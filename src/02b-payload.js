/*
File: src/02b-payload.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — tach khoi JSON trong dong log, va lop k=v dung chung cho ca tracker lan Grafana
// Tach ra tu src/02-insights.js (946 dong). Cac file src/*.js duoc build.sh noi lai theo thu tu
// ten file va boc trong MOT IIFE nen van dung chung scope — tach chi de doc.

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
  // Gan trong closure markSafe() ben duoi nen phai noi ro kieu: neu de tu suy tu `null`
  // thi TypeScript thu hep con `never` va bao loi o cho doc lai.
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
// AI-GENERATED END
