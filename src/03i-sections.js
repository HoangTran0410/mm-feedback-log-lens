// @ts-check
// biến mỗi tiêu đề mục (.fll-sec) thành một mục đóng/mở được, nhớ trạng thái qua phiên
//
// Làm BẰNG CÁCH GOM LẠI SAU KHI VẼ, không sửa từng renderer: các renderer nối chuỗi
// "<div class=fll-sec>Tên</div>" rồi đến nội dung, tức mục chỉ là một mốc phẳng chứ không phải một
// khối bao ngoài. Nếu đổi sang khối bao ngoài thì phải sửa hơn 20 chỗ và mỗi tab thêm sau này lại
// phải nhớ làm theo. Gom ở đây thì chỉ một chỗ biết chuyện này, và tab mới tự động có.

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
    // Riêng tư / dữ liệu cũ hỏng: coi như chưa mở mục nào, mặc định vẫn là đóng hết.
  }
  return openSectionKeys;
}

function persistOpenSections() {
  try {
    localStorage.setItem(SECTION_OPEN_KEY, JSON.stringify(Array.from(loadOpenSections())));
  } catch (error) {
    // Không lưu được thì phiên này vẫn đóng/mở bình thường, chỉ không nhớ sang lần sau.
  }
}

// Khoá gồm cả tên tab: hai tab có thể có mục trùng tên (ví dụ "Phiên app"), mở ở tab này không có
// nghĩa là mở ở tab kia.
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

// Bỏ qua thẻ không phải element (children chỉ trả về element) và thẻ .fll-sec lồng trong khối khác —
// chỉ quét đúng cấp con trực tiếp của vùng thân, đúng nơi các renderer đặt tiêu đề mục.
function collapsifySections(container, tabId) {
  if (!container || !container.children) return;
  const nodes = Array.from(container.children);
  let bodyOfCurrentSection = null;
  nodes.forEach((node) => {
    if (!node.classList || !node.classList.contains('fll-sec')) {
      if (bodyOfCurrentSection) bodyOfCurrentSection.appendChild(node);
      return;
    }
    // Lấy data-sec chứ không lấy textContent: textContent còn dính cả badge ("Phiên app3 phiên"),
    // mà badge đổi theo từng log — dùng nó làm khoá thì mở ở log này, sang log khác lại thấy đóng.
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
  // Chèn ô tìm SAU khi đã chuyển hết nội dung vào thân mục — lúc gom ở trên thân còn đang rỗng.
  // Cắt bớt TRƯỚC ô tìm: ô tìm đọc số hàng đang hiện để viết đúng câu "tìm trong N mục đang hiện".
  Array.from(container.querySelectorAll('.fll-secb')).forEach(capSectionRows);
  Array.from(container.querySelectorAll('.fll-secb')).forEach(addSectionSearch);
}

// Cắt bớt hàng thừa của mục dài, SAU KHI VẼ — cùng cách đã dùng cho ô đóng/mở và ô tìm nhanh.
//
// Vì sao không cắt trong từng renderer: cắt ở đó thì TỔNG bị mất luôn. Đó là lỗi thật đã có:
// extractDurations cắt còn 80 hàng TRƯỚC khi trả về, nên badge ghi "80" trong khi log có 160 con số,
// mà chữ ngay dưới lại ghi "MỌI con số thời lượng". Cắt ở đây thì renderer trả về đủ, badge đúng, và
// phần bị giấu vẫn còn trong DOM để ô tìm và nút "Hiện thêm" chạm tới.
const SECTION_MAX_ROWS = 12;

// Mục tự quản lý phân trang (danh sách nhóm lỗi, danh sách mốc) đã có nút "Hiện thêm" riêng đọc theo
// dữ liệu đầy đủ — cắt thêm một lần nữa ở đây là cắt chồng lên phân trang của nó.
function hasOwnPaging(sectionBody) {
  return !!sectionBody.querySelector('[data-act="moreIssues"], [data-act="moreTimeline"]');
}

function capSectionRows(sectionBody) {
  if (hasOwnPaging(sectionBody)) return;
  const container = sectionRowContainer(sectionBody);
  const rows = sectionRows(container, null);
  if (rows.length <= SECTION_MAX_ROWS) return;
  rows.slice(SECTION_MAX_ROWS).forEach((node) => {
    node.hidden = true;
    node.setAttribute('data-capped', '1');
  });
  const button = document.createElement('button');
  button.className = 'fll-btn fll-secmore';
  button.setAttribute('data-act', 'moreSection');
  button.textContent = 'Hiện thêm — còn ' + (rows.length - SECTION_MAX_ROWS) + ' mục';
  sectionBody.appendChild(button);
}

// Bỏ hẳn giới hạn của mục đó (không bung từng nấc): một mục dài nhất cũng chỉ vài chục hàng, mà bấm
// hai ba lần mới thấy hết thì khó chịu hơn là cuộn.
function expandSection(button) {
  const sectionBody = button.parentElement;
  if (!sectionBody) return;
  Array.from(sectionBody.querySelectorAll('[data-capped]')).forEach((node) => {
    node.hidden = false;
    node.removeAttribute('data-capped');
  });
  button.remove();
  // Ô tìm vừa được nới rộng phạm vi: viết lại câu mô tả cho khỏi nói dối.
  const box = sectionBody.querySelector('.fll-secq');
  if (box) refreshSectionSearchScope(box);
}

// Một mục có bao nhiêu hàng thì mới đáng có ô tìm. Dưới ngưỡng này thì liếc mắt là thấy hết.
const SECTION_SEARCH_MIN_ROWS = 6;

// Hàng của một mục không phải lúc nào cũng là con trực tiếp của thân mục: nhiều danh sách được bọc
// trong ĐÚNG MỘT thẻ (.fll-rank, .fll-lvkey, #fll-issue-list), lúc đó đếm con trực tiếp ra 1 và ô tìm
// sẽ không bao giờ được chèn. Nếu thân mục chỉ có một thẻ con mà thẻ đó lại có nhiều con thì chính
// nó mới là chỗ chứa hàng.
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
    !node.classList.contains('fll-secmore') && !node.classList.contains('fll-secq-note'));
}

// Chèn ô tìm vào ngay trong mục, SAU KHI VẼ, thay vì sửa từng renderer. Đo thật: mỗi ô tìm kiểu cũ
// (#fll-q, #fll-httpq, #fll-modq, #fll-tlq) đều phải sửa ở hai file — thêm một trường tabUiState, một
// nhánh trong handleLensInput, một thẻ input, một id container. Nhân lên ~20 mục là ~80 chỗ sửa và mỗi
// mục thêm sau này lại phải nhớ làm theo. Làm ở đây thì một chỗ biết, mọi mục đủ dài đều tự có.
//
// Đánh đổi: ô này lọc trên DOM ĐÃ VẼ, nên mục nào phân trang (danh sách nhóm lỗi) thì nó chỉ tìm trong
// trang đang hiện. Vì vậy mục nào ĐÃ có ô tìm riêng (tìm trên toàn bộ dữ liệu) thì bỏ qua, không chèn.
// Nhiều mục chỉ vẽ một phần (danh sách nhóm có phân trang) trong khi
// badge trên tiêu đề ghi TỔNG. Ô tìm chỉ tìm được phần đã vẽ, nên nó phải nói rõ điều đó — nếu không
// sẽ ra cảnh "mục ghi 64 module, gõ tên một module có thật, báo không khớp".
function sectionShownTotal(sectionBody) {
  const header = sectionBody.parentElement && sectionBody.parentElement.querySelector('.fll-secbdg');
  const badge = header ? parseInt(header.textContent, 10) : NaN;
  return Number.isNaN(badge) ? 0 : badge;
}

function addSectionSearch(sectionBody) {
  if (sectionBody.querySelector('input')) return;
  const container = sectionRowContainer(sectionBody);
  if (sectionRows(container, null).length < SECTION_SEARCH_MIN_ROWS) return;
  const box = document.createElement('input');
  box.className = 'fll-in fll-secq';
  sectionBody.insertBefore(box, sectionBody.firstChild);
  refreshSectionSearchScope(box);
}

// Phạm vi của ô tìm = số hàng ô tìm CHẠM TỚI ĐƯỢC. Hàng bị capSectionRows giấu đi vẫn chạm tới được
// (chúng nằm trong DOM, chỉ đang hidden) — còn hàng chưa hề được vẽ (mục tự phân trang) thì không.
// Câu chữ phải nói đúng điều đó, nếu không sẽ ra cảnh "mục ghi 64 module, gõ tên một module có thật,
// báo không khớp".
function refreshSectionSearchScope(box) {
  const sectionBody = box.parentElement;
  if (!sectionBody) return;
  const reach = sectionRows(sectionRowContainer(sectionBody), box).length;
  const total = sectionShownTotal(sectionBody);
  box.setAttribute('placeholder', total > reach
    ? 'Tìm trong ' + reach + ' mục đã vẽ (mục có ' + total + ')...'
    : 'Tìm nhanh trong mục này...');
}

// Lọc ngay trên DOM: không vẽ lại gì cả nên không mất tiêu điểm, không cần debounce.
function filterSectionRows(box) {
  const sectionBody = box.parentElement;
  const container = sectionRowContainer(sectionBody);
  const query = box.value.trim().toLowerCase();
  const rows = sectionRows(container, box);
  const more = sectionBody.querySelector('.fll-secmore');
  let shown = 0;
  // Hàng con (.sub) đi theo hàng cha, cả hai chiều: gõ tên miniapp thì mấy hàng bản build của nó phải
  // còn, mà gõ số build thì hàng miniapp chứa nó cũng phải còn — không thì hàng build hiện ra trơ trọi,
  // không biết của app nào. Phải quét HAI LƯỢT vì lượt một chưa biết hàng con phía sau có khớp không.
  const own = rows.map((node) => !query || (node.textContent || '').toLowerCase().indexOf(query) >= 0);
  const keep = own.slice();
  let parentAt = -1;
  rows.forEach((node, index) => {
    const isSub = node.classList.contains('sub');
    if (!isSub) {
      parentAt = index;
      return;
    }
    if (parentAt < 0) return;
    if (own[parentAt]) keep[index] = true;
    if (own[index]) keep[parentAt] = true;
  });
  rows.forEach((node, index) => {
    const hit = keep[index];
    // Đang gõ tìm thì bỏ qua giới hạn cắt: gõ đúng tên một hàng bị cắt mà vẫn "không mục nào khớp"
    // là kiểu sai khó chịu nhất. Xoá ô tìm thì trả lại trạng thái cắt cũ.
    node.hidden = query ? !hit : !!node.getAttribute('data-capped');
    if (hit) shown += 1;
  });
  if (more) more.hidden = !!query;
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
  const chuaVe = total > rows.length ? ' — mục có ' + total + ', ô này chỉ tìm trong phần đã vẽ' : '';
  note.textContent = (shown ? 'Khớp ' + shown + '/' + rows.length : 'Không mục nào khớp') + chuaVe + '.';
}

// Đóng/mở TẠI CHỖ, không vẽ lại cả tab: vẽ lại sẽ mất vị trí cuộn và làm mất luôn ô tìm đang gõ dở.
function toggleSection(header) {
  const wrap = header.parentElement;
  if (!wrap || !wrap.classList.contains('fll-secw')) return;
  const isOpen = !wrap.classList.contains('open');
  wrap.classList.toggle('open', isOpen);
  setSectionOpen(header.getAttribute('data-value') || '', isOpen);
  hideAim();
}

// Mở mục đang chứa phần tử này ra rồi mới cuộn tới. Không có bước này thì các lối tắt ("bấm thẻ phiên
// app ở Tổng quan") sẽ cuộn tới một chỗ đang bị đóng, tức không thấy gì.
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
