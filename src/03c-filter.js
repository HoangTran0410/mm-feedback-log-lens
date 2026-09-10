/*
File: src/03c-filter.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
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
function setLogFilteringMode(isFiltering, mode) {
  const container = lensState.data && lensState.data.container;
  if (!container) return;
  container.classList.toggle('fll-filtering', isFiltering && mode !== 'drop');
  container.classList.toggle('fll-dropping', isFiltering && mode === 'drop');
  lensState.isFiltering = isFiltering;
}

// Chi phi loc nam gan nhu HOAN TOAN o so lan cham vao class cua dong, khong phai o layout.
// Do that tren trang admin voi 10362 dong:
//   10k classList.add            -> 7025ms
//   bat .fll-filtering khi ca 10k dong deu co .fll-keep -> 224ms
//   83 classList.add             -> 5ms
//   tat loc, hien lai toan bo    -> 13ms
// Tuc 10k lan cham class dat gap 1400 lan so voi 83 lan. Vi vay danh dau theo phia IT HON:
// loc hep (vai chuc dong) thi danh dau dong DUOC GIU, loc rong (loc theo phien app — mot phien
// co the la 10279/10362 dong) thi danh dau dong BI LOAI. So lan cham luon la min(giu, loai).
function pickRowMarkMode(visibleCount, total) {
  return visibleCount * 2 > total ? 'drop' : 'keep';
}

function applyRowMarks(entries, keepFlags, isFiltering, mode) {
  // Doi cach danh dau thi phai go het dau cu truoc, neu khong dong mang dau cu se an/hien sai.
  if (lensState.filterDomMode !== mode) {
    const stale = lensState.filterDomMode === 'drop' ? 'fll-drop' : 'fll-keep';
    entries.forEach((entry) => {
      if (entry.isMarked && entry.el) entry.el.classList.remove(stale);
      entry.isMarked = false;
    });
    lensState.filterDomMode = mode;
  }

  const cls = mode === 'drop' ? 'fll-drop' : 'fll-keep';
  entries.forEach((entry, index) => {
    const keep = keepFlags[index] === 1;
    entry.isKept = keep;
    if (!isFiltering || !entry.el) return;
    // Che do 'drop' danh dau dong BI LOAI, nen dau can gan la phu dinh cua keep.
    const wanted = mode === 'drop' ? !keep : keep;
    if (entry.isMarked !== wanted) {
      entry.el.classList.toggle(cls, wanted);
      entry.isMarked = wanted;
    }
  });
}

function isRowVisible(entry) {
  return !lensState.isFiltering || entry.isKept === true;
}

// Ep mot dong hien ra du bo loc dang giau no — cach ep phu thuoc dang danh dau nao dang dung.
function forceRowVisible(entry) {
  if (!entry.el) return;
  if (lensState.filterDomMode === 'drop') {
    entry.el.classList.remove('fll-drop');
  } else {
    entry.el.classList.add('fll-keep');
  }
  entry.isMarked = lensState.filterDomMode !== 'drop';
  entry.isKept = true;
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
  const entries = lensState.data.entries;
  const visible = [];
  // Tinh xong het roi moi dung toi DOM: phai biet tong so dong duoc giu thi moi chon duoc
  // danh dau theo phia nao cho it thao tac hon.
  const keepFlags = new Uint8Array(entries.length);
  entries.forEach((entry, index) => {
    if (!entryMatches(entry, compiled, null)) return;
    keepFlags[index] = 1;
    visible.push(entry.domIndex);
  });
  // Khi khong loc thi giu nguyen cach danh dau dang co: class tren container tat la moi dong tu
  // hien lai, va dau tren dong van khop nen lan loc sau chi ghi dung phan chenh lech.
  const mode = isFiltering ? pickRowMarkMode(visible.length, entries.length) : lensState.filterDomMode;
  applyRowMarks(entries, keepFlags, isFiltering, mode);
  setLogFilteringMode(isFiltering, mode);
  lensState.visibleCount = isFiltering ? visible.length : entries.length;
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
