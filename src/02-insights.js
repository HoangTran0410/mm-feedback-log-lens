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

/* ------------------------------------------- nhieu tu chinh he thong do luong */

// Do tren 50 feedback PRODUCTION that (25 iOS, 25 Android, ngay 2026-09-10): 2488 dong ERROR, trong do
// 1267 dong (51%) khong phai loi user gap ma la loi cua chinh lop do luong. 24/49 log co qua nua so
// dong ERROR la loai nay. Chung deu ghi bang logger.e truc tiep nen KHONG bi cat boi co Debug Tool —
// tuc chung co mat tren may user that, khac han cac dong "@@ grafana >>" khac.
//
// Khong tu dong tat tieng: do la quyet dinh cua nguoi doc. Chi tach ra mot khoi rieng de danh sach
// van de con lai la nhung thu dang doc.
const TELEMETRY_NOISE_PATTERNS = [
  // withTraceId() lam buffer.remove() nen traceId chi dung duoc mot lan; goi stop lan hai la mat.
  { re: /GrafanaTrace\.\w+:: no traceId/, label: 'GrafanaTrace mất traceId' },
  // resolveFormatter() tra null khi Koin scope da dong.
  { re: /GrafanaTrace\.\w+ PaymentSession is null/, label: 'GrafanaTrace không có PaymentSession' },
  { re: /GrafanaTrace\.exceptionHandler/, label: 'GrafanaTrace nuốt exception' },
  // Hang doi gui trace cua chinh Grafana bi loi.
  { re: /grafana >> DefaultRequestQueue >> handleError/, label: 'Hàng đợi gửi trace Grafana lỗi' },
];

function telemetryNoiseLabel(text) {
  for (let i = 0; i < TELEMETRY_NOISE_PATTERNS.length; i += 1) {
    if (TELEMETRY_NOISE_PATTERNS[i].re.test(text)) return TELEMETRY_NOISE_PATTERNS[i].label;
  }
  return '';
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

  // Phan biet hai chuyen khac han nhau:
  // - gated: cac dong "@@ grafana >>" di qua GrafanaTracker.log(), bi cat boi co Debug Tool.
  //   Do tren 50 feedback production that: chi 2/50 log (4%) co startTrace/traceFail.
  // - available: co bat ky dong trace nao khong. Mot so dong ("generateOffsetBase", handleError)
  //   ghi thang bang logger nen KHONG bi cat — 68% log production co chung. Neu chi nhin
  //   available thi se tuong log nao cung co du lieu trace, trong khi thuc te gan nhu khong log nao co.
  return { available: lineCount > 0, hasGated: counts.startTrace + counts.traceSuccess + counts.traceFail > 0,
    lineCount, counts, fails };
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
