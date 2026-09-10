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
    node.setAttribute('title', 'Bấm để mở / thu mục này');
    node.insertAdjacentHTML('afterbegin', '<span class="fll-caret">&#9656;</span>');
    wrap.appendChild(node);
    bodyOfCurrentSection = document.createElement('div');
    bodyOfCurrentSection.className = 'fll-secb';
    wrap.appendChild(bodyOfCurrentSection);
  });
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
