// @ts-check
// minimap mật độ log và thao tác kéo chọn khoảng thời gian trên nó
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

/* ----------------------------------------------------------------- minimap */

// Minimap vẽ trong khoảng nào: cả log, hay chỉ khoảng đang phóng to. Mọi chỗ quy đổi thời gian <-> toạ
// độ đều phải đi qua đây, nếu không thì phóng to xong vạch đánh dấu và vị trí cuộn sẽ lệch hết.
function minimapBounds() {
  const zoom = lensState.mapZoom;
  if (zoom) return { from: zoom.from, to: zoom.to };
  return { from: lensState.data.firstTs, to: lensState.data.lastTs };
}

function buildBuckets(count) {
  const data = lensState.data;
  const bounds = minimapBounds();
  const span = Math.max(1, bounds.to - bounds.from);
  const buckets = [];
  for (let i = 0; i < count; i += 1) buckets.push({ ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0, total: 0, firstIndex: -1 });
  data.entries.forEach((entry) => {
    if (!entry.ts || !entry.level) return;
    if (entry.ts < bounds.from || entry.ts > bounds.to) return;
    const slot = Math.min(count - 1, Math.floor(((entry.ts - bounds.from) / span) * count));
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
      const bounds = minimapBounds();
      const title = bucket.total
        ? formatClock(bounds.from + ((bounds.to - bounds.from) * index) / MINIMAP_BUCKETS) +
          ' · ' + bucket.total + ' dòng (' + bucket.ERROR + ' lỗi, ' + bucket.WARNING + ' cảnh báo)'
        : 'không có log';
      return '<i data-bucket="' + bucket.firstIndex + '" data-tip="' + escapeHtml(title) + '" style="height:' +
        height.toFixed(1) + '%;background:' + color + '"></i>';
    })
    .join('');
  // Minimap cố ý giữ NGUYÊN toàn dải: nó là tấm bản đồ "đang ở đâu trong cả log".
  // Bộ lọc thời gian chỉ làm mờ phần ngoài cửa sổ, vẫn thấy được toàn cảnh.
  lensState.el.map.innerHTML = columns +
    '<div class="fll-shade fll-shade-l"></div><div class="fll-shade fll-shade-r"></div>' +
    '<div class="fll-cursor"></div>';
  lensState.el.cursor = lensState.el.map.querySelector('.fll-cursor');
  lensState.el.shadeLeft = lensState.el.map.querySelector('.fll-shade-l');
  lensState.el.shadeRight = lensState.el.map.querySelector('.fll-shade-r');
  const bounds = minimapBounds();
  lensState.el.mapLabel.innerHTML =
    '<span>' + formatClock(bounds.from) + '</span>' +
    '<span class="fll-maptext"></span>' +
    (lensState.mapZoom
      ? '<span class="fll-maprow">' + formatClock(bounds.to) +
        '<button class="fll-mapzoom on" data-act="mapZoomOut" data-tip="Lùi một nấc phóng to' +
        (lensState.mapZoomStack.length > 1
          ? ' — còn ' + (lensState.mapZoomStack.length - 1) + ' nấc nữa mới về cả log'
          : ' — về lại cả log') + '">&#8617;</button>' +
        // Chỉ hiện khi còn NHIỀU HƠN một nấc: còn đúng một nấc thì nó làm y hệt nút lùi, để cạnh nhau
        // hai nút giống nhau chỉ tổ người dùng phải đoán xem chúng khác gì.
        (lensState.mapZoomStack.length > 1
          ? '<button class="fll-mapzoom" data-act="mapZoomReset" data-tip="Xoá cả ' +
            lensState.mapZoomStack.length + ' nấc phóng to, về thẳng toàn bộ log">&#10005;</button>'
          : '') + '</span>'
      : '<span>' + formatClock(bounds.to) + '</span>');
  lensState.el.map.classList.toggle('fll-map-zoomed', !!lensState.mapZoom);
  lensState.el.mapText = lensState.el.mapLabel.querySelector('.fll-maptext');
  updateMinimapRange();
}

function updateMinimapRange() {
  const shadeLeft = lensState.el.shadeLeft;
  const shadeRight = lensState.el.shadeRight;
  if (!shadeLeft || !shadeRight || !lensState.data) return;
  const bounds = minimapBounds();
  const span = Math.max(1, bounds.to - bounds.from);
  const range = getVisibleTimeRange();
  shadeLeft.style.width =
    Math.max(0, Math.min(100, ((range.from - bounds.from) / span) * 100)).toFixed(2) + '%';
  shadeRight.style.width =
    Math.max(0, Math.min(100, ((bounds.to - range.to) / span) * 100)).toFixed(2) + '%';
  lensState.el.map.classList.toggle('fll-map-ranged', hasSelectedTimeRange());
  if (!lensState.el.mapText) return;
  if (hasSelectedTimeRange()) {
    lensState.el.mapText.innerHTML = escapeHtml(formatClock(range.from) + ' → ' + formatClock(range.to) +
      ' · ' + formatDuration(range.to - range.from)) +
      (canZoomFurther(range, bounds) ? ' <button class="fll-mapzoom" data-act="mapZoomIn" ' +
        'data-tip="Phóng minimap vào đúng khoảng này để nhìn rõ từng mốc">&#8596; phóng to</button>' : '');
    return;
  }
  lensState.el.mapText.textContent = lensState.mapZoom
    ? 'đang phóng to · kéo để chọn khoảng nhỏ hơn'
    : 'kéo để chọn khoảng · bấm để nhảy · nháy đúp để bỏ chọn';
}

// Nút "phóng to" hiện khi khoảng đang chọn NHỎ HƠN khung minimap đang vẽ — không quan tâm đã phóng
// to hay chưa. Trước đây cứ thấy đang phóng to là ẩn nút, nên chọn tiếp một khoảng nhỏ hơn bên trong
// vùng đã phóng thì không còn đường nào phóng sâu nữa. Chỉ giấu khi chọn đúng bằng khung đang vẽ, lúc
// đó bấm vào không đổi được gì.
function canZoomFurther(range, bounds) {
  return range.from > bounds.from || range.to < bounds.to;
}

function hasAnyTimeRange() {
  return lensState.filter.timeFrom !== null || lensState.filter.timeTo !== null;
}

// "Có khoảng đang chọn không" phải hỏi getVisibleTimeRange(), không hỏi riêng timeFrom/timeTo: lọc
// theo PHIÊN APP cũng thu khoảng đang xem về đúng phiên đó (getVisibleTimeRange cắt theo start/endTs
// của phiên) mà không đụng tới hai trường kia. Vì vậy minimap vẫn tô mờ hai bên đúng phiên nhưng lại
// không hiện nút phóng to — muốn phóng vào một phiên thì phải tự kéo tay lại đúng khoảng đã được tô
// sẵn. Hai câu hỏi đó phải cho cùng một câu trả lời, nếu không thì phần tô và cái nút nói khác nhau.
function hasSelectedTimeRange() {
  if (hasAnyTimeRange()) return true;
  const range = getVisibleTimeRange();
  return range.from > lensState.data.firstTs || range.to < lensState.data.lastTs;
}

/* ------------------------------------------- kéo chọn khoảng thời gian trên minimap */

const MINIMAP_EDGE_GRAB_PX = 7;
const MINIMAP_MIN_RANGE_MS = 500;

let minimapDrag = null;

function minimapTsFromClientX(clientX) {
  const rect = lensState.el.map.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  const bounds = minimapBounds();
  return bounds.from + ratio * Math.max(1, bounds.to - bounds.from);
}

// Ép về trong bề ngang của minimap: khi đang phóng to, mốc nằm ngoài khung sẽ cho toạ độ âm hoặc vượt
// ra ngoài — ép vào mép để mũi tên vẫn chỉ đúng "nó ở phía bên kia" thay vì vẽ ra ngoài panel.
function minimapClientXFromTs(ts) {
  const rect = lensState.el.map.getBoundingClientRect();
  const bounds = minimapBounds();
  const ratio = (ts - bounds.from) / Math.max(1, bounds.to - bounds.from);
  return rect.left + Math.max(0, Math.min(1, ratio)) * rect.width;
}

// Chỉ vẽ lại hai miếng mờ trong lúc kéo. Áp bộ lọc thật sự đòi một lượt 4085 dòng + layout bảng log,
// nặng quá để chạy theo từng nhịp chuột — nên chỉ commit lúc thả tay.
function previewMinimapRange(from, to) {
  const bounds = minimapBounds();
  const span = Math.max(1, bounds.to - bounds.from);
  lensState.el.shadeLeft.style.width =
    Math.max(0, Math.min(100, ((from - bounds.from) / span) * 100)).toFixed(2) + '%';
  lensState.el.shadeRight.style.width =
    Math.max(0, Math.min(100, ((bounds.to - to) / span) * 100)).toFixed(2) + '%';
  if (lensState.el.mapText) {
    lensState.el.mapText.textContent = formatClock(from) + ' → ' + formatClock(to) +
      ' · ' + formatDuration(Math.max(0, to - from));
  }
}

function resolveMinimapDragMode(clientX) {
  const filter = lensState.filter;
  if (filter.timeFrom === null && filter.timeTo === null) return 'create';
  const range = getVisibleTimeRange();
  // Vùng sáng phủ kín cả minimap (hay gặp ngay sau khi phóng to: khung vẽ đúng bằng khoảng đang chọn)
  // thì "dời" và "co giãn" đều vô nghĩa — không còn chỗ nào để dời tới. Coi mọi cú kéo là chọn mới,
  // nếu không thì phóng to xong là không thể chọn một khoảng nhỏ hơn nữa.
  const bounds = minimapBounds();
  if (range.from <= bounds.from && range.to >= bounds.to) return 'create';
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
  const bounds = minimapBounds();
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
    if (from < bounds.from) {
      to += bounds.from - from;
      from = bounds.from;
    }
    if (to > bounds.to) {
      from -= to - bounds.to;
      to = bounds.to;
    }
  }
  void data;

  minimapDrag.previewFrom = Math.max(bounds.from, from);
  minimapDrag.previewTo = Math.min(bounds.to, to);
  previewMinimapRange(minimapDrag.previewFrom, minimapDrag.previewTo);
}

function handleMinimapMouseUp() {
  window.removeEventListener('mousemove', handleMinimapMouseMove);
  window.removeEventListener('mouseup', handleMinimapMouseUp);
  const drag = minimapDrag;
  minimapDrag = null;
  // Bấm không kéo: để nguyên cho handleLensClick nhảy tới mốc đó như cũ.
  if (!drag || !drag.hasMoved) return;
  // Đã kéo thì chặn cú click sinh ra ngay sau mouseup, không thì vừa chọn xong lại nhảy lung tung.
  lensState.suppressMapClick = true;
  setTimeout(() => {
    lensState.suppressMapClick = false;
  }, 0);

  if (drag.previewTo - drag.previewFrom < MINIMAP_MIN_RANGE_MS) clearFilterFacet('window');
  else {
    lensState.filter.timeFrom = drag.previewFrom;
    lensState.filter.timeTo = drag.previewTo;
    // Kéo tay là khoảng tự chọn: không còn là preset nào nữa, chip "N phút cuối" phải tắt.
    lensState.filter.windowPreset = null;
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
  const bounds = minimapBounds();
  const ratio = (ts - bounds.from) / Math.max(1, bounds.to - bounds.from);
  if (ratio < 0 || ratio > 1) {
    // Dòng đang cuộn tới nằm ngoài khung đang phóng to: ẩn vạch đi còn hơn là ghim nó ở mép, vì ghim
    // ở mép thì người đọc tưởng mình đang ở đầu khoảng.
    cursor.style.opacity = '0';
    return;
  }
  cursor.style.left = (ratio * 100).toFixed(2) + '%';
  cursor.style.opacity = '1';
}
