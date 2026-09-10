/*
File: src/03b-nav.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — nhay toi dong log, duyet ket qua khop, thanh dieu huong duoi
// Tach ra tu src/03-shell.js (992 dong / 67 ham). Cac file src/*.js duoc build.sh noi lai
// theo thu tu ten file va boc trong MOT IIFE nen van dung chung scope — tach chi de doc,
// khong doi cach chung goi nhau.

/* ---------------------------------------------------------------- dieu huong */

function jumpToIndex(domIndex) {
  const data = lensState.data;
  const entry = data.entries[domIndex];
  if (!entry || !entry.el) return;

  // Truoc day cho chay het 4085 phan tu de go class highlight moi lan bam n — chi can nho dong truoc do.
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
  // Nhay mot cai khi co danh sach MOI. Thanh nay nam duoi cung panel nen nguoi dung hay khong nhan ra
  // vua co gi do de duyet; nhay o day chi de keo mat xuong. Co y KHONG nhay moi lan bam n/p — luc do
  // nguoi dung dang nhin no roi, nhay nua thanh phien.
  flashFooter();
}

function flashFooter() {
  const info = lensState.el.info;
  const footer = info && info.parentElement;
  if (!footer || !lensState.matches.length) return;
  footer.classList.remove('fll-ft-flash');
  // Doc lai offsetWidth de trinh duyet ket thuc animation cu truoc khi gan lai class,
  // neu khong thi bam hai lan lien tiep se khong thay nhay lan thu hai.
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

// Thanh duoi cung tung luon hien va ghi "Chua chon gi de duyet" — dung nhung khong noi no LA gi,
// nen nguoi dung nhin qua khong biet de lam gi, ma van chiem cho.
// Nay AN HAN khi chua co gi de duyet. Chinh viec no hien ra (kem mot nhay mau accent) la loi gioi
// thieu: no chi xuat hien dung luc vua co mot danh sach dong de di qua.
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
// AI-GENERATED END
