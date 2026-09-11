// @ts-check
// rê chuột trên bảng log của trang: chỉ vị trí dòng đó lên minimap, và làm panel trong suốt để đọc
// xuyên qua
//
// Panel rộng 480px nằm đè lên phần bên phải bảng log — đúng chỗ đuôi của những dòng dài. Thay vì bắt
// người dùng thu panel lại (Esc) rồi mở ra, cho nó mờ đi trong lúc chuột đang ở trên bảng log.
//
// KHÔNG đặt `opacity` lên chính `.fll-panel`: opacity gộp cả cây con thành một lớp, con không bao giờ
// sáng hơn cha — minimap sẽ mờ theo, mà minimap lại chính là thứ cần nhìn rõ lúc đó. Cách làm: nền
// panel chuyển sang màu có alpha, rồi mờ TỪNG ĐỨA CON trừ minimap và nhãn của nó.
//
// Mốc kích hoạt là "chuột đang trên bảng log", không phải "chuột rời khỏi panel". Hai cái khác nhau
// rất xa: chuột nằm ngoài panel gần như suốt thời gian, lấy mốc đó thì panel mờ là trạng thái mặc
// định và nó nhấp nháy mỗi lần chuột đi ngang. Còn "đang ở trên bảng log" thì đúng bằng lúc người
// dùng đang đọc log.

let pageHoverRow = null;

// Dòng không có giờ (dòng tiếp nối của stack trace) thừa hưởng giờ của dòng trên nó qua windowTs —
// dùng luôn ở đây, nếu không thì rê vào giữa một stack trace là vạch trên minimap tắt ngóm.
function pageRowTs(entry) {
  return entry.ts || entry.windowTs || 0;
}

function setXray(isOn) {
  const panel = lensState.el.panel;
  if (!panel) return;
  panel.classList.toggle('fll-xray', isOn);
}

function handlePageRowHover(event) {
  if (!lensState.data || !lensState.el.panel) return;
  const target = event.target;
  const row = target && target.closest ? target.closest(ROW_SELECTOR) : null;
  setXray(true);
  // mouseover bắn một lần mỗi lần vào một phần tử mới, nên chỉ cần chặn "vẫn đúng dòng cũ" là đủ;
  // không cần hẹn giờ tiết chế, và cũng không nên có: rê tới dòng nào phải thấy ngay dòng đó.
  if (!row || row === pageHoverRow) return;
  pageHoverRow = row;
  const entry = lensState.rowEntries ? lensState.rowEntries.get(row) : null;
  if (!entry) return;
  updateMinimapCursor(pageRowTs(entry));
  const text = lensState.el.mapText;
  if (!text) return;
  text.textContent = (pageRowTs(entry) ? formatClock(pageRowTs(entry)) + ' · ' : '') + 'dòng ' + entry.lineNo;
  text.classList.add('aiming');
}

function handlePageLeave() {
  pageHoverRow = null;
  setXray(false);
  // Không cần kiểm el.map: updateMinimapCursor và updateMinimapRange đều tự thoát khi chưa có phần tử,
  // mà thêm một điều kiện nữa ở đây thì lúc panel chưa dựng xong, vạch cũ sẽ nằm lại trên minimap.
  if (!lensState.data) return;
  updateMinimapCursor(0);
  if (lensState.el.mapText) lensState.el.mapText.classList.remove('aiming');
  // Trả dòng chữ giữa nhãn minimap về đúng trạng thái bộ lọc hiện tại.
  updateMinimapRange();
}

// Tra "phần tử dòng -> entry" bằng WeakMap thay vì indexOf trên mảng rowEls: rê chuột bắn liên tục,
// mà WeakMap còn tự buông khi trang thay DOM nên không giữ sống node đã bị gỡ.
function indexRowElements(data) {
  const map = new WeakMap();
  data.entries.forEach((entry) => {
    if (entry.el) map.set(entry.el, entry);
  });
  lensState.rowEntries = map;
}

function attachPageHover(container) {
  if (!container || lensState.el.hoverContainer === container) return;
  detachPageHover();
  container.addEventListener('mouseover', handlePageRowHover);
  container.addEventListener('mouseleave', handlePageLeave);
  lensState.el.hoverContainer = container;
}

function detachPageHover() {
  const container = lensState.el.hoverContainer;
  if (container) {
    container.removeEventListener('mouseover', handlePageRowHover);
    container.removeEventListener('mouseleave', handlePageLeave);
  }
  lensState.el.hoverContainer = null;
  pageHoverRow = null;
  setXray(false);
}
