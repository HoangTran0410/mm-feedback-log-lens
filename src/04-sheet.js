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
