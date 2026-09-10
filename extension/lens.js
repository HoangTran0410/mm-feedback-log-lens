(function(){"use strict";
/*
File: src/01-analyzer.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
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
const RE_SESSION = /MomoDatabase init OK/;

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
function buildGaps(entries, gapThresholdMs) {
  const timed = entries.filter((entry) => entry.ts).slice().sort((a, b) => a.ts - b.ts);
  const gaps = [];
  for (let i = 1; i < timed.length; i += 1) {
    const delta = timed[i].ts - timed[i - 1].ts;
    if (delta >= gapThresholdMs) gaps.push({ ms: delta, before: timed[i - 1], after: timed[i] });
  }
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

  let sessionCount = 0;
  entries.forEach((entry) => {
    if (RE_SESSION.test(entry.message)) sessionCount += 1;
    entry.session = Math.max(1, sessionCount);
  });

  let outOfOrder = 0;
  let previousTs = 0;
  entries.forEach((entry) => {
    if (!entry.ts) return;
    if (previousTs && entry.ts < previousTs) outOfOrder += 1;
    previousTs = entry.ts;
  });

  const timeline = buildGaps(entries, gapThresholdMs);

  // Phan phu thuoc tap dong (levels/groups/http/modules/...) nam trong deriveStats, dung chung voi
  // luc tinh lai theo bo loc. Phan con lai la thuoc tinh cua ca file, khong bao gio scope.
  return Object.assign({
    rowEls,
    entries,
    container: getLogScrollContainer(rowEls[0]),
    sessionCount: Math.max(1, sessionCount),
    outOfOrder,
    batchCount: entries.filter((entry) => entry.kind === 'batch').length,
    gaps: timeline.gaps,
    firstTs: timeline.timed.length ? timeline.timed[0].ts : 0,
    lastTs: timeline.timed.length ? timeline.timed[timeline.timed.length - 1].ts : 0,
  }, deriveStats(entries));
}
// AI-GENERATED END
/*
File: src/02-insights.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// AI-GENERATED START — lop phan tich thu hai: thoi luong, ID lien ket, phien app, metadata cua feedback
// Chay sau analyzeLog tren cung mang entries. Tach rieng de 01-analyzer.js khong phinh qua 500 dong.

// Vai cho trong log ghi nham epoch vao truong duration= (vi du duration=1788836518693),
// nen bo moi gia tri vuot nguong nay thay vi tin mu.
const MAX_PLAUSIBLE_DURATION_MS = 600000;
const MAX_DURATION_ROWS = 80;

const DURATION_PATTERNS = [
  { kind: 'duration', re: /\bduration=(\d+)\b/ },
  { kind: 'KMM', re: /\bduration KMM:\s*(\d+)\s?ms/ },
  { kind: 'elapsed', re: /\bin (\d+)\s?ms\b/ },
  { kind: 'write', re: /\bwrite=(\d+)\s?ms/ },
  { kind: 'waited', re: /\btotalWaited[A-Za-z]*\s*[:=]\s*(\d+)/ },
  { kind: 'took', re: /\btook (\d+)\s?ms\b/ },
];
// Co y KHONG bat pattern chung chung kieu /(\d+)\s?ms/: no an ca gia tri cau hinh
// (vi du mot module khai bao cua so cho 5000ms) va day len dau bang nhu the la thao tac cham.

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
    // Sang loc bang indexOf truoc: dai da so dong khong he co so do thoi gian, khong can chay 6 regex.
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
  return rows.sort((a, b) => b.ms - a.ms).slice(0, MAX_DURATION_ROWS);
}

// Mot cmdId xuat hien o nhieu dong = mot request di qua nhieu lop. Gom lai la dung duoc ca luong.
function buildCorrelations(entries) {
  const byValue = new Map();
  entries.forEach((entry) => {
    entry.correlationIds = [];
    if (!entry.raw) return;
    // Cung ly do: quet 5 regex toan cuc tren 1.2MB text la vo ich khi dong do khong chua ten ID nao.
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

function buildSessions(entries) {
  const sessions = [];
  entries.forEach((entry) => {
    if (!entry.level) return;
    let session = sessions[entry.session - 1];
    if (!session) {
      session = { index: entry.session, firstIndex: entry.domIndex, startTs: entry.ts, endTs: entry.ts, lineCount: 0,
        errorCount: 0 };
      sessions[entry.session - 1] = session;
    }
    session.lineCount += 1;
    if (entry.level === 'ERROR') session.errorCount += 1;
    if (entry.ts) {
      if (!session.startTs || entry.ts < session.startTs) session.startTs = entry.ts;
      if (!session.endTs || entry.ts > session.endTs) session.endTs = entry.ts;
    }
  });
  return sessions.filter(Boolean);
}

// Metadata cua feedback nam ngay tren trang duoi dang <span class="ant-tag">Nhan: gia tri</span>.
// Current Context dung truoc Error Context trong DOM nen lay lan xuat hien dau tien la dung cai dang co hieu luc.
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

// Tra ve ca vi tri bat dau/ket thuc: nguoi goi con phai doc tiep phan dang sau khoi JSON nay.
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

// Logger cua app cat bot message qua dai ("... exceeds 10000 characters."), nen khoi JSON khong
// bao gio dong lai va JSON.parse chiu thua. Nhung phan da co van la du lieu doc duoc: cat den diem
// an toan gan nhat roi tu dong not cac ngoac con mo.
//
// "Diem an toan" = vi tri ma cat o do van con la JSON hop le: ngay sau mot GIA TRI hoan chinh,
// ngay sau dau mo ngoac, hoac ngay TRUOC mot dau phay. Co y KHONG nhan diem an toan sau mot so
// chua co dau phan cach dang sau: 1788464400000 bi cat thanh 1788 van parse duoc nhung la so SAI —
// tha bo han con hon dua ra mot con so bia.
// Nhan luon cum **** la mot 'gia tri': cho bi che van la du lieu that, de repairMaskedJson don sau.
const JSON_LITERAL_RE = /^(-?\d+(\.\d+)?([eE][-+]?\d+)?|true|false|null|\*{2,})$/;

function findSafeJsonCut(text, start) {
  const frames = [];
  let safeCut = -1;
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
        // Trong object, chuoi dau tien cua moi cap la TEN truong — cat ngay sau no la hong.
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
      // Ky tu khong the mo dau mot gia tri JSON = da het phan du lieu, phan sau la chu cua logger
      // ("... Log message truncated; exceeds 10000 characters."). Dung han, dung nuot no lam gia tri.
      if (!/[-0-9tfn*]/.test(char)) break;
      literalStart = i;
    }
  }
  // Het text khi dang o giua mot chuoi (vi du "payload":"[{\\"id\\":...): dong chuoi lai de giu phan
  // da doc duoc, thay vi vut ca truong. Them dau … de nhin la biet gia tri nay bi cat giua chung.
  if (isInString && frames.length && stringStart > safeCut) {
    const frame = frames[frames.length - 1];
    if (frame.type !== '{' || frame.hasKey) {
      // Khi cho cat nam giua chuoi, dong chu cua logger bi ket luon BEN TRONG gia tri — cat no ra.
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

// Log che gia tri nhay cam truoc khi gui len server, va che theo hai kieu:
//   {"userId":"0","****","****","sessionKey":""}   — chuoi "****" tro troi
//   {"userId":12345678,****,"balance":"..."}      — **** tran, khong co nhay
// Ca hai deu lam JSON.parse hong. Quet co phan biet trong/ngoai chuoi de khong dung nham
// nhung gia tri ma chinh no chua dau sao, vi du "accountNo":"**** **** **32".
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
        // Chuoi toan dau sao va khong theo sau boi ':' thi khong phai ten truong — no la cho bi che.
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

// Sua tu cuoi ve dau de chi so cua cac cho con lai khong bi lech.
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
      // Gia tri bi che: giu lai de nguoi doc van thay truong do ton tai, chi boc them cap nhay.
      out = out.slice(0, start) + '"****"' + out.slice(end);
    } else if (out[after] === '{' || out[after] === '[' || out[after] === '"') {
      // Cho che an ca TEN truong, con gia tri thi khong: ,****{"displayName":...}
      // Danh so de hai cho bi che trong cung mot object khong de len nhau lam mat du lieu.
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
    // Roi vao day gan nhu luon la vi cho bi che; thu don rieng nhung cho do roi parse lai.
  }
  const repaired = repairMaskedJson(block);
  if (repaired !== block) {
    try {
      return { pretty: JSON.stringify(JSON.parse(repaired), null, 2), isParsed: true, isRepaired: true };
    } catch (error) {
      // Hong vi ly do khac (thuong la log cat bot payload dai): tra nguyen van.
    }
  }
  return { pretty: block, isParsed: false, isRepaired: false };
}

// Dong HTTP goi payload theo dang "--ten: gia tri" noi duoi nhau tren cung mot dong:
//   [RequestPayload: --encrypted: false --body: {...} --encryptedBody:  --header: {...}]--exception: none
// Doc tung truong mot, va khi gia tri la JSON thi nhay thang qua het khoi do — nho vay
// mot chuoi "--x:" nam ben trong JSON khong bi tuong nham la truong moi.
const PAYLOAD_FIELD_RE = /--([A-Za-z][A-Za-z0-9_]*)\s*:/g;
const BODY_LABEL_RE = /(?:responseBody|requestBody|body|payload)\s*:/i;

function countChar(text, char) {
  let total = 0;
  for (let i = 0; i < text.length; i += 1) if (text[i] === char) total += 1;
  return total;
}

// Truong cuoi thuong dinh theo dau ] dong khoi [RequestPayload: ...]. Chi cat khi that su thua.
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

// Nhieu dong khong log JSON ma log thang Map.toString() cua Kotlin/Java:
//   {stage=sync_step, location={lat=0.0, long=0.0}, locationString={"lat":0.0}}
// JSON.parse chiu thua nhung day van la du lieu co cau truc, doc duoi dang cay de hon nhieu.
const KV_MAP_HEAD_RE = /^\{\s*[A-Za-z_][\w.-]*\s*=/;

// Cat theo dau phay o do sau 0 de gia tri long nhau khong bi xe doi.
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
    // Dinh dang nay khong bao quanh gia tri, nen gia tri co dau phay ben trong (bundle_sof=1,2)
    // bi splitTopLevel xe doi va manh sau khong con dau '=' nao. Truoc day manh do bi bo di —
    // mat du lieu ma khong bao gi. Do tren mot log that: 20 manh roi rung im lang, o moneysource,
    // bundle_sof, list_sof, ref_id va ca title (title chinh la nhan popup trong "User da nhin thay gi").
    // Chi noi lai manh KHONG co dau '=' nao; manh co '=' van xu ly y nhu truoc.
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
        // Khong phai JSON that: giu nguyen van.
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
  // bytes do tren nguyen van trong log, khong do tren ban pretty-print: nguoi doc muon biet
  // request nang bao nhieu, khong phai ban da them thut le nang bao nhieu.
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

// Tra ve danh sach truong de tam truot ve tung khoi mot, thay vi chi mot khoi JSON duy nhat.
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

  // Dong khong theo dang "--ten:" (vi du "@@SomeService :: responseBody: {...}") van co the
  // chua mot khoi JSON tro troi. Uu tien cat sau nhan body/payload de khong vo phai [Module: HTTP].
  const label = BODY_LABEL_RE.exec(raw);
  const tail = label ? raw.slice(label.index + label[0].length) : raw.slice(raw.indexOf('{'));
  if (raw.indexOf('{') < 0 && !label) return sections;
  const section = buildJsonSection(label ? label[0].replace(/\s*:\s*$/, '') : 'JSON', tail);
  if (section) sections.push(section);
  return sections;
}

/* ---------------------------------------------- hanh trinh tuong tac cua user */

// Moi dong MoMoTracker deu ghi o muc INFO nen khong dong nao lot vao buildIssueGroups: nhung gi user
// THAY va CHAM hoan toan vo hinh voi phan gom nhom loi. Do tren log that (33112319): 955 dong tracker,
// 46 loai event, trong do popup "MAX-API SPAM DETECTED" dap vao mat user 5 lan ma khong kem mot ERROR nao.
// Log ghi lap: nhieu event tracker xuat hien 2 dong giong het nhau. Do tren log that (78 cap trung
// noi dung), khoang cach chia lam hai cum tach bach — mot cum 0..~1.1s (ghi lap) va mot cum tu 70s tro
// len (user lam lai that su o phien sau). Chon 1000ms nam giua hai cum: tha dem du con hon gop nham
// hai lan bam that thanh mot, vi "user bam lai vi app khong phan hoi" chinh la thu can nhin thay.
const JOURNEY_MERGE_WINDOW_MS = 1000;
const JOURNEY_KINDS = ['screen', 'tap', 'saw', 'move', 'fail'];
const JOURNEY_KIND_LABEL = {
  screen: 'Màn hình', tap: 'Chạm', saw: 'User thấy', move: 'Đổi luồng', fail: 'API fail',
};

// Tracker ghi thang chuoi "null"/"" cho truong rong; de nguyen thi nhan hien ra la chu "null".
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

// detail = boi canh ON DINH cua buoc (man hinh, service) — dung de gom nhom va so sanh khi gop.
// note   = so do RIENG cua lan do (duration, dwell_time) — chi hien tren dong hanh trinh.
// Tach hai thu nay ra vi neu tron chung thi hai lan cung mot loi chi khac 1ms duration se bi coi la
// hai thu khac nhau, va nhan nhom se mat sach phan errorCode.
// Bang duy nhat quyet dinh event nao vao hanh trinh. Tra null = bo qua (impression, ops_request_be,
// trail_*, sync_* ... khong phai thao tac cua user). Co y KHONG lay roothome_component_impressed (76),
// service_component_displayed (41), roothome_block_viewed (33): do la cai man hinh ve ra, khong phai
// cai user lam, va so luong cua chung se nhan chim phan con lai.
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
    return { kind: 'screen', label: screen || journeyValue(params.service_name),
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
    // component_id = "<appId>/<feature>/<screen>/Button/<nhan tieng Viet dung nhu user nhin thay>".
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
    return { kind: 'saw', label: journeyValue(params.title) || 'popup',
      detail: journeyParts([params.screen_name, params.desc]) };
  }
  if (event === 'service_popup_displayed') {
    return { kind: 'saw', label: journeyValue(params.popup_name) || 'popup',
      detail: journeyParts([params.screen_name, params.service_name]) };
  }
  if (event === 'auto_bottomsheet_displayed') {
    return { kind: 'saw',
      label: 'sheet ' + (journeyValue(params.component_name) || journeyValue(params.title) || '?'),
      detail: journeyParts([params.screen_name, params.feature_code]) };
  }
  if (event === 'service_screenshot') {
    return { kind: 'saw', label: 'user chụp màn hình',
      detail: journeyParts([params.screen_name, params.service_name]) };
  }
  // ops_receive_be la ket qua call BE do chinh tracker ghi, co san status/error_code/duration.
  // Chi lay ban fail: 45/307 tren log that, va tab HTTP khong thay het so nay vi no doc dong [Method:].
  if (event === 'ops_receive_be') {
    if (journeyValue(params.status) !== 'fail') return null;
    const code = journeyValue(params.error_code);
    const api = journeyValue(params.api) || journeyValue(params.api_path) || 'API';
    // errorCode vao NHAN chu khong vao detail: cung mot api fail voi hai ma khac nhau la hai chuyen
    // khac nhau, gom chung mot dong se giau mat ma loi.
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
      row = { key: step.label, count: 0, ms: 0, indices: [], detail: step.detail,
        firstTs: step.ts, lastTs: step.ts };
      map.set(step.label, row);
    }
    // Dem SO THAO TAC (so buoc da gop), khong phai so dong log — de con so o day khop voi the thong ke
    // dau tab. So dong tho van con nguyen trong row.indices de duyet tung dong.
    row.count += 1;
    row.ms += step.ms;
    step.indices.forEach((domIndex) => row.indices.push(domIndex));
    // Nhieu buoc cung nhan nhung khac boi canh (nut "transfer" o bill_detail va o detail_input):
    // giu detail cua buoc dau cho ca nhom la noi sai. Chi giu khi moi buoc deu giong nhau.
    if (row.detail !== step.detail) row.detail = '';
    if (step.ts && (!row.firstTs || step.ts < row.firstTs)) row.firstTs = step.ts;
    if (step.lastTs && (!row.lastTs || step.lastTs > row.lastTs)) row.lastTs = step.lastTs;
  });
  return Array.from(map.values());
}

// Gop cac buoc LIEN TIEP y het nhau va sat nhau ve thoi gian thanh mot buoc mang count.
// Khong xoa dong nao: indices giu du ca N dong de van nhay duoc toi tung dong trong bang log.
function mergeAdjacentJourneySteps(steps) {
  const merged = [];
  steps.forEach((step) => {
    const last = merged[merged.length - 1];
    // Buoc 'fail' KHONG gop: moi call BE da co trace_id rieng va da khu trung chinh xac theo do.
    // Hai call that su khac nhau cach nhau vai tram ms la chuyen binh thuong — gop thi so o day
    // se lech voi so call fail dem duoc tu trace_id.
    if (step.kind !== 'fail' &&
      last && last.kind === step.kind && last.label === step.label && last.detail === step.detail &&
      step.ts && last.lastTs && step.ts - last.lastTs <= JOURNEY_MERGE_WINDOW_MS) {
      last.count += 1;
      last.lastTs = step.ts;
      last.indices.push(step.domIndex);
      return;
    }
    merged.push({ kind: step.kind, label: step.label, detail: step.detail, note: step.note,
      event: step.event, ts: step.ts, lastTs: step.ts, domIndex: step.domIndex,
      indices: [step.domIndex], count: 1, ms: 0 });
  });
  return merged;
}

function buildJourney(entries) {
  const raw = [];
  const counts = { screen: 0, tap: 0, saw: 0, move: 0, fail: 0 };
  const seenTraceIds = new Set();
  let apiTotal = 0;
  let apiFail = 0;

  entries.forEach((entry) => {
    if (!entry.event || !entry.eventParams) return;
    if (entry.event === 'ops_receive_be') {
      // Mot call BE duoc ghi thanh 2 dong ops_receive_be giong het nhau. Do tren log that: 307 dong
      // nhung chi 166 trace_id (139 trace xuat hien dung 2 lan, 26 mot lan, 1 ba lan) — trong khi
      // ops_request_be la 166 dong / 166 trace_id, tuc 166 moi la so call that.
      // trace_id la ID cua chinh call do nen khu trung theo no la chac chan, khong phai phong doan.
      const traceId = journeyValue(entry.eventParams.trace_id);
      if (traceId && seenTraceIds.has(traceId)) return;
      if (traceId) seenTraceIds.add(traceId);
      apiTotal += 1;
      if (journeyValue(entry.eventParams.status) === 'fail') apiFail += 1;
    }
    const step = pickJourneyStep(entry.event, entry.eventParams);
    if (!step || !step.label) return;
    raw.push({ kind: step.kind, label: step.label, detail: step.detail || '', note: step.note || '',
      event: entry.event, ts: entry.ts, domIndex: entry.domIndex });
  });

  // Cung ly do nhu tab Timeline: log co dong timestamp lui ve truoc, thu tu dong khong phai thu tu thoi gian.
  raw.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const steps = mergeAdjacentJourneySteps(raw);
  steps.forEach((step) => {
    counts[step.kind] += 1;
  });

  // ms cua mot buoc "screen" = khoang cach toi buoc screen/move ke tiep. Day la SO TINH RA, khong phai
  // truong nao trong log — cac event no lien tuc trong cung mot lan chuyen man se ra ~0ms, chi buoc cuoi
  // cua chum moi mang con so that. Truong dwell_time co san cua roothome nam rieng trong detail.
  let boundaryTs = steps.length ? steps[steps.length - 1].ts : null;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i].kind === 'screen' && steps[i].ts && boundaryTs) {
      steps[i].ms = Math.max(0, boundaryTs - steps[i].ts);
    }
    if (steps[i].kind === 'screen' || steps[i].kind === 'move') boundaryTs = steps[i].ts || boundaryTs;
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
  };
}

/* -------------------------------------------------- loi doc tu Grafana trace */

// Grafana ghi o muc INFO nen khong dong nao lot vao buildIssueGroups, trong khi traceFail mang san
// flow + step + errorCode + errorMessage — tuc mo ta loi RO HON bat ky dong ERROR nao trong log.
//
// Gom theo errorMessage chu khong theo step: trong GrafanaTracker.generateParams, voi miniapp thi
// `flow` bi ghi de bang appId va `step` bi doi thanh "flow.step", nen MOT su co ha tang hien ra
// thanh hang chuc dong khac nhau. Do tren mot log that: cung mot loi "500 - B07 No version found
// from remote" xuat hien o 17 miniapp khac nhau. Gom theo errorMessage thi 17 dong do ve mot hang,
// kem so app bi anh huong — nhin la biet ngay ha tang chet chu khong phai bug cua tinh nang.
const TRACE_VERBS = ['startTrace', 'traceSuccess', 'traceFail', 'countTrace', 'durationStopTrace',
  'durationTrace', 'errorTrace'];

// Hau to _start/_success/_fail do generateParams tu gan, va tien to "<flow>." cung do no gan khi
// appId khong phai platform. Bo ca hai de con lai ten buoc that.
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
    // Co errorMessage thi gom theo no — do moi la thu chung giua cac app cung dinh mot su co.
    // Khong co thi KHONG duoc gom theo moi errorCode: tren mot log that, "code 200" om chung
    // TransactionResultV3_call_api_V1_REWARDS_PREDICT va TabBarContainer_call_api_RIGVER_APPVERSION
    // — hai chuyen khac han nhau. Luc do lay ten buoc lam khoa.
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

  return { available: lineCount > 0, lineCount, counts, fails };
}

// Moi thu phu thuoc "dang nhin nhung dong nao". Goi mot lan cho ca file luc quet,
// va goi lai tren tap da loc moi khi bo loc doi — do duoc 2.5ms cho 4085 dong, 0.4ms cho tap ~850 dong.
function deriveStats(entries) {
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
    tags: countBy(entries, (entry) => entry.tag),
    flows: countBy(entries, (entry) => entry.flow),
    events: countBy(entries, (entry) => entry.event),
    journey: buildJourney(entries),
    traceIssues: buildTraceIssues(entries),
  };
}

function attachInsights(data) {
  // Correlation KHONG scope theo bo loc: mot cmdId la mot chuoi request, xem chuoi thi phai xem tron ven
  // ke ca nhung dong dang bi bo loc giau di.
  data.correlations = buildCorrelations(data.entries);
  data.correlationValueSet = new Set(data.correlations.map((bucket) => bucket.value));
  data.sessions = buildSessions(data.entries);
  data.feedback = readFeedbackContext();
  return data;
}
// AI-GENERATED END
/*
File: src/02-theme.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// AI-GENERATED START — CSS cua panel Log Lens
//
// Ve do uu tien (specificity): trang admin dung antd nen phai reset, nhung reset KHONG duoc manh hon
// cac rule .fll-* cua minh. Vi vay reset dung ":where(#fll-root) <tag>" = (0,0,1): du de thang rule
// element cua trang, nhung van thua moi rule class (0,1,0) ben duoi. Neu viet "#fll-root *" (1,0,1)
// thi padding:0 se de chet toan bo padding cua cac the -> giao dien dinh sat mep.

const PANEL_CSS = [
  ':where(#fll-root) *,:where(#fll-root) *::before,:where(#fll-root) *::after{box-sizing:border-box}',
  ':where(#fll-root) div,:where(#fll-root) span,:where(#fll-root) header,:where(#fll-root) footer,',
  ':where(#fll-root) nav,:where(#fll-root) button,:where(#fll-root) input,:where(#fll-root) i,',
  ':where(#fll-root) u,:where(#fll-root) b,:where(#fll-root) em{margin:0;padding:0;border:0;',
  'background:none;color:inherit;font:inherit;line-height:1.45;letter-spacing:normal;text-transform:none;',
  'text-align:left;vertical-align:baseline;box-shadow:none;text-shadow:none;min-width:0;height:auto}',
  '#fll-root button,#fll-root input{outline:0;-webkit-appearance:none;appearance:none}',

  '#fll-root{position:fixed;z-index:2147483000;top:0;left:0;width:0;height:0;',
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;font-weight:400;',
  '--bg:#16141d;--bg2:#1e1b27;--bg3:#2a2436;--line:rgba(255,255,255,.09);--txt:#ece9f5;--mut:#9b93ad;',
  '--acc:#ff2e88;--err:#ff5f6d;--warn:#ffb648;--info:#58c4ff;--dbg:#7d8590;--ok:#3ddc97;',
  '--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;',
  /* Padding cua .fll-body: .fll-sec phai biet dung hai so nay de dinh sat mep va tran het be ngang.
     Moi cho dung deu kem gia tri du phong: bien khai o #fll-root, neu panel bi dung ngoai root do
     thi var() khong giai duoc va CA declaration hong — padding se sap ve 0 chu khong quay ve mac dinh. */
  '--pad-y:14px;--pad-x:16px}',

  /* ---------- khung panel ---------- */
  /* Kich thuoc bi chan bang JS (clampValue) chu khong bang max-width, de keo goc khong bi ket o 880px. */
  '.fll-panel{position:fixed;top:14px;right:14px;bottom:14px;width:480px;min-width:360px;max-width:none;',
  'display:flex;flex-direction:column;background:var(--bg);color:var(--txt);border:1px solid var(--line);',
  'border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.35);overflow:hidden;',
  'animation:fll-in .18s cubic-bezier(.2,.9,.3,1)}',
  '@keyframes fll-in{from{opacity:0;transform:translateX(16px) scale(.99)}to{opacity:1;transform:none}}',

  /* ---------- hai tay nam thay doi kich thuoc ---------- */
  /* Trong luc keo: bo bong mo ban kinh 70px (thu tot nhat de ve lai moi khung hinh),
     bao truoc cho trinh duyet chuan bi lop rieng, va tat hover ben trong cho khoi tinh vo ich. */
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
  '.fll-tt{font-size:13.5px;font-weight:650;letter-spacing:.2px}',
  '.fll-sub{font-size:11px;color:var(--mut);margin-top:2px}',
  '.fll-hd-sp{flex:1}',
  '.fll-ico{width:28px;height:28px;border:1px solid transparent;border-radius:8px;color:var(--mut);',
  'cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:.14s;',
  'flex:0 0 auto}',
  '.fll-ico:hover{background:var(--bg3);color:var(--txt);border-color:var(--line)}',

  /* ---------- tabs ---------- */
  '.fll-tabs{display:flex;gap:3px;padding:10px 12px 0;flex:0 0 auto;overflow-x:auto;scrollbar-width:none}',
  '.fll-tabs::-webkit-scrollbar{display:none}',
  '.fll-tab{flex:1 0 auto;padding:8px 7px 10px;border-bottom:2px solid transparent;color:var(--mut);font-size:11px;',
  'font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;',
  'transition:.14s;white-space:nowrap}',
  '.fll-tab:hover{color:var(--txt)}',
  '.fll-tab.on{color:var(--txt);border-bottom-color:var(--acc)}',
  '.fll-bdg{font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:20px;background:var(--bg3);',
  'color:var(--mut);line-height:1.6}',
  '.fll-tab.on .fll-bdg{background:var(--acc);color:#fff}',
  '.fll-bdg.err{background:rgba(255,95,109,.18);color:var(--err)}',
  '.fll-tab.on .fll-bdg.err{background:var(--err);color:#fff}',

  /* ---------- thanh bo loc thuong tru ---------- */
  '.fll-bar{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:10px 16px 0;padding:8px 11px;',
  'border:1px solid rgba(255,46,136,.3);background:rgba(255,46,136,.05);border-radius:10px;flex:0 0 auto}',
  '.fll-bar[hidden]{display:none}',
  '.fll-bar-t{font-size:10px;font-weight:700;color:var(--acc);letter-spacing:.5px;text-transform:uppercase}',
  '.fll-bar-n{font-size:10.5px;color:var(--mut);margin-left:auto;font-variant-numeric:tabular-nums}',
  '.fll-fchips{display:flex;flex-wrap:wrap;gap:5px;width:100%}',
  '.fll-fchip{display:inline-flex;align-items:center;gap:6px;padding:3px 5px 3px 10px;border-radius:20px;',
  'font-size:10.5px;background:var(--bg);border:1px solid var(--line);color:var(--txt);max-width:100%}',
  '.fll-fchip b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}',
  '.fll-fchip button{width:16px;height:16px;border-radius:50%;background:var(--bg3);color:var(--mut);',
  'font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto;',
  'transition:.14s}',
  '.fll-fchip button:hover{background:var(--err);color:#fff}',
  /* Chip mau bo loc: nua trai bam de ap, nua phai bam de xoa. */
  '.fll-tpl{cursor:default}',
  '.fll-tpl b{cursor:pointer;font-weight:600;max-width:190px;overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap}',
  '.fll-tpl:hover{border-color:var(--acc)}',
  '.fll-tpl b:hover{color:var(--acc)}',
  '.fll-in:disabled{opacity:.5;cursor:not-allowed}',
  '.fll-btn:disabled{opacity:.5;cursor:not-allowed}',
  '.fll-btn:disabled:hover{border-color:var(--line);background:var(--bg2)}',
  '.fll-fclear{padding:3px 11px;border-radius:20px;font-size:10.5px;font-weight:650;background:var(--acc);',
  'color:#fff;cursor:pointer;transition:.14s}',
  '.fll-fclear:hover{filter:brightness(1.14)}',
  '.fll-bdg.act{background:rgba(255,46,136,.22);color:var(--acc)}',
  '.fll-tab.on .fll-bdg.act{background:var(--acc);color:#fff}',

  /* ---------- minimap mat do log theo thoi gian ---------- */
  '.fll-map{position:relative;height:36px;margin:12px 16px 0;padding:0 2px;border:1px solid var(--line);',
  'border-radius:8px;background:linear-gradient(180deg,#120f19,#191522);display:flex;align-items:flex-end;',
  'overflow:hidden;cursor:crosshair;flex:0 0 auto}',
  '.fll-map i{flex:1;min-width:1px;display:block;transition:.1s}',
  '.fll-map i:hover{filter:brightness(1.8)}',
  '.fll-shade{position:absolute;top:0;bottom:0;width:0;background:rgba(14,11,20,.74);pointer-events:none}',
  '.fll-shade-l{left:0}',
  '.fll-shade-r{right:0}',
  /* Khi co khoang dang chon thi ve vach mep de biet cho nao nam duoc de co gian. */
  '.fll-map-ranged .fll-shade-l{border-right:2px solid var(--acc);box-shadow:2px 0 8px rgba(255,46,136,.4)}',
  '.fll-map-ranged .fll-shade-r{border-left:2px solid var(--acc);box-shadow:-2px 0 8px rgba(255,46,136,.4)}',
  '.fll-maptext{font-variant-numeric:tabular-nums;opacity:.75}',
  '.fll-map-ranged + .fll-maplbl .fll-maptext{opacity:1;color:var(--acc);font-weight:650}',
  '.fll-cursor{position:absolute;top:0;bottom:0;width:2px;background:var(--acc);pointer-events:none;',
  'box-shadow:0 0 10px var(--acc);opacity:0;transition:.12s}',
  '.fll-maplbl{display:flex;justify-content:space-between;gap:8px;margin:5px 17px 0;font-size:9.5px;',
  'color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 auto}',

  /* ---------- body ---------- */
  '.fll-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:var(--pad-y,14px) var(--pad-x,16px) 18px}',
  '.fll-body::-webkit-scrollbar{width:10px}',
  '.fll-body::-webkit-scrollbar-thumb{background:#3a3348;border-radius:10px;border:3px solid var(--bg)}',
  '.fll-body::-webkit-scrollbar-thumb:hover{background:#4c4360}',

  /* ---------- stat cards ---------- */
  '.fll-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:14px}',
  '.fll-stat{background:var(--bg2);border:1px solid var(--line);border-radius:11px;padding:12px 13px;',
  'cursor:pointer;transition:.14s}',
  '.fll-stat:hover{border-color:var(--acc);transform:translateY(-1px)}',
  '.fll-stat b{display:block;font-size:21px;font-weight:700;font-variant-numeric:tabular-nums;',
  'letter-spacing:-.5px;line-height:1.15}',
  '.fll-stat b em{font-style:normal;font-size:12px;font-weight:600;color:var(--mut);letter-spacing:0}',
  '.fll-stat span{display:block;font-size:10.5px;color:var(--mut);margin-top:4px}',

  /* ---------- khoi lay net theo feedback ----------
     Co y KHONG to hong: thanh bo loc phia tren da la mau accent roi. De ba khoi hong chong nhau
     thi accent mat het y nghia, khong con gi noi bat hon gi. */
  '.fll-focus{border:1px solid var(--line);background:var(--bg2);border-radius:12px;padding:12px 13px;',
  'margin-bottom:14px}',
  '.fll-focus-t{font-size:12.5px;line-height:1.5}',
  '.fll-focus-t b{font-weight:700;color:var(--acc)}',
  '.fll-focus-d{font-size:10.5px;color:var(--mut);margin-top:4px;font-family:var(--mono);',
  'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-focus-hint{font-size:10.5px;color:var(--mut);margin:11px 0 7px}',

  /* ---------- bang thoi luong ---------- */
  '.fll-slow{position:relative;display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;',
  'background:var(--bg2);border:1px solid transparent;margin-bottom:4px;cursor:pointer;overflow:hidden;',
  'transition:.14s}',
  '.fll-slow:hover{border-color:var(--acc)}',
  '.fll-slow u{position:absolute;left:0;top:0;bottom:0;text-decoration:none}',
  '.fll-slow-ms{position:relative;font-size:11.5px;font-weight:750;font-variant-numeric:tabular-nums;',
  'flex:0 0 auto;width:52px;text-align:right}',
  '.fll-slow-txt{position:relative;flex:1;min-width:0;font-family:var(--mono);font-size:10.5px;color:#cfc8dd;',
  'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

  /* ---------- nut nho trong hang, va nut tat tieng ---------- */
  '.fll-ico.fll-mini{width:24px;height:24px;font-size:10px;border-radius:6px;background:var(--bg3);flex:0 0 auto}',
  '.fll-ico.fll-mute{width:22px;height:22px;font-size:11px;opacity:.4;flex:0 0 auto;margin-left:2px}',
  '.fll-grp:hover .fll-ico.fll-mute{opacity:.9}',
  '.fll-grp.muted{opacity:.42}',
  '.fll-grp.muted:hover{opacity:.8}',

  /* ---------- tam truot chi tiet ---------- */
  '.fll-sheet{position:absolute;left:0;right:0;bottom:0;top:52px;background:var(--bg);display:flex;',
  'flex-direction:column;z-index:8;animation:fll-up .16s cubic-bezier(.2,.9,.3,1)}',
  '@keyframes fll-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
  '.fll-sheet-hd{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--line);',
  'background:linear-gradient(180deg,#241f31,#1a1723);flex:0 0 auto}',
  '.fll-sheet-tt{font-size:12.5px;font-weight:650;word-break:break-all}',
  '.fll-sheet-sub{font-size:10.5px;color:var(--mut);margin-top:2px}',
  '.fll-sheet-body{flex:1;overflow:auto;padding:14px 16px 18px}',
  '.fll-sheet-body::-webkit-scrollbar{width:10px;height:10px}',
  '.fll-sheet-body::-webkit-scrollbar-thumb{background:#3a3348;border-radius:10px;border:3px solid var(--bg)}',
  '.fll-code{font-family:var(--mono);font-size:11px;line-height:1.55;color:#cfc8dd;background:var(--bg2);',
  'border:1px solid var(--line);border-radius:9px;padding:12px 14px;white-space:pre;overflow-x:auto;',
  'display:block;tab-size:2}',
  '.fll-code.fll-wrap{white-space:pre-wrap;overflow-wrap:anywhere}',

  /* ---------- tung truong trong payload ---------- */
  /* Mot dong HTTP co the co 5 truong (--encrypted / --body / --header / --exception ...),
     nen moi truong la mot khoi rieng co nhan trang thai parse va nut copy rieng. */
  /* To mau JSON: mau khoa/chuoi/so tach nhau du de luot mat tim field, khong ruc den muc nhuc mat. */
  '.fll-code i{font-style:normal}',
  '.fll-jk{color:#7fd0ff}',
  '.fll-js{color:#a9e6b8}',
  '.fll-jn{color:var(--warn)}',
  '.fll-jb{color:#c79bff}',
  /* Thanh doi Request / Response: dung lai dang tab cua panel de nhat quan, size nam trong badge. */
  '.fll-stabs{display:flex;align-items:flex-end;gap:4px;border-bottom:1px solid var(--line);margin-bottom:13px}',
  '.fll-stabs .fll-tab{flex:0 0 auto;padding:5px 12px 8px}',
  '.fll-stabs .fll-chip,.fll-paybar .fll-chip{margin-bottom:6px}',
  '.fll-paybar{margin-bottom:8px}',
  '.fll-pay{margin-bottom:14px}',
  '.fll-pay:last-child{margin-bottom:0}',
  '.fll-pay-hd{display:flex;align-items:center;gap:8px;margin-bottom:7px;min-height:24px;flex-wrap:wrap}',
  '.fll-pay-hd b{font-family:var(--mono);font-size:11px;font-weight:700;color:#e8e2f2}',
  '.fll-pay-v{font-family:var(--mono);font-size:11px;color:var(--mut);word-break:break-all}',
  '.fll-pay-tag{font-size:9.5px;font-weight:700;letter-spacing:.3px;padding:3px 7px;border-radius:6px;',
  'background:rgba(61,220,151,.11);color:var(--ok);border:1px solid rgba(61,220,151,.24)}',
  '.fll-pay-tag.warn{background:rgba(255,182,72,.11);color:var(--warn);border-color:rgba(255,182,72,.28)}',
  '.fll-btn.fll-mini{padding:5px 10px;font-size:10.5px;border-radius:7px}',

  /* ---------- tieu de section ---------- */
  /* Dinh lai o mep tren khi cuon. Tab Loc co 8 muc, tab Dien bien ve 80 moc mot lo — cuon mot lat la
     khong con biet dang doc muc nao; sticky giu cai nhan do luon nam trong tam mat.
     Ba dieu kien de sticky khong vo:
     - Nen phai DUC va TRAN HET CHIEU RONG, neu khong noi dung se troi qua ngay ben duoi chu. Keo bang
       margin ngang am 16px (dung bang padding cua .fll-body) roi padding bu lai.
     - top phai la AM dung bang padding-top cua .fll-body. Do that trong Chrome tren trang test dung chinh
       bo CSS nay: voi top:0 tieu de dinh cach mep tren 13.9px (dung bang padding-top 14px) va noi dung
       van troi qua ben tren no — tuc offset tinh tu CONTENT box chu khong phai padding box. Voi
       top:calc(var(--pad-y) * -1) thi ho con 0px, va KHONG bi overflow cat: no chi nho dung toi mep
       padding box, la dung cho overflow bat dau clip.
     - z-index:3 du de de len noi dung, van nam duoi .fll-sheet (z-index:8) nen tam truot khong bi dam xuyen.
     Mau chu tung la #7f7793: chi 4.31:1 tren nen panel, duoi nguong WCAG AA 4.5:1, lai o co 10px in hoa
     nen doc duoc ma khong "nhay ra" duoc. Nay #d5cfe2 tren dai nen dam nhat van dat 10.53:1.
     Dai nen dung dung gradient cua .fll-sheet-hd cho thong nhat voi phan con lai cua panel. */
  '.fll-sec{position:sticky;top:calc(var(--pad-y,14px) * -1);z-index:3;',
  'margin:22px calc(var(--pad-x,16px) * -1) 10px;padding:10px var(--pad-x,16px) 9px;',
  'background:linear-gradient(180deg,#241f31,#1a1723);border-bottom:1px solid var(--line);',
  'font-size:11px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;',
  'color:#d5cfe2;display:flex;align-items:center;gap:8px}',
  '.fll-sec:before{content:"";width:3px;height:13px;border-radius:2px;background:var(--acc);flex:0 0 auto}',
  '.fll-sec:first-child{margin-top:0}',
  '.fll-note{display:flex;gap:10px;padding:12px 13px;border-radius:11px;font-size:11.5px;line-height:1.55;',
  'background:rgba(255,182,72,.09);border:1px solid rgba(255,182,72,.28);color:#ffd79a;margin-bottom:6px}',
  '.fll-note b{color:#fff;font-weight:650}',

  /* ---------- thanh ty le muc do ---------- */
  '.fll-lvbar{display:flex;height:10px;border-radius:5px;overflow:hidden;margin-bottom:10px;background:var(--bg3)}',
  '.fll-lvbar i{display:block;transition:.2s}',
  '.fll-lvkey{display:flex;flex-wrap:wrap;gap:6px}',
  '.fll-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;font-size:10.5px;',
  'font-weight:600;background:var(--bg2);border:1px solid var(--line);color:var(--mut);cursor:pointer;',
  'transition:.14s}',
  '.fll-chip:hover{border-color:var(--acc);color:var(--txt)}',
  '.fll-chip.on{background:var(--acc);border-color:var(--acc);color:#fff}',
  /* Chip khong con dong nao khop trong ngu canh hien tai: van bam duoc nhung khong doi nhin. */
  '.fll-chip.dim{opacity:.42}',
  '.fll-chip.dim:hover{opacity:1}',
  '.fll-chip em{font-style:normal;opacity:.75;font-variant-numeric:tabular-nums}',
  '.fll-sw{width:8px;height:8px;border-radius:2px;flex:0 0 auto}',

  /* ---------- bang xep hang co thanh ngang ---------- */
  '.fll-rank{display:flex;flex-direction:column;gap:4px}',
  '.fll-rk{position:relative;display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:8px;',
  'background:var(--bg2);border:1px solid transparent;cursor:pointer;overflow:hidden;transition:.14s}',
  '.fll-rk:hover{border-color:var(--acc)}',
  '.fll-rk u{position:absolute;left:0;top:0;bottom:0;background:rgba(255,46,136,.16);text-decoration:none}',
  '.fll-rk span{position:relative;flex:1;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-rk b{position:relative;font-size:11px;color:var(--mut);font-variant-numeric:tabular-nums}',

  /* ---------- the nhom van de ---------- */
  '.fll-grp{border:1px solid var(--line);border-left:3px solid var(--warn);border-radius:11px;',
  'background:var(--bg2);padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:.14s}',
  '.fll-grp:hover{border-color:var(--acc);border-left-color:var(--acc);background:var(--bg3)}',
  '.fll-grp.err{border-left-color:var(--err)}',
  '.fll-grp-top{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
  '.fll-cnt{font-size:11px;font-weight:800;padding:2px 9px;border-radius:20px;background:rgba(255,182,72,.16);',
  'color:var(--warn);font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-grp.err .fll-cnt{background:rgba(255,95,109,.16);color:var(--err)}',
  '.fll-mod{font-size:10px;font-weight:650;color:var(--info);background:rgba(88,196,255,.12);padding:2px 8px;',
  'border-radius:6px;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-when{margin-left:auto;font-size:10px;color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-msg{font-family:var(--mono);font-size:11px;line-height:1.55;color:#cfc8dd;word-break:break-word;',
  'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
  '.fll-spark{display:flex;align-items:flex-end;gap:1px;height:15px;margin-top:9px}',
  '.fll-spark i{flex:1;min-width:1px;background:var(--bg3);border-radius:1px}',

  /* ---------- HTTP ---------- */
  '.fll-call{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:8px;background:var(--bg2);',
  'border:1px solid transparent;margin-bottom:5px;cursor:pointer;transition:.14s}',
  '.fll-call:hover{border-color:var(--acc)}',
  '.fll-verb{font-size:9px;font-weight:800;letter-spacing:.4px;padding:3px 6px;border-radius:5px;',
  'background:var(--bg3);color:var(--mut);flex:0 0 auto;width:50px;text-align:center}',
  '.fll-st{font-size:10px;font-weight:700;padding:3px 7px;border-radius:5px;flex:0 0 auto;',
  'background:rgba(61,220,151,.14);color:var(--ok);font-variant-numeric:tabular-nums}',
  '.fll-st.bad{background:rgba(255,95,109,.16);color:var(--err)}',
  '.fll-st.wait{background:rgba(255,182,72,.16);color:var(--warn)}',
  '.fll-path{flex:1;min-width:0;font-family:var(--mono);font-size:11px;overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap;direction:rtl}',
  '.fll-dur{font-size:10px;color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 auto}',

  /* ---------- timeline ---------- */
  '.fll-tl{position:relative;padding-left:20px}',
  '.fll-tl:before{content:"";position:absolute;left:5px;top:8px;bottom:8px;width:1px;background:var(--line)}',
  '.fll-ev{position:relative;padding:9px 12px;margin-bottom:6px;border-radius:9px;background:var(--bg2);',
  'cursor:pointer;border:1px solid transparent;transition:.14s}',
  '.fll-ev:hover{border-color:var(--acc)}',
  '.fll-ev:before{content:"";position:absolute;left:-18px;top:15px;width:7px;height:7px;border-radius:50%;',
  'background:var(--mut);box-shadow:0 0 0 3px var(--bg)}',
  '.fll-ev.boot:before{background:var(--ok)}',
  '.fll-ev.gap:before{background:var(--warn)}',
  '.fll-ev.err:before{background:var(--err)}',
  '.fll-ev-t{display:flex;align-items:center;gap:9px;font-size:11.5px;font-weight:600}',
  '.fll-ev-t em{margin-left:auto;font-style:normal;font-size:10px;color:var(--mut);font-variant-numeric:tabular-nums}',
  '.fll-ev-d{font-size:10.5px;color:var(--mut);margin-top:4px;font-family:var(--mono);overflow:hidden;',
  'text-overflow:ellipsis;white-space:nowrap}',

  /* ---------- hanh trinh ---------- */
  /* Dung lai khung .fll-tl/.fll-ev cua Timeline, chi doi mau cham theo loai thao tac. */
  '.fll-ev.jr-screen:before{background:var(--info)}',
  '.fll-ev.jr-tap:before{background:var(--acc)}',
  '.fll-ev.jr-saw:before{background:var(--warn)}',
  '.fll-ev.jr-move:before{background:var(--ok)}',
  '.fll-ev.jr-fail:before{background:var(--err)}',
  '.fll-ev.jr-saw{border-left:2px solid var(--warn)}',
  '.fll-ev.jr-fail{border-left:2px solid var(--err)}',
  '.fll-jms{font-size:9.5px;font-weight:700;color:var(--warn);background:rgba(255,182,72,.14);',
  'padding:1px 6px;border-radius:20px;font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-jn{font-size:9.5px;font-weight:800;color:var(--mut);background:var(--bg3);padding:1px 6px;',
  'border-radius:20px;font-variant-numeric:tabular-nums;flex:0 0 auto}',

  /* ---------- form loc ---------- */
  '.fll-in{width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg2);',
  'color:var(--txt);font-size:12px;font-family:var(--mono);transition:.14s}',
  '.fll-in::placeholder{color:#6d6580}',
  '.fll-in:focus{border-color:var(--acc);box-shadow:0 0 0 3px rgba(255,46,136,.14)}',
  '.fll-in.bad{border-color:var(--err)}',
  '.fll-hint{font-size:10.5px;line-height:1.55;color:var(--mut)}',
  '.fll-hint b{font-weight:650}',
  '.fll-btn{padding:9px 15px;border-radius:9px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);',
  'font-size:11.5px;font-weight:650;cursor:pointer;transition:.14s}',
  '.fll-btn:hover{border-color:var(--acc);background:var(--bg3)}',
  '.fll-btn.pri{background:var(--acc);border-color:var(--acc);color:#fff}',
  '.fll-btn.pri:hover{filter:brightness(1.12)}',
  '.fll-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
  '.fll-empty{text-align:center;padding:40px 16px;color:var(--mut);font-size:12px}',

  /* ---------- footer dieu huong ---------- */
  /* Chua padding-right rong hon de nut ">" khong nam duoi tay nam keo goc. */
  '.fll-ft{display:flex;align-items:center;gap:8px;padding:11px 30px 11px 14px;',
  'border-top:1px solid var(--line);background:linear-gradient(0deg,#241f31,#1a1723);flex:0 0 auto}',
  '.fll-ft .fll-info{flex:1;font-size:11px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap}',
  '.fll-ft .fll-info b{color:var(--txt);font-weight:650;font-variant-numeric:tabular-nums}',

  /* ---------- pill khi thu nho ---------- */
  '.fll-pill{position:fixed;right:18px;bottom:18px;display:flex;align-items:center;gap:9px;padding:11px 18px;',
  'border-radius:24px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:12px;',
  'font-weight:600;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.42);transition:.16s;',
  'animation:fll-in .18s cubic-bezier(.2,.9,.3,1)}',
  '.fll-pill:hover{transform:translateY(-2px);border-color:var(--acc)}',
  '.fll-pill b{color:var(--err);font-weight:750;font-variant-numeric:tabular-nums}',

  /* ---------- style bom vao bang log cua trang ---------- */
  /* Loc bang mot class tren container + danh dau dong duoc giu, thay vi an tung dong bi loai. */
  '.fll-filtering > [class*="logRow"]:not(.fll-keep){display:none!important}',
  '.fll-hit{background:rgba(255,46,136,.22)!important;outline:2px solid #ff2e88!important;outline-offset:-2px;',
  'border-radius:3px;animation:fll-flash .9s ease-out}',
  '@keyframes fll-flash{0%{background:rgba(255,46,136,.6)!important}100%{background:rgba(255,46,136,.22)!important}}',
].join('');
// AI-GENERATED END
/*
File: src/03-shell.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// AI-GENERATED START — khung panel: state, dieu huong dong, bo loc, minimap, keo tha, thu nho

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
  // Nguoi dung bam "x" tren feedback nay: dung tu gan lai nua (nhung sang feedback khac thi gan lai).
  isDismissed: false,
  // Nho lan truoc dang mo panel hay dang thu gon, de sang feedback khac tra ve dung dang do.
  wasPanelOpen: false,
  // Dong bi bo loc an nhung nguoi dung van nhay toi: phai dem rieng, khong thi con so
  // "dang hien N/total" se noi doi.
  forcedVisibleIndices: new Set(),
  filter: {
    levels: new Set(),
    modules: new Set(),
    text: '',
    useRegex: true,
    hideOthers: true,
    // Khoang thoi gian tuy y. Chip preset ghi (lastTs - N, lastTs); keo tren minimap ghi khoang bat ky.
    timeFrom: null,
    timeTo: null,
    session: null,
  },
  el: {},
};

/* ------------------------------------------- tat tieng chu ky (nho qua phien) */

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
    // Rieng tu / het dung luong: tat tieng van chay trong phien nay, chi khong nho sang lan sau.
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

// Cac tab doc qua day: co bo loc thi la thong ke cua tap dang hien, khong thi la ca file.
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

function formatClock(ts) {
  if (!ts) return '--:--:--';
  const date = new Date(ts + 7 * 3600000);
  return date.toISOString().slice(11, 19);
}

function formatDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
}

function formatCount(value) {
  return value >= 1000 ? (value / 1000).toFixed(1) + 'k' : String(value);
}

/* ---------------------------------------------------------------- dieu huong */

function jumpToIndex(domIndex) {
  const data = lensState.data;
  const entry = data.entries[domIndex];
  if (!entry || !entry.el) return;

  // Truoc day cho chay het 4085 phan tu de go class highlight moi lan bam n — chi can nho dong truoc do.
  if (lensState.el.lastHit && lensState.el.lastHit !== entry.el) lensState.el.lastHit.classList.remove('fll-hit');
  if (!isRowVisible(entry)) {
    lensState.forcedVisibleIndices.add(domIndex);
    entry.el.classList.add('fll-keep');
    entry.isKept = true;
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

function setMatches(indices, label) {
  lensState.matches = indices;
  lensState.matchLabel = label;
  lensState.matchPos = indices.length ? 0 : -1;
  if (indices.length) jumpToIndex(indices[0]);
  renderFooter();
}

function moveMatch(step) {
  const total = lensState.matches.length;
  if (!total) return;
  lensState.matchPos = (lensState.matchPos + step + total) % total;
  jumpToIndex(lensState.matches[lensState.matchPos]);
  renderFooter();
}

function renderFooter() {
  const info = lensState.el.info;
  if (!info) return;
  const total = lensState.matches.length;
  if (!total) {
    info.innerHTML = '<span style="opacity:.7">Chưa chọn gì để duyệt</span>';
    return;
  }
  const entry = lensState.data.entries[lensState.matches[Math.max(0, lensState.matchPos)]];
  info.innerHTML =
    '<b>' + (lensState.matchPos + 1) + '/' + total + '</b> ' + escapeHtml(lensState.matchLabel) +
    ' &middot; dòng <b>' + (entry ? entry.lineNo : '?') + '</b>';
}

/* ------------------------------------------------------------------ bo loc */

function hasAnyFilterFacet() {
  const filter = lensState.filter;
  return !!(filter.levels.size || filter.modules.size || filter.text || filter.session ||
    filter.timeFrom !== null || filter.timeTo !== null);
}

// Mot lan ghi class len container thay cho hang nghin lan ghi len tung dong.
function setLogFilteringMode(isFiltering) {
  const container = lensState.data && lensState.data.container;
  if (!container) return;
  container.classList.toggle('fll-filtering', isFiltering);
  lensState.isFiltering = isFiltering;
}

function isRowVisible(entry) {
  return !lensState.isFiltering || entry.isKept === true;
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
    timeFrom: filter.timeFrom,
    timeTo: filter.timeTo,
    text: filter.text,
    needle: filter.text.toLowerCase(),
    matcher,
    isBadPattern,
  };
}

// skipFacetId cho phep hoi "neu bo qua dung dieu kien nay thi dong co lot khong".
// Do la cach dem cho cac chip trong tab Loc: mot facet khong duoc tu dem theo chinh no,
// neu khong thi chon ERROR xong chip WARNING ve 0 va khong con duong noi rong lai.
function entryMatches(entry, compiled, skipFacetId) {
  if (skipFacetId !== 'levels' && compiled.levels.size && !compiled.levels.has(entry.level)) return false;
  if (skipFacetId !== 'modules' && compiled.modules.size && !compiled.modules.has(entry.module)) return false;
  if (skipFacetId !== 'session' && compiled.session && entry.session !== compiled.session) return false;
  if (skipFacetId !== 'window' && (compiled.timeFrom !== null || compiled.timeTo !== null)) {
    if (!entry.ts) return false;
    if (compiled.timeFrom !== null && entry.ts < compiled.timeFrom) return false;
    if (compiled.timeTo !== null && entry.ts > compiled.timeTo) return false;
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

// Cua so thoi gian dang xem, suy tu cac dieu kien THOI GIAN (khong phai tu tap dong con lai).
// Neu suy tu tap dong thi loc "chi ERROR" se lam khoang lang phinh thanh nhung khoang gia giua hai loi.
function getVisibleTimeRange() {
  const data = lensState.data;
  const filter = lensState.filter;
  let from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
  let to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
  if (filter.session && data.sessions) {
    const session = data.sessions.find((item) => item.index === filter.session);
    if (session) {
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
  const stats = deriveStats(subset);
  const range = getVisibleTimeRange();
  // Khoang lang la thuoc tinh cua duong thoi gian, khong phai cua tap dong: chi cat theo cua so thoi gian.
  stats.gaps = data.gaps.filter((gap) => gap.before.ts >= range.from && gap.before.ts <= range.to);
  lensState.view = Object.assign({}, data, stats);
}

function computeFilteredIndices() {
  const filter = lensState.filter;
  const compiled = compileFilter();
  const isBadPattern = compiled.isBadPattern;
  // Ham nay tinh lai toan bo trang thai nen moi dong tung duoc "ep hien" tro ve chuan.
  lensState.forcedVisibleIndices.clear();
  const isFiltering = filter.hideOthers && hasAnyFilterFacet();
  const visible = [];
  lensState.data.entries.forEach((entry) => {
    const keep = entryMatches(entry, compiled, null);
    if (keep) visible.push(entry.domIndex);
    // Chi danh dau dong DUOC GIU (thuong vai chuc) thay vi an tung dong bi loai (thuong ~4000).
    // Khi khong loc thi khong dung toi DOM: class tren container tat la moi dong tu hien lai,
    // va entry.isKept van khop voi class dang co nen lan loc sau chi ghi dung phan chenh lech.
    if (isFiltering && entry.el && entry.isKept !== keep) {
      entry.el.classList.toggle('fll-keep', keep);
      entry.isKept = keep;
    }
  });
  setLogFilteringMode(isFiltering);
  lensState.visibleCount = isFiltering ? visible.length : lensState.data.entries.length;
  lensState.lastFilterResult = { visible, isBadPattern };
  buildView();
  return lensState.lastFilterResult;
}

// Ve lai tab Loc khong duoc tu quet lai 4085 dong: moi duong doi bo loc deu da goi
// computeFilteredIndices truoc do roi. Quet hai lan la ly do "Xoa tat ca" tung ton 200ms.
function getFilterResult() {
  return lensState.lastFilterResult || computeFilteredIndices();
}

/* --------------------------------------------------- permalink qua hash URL */

// Mot dinh nghia duy nhat cho ca permalink lan mau bo loc.
// Khoang thoi gian ket thuc dung o lastTs duoc luu dang "N cuoi" chu khong phai moc tuyet doi:
// nhu the mau "2 phut cuoi" con dung duoc o feedback khac, con moc tuyet doi thi vo nghia.
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
  if (filter.timeFrom !== null || filter.timeTo !== null) {
    const from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
    const to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
    if (Math.abs(to - data.lastTs) < 1000) payload.wLast = to - from;
    else {
      payload.f = from - data.firstTs;
      payload.tt = to - data.firstTs;
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
  filter.timeFrom = null;
  filter.timeTo = null;
  filter.hideOthers = true;
  // payload.w la dang cu cua permalink (chi luu "N giay cuoi").
  if (payload.wLast || payload.w) setTimeWindowPreset(payload.wLast || payload.w);
  else if (payload.f >= 0 || payload.tt >= 0) {
    filter.timeFrom = payload.f >= 0 ? Math.min(data.lastTs, data.firstTs + payload.f) : null;
    filter.timeTo = payload.tt >= 0 ? Math.min(data.lastTs, data.firstTs + payload.tt) : null;
  }
}

// Chi doc/ghi chuoi, khong dat lai location.hash: trang la SPA, doi hash co the lam router chay lai.
function buildPermalink() {
  // matches chua domIndex, khong phai vi tri trong entries — phai tra qua mot lop nua.
  const entry = lensState.matches.length
    ? lensState.data.entries[lensState.matches[Math.max(0, lensState.matchPos)]]
    : null;
  const payload = Object.assign({ t: lensState.tab, ln: entry ? entry.lineNo : 0 }, serializeFilter());
  return location.origin + location.pathname + location.search + PERMALINK_PREFIX +
    encodeURIComponent(JSON.stringify(payload));
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
  applyFilterPayload(payload);
  lensState.tab = payload.t || 'sum';
  applyFilter(false);
  if (payload.ln) {
    const target = lensState.data.entries.find((entry) => entry.lineNo === payload.ln);
    if (target) setMatches([target.domIndex], 'từ permalink');
  }
  return true;
}

/* ------------------------------------------------ mau bo loc (luu trong localStorage) */

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
    // Rieng tu / het dung luong: mau van dung duoc trong phien nay, chi khong nho sang lan sau.
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

// Mo ta ngan mot mau de hien lam tooltip — doc duoc ma khong can ap thu.
function describeTemplatePayload(payload) {
  const parts = [];
  if (payload.wLast) parts.push(formatWindowPresetLabel(payload.wLast));
  else if (payload.f >= 0 || payload.tt >= 0) parts.push('khoảng thời gian cố định');
  if (payload.s) parts.push('phiên ' + payload.s);
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

/* ------------------------------- thanh bo loc thuong tru (hien o moi tab) */

// Bo loc la state chung nhung truoc day chi nhin thay duoc trong tab Loc: doi sang tab khac
// la khong con dau hieu nao cho biet bang log dang bi cat bot. Thanh nay hien o moi tab.
function formatWindowLabel() {
  const filter = lensState.filter;
  const data = lensState.data;
  const from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
  const to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
  // Neu trung khit mot preset thi goi ten preset cho de doc, con lai hien khoang thoi gian that.
  if (Math.abs(to - data.lastTs) < 1000) {
    const span = to - from;
    for (let i = 0; i < TIME_WINDOW_CHOICES.length; i += 1) {
      if (Math.abs(span - TIME_WINDOW_CHOICES[i]) < 1000) return formatWindowPresetLabel(TIME_WINDOW_CHOICES[i]);
    }
  }
  return formatClock(from) + ' → ' + formatClock(to);
}

function formatWindowPresetLabel(ms) {
  return ms < 60000 ? ms / 1000 + ' giây cuối' : ms / 60000 + ' phút cuối';
}

function isWindowPresetActive(ms) {
  const filter = lensState.filter;
  if (!ms) return filter.timeFrom === null && filter.timeTo === null;
  if (filter.timeFrom === null || filter.timeTo === null) return false;
  return Math.abs(filter.timeTo - lensState.data.lastTs) < 1000 &&
    Math.abs(filter.timeTo - filter.timeFrom - ms) < 1000;
}

function setTimeWindowPreset(ms) {
  const filter = lensState.filter;
  if (!ms) {
    filter.timeFrom = null;
    filter.timeTo = null;
    return;
  }
  filter.timeTo = lensState.data.lastTs;
  filter.timeFrom = Math.max(lensState.data.firstTs, lensState.data.lastTs - ms);
}

function getActiveFilterFacets() {
  const filter = lensState.filter;
  const facets = [];
  if (filter.timeFrom !== null || filter.timeTo !== null) {
    facets.push({ id: 'window', label: formatWindowLabel() });
  }
  if (filter.session) facets.push({ id: 'session', label: 'Phiên ' + filter.session });
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
  }
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
        '<button data-act="clearFacet" data-value="' + facet.id + '" title="Bỏ điều kiện này">&times;</button>' +
        '</span>')
      .join('') +
    '<button class="fll-fclear" data-act="clearFilters">Xoá tất cả</button></div>';
}

function resetFilter() {
  lensState.filter.levels.clear();
  lensState.filter.modules.clear();
  lensState.filter.text = '';
  lensState.filter.timeFrom = null;
  lensState.filter.timeTo = null;
  lensState.filter.session = null;
  // Moi dieu kien da rong nen luot nay chi cham vao dung nhung dong dang bi an.
  computeFilteredIndices();
  if (lensState.el.lastHit) lensState.el.lastHit.classList.remove('fll-hit');
  lensState.el.lastHit = null;
  lensState.matches = [];
  lensState.matchPos = -1;
  renderFooter();
  refreshFilterBar();
}

function filterByModule(moduleName) {
  lensState.filter.modules = new Set([moduleName]);
  lensState.filter.hideOthers = true;
  switchTab('flt');
  applyFilter(true);
}

function filterByLevel(level) {
  lensState.filter.levels = new Set([level]);
  lensState.filter.hideOthers = true;
  switchTab('flt');
  applyFilter(true);
}

/* ----------------------------------------------------------------- minimap */

function buildBuckets(count) {
  const data = lensState.data;
  const span = Math.max(1, data.lastTs - data.firstTs);
  const buckets = [];
  for (let i = 0; i < count; i += 1) buckets.push({ ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0, total: 0, firstIndex: -1 });
  data.entries.forEach((entry) => {
    if (!entry.ts || !entry.level) return;
    const slot = Math.min(count - 1, Math.floor(((entry.ts - data.firstTs) / span) * count));
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
      const title = bucket.total
        ? formatClock(lensState.data.firstTs + ((lensState.data.lastTs - lensState.data.firstTs) * index) / MINIMAP_BUCKETS) +
          ' · ' + bucket.total + ' dòng (' + bucket.ERROR + ' lỗi, ' + bucket.WARNING + ' cảnh báo)'
        : 'không có log';
      return '<i data-bucket="' + bucket.firstIndex + '" title="' + escapeHtml(title) + '" style="height:' +
        height.toFixed(1) + '%;background:' + color + '"></i>';
    })
    .join('');
  // Minimap co y giu NGUYEN toan dai: no la la ban do "dang o dau trong ca log".
  // Bo loc thoi gian chi lam mo phan ngoai cua so, van thay duoc toan canh.
  lensState.el.map.innerHTML = columns +
    '<div class="fll-shade fll-shade-l"></div><div class="fll-shade fll-shade-r"></div>' +
    '<div class="fll-cursor"></div>';
  lensState.el.cursor = lensState.el.map.querySelector('.fll-cursor');
  lensState.el.shadeLeft = lensState.el.map.querySelector('.fll-shade-l');
  lensState.el.shadeRight = lensState.el.map.querySelector('.fll-shade-r');
  lensState.el.mapLabel.innerHTML =
    '<span>' + formatClock(lensState.data.firstTs) + '</span>' +
    '<span class="fll-maptext"></span>' +
    '<span>' + formatClock(lensState.data.lastTs) + '</span>';
  lensState.el.mapText = lensState.el.mapLabel.querySelector('.fll-maptext');
  updateMinimapRange();
}

function updateMinimapRange() {
  const shadeLeft = lensState.el.shadeLeft;
  const shadeRight = lensState.el.shadeRight;
  if (!shadeLeft || !shadeRight || !lensState.data) return;
  const data = lensState.data;
  const span = Math.max(1, data.lastTs - data.firstTs);
  const range = getVisibleTimeRange();
  shadeLeft.style.width = Math.max(0, ((range.from - data.firstTs) / span) * 100).toFixed(2) + '%';
  shadeRight.style.width = Math.max(0, ((data.lastTs - range.to) / span) * 100).toFixed(2) + '%';
  lensState.el.map.classList.toggle('fll-map-ranged', hasAnyTimeRange());
  if (!lensState.el.mapText) return;
  lensState.el.mapText.textContent = hasAnyTimeRange()
    ? formatClock(range.from) + ' → ' + formatClock(range.to) + ' · ' + formatDuration(range.to - range.from)
    : 'kéo để chọn khoảng · bấm để nhảy · nháy đúp để bỏ chọn';
}

function hasAnyTimeRange() {
  return lensState.filter.timeFrom !== null || lensState.filter.timeTo !== null;
}

/* ------------------------------------------- keo chon khoang thoi gian tren minimap */

const MINIMAP_EDGE_GRAB_PX = 7;
const MINIMAP_MIN_RANGE_MS = 500;

let minimapDrag = null;

function minimapTsFromClientX(clientX) {
  const rect = lensState.el.map.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  const data = lensState.data;
  return data.firstTs + ratio * Math.max(1, data.lastTs - data.firstTs);
}

function minimapClientXFromTs(ts) {
  const rect = lensState.el.map.getBoundingClientRect();
  const data = lensState.data;
  return rect.left + ((ts - data.firstTs) / Math.max(1, data.lastTs - data.firstTs)) * rect.width;
}

// Chi ve lai hai mieng mo trong luc keo. Ap bo loc that su doi mot luot 4085 dong + layout bang log,
// nang qua de chay theo tung nhip chuot — nen chi commit luc tha tay.
function previewMinimapRange(from, to) {
  const data = lensState.data;
  const span = Math.max(1, data.lastTs - data.firstTs);
  lensState.el.shadeLeft.style.width = Math.max(0, ((from - data.firstTs) / span) * 100).toFixed(2) + '%';
  lensState.el.shadeRight.style.width = Math.max(0, ((data.lastTs - to) / span) * 100).toFixed(2) + '%';
  if (lensState.el.mapText) {
    lensState.el.mapText.textContent = formatClock(from) + ' → ' + formatClock(to) +
      ' · ' + formatDuration(Math.max(0, to - from));
  }
}

function resolveMinimapDragMode(clientX) {
  const filter = lensState.filter;
  if (filter.timeFrom === null && filter.timeTo === null) return 'create';
  const range = getVisibleTimeRange();
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
    if (from < data.firstTs) {
      to += data.firstTs - from;
      from = data.firstTs;
    }
    if (to > data.lastTs) {
      from -= to - data.lastTs;
      to = data.lastTs;
    }
  }

  minimapDrag.previewFrom = Math.max(data.firstTs, from);
  minimapDrag.previewTo = Math.min(data.lastTs, to);
  previewMinimapRange(minimapDrag.previewFrom, minimapDrag.previewTo);
}

function handleMinimapMouseUp() {
  window.removeEventListener('mousemove', handleMinimapMouseMove);
  window.removeEventListener('mouseup', handleMinimapMouseUp);
  const drag = minimapDrag;
  minimapDrag = null;
  // Bam khong keo: de nguyen cho handleLensClick nhay toi moc do nhu cu.
  if (!drag || !drag.hasMoved) return;
  // Da keo thi chan cu click sinh ra ngay sau mouseup, khong thi vua chon xong lai nhay lung tung.
  lensState.suppressMapClick = true;
  setTimeout(() => {
    lensState.suppressMapClick = false;
  }, 0);

  if (drag.previewTo - drag.previewFrom < MINIMAP_MIN_RANGE_MS) clearFilterFacet('window');
  else {
    lensState.filter.timeFrom = drag.previewFrom;
    lensState.filter.timeTo = drag.previewTo;
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
  const span = Math.max(1, lensState.data.lastTs - lensState.data.firstTs);
  cursor.style.left = (((ts - lensState.data.firstTs) / span) * 100).toFixed(2) + '%';
  cursor.style.opacity = '1';
}

/* ------------------------------------------------- keo tha va doi kich thuoc */

function clampValue(value, min, max) {
  return Math.max(min, Math.min(Math.max(min, max), value));
}

// Panel mac dinh neo phai (top/right/bottom trong CSS) nen chieu cao la ngam.
// Khi keo di hoac keo goc thi ghim han sang left/top/width/height de hai chieu deu chinh duoc.
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

// mousemove/mouseup chi duoc gan trong luc keo roi go ngay, khong gan thuong tru:
// mountPanel() chay lai moi lan mo tu pill, gan thuong tru se cong don listener.
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
    origin.committedLeft = undefined;
    panel.classList.add('fll-dragging');
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    event.preventDefault();
  }

  // mousemove ban day hon tan so khung hinh, nen gom lai mot lan cap nhat moi frame.
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
      // Di chuyen bang transform chu khong phai left/top: transform duoc compositor xu ly,
      // khong bat trinh duyet layout lai va ve lai vung panel (kem bong mo 70px) moi khung hinh.
      // Chot lai thanh left/top luc tha tay.
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

    // 'edge': keo mep trai, giu nguyen mep phai o ca hai kieu neo.
    const width = clampValue(origin.rect.width + (origin.x - event.clientX), PANEL_MIN_WIDTH,
      origin.rect.right - VIEWPORT_MARGIN);
    panel.style.width = width + 'px';
    if (!origin.wasRightAnchored) panel.style.left = origin.rect.right - width + 'px';
  }

  function handleUp() {
    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('mouseup', handleUp);
    if (!mode) return;
    // Chot transform thanh vi tri that truoc khi do lai kich thuoc, khong thi getBoundingClientRect
    // van dang cong them phan dich chuyen.
    if (mode === 'move' && origin.committedLeft !== undefined) {
      panel.style.transform = '';
      panel.style.left = origin.committedLeft + 'px';
      panel.style.top = origin.committedTop + 'px';
    }
    mode = null;
    pendingEvent = null;
    panel.classList.remove('fll-dragging');
    document.body.style.userSelect = '';
    savePanelGeometry(panel);
  }

  header.addEventListener('mousedown', (event) => {
    if (event.target.closest('.fll-ico')) return;
    beginInteraction('move', event);
  });
  edgeGrip.addEventListener('mousedown', (event) => beginInteraction('edge', event));
  cornerGrip.addEventListener('mousedown', (event) => beginInteraction('corner', event));
}

/* ------------------------------------------------------------- phim tat */

// Esc chi thu ve pill, khong huy panel: neu huy thi khong con gi de bam mo lai.
// Nut "x" moi dong han, va Alt+L la duong quay lai — listener nay co y giu song sau khi dong.
//
// Da do tren trang that: khi trang admin nhan duoc Escape, chinh no goi removeChild go #fll-root
// ra khoi body (khong phai code o day — bay Element.prototype.remove khong bat duoc gi).
// Vi vay listener gan o capture phase tren window va chan lan truyen voi nhung phim minh xu ly,
// de trang khong bao gio thay Escape khi panel dang mo. LENS_KEY_LISTENER_OPTIONS phai dung
// y het nhau luc them va luc go, neu khac thi removeEventListener khong an.
const LENS_KEY_LISTENER_OPTIONS = true;

function isLensMounted() {
  return !!document.getElementById(ROOT_ID);
}

function handleShortcut(event) {
  // Instance cu (world khac) khong duoc gianh phim voi instance dang lam chu.
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
// AI-GENERATED END
/*
File: src/04-sheet.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// AI-GENERATED START — tam truot phu len than panel: xem payload JSON va gom cac dong cung mot ID

const SHEET_MAX_RAW_LENGTH = 20000;

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
    '<button class="fll-ico" data-act="closeSheet" title="Đóng">×</button></div>' +
    '<div class="fll-sheet-body">' + bodyHtml + '</div>';
  panel.appendChild(sheet);
  lensState.el.sheet = sheet;
}

function closeSheet() {
  const existing = lensState.el.panel && lensState.el.panel.querySelector('.fll-sheet');
  if (existing) existing.remove();
  lensState.el.sheet = null;
}

// Mot khoi co the vua bi cat vua bi che, nen tra ve danh sach nhan chu khong phai mot nhan.
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

// To mau bang cach quet token roi escape TUNG manh — escape truoc rooi mau sau se an ca the <i>,
// con mau truoc escape sau thi the bi bien thanh chu.
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

// Mot request HTTP nam o hai dong log khac nhau va moi dong mang truong khac nhau
// (--header/--encrypted o dong request, --status o dong response), nen mo chung mot tam truot
// roi doi qua lai bang chip: khoi phai dong ra mo vao de so request voi response.
const WRAP_STORAGE_KEY = 'fll.payloadWrap';

// Mac dinh BAT: pretty-print chi ngan dong o cau truc, con mot gia tri dai (chu ky, chuoi base64)
// van la mot dong dai vai nghin ky tu — cuon ngang de doc thu do rat met.
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
    // Rieng tu / het dung luong: lua chon van co hieu luc trong phien nay.
  }
}

function togglePayloadWrap(button) {
  payloadSheetState.isWrapped = !payloadSheetState.isWrapped;
  persistPayloadWrap();
  // Doi class tai cho thay vi ve lai: giu nguyen vi tri cuon nguoi dung dang doc do.
  const sheet = lensState.el.panel && lensState.el.panel.querySelector('.fll-sheet');
  if (sheet) {
    sheet.querySelectorAll('.fll-code').forEach((block) => {
      block.classList.toggle('fll-wrap', payloadSheetState.isWrapped);
    });
  }
  button.className = 'fll-chip' + (payloadSheetState.isWrapped ? ' on' : '');
}

function renderPayloadToolbar(tabsHtml) {
  const wrap = '<button class="fll-chip' + (payloadSheetState.isWrapped ? ' on' : '') +
    '" data-act="toggleWrap" title="Xuống dòng thay vì cuộn ngang">&#8629; Xuống dòng</button>';
  if (!tabsHtml) return '<div class="fll-row fll-paybar">' + '<div class="fll-hd-sp"></div>' + wrap + '</div>';
  return '<div class="fll-stabs">' + tabsHtml + '<div class="fll-hd-sp"></div>' + wrap + '</div>';
}

function renderPayloadBody(domIndex, tabsHtml) {
  const entry = lensState.data.entries[domIndex];
  if (!entry) return null;
  const sections = buildPayloadSections(entry.raw);
  const body = sections.length
    ? sections.map(renderPayloadSection).join('') +
      '<div class="fll-row" style="margin-top:12px">' +
      '<button class="fll-btn pri" data-jump="' + domIndex + '">Nhảy tới dòng ' + entry.lineNo + '</button></div>'
    : '<div class="fll-empty">Dòng này không có khối dữ liệu nào.</div>';
  return { entry, html: renderPayloadToolbar(tabsHtml || '') + body };
}

function formatBytes(count) {
  if (count < 1024) return count + ' B';
  return (count / 1024).toFixed(count < 10240 ? 1 : 0) + ' KB';
}

// Do tren nguyen van cua CAC TRUONG payload, khong tinh phan "[Module: HTTP] [URL: ...]" dau dong.
function payloadBytes(domIndex) {
  const entry = lensState.data.entries[domIndex];
  if (!entry) return 0;
  return buildPayloadSections(entry.raw).reduce((total, section) => total + (section.bytes || 0), 0);
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

// Duong vao cho MOT dong don le (tam truot correlation), khong co cap request/response.
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
// AI-GENERATED END
/*
File: src/04-tabs.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// AI-GENERATED START — noi dung 6 tab: Tong quan, Van de, HTTP, Cham, Loc, Dien bien

// Dung log that co 262 nhom sau khi gom; ve het mot luot la mot chuoi HTML rat lon va phai
// dung lai moi lan go phim trong o tim. Ve theo lo, con lai bam "Hien them".
const ISSUE_PAGE_SIZE = 50;

const TIMELINE_PAGE_SIZE = 80;

const tabUiState = { issueLevel: 'all', issueQuery: '', httpOnlyBad: false, httpQuery: '', moduleQuery: '',
  issueLimit: ISSUE_PAGE_SIZE, templateName: '', tlGroup: 'all', tlLimit: TIMELINE_PAGE_SIZE };

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

function renderRankList(rows, dataAttr, limit) {
  const visible = rows.slice(0, limit);
  const peak = Math.max(1, ...visible.map((row) => row.count));
  return '<div class="fll-rank">' + visible
    .map((row) =>
      '<div class="fll-rk" ' + dataAttr + '="' + escapeHtml(row.key) + '">' +
      '<u style="width:' + ((row.count / peak) * 100).toFixed(1) + '%"></u>' +
      '<span>' + escapeHtml(row.key) + '</span><b>' + row.count + '</b></div>')
    .join('') + '</div>';
}

// The thong ke hien so chinh xac; chi badge tren tab moi rut gon kieu 4.1k.
// Khi dang loc thi kem theo tong cua ca file (47/958) de khong ai giat minh "warning cua toi dau mat roi".
function statCard(value, label, color, attrs, total) {
  const suffix = total != null && total !== value ? '<em>/' + total + '</em>' : '';
  return '<button class="fll-stat" ' + attrs + '><b' + (color ? ' style="color:' + color + '"' : '') + '>' +
    value + suffix + '</b><span>' + escapeHtml(label) + '</span></button>';
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

// Log duoc chup dung luc user bam gui feedback, nen mep phai cua truc thoi gian chinh la thoi diem xay ra van de.
function renderFeedbackBanner() {
  const data = lensState.data;
  const context = data.feedback || {};
  const bits = [context.Feature, context.ScreenID, context.MiniApp].filter(Boolean);
  const device = [context['Device OS'], context['App Info'], context.Network].filter(Boolean).join(' · ');

  // Thiet bi/phien ban chi de trong tooltip: dong nay bi cat giua chu thi doc cang kho hon la khong co.
  return '<div class="fll-focus">' +
    '<div class="fll-focus-t">User gửi lúc <b>' + formatClock(data.lastTs) + '</b>' +
    (context['Entry Point'] ? ' từ <b>' + escapeHtml(context['Entry Point']) + '</b>' : '') + '</div>' +
    (bits.length ? '<div class="fll-focus-d" title="' +
      escapeHtml(bits.join(' · ') + (device ? '\n' + device : '')) + '">' +
      escapeHtml(bits.join(' · ')) + '</div>' : '') +
    '<div class="fll-focus-hint">Vấn đề thường nằm ở cuối log — thu hẹp lại:</div>' +
    renderWindowChips(false) +
    (context.Feature ? '<button class="fll-btn" style="margin-top:9px" data-act="filterFeature" data-value="' +
      escapeHtml(context.Feature) + '">Chỉ dòng có "' + escapeHtml(context.Feature) + '"</button>' : '') +
    '</div>';
}

function renderSummaryTab() {
  const data = getView();
  const full = lensState.data;
  const isScoped = data !== full;
  const errorGroups = data.groups.filter((group) => group.level === 'ERROR' && !isGroupMuted(group));

  // Khong lap lai "dang loc N dong" o day: thanh bo loc ngay phia tren da noi roi,
  // va moi the thong ke deu tu hien dang scope/tong.
  let html = renderFeedbackBanner() +
    '<div class="fll-stats">' +
    statCard(data.scopedEntries.length, 'dòng log', '', 'data-act="noop"',
      isScoped ? full.entries.length : null) +
    statCard(data.levels.ERROR, 'ERROR', LEVEL_COLOR.ERROR, 'data-level="ERROR"',
      isScoped ? full.levels.ERROR : null) +
    statCard(data.levels.WARNING, 'WARNING', LEVEL_COLOR.WARNING, 'data-level="WARNING"',
      isScoped ? full.levels.WARNING : null) +
    statCard(full.sessionCount, 'phiên app', '#3ddc97', 'data-act="gotoTimeline"') +
    statCard(data.gaps.length, 'khoảng lặng ≥ ' + full.gapThresholdLabel, LEVEL_COLOR.WARNING,
      'data-act="gotoTimeline"', isScoped ? full.gaps.length : null) +
    statCard(data.badHttpCalls.length, 'HTTP bất thường', LEVEL_COLOR.ERROR, 'data-act="gotoHttp"',
      isScoped ? full.badHttpCalls.length : null) +
    '</div>';

  if (full.outOfOrder > 0) {
    html += '<div class="fll-note" title="Logger flush theo lô (' + full.batchCount +
      ' mốc END OF BATCH). Minimap, khoảng lặng và tab Timeline đều đã sắp lại theo timestamp thật.">' +
      '<span>&#9888;</span><div><b>' + full.outOfOrder + ' dòng có timestamp lùi về trước</b> — ' +
      'thứ tự dòng không phải thứ tự thời gian.</div></div>';
  }

  html += '<div class="fll-sec">Tỷ lệ mức độ</div>';
  const levelTotal = Math.max(1, LEVEL_ORDER.reduce((sum, level) => sum + data.levels[level], 0));
  html += '<div class="fll-lvbar">' + LEVEL_ORDER
    .map((level) => '<i style="width:' + ((data.levels[level] / levelTotal) * 100).toFixed(2) + '%;background:' +
      LEVEL_COLOR[level] + '" title="' + level + ': ' + data.levels[level] + '"></i>')
    .join('') + '</div>';
  html += '<div class="fll-lvkey">' + LEVEL_ORDER
    .map((level) => '<button class="fll-chip" data-level="' + level + '">' +
      '<i class="fll-sw" style="background:' + LEVEL_COLOR[level] + '"></i>' + level +
      ' <em>' + data.levels[level] + '</em></button>')
    .join('') + '</div>';

  if (errorGroups.length) {
    html += '<div class="fll-sec">Lỗi nổi bật</div>' +
      errorGroups.slice(0, 3).map((group) => renderGroupCard(group, data.groups.indexOf(group))).join('') +
      '<button class="fll-btn" data-act="gotoIssues" style="width:100%">Xem tất cả ' + data.groups.length +
      ' nhóm vấn đề</button>';
  }

  // Popup/bottom sheet dat gia nhat nen nam ngay tab dau, khong phai giau sau vai lan bam:
  // chung deu ghi o muc INFO nen phan "Loi noi bat" ngay tren khong bao gio nhac toi.
  if (data.journey.saw.length) {
    html += '<div class="fll-sec">User đã nhìn thấy gì</div>' +
      '<div class="fll-hint" style="margin-bottom:8px">Popup và bottom sheet thật sự hiện lên màn hình. ' +
      'Tất cả đều ghi ở mức <b>INFO</b> nên tab Vấn đề không đếm chúng.</div>' +
      data.journey.saw.map(renderSawCard).join('');
  }
  if (data.journey.taps.length) {
    html += '<div class="fll-sec">Chạm nhiều nhất</div>' + renderRankList(data.journey.taps, 'data-jtap', 6);
  }

  html += '<div class="fll-sec">Module nói nhiều nhất</div>' + renderRankList(data.modules, 'data-module', 8);
  if (data.events.length) {
    html += '<div class="fll-sec">Tracker event</div>' + renderRankList(data.events, 'data-event', 6) +
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
    '<button class="fll-ico fll-mute" data-act="mute" data-value="' + groupIndex + '" title="' +
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
    if (isGroupMuted(group)) {
      mutedCount += 1;
      return;
    }
    counts.all += 1;
    counts[group.level] += 1;
  });

  return '<div class="fll-row" style="margin-bottom:8px">' +
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
    renderTraceFailSection(data) +
    '<div class="fll-sec">Nhóm theo chữ ký dòng log</div>' +
    '<div id="fll-issue-list">' + renderIssueList() + '</div>';
}

// Dat TRUOC danh sach nhom chu ky vi day la loai loi ma danh sach do khong the thay: Grafana ghi o
// muc INFO. Mot log co the khong co dong Grafana nao — luc do phai noi thang la khong co, chu de
// trong thi nguoi doc tuong la "khong co loi".
function renderTraceFailSection(data) {
  const trace = data.traceIssues;
  if (!trace.available) {
    return '<div class="fll-sec">Lỗi từ Grafana trace</div>' +
      '<div class="fll-hint" style="margin-bottom:4px">Log này <b>không có dòng Grafana trace nào</b>. ' +
      'Những dòng đó chỉ được ghi khi máy gửi feedback bật Debug Tool, nên vắng mặt là bình thường — ' +
      'chỉ là ở log này không có thêm nguồn lỗi nào ngoài các nhóm chữ ký bên dưới.</div>';
  }
  if (!trace.fails.length) {
    return '<div class="fll-sec">Lỗi từ Grafana trace</div>' +
      '<div class="fll-hint" style="margin-bottom:4px">Có <b>' + trace.lineCount + '</b> dòng Grafana trace ' +
      'nhưng <b>không có <code>traceFail</code></b> nào — theo Grafana thì không luồng nào báo lỗi.</div>';
  }

  return '<div class="fll-sec">Lỗi từ Grafana trace</div>' +
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
  return '<div class="fll-grp err" data-tracefail="' + rowIndex + '" title="' +
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

// Tim ca trong payload chu khong chi trong URL: phan lon luc can la dan theo mot cmdId /
// request_id nhin thay o dong khac, ma gia tri do chi nam trong body.
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
  // Hai dau co payload khac nhau: --header / --encrypted nam o dong request, --status o dong response.
  // Truoc day chi mo duoc dong response nen phan header khong bao gio xem duoc tu day.
  const payloadIndex = call.resIndex != null ? call.resIndex : call.reqIndex;
  const correlation = findCorrelationForEntry(data.entries[payloadIndex]);
  const payloadButton = '<button class="fll-ico fll-mini" data-act="payload" data-req="' +
    (call.reqIndex == null ? '' : call.reqIndex) + '" data-res="' +
    (call.resIndex == null ? '' : call.resIndex) + '" title="Xem payload request / response">{ }</button>';
  return '<div class="fll-call" data-call="' + data.httpCalls.indexOf(call) + '">' +
    '<span class="fll-verb">' + escapeHtml(call.method) + '</span>' +
    '<span class="' + statusClass + '">' + escapeHtml(statusText) + '</span>' +
    '<span class="fll-path" title="' + escapeHtml(call.url) + '">' + escapeHtml(call.path) + '</span>' +
    '<span class="fll-dur">' + (call.duration != null ? formatDuration(call.duration) : call.time.slice(0, 8)) +
    '</span>' +
    payloadButton +
    (correlation ? '<button class="fll-ico fll-mini" data-act="correlate" data-value="' +
      escapeHtml(correlation.value) + '" title="Gom theo ' + correlation.key + '">&#128279;</button>' : '') +
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

function renderHttpTab() {
  const data = getView();
  return '<div class="fll-row" style="margin-bottom:9px">' +
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

// Nguon thu hai cho cung cau hoi "call nao hong": ops_receive_be do chinh app ghi, co san
// status/error_code/duration. Khong tron vao bang tren vi hai ben dem theo hai cach khac nhau
// (bang tren ghep dong [Method:] req/res, day khu trung theo trace_id) — de canh nhau moi doi chieu duoc.
function renderTrackerFailSection(data) {
  const journey = data.journey;
  if (!journey.fails.length) return '';
  return '<div class="fll-sec">Call BE fail — theo tracker</div>' +
    '<div class="fll-hint" style="margin-bottom:8px">Lấy từ <code>ops_receive_be</code> có ' +
    '<code>status=fail</code>. Đây là nguồn khác với bảng trên (bảng đó đọc dòng <code>[Method:]</code>) ' +
    'nên hai bên lệch nhau là bình thường: log này có <b>' + journey.apiTotal + '</b> call theo tracker ' +
    'và <b>' + data.httpCalls.length + '</b> call theo dòng HTTP.</div>' +
    journey.fails.map(renderTrackerFailRow).join('');
}

/* --------------------------------------------------------------------- Chậm */

function renderSlowTab() {
  const view = getView();
  const rows = view.durations;
  const header = renderScreenDwellSection(view) + '<div class="fll-sec">Mọi con số thời lượng</div>' + '<div class="fll-hint" style="margin-bottom:10px">Mọi con số thời lượng rút được từ log ' +
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

/* ----------------------------------------- manh dung chung cho hanh trinh user */

// Ba manh duoi day khong con tab rieng: chung nam trong tab da co dung chu de cua chung —
// "user thay gi" + "cham nhieu nhat" o Tong quan, "call BE fail" o HTTP, "o lau tren man" o Cham.
// Ban than dong thoi gian thi tron thang vao tab Dien bien.
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
  return '<div class="fll-sec">Ở lâu nhất trên màn</div>' +
    '<div class="fll-hint" style="margin-bottom:8px">Con số này <b>tính ra</b> từ khoảng cách tới bước ' +
    'màn hình kế tiếp, không phải trường có sẵn trong log. Các event nổ liên tiếp trong cùng một lần ' +
    'chuyển màn sẽ ra ~0ms nên không có mặt ở đây.</div>' +
    '<div class="fll-rank">' + screens.slice(0, 8)
      .map((row) => '<div class="fll-rk" data-jscreen="' + escapeHtml(row.key) + '">' +
        '<u style="width:' + ((row.ms / peak) * 100).toFixed(1) + '%"></u>' +
        '<span>' + escapeHtml(row.key) + '</span>' +
        '<b>' + formatDuration(row.ms) + ' &middot; ' + row.count + '&times;</b></div>')
      .join('') + '</div>';
}

/* ---------------------------------------------------------------------- Lọc */

function renderModuleChips() {
  const query = tabUiState.moduleQuery.toLowerCase();
  // Dem theo cac dieu kien KHAC, bo qua chinh dieu kien module: co the doi module dang chon.
  const tally = tallyFacetCandidates('modules', (entry) => entry.module);
  lensState.filter.modules.forEach((name) => {
    if (!tally.has(name)) tally.set(name, 0);
  });
  const modules = Array.from(tally, (pair) => ({ key: pair[0], count: pair[1] }))
    .filter((row) => !query || row.key.toLowerCase().indexOf(query) >= 0)
    .sort((a, b) => b.count - a.count);
  if (!modules.length) return '<div class="fll-hint">Không có module nào khớp.</div>';
  return modules.slice(0, 60)
    .map((row) => '<button class="fll-chip' + (lensState.filter.modules.has(row.key) ? ' on' : '') +
      '" data-act="tglModule" data-value="' + escapeHtml(row.key) + '">' + escapeHtml(row.key) +
      ' <em>' + row.count + '</em></button>')
    .join('');
}

function renderSessionChips() {
  const sessions = lensState.data.sessions;
  if (sessions.length < 2) return '';
  const tally = tallyFacetCandidates('session', (entry) => entry.session);
  return '<div class="fll-sec">Phiên app</div><div class="fll-lvkey">' +
    sessions
      .map((session) => {
        const count = tally.get(session.index) || 0;
        return '<button class="fll-chip' + (lensState.filter.session === session.index ? ' on' : '') +
          (count ? '' : ' dim') + '" data-act="setSession" data-value="' + session.index +
          '" title="Bắt đầu ' + formatClock(session.startTs) + '">Phiên ' + session.index +
          ' <em>' + count + '</em></button>';
      })
      .join('') +
    '<button class="fll-chip' + (lensState.filter.session ? '' : ' on') +
    '" data-act="setSession" data-value="0">Tất cả</button></div>';
}

function renderCorrelationList() {
  const buckets = lensState.data.correlations;
  if (!buckets.length) return '';
  return '<div class="fll-sec">Gom theo ID</div>' +
    '<div class="fll-hint" style="margin-bottom:8px">Một ID xuất hiện ở nhiều dòng là một request đi qua ' +
    'nhiều lớp. Bấm để xem trọn chuỗi.</div><div class="fll-rank">' +
    buckets.slice(0, 12)
      .map((bucket) => '<div class="fll-rk" data-act="correlate" data-value="' + escapeHtml(bucket.value) + '">' +
        '<u style="width:' + ((bucket.indices.length / buckets[0].indices.length) * 100).toFixed(1) + '%"></u>' +
        '<span>' + escapeHtml(bucket.key) + ' · ' + escapeHtml(bucket.value.slice(-16)) + '</span>' +
        '<b>' + bucket.indices.length + '</b></div>')
      .join('') + '</div>';
}

// Mau bo loc dung chung dinh dang voi permalink, chi khac la nam trong localStorage
// va khong keo theo tab/dong dang dung — nhung thu do vo nghia o feedback khac.
function renderTemplateSection() {
  const templates = lensState.filterTemplates;
  const canSave = hasAnyFilterFacet();
  const suggestion = suggestTemplateName();

  const chips = templates.length
    ? '<div class="fll-lvkey" style="margin-bottom:8px">' + templates
      .map((template) => '<span class="fll-fchip fll-tpl" title="' +
        escapeHtml(describeTemplatePayload(template.payload)) + '">' +
        '<b data-act="applyTemplate" data-value="' + escapeHtml(template.name) + '">' +
        escapeHtml(template.name) + '</b>' +
        '<button data-act="deleteTemplate" data-value="' + escapeHtml(template.name) +
        '" title="Xoá mẫu">&times;</button></span>')
      .join('') + '</div>'
    : '<div class="fll-hint" style="margin-bottom:8px">Chưa có mẫu nào. Đặt điều kiện rồi lưu lại ' +
      'để lần sau áp một phát.</div>';

  return '<div class="fll-sec">Mẫu bộ lọc</div>' + chips +
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
  // Chip dem kieu faceted: bo qua chinh dieu kien cua no, neu khong thi chon ERROR xong
  // chip WARNING ve 0 va khong con duong noi rong lai.
  const levelTally = tallyFacetCandidates('levels', (entry) => entry.level);

  return renderTemplateSection() +
    '<div class="fll-sec">Cửa sổ thời gian</div>' + renderWindowChips(true) +
    renderSessionChips() +

    '<div class="fll-sec">Mức độ</div>' +
    '<div class="fll-lvkey">' + LEVEL_ORDER
      .map((level) => '<button class="fll-chip' + (filter.levels.has(level) ? ' on' : '') +
        '" data-act="tglLevel" data-value="' + level + '">' +
        '<i class="fll-sw" style="background:' + LEVEL_COLOR[level] + '"></i>' + level +
        ' <em>' + (levelTally.get(level) || 0) + '</em></button>')
      .join('') + '</div>' +

    '<div class="fll-sec">Module' + (filter.modules.size ? ' · đã chọn ' + filter.modules.size : '') + '</div>' +
    '<input class="fll-in" id="fll-modq" placeholder="Tìm module..." value="' +
    escapeHtml(tabUiState.moduleQuery) + '" style="margin-bottom:7px">' +
    '<div class="fll-lvkey" id="fll-mod-list" style="max-height:150px;overflow-y:auto">' +
    renderModuleChips() + '</div>' +

    '<div class="fll-sec">Tìm trong nội dung</div>' +
    '<input class="fll-in' + (result.isBadPattern ? ' bad' : '') + '" id="fll-re" placeholder="' +
    (filter.useRegex ? 'Regex, ví dụ: timeout|retry|88\\d{7}' : 'Chuỗi con...') + '" value="' +
    escapeHtml(filter.text) + '">' +
    '<div class="fll-row" style="margin-top:7px">' +
    '<button class="fll-chip' + (filter.useRegex ? ' on' : '') + '" data-act="tglRegex">Regex</button>' +
    '<button class="fll-chip' + (filter.hideOthers ? ' on' : '') +
    '" data-act="tglHide">Ẩn dòng không khớp</button></div>' +
    (result.isBadPattern ? '<div class="fll-hint" style="color:var(--err)">Regex không hợp lệ.</div>' : '') +

    renderCorrelationList() +

    '<div class="fll-sec">Kết quả</div>' +
    '<div class="fll-hint" style="margin-bottom:10px">Đang hiện <b id="fll-count" style="color:var(--txt)">' +
    result.visible.length + '</b> / ' + data.entries.length + ' dòng.</div>' +
    '<div class="fll-row">' +
    '<button class="fll-btn pri" data-act="applyFilter">Duyệt kết quả</button>' +
    '<button class="fll-btn" data-act="copyVisible">Copy dòng đang hiện</button>' +
    '<button class="fll-btn" data-act="copyLink">Copy link</button>' +
    '<button class="fll-btn" data-act="resetFilter">Xoá lọc</button></div>';
}

/* ---------------------------------------------------------------- Diễn biến */

// Truoc day day la tab "Timeline" chi co 3 loai moc cua APP (khoi dong / khoang lang / nhom loi):
// 29 moc, tab mong nhat trong ca panel. Buoc tuong tac cua user tung nam o mot tab rieng — nhung ca hai
// deu la "sap theo timestamp that roi ve .fll-tl", tuc cung mot thu voi hai nguon khac nhau, va phai
// nhay qua lai giua hai tab moi ghep duoc cau "user bam gi -> app dung im -> loi gi". Tron lam mot.
const TIMELINE_GROUPS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'app', label: 'App' },
  { id: 'screen', label: 'Màn hình' },
  { id: 'tap', label: 'Chạm' },
  { id: 'saw', label: 'User thấy' },
  { id: 'fail', label: 'API fail' },
];

function buildTimelineEvents(data) {
  const events = [];

  data.scopedEntries.forEach((entry) => {
    if (RE_SESSION.test(entry.message)) {
      events.push({ ts: entry.ts, group: 'app', kind: 'boot', title: 'App khởi động — phiên ' + entry.session,
        detail: entry.message, index: entry.domIndex });
    }
  });

  data.gaps.forEach((gap) => {
    events.push({ ts: gap.before.ts, group: 'app', kind: 'gap', title: 'Khoảng lặng ' + formatDuration(gap.ms),
      detail: 'dừng sau: ' + gap.before.message.slice(0, 90), index: gap.after.domIndex });
  });

  data.groups.filter((group) => group.level === 'ERROR' && !isGroupMuted(group)).forEach((group) => {
    events.push({ ts: group.firstTs, group: 'app', kind: 'err',
      title: group.indices.length + '× ' + (group.module || 'ERROR'),
      detail: group.sample.slice(0, 90), index: group.indices[0] });
  });

  // "Doi luong" (feature_source) di chung nhom voi man hinh: no cung la chuyen dich chuyen, va tach
  // ra thanh chip thu bay thi hang chip bat dau cuon ngang.
  data.journey.steps.forEach((step) => {
    events.push({ ts: step.ts, group: step.kind === 'move' ? 'screen' : step.kind, kind: 'jr-' + step.kind,
      title: step.label, detail: [step.detail, step.note].filter(Boolean).join(' · '),
      index: step.domIndex, count: step.count, ms: step.ms });
  });

  return events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

function renderTimelineTab() {
  const data = getView();
  const all = buildTimelineEvents(data);
  const events = tabUiState.tlGroup === 'all'
    ? all
    : all.filter((event) => event.group === tabUiState.tlGroup);

  const counts = {};
  TIMELINE_GROUPS.forEach((choice) => {
    counts[choice.id] = choice.id === 'all' ? all.length : all.filter((e) => e.group === choice.id).length;
  });

  let header = '<div class="fll-row" style="margin-bottom:9px">' + TIMELINE_GROUPS
    .filter((choice) => counts[choice.id])
    .map((choice) => '<button class="fll-chip' + (tabUiState.tlGroup === choice.id ? ' on' : '') +
      '" data-act="tlGroup" data-value="' + choice.id + '">' + choice.label +
      ' <em>' + counts[choice.id] + '</em></button>')
    .join('') + '</div>';

  // Chip nguong khoang lang chi co nghia khi moc App dang hien.
  if (tabUiState.tlGroup === 'all' || tabUiState.tlGroup === 'app') {
    header += '<div class="fll-row" style="margin-bottom:9px">' +
      [1000, 2000, 5000, 10000]
        .map((ms) => '<button class="fll-chip' + (lensState.gapThresholdMs === ms ? ' on' : '') +
          '" data-act="setGap" data-value="' + ms + '">lặng &ge; ' + ms / 1000 + 's</button>')
        .join('') + '</div>';
  }

  header += '<div class="fll-hint" style="margin:0 0 10px">' + data.sessionCount + ' phiên app · ' +
    data.gaps.length + ' khoảng lặng · ' + countUnmutedErrorGroups(data) + ' nhóm lỗi · ' +
    data.journey.steps.length + ' bước tương tác. Đã sắp theo thời gian thật, không theo thứ tự dòng. ' +
    'Bước tương tác đọc từ event <b>MoMoTracker</b> (mức INFO) — log ghi lặp nên các bước giống hệt ' +
    'nhau cách nhau dưới 1s đã gộp thành <b>N&times;</b>, bấm vào vẫn duyệt đủ từng dòng.' +
    (data !== lensState.data
      ? ' <b>Khoảng lặng chỉ cắt theo cửa sổ thời gian</b> — lọc theo mức độ hay module không đổi nó, ' +
        'vì khoảng lặng là tính chất của đường thời gian chứ không phải của tập dòng.'
      : '') + '</div>';

  if (!events.length) return header + '<div class="fll-empty">Không có mốc nào đáng chú ý.</div>';

  const shown = events.slice(0, tabUiState.tlLimit);
  return header + '<div class="fll-tl">' + shown
    .map((event) => '<div class="fll-ev ' + event.kind + '" data-jump="' + event.index + '">' +
      '<div class="fll-ev-t">' +
      (event.count > 1 ? '<span class="fll-jn">' + event.count + '&times;</span>' : '') +
      escapeHtml(event.title) +
      (event.ms >= 1000 ? '<span class="fll-jms">' + formatDuration(event.ms) + '</span>' : '') +
      '<em>' + formatClock(event.ts) + '</em></div>' +
      (event.detail ? '<div class="fll-ev-d">' + escapeHtml(event.detail) + '</div>' : '') +
      '</div>')
    .join('') + '</div>' +
    (events.length > shown.length
      ? '<button class="fll-btn" style="width:100%;margin-top:8px" data-act="moreTimeline">Hiện thêm — còn ' +
        (events.length - shown.length) + ' mốc</button>'
      : '');
}
// AI-GENERATED END
/*
File: src/05-boot.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// AI-GENERATED START — gan panel vao trang, dieu phoi tab, uy quyen su kien, tu quet lai khi doi tab log

const ROOT_ID = 'fll-root';
const TAB_DEFS = [
  { id: 'sum', label: 'Tổng quan' },
  { id: 'iss', label: 'Vấn đề', badge: countUnmutedErrorGroups, danger: true },
  { id: 'http', label: 'HTTP', badge: (data) => data.httpCalls.length },
  { id: 'slow', label: 'Chậm' },
  { id: 'flt', label: 'Lọc', badge: () => getActiveFilterFacets().length || null, tone: 'act' },
  { id: 'tl', label: 'Diễn biến' },
];

// Chay lai ca file (reload extension khi tab dang mo) = sinh mot the he closure moi.
// The he cu van con listener keydown tren document va interval dang chay: no se bat phim
// roi thao tac len panel cua the he moi. Vi vay moi lan khoi dong phai don the he truoc qua bien global nay.
const LENS_GLOBAL_KEY = '__feedbackLogLens';

// Con duong don qua window[LENS_GLOBAL_KEY] chi hoat dong khi hai the he dung chung mot window.
// Moc thu hai nay di qua DOM nen khong phu thuoc dieu do: instance nao khoi dong sau se ghi ten minh
// len the html; instance cu doc thay ten khac thi tu rut lui, neu khong luoi an toan "root bi go thi
// gan lai" cua no se dung dai root cu ve moi 2 giay.
// CHUA XAC MINH: co truong hop nao con lai khien hai the he KHONG chung window hay khong. Moc nay ra doi
// tu thoi con ban bookmarklet chay o page world; ban bookmarklet da bo, nhung chua kiem duoc reload
// extension luc tab dang mo thi the he cu nam o dau, nen giu lai.
const LENS_OWNER_ATTR = 'data-fll-owner';
const lensInstanceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function claimLensOwnership() {
  document.documentElement.setAttribute(LENS_OWNER_ATTR, lensInstanceId);
}

function isLensOwner() {
  return document.documentElement.getAttribute(LENS_OWNER_ATTR) === lensInstanceId;
}

// WebAdmin la SPA React: bam tu danh sach sang feedback detail KHONG tai lai tai lieu,
// nen content script (chay o document_idle) khong bao gio chay lai. Ban dau dung waitForLogRows
// poll 30 giay roi bo cuoc — ngoi o trang danh sach lau hon the la mat luon co hoi gan.
// Thay bang mot watcher thuong tru: gan khi bang log xuat hien, thao khi roi khoi trang detail.
const PAGE_WATCH_INTERVAL_MS = 1000;
// O loc noi dung cho lau hon vi no keo theo ca luot quet 4085 dong; hai o kia chi ve lai mot manh.
const FILTER_INPUT_DEBOUNCE_MS = 180;
const LIST_INPUT_DEBOUNCE_MS = 120;

let pageWatcher = null;
let lastRowCount = 0;
// Moi o tim mot timer rieng: dung chung mot bien thi go o nay se huy mat cap nhat dang cho cua o kia.
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

// Phai go dung root CUA CHINH instance nay, khong duoc lay getElementById: khi mot instance khac
// da tiep quan thi id do dang tro toi panel cua no.
// shouldRestorePage=false khi minh rut lui vi nguoi khac tiep quan — luc ay class loc tren bang log
// la cua chu moi, dung dong vao.
function disposeSelf(shouldRestorePage) {
  window.removeEventListener('keydown', handleShortcut, LENS_KEY_LISTENER_OPTIONS);
  if (pageWatcher) clearInterval(pageWatcher);
  pageWatcher = null;
  // Timer con treo se chay tren panel da bi go, phai don.
  clearInputTimers();
  if (lensState.el.root) lensState.el.root.remove();
  if (shouldRestorePage) {
    document.querySelectorAll('.fll-filtering, .fll-hit')
      .forEach((el) => el.classList.remove('fll-filtering', 'fll-hit'));
  }
}

function registerInstance() {
  window[LENS_GLOBAL_KEY] = { dispose: function dispose() { disposeSelf(true); } };
}

function scanLog() {
  const data = attachInsights(analyzeLog(lensState.gapThresholdMs));
  data.gapThresholdLabel = lensState.gapThresholdMs / 1000 + 's';
  lensState.data = data;
  lensState.view = data;
  // Ket qua loc cu tro toi mang entries cu (va DOM cu), phai bo di de lan ve tab sau tinh lai.
  lensState.lastFilterResult = null;
  lensState.forcedVisibleIndices.clear();
  lensState.el.lastHit = null;
  lensState.isFiltering = false;
  lensState.visibleCount = data.entries.length;
  return data;
}

function renderTab() {
  const body = lensState.el.body;
  if (!body) return;
  if (lensState.tab === 'sum') body.innerHTML = renderSummaryTab();
  else if (lensState.tab === 'iss') body.innerHTML = renderIssuesTab();
  else if (lensState.tab === 'http') body.innerHTML = renderHttpTab();
  else if (lensState.tab === 'slow') body.innerHTML = renderSlowTab();
  else if (lensState.tab === 'flt') body.innerHTML = renderFilterTab();
  else body.innerHTML = renderTimelineTab();
  body.scrollTop = 0;
  renderTabBar();
  refreshFilterBar();
}

// Go trong o tim thi moi con so trong tab deu doi theo (chip dem faceted, danh sach ID, trang thai
// nut luu mau). Truoc day khong ve lai vi so mat con tro — nhung nhu the ca tab dung yen o trang thai cu,
// nguoi dung thay "1 bo loc dang bat" ma phan Mau bo loc van bao chua co dieu kien nao.
// Ve lai het roi tra lai tieu diem + vi tri con tro + vi tri cuon.
function renderTabPreservingFocus() {
  const body = lensState.el.body;
  const active = document.activeElement;
  const activeId = active && active.id;
  const hasSelection = active && typeof active.selectionStart === 'number';
  const selectionStart = hasSelection ? active.selectionStart : null;
  const selectionEnd = hasSelection ? active.selectionEnd : null;
  const scrollTop = body ? body.scrollTop : 0;

  renderTab();

  if (body) body.scrollTop = scrollTop;
  if (!activeId) return;
  const restored = document.getElementById(activeId);
  if (!restored) return;
  restored.focus();
  if (selectionStart !== null && typeof restored.setSelectionRange === 'function') {
    restored.setSelectionRange(selectionStart, selectionEnd);
  }
}

function renderTabBar() {
  lensState.el.tabs.innerHTML = TAB_DEFS
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
  lensState.el.sub.textContent = data.entries.length + ' dòng · ' + data.sessionCount + ' phiên · ' +
    data.levels.ERROR + ' lỗi · ' + data.gaps.length + ' khoảng lặng';
}

// Dem con cua container (O(1)) thay vi querySelectorAll ca tai lieu 8000+ node moi 2 giay.
// PHAI dung dung ham nay cho ca gia tri khoi tao lan moi lan kiem: container con 2 div dem
// ngoai cac dong log (4087 vs 4085), lay hai nguon khac nhau la tick dau tien se rescan oan
// va xoa sach trang thai loc trong khi DOM van dang bi loc.
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
  // Bang log vua duoc dung lai: ap lai bo loc dang bat de DOM va state khong lech nhau.
  applyFilter(false);
  renderTab();
}

// Co y KHONG go listener phim va KHONG dung pageWatcher: chung la duong de Alt+L mo lai
// ma khong phai reload trang. Co isDismissed nen watcher se khong tu gan lai tren feedback nay.
function closeLens() {
  const root = document.getElementById(ROOT_ID);
  if (root) root.remove();
  document.querySelectorAll('.fll-filtering, .fll-hit')
    .forEach((el) => el.classList.remove('fll-filtering', 'fll-hit'));
  lensState.el.root = null;
  lensState.el.panel = null;
  lensState.data = null;
  lensState.isDismissed = true;
}

// Roi khoi trang detail (SPA doi route): thao panel nhung giu watcher va phim tat,
// de vao feedback khac la gan lai. Bo loc dat cho feedback cu phai xoa — giu lai la du lieu
// feedback moi hien ra thieu ma nguoi dung khong biet. Rieng danh sach tat tieng thi giu.
function detachLens() {
  clearInputTimers();
  if (lensState.el.root) lensState.el.root.remove();
  // Tra bang log ve nguyen trang TRUOC khi bo data: SPA co the dung lai chinh container do cho feedback
  // ke tiep. Con sot .fll-filtering/.fll-keep thi feedback moi chi hien vai chuc dong trong khi panel
  // bao "khong co bo loc nao" — dung kieu sai ma nguoi dung khong biet.
  setLogFilteringMode(false);
  document.querySelectorAll('.fll-keep, .fll-hit')
    .forEach((el) => el.classList.remove('fll-keep', 'fll-hit'));
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
  lensState.filter.session = null;
  lensState.isDismissed = false;
  lastRowCount = 0;
}

function tickPageWatcher() {
  if (!lensState.data || !lensState.el.root) {
    if (!lensState.isDismissed && hasLogRows()) startLens(!lensState.wasPanelOpen);
    return;
  }
  // Mot instance moi hon da tiep quan: rut lui han.
  if (!isLensOwner()) {
    disposeSelf(false);
    return;
  }
  if (!hasLogRows()) {
    detachLens();
    return;
  }
  // Luoi an toan: trang admin tung go #fll-root khoi body khi xu ly phim. Neu bi go thi gan lai.
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
  const data = lensState.data;
  const facetCount = getActiveFilterFacets().length;
  lensState.wasPanelOpen = false;
  root.innerHTML = '<style>' + PANEL_CSS + '</style>' +
    '<div class="fll-pill" data-act="open"><span style="color:var(--acc)">◆</span> Log Lens · <b>' +
    countUnmutedErrorGroups(getView()) + '</b> nhóm lỗi · ' + getView().gaps.length + ' khoảng lặng' +
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
    '<button class="fll-ico" data-act="rescan" title="Quét lại (khi đổi tab log)">⟳</button>' +
    '<button class="fll-ico" data-act="minimize" title="Thu nhỏ (Esc)">–</button>' +
    '<button class="fll-ico" data-act="close" title="Đóng hẳn — Alt+L để mở lại">×</button></header>' +
    '<nav class="fll-tabs"></nav>' +
    '<div class="fll-bar" hidden></div>' +
    '<div class="fll-map" title="Bấm để nhảy tới mốc đó. Kéo để chọn khoảng thời gian; ' +
    'kéo giữa vùng sáng để dời, kéo mép để co giãn, nháy đúp để bỏ chọn."></div>' +
    '<div class="fll-maplbl"></div>' +
    '<div class="fll-body"></div>' +
    '<footer class="fll-ft">' +
    '<button class="fll-ico" data-act="prev" title="Trước (p)">◀</button>' +
    '<div class="fll-info"></div>' +
    '<button class="fll-ico" data-act="next" title="Sau (n)">▶</button></footer>' +
    '<div class="fll-corner" title="Kéo để đổi cả chiều rộng và chiều cao"></div></div>';

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

  applyPanelGeometry(panel);
  enableDragAndResize(panel, root.querySelector('.fll-hd'), root.querySelector('.fll-grip'),
    root.querySelector('.fll-corner'));
  renderMinimap();
  refreshHeader();
  renderTab();
  renderFooter();
}

/* ---------------------------------------------------------- uy quyen click */

function handleLensClick(event) {
  const hit = event.target.closest('[data-act],[data-tab],[data-jump],[data-group],[data-module],' +
    '[data-level],[data-call],[data-bucket],[data-event],[data-saw],[data-apifail],' +
    '[data-jscreen],[data-jtap],[data-tracefail]');
  if (!hit) return;
  // groups/httpCalls doc theo view (dang loc thi la cua tap dang hien, dung nhu tab vua ve);
  // correlations van lay tu data vi chuoi mot request phai xem tron ven.
  const data = lensState.data;
  const view = getView();
  const value = hit.getAttribute('data-value');

  if (hit.dataset.tab) return switchTab(hit.dataset.tab);
  if (hit.dataset.jump) return jumpToIndex(Number(hit.dataset.jump));
  if (hit.dataset.bucket) {
    // Vua keo chon khoang xong: cu click di kem mouseup khong duoc bien thanh lenh nhay dong.
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
    switchTab('flt');
    return applyFilter(true);
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
    switchTab('flt');
    return applyFilter(true);
  }
  if (action === 'mute') {
    const group = view.groups[Number(value)];
    if (group) toggleMutedSignature(group.key);
    return renderTab();
  }
  if (action === 'toggleMutedView') {
    lensState.isShowingMuted = !lensState.isShowingMuted;
    return renderTab();
  }
  if (action === 'moreIssues') {
    tabUiState.issueLimit += ISSUE_PAGE_SIZE;
    const list = document.getElementById('fll-issue-list');
    if (list) list.innerHTML = renderIssueList();
    return undefined;
  }
  if (action === 'rescan') return rescan();
  if (action === 'minimize') return showPill();
  if (action === 'open') return mountPanel();
  if (action === 'prev') return moveMatch(-1);
  if (action === 'next') return moveMatch(1);
  if (action === 'gotoIssues') return switchTab('iss');
  if (action === 'gotoHttp') return switchTab('http');
  if (action === 'gotoTimeline') return switchTab('tl');
  if (action === 'issueLevel') {
    tabUiState.issueLevel = value;
    return renderTab();
  }
  if (action === 'tlGroup') {
    // Bam lai dung nhom dang chon = bo chon, quay ve xem tat ca.
    tabUiState.tlGroup = tabUiState.tlGroup === value ? 'all' : value;
    tabUiState.tlLimit = TIMELINE_PAGE_SIZE;
    return renderTab();
  }
  if (action === 'moreTimeline') {
    tabUiState.tlLimit += TIMELINE_PAGE_SIZE;
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
  if (action === 'copyVisible') return copyVisibleLines(hit);
  return undefined;
}

function toggleSetValue(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function copyTextToClipboard(text, button, doneLabel) {
  navigator.clipboard.writeText(text).then(() => {
    const original = button.textContent;
    button.textContent = doneLabel;
    setTimeout(() => {
      button.textContent = original;
    }, 1600);
  });
}

function copyVisibleLines(button) {
  const text = lensState.data.entries
    .filter((entry) => entry.el && isRowVisible(entry))
    .map((entry) => entry.raw)
    .join('\n');
  copyTextToClipboard(text, button, 'Đã copy ' + text.split('\n').length + ' dòng');
}

/* ----------------------------------------------------- uy quyen go phim */

function handleLensInput(event) {
  const target = event.target;
  // Ve lai toi 50 the nhom, moi the mot sparkline 26 cot — do duoc 2 khung hinh roi neu chay moi phim.
  if (target.id === 'fll-q') {
    tabUiState.issueQuery = target.value;
    debounceInput('issueQuery', LIST_INPUT_DEBOUNCE_MS, () => {
      const list = document.getElementById('fll-issue-list');
      if (list) list.innerHTML = renderIssueList();
    });
    return;
  }
  // Giu ten mau nguoi dung dang go: sua bo loc se ve lai tab, khong giu thi ten bay mat.
  if (target.id === 'fll-tplname') {
    tabUiState.templateName = target.value;
    return;
  }
  // Quet ca payload cua moi request nen nang hon o tim nhom; van chi ve lai danh sach HTTP.
  if (target.id === 'fll-httpq') {
    tabUiState.httpQuery = target.value;
    debounceInput('httpQuery', LIST_INPUT_DEBOUNCE_MS, () => {
      const list = document.getElementById('fll-http-list');
      if (list) list.innerHTML = renderHttpList();
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
  // Duong nang nhat: quet 4085 dong, ghi class len bang log roi ve lai ca tab. De cho lau hon.
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
  // Nhan quyen TRUOC khi don: neu don xong moi nhan, nhip watcher cua instance cu cham vao dung khe ho
  // do se tuong root cua no bi go oan va dung lai ngay.
  claimLensOwnership();
  disposePreviousInstance();
  registerInstance();

  const root = document.createElement('div');
  root.id = ROOT_ID;
  document.body.appendChild(root);
  lensState.el.root = root;
  lensState.mutedSignatures = loadMutedSignatures();
  lensState.filterTemplates = loadFilterTemplates();

  scanLog();
  // Mo bang link chia se thi luon bung panel, ke ca khi dang chay duoi dang extension (mac dinh thu gon):
  // nguoi nhan link chi thay mot cai pill trong khi bang log da bi loc se tuong la khong co gi xay ra.
  const isRestoredFromLink = applyPermalinkFromHash();
  if (startMinimized && !isRestoredFromLink) showPill();
  else mountPanel();

  root.addEventListener('click', handleLensClick);
  root.addEventListener('input', handleLensInput);
  window.addEventListener('keydown', handleShortcut, LENS_KEY_LISTENER_OPTIONS);

  lensState.isDismissed = false;
  lastRowCount = countLogRows();
  startPageWatcher();
}

if (hasLogRows()) startLens(false);
// Chay ca khi chua gan duoc: dieu huong trong SPA khong tai lai tai lieu, watcher nay la thu duy nhat
// biet duoc "vua vao mot feedback detail moi".
startPageWatcher();
// AI-GENERATED END
})();
