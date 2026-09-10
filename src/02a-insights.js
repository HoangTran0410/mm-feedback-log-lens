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
