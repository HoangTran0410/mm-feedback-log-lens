// @ts-check
// permalink qua hash URL và mẫu bộ lọc lưu sẵn
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

/* --------------------------------------------------- permalink qua hash URL */

// Một định nghĩa duy nhất cho cả permalink lẫn mẫu bộ lọc.
// Khoảng thời gian kết thúc đúng ở lastTs được lưu dạng "N cuối" chứ không phải mốc tuyệt đối:
// như thế mẫu "2 phút cuối" còn dùng được ở feedback khác, còn mốc tuyệt đối thì vô nghĩa.
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
  // Thiếu chỗ này thì: mẫu bộ lọc lưu xong mô tả là "không có điều kiện nào" và bấm vào không làm gì,
  // còn permalink gửi cho đồng nghiệp sẽ hiện số gấp đôi mà không có dấu hiệu gì.
  if (filter.skipDuplicate) payload.d = 1;
  // Chip "Ẩn dòng không khớp" tắt được, mà bật/tắt nó là hai bức tranh khác hẳn nhau: cùng một bộ điều
  // kiện, một bên bảng log còn nguyên, một bên bị xén còn vài chục dòng. Vắng khoá này = bật (mặc định),
  // nên link cũ vẫn đọc đúng.
  if (!filter.hideOthers) payload.h = 0;
  if (filter.timeFrom !== null || filter.timeTo !== null) {
    // Preset gửi đi dưới dạng "N cuối" để người nhận tính lại trên log của họ, không gửi hai mốc tuyệt đối.
    // Chỉ đổi khi ĐANG thật sự là preset: khoảng kéo tay mà kết thúc gần cuối log từng bị đoán thành
    // preset, làm người nhận thấy nhãn "39.5 giây cuối" trong khi người gửi thấy hai mốc giờ — và tệ hơn,
    // windowPreset khác null thì retargetTimeWindow() sẽ TỰ tính lại cửa sổ khi sang log khác. Kéo tay
    // thì không đoán được ý người dùng, đúng như luật ở retargetTimeWindow.
    if (filter.windowPreset) payload.wLast = filter.windowPreset;
    else {
      payload.f = (filter.timeFrom !== null ? filter.timeFrom : data.firstTs) - data.firstTs;
      payload.tt = (filter.timeTo !== null ? filter.timeTo : data.lastTs) - data.firstTs;
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
  // Phải đặt lại CẢ khi payload không có: áp một mẫu không có điều kiện này mà vẫn giữ cờ đang bật thì
  // kết quả khác hẳn mô tả của mẫu.
  filter.skipDuplicate = payload.d === 1;
  filter.timeFrom = null;
  filter.timeTo = null;
  filter.windowPreset = null;
  filter.hideOthers = payload.h !== 0;
  // payload.w là dạng cũ của permalink (chỉ lưu "N giây cuối").
  if (payload.wLast || payload.w) setTimeWindowPreset(payload.wLast || payload.w);
  else if (payload.f >= 0 || payload.tt >= 0) {
    filter.timeFrom = payload.f >= 0 ? Math.min(data.lastTs, data.firstTs + payload.f) : null;
    filter.timeTo = payload.tt >= 0 ? Math.min(data.lastTs, data.firstTs + payload.tt) : null;
  }
}

// Trạng thái BÊN TRONG tab (ô tìm, chip loại mốc, chip chỉ-call-hỏng). Không nhập vào serializeFilter:
// mẫu bộ lọc là một BỘ ĐIỀU KIỆN dùng lại được ở feedback khác, còn mấy thứ này là "đang xem lát nào
// của tab này". Chỉ ghi phần khác mặc định, để hash không phình vì những giá trị không ai đổi.
function serializeTabUi() {
  const ui = {};
  if (tabUiState.issueLevel !== 'all') ui.il = tabUiState.issueLevel;
  if (tabUiState.issueQuery) ui.iq = tabUiState.issueQuery;
  if (tabUiState.httpOnlyBad) ui.hb = 1;
  if (tabUiState.httpQuery) ui.hq = tabUiState.httpQuery;
  if (tabUiState.moduleQuery) ui.mq = tabUiState.moduleQuery;
  if (tabUiState.showNoise) ui.sn = 1;
  if (tabUiState.tlQuery) ui.tq = tabUiState.tlQuery;
  if (tabUiState.tlKinds.size) ui.tk = Array.from(tabUiState.tlKinds);
  return ui;
}

function applyTabUiPayload(ui) {
  // Dọn trước rồi mới áp, kể cả khi link không mang gì: còn sót ô tìm của lần trước thì danh sách đã bị
  // lọc sẵn mà không có dòng nào nói ra — đúng loại lỗi với việc mang bộ lọc sang feedback khác.
  resetTabUiState();
  if (!ui) return;
  if (ui.il) tabUiState.issueLevel = ui.il;
  if (ui.iq) tabUiState.issueQuery = ui.iq;
  if (ui.hb) tabUiState.httpOnlyBad = true;
  if (ui.hq) tabUiState.httpQuery = ui.hq;
  if (ui.mq) tabUiState.moduleQuery = ui.mq;
  if (ui.sn) tabUiState.showNoise = true;
  if (ui.tq) tabUiState.tlQuery = ui.tq;
  if (Array.isArray(ui.tk)) tabUiState.tlKinds = new Set(ui.tk);
}

// Chỉ đọc/ghi chuỗi, không đặt lại location.hash: trang là SPA, đổi hash có thể làm router chạy lại.
function buildPermalink() {
  // domIndex CHÍNH LÀ vị trí trong entries (analyzeLog gán index của cùng một mảng), nên tra thẳng được.
  const entry = lensState.matches.length
    ? lensState.data.entries[lensState.matches[Math.max(0, lensState.matchPos)]]
    : null;
  const payload = Object.assign({ t: lensState.tab, ln: entry ? entry.lineNo : 0 }, serializeFilter());
  const ui = serializeTabUi();
  if (Object.keys(ui).length) payload.u = ui;
  // Ngưỡng khoảng lặng đi vào chính lúc dựng data, đổi nó là đổi số khoảng lặng người nhận đọc được.
  if (lensState.gapThresholdMs !== DEFAULT_GAP_MS) payload.g = lensState.gapThresholdMs;
  // Minimap đang phóng to: gửi theo độ lệch so với đầu log, cùng cách với cửa sổ thời gian kéo tay.
  if (lensState.mapZoom) {
    payload.z = [lensState.mapZoom.from - lensState.data.firstTs,
      lensState.mapZoom.to - lensState.data.firstTs];
  }
  return location.origin + location.pathname + location.search + PERMALINK_PREFIX +
    encodeURIComponent(JSON.stringify(payload));
}

// Khoảng phóng to của minimap, kẹp về trong log đang mở: link mở nhầm trên log khác thì thà thấy cả
// log còn hơn thấy một khoảng rỗng không có cách nào lùi ra.
function restoreMapZoom(range) {
  const data = lensState.data;
  if (!Array.isArray(range) || range.length !== 2) return;
  const from = Math.max(data.firstTs, Math.min(data.lastTs, data.firstTs + range[0]));
  const to = Math.max(data.firstTs, Math.min(data.lastTs, data.firstTs + range[1]));
  if (to > from) lensState.mapZoom = { from, to };
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
  // Ngưỡng khoảng lặng nằm trong buildGaps, tức phải đặt TRƯỚC rồi quét lại — không gọi rescan() vì
  // panel chưa mount ở thời điểm này (startLens gọi hàm này giữa scanLog và mountPanel).
  if (payload.g && payload.g !== lensState.gapThresholdMs) {
    lensState.gapThresholdMs = payload.g;
    scanLog();
  }
  applyFilterPayload(payload);
  applyTabUiPayload(payload.u);
  // Link cũ có thể ghi t='http' hoặc t='slow' — hai tab đã gộp đi. Không chặn thì renderTab rơi vào
  // nhánh else và vẽ tab Diễn biến trong khi thanh tab không có nút nào sáng.
  lensState.tab = TAB_DEFS.some((tab) => tab.id === payload.t) ? payload.t : 'sum';
  const result = applyFilter(false);
  restoreMapZoom(payload.z);
  if (payload.ln) {
    const target = lensState.data.entries.find((entry) => entry.lineNo === payload.ln);
    // Người gửi đang duyệt cả tập dòng khớp (thanh dưới ghi "3/47", bấm n/p đi tiếp được). Đặt matches
    // thành ĐÚNG MỘT dòng thì người nhận thấy "1/1" và n/p chết — cùng một link, hai cách dùng khác hẳn.
    // Không có điều kiện nào thì visible là cả log, lúc đó "duyệt kết quả" không còn nghĩa gì: giữ
    // nguyên cách cũ, chỉ nhảy tới dòng được trỏ.
    const pos = target && hasAnyFilterFacet() ? result.visible.indexOf(target.domIndex) : -1;
    if (pos >= 0) setMatches(result.visible, 'dòng khớp bộ lọc', pos);
    else if (target) setMatches([target.domIndex], 'từ permalink');
  }
  return true;
}

/* ------------------------------------------------ mẫu bộ lọc (lưu trong localStorage) */

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
    // Riêng tư / hết dung lượng: mẫu vẫn dùng được trong phiên này, chỉ không nhớ sang lần sau.
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

// Mô tả ngắn một mẫu để hiện làm tooltip — đọc được mà không cần áp thử.
function describeTemplatePayload(payload) {
  const parts = [];
  if (payload.wLast) parts.push(formatWindowPresetLabel(payload.wLast));
  else if (payload.f >= 0 || payload.tt >= 0) parts.push('khoảng thời gian cố định');
  if (payload.d) parts.push('bỏ khối lặp');
  if (payload.h === 0) parts.push('không ẩn dòng khác');
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
