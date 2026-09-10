// @ts-check
// nhảy tới dòng log, duyệt kết quả khớp, thanh điều hướng dưới
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

/* ---------------------------------------------------------------- điều hướng */

function jumpToIndex(domIndex) {
  const data = lensState.data;
  const entry = data.entries[domIndex];
  if (!entry || !entry.el) return;

  // Trước đây cho chạy hết 4085 phần tử để gỡ class highlight mỗi lần bấm n — chỉ cần nhớ dòng trước đó.
  if (lensState.el.lastHit && lensState.el.lastHit !== entry.el) lensState.el.lastHit.classList.remove('fll-hit');
  if (!isRowVisible(entry)) {
    lensState.forcedVisibleIndices.add(domIndex);
    forceRowVisible(entry);
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
  // Nháy một cái khi có danh sách MỚI. Thanh này nằm dưới cùng panel nên người dùng hay không nhận ra
  // vừa có gì đó để duyệt; nháy ở đây chỉ để kéo mắt xuống. Cố ý KHÔNG nháy mỗi lần bấm n/p — lúc đó
  // người dùng đang nhìn nó rồi, nháy nữa thành phiền.
  flashFooter();
}

function flashFooter() {
  const info = lensState.el.info;
  const footer = info && info.parentElement;
  if (!footer || !lensState.matches.length) return;
  footer.classList.remove('fll-ft-flash');
  // Đọc lại offsetWidth để trình duyệt kết thúc animation cũ trước khi gắn lại class,
  // nếu không thì bấm hai lần liên tiếp sẽ không thấy nháy lần thứ hai.
  void footer.offsetWidth;
  footer.classList.add('fll-ft-flash');
}

function moveMatch(step) {
  const total = lensState.matches.length;
  if (!total) return;
  lensState.matchPos = (lensState.matchPos + step + total) % total;
  jumpToIndex(lensState.matches[lensState.matchPos]);
  renderFooter();
}

// Thanh dưới cùng từng luôn hiện và ghi "Chưa chọn gì để duyệt" — đúng nhưng không nói nó LÀ gì,
// nên người dùng nhìn qua không biết để làm gì, mà vẫn chiếm chỗ.
// Nay ẨN HẲN khi chưa có gì để duyệt. Chính việc nó hiện ra (kèm một nháy màu accent) là lời giới
// thiệu: nó chỉ xuất hiện đúng lúc vừa có một danh sách dòng để đi qua.
function renderFooter() {
  const info = lensState.el.info;
  if (!info) return;
  const footer = /** @type {HTMLElement | null} */ (info.parentElement);
  const total = lensState.matches.length;

  if (footer) footer.hidden = !total;
  if (!total) {
    info.innerHTML = '';
    return;
  }

  const entry = lensState.data.entries[lensState.matches[Math.max(0, lensState.matchPos)]];
  info.innerHTML =
    '<span class="fll-ft-tag">đang duyệt</span>' +
    '<b class="fll-ft-pos">' + (lensState.matchPos + 1) + '/' + total + '</b> ' +
    '<span class="fll-ft-lbl">' + escapeHtml(lensState.matchLabel) + '</span>' +
    '<span class="fll-ft-line">#<b>' + (entry ? entry.lineNo : '?') + '</b></span>';
}
