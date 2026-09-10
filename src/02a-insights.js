/*
File: src/02a-insights.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// AI-GENERATED START — thoi luong, ID lien ket, phien app, metadata feedback
// Tach ra tu src/02-insights.js (946 dong). Cac file src/*.js duoc build.sh noi lai theo thu tu
// ten file va boc trong MOT IIFE nen van dung chung scope — tach chi de doc.

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
// AI-GENERATED END
