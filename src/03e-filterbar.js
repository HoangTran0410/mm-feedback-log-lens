// @ts-check
// thanh bộ lọc thường trú: chip facet, cửa sổ thời gian, gỡ từng điều kiện
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

/* ------------------------------- thanh bộ lọc thường trú (hiện ở mọi tab) */

// Bộ lọc là state chung nhưng trước đây chỉ nhìn thấy được trong tab Lọc: đổi sang tab khác
// là không còn dấu hiệu nào cho biết bảng log đang bị cắt bớt. Thanh này hiện ở mọi tab.
function formatWindowLabel() {
  const filter = lensState.filter;
  const data = lensState.data;
  // Đang bật preset thì gọi tên preset. Đọc từ filter.windowPreset chứ không suy ngược từ hai mốc:
  // trên log ngắn hơn preset, timeFrom bị kẹp về firstTs nên hiệu hai mốc nhỏ hơn preset và nhãn rơi
  // vào nhánh giờ tuyệt đối.
  if (filter.windowPreset) return formatWindowPresetLabel(filter.windowPreset);
  const from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
  const to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
  return formatClock(from) + ' → ' + formatClock(to);
}

function formatWindowPresetLabel(ms) {
  return ms < 60000 ? ms / 1000 + ' giây cuối' : ms / 60000 + ' phút cuối';
}

function isWindowPresetActive(ms) {
  const filter = lensState.filter;
  if (!ms) return filter.timeFrom === null && filter.timeTo === null;
  return filter.windowPreset === ms;
}

function setTimeWindowPreset(ms) {
  const filter = lensState.filter;
  filter.windowPreset = ms || null;
  if (!ms) {
    filter.timeFrom = null;
    filter.timeTo = null;
    return;
  }
  filter.timeTo = lensState.data.lastTs;
  // Vẫn kẹp về firstTs (không lọc mất gì trên log ngắn hơn preset), nhưng preset đã được nhớ riêng
  // nên việc kẹp không còn làm chip tắt.
  filter.timeFrom = Math.max(lensState.data.firstTs, lensState.data.lastTs - ms);
}

function getActiveFilterFacets() {
  const filter = lensState.filter;
  const facets = [];
  if (filter.timeFrom !== null || filter.timeTo !== null) {
    facets.push({ id: 'window', label: formatWindowLabel() });
  }
  if (filter.skipDuplicate) facets.push({ id: 'duplicate', label: 'bỏ khối lặp' });
  if (filter.session) facets.push({ id: 'session', label: sessionLabel(filter.session) });
  if (filter.levels.size) facets.push({ id: 'levels', label: Array.from(filter.levels).join(' + ') });
  if (filter.modules.size) {
    facets.push({ id: 'modules', label: filter.modules.size === 1
      ? Array.from(filter.modules)[0]
      : filter.modules.size + ' module' });
  }
  if (filter.text) facets.push({ id: 'text', label: (filter.useRegex ? '/' : '"') + filter.text + (filter.useRegex ? '/' : '"') });
  return facets;
}

function clearFilterFacet(facetId) {
  const filter = lensState.filter;
  if (facetId === 'window') {
    filter.timeFrom = null;
    filter.timeTo = null;
    filter.windowPreset = null;
  }
  else if (facetId === 'duplicate') filter.skipDuplicate = false;
  else if (facetId === 'session') filter.session = null;
  else if (facetId === 'levels') filter.levels.clear();
  else if (facetId === 'modules') filter.modules.clear();
  else if (facetId === 'text') filter.text = '';
}

function refreshFilterBar() {
  const bar = lensState.el.bar;
  if (!bar || !lensState.data) return;
  updateMinimapRange();
  const facets = getActiveFilterFacets();
  if (!facets.length) {
    bar.hidden = true;
    bar.innerHTML = '';
    positionSheetBelowTimeline();
    return;
  }
  const forced = lensState.forcedVisibleIndices.size;
  bar.hidden = false;
  bar.innerHTML =
    '<span class="fll-bar-t">' + facets.length + ' bộ lọc đang bật</span>' +
    '<span class="fll-bar-n">hiện ' + (lensState.visibleCount + forced) + '/' + lensState.data.entries.length + ' dòng' +
    (forced ? ' · ' + forced + ' dòng ngoài lọc' : '') + '</span>' +
    '<div class="fll-fchips">' + facets
      .map((facet) => '<span class="fll-fchip"><b>' + escapeHtml(facet.label) + '</b>' +
        '<button data-act="clearFacet" data-value="' + facet.id + '" data-tip="Bỏ điều kiện này">&times;</button>' +
        '</span>')
      .join('') +
    '<button class="fll-fclear" data-act="clearFilters">Xoá tất cả</button></div>';
  // Đo SAU khi đã có nội dung: thanh bộ lọc chưa có chữ thì chiều cao chưa đúng.
  positionSheetBelowTimeline();
}

function resetFilter() {
  lensState.filter.levels.clear();
  lensState.filter.modules.clear();
  lensState.filter.text = '';
  lensState.filter.timeFrom = null;
  lensState.filter.timeTo = null;
  lensState.filter.session = null;
  lensState.filter.skipDuplicate = false;
  // Mọi điều kiện đã rỗng nên lượt này chỉ chạm vào đúng những dòng đang bị ẩn.
  computeFilteredIndices();
  if (lensState.el.lastHit) lensState.el.lastHit.classList.remove('fll-hit');
  lensState.el.lastHit = null;
  lensState.matches = [];
  lensState.matchPos = -1;
  renderFooter();
  refreshFilterBar();
}

function filterByModule(moduleName) {
  lensState.filter.modules = new Set([moduleName]);
  lensState.filter.hideOthers = true;
  switchTab('flt');
  applyFilter(true);
}

function filterByLevel(level) {
  lensState.filter.levels = new Set([level]);
  lensState.filter.hideOthers = true;
  switchTab('flt');
  applyFilter(true);
}
