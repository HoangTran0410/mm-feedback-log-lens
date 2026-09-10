/*
File: src/03g-panel.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — keo tha panel, doi kich thuoc, nho lai vi tri
// Tach ra tu src/03-shell.js (992 dong / 67 ham). Cac file src/*.js duoc build.sh noi lai
// theo thu tu ten file va boc trong MOT IIFE nen van dung chung scope — tach chi de doc,
// khong doi cach chung goi nhau.

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
      // Khai bao han o day thay vi gan them sau: gan them thi go sai ten mot chu la im lang hong.
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
