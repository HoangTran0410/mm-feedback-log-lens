/*
File: src/01-analyzer.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — doc DOM log cua trang feedback admin, parse thanh entry co cau truc + thong ke
// Cac file src/*.js duoc build.sh noi lai va boc trong MOT IIFE nen dung chung scope. Dat ten khong trung nhau.

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
// Trang thai app nam ghep trong dong MQTT: "... - appState: BACKGROUND - isReady: false".
// Day la cho DUY NHAT trong log noi ra app dang o nen hay dang mo — khong co dong lifecycle rieng
// (da tim: didEnterBackground / willEnterForeground / onPause deu 0 lan tren ca ba log).
const RE_APP_STATE = /appState[:= ]+([A-Z]+)/;
// Ba moc deu ghi dung mot lan moi lan process khoi dong, deu o muc INFO va deu khong bi bat ky co
// debug nao chan (da doc source app). Do tren 50 feedback production that: "MomoDatabase init OK"
// co mat o 44/50 log — 6 log con lai can moc du phong, vi file log bi xoay vong thi dong khoi dong
// la dong bi cat dau tien.
//
// NHUNG ca ba moc deu no trong CUNG mot lan khoi dong, cach nhau vai tram ms. Dem moi moc la mot phien
// thi mot lan mo app thanh ba phien — bug that, nguoi dung bat duoc. Do tren ba log that:
//   - khoang cach GIUA ba moc cua cung mot lan khoi dong: 369, 382, 470, 916, 1000, 1119, 1829, 2078ms
//   - khoang cach giua HAI lan khoi dong that: 75 440ms va 163 029ms
// Hai nhom cach nhau 36 lan, nen nguong 5s nam giua khoang trong do, khong sat mep nao.
const SESSION_MARKERS = [
  { kind: 'db', re: /MomoDatabase init OK/ },
  { kind: 'sync', re: /@@ appSync >> syncStartApp/ },
  { kind: 'perf', re: /\[PERF\] SyncAppFeature, start/ },
];
const SESSION_BURST_MS = 5000;

function sessionMarkerKind(message) {
  for (let i = 0; i < SESSION_MARKERS.length; i += 1) {
    if (SESSION_MARKERS[i].re.test(message)) return SESSION_MARKERS[i].kind;
  }
  return '';
}

function getLogRowElements() {
  return Array.from(document.querySelectorAll(ROW_SELECTOR));
}

// Log khong scroll theo window ma theo mot div long ben trong, phai tim dung no de nhay dong.
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

// Gom cac dong cung ban chat ve mot chu ky: bo timestamp, con tro, object id, uuid, appId, moi con so.
// errorCode duoc giu nguyen (lookbehind) vi day la tin hieu phan biet loi that su.
// Do trên log that: 958 dong WARNING gom con 252 nhom (truoc khi bo <ptr>/<appId>/so nho la 411).
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
    // URL tuong doi hoac bi cat giua chung: giu nguyen chuoi goc.
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

// params cua MoMoTracker khong phai JSON ma la map "k=v, k=v": parseKeyValueMap (02-insights) da xu ly
// dung dau phay nam trong gia tri (bundle_sof=1,2) va map long nhau (last_component={...}).
// Do tren log that: 940/940 dong co "| params: {" deu parse ra map, khong dong nao that bai.
// indexOf chan truoc vi dai da so dong khong he co params, khong can chay regex.
function parseEventParams(message) {
  if (message.indexOf('| params: {') < 0) return null;
  const hit = RE_EVENT_PARAMS.exec(message);
  return hit ? parseKeyValueMap(hit[1]) : null;
}

// Grafana ghi tham so duoi dang TraceParameter(k=v, k=v) — cung mot dinh dang k=v voi params cua
// tracker, chi khac cap bao ngoai. Boc lai thanh {k=v} de dung chung parseKeyValueMap, huong luon
// ca phan noi lai manh bi dau phay xe doi. Do tren hai log that (mot UAT, mot prod): 3904/3904 dong
// TraceParameter parse ra map co truong flow.
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
    // Dat true cho dong DAU TIEN cua moi chum moc khoi dong. Tab Dien bien doc co nay chu khong
    // do lai regex, neu khong mot lan mo app se ve ra ba moc "App khoi dong" chong nhau.
    isSessionStart: false,
    // Nam trong khoi bi lap lai nguyen xi (xem src/02h-duplicate.js).
    isDuplicate: false,
    // 'FOREGROUND' | 'BACKGROUND' | '' — doc tu dong MQTT, xem RE_APP_STATE.
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

  // indexOf chan truoc: chi dong Grafana moi mang trace, chay regex tren moi dong la vo ich.
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
  // Chi ERROR/WARNING moi vao buildIssueGroups. Tinh chu ky cho ca 4085 dong la lang phi nang nhat
  // luc khoi dong: 7 luot replace tren nhung dong payload HTTP dai toi 10KB ma khong ai dung den.
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
        // Loi cua chinh lop do luong, khong phai loi user gap. Danh dau ngay luc gom de tab Van de
        // tach rieng ra — do tren 50 feedback production: 1267/2488 dong ERROR (51%) la loai nay.
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

// Ghep response voi request gan nhat cung URL. Request khong co response => nghi treo/timeout.
function buildHttpCalls(entries) {
  const calls = [];
  const pendingByUrl = new Map();
  entries.forEach((entry) => {
    if (!entry.http) return;
    const http = entry.http;
    if (http.direction !== 'res') {
      const call = {
        reqIndex: entry.domIndex,
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
      calls.push(call);
      pendingByUrl.set(http.url, call);
      return;
    }
    const pending = pendingByUrl.get(http.url);
    if (pending && pending.resIndex === null) {
      pending.resIndex = entry.domIndex;
      pending.status = http.status;
      pending.errorCode = http.errorCode;
      pending.duration = entry.ts && pending.ts ? entry.ts - pending.ts : null;
      pendingByUrl.delete(http.url);
      return;
    }
    calls.push({
      reqIndex: null,
      resIndex: entry.domIndex,
      ts: entry.ts,
      time: entry.time,
      method: http.method,
      url: http.url,
      host: http.host,
      path: http.path,
      status: http.status,
      errorCode: http.errorCode,
      duration: null,
    });
  });
  return calls;
}

// Gap phai tinh tren truc thoi gian da sort: logger flush theo lo nen thu tu dong khong phai thu tu thoi gian.
// Cua so xe dich cho phep giua moc doi trang thai va hai dau khoang lang.
const GAP_STATE_TOLERANCE_MS = 2000;

// Danh dau khoang lang nao la do APP XUONG NEN chu khong phai app treo. Truoc day tool bao hai truong
// hop nhu nhau — do la false positive lon nhat cua tinh nang khoang lang: "user bam Home" bi doc thanh
// "app dung im". Do tren log that (33112319): 22 khoang lang, dung 2 cai dai nhat (142.7s va 231.8s)
// la app o nen, 20 cai con lai khong co moc doi trang thai nao.
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
    // Phai co CA HAI dau: xuong nen trong long khoang lang, va tro lai o cuoi khoang. Chi thay mot
    // dau thi khong ket luan — co the la app xuong nen roi bi giet han.
    // Noi long CA hai dau bang GAP_STATE_TOLERANCE_MS. Do that: moc xuong nen nam SOM HON gap.before
    // vai chuc ms, vi ba module MQTT cung ghi mot luc va dong cuoi truoc khoang lang la dong thu ba,
    // con moc doi trang thai la dong thu nhat. Chan cung "moc >= gap.before.ts" thi truot het.
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
  // Bo dong thuoc khoi lap: log bi noi doi thi moi moc thoi gian xuat hien hai lan, hai dong lien tiep
  // sau khi sort cach nhau 0ms nen KHONG con khoang lang nao duoc nhan ra. Do that tren log
  // production bi noi doi: 0 khoang lang truoc khi bo, dung so that sau khi bo. Khoi lap khong the
  // tao ra hay xoa di mot khoang im lang co that — no chi che mat, nen bo la dung ca khi nguoi dung
  // chua bat "bo khoi lap".
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

  // Mot lan khoi dong = mot CHUM moc, khong phai mot moc. Sang phien moi khi: cach moc truoc qua
  // SESSION_BURST_MS, HOAC gap lai dung loai moc da thay trong chum nay — mot process khong the ghi
  // "MomoDatabase init OK" hai lan, nen moc trung loai chac chan la lan khoi dong khac. Ve dieu kien
  // thu hai: dung tren bon chum quan sat duoc (moi chum dung mot moc moi loai), CHUA XAC MINH duoc
  // rang khong log nao lap lai mot loai moc giua chung mot lan chay.
  let sessionCount = 0;
  let lastMarkerTs = 0;
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
    entry.session = Math.max(1, sessionCount);
  });

  let outOfOrder = 0;
  let previousTs = 0;
  entries.forEach((entry) => {
    if (!entry.ts) return;
    if (previousTs && entry.ts < previousTs) outOfOrder += 1;
    previousTs = entry.ts;
  });

  // Danh dau khoi lap TRUOC khi tinh thong ke: bo loc "bo khoi lap" doc co nay.
  const duplicate = markDuplicateEntries(entries);

  const timeline = buildGaps(entries, gapThresholdMs);

  // Phan phu thuoc tap dong (levels/groups/http/modules/...) nam trong deriveStats, dung chung voi
  // luc tinh lai theo bo loc. Phan con lai la thuoc tinh cua ca file, khong bao gio scope.
  return Object.assign({
    rowEls,
    entries,
    container: getLogScrollContainer(rowEls[0]),
    sessionCount: Math.max(1, sessionCount),
    duplicate,
    outOfOrder,
    batchCount: entries.filter((entry) => entry.kind === 'batch').length,
    gaps: timeline.gaps,
    firstTs: timeline.timed.length ? timeline.timed[0].ts : 0,
    lastTs: timeline.timed.length ? timeline.timed[timeline.timed.length - 1].ts : 0,
  }, deriveStats(entries));
}
// AI-GENERATED END
