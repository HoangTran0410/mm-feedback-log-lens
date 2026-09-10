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
