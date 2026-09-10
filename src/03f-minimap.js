/*
File: src/03f-minimap.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — minimap mat do log va thao tac keo chon khoang thoi gian tren no
// Tach ra tu src/03-shell.js (992 dong / 67 ham). Cac file src/*.js duoc build.sh noi lai
// theo thu tu ten file va boc trong MOT IIFE nen van dung chung scope — tach chi de doc,
// khong doi cach chung goi nhau.

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
// AI-GENERATED END
