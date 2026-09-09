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
