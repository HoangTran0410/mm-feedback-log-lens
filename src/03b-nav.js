/*
File: src/03b-nav.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
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
// AI-GENERATED END
