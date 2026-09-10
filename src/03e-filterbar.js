/*
File: src/03e-filterbar.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — thanh bo loc thuong tru: chip facet, cua so thoi gian, go tung dieu kien
// Tach ra tu src/03-shell.js (992 dong / 67 ham). Cac file src/*.js duoc build.sh noi lai
// theo thu tu ten file va boc trong MOT IIFE nen van dung chung scope — tach chi de doc,
// khong doi cach chung goi nhau.

/* ------------------------------- thanh bo loc thuong tru (hien o moi tab) */

// Bo loc la state chung nhung truoc day chi nhin thay duoc trong tab Loc: doi sang tab khac
// la khong con dau hieu nao cho biet bang log dang bi cat bot. Thanh nay hien o moi tab.
function formatWindowLabel() {
  const filter = lensState.filter;
  const data = lensState.data;
  const from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
  const to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
  // Neu trung khit mot preset thi goi ten preset cho de doc, con lai hien khoang thoi gian that.
  if (Math.abs(to - data.lastTs) < 1000) {
    const span = to - from;
    for (let i = 0; i < TIME_WINDOW_CHOICES.length; i += 1) {
      if (Math.abs(span - TIME_WINDOW_CHOICES[i]) < 1000) return formatWindowPresetLabel(TIME_WINDOW_CHOICES[i]);
    }
  }
  return formatClock(from) + ' → ' + formatClock(to);
}

function formatWindowPresetLabel(ms) {
  return ms < 60000 ? ms / 1000 + ' giây cuối' : ms / 60000 + ' phút cuối';
}

function isWindowPresetActive(ms) {
  const filter = lensState.filter;
  if (!ms) return filter.timeFrom === null && filter.timeTo === null;
  if (filter.timeFrom === null || filter.timeTo === null) return false;
  return Math.abs(filter.timeTo - lensState.data.lastTs) < 1000 &&
    Math.abs(filter.timeTo - filter.timeFrom - ms) < 1000;
}

function setTimeWindowPreset(ms) {
  const filter = lensState.filter;
  if (!ms) {
    filter.timeFrom = null;
    filter.timeTo = null;
    return;
  }
  filter.timeTo = lensState.data.lastTs;
  filter.timeFrom = Math.max(lensState.data.firstTs, lensState.data.lastTs - ms);
}

function getActiveFilterFacets() {
  const filter = lensState.filter;
  const facets = [];
  if (filter.timeFrom !== null || filter.timeTo !== null) {
    facets.push({ id: 'window', label: formatWindowLabel() });
  }
  if (filter.session) facets.push({ id: 'session', label: 'Phiên ' + filter.session });
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
  }
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
        '<button data-act="clearFacet" data-value="' + facet.id + '" title="Bỏ điều kiện này">&times;</button>' +
        '</span>')
      .join('') +
    '<button class="fll-fclear" data-act="clearFilters">Xoá tất cả</button></div>';
}

function resetFilter() {
  lensState.filter.levels.clear();
  lensState.filter.modules.clear();
  lensState.filter.text = '';
  lensState.filter.timeFrom = null;
  lensState.filter.timeTo = null;
  lensState.filter.session = null;
  // Moi dieu kien da rong nen luot nay chi cham vao dung nhung dong dang bi an.
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
// AI-GENERATED END
