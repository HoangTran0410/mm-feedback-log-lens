/*
File: src/03j-tooltip.js
Created At: 2026-09-10 23:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — tooltip tu ve, thay cho thuoc tinh title="" cua trinh duyet
//
// Vi sao phai tu ve: do tre truoc khi hien title="" do HE DIEU HANH quyet dinh, khong co CSS hay JS
// nao doi duoc. Panel nay day chu giai — moi hang, moi chip, moi tieu de muc deu co mot cai — nen luot
// chuot qua la tooltip nhay lien tuc va che mat phan giao dien phia sau. Doi sang data-tip roi tu ve
// thi kiem soat duoc ba thu: cho bao lau moi hien, rong toi da bao nhieu, va hien o dau.
//
// Dat trong #fll-root chu khong trong .fll-panel: panel co overflow:hidden nen tooltip sat mep panel
// se bi cat mat mot nua.

const TOOLTIP_DELAY_MS = 600;
// Lech xuong duoi va sang phai con tro. Chuot thuong di tu tren xuong / tu trai sang, nen huong nay
// che vao cho nguoi dung VUA roi khoi, khong che cho ho dang nhin toi.
const TOOLTIP_OFFSET_X = 14;
const TOOLTIP_OFFSET_Y = 18;
const TOOLTIP_MARGIN = 8;

let tooltipTimer = 0;

function ensureTooltip() {
  const root = lensState.el.root;
  if (!root) return null;
  if (lensState.el.tip && lensState.el.tip.parentNode === root) return lensState.el.tip;
  const tip = document.createElement('div');
  tip.className = 'fll-tip';
  tip.hidden = true;
  root.appendChild(tip);
  lensState.el.tip = tip;
  return tip;
}

function clearTooltipTimer() {
  if (!tooltipTimer) return;
  clearTimeout(tooltipTimer);
  tooltipTimer = 0;
}

function hideTooltip() {
  clearTooltipTimer();
  lensState.tipEl = null;
  if (lensState.el.tip) lensState.el.tip.hidden = true;
}

// Do xong moi dat: phai hien ra thi moi biet no rong cao bao nhieu de con lat len / day vao trong man.
function placeTooltip(el, clientX, clientY) {
  const text = el.getAttribute('data-tip');
  if (!text || !el.isConnected) return;
  const tip = ensureTooltip();
  if (!tip) return;
  tip.textContent = text;
  tip.hidden = false;

  const box = tip.getBoundingClientRect();
  let left = clientX + TOOLTIP_OFFSET_X;
  let top = clientY + TOOLTIP_OFFSET_Y;
  if (left + box.width > window.innerWidth - TOOLTIP_MARGIN) {
    left = Math.max(TOOLTIP_MARGIN, window.innerWidth - TOOLTIP_MARGIN - box.width);
  }
  // Khong du cho ben duoi thi lat len TREN con tro, chu khong ep sat day man hinh — ep sat day thi no
  // nam de len chinh cai dang tro toi.
  if (top + box.height > window.innerHeight - TOOLTIP_MARGIN) {
    top = Math.max(TOOLTIP_MARGIN, clientY - TOOLTIP_OFFSET_Y - box.height);
  }
  tip.style.left = Math.round(left) + 'px';
  tip.style.top = Math.round(top) + 'px';
}

function handleLensTooltip(event) {
  const target = event.target;
  const hit = target && target.closest ? target.closest('[data-tip]') : null;
  if (hit === lensState.tipEl) return;
  hideTooltip();
  if (!hit) return;
  lensState.tipEl = hit;
  const clientX = event.clientX;
  const clientY = event.clientY;
  tooltipTimer = setTimeout(() => {
    tooltipTimer = 0;
    if (lensState.tipEl === hit) placeTooltip(hit, clientX, clientY);
  }, TOOLTIP_DELAY_MS);
}
// AI-GENERATED END
