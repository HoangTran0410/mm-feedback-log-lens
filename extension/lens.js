(function(){"use strict";
// @ts-check
// đọc DOM log của trang feedback admin, parse thành entry có cấu trúc + thống kê
// Các file src/*.js được build.sh nối lại và bọc trong MỘT IIFE nên dùng chung scope. Đặt tên không trùng nhau.

const LEVEL_ALIAS = { WARN: 'WARNING', VERBOSE: 'DEBUG', TRACE: 'DEBUG', FATAL: 'ERROR' };
const LEVEL_ORDER = ['ERROR', 'WARNING', 'INFO', 'DEBUG'];
const SIGNATURE_MAX_LENGTH = 120;
const ROW_SELECTOR = 'div[class*="logRow"]';

const RE_HEAD =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}):(\d{3}) GMT([+-])(\d{2}):(\d{2})\s+([A-Z]+)\s+([\s\S]*)$/;
const RE_MODULE = /\[Module: (?:\[([^\]]+)\]|([^[\]]+))\]/g;
const RE_MODULE_STRIP = /\[Module: (?:\[[^\]]+\]|[^[\]]+)\]\s*/g;
const RE_FLOW = /\[Flow: ([^\]]+)\]/;
const RE_FLOW_STRIP = /\[Flow: [^\]]+\]\s*/g;
const RE_TAG = /@@([A-Za-z][A-Za-z0-9_]*)/;
const RE_EVENT = /\bevent: ([a-z0-9_]+)/;
const RE_EVENT_PARAMS = /\| params: (\{[\s\S]*\})/;
const RE_TRACE_VERB = /@@ grafana >> ([a-zA-Z]+) >>/;
const RE_TRACE_PARAM = /TraceParameter\((.*)\)\s*$/;
const RE_METHOD = /\[Method: ([A-Z]+)\]/;
const RE_URL = /\[URL: (\S+?)\]/;
const RE_STATUS = /--status: (\d+)/;
const RE_ERRCODE = /"errorCode"\s*:\s*"?(-?\d+)|errorCode=(-?\d+)/;
const RE_BATCH = /LOGGER: END OF BATCH/;
// Trạng thái app nằm ghép trong dòng MQTT: "... - appState: BACKGROUND - isReady: false".
// Đây là chỗ DUY NHẤT trong log nói ra app đang ở nền hay đang mở — không có dòng lifecycle riêng
// (đã tìm: didEnterBackground / willEnterForeground / onPause đều 0 lần trên cả ba log).
const RE_APP_STATE = /appState[:= ]+([A-Z]+)/;
// Ba mốc đều ghi đúng một lần mỗi lần process khởi động, đều ở mức INFO và đều không bị bất kỳ cờ
// debug nào chặn (đã đọc source app). Đo trên 50 feedback production thật: "MomoDatabase init OK"
// có mặt ở 44/50 log — 6 log còn lại cần mốc dự phòng, vì file log bị xoay vòng thì dòng khởi động
// là dòng bị cắt đầu tiên.
//
// NHƯNG cả ba mốc đều nổ trong CÙNG một lần khởi động, cách nhau vài trăm ms. Đếm mỗi mốc là một phiên
// thì một lần mở app thành ba phiên — bug thật, người dùng bắt được. Đo trên ba log thật:
//   - khoảng cách GIỮA ba mốc của cùng một lần khởi động: 369, 382, 470, 916, 1000, 1119, 1829, 2078ms
//   - khoảng cách giữa HAI lần khởi động thật: 75 440ms và 163 029ms
// Hai nhóm cách nhau 36 lần, nên ngưỡng 5s nằm giữa khoảng trống đó, không sát mép nào.
const SESSION_MARKERS = [
  { kind: 'db', re: /MomoDatabase init OK/ },
  { kind: 'sync', re: /@@ appSync >> syncStartApp/ },
  { kind: 'perf', re: /\[PERF\] SyncAppFeature, start/ },
];
const SESSION_BURST_MS = 5000;

// Dòng nằm TRƯỚC mốc khởi động đầu tiên không thuộc phiên 1: chúng là phần đuôi của một lần chạy
// trước đó mà log không còn giữ điểm bắt đầu (log bị cắt bớt, hoặc app đã chạy từ lâu trước khi
// khoảng log này bắt đầu). Gộp chúng vào phiên 1 là nói rằng chúng xảy ra SAU lần khởi động đó —
// sai cả thứ tự lẫn việc ta thật sự biết gì. Chỉ số âm chứ không phải 0, vì bộ lọc kiểm phiên bằng
// `filter.session` theo kiểu truthy ở nhiều chỗ: phiên 0 sẽ bị đọc thành "không lọc phiên nào".
const SESSION_ORPHAN_INDEX = -1;

function sessionMarkerKind(message) {
  for (let i = 0; i < SESSION_MARKERS.length; i += 1) {
    if (SESSION_MARKERS[i].re.test(message)) return SESSION_MARKERS[i].kind;
  }
  return '';
}

function getLogRowElements() {
  return Array.from(document.querySelectorAll(ROW_SELECTOR));
}

// Log không scroll theo window mà theo một div lồng bên trong, phải tìm đúng nó để nhảy dòng.
function getLogScrollContainer(rowEl) {
  let node = rowEl ? rowEl.parentElement : null;
  while (node && node !== document.body) {
    if (node.scrollHeight > node.clientHeight + 40) return node;
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function parseModules(body) {
  const names = [];
  RE_MODULE.lastIndex = 0;
  let hit = RE_MODULE.exec(body);
  while (hit) {
    names.push((hit[1] || hit[2] || '').trim());
    hit = RE_MODULE.exec(body);
  }
  return names;
}

// Gom các dòng cùng bản chất về một chữ ký: bỏ timestamp, con trỏ, object id, uuid, appId, mọi con số.
// errorCode được giữ nguyên (lookbehind) vì đây là tín hiệu phân biệt lỗi thật sự.
// Đo trên log thật: 958 dòng WARNING gom còn 252 nhóm (trước khi bỏ <ptr>/<appId>/số nhỏ là 411).
function normalizeSignature(text) {
  return text
    .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[:.]\d{3}/g, '<ts>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/0x[0-9a-fA-F]+/g, '<ptr>')
    .replace(/@[0-9a-fA-F]{4,}/g, '@<id>')
    .replace(/\bvn\.momo\.[a-zA-Z0-9_]+/g, '<appId>')
    .replace(/\b[0-9a-fA-F]{16,}\b/g, '<hex>')
    .replace(/(?<!errorCode"?\s*[=:]\s*"?)(?<!Code=)\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHttpFields(body) {
  const method = RE_METHOD.exec(body);
  const url = RE_URL.exec(body);
  if (!method || !url) return null;

  const status = RE_STATUS.exec(body);
  const errCode = RE_ERRCODE.exec(body);
  let host = url[1];
  let path = url[1];
  try {
    const parsed = new URL(url[1]);
    host = parsed.host;
    path = parsed.pathname + (parsed.search ? '?...' : '');
  } catch (error) {
    // URL tương đối hoặc bị cắt giữa chừng: giữ nguyên chuỗi gốc.
  }

  let direction = 'other';
  if (body.indexOf('ResponsePayload') >= 0) direction = 'res';
  else if (body.indexOf('RequestPayload') >= 0) direction = 'req';

  return {
    method: method[1],
    url: url[1],
    host,
    path,
    direction,
    status: status ? Number(status[1]) : null,
    errorCode: errCode ? Number(errCode[1] != null ? errCode[1] : errCode[2]) : null,
  };
}

// params của MoMoTracker không phải JSON mà là map "k=v, k=v": parseKeyValueMap (02-insights) đã xử lý
// đúng dấu phẩy nằm trong giá trị (bundle_sof=1,2) và map lồng nhau (last_component={...}).
// Đo trên log thật: 940/940 dòng có "| params: {" đều parse ra map, không dòng nào thất bại.
// indexOf chặn trước vì đại đa số dòng không hề có params, không cần chạy regex.
function parseEventParams(message) {
  if (message.indexOf('| params: {') < 0) return null;
  const hit = RE_EVENT_PARAMS.exec(message);
  return hit ? parseKeyValueMap(hit[1]) : null;
}

// Grafana ghi tham số dưới dạng TraceParameter(k=v, k=v) — cùng một định dạng k=v với params của
// tracker, chỉ khác cặp bao ngoài. Bọc lại thành {k=v} để dùng chung parseKeyValueMap, hưởng luôn
// cả phần nối lại mảnh bị dấu phẩy xẻ đôi. Đo trên hai log thật (một UAT, một prod): 3904/3904 dòng
// TraceParameter parse ra map có trường flow.
function parseTraceParameter(message) {
  const hit = RE_TRACE_PARAM.exec(message);
  return hit ? parseKeyValueMap('{' + hit[1] + '}') : null;
}

function parseEntry(rawText, domIndex, lineNo, el) {
  const entry = {
    domIndex,
    lineNo,
    el,
    raw: rawText,
    kind: 'log',
    level: '',
    ts: null,
    // Mốc dùng RIÊNG cho cửa sổ thời gian: dòng không có giờ thừa hưởng giờ của dòng có giờ gần nhất
    // phía trên. Không nhập vào ts vì ts đi vào khoảng lặng, minimap, phiên app — thêm giờ giả vào đó
    // là đổi số liệu, còn ở đây chỉ là để dòng tiếp nối không bị cửa sổ thời gian cắt mất.
    windowTs: null,
    time: '',
    modules: [],
    module: '',
    ownerModule: '',
    flow: '',
    tag: '',
    event: '',
    eventParams: null,
    traceVerb: '',
    traceParams: null,
    message: rawText,
    signature: '',
    http: null,
    session: 1,
    // Đặt true cho dòng ĐẦU TIÊN của mỗi chùm mốc khởi động. Tab Diễn biến đọc cờ này chứ không
    // dò lại regex, nếu không một lần mở app sẽ vẽ ra ba mốc "App khởi động" chồng nhau.
    isSessionStart: false,
    // Nằm trong khối bị lặp lại nguyên xi (xem src/02h-duplicate.js).
    isDuplicate: false,
    // 'FOREGROUND' | 'BACKGROUND' | '' — đọc từ dòng MQTT, xem RE_APP_STATE.
    appState: '',
  };

  const head = RE_HEAD.exec(rawText);
  if (!head) {
    if (RE_BATCH.test(rawText)) entry.kind = 'batch';
    else if (!rawText.trim()) entry.kind = 'blank';
    else entry.kind = 'cont';
    return entry;
  }

  const offsetMinutes = (Number(head[9]) * 60 + Number(head[10])) * (head[8] === '-' ? -1 : 1);
  entry.ts = Date.UTC(+head[1], +head[2] - 1, +head[3], +head[4], +head[5], +head[6], +head[7]) - offsetMinutes * 60000;
  entry.time = head[4] + ':' + head[5] + ':' + head[6] + '.' + head[7];
  entry.level = LEVEL_ALIAS[head[11]] || head[11];

  const body = head[12];
  entry.modules = parseModules(body);
  entry.module = entry.modules[entry.modules.length - 1] || '';
  entry.ownerModule = entry.modules.length > 1 ? entry.modules[0] : '';

  const flow = RE_FLOW.exec(body);
  if (flow) entry.flow = flow[1];

  entry.message = body.replace(RE_MODULE_STRIP, '').replace(RE_FLOW_STRIP, '').trim();

  const tag = RE_TAG.exec(entry.message);
  if (tag) entry.tag = '@@' + tag[1];
  const event = RE_EVENT.exec(entry.message);
  if (event) {
    entry.event = event[1];
    entry.eventParams = parseEventParams(entry.message);
  }

  // indexOf chặn trước: chỉ dòng Grafana mới mang trace, chạy regex trên mọi dòng là vô ích.
  if (entry.message.indexOf('@@ grafana >> ') >= 0) {
    const traceVerb = RE_TRACE_VERB.exec(entry.message);
    if (traceVerb) {
      entry.traceVerb = traceVerb[1];
      entry.traceParams = parseTraceParameter(entry.message);
    }
  }

  const appState = entry.message.indexOf('appState') >= 0 ? RE_APP_STATE.exec(entry.message) : null;
  if (appState) entry.appState = appState[1];

  entry.http = parseHttpFields(body);
  // Chỉ ERROR/WARNING mới vào buildIssueGroups. Tính chữ ký cho cả 4085 dòng là lãng phí nặng nhất
  // lúc khởi động: 7 lượt replace trên những dòng payload HTTP dài tới 10KB mà không ai dùng đến.
  if (entry.level === 'ERROR' || entry.level === 'WARNING') {
    entry.signature = normalizeSignature(entry.message).slice(0, SIGNATURE_MAX_LENGTH);
  }
  return entry;
}

function countBy(entries, pickKey) {
  const map = new Map();
  entries.forEach((entry) => {
    const key = pickKey(entry);
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map, (pair) => ({ key: pair[0], count: pair[1] })).sort((a, b) => b.count - a.count);
}

function buildIssueGroups(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    if (entry.level !== 'ERROR' && entry.level !== 'WARNING') return;
    const key = entry.level + ' :: ' + entry.module + ' :: ' + entry.signature;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        level: entry.level,
        module: entry.module,
        signature: entry.signature,
        sample: entry.message,
        // Lỗi của chính lớp đo lường, không phải lỗi user gặp. Đánh dấu ngay lúc gom để tab Vấn đề
        // tách riêng ra — đo trên 50 feedback production: 1267/2488 dòng ERROR (51%) là loại này.
        noiseLabel: telemetryNoiseLabel(entry.message),
        indices: [],
        firstTs: entry.ts,
        lastTs: entry.ts,
      };
      map.set(key, group);
    }
    group.indices.push(entry.domIndex);
    if (entry.ts) {
      if (!group.firstTs || entry.ts < group.firstTs) group.firstTs = entry.ts;
      if (!group.lastTs || entry.ts > group.lastTs) group.lastTs = entry.ts;
    }
  });
  return Array.from(map.values()).sort((a, b) => {
    if (a.level !== b.level) return a.level === 'ERROR' ? -1 : 1;
    return b.indices.length - a.indices.length;
  });
}

// Ghép request với response theo CÙNG MỘT URL, FIFO theo thứ tự dòng, có cửa sổ lùi một dòng.
//
// Vì sao cần cửa sổ lùi: logger ghi theo lô nên dòng ResponsePayload có thể nằm TRƯỚC dòng
// RequestPayload của chính nó. Đo trên ba log thật: 0 / 3 / 16 cặp nằm ngược, và MỌI cặp ngược quan
// sát được đều lệch đúng MỘT dòng (Δdòng = -1, Δts = 0 hoặc -2ms) — hai dòng ra trong cùng một lần
// flush. Vì vậy HTTP_PAIR_LOOKAHEAD = 1.
//
// Bản cũ ghép response với request đứng trước nó theo dòng nên hỏng cả hai đầu: request thật bị báo
// "không có response" (=> vào badHttpCalls, vào thẻ "HTTP bất thường", vào ticket), rồi chính
// response đó lại sinh thêm một hàng "call ma". Đo trên log production: 94 dòng request và 94 dòng
// response mà ra 104 call, 10 cái báo thiếu response. Sau khi sửa: 94 call, 0 cái thiếu response.
//
// ĐÃ THỬ và bỏ: ghép theo trục THỜI GIAN thay vì thứ tự dòng. Trục thời gian nhiễu hơn nhiều — trên
// log uat1 có một cặp request/response nằm đúng thứ tự dòng mà timestamp lệch NGƯỢC 728ms, chặn theo
// ts thì cặp đó bị xẻ đôi. Thứ tự dòng sai ít hơn, và sai theo một kiểu duy nhất (lệch một dòng).
//
// CHƯA XÁC MINH: giả định một URL trả về theo đúng thứ tự gọi. Dòng HTTP trong log chỉ có [Method:]
// và [URL:], không có trường nào nối request với response, nên không có cách nào chắc hơn.
const HTTP_PAIR_LOOKAHEAD = 1;

function makeHttpCall(entry) {
  const http = entry.http;
  return {
    reqIndex: null,
    resIndex: null,
    ts: entry.ts,
    time: entry.time,
    method: http.method,
    url: http.url,
    host: http.host,
    path: http.path,
    status: http.status,
    errorCode: http.errorCode,
    duration: null,
  };
}

function pairHttpSides(reqs, ress, calls) {
  const open = [];
  let next = 0;
  ress.forEach((res) => {
    // Mở mọi request nằm trước response này (cộng cửa sổ lùi), rồi lấy cái chờ lâu nhất.
    while (next < reqs.length && reqs[next].domIndex <= res.domIndex + HTTP_PAIR_LOOKAHEAD) {
      open.push(reqs[next]);
      next += 1;
    }
    const req = open.shift();
    if (!req) {
      // Response mồ côi: request của nó nằm ngoài log (log bị cắt đầu) hoặc đang bị bộ lọc giấu đi.
      // Đo trên log uat1: 52 dòng request / 58 dòng response, 6 response đầu file không có request.
      const orphan = makeHttpCall(res);
      orphan.resIndex = res.domIndex;
      calls.push(orphan);
      return;
    }
    const call = makeHttpCall(req);
    call.reqIndex = req.domIndex;
    call.resIndex = res.domIndex;
    call.status = res.http.status;
    call.errorCode = res.http.errorCode;
    // Lệch âm (response ghi trước request) thì để trống chứ không báo số âm: không biết call chạy bao
    // lâu thì hàng đó hiện giờ thay vì hiện một con số sai.
    const delta = res.ts && req.ts ? res.ts - req.ts : -1;
    call.duration = delta >= 0 ? delta : null;
    calls.push(call);
  });
  open.concat(reqs.slice(next)).forEach((req) => {
    const call = makeHttpCall(req);
    call.reqIndex = req.domIndex;
    calls.push(call);
  });
}

function buildHttpCalls(entries) {
  const byUrl = new Map();
  entries.forEach((entry) => {
    if (!entry.http) return;
    let pair = byUrl.get(entry.http.url);
    if (!pair) {
      pair = { reqs: [], ress: [] };
      byUrl.set(entry.http.url, pair);
    }
    // direction 'other' (không có cả RequestPayload lẫn ResponsePayload) tính là phía request, giữ
    // nguyên như bản cũ. Đo trên ba log thật: 0 dòng rơi vào nhánh này.
    (entry.http.direction === 'res' ? pair.ress : pair.reqs).push(entry);
  });
  const calls = [];
  // entries đi vào theo thứ tự dòng nên reqs/ress đã sẵn thứ tự, không cần sort lại.
  byUrl.forEach((pair) => pairHttpSides(pair.reqs, pair.ress, calls));
  // Trả về theo thứ tự dòng của đầu sớm nhất: danh sách call trên panel đọc từ trên xuống.
  return calls.sort((a, b) => httpCallAnchor(a) - httpCallAnchor(b));
}

function httpCallAnchor(call) {
  return call.reqIndex != null ? call.reqIndex : call.resIndex;
}

// Gap phải tính trên trục thời gian đã sort: logger flush theo lô nên thứ tự dòng không phải thứ tự thời gian.
// Cửa sổ xê dịch cho phép giữa mốc đổi trạng thái và hai đầu khoảng lặng.
const GAP_STATE_TOLERANCE_MS = 2000;

// Đánh dấu khoảng lặng nào là do APP XUỐNG NỀN chứ không phải app treo. Trước đây tool báo hai trường
// hợp như nhau — đó là false positive lớn nhất của tính năng khoảng lặng: "user bấm Home" bị đọc thành
// "app đứng im". Đo trên log thật (33112319): 22 khoảng lặng, đúng 2 cái dài nhất (142.7s và 231.8s)
// là app ở nền, 20 cái còn lại không có mốc đổi trạng thái nào.
function markBackgroundGaps(gaps, timed) {
  const marks = [];
  let last = '';
  timed.forEach((entry) => {
    if (!entry.appState || entry.appState === last) return;
    marks.push({ ts: entry.ts, state: entry.appState });
    last = entry.appState;
  });
  if (!marks.length) return;
  gaps.forEach((gap) => {
    // Phải có CẢ HAI đầu: xuống nền trong lòng khoảng lặng, và trở lại ở cuối khoảng. Chỉ thấy một
    // đầu thì không kết luận — có thể là app xuống nền rồi bị giết hẳn.
    // Nới lỏng CẢ hai đầu bằng GAP_STATE_TOLERANCE_MS. Đo thật: mốc xuống nền nằm SỚM HƠN gap.before
    // vài chục ms, vì ba module MQTT cùng ghi một lúc và dòng cuối trước khoảng lặng là dòng thứ ba,
    // còn mốc đổi trạng thái là dòng thứ nhất. Chặn cứng "mốc >= gap.before.ts" thì trượt hết.
    const down = marks.find((mark) => mark.state === 'BACKGROUND' &&
      mark.ts >= gap.before.ts - GAP_STATE_TOLERANCE_MS && mark.ts <= gap.after.ts);
    if (!down) return;
    const up = marks.find((mark) => mark.state === 'FOREGROUND' &&
      mark.ts >= down.ts && mark.ts <= gap.after.ts + GAP_STATE_TOLERANCE_MS);
    if (!up) return;
    gap.cause = 'background';
    gap.downTs = down.ts;
    gap.upTs = up.ts;
  });
}

function buildGaps(entries, gapThresholdMs) {
  // Bỏ dòng thuộc khối lặp: log bị nối đôi thì mọi mốc thời gian xuất hiện hai lần, hai dòng liên tiếp
  // sau khi sort cách nhau 0ms nên KHÔNG còn khoảng lặng nào được nhận ra. Đo thật trên log
  // production bị nối đôi: 0 khoảng lặng trước khi bỏ, đúng số thật sau khi bỏ. Khối lặp không thể
  // tạo ra hay xoá đi một khoảng im lặng có thật — nó chỉ che mất, nên bỏ là đúng cả khi người dùng
  // chưa bật "bỏ khối lặp".
  const timed = entries.filter((entry) => entry.ts && !entry.isDuplicate).slice()
    .sort((a, b) => a.ts - b.ts);
  const gaps = [];
  for (let i = 1; i < timed.length; i += 1) {
    const delta = timed[i].ts - timed[i - 1].ts;
    if (delta >= gapThresholdMs) gaps.push({ ms: delta, before: timed[i - 1], after: timed[i], cause: '' });
  }
  markBackgroundGaps(gaps, timed);
  return { timed, gaps };
}

function isBadHttpCall(call) {
  if (call.resIndex === null) return true;
  if (call.status && call.status >= 400) return true;
  return call.errorCode != null && call.errorCode !== 0;
}

function analyzeLog(gapThresholdMs) {
  const rowEls = getLogRowElements();
  const entries = rowEls.map((el, index) => {
    const text = (el.children[1] ? el.children[1].textContent : el.textContent) || '';
    const parsedLineNo = el.children[0] ? parseInt(el.children[0].textContent, 10) : NaN;
    return parseEntry(text, index, Number.isNaN(parsedLineNo) ? index + 1 : parsedLineNo, el);
  });

  // Một lần khởi động = một CHÙM mốc, không phải một mốc. Sang phiên mới khi: cách mốc trước quá
  // SESSION_BURST_MS, HOẶC gặp lại đúng loại mốc đã thấy trong chùm này — một process không thể ghi
  // "MomoDatabase init OK" hai lần, nên mốc trùng loại chắc chắn là lần khởi động khác. Về điều kiện
  // thứ hai: đúng trên bốn chùm quan sát được (mỗi chùm đúng một mốc mỗi loại), CHƯA XÁC MINH được
  // rằng không log nào lặp lại một loại mốc giữa chừng một lần chạy.
  let sessionCount = 0;
  let lastMarkerTs = 0;
  let hasOrphanTail = false;
  let burstKinds = new Set();
  entries.forEach((entry) => {
    const kind = sessionMarkerKind(entry.message);
    if (kind) {
      const gap = entry.ts && lastMarkerTs ? entry.ts - lastMarkerTs : Infinity;
      if (gap > SESSION_BURST_MS || burstKinds.has(kind)) {
        sessionCount += 1;
        burstKinds = new Set();
        entry.isSessionStart = true;
      }
      burstKinds.add(kind);
      if (entry.ts) lastMarkerTs = entry.ts;
    }
    entry.session = sessionCount || SESSION_ORPHAN_INDEX;
    if (entry.session === SESSION_ORPHAN_INDEX) hasOrphanTail = true;
  });

  let outOfOrder = 0;
  let previousTs = 0;
  entries.forEach((entry) => {
    // Đo trên ba log thật: 240 / 180 / 85 dòng không có giờ (dòng tiếp nối của stack trace, dòng
    // trống, dòng "END OF BATCH"). Trước đây cửa sổ thời gian loại thẳng chúng, nên bật cửa sổ quanh
    // đúng lúc lỗi nổ ra thì chính phần stack trace nhiều dòng của lỗi đó bị giấu đi.
    if (!entry.ts) {
      entry.windowTs = previousTs || null;
      return;
    }
    if (previousTs && entry.ts < previousTs) outOfOrder += 1;
    previousTs = entry.ts;
    entry.windowTs = entry.ts;
  });

  // Đánh dấu khối lặp TRƯỚC khi tính thống kê: bộ lọc "bỏ khối lặp" đọc cờ này.
  const duplicate = markDuplicateEntries(entries);

  const timeline = buildGaps(entries, gapThresholdMs);

  // Phần phụ thuộc tập dòng (levels/groups/http/modules/...) nằm trong deriveStats, dùng chung với
  // lúc tính lại theo bộ lọc. Phần còn lại là thuộc tính của cả file, không bao giờ scope.
  return Object.assign({
    rowEls,
    entries,
    container: getLogScrollContainer(rowEls[0]),
    // Đếm cả đoạn mồ côi: nó là một lần chạy khác thật, chỉ là không thấy điểm bắt đầu. Log không có
    // mốc nào thì ra đúng 1 như trước, chỉ khác ở chỗ đoạn đó nay tự khai là không rõ điểm đầu.
    sessionCount: sessionCount + (hasOrphanTail ? 1 : 0),
    hasOrphanTail,
    duplicate,
    outOfOrder,
    batchCount: entries.filter((entry) => entry.kind === 'batch').length,
    gaps: timeline.gaps,
    firstTs: timeline.timed.length ? timeline.timed[0].ts : 0,
    lastTs: timeline.timed.length ? timeline.timed[timeline.timed.length - 1].ts : 0,
  }, deriveStats(entries, timeline.gaps));
}
// @ts-check
// thời lượng, ID liên kết, phiên app, metadata feedback
// Tách ra từ src/02-insights.js (946 dòng). Các file src/*.js được build.sh nối lại theo thứ tự
// tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc.

// Chạy sau analyzeLog trên cùng mảng entries. Tách riêng để 01-analyzer.js không phình quá 500 dòng.

// Vài chỗ trong log ghi nhầm epoch vào trường duration= (ví dụ duration=1788836518693),
// nên bỏ mọi giá trị vượt ngưỡng này thay vì tin mù.
const MAX_PLAUSIBLE_DURATION_MS = 600000;

const DURATION_PATTERNS = [
  { kind: 'duration', re: /\bduration=(\d+)\b/ },
  { kind: 'KMM', re: /\bduration KMM:\s*(\d+)\s?ms/ },
  { kind: 'elapsed', re: /\bin (\d+)\s?ms\b/ },
  { kind: 'write', re: /\bwrite=(\d+)\s?ms/ },
  { kind: 'waited', re: /\btotalWaited[A-Za-z]*\s*[:=]\s*(\d+)/ },
  { kind: 'took', re: /\btook (\d+)\s?ms\b/ },
];
// Cố ý KHÔNG bắt pattern chung chung kiểu /(\d+)\s?ms/: nó ăn cả giá trị cấu hình
// (ví dụ một module khai báo cửa sổ chờ 5000ms) và đẩy lên đầu bảng như thể là thao tác chậm.

const CORRELATION_PATTERNS = [
  { key: 'cmdId', re: /"cmdId"\s*:\s*"([^"]{6,})"/g },
  { key: 'cmdId', re: /\bcmdId=([A-Za-z0-9_-]{6,})/g },
  { key: 'request_id', re: /"request_id"\s*:\s*"([^"]{6,})"/g },
  { key: 'riskId', re: /\briskId=([A-Za-z0-9_]{6,})/g },
  { key: 'traceId', re: /\btraceId["\s]*[:=]\s*"?([A-Za-z0-9-]{6,})/g },
];

const METADATA_LABELS = ['AgentID', 'Device OS', 'Network', 'App Info', 'Entry Point', 'MiniApp', 'Feature',
  'ScreenID', 'Version'];

function extractDurations(entries) {
  const rows = [];
  entries.forEach((entry) => {
    if (!entry.message) return;
    // Sàng lọc bằng indexOf trước: đại đa số dòng không hề có số đo thời gian, không cần chạy 6 regex.
    if (entry.message.indexOf('ms') < 0 && entry.message.indexOf('duration=') < 0 &&
      entry.message.indexOf('Waited') < 0) return;
    for (let i = 0; i < DURATION_PATTERNS.length; i += 1) {
      const hit = DURATION_PATTERNS[i].re.exec(entry.message);
      if (!hit) continue;
      const ms = Number(hit[1]);
      if (!ms || ms > MAX_PLAUSIBLE_DURATION_MS) continue;
      rows.push({
        domIndex: entry.domIndex,
        lineNo: entry.lineNo,
        ms,
        kind: DURATION_PATTERNS[i].kind,
        module: entry.module,
        time: entry.time,
        message: entry.message,
      });
      return;
    }
  });
  // KHÔNG cắt bớt ở đây: cắt trước khi trả về thì tổng bị mất luôn, badge của mục ghi 80 trong khi
  // log có 160 con số — mà chữ ngay dưới lại ghi "Mọi con số thời lượng". Việc cắt bớt để cho
  // capSectionRows() làm sau khi vẽ, lúc đó vẫn còn tổng thật để ghi badge.
  return rows.sort((a, b) => b.ms - a.ms);
}

// Một cmdId xuất hiện ở nhiều dòng = một request đi qua nhiều lớp. Gom lại là dựng được cả luồng.
function buildCorrelations(entries) {
  const byValue = new Map();
  entries.forEach((entry) => {
    entry.correlationIds = [];
    if (!entry.raw) return;
    // Cùng lý do: quét 5 regex toàn cục trên 1.2MB text là vô ích khi dòng đó không chứa tên ID nào.
    if (entry.raw.indexOf('cmdId') < 0 && entry.raw.indexOf('request_id') < 0 &&
      entry.raw.indexOf('riskId') < 0 && entry.raw.indexOf('traceId') < 0) return;
    CORRELATION_PATTERNS.forEach((pattern) => {
      pattern.re.lastIndex = 0;
      let hit = pattern.re.exec(entry.raw);
      while (hit) {
        const value = hit[1];
        let bucket = byValue.get(value);
        if (!bucket) {
          bucket = { key: pattern.key, value, indices: [] };
          byValue.set(value, bucket);
        }
        if (bucket.indices[bucket.indices.length - 1] !== entry.domIndex) bucket.indices.push(entry.domIndex);
        if (!entry.correlationIds.some((item) => item.value === value)) {
          entry.correlationIds.push({ key: pattern.key, value });
        }
        hit = pattern.re.exec(entry.raw);
      }
    });
  });
  return Array.from(byValue.values())
    .filter((bucket) => bucket.indices.length > 1)
    .sort((a, b) => b.indices.length - a.indices.length);
}

// Đánh theo Map chứ không theo vị trí trong mảng: phiên mồ côi mang chỉ số âm (SESSION_ORPHAN_INDEX),
// mà `sessions[index - 1]` với index âm ghi ra một thuộc tính chứ không phải phần tử — filter(Boolean)
// sau đó sẽ nuốt luôn cả phiên đó. Sắp theo chỉ số nên đoạn mồ côi đứng đầu, đúng thứ tự nó nằm trong log.
function buildSessions(entries) {
  const byIndex = new Map();
  entries.forEach((entry) => {
    if (!entry.level) return;
    let session = byIndex.get(entry.session);
    if (!session) {
      session = { index: entry.session, firstIndex: entry.domIndex, startTs: entry.ts, endTs: entry.ts, lineCount: 0,
        errorCount: 0, isOrphanTail: entry.session === SESSION_ORPHAN_INDEX };
      byIndex.set(entry.session, session);
    }
    session.lineCount += 1;
    if (entry.level === 'ERROR') session.errorCount += 1;
    if (entry.ts) {
      if (!session.startTs || entry.ts < session.startTs) session.startTs = entry.ts;
      if (!session.endTs || entry.ts > session.endTs) session.endTs = entry.ts;
    }
  });
  return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
}

// Metadata của feedback nằm ngay trên trang dưới dạng <span class="ant-tag">Nhãn: giá trị</span>.
// Current Context đứng trước Error Context trong DOM nên lấy lần xuất hiện đầu tiên là đúng cái đang có hiệu lực.
function readFeedbackContext() {
  const context = {};
  document.querySelectorAll('span[class*="ant-tag"]').forEach((el) => {
    const hit = /^([A-Za-z][A-Za-z ]*):\s*(.+)$/.exec((el.textContent || '').trim());
    if (!hit) return;
    const label = hit[1].trim();
    const value = hit[2].trim();
    if (METADATA_LABELS.indexOf(label) < 0 || context[label] || value === 'N/A') return;
    context[label] = value;
  });
  const timeEl = document.querySelector('[class*="serverTime"]');
  const timeHit = timeEl && /Time:\s*([\d/]+)\s*-\s*(\d{1,2}:\d{2})/.exec(timeEl.textContent || '');
  if (timeHit) context.submittedAt = timeHit[1] + ' ' + timeHit[2];
  return context;
}
// @ts-check
// tách khối JSON trong dòng log, và lớp k=v dùng chung cho cả tracker lẫn Grafana
// Tách ra từ src/02-insights.js (946 dòng). Các file src/*.js được build.sh nối lại theo thứ tự
// tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc.

// Trả về cả vị trí bắt đầu/kết thúc: người gọi còn phải đọc tiếp phần đằng sau khối JSON này.
function extractJsonBlock(text) {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let isInString = false;
  let isEscaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (isInString) {
      if (isEscaped) isEscaped = false;
      else if (char === '\\') isEscaped = true;
      else if (char === '"') isInString = false;
      continue;
    }
    if (char === '"') isInString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return { text: text.slice(start, i + 1), start, end: i + 1 };
    }
  }
  return null;
}

// Logger của app cắt bớt message quá dài ("... exceeds 10000 characters."), nên khối JSON không
// bao giờ đóng lại và JSON.parse chịu thua. Nhưng phần đã có vẫn là dữ liệu đọc được: cắt đến điểm
// an toàn gần nhất rồi tự đóng nốt các ngoặc còn mở.
//
// "Điểm an toàn" = vị trí mà cắt ở đó vẫn còn là JSON hợp lệ: ngay sau một GIÁ TRỊ hoàn chỉnh,
// ngay sau dấu mở ngoặc, hoặc ngay TRƯỚC một dấu phẩy. Cố ý KHÔNG nhận điểm an toàn sau một số
// chưa có dấu phân cách đằng sau: 1788464400000 bị cắt thành 1788 vẫn parse được nhưng là số SAI —
// thà bỏ hẳn còn hơn đưa ra một con số bịa.
// Nhận luôn cụm **** là một 'giá trị': chỗ bị che vẫn là dữ liệu thật, để repairMaskedJson dọn sau.
const JSON_LITERAL_RE = /^(-?\d+(\.\d+)?([eE][-+]?\d+)?|true|false|null|\*{2,})$/;

function findSafeJsonCut(text, start) {
  const frames = [];
  let safeCut = -1;
  // Gán trong closure markSafe() bên dưới nên phải nói rõ kiểu: nếu để tự suy từ `null`
  // thì TypeScript thu hẹp còn `never` và báo lỗi ở chỗ đọc lại.
  /** @type {string[] | null} */
  let safeFrames = null;
  let isInString = false;
  let isEscaped = false;
  let stringStart = -1;
  let literalStart = -1;

  const markSafe = (index) => {
    safeCut = index;
    safeFrames = frames.map((frame) => frame.type);
  };
  const closeValue = (index) => {
    if (frames.length) frames[frames.length - 1].hasKey = false;
    markSafe(index);
  };

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (isInString) {
      if (isEscaped) isEscaped = false;
      else if (char === '\\') isEscaped = true;
      else if (char === '"') {
        isInString = false;
        const frame = frames[frames.length - 1];
        // Trong object, chuỗi đầu tiên của mỗi cặp là TÊN trường — cắt ngay sau nó là hỏng.
        if (frame && frame.type === '{' && !frame.hasKey) frame.hasKey = true;
        else closeValue(i + 1);
      }
      continue;
    }
    if (literalStart >= 0 && /[\s,}\]]/.test(char)) {
      if (!JSON_LITERAL_RE.test(text.slice(literalStart, i))) break;
      closeValue(i);
      literalStart = -1;
    }
    if (char === '"') {
      isInString = true;
      stringStart = i;
    } else if (char === '{' || char === '[') {
      frames.push({ type: char, hasKey: false });
      markSafe(i + 1);
    } else if (char === '}' || char === ']') {
      frames.pop();
      if (!frames.length) return { cut: i + 1, closers: '' };
      closeValue(i + 1);
    } else if (char === ',') {
      markSafe(i);
    } else if (literalStart < 0 && !/[\s:]/.test(char)) {
      // Ký tự không thể mở đầu một giá trị JSON = đã hết phần dữ liệu, phần sau là chữ của logger
      // ("... Log message truncated; exceeds 10000 characters."). Dừng hẳn, đừng nuốt nó làm giá trị.
      if (!/[-0-9tfn*]/.test(char)) break;
      literalStart = i;
    }
  }
  // Hết text khi đang ở giữa một chuỗi (ví dụ "payload":"[{\\"id\\":...): đóng chuỗi lại để giữ phần
  // đã đọc được, thay vì vứt cả trường. Thêm dấu … để nhìn là biết giá trị này bị cắt giữa chừng.
  if (isInString && frames.length && stringStart > safeCut) {
    const frame = frames[frames.length - 1];
    if (frame.type !== '{' || frame.hasKey) {
      // Khi chỗ cắt nằm giữa chuỗi, dòng chữ của logger bị kẹt luôn BÊN TRONG giá trị — cắt nó ra.
      const marker = /\.{3}\s*Log message truncated[^"]*$/.exec(text);
      let cut = marker ? marker.index : text.length;
      let slashes = 0;
      while (text[cut - 1 - slashes] === '\\') slashes += 1;
      if (slashes % 2 === 1) cut -= 1;
      const halfEscape = /\\u[0-9a-fA-F]{0,3}$/.exec(text.slice(stringStart, cut));
      if (halfEscape) cut -= halfEscape[0].length;
      markSafe(cut);
      return { cut, closers: '…"' + closersFor(safeFrames), lostChars: text.length - cut, isCutInString: true };
    }
  }
  if (safeCut < 0 || !safeFrames || !safeFrames.length) return null;
  return { cut: safeCut, closers: closersFor(safeFrames), lostChars: text.length - safeCut };
}

function closersFor(types) {
  return types
    .map((type) => (type === '{' ? '}' : ']'))
    .reverse()
    .join('');
}

// Log che giá trị nhạy cảm trước khi gửi lên server, và che theo hai kiểu:
//   {"userId":"0","****","****","sessionKey":""}   — chuỗi "****" trơ trọi
//   {"userId":12345678,****,"balance":"..."}      — **** trần, không có nháy
// Cả hai đều làm JSON.parse hỏng. Quét có phân biệt trong/ngoài chuỗi để không đụng nhầm
// những giá trị mà chính nó chứa dấu sao, ví dụ "accountNo":"**** **** **32".
function findMaskedSpans(block) {
  const spans = [];
  let isInString = false;
  let isEscaped = false;
  let stringStart = -1;
  for (let i = 0; i < block.length; i += 1) {
    const char = block[i];
    if (isInString) {
      if (isEscaped) isEscaped = false;
      else if (char === '\\') isEscaped = true;
      else if (char === '"') {
        isInString = false;
        // Chuỗi toàn dấu sao và không theo sau bởi ':' thì không phải tên trường — nó là chỗ bị che.
        if (/^\*{2,}$/.test(block.slice(stringStart + 1, i)) && nextNonSpaceChar(block, i + 1) !== ':') {
          spans.push([stringStart, i + 1]);
        }
      }
      continue;
    }
    if (char === '"') {
      isInString = true;
      stringStart = i;
    } else if (char === '*') {
      let end = i;
      while (block[end] === '*') end += 1;
      if (end - i >= 2) spans.push([i, end]);
      i = end - 1;
    }
  }
  return spans;
}

function nextNonSpaceChar(text, from) {
  for (let i = from; i < text.length; i += 1) if (!/\s/.test(text[i])) return text[i];
  return '';
}

function lastNonSpaceIndex(text, from) {
  for (let i = from; i >= 0; i -= 1) if (!/\s/.test(text[i])) return i;
  return -1;
}

function firstNonSpaceIndex(text, from) {
  for (let i = from; i < text.length; i += 1) if (!/\s/.test(text[i])) return i;
  return text.length;
}

// Sửa từ cuối về đầu để chỉ số của các chỗ còn lại không bị lệch.
function repairMaskedJson(block) {
  const spans = findMaskedSpans(block);
  if (!spans.length) return block;
  let out = block;
  let maskedKeyCount = 0;
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const start = spans[i][0];
    const end = spans[i][1];
    const before = lastNonSpaceIndex(out, start - 1);
    const after = firstNonSpaceIndex(out, end);
    if (before >= 0 && out[before] === ':') {
      // Giá trị bị che: giữ lại để người đọc vẫn thấy trường đó tồn tại, chỉ bọc thêm cặp nháy.
      out = out.slice(0, start) + '"****"' + out.slice(end);
    } else if (out[after] === '{' || out[after] === '[' || out[after] === '"') {
      // Chỗ che ăn cả TÊN trường, còn giá trị thì không: ,****{"displayName":...}
      // Đánh số để hai chỗ bị che trong cùng một object không đè lên nhau làm mất dữ liệu.
      maskedKeyCount += 1;
      out = out.slice(0, start) + '"****#' + maskedKeyCount + '":' + out.slice(end);
    } else if (before >= 0 && out[before] === ',') {
      out = out.slice(0, before) + out.slice(end);
    } else if (out[after] === ',') {
      out = out.slice(0, start) + out.slice(after + 1);
    } else {
      out = out.slice(0, start) + out.slice(end);
    }
  }
  return out;
}

function parseJsonMaybeMasked(block) {
  try {
    return { pretty: JSON.stringify(JSON.parse(block), null, 2), isParsed: true, isRepaired: false };
  } catch (error) {
    // Rơi vào đây gần như luôn là vì chỗ bị che; thử dọn riêng những chỗ đó rồi parse lại.
  }
  const repaired = repairMaskedJson(block);
  if (repaired !== block) {
    try {
      return { pretty: JSON.stringify(JSON.parse(repaired), null, 2), isParsed: true, isRepaired: true };
    } catch (error) {
      // Hỏng vì lý do khác (thường là log cắt bớt payload dài): trả nguyên văn.
    }
  }
  return { pretty: block, isParsed: false, isRepaired: false };
}

// Dòng HTTP gói payload theo dạng "--tên: giá trị" nối đuôi nhau trên cùng một dòng:
//   [RequestPayload: --encrypted: false --body: {...} --encryptedBody:  --header: {...}]--exception: none
// Đọc từng trường một, và khi giá trị là JSON thì nhảy thẳng qua hết khối đó — nhờ vậy
// một chuỗi "--x:" nằm bên trong JSON không bị tưởng nhầm là trường mới.
const PAYLOAD_FIELD_RE = /--([A-Za-z][A-Za-z0-9_]*)\s*:/g;
const BODY_LABEL_RE = /(?:responseBody|requestBody|body|payload)\s*:/i;

function countChar(text, char) {
  let total = 0;
  for (let i = 0; i < text.length; i += 1) if (text[i] === char) total += 1;
  return total;
}

// Trường cuối thường dính theo dấu ] đóng khối [RequestPayload: ...]. Chỉ cắt khi thật sự thừa.
function trimPayloadScalar(text) {
  let value = text.trim();
  while (value.slice(-1) === ']' && countChar(value, ']') > countChar(value, '[')) {
    value = value.slice(0, -1).trim();
  }
  return value;
}

function splitPayloadFields(raw) {
  const fields = [];
  let cursor = 0;
  for (;;) {
    PAYLOAD_FIELD_RE.lastIndex = cursor;
    const hit = PAYLOAD_FIELD_RE.exec(raw);
    if (!hit) break;
    const valueStart = hit.index + hit[0].length;
    const rest = raw.slice(valueStart);
    const lead = /^\s*/.exec(rest)[0].length;
    let value = null;
    let end = 0;
    if (rest[lead] === '{' || rest[lead] === '[') {
      const block = extractJsonBlock(rest);
      if (block && block.start === lead) {
        value = block.text;
        end = valueStart + block.end;
      }
    }
    if (value === null) {
      PAYLOAD_FIELD_RE.lastIndex = valueStart;
      const next = PAYLOAD_FIELD_RE.exec(raw);
      end = next ? next.index : raw.length;
      value = trimPayloadScalar(raw.slice(valueStart, end));
    }
    fields.push({ name: hit[1], value });
    cursor = end;
  }
  return fields;
}

// Nhiều dòng không log JSON mà log thẳng Map.toString() của Kotlin/Java:
//   {stage=sync_step, location={lat=0.0, long=0.0}, locationString={"lat":0.0}}
// JSON.parse chịu thua nhưng đây vẫn là dữ liệu có cấu trúc, đọc dưới dạng cây dễ hơn nhiều.
const KV_MAP_HEAD_RE = /^\{\s*[A-Za-z_][\w.-]*\s*=/;

// Cắt theo dấu phẩy ở độ sâu 0 để giá trị lồng nhau không bị xẻ đôi.
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function parseKeyValueMap(text) {
  if (!KV_MAP_HEAD_RE.test(text) || text.slice(-1) !== '}') return null;
  const result = {};
  let count = 0;
  let lastKey = null;
  splitTopLevel(text.slice(1, -1)).forEach((part) => {
    const at = part.indexOf('=');
    // Định dạng này không bao quanh giá trị, nên giá trị có dấu phẩy bên trong (bundle_sof=1,2)
    // bị splitTopLevel xẻ đôi và mảnh sau không còn dấu '=' nào. Trước đây mảnh đó bị bỏ đi —
    // mất dữ liệu mà không báo gì. Đo trên một log thật: 20 mảnh rơi rụng im lặng, ở moneysource,
    // bundle_sof, list_sof, ref_id và cả title (title chính là nhãn popup trong "User đã nhìn thấy gì").
    // Chỉ nối lại mảnh KHÔNG có dấu '=' nào; mảnh có '=' vẫn xử lý y như trước.
    if (at < 0) {
      if (lastKey !== null && typeof result[lastKey] === 'string') result[lastKey] += ',' + part;
      return;
    }
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    count += 1;
    lastKey = key;
    if (KV_MAP_HEAD_RE.test(value)) {
      result[key] = parseKeyValueMap(value) || value;
      return;
    }
    if (value.charAt(0) === '{' || value.charAt(0) === '[') {
      try {
        result[key] = JSON.parse(value);
        return;
      } catch (error) {
        // Không phải JSON thật: giữ nguyên văn.
      }
    }
    result[key] = value;
  });
  return count ? result : null;
}

function buildJsonSection(name, text) {
  const block = extractJsonBlock(text);
  if (!block) {
    const start = text.search(/[{[]/);
    if (start < 0) return null;
    const raw = text.slice(start);
    const safe = findSafeJsonCut(text, start);
    if (safe) {
      const closed = parseJsonMaybeMasked(text.slice(start, safe.cut) + safe.closers);
      if (closed.isParsed) {
        return { name, kind: 'json', pretty: closed.pretty, isParsed: true, isRepaired: closed.isRepaired,
          isTruncated: true, isMap: false, bytes: raw.length, lostChars: safe.lostChars };
      }
    }
    return { name, kind: 'json', pretty: raw, isParsed: false, isRepaired: false,
      isTruncated: true, isMap: false, bytes: raw.length };
  }
  const parsed = parseJsonMaybeMasked(block.text);
  // bytes đo trên nguyên văn trong log, không đo trên bản pretty-print: người đọc muốn biết
  // request nặng bao nhiêu, không phải bản đã thêm thụt lề nặng bao nhiêu.
  if (parsed.isParsed) {
    return { name, kind: 'json', pretty: parsed.pretty, isParsed: true, isRepaired: parsed.isRepaired,
      isTruncated: false, isMap: false, bytes: block.text.length };
  }
  const map = parseKeyValueMap(block.text);
  if (map) {
    return { name, kind: 'json', pretty: JSON.stringify(map, null, 2), isParsed: true, isRepaired: false,
      isTruncated: false, isMap: true, bytes: block.text.length };
  }
  return { name, kind: 'json', pretty: parsed.pretty, isParsed: false, isRepaired: false,
    isTruncated: false, isMap: false, bytes: block.text.length };
}

// Trả về danh sách trường để tấm trượt vẽ từng khối một, thay vì chỉ một khối JSON duy nhất.
/* ------------------------------------------- JSON bị in ra nhiều dòng log */

// Trang admin in JSON nhiều dòng thì MỖI DÒNG VẬT LÝ là một logRow riêng: dòng mở khối có "{" mà
// không bao giờ đóng trong chính nó, những dòng sau không có giờ, không có mức độ. Gặp thật trên log
// production (một khối config dài từ dòng 2643 trở đi).
//
// Nối thêm những dòng tiếp nối đó cho tới khi cân ngoặc — nhưng CHỈ cho đường mở payload, tuyệt đối
// không nhập vào `entry.raw`: raw đi vào tìm kiếm, chữ ký lỗi, khoảng lặng, chữ ký trùng lặp... thêm
// chữ của dòng khác vào đó là đổi mọi con số. Cùng lý do với `windowTs` không được nhập vào `ts`.
const SPLIT_JSON_MAX_LINES = 2000;

// Quét độ sâu ngoặc, có nhớ trạng thái để chạy tiếp qua nhiều dòng. Phải biết đang ở trong chuỗi hay
// không, nếu không thì một dấu ngoặc nằm trong giá trị text ("url": "https://a/{id}") sẽ đếm nhầm.
function scanJsonDepth(text, state) {
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (state.isInString) {
      if (state.isEscaped) state.isEscaped = false;
      else if (char === '\\') state.isEscaped = true;
      else if (char === '"') state.isInString = false;
      continue;
    }
    if (char === '"') state.isInString = true;
    else if (char === '{' || char === '[') state.depth += 1;
    else if (char === '}' || char === ']') state.depth -= 1;
  }
  return state;
}

// Nguyên văn "hợp lý" của một dòng: chính nó, cộng thêm phần đuôi nếu khối JSON của nó bị tách ra.
function logicalPayloadText(entry) {
  const raw = (entry && entry.raw) || '';
  const at = raw.search(/[{[]/);
  if (at < 0 || !lensState.data) return raw;
  const state = scanJsonDepth(raw.slice(at), { depth: 0, isInString: false, isEscaped: false });
  if (state.depth <= 0) return raw;
  const entries = lensState.data.entries;
  let text = raw;
  for (let i = entry.domIndex + 1; i < entries.length && state.depth > 0; i += 1) {
    const next = entries[i];
    // Gặp dòng có giờ riêng = một dòng log mới bắt đầu, dừng. Khối chưa cân thì thà hiện phần đọc
    // được còn hơn nuốt luôn dòng log sau đó vào khối.
    if (next.ts || i - entry.domIndex > SPLIT_JSON_MAX_LINES) break;
    text += '\n' + next.raw;
    scanJsonDepth(next.raw, state);
  }
  return text;
}

function buildPayloadSections(raw) {
  const sections = [];
  splitPayloadFields(raw).forEach((field) => {
    if (field.value.charAt(0) === '{' || field.value.charAt(0) === '[') {
      const section = buildJsonSection(field.name, field.value);
      if (section) sections.push(section);
      return;
    }
    sections.push({ name: field.name, kind: 'text', pretty: field.value, isParsed: true,
      isRepaired: false, isTruncated: false, isMap: false, bytes: field.value.length });
  });
  if (sections.length) return sections;

  // Dòng không theo dạng "--tên:" (ví dụ "@@SomeService :: responseBody: {...}") vẫn có thể
  // chứa một khối JSON trơ trọi. Ưu tiên cắt sau nhãn body/payload để không vỡ phải [Module: HTTP].
  const label = BODY_LABEL_RE.exec(raw);
  const tail = label ? raw.slice(label.index + label[0].length) : raw.slice(raw.indexOf('{'));
  if (raw.indexOf('{') < 0 && !label) return sections;
  const section = buildJsonSection(label ? label[0].replace(/\s*:\s*$/, '') : 'JSON', tail);
  if (section) sections.push(section);
  return sections;
}
// @ts-check
// dựng lại thao tác của user từ event MoMoTracker
// Tách ra từ src/02-insights.js (946 dòng). Các file src/*.js được build.sh nối lại theo thứ tự
// tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc.

/* ---------------------------------------------- hành trình tương tác của user */

// Mọi dòng MoMoTracker đều ghi ở mức INFO nên không dòng nào lọt vào buildIssueGroups: những gì user
// THẤY và CHẠM hoàn toàn vô hình với phần gom nhóm lỗi. Đo trên log thật (33112319): 955 dòng tracker,
// 46 loại event, trong đó popup "MAX-API SPAM DETECTED" đập vào mặt user 5 lần mà không kèm một ERROR nào.
// Log ghi lặp: nhiều event tracker xuất hiện 2 dòng giống hệt nhau. Đo trên log thật (78 cặp trùng
// nội dung), khoảng cách chia làm hai cụm tách bạch — một cụm 0..~1.1s (ghi lặp) và một cụm từ 70s trở
// lên (user làm lại thật sự ở phiên sau). Chọn 1000ms nằm giữa hai cụm: thà đếm dư còn hơn gộp nhầm
// hai lần bấm thật thành một, vì "user bấm lại vì app không phản hồi" chính là thứ cần nhìn thấy.
const JOURNEY_MERGE_WINDOW_MS = 1000;
const JOURNEY_KINDS = ['screen', 'tap', 'saw', 'move', 'fail'];
const JOURNEY_KIND_LABEL = {
  screen: 'Màn hình', tap: 'Chạm', saw: 'User thấy', move: 'Đổi luồng', fail: 'API fail',
};

// Tracker ghi thẳng chuỗi "null"/"" cho trường rỗng; để nguyên thì nhãn hiện ra là chữ "null".
function journeyValue(raw) {
  const text = raw == null ? '' : String(raw).trim();
  return text === 'null' || text === 'undefined' || text === '{}' || text === '[]' ? '' : text;
}

function journeyParts(list) {
  return list.map(journeyValue).filter(Boolean).join(' · ');
}

function journeyMs(raw) {
  const ms = Number(journeyValue(raw));
  return Number.isFinite(ms) && ms > 0 && ms <= MAX_PLAUSIBLE_DURATION_MS ? Math.round(ms) : 0;
}

// detail = bối cảnh ỔN ĐỊNH của bước (màn hình, service) — dùng để gom nhóm và so sánh khi gộp.
// note   = số đo RIÊNG của lần đó (duration, dwell_time) — chỉ hiện trên dòng hành trình.
// Tách hai thứ này ra vì nếu trộn chung thì hai lần cùng một lỗi chỉ khác 1ms duration sẽ bị coi là
// hai thứ khác nhau, và nhãn nhóm sẽ mất sạch phần errorCode.
// Bảng duy nhất quyết định event nào vào hành trình. Trả null = bỏ qua (impression, ops_request_be,
// trail_*, sync_* ... không phải thao tác của user). Cố ý KHÔNG lấy roothome_component_impressed (76),
// service_component_displayed (41), roothome_block_viewed (33): đó là cái màn hình vẽ ra, không phải
// cái user làm, và số lượng của chúng sẽ nhấn chìm phần còn lại.
// Lấy nguyên văn từ AppEvent.FeatureMiniAppLoad.Stage (momo-app). Chỉ giữ những stage báo hiệu
// user nhìn thấy một màn hình/toast/popup — các stage đo lường khác không vào hành trình.
const MINIAPP_FAIL_STAGES = {
  scr_fail_loading_miniapp: 'màn hình lỗi tải miniapp',
  toast_fail_loading_miniapp: 'toast lỗi tải miniapp',
  miniapp_web_js_crash: 'miniapp crash JS',
  pu_waiting_load_bundle: 'popup chờ tải bundle',
  pu_version_update: 'popup bắt cập nhật app',
  pu_recording: 'popup đang ghi màn hình',
};

// Quy tắc đặt nhãn: lấy trường đầu tiên KHÔNG rỗng, xếp theo "càng riêng cho bước này và càng giống
// thứ user nhìn thấy thì càng ưu tiên". Ba bậc:
//   1. Chữ user THẬT SỰ đọc được trên màn: title, button_name, item_title
//   2. Tên thành phần do dev đặt: component_name, popup_name, đuôi của component_id
//   3. Bối cảnh rộng hơn: feature_code, service_name
// Bậc 3 không bao giờ nên đứng một mình ở chỗ khác, vì một feature_code có hàng chục popup; nhưng khi
// hai bậc trên đều rỗng thì nó vẫn hơn chữ "popup" trơn — ít ra còn biết popup đó thuộc chỗ nào.
// Vì sao cần: trên log thật có popup ghi title=null, nhãn ra đúng chữ "popup", nên hai popup khác hẳn
// nhau bị gom thành một hàng "2x popup" mà không còn gì để phân biệt.
const JOURNEY_LABEL_MAX = 48;

function pickJourneyLabel(candidates, fallback) {
  for (let i = 0; i < candidates.length; i += 1) {
    const value = journeyValue(candidates[i]);
    if (!value) continue;
    // component_id là đường dẫn "<appId>/<feature>/<screen>/Popup/<tên>" — chỉ đoạn cuối mới là tên.
    const tail = value.indexOf('/') >= 0 ? value.slice(value.lastIndexOf('/') + 1).trim() : value;
    const name = tail || value;
    return name.length > JOURNEY_LABEL_MAX ? name.slice(0, JOURNEY_LABEL_MAX - 1) + '…' : name;
  }
  return fallback;
}

// momoClassDiscriminator là tên LỚP đầy đủ của event, đuôi của nó là tên bề mặt thật sự hiện ra.
// Vì sao cần: trên log thật có hai màn đều ghi screen_name=result nhưng là hai lớp khác hẳn —
// TransactionResultRevampScreenDisplayed và TransactionResultWidgetDisplayed — nên chúng bị gom làm
// một hàng, mất sạch cái để phân biệt.
//
// NHƯNG không được dùng bừa: cũng trên log thật, một log có 64 dòng mang discriminator mà TẤT CẢ đều
// là "PromotionEventParams" — đó là lớp chứa THAM SỐ, không phải tên màn. Lấy bừa thì mọi màn đều bị
// đặt tên "PromotionEventParams".
// Vì vậy chỉ nhận lớp nào kết thúc bằng Displayed / Interacted / Viewed: đó là lớp mô tả một bề mặt
// vừa hiện ra. Đo trên 10 đuôi lớp khác nhau quan sát được ở hai log: 7 cái khớp đều là tên bề mặt
// thật, 3 cái không khớp (PromotionEventParams, CheckoutRequested, CheckoutResponse) đều không phải.
// CHƯA XÁC MINH trên dải lớp rộng hơn — mới có hai log mang trường này.
const RE_JOURNEY_SURFACE = /(Displayed|Interacted|Viewed)$/;

function journeySurfaceName(params) {
  const full = journeyValue(params.momoClassDiscriminator);
  if (!full) return '';
  const tail = full.slice(full.lastIndexOf('.') + 1);
  if (!RE_JOURNEY_SURFACE.test(tail)) return '';
  // Bỏ đuôi mô tả hành động rồi bỏ nốt chữ "Screen" còn thừa: TransactionResultRevampScreenDisplayed
  // -> TransactionResultRevamp, còn TransactionResultWidgetDisplayed -> TransactionResultWidget.
  return tail.replace(RE_JOURNEY_SURFACE, '').replace(/Screen$/, '');
}

// Tên màn = tên màn hình + tên bề mặt (nếu đọc được). Hai thứ này khác cấp độ chi tiết nên nối bằng
// dấu chấm giữa, không trộn làm một.
function journeyScreenLabel(params, fallback) {
  const base = journeyValue(params.screen_name) || fallback || '';
  const surface = journeySurfaceName(params);
  if (!surface) return base;
  return base ? base + ' · ' + surface : surface;
}

function pickJourneyStep(event, params) {
  const screen = journeyValue(params.screen_name);
  if (event === 'auto_screen_navigated') {
    const from = journeyValue(params.pre_screen_name);
    return { kind: 'screen', label: screen || journeyValue(params.feature_code),
      detail: journeyParts([from ? from + ' → ' + (screen || '?') : screen, params.action]) };
  }
  if (event === 'auto_screen_displayed' || event === 'service_screen_displayed' ||
    event === 'service_screen_viewed' || event === 'roothome_screen_displayed') {
    const load = journeyMs(params.duration);
    return { kind: 'screen', label: journeyScreenLabel(params, journeyValue(params.service_name)),
      detail: journeyParts([params.service_name, params.status]),
      note: load ? 'load ' + formatDuration(load) : '' };
  }
  if (event === 'feature_source') {
    const from = journeyValue(params.from);
    const to = journeyValue(params.to);
    if (!from && !to) return null;
    return { kind: 'move', label: (from || '?') + ' → ' + (to || '?'), detail: journeyValue(params.action) };
  }
  if (event === 'service_button_clicked') {
    return { kind: 'tap', label: journeyValue(params.button_name) || 'button',
      detail: journeyParts([params.screen_name, params.service_name]) };
  }
  if (event === 'auto_button_clicked') {
    // component_id = "<appId>/<feature>/<screen>/Button/<nhãn tiếng Việt đúng như user nhìn thấy>".
    const id = journeyValue(params.component_id);
    return { kind: 'tap', label: (id ? id.slice(id.lastIndexOf('/') + 1) : journeyValue(params.component_name)) || 'button',
      detail: journeyParts([params.screen_name, params.action]) };
  }
  if (event === 'service_component_clicked') {
    return { kind: 'tap', label: journeyValue(params.component_name) || 'component',
      detail: journeyParts([params.screen_name, params.component_type]) };
  }
  if (event === 'roothome_component_clicked') {
    const dwell = journeyMs(params.dwell_time);
    return { kind: 'tap',
      label: journeyValue(params.button_name) || journeyValue(params.component_name) ||
        journeyValue(params.service) || 'component',
      detail: journeyParts([params.item_title, params.block]),
      note: dwell ? 'đứng ' + formatDuration(dwell) : '' };
  }
  if (event === 'roothome_screen_scrolled') {
    const dwell = journeyMs(params.dwell_time);
    return { kind: 'tap', label: 'cuộn ' + (screen || 'home'), detail: '',
      note: dwell ? 'đứng ' + formatDuration(dwell) : '' };
  }
  if (event === 'auto_popup_displayed') {
    return { kind: 'saw',
      label: 'popup ' + pickJourneyLabel([params.title, params.component_name, params.component_id,
        params.desc, params.feature_code], '?'),
      detail: journeyParts([params.screen_name, params.feature_code, params.desc]) };
  }
  if (event === 'service_popup_displayed') {
    return { kind: 'saw',
      label: 'popup ' + pickJourneyLabel([params.popup_name, params.title, params.component_name,
        params.service_name], '?'),
      detail: journeyParts([params.screen_name, params.service_name]) };
  }
  if (event === 'auto_bottomsheet_displayed') {
    return { kind: 'saw',
      label: 'sheet ' + pickJourneyLabel([params.title, params.component_name, params.component_id,
        params.feature_code], '?'),
      detail: journeyParts([params.screen_name, params.feature_code]) };
  }
  // Tên stage lấy từ AppEvent.FeatureMiniAppLoad.Stage trong source app, không phải đoán từ log.
  // Đây là những stage mà user THẤY: màn lỗi, toast lỗi, popup. Chúng ghi ở mức INFO như mọi event
  // tracker khác nên phần gom nhóm lỗi không đếm được.
  // Đo trên hai log thử: cả hai đều 0 lần — hai log đó không gặp sự cố tải miniapp, không phải sai tên.
  if (event === 'feature_miniapp_load') {
    const stage = journeyValue(params.stage);
    const seen = MINIAPP_FAIL_STAGES[stage];
    if (!seen) return null;
    return { kind: 'saw', label: seen,
      detail: journeyParts([params.app_id, params.feature_code]),
      note: journeyValue(params.error_message) || journeyValue(params.error_code) };
  }
  if (event === 'service_screenshot') {
    return { kind: 'saw', label: 'user chụp màn hình',
      detail: journeyParts([params.screen_name, params.service_name]) };
  }
  // ops_receive_be là kết quả call BE do chính tracker ghi, có sẵn status/error_code/duration.
  // Chỉ lấy bản fail: 45/307 trên log thật, và tab HTTP không thấy hết số này vì nó đọc dòng [Method:].
  if (event === 'ops_receive_be') {
    if (journeyValue(params.status) !== 'fail') return null;
    const code = journeyValue(params.error_code);
    const api = journeyValue(params.api) || journeyValue(params.api_path) || 'API';
    // errorCode vào NHÃN chứ không vào detail: cùng một api fail với hai mã khác nhau là hai chuyện
    // khác nhau, gom chung một dòng sẽ giấu mất mã lỗi.
    return { kind: 'fail', label: code ? api + ' · ' + code : api,
      detail: journeyParts([params.error_message, params.screen_name]),
      note: journeyMs(params.duration) ? formatDuration(journeyMs(params.duration)) : '' };
  }
  return null;
}

function groupJourneySteps(steps, kind) {
  const map = new Map();
  steps.forEach((step) => {
    if (step.kind !== kind) return;
    let row = map.get(step.label);
    if (!row) {
      row = { key: step.label, count: 0, ms: 0, maxMs: 0, indices: [], detail: step.detail,
        firstTs: step.ts, lastTs: step.ts };
      map.set(step.label, row);
    }
    // Đếm SỐ THAO TÁC (số bước đã gộp), không phải số dòng log — để con số ở đây khớp với thẻ thống kê
    // đầu tab. Số dòng thô vẫn còn nguyên trong row.indices để duyệt từng dòng.
    row.count += 1;
    // ms là TỔNG của mọi lần vào màn đó; maxMs là lần lâu nhất. Chỉ hiện tổng mà để cạnh "2x" thì
    // người đọc dễ tưởng 2 lần mỗi lần bằng từng đó.
    row.ms += step.ms;
    if (step.ms > row.maxMs) row.maxMs = step.ms;
    step.indices.forEach((domIndex) => row.indices.push(domIndex));
    // Nhiều bước cùng nhãn nhưng khác bối cảnh (nút "transfer" ở bill_detail và ở detail_input):
    // giữ detail của bước đầu cho cả nhóm là nói sai. Chỉ giữ khi mọi bước đều giống nhau.
    if (row.detail !== step.detail) row.detail = '';
    if (step.ts && (!row.firstTs || step.ts < row.firstTs)) row.firstTs = step.ts;
    if (step.lastTs && (!row.lastTs || step.lastTs > row.lastTs)) row.lastTs = step.lastTs;
  });
  return Array.from(map.values());
}

// Gộp các bước LIÊN TIẾP y hệt nhau và sát nhau về thời gian thành một bước mang count.
// Không xoá dòng nào: indices giữ đủ cả N dòng để vẫn nhảy được tới từng dòng trong bảng log.
function mergeAdjacentJourneySteps(steps) {
  const merged = [];
  steps.forEach((step) => {
    const last = merged[merged.length - 1];
    // Bước 'fail' KHÔNG gộp: mỗi call BE đã có trace_id riêng và đã khử trùng chính xác theo đó.
    // Hai call thật sự khác nhau cách nhau vài trăm ms là chuyện bình thường — gộp thì số ở đây
    // sẽ lệch với số call fail đếm được từ trace_id.
    if (step.kind !== 'fail' &&
      last && last.kind === step.kind && last.label === step.label && last.detail === step.detail &&
      step.ts && last.lastTs && step.ts - last.lastTs <= JOURNEY_MERGE_WINDOW_MS) {
      last.count += 1;
      last.lastTs = step.ts;
      last.indices.push(step.domIndex);
      return;
    }
    // PHẢI mang theo session: thiếu nó thì guard "không đo vắt qua hai phiên app" ở dưới so
    // undefined === undefined, tức luôn đúng, tức guard đó chưa bao giờ chạy.
    merged.push({ kind: step.kind, label: step.label, detail: step.detail, note: step.note,
      event: step.event, ts: step.ts, lastTs: step.ts, domIndex: step.domIndex, session: step.session,
      indices: [step.domIndex], count: 1, ms: 0 });
  });
  return merged;
}

// Thời gian TẢI một màn, khác hẳn "ở lâu trên màn" (dwell): đây là số có sẵn trong log
// (auto_screen_displayed.duration khi state=load, và auto_load_progress_tracked.duration),
// không phải số tính ra. Tab Chậm vốn gom mọi "duration=" vào một rổ mà không gắn với màn nào.
function buildScreenLoads(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    if (!entry.eventParams) return;
    if (entry.event !== 'auto_screen_displayed' && entry.event !== 'auto_load_progress_tracked') return;
    const params = entry.eventParams;
    if (entry.event === 'auto_screen_displayed' && journeyValue(params.state) !== 'load') return;
    const ms = journeyMs(params.duration);
    if (!ms) return;
    const key = journeyValue(params.screen_name) || journeyValue(params.end_point) ||
      journeyValue(params.feature_code);
    if (!key) return;
    let row = map.get(key);
    if (!row) {
      row = { key, count: 0, worstMs: 0, totalMs: 0, indices: [] };
      map.set(key, row);
    }
    row.count += 1;
    row.totalMs += ms;
    if (ms > row.worstMs) row.worstMs = ms;
    row.indices.push(entry.domIndex);
  });
  // Đã bỏ trường `sources` (một Set mỗi hàng, rồi đổi thành mảng): không renderer nào đọc.
  return Array.from(map.values())
    .map((row) => ({ key: row.key, count: row.count, worstMs: row.worstMs,
      avgMs: Math.round(row.totalMs / row.count), indices: row.indices }))
    .sort((a, b) => b.worstMs - a.worstMs);
}

// Thời gian "ở trên màn" không được tính cả lúc app nằm dưới nền. Đo thật: một màn báo 7m08s trong khi
// 3m52s trong số đó là lúc user rời hẳn app — 88% con số là thứ không ai nhìn. Tool đã tính sẵn các
// khoảng đó cho thẻ thống kê ở Tổng quan, chỉ là chưa trừ ở đây.
function subtractBackground(fromTs, toTs, backgrounds) {
  let overlap = 0;
  backgrounds.forEach((gap) => {
    const start = Math.max(fromTs, gap.downTs || gap.before.ts);
    const end = Math.min(toTs, gap.upTs || gap.after.ts);
    if (end > start) overlap += end - start;
  });
  return Math.max(0, toTs - fromTs - overlap);
}

function buildJourney(entries, gaps) {
  const raw = [];
  const counts = { screen: 0, tap: 0, saw: 0, move: 0, fail: 0 };
  const seenTraceIds = new Set();
  let apiTotal = 0;
  let apiFail = 0;

  entries.forEach((entry) => {
    if (!entry.event || !entry.eventParams) return;
    if (entry.event === 'ops_receive_be') {
      // Một call BE được ghi thành 2 dòng ops_receive_be giống hệt nhau. Đo trên log thật: 307 dòng
      // nhưng chỉ 166 trace_id (139 trace xuất hiện đúng 2 lần, 26 một lần, 1 ba lần) — trong khi
      // ops_request_be là 166 dòng / 166 trace_id, tức 166 mới là số call thật.
      // trace_id là ID của chính call đó nên khử trùng theo nó là chắc chắn, không phải phỏng đoán.
      const traceId = journeyValue(entry.eventParams.trace_id);
      if (traceId && seenTraceIds.has(traceId)) return;
      if (traceId) seenTraceIds.add(traceId);
      apiTotal += 1;
      if (journeyValue(entry.eventParams.status) === 'fail') apiFail += 1;
    }
    const step = pickJourneyStep(entry.event, entry.eventParams);
    if (!step || !step.label) return;
    raw.push({ kind: step.kind, label: step.label, detail: step.detail || '', note: step.note || '',
      event: entry.event, ts: entry.ts, domIndex: entry.domIndex, session: entry.session });
  });

  // Cùng lý do như tab Timeline: log có dòng timestamp lùi về trước, thứ tự dòng không phải thứ tự thời gian.
  raw.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const steps = mergeAdjacentJourneySteps(raw);
  steps.forEach((step) => {
    counts[step.kind] += 1;
  });

  // ms của một bước "screen" = khoảng cách tới bước screen/move kế tiếp. Đây là SỐ TÍNH RA, không phải
  // trường nào trong log — các event nổ liên tục trong cùng một lần chuyển màn sẽ ra ~0ms, chỉ bước cuối
  // của chùm mới mang con số thật. Trường dwell_time có sẵn của roothome nằm riêng trong detail.
  //
  // Hai chỗ phải chặn, nếu không con số ra vô nghĩa (đã gặp thật: một màn báo "11h24m" trong khi hai
  // dòng log của nó cách nhau 2 giây):
  //   - bước màn hình cuối của MỘT PHIÊN không được đo sang bước đầu của phiên sau: giữa hai phiên app
  //     đã bị tắt, không ai "ở trên màn" cả.
  //   - khoảng cách quá MAX_PLAUSIBLE_DURATION_MS thì gần như chắc chắn là app bị đẩy xuống nền chứ
  //     không phải người dùng ngồi nhìn. Bỏ hẳn (0 = không biết) chứ không báo một con số sai.
  const backgrounds = (gaps || []).filter((gap) => gap.cause === 'background');
  let boundaryTs = steps.length ? steps[steps.length - 1].ts : null;
  let boundarySession = steps.length ? steps[steps.length - 1].session : null;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step.kind === 'screen' && step.ts && boundaryTs && step.session === boundarySession) {
      const span = subtractBackground(step.ts, boundaryTs, backgrounds);
      step.ms = span <= MAX_PLAUSIBLE_DURATION_MS ? span : 0;
    }
    if (step.kind === 'screen' || step.kind === 'move') {
      boundaryTs = step.ts || boundaryTs;
      boundarySession = step.session;
    }
  }

  const byCount = (a, b) => b.count - a.count;
  return {
    steps,
    counts,
    apiTotal,
    apiFail,
    screens: groupJourneySteps(steps, 'screen').sort((a, b) => b.ms - a.ms || b.count - a.count),
    taps: groupJourneySteps(steps, 'tap').sort(byCount),
    saw: groupJourneySteps(steps, 'saw').sort(byCount),
    fails: groupJourneySteps(steps, 'fail').sort(byCount),
    screenLoads: buildScreenLoads(entries),
  };
}
// @ts-check
// lỗi đọc từ Grafana trace, và nhận diện nhiễu của chính lớp đo lường
// Tách ra từ src/02-insights.js (946 dòng). Các file src/*.js được build.sh nối lại theo thứ tự
// tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc.

/* ------------------------------------------- nhiễu từ chính hệ thống đo lường */

// Đo trên 50 feedback PRODUCTION thật (25 iOS, 25 Android, ngày 2026-09-10): 2488 dòng ERROR, trong đó
// 1267 dòng (51%) không phải lỗi user gặp mà là lỗi của chính lớp đo lường. 24/49 log có quá nửa số
// dòng ERROR là loại này. Chúng đều ghi bằng logger.e trực tiếp nên KHÔNG bị cắt bởi cờ Debug Tool —
// tức chúng có mặt trên máy user thật, khác hẳn các dòng "@@ grafana >>" khác.
//
// Không tự động tắt tiếng: đó là quyết định của người đọc. Chỉ tách ra một khối riêng để danh sách
// vấn đề còn lại là những thứ đáng đọc.
const TELEMETRY_NOISE_PATTERNS = [
  // withTraceId() làm buffer.remove() nên traceId chỉ dùng được một lần; gọi stop lần hai là mất.
  { re: /GrafanaTrace\.\w+:: no traceId/, label: 'GrafanaTrace mất traceId' },
  // resolveFormatter() trả null khi Koin scope đã đóng.
  { re: /GrafanaTrace\.\w+ PaymentSession is null/, label: 'GrafanaTrace không có PaymentSession' },
  { re: /GrafanaTrace\.exceptionHandler/, label: 'GrafanaTrace nuốt exception' },
  // Hàng đợi gửi trace của chính Grafana bị lỗi.
  { re: /grafana >> DefaultRequestQueue >> handleError/, label: 'Hàng đợi gửi trace Grafana lỗi' },
];

function telemetryNoiseLabel(text) {
  for (let i = 0; i < TELEMETRY_NOISE_PATTERNS.length; i += 1) {
    if (TELEMETRY_NOISE_PATTERNS[i].re.test(text)) return TELEMETRY_NOISE_PATTERNS[i].label;
  }
  return '';
}

/* -------------------------------------------------- lỗi đọc từ Grafana trace */

// Grafana ghi ở mức INFO nên không dòng nào lọt vào buildIssueGroups, trong khi traceFail mang sẵn
// flow + step + errorCode + errorMessage — tức mô tả lỗi RÕ HƠN bất kỳ dòng ERROR nào trong log.
//
// Gom theo errorMessage chứ không theo step: trong GrafanaTracker.generateParams, với miniapp thì
// `flow` bị ghi đè bằng appId và `step` bị đổi thành "flow.step", nên MỘT sự cố hạ tầng hiện ra
// thành hàng chục dòng khác nhau. Đo trên một log thật: cùng một lỗi "500 - B07 No version found
// from remote" xuất hiện ở 17 miniapp khác nhau. Gom theo errorMessage thì 17 dòng đó về một hàng,
// kèm số app bị ảnh hưởng — nhìn là biết ngay hạ tầng chết chứ không phải bug của tính năng.
const TRACE_VERBS = ['startTrace', 'traceSuccess', 'traceFail', 'countTrace', 'durationStopTrace',
  'durationTrace', 'errorTrace'];

// Hậu tố _start/_success/_fail do generateParams tự gắn, và tiền tố "<flow>." cũng do nó gắn khi
// appId không phải platform. Bỏ cả hai để còn lại tên bước thật.
function traceStepRoot(step) {
  const text = journeyValue(step).replace(/_(start|success|fail|duration)$/i, '');
  const dot = text.lastIndexOf('.');
  return dot >= 0 ? text.slice(dot + 1) : text;
}

function buildTraceIssues(entries) {
  const counts = {};
  TRACE_VERBS.forEach((verb) => {
    counts[verb] = 0;
  });
  let lineCount = 0;
  const failMap = new Map();

  entries.forEach((entry) => {
    if (!entry.traceVerb) return;
    lineCount += 1;
    if (counts[entry.traceVerb] !== undefined) counts[entry.traceVerb] += 1;
    if (entry.traceVerb !== 'traceFail' || !entry.traceParams) return;

    const params = entry.traceParams;
    const message = journeyValue(params.errorMessage);
    const code = journeyValue(params.errorCode).replace(/\.0$/, '');
    const step = traceStepRoot(params.step);
    // Có errorMessage thì gom theo nó — đó mới là thứ chung giữa các app cùng dính một sự cố.
    // Không có thì KHÔNG được gom theo mỗi errorCode: trên một log thật, "code 200" ôm chung
    // TransactionResultV3_call_api_V1_REWARDS_PREDICT va TabBarContainer_call_api_RIGVER_APPVERSION
    // — hai chuyện khác hẳn nhau. Lúc đó lấy tên bước làm khoá.
    const key = message || (step ? step + (code ? ' · errorCode ' + code : '') : 'errorCode ' + code);

    let row = failMap.get(key);
    if (!row) {
      row = { key, count: 0, indices: [], codes: new Set(), steps: new Set(), apps: new Set(),
        firstTs: entry.ts, lastTs: entry.ts };
      failMap.set(key, row);
    }
    row.count += 1;
    row.indices.push(entry.domIndex);
    if (code) row.codes.add(code);
    if (step) row.steps.add(step);
    const app = journeyValue(params.appId) || journeyValue(params.flow);
    if (app) row.apps.add(app);
    if (entry.ts) {
      if (!row.firstTs || entry.ts < row.firstTs) row.firstTs = entry.ts;
      if (!row.lastTs || entry.ts > row.lastTs) row.lastTs = entry.ts;
    }
  });

  const fails = Array.from(failMap.values())
    .map((row) => ({ key: row.key, count: row.count, indices: row.indices, firstTs: row.firstTs,
      lastTs: row.lastTs, codes: Array.from(row.codes), steps: Array.from(row.steps),
      apps: Array.from(row.apps) }))
    .sort((a, b) => b.apps.length - a.apps.length || b.count - a.count);

  // Phân biệt hai chuyện khác hẳn nhau:
  // - gated: các dòng "@@ grafana >>" đi qua GrafanaTracker.log(), bị cắt bởi cờ Debug Tool.
  //   Đo trên 50 feedback production thật: chỉ 2/50 log (4%) có startTrace/traceFail.
  // - available: có bất kỳ dòng trace nào không. Một số dòng ("generateOffsetBase", handleError)
  //   ghi thẳng bằng logger nên KHÔNG bị cắt — 68% log production có chúng. Nếu chỉ nhìn
  //   available thì sẽ tưởng log nào cũng có dữ liệu trace, trong khi thực tế gần như không log nào có.
  return { available: lineCount > 0, hasGated: counts.startTrace + counts.traceSuccess + counts.traceFail > 0,
    lineCount, counts, fails };
}

// Mọi thứ phụ thuộc "đang nhìn những dòng nào". Gọi một lần cho cả file lúc quét,
// và gọi lại trên tập đã lọc mỗi khi bộ lọc đổi — đo được 2.5ms cho 4085 dòng, 0.4ms cho tập ~850 dòng.
// @ts-check
// gom mọi thống kê phụ thuộc "đang nhìn những dòng nào" vào một chỗ
// Tách ra từ src/02-insights.js (946 dòng). Các file src/*.js được build.sh nối lại theo thứ tự
// tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc.

function deriveStats(entries, gaps) {
  const levels = {};
  LEVEL_ORDER.forEach((level) => {
    levels[level] = 0;
  });
  entries.forEach((entry) => {
    if (levels[entry.level] !== undefined) levels[entry.level] += 1;
  });
  const httpCalls = buildHttpCalls(entries);
  return {
    scopedEntries: entries,
    levels,
    groups: buildIssueGroups(entries),
    httpCalls,
    badHttpCalls: httpCalls.filter(isBadHttpCall),
    durations: extractDurations(entries),
    modules: countBy(entries, (entry) => entry.module),
    // Đã bỏ `tags` và `flows`: hai lượt countBy trên toàn bộ dòng, chạy lại mỗi lần đổi bộ lọc, mà
    // không renderer nào đọc. entry.tag / entry.flow vẫn còn vì bộ lọc nội dung đọc chúng.
    events: countBy(entries, (entry) => entry.event),
    journey: buildJourney(entries, gaps),
    traceIssues: buildTraceIssues(entries),
    errorCodes: buildErrorCodes(entries),
    configs: buildConfigs(entries, httpCalls),
    environment: buildEnvironment(entries, httpCalls),
  };
}

function attachInsights(data) {
  // Correlation KHÔNG scope theo bộ lọc: một cmdId là một chuỗi request, xem chuỗi thì phải xem trọn vẹn
  // kể cả những dòng đang bị bộ lọc giấu đi.
  data.correlations = buildCorrelations(data.entries);
  data.correlationValueSet = new Set(data.correlations.map((bucket) => bucket.value));
  data.sessions = buildSessions(data.entries);
  data.feedback = readFeedbackContext();
  return data;
}
// @ts-check
// CSS của panel Log Lens
//
// Về độ ưu tiên (specificity): trang admin dùng antd nên phải reset, nhưng reset KHÔNG được mạnh hơn
// các rule .fll-* của mình. Vì vậy reset dùng ":where(#fll-root) <tag>" = (0,0,1): đủ để thắng rule
// element của trang, nhưng vẫn thua mọi rule class (0,1,0) bên dưới. Nếu viết "#fll-root *" (1,0,1)
// thì padding:0 sẽ đè chết toàn bộ padding của các thẻ -> giao diện dính sát mép.

const PANEL_CSS = [
  ':where(#fll-root) *,:where(#fll-root) *::before,:where(#fll-root) *::after{box-sizing:border-box}',
  ':where(#fll-root) div,:where(#fll-root) span,:where(#fll-root) header,:where(#fll-root) footer,',
  ':where(#fll-root) nav,:where(#fll-root) button,:where(#fll-root) input,:where(#fll-root) i,',
  ':where(#fll-root) u,:where(#fll-root) b,:where(#fll-root) em{margin:0;padding:0;border:0;',
  'background:none;color:inherit;font:inherit;line-height:1.45;letter-spacing:normal;text-transform:none;',
  'text-align:left;vertical-align:baseline;box-shadow:none;text-shadow:none;min-width:0;height:auto}',
  '#fll-root button,#fll-root input{outline:0;-webkit-appearance:none;appearance:none}',
  /* Thuộc tính hidden mặc định là display:none của trình duyệt, nhưng MỌI rule .fll-* có display đều
     đè lên nó (class thắng selector thuộc tính của UA). Trước đây chỉ khai riêng cho .fll-bar và
     .fll-ft nên ô tìm trong từng mục đặt node.hidden=true mà hàng vẫn hiện nguyên — .fll-rk,
     .fll-call, .fll-slow, .fll-chip đều là display:flex/inline-flex. Khai một lần ở đây cho cả panel. */
  '#fll-root [hidden]{display:none!important}',

  '#fll-root{position:fixed;z-index:2147483000;top:0;left:0;width:0;height:0;',
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14.5px;font-weight:400;',
  '--bg:#16141d;--bg2:#1e1b27;--bg3:#2a2436;--line:rgba(255,255,255,.09);--txt:#ece9f5;--mut:#9b93ad;',
  '--acc:#ff2e88;--err:#ff5f6d;--warn:#ffb648;--info:#58c4ff;--dbg:#7d8590;--ok:#3ddc97;',
  '--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;',
  /* Padding của .fll-body: .fll-sec phải biết đúng hai số này để dính sát mép và tràn hết bề ngang.
     Mọi chỗ dùng đều kèm giá trị dự phòng: biến khai ở #fll-root, nếu panel bị dùng ngoài root đó
     thì var() không giải được và CẢ declaration hỏng — padding sẽ sập về 0 chứ không quay về mặc định. */
  '--pad-y:14px;--pad-x:16px}',

  /* ---------- khung panel ---------- */
  /* Kích thước bị chặn bằng JS (clampValue) chứ không bằng max-width, để kéo góc không bị kẹt ở 880px. */
  '.fll-panel{position:fixed;top:14px;right:14px;bottom:14px;width:480px;min-width:360px;max-width:none;',
  'display:flex;flex-direction:column;background:var(--bg);color:var(--txt);border:1px solid var(--line);',
  'border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.35);overflow:hidden;',
  'animation:fll-in .18s cubic-bezier(.2,.9,.3,1)}',
  '@keyframes fll-in{from{opacity:0;transform:translateX(16px) scale(.99)}to{opacity:1;transform:none}}',

  /* Đọc xuyên qua panel trong lúc chuột đang ở trên bảng log. KHÔNG đặt opacity lên chính .fll-panel:
     opacity gộp cả cây con thành một lớp nên con không bao giờ sáng hơn cha — minimap sẽ mờ theo, mà
     minimap lại đúng là thứ cần nhìn rõ lúc đó. Nền chuyển sang màu có alpha, rồi mờ từng đứa con và
     chừa minimap (.fll-map) cùng nhãn của nó (.fll-maplbl) ra.
     Bỏ luôn bóng mờ 70px: để lại thì vùng tối quanh panel vẫn che chữ của bảng log. */
  '.fll-panel{transition:background .14s,box-shadow .14s,border-color .14s}',
  '.fll-panel > *{transition:opacity .14s}',
  '.fll-panel.fll-xray{background:rgba(22,20,29,.10);box-shadow:none;border-color:rgba(255,255,255,.05)}',
  '.fll-panel.fll-xray > *:not(.fll-map):not(.fll-maplbl){opacity:.10}',

  /* ---------- hai tay nắm thay đổi kích thước ---------- */
  /* Trong lúc kéo: bỏ bóng mờ bán kính 70px (thứ tốn nhất để vẽ lại mỗi khung hình),
     báo trước cho trình duyệt chuẩn bị lớp riêng, và tắt hover bên trong cho khỏi tính vô ích. */
  '.fll-panel.fll-dragging{box-shadow:0 6px 20px rgba(0,0,0,.45);will-change:transform}',
  '.fll-panel.fll-dragging .fll-body,.fll-panel.fll-dragging .fll-map{pointer-events:none}',
  '.fll-grip{position:absolute;left:0;top:0;bottom:0;width:7px;cursor:ew-resize;z-index:5}',
  '.fll-grip:hover{background:linear-gradient(90deg,rgba(255,46,136,.55),transparent)}',
  '.fll-corner{position:absolute;right:0;bottom:0;width:26px;height:26px;cursor:nwse-resize;z-index:6}',
  '.fll-corner:before{content:"";position:absolute;right:7px;bottom:7px;width:11px;height:11px;opacity:.5;',
  'transition:.14s;background:linear-gradient(135deg,transparent 0 44%,var(--mut) 44% 57%,',
  'transparent 57% 71%,var(--mut) 71% 84%,transparent 84%)}',
  '.fll-corner:hover:before{opacity:1;background:linear-gradient(135deg,transparent 0 44%,var(--acc) 44% 57%,',
  'transparent 57% 71%,var(--acc) 71% 84%,transparent 84%)}',

  /* ---------- header ---------- */
  '.fll-hd{display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:grab;user-select:none;',
  'background:linear-gradient(180deg,#241f31,#1a1723);border-bottom:1px solid var(--line);flex:0 0 auto}',
  '.fll-hd:active{cursor:grabbing}',
  '.fll-dot{width:9px;height:9px;border-radius:50%;background:var(--acc);box-shadow:0 0 12px var(--acc);',
  'flex:0 0 auto}',
  '.fll-tt{font-size:15px;font-weight:650;letter-spacing:.2px}',
  '.fll-sub{font-size:12.5px;color:var(--mut);margin-top:2px}',
  '.fll-hd-sp{flex:1}',
  '.fll-ico{width:28px;height:28px;border:1px solid transparent;border-radius:8px;color:var(--mut);',
  'cursor:pointer;font-size:15.5px;display:flex;align-items:center;justify-content:center;transition:.14s;',
  'flex:0 0 auto}',
  '.fll-ico:hover{background:var(--bg3);color:var(--txt);border-color:var(--line)}',

  /* ---------- thanh tab ---------- */
  /* Đo đếm trên panel 480px: với gap 3px + padding ngang 7px, bảy tab cần 507px trong khi chỗ chỉ có
     478px — tab cuối ("Diễn biến") bị cắt mất chữ mà không có dấu hiệu gì là còn cuộn được.
     Gap 2px + padding 5px lại còn 473px. overflow-x vẫn giữ cho trường hợp kéo panel hẹp hơn. */
  '.fll-tabs{display:flex;gap:2px;padding:10px 12px 0;flex:0 0 auto;overflow-x:auto;scrollbar-width:none}',
  '.fll-tabs::-webkit-scrollbar{display:none}',
  '.fll-tab{flex:1 0 auto;padding:8px 5px 10px;border-bottom:2px solid transparent;color:var(--mut);font-size:12.5px;',
  'font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;',
  'transition:.14s;white-space:nowrap}',
  '.fll-tab:hover{color:var(--txt)}',
  '.fll-tab.on{color:var(--txt);border-bottom-color:var(--acc)}',
  '.fll-bdg{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:20px;background:var(--bg3);',
  'color:var(--mut);line-height:1.6}',
  '.fll-tab.on .fll-bdg{background:var(--acc);color:#fff}',
  '.fll-bdg.err{background:rgba(255,95,109,.18);color:var(--err)}',
  '.fll-tab.on .fll-bdg.err{background:var(--err);color:#fff}',

  /* ---------- thanh bộ lọc thường trú ---------- */
  '.fll-bar{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:10px 16px 0;padding:8px 11px;',
  'border:1px solid rgba(255,46,136,.3);background:rgba(255,46,136,.05);border-radius:10px;flex:0 0 auto}',
  '.fll-bar[hidden]{display:none}',
  '.fll-bar-t{font-size:11px;font-weight:700;color:var(--acc);letter-spacing:.5px;text-transform:uppercase}',
  '.fll-bar-n{font-size:12px;color:var(--mut);margin-left:auto;font-variant-numeric:tabular-nums}',
  '.fll-fchips{display:flex;flex-wrap:wrap;gap:5px;width:100%}',
  '.fll-fchip{display:inline-flex;align-items:center;gap:6px;padding:3px 5px 3px 10px;border-radius:20px;',
  'font-size:12px;background:var(--bg);border:1px solid var(--line);color:var(--txt);max-width:100%}',
  '.fll-fchip b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}',
  '.fll-fchip button{width:16px;height:16px;border-radius:50%;background:var(--bg3);color:var(--mut);',
  'font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto;',
  'transition:.14s}',
  '.fll-fchip button:hover{background:var(--err);color:#fff}',
  /* Chip mẫu bộ lọc: nửa trái bấm để áp, nửa phải bấm để xoá. */
  '.fll-tpl{cursor:default}',
  '.fll-tpl b{cursor:pointer;font-weight:600;max-width:190px;overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap}',
  '.fll-tpl:hover{border-color:var(--acc)}',
  '.fll-tpl b:hover{color:var(--acc)}',
  '.fll-in:disabled{opacity:.5;cursor:not-allowed}',
  '.fll-btn:disabled{opacity:.5;cursor:not-allowed}',
  '.fll-btn:disabled:hover{border-color:var(--line);background:var(--bg2)}',
  '.fll-fclear{padding:3px 11px;border-radius:20px;font-size:12px;font-weight:650;background:var(--acc);',
  'color:#fff;cursor:pointer;transition:.14s}',
  '.fll-fclear:hover{filter:brightness(1.14)}',
  '.fll-bdg.act{background:rgba(255,46,136,.22);color:var(--acc)}',
  '.fll-tab.on .fll-bdg.act{background:var(--acc);color:#fff}',

  /* ---------- minimap mật độ log theo thời gian ---------- */
  '.fll-map{position:relative;height:36px;margin:12px 16px 0;padding:0 2px;border:1px solid var(--line);',
  'border-radius:8px;background:linear-gradient(180deg,#120f19,#191522);display:flex;align-items:flex-end;',
  'overflow:hidden;cursor:crosshair;flex:0 0 auto}',
  '.fll-map i{flex:1;min-width:1px;display:block;transition:.1s}',
  '.fll-map i:hover{filter:brightness(1.8)}',
  '.fll-shade{position:absolute;top:0;bottom:0;width:0;background:rgba(14,11,20,.74);pointer-events:none}',
  '.fll-shade-l{left:0}',
  '.fll-shade-r{right:0}',
  /* Khi có khoảng đang chọn thì vẽ vạch mép để biết chỗ nào nắm được để co giãn. */
  '.fll-map-ranged .fll-shade-l{border-right:2px solid var(--acc);box-shadow:2px 0 8px rgba(255,46,136,.4)}',
  '.fll-map-ranged .fll-shade-r{border-left:2px solid var(--acc);box-shadow:-2px 0 8px rgba(255,46,136,.4)}',
  '.fll-maptext{font-variant-numeric:tabular-nums;opacity:.75}',
  '.fll-map-ranged + .fll-maplbl .fll-maptext{opacity:1;color:var(--acc);font-weight:650}',
  '.fll-maptext.aiming{opacity:1;color:#fff;font-weight:700;font-variant-numeric:tabular-nums}',
  /* Vạch vị trí TRẮNG, không accent. Accent (#ff2e88) cùng hệ hồng với cột ERROR của minimap (#ff5f6d)
     nên đặt lên đúng chỗ có lỗi là chìm nghỉm — mà chỗ có lỗi lại chính là chỗ hay phải nhìn nhất.
     Cùng lý do đã đổi vạch của mũi tên sang trắng; hồi đó .fll-cursor bị bỏ sót. Viền tối mảnh bao
     quanh để trên cột trắng/vàng vẫn tách ra được. Accent ở minimap từ nay chỉ còn nghĩa "khoảng đang
     bị cắt bởi bộ lọc" (mép vùng chọn), đúng với luật một-thứ-accent-một-lúc. */
  '.fll-cursor{position:absolute;top:0;bottom:0;width:2px;background:#fff;pointer-events:none;',
  'box-shadow:0 0 0 1px rgba(10,8,14,.55),0 0 10px rgba(255,255,255,.75);opacity:0;transition:.12s}',
  /* Tooltip tự vẽ. position:fixed và nằm trong #fll-root (không phải .fll-panel, panel có
     overflow:hidden sẽ cắt mất nó). z-index trên cả tấm trượt lẫn lớp mũi tên. */
  '.fll-tip{position:fixed;z-index:2147483001;max-width:300px;padding:7px 10px;border-radius:8px;',
  'background:#0d0b12;border:1px solid var(--line);color:var(--txt);font-size:12px;line-height:1.5;',
  'box-shadow:0 8px 26px rgba(0,0,0,.6);pointer-events:none;white-space:normal;word-break:break-word;',
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',

  /* Nút phóng to nằm ngay trong dòng nhãn dưới minimap — chỗ duy nhất vừa liên quan vừa không ăn
     mất chỗ của chính minimap. */
  '.fll-maprow{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto}',
  /* Chiều cao của nút PHẢI cố định, đừng để nó suy ra từ line-height thừa hưởng: nút này hiện/ẩn theo
     việc có khoảng đang chọn hay không, mà đo trong Chrome thì dòng nhãn cao 15.22px khi không có nút
     và 18.50px khi có — mỗi lần bấm là cả phần dưới panel bị đẩy lên rồi tụt xuống 3.28px. Nay nút
     cao đúng 18.5px và .fll-maplbl chừa sẵn từng ấy, nên hiện/ẩn không đụng vào layout.
     Đổi cỡ chữ cả bộ thì đo lại hai số này. */
  '.fll-mapzoom{font-size:10px;font-weight:700;height:18.5px;padding:0 7px;border-radius:20px;',
  'display:inline-flex;align-items:center;cursor:pointer;',
  'background:var(--bg3);color:var(--txt);border:1px solid var(--line)!important;white-space:nowrap}',
  '.fll-mapzoom:hover{border-color:var(--acc)!important;color:var(--acc)}',
  '.fll-mapzoom.on{background:var(--acc);color:#fff;border-color:var(--acc)!important}',
  '.fll-map-zoomed{border-color:var(--acc)}',
  '.fll-maplbl{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:5px 17px 0;',
  'min-height:18.5px;font-size:10.5px;',
  'color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 auto}',

  /* ---------- thân panel ---------- */
  '.fll-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:var(--pad-y,14px) var(--pad-x,16px) 18px}',
  '.fll-body::-webkit-scrollbar{width:10px}',
  '.fll-body::-webkit-scrollbar-thumb{background:#3a3348;border-radius:10px;border:3px solid var(--bg)}',
  '.fll-body::-webkit-scrollbar-thumb:hover{background:#4c4360}',

  /* ---------- thẻ thống kê ---------- */
  '.fll-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:14px}',
  '.fll-stat{background:var(--bg2);border:1px solid var(--line);border-radius:11px;padding:12px 13px;',
  'cursor:pointer;transition:.14s}',
  '.fll-stat:hover{border-color:var(--acc);transform:translateY(-1px)}',
  '.fll-stat b{display:block;font-size:23.5px;font-weight:700;font-variant-numeric:tabular-nums;',
  'letter-spacing:-.5px;line-height:1.15}',
  '.fll-stat b em{font-style:normal;font-size:13.5px;font-weight:600;color:var(--mut);letter-spacing:0}',
  '.fll-stat span{display:block;font-size:12px;color:var(--mut);margin-top:4px}',

  /* ---------- khối lấy nét theo feedback ----------
     Cố ý KHÔNG tô hồng: thanh bộ lọc phía trên đã là màu accent rồi. Để ba khối hồng chồng nhau
     thì accent mất hết ý nghĩa, không còn gì nổi bật hơn gì. */
  '.fll-focus{border:1px solid var(--line);background:var(--bg2);border-radius:12px;padding:12px 13px;',
  'margin-bottom:14px}',
  '.fll-focus-t{font-size:14px;line-height:1.5}',
  '.fll-focus-t b{font-weight:700;color:var(--acc)}',
  '.fll-focus-d{font-size:12px;color:var(--mut);margin-top:4px;font-family:var(--mono);',
  'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-focus-hint{font-size:12px;color:var(--mut);margin:11px 0 7px}',

  /* ---------- bảng thời lượng ---------- */
  '.fll-slow{position:relative;display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;',
  'background:var(--bg2);border:1px solid transparent;margin-bottom:4px;cursor:pointer;overflow:hidden;',
  'transition:.14s}',
  '.fll-slow:hover{border-color:var(--acc)}',
  '.fll-slow u{position:absolute;left:0;top:0;bottom:0;text-decoration:none}',
  '.fll-slow-ms{position:relative;font-size:13px;font-weight:750;font-variant-numeric:tabular-nums;',
  'flex:0 0 auto;width:52px;text-align:right}',
  '.fll-slow-txt{position:relative;flex:1;min-width:0;font-family:var(--mono);font-size:12px;color:#cfc8dd;',
  'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

  /* ---------- bảng cấu hình ---------- */
  /* Hàng có thể chứa một khối JSON dài; .fll-cfg-v giới hạn 3 dòng rồi cắt, còn bản đầy đủ thì
     xem qua nút JSON. Không dùng white-space:nowrap như các bảng khác vì giá trị cấu hình đọc
     theo chiều ngang thì mất nghĩa. */
  '.fll-cfg{position:relative;padding:9px 12px 9px;margin-bottom:5px;border-radius:9px;',
  'background:var(--bg2);border:1px solid var(--line);transition:.14s}',
  '.fll-cfg.chg{border-left:2px solid var(--warn)}',
  '.fll-cfg-hd{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:13px;font-weight:600}',
  '.fll-cfg-hd b{font-weight:700;word-break:break-word}',
  '.fll-cfg-hd em{margin-left:auto;font-style:normal;font-size:11px;color:var(--mut);',
  'font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-cfg-chg{font-style:normal;font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:20px;',
  'background:rgba(255,182,72,.18);color:var(--warn)}',
  '.fll-cfg-note{font-style:normal;font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:20px;',
  'background:var(--bg3);color:var(--mut)}',
  '.fll-cfg-val{margin-top:6px;padding:6px 9px;border-radius:7px;background:var(--bg);',
  'border:1px solid transparent;cursor:pointer;transition:.14s}',
  '.fll-cfg-val:hover{border-color:var(--acc)}',
  '.fll-cfg-val.last{background:var(--bg3)}',
  '.fll-cfg-vm{font-size:10.5px;color:var(--mut);font-variant-numeric:tabular-nums}',
  '.fll-cfg-v{margin-top:3px;font-family:var(--mono);font-size:12px;line-height:1.5;color:#cfc8dd;',
  'word-break:break-all;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
  '.fll-cfg-js{margin-top:6px;padding:4px 10px;font-size:11px}',

  /* ---------- mũi tên từ mục đang di chuột lên minimap ---------- */
  /* Một lớp SVG phủ lên cả panel. pointer-events:none để không chặn chuột; z-index cao hơn .fll-sheet
     (8) vì đường kẻ phải đi TỪ trong tấm trượt RA đến minimap nằm ngoài nó. */
  /* Mũi tên từng tô accent — cùng hệ hồng với cột ERROR của minimap (#ff5f6d), nên đặt lên minimap là
     chìm nghỉm. Nay tô TRẮNG kèm viền màu nền panel: trên cột hồng, cột vàng hay chỗ trống đều nổi.
     .fll-cursor nay cũng trắng vì đúng một lý do đó; hai cái không lẫn nhau vì khác hình: vạch vị trí
     là đường dọc 2px suốt chiều cao, còn dấu của mũi tên là những ô ngắn. */
  '.fll-aim{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9;',
  'opacity:0;transition:opacity .12s}',
  '.fll-aim.on{opacity:1}',
  /* Đường kẻ vẫn để accent: nó chạy trên các thẻ tối trong thân panel, ở đó accent đọc tốt mà không
     đè lên chữ nhiều như nét trắng. Chỉ cái ĐẦU MŨI TÊN và vạch trên minimap mới đổi sang trắng. */
  '.fll-aim-line{fill:none;stroke:var(--acc);stroke-width:1.6;stroke-dasharray:4 3;opacity:.9}',
  '.fll-aim-head{fill:#fff;stroke:var(--bg);stroke-width:1;paint-order:stroke}',
  '.fll-aim-ticks rect{fill:#fff;stroke:var(--bg);stroke-width:1;paint-order:stroke;opacity:.75}',
  '.fll-aim-ticks rect.fll-aim-first{opacity:1}',
  '.fll-aimed{outline:1px solid var(--acc);outline-offset:1px;border-radius:8px}',

  /* ---------- nút nhỏ trong hàng, và nút tắt tiếng ---------- */
  '.fll-ico.fll-mini{width:24px;height:24px;font-size:11px;border-radius:6px;background:var(--bg3);flex:0 0 auto}',
  '.fll-ico.fll-mute{width:22px;height:22px;font-size:12.5px;opacity:.4;flex:0 0 auto;margin-left:2px}',
  '.fll-grp:hover .fll-ico.fll-mute{opacity:.9}',
  '.fll-grp.muted{opacity:.42}',
  '.fll-grp.muted:hover{opacity:.8}',

  /* ---------- tấm trượt chi tiết ---------- */
  '.fll-sheet{position:absolute;left:0;right:0;bottom:0;top:52px;background:var(--bg);display:flex;',
  'flex-direction:column;z-index:8;animation:fll-up .16s cubic-bezier(.2,.9,.3,1)}',
  '@keyframes fll-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
  '.fll-sheet-hd{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--line);',
  'background:linear-gradient(180deg,#241f31,#1a1723);flex:0 0 auto}',
  '.fll-sheet-tt{font-size:14px;font-weight:650;word-break:break-all}',
  '.fll-sheet-sub{font-size:12px;color:var(--mut);margin-top:2px}',
  '.fll-sheet-body{flex:1;overflow:auto;padding:14px 16px 18px}',
  '.fll-sheet-body::-webkit-scrollbar{width:10px;height:10px}',
  '.fll-sheet-body::-webkit-scrollbar-thumb{background:#3a3348;border-radius:10px;border:3px solid var(--bg)}',
  '.fll-code{font-family:var(--mono);font-size:12.5px;line-height:1.55;color:#cfc8dd;background:var(--bg2);',
  'border:1px solid var(--line);border-radius:9px;padding:12px 14px;white-space:pre;overflow-x:auto;',
  'display:block;tab-size:2}',
  '.fll-code.fll-wrap{white-space:pre-wrap;overflow-wrap:anywhere}',

  /* ---------- từng trường trong payload ---------- */
  /* Một dòng HTTP có thể có 5 trường (--encrypted / --body / --header / --exception ...),
     nên mỗi trường là một khối riêng có nhãn trạng thái parse và nút copy riêng. */
  /* Tô màu JSON: màu khoá/chuỗi/số tách nhau đủ để lướt mắt tìm field, không rực đến mức nhức mắt. */
  '.fll-code i{font-style:normal}',
  '.fll-jk{color:#7fd0ff}',
  '.fll-js{color:#a9e6b8}',
  '.fll-jn{color:var(--warn)}',
  '.fll-jb{color:#c79bff}',
  /* Thanh đổi Request / Response: dùng lại dạng tab của panel cho nhất quán, size nằm trong badge. */
  /* Thanh công cụ của tấm trượt dính lại khi cuộn: payload JSON dài tới 10KB, cuộn giữa chừng vẫn
     phải bấm được "Tới dòng" và đổi Request/Response. Cùng ba điều kiện như .fll-sec — nền đục,
     tràn hết bề ngang bằng margin ngang âm, và top âm đúng bằng padding của vùng cuộn. */
  '.fll-paytop{position:sticky;top:calc(var(--pad-y,14px) * -1);z-index:4;background:var(--bg);',
  'margin:calc(var(--pad-y,14px) * -1) calc(var(--pad-x,16px) * -1) 12px;',
  'padding:var(--pad-y,14px) var(--pad-x,16px) 8px;border-bottom:1px solid var(--line)}',
  '.fll-stabs{display:flex;align-items:flex-end;gap:4px;border-bottom:1px solid var(--line);margin-bottom:8px}',
  '.fll-stabs .fll-tab{flex:0 0 auto;padding:5px 12px 8px}',
  '.fll-stabs .fll-chip,.fll-paybar .fll-chip{margin-bottom:6px}',
  '.fll-paybar{margin:0;gap:6px}',
  '.fll-paybar .fll-btn.fll-mini{flex:0 0 auto}',
  '.fll-paybar .fll-chip{margin:0}',
  '.fll-pay{margin-bottom:14px}',
  '.fll-pay:last-child{margin-bottom:0}',
  '.fll-pay-hd{display:flex;align-items:center;gap:8px;margin-bottom:7px;min-height:24px;flex-wrap:wrap}',
  '.fll-pay-hd b{font-family:var(--mono);font-size:12.5px;font-weight:700;color:#e8e2f2}',
  '.fll-pay-v{font-family:var(--mono);font-size:12.5px;color:var(--mut);word-break:break-all}',
  '.fll-pay-tag{font-size:10.5px;font-weight:700;letter-spacing:.3px;padding:3px 7px;border-radius:6px;',
  'background:rgba(61,220,151,.11);color:var(--ok);border:1px solid rgba(61,220,151,.24)}',
  '.fll-pay-tag.warn{background:rgba(255,182,72,.11);color:var(--warn);border-color:rgba(255,182,72,.28)}',
  '.fll-btn.fll-mini{padding:5px 10px;font-size:12px;border-radius:7px}',

  /* ---------- tiêu đề mục ---------- */
  /* Dính lại ở mép trên khi cuộn. Tab Lọc có 8 mục, tab Diễn biến vẽ 80 mốc một lô — cuộn một lát là
     không còn biết đang đọc mục nào; sticky giữ cái nhãn đó luôn nằm trong tầm mắt.
     Ba điều kiện để sticky không vỡ:
     - Nền phải ĐỤC và TRÀN HẾT CHIỀU RỘNG, nếu không nội dung sẽ trôi qua ngay bên dưới chữ. Kéo bằng
       margin ngang âm 16px (đúng bằng padding của .fll-body) rồi padding bù lại.
     - top phải là ÂM đúng bằng padding-top của .fll-body. Đo thật trong Chrome trên trang test dùng chính
       bộ CSS này: với top:0 tiêu đề dính cách mép trên 13.9px (đúng bằng padding-top 14px) và nội dung
       vẫn trôi qua bên trên nó — tức offset tính từ CONTENT box chứ không phải padding box. Với
       top:calc(var(--pad-y) * -1) thì hở còn 0px, và KHÔNG bị overflow cắt: nó chỉ nhô đúng tới mép
       padding box, là đúng chỗ overflow bắt đầu clip.
     - z-index:3 đủ để đè lên nội dung, vẫn nằm dưới .fll-sheet (z-index:8) nên tấm trượt không bị đâm xuyên.
     Màu chữ từng là #7f7793: chỉ 4.31:1 trên nền panel, dưới ngưỡng WCAG AA 4.5:1, lại ở cỡ 10px in hoa
     nên đọc được mà không "nhảy ra" được. Nay #d5cfe2 trên dải nền đậm nhất vẫn đạt 10.53:1.
     Dải nền dùng đúng gradient của .fll-sheet-hd cho thống nhất với phần còn lại của panel. */
  '.fll-sec{position:sticky;top:calc(var(--pad-y,14px) * -1);z-index:3;',
  'margin:22px calc(var(--pad-x,16px) * -1) 10px;padding:10px var(--pad-x,16px) 9px;',
  'background:linear-gradient(180deg,#241f31,#1a1723);border-bottom:1px solid var(--line);',
  'font-size:12.5px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;',
  'color:#d5cfe2;display:flex;align-items:center;gap:8px}',
  '.fll-sec:before{content:"";width:3px;height:13px;border-radius:2px;background:var(--acc);flex:0 0 auto}',
  '.fll-sec:first-child{margin-top:0}',

  /* ---------- mục đóng/mở được ---------- */
  /* Khối .fll-secw do collapsifySections() dựng sau khi vẽ, không renderer nào sinh ra nó.
     Lề trên 22px chuyển từ .fll-sec sang khối bao ngoài: sau khi bọc, .fll-sec luôn là con đầu tiên
     của khối nên ".fll-sec:first-child{margin-top:0}" sẽ ăn hết lề của MỌI mục. Hai rule dưới đây
     cùng độ đặc hiệu (0,2,0) với rule đó nhưng viết sau nên thắng. */
  '.fll-secw{margin-top:22px}',
  '.fll-secw:first-child{margin-top:0}',
  /* Mục đang thu lại thì không còn nội dung để tách khỏi mục trước, 22px chỉ làm danh sách tiêu đề
     dài ra vô ích — tab Tổng quan có chín mục. */
  '.fll-secw:not(.open) + .fll-secw:not(.open){margin-top:8px}',
  '.fll-secw > .fll-sec{margin-top:0;cursor:pointer;user-select:none;transition:.14s}',
  '.fll-secw > .fll-sec:hover{color:#fff;background:linear-gradient(180deg,#2d2740,#211c2e)}',
  '.fll-secb{display:none}',
  '.fll-secq{margin-bottom:8px;font-size:12px;padding:6px 10px}',
  /* Nút "Hiện thêm" của một mục: capSectionRows() cắt bớt hàng thừa sau khi vẽ, nút này bung phần còn lại. */
  '.fll-secmore{width:100%;margin-top:8px}',
  '.fll-secq-note{margin:-4px 0 8px}',
  '.fll-secw.open > .fll-secb{display:block}',
  /* Mục đang đóng thì thanh tiêu đề không cần dính lại: không có gì trôi qua dưới nó cả. */
  '.fll-secw:not(.open) > .fll-sec{position:relative;top:0}',
  /* Badge là thứ DUY NHẤT nhìn thấy khi mục đang thu lại, nên nó phải đọc được ngay: đẩy sang phải
     bằng margin-left:auto, và cắt bớt nếu quá dài (chuỗi đang tìm có thể dài bao nhiêu cũng được). */
  '.fll-secbdg{margin-left:auto;flex:0 1 auto;max-width:52%;overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap;font-style:normal;font-size:10.5px;font-weight:700;letter-spacing:.2px;',
  'text-transform:none;padding:2px 7px;border-radius:20px;background:var(--bg3);color:var(--mut)}',
  '.fll-secbdg.err{background:rgba(255,95,109,.18);color:var(--err)}',
  '.fll-secbdg.warn{background:rgba(255,182,72,.18);color:var(--warn)}',
  '.fll-secbdg.ok{background:rgba(61,220,151,.16);color:var(--ok)}',
  '.fll-secbdg.act{background:var(--acc);color:#fff}',
  '.fll-caret{flex:0 0 auto;font-size:10px;color:var(--mut);transition:transform .15s,color .15s;',
  'display:inline-block;width:9px;text-align:center}',
  '.fll-secw.open > .fll-sec .fll-caret{transform:rotate(90deg);color:var(--acc)}',
  '.fll-note{display:flex;gap:10px;padding:12px 13px;border-radius:11px;font-size:13px;line-height:1.55;',
  'background:rgba(255,182,72,.09);border:1px solid rgba(255,182,72,.28);color:#ffd79a;margin-bottom:6px}',
  '.fll-note b{color:#fff;font-weight:650}',
  '.fll-note.ok{background:rgba(61,220,151,.09);border-color:rgba(61,220,151,.28);color:#a9f0cf}',

  /* ---------- thanh tỷ lệ mức độ ---------- */
  '.fll-lvbar{display:flex;height:10px;border-radius:5px;overflow:hidden;margin-bottom:10px;background:var(--bg3)}',
  '.fll-lvbar i{display:block;transition:.2s}',
  '.fll-lvkey{display:flex;flex-wrap:wrap;gap:6px}',
  '.fll-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;font-size:12px;',
  'font-weight:600;background:var(--bg2);border:1px solid var(--line);color:var(--mut);cursor:pointer;',
  'transition:.14s}',
  '.fll-chip:hover{border-color:var(--acc);color:var(--txt)}',
  '.fll-chip.on{background:var(--acc);border-color:var(--acc);color:#fff}',
  /* Chip không còn dòng nào khớp trong ngữ cảnh hiện tại: vẫn bấm được nhưng không đòi nhìn. */
  '.fll-chip.dim{opacity:.42}',
  /* Phiên không thấy điểm bắt đầu: viền đứt ở mép trái, đọc ra là "đoạn này bị cắt cụt đầu". Cố ý
     KHÔNG tô accent — accent để dành riêng cho thanh bộ lọc. */
  '.fll-chip-orphan{border-left-style:dashed;border-left-width:2px;border-left-color:var(--mut)}',
  '.fll-chip.dim:hover{opacity:1}',
  '.fll-chip em{font-style:normal;opacity:.75;font-variant-numeric:tabular-nums}',
  '.fll-sw{width:8px;height:8px;border-radius:2px;flex:0 0 auto}',

  /* ---------- bảng xếp hạng có thanh ngang ---------- */
  '.fll-rank{display:flex;flex-direction:column;gap:4px}',
  '.fll-rk{position:relative;display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:8px;',
  'background:var(--bg2);border:1px solid transparent;cursor:pointer;overflow:hidden;transition:.14s}',
  '.fll-rk:hover{border-color:var(--acc)}',
  '.fll-rk u{position:absolute;left:0;top:0;bottom:0;background:rgba(255,46,136,.16);text-decoration:none}',
  '.fll-rk span{position:relative;flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-rk b{position:relative;font-size:12.5px;color:var(--mut);font-variant-numeric:tabular-nums}',

  /* ---------- thẻ nhóm vấn đề ---------- */
  '.fll-grp{border:1px solid var(--line);border-left:3px solid var(--warn);border-radius:11px;',
  'background:var(--bg2);padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:.14s}',
  '.fll-grp:hover{border-color:var(--acc);border-left-color:var(--acc);background:var(--bg3)}',
  '.fll-grp.err{border-left-color:var(--err)}',
  '.fll-grp-top{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
  '.fll-cnt{font-size:12.5px;font-weight:800;padding:2px 9px;border-radius:20px;background:rgba(255,182,72,.16);',
  'color:var(--warn);font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-grp.err .fll-cnt{background:rgba(255,95,109,.16);color:var(--err)}',
  '.fll-mod{font-size:11px;font-weight:650;color:var(--info);background:rgba(88,196,255,.12);padding:2px 8px;',
  'border-radius:6px;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-when{margin-left:auto;font-size:11px;color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-msg{font-family:var(--mono);font-size:12.5px;line-height:1.55;color:#cfc8dd;word-break:break-word;',
  'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
  '.fll-spark{display:flex;align-items:flex-end;gap:1px;height:15px;margin-top:9px}',
  '.fll-spark i{flex:1;min-width:1px;background:var(--bg3);border-radius:1px}',

  /* ---------- HTTP ---------- */
  '.fll-call{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:8px;background:var(--bg2);',
  'border:1px solid transparent;margin-bottom:5px;cursor:pointer;transition:.14s}',
  '.fll-call:hover{border-color:var(--acc)}',
  '.fll-verb{font-size:10px;font-weight:800;letter-spacing:.4px;padding:3px 6px;border-radius:5px;',
  'background:var(--bg3);color:var(--mut);flex:0 0 auto;width:50px;text-align:center}',
  '.fll-st{font-size:11px;font-weight:700;padding:3px 7px;border-radius:5px;flex:0 0 auto;',
  'background:rgba(61,220,151,.14);color:var(--ok);font-variant-numeric:tabular-nums}',
  '.fll-st.bad{background:rgba(255,95,109,.16);color:var(--err)}',
  '.fll-st.wait{background:rgba(255,182,72,.16);color:var(--warn)}',
  '.fll-path{flex:1;min-width:0;font-family:var(--mono);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap;direction:rtl}',
  '.fll-dur{font-size:11px;color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 auto}',

  /* ---------- đường thời gian ---------- */
  '.fll-tl{position:relative;padding-left:26px}',
  '.fll-tl:before{content:"";position:absolute;left:9px;top:8px;bottom:8px;width:1px;background:var(--line)}',
  '.fll-ev{position:relative;padding:9px 12px;margin-bottom:6px;border-radius:9px;background:var(--bg2);',
  'cursor:pointer;border:1px solid transparent;transition:.14s}',
  '.fll-ev:hover{border-color:var(--acc)}',
  /* Chấm tròn màu ở lề trái đã bỏ: màu không tự nói ra nghĩa, người đọc phải nhớ "hồng là chạm, xanh
     là màn hình" — không ai nhớ. Nay biểu tượng nằm trong thẻ, kèm title và một hàng chú giải ở trên. */
  '.fll-ev:before{content:"";position:absolute;left:-18px;top:17px;width:5px;height:5px;border-radius:50%;',
  'background:var(--line)}',
  /* Biểu tượng nằm THẲNG TRÊN đường thời gian chứ không trong thẻ: nhìn dọc một cột là quét được cả
     chuỗi sự kiện. Vẫn là một thẻ thật (không phải :before) nên mang được title = tên loại mốc.
     Nền đục để nó đè lên nét kẻ của đường thời gian chạy bên dưới. */
  '.fll-ev-ic{position:absolute;left:-28px;top:6px;width:21px;height:21px;text-align:center;',
  'font-size:15.5px;line-height:21px;border-radius:50%;background:var(--bg);',
  'font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}',
  '.fll-chip-ic{font-style:normal;font-size:14.5px;line-height:1;',
  'font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}',
  '.fll-ev-t{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600}',
  '.fll-ev-t em{margin-left:auto;font-style:normal;font-size:11px;color:var(--mut);font-variant-numeric:tabular-nums}',
  '.fll-ev-d{font-size:12px;color:var(--mut);margin-top:4px;font-family:var(--mono);overflow:hidden;',
  'text-overflow:ellipsis;white-space:nowrap}',

  /* ---------- hành trình ---------- */
  /* Dùng lại khung .fll-tl/.fll-ev của Timeline, chỉ đổi màu chấm theo loại thao tác. */
  '.fll-ev.jr-saw{border-left:2px solid var(--warn)}',
  '.fll-ev.jr-fail{border-left:2px solid var(--err)}',
  '.fll-jms{font-size:10.5px;font-weight:700;color:var(--warn);background:rgba(255,182,72,.14);',
  'padding:1px 6px;border-radius:20px;font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-jn{font-size:10.5px;font-weight:800;color:var(--mut);background:var(--bg3);padding:1px 6px;',
  'border-radius:20px;font-variant-numeric:tabular-nums;flex:0 0 auto}',

  /* ---------- form lọc ---------- */
  '.fll-in{width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg2);',
  'color:var(--txt);font-size:13.5px;font-family:var(--mono);transition:.14s}',
  '.fll-in::placeholder{color:#6d6580}',
  '.fll-in:focus{border-color:var(--acc);box-shadow:0 0 0 3px rgba(255,46,136,.14)}',
  '.fll-in.bad{border-color:var(--err)}',
  '.fll-hint{font-size:12px;line-height:1.55;color:var(--mut)}',
  '.fll-hint b{font-weight:650}',
  '.fll-btn{padding:9px 15px;border-radius:9px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);',
  'font-size:13px;font-weight:650;cursor:pointer;transition:.14s}',
  '.fll-btn:hover{border-color:var(--acc);background:var(--bg3)}',
  '.fll-btn.pri{background:var(--acc);border-color:var(--acc);color:#fff}',
  '.fll-btn.pri:hover{filter:brightness(1.12)}',
  '.fll-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
  '.fll-empty{text-align:center;padding:40px 16px;color:var(--mut);font-size:13.5px}',

  /* ---------- thanh điều hướng dưới cùng ---------- */
  /* Chừa padding-right rộng hơn để nút ">" không nằm dưới tay nắm kéo góc. */
  /* Thanh này nằm dưới cùng nên dễ bị bỏ qua, mà luôn hiển thị lại tốn chỗ khi không có việc.
     Nay chỉ hiện khi thật sự có danh sách dòng để duyệt — việc nó XUẤT HIỆN chính là lời giới thiệu.
     [hidden] phải ghi rõ vì display:flex bên dưới sẽ đè lên mặc định của thuộc tính hidden. */
  '.fll-ft[hidden]{display:none}',
  '.fll-ft{display:flex;align-items:center;gap:6px;padding:9px 30px 9px 8px;',
  'border-top:1px solid var(--line);background:linear-gradient(0deg,#241f31,#1a1723);flex:0 0 auto;',
  'transition:background .18s,border-color .18s}',
  '.fll-ft{border-top:2px solid var(--acc);background:linear-gradient(0deg,#2c2235,#221b2c)}',
  '.fll-ft .fll-info{flex:1;min-width:0;font-size:12.5px;color:var(--mut);display:flex;align-items:center;',
  'gap:6px;overflow:hidden}',
  '.fll-ft .fll-info b{color:var(--txt);font-weight:650;font-variant-numeric:tabular-nums}',
  '.fll-ft-tag{flex:0 0 auto;font-size:9px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;',
  'color:var(--acc);background:rgba(255,46,136,.14);padding:2px 5px;border-radius:20px}',
  '.fll-ft-pos{flex:0 0 auto;font-size:13.5px}',
  '.fll-ft-lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-ft-line{flex:0 0 auto;color:var(--mut)}',

  /* Nút duyệt: trước chỉ là mũi tên 28px không nhãn, người dùng không biết có phím tắt.
     Nay đeo luôn chữ phím ngay trên nút. */
  '.fll-nav{display:flex;align-items:center;gap:3px;padding:5px 7px;border-radius:8px;',
  'border:1px solid var(--line);background:var(--bg2);color:var(--mut);font-size:11px;cursor:pointer;',
  'transition:.14s;flex:0 0 auto}',
  '.fll-nav em{font-style:normal;font-size:10.5px;font-weight:800;background:var(--bg3);color:var(--mut);',
  'padding:1px 5px;border-radius:4px}',
  '.fll-nav{color:var(--txt);border-color:rgba(255,46,136,.4)}',
  '.fll-nav em{background:rgba(255,46,136,.18);color:var(--acc)}',
  '.fll-nav:hover{border-color:var(--acc);color:var(--txt)}',
  '.fll-ft-flash{animation:fll-ftflash .55s ease-out}',
  '@keyframes fll-ftflash{0%{background:rgba(255,46,136,.32)}100%{background:linear-gradient(0deg,#2c2235,#221b2c)}}',

  /* ---------- pill khi thu nhỏ ---------- */
  '.fll-pill{position:fixed;right:18px;bottom:18px;display:flex;align-items:center;gap:9px;padding:11px 18px;',
  'border-radius:24px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:13.5px;',
  'font-weight:600;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.42);transition:.16s;',
  'animation:fll-in .18s cubic-bezier(.2,.9,.3,1)}',
  '.fll-pill:hover{transform:translateY(-2px);border-color:var(--acc)}',
  '.fll-pill b{color:var(--err);font-weight:750;font-variant-numeric:tabular-nums}',

  /* ---------- style bơm vào bảng log của trang ---------- */
  /* Lọc bằng một class trên container + đánh dấu dòng được giữ, thay vì ẩn từng dòng bị loại. */
  '.fll-filtering > [class*="logRow"]:not(.fll-keep){display:none!important}',
  /* Chế độ đảo: lọc rộng thì đánh dấu dòng BỊ LOẠI cho ít thao tác hơn. */
  '.fll-dropping > [class*="logRow"].fll-drop{display:none!important}',
  '.fll-hit{background:rgba(255,46,136,.22)!important;outline:2px solid #ff2e88!important;outline-offset:-2px;',
  'border-radius:3px;animation:fll-flash .9s ease-out}',
  '@keyframes fll-flash{0%{background:rgba(255,46,136,.6)!important}100%{background:rgba(255,46,136,.22)!important}}',
].join('');
// @ts-check
// rút các dòng "config" mà app nhận từ BE / webadmin / CDN / A-B testing
//
// Vì sao tách riêng khỏi buildIssueGroups: những dòng này đều ở mức INFO nên không bao giờ lọt qua
// nhóm lỗi, và chúng không phải sự kiện người dùng nên không vào hành trình. Chúng trả lời một câu
// khác hẳn: "lúc đó máy này đang chạy với cấu hình gì".
//
// Nguồn (source) KHÔNG suy đoán: mọi nhãn dưới đây đều đọc được thẳng từ chính dòng log
// (chữ "webadmin", url CDN, tên lớp ABTesting...). Dòng nào không tự nói nguồn thì vào nhóm 'oth'
// chứ không đoán bừa.

const CONFIG_SOURCE_ORDER = ['ab', 'be', 'wa', 'cdn', 'app', 'oth'];
const CONFIG_SOURCE_META = {
  ab: {
    label: 'A/B testing',
    hint: 'Nhánh máy này rơi vào — hai máy khác nhánh chạy hai đoạn code khác nhau. ' +
      '<code>DEFAULT_GROUP</code> = không nằm trong thí nghiệm.',
  },
  be: {
    label: 'BE trả về',
    hint: 'Dòng log tự nói là nhận từ server.',
  },
  wa: {
    label: 'Webadmin',
    hint: 'Feature và giá trị webadmin đẩy xuống.',
  },
  cdn: {
    label: 'File JSON trên CDN',
    hint: 'Cấu hình dạng file tĩnh. Muốn xem nội dung thì mở url.',
  },
  app: {
    label: 'App đã áp dụng',
    hint: 'Giá trị app tự ghi sau khi dựng xong — so với khối "BE trả về" xem có khớp không.',
  },
  oth: {
    label: 'Chưa rõ nguồn',
    hint: 'Tự gọi mình là config nhưng không nói lấy từ đâu.',
  },
};

const RE_CFG_AB_TAG =
  /ABTestingExpTag\(namespace=([^,)]*),\s*exp_definition=([^,)]*),\s*exp_name=([^,)]*),\s*tag=([^,)]*)/;
const RE_CFG_AB_FLOW = /-\s*defaultFlow:\s*(\S+)/;
const RE_CFG_AB_AUTH = /ABTest tag for namespace (\S+)\s*=>\s*(\S+)/;
const RE_CFG_AB_FULLSCREEN = /resolveFullscreenAbTag\s*::\s*tagName=(\S+) for nameSpace=(\S+)/;
const RE_CFG_PERSIST = /\bPersist\s+(\S+)\s+key=(\S+)\s+raw=([\s\S]+)$/;
const RE_CFG_WEBADMIN = /webadmin config\s+(\S+)\s*([\s\S]*)$/;
const RE_CFG_CDN = /configs\s*>>\s*fetchConfig\s*>>\s*url:\s*(\S+)/;
const RE_CFG_DYNA_KEYS = /@@DynamicConfig\s*::\s*Transformed config for (\S+) with (\d+) namespaced keys/;
const RE_CFG_DYNA_BODY = /@@DynamicConfig\s*::\s*responseBody:\s*([\s\S]+)$/;
const RE_CFG_FEATURE_CONF = /getFeatureConfigurations\(\)\]\s*Config\s*->\s*([\s\S]+)$/;
const RE_CFG_OMEGA = /OMEGA FEATURE TESTINGS LIST CODE:\s*([\s\S]+)$/;
const RE_CFG_SENTRY_KMP = /@@SentryKMP\s*::\s*(.+?)\s+(\w+=[\s\S]+)$/;
const RE_CFG_SPAM = /(ApiSpamDetector):\s*Config:\s*([\s\S]+)$/;
const RE_CFG_AUTH_BG = /(AuthenticationBackgroundConfigApi)\s*>>\s*fetchConfig\s*>>\s*loaded\s+([\s\S]+)$/;
// Kotlin/KMM in data class ra dạng TenLop(a=1, b=2). Chỉ nhận khi TÊN LỚP có chữ Config/Setting —
// không thể bắt mọi cặp ngoặc, gần nửa dòng log nào cũng có ngoặc.
const RE_CFG_DATA_CLASS = /([A-Z]\w*(?:Config|Setting)\w*)\((.{20,})\)\s*$/;
// Đường dẫn API có chữ "config": xét trên path đã bỏ query, vì query của API khác cũng có
// "displayConfig=" mà đó không phải API cấu hình.
const RE_CFG_URL = /config/i;

// Không đặt \b trước "config": trong log chữ này hầu hết dính liền với từ khác (fetchConfig,
// getTabMeConfigBE, displayConfig) nên \b sẽ trượt hết.
// Loại riêng động từ "configure/configuring/configured" (dòng báo đã dùng xong một bước, không
// mang giá trị cấu hình nào); "configuration(s)" thì vẫn nhận.
const RE_CFG_WORD = /config(?!ur(?:e|ing|ed)\b)|setting|feature.?flag|toggle|kill.?switch/i;
// Động từ nói là nhận về từ một lời gọi -> xếp vào 'be'. Không có dấu hiệu này thì để 'oth'.
const RE_CFG_FROM_BE = /response|payload|fetched|downloaded/i;
const RE_CFG_BLOB = /[{[]/;
// Năm module này đều đã có chỗ riêng (tab HTTP, nhóm lỗi Grafana, hành trình tracker; còn MQTT và
// NOTIFICATION là bản tin đẩy xuống chứ không phải cấu hình) — để chúng vào đây chỉ làm loãng.
const RE_CFG_SKIP_MODULE = /^(HTTP|Grafana|MoMoTracker|MQTT|NOTIFICATION)/;

function cfgHit(source, key, value, note) {
  const trimmed = String(key).trim();
  if (!trimmed) return null;
  return { source, key: trimmed.slice(0, 90), value: String(value).trim(), note: note || '' };
}

// Cắt đuôi url lấy tên file, vì chính tên file mới là "khoá" của cấu hình đó.
function cdnConfigName(url) {
  const clean = url.split('?')[0].replace(/\/+$/, '');
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  return name || clean;
}

function matchConfigSpecific(message) {
  const abTag = RE_CFG_AB_TAG.exec(message);
  if (abTag) {
    const flow = RE_CFG_AB_FLOW.exec(message);
    const expName = abTag[3].trim();
    const note = (expName ? 'exp ' + expName : 'không nằm trong thí nghiệm') +
      (flow ? ' · nhánh mặc định ' + flow[1] : '');
    return cfgHit('ab', abTag[1], abTag[4], note);
  }
  const abAuth = RE_CFG_AB_AUTH.exec(message);
  if (abAuth) return cfgHit('ab', abAuth[1], abAuth[2], '');
  const abFull = RE_CFG_AB_FULLSCREEN.exec(message);
  if (abFull) return cfgHit('ab', abFull[2], abFull[1], '');

  const persist = RE_CFG_PERSIST.exec(message);
  if (persist) return cfgHit('be', persist[2], persist[3], persist[1]);

  const webadmin = RE_CFG_WEBADMIN.exec(message);
  if (webadmin) return cfgHit('wa', webadmin[1], webadmin[2] || '(rỗng)', '');

  const cdn = RE_CFG_CDN.exec(message);
  if (cdn) return cfgHit('cdn', cdnConfigName(cdn[1]), cdn[1], '');

  const dynaKeys = RE_CFG_DYNA_KEYS.exec(message);
  if (dynaKeys) return cfgHit('be', 'DynamicConfig ' + dynaKeys[1], dynaKeys[2] + ' khóa', '');
  const dynaBody = RE_CFG_DYNA_BODY.exec(message);
  if (dynaBody) return cfgHit('be', 'DynamicConfig responseBody', dynaBody[1], '');

  const featureConf = RE_CFG_FEATURE_CONF.exec(message);
  if (featureConf) return cfgHit('wa', 'AppFeatureUpdater', featureConf[1], '');
  const omega = RE_CFG_OMEGA.exec(message);
  if (omega) {
    const codes = omega[1].split(/\s+-\s+/).filter((part) => part.trim());
    return cfgHit('wa', 'OMEGA feature testings', omega[1], codes.length + ' feature');
  }

  const sentry = RE_CFG_SENTRY_KMP.exec(message);
  if (sentry) return cfgHit('app', 'SentryKMP ' + sentry[1], sentry[2], '');
  const spam = RE_CFG_SPAM.exec(message);
  if (spam) return cfgHit('app', spam[1], spam[2], '');
  const authBg = RE_CFG_AUTH_BG.exec(message);
  if (authBg) return cfgHit('be', authBg[1], authBg[2], '');

  const dataClass = RE_CFG_DATA_CLASS.exec(message);
  if (dataClass) {
    const head = message.slice(0, dataClass.index);
    return cfgHit(RE_CFG_FROM_BE.test(head) ? 'be' : 'oth', dataClass[1], dataClass[2], '');
  }
  return null;
}

// Lưới vét cuối cùng, cố ý hẹp: chữ "config" phải nằm TRƯỚC khối JSON. Nhờ vậy dòng payload khuyến mãi
// dài 5000 ký tự (mở đầu bằng "{", chữ displayConfig nằm sau đó) không bị kéo vào đây.
function matchConfigGeneric(message) {
  const blob = message.search(RE_CFG_BLOB);
  if (blob < 0) return null;
  const head = message.slice(0, blob);
  if (!RE_CFG_WORD.test(head)) return null;
  const value = message.slice(blob);
  if (value.length < 20) return null;
  const key = head.replace(/[\s:=>|-]+$/, '');
  const source = RE_CFG_FROM_BE.test(head) ? 'be' : 'oth';
  return cfgHit(source, key, value, '');
}

function matchConfigLine(entry) {
  if (!entry.message || entry.kind !== 'log') return null;
  if (RE_CFG_SKIP_MODULE.test(entry.module || '')) return null;
  return matchConfigSpecific(entry.message) || matchConfigGeneric(entry.message);
}

function buildConfigs(entries, httpCalls) {
  const groups = new Map();
  let lineCount = 0;
  entries.forEach((entry) => {
    const hit = matchConfigLine(entry);
    if (!hit) return;
    lineCount += 1;
    const id = hit.source + ' ' + hit.key;
    let group = groups.get(id);
    if (!group) {
      group = { key: hit.key, source: hit.source, note: hit.note, count: 0, values: [], indices: [] };
      groups.set(id, group);
    }
    group.count += 1;
    group.indices.push(entry.domIndex);
    if (hit.note && !group.note) group.note = hit.note;
    // Chỉ ghi khi giá trị KHÁC lần trước. Nhờ vậy values.length > 1 có đúng một nghĩa:
    // cấu hình này đổi giữa chừng phiên — thứ đáng để ý nhất khi "phá án".
    // Nhưng vẫn phải gom ĐỦ chỉ số dòng của mọi giá trị: một khoá ghi 4 lần cùng một giá trị thì
    // vẫn là 4 dòng log có thật, phải duyệt được cả bốn chứ không chỉ nhảy tới dòng đầu.
    const last = group.values[group.values.length - 1];
    if (last && last.value === hit.value) {
      last.indices.push(entry.domIndex);
      return;
    }
    group.values.push({
      value: hit.value,
      indices: [entry.domIndex],
      domIndex: entry.domIndex,
      lineNo: entry.lineNo,
      time: entry.time,
      // Xét trên GIÁ TRỊ chứ không phải cả dòng: dòng log nào cũng có "[Module: X]" nên đo trên
      // entry.raw thì hàng nào cũng mọc ra nút JSON, bấm vào lại chẳng có JSON nào.
      hasJson: RE_CFG_BLOB.test(hit.value),
    });
  });

  const items = Array.from(groups.values());
  items.forEach((item) => {
    item.changed = item.values.length > 1;
    item.latest = item.values[item.values.length - 1];
  });
  items.sort((a, b) => {
    if (a.changed !== b.changed) return a.changed ? -1 : 1;
    const order = CONFIG_SOURCE_ORDER.indexOf(a.source) - CONFIG_SOURCE_ORDER.indexOf(b.source);
    if (order) return order;
    return a.key.localeCompare(b.key);
  });

  const bySource = {};
  CONFIG_SOURCE_ORDER.forEach((source) => {
    bySource[source] = items.filter((item) => item.source === source);
  });
  // Call BE có chữ "config" trên đường dẫn: chính nó là chỗ app đi XIN cấu hình. Các dòng này nằm ở
  // module HTTP nên bị loại khỏi vòng quét bên trên; kéo riêng ra đây để tab trả lời được cả câu
  // "app xin cấu hình gì từ BE" chứ không chỉ "app nhận được gì".
  const calls = (httpCalls || []).filter((call) => RE_CFG_URL.test(call.path || ''));
  return {
    items,
    bySource,
    calls,
    total: items.length,
    lineCount,
    changedCount: items.filter((item) => item.changed).length,
    hasAny: items.length > 0 || calls.length > 0,
  };
}
// @ts-check
// phát hiện một khối dòng bị lặp lại nguyên xi trong log
//
// Vì sao cần: một log feedback production thật (autoId 45490371) dài 4222 dòng hoá ra là 2111 dòng đầu
// LẶP LẠI Y HỆT — md5 hai nửa bằng nhau, chỗ nối nằm ngay sau một dòng "LOGGER: END OF BATCH". Tool
// không biết chuyện đó nên đếm gấp đôi MỌI THỨ: mọi nhóm lỗi, mọi call HTTP, mọi event tracker. Đọc
// "lỗi này xảy ra 4 lần" trong khi thật ra 2 lần là đọc sai hẳn vấn đề.
//
// Cách tìm: mỗi dòng trùng nhau sinh ra một "phiếu" cho độ lệch giữa hai lần xuất hiện. Log bị nối đôi
// sẽ dồn gần hết phiếu vào ĐÚNG MỘT độ lệch (2111). Sau đó xác minh bằng cách đếm chuỗi liên tiếp
// dài nhất khớp theo độ lệch đó — trùng ngẫu nhiên vài dòng lẻ tẻ thì không tạo được chuỗi dài.
//
// Cố ý KHÔNG tự động bỏ khối lặp: báo trước, để người đọc bấm. Khử nhầm một khối không lặp thì số liệu
// cũng sai, chỉ là sai theo hướng khác — mà lúc đó không còn dấu hiệu nào để nhận ra.

// Dưới ngưỡng này coi như trùng ngẫu nhiên: log sạch nhất trong ba log thật có chuỗi lặp dài nhất
// 8 dòng (các dòng định kỳ như heartbeat, "END OF BATCH"). 40 là cách xa ngưỡng đó.
const DUPLICATE_MIN_RUN = 40;
// Dòng quá ngắn (dấu phân cách, dòng trống) trùng nhau là chuyện bình thường, không tính phiếu.
const DUPLICATE_MIN_LINE = 24;

// Chỉ dòng CÓ GIỜ RIÊNG mới được bỏ phiếu và mới được tính là khớp.
//
// Log bị nối đôi là file bị ghép với chính nó: những dòng lặp lại mang theo cả timestamp y hệt — đó
// chính là định nghĩa của cái artefact này (md5 hai nửa bằng nhau). Còn một khối JSON in đẹp thì mọi
// dòng bên trong KHÔNG có giờ riêng, và app hoàn toàn có thể in cùng một khối config hai lần (fetch
// lại) — đó là nội dung lặp, không phải file lặp.
//
// Đo trên log dựng lại đúng hình đó (một khối config 300 dòng được log hai lần, cách nhau 30 dòng):
// bản cũ báo "khối lặp 301 dòng, 91 dòng khớp" — một cảnh báo sai nói rằng mọi con số đang bị đếm
// gấp đôi. Lọc theo `ts` thì khối JSON không còn phiếu nào, trong khi log nối đôi thật vẫn phát hiện
// được (274 dòng khớp trước khi sửa, 91 sau khi sửa — vẫn gấp đôi ngưỡng 40).
//
// Dòng không có giờ vẫn TRUNG TÍNH chứ không cắt đứt chuỗi, cùng lý do với dòng ngắn: khối lặp 2111
// dòng của log production có dòng trống xen vào, coi chúng là cắt đứt thì chỉ nhận ra được 491 dòng.
function isDuplicateCandidate(entry) {
  return !!(entry && entry.ts && entry.raw && entry.raw.length >= DUPLICATE_MIN_LINE);
}

function tallyDuplicateOffsets(entries) {
  const firstSeen = new Map();
  const offsets = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    if (!isDuplicateCandidate(entries[index])) continue;
    const raw = entries[index].raw;
    const first = firstSeen.get(raw);
    if (first === undefined) {
      firstSeen.set(raw, index);
      continue;
    }
    const offset = index - first;
    offsets.set(offset, (offsets.get(offset) || 0) + 1);
  }
  return offsets;
}

// Độ lệch được nhiều phiếu nhất mới là ứng viên; còn lại là trùng lẻ tẻ.
function bestDuplicateOffset(offsets) {
  let best = 0;
  let bestVotes = 0;
  offsets.forEach((votes, offset) => {
    if (votes > bestVotes) {
      bestVotes = votes;
      best = offset;
    }
  });
  return { offset: best, votes: bestVotes };
}

// Chuỗi liên tiếp dài nhất mà entries[i] giống hệt entries[i - offset].
//
// Dòng ngắn (dòng trống, dòng phân cách) là TRUNG TÍNH: không tính là khớp, nhưng cũng không cắt đứt
// chuỗi. Đo thật: coi chúng là cắt đứt thì khối lặp 2111 dòng của log production chỉ nhận ra được 491
// dòng, vì cứ vài chục dòng lại có một dòng trống xen vào.
function longestRunAtOffset(entries, offset) {
  let runStart = -1;
  let runCount = 0;
  let best = { count: 0, start: -1, end: -1 };
  for (let index = offset; index < entries.length; index += 1) {
    if (!isDuplicateCandidate(entries[index])) continue;
    const raw = entries[index].raw;
    if (raw !== entries[index - offset].raw) {
      runStart = -1;
      runCount = 0;
      continue;
    }
    if (runStart < 0) runStart = index;
    runCount += 1;
    if (runCount > best.count) best = { count: runCount, start: runStart, end: index };
  }
  return best;
}

function findDuplicateBlock(entries) {
  if (!entries || entries.length < DUPLICATE_MIN_RUN * 2) return null;
  const { offset, votes } = bestDuplicateOffset(tallyDuplicateOffsets(entries));
  if (!offset || votes < DUPLICATE_MIN_RUN) return null;
  const run = longestRunAtOffset(entries, offset);
  if (run.count < DUPLICATE_MIN_RUN) return null;
  const from = run.start;
  const to = run.end;
  return {
    offset,
    from,
    to,
    // length = cả đoạn bị lặp (kể cả dòng trống và dòng JSON xen giữa); matched = số dòng CÓ GIỜ khớp
    // từng ký tự — chỉ dòng có giờ mới được tính, xem isDuplicateCandidate.
    length: to - from + 1,
    matched: run.count,
    lineFrom: entries[from].lineNo,
    lineTo: entries[to].lineNo,
    sourceLineFrom: entries[from - offset].lineNo,
  };
}

// Đánh dấu trên từng entry để bộ lọc và thống kê đọc được. Trả về chính thông tin khối để gắn vào data.
function markDuplicateEntries(entries) {
  const block = findDuplicateBlock(entries);
  if (!block) return null;
  for (let index = block.from; index <= block.to; index += 1) entries[index].isDuplicate = true;
  return block;
}
// @ts-check
// đọc "máy này là máy gì, chạy bản nào, nối vào đâu, xài miniapp version bao nhiêu" từ dòng request HTTP
//
// Vì sao lấy từ dòng HTTP chứ không từ module DeviceProfileManager: đếm trên ba log thật,
// DeviceProfileManager có 27 / 9 / 0 dòng — bằng 0 trên log production. Còn header thì có
// 52 / 66 / 94 lần. Đây là nguồn duy nhất trả lời được câu "máy gì, bản nào" trên log production.
//
// Một dòng RequestPayload mang HAI map đáng đọc, viết theo hai kiểu tên khác nhau:
//   --body:   {"appCode":"5.13.1","appId":"vn.momo.myvoucher","appVer":51310,"buildNumber":0,
//              "channel":"APP","lang":"vi","deviceName":"Redmi Note 11","deviceOS":"android"}
//   --header: {"deviceid":"6665…4e84b","device-name":"Oppo CPH2083","device-ip":"42.118.185.199",
//              "map_appId":"vn.momo.cvs_fund","map_miniAppVersion":"694","device_os":"ANDROID",
//              "app_version":"51500","app_code":"5.15.0","agent_id":"73217397","env":"production",
//              "M-Timezone":"Asia/Ho_Chi_Minh","User-Agent":"momotransfer/5.15.0.51500 Dalvik/2.1.0 …"}
//
// Bốn điều đã học khi viết phần này:
//
// 1. KHÔNG JSON.parse được map đó. Header bị làm mờ để lại giá trị trần không có khoá
//    (`"agent_id":"73217397","****","****","sessionKey":…`) — JSON.parse ném lỗi ngay. Quét từng cặp
//    "khoá":"giá trị" thì mấy token trần đó tự bị bỏ qua.
// 2. Danh sách khoá là DANH SÁCH TRẮNG, cố ý không phải "đọc hết rồi lọc thứ nhạy cảm". Cùng map đó
//    còn có authorization, cvs-token, sessionKey, M-Signature — bỏ sót một cái tên trong danh sách đen
//    là đưa token lên panel và vào ticket.
// 3. Không chỉ có iOS. Bản cũ chỉ khớp User-Agent kiểu iOS (MoMoPlatform … CFNetwork … Darwin), nên
//    trên log Android nó bỏ trống cả tên máy lẫn phiên bản app — đo trên đúng một dòng log Android
//    thật: chỉ ra được device_os / device_performance / lang, mất device-name, app_code, app_version.
// 4. Header KHÔNG phải lúc nào cũng có tên máy, mà body thì có. Đo trên log production 9609 dòng
//    (autoId=5956756): `device-name` trong header **0 dòng**, `deviceName` trong body **153 dòng**,
//    tất cả cùng một giá trị "Redmi Note 11". Không đọc body thì panel chỉ ghi được mã máy moi từ
//    User-Agent — "2201117TG", đúng nhưng không ai đọc ra đó là Redmi Note 11.

const ENV_HEADER_KEYS = ['deviceid', 'device-name', 'device-ip', 'device_os', 'device_performance',
  'app_code', 'app_version', 'agent_id', 'lang', 'M-Lang', 'M-Timezone', 'channel', 'env', 'app_type',
  'map_appId', 'map_miniAppVersion', 'map_screen_name', 'User-Agent'];

// Body gọi cùng một thứ bằng tên khác, nên phải quy về một tên chung — nếu không thì hai nguồn nói
// về cùng một sự thật lại nằm ở hai khoá và không bao giờ gặp nhau.
const ENV_BODY_KEY_MAP = new Map([
  ['deviceName', 'device-name'],
  ['deviceOS', 'device_os'],
  ['devicePerformance', 'device_performance'],
  ['appCode', 'app_code'],
  ['appVer', 'app_version'],
  ['lang', 'lang'],
  ['channel', 'channel'],
]);
// Cố ý KHÔNG lấy từ body, cả bốn đều đo trên chính log trên:
//   appId             id của MINIAPP đang gọi (vn.momo.helpcenter, vn.momo.myvoucher, …) chứ không
//                     phải app mẹ — 7 giá trị khác nhau trong khi app_code chỉ có 2. Lấy nhầm thì
//                     dòng "Bản app" ghi tên một miniapp.
//   deviceNameSetting tên do chính người dùng đặt cho máy, hoàn toàn có thể là tên thật của họ.
//                     Mục này đi thẳng vào ticket, nên cùng luật với danh sách trắng của header.
//   DEVICE_IMEI / SECUREID / MODELID / DEVICE_TOKEN / checkSum  định danh máy và chữ ký.
//   buildNumber       bằng 0 ở cả 146/146 dòng, không nói lên gì.

// Chấp nhận cả giá trị trần: header viết "app_version":"51310" (có nháy) còn body viết "appVer":51310.
const RE_ENV_PAIR = /"([A-Za-z0-9_.\-]{1,40})"\s*:\s*(?:"([^"]*)"|(-?\d+(?:\.\d+)?))/g;
// iOS: MoMoPlatform UAT/5.15.0.51500 CFNetwork/1410.1 Darwin/22.6.0 (iPhone 8 Plus iOS/16.7.16)
const RE_ENV_UA = /MoMoPlatform\s*([A-Za-z]*)\s*\/?([\d.]+)\s+CFNetwork\/([\d.]+)\s+Darwin\/([\d.]+)\s+\(([^)]*)\)/;
const RE_ENV_DEVICE = /^(.*?)\s+iOS\/([\d.]+)$/;
// Android: momotransfer/5.15.0.51500 Dalvik/2.1.0 (Linux; U; Android 9; CPH2083 Build/PPR1.180610.011)
const RE_ENV_ANDROID = /\bAndroid\s+([\d.]+)/;
const RE_ENV_ANDROID_MODEL = /;\s*([^;()]{2,40}?)\s+Build\//;
const RE_ENV_PERF = /device_performance[=:"\s]+([a-z-]{3,20})/;
const RE_ENV_OS = /device_os[=:"\s]+([A-Za-z0-9._ ]{2,30})/;
// Ký tự đóng phải gồm cả "}": trên log thật lang nằm giữa map nên sau nó là dấu phẩy, nhưng khi nó là
// trường CUỐI của map thì sau nó là dấu đóng ngoặc.
const RE_ENV_LANG = /[",\s]lang[=:"\s]+([a-z]{2,5})[",\s}]/;
// Dấu hiệu KHÔNG phải production trên hostname. Không làm danh sách host production: danh sách đó sẽ
// cứ phải cập nhật, còn dấu hiệu uat/dev/staging thì ổn định hơn nhiều.
const RE_ENV_NONPROD_HOST = /(^|[.\-/])(uat|dev|staging|test|sandbox)([.\-:/]|$)/i;
// Tìm DẤU HIỆU không-production, không phải "khác chữ production". Bản production trên App Store ghi
// flavor là "Store" — coi mọi thứ khác chữ "production" là đáng ngờ thì log thật nào cũng bị cảnh báo
// nhầm. Đã dính đúng lỗi đó khi test trên trang admin thật.
const RE_ENV_NONPROD_BUILD = /^(uat|staging|dev|test|sandbox|alpha|beta|debug)$/i;

function envFirst(entries, re, group) {
  for (let i = 0; i < entries.length; i += 1) {
    const raw = entries[i].raw;
    if (!raw) continue;
    const hit = re.exec(raw);
    // group == null chứ không phải "group || 1": gọi với group = 0 (lấy cả chuỗi khớp) thì 0 là falsy,
    // "0 || 1" ra 1 và hàm trả về nhóm thứ nhất. Đã dính đúng bẫy này.
    if (hit) return hit[group == null ? 1 : group];
  }
  return '';
}

// Tên máy + phiên bản iOS nằm chung trong ngoặc: "iPhone 8 Plus iOS/16.7.16".
function parseEnvDevice(inside) {
  const hit = RE_ENV_DEVICE.exec(inside || '');
  if (!hit) return { device: inside || '', osVersion: '' };
  return { device: hit[1].trim(), osVersion: hit[2] };
}

// Khối JSON phải nằm NGAY sau nhãn. Dòng "--body: null --encryptedBody:  --header: {…}" có thật —
// đo trên log trên: 20/291 dòng có body là null. Đi tìm dấu { đầu tiên kể từ nhãn --body thì vớ luôn
// map header của chính dòng đó, tức là đọc một nguồn rồi ghi vào tên của nguồn kia.
function envJsonAfter(raw, marker) {
  const at = raw.indexOf(marker);
  if (at < 0) return null;
  const block = extractJsonBlock(raw.slice(at + marker.length));
  return block && block.start <= 1 ? block.text : null;
}

function envHeaderKey(key) {
  return ENV_HEADER_KEYS.indexOf(key) >= 0 ? key : '';
}

function envBodyKey(key) {
  return ENV_BODY_KEY_MAP.get(key) || '';
}

// Map của MỘT dòng, chỉ giữ khoá mà resolveKey nhận — và trả về dưới tên chung.
function parseEnvMap(raw, marker, resolveKey) {
  const text = envJsonAfter(raw, marker);
  if (!text) return null;
  const map = Object.create(null);
  let count = 0;
  RE_ENV_PAIR.lastIndex = 0;
  let hit = RE_ENV_PAIR.exec(text);
  while (hit) {
    const name = resolveKey(hit[1]);
    const value = (hit[2] != null ? hit[2] : hit[3] || '').trim();
    if (name && value) {
      map[name] = value;
      count += 1;
    }
    hit = RE_ENV_PAIR.exec(text);
  }
  return count ? map : null;
}

// Nhớ luôn DÒNG NÀO đã cho ra giá trị này: có vậy thì rê chuột lên một giá trị mới chỉ được ra nó
// xuất hiện lúc nào trên minimap, và bấm vào mới duyệt được đúng những dòng đó. Lưu thẳng chỉ số chứ
// không quét lại lúc hover: hover bắn liên tục, mà quét lại là đi qua cả vạn dòng mỗi lần.
function envBump(tally, key, value, index) {
  let byValue = tally.get(key);
  if (!byValue) {
    byValue = new Map();
    tally.set(key, byValue);
  }
  let seen = byValue.get(value);
  if (!seen) {
    seen = { count: 0, indices: [] };
    byValue.set(value, seen);
  }
  seen.count += 1;
  seen.indices.push(index);
}

// Một lượt quét duy nhất qua các dòng request. Sàng bằng indexOf trước: dòng payload dài mà chạy
// regex lên tất cả thì riêng mục này ăn hết phần lớn thời gian khởi động. Body chỉ đọc trên dòng
// RequestPayload — dòng ResponsePayload cũng có "--body:" nhưng không khai máy, đọc nó là mất công
// bóc một khối JSON to cho mỗi call.
function collectEnvHeaders(entries) {
  const tally = new Map();
  const bodyTally = new Map();
  const miniApps = new Map();
  let lineCount = 0;
  let bodyLineCount = 0;
  entries.forEach((entry) => {
    const raw = entry.raw;
    if (!raw) return;
    if (raw.indexOf('--header:') >= 0) {
      const map = parseEnvMap(raw, '--header:', envHeaderKey);
      if (map) {
        lineCount += 1;
        Object.keys(map).forEach((key) => envBump(tally, key, map[key], entry.domIndex));
        // Cặp (miniapp, version) phải đọc TRONG CÙNG một dòng: gom riêng hai danh sách rồi ghép lại là
        // gán nhầm version của miniapp này cho miniapp kia.
        if (map.map_appId && map.map_miniAppVersion) {
          let versions = miniApps.get(map.map_appId);
          if (!versions) {
            versions = new Map();
            miniApps.set(map.map_appId, versions);
          }
          let seen = versions.get(map.map_miniAppVersion);
          if (!seen) {
            seen = { count: 0, indices: [] };
            versions.set(map.map_miniAppVersion, seen);
          }
          seen.count += 1;
          seen.indices.push(entry.domIndex);
        }
      }
    }
    if (raw.indexOf('--body:') >= 0 && raw.indexOf('RequestPayload') >= 0) {
      const map = parseEnvMap(raw, '--body:', envBodyKey);
      if (map) {
        bodyLineCount += 1;
        Object.keys(map).forEach((key) => envBump(bodyTally, key, map[key], entry.domIndex));
      }
    }
  });
  return { tally, bodyTally, miniApps, lineCount, bodyLineCount };
}

// Mọi giá trị của một khoá, nhiều lần nhất đứng trước. Trả về danh sách chứ không trả về một giá trị:
// nhiều deviceid hay nhiều IP trong cùng một log là thứ đáng nhìn thấy, không phải thứ để chọn đại
// lấy cái đầu (IP đổi = đổi mạng giữa chừng; deviceid đổi thì log đã bị trộn từ hai máy).
function envValues(tally, key) {
  const byValue = tally.get(key);
  if (!byValue) return [];
  return Array.from(byValue, (pair) => ({ value: pair[0], count: pair[1].count, indices: pair[1].indices }))
    .sort((a, b) => b.count - a.count);
}

// Header đi trước, body chỉ ĐIỀN VÀO CHỖ TRỐNG — cố ý không cộng dồn hai bên: một dòng request mang
// cả body lẫn header, gộp lại là mỗi lần xuất hiện bị đếm hai lượt mà số lần đó có hiện ra trên panel.
// Cộng dồn còn xẻ một sự thật thành hai giá trị khi hai bên viết khác kiểu chữ (header "ANDROID",
// body "android").
function envPick(headers, key) {
  const fromHeader = envValues(headers.tally, key);
  return fromHeader.length ? fromHeader : envValues(headers.bodyTally, key);
}

function envTop(headers, key) {
  const list = envPick(headers, key);
  return list.length ? list[0].value : '';
}

// Nhãn hệ điều hành dựng từ MỘT chuỗi User-Agent. Tách riêng vì còn phải chạy lên cả danh sách UA:
// log phủ cả tuần thì người dùng hoàn toàn có thể lên đời hệ điều hành giữa chừng.
function osLabelFromUa(ua) {
  const parsed = RE_ENV_UA.exec(ua || '');
  const ios = parseEnvDevice(parsed ? parsed[5] : '');
  if (ios.osVersion) return 'iOS ' + ios.osVersion;
  const android = RE_ENV_ANDROID.exec(ua || '');
  return android ? 'Android ' + android[1] : '';
}

// Gộp danh sách User-Agent lại theo nhãn hệ điều hành: cùng một Android 13 nhưng khác AgentID thì UA
// là hai chuỗi khác nhau — đo trên log thật có 8 chuỗi UA mà chỉ một hệ điều hành.
function envOsLabels(uaValues) {
  const byLabel = new Map();
  uaValues.forEach((item) => {
    const label = osLabelFromUa(item.value);
    if (!label) return;
    let seen = byLabel.get(label);
    if (!seen) {
      seen = { count: 0, indices: [] };
      byLabel.set(label, seen);
    }
    seen.count += item.count;
    // Gộp chỉ số của mọi chuỗi UA cùng nhãn, giữ đúng thứ tự dòng để vạch trên minimap không nhảy cóc.
    seen.indices = seen.indices.concat(item.indices);
  });
  return Array.from(byLabel, (pair) => ({ value: pair[0], count: pair[1].count,
    indices: pair[1].indices.slice().sort((a, b) => a - b) }))
    .sort((a, b) => b.count - a.count);
}

// Những trường ĐÁNG LẼ không đổi trong suốt một log. Đổi là có chuyện đáng kể ra, nên mỗi trường ở đây
// đều đi kèm câu nói rõ "đổi thì nghĩa là gì" — một danh sách trần không gắn với câu hỏi nào thì người
// đọc chỉ thấy hai dòng chữ mà không biết nên nghĩ gì.
//
// Cố ý KHÔNG đưa vào đây: map_screen_name (đổi theo từng request, đó là bản chất của nó, không phải
// "thay đổi"), map_appId / map_miniAppVersion (đã có mục MiniApp riêng, và nhiều miniapp là bình
// thường), User-Agent thô (8 chuỗi khác nhau trên log thật mà chỉ khác đuôi AgentID).
const ENV_WATCHED_FIELDS = [
  { key: 'device-name', label: 'Tên máy',
    tip: 'Hai tên máy trong cùng một log nghĩa là log đã bị trộn từ hai máy — mọi con số phía trên đang cộng của cả hai.' },
  { key: 'osLabel', label: 'Hệ điều hành',
    tip: 'Hệ điều hành lên đời giữa log. Lỗi chỉ xuất hiện ở một bên là một manh mối.' },
  { key: 'device_performance', label: 'Đời máy', scan: RE_ENV_PERF,
    tip: 'Đời máy đổi thì không còn là một máy nữa — cùng loại với việc đổi deviceid.' },
  { key: 'app_code', label: 'Bản app',
    tip: 'Người dùng nâng cấp app giữa log — mọi con số phía trên đang trộn hai bản.' },
  { key: 'lang', label: 'Ngôn ngữ', alt: ['M-Lang'], scan: RE_ENV_LANG,
    tip: 'Người dùng đổi ngôn ngữ app giữa chừng. Chữ trên màn và cả nội dung BE trả về đều đổi theo.' },
  { key: 'M-Timezone', label: 'Múi giờ',
    tip: 'Múi giờ đổi: người dùng đi vùng khác, tự sửa giờ máy, hoặc máy vừa đồng bộ lại giờ. Mọi mốc thời gian trong log đọc theo múi giờ này.' },
  { key: 'channel', label: 'Kênh',
    tip: 'Kênh gọi request đổi giữa chừng.' },
  { key: 'env', label: 'Môi trường', alt: ['app_type'],
    tip: 'Môi trường đổi giữa log (production ↔ uat) — app không được phép làm vậy trong một lần chạy.' },
  { key: 'agent_id', label: 'Agent ID',
    tip: 'Nhiều agent_id: người dùng đăng nhập tài khoản khác, hoặc log gộp nhiều người.' },
  { key: 'deviceid', label: 'Device ID',
    tip: 'deviceid đổi nghĩa là log đã bị trộn từ hai máy.' },
  { key: 'device-ip', label: 'IP',
    tip: 'IP đổi giữa chừng = đổi mạng (wifi sang 4G, hoặc đổi wifi).' },
];

function buildEnvironment(entries, httpCalls) {
  const headers = collectEnvHeaders(entries);

  const ua = envTop(headers, 'User-Agent') || envFirst(entries, RE_ENV_UA, 0);
  const parsed = ua ? RE_ENV_UA.exec(ua) : null;
  const iosDevice = parseEnvDevice(parsed ? parsed[5] : '');
  const androidModel = ua ? RE_ENV_ANDROID_MODEL.exec(ua) : null;

  const hosts = new Map();
  (httpCalls || []).forEach((call) => {
    if (!call.host) return;
    hosts.set(call.host, (hosts.get(call.host) || 0) + 1);
  });
  const nonProdHosts = Array.from(hosts.keys()).filter((host) => RE_ENV_NONPROD_HOST.test(host));

  const flavor = parsed ? parsed[1] : '';
  const deviceOs = envTop(headers, 'device_os') || envFirst(entries, RE_ENV_OS);
  // Nhãn hệ điều hành do đây dựng, không để renderer tự ghép chữ "iOS": ghép cứng ở đó thì log Android
  // hiện ra "iOS 9". Không đoán được phiên bản thì chỉ ghi tên hệ điều hành.
  const osLabels = envOsLabels(envPick(headers, 'User-Agent'));
  const osLabel = osLabelFromUa(ua) || (osLabels.length ? osLabels[0].value : '');

  // Hai cái tên của cùng một cái máy: tên người đọc được ("Redmi Note 11") và mã máy trong
  // User-Agent ("2201117TG"). Giữ cả hai — tên để người đọc nhận ra, mã để tra cứu và để so với
  // những log khác. Chỉ giữ mã riêng khi tên CHƯA CHỨA nó: có log ghi device-name là "Oppo CPH2083"
  // còn User-Agent ghi "CPH2083", hiện cả hai thì ra "Oppo CPH2083 (CPH2083)".
  const uaModel = iosDevice.device || (androidModel ? androidModel[1] : '');
  const namedDevice = envTop(headers, 'device-name');
  const modelIsNew = !!uaModel && namedDevice.toLowerCase().indexOf(uaModel.toLowerCase()) < 0;
  const appVersions = envPick(headers, 'app_code');

  const miniApps = Array.from(headers.miniApps, (pair) => ({
    appId: pair[0],
    versions: Array.from(pair[1], (item) => ({ value: item[0], count: item[1].count }))
      .sort((a, b) => b.count - a.count),
    indices: Array.from(pair[1].values()).reduce((all, item) => all.concat(item.indices), [])
      .sort((a, b) => a - b),
    count: Array.from(pair[1].values()).reduce((sum, item) => sum + item.count, 0),
    bundles: [],
  }));
  // Bản build của bundle đi kèm luôn vào từng miniapp: header chỉ khai version tại lúc gọi request,
  // còn đường đi giữa các bản thì chỉ dòng nạp bundle mới nói ra (xem 02l).
  buildMiniAppBundles(entries).forEach((list, appId) => {
    const found = miniApps.find((app) => app.appId === appId);
    if (found) found.bundles = list;
    // Miniapp đã nạp bundle mà chưa gọi request nào thì vẫn là một miniapp đã chạy — bỏ qua là mất
    // hẳn nó khỏi mục này.
    else miniApps.push({ appId, versions: [], indices: [], count: 0, bundles: list });
  });
  const miniAppWeight = (app) => app.count + app.bundles.reduce((sum, item) => sum + item.count, 0);
  miniApps.sort((a, b) => miniAppWeight(b) - miniAppWeight(a));

  // Mỗi trường đáng theo dõi kèm mọi giá trị của nó. Renderer chỉ cần một luật: đúng một giá trị thì
  // để trong bảng, từ hai trở lên thì tách thành danh sách — không phải nhớ tên từng trường nữa.
  // `alt` và `scan` là những đường dự phòng vốn có của từng trường, đừng bỏ khi gom về một cơ chế:
  // không có header thì `lang` còn đọc được từ chữ trong dòng log, `env` còn có `app_type`.
  const watchedValues = (field) => {
    if (field.key === 'osLabel') return osLabels;
    let values = envPick(headers, field.key);
    (field.alt || []).forEach((key) => {
      if (!values.length) values = envPick(headers, key);
    });
    if (!values.length && field.scan) {
      const hit = envFirst(entries, field.scan);
      // Đường quét bằng regex chỉ trả về giá trị ĐẦU TIÊN gặp, nên không đếm được số lần — và cũng
      // không dùng để nói "đổi giữa chừng", nó luôn là một giá trị.
      if (hit) values = [{ value: hit, count: 1, indices: [] }];
    }
    return values;
  };
  const watched = ENV_WATCHED_FIELDS
    .map((field) => Object.assign({}, field, { values: watchedValues(field) }))
    .filter((field) => field.values.length);

  return {
    watched,
    // Những trường đổi giữa chừng, để ticket nói ra được mà không phải kể lại cả bảng.
    changed: watched.filter((field) => field.values.length > 1),
    // Rỗng hết thì tab không vẽ mục này — log production cắt giữa chừng có thể không có request nào.
    // watched.length cũng tính: log không có request HTTP nào vẫn có thể khai máy trong chữ của chính
    // dòng log (DeviceProfileManager), và mấy đường quét dự phòng sinh ra là để đọc đúng ca đó.
    available: !!(parsed || hosts.size || headers.lineCount || headers.bodyLineCount || watched.length),
    flavor,
    appVersion: (parsed ? parsed[2] : '') || envTop(headers, 'app_code'),
    appVersions,
    appBuild: envTop(headers, 'app_version'),
    cfNetwork: parsed ? parsed[3] : '',
    darwin: parsed ? parsed[4] : '',
    device: namedDevice || uaModel,
    deviceModel: namedDevice && modelIsNew ? uaModel : '',
    osVersion: iosDevice.osVersion,
    osLabel,
    deviceOs,
    performance: envTop(headers, 'device_performance') || envFirst(entries, RE_ENV_PERF),
    lang: envTop(headers, 'lang') || envTop(headers, 'M-Lang') || envFirst(entries, RE_ENV_LANG),
    timezone: envTop(headers, 'M-Timezone'),
    channel: envTop(headers, 'channel'),
    envName: envTop(headers, 'env') || envTop(headers, 'app_type'),
    deviceIds: envPick(headers, 'deviceid'),
    ips: envPick(headers, 'device-ip'),
    agentIds: envPick(headers, 'agent_id'),
    miniApps,
    headerLineCount: headers.lineCount,
    bodyLineCount: headers.bodyLineCount,
    hostCount: hosts.size,
    nonProdHosts,
    // Bản Staging/UAT mà lại gọi toàn host không có dấu hiệu uat/dev — gặp thật trên một log. Chỉ NÓI
    // RA sự thật quan sát được, không kết luận "log này là prod hay không": bản build và host là hai
    // chuyện khác nhau, và danh sách host ở đây chỉ gồm những host có request trong log.
    mixedBuild: RE_ENV_NONPROD_BUILD.test(flavor) && hosts.size > 0 && nonProdHosts.length === 0,
  };
}
// @ts-check
// dựng một khối markdown ~25 dòng để dán thẳng vào ticket
//
// Bước trống nhất trong quy trình của dev: đọc log xong vẫn phải gõ tay lại vào ticket. "Copy dòng đang
// hiện" cho ra vài nghìn dòng thô — không ai dán được, mà lại kèm nguyên số điện thoại và token trong
// payload.
//
// LUẬT CỦA KHỐI NÀY: chỉ liệt kê SỰ KIỆN CÓ GIỜ, tuyệt đối không có câu "nguyên nhân là X". Xếp hạng
// nguyên nhân là suy đoán, mà cái này sẽ nằm lại trong ticket cho người khác đọc như sự thật.
// Và chỉ lấy những trường ĐÃ HIỆN trên panel — không nhét payload thô vào.

const SUMMARY_MAX_GROUPS = 5;
const SUMMARY_MAX_CALLS = 5;
const SUMMARY_MAX_STEPS = 8;

function summaryLine(label, value) {
  return value ? '- **' + label + ':** ' + value + '\n' : '';
}

function summaryEnvironment(data) {
  const env = data.environment;
  const context = data.feedback || {};
  let out = '';
  // env.osLabel chứ không ghép cứng chữ "iOS" ở đây: log Android sẽ ra "iOS 9".
  // Mã model đi kèm tên máy: tên thương mại thì không tra ngược được, còn mã model search ra đúng mẫu.
  out += summaryLine('Thiết bị', [env.device + (env.deviceModel ? ' (' + env.deviceModel + ')' : ''),
    env.osLabel, env.performance].filter(Boolean).join(' · '));
  // Log phủ nhiều ngày thì người dùng có thể đã nâng cấp app giữa chừng. Bản cũ ghi bản HAY GẶP NHẤT
  // rồi dán luôn App Info của feedback vào sau, ra "5.13.1 · build 51310 · 5.15.0 - 51500" — hai bản
  // khác nhau nằm cạnh nhau mà không một chữ nào nói ra đó là hai bản.
  const appLine = env.appVersions.length > 1
    ? env.appVersions.length + ' bản trong log: ' + env.appVersions.map((item) => item.value).join(' / ')
    : [env.appVersion, env.appBuild ? 'build ' + env.appBuild : ''].filter(Boolean).join(' · ');
  out += summaryLine('Bản app', [appLine, env.flavor ? 'build ' + env.flavor : '',
    context['App Info'] ? 'lúc gửi: ' + context['App Info'] : ''].filter(Boolean).join(' · '));
  // Version miniapp là thứ quyết định "chạy đoạn code nào" — thiếu nó thì ticket không tái hiện được.
  out += summaryLine('MiniApp', env.miniApps
    .map((app) => app.appId + ' ' + app.versions.map((item) => item.value).join('/')).join(' · '));
  // Những trường đáng lẽ không đổi mà lại đổi: đây là thứ người đọc ticket cần biết TRƯỚC khi tin mấy
  // con số phía trên, vì chúng đang cộng của cả hai bên.
  out += summaryLine('Đổi giữa chừng', env.changed
    .map((field) => field.label + ' (' + field.values.length + ')').join(' · '));
  // Miniapp nhảy bản giữa log là thứ phải nằm trong ticket: "lỗi ở bản nào" là câu hỏi đầu tiên của
  // team miniapp, mà header chỉ khai được bản cuối.
  out += summaryLine('MiniApp đổi bản giữa log', env.miniApps
    .filter(miniAppChangedBuild)
    .map((app) => app.appId + ' ' + miniAppBuildPath(app))
    .join(' · '));
  out += summaryLine('Mạng', context.Network);
  out += summaryLine('Màn / tính năng', [context.Feature, context.ScreenID, context.MiniApp]
    .filter(Boolean).join(' · '));
  out += summaryLine('Vào từ', context['Entry Point']);
  out += summaryLine('Gửi lúc', context.submittedAt || formatClock(data.lastTs));
  return out;
}

// Những gì log KHÔNG trả lời được cũng phải nằm trong ticket: người đọc sau sẽ biết vì sao không có
// phần đó, thay vì tưởng là "đã kiểm, không có vấn đề".
function summaryBlindSpots(data) {
  const notes = [];
  // LUÔN nhắc, chỉ đổi câu chữ. Trước đây chỗ bật "bỏ khối lặp" thì câu này biến mất — người đọc ticket
  // không còn một dấu hiệu nào rằng file gốc bị nối đôi.
  if (data.duplicate) {
    notes.push(lensState.filter.skipDuplicate
      ? 'file gốc có ' + data.duplicate.length + ' dòng lặp lại nguyên xi; các con số trên đã trừ chúng ra'
      : 'log có ' + data.duplicate.length + ' dòng lặp lại nguyên xi — các con số trên đang tính cả hai lần');
  }
  if (!data.traceIssues.available) {
    notes.push('không có dòng Grafana trace (máy gửi không bật Debug Tool) nên không có nguồn lỗi này');
  }
  if (!data.journey.steps.length) {
    notes.push('không có event MoMoTracker nên không dựng được thao tác của user');
  }
  if (data.outOfOrder) {
    notes.push(data.outOfOrder + ' dòng có timestamp lùi về trước — thứ tự dòng không phải thứ tự thời gian');
  }
  if (data.hasOrphanTail) {
    notes.push('đoạn đầu log nằm trước lần khởi động đầu tiên thấy được — không biết phiên đó bắt đầu ' +
      'lúc nào và đã chạy bao lâu trước đó');
  }
  const spanMs = data.lastTs - data.firstTs;
  if (spanMs > 0) {
    notes.push('log chỉ phủ ' + formatDuration(spanMs) + ' (' + formatClock(data.firstTs) + ' → ' +
      formatClock(data.lastTs) + '), thao tác trước đó không nằm trong file');
  }
  return notes;
}

// Ticket mô tả CẢ LOG chứ không mô tả lát cắt người đọc đang mở — nhưng "bỏ khối lặp" không phải một
// lát cắt, nó là sửa dữ liệu về đúng. Nên đây là ngoại lệ duy nhất được lọc.
function summaryData(data) {
  if (!data.duplicate || !lensState.filter.skipDuplicate) return data;
  const entries = data.entries.filter((entry) => !entry.isDuplicate);
  return Object.assign({}, data, deriveStats(entries, data.gaps), { entries });
}

function buildTicketSummary(fullData) {
  const data = summaryData(fullData);
  const context = data.feedback || {};
  const groups = data.groups
    .filter((group) => group.level === 'ERROR' && !isGroupMuted(group) && !group.noiseLabel)
    .slice(0, SUMMARY_MAX_GROUPS);
  const calls = data.badHttpCalls.slice(0, SUMMARY_MAX_CALLS);
  const steps = data.journey.steps.slice(-SUMMARY_MAX_STEPS);
  const abTags = data.configs.bySource.ab || [];

  let out = '## Feedback' + (context.AgentID ? ' · ' + context.AgentID : '') + '\n\n';
  out += summaryEnvironment(data);
  out += '\n';

  if (groups.length) {
    out += '### ' + groups.length + ' nhóm lỗi nổi bật\n';
    groups.forEach((group) => {
      out += '- `' + (group.module || 'no module') + '` ×' + group.indices.length + ' — ' +
        group.sample.replace(/\s+/g, ' ').slice(0, 120) + ' _(' + formatClock(group.firstTs) + ')_\n';
    });
    out += '\n';
  }

  if (data.traceIssues.fails.length) {
    out += '### Lỗi từ Grafana trace\n';
    data.traceIssues.fails.slice(0, SUMMARY_MAX_GROUPS).forEach((row) => {
      out += '- ×' + row.indices.length + ' — ' + row.key.replace(/\s+/g, ' ').slice(0, 120) + '\n';
    });
    out += '\n';
  }

  if (calls.length) {
    out += '### Call HTTP bất thường (' + data.badHttpCalls.length + '/' + data.httpCalls.length + ')\n';
    calls.forEach((call) => {
      const status = call.resIndex === null ? 'không có response'
        : (call.errorCode != null && call.errorCode !== 0 ? 'errorCode ' + call.errorCode : call.status);
      out += '- `' + call.method + ' ' + call.path + '` → ' + status +
        (call.duration != null ? ' · ' + formatDuration(call.duration) : '') + '\n';
    });
    out += '\n';
  }

  if (steps.length) {
    out += '### ' + steps.length + ' bước cuối trước lúc gửi\n';
    steps.forEach((step) => {
      out += '- `' + formatClock(step.ts) + '` ' + step.label +
        (step.count > 1 ? ' ×' + step.count : '') + (step.detail ? ' — ' + step.detail : '') + '\n';
    });
    out += '\n';
  }

  if (abTags.length) {
    out += '### Nhánh A/B đang bật\n';
    abTags.forEach((item) => {
      out += '- `' + item.key + '` = ' + item.latest.value + '\n';
    });
    out += '\n';
  }

  const blind = summaryBlindSpots(fullData);
  if (blind.length) {
    out += '### Log này không trả lời được\n';
    blind.forEach((note) => {
      out += '- ' + note + '\n';
    });
    out += '\n';
  }

  out += '_Trích bằng Feedback Log Lens từ ' + data.entries.length + ' dòng log. ' +
    'Đây là danh sách sự kiện có giờ, không phải kết luận nguyên nhân._\n';
  return out;
}
// @ts-check
// gom MỌI mã lỗi xuất hiện trong log về một chỗ
//
// Mã lỗi đang nằm rải ở bốn nguồn khác nhau và không chỗ nào đếm chúng lại: `entry.http.errorCode`
// (payload HTTP), `error_code` trong params của MoMoTracker, `errorCode` trong TraceParameter của
// Grafana, và `"errorCode": 413` nằm trong thân JSON của response hoặc của một khối config. Muốn biết
// "log này có những mã nào, mã nào nổ nhiều nhất" thì phải tự đọc từng mục một rồi cộng tay.
//
// Vì vậy đọc bằng MỘT regex chung trên chính dòng text, thay vì đi gom từ bốn cấu trúc đã parse: bốn
// nguồn đó viết mã lỗi theo bốn kiểu (`errorCode=`, `error_code=`, `"errorCode":`, `"errorCode": "`)
// nhưng đều là cùng một chữ. Sàng bằng indexOf trước vì đại đa số dòng không có chữ nào trong hai chữ
// đó — cùng lý do với chữ ký lỗi và với buildCorrelations.
const RE_ERROR_CODE_ANY = /(?:errorCode|error_code)"?\s*[=:]\s*"?(-?\d+)/g;

// Mã 0 và mã rỗng nghĩa là KHÔNG lỗi: `ops_receive_be` ghi `error_code=0` cho mọi call thành công, để
// lẫn vào thì mã hay gặp nhất trong log luôn là 0 và mục này thành vô dụng.
function buildErrorCodes(entries) {
  const byCode = new Map();
  entries.forEach((entry) => {
    const raw = entry.raw;
    if (!raw || (raw.indexOf('errorCode') < 0 && raw.indexOf('error_code') < 0)) return;
    RE_ERROR_CODE_ANY.lastIndex = 0;
    let hit = RE_ERROR_CODE_ANY.exec(raw);
    while (hit) {
      const code = Number(hit[1]);
      if (code !== 0) {
        let bucket = byCode.get(code);
        if (!bucket) {
          bucket = { code, count: 0, indices: [], firstTs: entry.ts || entry.windowTs || 0, modules: new Set() };
          byCode.set(code, bucket);
        }
        bucket.count += 1;
        if (entry.module) bucket.modules.add(entry.module);
        // Một dòng có thể ghi cùng một mã hai lần (payload lồng nhau); chỉ giữ dòng một lần để bấm vào
        // duyệt không bị lặp.
        if (bucket.indices[bucket.indices.length - 1] !== entry.domIndex) bucket.indices.push(entry.domIndex);
      }
      hit = RE_ERROR_CODE_ANY.exec(raw);
    }
  });
  return Array.from(byCode.values())
    .map((bucket) => ({ code: bucket.code, count: bucket.count, indices: bucket.indices,
      firstTs: bucket.firstTs, modules: Array.from(bucket.modules) }))
    .sort((a, b) => b.count - a.count || a.code - b.code);
}
// @ts-check
// "miniapp này đang chạy bản build nào, và nó vừa nhảy từ bản nào lên"
//
// Dòng nguồn là Map.toString() của Kotlin (không phải JSON), dùng chung lớp đọc với tracker và Grafana:
//   [Module: BundleLoader] [BundleExecutorManager][e@14ffac7] [vn.momo.expense] execute version:
//   {deploymentTarget=150, cdnUrl=…, buildNumber=3449, size=1619017, appId=vn.momo.expense,
//    installMode=1, diffChange={url=…, fromBuildNumber=3420, toBuildNumber=3449, size=544980}}
//
// Vì sao đáng đọc riêng: header request chỉ khai `map_miniAppVersion` tại lúc gọi, tức chỉ thấy bản
// CUỐI. Dòng này mới nói ra cả đường đi. Đo trên log production (autoId=5956827): `vn.momo.expense`
// chạy 3420, vá lên 3449 rồi vá tiếp lên 3494 — ba bản trong một log, mà mục MiniApp cũ chỉ hiện một.
//
// Cùng chuỗi "execute version" còn một dòng KHÁC hẳn, không phải map:
//   "execute version.appId: vn.momo.expense loaded event. bridge data: com.facebook.react…"
// Đo trên log trên: 54 dòng chứa chuỗi đó thì **20 dòng là loại này**. Vì vậy phải đòi đúng dấu hai
// chấm rồi tới dấu ngoặc (`RE_BUNDLE_EXEC`), sàng bằng indexOf trước cho rẻ.

const BUNDLE_MARK = 'execute version';
const RE_BUNDLE_EXEC = /execute version:\s*\{/;
// Những khoá đáng hiện. Danh sách trắng chứ không phải "đọc hết": cùng map đó có `signature` dài hơn
// 1000 ký tự và `checksum`, `jsBundlePath`, `cdnUrl`, `downloadUrls` — không có chỗ nào trên panel
// rộng 480px cho chúng, mà đưa vào ticket thì chỉ làm loãng.
const BUNDLE_KEYS = ['buildNumber', 'size', 'installMode', 'platform', 'deploymentTarget',
  'trackingFlag', 'versionFromSource'];

function bundleNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Một dòng "execute version" -> thông tin gọn của lần nạp bundle đó, hoặc null nếu không phải dòng map.
function parseBundleExec(raw) {
  if (!raw || raw.indexOf(BUNDLE_MARK) < 0) return null;
  const hit = RE_BUNDLE_EXEC.exec(raw);
  if (!hit) return null;
  const block = extractJsonBlock(raw.slice(hit.index));
  const map = block ? parseKeyValueMap(block.text) : null;
  if (!map || !map.appId) return null;
  const info = { appId: String(map.appId) };
  BUNDLE_KEYS.forEach((key) => {
    if (map[key] != null && map[key] !== '') info[key] = String(map[key]);
  });
  // diffChange có nghĩa là bản này được VÁ từ một bản cũ chứ không tải trọn gói: đó chính là chỗ nhìn
  // ra đường đi của version. Không có nó thì đây là lần nạp thẳng một bản.
  const diff = map.diffChange && typeof map.diffChange === 'object' ? map.diffChange : null;
  if (diff) {
    info.from = String(diff.fromBuildNumber || '');
    info.to = String(diff.toBuildNumber || '');
    info.patchSize = bundleNumber(diff.size);
  }
  return info;
}

// Gom theo (miniapp, bản build, vá từ bản nào). Giữ thứ tự GẶP LẦN ĐẦU chứ không sắp theo số lần:
// câu chuyện ở đây là "đi từ bản nào lên bản nào", sắp lại theo số lần là đọc ngược dòng thời gian.
function buildMiniAppBundles(entries) {
  const byApp = new Map();
  entries.forEach((entry) => {
    const info = parseBundleExec(entry.raw);
    if (!info) return;
    let list = byApp.get(info.appId);
    if (!list) {
      list = [];
      byApp.set(info.appId, list);
    }
    const key = (info.buildNumber || '') + '|' + (info.from || '');
    let seen = list.find((item) => item.key === key);
    if (!seen) {
      seen = Object.assign({ key, count: 0, indices: [], firstTs: entry.ts, lastTs: entry.ts }, info);
      list.push(seen);
    }
    seen.count += 1;
    seen.indices.push(entry.domIndex);
    if (entry.ts) {
      if (!seen.firstTs) seen.firstTs = entry.ts;
      seen.lastTs = entry.ts;
    }
  });
  return byApp;
}

// Miniapp có đổi bản trong tập đang xem không. Một lần nạp DUY NHẤT mà là bản vá thì vẫn là có đổi:
// chính chữ "vá từ 3420 lên 3449" đã nói ra điều đó, không cần thấy đủ hai lần nạp.
function miniAppChangedBuild(app) {
  return app.bundles.length > 1 || !!(app.bundles[0] && app.bundles[0].from);
}

// Đường đi của version, ví dụ "3420 → 3449 → 3494". Phải bắt đầu từ bản ĐƯỢC VÁ LÊN của lần nạp đầu,
// không thì mất mất bản gốc: trên log thật lần nạp đầu của vn.momo.expense đã là "3449 vá từ 3420",
// liệt kê trơn số build sẽ ra "3449 → 3494" và bản 3420 biến mất.
function miniAppBuildPath(app) {
  const first = app.bundles[0];
  if (!first) return '';
  return (first.from ? [first.from] : []).concat(app.bundles.map((item) => item.buildNumber)).join(' → ');
}
// @ts-check
// hằng số dùng chung, lensState, tắt tiếng chữ ký, hàm định dạng
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

const MINIMAP_BUCKETS = 90;
const SPARKLINE_BUCKETS = 26;
const DEFAULT_GAP_MS = 2000;
const PANEL_MIN_WIDTH = 360;
const PANEL_MIN_HEIGHT = 260;
const VIEWPORT_MARGIN = 8;

const LEVEL_COLOR = {
  ERROR: '#ff5f6d',
  WARNING: '#ffb648',
  INFO: '#58c4ff',
  DEBUG: '#7d8590',
};

const MUTE_STORAGE_KEY = 'fll.mutedSignatures';
const TEMPLATE_STORAGE_KEY = 'fll.filterTemplates';
const MAX_FILTER_TEMPLATES = 20;
const PERMALINK_PREFIX = '#fll=';
const TIME_WINDOW_CHOICES = [30000, 60000, 120000, 300000];

const lensState = {
  data: null,
  geometry: null,
  tab: 'sum',
  matches: [],
  matchPos: -1,
  matchLabel: '',
  gapThresholdMs: DEFAULT_GAP_MS,
  mutedSignatures: new Set(),
  filterTemplates: [],
  isShowingMuted: false,
  // 'keep' = đánh dấu dòng được giữ, 'drop' = đánh dấu dòng bị loại. Chọn theo phía ít hơn,
  // vì chi phí lọc nằm ở SỐ LẦN chạm class chứ không phải ở layout.
  filterDomMode: 'keep',
  // Người dùng bấm "x" trên feedback này: đừng tự gắn lại nữa (nhưng sang feedback khác thì gắn lại).
  isDismissed: false,
  // Nhớ lần trước đang mở panel hay đang thu gọn, để sang feedback khác trả về đúng dạng đó.
  wasPanelOpen: false,
  // Dòng bị bộ lọc ẩn nhưng người dùng vẫn nhảy tới: phải đếm riêng, không thì con số
  // "đang hiện N/total" sẽ nói dối.
  forcedVisibleIndices: new Set(),
  filter: {
    levels: new Set(),
    modules: new Set(),
    text: '',
    useRegex: true,
    hideOthers: true,
    // Khoảng thời gian tuỳ ý. Chip preset ghi (lastTs - N, lastTs); kéo trên minimap ghi khoảng bất kỳ.
    timeFrom: null,
    timeTo: null,
    // Preset đang bật, tính bằng ms ("2 phút cuối" = 120000), null = khoảng tự chọn hoặc không lọc.
    // Phải NHỚ chứ không suy ngược từ (timeFrom, timeTo): setTimeWindowPreset kẹp timeFrom về firstTs,
    // nên trên log ngắn hơn preset thì hiệu hai mốc không còn bằng preset và chip không sáng, nhãn
    // lại đổi thành hai mốc giờ tuyệt đối. Đo trên ba log thật (dài 291s / 572s / 234s): preset
    // "5 phút cuối" hỏng ở CẢ BA. Nhớ preset còn cho phép tính lại cửa sổ khi sang log khác.
    windowPreset: null,
    session: null,
    // Bỏ qua khối dòng bị lặp lại nguyên xi. Mặc định TẮT: báo trước rồi để người đọc bấm, vì khử nhầm
    // một khối không lặp thì số liệu cũng sai — chỉ là sai theo hướng khác và không còn dấu hiệu nào.
    skipDuplicate: false,
  },
  // Mục đang di chuột qua, để biết lúc nào phải vẽ lại mũi tên lên minimap (và lúc nào thì thôi).
  aimEl: null,
  // Phần tử chuột đang dừng trên, để biết lúc nào phải hiện tooltip tự vẽ (và lúc nào thì thôi).
  tipEl: null,
  // Khoảng thời gian minimap đang VẼ (null = vẽ nguyên cả log). Độc lập với bộ lọc: phóng to chỉ đổi
  // cái nhìn, không đổi tập dòng đang hiện.
  mapZoom: null,
  // Các nấc phóng to trước đó, để lùi từng nấc một thay vì nhảy thẳng về cả log.
  mapZoomStack: [],
  el: {},
};

/* ------------------------------------------- tắt tiếng chữ ký (nhớ qua phiên) */

function loadMutedSignatures() {
  try {
    return new Set(JSON.parse(localStorage.getItem(MUTE_STORAGE_KEY)) || []);
  } catch (error) {
    return new Set();
  }
}

function persistMutedSignatures() {
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, JSON.stringify(Array.from(lensState.mutedSignatures)));
  } catch (error) {
    // Riêng tư / hết dung lượng: tắt tiếng vẫn chạy trong phiên này, chỉ không nhớ sang lần sau.
  }
}

function toggleMutedSignature(groupKey) {
  if (lensState.mutedSignatures.has(groupKey)) lensState.mutedSignatures.delete(groupKey);
  else lensState.mutedSignatures.add(groupKey);
  persistMutedSignatures();
}

function isGroupMuted(group) {
  return lensState.mutedSignatures.has(group.key);
}

function countUnmutedErrorGroups(source) {
  return source.groups.filter((group) => group.level === 'ERROR' && !isGroupMuted(group)).length;
}

// Các tab đọc qua đây: có bộ lọc thì là thống kê của tập đang hiện, không thì là cả file.
function getView() {
  return lensState.view || lensState.data;
}

function escapeHtml(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    return '&#39;';
  });
}

// Tên một phiên app. Đoạn đầu log nằm trước mốc khởi động đầu tiên không có số thứ tự nào đúng cả:
// nó là đuôi của một lần chạy mà log không giữ được điểm bắt đầu, nên gọi thẳng ra như vậy.
function sessionLabel(index) {
  return index === SESSION_ORPHAN_INDEX ? 'Đuôi phiên trước' : 'Phiên ' + index;
}

const SESSION_ORPHAN_TIP = 'Đoạn đầu log, nằm trước lần khởi động đầu tiên thấy được — không có điểm ' +
  'bắt đầu phiên trong file này (log bị cắt bớt, hoặc app đã chạy từ trước đó). Số liệu của nó là số ' +
  'liệu của một phần phiên, không phải cả phiên.';

function formatClock(ts) {
  if (!ts) return '--:--:--';
  const date = new Date(ts + 7 * 3600000);
  return date.toISOString().slice(11, 19);
}

function formatDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
  // Khoảng lặng giữa hai lần mở app có thể dài vài tiếng. "14182s" thì không ai đọc ra là gần bốn
  // tiếng — phải tự chia trong đầu. Trên một phút thì đổi sang phút/giờ.
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours) return hours + 'h' + String(minutes).padStart(2, '0') + 'm';
  return minutes + 'm' + String(totalSeconds % 60).padStart(2, '0') + 's';
}

function formatCount(value) {
  return value >= 1000 ? (value / 1000).toFixed(1) + 'k' : String(value);
}
// @ts-check
// nhảy tới dòng log, duyệt kết quả khớp, thanh điều hướng dưới
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

/* ---------------------------------------------------------------- điều hướng */

function jumpToIndex(domIndex) {
  const data = lensState.data;
  const entry = data.entries[domIndex];
  if (!entry || !entry.el) return;

  // Trước đây cho chạy hết 4085 phần tử để gỡ class highlight mỗi lần bấm n — chỉ cần nhớ dòng trước đó.
  if (lensState.el.lastHit && lensState.el.lastHit !== entry.el) lensState.el.lastHit.classList.remove('fll-hit');
  if (!isRowVisible(entry)) {
    lensState.forcedVisibleIndices.add(domIndex);
    forceRowVisible(entry);
  }
  entry.el.classList.add('fll-hit');
  lensState.el.lastHit = entry.el;

  const container = data.container;
  const containerRect = container.getBoundingClientRect();
  const rowRect = entry.el.getBoundingClientRect();
  container.scrollTop += rowRect.top - containerRect.top - container.clientHeight / 2 + rowRect.height / 2;

  if (containerRect.bottom < 60 || containerRect.top > window.innerHeight - 60) {
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  updateMinimapCursor(entry.ts);
  refreshFilterBar();
}

// startPos: đứng sẵn ở dòng thứ mấy trong danh sách, mặc định là dòng đầu. Mở bằng permalink cần
// nó — link chỉ ra một dòng cụ thể, nhưng danh sách để bấm n/p vẫn phải là cả tập dòng khớp.
function setMatches(indices, label, startPos) {
  lensState.matches = indices;
  lensState.matchLabel = label;
  const start = Math.min(Math.max(0, startPos || 0), Math.max(0, indices.length - 1));
  lensState.matchPos = indices.length ? start : -1;
  if (indices.length) jumpToIndex(indices[start]);
  renderFooter();
  // Nháy một cái khi có danh sách MỚI. Thanh này nằm dưới cùng panel nên người dùng hay không nhận ra
  // vừa có gì đó để duyệt; nháy ở đây chỉ để kéo mắt xuống. Cố ý KHÔNG nháy mỗi lần bấm n/p — lúc đó
  // người dùng đang nhìn nó rồi, nháy nữa thành phiền.
  flashFooter();
}

function flashFooter() {
  const info = lensState.el.info;
  const footer = info && info.parentElement;
  if (!footer || !lensState.matches.length) return;
  footer.classList.remove('fll-ft-flash');
  // Đọc lại offsetWidth để trình duyệt kết thúc animation cũ trước khi gắn lại class,
  // nếu không thì bấm hai lần liên tiếp sẽ không thấy nháy lần thứ hai.
  void footer.offsetWidth;
  footer.classList.add('fll-ft-flash');
}

function moveMatch(step) {
  const total = lensState.matches.length;
  if (!total) return;
  lensState.matchPos = (lensState.matchPos + step + total) % total;
  jumpToIndex(lensState.matches[lensState.matchPos]);
  renderFooter();
}

// Thanh dưới cùng từng luôn hiện và ghi "Chưa chọn gì để duyệt" — đúng nhưng không nói nó LÀ gì,
// nên người dùng nhìn qua không biết để làm gì, mà vẫn chiếm chỗ.
// Nay ẨN HẲN khi chưa có gì để duyệt. Chính việc nó hiện ra (kèm một nháy màu accent) là lời giới
// thiệu: nó chỉ xuất hiện đúng lúc vừa có một danh sách dòng để đi qua.
function renderFooter() {
  const info = lensState.el.info;
  if (!info) return;
  const footer = /** @type {HTMLElement | null} */ (info.parentElement);
  const total = lensState.matches.length;

  if (footer) footer.hidden = !total;
  if (!total) {
    info.innerHTML = '';
    return;
  }

  const entry = lensState.data.entries[lensState.matches[Math.max(0, lensState.matchPos)]];
  info.innerHTML =
    '<span class="fll-ft-tag">đang duyệt</span>' +
    '<b class="fll-ft-pos">' + (lensState.matchPos + 1) + '/' + total + '</b> ' +
    '<span class="fll-ft-lbl">' + escapeHtml(lensState.matchLabel) + '</span>' +
    '<span class="fll-ft-line">#<b>' + (entry ? entry.lineNo : '?') + '</b></span>';
}
// @ts-check
// lõi bộ lọc: biến điều kiện thành hàm, lọc tập dòng, dựng view
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

/* ------------------------------------------------------------------ bộ lọc */

function hasAnyFilterFacet() {
  const filter = lensState.filter;
  return !!(filter.levels.size || filter.modules.size || filter.text || filter.session ||
    filter.timeFrom !== null || filter.timeTo !== null || filter.skipDuplicate);
}

// Một lần ghi class lên container thay cho hàng nghìn lần ghi lên từng dòng.
function setLogFilteringMode(isFiltering, mode) {
  const container = lensState.data && lensState.data.container;
  if (!container) return;
  container.classList.toggle('fll-filtering', isFiltering && mode !== 'drop');
  container.classList.toggle('fll-dropping', isFiltering && mode === 'drop');
  lensState.isFiltering = isFiltering;
}

// Chi phí lọc nằm gần như HOÀN TOÀN ở số lần chạm vào class của dòng, không phải ở layout.
// Đo thật trên trang admin với 10362 dòng:
//   10k classList.add            -> 7025ms
//   bật .fll-filtering khi cả 10k dòng đều có .fll-keep -> 224ms
//   83 classList.add             -> 5ms
//   tắt lọc, hiện lại toàn bộ    -> 13ms
// Tức 10k lần chạm class đắt gấp 1400 lần so với 83 lần. Vì vậy đánh dấu theo phía ÍT HƠN:
// lọc hẹp (vài chục dòng) thì đánh dấu dòng ĐƯỢC GIỮ, lọc rộng (lọc theo phiên app — một phiên
// có thể là 10279/10362 dòng) thì đánh dấu dòng BỊ LOẠI. Số lần chạm luôn là min(giữ, loại).
function pickRowMarkMode(visibleCount, total) {
  return visibleCount * 2 > total ? 'drop' : 'keep';
}

function applyRowMarks(entries, keepFlags, isFiltering, mode) {
  // Đổi cách đánh dấu thì phải gỡ hết dấu cũ trước, nếu không dòng mang dấu cũ sẽ ẩn/hiện sai.
  if (lensState.filterDomMode !== mode) {
    const stale = lensState.filterDomMode === 'drop' ? 'fll-drop' : 'fll-keep';
    entries.forEach((entry) => {
      if (entry.isMarked && entry.el) entry.el.classList.remove(stale);
      entry.isMarked = false;
    });
    lensState.filterDomMode = mode;
  }

  const cls = mode === 'drop' ? 'fll-drop' : 'fll-keep';
  entries.forEach((entry, index) => {
    const keep = keepFlags[index] === 1;
    entry.isKept = keep;
    if (!isFiltering || !entry.el) return;
    // Chế độ 'drop' đánh dấu dòng BỊ LOẠI, nên dấu cần gắn là phủ định của keep.
    const wanted = mode === 'drop' ? !keep : keep;
    if (entry.isMarked !== wanted) {
      entry.el.classList.toggle(cls, wanted);
      entry.isMarked = wanted;
    }
  });
}

function isRowVisible(entry) {
  return !lensState.isFiltering || entry.isKept === true;
}

// Ép một dòng hiện ra dù bộ lọc đang giấu nó — cách ép phụ thuộc dạng đánh dấu nào đang dùng.
function forceRowVisible(entry) {
  if (!entry.el) return;
  if (lensState.filterDomMode === 'drop') {
    entry.el.classList.remove('fll-drop');
  } else {
    entry.el.classList.add('fll-keep');
  }
  entry.isMarked = lensState.filterDomMode !== 'drop';
  entry.isKept = true;
}

function compileFilter() {
  const filter = lensState.filter;
  let matcher = null;
  let isBadPattern = false;
  if (filter.text && filter.useRegex) {
    try {
      matcher = new RegExp(filter.text, 'i');
    } catch (error) {
      isBadPattern = true;
    }
  }
  return {
    levels: filter.levels,
    modules: filter.modules,
    session: filter.session,
    skipDuplicate: filter.skipDuplicate,
    timeFrom: filter.timeFrom,
    timeTo: filter.timeTo,
    text: filter.text,
    needle: filter.text.toLowerCase(),
    matcher,
    isBadPattern,
  };
}

// skipFacetId cho phép hỏi "nếu bỏ qua đúng điều kiện này thì dòng có lọt không".
// Đó là cách đếm cho các chip trong tab Lọc: một facet không được tự đếm theo chính nó,
// nếu không thì chọn ERROR xong chip WARNING về 0 và không còn đường nới rộng lại.
function entryMatches(entry, compiled, skipFacetId) {
  if (skipFacetId !== 'duplicate' && compiled.skipDuplicate && entry.isDuplicate) return false;
  if (skipFacetId !== 'levels' && compiled.levels.size && !compiled.levels.has(entry.level)) return false;
  if (skipFacetId !== 'modules' && compiled.modules.size && !compiled.modules.has(entry.module)) return false;
  if (skipFacetId !== 'session' && compiled.session && entry.session !== compiled.session) return false;
  if (skipFacetId !== 'window' && (compiled.timeFrom !== null || compiled.timeTo !== null)) {
    // windowTs chứ không phải ts: dòng tiếp nối thừa hưởng giờ của dòng trên nó, nhờ vậy stack trace
    // nhiều dòng không bị cửa sổ thời gian xén mất phần dưới.
    if (!entry.windowTs) return false;
    if (compiled.timeFrom !== null && entry.windowTs < compiled.timeFrom) return false;
    if (compiled.timeTo !== null && entry.windowTs > compiled.timeTo) return false;
  }
  if (skipFacetId !== 'text' && compiled.text && !compiled.isBadPattern) {
    return compiled.matcher
      ? compiled.matcher.test(entry.raw)
      : entry.raw.toLowerCase().indexOf(compiled.needle) >= 0;
  }
  return true;
}

function tallyFacetCandidates(skipFacetId, pickKey) {
  const compiled = compileFilter();
  const tally = new Map();
  lensState.data.entries.forEach((entry) => {
    if (!entryMatches(entry, compiled, skipFacetId)) return;
    const key = pickKey(entry);
    if (key === '' || key === undefined || key === null) return;
    tally.set(key, (tally.get(key) || 0) + 1);
  });
  return tally;
}

// Cửa sổ thời gian đang xem, suy từ các điều kiện THỜI GIAN (không phải từ tập dòng còn lại).
// Nếu suy từ tập dòng thì lọc "chỉ ERROR" sẽ làm khoảng lặng phình thành những khoảng giả giữa hai lỗi.
function getVisibleTimeRange() {
  const data = lensState.data;
  const filter = lensState.filter;
  let from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
  let to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
  if (filter.session && data.sessions) {
    const session = data.sessions.find((item) => item.index === filter.session);
    // Phiên không có dòng nào mang timestamp thì startTs/endTs là null: Math.min(x, null) ra 0, tức
    // khoảng đang xem thành [firstTs, 0] — vô nghĩa mà không có gì báo. Không có mốc thì đừng thu hẹp.
    if (session && session.startTs && session.endTs) {
      from = Math.max(from, session.startTs);
      to = Math.min(to, session.endTs);
    }
  }
  return { from, to };
}

function buildView() {
  const data = lensState.data;
  if (!hasAnyFilterFacet() || !lensState.lastFilterResult) {
    lensState.view = data;
    return;
  }
  const subset = lensState.lastFilterResult.visible.map((index) => data.entries[index]);
  const stats = deriveStats(subset, data.gaps);
  const range = getVisibleTimeRange();
  // Khoảng lặng là thuộc tính của đường thời gian, không phải của tập dòng: chỉ cắt theo cửa sổ thời gian.
  stats.gaps = data.gaps.filter((gap) => gap.before.ts >= range.from && gap.before.ts <= range.to);
  lensState.view = Object.assign({}, data, stats);
}

function computeFilteredIndices() {
  const filter = lensState.filter;
  const compiled = compileFilter();
  const isBadPattern = compiled.isBadPattern;
  // Hàm này tính lại toàn bộ trạng thái nên mọi dòng từng được "ép hiện" trở về chuẩn.
  lensState.forcedVisibleIndices.clear();
  const isFiltering = filter.hideOthers && hasAnyFilterFacet();
  const entries = lensState.data.entries;
  const visible = [];
  // Tính xong hết rồi mới đụng tới DOM: phải biết tổng số dòng được giữ thì mới chọn được
  // đánh dấu theo phía nào cho ít thao tác hơn.
  const keepFlags = new Uint8Array(entries.length);
  entries.forEach((entry, index) => {
    if (!entryMatches(entry, compiled, null)) return;
    keepFlags[index] = 1;
    visible.push(entry.domIndex);
  });
  // Khi không lọc thì giữ nguyên cách đánh dấu đang có: class trên container tắt là mọi dòng tự
  // hiện lại, và dấu trên dòng vẫn khớp nên lần lọc sau chỉ ghi đúng phần chênh lệch.
  const mode = isFiltering ? pickRowMarkMode(visible.length, entries.length) : lensState.filterDomMode;
  applyRowMarks(entries, keepFlags, isFiltering, mode);
  setLogFilteringMode(isFiltering, mode);
  lensState.visibleCount = isFiltering ? visible.length : entries.length;
  lensState.lastFilterResult = { visible, isBadPattern };
  buildView();
  return lensState.lastFilterResult;
}

/* ------------------------------------------- gom giá trị bắt được từ ô tìm regex */

// Ô tìm regex vốn đã là bộ trích xuất vạn năng, chỉ thiếu một bước: nó hiện ra DÒNG, không hiện ra
// GIÁ TRỊ. Thêm bước này thì gõ `(\d+\.\d+\.\d+\.\d+)` là ra danh sách IP, gõ `agent_id":"(\d+)"`
// là ra danh sách agent — mà không phải đoán trước xem loại nào đáng quét, không tốn gì lúc khởi động,
// và không có mục nào nằm thường trực trên panel.
const CAPTURE_MAX_LINES = 5000;
const CAPTURE_MAX_VALUES = 300;

// Cách chuẩn để đếm số nhóm bắt mà không phải tự parse regex: thêm một nhánh rỗng vào cuối rồi khớp
// chuỗi rỗng — nhánh đó luôn khớp, nên mảng kết quả có đúng (số nhóm + 1) phần tử.
function regexCaptureCount(source) {
  try {
    const probe = new RegExp(source + '|').exec('');
    return probe ? probe.length - 1 : 0;
  } catch (error) {
    return 0;
  }
}

// Nhóm đầu tiên CÓ giá trị, không phải nhóm 1: với regex có nhánh (`a(x)|b(y)`) thì nhóm 1 rỗng khi
// nhánh sau khớp, lấy cứng hit[1] là ra một danh sách toàn undefined.
function firstCapture(hit) {
  for (let i = 1; i < hit.length; i += 1) {
    if (hit[i] !== undefined) return hit[i];
  }
  return undefined;
}

function buildCaptureTally(visible) {
  const filter = lensState.filter;
  if (!filter.text || !filter.useRegex || !lensState.data) return null;
  if (regexCaptureCount(filter.text) < 1) return null;
  let re;
  try {
    re = new RegExp(filter.text, 'gi');
  } catch (error) {
    return null;
  }
  const entries = lensState.data.entries;
  const byValue = new Map();
  const lines = Math.min(visible.length, CAPTURE_MAX_LINES);
  let total = 0;
  for (let i = 0; i < lines; i += 1) {
    const entry = entries[visible[i]];
    if (!entry || !entry.raw) continue;
    re.lastIndex = 0;
    let hit = re.exec(entry.raw);
    while (hit) {
      // Regex khớp chuỗi RỖNG (ví dụ `(\d*)`) thì lastIndex không tiến, vòng lặp treo cứng trang.
      if (hit[0] === '') re.lastIndex += 1;
      const value = firstCapture(hit);
      if (value !== undefined) {
        total += 1;
        let bucket = byValue.get(value);
        if (!bucket) {
          if (byValue.size >= CAPTURE_MAX_VALUES) break;
          bucket = { value, count: 0, indices: [] };
          byValue.set(value, bucket);
        }
        bucket.count += 1;
        if (bucket.indices[bucket.indices.length - 1] !== entry.domIndex) bucket.indices.push(entry.domIndex);
      }
      hit = re.exec(entry.raw);
    }
  }
  return {
    values: Array.from(byValue.values()).sort((a, b) => b.count - a.count),
    total,
    scannedLines: lines,
    cappedLines: visible.length > lines,
    cappedValues: byValue.size >= CAPTURE_MAX_VALUES,
  };
}

// Vẽ lại tab Lọc không được tự quét lại 4085 dòng: mọi đường đổi bộ lọc đều đã gọi
// computeFilteredIndices trước đó rồi. Quét hai lần là lý do "Xoá tất cả" từng tốn 200ms.
function getFilterResult() {
  return lensState.lastFilterResult || computeFilteredIndices();
}
// @ts-check
// permalink qua hash URL và mẫu bộ lọc lưu sẵn
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

/* --------------------------------------------------- permalink qua hash URL */

// Một định nghĩa duy nhất cho cả permalink lẫn mẫu bộ lọc.
// Khoảng thời gian kết thúc đúng ở lastTs được lưu dạng "N cuối" chứ không phải mốc tuyệt đối:
// như thế mẫu "2 phút cuối" còn dùng được ở feedback khác, còn mốc tuyệt đối thì vô nghĩa.
function serializeFilter() {
  const filter = lensState.filter;
  const data = lensState.data;
  const payload = {
    lv: Array.from(filter.levels),
    md: Array.from(filter.modules),
    q: filter.text,
    re: filter.useRegex ? 1 : 0,
    s: filter.session || 0,
  };
  // Thiếu chỗ này thì: mẫu bộ lọc lưu xong mô tả là "không có điều kiện nào" và bấm vào không làm gì,
  // còn permalink gửi cho đồng nghiệp sẽ hiện số gấp đôi mà không có dấu hiệu gì.
  if (filter.skipDuplicate) payload.d = 1;
  // Chip "Ẩn dòng không khớp" tắt được, mà bật/tắt nó là hai bức tranh khác hẳn nhau: cùng một bộ điều
  // kiện, một bên bảng log còn nguyên, một bên bị xén còn vài chục dòng. Vắng khoá này = bật (mặc định),
  // nên link cũ vẫn đọc đúng.
  if (!filter.hideOthers) payload.h = 0;
  if (filter.timeFrom !== null || filter.timeTo !== null) {
    // Preset gửi đi dưới dạng "N cuối" để người nhận tính lại trên log của họ, không gửi hai mốc tuyệt đối.
    // Chỉ đổi khi ĐANG thật sự là preset: khoảng kéo tay mà kết thúc gần cuối log từng bị đoán thành
    // preset, làm người nhận thấy nhãn "39.5 giây cuối" trong khi người gửi thấy hai mốc giờ — và tệ hơn,
    // windowPreset khác null thì retargetTimeWindow() sẽ TỰ tính lại cửa sổ khi sang log khác. Kéo tay
    // thì không đoán được ý người dùng, đúng như luật ở retargetTimeWindow.
    if (filter.windowPreset) payload.wLast = filter.windowPreset;
    else {
      payload.f = (filter.timeFrom !== null ? filter.timeFrom : data.firstTs) - data.firstTs;
      payload.tt = (filter.timeTo !== null ? filter.timeTo : data.lastTs) - data.firstTs;
    }
  }
  return payload;
}

function applyFilterPayload(payload) {
  const filter = lensState.filter;
  const data = lensState.data;
  filter.levels = new Set(payload.lv || []);
  filter.modules = new Set(payload.md || []);
  filter.text = payload.q || '';
  filter.useRegex = payload.re !== 0;
  filter.session = payload.s || null;
  // Phải đặt lại CẢ khi payload không có: áp một mẫu không có điều kiện này mà vẫn giữ cờ đang bật thì
  // kết quả khác hẳn mô tả của mẫu.
  filter.skipDuplicate = payload.d === 1;
  filter.timeFrom = null;
  filter.timeTo = null;
  filter.windowPreset = null;
  filter.hideOthers = payload.h !== 0;
  // payload.w là dạng cũ của permalink (chỉ lưu "N giây cuối").
  if (payload.wLast || payload.w) setTimeWindowPreset(payload.wLast || payload.w);
  else if (payload.f >= 0 || payload.tt >= 0) {
    filter.timeFrom = payload.f >= 0 ? Math.min(data.lastTs, data.firstTs + payload.f) : null;
    filter.timeTo = payload.tt >= 0 ? Math.min(data.lastTs, data.firstTs + payload.tt) : null;
  }
}

// Trạng thái BÊN TRONG tab (ô tìm, chip loại mốc, chip chỉ-call-hỏng). Không nhập vào serializeFilter:
// mẫu bộ lọc là một BỘ ĐIỀU KIỆN dùng lại được ở feedback khác, còn mấy thứ này là "đang xem lát nào
// của tab này". Chỉ ghi phần khác mặc định, để hash không phình vì những giá trị không ai đổi.
function serializeTabUi() {
  const ui = {};
  if (tabUiState.issueLevel !== 'all') ui.il = tabUiState.issueLevel;
  if (tabUiState.issueQuery) ui.iq = tabUiState.issueQuery;
  if (tabUiState.httpOnlyBad) ui.hb = 1;
  if (tabUiState.httpQuery) ui.hq = tabUiState.httpQuery;
  if (tabUiState.moduleQuery) ui.mq = tabUiState.moduleQuery;
  if (tabUiState.showNoise) ui.sn = 1;
  if (tabUiState.tlQuery) ui.tq = tabUiState.tlQuery;
  if (tabUiState.tlKinds.size) ui.tk = Array.from(tabUiState.tlKinds);
  return ui;
}

function applyTabUiPayload(ui) {
  // Dọn trước rồi mới áp, kể cả khi link không mang gì: còn sót ô tìm của lần trước thì danh sách đã bị
  // lọc sẵn mà không có dòng nào nói ra — đúng loại lỗi với việc mang bộ lọc sang feedback khác.
  resetTabUiState();
  if (!ui) return;
  if (ui.il) tabUiState.issueLevel = ui.il;
  if (ui.iq) tabUiState.issueQuery = ui.iq;
  if (ui.hb) tabUiState.httpOnlyBad = true;
  if (ui.hq) tabUiState.httpQuery = ui.hq;
  if (ui.mq) tabUiState.moduleQuery = ui.mq;
  if (ui.sn) tabUiState.showNoise = true;
  if (ui.tq) tabUiState.tlQuery = ui.tq;
  if (Array.isArray(ui.tk)) tabUiState.tlKinds = new Set(ui.tk);
}

// Chỉ đọc/ghi chuỗi, không đặt lại location.hash: trang là SPA, đổi hash có thể làm router chạy lại.
function buildPermalink() {
  // domIndex CHÍNH LÀ vị trí trong entries (analyzeLog gán index của cùng một mảng), nên tra thẳng được.
  const entry = lensState.matches.length
    ? lensState.data.entries[lensState.matches[Math.max(0, lensState.matchPos)]]
    : null;
  const payload = Object.assign({ t: lensState.tab, ln: entry ? entry.lineNo : 0 }, serializeFilter());
  const ui = serializeTabUi();
  if (Object.keys(ui).length) payload.u = ui;
  // Ngưỡng khoảng lặng đi vào chính lúc dựng data, đổi nó là đổi số khoảng lặng người nhận đọc được.
  if (lensState.gapThresholdMs !== DEFAULT_GAP_MS) payload.g = lensState.gapThresholdMs;
  // Minimap đang phóng to: gửi theo độ lệch so với đầu log, cùng cách với cửa sổ thời gian kéo tay.
  if (lensState.mapZoom) {
    payload.z = [lensState.mapZoom.from - lensState.data.firstTs,
      lensState.mapZoom.to - lensState.data.firstTs];
  }
  return location.origin + location.pathname + location.search + PERMALINK_PREFIX +
    encodeURIComponent(JSON.stringify(payload));
}

// Khoảng phóng to của minimap, kẹp về trong log đang mở: link mở nhầm trên log khác thì thà thấy cả
// log còn hơn thấy một khoảng rỗng không có cách nào lùi ra.
function restoreMapZoom(range) {
  const data = lensState.data;
  if (!Array.isArray(range) || range.length !== 2) return;
  const from = Math.max(data.firstTs, Math.min(data.lastTs, data.firstTs + range[0]));
  const to = Math.max(data.firstTs, Math.min(data.lastTs, data.firstTs + range[1]));
  if (to > from) lensState.mapZoom = { from, to };
}

function applyPermalinkFromHash() {
  const hash = location.hash || '';
  if (hash.indexOf(PERMALINK_PREFIX) !== 0) return false;
  let payload;
  try {
    payload = JSON.parse(decodeURIComponent(hash.slice(PERMALINK_PREFIX.length)));
  } catch (error) {
    return false;
  }
  // Ngưỡng khoảng lặng nằm trong buildGaps, tức phải đặt TRƯỚC rồi quét lại — không gọi rescan() vì
  // panel chưa mount ở thời điểm này (startLens gọi hàm này giữa scanLog và mountPanel).
  if (payload.g && payload.g !== lensState.gapThresholdMs) {
    lensState.gapThresholdMs = payload.g;
    scanLog();
  }
  applyFilterPayload(payload);
  applyTabUiPayload(payload.u);
  // Link cũ có thể ghi t='http' hoặc t='slow' — hai tab đã gộp đi. Không chặn thì renderTab rơi vào
  // nhánh else và vẽ tab Diễn biến trong khi thanh tab không có nút nào sáng.
  lensState.tab = TAB_DEFS.some((tab) => tab.id === payload.t) ? payload.t : 'sum';
  const result = applyFilter(false);
  restoreMapZoom(payload.z);
  if (payload.ln) {
    const target = lensState.data.entries.find((entry) => entry.lineNo === payload.ln);
    // Người gửi đang duyệt cả tập dòng khớp (thanh dưới ghi "3/47", bấm n/p đi tiếp được). Đặt matches
    // thành ĐÚNG MỘT dòng thì người nhận thấy "1/1" và n/p chết — cùng một link, hai cách dùng khác hẳn.
    // Không có điều kiện nào thì visible là cả log, lúc đó "duyệt kết quả" không còn nghĩa gì: giữ
    // nguyên cách cũ, chỉ nhảy tới dòng được trỏ.
    const pos = target && hasAnyFilterFacet() ? result.visible.indexOf(target.domIndex) : -1;
    if (pos >= 0) setMatches(result.visible, 'dòng khớp bộ lọc', pos);
    else if (target) setMatches([target.domIndex], 'từ permalink');
  }
  return true;
}

/* ------------------------------------------------ mẫu bộ lọc (lưu trong localStorage) */

function loadFilterTemplates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function persistFilterTemplates() {
  try {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(lensState.filterTemplates));
  } catch (error) {
    // Riêng tư / hết dung lượng: mẫu vẫn dùng được trong phiên này, chỉ không nhớ sang lần sau.
  }
}

function suggestTemplateName() {
  const facets = getActiveFilterFacets();
  return facets.length ? facets.map((facet) => facet.label).join(' · ').slice(0, 60) : '';
}

function saveCurrentFilterAsTemplate(rawName) {
  const name = (rawName || suggestTemplateName()).trim();
  if (!name || !hasAnyFilterFacet()) return false;
  lensState.filterTemplates = lensState.filterTemplates.filter((item) => item.name !== name);
  lensState.filterTemplates.unshift({ name, payload: serializeFilter(), savedAt: Date.now() });
  lensState.filterTemplates = lensState.filterTemplates.slice(0, MAX_FILTER_TEMPLATES);
  persistFilterTemplates();
  return true;
}

function deleteFilterTemplate(name) {
  lensState.filterTemplates = lensState.filterTemplates.filter((item) => item.name !== name);
  persistFilterTemplates();
}

function applyFilterTemplate(name) {
  const template = lensState.filterTemplates.find((item) => item.name === name);
  if (!template) return;
  applyFilterPayload(template.payload);
  applyFilter(true);
}

// Mô tả ngắn một mẫu để hiện làm tooltip — đọc được mà không cần áp thử.
function describeTemplatePayload(payload) {
  const parts = [];
  if (payload.wLast) parts.push(formatWindowPresetLabel(payload.wLast));
  else if (payload.f >= 0 || payload.tt >= 0) parts.push('khoảng thời gian cố định');
  if (payload.d) parts.push('bỏ khối lặp');
  if (payload.h === 0) parts.push('không ẩn dòng khác');
  if (payload.s) parts.push(sessionLabel(payload.s).toLowerCase());
  if (payload.lv && payload.lv.length) parts.push(payload.lv.join(' + '));
  if (payload.md && payload.md.length) {
    parts.push(payload.md.length === 1 ? payload.md[0] : payload.md.length + ' module');
  }
  if (payload.q) parts.push((payload.re ? '/' : '"') + payload.q + (payload.re ? '/' : '"'));
  return parts.join(' · ') || 'không có điều kiện nào';
}

function applyFilter(shouldNavigate) {
  const result = computeFilteredIndices();
  if (shouldNavigate) setMatches(result.visible, 'dòng khớp bộ lọc');
  refreshFilterBar();
  return result;
}
// @ts-check
// thanh bộ lọc thường trú: chip facet, cửa sổ thời gian, gỡ từng điều kiện
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

/* ------------------------------- thanh bộ lọc thường trú (hiện ở mọi tab) */

// Bộ lọc là state chung nhưng trước đây chỉ nhìn thấy được trong tab Lọc: đổi sang tab khác
// là không còn dấu hiệu nào cho biết bảng log đang bị cắt bớt. Thanh này hiện ở mọi tab.
function formatWindowLabel() {
  const filter = lensState.filter;
  const data = lensState.data;
  // Đang bật preset thì gọi tên preset. Đọc từ filter.windowPreset chứ không suy ngược từ hai mốc:
  // trên log ngắn hơn preset, timeFrom bị kẹp về firstTs nên hiệu hai mốc nhỏ hơn preset và nhãn rơi
  // vào nhánh giờ tuyệt đối.
  if (filter.windowPreset) return formatWindowPresetLabel(filter.windowPreset);
  const from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
  const to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
  return formatClock(from) + ' → ' + formatClock(to);
}

function formatWindowPresetLabel(ms) {
  return ms < 60000 ? ms / 1000 + ' giây cuối' : ms / 60000 + ' phút cuối';
}

function isWindowPresetActive(ms) {
  const filter = lensState.filter;
  if (!ms) return filter.timeFrom === null && filter.timeTo === null;
  return filter.windowPreset === ms;
}

function setTimeWindowPreset(ms) {
  const filter = lensState.filter;
  filter.windowPreset = ms || null;
  if (!ms) {
    filter.timeFrom = null;
    filter.timeTo = null;
    return;
  }
  filter.timeTo = lensState.data.lastTs;
  // Vẫn kẹp về firstTs (không lọc mất gì trên log ngắn hơn preset), nhưng preset đã được nhớ riêng
  // nên việc kẹp không còn làm chip tắt.
  filter.timeFrom = Math.max(lensState.data.firstTs, lensState.data.lastTs - ms);
}

function getActiveFilterFacets() {
  const filter = lensState.filter;
  const facets = [];
  if (filter.timeFrom !== null || filter.timeTo !== null) {
    facets.push({ id: 'window', label: formatWindowLabel() });
  }
  if (filter.skipDuplicate) facets.push({ id: 'duplicate', label: 'bỏ khối lặp' });
  if (filter.session) facets.push({ id: 'session', label: sessionLabel(filter.session) });
  if (filter.levels.size) facets.push({ id: 'levels', label: Array.from(filter.levels).join(' + ') });
  if (filter.modules.size) {
    facets.push({ id: 'modules', label: filter.modules.size === 1
      ? Array.from(filter.modules)[0]
      : filter.modules.size + ' module' });
  }
  if (filter.text) facets.push({ id: 'text', label: (filter.useRegex ? '/' : '"') + filter.text + (filter.useRegex ? '/' : '"') });
  return facets;
}

function clearFilterFacet(facetId) {
  const filter = lensState.filter;
  if (facetId === 'window') {
    filter.timeFrom = null;
    filter.timeTo = null;
    filter.windowPreset = null;
  }
  else if (facetId === 'duplicate') filter.skipDuplicate = false;
  else if (facetId === 'session') filter.session = null;
  else if (facetId === 'levels') filter.levels.clear();
  else if (facetId === 'modules') filter.modules.clear();
  else if (facetId === 'text') filter.text = '';
}

function refreshFilterBar() {
  const bar = lensState.el.bar;
  if (!bar || !lensState.data) return;
  updateMinimapRange();
  const facets = getActiveFilterFacets();
  if (!facets.length) {
    bar.hidden = true;
    bar.innerHTML = '';
    positionSheetBelowTimeline();
    return;
  }
  const forced = lensState.forcedVisibleIndices.size;
  bar.hidden = false;
  bar.innerHTML =
    '<span class="fll-bar-t">' + facets.length + ' bộ lọc đang bật</span>' +
    '<span class="fll-bar-n">hiện ' + (lensState.visibleCount + forced) + '/' + lensState.data.entries.length + ' dòng' +
    (forced ? ' · ' + forced + ' dòng ngoài lọc' : '') + '</span>' +
    '<div class="fll-fchips">' + facets
      .map((facet) => '<span class="fll-fchip"><b>' + escapeHtml(facet.label) + '</b>' +
        '<button data-act="clearFacet" data-value="' + facet.id + '" data-tip="Bỏ điều kiện này">&times;</button>' +
        '</span>')
      .join('') +
    '<button class="fll-fclear" data-act="clearFilters">Xoá tất cả</button></div>';
  // Đo SAU khi đã có nội dung: thanh bộ lọc chưa có chữ thì chiều cao chưa đúng.
  positionSheetBelowTimeline();
}

function resetFilter() {
  lensState.filter.levels.clear();
  lensState.filter.modules.clear();
  lensState.filter.text = '';
  lensState.filter.timeFrom = null;
  lensState.filter.timeTo = null;
  lensState.filter.session = null;
  lensState.filter.skipDuplicate = false;
  // Mọi điều kiện đã rỗng nên lượt này chỉ chạm vào đúng những dòng đang bị ẩn.
  computeFilteredIndices();
  if (lensState.el.lastHit) lensState.el.lastHit.classList.remove('fll-hit');
  lensState.el.lastHit = null;
  lensState.matches = [];
  lensState.matchPos = -1;
  renderFooter();
  refreshFilterBar();
}

// Lọc TRƯỚC rồi mới chuyển tab, không được làm ngược lại: switchTab() vẽ tab ngay lập tức, mà lúc đó
// bộ lọc mới chỉ nằm trong lensState.filter chứ view chưa tính lại — tab Lọc hiện ra với mục "Mức độ:
// ERROR" nhưng "Kết quả 9609/9609" và danh sách module của cả log, và nó đứng nguyên như vậy cho tới
// lần vẽ sau. Đo trên log production: bấm thẻ ERROR (56/9609 dòng) xong tab Lọc vẫn ghi 9609/9609.
// applyFilter() không tự vẽ lại tab nên đổi thứ tự không tốn thêm lần vẽ nào.
function filterByModule(moduleName) {
  lensState.filter.modules = new Set([moduleName]);
  lensState.filter.hideOthers = true;
  applyFilter(true);
  switchTab('flt');
}

function filterByLevel(level) {
  lensState.filter.levels = new Set([level]);
  lensState.filter.hideOthers = true;
  applyFilter(true);
  switchTab('flt');
}
// @ts-check
// minimap mật độ log và thao tác kéo chọn khoảng thời gian trên nó
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

/* ----------------------------------------------------------------- minimap */

// Minimap vẽ trong khoảng nào: cả log, hay chỉ khoảng đang phóng to. Mọi chỗ quy đổi thời gian <-> toạ
// độ đều phải đi qua đây, nếu không thì phóng to xong vạch đánh dấu và vị trí cuộn sẽ lệch hết.
function minimapBounds() {
  const zoom = lensState.mapZoom;
  if (zoom) return { from: zoom.from, to: zoom.to };
  return { from: lensState.data.firstTs, to: lensState.data.lastTs };
}

function buildBuckets(count) {
  const data = lensState.data;
  const bounds = minimapBounds();
  const span = Math.max(1, bounds.to - bounds.from);
  const buckets = [];
  for (let i = 0; i < count; i += 1) buckets.push({ ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0, total: 0, firstIndex: -1 });
  data.entries.forEach((entry) => {
    if (!entry.ts || !entry.level) return;
    if (entry.ts < bounds.from || entry.ts > bounds.to) return;
    const slot = Math.min(count - 1, Math.floor(((entry.ts - bounds.from) / span) * count));
    const bucket = buckets[slot];
    bucket[entry.level] = (bucket[entry.level] || 0) + 1;
    bucket.total += 1;
    if (bucket.firstIndex < 0) bucket.firstIndex = entry.domIndex;
  });
  return buckets;
}

function renderMinimap() {
  const buckets = buildBuckets(MINIMAP_BUCKETS);
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const columns = buckets
    .map((bucket, index) => {
      let color = '#2a2436';
      if (bucket.ERROR) color = LEVEL_COLOR.ERROR;
      else if (bucket.WARNING) color = LEVEL_COLOR.WARNING;
      else if (bucket.INFO) color = 'rgba(88,196,255,.55)';
      else if (bucket.DEBUG) color = 'rgba(125,133,144,.5)';
      const height = bucket.total ? 12 + (Math.log(1 + bucket.total) / Math.log(1 + peak)) * 88 : 4;
      const bounds = minimapBounds();
      const title = bucket.total
        ? formatClock(bounds.from + ((bounds.to - bounds.from) * index) / MINIMAP_BUCKETS) +
          ' · ' + bucket.total + ' dòng (' + bucket.ERROR + ' lỗi, ' + bucket.WARNING + ' cảnh báo)'
        : 'không có log';
      return '<i data-bucket="' + bucket.firstIndex + '" data-tip="' + escapeHtml(title) + '" style="height:' +
        height.toFixed(1) + '%;background:' + color + '"></i>';
    })
    .join('');
  // Minimap cố ý giữ NGUYÊN toàn dải: nó là tấm bản đồ "đang ở đâu trong cả log".
  // Bộ lọc thời gian chỉ làm mờ phần ngoài cửa sổ, vẫn thấy được toàn cảnh.
  lensState.el.map.innerHTML = columns +
    '<div class="fll-shade fll-shade-l"></div><div class="fll-shade fll-shade-r"></div>' +
    '<div class="fll-cursor"></div>';
  lensState.el.cursor = lensState.el.map.querySelector('.fll-cursor');
  lensState.el.shadeLeft = lensState.el.map.querySelector('.fll-shade-l');
  lensState.el.shadeRight = lensState.el.map.querySelector('.fll-shade-r');
  const bounds = minimapBounds();
  lensState.el.mapLabel.innerHTML =
    '<span>' + formatClock(bounds.from) + '</span>' +
    '<span class="fll-maptext"></span>' +
    (lensState.mapZoom
      ? '<span class="fll-maprow">' + formatClock(bounds.to) +
        '<button class="fll-mapzoom on" data-act="mapZoomOut" data-tip="Lùi một nấc phóng to' +
        (lensState.mapZoomStack.length > 1
          ? ' — còn ' + (lensState.mapZoomStack.length - 1) + ' nấc nữa mới về cả log'
          : ' — về lại cả log') + '">&#8617;</button>' +
        // Chỉ hiện khi còn NHIỀU HƠN một nấc: còn đúng một nấc thì nó làm y hệt nút lùi, để cạnh nhau
        // hai nút giống nhau chỉ tổ người dùng phải đoán xem chúng khác gì.
        (lensState.mapZoomStack.length > 1
          ? '<button class="fll-mapzoom" data-act="mapZoomReset" data-tip="Xoá cả ' +
            lensState.mapZoomStack.length + ' nấc phóng to, về thẳng toàn bộ log">&#10005;</button>'
          : '') + '</span>'
      : '<span>' + formatClock(bounds.to) + '</span>');
  lensState.el.map.classList.toggle('fll-map-zoomed', !!lensState.mapZoom);
  lensState.el.mapText = lensState.el.mapLabel.querySelector('.fll-maptext');
  updateMinimapRange();
}

// Vùng phóng to là "cái nhìn", bộ lọc là "tập dòng" — hai thứ cố ý độc lập, nên đổi bộ lọc KHÔNG tự bỏ
// phóng to. Nhưng có một ca mà giữ nguyên là hỏng hẳn: khoảng đang chọn rơi ra NGOÀI vùng đang phóng
// (đang phóng vào phiên 1 rồi bấm sang phiên 2). Minimap vẫn vẽ vùng cũ, phần tô nằm ngoài khung nên
// biến mất sạch — người dùng thấy "chọn phiên 2 mà chẳng có gì được chọn", và không có dấu hiệu nào nói
// rằng phải lùi phóng to ra mới thấy.
//
// Hai lựa chọn trong cách viết điều kiện, chọn cái rộng hơn:
//   - KHÔNG GIAO NHAU (đang dùng): chỉ cần còn thấy một phần khoảng chọn là còn đường lần ra, giữ nguyên.
//   - "không chứa trọn" thì quá chặt: bỏ hết bộ lọc (khoảng = cả log) cũng làm bung sạch phóng to, tức
//     là bộ lọc lại điều khiển cái nhìn — đúng thứ mà hai trạng thái này cố ý tách ra.
// Lùi từng nấc theo đúng ngăn xếp phóng to chứ không nhảy thẳng về cả log: nấc ngoài mà đã thấy được
// khoảng mới thì dừng ngay ở đó, người dùng giữ lại được phần lớn độ phóng đang có.
function releaseZoomOutsideRange() {
  if (!lensState.mapZoom || !lensState.data) return false;
  const range = getVisibleTimeRange();
  let changed = false;
  while (lensState.mapZoom && (range.to < lensState.mapZoom.from || range.from > lensState.mapZoom.to)) {
    lensState.mapZoom = lensState.mapZoomStack.length ? lensState.mapZoomStack.pop() : null;
    changed = true;
  }
  return changed;
}

function updateMinimapRange() {
  // Đặt TRƯỚC mọi guard DOM: đây là trạng thái, không phải phần vẽ — panel chưa dựng thì vẫn phải đúng.
  // Vẽ lại cả minimap chứ không chỉ phần tô, vì các cột được chia theo đúng khung đang phóng.
  // renderMinimap() gọi ngược lại hàm này, nhưng lúc đó vùng phóng đã hợp lệ nên không lặp tiếp.
  if (releaseZoomOutsideRange() && lensState.el.map) {
    renderMinimap();
    return;
  }
  const shadeLeft = lensState.el.shadeLeft;
  const shadeRight = lensState.el.shadeRight;
  if (!shadeLeft || !shadeRight || !lensState.data) return;
  const bounds = minimapBounds();
  const span = Math.max(1, bounds.to - bounds.from);
  const range = getVisibleTimeRange();
  shadeLeft.style.width =
    Math.max(0, Math.min(100, ((range.from - bounds.from) / span) * 100)).toFixed(2) + '%';
  shadeRight.style.width =
    Math.max(0, Math.min(100, ((bounds.to - range.to) / span) * 100)).toFixed(2) + '%';
  lensState.el.map.classList.toggle('fll-map-ranged', hasSelectedTimeRange());
  if (!lensState.el.mapText) return;
  if (hasSelectedTimeRange()) {
    lensState.el.mapText.innerHTML = escapeHtml(formatClock(range.from) + ' → ' + formatClock(range.to) +
      ' · ' + formatDuration(range.to - range.from)) +
      (canZoomFurther(range, bounds) ? ' <button class="fll-mapzoom" data-act="mapZoomIn" ' +
        'data-tip="Phóng minimap vào đúng khoảng này để nhìn rõ từng mốc">&#8596; phóng to</button>' : '');
    return;
  }
  lensState.el.mapText.textContent = lensState.mapZoom
    ? 'đang phóng to · kéo để chọn khoảng nhỏ hơn'
    : 'kéo để chọn khoảng · bấm để nhảy · nháy đúp để bỏ chọn';
}

// Nút "phóng to" hiện khi khoảng đang chọn NHỎ HƠN khung minimap đang vẽ — không quan tâm đã phóng
// to hay chưa. Trước đây cứ thấy đang phóng to là ẩn nút, nên chọn tiếp một khoảng nhỏ hơn bên trong
// vùng đã phóng thì không còn đường nào phóng sâu nữa. Chỉ giấu khi chọn đúng bằng khung đang vẽ, lúc
// đó bấm vào không đổi được gì.
function canZoomFurther(range, bounds) {
  return range.from > bounds.from || range.to < bounds.to;
}

function hasAnyTimeRange() {
  return lensState.filter.timeFrom !== null || lensState.filter.timeTo !== null;
}

// "Có khoảng đang chọn không" phải hỏi getVisibleTimeRange(), không hỏi riêng timeFrom/timeTo: lọc
// theo PHIÊN APP cũng thu khoảng đang xem về đúng phiên đó (getVisibleTimeRange cắt theo start/endTs
// của phiên) mà không đụng tới hai trường kia. Vì vậy minimap vẫn tô mờ hai bên đúng phiên nhưng lại
// không hiện nút phóng to — muốn phóng vào một phiên thì phải tự kéo tay lại đúng khoảng đã được tô
// sẵn. Hai câu hỏi đó phải cho cùng một câu trả lời, nếu không thì phần tô và cái nút nói khác nhau.
function hasSelectedTimeRange() {
  if (hasAnyTimeRange()) return true;
  const range = getVisibleTimeRange();
  return range.from > lensState.data.firstTs || range.to < lensState.data.lastTs;
}

/* ------------------------------------------- kéo chọn khoảng thời gian trên minimap */

const MINIMAP_EDGE_GRAB_PX = 7;
const MINIMAP_MIN_RANGE_MS = 500;

let minimapDrag = null;

function minimapTsFromClientX(clientX) {
  const rect = lensState.el.map.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  const bounds = minimapBounds();
  return bounds.from + ratio * Math.max(1, bounds.to - bounds.from);
}

// Ép về trong bề ngang của minimap: khi đang phóng to, mốc nằm ngoài khung sẽ cho toạ độ âm hoặc vượt
// ra ngoài — ép vào mép để mũi tên vẫn chỉ đúng "nó ở phía bên kia" thay vì vẽ ra ngoài panel.
function minimapClientXFromTs(ts) {
  const rect = lensState.el.map.getBoundingClientRect();
  const bounds = minimapBounds();
  const ratio = (ts - bounds.from) / Math.max(1, bounds.to - bounds.from);
  return rect.left + Math.max(0, Math.min(1, ratio)) * rect.width;
}

// Chỉ vẽ lại hai miếng mờ trong lúc kéo. Áp bộ lọc thật sự đòi một lượt 4085 dòng + layout bảng log,
// nặng quá để chạy theo từng nhịp chuột — nên chỉ commit lúc thả tay.
function previewMinimapRange(from, to) {
  const bounds = minimapBounds();
  const span = Math.max(1, bounds.to - bounds.from);
  lensState.el.shadeLeft.style.width =
    Math.max(0, Math.min(100, ((from - bounds.from) / span) * 100)).toFixed(2) + '%';
  lensState.el.shadeRight.style.width =
    Math.max(0, Math.min(100, ((bounds.to - to) / span) * 100)).toFixed(2) + '%';
  if (lensState.el.mapText) {
    lensState.el.mapText.textContent = formatClock(from) + ' → ' + formatClock(to) +
      ' · ' + formatDuration(Math.max(0, to - from));
  }
}

function resolveMinimapDragMode(clientX) {
  const filter = lensState.filter;
  if (filter.timeFrom === null && filter.timeTo === null) return 'create';
  const range = getVisibleTimeRange();
  // Vùng sáng phủ kín cả minimap (hay gặp ngay sau khi phóng to: khung vẽ đúng bằng khoảng đang chọn)
  // thì "dời" và "co giãn" đều vô nghĩa — không còn chỗ nào để dời tới. Coi mọi cú kéo là chọn mới,
  // nếu không thì phóng to xong là không thể chọn một khoảng nhỏ hơn nữa.
  const bounds = minimapBounds();
  if (range.from <= bounds.from && range.to >= bounds.to) return 'create';
  if (Math.abs(clientX - minimapClientXFromTs(range.from)) <= MINIMAP_EDGE_GRAB_PX) return 'resizeStart';
  if (Math.abs(clientX - minimapClientXFromTs(range.to)) <= MINIMAP_EDGE_GRAB_PX) return 'resizeEnd';
  if (clientX > minimapClientXFromTs(range.from) && clientX < minimapClientXFromTs(range.to)) return 'move';
  return 'create';
}

function handleMinimapMouseDown(event) {
  if (!lensState.data || !lensState.el.shadeLeft) return;
  const range = getVisibleTimeRange();
  minimapDrag = {
    mode: resolveMinimapDragMode(event.clientX),
    startX: event.clientX,
    anchorTs: minimapTsFromClientX(event.clientX),
    from: range.from,
    to: range.to,
    previewFrom: range.from,
    previewTo: range.to,
    hasMoved: false,
  };
  window.addEventListener('mousemove', handleMinimapMouseMove);
  window.addEventListener('mouseup', handleMinimapMouseUp);
  event.preventDefault();
}

function handleMinimapMouseMove(event) {
  if (!minimapDrag) return;
  if (!minimapDrag.hasMoved && Math.abs(event.clientX - minimapDrag.startX) <= 2) return;
  minimapDrag.hasMoved = true;

  const data = lensState.data;
  const bounds = minimapBounds();
  const ts = minimapTsFromClientX(event.clientX);
  let from = minimapDrag.from;
  let to = minimapDrag.to;

  if (minimapDrag.mode === 'create') {
    from = Math.min(minimapDrag.anchorTs, ts);
    to = Math.max(minimapDrag.anchorTs, ts);
  } else if (minimapDrag.mode === 'resizeStart') {
    from = Math.min(ts, minimapDrag.to - MINIMAP_MIN_RANGE_MS);
  } else if (minimapDrag.mode === 'resizeEnd') {
    to = Math.max(ts, minimapDrag.from + MINIMAP_MIN_RANGE_MS);
  } else {
    const delta = ts - minimapDrag.anchorTs;
    from = minimapDrag.from + delta;
    to = minimapDrag.to + delta;
    if (from < bounds.from) {
      to += bounds.from - from;
      from = bounds.from;
    }
    if (to > bounds.to) {
      from -= to - bounds.to;
      to = bounds.to;
    }
  }
  void data;

  minimapDrag.previewFrom = Math.max(bounds.from, from);
  minimapDrag.previewTo = Math.min(bounds.to, to);
  previewMinimapRange(minimapDrag.previewFrom, minimapDrag.previewTo);
}

function handleMinimapMouseUp() {
  window.removeEventListener('mousemove', handleMinimapMouseMove);
  window.removeEventListener('mouseup', handleMinimapMouseUp);
  const drag = minimapDrag;
  minimapDrag = null;
  // Bấm không kéo: để nguyên cho handleLensClick nhảy tới mốc đó như cũ.
  if (!drag || !drag.hasMoved) return;
  // Đã kéo thì chặn cú click sinh ra ngay sau mouseup, không thì vừa chọn xong lại nhảy lung tung.
  lensState.suppressMapClick = true;
  setTimeout(() => {
    lensState.suppressMapClick = false;
  }, 0);

  if (drag.previewTo - drag.previewFrom < MINIMAP_MIN_RANGE_MS) clearFilterFacet('window');
  else {
    lensState.filter.timeFrom = drag.previewFrom;
    lensState.filter.timeTo = drag.previewTo;
    // Kéo tay là khoảng tự chọn: không còn là preset nào nữa, chip "N phút cuối" phải tắt.
    lensState.filter.windowPreset = null;
    lensState.filter.hideOthers = true;
  }
  applyFilter(true);
  renderTab();
}

function handleMinimapHover(event) {
  if (minimapDrag || !lensState.data) return;
  const mode = resolveMinimapDragMode(event.clientX);
  lensState.el.map.style.cursor =
    mode === 'move' ? 'grab' : mode === 'create' ? 'crosshair' : 'col-resize';
}

function handleMinimapDoubleClick() {
  clearFilterFacet('window');
  applyFilter(true);
  renderTab();
}

function updateMinimapCursor(ts) {
  const cursor = lensState.el.cursor;
  if (!cursor) return;
  if (!ts) {
    cursor.style.opacity = '0';
    return;
  }
  const bounds = minimapBounds();
  const ratio = (ts - bounds.from) / Math.max(1, bounds.to - bounds.from);
  if (ratio < 0 || ratio > 1) {
    // Dòng đang cuộn tới nằm ngoài khung đang phóng to: ẩn vạch đi còn hơn là ghim nó ở mép, vì ghim
    // ở mép thì người đọc tưởng mình đang ở đầu khoảng.
    cursor.style.opacity = '0';
    return;
  }
  cursor.style.left = (ratio * 100).toFixed(2) + '%';
  cursor.style.opacity = '1';
}
// @ts-check
// kéo thả panel, đổi kích thước, nhớ lại vị trí
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

/* ------------------------------------------------- kéo thả và đổi kích thước */

function clampValue(value, min, max) {
  return Math.max(min, Math.min(Math.max(min, max), value));
}

// Panel mặc định neo phải (top/right/bottom trong CSS) nên chiều cao là ngầm.
// Khi kéo đi hoặc kéo góc thì ghim hẳn sang left/top/width/height để hai chiều đều chỉnh được.
function isPanelRightAnchored(panel) {
  return !panel.style.left || panel.style.left === 'auto';
}

function savePanelGeometry(panel) {
  const rect = panel.getBoundingClientRect();
  lensState.geometry = {
    width: rect.width,
    height: rect.height,
    left: rect.left,
    top: rect.top,
    isPinned: !isPanelRightAnchored(panel),
  };
}

function applyPanelGeometry(panel) {
  const geometry = lensState.geometry;
  if (!geometry) return;
  panel.style.width = geometry.width + 'px';
  if (!geometry.isPinned) return;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panel.style.left = clampValue(geometry.left, 0, window.innerWidth - 120) + 'px';
  panel.style.top = clampValue(geometry.top, 0, window.innerHeight - 60) + 'px';
  panel.style.height = geometry.height + 'px';
}

// mousemove/mouseup chỉ được gắn trong lúc kéo rồi gỡ ngay, không gắn thường trú:
// mountPanel() chạy lại mỗi lần mở từ pill, gắn thường trú sẽ cộng dồn listener.
// Chặn bôi đen chữ trong lúc kéo bằng cách nuốt sự kiện 'selectstart', KHÔNG bằng
// document.body.style.userSelect = 'none'.
//
// user-select là thuộc tính KẾ THỪA, nên đặt nó lên <body> bắt trình duyệt tính lại style cho toàn bộ
// tài liệu. Đo trên trang admin thật (9363 dòng log, 40 537 node): bật mất 213.7ms, trả lại mất
// 176.5ms — hai cú khựng gần một phần năm giây, đúng một khung sau mousedown và một khung sau mouseup.
// Giữa cú kéo thì mượt (p50 16.7ms), và lúc không kéo thì 181 khung liên tiếp không rớt cái nào, nên
// nhìn vào chỉ thấy "kéo panel bị giật" mà không đoán ra vì sao.
// Đối chứng cùng lượt đo: panel.classList.add('fll-dragging') chỉ tốn 1.3ms, và số node TRONG panel
// không ảnh hưởng gì (4406 node so với 400 node cho cùng một con số).
function blockSelectStart(event) {
  event.preventDefault();
}

function enableDragAndResize(panel, header, edgeGrip, cornerGrip) {
  let mode = null;
  let origin = null;
  let pendingEvent = null;
  let isFramePending = false;

  function beginInteraction(nextMode, event) {
    const rect = panel.getBoundingClientRect();
    origin = {
      x: event.clientX,
      y: event.clientY,
      rect,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      wasRightAnchored: isPanelRightAnchored(panel),
      // Khai báo hẳn ở đây thay vì gán thêm sau: gán thêm thì gõ sai tên một chữ là im lặng hỏng.
      /** @type {number | undefined} */
      committedLeft: undefined,
    };
    mode = nextMode;
    if (nextMode !== 'edge') {
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.width = rect.width + 'px';
      panel.style.height = rect.height + 'px';
    }
    panel.classList.add('fll-dragging');
    window.addEventListener('selectstart', blockSelectStart);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    event.preventDefault();
  }

  // mousemove bắn dày hơn tần số khung hình, nên gom lại một lần cập nhật mỗi frame.
  function handleMove(event) {
    if (!mode) return;
    pendingEvent = event;
    if (isFramePending) return;
    isFramePending = true;
    requestAnimationFrame(applyPendingMove);
  }

  function applyPendingMove() {
    isFramePending = false;
    const event = pendingEvent;
    if (!mode || !event) return;

    if (mode === 'move') {
      // Di chuyển bằng transform chứ không phải left/top: transform được compositor xử lý,
      // không bắt trình duyệt layout lại và vẽ lại vùng panel (kèm bóng mờ 70px) mỗi khung hình.
      // Chốt lại thành left/top lúc thả tay.
      const left = clampValue(event.clientX - origin.grabX, VIEWPORT_MARGIN - origin.rect.width + 140,
        window.innerWidth - 140);
      const top = clampValue(event.clientY - origin.grabY, 0, window.innerHeight - 60);
      origin.committedLeft = left;
      origin.committedTop = top;
      panel.style.transform = 'translate3d(' + (left - origin.rect.left) + 'px,' +
        (top - origin.rect.top) + 'px,0)';
      return;
    }

    if (mode === 'corner') {
      panel.style.width = clampValue(event.clientX - origin.rect.left, PANEL_MIN_WIDTH,
        window.innerWidth - origin.rect.left - VIEWPORT_MARGIN) + 'px';
      panel.style.height = clampValue(event.clientY - origin.rect.top, PANEL_MIN_HEIGHT,
        window.innerHeight - origin.rect.top - VIEWPORT_MARGIN) + 'px';
      return;
    }

    // 'edge': kéo mép trái, giữ nguyên mép phải ở cả hai kiểu neo.
    const width = clampValue(origin.rect.width + (origin.x - event.clientX), PANEL_MIN_WIDTH,
      origin.rect.right - VIEWPORT_MARGIN);
    panel.style.width = width + 'px';
    if (!origin.wasRightAnchored) panel.style.left = origin.rect.right - width + 'px';
  }

  function handleUp() {
    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('mouseup', handleUp);
    window.removeEventListener('selectstart', blockSelectStart);
    if (!mode) return;
    // Chốt transform thành vị trí thật trước khi đo lại kích thước, không thì getBoundingClientRect
    // vẫn đang cộng thêm phần dịch chuyển.
    if (mode === 'move' && origin.committedLeft !== undefined) {
      panel.style.transform = '';
      panel.style.left = origin.committedLeft + 'px';
      panel.style.top = origin.committedTop + 'px';
    }
    mode = null;
    pendingEvent = null;
    panel.classList.remove('fll-dragging');
    savePanelGeometry(panel);
  }

  header.addEventListener('mousedown', (event) => {
    if (event.target.closest('.fll-ico')) return;
    beginInteraction('move', event);
  });
  edgeGrip.addEventListener('mousedown', (event) => beginInteraction('edge', event));
  cornerGrip.addEventListener('mousedown', (event) => beginInteraction('corner', event));
}

/* ------------------------------------------------------------- phím tắt */

// Esc chỉ thu về pill, không huỷ panel: nếu huỷ thì không còn gì để bấm mở lại.
// Nút "x" mới đóng hẳn, và Alt+L là đường quay lại — listener này cố ý giữ sống sau khi đóng.
//
// Đã đo trên trang thật: khi trang admin nhận được Escape, chính nó gọi removeChild gỡ #fll-root
// ra khỏi body (không phải code ở đây — bẫy Element.prototype.remove không bắt được gì).
// Vì vậy listener gắn ở capture phase trên window và chặn lan truyền với những phím mình xử lý,
// để trang không bao giờ thấy Escape khi panel đang mở. LENS_KEY_LISTENER_OPTIONS phải đúng
// y hệt nhau lúc thêm và lúc gỡ, nếu khác thì removeEventListener không ăn.
const LENS_KEY_LISTENER_OPTIONS = true;

function isLensMounted() {
  return !!document.getElementById(ROOT_ID);
}

function handleShortcut(event) {
  // Instance cũ (world khác) không được giành phím với instance đang làm chủ.
  if (!isLensOwner()) return;
  const target = event.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

  if (event.altKey && (event.code === 'KeyL' || event.key === 'l' || event.key === 'L')) {
    event.preventDefault();
    event.stopPropagation();
    if (!isLensMounted()) startLens(false);
    else if (!lensState.el.panel || !document.contains(lensState.el.panel)) mountPanel();
    return;
  }

  if (!isLensMounted()) return;
  if (event.key === 'n') {
    event.stopPropagation();
    moveMatch(1);
  } else if (event.key === 'N' || event.key === 'p') {
    event.stopPropagation();
    moveMatch(-1);
  } else if (event.key === 'Escape' && lensState.el.panel && document.contains(lensState.el.panel)) {
    event.preventDefault();
    event.stopPropagation();
    showPill();
  }
}
// @ts-check
// di chuột qua một mục bất kỳ: vẽ mũi tên từ mục đó lên đúng vị trí của nó trên minimap
//
// Vấn đề: mỗi hàng trong mỗi tab đều có giờ và số dòng, nhưng đó là CON SỐ. Người đọc phải tự dịch
// "10:02:50" ra "khoảng giữa log" mới biết nó nằm ở đâu trong cả phiên. Minimap ngay trên đầu đã là
// trục thời gian rồi — chỉ thiếu một đường nối giữa hai cái.
//
// Vẽ bằng MỘT lớp SVG phủ lên cả panel (pointer-events:none) chứ không chèn thẻ vào từng hàng: như vậy
// không renderer nào phải biết đến chuyện này, và tab mới thêm sau này tự động có luôn.

const AIM_SELECTOR = '[data-aim],[data-lines],[data-jump],[data-bucket],[data-group],[data-call],' +
  '[data-saw],[data-apifail],[data-jscreen],[data-jtap],[data-jload],[data-tracefail],' +
  '[data-env],[data-envapp]';
// Một nhóm lỗi có thể có hàng trăm dòng. Vẽ hết thì minimap thành một mảng đỏ đặc, nhìn không ra gì;
// 60 vạch đã đủ dày để thấy "rải đều" hay "dồn một chỗ".
const AIM_MAX_TICKS = 60;

// Cùng một cách đọc như handleLensClick — một hàng trỏ tới những dòng nào thì mũi tên chỉ tới đúng
// những dòng đó. Tách ra hàm riêng để test gọi được mà không cần DOM thật.
function aimIndicesFor(el) {
  const view = getView();
  const data = el.dataset;
  // data-aim = "phần tử này trỏ tới những dòng này, nhưng BẤM vào nó lại làm việc khác". Chip phiên app
  // là ca duy nhất đang dùng: bấm vào là lọc theo phiên, còn rê chuột thì vẫn phải chỉ được ra chỗ
  // phiên đó bắt đầu trên minimap. Vì vậy nó KHÔNG nằm trong danh sách của handleLensClick — thêm vào
  // đó là cú bấm biến thành lệnh nhảy dòng và mất luôn bộ lọc.
  if (data.aim != null) return data.aim.split(',').map(Number).filter((index) => !Number.isNaN(index));
  // data-lines đi trước data-jump: hàng ứng với nhiều dòng (nhóm lỗi, hai đầu một khoảng lặng) thì mũi
  // tên phải đánh dấu hết, không chỉ dòng đầu.
  if (data.lines != null) return data.lines.split(',').map(Number).filter((index) => !Number.isNaN(index));
  if (data.jump != null) return [Number(data.jump)];
  if (data.bucket != null) return Number(data.bucket) >= 0 ? [Number(data.bucket)] : [];
  if (data.group != null) {
    const group = view.groups[Number(data.group)];
    return group ? group.indices : [];
  }
  if (data.call != null) {
    const call = view.httpCalls[Number(data.call)];
    return call ? [call.reqIndex, call.resIndex].filter((index) => index != null) : [];
  }
  if (data.saw != null) {
    const row = view.journey.saw[Number(data.saw)];
    return row ? row.indices : [];
  }
  if (data.apifail != null) {
    const row = view.journey.fails[Number(data.apifail)];
    return row ? row.indices : [];
  }
  if (data.tracefail != null) {
    const row = view.traceIssues.fails[Number(data.tracefail)];
    return row ? row.indices : [];
  }
  if (data.jscreen != null) {
    const row = view.journey.screens.find((item) => item.key === data.jscreen);
    return row ? row.indices : [];
  }
  if (data.jtap != null) {
    const row = view.journey.taps.find((item) => item.key === data.jtap);
    return row ? row.indices : [];
  }
  if (data.jload != null) {
    const row = view.journey.screenLoads.find((item) => item.key === data.jload);
    return row ? row.indices : [];
  }
  // "trường:giá trị" trong mục Máy & môi trường — trỏ tới đúng những dòng đã khai ra giá trị đó, để
  // thấy nó xuất hiện lúc nào trên minimap (múi giờ đổi lúc nào, bản app cũ dừng ở đâu).
  if (data.env != null) {
    const at = data.env.split(':');
    const field = view.environment.watched[Number(at[0])];
    const item = field && field.values[Number(at[1])];
    return item ? item.indices : [];
  }
  // "<thứ tự miniapp>" = mọi request của miniapp đó; "<miniapp>:<thứ tự bundle>" = những dòng nạp
  // đúng bản build đó.
  if (data.envapp != null) {
    const at = data.envapp.split(':');
    const app = view.environment.miniApps[Number(at[0])];
    if (!app) return [];
    if (at.length < 2) return app.indices;
    const bundle = app.bundles[Number(at[1])];
    return bundle ? bundle.indices : [];
  }
  return [];
}

function ensureAimLayer() {
  const panel = lensState.el.panel;
  if (!panel) return null;
  if (lensState.el.aim && lensState.el.aim.parentNode === panel) return lensState.el.aim;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'fll-aim');
  // Không đặt viewBox: không có viewBox thì một đơn vị của SVG = một px CSS, nên toạ độ lấy từ
  // getBoundingClientRect dùng thẳng được, không phải quy đổi.
  svg.innerHTML = '<g class="fll-aim-ticks"></g><path class="fll-aim-line"></path>' +
    '<polygon class="fll-aim-head"></polygon>';
  panel.appendChild(svg);
  lensState.el.aim = svg;
  return svg;
}

function hideAim() {
  const previous = lensState.aimEl;
  lensState.aimEl = null;
  if (previous && previous.classList) previous.classList.remove('fll-aimed');
  if (lensState.el.aim) lensState.el.aim.classList.remove('on');
  if (lensState.el.mapText) lensState.el.mapText.classList.remove('aiming');
  // Trả dòng chữ giữa nhãn minimap về đúng trạng thái bộ lọc hiện tại.
  if (lensState.data && lensState.el.mapText) updateMinimapRange();
}

function drawAim(el) {
  const panel = lensState.el.panel;
  const map = lensState.el.map;
  if (!panel || !map || !lensState.data || !el.isConnected) return;
  const entries = lensState.data.entries;
  const timed = aimIndicesFor(el)
    .map((index) => entries[index])
    .filter((entry) => entry && entry.ts);
  if (!timed.length) return;

  const svg = ensureAimLayer();
  if (!svg) return;
  const panelRect = panel.getBoundingClientRect();
  const mapRect = map.getBoundingClientRect();
  const itemRect = el.getBoundingClientRect();
  // Hàng bị cuộn khuất lên trên minimap thì mũi tên sẽ đâm ngược — thôi không vẽ.
  if (itemRect.top < mapRect.bottom + 4 || itemRect.bottom > panelRect.bottom) {
    svg.classList.remove('on');
    return;
  }

  const mapTop = mapRect.top - panelRect.top;
  const endX = minimapClientXFromTs(timed[0].ts) - panelRect.left;
  const endY = mapRect.bottom - panelRect.top;
  // Bắt đầu từ mép TRÁI của hàng chứ không phải tâm: hàng rộng cả panel, lấy tâm thì đường kẻ mọc ra
  // từ giữa một dòng chữ, nhìn như không dính vào đâu cả.
  const startX = Math.min(itemRect.left + 18, itemRect.right - 8) - panelRect.left;
  const startY = itemRect.top - panelRect.top;
  const lift = Math.max(16, (startY - endY) * 0.45);

  svg.querySelector('.fll-aim-line').setAttribute('d',
    'M' + startX.toFixed(1) + ' ' + startY.toFixed(1) +
    ' C' + startX.toFixed(1) + ' ' + (startY - lift).toFixed(1) +
    ',' + endX.toFixed(1) + ' ' + (endY + lift).toFixed(1) +
    ',' + endX.toFixed(1) + ' ' + endY.toFixed(1));
  // Mũi tên quay lên và nằm BÊN TRONG minimap. Trước đó nó chạm ở mép dưới minimap nên đè lên dòng
  // nhãn giờ ngay bên dưới (dòng nhãn chỉ cao ~14px) — thấy khi chụp màn hình.
  svg.querySelector('.fll-aim-head').setAttribute('points',
    endX.toFixed(1) + ',' + (endY - 9).toFixed(1) + ' ' +
    (endX - 4.5).toFixed(1) + ',' + (endY - 1).toFixed(1) + ' ' +
    (endX + 4.5).toFixed(1) + ',' + (endY - 1).toFixed(1));
  svg.querySelector('.fll-aim-ticks').innerHTML = timed.slice(0, AIM_MAX_TICKS)
    .map((entry, index) => {
      const x = minimapClientXFromTs(entry.ts) - panelRect.left;
      // Vạch đầu tiên là cái mũi tên đang chỉ tới: to và đậm hơn những vạch còn lại.
      const width = index === 0 ? 3 : 2;
      return '<rect class="' + (index === 0 ? 'fll-aim-first' : '') + '" x="' +
        (x - width / 2).toFixed(1) + '" y="' + mapTop.toFixed(1) +
        '" width="' + width + '" height="' + mapRect.height.toFixed(1) + '"></rect>';
    })
    .join('');
  svg.classList.add('on');

  if (lensState.el.mapText) {
    lensState.el.mapText.textContent = formatClock(timed[0].ts) +
      (timed.length > 1 ? ' · ' + timed.length + ' dòng' : ' · dòng ' + timed[0].lineNo);
    lensState.el.mapText.classList.add('aiming');
  }
}

function handleLensHover(event) {
  const target = event.target;
  const hit = target && target.closest ? target.closest(AIM_SELECTOR) : null;
  if (hit === lensState.aimEl) return;
  hideAim();
  if (!hit) return;
  lensState.aimEl = hit;
  hit.classList.add('fll-aimed');
  drawAim(hit);
}

// Cuộn thì hàng di chuyển mà chuột không đổi -> mouseover không bắn lại. Vẽ lại theo sự kiện cuộn
// (bắt ở pha capture vì 'scroll' không nổi bọt lên).
function handleAimScroll() {
  if (lensState.aimEl) drawAim(lensState.aimEl);
}
// @ts-check
// biến mỗi tiêu đề mục (.fll-sec) thành một mục đóng/mở được, nhớ trạng thái qua phiên
//
// Làm BẰNG CÁCH GOM LẠI SAU KHI VẼ, không sửa từng renderer: các renderer nối chuỗi
// "<div class=fll-sec>Tên</div>" rồi đến nội dung, tức mục chỉ là một mốc phẳng chứ không phải một
// khối bao ngoài. Nếu đổi sang khối bao ngoài thì phải sửa hơn 20 chỗ và mỗi tab thêm sau này lại
// phải nhớ làm theo. Gom ở đây thì chỉ một chỗ biết chuyện này, và tab mới tự động có.

const SECTION_OPEN_KEY = 'fll.openSections';

/** @type {Set<string> | null} */
let openSectionKeys = null;

function loadOpenSections() {
  if (openSectionKeys) return openSectionKeys;
  openSectionKeys = new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(SECTION_OPEN_KEY));
    if (Array.isArray(raw)) raw.forEach((key) => openSectionKeys.add(String(key)));
  } catch (error) {
    // Riêng tư / dữ liệu cũ hỏng: coi như chưa mở mục nào, mặc định vẫn là đóng hết.
  }
  return openSectionKeys;
}

function persistOpenSections() {
  try {
    localStorage.setItem(SECTION_OPEN_KEY, JSON.stringify(Array.from(loadOpenSections())));
  } catch (error) {
    // Không lưu được thì phiên này vẫn đóng/mở bình thường, chỉ không nhớ sang lần sau.
  }
}

// Khoá gồm cả tên tab: hai tab có thể có mục trùng tên (ví dụ "Phiên app"), mở ở tab này không có
// nghĩa là mở ở tab kia.
function sectionKey(tabId, title) {
  return tabId + '::' + title;
}

function isSectionOpen(tabId, title) {
  return loadOpenSections().has(sectionKey(tabId, title));
}

function setSectionOpen(key, isOpen) {
  const keys = loadOpenSections();
  if (isOpen) keys.add(key);
  else keys.delete(key);
  persistOpenSections();
}

// Bỏ qua thẻ không phải element (children chỉ trả về element) và thẻ .fll-sec lồng trong khối khác —
// chỉ quét đúng cấp con trực tiếp của vùng thân, đúng nơi các renderer đặt tiêu đề mục.
function collapsifySections(container, tabId) {
  if (!container || !container.children) return;
  const nodes = Array.from(container.children);
  let bodyOfCurrentSection = null;
  nodes.forEach((node) => {
    if (!node.classList || !node.classList.contains('fll-sec')) {
      if (bodyOfCurrentSection) bodyOfCurrentSection.appendChild(node);
      return;
    }
    // Lấy data-sec chứ không lấy textContent: textContent còn dính cả badge ("Phiên app3 phiên"),
    // mà badge đổi theo từng log — dùng nó làm khoá thì mở ở log này, sang log khác lại thấy đóng.
    const title = node.getAttribute('data-sec') || (node.textContent || '').trim();
    const key = sectionKey(tabId, title);
    const wrap = document.createElement('div');
    wrap.className = 'fll-secw' + (loadOpenSections().has(key) ? ' open' : '');
    container.insertBefore(wrap, node);
    node.setAttribute('data-act', 'tglSec');
    node.setAttribute('data-value', key);
    node.setAttribute('data-tip', 'Bấm để mở / thu mục này');
    node.insertAdjacentHTML('afterbegin', '<span class="fll-caret">&#9656;</span>');
    wrap.appendChild(node);
    bodyOfCurrentSection = document.createElement('div');
    bodyOfCurrentSection.className = 'fll-secb';
    wrap.appendChild(bodyOfCurrentSection);
  });
  // Chèn ô tìm SAU khi đã chuyển hết nội dung vào thân mục — lúc gom ở trên thân còn đang rỗng.
  // Cắt bớt TRƯỚC ô tìm: ô tìm đọc số hàng đang hiện để viết đúng câu "tìm trong N mục đang hiện".
  Array.from(container.querySelectorAll('.fll-secb')).forEach(capSectionRows);
  Array.from(container.querySelectorAll('.fll-secb')).forEach(addSectionSearch);
}

// Cắt bớt hàng thừa của mục dài, SAU KHI VẼ — cùng cách đã dùng cho ô đóng/mở và ô tìm nhanh.
//
// Vì sao không cắt trong từng renderer: cắt ở đó thì TỔNG bị mất luôn. Đó là lỗi thật đã có:
// extractDurations cắt còn 80 hàng TRƯỚC khi trả về, nên badge ghi "80" trong khi log có 160 con số,
// mà chữ ngay dưới lại ghi "MỌI con số thời lượng". Cắt ở đây thì renderer trả về đủ, badge đúng, và
// phần bị giấu vẫn còn trong DOM để ô tìm và nút "Hiện thêm" chạm tới.
const SECTION_MAX_ROWS = 12;

// Mục tự quản lý phân trang (danh sách nhóm lỗi, danh sách mốc) đã có nút "Hiện thêm" riêng đọc theo
// dữ liệu đầy đủ — cắt thêm một lần nữa ở đây là cắt chồng lên phân trang của nó.
function hasOwnPaging(sectionBody) {
  return !!sectionBody.querySelector('[data-act="moreIssues"], [data-act="moreTimeline"]');
}

function capSectionRows(sectionBody) {
  if (hasOwnPaging(sectionBody)) return;
  const container = sectionRowContainer(sectionBody);
  const rows = sectionRows(container, null);
  if (rows.length <= SECTION_MAX_ROWS) return;
  rows.slice(SECTION_MAX_ROWS).forEach((node) => {
    node.hidden = true;
    node.setAttribute('data-capped', '1');
  });
  const button = document.createElement('button');
  button.className = 'fll-btn fll-secmore';
  button.setAttribute('data-act', 'moreSection');
  button.textContent = 'Hiện thêm — còn ' + (rows.length - SECTION_MAX_ROWS) + ' mục';
  sectionBody.appendChild(button);
}

// Bỏ hẳn giới hạn của mục đó (không bung từng nấc): một mục dài nhất cũng chỉ vài chục hàng, mà bấm
// hai ba lần mới thấy hết thì khó chịu hơn là cuộn.
function expandSection(button) {
  const sectionBody = button.parentElement;
  if (!sectionBody) return;
  Array.from(sectionBody.querySelectorAll('[data-capped]')).forEach((node) => {
    node.hidden = false;
    node.removeAttribute('data-capped');
  });
  button.remove();
  // Ô tìm vừa được nới rộng phạm vi: viết lại câu mô tả cho khỏi nói dối.
  const box = sectionBody.querySelector('.fll-secq');
  if (box) refreshSectionSearchScope(box);
}

// Một mục có bao nhiêu hàng thì mới đáng có ô tìm. Dưới ngưỡng này thì liếc mắt là thấy hết.
const SECTION_SEARCH_MIN_ROWS = 6;

// Hàng của một mục không phải lúc nào cũng là con trực tiếp của thân mục: nhiều danh sách được bọc
// trong ĐÚNG MỘT thẻ (.fll-rank, .fll-lvkey, #fll-issue-list), lúc đó đếm con trực tiếp ra 1 và ô tìm
// sẽ không bao giờ được chèn. Nếu thân mục chỉ có một thẻ con mà thẻ đó lại có nhiều con thì chính
// nó mới là chỗ chứa hàng.
function sectionRowContainer(sectionBody) {
  const kids = Array.from(sectionBody.children).filter((node) => node.classList &&
    !node.classList.contains('fll-hint') && !node.classList.contains('fll-secq') &&
    !node.classList.contains('fll-secq-note'));
  if (kids.length === 1 && kids[0].children && kids[0].children.length > 1) return kids[0];
  return sectionBody;
}

function sectionRows(container, box) {
  return Array.from(container.children).filter((node) => node !== box && node.classList &&
    !node.classList.contains('fll-hint') && !node.classList.contains('fll-secq') &&
    !node.classList.contains('fll-secmore') && !node.classList.contains('fll-secq-note'));
}

// Chèn ô tìm vào ngay trong mục, SAU KHI VẼ, thay vì sửa từng renderer. Đo thật: mỗi ô tìm kiểu cũ
// (#fll-q, #fll-httpq, #fll-modq, #fll-tlq) đều phải sửa ở hai file — thêm một trường tabUiState, một
// nhánh trong handleLensInput, một thẻ input, một id container. Nhân lên ~20 mục là ~80 chỗ sửa và mỗi
// mục thêm sau này lại phải nhớ làm theo. Làm ở đây thì một chỗ biết, mọi mục đủ dài đều tự có.
//
// Đánh đổi: ô này lọc trên DOM ĐÃ VẼ, nên mục nào phân trang (danh sách nhóm lỗi) thì nó chỉ tìm trong
// trang đang hiện. Vì vậy mục nào ĐÃ có ô tìm riêng (tìm trên toàn bộ dữ liệu) thì bỏ qua, không chèn.
// Nhiều mục chỉ vẽ một phần (danh sách nhóm có phân trang) trong khi
// badge trên tiêu đề ghi TỔNG. Ô tìm chỉ tìm được phần đã vẽ, nên nó phải nói rõ điều đó — nếu không
// sẽ ra cảnh "mục ghi 64 module, gõ tên một module có thật, báo không khớp".
function sectionShownTotal(sectionBody) {
  const header = sectionBody.parentElement && sectionBody.parentElement.querySelector('.fll-secbdg');
  const badge = header ? parseInt(header.textContent, 10) : NaN;
  return Number.isNaN(badge) ? 0 : badge;
}

function addSectionSearch(sectionBody) {
  if (sectionBody.querySelector('input')) return;
  const container = sectionRowContainer(sectionBody);
  if (sectionRows(container, null).length < SECTION_SEARCH_MIN_ROWS) return;
  const box = document.createElement('input');
  box.className = 'fll-in fll-secq';
  sectionBody.insertBefore(box, sectionBody.firstChild);
  refreshSectionSearchScope(box);
}

// Phạm vi của ô tìm = số hàng ô tìm CHẠM TỚI ĐƯỢC. Hàng bị capSectionRows giấu đi vẫn chạm tới được
// (chúng nằm trong DOM, chỉ đang hidden) — còn hàng chưa hề được vẽ (mục tự phân trang) thì không.
// Câu chữ phải nói đúng điều đó, nếu không sẽ ra cảnh "mục ghi 64 module, gõ tên một module có thật,
// báo không khớp".
function refreshSectionSearchScope(box) {
  const sectionBody = box.parentElement;
  if (!sectionBody) return;
  const reach = sectionRows(sectionRowContainer(sectionBody), box).length;
  const total = sectionShownTotal(sectionBody);
  box.setAttribute('placeholder', total > reach
    ? 'Tìm trong ' + reach + ' mục đã vẽ (mục có ' + total + ')...'
    : 'Tìm nhanh trong mục này...');
}

// Lọc ngay trên DOM: không vẽ lại gì cả nên không mất tiêu điểm, không cần debounce.
function filterSectionRows(box) {
  const sectionBody = box.parentElement;
  const container = sectionRowContainer(sectionBody);
  const query = box.value.trim().toLowerCase();
  const rows = sectionRows(container, box);
  const more = sectionBody.querySelector('.fll-secmore');
  let shown = 0;
  rows.forEach((node) => {
    const hit = !query || (node.textContent || '').toLowerCase().indexOf(query) >= 0;
    // Đang gõ tìm thì bỏ qua giới hạn cắt: gõ đúng tên một hàng bị cắt mà vẫn "không mục nào khớp"
    // là kiểu sai khó chịu nhất. Xoá ô tìm thì trả lại trạng thái cắt cũ.
    node.hidden = query ? !hit : !!node.getAttribute('data-capped');
    if (hit) shown += 1;
  });
  if (more) more.hidden = !!query;
  let note = sectionBody.querySelector('.fll-secq-note');
  if (!query) {
    if (note) note.remove();
    return;
  }
  if (!note) {
    note = document.createElement('div');
    note.className = 'fll-hint fll-secq-note';
    sectionBody.insertBefore(note, box.nextSibling);
  }
  const total = sectionShownTotal(sectionBody);
  const chuaVe = total > rows.length ? ' — mục có ' + total + ', ô này chỉ tìm trong phần đã vẽ' : '';
  note.textContent = (shown ? 'Khớp ' + shown + '/' + rows.length : 'Không mục nào khớp') + chuaVe + '.';
}

// Đóng/mở TẠI CHỖ, không vẽ lại cả tab: vẽ lại sẽ mất vị trí cuộn và làm mất luôn ô tìm đang gõ dở.
function toggleSection(header) {
  const wrap = header.parentElement;
  if (!wrap || !wrap.classList.contains('fll-secw')) return;
  const isOpen = !wrap.classList.contains('open');
  wrap.classList.toggle('open', isOpen);
  setSectionOpen(header.getAttribute('data-value') || '', isOpen);
  hideAim();
}

// Mở mục đang chứa phần tử này ra rồi mới cuộn tới. Không có bước này thì các lối tắt ("bấm thẻ phiên
// app ở Tổng quan") sẽ cuộn tới một chỗ đang bị đóng, tức không thấy gì.
function revealElement(el) {
  let node = el;
  while (node && node !== lensState.el.body) {
    if (node.classList && node.classList.contains('fll-secw') && !node.classList.contains('open')) {
      node.classList.add('open');
      const header = node.querySelector('.fll-sec');
      if (header) setSectionOpen(header.getAttribute('data-value') || '', true);
    }
    node = node.parentElement;
  }
}
// @ts-check
// tooltip tự vẽ, thay cho thuộc tính title="" của trình duyệt
//
// Vì sao phải tự vẽ: độ trễ trước khi hiện title="" do HỆ ĐIỀU HÀNH quyết định, không có CSS hay JS
// nào đổi được. Panel này đầy chú giải — mỗi hàng, mỗi chip, mỗi tiêu đề mục đều có một cái — nên lướt
// chuột qua là tooltip nhảy liên tục và che mất phần giao diện phía sau. Đổi sang data-tip rồi tự vẽ
// thì kiểm soát được ba thứ: chờ bao lâu mới hiện, rộng tối đa bao nhiêu, và hiện ở đâu.
//
// Đặt trong #fll-root chứ không trong .fll-panel: panel có overflow:hidden nên tooltip sát mép panel
// sẽ bị cắt mất một nửa.

const TOOLTIP_DELAY_MS = 600;
// Lệch xuống dưới và sang phải con trỏ. Chuột thường đi từ trên xuống / từ trái sang, nên hướng này
// che vào chỗ người dùng VỪA rời khỏi, không che chỗ họ đang nhìn tới.
const TOOLTIP_OFFSET_X = 14;
const TOOLTIP_OFFSET_Y = 18;
const TOOLTIP_MARGIN = 8;

let tooltipTimer = 0;

function ensureTooltip() {
  const root = lensState.el.root;
  if (!root) return null;
  if (lensState.el.tip && lensState.el.tip.parentNode === root) return lensState.el.tip;
  const tip = document.createElement('div');
  tip.className = 'fll-tip';
  tip.hidden = true;
  root.appendChild(tip);
  lensState.el.tip = tip;
  return tip;
}

function clearTooltipTimer() {
  if (!tooltipTimer) return;
  clearTimeout(tooltipTimer);
  tooltipTimer = 0;
}

function hideTooltip() {
  clearTooltipTimer();
  lensState.tipEl = null;
  if (lensState.el.tip) lensState.el.tip.hidden = true;
}

// Đo xong mới đặt: phải hiện ra thì mới biết nó rộng cao bao nhiêu để còn lật lên / đẩy vào trong màn.
function placeTooltip(el, clientX, clientY) {
  const text = el.getAttribute('data-tip');
  if (!text || !el.isConnected) return;
  const tip = ensureTooltip();
  if (!tip) return;
  tip.textContent = text;
  tip.hidden = false;

  const box = tip.getBoundingClientRect();
  let left = clientX + TOOLTIP_OFFSET_X;
  let top = clientY + TOOLTIP_OFFSET_Y;
  if (left + box.width > window.innerWidth - TOOLTIP_MARGIN) {
    left = Math.max(TOOLTIP_MARGIN, window.innerWidth - TOOLTIP_MARGIN - box.width);
  }
  // Không đủ chỗ bên dưới thì lật lên TRÊN con trỏ, chứ không ép sát đáy màn hình — ép sát đáy thì nó
  // nằm đè lên chính cái đang trỏ tới.
  if (top + box.height > window.innerHeight - TOOLTIP_MARGIN) {
    top = Math.max(TOOLTIP_MARGIN, clientY - TOOLTIP_OFFSET_Y - box.height);
  }
  tip.style.left = Math.round(left) + 'px';
  tip.style.top = Math.round(top) + 'px';
}

function handleLensTooltip(event) {
  const target = event.target;
  const hit = target && target.closest ? target.closest('[data-tip]') : null;
  if (hit === lensState.tipEl) return;
  hideTooltip();
  if (!hit) return;
  lensState.tipEl = hit;
  const clientX = event.clientX;
  const clientY = event.clientY;
  tooltipTimer = setTimeout(() => {
    tooltipTimer = 0;
    if (lensState.tipEl === hit) placeTooltip(hit, clientX, clientY);
  }, TOOLTIP_DELAY_MS);
}
// @ts-check
// rê chuột trên bảng log của trang: chỉ vị trí dòng đó lên minimap, và làm panel trong suốt để đọc
// xuyên qua
//
// Panel rộng 480px nằm đè lên phần bên phải bảng log — đúng chỗ đuôi của những dòng dài. Thay vì bắt
// người dùng thu panel lại (Esc) rồi mở ra, cho nó mờ đi trong lúc chuột đang ở trên bảng log.
//
// KHÔNG đặt `opacity` lên chính `.fll-panel`: opacity gộp cả cây con thành một lớp, con không bao giờ
// sáng hơn cha — minimap sẽ mờ theo, mà minimap lại chính là thứ cần nhìn rõ lúc đó. Cách làm: nền
// panel chuyển sang màu có alpha, rồi mờ TỪNG ĐỨA CON trừ minimap và nhãn của nó.
//
// Mốc kích hoạt là "chuột đang trên bảng log", không phải "chuột rời khỏi panel". Hai cái khác nhau
// rất xa: chuột nằm ngoài panel gần như suốt thời gian, lấy mốc đó thì panel mờ là trạng thái mặc
// định và nó nhấp nháy mỗi lần chuột đi ngang. Còn "đang ở trên bảng log" thì đúng bằng lúc người
// dùng đang đọc log.

let pageHoverRow = null;

// Dòng không có giờ (dòng tiếp nối của stack trace) thừa hưởng giờ của dòng trên nó qua windowTs —
// dùng luôn ở đây, nếu không thì rê vào giữa một stack trace là vạch trên minimap tắt ngóm.
function pageRowTs(entry) {
  return entry.ts || entry.windowTs || 0;
}

function setXray(isOn) {
  const panel = lensState.el.panel;
  if (!panel) return;
  panel.classList.toggle('fll-xray', isOn);
}

function handlePageRowHover(event) {
  if (!lensState.data || !lensState.el.panel) return;
  const target = event.target;
  const row = target && target.closest ? target.closest(ROW_SELECTOR) : null;
  setXray(true);
  // mouseover bắn một lần mỗi lần vào một phần tử mới, nên chỉ cần chặn "vẫn đúng dòng cũ" là đủ;
  // không cần hẹn giờ tiết chế, và cũng không nên có: rê tới dòng nào phải thấy ngay dòng đó.
  if (!row || row === pageHoverRow) return;
  pageHoverRow = row;
  const entry = lensState.rowEntries ? lensState.rowEntries.get(row) : null;
  if (!entry) return;
  updateMinimapCursor(pageRowTs(entry));
  const text = lensState.el.mapText;
  if (!text) return;
  text.textContent = (pageRowTs(entry) ? formatClock(pageRowTs(entry)) + ' · ' : '') + 'dòng ' + entry.lineNo;
  text.classList.add('aiming');
}

function handlePageLeave() {
  pageHoverRow = null;
  setXray(false);
  // Không cần kiểm el.map: updateMinimapCursor và updateMinimapRange đều tự thoát khi chưa có phần tử,
  // mà thêm một điều kiện nữa ở đây thì lúc panel chưa dựng xong, vạch cũ sẽ nằm lại trên minimap.
  if (!lensState.data) return;
  updateMinimapCursor(0);
  if (lensState.el.mapText) lensState.el.mapText.classList.remove('aiming');
  // Trả dòng chữ giữa nhãn minimap về đúng trạng thái bộ lọc hiện tại.
  updateMinimapRange();
}

// Tra "phần tử dòng -> entry" bằng WeakMap thay vì indexOf trên mảng rowEls: rê chuột bắn liên tục,
// mà WeakMap còn tự buông khi trang thay DOM nên không giữ sống node đã bị gỡ.
function indexRowElements(data) {
  const map = new WeakMap();
  data.entries.forEach((entry) => {
    if (entry.el) map.set(entry.el, entry);
  });
  lensState.rowEntries = map;
}

function attachPageHover(container) {
  if (!container || lensState.el.hoverContainer === container) return;
  detachPageHover();
  container.addEventListener('mouseover', handlePageRowHover);
  container.addEventListener('mouseleave', handlePageLeave);
  lensState.el.hoverContainer = container;
}

function detachPageHover() {
  const container = lensState.el.hoverContainer;
  if (container) {
    container.removeEventListener('mouseover', handlePageRowHover);
    container.removeEventListener('mouseleave', handlePageLeave);
  }
  lensState.el.hoverContainer = null;
  pageHoverRow = null;
  setXray(false);
}
// @ts-check
// tấm trượt phủ lên thân panel: xem payload JSON và gom các dòng cùng một ID

const SHEET_MAX_RAW_LENGTH = 20000;

// Tấm trượt từng phủ từ dưới header xuống (top:52px cố định trong CSS) nên nó che luôn minimap —
// đúng lúc đọc payload lại là lúc cần nhìn "dòng này nằm chỗ nào trong log" nhất. Đo bằng JS thay vì
// đặt số cố định vì chiều cao phần trên không cố định: thanh bộ lọc có lúc hiện có lúc ẩn.
function positionSheetBelowTimeline() {
  const sheet = lensState.el.sheet;
  const body = lensState.el.body;
  if (!sheet || !body) return;
  sheet.style.top = body.offsetTop + 'px';
}

function openSheet(title, subtitle, bodyHtml) {
  const panel = lensState.el.panel;
  if (!panel) return;
  closeSheet();
  const sheet = document.createElement('div');
  sheet.className = 'fll-sheet';
  sheet.innerHTML =
    '<div class="fll-sheet-hd"><div><div class="fll-sheet-tt">' + escapeHtml(title) + '</div>' +
    '<div class="fll-sheet-sub">' + escapeHtml(subtitle) + '</div></div>' +
    '<div class="fll-hd-sp"></div>' +
    '<button class="fll-ico" data-act="closeSheet" data-tip="Đóng">×</button></div>' +
    '<div class="fll-sheet-body">' + bodyHtml + '</div>';
  panel.appendChild(sheet);
  lensState.el.sheet = sheet;
  positionSheetBelowTimeline();
}

function closeSheet() {
  const existing = lensState.el.panel && lensState.el.panel.querySelector('.fll-sheet');
  if (existing) existing.remove();
  lensState.el.sheet = null;
}

// Một khối có thể vừa bị cắt vừa bị che, nên trả về danh sách nhãn chứ không phải một nhãn.
function payloadSectionTags(section) {
  const tags = [];
  if (section.isTruncated) {
    tags.push(section.isParsed
      ? ['warn', 'log cắt bớt — mất ' + section.lostChars + ' ký tự cuối, đã đóng ngoặc để đọc']
      : ['warn', 'log cắt bớt — không đóng lại được']);
  } else if (!section.isParsed) {
    tags.push(['warn', 'không parse được']);
  }
  if (section.isRepaired) tags.push(['ok', 'đã bỏ **** để parse']);
  if (section.isMap) tags.push(['ok', 'map k=v']);
  return tags;
}

// Tô màu bằng cách quét token rồi escape TỪNG mảnh — escape trước rồi tô màu sau sẽ ăn cả thẻ <i>,
// còn tô màu trước escape sau thì thẻ bị biến thành chữ.
const JSON_TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;

function highlightJson(text) {
  let out = '';
  let last = 0;
  JSON_TOKEN_RE.lastIndex = 0;
  let hit = JSON_TOKEN_RE.exec(text);
  while (hit) {
    out += escapeHtml(text.slice(last, hit.index));
    if (hit[1] && hit[2]) out += '<i class="fll-jk">' + escapeHtml(hit[1]) + '</i>' + escapeHtml(hit[2]);
    else if (hit[1]) out += '<i class="fll-js">' + escapeHtml(hit[1]) + '</i>';
    else if (hit[3]) out += '<i class="fll-jb">' + hit[3] + '</i>';
    else out += '<i class="fll-jn">' + hit[4] + '</i>';
    last = hit.index + hit[0].length;
    hit = JSON_TOKEN_RE.exec(text);
  }
  return out + escapeHtml(text.slice(last));
}

function renderPayloadSection(section, index) {
  const name = escapeHtml(section.name);
  if (section.kind === 'text') {
    return '<div class="fll-pay"><div class="fll-pay-hd"><b>' + name + '</b>' +
      '<span class="fll-pay-v">' + (section.pretty ? escapeHtml(section.pretty) : '(rỗng)') +
      '</span></div></div>';
  }
  const tags = payloadSectionTags(section)
    .map((tag) => '<span class="fll-pay-tag ' + tag[0] + '">' + tag[1] + '</span>')
    .join('');
  const blockId = 'fll-json-' + index;
  const text = section.pretty.slice(0, SHEET_MAX_RAW_LENGTH) +
    (section.pretty.length > SHEET_MAX_RAW_LENGTH ? '\n… (đã cắt bớt để hiển thị)' : '');
  return '<div class="fll-pay"><div class="fll-pay-hd"><b>' + name + '</b>' +
    tags +
    '<div class="fll-hd-sp"></div>' +
    '<button class="fll-btn fll-mini" data-act="copyJson" data-value="' + blockId + '">Copy</button>' +
    '</div><pre class="fll-code' + (payloadSheetState.isWrapped ? ' fll-wrap' : '') + '" id="' + blockId +
    '">' + highlightJson(text) + '</pre></div>';
}

// Một request HTTP nằm ở hai dòng log khác nhau và mỗi dòng mang trường khác nhau
// (--header/--encrypted ở dòng request, --status ở dòng response), nên mở chung một tấm trượt
// rồi đổi qua lại bằng chip: khỏi phải đóng ra mở vào để so request với response.
const WRAP_STORAGE_KEY = 'fll.payloadWrap';

// Mặc định BẬT: pretty-print chỉ ngắt dòng ở cấu trúc, còn một giá trị dài (chữ ký, chuỗi base64)
// vẫn là một dòng dài vài nghìn ký tự — cuộn ngang để đọc thứ đó rất mệt.
const payloadSheetState = { reqIndex: null, resIndex: null, side: 'req', isWrapped: loadPayloadWrap() };

function loadPayloadWrap() {
  try {
    return localStorage.getItem(WRAP_STORAGE_KEY) !== '0';
  } catch (error) {
    return true;
  }
}

function persistPayloadWrap() {
  try {
    localStorage.setItem(WRAP_STORAGE_KEY, payloadSheetState.isWrapped ? '1' : '0');
  } catch (error) {
    // Riêng tư / hết dung lượng: lựa chọn vẫn có hiệu lực trong phiên này.
  }
}

function togglePayloadWrap(button) {
  payloadSheetState.isWrapped = !payloadSheetState.isWrapped;
  persistPayloadWrap();
  // Đổi class tại chỗ thay vì vẽ lại: giữ nguyên vị trí cuộn người dùng đang đọc dở.
  const sheet = lensState.el.panel && lensState.el.panel.querySelector('.fll-sheet');
  if (sheet) {
    sheet.querySelectorAll('.fll-code').forEach((block) => {
      block.classList.toggle('fll-wrap', payloadSheetState.isWrapped);
    });
  }
  button.className = 'fll-chip' + (payloadSheetState.isWrapped ? ' on' : '');
}

// Nút "Nhảy tới dòng" nằm trên thanh công cụ đầu tấm trượt, không phải dưới cùng: payload JSON dài
// tới 10KB nên trước đây phải cuộn hết cả khối dữ liệu mới thấy nó. Thanh này còn dính lại khi cuộn
// (position:sticky) để đọc giữa chừng vẫn bấm được.
// Hai hàng có chủ đích, không nhồi tất cả vào một hàng: đo thật trên panel 480px cho thấy nhồi chung
// thì tổng bề ngang các nút vượt khung 61px và tự vỡ thành hai hàng lồi lõm.
// Hàng trên là tab Request/Response, hàng dưới là hành động. Cả khối dính lại khi cuộn.
function renderPayloadToolbar(tabsHtml, domIndex, lineNo) {
  const jump = domIndex == null ? '' :
    '<button class="fll-btn fll-mini pri" data-jump="' + domIndex + '" ' +
    'data-tip="Cuộn bảng log tới đúng dòng này">&#8629; Dòng ' + lineNo + '</button>';
  const wrap = '<button class="fll-chip' + (payloadSheetState.isWrapped ? ' on' : '') +
    '" data-act="toggleWrap" data-tip="Xuống dòng thay vì cuộn ngang">&#8629; Xuống dòng</button>';
  return '<div class="fll-paytop">' +
    (tabsHtml ? '<div class="fll-stabs">' + tabsHtml + '</div>' : '') +
    '<div class="fll-row fll-paybar">' + jump + '<div class="fll-hd-sp"></div>' + wrap + '</div>' +
    '</div>';
}

function renderPayloadBody(domIndex, tabsHtml) {
  const entry = lensState.data.entries[domIndex];
  if (!entry) return null;
  // logicalPayloadText: khối JSON in ra nhiều dòng log thì dòng này chỉ có phần đầu.
  const sections = buildPayloadSections(logicalPayloadText(entry));
  const body = sections.length
    ? sections.map(renderPayloadSection).join('')
    : '<div class="fll-empty">Dòng này không có khối dữ liệu nào.</div>';
  return { entry, html: renderPayloadToolbar(tabsHtml || '', domIndex, entry.lineNo) + body };
}

function formatBytes(count) {
  if (count < 1024) return count + ' B';
  // Gói bundle của miniapp tính bằng MB (1 619 017 B), để nguyên KB thì ra "1581 KB" — đọc không ra
  // ngay là bao nhiêu.
  if (count >= 1024 * 1024) return (count / (1024 * 1024)).toFixed(1) + ' MB';
  return (count / 1024).toFixed(count < 10240 ? 1 : 0) + ' KB';
}

// Đo trên nguyên văn của CÁC TRƯỜNG payload, không tính phần "[Module: HTTP] [URL: ...]" đầu dòng.
function payloadBytes(domIndex) {
  const entry = lensState.data.entries[domIndex];
  if (!entry) return 0;
  return buildPayloadSections(logicalPayloadText(entry))
    .reduce((total, section) => total + (section.bytes || 0), 0);
}

function renderPayloadSideTabs() {
  const tab = (side, label, domIndex) => {
    if (domIndex == null) return '';
    return '<button class="fll-tab' + (payloadSheetState.side === side ? ' on' : '') +
      '" data-act="payloadSide" data-value="' + side + '">' + label +
      '<i class="fll-bdg">' + formatBytes(payloadBytes(domIndex)) + '</i></button>';
  };
  return tab('req', 'Request', payloadSheetState.reqIndex) +
    tab('res', 'Response', payloadSheetState.resIndex);
}

function renderPayloadSheet(reqIndex, resIndex, side) {
  payloadSheetState.reqIndex = reqIndex;
  payloadSheetState.resIndex = resIndex;
  payloadSheetState.side = side === 'res' && resIndex == null ? 'req' : side;
  const domIndex = payloadSheetState.side === 'req' ? reqIndex : resIndex;
  const rendered = renderPayloadBody(domIndex, renderPayloadSideTabs());
  if (!rendered) return;
  openSheet('Payload dòng ' + rendered.entry.lineNo,
    rendered.entry.module + ' · ' + rendered.entry.time, rendered.html);
}

function switchPayloadSide(side) {
  renderPayloadSheet(payloadSheetState.reqIndex, payloadSheetState.resIndex, side);
}

// Đường vào cho MỘT dòng đơn lẻ (tấm trượt correlation), không có cặp request/response.
function renderJsonSheet(domIndex) {
  const rendered = renderPayloadBody(domIndex, '');
  if (!rendered) return;
  openSheet('Payload dòng ' + rendered.entry.lineNo,
    rendered.entry.module + ' · ' + rendered.entry.time, rendered.html);
}

function renderCorrelationSheet(value) {
  const bucket = lensState.data.correlations.find((item) => item.value === value);
  if (!bucket) return;
  const rows = bucket.indices
    .map((domIndex) => {
      const entry = lensState.data.entries[domIndex];
      const hasJson = /[{[]/.test(entry.raw);
      return '<div class="fll-ev" data-jump="' + domIndex + '">' +
        '<div class="fll-ev-t">' + escapeHtml(entry.module || entry.level || '—') +
        '<em>' + escapeHtml(entry.time) + ' · dòng ' + entry.lineNo + '</em></div>' +
        '<div class="fll-ev-d">' + escapeHtml(entry.message.slice(0, 150)) + '</div>' +
        (hasJson ? '<button class="fll-btn" style="margin-top:7px;padding:5px 10px" data-act="json" ' +
          'data-value="' + domIndex + '">Xem JSON</button>' : '') +
        '</div>';
    })
    .join('');
  const first = lensState.data.entries[bucket.indices[0]];
  const last = lensState.data.entries[bucket.indices[bucket.indices.length - 1]];
  const span = first.ts && last.ts ? formatDuration(last.ts - first.ts) : '—';
  openSheet(bucket.key + ' = ' + value, bucket.indices.length + ' dòng · kéo dài ' + span,
    '<div class="fll-row" style="margin-bottom:10px">' +
    '<button class="fll-btn pri" data-act="browseCorrelation" data-value="' + escapeHtml(value) + '">' +
    'Duyệt bằng n / p</button></div><div class="fll-tl">' + rows + '</div>');
}
// @ts-check
// nội dung 5 tab: Tổng quan, Vấn đề, Cấu hình, Lọc, Diễn biến

// Dùng log thật có 262 nhóm sau khi gom; vẽ hết một lượt là một chuỗi HTML rất lớn và phải
// dựng lại mỗi lần gõ phím trong ô tìm. Vẽ theo lô, còn lại bấm "Hiện thêm".
const ISSUE_PAGE_SIZE = 50;

const TIMELINE_PAGE_SIZE = 80;

const tabUiState = { issueLevel: 'all', issueQuery: '', httpOnlyBad: false, httpQuery: '', moduleQuery: '',
  issueLimit: ISSUE_PAGE_SIZE, templateName: '', tlKinds: new Set(), tlQuery: '',
  tlLimit: TIMELINE_PAGE_SIZE, showNoise: false };

// Mọi thứ trong tabUiState đều là trạng thái của MỘT feedback đang mở. Sang feedback khác mà còn sót
// thì danh sách đã bị lọc sẵn bằng câu tìm của log trước, mà thanh bộ lọc không hề báo gì.
function resetTabUiState() {
  tabUiState.issueLevel = 'all';
  tabUiState.issueQuery = '';
  tabUiState.httpOnlyBad = false;
  tabUiState.httpQuery = '';
  tabUiState.moduleQuery = '';
  tabUiState.issueLimit = ISSUE_PAGE_SIZE;
  tabUiState.templateName = '';
  tabUiState.tlKinds = new Set();
  tabUiState.tlQuery = '';
  tabUiState.tlLimit = TIMELINE_PAGE_SIZE;
  tabUiState.showNoise = false;
}

function renderSparkline(indices, color) {
  const data = lensState.data;
  const span = Math.max(1, data.lastTs - data.firstTs);
  const buckets = new Array(SPARKLINE_BUCKETS).fill(0);
  indices.forEach((domIndex) => {
    const entry = data.entries[domIndex];
    if (!entry || !entry.ts) return;
    buckets[Math.min(SPARKLINE_BUCKETS - 1, Math.floor(((entry.ts - data.firstTs) / span) * SPARKLINE_BUCKETS))] += 1;
  });
  const peak = Math.max(1, ...buckets);
  return '<div class="fll-spark">' + buckets
    .map((count) => '<i style="height:' + (count ? 20 + (count / peak) * 80 : 8) + '%;background:' +
      (count ? color : '#2a2436') + '"></i>')
    .join('') + '</div>';
}

// Vẽ HẾT hàng: việc cắt bớt để capSectionRows() làm sau khi vẽ, nhờ vậy badge trên tiêu đề vẫn là
// tổng thật và ô tìm nhanh vẫn chạm tới được phần bị giấu. Hàng đã sort giảm dần nên peak là hàng đầu.
function renderRankList(rows, dataAttr) {
  const peak = Math.max(1, ...rows.map((row) => row.count));
  return '<div class="fll-rank">' + rows
    .map((row) =>
      '<div class="fll-rk" ' + dataAttr + '="' + escapeHtml(row.key) + '">' +
      '<u style="width:' + ((row.count / peak) * 100).toFixed(1) + '%"></u>' +
      '<span>' + escapeHtml(row.key) + '</span><b>' + row.count + '</b></div>')
    .join('') + '</div>';
}

// Thẻ thống kê hiện số chính xác; chỉ badge trên tab mới rút gọn kiểu 4.1k.
// Khi đang lọc thì kèm theo tổng của cả file (47/958) để không ai giật mình "warning của tôi đâu mất rồi".
function statCard(value, label, color, attrs, total) {
  const suffix = total != null && total !== value ? '<em>/' + total + '</em>' : '';
  return '<button class="fll-stat" ' + attrs + '><b' + (color ? ' style="color:' + color + '"' : '') + '>' +
    value + suffix + '</b><span>' + escapeHtml(label) + '</span></button>';
}

// Tiêu đề một mục. data-sec giữ tên GỐC: collapsifySections() lấy thuộc tính này làm khoá nhớ trạng
// thái đóng/mở, không được lấy textContent vì trong đó có cả badge — badge đổi theo từng log, lấy nó
// vào khoá thì mở một mục ở log này, sang log khác lại thấy mục đó đang đóng.
// Badge là thứ duy nhất nhìn thấy khi mục đang thu lại, nên nó phải trả lời được "trong này có gì".
// tone 'act' = đang có bộ lọc bật, dùng màu accent giống chip bộ lọc.
function secTitle(title, badge, tone) {
  const chip = badge == null || badge === '' ? ''
    : '<i class="fll-secbdg' + (tone ? ' ' + tone : '') + '">' + escapeHtml(String(badge)) + '</i>';
  return '<div class="fll-sec" data-sec="' + escapeHtml(title) + '">' + escapeHtml(title) + chip + '</div>';
}

function renderWindowChips(includeAllChip) {
  const choices = includeAllChip ? TIME_WINDOW_CHOICES.concat([0]) : TIME_WINDOW_CHOICES;
  return '<div class="fll-row">' +
    choices
      .map((ms) => '<button class="fll-chip' + (isWindowPresetActive(ms) ? ' on' : '') +
        '" data-act="setWindow" data-value="' + ms + '">' +
        (ms ? formatWindowPresetLabel(ms) : 'Toàn bộ') + '</button>')
      .join('') +
    '</div><div class="fll-hint" style="margin-top:6px">Hoặc kéo thẳng trên minimap để chọn khoảng ' +
    'bất kỳ.</div>';
}

/* ---------------------------------------------------------------- Tổng quan */

// Log được chụp đúng lúc user bấm gửi feedback, nên mép phải của trục thời gian chính là thời điểm xảy ra vấn đề.
// Một log production thật (autoId 45490371) dài 4222 dòng hoá ra là 2111 dòng đầu lặp lại y hệt.
// Không báo thì tool đếm gấp đôi mọi thứ mà không ai nhận ra — "lỗi này 4 lần" thật ra là 2 lần.
function renderDuplicateBanner(data) {
  const block = data.duplicate;
  if (!block) return '';
  const isSkipping = lensState.filter.skipDuplicate;
  const share = ((block.length / data.entries.length) * 100).toFixed(0);
  return '<div class="fll-note' + (isSkipping ? ' ok' : '') + '">' +
    '<span>' + (isSkipping ? '&#10003;' : '&#9888;') + '</span><div>' +
    (isSkipping
      ? '<b>Đang bỏ ' + block.length + ' dòng lặp.</b> Mọi con số bên dưới tính trên phần còn lại.'
      : '<b>File này có ' + block.length + ' dòng lặp lại nguyên xi</b> (' + share + '% cả log): ' +
        'dòng ' + block.sourceLineFrom + ' trở đi xuất hiện lại ở dòng ' + block.lineFrom + '–' +
        block.lineTo + '. <b>Mọi con số bên dưới đang tính cả hai lần.</b>') +
    '<div class="fll-row" style="margin-top:8px">' +
    '<button class="fll-btn' + (isSkipping ? '' : ' pri') + '" data-act="tglSkipDuplicate">' +
    (isSkipping ? 'Tính lại cả phần lặp' : 'Bỏ khối lặp, tính lại') + '</button>' +
    '<button class="fll-btn" data-act="jumpDuplicate">Tới chỗ nối</button></div>' +
    '</div></div>';
}

// Giá trị dài (deviceid 64 ký tự) không vừa panel 480px: cắt giữa, giữ hai đầu để còn đối chiếu được,
// nguyên văn để trong chú giải.
function envShortValue(value) {
  return value.length > 24 ? value.slice(0, 12) + '…' + value.slice(-6) : value;
}

// attrs khác rỗng = hàng này trỏ tới những dòng log cụ thể: rê chuột thì vạch lên minimap, bấm thì
// đưa vào thanh duyệt. Hàng không trỏ đi đâu thì giữ con trỏ mặc định, đừng mời bấm một chỗ không bấm được.
function envRankRow(left, right, tip, attrs) {
  return '<div class="fll-rk" style="cursor:' + (attrs ? 'pointer' : 'default') + '"' + (attrs || '') +
    (tip ? ' data-tip="' + escapeHtml(tip) + '"' : '') + '>' +
    '<span>' + escapeHtml(left) + '</span><b style="color:var(--txt)">' + escapeHtml(right) + '</b></div>';
}

// Một khoá có NHIỀU giá trị là thứ đáng nhìn thấy cả danh sách, không phải thứ để chọn đại lấy cái
// hay gặp nhất: IP đổi giữa chừng = đổi mạng, deviceid đổi = log đã bị trộn từ hai máy, bản app đổi =
// người dùng vừa nâng cấp giữa log nên mọi con số phía trên đang trộn hai bản.
// Đúng một giá trị thì nó đã nằm ở bảng trên rồi, không lặp lại ở đây.
function renderEnvValueList(field, fieldIndex) {
  if (field.values.length < 2) return '';
  return '<div class="fll-hint" style="margin:10px 0 4px"' +
    (field.tip ? ' data-tip="' + escapeHtml(field.tip) + '"' : '') + '>' + escapeHtml(field.label) +
    ' — <b>' + field.values.length + '</b> giá trị khác nhau, đổi giữa chừng</div>' +
    '<div class="fll-rank">' + field.values
      .map((item, valueIndex) => envRankRow(envShortValue(item.value), item.count + ' lần',
        item.value + (field.tip ? '\n' + field.tip : '') +
        (item.indices.length ? '\nBấm để duyệt ' + item.indices.length + ' dòng mang giá trị này.' : ''),
        // Chỉ số vào env.watched chứ không nhét cả danh sách dòng vào thuộc tính: một giá trị có thể
        // ứng với hàng nghìn dòng, viết hết ra HTML là mỗi hàng nặng cả chục KB.
        item.indices.length ? ' data-env="' + fieldIndex + ':' + valueIndex + '"' : ''))
      .join('') + '</div>';
}

// Một lần nạp bundle: "build 3449 ← 3420" khi nó được vá lên từ bản cũ, còn không thì chỉ số build.
// Hàng con nằm PHẲNG trong cùng khối, chỉ lùi đầu bằng một ký tự: lồng thêm một lớp div thì ô tìm
// nhanh và bước cắt bớt hàng của mục không còn nhận ra hàng nữa (xem luật ở CLAUDE.md).
function renderMiniAppBundleRow(app, appIndex, bundle, bundleIndex) {
  const size = bundle.patchSize ? 'vá ' + formatBytes(bundle.patchSize)
    : (bundle.size ? formatBytes(Number(bundle.size)) : '');
  const tip = [app.appId,
    bundle.from ? 'vá từ bản ' + bundle.from + ' lên ' + (bundle.to || bundle.buildNumber) : 'nạp thẳng bản này',
    bundle.size ? 'gói: ' + formatBytes(Number(bundle.size)) : '',
    bundle.patchSize ? 'bản vá: ' + formatBytes(bundle.patchSize) : '',
    bundle.installMode ? 'installMode ' + bundle.installMode : '',
    bundle.deploymentTarget ? 'deploymentTarget ' + bundle.deploymentTarget : '',
    bundle.trackingFlag ? 'nạp lúc: ' + bundle.trackingFlag : '',
    bundle.platform || '',
    'Bấm để duyệt ' + bundle.indices.length + ' dòng nạp bundle này.'].filter(Boolean).join('\n');
  return envRankRow('↳ build ' + (bundle.buildNumber || '?') + (bundle.from ? ' ← ' + bundle.from : ''),
    [size, formatClock(bundle.firstTs), bundle.count > 1 ? bundle.count + ' lần' : '']
      .filter(Boolean).join(' · '),
    tip, ' data-envapp="' + appIndex + ':' + bundleIndex + '"');
}

function renderEnvMiniApps(miniApps) {
  if (!miniApps.length) return '';
  const capNhat = miniApps.filter(miniAppChangedBuild).length;
  return '<div class="fll-hint" style="margin:10px 0 4px">MiniApp — <b>' + miniApps.length + '</b>' +
    (capNhat ? ', trong đó <b>' + capNhat + '</b> cập nhật bản build giữa log' : '') + '</div>' +
    '<div class="fll-rank">' + miniApps
      .map((app, appIndex) => envRankRow(app.appId, app.versions.map((item) => item.value).join(', '),
        app.appId + '\n' + app.versions.map((item) => 'version ' + item.value + ': ' + item.count + ' request')
          .join('\n') + (app.indices.length
          ? '\nBấm để duyệt ' + app.indices.length + ' request của miniapp này.'
          : '\nMiniapp này có nạp bundle nhưng không có request nào trong tập đang xem.'),
        app.indices.length ? ' data-envapp="' + appIndex + '"' : '') +
        app.bundles.map((bundle, bundleIndex) =>
          renderMiniAppBundleRow(app, appIndex, bundle, bundleIndex)).join(''))
      .join('') + '</div>';
}

// Mục này trả lời câu đầu tiên của bước TÁI HIỆN: máy gì, hệ điều hành nào, bản nào, miniapp version
// bao nhiêu, nối vào đâu. Đọc từ header request HTTP vì đó là nguồn duy nhất còn sống trên log
// production (xem 02i) — và cũng vì một dòng header mang sẵn hơn chục trường đáng đọc.
function renderEnvironmentSection(data) {
  const env = data.environment;
  const full = lensState.data ? lensState.data.environment : env;
  if (!env.available) {
    // Chỉ được nói "log này không có" khi CẢ LOG không có — cùng luật với tab Cấu hình.
    if (env === full || !full.available) return '';
    return secTitle('Máy & môi trường', 'bị lọc hết') +
      emptyBecauseOfFilter(full.headerLineCount + full.bodyLineCount,
        'dòng request HTTP nào mang thông tin máy');
  }
  const context = data.feedback || {};
  const byKey = new Map(env.watched.map((field) => [field.key, field]));
  // Đúng một giá trị thì để trong bảng; từ hai trở lên thì bảng IM, danh sách bên dưới nói. Bảng mà
  // vẫn ghi một giá trị trong khi ngay dưới là danh sách hai giá trị thì đọc ra là một khẳng định,
  // còn nó chỉ là cái hay gặp nhất.
  const one = (key) => {
    const field = byKey.get(key);
    return field && field.values.length === 1 ? field.values[0].value : '';
  };
  const deviceName = one('device-name');
  const rows = [
    ['Thiết bị', [deviceName
      ? deviceName + (env.deviceModel ? ' (' + env.deviceModel + ')' : '')
      : (byKey.has('device-name') ? env.deviceModel : env.device),
      one('osLabel') || (byKey.has('osLabel') ? '' : env.deviceOs)].filter(Boolean).join(' · ')],
    ['Đời máy', one('device_performance')],
    ['Bản app', one('app_code')
      ? [env.appVersion, env.appBuild ? 'build ' + env.appBuild : '',
        env.flavor ? 'build ' + env.flavor : ''].filter(Boolean).join(' · ')
      : ''],
    ['Mạng', context.Network || ''],
    ['Ngôn ngữ', one('lang')],
    ['Múi giờ', one('M-Timezone')],
    ['Môi trường', [one('env'), one('channel')].filter(Boolean).join(' · ')],
    ['CFNetwork / Darwin', [env.cfNetwork, env.darwin].filter(Boolean).join(' / ')],
    ['Agent ID', one('agent_id')],
    // Cắt ở đây chứ không cắt trong 02i: nguyên văn vẫn phải còn trong dữ liệu để chú giải hiện ra
    // được và để ai đọc code sau không tưởng tool chỉ đọc được một phần deviceid.
    ['Device ID', envShortValue(one('deviceid')), one('deviceid')],
    ['IP', one('device-ip')],
    ['Host đã gọi', env.hostCount
      ? env.hostCount + ' host' + (env.nonProdHosts.length
        ? ' · ' + env.nonProdHosts.length + ' host có dấu hiệu uat/dev: ' + env.nonProdHosts.join(', ')
        : ' · không host nào có dấu hiệu uat/dev')
      : ''],
  ].filter((row) => row[1]);
  // Một luật cho MỌI trường đáng theo dõi, không phải nhớ tên từng cái ở đây: thêm trường mới thì khai
  // ở ENV_WATCHED_FIELDS trong 02i, chỗ này tự có.
  const lists = env.watched.map(renderEnvValueList).join('') + renderEnvMiniApps(env.miniApps);
  if (!rows.length && !lists) return '';

  // Bản build và host là HAI chuyện khác nhau — chỉ nói ra sự thật quan sát được, không kết luận hộ.
  const mixed = env.mixedBuild
    ? '<div class="fll-note" style="margin-top:8px"><span>&#9888;</span><div>Bản <b>' +
      escapeHtml(env.flavor) + '</b> nhưng mọi host trong log đều không có dấu hiệu uat/dev. ' +
      'Bản build và host là hai chuyện khác nhau — đây chỉ là điều quan sát được, không phải kết luận.' +
      '</div></div>'
    : '';
  const sources = [env.headerLineCount ? env.headerLineCount + ' header' : '',
    env.bodyLineCount ? env.bodyLineCount + ' body' : ''].filter(Boolean).join(' và ');
  return secTitle('Máy & môi trường', env.device || env.appVersion || '') +
    (sources
      ? '<div class="fll-hint" style="margin-bottom:8px">Đọc từ ' + sources +
        ' của request HTTP — nguồn duy nhất còn sống trên log production.</div>'
      : '') +
    '<div class="fll-rank">' + rows.map((row) => envRankRow(row[0], row[1], row[2] || row[1])).join('') +
    '</div>' +
    lists + mixed;
}

function renderFeedbackBanner() {
  const data = lensState.data;
  const context = data.feedback || {};
  const bits = [context.Feature, context.ScreenID, context.MiniApp].filter(Boolean);
  const device = [context['Device OS'], context['App Info'], context.Network].filter(Boolean).join(' · ');

  // Thiết bị/phiên bản chỉ để trong tooltip: dòng này bị cắt giữa chừng thì đọc càng khó hơn là không có.
  return '<div class="fll-focus">' +
    '<div class="fll-focus-t">User gửi lúc <b>' + formatClock(data.lastTs) + '</b>' +
    (context['Entry Point'] ? ' từ <b>' + escapeHtml(context['Entry Point']) + '</b>' : '') + '</div>' +
    (bits.length ? '<div class="fll-focus-d" data-tip="' +
      escapeHtml(bits.join(' · ') + (device ? '\n' + device : '')) + '">' +
      escapeHtml(bits.join(' · ')) + '</div>' : '') +
    '<div class="fll-focus-hint">Vấn đề thường nằm ở cuối log — thu hẹp lại:</div>' +
    renderWindowChips(false) +
    '<div class="fll-row" style="margin-top:9px">' +
    '<button class="fll-btn pri" data-act="copySummary" data-tip="Khối markdown gọn để dán thẳng vào ' +
    'ticket — liệt kê sự kiện có giờ, không kết luận nguyên nhân.">Copy tóm tắt cho ticket</button>' +
    '</div>' +
    (context.Feature ? '<button class="fll-btn" style="margin-top:9px" data-act="filterFeature" data-value="' +
      escapeHtml(context.Feature) + '">Chỉ dòng có "' + escapeHtml(context.Feature) + '"</button>' : '') +
    '</div>';
}

function renderSummaryTab() {
  const data = getView();
  const full = lensState.data;
  const isScoped = data !== full;
  const errorGroups = data.groups.filter((group) => group.level === 'ERROR' && !isGroupMuted(group));

  // Không lặp lại "đang lọc N dòng" ở đây: thanh bộ lọc ngay phía trên đã nói rồi,
  // và mỗi thẻ thống kê đều tự hiện dạng scope/tổng.
  let html = renderFeedbackBanner() +
    '<div class="fll-stats">' +
    statCard(data.scopedEntries.length, 'dòng log', '', 'data-act="noop"',
      isScoped ? full.entries.length : null) +
    statCard(data.levels.ERROR, 'ERROR', LEVEL_COLOR.ERROR, 'data-level="ERROR"',
      isScoped ? full.levels.ERROR : null) +
    statCard(data.levels.WARNING, 'WARNING', LEVEL_COLOR.WARNING, 'data-level="WARNING"',
      isScoped ? full.levels.WARNING : null) +
    // Bấm vào đây phải ra đúng CHỖ LỌC theo phiên (tab Lọc), không phải tab Diễn biến — trước đây
    // nó dẫn sang Diễn biến trong khi chỗ chọn phiên lại nằm ở Lọc. Một phiên thì không có gì để
    // chọn, để nút bấm được chỉ làm người dùng bấm hụt.
    statCard(full.sessionCount, 'phiên app', '#3ddc97',
      (full.sessionCount > 1 ? 'data-act="gotoSessions"' : 'data-act="noop"') +
      (full.hasOrphanTail ? ' data-tip="' + escapeHtml('Trong đó có một đoạn không đếm được trọn vẹn. ' +
        SESSION_ORPHAN_TIP) + '"' : '')) +
    statCard(data.gaps.filter((gap) => gap.cause !== 'background').length,
      'khoảng lặng ≥ ' + full.gapThresholdLabel, LEVEL_COLOR.WARNING,
      'data-act="gotoTimeline" data-tip="' +
      (data.gaps.some((gap) => gap.cause === 'background')
        ? 'Đã trừ ' + data.gaps.filter((gap) => gap.cause === 'background').length +
          ' khoảng do app xuống nền — những khoảng đó không phải app treo.'
        : 'Không khoảng nào trùng với lúc app xuống nền.') + '"',
      isScoped ? full.gaps.filter((gap) => gap.cause !== 'background').length : null) +
    statCard(data.badHttpCalls.length, 'HTTP bất thường', LEVEL_COLOR.ERROR, 'data-act="gotoHttp"',
      isScoped ? full.badHttpCalls.length : null) +
    '</div>';

  // Băng này phải đứng TRÊN mọi con số, vì nếu log bị nối đôi thì mọi con số bên dưới đều gấp đôi.
  html += renderDuplicateBanner(full);

  if (full.outOfOrder > 0) {
    html += '<div class="fll-note" data-tip="Logger flush theo lô (' + full.batchCount +
      ' mốc END OF BATCH). Minimap, khoảng lặng và tab Timeline đều đã sắp lại theo timestamp thật.">' +
      '<span>&#9888;</span><div><b>' + full.outOfOrder + ' dòng có timestamp lùi về trước</b> — ' +
      'thứ tự dòng không phải thứ tự thời gian.</div></div>';
  }

  html += secTitle('Tỷ lệ mức độ', data.levels.ERROR + ' lỗi', data.levels.ERROR ? 'err' : '');
  const levelTotal = Math.max(1, LEVEL_ORDER.reduce((sum, level) => sum + data.levels[level], 0));
  html += '<div class="fll-lvbar">' + LEVEL_ORDER
    .map((level) => '<i style="width:' + ((data.levels[level] / levelTotal) * 100).toFixed(2) + '%;background:' +
      LEVEL_COLOR[level] + '" data-tip="' + level + ': ' + data.levels[level] + '"></i>')
    .join('') + '</div>';
  html += '<div class="fll-lvkey">' + LEVEL_ORDER
    .map((level) => '<button class="fll-chip" data-level="' + level + '">' +
      '<i class="fll-sw" style="background:' + LEVEL_COLOR[level] + '"></i>' + level +
      ' <em>' + data.levels[level] + '</em></button>')
    .join('') + '</div>';

  if (errorGroups.length) {
    html += secTitle('Lỗi nổi bật', errorGroups.length, 'err') +
      errorGroups.slice(0, 3).map((group) => renderGroupCard(group, data.groups.indexOf(group))).join('') +
      '<button class="fll-btn" data-act="gotoIssues" style="width:100%">Xem tất cả ' + data.groups.length +
      ' nhóm vấn đề</button>';
  }

  // Popup/bottom sheet đắt giá nhất nên nằm ngay tab đầu, không phải giấu sau vài lần bấm:
  // chúng đều ghi ở mức INFO nên phần "Lỗi nổi bật" ngay trên không bao giờ nhắc tới.
  if (data.journey.saw.length) {
    html += secTitle('User đã nhìn thấy gì', data.journey.saw.length, 'warn') +
      '<div class="fll-hint" style="margin-bottom:8px">Popup và bottom sheet thật sự hiện lên màn hình. ' +
      'Tất cả đều ghi ở mức <b>INFO</b> nên tab Vấn đề không đếm chúng.</div>' +
      data.journey.saw.map(renderSawCard).join('');
  }
  if (data.journey.taps.length) {
    html += secTitle('Chạm nhiều nhất', data.journey.taps.length) +
      renderRankList(data.journey.taps, 'data-jtap');
  }

  // Mục này chạy theo bộ lọc như mọi mục khác của tab: lọc vào đúng một phiên app thì "bản app"
  // phải là bản của phiên đó. Đo trên log production 9609 dòng: cả log có hai bản (5.13.1 và 5.15.0,
  // người dùng nâng cấp giữa chừng), đọc theo cả log thì panel ghi bản hay gặp nhất — tức bản CŨ,
  // trong khi feedback được gửi từ bản mới.
  html += renderEnvironmentSection(data);
  html += renderSlowSections();
  html += secTitle('Module nói nhiều nhất', data.modules.length) +
    renderRankList(data.modules, 'data-module');
  if (data.events.length) {
    html += secTitle('Tracker event', data.events.length) + renderRankList(data.events, 'data-event') +
      '<div class="fll-hint" style="margin-top:6px">Tên event thô, kể cả loại chưa dựng thành thao tác ' +
      'được — bấm để lọc thẳng ra những dòng đó.</div>';
  }
  return html;
}

/* ------------------------------------------------------------------ Vấn đề */

function renderGroupCard(group, groupIndex) {
  const color = group.level === 'ERROR' ? LEVEL_COLOR.ERROR : LEVEL_COLOR.WARNING;
  const muted = isGroupMuted(group);
  return '<div class="fll-grp' + (group.level === 'ERROR' ? ' err' : '') + (muted ? ' muted' : '') +
    '" data-group="' + groupIndex + '">' +
    '<div class="fll-grp-top">' +
    '<span class="fll-cnt">' + group.indices.length + '&times;</span>' +
    (group.module ? '<span class="fll-mod">' + escapeHtml(group.module) + '</span>' : '') +
    '<span class="fll-when">' + formatClock(group.firstTs) +
    (group.indices.length > 1 ? ' &rarr; ' + formatClock(group.lastTs) : '') + '</span>' +
    '<button class="fll-ico fll-mute" data-act="mute" data-value="' + groupIndex + '" data-tip="' +
    (muted ? 'Bật lại nhóm này' : 'Tắt tiếng chữ ký này, nhớ cho các feedback sau') + '">' +
    (muted ? '&#128266;' : '&#128263;') + '</button></div>' +
    '<div class="fll-msg">' + escapeHtml(group.sample) + '</div>' +
    (group.indices.length > 1 ? renderSparkline(group.indices, color) : '') +
    '</div>';
}

function renderIssueList() {
  const view = getView();
  const query = tabUiState.issueQuery.toLowerCase();
  const groups = view.groups.filter((group) => {
    // Nhiễu đo lường có khối riêng bên dưới, không trộn vào đây.
    if (group.noiseLabel) return false;
    if (isGroupMuted(group) && !lensState.isShowingMuted) return false;
    if (tabUiState.issueLevel !== 'all' && group.level !== tabUiState.issueLevel) return false;
    if (!query) return true;
    return (group.sample + ' ' + group.module).toLowerCase().indexOf(query) >= 0;
  });
  if (!groups.length) return '<div class="fll-empty">Không có nhóm nào khớp.</div>';
  const shown = groups.slice(0, tabUiState.issueLimit);
  return shown.map((group) => renderGroupCard(group, view.groups.indexOf(group))).join('') +
    (groups.length > shown.length
      ? '<button class="fll-btn" style="width:100%" data-act="moreIssues">Hiện thêm — còn ' +
        (groups.length - shown.length) + ' nhóm</button>'
      : '');
}

function renderIssuesTab() {
  const data = getView();
  const counts = { all: 0, ERROR: 0, WARNING: 0 };
  let mutedCount = 0;
  data.groups.forEach((group) => {
    if (group.noiseLabel) return;
    if (isGroupMuted(group)) {
      mutedCount += 1;
      return;
    }
    counts.all += 1;
    counts[group.level] += 1;
  });

  return renderTraceFailSection(data) +
    secTitle('Nhóm theo chữ ký dòng log', counts.all, counts.ERROR ? 'err' : '') +
    '<div class="fll-row" style="margin-bottom:8px">' +
    ['all', 'ERROR', 'WARNING']
      .map((key) => '<button class="fll-chip' + (tabUiState.issueLevel === key ? ' on' : '') +
        '" data-act="issueLevel" data-value="' + key + '">' + (key === 'all' ? 'Tất cả' : key) +
        ' <em>' + counts[key] + '</em></button>')
      .join('') +
    (mutedCount ? '<button class="fll-chip' + (lensState.isShowingMuted ? ' on' : '') +
      '" data-act="toggleMutedView">&#128263; Đã tắt tiếng <em>' + mutedCount + '</em></button>' : '') +
    '</div>' +
    '<input class="fll-in" id="fll-q" placeholder="Lọc nhanh trong các nhóm..." value="' +
    escapeHtml(tabUiState.issueQuery) + '">' +
    '<div class="fll-hint" style="margin:6px 0 10px">Bấm một nhóm để nhảy đến, rồi <b>n</b> / <b>p</b> đi tiếp. ' +
    'Bấm &#128263; để tắt tiếng chữ ký nhiễu — nhớ luôn cho các feedback mở sau này.</div>' +
    '<div id="fll-issue-list">' + renderIssueList() + '</div>' +
    renderTelemetryNoiseSection(data) +
    renderErrorCodeSection(data) +
    renderHttpSection();
}

// Mã lỗi đang nằm rải ở bốn nguồn (payload HTTP, params tracker, TraceParameter của Grafana, thân JSON
// của response) và không chỗ nào cộng lại. Mục này trả lời "log có những mã nào, mã nào nổ nhiều nhất,
// mã nào chỉ nổ đúng một lần" — câu hay hỏi nhất khi mở một log lạ, mà trước đây phải tự đọc từng mục
// rồi cộng tay.
function renderErrorCodeSection(data) {
  const codes = data.errorCodes || [];
  if (!codes.length) return '';
  const tong = codes.reduce((sum, item) => sum + item.count, 0);
  return secTitle('Mọi mã lỗi', codes.length + ' mã · ' + tong + ' lần', 'err') +
    '<div class="fll-hint" style="margin-bottom:8px">Bấm một mã để duyệt những dòng có nó. ' +
    'Mã <b>0</b> không tính — đó là mã của call thành công.</div>' +
    '<div class="fll-rank">' + codes
      .map((item) => '<div class="fll-rk" data-lines="' + item.indices.slice(0, 200).join(',') +
        '" data-label="mã lỗi ' + item.code + '" data-tip="' +
        escapeHtml((item.modules.length ? item.modules.join(', ') + ' · ' : '') +
          (item.firstTs ? 'lần đầu ' + formatClock(item.firstTs) : 'không có giờ')) + '">' +
        '<span>' + item.code + '</span><b style="color:var(--txt)">' + item.count + ' lần</b></div>')
      .join('') + '</div>';
}

// Đo trên 50 feedback PRODUCTION thật: 1267/2488 dòng ERROR (51%) không phải lỗi user gặp mà là lỗi
// của chính lớp đo lường, và 24/49 log có quá nửa số dòng ERROR là loại này. Để chúng lẫn trong danh
// sách thì người đọc mất một nửa thời gian vào thứ không liên quan.
// Tách ra chứ KHÔNG tự động tắt tiếng: tắt tiếng là quyết định của người đọc, và đôi khi chính lớp
// đo lường hỏng lại là manh mối.
function renderTelemetryNoiseSection(data) {
  const noise = data.groups.filter((group) => group.noiseLabel);
  if (!noise.length) return '';

  const lineCount = noise.reduce((sum, group) => sum + group.indices.length, 0);
  const byLabel = new Map();
  noise.forEach((group) => {
    byLabel.set(group.noiseLabel, (byLabel.get(group.noiseLabel) || 0) + group.indices.length);
  });
  const breakdown = Array.from(byLabel, (pair) => pair[0] + ' <b>' + pair[1] + '</b>')
    .sort()
    .join(' · ');

  return secTitle('Nhiễu từ hệ thống đo lường', noise.length) +
    '<div class="fll-note" style="background:rgba(88,196,255,.08);border-color:rgba(88,196,255,.28);' +
    'color:#bfe4ff"><span>&#9432;</span><div>' +
    '<b>' + lineCount + ' dòng</b> trong ' + noise.length + ' nhóm là lỗi của <b>chính lớp đo lường</b>, ' +
    'không phải lỗi user gặp — đã tách khỏi danh sách trên.<br>' +
    '<span style="opacity:.75">' + breakdown + '</span></div></div>' +
    '<button class="fll-btn" style="width:100%" data-act="toggleNoise">' +
    (tabUiState.showNoise ? 'Ẩn lại' : 'Vẫn muốn xem ' + noise.length + ' nhóm này') + '</button>' +
    (tabUiState.showNoise
      ? '<div style="margin-top:8px">' +
        noise.map((group) => renderGroupCard(group, data.groups.indexOf(group))).join('') + '</div>'
      : '');
}

// Đặt TRƯỚC danh sách nhóm chữ ký vì đây là loại lỗi mà danh sách đó không thể thấy: Grafana ghi ở
// mức INFO. Một log có thể không có dòng Grafana nào — lúc đó phải nói thẳng là không có, chứ để
// trống thì người đọc tưởng là "không có lỗi".
// "Log này không có X" là một khẳng định về CẢ LOG, mà các renderer lại đọc view đang lọc: lọc còn
// ERROR xong thì tab Cấu hình in "log này không có dòng cấu hình nào đọc được" trong khi cả log có 34
// khoá. Repo đã áp luật này cho hide() của tab (src/05-boot.js) — đây là áp nốt cho CÂU CHỮ.
//
// countFull trả về số lượng trong lensState.data (đầy đủ). Rỗng thật thì câu "log này không có" mới
// được phép; view rỗng mà data có thì đổi sang câu khác hẳn, kèm nút bỏ lọc.
function emptyBecauseOfFilter(countFull, whatIsMissing) {
  if (!countFull) {
    return '<div class="fll-empty">Log này không có ' + whatIsMissing + '.</div>';
  }
  return '<div class="fll-empty">Bộ lọc hiện tại không còn ' + whatIsMissing + ' nào — ' +
    'cả log có <b>' + countFull + '</b>. ' +
    '<button class="fll-chip" data-act="clearFilters">Xoá bộ lọc</button></div>';
}

function renderTraceFailSection(data) {
  const trace = data.traceIssues;
  if (!trace.available) {
    // Cùng một luật với tab Cấu hình: chỉ được nói "log này không có" khi CẢ LOG không có.
    const full = lensState.data ? lensState.data.traceIssues : trace;
    if (full !== trace && full.available) {
      return secTitle('Lỗi từ Grafana trace', 'bị lọc hết', 'warn') +
        '<div class="fll-hint" style="margin-bottom:4px">Bộ lọc hiện tại không còn dòng Grafana trace ' +
        'nào, nhưng cả log có <b>' + full.lineCount + '</b> dòng. ' +
        '<button class="fll-chip" data-act="clearFilters">Xoá bộ lọc</button></div>';
    }
    return secTitle('Lỗi từ Grafana trace', 'không có dòng nào') +
      '<div class="fll-hint" style="margin-bottom:4px">Log này <b>không có dòng Grafana trace nào</b>. ' +
      'Những dòng đó chỉ được ghi khi máy gửi feedback bật Debug Tool, nên vắng mặt là bình thường — ' +
      'chỉ là ở log này không có thêm nguồn lỗi nào ngoài các nhóm chữ ký bên dưới.</div>';
  }
  // Có dòng Grafana nhưng KHÔNG có dòng nào đi qua cờ debug (startTrace/traceFail) thì không được nói
  // "không luồng nào báo lỗi": những dòng đang có chỉ là log thường của lớp Grafana, còn đường ghi
  // traceFail chưa bao giờ được mở. README đã cảnh báo đừng nhầm available với hasGated — và trước đây
  // hasGated tính ra rồi không renderer nào đọc.
  if (!trace.hasGated) {
    return secTitle('Lỗi từ Grafana trace', 'không kết luận được', 'warn') +
      '<div class="fll-hint" style="margin-bottom:4px">Log có <b>' + trace.lineCount + '</b> dòng của lớp ' +
      'Grafana nhưng <b>không có <code>startTrace</code> hay <code>traceFail</code></b> nào — máy gửi ' +
      'feedback không bật Debug Tool nên đường ghi trace chưa từng chạy. <b>Không kết luận được</b> là ' +
      'không có lỗi; chỉ là log này không có nguồn đó.</div>';
  }
  if (!trace.fails.length) {
    return secTitle('Lỗi từ Grafana trace', 'không lỗi', 'ok') +
      '<div class="fll-hint" style="margin-bottom:4px">Có <b>' + trace.lineCount + '</b> dòng Grafana trace ' +
      'nhưng <b>không có <code>traceFail</code></b> nào — theo Grafana thì không luồng nào báo lỗi.</div>';
  }

  return secTitle('Lỗi từ Grafana trace', trace.fails.length, 'err') +
    '<div class="fll-hint" style="margin-bottom:8px">Đọc từ <code>traceFail</code> — mang sẵn ' +
    '<code>errorCode</code> và <code>errorMessage</code>, mô tả lỗi rõ hơn hầu hết dòng ERROR trong log, ' +
    'nhưng ghi ở mức <b>INFO</b> nên các nhóm chữ ký bên dưới không đếm chúng. Gom theo ' +
    '<code>errorMessage</code>: một sự cố hạ tầng hiện ra ở nhiều app khác nhau vẫn về <b>một</b> hàng.' +
    '</div>' + trace.fails.map(renderTraceFailCard).join('');
}

function renderTraceFailCard(row, rowIndex) {
  const meta = [];
  if (row.apps.length > 1) meta.push('<b>' + row.apps.length + ' app</b>');
  else if (row.apps.length === 1) meta.push(escapeHtml(row.apps[0]));
  if (row.steps.length) {
    meta.push(escapeHtml(row.steps.slice(0, 3).join(', ')) +
      (row.steps.length > 3 ? ' +' + (row.steps.length - 3) : ''));
  }
  return '<div class="fll-grp err" data-tracefail="' + rowIndex + '" data-tip="' +
    escapeHtml(row.apps.join('\n')) + '">' +
    '<div class="fll-grp-top">' +
    '<span class="fll-cnt">' + row.count + '&times;</span>' +
    (row.codes.length ? '<span class="fll-mod">code ' + escapeHtml(row.codes.join('/')) + '</span>' : '') +
    '<span class="fll-when">' + formatClock(row.firstTs) +
    (row.count > 1 ? ' &rarr; ' + formatClock(row.lastTs) : '') + '</span></div>' +
    '<div class="fll-msg">' + escapeHtml(row.key) +
    (meta.length ? '<br><span style="opacity:.6">' + meta.join(' · ') + '</span>' : '') +
    '</div></div>';
}

/* --------------------------------------------------------------------- HTTP */

function findCorrelationForEntry(entry) {
  if (!entry || !entry.correlationIds) return null;
  return entry.correlationIds.find((item) => lensState.data.correlationValueSet.has(item.value)) || null;
}

// Tìm cả trong payload chứ không chỉ trong URL: phần lớn lúc cần là dò theo một cmdId /
// request_id nhìn thấy ở dòng khác, mà giá trị đó chỉ nằm trong body.
function httpCallMatches(call, query, entries) {
  if (!query) return true;
  const head = (call.method + ' ' + call.url + ' ' + (call.status || '') + ' ' +
    (call.errorCode == null ? '' : 'e' + call.errorCode)).toLowerCase();
  if (head.indexOf(query) >= 0) return true;
  const req = call.reqIndex != null ? entries[call.reqIndex] : null;
  if (req && req.raw.toLowerCase().indexOf(query) >= 0) return true;
  const res = call.resIndex != null ? entries[call.resIndex] : null;
  return !!res && res.raw.toLowerCase().indexOf(query) >= 0;
}

function renderHttpCall(call, data) {
  let statusClass = 'fll-st';
  let statusText = call.status ? String(call.status) : '?';
  if (call.resIndex === null) {
    statusClass += ' wait';
    statusText = 'no res';
  } else if ((call.status && call.status >= 400) || (call.errorCode != null && call.errorCode !== 0)) {
    statusClass += ' bad';
    if (call.errorCode != null && call.errorCode !== 0) statusText = 'e' + call.errorCode;
  }
  // Hai đầu có payload khác nhau: --header / --encrypted nằm ở dòng request, --status ở dòng response.
  // Trước đây chỉ mở được dòng response nên phần header không bao giờ xem được từ đây.
  const payloadIndex = call.resIndex != null ? call.resIndex : call.reqIndex;
  const correlation = findCorrelationForEntry(data.entries[payloadIndex]);
  const payloadButton = '<button class="fll-ico fll-mini" data-act="payload" data-req="' +
    (call.reqIndex == null ? '' : call.reqIndex) + '" data-res="' +
    (call.resIndex == null ? '' : call.resIndex) + '" data-tip="Xem payload request / response">{ }</button>';
  return '<div class="fll-call" data-call="' + data.httpCalls.indexOf(call) + '">' +
    '<span class="fll-verb">' + escapeHtml(call.method) + '</span>' +
    '<span class="' + statusClass + '">' + escapeHtml(statusText) + '</span>' +
    '<span class="fll-path" data-tip="' + escapeHtml(call.url) + '">' + escapeHtml(call.path) + '</span>' +
    '<span class="fll-dur">' + (call.duration != null ? formatDuration(call.duration) : call.time.slice(0, 8)) +
    '</span>' +
    payloadButton +
    (correlation ? '<button class="fll-ico fll-mini" data-act="correlate" data-value="' +
      escapeHtml(correlation.value) + '" data-tip="Gom theo ' + correlation.key + '">&#128279;</button>' : '') +
    '</div>';
}

function renderHttpList() {
  const data = getView();
  const pool = tabUiState.httpOnlyBad ? data.badHttpCalls : data.httpCalls;
  const query = tabUiState.httpQuery.trim().toLowerCase();
  const calls = pool.filter((call) => httpCallMatches(call, query, data.entries));
  if (!calls.length) {
    return '<div class="fll-empty">' + (query ? 'Không request nào khớp.' : 'Không có request nào.') + '</div>';
  }
  const count = query ? '<div class="fll-hint" style="margin:0 0 8px">Khớp <b>' + calls.length + '</b>/' +
    pool.length + ' request.</div>' : '';
  return count + calls.map((call) => renderHttpCall(call, data)).join('');
}

// Không còn là một tab: "call nào hỏng" và "lỗi gì đã nổ" là cùng một câu hỏi, trước phải mở hai tab
// mới ghép lại được. Nay là hai mục cạnh nhau trong tab Vấn đề.
function renderHttpSection() {
  const data = getView();
  return secTitle('Call HTTP', data.badHttpCalls.length
    ? data.badHttpCalls.length + '/' + data.httpCalls.length + ' bất thường'
    : data.httpCalls.length, data.badHttpCalls.length ? 'err' : '') +
    '<div class="fll-row" style="margin-bottom:9px">' +
    '<button class="fll-chip' + (tabUiState.httpOnlyBad ? '' : ' on') + '" data-act="httpAll">Tất cả <em>' +
    data.httpCalls.length + '</em></button>' +
    '<button class="fll-chip' + (tabUiState.httpOnlyBad ? ' on' : '') + '" data-act="httpBad">Bất thường <em>' +
    data.badHttpCalls.length + '</em></button></div>' +
    '<input class="fll-in" id="fll-httpq" placeholder="Tìm theo URL, method, status hoặc nội dung payload..." ' +
    'value="' + escapeHtml(tabUiState.httpQuery) + '">' +
    '<div class="fll-hint" style="margin:6px 0 10px">Bất thường = status &ge; 400, errorCode khác 0, ' +
    'hoặc request không tìm thấy response. <b>{ }</b> mở payload (đổi qua lại request / response), ' +
    '<b>&#128279;</b> gom mọi dòng cùng ID.</div>' +
    '<div id="fll-http-list">' + renderHttpList() + '</div>' +
    renderTrackerFailSection(data);
}

// Nguồn thứ hai cho cùng câu hỏi "call nào hỏng": ops_receive_be do chính app ghi, có sẵn
// status/error_code/duration. Không trộn vào bảng trên vì hai bên đếm theo hai cách khác nhau
// (bảng trên ghép dòng [Method:] req/res, đây khử trùng theo trace_id) — để cạnh nhau mới đối chiếu được.
function renderTrackerFailSection(data) {
  const journey = data.journey;
  if (!journey.fails.length) return '';
  // Badge phải nói rõ đơn vị: fails là số NHÓM chữ ký, apiFail là số LẦN fail thật. Hai số lệch nhau
  // nhiều (đo trên log thật: 12 nhóm / 25 lần) nên ghi một số trơn sẽ bị đọc nhầm thành số kia.
  return secTitle('Call BE fail — theo tracker',
    journey.fails.length + ' nhóm · ' + journey.apiFail + ' lần', 'err') +
    '<div class="fll-hint" style="margin-bottom:8px">Lấy từ <code>ops_receive_be</code> có ' +
    '<code>status=fail</code>. Đây là nguồn khác với bảng trên (bảng đó đọc dòng <code>[Method:]</code>) ' +
    'nên hai bên lệch nhau là bình thường: log này có <b>' + journey.apiTotal + '</b> call theo tracker ' +
    'và <b>' + data.httpCalls.length + '</b> call theo dòng HTTP.</div>' +
    journey.fails.map(renderTrackerFailRow).join('');
}

/* --------------------------------------------------------------------- Chậm */

// Khác hẳn mục "Ở lâu nhất trên màn": đây là thời gian TẢI màn, số có sẵn trong log chứ không phải
// số tính ra. Đặt trước vì nó trả lời thẳng câu "màn nào tải lâu", còn bảng dưới là mọi con số thô.
function renderScreenLoadSection(view) {
  const rows = view.journey.screenLoads;
  if (!rows.length) return '';
  const peak = rows[0].worstMs;
  return secTitle('Màn tải lâu nhất', rows.length) +
    '<div class="fll-hint" style="margin-bottom:8px">Số <b>có sẵn trong log</b> — trường ' +
    '<code>duration</code> của <code>auto_screen_displayed</code> (lúc <code>state=load</code>) và ' +
    '<code>auto_load_progress_tracked</code>. Hiện lần chậm nhất; ngoặc là số lần đo và trung bình.</div>' +
    '<div class="fll-rank">' + rows
      .map((row) => {
        const color = row.worstMs >= 3000 ? LEVEL_COLOR.ERROR
          : row.worstMs >= 1000 ? LEVEL_COLOR.WARNING : LEVEL_COLOR.INFO;
        return '<div class="fll-rk" data-jload="' + escapeHtml(row.key) + '">' +
          '<u style="width:' + ((row.worstMs / peak) * 100).toFixed(1) + '%;background:' + color + '22"></u>' +
          '<span>' + escapeHtml(row.key) + '</span>' +
          '<b style="color:' + color + '">' + formatDuration(row.worstMs) + '</b>' +
          '<b>' + row.count + '× · tb ' + formatDuration(row.avgMs) + '</b></div>';
      })
      .join('') + '</div>';
}

// Không còn là một tab: ba mục này đều là "số rút từ log" y hệt các mục khác của Tổng quan, tách ra
// một tab riêng chỉ bắt người đọc nhảy qua lại. Từ khi mỗi mục tự thu lại được thì một tab nhiều mục
// không còn đắt chỗ nữa.
function renderSlowSections() {
  const view = getView();
  const rows = view.durations;
  const header = renderScreenLoadSection(view) + renderScreenDwellSection(view) +
    secTitle('Mọi con số thời lượng', rows.length) +
    '<div class="fll-hint" style="margin-bottom:10px">Mọi con số thời lượng rút được từ log ' +
    '(<code>duration=</code>, <code>in Nms</code>, <code>duration KMM</code>, <code>totalWaited</code>), ' +
    'xếp giảm dần. Giá trị trên ' + MAX_PLAUSIBLE_DURATION_MS / 1000 + 's bị bỏ vì log có chỗ ghi nhầm ' +
    'epoch vào <code>duration=</code>.</div>';
  if (!rows.length) return header + '<div class="fll-empty">Không tìm thấy trường thời lượng nào.</div>';

  const peak = rows[0].ms;
  return header + rows
    .map((row) => {
      const color = row.ms >= 3000 ? LEVEL_COLOR.ERROR : row.ms >= 1000 ? LEVEL_COLOR.WARNING : LEVEL_COLOR.INFO;
      return '<div class="fll-slow" data-jump="' + row.domIndex + '">' +
        '<u style="width:' + ((row.ms / peak) * 100).toFixed(1) + '%;background:' + color + '22"></u>' +
        '<span class="fll-slow-ms" style="color:' + color + '">' + formatDuration(row.ms) + '</span>' +
        '<span class="fll-slow-txt">' + escapeHtml(row.message.slice(0, 110)) + '</span>' +
        '<span class="fll-dur">' + escapeHtml(row.time.slice(0, 8)) + '</span></div>';
    })
    .join('');
}

/* ----------------------------------------- mảnh dùng chung cho hành trình user */

// Ba mảnh dưới đây không còn tab riêng: chúng nằm trong tab đã có đúng chủ đề của chúng —
// "user thấy gì" + "chạm nhiều nhất" ở Tổng quan, "call BE fail" ở Vấn đề, "ở lâu trên màn" ở phần Chậm.
// Bản thân dòng thời gian thì trộn thẳng vào tab Diễn biến.
function renderSawCard(row, rowIndex) {
  return '<div class="fll-grp err" data-saw="' + rowIndex + '">' +
    '<div class="fll-grp-top">' +
    '<span class="fll-cnt">' + row.count + '&times;</span>' +
    '<span class="fll-when">' + formatClock(row.firstTs) +
    (row.count > 1 ? ' &rarr; ' + formatClock(row.lastTs) : '') + '</span></div>' +
    '<div class="fll-msg">' + escapeHtml(row.key) +
    (row.detail ? '<br><span style="opacity:.6">' + escapeHtml(row.detail) + '</span>' : '') +
    '</div></div>';
}

function renderTrackerFailRow(row, rowIndex) {
  return '<div class="fll-call" data-apifail="' + rowIndex + '">' +
    '<span class="fll-st bad">' + row.count + '&times;</span>' +
    '<span class="fll-path" style="direction:ltr">' + escapeHtml(row.key) + '</span>' +
    '<span class="fll-dur">' + escapeHtml(row.detail.slice(0, 60)) + '</span></div>';
}

function renderScreenDwellSection(view) {
  const screens = view.journey.screens.filter((row) => row.ms > 0);
  if (!screens.length) return '';
  const peak = Math.max(1, screens[0].ms);
  return secTitle('Ở lâu nhất trên màn', screens.length) +
    '<div class="fll-hint" style="margin-bottom:8px"><b>Tổng</b> thời gian ở trên màn đó, cộng qua các ' +
    'lần vào. Số <b>tính ra</b> từ khoảng cách tới bước màn hình kế tiếp chứ không có sẵn trong log — ' +
    'nên khoảng cách vắt qua hai phiên app, hoặc dài quá ' + MAX_PLAUSIBLE_DURATION_MS / 60000 +
    ' phút (app nằm dưới nền chứ không phải người dùng ngồi nhìn), đều bị bỏ.</div>' +
    '<div class="fll-rank">' + screens
      .map((row) => '<div class="fll-rk" data-jscreen="' + escapeHtml(row.key) + '" data-tip="' +
        row.count + ' lần vào, lần lâu nhất ' + formatDuration(row.maxMs) + '">' +
        '<u style="width:' + ((row.ms / peak) * 100).toFixed(1) + '%"></u>' +
        '<span>' + escapeHtml(row.key) + '</span>' +
        '<b>' + formatDuration(row.ms) + (row.count > 1 ? ' &middot; ' + row.count + ' lần' : '') +
        '</b></div>')
      .join('') + '</div>';
}

/* ---------------------------------------------------------------------- Lọc */

function renderModuleChips() {
  const query = tabUiState.moduleQuery.toLowerCase();
  // Đếm theo các điều kiện KHÁC, bỏ qua chính điều kiện module: có thể đổi module đang chọn.
  const tally = tallyFacetCandidates('modules', (entry) => entry.module);
  lensState.filter.modules.forEach((name) => {
    if (!tally.has(name)) tally.set(name, 0);
  });
  const modules = Array.from(tally, (pair) => ({ key: pair[0], count: pair[1] }))
    .filter((row) => !query || row.key.toLowerCase().indexOf(query) >= 0)
    .sort((a, b) => b.count - a.count);
  if (!modules.length) return '<div class="fll-hint">Không có module nào khớp.</div>';
  return modules
    .map((row) => '<button class="fll-chip' + (lensState.filter.modules.has(row.key) ? ' on' : '') +
      '" data-act="tglModule" data-value="' + escapeHtml(row.key) + '">' + escapeHtml(row.key) +
      ' <em>' + row.count + '</em></button>')
    .join('');
}

function renderSessionChips() {
  const sessions = lensState.data.sessions;
  if (sessions.length < 2) return '';
  const picked = lensState.filter.session;
  return secTitle('Phiên app', picked ? sessionLabel(picked) : sessions.length + ' phiên', picked ? 'act' : '') +
    renderSessionChipRow();
}

// Chỉ riêng dãy chip, không kèm tiêu đề mục: tab Diễn biến không chia mục nên phải đặt thẳng chip vào
// hàng công cụ, còn tab Lọc thì bọc thêm tiêu đề ở trên.
function renderSessionChipRow() {
  const sessions = lensState.data.sessions;
  if (sessions.length < 2) return '';
  const tally = tallyFacetCandidates('session', (entry) => entry.session);
  return '<div class="fll-lvkey">' +
    sessions
      .map((session) => {
        const count = tally.get(session.index) || 0;
        // Đoạn mồ côi không có "bắt đầu" để ghi: mốc duy nhất biết chắc là chỗ nó kết thúc.
        const tip = session.isOrphanTail
          ? SESSION_ORPHAN_TIP + ' Đoạn này kết thúc lúc ' + formatClock(session.endTs) + '.'
          : 'Bắt đầu ' + formatClock(session.startTs);
        // data-aim: rê chuột lên chip thì mũi tên chỉ thẳng ra chỗ phiên đó BẮT ĐẦU trên minimap,
        // giống hệt rê lên một hàng trong danh sách. Bấm vào vẫn là lọc theo phiên — xem chú thích
        // của data-aim trong aimIndicesFor().
        return '<button class="fll-chip' + (lensState.filter.session === session.index ? ' on' : '') +
          (count ? '' : ' dim') + (session.isOrphanTail ? ' fll-chip-orphan' : '') +
          '" data-act="setSession" data-value="' + session.index +
          '" data-aim="' + session.firstIndex +
          '" data-tip="' + escapeHtml(tip) + '">' + escapeHtml(sessionLabel(session.index)) +
          ' <em>' + count + '</em></button>';
      })
      .join('') +
    '<button class="fll-chip' + (lensState.filter.session ? '' : ' on') +
    '" data-act="setSession" data-value="0">Tất cả</button></div>';
}

// Mục này là ngoại lệ duy nhất trong panel: CHUỖI của một ID không bao giờ bị cắt theo bộ lọc, vì
// xem một cmdId đi qua mấy lớp mà thiếu mất vài lớp thì đúng là thứ làm người đọc kết luận sai.
//
// Nhưng "không cắt chuỗi" không có nghĩa là "không cắt danh sách". Trước đây mục này liệt kê MỌI ID
// của cả log kể cả khi đang bật cửa sổ thời gian, trong khi mọi mục xung quanh đều theo bộ lọc — và
// không có một dòng chữ nào nói ra chuyện đó. Nay danh sách chỉ giữ ID nào CÓ ÍT NHẤT MỘT DÒNG nằm
// trong tập đang xem; bấm vào thì vẫn mở trọn chuỗi như cũ, và chữ ngay dưới nói rõ điều đó.
function correlationBucketsInView() {
  const buckets = lensState.data.correlations;
  const view = getView();
  if (view === lensState.data) return buckets;
  const inView = new Set(view.scopedEntries.map((entry) => entry.domIndex));
  return buckets.filter((bucket) => bucket.indices.some((index) => inView.has(index)));
}

// Ô tìm regex vốn đã là bộ trích xuất vạn năng, chỉ thiếu bước gom: nó hiện ra DÒNG chứ không hiện ra
// GIÁ TRỊ. Mục này chỉ xuất hiện khi mẫu có nhóm bắt — tức chỉ khi người dùng đã cố ý hỏi "liệt kê giá
// trị", nên không tốn gì cho những lần tìm bình thường.
function renderCaptureSection(result) {
  const tally = buildCaptureTally(result.visible);
  if (!tally || !tally.values.length) return '';
  const gioiHan = (tally.cappedLines ? ' · chỉ quét ' + tally.scannedLines + ' dòng đầu' : '') +
    (tally.cappedValues ? ' · đã cắt ở ' + tally.values.length + ' giá trị' : '');
  return secTitle('Giá trị bắt được', tally.values.length + ' giá trị · ' + tally.total + ' lần', 'act') +
    '<div class="fll-hint" style="margin-bottom:8px">Nhóm bắt đầu tiên trong mẫu regex, gom theo giá ' +
    'trị' + gioiHan + '. Bấm một giá trị để duyệt những dòng có nó.</div>' +
    '<div class="fll-rank">' + tally.values
      .map((item) => '<div class="fll-rk" data-lines="' + item.indices.slice(0, 100).join(',') +
        '" data-label="' + escapeHtml(item.value.slice(0, 40)) + '" data-tip="' +
        escapeHtml(item.value) + '">' +
        '<span>' + escapeHtml(envShortValue(item.value)) + '</span>' +
        '<b style="color:var(--txt)">' + item.count + '</b></div>')
      .join('') + '</div>';
}

function renderCorrelationList() {
  const all = lensState.data.correlations;
  if (!all.length) return '';
  const buckets = correlationBucketsInView();
  const isScoped = buckets.length !== all.length;
  const note = isScoped
    ? 'Đang lọc nên chỉ liệt kê <b>' + buckets.length + '</b>/' + all.length +
      ' ID còn dòng trong tập đang xem — nhưng bấm vào vẫn mở <b>trọn</b> chuỗi, kể cả những dòng bộ lọc đang giấu.'
    : 'Một ID xuất hiện ở nhiều dòng là một request đi qua nhiều lớp. Bấm để xem trọn chuỗi.';
  const body = buckets.length
    ? '<div class="fll-rank">' + buckets
      .map((bucket) => '<div class="fll-rk" data-act="correlate" data-value="' + escapeHtml(bucket.value) + '">' +
        '<u style="width:' + ((bucket.indices.length / buckets[0].indices.length) * 100).toFixed(1) + '%"></u>' +
        '<span>' + escapeHtml(bucket.key) + ' · ' + escapeHtml(bucket.value.slice(-16)) + '</span>' +
        '<b>' + bucket.indices.length + '</b></div>')
      .join('') + '</div>'
    : emptyBecauseOfFilter(all.length, 'ID nào');
  return secTitle('Gom theo ID', isScoped ? buckets.length + '/' + all.length : buckets.length,
    isScoped ? 'act' : '') +
    '<div class="fll-hint" style="margin-bottom:8px">' + note + '</div>' + body;
}

// Mẫu bộ lọc dùng chung định dạng với permalink, chỉ khác là nằm trong localStorage
// và không kéo theo tab/dòng đang đứng — những thứ đó vô nghĩa ở feedback khác.
function renderTemplateSection() {
  const templates = lensState.filterTemplates;
  const canSave = hasAnyFilterFacet();
  const suggestion = suggestTemplateName();

  const chips = templates.length
    ? '<div class="fll-lvkey" style="margin-bottom:8px">' + templates
      .map((template) => '<span class="fll-fchip fll-tpl" data-tip="' +
        escapeHtml(describeTemplatePayload(template.payload)) + '">' +
        '<b data-act="applyTemplate" data-value="' + escapeHtml(template.name) + '">' +
        escapeHtml(template.name) + '</b>' +
        '<button data-act="deleteTemplate" data-value="' + escapeHtml(template.name) +
        '" data-tip="Xoá mẫu">&times;</button></span>')
      .join('') + '</div>'
    : '<div class="fll-hint" style="margin-bottom:8px">Chưa có mẫu nào. Đặt điều kiện rồi lưu lại ' +
      'để lần sau áp một phát.</div>';

  return secTitle('Mẫu bộ lọc', lensState.filterTemplates.length) + chips +
    '<div class="fll-row">' +
    '<input class="fll-in" id="fll-tplname" style="flex:1;min-width:140px" value="' +
    escapeHtml(tabUiState.templateName) + '" placeholder="' +
    escapeHtml(suggestion || 'Đặt điều kiện trước đã...') + '"' + (canSave ? '' : ' disabled') + '>' +
    '<button class="fll-btn" data-act="saveTemplate"' + (canSave ? '' : ' disabled') + '>Lưu mẫu</button>' +
    '</div>' +
    (canSave ? '' : '<div class="fll-hint" style="margin-top:6px">Chỉ lưu được khi đang có ít nhất ' +
      'một điều kiện.</div>');
}

function renderFilterTab() {
  const data = lensState.data;
  const filter = lensState.filter;
  const result = getFilterResult();
  // Chip đếm kiểu faceted: bỏ qua chính điều kiện của nó, nếu không thì chọn ERROR xong
  // chip WARNING về 0 và không còn đường nới rộng lại.
  const levelTally = tallyFacetCandidates('levels', (entry) => entry.level);

  const hasWindow = filter.timeFrom !== null || filter.timeTo !== null;
  return renderTemplateSection() +
    secTitle('Cửa sổ thời gian', hasWindow ? formatWindowLabel() : 'toàn bộ', hasWindow ? 'act' : '') +
    renderWindowChips(true) +
    renderSessionChips() +

    secTitle('Mức độ', filter.levels.size ? Array.from(filter.levels).join(' + ') : 'tất cả',
      filter.levels.size ? 'act' : '') +
    '<div class="fll-lvkey">' + LEVEL_ORDER
      .map((level) => '<button class="fll-chip' + (filter.levels.has(level) ? ' on' : '') +
        '" data-act="tglLevel" data-value="' + level + '">' +
        '<i class="fll-sw" style="background:' + LEVEL_COLOR[level] + '"></i>' + level +
        ' <em>' + (levelTally.get(level) || 0) + '</em></button>')
      .join('') + '</div>' +

    secTitle('Module', filter.modules.size ? 'đã chọn ' + filter.modules.size : data.modules.length,
      filter.modules.size ? 'act' : '') +
    '<input class="fll-in" id="fll-modq" placeholder="Tìm module..." value="' +
    escapeHtml(tabUiState.moduleQuery) + '" style="margin-bottom:7px">' +
    '<div class="fll-lvkey" id="fll-mod-list" style="max-height:150px;overflow-y:auto">' +
    renderModuleChips() + '</div>' +

    secTitle('Tìm trong nội dung',
      filter.text ? (filter.useRegex ? '/' + filter.text + '/' : '"' + filter.text + '"') : 'chưa đặt',
      filter.text ? 'act' : '') +
    '<input class="fll-in' + (result.isBadPattern ? ' bad' : '') + '" id="fll-re" placeholder="' +
    (filter.useRegex ? 'Regex, ví dụ: timeout|retry|88\\d{7}' : 'Chuỗi con...') + '" value="' +
    escapeHtml(filter.text) + '">' +
    '<div class="fll-row" style="margin-top:7px">' +
    '<button class="fll-chip' + (filter.useRegex ? ' on' : '') + '" data-act="tglRegex">Regex</button>' +
    '<button class="fll-chip' + (filter.hideOthers ? ' on' : '') +
    '" data-act="tglHide">Ẩn dòng không khớp</button></div>' +
    (result.isBadPattern ? '<div class="fll-hint" style="color:var(--err)">Regex không hợp lệ.</div>' : '') +
    renderCaptureSection(result) +

    renderCorrelationList() +

    secTitle('Kết quả', result.visible.length + '/' + data.entries.length,
      result.visible.length === data.entries.length ? '' : 'act') +
    '<div class="fll-hint" style="margin-bottom:10px">Đang hiện <b id="fll-count" style="color:var(--txt)">' +
    result.visible.length + '</b> / ' + data.entries.length + ' dòng.</div>' +
    '<div class="fll-row">' +
    '<button class="fll-btn pri" data-act="applyFilter">Duyệt kết quả</button>' +
    '<button class="fll-btn" data-act="copySummary" data-tip="Khối markdown gọn để dán thẳng vào ' +
    'ticket: máy, bản app, nhóm lỗi, call fail, các bước cuối, nhánh A/B, và cả những gì log KHÔNG ' +
    'trả lời được.">Copy tóm tắt</button>' +
    '<button class="fll-btn" data-act="copyVisible">Copy dòng đang hiện</button>' +
    '<button class="fll-btn" data-act="copyLink">Copy link</button>' +
    '<button class="fll-btn" data-act="resetFilter">Xoá lọc</button></div>';
}

/* ---------------------------------------------------------------- Diễn biến */

// Trước đây đây là tab "Timeline" chỉ có 3 loại mốc của APP (khởi động / khoảng lặng / nhóm lỗi):
// 29 mốc, tab mỏng nhất trong cả panel. Bước tương tác của user từng nằm ở một tab riêng — nhưng cả hai
// đều là "sắp theo timestamp thật rồi vẽ .fll-tl", tức cùng một thứ với hai nguồn khác nhau, và phải
// nhảy qua lại giữa hai tab mới ghép được câu "user bấm gì -> app đứng im -> lỗi gì". Trộn làm một.
// Trước đây loại mốc chỉ phân biệt bằng MÀU của một chấm tròn 7px ở lề trái. Màu không tự nói ra
// nghĩa: người đọc phải nhớ "hồng là chạm, xanh là màn hình" — không ai nhớ. Nay mỗi loại có một biểu
// tượng + một cái tên, và có cả hàng chú giải ngay trên danh sách.
const TIMELINE_KINDS = {
  boot: { icon: '\uD83D\uDE80', label: 'App khởi động', short: 'Khởi động' },
  gap: { icon: '\uD83D\uDCA4', label: 'Khoảng lặng, không có log', short: 'Lặng' },
  'gap-bg': { icon: '\uD83C\uDF19', label: 'App xuống nền (không phải treo)', short: 'Xuống nền' },
  err: { icon: '\u274C', label: 'Nhóm lỗi', short: 'Lỗi' },
  'jr-screen': { icon: '\uD83D\uDCF1', label: 'Màn hình hiện ra', short: 'Màn hình' },
  'jr-move': { icon: '\uD83D\uDD00', label: 'Đổi luồng tính năng', short: 'Đổi luồng' },
  'jr-tap': { icon: '\uD83D\uDC46', label: 'User chạm', short: 'Chạm' },
  'jr-saw': { icon: '\uD83D\uDC40', label: 'User nhìn thấy popup', short: 'Popup' },
  'jr-fail': { icon: '\u26A0\uFE0F', label: 'Call BE fail', short: 'Call fail' },
};

// Trước đây đây là sáu nhóm thô (App / Màn hình / Chạm / User thấy / API fail) trong khi mốc thì có
// tám loại — "App" gom cả khởi động, khoảng lặng và nhóm lỗi vào một chỗ. Nay chip chính là từng loại
// mốc, mang đúng biểu tượng của nó, và chọn được nhiều loại cùng lúc. Hàng chú giải riêng bỏ đi:
// chip đã vừa là chú giải vừa là bộ lọc.
const TIMELINE_KIND_ORDER = ['boot', 'gap', 'gap-bg', 'err', 'jr-screen', 'jr-move', 'jr-tap',
  'jr-saw', 'jr-fail'];

function timelineIcon(kind) {
  const meta = TIMELINE_KINDS[kind];
  if (!meta) return '';
  return '<span class="fll-ev-ic" data-tip="' + escapeHtml(meta.label) + '">' + meta.icon + '</span>';
}

function buildTimelineEvents(data) {
  const events = [];

  data.scopedEntries.forEach((entry) => {
    if (entry.isSessionStart) {
      events.push({ ts: entry.ts, kind: 'boot', title: 'App khởi động — phiên ' + entry.session,
        detail: entry.message, index: entry.domIndex });
    }
  });

  // Khoảng lặng là một KHOẢNG, không phải một điểm. Trước đây hàng này hiện giờ của dòng TRƯỚC khoảng
  // lặng nhưng bấm (và mũi tên) lại trỏ tới dòng SAU nó — hai đầu cách nhau cả tiếng đồng hồ, nên nhìn
  // vào thấy giao diện tự mâu thuẫn. Nay hiện cả hai mốc, và mũi tên đánh dấu cả hai đầu trên minimap.
  //
  // Hàng này ứng với HAI dòng log, nên nó đưa cả hai vào thanh duyệt (`data-lines`) chứ không nhảy tới
  // một dòng: bấm là tới dòng dừng lại, bấm `n` là sang thẳng dòng mở lại. Bản trước nhảy thẳng tới
  // dòng SAU khoảng lặng trong khi chữ trên hàng là của dòng TRƯỚC, và không có đường nào xem dòng kia.
  data.gaps.forEach((gap) => {
    // Xuống nền và treo là HAI chuyện khác hẳn nhau; gọi chung một tên thì đọc log thành đoán mò.
    const isBackground = gap.cause === 'background';
    events.push({ ts: gap.before.ts, tsEnd: gap.after.ts, kind: isBackground ? 'gap-bg' : 'gap',
      title: (isBackground ? 'App xuống nền ' : 'Khoảng lặng ') + formatDuration(gap.ms),
      detail: isBackground
        ? 'xuống nền ' + formatClock(gap.downTs) + ', trở lại ' + formatClock(gap.upTs) +
          ' — im lặng vì user rời app, không phải app treo'
        : 'dừng sau: ' + gap.before.message.slice(0, 90),
      lines: [gap.before.domIndex, gap.after.domIndex],
      linesLabel: isBackground ? 'hai đầu đoạn xuống nền' : 'hai đầu khoảng lặng' });
  });

  data.groups.filter((group) => group.level === 'ERROR' && !isGroupMuted(group)).forEach((group) => {
    events.push({ ts: group.firstTs, kind: 'err',
      title: group.indices.length + '× ' + (group.module || 'ERROR'),
      detail: group.sample.slice(0, 90), index: group.indices[0] });
  });

  // "Đổi luồng" (feature_source) đi chung nhóm với màn hình: nó cũng là chuyện dịch chuyển, và tách
  // ra thành chip thứ bảy thì hàng chip bắt đầu cuộn ngang.
  data.journey.steps.forEach((step) => {
    events.push({ ts: step.ts, kind: 'jr-' + step.kind,
      title: step.label, detail: [step.detail, step.note].filter(Boolean).join(' · '),
      index: step.domIndex, count: step.count, ms: step.ms });
  });

  return events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

function renderTimelineTab() {
  const data = getView();
  const all = buildTimelineEvents(data);
  const picked = tabUiState.tlKinds;

  let header = '<div class="fll-row" style="margin-bottom:9px">' +
    '<button class="fll-chip' + (picked.size ? '' : ' on') + '" data-act="tlKindAll">Tất cả <em>' +
    all.length + '</em></button>' +
    TIMELINE_KIND_ORDER
      .map((kind) => ({ kind, count: all.filter((event) => event.kind === kind).length }))
      .filter((row) => row.count)
      .map((row) => '<button class="fll-chip' + (picked.has(row.kind) ? ' on' : '') +
        '" data-act="tlKind" data-value="' + row.kind + '" data-tip="' +
        escapeHtml(TIMELINE_KINDS[row.kind].label) + '"><i class="fll-chip-ic">' +
        TIMELINE_KINDS[row.kind].icon + '</i>' + escapeHtml(TIMELINE_KINDS[row.kind].short) +
        ' <em>' + row.count + '</em></button>')
      .join('') + '</div>';

  // Lọc theo phiên ngay tại đây. Trước đó muốn xem riêng một phiên phải sang tab Lọc rồi quay lại —
  // mà dòng thời gian chính là chỗ để ý "phiên này khác phiên kia chỗ nào" nhất.
  const sessionRow = renderSessionChipRow();
  if (sessionRow) header += '<div style="margin-bottom:9px">' + sessionRow + '</div>';

  // Chip ngưỡng khoảng lặng chỉ có nghĩa khi mốc khoảng lặng đang hiện.
  if (!picked.size || picked.has('gap')) {
    header += '<div class="fll-row" style="margin-bottom:9px">' +
      [1000, 2000, 5000, 10000]
        .map((ms) => '<button class="fll-chip' + (lensState.gapThresholdMs === ms ? ' on' : '') +
          '" data-act="setGap" data-value="' + ms + '">lặng &ge; ' + ms / 1000 + 's</button>')
        .join('') + '</div>';
  }

  // Bốn con số ở đầu đoạn này đã nằm sẵn trên chip và trên phụ đề panel. Giữ lại một câu — cái duy
  // nhất không nhìn ra được từ giao diện.
  header += '<div class="fll-hint" style="margin:0 0 10px" data-tip="Bước tương tác đọc từ event ' +
    'MoMoTracker, đều ghi ở mức INFO nên tab Vấn đề không đếm chúng.">Sắp theo thời gian thật, ' +
    'không theo thứ tự dòng. Bước giống hệt nhau cách nhau dưới 1s gộp thành <b>N&times;</b> — ' +
    'bấm vẫn duyệt đủ từng dòng.' +
    (data !== lensState.data
      ? ' <b>Khoảng lặng chỉ cắt theo cửa sổ thời gian</b>, không đổi theo mức độ hay module.'
      : '') + '</div>';

  header += '<input class="fll-in" id="fll-tlq" placeholder="Tìm trong mốc — tên màn, tên nút, mã lỗi..." ' +
    'value="' + escapeHtml(tabUiState.tlQuery) + '" style="margin-bottom:9px">';

  return header + '<div id="fll-tl-list">' + renderTimelineList() + '</div>';
}

// Tách riêng để ô tìm chỉ vẽ lại danh sách, không đụng tới chip và chú giải ở trên — gõ một phím mà
// vẽ lại cả tab thì mất luôn tiêu điểm trong ô đang gõ.
function renderTimelineList() {
  const data = getView();
  const all = buildTimelineEvents(data);
  const picked = tabUiState.tlKinds;
  const grouped = picked.size ? all.filter((event) => picked.has(event.kind)) : all;
  const query = tabUiState.tlQuery.trim().toLowerCase();
  const events = query
    ? grouped.filter((event) => (event.title + ' ' + (event.detail || '')).toLowerCase().indexOf(query) >= 0)
    : grouped;

  if (!events.length) {
    return '<div class="fll-empty">' +
      (query ? 'Không mốc nào khớp "' + escapeHtml(tabUiState.tlQuery) + '".' : 'Không có mốc nào đáng chú ý.') +
      '</div>';
  }
  const found = query
    ? '<div class="fll-hint" style="margin:0 0 8px">Khớp <b>' + events.length + '</b>/' + grouped.length +
      ' mốc.</div>'
    : '';

  const shown = events.slice(0, tabUiState.tlLimit);
  return found + '<div class="fll-tl">' + shown
    .map((event) => '<div class="fll-ev ' + event.kind + '"' +
      (event.lines
        ? ' data-lines="' + event.lines.join(',') + '" data-label="' + escapeHtml(event.linesLabel) + '"'
        : ' data-jump="' + event.index + '"') + '>' +
      '<div class="fll-ev-t">' + timelineIcon(event.kind) +
      (event.count > 1 ? '<span class="fll-jn">' + event.count + '&times;</span>' : '') +
      escapeHtml(event.title) +
      (event.ms >= 1000 ? '<span class="fll-jms">' + formatDuration(event.ms) + '</span>' : '') +
      '<em>' + formatClock(event.ts) +
      (event.tsEnd ? ' &rarr; ' + formatClock(event.tsEnd) : '') + '</em></div>' +
      (event.detail ? '<div class="fll-ev-d">' + escapeHtml(event.detail) + '</div>' : '') +
      '</div>')
    .join('') + '</div>' +
    (events.length > shown.length
      ? '<button class="fll-btn" style="width:100%;margin-top:8px" data-act="moreTimeline">Hiện thêm — còn ' +
        (events.length - shown.length) + ' mốc</button>'
      : '');
}
/* ---------------------------------------------------------------- Cấu hình */

// Một dòng config có thể dài 5000 ký tự. Hàng chỉ hiện một đoạn; muốn xem hết thì bấm "JSON" để
// mở tấm trượt dựng sẵn (nó đã biết cắt khối JSON ra khỏi dòng log và tô màu).
function renderConfigValue(item, value, isLatest) {
  const json = value.hasJson
    ? '<button class="fll-btn fll-cfg-js" data-act="json" data-value="' + value.domIndex + '">JSON</button>'
    : '';
  // data-lines chứ không phải data-jump: một giá trị có thể được ghi lại nhiều lần, bấm vào phải
  // duyệt được cả chùm bằng n/p ở thanh dưới chứ không dừng lại ở dòng đầu tiên.
  return '<div class="fll-cfg-val' + (isLatest ? ' last' : '') +
    '" data-lines="' + value.indices.join(',') + '" data-label="' + escapeHtml(item.key) + '">' +
    '<div class="fll-cfg-vm">' + escapeHtml(value.time.slice(0, 8)) + ' · dòng ' + value.lineNo +
    (value.indices.length > 1 ? ' · ' + value.indices.length + ' dòng' : '') +
    (isLatest && item.values.length > 1 ? ' · mới nhất' : '') + '</div>' +
    '<div class="fll-cfg-v">' + escapeHtml(value.value.slice(0, 260)) +
    (value.value.length > 260 ? '…' : '') + '</div>' + json + '</div>';
}

// Một dòng config có thể dài 5000 ký tự. Hàng chỉ hiện một đoạn; muốn xem hết thì bấm "JSON" để
// mở tấm trượt dựng sẵn (nó đã biết cắt khối JSON ra khỏi dòng log và tô màu).
// Khoá nào có nhiều giá trị khác nhau thì bày hết ra (tối đa 4 giá trị gần nhất) — chính chỗ lệch
// nhau mới là thứ cần nhìn, gấp lại chỉ còn "giá trị cuối" thì mất luôn.
function renderConfigRow(item) {
  const many = item.values.length > 1
    ? '<i class="fll-cfg-chg" data-tip="Khoá này ghi ra ' + item.values.length + ' giá trị khác nhau. ' +
      'Có thể là cấu hình đổi giữa phiên — thứ dễ làm bug chỉ tái hiện được một lần. Cũng có thể chỉ ' +
      'vì payload mang theo id hoặc thời điểm khác nhau mỗi lần: bấm từng dòng dưới đây mà so.">' +
      item.values.length + ' giá trị khác nhau</i>'
    : '';
  const note = item.note ? '<i class="fll-cfg-note">' + escapeHtml(item.note) + '</i>' : '';
  const shown = item.values.slice(-4);
  const values = shown
    .map((value, index) => renderConfigValue(item, value, index === shown.length - 1))
    .join('');
  // Bản thân tiêu đề khoá cũng bấm được: duyệt HẾT mọi dòng của khoá đó, kể cả các giá trị cũ.
  return '<div class="fll-cfg' + (item.changed ? ' chg' : '') + '">' +
    '<div class="fll-cfg-hd" data-lines="' + item.indices.join(',') + '" data-label="' +
    escapeHtml(item.key) + '" data-tip="Bấm để duyệt cả ' + item.count + ' dòng của khoá này">' +
    '<b>' + escapeHtml(item.key) + '</b>' + many + note +
    '<em>' + (item.count > 1 ? item.count + '&times;' : '1 dòng') + '</em></div>' +
    (item.values.length > shown.length
      ? '<div class="fll-cfg-vm">(còn ' + (item.values.length - shown.length) + ' giá trị cũ hơn)</div>'
      : '') +
    values + '</div>';
}

function renderConfigSection(source, rows) {
  if (!rows.length) return '';
  const meta = CONFIG_SOURCE_META[source];
  return secTitle(meta.label, rows.length) +
    '<div class="fll-hint" style="margin-bottom:8px">' + meta.hint + '</div>' +
    rows.map(renderConfigRow).join('');
}

// Các call này nằm ở module HTTP nên vòng quét cấu hình cố ý bỏ qua. Dùng lại hàng của tab HTTP
// (có sẵn nút xem payload) thay vì vẽ kiểu riêng — cùng một thứ thì phải nhìn giống nhau.
function renderConfigCallSection(cfg, view) {
  if (!cfg.calls.length) return '';
  return secTitle('Call BE xin cấu hình', cfg.calls.length) +
    '<div class="fll-hint" style="margin-bottom:8px">Call có chữ <code>config</code> trên đường dẫn. ' +
    'Bấm <code>{ }</code> để xem BE trả về.</div>' +
    cfg.calls.map((call) => renderHttpCall(call, view)).join('');
}

function renderConfigTab() {
  const view = getView();
  const cfg = view.configs;
  // Đoạn này từng dài bốn câu, giải thích bằng lời những thứ chính giao diện đã nói. Nay một dòng;
  // phần cần cảnh báo (nhiều giá trị không chắc là cấu hình đổi) nằm trong chú giải của chính cái nhãn đó.
  const header = '<div class="fll-hint" style="margin-bottom:10px">Cấu hình app <b>nhận được</b> ' +
    'hoặc <b>áp dụng</b>, gom theo khóa. Bấm một dòng để nhảy tới dòng log.</div>';
  if (!cfg.hasAny) {
    return header + emptyBecauseOfFilter(lensState.data.configs.total, 'dòng cấu hình nào đọc được');
  }
  const summary = '<div class="fll-stats">' +
    statCard(cfg.total, 'khóa cấu hình', LEVEL_COLOR.INFO, 'data-act="noop"') +
    statCard(cfg.changedCount, 'đổi giữa chừng',
      cfg.changedCount ? LEVEL_COLOR.WARNING : '', 'data-act="noop"') +
    statCard(cfg.lineCount, 'dòng log gốc', '', 'data-act="noop"') + '</div>';
  return header + summary +
    CONFIG_SOURCE_ORDER.map((source) => renderConfigSection(source, cfg.bySource[source])).join('') +
    renderConfigCallSection(cfg, view);
}
// @ts-check
// gắn panel vào trang, điều phối tab, uỷ quyền sự kiện, tự quét lại khi đổi tab log

const ROOT_ID = 'fll-root';
const TAB_DEFS = [
  // Tab Chậm cũ nằm trong đây: ba mục của nó cũng là "số rút từ log" như mọi mục khác ở Tổng quan.
  { id: 'sum', label: 'Tổng quan' },
  // Tab HTTP cũ nằm trong đây: "call nào hỏng" và "lỗi gì đã nổ" là cùng một câu hỏi.
  { id: 'iss', label: 'Vấn đề', badge: countUnmutedErrorGroups, danger: true },
  // Tab duy nhất có thể tự ẩn: log nào không có dòng cấu hình nào thì tab biến mất thay vì hiện
  // một tab rỗng. Panel chỉ rộng 480px, mỗi tab thừa đều ăn vào chỗ của tab còn lại.
  { id: 'cfg', label: 'Cấu hình', badge: (data) => data.configs.total || null,
    hide: (data) => !data.configs.hasAny },
  { id: 'flt', label: 'Lọc', badge: () => getActiveFilterFacets().length || null, tone: 'act' },
  { id: 'tl', label: 'Diễn biến' },
];

// Chạy lại cả file (reload extension khi tab đang mở) = sinh một thế hệ closure mới.
// Thế hệ cũ vẫn còn listener keydown trên document và interval đang chạy: nó sẽ bắt phím
// rồi thao tác lên panel của thế hệ mới. Vì vậy mỗi lần khởi động phải dọn thế hệ trước qua biến global này.
const LENS_GLOBAL_KEY = '__feedbackLogLens';

// Con đường dọn qua window[LENS_GLOBAL_KEY] chỉ hoạt động khi hai thế hệ dùng chung một window.
// Mốc thứ hai này đi qua DOM nên không phụ thuộc điều đó: instance nào khởi động sau sẽ ghi tên mình
// lên thẻ html; instance cũ đọc thấy tên khác thì tự rút lui, nếu không lưới an toàn "root bị gỡ thì
// gắn lại" của nó sẽ dựng dậy root cũ về mỗi 2 giây.
// CHƯA XÁC MINH: có trường hợp nào còn lại khiến hai thế hệ KHÔNG chung window hay không. Mốc này ra đời
// từ thời còn bản bookmarklet chạy ở page world; bản bookmarklet đã bỏ, nhưng chưa kiểm được reload
// extension lúc tab đang mở thì thế hệ cũ nằm ở đâu, nên giữ lại.
const LENS_OWNER_ATTR = 'data-fll-owner';
const lensInstanceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Từ khi WebAdmin nhúng sẵn lens.js vào trang, trên cùng một tab có thể có HAI bản cùng chạy: bản của
// trang (page world) và bản extension của người đang sửa tool (isolated world). Hai bên không thấy
// `window` của nhau nên chỉ còn thẻ html để nhường quyền.
//
// "Ai chạy sau thì thắng" là sai cho ca này: trang chở một bản CỐ ĐỊNH, còn người đang sửa cần bản mới
// của mình ăn trước — mà thứ tự nạp thì không kiểm soát được (bundle của SPA có thể chạy sau
// document_idle). Vì vậy quyền sở hữu có XẾP HẠNG, và hạng cao luôn thắng bất kể thứ tự.
//
// Nhận diện bằng `chrome.runtime.id`: chỉ content script mới có. Page world của một trang có thể có
// `chrome` và cả `chrome.runtime`, nhưng `id` là undefined — đã đo, xem CLAUDE.md.
// Đọc qua `globalThis` chứ không viết thẳng tên `chrome`: trình duyệt không có biến đó (page world của
// Firefox/Safari) sẽ ném ReferenceError ngay lúc nạp file, mà đây là dòng chạy đầu tiên.
const LENS_RANK = (function detectLensRank() {
  const api = /** @type {any} */ (globalThis).chrome;
  return api && api.runtime && api.runtime.id ? 2 : 1;
}());

function lensOwnerMark() {
  return document.documentElement.getAttribute(LENS_OWNER_ATTR) || '';
}

// Hạng của bản đang giữ quyền. Nhãn cũ (chưa có hạng) đọc ra 0 nên bản mới luôn giành được.
function currentOwnerRank() {
  const rank = Number(lensOwnerMark().split(':')[0]);
  return Number.isFinite(rank) ? rank : 0;
}

// Có bản hạng CAO HƠN đang giữ quyền: mình phải đứng ngoài hẳn. Hạng bằng nhau thì vẫn theo luật cũ
// (ai claim sau thì thắng) — đó là ca reload extension, thế hệ mới phải thay được thế hệ cũ.
function isLensOutranked() {
  return !isLensOwner() && currentOwnerRank() > LENS_RANK;
}

function claimLensOwnership() {
  if (isLensOutranked()) return false;
  document.documentElement.setAttribute(LENS_OWNER_ATTR, LENS_RANK + ':' + lensInstanceId);
  return true;
}

function isLensOwner() {
  const mark = lensOwnerMark();
  return mark.slice(mark.indexOf(':') + 1) === lensInstanceId;
}

// WebAdmin là SPA React: bấm từ danh sách sang feedback detail KHÔNG tải lại tài liệu,
// nên content script (chạy ở document_idle) không bao giờ chạy lại. Ban đầu dùng waitForLogRows
// poll 30 giây rồi bỏ cuộc — ngồi ở trang danh sách lâu hơn thế là mất luôn cơ hội gắn.
// Thay bằng một watcher thường trú: gắn khi bảng log xuất hiện, tháo khi rời khỏi trang detail.
const PAGE_WATCH_INTERVAL_MS = 1000;
// Ô lọc nội dung chờ lâu hơn vì nó kéo theo cả lượt quét 4085 dòng; hai ô kia chỉ vẽ lại một mảnh.
const FILTER_INPUT_DEBOUNCE_MS = 180;
const LIST_INPUT_DEBOUNCE_MS = 120;

let pageWatcher = null;
let lastRowCount = 0;
// Mỗi ô tìm một timer riêng: dùng chung một biến thì gõ ô này sẽ huỷ mất cập nhật đang chờ của ô kia.
const inputTimers = {};

function debounceInput(key, delayMs, run) {
  clearTimeout(inputTimers[key]);
  inputTimers[key] = setTimeout(run, delayMs);
}

function clearInputTimers() {
  Object.keys(inputTimers).forEach((key) => clearTimeout(inputTimers[key]));
}

function hasLogRows() {
  return !!document.querySelector(ROW_SELECTOR);
}

function disposePreviousInstance() {
  const previous = window[LENS_GLOBAL_KEY];
  if (previous && typeof previous.dispose === 'function') previous.dispose();
  const leftover = document.getElementById(ROOT_ID);
  if (leftover) leftover.remove();
}

// Phải gỡ đúng root CỦA CHÍNH instance này, không được lấy getElementById: khi một instance khác
// đã tiếp quản thì id đó đang trỏ tới panel của nó.
// shouldRestorePage=false khi mình rút lui vì người khác tiếp quản — lúc ấy class lọc trên bảng log
// là của chủ mới, đừng động vào.
function disposeSelf(shouldRestorePage) {
  window.removeEventListener('keydown', handleShortcut, LENS_KEY_LISTENER_OPTIONS);
  if (pageWatcher) clearInterval(pageWatcher);
  pageWatcher = null;
  // Timer còn treo sẽ chạy trên panel đã bị gỡ, phải dọn.
  clearInputTimers();
  detachPageHover();
  if (lensState.el.root) lensState.el.root.remove();
  if (shouldRestorePage) {
    document.querySelectorAll('.fll-filtering, .fll-dropping, .fll-drop, .fll-hit')
      .forEach((el) => el.classList.remove('fll-filtering', 'fll-dropping', 'fll-drop', 'fll-hit'));
  }
}

function registerInstance() {
  window[LENS_GLOBAL_KEY] = { dispose: function dispose() { disposeSelf(true); } };
}

// timeFrom/timeTo là mốc TUYỆT ĐỐI, mà trang admin là SPA: bấm sang feedback khác thì log đổi nội
// dung nhưng bộ lọc còn nguyên. Đo thật: ở log 1 bấm "2 phút cuối" rồi sang log 2 -> bảng log còn
// 0/7107 dòng, chip ghi một khoảng giờ không hề tồn tại trong log 2.
//
// Hai đường xử lý, khác nhau ở chỗ có biết người dùng MUỐN gì không:
//   - đang bật preset ("N cuối") -> tính lại theo lastTs mới, ý định vẫn đúng trên log mới;
//   - khoảng tự kéo tay -> không đoán được, chỉ giữ nếu nó còn giao với log mới, không thì bỏ hẳn.
// Trường hợp log dài thêm (vẫn là log cũ, chỉ có dòng mới) thì khoảng cũ vẫn giao nên được giữ.
function retargetTimeWindow(data) {
  const filter = lensState.filter;
  if (filter.timeFrom === null && filter.timeTo === null) return;
  if (filter.windowPreset) {
    filter.timeTo = data.lastTs;
    filter.timeFrom = Math.max(data.firstTs, data.lastTs - filter.windowPreset);
    return;
  }
  const from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
  const to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
  if (from <= data.lastTs && to >= data.firstTs) return;
  filter.timeFrom = null;
  filter.timeTo = null;
}

function scanLog() {
  const data = attachInsights(analyzeLog(lensState.gapThresholdMs));
  data.gapThresholdLabel = lensState.gapThresholdMs / 1000 + 's';
  lensState.data = data;
  lensState.view = data;
  // Dựng lại chỉ mục "phần tử dòng -> entry" và gắn lại listener: quét lại nghĩa là DOM cũ có thể đã
  // bị trang thay hết, chỉ mục cũ trỏ vào node đã gỡ.
  indexRowElements(data);
  attachPageHover(data.container);
  // Kết quả lọc cũ trỏ tới mảng entries cũ (và DOM cũ), phải bỏ đi để lần vẽ tab sau tính lại.
  lensState.lastFilterResult = null;
  lensState.forcedVisibleIndices.clear();
  lensState.el.lastHit = null;
  lensState.isFiltering = false;
  lensState.visibleCount = data.entries.length;
  // Sang log khác thì khoảng đang phóng to không còn nghĩa gì.
  lensState.mapZoom = null;
  lensState.mapZoomStack = [];
  retargetTimeWindow(data);
  // Đổi sang log khác (trang admin thay nội dung mà không tải lại) có thể làm tab đang mở biến mất.
  // Không bắt lại thì thân panel vẽ tab đó trong khi trên thanh tab không còn nút nào sáng.
  const current = TAB_DEFS.find((tab) => tab.id === lensState.tab);
  if (current && current.hide && current.hide(data)) lensState.tab = 'sum';
  return data;
}

function renderTab() {
  const body = lensState.el.body;
  if (!body) return;
  if (lensState.tab === 'sum') body.innerHTML = renderSummaryTab();
  else if (lensState.tab === 'iss') body.innerHTML = renderIssuesTab();
  else if (lensState.tab === 'cfg') body.innerHTML = renderConfigTab();
  else if (lensState.tab === 'flt') body.innerHTML = renderFilterTab();
  else body.innerHTML = renderTimelineTab();
  // Mục đang trỏ tới vừa bị thay thế -> mũi tên trỏ vào hư không, dọn trước khi gom mục.
  hideAim();
  hideTooltip();
  collapsifySections(body, lensState.tab);
  body.scrollTop = 0;
  renderTabBar();
  refreshFilterBar();
}

// Gõ trong ô tìm thì mọi con số trong tab đều đổi theo (chip đếm faceted, danh sách ID, trạng thái
// nút lưu mẫu). Trước đây không vẽ lại vì sợ mất con trỏ — nhưng như thế cả tab đứng yên ở trạng thái cũ,
// người dùng thấy "1 bộ lọc đang bật" mà phần Mẫu bộ lọc vẫn báo chưa có điều kiện nào.
// Vẽ lại hết rồi trả lại tiêu điểm + vị trí con trỏ + vị trí cuộn.
function renderTabPreservingFocus() {
  const body = lensState.el.body;
  // selectionStart/setSelectionRange chỉ có trên ô nhập. Kiểm bằng typeof rồi mới dùng, còn ép kiểu
  // ở đây là để trình kiểm kiểu biết điều đó — không đổi hành vi lúc chạy.
  const active = /** @type {HTMLInputElement | null} */ (document.activeElement);
  const activeId = active && active.id;
  const hasSelection = active && typeof active.selectionStart === 'number';
  const selectionStart = hasSelection ? active.selectionStart : null;
  const selectionEnd = hasSelection ? active.selectionEnd : null;
  const scrollTop = body ? body.scrollTop : 0;

  renderTab();

  if (body) body.scrollTop = scrollTop;
  if (!activeId) return;
  const restored = /** @type {HTMLInputElement | null} */ (document.getElementById(activeId));
  if (!restored) return;
  restored.focus();
  if (selectionStart !== null && typeof restored.setSelectionRange === 'function') {
    restored.setSelectionRange(selectionStart, selectionEnd);
  }
}

function renderTabBar() {
  lensState.el.tabs.innerHTML = TAB_DEFS
    // Truyền data ĐẦY ĐỦ chứ không phải view đang lọc: lọc xuống còn 3 dòng thì trong tập đó không còn
    // dòng cấu hình nào, và tab Cấu hình sẽ BIẾN MẤT giữa chừng — thấy khi chụp màn hình. Tab có hay
    // không là tính chất của cả log, còn nội dung bên trong mới chạy theo bộ lọc.
    .filter((tab) => !(tab.hide && tab.hide(lensState.data)))
    .map((tab) => {
      const count = tab.badge ? tab.badge(getView()) : null;
      const tone = tab.danger ? ' err' : tab.tone ? ' ' + tab.tone : '';
      const badge = count == null ? '' : '<i class="fll-bdg' + tone + '">' + formatCount(count) + '</i>';
      return '<button class="fll-tab' + (lensState.tab === tab.id ? ' on' : '') + '" data-tab="' + tab.id + '">' +
        tab.label + badge + '</button>';
    })
    .join('');
}

function switchTab(tabId) {
  closeSheet();
  lensState.tab = tabId;
  renderTab();
}

function refreshHeader() {
  const data = lensState.data;
  // Phải trừ phần "app xuống nền" y hệt thẻ thống kê ở Tổng quan. Đo trên log thật 9363 dòng: phụ đề
  // ghi 34 trong khi thẻ ghi 28 — hai con số cho cùng một thứ, người đọc không biết tin cái nào.
  const gaps = data.gaps.filter((gap) => gap.cause !== 'background');
  const background = data.gaps.length - gaps.length;
  lensState.el.sub.textContent = data.entries.length + ' dòng · ' + data.sessionCount + ' phiên · ' +
    data.levels.ERROR + ' lỗi · ' + gaps.length + ' khoảng lặng' +
    (background ? ' · ' + background + ' lần xuống nền' : '');
}

// Đếm con của container (O(1)) thay vì querySelectorAll cả tài liệu 8000+ node mỗi 2 giây.
// PHẢI dùng đúng hàm này cho cả giá trị khởi tạo lẫn mỗi lần kiểm: container còn 2 div đệm
// ngoài các dòng log (4087 vs 4085), lấy hai nguồn khác nhau là tick đầu tiên sẽ rescan oan
// và xoá sạch trạng thái lọc trong khi DOM vẫn đang bị lọc.
function countLogRows() {
  const container = lensState.data && lensState.data.container;
  return container && container.isConnected
    ? container.childElementCount
    : document.querySelectorAll(ROW_SELECTOR).length;
}

function rescan() {
  scanLog();
  renderMinimap();
  refreshHeader();
  // Bảng log vừa được dựng lại: áp lại bộ lọc đang bật để DOM và state không lệch nhau.
  applyFilter(false);
  renderTab();
}

// Cố ý KHÔNG gỡ listener phím và KHÔNG dừng pageWatcher: chúng là đường để Alt+L mở lại
// mà không phải reload trang. Cờ isDismissed nên watcher sẽ không tự gắn lại trên feedback này.
function closeLens() {
  const root = document.getElementById(ROOT_ID);
  if (root) root.remove();
  document.querySelectorAll('.fll-filtering, .fll-dropping, .fll-drop, .fll-hit')
    .forEach((el) => el.classList.remove('fll-filtering', 'fll-dropping', 'fll-drop', 'fll-hit'));
  lensState.el.root = null;
  lensState.el.panel = null;
  lensState.data = null;
  lensState.isDismissed = true;
}

// Rời khỏi trang detail (SPA đổi route): tháo panel nhưng giữ watcher và phím tắt,
// để vào feedback khác là gắn lại. Bộ lọc đặt cho feedback cũ phải xoá — giữ lại là dữ liệu
// feedback mới hiện ra thiếu mà người dùng không biết. Riêng danh sách tắt tiếng thì giữ.
function detachLens() {
  clearInputTimers();
  detachPageHover();
  if (lensState.el.root) lensState.el.root.remove();
  // Trả bảng log về nguyên trạng TRƯỚC khi bỏ data: SPA có thể dùng lại chính container đó cho feedback
  // kế tiếp. Còn sót .fll-filtering/.fll-keep thì feedback mới chỉ hiện vài chục dòng trong khi panel
  // báo "không có bộ lọc nào" — đúng kiểu sai mà người dùng không biết.
  setLogFilteringMode(false);
  document.querySelectorAll('.fll-keep, .fll-drop, .fll-hit')
    .forEach((el) => el.classList.remove('fll-keep', 'fll-drop', 'fll-hit'));
  lensState.el = { root: null, panel: null };
  lensState.data = null;
  lensState.view = null;
  lensState.matches = [];
  lensState.matchPos = -1;
  lensState.isFiltering = false;
  lensState.lastFilterResult = null;
  lensState.visibleCount = 0;
  lensState.forcedVisibleIndices.clear();
  lensState.filter.levels.clear();
  lensState.filter.modules.clear();
  lensState.filter.text = '';
  lensState.filter.timeFrom = null;
  lensState.filter.timeTo = null;
  lensState.filter.windowPreset = null;
  lensState.filter.session = null;
  lensState.filter.skipDuplicate = false;
  lensState.mapZoom = null;
  lensState.mapZoomStack = [];
  // tabUiState cũng là trạng thái của MỘT feedback: ô tìm nhóm lỗi, ô tìm HTTP, chip loại mốc, chế độ
  // xem nhóm đã tắt tiếng. Để sót thì sang feedback sau người dùng thấy danh sách đã bị lọc sẵn bằng
  // một câu tìm của log trước — cùng một loại lỗi với việc để sót bộ lọc.
  resetTabUiState();
  lensState.isShowingMuted = false;
  lensState.isDismissed = false;
  lastRowCount = 0;
}

function tickPageWatcher() {
  // Kiểm quyền TRƯỚC mọi thứ khác: bản bị vượt hạng phải rút lui kể cả khi nó chưa gắn được vào trang
  // nào. Để sau nhánh "chưa gắn" thì nó cứ thử gắn lại mỗi nhịp trong khi đã có chủ khác.
  if (isLensOutranked()) {
    disposeSelf(false);
    return;
  }
  if (!lensState.data || !lensState.el.root) {
    if (!lensState.isDismissed && hasLogRows()) startLens(!lensState.wasPanelOpen);
    return;
  }
  // Một instance mới hơn đã tiếp quản: rút lui hẳn.
  if (!isLensOwner()) {
    disposeSelf(false);
    return;
  }
  if (!hasLogRows()) {
    detachLens();
    return;
  }
  // Lưới an toàn: trang admin từng gỡ #fll-root khỏi body khi xử lý phím. Nếu bị gỡ thì gắn lại.
  if (!lensState.el.root.isConnected) document.body.appendChild(lensState.el.root);
  const current = countLogRows();
  if (current === lastRowCount || !current) return;
  lastRowCount = current;
  if (lensState.el.panel && document.contains(lensState.el.panel)) rescan();
  else {
    scanLog();
    showPill();
  }
}

function startPageWatcher() {
  if (pageWatcher) clearInterval(pageWatcher);
  pageWatcher = setInterval(tickPageWatcher, PAGE_WATCH_INTERVAL_MS);
}

function showPill() {
  const root = lensState.el.root;
  const facetCount = getActiveFilterFacets().length;
  lensState.wasPanelOpen = false;
  root.innerHTML = '<style>' + PANEL_CSS + '</style>' +
    '<div class="fll-pill" data-act="open"><span style="color:var(--acc)">◆</span> Log Lens · <b>' +
    countUnmutedErrorGroups(getView()) + '</b> nhóm lỗi · ' +
    getView().gaps.filter((gap) => gap.cause !== 'background').length + ' khoảng lặng' +
    (facetCount ? ' · <b style="color:var(--acc)">' + facetCount + ' bộ lọc</b>' : '') + '</div>';
}

function mountPanel() {
  const root = lensState.el.root;
  lensState.wasPanelOpen = true;
  root.innerHTML = '<style>' + PANEL_CSS + '</style>' +
    '<div class="fll-panel">' +
    '<div class="fll-grip"></div>' +
    '<header class="fll-hd"><span class="fll-dot"></span>' +
    '<div><div class="fll-tt">Feedback Log Lens</div><div class="fll-sub"></div></div>' +
    '<div class="fll-hd-sp"></div>' +
    '<button class="fll-ico" data-act="rescan" data-tip="Quét lại (khi đổi tab log)">⟳</button>' +
    '<button class="fll-ico" data-act="minimize" data-tip="Thu nhỏ (Esc)">–</button>' +
    // '<button class="fll-ico" data-act="close" data-tip="Đóng hẳn — Alt+L để mở lại">×</button>' +
    '</header>' +
    '<nav class="fll-tabs"></nav>' +
    '<div class="fll-bar" hidden></div>' +
    '<div class="fll-map" data-tip="Bấm để nhảy tới mốc đó. Kéo để chọn khoảng thời gian; ' +
    'kéo giữa vùng sáng để dời, kéo mép để co giãn, nháy đúp để bỏ chọn."></div>' +
    '<div class="fll-maplbl"></div>' +
    '<div class="fll-body"></div>' +
    '<footer class="fll-ft" hidden>' +
    '<button class="fll-nav" data-act="prev" data-tip="Dòng trước — phím p">&#9664;<em>p</em></button>' +
    '<div class="fll-info"></div>' +
    '<button class="fll-nav" data-act="next" data-tip="Dòng sau — phím n"><em>n</em>&#9654;</button></footer>' +
    '<div class="fll-corner" data-tip="Kéo để đổi cả chiều rộng và chiều cao"></div></div>';

  const panel = root.querySelector('.fll-panel');
  lensState.el.panel = panel;
  lensState.el.tabs = root.querySelector('.fll-tabs');
  lensState.el.body = root.querySelector('.fll-body');
  lensState.el.bar = root.querySelector('.fll-bar');
  lensState.el.map = root.querySelector('.fll-map');
  lensState.el.mapLabel = root.querySelector('.fll-maplbl');
  lensState.el.info = root.querySelector('.fll-info');
  lensState.el.sub = root.querySelector('.fll-sub');

  lensState.el.map.addEventListener('mousedown', handleMinimapMouseDown);
  lensState.el.map.addEventListener('mousemove', handleMinimapHover);
  lensState.el.map.addEventListener('dblclick', handleMinimapDoubleClick);
  // Gắn ở PANEL chứ không ở thân: như vậy các hàng trong tấm trượt (.fll-sheet) cũng được vẽ mũi tên.
  panel.addEventListener('mouseover', handleLensHover);
  panel.addEventListener('mouseleave', hideAim);
  // 'scroll' không nổi bọt lên, phải bắt ở pha capture mới thấy được cuộn của thân và của tấm trượt.
  panel.addEventListener('scroll', handleAimScroll, true);

  applyPanelGeometry(panel);
  enableDragAndResize(panel, root.querySelector('.fll-hd'), root.querySelector('.fll-grip'),
    root.querySelector('.fll-corner'));
  renderMinimap();
  refreshHeader();
  renderTab();
  renderFooter();
}

/* ---------------------------------------------------------- uỷ quyền click */

function handleLensClick(event) {
  const hit = event.target.closest('[data-act],[data-tab],[data-lines],[data-jump],[data-group],' +
    '[data-module],[data-level],[data-call],[data-bucket],[data-event],[data-saw],[data-apifail],' +
    '[data-jscreen],[data-jtap],[data-tracefail],[data-jload],[data-env],[data-envapp]');
  if (!hit) return;
  // groups/httpCalls đọc theo view (đang lọc thì là của tập đang hiện, đúng như tab vừa vẽ);
  // correlations vẫn lấy từ data vì chuỗi một request phải xem trọn vẹn.
  const data = lensState.data;
  const view = getView();
  const value = hit.getAttribute('data-value');

  if (hit.dataset.tab) return switchTab(hit.dataset.tab);
  // data-lines = "hàng này ứng với từng này dòng log". Phải xét TRƯỚC data-jump: nhảy một dòng thì
  // thanh dưới không có gì để duyệt, người dùng kẹt ở dòng đầu tiên của nhóm.
  if (hit.dataset.lines) {
    const indices = hit.dataset.lines.split(',').map(Number).filter((index) => !Number.isNaN(index));
    return setMatches(indices, hit.getAttribute('data-label') || (indices.length + ' dòng'));
  }
  if (hit.dataset.jump) return jumpToIndex(Number(hit.dataset.jump));
  if (hit.dataset.bucket) {
    // Vừa kéo chọn khoảng xong: cú click đi kèm mouseup không được biến thành lệnh nhảy dòng.
    if (lensState.suppressMapClick) return undefined;
    const index = Number(hit.dataset.bucket);
    return index >= 0 ? jumpToIndex(index) : undefined;
  }
  if (hit.dataset.group) {
    const group = view.groups[Number(hit.dataset.group)];
    return setMatches(group.indices, group.level + ' · ' + (group.module || 'no module'));
  }
  if (hit.dataset.module) return filterByModule(hit.dataset.module);
  if (hit.dataset.level) return filterByLevel(hit.dataset.level);
  if (hit.dataset.event) {
    lensState.filter.text = 'event: ' + hit.dataset.event;
    lensState.filter.useRegex = false;
    // Lọc trước, chuyển tab sau — xem chú thích của filterByLevel().
    applyFilter(true);
    return switchTab('flt');
  }
  // Một giá trị trong mục Máy & môi trường ứng với NHIỀU dòng, nên đưa cả tập vào thanh duyệt thay vì
  // nhảy tới một dòng — cùng luật với hàng khoảng lặng.
  if (hit.dataset.env != null) {
    const at = hit.dataset.env.split(':');
    const field = view.environment.watched[Number(at[0])];
    const item = field && field.values[Number(at[1])];
    if (!item || !item.indices.length) return undefined;
    return setMatches(item.indices, field.label + ': ' + item.value);
  }
  if (hit.dataset.envapp != null) {
    const at = hit.dataset.envapp.split(':');
    const app = view.environment.miniApps[Number(at[0])];
    if (!app) return undefined;
    const bundle = at.length > 1 ? app.bundles[Number(at[1])] : null;
    const indices = bundle ? bundle.indices : app.indices;
    if (!indices.length) return undefined;
    return setMatches(indices, bundle
      ? app.appId + ' build ' + bundle.buildNumber
      : 'MiniApp: ' + app.appId);
  }
  if (hit.dataset.call) {
    const call = view.httpCalls[Number(hit.dataset.call)];
    const indices = [call.reqIndex, call.resIndex].filter((index) => index != null);
    return setMatches(indices, call.method + ' ' + call.path);
  }
  if (hit.dataset.saw) {
    const row = view.journey.saw[Number(hit.dataset.saw)];
    return row ? setMatches(row.indices, 'User thấy · ' + row.key) : undefined;
  }
  if (hit.dataset.apifail) {
    const row = view.journey.fails[Number(hit.dataset.apifail)];
    return row ? setMatches(row.indices, 'API fail · ' + row.key) : undefined;
  }
  if (hit.dataset.jscreen) {
    const row = view.journey.screens.find((item) => item.key === hit.dataset.jscreen);
    return row ? setMatches(row.indices, 'Màn hình · ' + row.key) : undefined;
  }
  if (hit.dataset.jtap) {
    const row = view.journey.taps.find((item) => item.key === hit.dataset.jtap);
    return row ? setMatches(row.indices, 'Chạm · ' + row.key) : undefined;
  }
  if (hit.dataset.jload) {
    const row = view.journey.screenLoads.find((item) => item.key === hit.dataset.jload);
    return row ? setMatches(row.indices, 'Tải màn · ' + row.key) : undefined;
  }
  if (hit.dataset.tracefail) {
    const row = view.traceIssues.fails[Number(hit.dataset.tracefail)];
    return row ? setMatches(row.indices, 'traceFail · ' + row.key.slice(0, 40)) : undefined;
  }

  const action = hit.dataset.act;
  if (action === 'noop') return undefined;
  if (action === 'clearFilters') {
    resetFilter();
    return renderTab();
  }
  if (action === 'clearFacet') {
    clearFilterFacet(value);
    applyFilter(false);
    return renderTab();
  }
  if (action === 'close') return closeLens();
  if (action === 'closeSheet') return closeSheet();
  if (action === 'json') return renderJsonSheet(Number(value));
  if (action === 'payload') {
    const reqIndex = hit.dataset.req === '' ? null : Number(hit.dataset.req);
    const resIndex = hit.dataset.res === '' ? null : Number(hit.dataset.res);
    return renderPayloadSheet(reqIndex, resIndex, reqIndex == null ? 'res' : 'req');
  }
  if (action === 'payloadSide') return switchPayloadSide(value);
  if (action === 'toggleWrap') return togglePayloadWrap(hit);
  if (action === 'correlate') return renderCorrelationSheet(value);
  if (action === 'browseCorrelation') {
    const bucket = data.correlations.find((item) => item.value === value);
    closeSheet();
    const shortValue = value.length > 18 ? value.slice(0, 8) + '…' + value.slice(-6) : value;
    return bucket ? setMatches(bucket.indices, bucket.key + ' = ' + shortValue) : undefined;
  }
  if (action === 'copyJson') {
    const block = document.getElementById(value);
    return block ? copyTextToClipboard(block.textContent, hit, 'Đã copy') : undefined;
  }
  if (action === 'copyLink') return copyTextToClipboard(buildPermalink(), hit, 'Đã copy link');
  if (action === 'applyTemplate') {
    applyFilterTemplate(value);
    return renderTab();
  }
  if (action === 'deleteTemplate') {
    deleteFilterTemplate(value);
    return renderTab();
  }
  if (action === 'saveTemplate') {
    if (!saveCurrentFilterAsTemplate(tabUiState.templateName)) return undefined;
    tabUiState.templateName = '';
    return renderTab();
  }
  if (action === 'setWindow') {
    setTimeWindowPreset(Number(value) || 0);
    lensState.filter.hideOthers = true;
    applyFilter(hasAnyTimeRange());
    return renderTab();
  }
  if (action === 'setSession') {
    lensState.filter.session = Number(value) || null;
    lensState.filter.hideOthers = true;
    applyFilter(!!lensState.filter.session);
    return renderTab();
  }
  if (action === 'filterFeature') {
    lensState.filter.text = value;
    lensState.filter.useRegex = false;
    lensState.filter.hideOthers = true;
    applyFilter(true);
    return switchTab('flt');
  }
  if (action === 'mute') {
    const group = view.groups[Number(value)];
    if (group) toggleMutedSignature(group.key);
    return renderTab();
  }
  if (action === 'toggleNoise') {
    tabUiState.showNoise = !tabUiState.showNoise;
    return renderTab();
  }
  if (action === 'toggleMutedView') {
    lensState.isShowingMuted = !lensState.isShowingMuted;
    return renderTab();
  }
  if (action === 'moreSection') {
    expandSection(hit);
    return;
  }
  if (action === 'moreIssues') {
    tabUiState.issueLimit += ISSUE_PAGE_SIZE;
    const list = document.getElementById('fll-issue-list');
    if (list) list.innerHTML = renderIssueList();
    return undefined;
  }
  if (action === 'mapZoomIn') {
    const range = getVisibleTimeRange();
    // Nhớ nấc đang đứng trước khi phóng sâu, để còn lùi từng nấc. Nấc đầu tiên là null = cả log.
    lensState.mapZoomStack.push(lensState.mapZoom);
    lensState.mapZoom = { from: range.from, to: range.to };
    renderMinimap();
    return undefined;
  }
  if (action === 'mapZoomOut') {
    lensState.mapZoom = lensState.mapZoomStack.length ? lensState.mapZoomStack.pop() : null;
    renderMinimap();
    return undefined;
  }
  if (action === 'mapZoomReset') {
    lensState.mapZoom = null;
    lensState.mapZoomStack = [];
    renderMinimap();
    return undefined;
  }
  if (action === 'tglSkipDuplicate') {
    lensState.filter.skipDuplicate = !lensState.filter.skipDuplicate;
    applyFilter(true);
    return renderTab();
  }
  if (action === 'jumpDuplicate') {
    const block = lensState.data.duplicate;
    return block ? jumpToIndex(block.from) : undefined;
  }
  if (action === 'tglSec') return toggleSection(hit);
  if (action === 'rescan') return rescan();
  if (action === 'minimize') return showPill();
  if (action === 'open') return mountPanel();
  if (action === 'prev') return moveMatch(-1);
  if (action === 'next') return moveMatch(1);
  if (action === 'gotoIssues') {
    switchTab('iss');
    // Mục mặc định đang thu lại. Bấm "47 ERROR" mà sang tab chỉ thấy mấy dòng tiêu đề thì coi như
    // không đi đến đâu — mở sẵn đúng mục chứa danh sách lỗi.
    const first = lensState.el.body && lensState.el.body.querySelector('[data-group]');
    if (first) revealElement(first);
    return undefined;
  }
  if (action === 'gotoHttp') {
    switchTab('iss');
    const httpSection = lensState.el.body && lensState.el.body.querySelector('[data-sec="Call HTTP"]');
    if (httpSection) {
      revealElement(httpSection);
      httpSection.scrollIntoView({ block: 'start' });
    }
    return undefined;
  }
  if (action === 'gotoTimeline') return switchTab('tl');
  if (action === 'gotoSessions') {
    switchTab('flt');
    // Tab Lọc có 9 mục; nhảy thẳng tới mục Phiên app thay vì để người dùng tự dò tìm.
    const chip = lensState.el.body && lensState.el.body.querySelector('[data-act="setSession"]');
    if (chip) {
      // Mục mặc định đang thu lại: không mở ra thì cuộn tới cũng không thấy gì.
      revealElement(chip);
      chip.scrollIntoView({ block: 'center' });
    }
    return undefined;
  }
  if (action === 'issueLevel') {
    tabUiState.issueLevel = value;
    return renderTab();
  }
  if (action === 'tlKind') {
    // Chọn được nhiều loại cùng lúc: "chỉ xem chạm + popup" là câu hay hỏi nhất khi đọc lại một ca lỗi.
    toggleSetValue(tabUiState.tlKinds, value);
    tabUiState.tlLimit = TIMELINE_PAGE_SIZE;
    return renderTab();
  }
  if (action === 'tlKindAll') {
    tabUiState.tlKinds.clear();
    tabUiState.tlLimit = TIMELINE_PAGE_SIZE;
    return renderTab();
  }
  if (action === 'moreTimeline') {
    tabUiState.tlLimit += TIMELINE_PAGE_SIZE;
    const list = document.getElementById('fll-tl-list');
    if (list) {
      list.innerHTML = renderTimelineList();
      return undefined;
    }
    return renderTab();
  }
  if (action === 'httpAll' || action === 'httpBad') {
    tabUiState.httpOnlyBad = action === 'httpBad';
    return renderTab();
  }
  if (action === 'setGap') {
    lensState.gapThresholdMs = Number(value);
    return rescan();
  }
  if (action === 'tglLevel') {
    toggleSetValue(lensState.filter.levels, value);
    applyFilter(false);
    return renderTab();
  }
  if (action === 'tglModule') {
    toggleSetValue(lensState.filter.modules, value);
    applyFilter(false);
    return renderTab();
  }
  if (action === 'tglRegex') {
    lensState.filter.useRegex = !lensState.filter.useRegex;
    applyFilter(false);
    return renderTab();
  }
  if (action === 'tglHide') {
    lensState.filter.hideOthers = !lensState.filter.hideOthers;
    applyFilter(false);
    return renderTab();
  }
  if (action === 'applyFilter') return applyFilter(true);
  if (action === 'resetFilter') {
    resetFilter();
    return renderTab();
  }
  if (action === 'copySummary') {
    // Tóm tắt luôn đọc data ĐẦY ĐỦ, không đọc view đang lọc: ticket phải mô tả cả log chứ không phải
    // mô tả cái lát cắt người đọc đang mở.
    return copyTextToClipboard(buildTicketSummary(lensState.data), hit, 'Đã copy tóm tắt');
  }
  if (action === 'copyVisible') return copyVisibleLines(hit);
  return undefined;
}

function toggleSetValue(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

// Đổi nhãn nút rồi trả lại. Phải có cả nhánh HỎNG: navigator.clipboard từ chối khi tab không được lấy
// nét (hoặc trình duyệt chặn), lúc đó promise reject và trước đây nút đứng im — người dùng tưởng đã
// copy xong rồi đi dán, dán ra thứ cũ.
function copyTextToClipboard(text, button, doneLabel) {
  const original = button.textContent;
  const show = (label) => {
    button.textContent = label;
    setTimeout(() => {
      button.textContent = original;
    }, 1600);
  };
  if (!navigator.clipboard) {
    show('Trình duyệt chặn copy');
    return;
  }
  navigator.clipboard.writeText(text)
    .then(() => show(doneLabel))
    .catch(() => show('Không copy được — bấm vào panel rồi thử lại'));
}

function copyVisibleLines(button) {
  const text = lensState.data.entries
    .filter((entry) => entry.el && isRowVisible(entry))
    .map((entry) => entry.raw)
    .join('\n');
  copyTextToClipboard(text, button, 'Đã copy ' + text.split('\n').length + ' dòng');
}

/* ----------------------------------------------------- uỷ quyền gõ phím */

function handleLensInput(event) {
  const target = event.target;
  // Ô tìm của từng mục: lọc thẳng trên DOM đã vẽ, không vẽ lại gì nên không cần debounce.
  if (target.classList && target.classList.contains('fll-secq')) {
    filterSectionRows(target);
    return;
  }
  // Vẽ lại tới 50 thẻ nhóm, mỗi thẻ một sparkline 26 cột — đo được 2 khung hình rơi nếu chạy mỗi phím.
  if (target.id === 'fll-q') {
    tabUiState.issueQuery = target.value;
    debounceInput('issueQuery', LIST_INPUT_DEBOUNCE_MS, () => {
      const list = document.getElementById('fll-issue-list');
      if (list) list.innerHTML = renderIssueList();
    });
    return;
  }
  // Giữ tên mẫu người dùng đang gõ: sửa bộ lọc sẽ vẽ lại tab, không giữ thì tên bay mất.
  if (target.id === 'fll-tplname') {
    tabUiState.templateName = target.value;
    return;
  }
  // Quét cả payload của mọi request nên nặng hơn ô tìm nhóm; vẫn chỉ vẽ lại danh sách HTTP.
  if (target.id === 'fll-httpq') {
    tabUiState.httpQuery = target.value;
    debounceInput('httpQuery', LIST_INPUT_DEBOUNCE_MS, () => {
      const list = document.getElementById('fll-http-list');
      if (list) list.innerHTML = renderHttpList();
    });
    return;
  }
  if (target.id === 'fll-tlq') {
    tabUiState.tlQuery = target.value;
    // Gõ lại từ đầu thì trả về trang đầu, không thì đang ở "đã hiện 240 mốc" mà lọc còn 3.
    tabUiState.tlLimit = TIMELINE_PAGE_SIZE;
    debounceInput('tlQuery', LIST_INPUT_DEBOUNCE_MS, () => {
      const list = document.getElementById('fll-tl-list');
      if (list) list.innerHTML = renderTimelineList();
    });
    return;
  }
  if (target.id === 'fll-modq') {
    tabUiState.moduleQuery = target.value;
    debounceInput('moduleQuery', LIST_INPUT_DEBOUNCE_MS, () => {
      const list = document.getElementById('fll-mod-list');
      if (list) list.innerHTML = renderModuleChips();
    });
    return;
  }
  // Đường nặng nhất: quét 4085 dòng, ghi class lên bảng log rồi vẽ lại cả tab. Để chờ lâu hơn.
  if (target.id === 'fll-re') {
    lensState.filter.text = target.value;
    debounceInput('filterText', FILTER_INPUT_DEBOUNCE_MS, () => {
      applyFilter(false);
      renderTabPreservingFocus();
    });
  }
}

/* -------------------------------------------------------------------- boot */

function startLens(startMinimized) {
  // Nhận quyền TRƯỚC khi dọn: nếu dọn xong mới nhận, nhịp watcher của instance cũ chạm vào đúng khe hở
  // đó sẽ tưởng root của nó bị gỡ oan và dựng lại ngay.
  // Không giành được (có bản hạng cao hơn đang chạy) thì đứng ngoài hẳn: không dựng panel, không quét
  // 4000 dòng, và bỏ luôn watcher của mình.
  if (!claimLensOwnership()) {
    if (pageWatcher) clearInterval(pageWatcher);
    pageWatcher = null;
    return;
  }
  disposePreviousInstance();
  registerInstance();

  const root = document.createElement('div');
  root.id = ROOT_ID;
  document.body.appendChild(root);
  lensState.el.root = root;
  lensState.mutedSignatures = loadMutedSignatures();
  lensState.filterTemplates = loadFilterTemplates();

  scanLog();
  // Mở bằng link chia sẻ thì luôn bung panel, kể cả khi đang chạy dưới dạng extension (mặc định thu gọn):
  // người nhận link chỉ thấy một cái pill trong khi bảng log đã bị lọc sẽ tưởng là không có gì xảy ra.
  const isRestoredFromLink = applyPermalinkFromHash();
  if (startMinimized && !isRestoredFromLink) showPill();
  else mountPanel();

  root.addEventListener('click', handleLensClick);
  root.addEventListener('input', handleLensInput);
  root.addEventListener('mouseover', handleLensTooltip);
  root.addEventListener('mouseleave', hideTooltip);
  // Bấm vào đâu là đang làm việc khác, không còn đợi đọc chú giải nữa. 'scroll' bắt ở pha capture vì
  // nó không nổi bọt lên.
  root.addEventListener('mousedown', hideTooltip);
  root.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('keydown', handleShortcut, LENS_KEY_LISTENER_OPTIONS);

  lensState.isDismissed = false;
  lastRowCount = countLogRows();
  startPageWatcher();
}

if (hasLogRows()) startLens(false);
// Chạy cả khi chưa gắn được: điều hướng trong SPA không tải lại tài liệu, watcher này là thứ duy nhất
// biết được "vừa vào một feedback detail mới".
startPageWatcher();
})();
