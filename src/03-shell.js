/*
File: src/03-shell.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// AI-GENERATED START — khung panel: state, dieu huong dong, bo loc, minimap, keo tha, thu nho

const MINIMAP_BUCKETS = 90;
const SPARKLINE_BUCKETS = 26;
const DEFAULT_GAP_MS = 2000;
const PANEL_MIN_WIDTH = 360;
const PANEL_MIN_HEIGHT = 260;
const VIEWPORT_MARGIN = 8;

const LEVEL_COLOR = {
  ERROR: '#ff5f6d',
  WARNING: '#ffb648',
  INFO: '#58c4ff',
  DEBUG: '#7d8590',
};

const MUTE_STORAGE_KEY = 'fll.mutedSignatures';
const TEMPLATE_STORAGE_KEY = 'fll.filterTemplates';
const MAX_FILTER_TEMPLATES = 20;
const PERMALINK_PREFIX = '#fll=';
const TIME_WINDOW_CHOICES = [30000, 60000, 120000, 300000];

const lensState = {
  data: null,
  geometry: null,
  tab: 'sum',
  matches: [],
  matchPos: -1,
  matchLabel: '',
  gapThresholdMs: DEFAULT_GAP_MS,
  mutedSignatures: new Set(),
  filterTemplates: [],
  isShowingMuted: false,
  // Nguoi dung bam "x" tren feedback nay: dung tu gan lai nua (nhung sang feedback khac thi gan lai).
  isDismissed: false,
  // Nho lan truoc dang mo panel hay dang thu gon, de sang feedback khac tra ve dung dang do.
  wasPanelOpen: false,
  // Dong bi bo loc an nhung nguoi dung van nhay toi: phai dem rieng, khong thi con so
  // "dang hien N/total" se noi doi.
  forcedVisibleIndices: new Set(),
  filter: {
    levels: new Set(),
    modules: new Set(),
    text: '',
    useRegex: true,
    hideOthers: true,
    // Khoang thoi gian tuy y. Chip preset ghi (lastTs - N, lastTs); keo tren minimap ghi khoang bat ky.
    timeFrom: null,
    timeTo: null,
    session: null,
  },
  el: {},
};

/* ------------------------------------------- tat tieng chu ky (nho qua phien) */

function loadMutedSignatures() {
  try {
    return new Set(JSON.parse(localStorage.getItem(MUTE_STORAGE_KEY)) || []);
  } catch (error) {
    return new Set();
  }
}

function persistMutedSignatures() {
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, JSON.stringify(Array.from(lensState.mutedSignatures)));
  } catch (error) {
    // Rieng tu / het dung luong: tat tieng van chay trong phien nay, chi khong nho sang lan sau.
  }
}

function toggleMutedSignature(groupKey) {
  if (lensState.mutedSignatures.has(groupKey)) lensState.mutedSignatures.delete(groupKey);
  else lensState.mutedSignatures.add(groupKey);
  persistMutedSignatures();
}

function isGroupMuted(group) {
  return lensState.mutedSignatures.has(group.key);
}

function countUnmutedErrorGroups(source) {
  return source.groups.filter((group) => group.level === 'ERROR' && !isGroupMuted(group)).length;
}

// Cac tab doc qua day: co bo loc thi la thong ke cua tap dang hien, khong thi la ca file.
function getView() {
  return lensState.view || lensState.data;
}

function escapeHtml(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    return '&#39;';
  });
}

function formatClock(ts) {
  if (!ts) return '--:--:--';
  const date = new Date(ts + 7 * 3600000);
  return date.toISOString().slice(11, 19);
}

function formatDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
}

function formatCount(value) {
  return value >= 1000 ? (value / 1000).toFixed(1) + 'k' : String(value);
}

/* ---------------------------------------------------------------- dieu huong */

function jumpToIndex(domIndex) {
  const data = lensState.data;
  const entry = data.entries[domIndex];
  if (!entry || !entry.el) return;

  // Truoc day cho chay het 4085 phan tu de go class highlight moi lan bam n — chi can nho dong truoc do.
  if (lensState.el.lastHit && lensState.el.lastHit !== entry.el) lensState.el.lastHit.classList.remove('fll-hit');
  if (!isRowVisible(entry)) {
    lensState.forcedVisibleIndices.add(domIndex);
    entry.el.classList.add('fll-keep');
    entry.isKept = true;
  }
  entry.el.classList.add('fll-hit');
  lensState.el.lastHit = entry.el;

  const container = data.container;
  const containerRect = container.getBoundingClientRect();
  const rowRect = entry.el.getBoundingClientRect();
  container.scrollTop += rowRect.top - containerRect.top - container.clientHeight / 2 + rowRect.height / 2;

  if (containerRect.bottom < 60 || containerRect.top > window.innerHeight - 60) {
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  updateMinimapCursor(entry.ts);
  refreshFilterBar();
}

function setMatches(indices, label) {
  lensState.matches = indices;
  lensState.matchLabel = label;
  lensState.matchPos = indices.length ? 0 : -1;
  if (indices.length) jumpToIndex(indices[0]);
  renderFooter();
}

function moveMatch(step) {
  const total = lensState.matches.length;
  if (!total) return;
  lensState.matchPos = (lensState.matchPos + step + total) % total;
  jumpToIndex(lensState.matches[lensState.matchPos]);
  renderFooter();
}

function renderFooter() {
  const info = lensState.el.info;
  if (!info) return;
  const total = lensState.matches.length;
  if (!total) {
    info.innerHTML = '<span style="opacity:.7">Chưa chọn gì để duyệt</span>';
    return;
  }
  const entry = lensState.data.entries[lensState.matches[Math.max(0, lensState.matchPos)]];
  info.innerHTML =
    '<b>' + (lensState.matchPos + 1) + '/' + total + '</b> ' + escapeHtml(lensState.matchLabel) +
    ' &middot; dòng <b>' + (entry ? entry.lineNo : '?') + '</b>';
}

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

/* ----------------------------------------------------------------- minimap */

function buildBuckets(count) {
  const data = lensState.data;
  const span = Math.max(1, data.lastTs - data.firstTs);
  const buckets = [];
  for (let i = 0; i < count; i += 1) buckets.push({ ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0, total: 0, firstIndex: -1 });
  data.entries.forEach((entry) => {
    if (!entry.ts || !entry.level) return;
    const slot = Math.min(count - 1, Math.floor(((entry.ts - data.firstTs) / span) * count));
    const bucket = buckets[slot];
    bucket[entry.level] = (bucket[entry.level] || 0) + 1;
    bucket.total += 1;
    if (bucket.firstIndex < 0) bucket.firstIndex = entry.domIndex;
  });
  return buckets;
}

function renderMinimap() {
  const buckets = buildBuckets(MINIMAP_BUCKETS);
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const columns = buckets
    .map((bucket, index) => {
      let color = '#2a2436';
      if (bucket.ERROR) color = LEVEL_COLOR.ERROR;
      else if (bucket.WARNING) color = LEVEL_COLOR.WARNING;
      else if (bucket.INFO) color = 'rgba(88,196,255,.55)';
      else if (bucket.DEBUG) color = 'rgba(125,133,144,.5)';
      const height = bucket.total ? 12 + (Math.log(1 + bucket.total) / Math.log(1 + peak)) * 88 : 4;
      const title = bucket.total
        ? formatClock(lensState.data.firstTs + ((lensState.data.lastTs - lensState.data.firstTs) * index) / MINIMAP_BUCKETS) +
          ' · ' + bucket.total + ' dòng (' + bucket.ERROR + ' lỗi, ' + bucket.WARNING + ' cảnh báo)'
        : 'không có log';
      return '<i data-bucket="' + bucket.firstIndex + '" title="' + escapeHtml(title) + '" style="height:' +
        height.toFixed(1) + '%;background:' + color + '"></i>';
    })
    .join('');
  // Minimap co y giu NGUYEN toan dai: no la la ban do "dang o dau trong ca log".
  // Bo loc thoi gian chi lam mo phan ngoai cua so, van thay duoc toan canh.
  lensState.el.map.innerHTML = columns +
    '<div class="fll-shade fll-shade-l"></div><div class="fll-shade fll-shade-r"></div>' +
    '<div class="fll-cursor"></div>';
  lensState.el.cursor = lensState.el.map.querySelector('.fll-cursor');
  lensState.el.shadeLeft = lensState.el.map.querySelector('.fll-shade-l');
  lensState.el.shadeRight = lensState.el.map.querySelector('.fll-shade-r');
  lensState.el.mapLabel.innerHTML =
    '<span>' + formatClock(lensState.data.firstTs) + '</span>' +
    '<span class="fll-maptext"></span>' +
    '<span>' + formatClock(lensState.data.lastTs) + '</span>';
  lensState.el.mapText = lensState.el.mapLabel.querySelector('.fll-maptext');
  updateMinimapRange();
}

function updateMinimapRange() {
  const shadeLeft = lensState.el.shadeLeft;
  const shadeRight = lensState.el.shadeRight;
  if (!shadeLeft || !shadeRight || !lensState.data) return;
  const data = lensState.data;
  const span = Math.max(1, data.lastTs - data.firstTs);
  const range = getVisibleTimeRange();
  shadeLeft.style.width = Math.max(0, ((range.from - data.firstTs) / span) * 100).toFixed(2) + '%';
  shadeRight.style.width = Math.max(0, ((data.lastTs - range.to) / span) * 100).toFixed(2) + '%';
  lensState.el.map.classList.toggle('fll-map-ranged', hasAnyTimeRange());
  if (!lensState.el.mapText) return;
  lensState.el.mapText.textContent = hasAnyTimeRange()
    ? formatClock(range.from) + ' → ' + formatClock(range.to) + ' · ' + formatDuration(range.to - range.from)
    : 'kéo để chọn khoảng · bấm để nhảy · nháy đúp để bỏ chọn';
}

function hasAnyTimeRange() {
  return lensState.filter.timeFrom !== null || lensState.filter.timeTo !== null;
}

/* ------------------------------------------- keo chon khoang thoi gian tren minimap */

const MINIMAP_EDGE_GRAB_PX = 7;
const MINIMAP_MIN_RANGE_MS = 500;

let minimapDrag = null;

function minimapTsFromClientX(clientX) {
  const rect = lensState.el.map.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  const data = lensState.data;
  return data.firstTs + ratio * Math.max(1, data.lastTs - data.firstTs);
}

function minimapClientXFromTs(ts) {
  const rect = lensState.el.map.getBoundingClientRect();
  const data = lensState.data;
  return rect.left + ((ts - data.firstTs) / Math.max(1, data.lastTs - data.firstTs)) * rect.width;
}

// Chi ve lai hai mieng mo trong luc keo. Ap bo loc that su doi mot luot 4085 dong + layout bang log,
// nang qua de chay theo tung nhip chuot — nen chi commit luc tha tay.
function previewMinimapRange(from, to) {
  const data = lensState.data;
  const span = Math.max(1, data.lastTs - data.firstTs);
  lensState.el.shadeLeft.style.width = Math.max(0, ((from - data.firstTs) / span) * 100).toFixed(2) + '%';
  lensState.el.shadeRight.style.width = Math.max(0, ((data.lastTs - to) / span) * 100).toFixed(2) + '%';
  if (lensState.el.mapText) {
    lensState.el.mapText.textContent = formatClock(from) + ' → ' + formatClock(to) +
      ' · ' + formatDuration(Math.max(0, to - from));
  }
}

function resolveMinimapDragMode(clientX) {
  const filter = lensState.filter;
  if (filter.timeFrom === null && filter.timeTo === null) return 'create';
  const range = getVisibleTimeRange();
  if (Math.abs(clientX - minimapClientXFromTs(range.from)) <= MINIMAP_EDGE_GRAB_PX) return 'resizeStart';
  if (Math.abs(clientX - minimapClientXFromTs(range.to)) <= MINIMAP_EDGE_GRAB_PX) return 'resizeEnd';
  if (clientX > minimapClientXFromTs(range.from) && clientX < minimapClientXFromTs(range.to)) return 'move';
  return 'create';
}

function handleMinimapMouseDown(event) {
  if (!lensState.data || !lensState.el.shadeLeft) return;
  const range = getVisibleTimeRange();
  minimapDrag = {
    mode: resolveMinimapDragMode(event.clientX),
    startX: event.clientX,
    anchorTs: minimapTsFromClientX(event.clientX),
    from: range.from,
    to: range.to,
    previewFrom: range.from,
    previewTo: range.to,
    hasMoved: false,
  };
  window.addEventListener('mousemove', handleMinimapMouseMove);
  window.addEventListener('mouseup', handleMinimapMouseUp);
  event.preventDefault();
}

function handleMinimapMouseMove(event) {
  if (!minimapDrag) return;
  if (!minimapDrag.hasMoved && Math.abs(event.clientX - minimapDrag.startX) <= 2) return;
  minimapDrag.hasMoved = true;

  const data = lensState.data;
  const ts = minimapTsFromClientX(event.clientX);
  let from = minimapDrag.from;
  let to = minimapDrag.to;

  if (minimapDrag.mode === 'create') {
    from = Math.min(minimapDrag.anchorTs, ts);
    to = Math.max(minimapDrag.anchorTs, ts);
  } else if (minimapDrag.mode === 'resizeStart') {
    from = Math.min(ts, minimapDrag.to - MINIMAP_MIN_RANGE_MS);
  } else if (minimapDrag.mode === 'resizeEnd') {
    to = Math.max(ts, minimapDrag.from + MINIMAP_MIN_RANGE_MS);
  } else {
    const delta = ts - minimapDrag.anchorTs;
    from = minimapDrag.from + delta;
    to = minimapDrag.to + delta;
    if (from < data.firstTs) {
      to += data.firstTs - from;
      from = data.firstTs;
    }
    if (to > data.lastTs) {
      from -= to - data.lastTs;
      to = data.lastTs;
    }
  }

  minimapDrag.previewFrom = Math.max(data.firstTs, from);
  minimapDrag.previewTo = Math.min(data.lastTs, to);
  previewMinimapRange(minimapDrag.previewFrom, minimapDrag.previewTo);
}

function handleMinimapMouseUp() {
  window.removeEventListener('mousemove', handleMinimapMouseMove);
  window.removeEventListener('mouseup', handleMinimapMouseUp);
  const drag = minimapDrag;
  minimapDrag = null;
  // Bam khong keo: de nguyen cho handleLensClick nhay toi moc do nhu cu.
  if (!drag || !drag.hasMoved) return;
  // Da keo thi chan cu click sinh ra ngay sau mouseup, khong thi vua chon xong lai nhay lung tung.
  lensState.suppressMapClick = true;
  setTimeout(() => {
    lensState.suppressMapClick = false;
  }, 0);

  if (drag.previewTo - drag.previewFrom < MINIMAP_MIN_RANGE_MS) clearFilterFacet('window');
  else {
    lensState.filter.timeFrom = drag.previewFrom;
    lensState.filter.timeTo = drag.previewTo;
    lensState.filter.hideOthers = true;
  }
  applyFilter(true);
  renderTab();
}

function handleMinimapHover(event) {
  if (minimapDrag || !lensState.data) return;
  const mode = resolveMinimapDragMode(event.clientX);
  lensState.el.map.style.cursor =
    mode === 'move' ? 'grab' : mode === 'create' ? 'crosshair' : 'col-resize';
}

function handleMinimapDoubleClick() {
  clearFilterFacet('window');
  applyFilter(true);
  renderTab();
}

function updateMinimapCursor(ts) {
  const cursor = lensState.el.cursor;
  if (!cursor) return;
  if (!ts) {
    cursor.style.opacity = '0';
    return;
  }
  const span = Math.max(1, lensState.data.lastTs - lensState.data.firstTs);
  cursor.style.left = (((ts - lensState.data.firstTs) / span) * 100).toFixed(2) + '%';
  cursor.style.opacity = '1';
}

/* ------------------------------------------------- keo tha va doi kich thuoc */

function clampValue(value, min, max) {
  return Math.max(min, Math.min(Math.max(min, max), value));
}

// Panel mac dinh neo phai (top/right/bottom trong CSS) nen chieu cao la ngam.
// Khi keo di hoac keo goc thi ghim han sang left/top/width/height de hai chieu deu chinh duoc.
function isPanelRightAnchored(panel) {
  return !panel.style.left || panel.style.left === 'auto';
}

function savePanelGeometry(panel) {
  const rect = panel.getBoundingClientRect();
  lensState.geometry = {
    width: rect.width,
    height: rect.height,
    left: rect.left,
    top: rect.top,
    isPinned: !isPanelRightAnchored(panel),
  };
}

function applyPanelGeometry(panel) {
  const geometry = lensState.geometry;
  if (!geometry) return;
  panel.style.width = geometry.width + 'px';
  if (!geometry.isPinned) return;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panel.style.left = clampValue(geometry.left, 0, window.innerWidth - 120) + 'px';
  panel.style.top = clampValue(geometry.top, 0, window.innerHeight - 60) + 'px';
  panel.style.height = geometry.height + 'px';
}

// mousemove/mouseup chi duoc gan trong luc keo roi go ngay, khong gan thuong tru:
// mountPanel() chay lai moi lan mo tu pill, gan thuong tru se cong don listener.
function enableDragAndResize(panel, header, edgeGrip, cornerGrip) {
  let mode = null;
  let origin = null;
  let pendingEvent = null;
  let isFramePending = false;

  function beginInteraction(nextMode, event) {
    const rect = panel.getBoundingClientRect();
    origin = {
      x: event.clientX,
      y: event.clientY,
      rect,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      wasRightAnchored: isPanelRightAnchored(panel),
    };
    mode = nextMode;
    if (nextMode !== 'edge') {
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.width = rect.width + 'px';
      panel.style.height = rect.height + 'px';
    }
    origin.committedLeft = undefined;
    panel.classList.add('fll-dragging');
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    event.preventDefault();
  }

  // mousemove ban day hon tan so khung hinh, nen gom lai mot lan cap nhat moi frame.
  function handleMove(event) {
    if (!mode) return;
    pendingEvent = event;
    if (isFramePending) return;
    isFramePending = true;
    requestAnimationFrame(applyPendingMove);
  }

  function applyPendingMove() {
    isFramePending = false;
    const event = pendingEvent;
    if (!mode || !event) return;

    if (mode === 'move') {
      // Di chuyen bang transform chu khong phai left/top: transform duoc compositor xu ly,
      // khong bat trinh duyet layout lai va ve lai vung panel (kem bong mo 70px) moi khung hinh.
      // Chot lai thanh left/top luc tha tay.
      const left = clampValue(event.clientX - origin.grabX, VIEWPORT_MARGIN - origin.rect.width + 140,
        window.innerWidth - 140);
      const top = clampValue(event.clientY - origin.grabY, 0, window.innerHeight - 60);
      origin.committedLeft = left;
      origin.committedTop = top;
      panel.style.transform = 'translate3d(' + (left - origin.rect.left) + 'px,' +
        (top - origin.rect.top) + 'px,0)';
      return;
    }

    if (mode === 'corner') {
      panel.style.width = clampValue(event.clientX - origin.rect.left, PANEL_MIN_WIDTH,
        window.innerWidth - origin.rect.left - VIEWPORT_MARGIN) + 'px';
      panel.style.height = clampValue(event.clientY - origin.rect.top, PANEL_MIN_HEIGHT,
        window.innerHeight - origin.rect.top - VIEWPORT_MARGIN) + 'px';
      return;
    }

    // 'edge': keo mep trai, giu nguyen mep phai o ca hai kieu neo.
    const width = clampValue(origin.rect.width + (origin.x - event.clientX), PANEL_MIN_WIDTH,
      origin.rect.right - VIEWPORT_MARGIN);
    panel.style.width = width + 'px';
    if (!origin.wasRightAnchored) panel.style.left = origin.rect.right - width + 'px';
  }

  function handleUp() {
    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('mouseup', handleUp);
    if (!mode) return;
    // Chot transform thanh vi tri that truoc khi do lai kich thuoc, khong thi getBoundingClientRect
    // van dang cong them phan dich chuyen.
    if (mode === 'move' && origin.committedLeft !== undefined) {
      panel.style.transform = '';
      panel.style.left = origin.committedLeft + 'px';
      panel.style.top = origin.committedTop + 'px';
    }
    mode = null;
    pendingEvent = null;
    panel.classList.remove('fll-dragging');
    document.body.style.userSelect = '';
    savePanelGeometry(panel);
  }

  header.addEventListener('mousedown', (event) => {
    if (event.target.closest('.fll-ico')) return;
    beginInteraction('move', event);
  });
  edgeGrip.addEventListener('mousedown', (event) => beginInteraction('edge', event));
  cornerGrip.addEventListener('mousedown', (event) => beginInteraction('corner', event));
}

/* ------------------------------------------------------------- phim tat */

// Esc chi thu ve pill, khong huy panel: neu huy thi khong con gi de bam mo lai.
// Nut "x" moi dong han, va Alt+L la duong quay lai — listener nay co y giu song sau khi dong.
//
// Da do tren trang that: khi trang admin nhan duoc Escape, chinh no goi removeChild go #fll-root
// ra khoi body (khong phai code o day — bay Element.prototype.remove khong bat duoc gi).
// Vi vay listener gan o capture phase tren window va chan lan truyen voi nhung phim minh xu ly,
// de trang khong bao gio thay Escape khi panel dang mo. LENS_KEY_LISTENER_OPTIONS phai dung
// y het nhau luc them va luc go, neu khac thi removeEventListener khong an.
const LENS_KEY_LISTENER_OPTIONS = true;

function isLensMounted() {
  return !!document.getElementById(ROOT_ID);
}

function handleShortcut(event) {
  // Instance cu (world khac) khong duoc gianh phim voi instance dang lam chu.
  if (!isLensOwner()) return;
  const target = event.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

  if (event.altKey && (event.code === 'KeyL' || event.key === 'l' || event.key === 'L')) {
    event.preventDefault();
    event.stopPropagation();
    if (!isLensMounted()) startLens(false);
    else if (!lensState.el.panel || !document.contains(lensState.el.panel)) mountPanel();
    return;
  }

  if (!isLensMounted()) return;
  if (event.key === 'n') {
    event.stopPropagation();
    moveMatch(1);
  } else if (event.key === 'N' || event.key === 'p') {
    event.stopPropagation();
    moveMatch(-1);
  } else if (event.key === 'Escape' && lensState.el.panel && document.contains(lensState.el.panel)) {
    event.preventDefault();
    event.stopPropagation();
    showPill();
  }
}
// AI-GENERATED END
