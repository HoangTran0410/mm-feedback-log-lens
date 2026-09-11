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
