/*
File: src/03i-sections.js
Created At: 2026-09-10 18:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — bien moi tieu de muc (.fll-sec) thanh mot muc dong/mo duoc, nho trang thai qua phien
//
// Lam BANG CACH GOM LAI SAU KHI VE, khong sua tung renderer: cac renderer noi chuoi
// "<div class=fll-sec>Ten</div>" roi den noi dung, tuc muc chi la mot moc phang chu khong phai mot
// khoi bao ngoai. Neu doi sang khoi bao ngoai thi phai sua hon 20 cho va moi tab them sau nay lai
// phai nho lam theo. Gom o day thi chi mot cho biet chuyen nay, va tab moi tu dong co.

const SECTION_OPEN_KEY = 'fll.openSections';

/** @type {Set<string> | null} */
let openSectionKeys = null;

function loadOpenSections() {
  if (openSectionKeys) return openSectionKeys;
  openSectionKeys = new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(SECTION_OPEN_KEY));
    if (Array.isArray(raw)) raw.forEach((key) => openSectionKeys.add(String(key)));
  } catch (error) {
    // Rieng tu / du lieu cu hong: coi nhu chua mo muc nao, mac dinh van la dong het.
  }
  return openSectionKeys;
}

function persistOpenSections() {
  try {
    localStorage.setItem(SECTION_OPEN_KEY, JSON.stringify(Array.from(loadOpenSections())));
  } catch (error) {
    // Khong luu duoc thi phien nay van dong/mo binh thuong, chi khong nho sang lan sau.
  }
}

// Khoa gom ca ten tab: hai tab co the co muc trung ten (vi du "Phiên app"), mo o tab nay khong co
// nghia la mo o tab kia.
function sectionKey(tabId, title) {
  return tabId + '::' + title;
}

function isSectionOpen(tabId, title) {
  return loadOpenSections().has(sectionKey(tabId, title));
}

function setSectionOpen(key, isOpen) {
  const keys = loadOpenSections();
  if (isOpen) keys.add(key);
  else keys.delete(key);
  persistOpenSections();
}

// Bo qua the khong phai element (children chi tra ve element) va the .fll-sec long trong khoi khac —
// chi quet dung cap con truc tiep cua vung than, dung noi cac renderer dat tieu de muc.
function collapsifySections(container, tabId) {
  if (!container || !container.children) return;
  const nodes = Array.from(container.children);
  let bodyOfCurrentSection = null;
  nodes.forEach((node) => {
    if (!node.classList || !node.classList.contains('fll-sec')) {
      if (bodyOfCurrentSection) bodyOfCurrentSection.appendChild(node);
      return;
    }
    // Lay data-sec chu khong lay textContent: textContent con dinh ca badge ("Phiên app3 phiên"),
    // ma badge doi theo tung log — dung no lam khoa thi mo o log nay, sang log khac lai thay dong.
    const title = node.getAttribute('data-sec') || (node.textContent || '').trim();
    const key = sectionKey(tabId, title);
    const wrap = document.createElement('div');
    wrap.className = 'fll-secw' + (loadOpenSections().has(key) ? ' open' : '');
    container.insertBefore(wrap, node);
    node.setAttribute('data-act', 'tglSec');
    node.setAttribute('data-value', key);
    node.setAttribute('data-tip', 'Bấm để mở / thu mục này');
    node.insertAdjacentHTML('afterbegin', '<span class="fll-caret">&#9656;</span>');
    wrap.appendChild(node);
    bodyOfCurrentSection = document.createElement('div');
    bodyOfCurrentSection.className = 'fll-secb';
    wrap.appendChild(bodyOfCurrentSection);
  });
  // Chen o tim SAU khi da chuyen het noi dung vao than muc — luc gom o tren than con dang rong.
  Array.from(container.querySelectorAll('.fll-secb')).forEach(addSectionSearch);
}

// Mot muc co bao nhieu hang thi moi dang co o tim. Duoi nguong nay thi liec mat la thay het.
const SECTION_SEARCH_MIN_ROWS = 6;

// Hang cua mot muc khong phai luc nao cung la con truc tiep cua than muc: nhieu danh sach duoc boc
// trong DUNG MOT the (.fll-rank, .fll-lvkey, #fll-issue-list), luc do dem con truc tiep ra 1 va o tim
// se khong bao gio duoc chen. Neu than muc chi co mot the con ma the do lai co nhieu con thi chinh
// no moi la cho chua hang.
function sectionRowContainer(sectionBody) {
  const kids = Array.from(sectionBody.children).filter((node) => node.classList &&
    !node.classList.contains('fll-hint') && !node.classList.contains('fll-secq') &&
    !node.classList.contains('fll-secq-note'));
  if (kids.length === 1 && kids[0].children && kids[0].children.length > 1) return kids[0];
  return sectionBody;
}

function sectionRows(container, box) {
  return Array.from(container.children).filter((node) => node !== box && node.classList &&
    !node.classList.contains('fll-hint') && !node.classList.contains('fll-secq') &&
    !node.classList.contains('fll-secq-note'));
}

// Chen o tim vao ngay trong muc, SAU KHI VE, thay vi sua tung renderer. Do that: moi o tim kieu cu
// (#fll-q, #fll-httpq, #fll-modq, #fll-tlq) deu phai sua o hai file — them mot truong tabUiState, mot
// nhanh trong handleLensInput, mot the input, mot id container. Nhan len ~20 muc la ~80 cho sua va moi
// muc them sau nay lai phai nho lam theo. Lam o day thi mot cho biet, moi muc du dai deu tu co.
//
// Danh doi: o nay loc tren DOM DA VE, nen muc nao phan trang (danh sach nhom loi) thi no chi tim trong
// trang dang hien. Vi vay muc nao DA co o tim rieng (tim tren toan bo du lieu) thi bo qua, khong chen.
// Nhieu muc chi ve mot phan (bang xep hang cat con 8 hang, danh sach nhom co phan trang) trong khi
// badge tren tieu de ghi TONG. O tim chi tim duoc phan da ve, nen no phai noi ro dieu do — neu khong
// se ra canh "muc ghi 64 module, go ten mot module co that, bao khong khop".
function sectionShownTotal(sectionBody) {
  const header = sectionBody.parentElement && sectionBody.parentElement.querySelector('.fll-secbdg');
  const badge = header ? parseInt(header.textContent, 10) : NaN;
  return Number.isNaN(badge) ? 0 : badge;
}

function addSectionSearch(sectionBody) {
  if (sectionBody.querySelector('input')) return;
  const container = sectionRowContainer(sectionBody);
  const shown = sectionRows(container, null).length;
  if (shown < SECTION_SEARCH_MIN_ROWS) return;
  const total = sectionShownTotal(sectionBody);
  const box = document.createElement('input');
  box.className = 'fll-in fll-secq';
  box.setAttribute('placeholder', total > shown
    ? 'Tìm trong ' + shown + ' mục đang hiện (mục có ' + total + ')...'
    : 'Tìm nhanh trong mục này...');
  sectionBody.insertBefore(box, sectionBody.firstChild);
}

// Loc ngay tren DOM: khong ve lai gi ca nen khong mat tieu diem, khong can debounce.
function filterSectionRows(box) {
  const sectionBody = box.parentElement;
  const container = sectionRowContainer(sectionBody);
  const query = box.value.trim().toLowerCase();
  const rows = sectionRows(container, box);
  let shown = 0;
  rows.forEach((node) => {
    const hit = !query || (node.textContent || '').toLowerCase().indexOf(query) >= 0;
    node.hidden = !hit;
    if (hit) shown += 1;
  });
  let note = sectionBody.querySelector('.fll-secq-note');
  if (!query) {
    if (note) note.remove();
    return;
  }
  if (!note) {
    note = document.createElement('div');
    note.className = 'fll-hint fll-secq-note';
    sectionBody.insertBefore(note, box.nextSibling);
  }
  const total = sectionShownTotal(sectionBody);
  const chuaVe = total > rows.length ? ' — mục có ' + total + ', ô này chỉ tìm trong phần đang hiện' : '';
  note.textContent = (shown ? 'Khớp ' + shown + '/' + rows.length : 'Không mục nào khớp') + chuaVe + '.';
}

// Dong/mo TAI CHO, khong ve lai ca tab: ve lai se mat vi tri cuon va lam mat luon o tim dang go do.
function toggleSection(header) {
  const wrap = header.parentElement;
  if (!wrap || !wrap.classList.contains('fll-secw')) return;
  const isOpen = !wrap.classList.contains('open');
  wrap.classList.toggle('open', isOpen);
  setSectionOpen(header.getAttribute('data-value') || '', isOpen);
  hideAim();
}

// Mo muc dang chua phan tu nay ra roi moi cuon toi. Khong co buoc nay thi cac loi tat ("bấm thẻ phiên
// app o Tong quan") se cuon toi mot cho dang bi dong, tuc khong thay gi.
function revealElement(el) {
  let node = el;
  while (node && node !== lensState.el.body) {
    if (node.classList && node.classList.contains('fll-secw') && !node.classList.contains('open')) {
      node.classList.add('open');
      const header = node.querySelector('.fll-sec');
      if (header) setSectionOpen(header.getAttribute('data-value') || '', true);
    }
    node = node.parentElement;
  }
}
// AI-GENERATED END
