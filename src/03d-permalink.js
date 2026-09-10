/*
File: src/03d-permalink.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — permalink qua hash URL va mau bo loc luu san
// Tach ra tu src/03-shell.js (992 dong / 67 ham). Cac file src/*.js duoc build.sh noi lai
// theo thu tu ten file va boc trong MOT IIFE nen van dung chung scope — tach chi de doc,
// khong doi cach chung goi nhau.

/* --------------------------------------------------- permalink qua hash URL */

// Mot dinh nghia duy nhat cho ca permalink lan mau bo loc.
// Khoang thoi gian ket thuc dung o lastTs duoc luu dang "N cuoi" chu khong phai moc tuyet doi:
// nhu the mau "2 phut cuoi" con dung duoc o feedback khac, con moc tuyet doi thi vo nghia.
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
  if (filter.timeFrom !== null || filter.timeTo !== null) {
    const from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
    const to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
    if (Math.abs(to - data.lastTs) < 1000) payload.wLast = to - from;
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
  filter.timeFrom = null;
  filter.timeTo = null;
  filter.hideOthers = true;
  // payload.w la dang cu cua permalink (chi luu "N giay cuoi").
  if (payload.wLast || payload.w) setTimeWindowPreset(payload.wLast || payload.w);
  else if (payload.f >= 0 || payload.tt >= 0) {
    filter.timeFrom = payload.f >= 0 ? Math.min(data.lastTs, data.firstTs + payload.f) : null;
    filter.timeTo = payload.tt >= 0 ? Math.min(data.lastTs, data.firstTs + payload.tt) : null;
  }
}

// Chi doc/ghi chuoi, khong dat lai location.hash: trang la SPA, doi hash co the lam router chay lai.
function buildPermalink() {
  // matches chua domIndex, khong phai vi tri trong entries — phai tra qua mot lop nua.
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
  lensState.tab = payload.t || 'sum';
  applyFilter(false);
  if (payload.ln) {
    const target = lensState.data.entries.find((entry) => entry.lineNo === payload.ln);
    if (target) setMatches([target.domIndex], 'từ permalink');
  }
  return true;
}

/* ------------------------------------------------ mau bo loc (luu trong localStorage) */

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
    // Rieng tu / het dung luong: mau van dung duoc trong phien nay, chi khong nho sang lan sau.
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

// Mo ta ngan mot mau de hien lam tooltip — doc duoc ma khong can ap thu.
function describeTemplatePayload(payload) {
  const parts = [];
  if (payload.wLast) parts.push(formatWindowPresetLabel(payload.wLast));
  else if (payload.f >= 0 || payload.tt >= 0) parts.push('khoảng thời gian cố định');
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
// AI-GENERATED END
