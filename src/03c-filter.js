// @ts-check
// lõi bộ lọc: biến điều kiện thành hàm, lọc tập dòng, dựng view
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

/* ------------------------------------------------------------------ bộ lọc */

function hasAnyFilterFacet() {
  const filter = lensState.filter;
  return !!(filter.levels.size || filter.modules.size || filter.text || filter.session ||
    filter.timeFrom !== null || filter.timeTo !== null || filter.skipDuplicate);
}

// Một lần ghi class lên container thay cho hàng nghìn lần ghi lên từng dòng.
function setLogFilteringMode(isFiltering, mode) {
  const container = lensState.data && lensState.data.container;
  if (!container) return;
  container.classList.toggle('fll-filtering', isFiltering && mode !== 'drop');
  container.classList.toggle('fll-dropping', isFiltering && mode === 'drop');
  lensState.isFiltering = isFiltering;
}

// Chi phí lọc nằm gần như HOÀN TOÀN ở số lần chạm vào class của dòng, không phải ở layout.
// Đo thật trên trang admin với 10362 dòng:
//   10k classList.add            -> 7025ms
//   bật .fll-filtering khi cả 10k dòng đều có .fll-keep -> 224ms
//   83 classList.add             -> 5ms
//   tắt lọc, hiện lại toàn bộ    -> 13ms
// Tức 10k lần chạm class đắt gấp 1400 lần so với 83 lần. Vì vậy đánh dấu theo phía ÍT HƠN:
// lọc hẹp (vài chục dòng) thì đánh dấu dòng ĐƯỢC GIỮ, lọc rộng (lọc theo phiên app — một phiên
// có thể là 10279/10362 dòng) thì đánh dấu dòng BỊ LOẠI. Số lần chạm luôn là min(giữ, loại).
function pickRowMarkMode(visibleCount, total) {
  return visibleCount * 2 > total ? 'drop' : 'keep';
}

function applyRowMarks(entries, keepFlags, isFiltering, mode) {
  // Đổi cách đánh dấu thì phải gỡ hết dấu cũ trước, nếu không dòng mang dấu cũ sẽ ẩn/hiện sai.
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
    // Chế độ 'drop' đánh dấu dòng BỊ LOẠI, nên dấu cần gắn là phủ định của keep.
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

// Ép một dòng hiện ra dù bộ lọc đang giấu nó — cách ép phụ thuộc dạng đánh dấu nào đang dùng.
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
    skipDuplicate: filter.skipDuplicate,
    timeFrom: filter.timeFrom,
    timeTo: filter.timeTo,
    text: filter.text,
    needle: filter.text.toLowerCase(),
    matcher,
    isBadPattern,
  };
}

// skipFacetId cho phép hỏi "nếu bỏ qua đúng điều kiện này thì dòng có lọt không".
// Đó là cách đếm cho các chip trong tab Lọc: một facet không được tự đếm theo chính nó,
// nếu không thì chọn ERROR xong chip WARNING về 0 và không còn đường nới rộng lại.
function entryMatches(entry, compiled, skipFacetId) {
  if (skipFacetId !== 'duplicate' && compiled.skipDuplicate && entry.isDuplicate) return false;
  if (skipFacetId !== 'levels' && compiled.levels.size && !compiled.levels.has(entry.level)) return false;
  if (skipFacetId !== 'modules' && compiled.modules.size && !compiled.modules.has(entry.module)) return false;
  if (skipFacetId !== 'session' && compiled.session && entry.session !== compiled.session) return false;
  if (skipFacetId !== 'window' && (compiled.timeFrom !== null || compiled.timeTo !== null)) {
    // windowTs chứ không phải ts: dòng tiếp nối thừa hưởng giờ của dòng trên nó, nhờ vậy stack trace
    // nhiều dòng không bị cửa sổ thời gian xén mất phần dưới.
    if (!entry.windowTs) return false;
    if (compiled.timeFrom !== null && entry.windowTs < compiled.timeFrom) return false;
    if (compiled.timeTo !== null && entry.windowTs > compiled.timeTo) return false;
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

// Cửa sổ thời gian đang xem, suy từ các điều kiện THỜI GIAN (không phải từ tập dòng còn lại).
// Nếu suy từ tập dòng thì lọc "chỉ ERROR" sẽ làm khoảng lặng phình thành những khoảng giả giữa hai lỗi.
function getVisibleTimeRange() {
  const data = lensState.data;
  const filter = lensState.filter;
  let from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
  let to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
  if (filter.session && data.sessions) {
    const session = data.sessions.find((item) => item.index === filter.session);
    // Phiên không có dòng nào mang timestamp thì startTs/endTs là null: Math.min(x, null) ra 0, tức
    // khoảng đang xem thành [firstTs, 0] — vô nghĩa mà không có gì báo. Không có mốc thì đừng thu hẹp.
    if (session && session.startTs && session.endTs) {
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
  const stats = deriveStats(subset, data.gaps);
  const range = getVisibleTimeRange();
  // Khoảng lặng là thuộc tính của đường thời gian, không phải của tập dòng: chỉ cắt theo cửa sổ thời gian.
  stats.gaps = data.gaps.filter((gap) => gap.before.ts >= range.from && gap.before.ts <= range.to);
  lensState.view = Object.assign({}, data, stats);
}

function computeFilteredIndices() {
  const filter = lensState.filter;
  const compiled = compileFilter();
  const isBadPattern = compiled.isBadPattern;
  // Hàm này tính lại toàn bộ trạng thái nên mọi dòng từng được "ép hiện" trở về chuẩn.
  lensState.forcedVisibleIndices.clear();
  const isFiltering = filter.hideOthers && hasAnyFilterFacet();
  const entries = lensState.data.entries;
  const visible = [];
  // Tính xong hết rồi mới đụng tới DOM: phải biết tổng số dòng được giữ thì mới chọn được
  // đánh dấu theo phía nào cho ít thao tác hơn.
  const keepFlags = new Uint8Array(entries.length);
  entries.forEach((entry, index) => {
    if (!entryMatches(entry, compiled, null)) return;
    keepFlags[index] = 1;
    visible.push(entry.domIndex);
  });
  // Khi không lọc thì giữ nguyên cách đánh dấu đang có: class trên container tắt là mọi dòng tự
  // hiện lại, và dấu trên dòng vẫn khớp nên lần lọc sau chỉ ghi đúng phần chênh lệch.
  const mode = isFiltering ? pickRowMarkMode(visible.length, entries.length) : lensState.filterDomMode;
  applyRowMarks(entries, keepFlags, isFiltering, mode);
  setLogFilteringMode(isFiltering, mode);
  lensState.visibleCount = isFiltering ? visible.length : entries.length;
  lensState.lastFilterResult = { visible, isBadPattern };
  buildView();
  return lensState.lastFilterResult;
}

// Vẽ lại tab Lọc không được tự quét lại 4085 dòng: mọi đường đổi bộ lọc đều đã gọi
// computeFilteredIndices trước đó rồi. Quét hai lần là lý do "Xoá tất cả" từng tốn 200ms.
function getFilterResult() {
  return lensState.lastFilterResult || computeFilteredIndices();
}
