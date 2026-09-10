// @ts-check
// kéo thả panel, đổi kích thước, nhớ lại vị trí
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

/* ------------------------------------------------- kéo thả và đổi kích thước */

function clampValue(value, min, max) {
  return Math.max(min, Math.min(Math.max(min, max), value));
}

// Panel mặc định neo phải (top/right/bottom trong CSS) nên chiều cao là ngầm.
// Khi kéo đi hoặc kéo góc thì ghim hẳn sang left/top/width/height để hai chiều đều chỉnh được.
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

// mousemove/mouseup chỉ được gắn trong lúc kéo rồi gỡ ngay, không gắn thường trú:
// mountPanel() chạy lại mỗi lần mở từ pill, gắn thường trú sẽ cộng dồn listener.
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
      // Khai báo hẳn ở đây thay vì gán thêm sau: gán thêm thì gõ sai tên một chữ là im lặng hỏng.
      /** @type {number | undefined} */
      committedLeft: undefined,
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
    panel.classList.add('fll-dragging');
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    event.preventDefault();
  }

  // mousemove bắn dày hơn tần số khung hình, nên gom lại một lần cập nhật mỗi frame.
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
      // Di chuyển bằng transform chứ không phải left/top: transform được compositor xử lý,
      // không bắt trình duyệt layout lại và vẽ lại vùng panel (kèm bóng mờ 70px) mỗi khung hình.
      // Chốt lại thành left/top lúc thả tay.
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

    // 'edge': kéo mép trái, giữ nguyên mép phải ở cả hai kiểu neo.
    const width = clampValue(origin.rect.width + (origin.x - event.clientX), PANEL_MIN_WIDTH,
      origin.rect.right - VIEWPORT_MARGIN);
    panel.style.width = width + 'px';
    if (!origin.wasRightAnchored) panel.style.left = origin.rect.right - width + 'px';
  }

  function handleUp() {
    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('mouseup', handleUp);
    if (!mode) return;
    // Chốt transform thành vị trí thật trước khi đo lại kích thước, không thì getBoundingClientRect
    // vẫn đang cộng thêm phần dịch chuyển.
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

/* ------------------------------------------------------------- phím tắt */

// Esc chỉ thu về pill, không huỷ panel: nếu huỷ thì không còn gì để bấm mở lại.
// Nút "x" mới đóng hẳn, và Alt+L là đường quay lại — listener này cố ý giữ sống sau khi đóng.
//
// Đã đo trên trang thật: khi trang admin nhận được Escape, chính nó gọi removeChild gỡ #fll-root
// ra khỏi body (không phải code ở đây — bẫy Element.prototype.remove không bắt được gì).
// Vì vậy listener gắn ở capture phase trên window và chặn lan truyền với những phím mình xử lý,
// để trang không bao giờ thấy Escape khi panel đang mở. LENS_KEY_LISTENER_OPTIONS phải đúng
// y hệt nhau lúc thêm và lúc gỡ, nếu khác thì removeEventListener không ăn.
const LENS_KEY_LISTENER_OPTIONS = true;

function isLensMounted() {
  return !!document.getElementById(ROOT_ID);
}

function handleShortcut(event) {
  // Instance cũ (world khác) không được giành phím với instance đang làm chủ.
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
