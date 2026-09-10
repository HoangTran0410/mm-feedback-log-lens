/*
File: src/03c-filter.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// AI-GENERATED START — loi bo loc: bien dieu kien thanh ham, loc tap dong, dung view
// Tach ra tu src/03-shell.js (992 dong / 67 ham). Cac file src/*.js duoc build.sh noi lai
// theo thu tu ten file va boc trong MOT IIFE nen van dung chung scope — tach chi de doc,
// khong doi cach chung goi nhau.

/* ------------------------------------------------------------------ bo loc */

function hasAnyFilterFacet() {
  const filter = lensState.filter;
  return !!(filter.levels.size || filter.modules.size || filter.text || filter.session ||
    filter.timeFrom !== null || filter.timeTo !== null);
}

// Mot lan ghi class len container thay cho hang nghin lan ghi len tung dong.
function setLogFilteringMode(isFiltering) {
  const container = lensState.data && lensState.data.container;
  if (!container) return;
  container.classList.toggle('fll-filtering', isFiltering);
  lensState.isFiltering = isFiltering;
}

function isRowVisible(entry) {
  return !lensState.isFiltering || entry.isKept === true;
}

function compileFilter() {
  const filter = lensState.filter;
  let matcher = null;
  let isBadPattern = false;
  if (filter.text && filter.useRegex) {
    try {
      matcher = new RegExp(filter.text, 'i');
    } catch (error) {
      isBadPattern = true;
    }
  }
  return {
    levels: filter.levels,
    modules: filter.modules,
    session: filter.session,
    timeFrom: filter.timeFrom,
    timeTo: filter.timeTo,
    text: filter.text,
    needle: filter.text.toLowerCase(),
    matcher,
    isBadPattern,
  };
}

// skipFacetId cho phep hoi "neu bo qua dung dieu kien nay thi dong co lot khong".
// Do la cach dem cho cac chip trong tab Loc: mot facet khong duoc tu dem theo chinh no,
// neu khong thi chon ERROR xong chip WARNING ve 0 va khong con duong noi rong lai.
function entryMatches(entry, compiled, skipFacetId) {
  if (skipFacetId !== 'levels' && compiled.levels.size && !compiled.levels.has(entry.level)) return false;
  if (skipFacetId !== 'modules' && compiled.modules.size && !compiled.modules.has(entry.module)) return false;
  if (skipFacetId !== 'session' && compiled.session && entry.session !== compiled.session) return false;
  if (skipFacetId !== 'window' && (compiled.timeFrom !== null || compiled.timeTo !== null)) {
    if (!entry.ts) return false;
    if (compiled.timeFrom !== null && entry.ts < compiled.timeFrom) return false;
    if (compiled.timeTo !== null && entry.ts > compiled.timeTo) return false;
  }
  if (skipFacetId !== 'text' && compiled.text && !compiled.isBadPattern) {
    return compiled.matcher
      ? compiled.matcher.test(entry.raw)
      : entry.raw.toLowerCase().indexOf(compiled.needle) >= 0;
  }
  return true;
}

function tallyFacetCandidates(skipFacetId, pickKey) {
  const compiled = compileFilter();
  const tally = new Map();
  lensState.data.entries.forEach((entry) => {
    if (!entryMatches(entry, compiled, skipFacetId)) return;
    const key = pickKey(entry);
    if (key === '' || key === undefined || key === null) return;
    tally.set(key, (tally.get(key) || 0) + 1);
  });
  return tally;
}

// Cua so thoi gian dang xem, suy tu cac dieu kien THOI GIAN (khong phai tu tap dong con lai).
// Neu suy tu tap dong thi loc "chi ERROR" se lam khoang lang phinh thanh nhung khoang gia giua hai loi.
function getVisibleTimeRange() {
  const data = lensState.data;
  const filter = lensState.filter;
  let from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
  let to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
  if (filter.session && data.sessions) {
    const session = data.sessions.find((item) => item.index === filter.session);
    if (session) {
      from = Math.max(from, session.startTs);
      to = Math.min(to, session.endTs);
    }
  }
  return { from, to };
}

function buildView() {
  const data = lensState.data;
  if (!hasAnyFilterFacet() || !lensState.lastFilterResult) {
    lensState.view = data;
    return;
  }
  const subset = lensState.lastFilterResult.visible.map((index) => data.entries[index]);
  const stats = deriveStats(subset);
  const range = getVisibleTimeRange();
  // Khoang lang la thuoc tinh cua duong thoi gian, khong phai cua tap dong: chi cat theo cua so thoi gian.
  stats.gaps = data.gaps.filter((gap) => gap.before.ts >= range.from && gap.before.ts <= range.to);
  lensState.view = Object.assign({}, data, stats);
}

function computeFilteredIndices() {
  const filter = lensState.filter;
  const compiled = compileFilter();
  const isBadPattern = compiled.isBadPattern;
  // Ham nay tinh lai toan bo trang thai nen moi dong tung duoc "ep hien" tro ve chuan.
  lensState.forcedVisibleIndices.clear();
  const isFiltering = filter.hideOthers && hasAnyFilterFacet();
  const visible = [];
  lensState.data.entries.forEach((entry) => {
    const keep = entryMatches(entry, compiled, null);
    if (keep) visible.push(entry.domIndex);
    // Chi danh dau dong DUOC GIU (thuong vai chuc) thay vi an tung dong bi loai (thuong ~4000).
    // Khi khong loc thi khong dung toi DOM: class tren container tat la moi dong tu hien lai,
    // va entry.isKept van khop voi class dang co nen lan loc sau chi ghi dung phan chenh lech.
    if (isFiltering && entry.el && entry.isKept !== keep) {
      entry.el.classList.toggle('fll-keep', keep);
      entry.isKept = keep;
    }
  });
  setLogFilteringMode(isFiltering);
  lensState.visibleCount = isFiltering ? visible.length : lensState.data.entries.length;
  lensState.lastFilterResult = { visible, isBadPattern };
  buildView();
  return lensState.lastFilterResult;
}

// Ve lai tab Loc khong duoc tu quet lai 4085 dong: moi duong doi bo loc deu da goi
// computeFilteredIndices truoc do roi. Quet hai lan la ly do "Xoa tat ca" tung ton 200ms.
function getFilterResult() {
  return lensState.lastFilterResult || computeFilteredIndices();
}
// AI-GENERATED END
