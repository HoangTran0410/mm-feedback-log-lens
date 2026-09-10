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
  if (filter.timeFrom !== null || filter.timeTo !== null) {
    const from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
    const to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
    // Preset gửi đi dưới dạng "N cuối" để người nhận tính lại trên log của họ, không gửi hai mốc tuyệt đối.
    if (filter.windowPreset) payload.wLast = filter.windowPreset;
    else if (Math.abs(to - data.lastTs) < 1000) payload.wLast = to - from;
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
  // Phải đặt lại CẢ khi payload không có: áp một mẫu không có điều kiện này mà vẫn giữ cờ đang bật thì
  // kết quả khác hẳn mô tả của mẫu.
  filter.skipDuplicate = payload.d === 1;
  filter.timeFrom = null;
  filter.timeTo = null;
  filter.windowPreset = null;
  filter.hideOthers = true;
  // payload.w là dạng cũ của permalink (chỉ lưu "N giây cuối").
  if (payload.wLast || payload.w) setTimeWindowPreset(payload.wLast || payload.w);
  else if (payload.f >= 0 || payload.tt >= 0) {
    filter.timeFrom = payload.f >= 0 ? Math.min(data.lastTs, data.firstTs + payload.f) : null;
    filter.timeTo = payload.tt >= 0 ? Math.min(data.lastTs, data.firstTs + payload.tt) : null;
  }
}

// Chỉ đọc/ghi chuỗi, không đặt lại location.hash: trang là SPA, đổi hash có thể làm router chạy lại.
function buildPermalink() {
  // matches chứa domIndex, không phải vị trí trong entries — phải tra qua một lớp nữa.
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
  // Link cũ có thể ghi t='http' hoặc t='slow' — hai tab đã gộp đi. Không chặn thì renderTab rơi vào
  // nhánh else và vẽ tab Diễn biến trong khi thanh tab không có nút nào sáng.
  lensState.tab = TAB_DEFS.some((tab) => tab.id === payload.t) ? payload.t : 'sum';
  applyFilter(false);
  if (payload.ln) {
    const target = lensState.data.entries.find((entry) => entry.lineNo === payload.ln);
    if (target) setMatches([target.domIndex], 'từ permalink');
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
