// @ts-check
// tooltip tự vẽ, thay cho thuộc tính title="" của trình duyệt
//
// Vì sao phải tự vẽ: độ trễ trước khi hiện title="" do HỆ ĐIỀU HÀNH quyết định, không có CSS hay JS
// nào đổi được. Panel này đầy chú giải — mỗi hàng, mỗi chip, mỗi tiêu đề mục đều có một cái — nên lướt
// chuột qua là tooltip nhảy liên tục và che mất phần giao diện phía sau. Đổi sang data-tip rồi tự vẽ
// thì kiểm soát được ba thứ: chờ bao lâu mới hiện, rộng tối đa bao nhiêu, và hiện ở đâu.
//
// Đặt trong #fll-root chứ không trong .fll-panel: panel có overflow:hidden nên tooltip sát mép panel
// sẽ bị cắt mất một nửa.

const TOOLTIP_DELAY_MS = 600;
// Lệch xuống dưới và sang phải con trỏ. Chuột thường đi từ trên xuống / từ trái sang, nên hướng này
// che vào chỗ người dùng VỪA rời khỏi, không che chỗ họ đang nhìn tới.
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

// Đo xong mới đặt: phải hiện ra thì mới biết nó rộng cao bao nhiêu để còn lật lên / đẩy vào trong màn.
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
  // Không đủ chỗ bên dưới thì lật lên TRÊN con trỏ, chứ không ép sát đáy màn hình — ép sát đáy thì nó
  // nằm đè lên chính cái đang trỏ tới.
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
