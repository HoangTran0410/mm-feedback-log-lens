/*
File: src/04-tabs.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — noi dung 6 tab: Tong quan, Van de, HTTP, Cham, Loc, Dien bien

// Dung log that co 262 nhom sau khi gom; ve het mot luot la mot chuoi HTML rat lon va phai
// dung lai moi lan go phim trong o tim. Ve theo lo, con lai bam "Hien them".
const ISSUE_PAGE_SIZE = 50;

const TIMELINE_PAGE_SIZE = 80;

const tabUiState = { issueLevel: 'all', issueQuery: '', httpOnlyBad: false, httpQuery: '', moduleQuery: '',
  issueLimit: ISSUE_PAGE_SIZE, templateName: '', tlGroup: 'all', tlLimit: TIMELINE_PAGE_SIZE, showNoise: false };

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
    // Nhieu do luong co khoi rieng ben duoi, khong tron vao day.
    if (group.noiseLabel) return false;
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
    if (group.noiseLabel) return;
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
    '<div id="fll-issue-list">' + renderIssueList() + '</div>' +
    renderTelemetryNoiseSection(data);
}

// Do tren 50 feedback PRODUCTION that: 1267/2488 dong ERROR (51%) khong phai loi user gap ma la loi
// cua chinh lop do luong, va 24/49 log co qua nua so dong ERROR la loai nay. De chung lan trong danh
// sach thi nguoi doc mat mot nua thoi gian vao thu khong lien quan.
// Tach ra chu KHONG tu dong tat tieng: tat tieng la quyet dinh cua nguoi doc, va doi khi chinh lop
// do luong hong lai la manh moi.
function renderTelemetryNoiseSection(data) {
  const noise = data.groups.filter((group) => group.noiseLabel);
  if (!noise.length) return '';

  const lineCount = noise.reduce((sum, group) => sum + group.indices.length, 0);
  const byLabel = new Map();
  noise.forEach((group) => {
    byLabel.set(group.noiseLabel, (byLabel.get(group.noiseLabel) || 0) + group.indices.length);
  });
  const breakdown = Array.from(byLabel, (pair) => pair[0] + ' <b>' + pair[1] + '</b>')
    .sort()
    .join(' · ');

  return '<div class="fll-sec">Nhiễu từ hệ thống đo lường</div>' +
    '<div class="fll-note" style="background:rgba(88,196,255,.08);border-color:rgba(88,196,255,.28);' +
    'color:#bfe4ff"><span>&#9432;</span><div>' +
    '<b>' + lineCount + ' dòng</b> trong ' + noise.length + ' nhóm là lỗi của <b>chính lớp đo lường</b>, ' +
    'không phải lỗi user gặp — đã tách khỏi danh sách trên.<br>' +
    '<span style="opacity:.75">' + breakdown + '</span></div></div>' +
    '<button class="fll-btn" style="width:100%" data-act="toggleNoise">' +
    (tabUiState.showNoise ? 'Ẩn lại' : 'Vẫn muốn xem ' + noise.length + ' nhóm này') + '</button>' +
    (tabUiState.showNoise
      ? '<div style="margin-top:8px">' +
        noise.map((group) => renderGroupCard(group, data.groups.indexOf(group))).join('') + '</div>'
      : '');
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

// Khac han muc "O lau nhat tren man": day la thoi gian TAI man, so co san trong log chu khong phai
// so tinh ra. Dat truoc vi no tra loi thang cau "man nao tai lau", con bang duoi la moi con so tho.
function renderScreenLoadSection(view) {
  const rows = view.journey.screenLoads;
  if (!rows.length) return '';
  const peak = rows[0].worstMs;
  return '<div class="fll-sec">Màn tải lâu nhất</div>' +
    '<div class="fll-hint" style="margin-bottom:8px">Số <b>có sẵn trong log</b> — trường ' +
    '<code>duration</code> của <code>auto_screen_displayed</code> (lúc <code>state=load</code>) và ' +
    '<code>auto_load_progress_tracked</code>. Hiện lần chậm nhất; ngoặc là số lần đo và trung bình.</div>' +
    '<div class="fll-rank">' + rows.slice(0, 8)
      .map((row) => {
        const color = row.worstMs >= 3000 ? LEVEL_COLOR.ERROR
          : row.worstMs >= 1000 ? LEVEL_COLOR.WARNING : LEVEL_COLOR.INFO;
        return '<div class="fll-rk" data-jload="' + escapeHtml(row.key) + '">' +
          '<u style="width:' + ((row.worstMs / peak) * 100).toFixed(1) + '%;background:' + color + '22"></u>' +
          '<span>' + escapeHtml(row.key) + '</span>' +
          '<b style="color:' + color + '">' + formatDuration(row.worstMs) + '</b>' +
          '<b>' + row.count + '× · tb ' + formatDuration(row.avgMs) + '</b></div>';
      })
      .join('') + '</div>';
}

function renderSlowTab() {
  const view = getView();
  const rows = view.durations;
  const header = renderScreenLoadSection(view) + renderScreenDwellSection(view) +
    '<div class="fll-sec">Mọi con số thời lượng</div>' + '<div class="fll-hint" style="margin-bottom:10px">Mọi con số thời lượng rút được từ log ' +
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
