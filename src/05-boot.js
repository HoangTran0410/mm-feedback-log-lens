// @ts-check
// gắn panel vào trang, điều phối tab, uỷ quyền sự kiện, tự quét lại khi đổi tab log

const ROOT_ID = 'fll-root';
const TAB_DEFS = [
  // Tab Chậm cũ nằm trong đây: ba mục của nó cũng là "số rút từ log" như mọi mục khác ở Tổng quan.
  { id: 'sum', label: 'Tổng quan' },
  // Tab HTTP cũ nằm trong đây: "call nào hỏng" và "lỗi gì đã nổ" là cùng một câu hỏi.
  { id: 'iss', label: 'Vấn đề', badge: countUnmutedErrorGroups, danger: true },
  // Tab duy nhất có thể tự ẩn: log nào không có dòng cấu hình nào thì tab biến mất thay vì hiện
  // một tab rỗng. Panel chỉ rộng 480px, mỗi tab thừa đều ăn vào chỗ của tab còn lại.
  { id: 'cfg', label: 'Cấu hình', badge: (data) => data.configs.total || null,
    hide: (data) => !data.configs.hasAny },
  { id: 'flt', label: 'Lọc', badge: () => getActiveFilterFacets().length || null, tone: 'act' },
  { id: 'tl', label: 'Diễn biến' },
];

// Chạy lại cả file (reload extension khi tab đang mở) = sinh một thế hệ closure mới.
// Thế hệ cũ vẫn còn listener keydown trên document và interval đang chạy: nó sẽ bắt phím
// rồi thao tác lên panel của thế hệ mới. Vì vậy mỗi lần khởi động phải dọn thế hệ trước qua biến global này.
const LENS_GLOBAL_KEY = '__feedbackLogLens';

// Con đường dọn qua window[LENS_GLOBAL_KEY] chỉ hoạt động khi hai thế hệ dùng chung một window.
// Mốc thứ hai này đi qua DOM nên không phụ thuộc điều đó: instance nào khởi động sau sẽ ghi tên mình
// lên thẻ html; instance cũ đọc thấy tên khác thì tự rút lui, nếu không lưới an toàn "root bị gỡ thì
// gắn lại" của nó sẽ dựng dậy root cũ về mỗi 2 giây.
// CHƯA XÁC MINH: có trường hợp nào còn lại khiến hai thế hệ KHÔNG chung window hay không. Mốc này ra đời
// từ thời còn bản bookmarklet chạy ở page world; bản bookmarklet đã bỏ, nhưng chưa kiểm được reload
// extension lúc tab đang mở thì thế hệ cũ nằm ở đâu, nên giữ lại.
const LENS_OWNER_ATTR = 'data-fll-owner';
const lensInstanceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Từ khi WebAdmin nhúng sẵn lens.js vào trang, trên cùng một tab có thể có HAI bản cùng chạy: bản của
// trang (page world) và bản extension của người đang sửa tool (isolated world). Hai bên không thấy
// `window` của nhau nên chỉ còn thẻ html để nhường quyền.
//
// "Ai chạy sau thì thắng" là sai cho ca này: trang chở một bản CỐ ĐỊNH, còn người đang sửa cần bản mới
// của mình ăn trước — mà thứ tự nạp thì không kiểm soát được (bundle của SPA có thể chạy sau
// document_idle). Vì vậy quyền sở hữu có XẾP HẠNG, và hạng cao luôn thắng bất kể thứ tự.
//
// Nhận diện bằng `chrome.runtime.id`: chỉ content script mới có. Page world của một trang có thể có
// `chrome` và cả `chrome.runtime`, nhưng `id` là undefined — đã đo, xem CLAUDE.md.
// Đọc qua `globalThis` chứ không viết thẳng tên `chrome`: trình duyệt không có biến đó (page world của
// Firefox/Safari) sẽ ném ReferenceError ngay lúc nạp file, mà đây là dòng chạy đầu tiên.
const LENS_RANK = (function detectLensRank() {
  const api = /** @type {any} */ (globalThis).chrome;
  return api && api.runtime && api.runtime.id ? 2 : 1;
}());

function lensOwnerMark() {
  return document.documentElement.getAttribute(LENS_OWNER_ATTR) || '';
}

// Hạng của bản đang giữ quyền. Nhãn cũ (chưa có hạng) đọc ra 0 nên bản mới luôn giành được.
function currentOwnerRank() {
  const rank = Number(lensOwnerMark().split(':')[0]);
  return Number.isFinite(rank) ? rank : 0;
}

// Có bản hạng CAO HƠN đang giữ quyền: mình phải đứng ngoài hẳn. Hạng bằng nhau thì vẫn theo luật cũ
// (ai claim sau thì thắng) — đó là ca reload extension, thế hệ mới phải thay được thế hệ cũ.
function isLensOutranked() {
  return !isLensOwner() && currentOwnerRank() > LENS_RANK;
}

function claimLensOwnership() {
  if (isLensOutranked()) return false;
  document.documentElement.setAttribute(LENS_OWNER_ATTR, LENS_RANK + ':' + lensInstanceId);
  return true;
}

function isLensOwner() {
  const mark = lensOwnerMark();
  return mark.slice(mark.indexOf(':') + 1) === lensInstanceId;
}

// WebAdmin là SPA React: bấm từ danh sách sang feedback detail KHÔNG tải lại tài liệu,
// nên content script (chạy ở document_idle) không bao giờ chạy lại. Ban đầu dùng waitForLogRows
// poll 30 giây rồi bỏ cuộc — ngồi ở trang danh sách lâu hơn thế là mất luôn cơ hội gắn.
// Thay bằng một watcher thường trú: gắn khi bảng log xuất hiện, tháo khi rời khỏi trang detail.
const PAGE_WATCH_INTERVAL_MS = 1000;
// Ô lọc nội dung chờ lâu hơn vì nó kéo theo cả lượt quét 4085 dòng; hai ô kia chỉ vẽ lại một mảnh.
const FILTER_INPUT_DEBOUNCE_MS = 180;
const LIST_INPUT_DEBOUNCE_MS = 120;

let pageWatcher = null;
let lastRowCount = 0;
// Mỗi ô tìm một timer riêng: dùng chung một biến thì gõ ô này sẽ huỷ mất cập nhật đang chờ của ô kia.
const inputTimers = {};

function debounceInput(key, delayMs, run) {
  clearTimeout(inputTimers[key]);
  inputTimers[key] = setTimeout(run, delayMs);
}

function clearInputTimers() {
  Object.keys(inputTimers).forEach((key) => clearTimeout(inputTimers[key]));
}

function hasLogRows() {
  return !!document.querySelector(ROW_SELECTOR);
}

function disposePreviousInstance() {
  const previous = window[LENS_GLOBAL_KEY];
  if (previous && typeof previous.dispose === 'function') previous.dispose();
  const leftover = document.getElementById(ROOT_ID);
  if (leftover) leftover.remove();
}

// Phải gỡ đúng root CỦA CHÍNH instance này, không được lấy getElementById: khi một instance khác
// đã tiếp quản thì id đó đang trỏ tới panel của nó.
// shouldRestorePage=false khi mình rút lui vì người khác tiếp quản — lúc ấy class lọc trên bảng log
// là của chủ mới, đừng động vào.
function disposeSelf(shouldRestorePage) {
  window.removeEventListener('keydown', handleShortcut, LENS_KEY_LISTENER_OPTIONS);
  if (pageWatcher) clearInterval(pageWatcher);
  pageWatcher = null;
  // Timer còn treo sẽ chạy trên panel đã bị gỡ, phải dọn.
  clearInputTimers();
  detachPageHover();
  if (lensState.el.root) lensState.el.root.remove();
  if (shouldRestorePage) {
    document.querySelectorAll('.fll-filtering, .fll-dropping, .fll-drop, .fll-hit')
      .forEach((el) => el.classList.remove('fll-filtering', 'fll-dropping', 'fll-drop', 'fll-hit'));
  }
}

function registerInstance() {
  window[LENS_GLOBAL_KEY] = { dispose: function dispose() { disposeSelf(true); } };
}

// timeFrom/timeTo là mốc TUYỆT ĐỐI, mà trang admin là SPA: bấm sang feedback khác thì log đổi nội
// dung nhưng bộ lọc còn nguyên. Đo thật: ở log 1 bấm "2 phút cuối" rồi sang log 2 -> bảng log còn
// 0/7107 dòng, chip ghi một khoảng giờ không hề tồn tại trong log 2.
//
// Hai đường xử lý, khác nhau ở chỗ có biết người dùng MUỐN gì không:
//   - đang bật preset ("N cuối") -> tính lại theo lastTs mới, ý định vẫn đúng trên log mới;
//   - khoảng tự kéo tay -> không đoán được, chỉ giữ nếu nó còn giao với log mới, không thì bỏ hẳn.
// Trường hợp log dài thêm (vẫn là log cũ, chỉ có dòng mới) thì khoảng cũ vẫn giao nên được giữ.
function retargetTimeWindow(data) {
  const filter = lensState.filter;
  if (filter.timeFrom === null && filter.timeTo === null) return;
  if (filter.windowPreset) {
    filter.timeTo = data.lastTs;
    filter.timeFrom = Math.max(data.firstTs, data.lastTs - filter.windowPreset);
    return;
  }
  const from = filter.timeFrom !== null ? filter.timeFrom : data.firstTs;
  const to = filter.timeTo !== null ? filter.timeTo : data.lastTs;
  if (from <= data.lastTs && to >= data.firstTs) return;
  filter.timeFrom = null;
  filter.timeTo = null;
}

function scanLog() {
  const data = attachInsights(analyzeLog(lensState.gapThresholdMs));
  data.gapThresholdLabel = lensState.gapThresholdMs / 1000 + 's';
  lensState.data = data;
  lensState.view = data;
  // Dựng lại chỉ mục "phần tử dòng -> entry" và gắn lại listener: quét lại nghĩa là DOM cũ có thể đã
  // bị trang thay hết, chỉ mục cũ trỏ vào node đã gỡ.
  indexRowElements(data);
  attachPageHover(data.container);
  // Kết quả lọc cũ trỏ tới mảng entries cũ (và DOM cũ), phải bỏ đi để lần vẽ tab sau tính lại.
  lensState.lastFilterResult = null;
  lensState.forcedVisibleIndices.clear();
  lensState.el.lastHit = null;
  lensState.isFiltering = false;
  lensState.visibleCount = data.entries.length;
  // Sang log khác thì khoảng đang phóng to không còn nghĩa gì.
  lensState.mapZoom = null;
  lensState.mapZoomStack = [];
  retargetTimeWindow(data);
  // Đổi sang log khác (trang admin thay nội dung mà không tải lại) có thể làm tab đang mở biến mất.
  // Không bắt lại thì thân panel vẽ tab đó trong khi trên thanh tab không còn nút nào sáng.
  const current = TAB_DEFS.find((tab) => tab.id === lensState.tab);
  if (current && current.hide && current.hide(data)) lensState.tab = 'sum';
  return data;
}

function renderTab() {
  const body = lensState.el.body;
  if (!body) return;
  if (lensState.tab === 'sum') body.innerHTML = renderSummaryTab();
  else if (lensState.tab === 'iss') body.innerHTML = renderIssuesTab();
  else if (lensState.tab === 'cfg') body.innerHTML = renderConfigTab();
  else if (lensState.tab === 'flt') body.innerHTML = renderFilterTab();
  else body.innerHTML = renderTimelineTab();
  // Mục đang trỏ tới vừa bị thay thế -> mũi tên trỏ vào hư không, dọn trước khi gom mục.
  hideAim();
  hideTooltip();
  collapsifySections(body, lensState.tab);
  body.scrollTop = 0;
  renderTabBar();
  refreshFilterBar();
}

// Gõ trong ô tìm thì mọi con số trong tab đều đổi theo (chip đếm faceted, danh sách ID, trạng thái
// nút lưu mẫu). Trước đây không vẽ lại vì sợ mất con trỏ — nhưng như thế cả tab đứng yên ở trạng thái cũ,
// người dùng thấy "1 bộ lọc đang bật" mà phần Mẫu bộ lọc vẫn báo chưa có điều kiện nào.
// Vẽ lại hết rồi trả lại tiêu điểm + vị trí con trỏ + vị trí cuộn.
function renderTabPreservingFocus() {
  const body = lensState.el.body;
  // selectionStart/setSelectionRange chỉ có trên ô nhập. Kiểm bằng typeof rồi mới dùng, còn ép kiểu
  // ở đây là để trình kiểm kiểu biết điều đó — không đổi hành vi lúc chạy.
  const active = /** @type {HTMLInputElement | null} */ (document.activeElement);
  const activeId = active && active.id;
  const hasSelection = active && typeof active.selectionStart === 'number';
  const selectionStart = hasSelection ? active.selectionStart : null;
  const selectionEnd = hasSelection ? active.selectionEnd : null;
  const scrollTop = body ? body.scrollTop : 0;

  renderTab();

  if (body) body.scrollTop = scrollTop;
  if (!activeId) return;
  const restored = /** @type {HTMLInputElement | null} */ (document.getElementById(activeId));
  if (!restored) return;
  restored.focus();
  if (selectionStart !== null && typeof restored.setSelectionRange === 'function') {
    restored.setSelectionRange(selectionStart, selectionEnd);
  }
}

function renderTabBar() {
  lensState.el.tabs.innerHTML = TAB_DEFS
    // Truyền data ĐẦY ĐỦ chứ không phải view đang lọc: lọc xuống còn 3 dòng thì trong tập đó không còn
    // dòng cấu hình nào, và tab Cấu hình sẽ BIẾN MẤT giữa chừng — thấy khi chụp màn hình. Tab có hay
    // không là tính chất của cả log, còn nội dung bên trong mới chạy theo bộ lọc.
    .filter((tab) => !(tab.hide && tab.hide(lensState.data)))
    .map((tab) => {
      const count = tab.badge ? tab.badge(getView()) : null;
      const tone = tab.danger ? ' err' : tab.tone ? ' ' + tab.tone : '';
      const badge = count == null ? '' : '<i class="fll-bdg' + tone + '">' + formatCount(count) + '</i>';
      return '<button class="fll-tab' + (lensState.tab === tab.id ? ' on' : '') + '" data-tab="' + tab.id + '">' +
        tab.label + badge + '</button>';
    })
    .join('');
}

function switchTab(tabId) {
  closeSheet();
  lensState.tab = tabId;
  renderTab();
}

function refreshHeader() {
  const data = lensState.data;
  // Phải trừ phần "app xuống nền" y hệt thẻ thống kê ở Tổng quan. Đo trên log thật 9363 dòng: phụ đề
  // ghi 34 trong khi thẻ ghi 28 — hai con số cho cùng một thứ, người đọc không biết tin cái nào.
  const gaps = data.gaps.filter((gap) => gap.cause !== 'background');
  const background = data.gaps.length - gaps.length;
  lensState.el.sub.textContent = data.entries.length + ' dòng · ' + data.sessionCount + ' phiên · ' +
    data.levels.ERROR + ' lỗi · ' + gaps.length + ' khoảng lặng' +
    (background ? ' · ' + background + ' lần xuống nền' : '');
}

// Đếm con của container (O(1)) thay vì querySelectorAll cả tài liệu 8000+ node mỗi 2 giây.
// PHẢI dùng đúng hàm này cho cả giá trị khởi tạo lẫn mỗi lần kiểm: container còn 2 div đệm
// ngoài các dòng log (4087 vs 4085), lấy hai nguồn khác nhau là tick đầu tiên sẽ rescan oan
// và xoá sạch trạng thái lọc trong khi DOM vẫn đang bị lọc.
function countLogRows() {
  const container = lensState.data && lensState.data.container;
  return container && container.isConnected
    ? container.childElementCount
    : document.querySelectorAll(ROW_SELECTOR).length;
}

function rescan() {
  scanLog();
  renderMinimap();
  refreshHeader();
  // Bảng log vừa được dựng lại: áp lại bộ lọc đang bật để DOM và state không lệch nhau.
  applyFilter(false);
  renderTab();
}

// Cố ý KHÔNG gỡ listener phím và KHÔNG dừng pageWatcher: chúng là đường để Alt+L mở lại
// mà không phải reload trang. Cờ isDismissed nên watcher sẽ không tự gắn lại trên feedback này.
function closeLens() {
  const root = document.getElementById(ROOT_ID);
  if (root) root.remove();
  document.querySelectorAll('.fll-filtering, .fll-dropping, .fll-drop, .fll-hit')
    .forEach((el) => el.classList.remove('fll-filtering', 'fll-dropping', 'fll-drop', 'fll-hit'));
  lensState.el.root = null;
  lensState.el.panel = null;
  lensState.data = null;
  lensState.isDismissed = true;
}

// Rời khỏi trang detail (SPA đổi route): tháo panel nhưng giữ watcher và phím tắt,
// để vào feedback khác là gắn lại. Bộ lọc đặt cho feedback cũ phải xoá — giữ lại là dữ liệu
// feedback mới hiện ra thiếu mà người dùng không biết. Riêng danh sách tắt tiếng thì giữ.
function detachLens() {
  clearInputTimers();
  detachPageHover();
  if (lensState.el.root) lensState.el.root.remove();
  // Trả bảng log về nguyên trạng TRƯỚC khi bỏ data: SPA có thể dùng lại chính container đó cho feedback
  // kế tiếp. Còn sót .fll-filtering/.fll-keep thì feedback mới chỉ hiện vài chục dòng trong khi panel
  // báo "không có bộ lọc nào" — đúng kiểu sai mà người dùng không biết.
  setLogFilteringMode(false);
  document.querySelectorAll('.fll-keep, .fll-drop, .fll-hit')
    .forEach((el) => el.classList.remove('fll-keep', 'fll-drop', 'fll-hit'));
  lensState.el = { root: null, panel: null };
  lensState.data = null;
  lensState.view = null;
  lensState.matches = [];
  lensState.matchPos = -1;
  lensState.isFiltering = false;
  lensState.lastFilterResult = null;
  lensState.visibleCount = 0;
  lensState.forcedVisibleIndices.clear();
  lensState.filter.levels.clear();
  lensState.filter.modules.clear();
  lensState.filter.text = '';
  lensState.filter.timeFrom = null;
  lensState.filter.timeTo = null;
  lensState.filter.windowPreset = null;
  lensState.filter.session = null;
  lensState.filter.skipDuplicate = false;
  lensState.mapZoom = null;
  lensState.mapZoomStack = [];
  // tabUiState cũng là trạng thái của MỘT feedback: ô tìm nhóm lỗi, ô tìm HTTP, chip loại mốc, chế độ
  // xem nhóm đã tắt tiếng. Để sót thì sang feedback sau người dùng thấy danh sách đã bị lọc sẵn bằng
  // một câu tìm của log trước — cùng một loại lỗi với việc để sót bộ lọc.
  resetTabUiState();
  lensState.isShowingMuted = false;
  lensState.isDismissed = false;
  lastRowCount = 0;
}

function tickPageWatcher() {
  // Kiểm quyền TRƯỚC mọi thứ khác: bản bị vượt hạng phải rút lui kể cả khi nó chưa gắn được vào trang
  // nào. Để sau nhánh "chưa gắn" thì nó cứ thử gắn lại mỗi nhịp trong khi đã có chủ khác.
  if (isLensOutranked()) {
    disposeSelf(false);
    return;
  }
  if (!lensState.data || !lensState.el.root) {
    if (!lensState.isDismissed && hasLogRows()) startLens(!lensState.wasPanelOpen);
    return;
  }
  // Một instance mới hơn đã tiếp quản: rút lui hẳn.
  if (!isLensOwner()) {
    disposeSelf(false);
    return;
  }
  if (!hasLogRows()) {
    detachLens();
    return;
  }
  // Lưới an toàn: trang admin từng gỡ #fll-root khỏi body khi xử lý phím. Nếu bị gỡ thì gắn lại.
  if (!lensState.el.root.isConnected) document.body.appendChild(lensState.el.root);
  const current = countLogRows();
  if (current === lastRowCount || !current) return;
  lastRowCount = current;
  if (lensState.el.panel && document.contains(lensState.el.panel)) rescan();
  else {
    scanLog();
    showPill();
  }
}

function startPageWatcher() {
  if (pageWatcher) clearInterval(pageWatcher);
  pageWatcher = setInterval(tickPageWatcher, PAGE_WATCH_INTERVAL_MS);
}

function showPill() {
  const root = lensState.el.root;
  const facetCount = getActiveFilterFacets().length;
  lensState.wasPanelOpen = false;
  root.innerHTML = '<style>' + PANEL_CSS + '</style>' +
    '<div class="fll-pill" data-act="open"><span style="color:var(--acc)">◆</span> Log Lens · <b>' +
    countUnmutedErrorGroups(getView()) + '</b> nhóm lỗi · ' +
    getView().gaps.filter((gap) => gap.cause !== 'background').length + ' khoảng lặng' +
    (facetCount ? ' · <b style="color:var(--acc)">' + facetCount + ' bộ lọc</b>' : '') + '</div>';
}

function mountPanel() {
  const root = lensState.el.root;
  lensState.wasPanelOpen = true;
  root.innerHTML = '<style>' + PANEL_CSS + '</style>' +
    '<div class="fll-panel">' +
    '<div class="fll-grip"></div>' +
    '<header class="fll-hd"><span class="fll-dot"></span>' +
    '<div><div class="fll-tt">Feedback Log Lens</div><div class="fll-sub"></div></div>' +
    '<div class="fll-hd-sp"></div>' +
    '<button class="fll-ico" data-act="rescan" data-tip="Quét lại (khi đổi tab log)">⟳</button>' +
    '<button class="fll-ico" data-act="minimize" data-tip="Thu nhỏ (Esc)">–</button>' +
    // '<button class="fll-ico" data-act="close" data-tip="Đóng hẳn — Alt+L để mở lại">×</button>' +
    '</header>' +
    '<nav class="fll-tabs"></nav>' +
    '<div class="fll-bar" hidden></div>' +
    '<div class="fll-map" data-tip="Bấm để nhảy tới mốc đó. Kéo để chọn khoảng thời gian; ' +
    'kéo giữa vùng sáng để dời, kéo mép để co giãn, nháy đúp để bỏ chọn."></div>' +
    '<div class="fll-maplbl"></div>' +
    '<div class="fll-body"></div>' +
    '<footer class="fll-ft" hidden>' +
    '<button class="fll-nav" data-act="prev" data-tip="Dòng trước — phím p">&#9664;<em>p</em></button>' +
    '<div class="fll-info"></div>' +
    '<button class="fll-nav" data-act="next" data-tip="Dòng sau — phím n"><em>n</em>&#9654;</button></footer>' +
    '<div class="fll-corner" data-tip="Kéo để đổi cả chiều rộng và chiều cao"></div></div>';

  const panel = root.querySelector('.fll-panel');
  lensState.el.panel = panel;
  lensState.el.tabs = root.querySelector('.fll-tabs');
  lensState.el.body = root.querySelector('.fll-body');
  lensState.el.bar = root.querySelector('.fll-bar');
  lensState.el.map = root.querySelector('.fll-map');
  lensState.el.mapLabel = root.querySelector('.fll-maplbl');
  lensState.el.info = root.querySelector('.fll-info');
  lensState.el.sub = root.querySelector('.fll-sub');

  lensState.el.map.addEventListener('mousedown', handleMinimapMouseDown);
  lensState.el.map.addEventListener('mousemove', handleMinimapHover);
  lensState.el.map.addEventListener('dblclick', handleMinimapDoubleClick);
  // Gắn ở PANEL chứ không ở thân: như vậy các hàng trong tấm trượt (.fll-sheet) cũng được vẽ mũi tên.
  panel.addEventListener('mouseover', handleLensHover);
  panel.addEventListener('mouseleave', hideAim);
  // 'scroll' không nổi bọt lên, phải bắt ở pha capture mới thấy được cuộn của thân và của tấm trượt.
  panel.addEventListener('scroll', handleAimScroll, true);

  applyPanelGeometry(panel);
  enableDragAndResize(panel, root.querySelector('.fll-hd'), root.querySelector('.fll-grip'),
    root.querySelector('.fll-corner'));
  renderMinimap();
  refreshHeader();
  renderTab();
  renderFooter();
}

/* ---------------------------------------------------------- uỷ quyền click */

function handleLensClick(event) {
  const hit = event.target.closest('[data-act],[data-tab],[data-lines],[data-jump],[data-group],' +
    '[data-module],[data-level],[data-call],[data-bucket],[data-event],[data-saw],[data-apifail],' +
    '[data-jscreen],[data-jtap],[data-tracefail],[data-jload],[data-env],[data-envapp]');
  if (!hit) return;
  // groups/httpCalls đọc theo view (đang lọc thì là của tập đang hiện, đúng như tab vừa vẽ);
  // correlations vẫn lấy từ data vì chuỗi một request phải xem trọn vẹn.
  const data = lensState.data;
  const view = getView();
  const value = hit.getAttribute('data-value');

  if (hit.dataset.tab) return switchTab(hit.dataset.tab);
  // data-lines = "hàng này ứng với từng này dòng log". Phải xét TRƯỚC data-jump: nhảy một dòng thì
  // thanh dưới không có gì để duyệt, người dùng kẹt ở dòng đầu tiên của nhóm.
  if (hit.dataset.lines) {
    const indices = hit.dataset.lines.split(',').map(Number).filter((index) => !Number.isNaN(index));
    return setMatches(indices, hit.getAttribute('data-label') || (indices.length + ' dòng'));
  }
  if (hit.dataset.jump) return jumpToIndex(Number(hit.dataset.jump));
  if (hit.dataset.bucket) {
    // Vừa kéo chọn khoảng xong: cú click đi kèm mouseup không được biến thành lệnh nhảy dòng.
    if (lensState.suppressMapClick) return undefined;
    const index = Number(hit.dataset.bucket);
    return index >= 0 ? jumpToIndex(index) : undefined;
  }
  if (hit.dataset.group) {
    const group = view.groups[Number(hit.dataset.group)];
    return setMatches(group.indices, group.level + ' · ' + (group.module || 'no module'));
  }
  if (hit.dataset.module) return filterByModule(hit.dataset.module);
  if (hit.dataset.level) return filterByLevel(hit.dataset.level);
  if (hit.dataset.event) {
    lensState.filter.text = 'event: ' + hit.dataset.event;
    lensState.filter.useRegex = false;
    // Lọc trước, chuyển tab sau — xem chú thích của filterByLevel().
    applyFilter(true);
    return switchTab('flt');
  }
  // Một giá trị trong mục Máy & môi trường ứng với NHIỀU dòng, nên đưa cả tập vào thanh duyệt thay vì
  // nhảy tới một dòng — cùng luật với hàng khoảng lặng.
  if (hit.dataset.env != null) {
    const at = hit.dataset.env.split(':');
    const field = view.environment.watched[Number(at[0])];
    const item = field && field.values[Number(at[1])];
    if (!item || !item.indices.length) return undefined;
    return setMatches(item.indices, field.label + ': ' + item.value);
  }
  if (hit.dataset.envapp != null) {
    const at = hit.dataset.envapp.split(':');
    const app = view.environment.miniApps[Number(at[0])];
    if (!app) return undefined;
    const bundle = at.length > 1 ? app.bundles[Number(at[1])] : null;
    const indices = bundle ? bundle.indices : app.indices;
    if (!indices.length) return undefined;
    return setMatches(indices, bundle
      ? app.appId + ' build ' + bundle.buildNumber
      : 'MiniApp: ' + app.appId);
  }
  if (hit.dataset.call) {
    const call = view.httpCalls[Number(hit.dataset.call)];
    const indices = [call.reqIndex, call.resIndex].filter((index) => index != null);
    return setMatches(indices, call.method + ' ' + call.path);
  }
  if (hit.dataset.saw) {
    const row = view.journey.saw[Number(hit.dataset.saw)];
    return row ? setMatches(row.indices, 'User thấy · ' + row.key) : undefined;
  }
  if (hit.dataset.apifail) {
    const row = view.journey.fails[Number(hit.dataset.apifail)];
    return row ? setMatches(row.indices, 'API fail · ' + row.key) : undefined;
  }
  if (hit.dataset.jscreen) {
    const row = view.journey.screens.find((item) => item.key === hit.dataset.jscreen);
    return row ? setMatches(row.indices, 'Màn hình · ' + row.key) : undefined;
  }
  if (hit.dataset.jtap) {
    const row = view.journey.taps.find((item) => item.key === hit.dataset.jtap);
    return row ? setMatches(row.indices, 'Chạm · ' + row.key) : undefined;
  }
  if (hit.dataset.jload) {
    const row = view.journey.screenLoads.find((item) => item.key === hit.dataset.jload);
    return row ? setMatches(row.indices, 'Tải màn · ' + row.key) : undefined;
  }
  if (hit.dataset.tracefail) {
    const row = view.traceIssues.fails[Number(hit.dataset.tracefail)];
    return row ? setMatches(row.indices, 'traceFail · ' + row.key.slice(0, 40)) : undefined;
  }

  const action = hit.dataset.act;
  if (action === 'noop') return undefined;
  if (action === 'clearFilters') {
    resetFilter();
    return renderTab();
  }
  if (action === 'clearFacet') {
    clearFilterFacet(value);
    applyFilter(false);
    return renderTab();
  }
  if (action === 'close') return closeLens();
  if (action === 'closeSheet') return closeSheet();
  if (action === 'json') return renderJsonSheet(Number(value));
  if (action === 'payload') {
    const reqIndex = hit.dataset.req === '' ? null : Number(hit.dataset.req);
    const resIndex = hit.dataset.res === '' ? null : Number(hit.dataset.res);
    return renderPayloadSheet(reqIndex, resIndex, reqIndex == null ? 'res' : 'req');
  }
  if (action === 'payloadSide') return switchPayloadSide(value);
  if (action === 'toggleWrap') return togglePayloadWrap(hit);
  if (action === 'correlate') return renderCorrelationSheet(value);
  if (action === 'browseCorrelation') {
    const bucket = data.correlations.find((item) => item.value === value);
    closeSheet();
    const shortValue = value.length > 18 ? value.slice(0, 8) + '…' + value.slice(-6) : value;
    return bucket ? setMatches(bucket.indices, bucket.key + ' = ' + shortValue) : undefined;
  }
  if (action === 'copyJson') {
    const block = document.getElementById(value);
    return block ? copyTextToClipboard(block.textContent, hit, 'Đã copy') : undefined;
  }
  if (action === 'copyLink') return copyTextToClipboard(buildPermalink(), hit, 'Đã copy link');
  if (action === 'applyTemplate') {
    applyFilterTemplate(value);
    return renderTab();
  }
  if (action === 'deleteTemplate') {
    deleteFilterTemplate(value);
    return renderTab();
  }
  if (action === 'saveTemplate') {
    if (!saveCurrentFilterAsTemplate(tabUiState.templateName)) return undefined;
    tabUiState.templateName = '';
    return renderTab();
  }
  if (action === 'setWindow') {
    setTimeWindowPreset(Number(value) || 0);
    lensState.filter.hideOthers = true;
    applyFilter(hasAnyTimeRange());
    return renderTab();
  }
  if (action === 'setSession') {
    lensState.filter.session = Number(value) || null;
    lensState.filter.hideOthers = true;
    applyFilter(!!lensState.filter.session);
    return renderTab();
  }
  if (action === 'filterFeature') {
    lensState.filter.text = value;
    lensState.filter.useRegex = false;
    lensState.filter.hideOthers = true;
    applyFilter(true);
    return switchTab('flt');
  }
  if (action === 'mute') {
    const group = view.groups[Number(value)];
    if (group) toggleMutedSignature(group.key);
    return renderTab();
  }
  if (action === 'toggleNoise') {
    tabUiState.showNoise = !tabUiState.showNoise;
    return renderTab();
  }
  if (action === 'toggleMutedView') {
    lensState.isShowingMuted = !lensState.isShowingMuted;
    return renderTab();
  }
  if (action === 'moreSection') {
    expandSection(hit);
    return;
  }
  if (action === 'moreIssues') {
    tabUiState.issueLimit += ISSUE_PAGE_SIZE;
    const list = document.getElementById('fll-issue-list');
    if (list) list.innerHTML = renderIssueList();
    return undefined;
  }
  if (action === 'mapZoomIn') {
    const range = getVisibleTimeRange();
    // Nhớ nấc đang đứng trước khi phóng sâu, để còn lùi từng nấc. Nấc đầu tiên là null = cả log.
    lensState.mapZoomStack.push(lensState.mapZoom);
    lensState.mapZoom = { from: range.from, to: range.to };
    renderMinimap();
    return undefined;
  }
  if (action === 'mapZoomOut') {
    lensState.mapZoom = lensState.mapZoomStack.length ? lensState.mapZoomStack.pop() : null;
    renderMinimap();
    return undefined;
  }
  if (action === 'mapZoomReset') {
    lensState.mapZoom = null;
    lensState.mapZoomStack = [];
    renderMinimap();
    return undefined;
  }
  if (action === 'tglSkipDuplicate') {
    lensState.filter.skipDuplicate = !lensState.filter.skipDuplicate;
    applyFilter(true);
    return renderTab();
  }
  if (action === 'jumpDuplicate') {
    const block = lensState.data.duplicate;
    return block ? jumpToIndex(block.from) : undefined;
  }
  if (action === 'tglSec') return toggleSection(hit);
  if (action === 'rescan') return rescan();
  if (action === 'minimize') return showPill();
  if (action === 'open') return mountPanel();
  if (action === 'prev') return moveMatch(-1);
  if (action === 'next') return moveMatch(1);
  if (action === 'gotoIssues') {
    switchTab('iss');
    // Mục mặc định đang thu lại. Bấm "47 ERROR" mà sang tab chỉ thấy mấy dòng tiêu đề thì coi như
    // không đi đến đâu — mở sẵn đúng mục chứa danh sách lỗi.
    const first = lensState.el.body && lensState.el.body.querySelector('[data-group]');
    if (first) revealElement(first);
    return undefined;
  }
  if (action === 'gotoHttp') {
    switchTab('iss');
    const httpSection = lensState.el.body && lensState.el.body.querySelector('[data-sec="Call HTTP"]');
    if (httpSection) {
      revealElement(httpSection);
      httpSection.scrollIntoView({ block: 'start' });
    }
    return undefined;
  }
  if (action === 'gotoTimeline') return switchTab('tl');
  if (action === 'gotoSessions') {
    switchTab('flt');
    // Tab Lọc có 9 mục; nhảy thẳng tới mục Phiên app thay vì để người dùng tự dò tìm.
    const chip = lensState.el.body && lensState.el.body.querySelector('[data-act="setSession"]');
    if (chip) {
      // Mục mặc định đang thu lại: không mở ra thì cuộn tới cũng không thấy gì.
      revealElement(chip);
      chip.scrollIntoView({ block: 'center' });
    }
    return undefined;
  }
  if (action === 'issueLevel') {
    tabUiState.issueLevel = value;
    return renderTab();
  }
  if (action === 'tlKind') {
    // Chọn được nhiều loại cùng lúc: "chỉ xem chạm + popup" là câu hay hỏi nhất khi đọc lại một ca lỗi.
    toggleSetValue(tabUiState.tlKinds, value);
    tabUiState.tlLimit = TIMELINE_PAGE_SIZE;
    return renderTab();
  }
  if (action === 'tlKindAll') {
    tabUiState.tlKinds.clear();
    tabUiState.tlLimit = TIMELINE_PAGE_SIZE;
    return renderTab();
  }
  if (action === 'moreTimeline') {
    tabUiState.tlLimit += TIMELINE_PAGE_SIZE;
    const list = document.getElementById('fll-tl-list');
    if (list) {
      list.innerHTML = renderTimelineList();
      return undefined;
    }
    return renderTab();
  }
  if (action === 'httpAll' || action === 'httpBad') {
    tabUiState.httpOnlyBad = action === 'httpBad';
    return renderTab();
  }
  if (action === 'setGap') {
    lensState.gapThresholdMs = Number(value);
    return rescan();
  }
  if (action === 'tglLevel') {
    toggleSetValue(lensState.filter.levels, value);
    applyFilter(false);
    return renderTab();
  }
  if (action === 'tglModule') {
    toggleSetValue(lensState.filter.modules, value);
    applyFilter(false);
    return renderTab();
  }
  if (action === 'tglRegex') {
    lensState.filter.useRegex = !lensState.filter.useRegex;
    applyFilter(false);
    return renderTab();
  }
  if (action === 'tglHide') {
    lensState.filter.hideOthers = !lensState.filter.hideOthers;
    applyFilter(false);
    return renderTab();
  }
  if (action === 'applyFilter') return applyFilter(true);
  if (action === 'resetFilter') {
    resetFilter();
    return renderTab();
  }
  if (action === 'copySummary') {
    // Tóm tắt luôn đọc data ĐẦY ĐỦ, không đọc view đang lọc: ticket phải mô tả cả log chứ không phải
    // mô tả cái lát cắt người đọc đang mở.
    return copyTextToClipboard(buildTicketSummary(lensState.data), hit, 'Đã copy tóm tắt');
  }
  if (action === 'copyVisible') return copyVisibleLines(hit);
  return undefined;
}

function toggleSetValue(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

// Đổi nhãn nút rồi trả lại. Phải có cả nhánh HỎNG: navigator.clipboard từ chối khi tab không được lấy
// nét (hoặc trình duyệt chặn), lúc đó promise reject và trước đây nút đứng im — người dùng tưởng đã
// copy xong rồi đi dán, dán ra thứ cũ.
function copyTextToClipboard(text, button, doneLabel) {
  const original = button.textContent;
  const show = (label) => {
    button.textContent = label;
    setTimeout(() => {
      button.textContent = original;
    }, 1600);
  };
  if (!navigator.clipboard) {
    show('Trình duyệt chặn copy');
    return;
  }
  navigator.clipboard.writeText(text)
    .then(() => show(doneLabel))
    .catch(() => show('Không copy được — bấm vào panel rồi thử lại'));
}

function copyVisibleLines(button) {
  const text = lensState.data.entries
    .filter((entry) => entry.el && isRowVisible(entry))
    .map((entry) => entry.raw)
    .join('\n');
  copyTextToClipboard(text, button, 'Đã copy ' + text.split('\n').length + ' dòng');
}

/* ----------------------------------------------------- uỷ quyền gõ phím */

function handleLensInput(event) {
  const target = event.target;
  // Ô tìm của từng mục: lọc thẳng trên DOM đã vẽ, không vẽ lại gì nên không cần debounce.
  if (target.classList && target.classList.contains('fll-secq')) {
    filterSectionRows(target);
    return;
  }
  // Vẽ lại tới 50 thẻ nhóm, mỗi thẻ một sparkline 26 cột — đo được 2 khung hình rơi nếu chạy mỗi phím.
  if (target.id === 'fll-q') {
    tabUiState.issueQuery = target.value;
    debounceInput('issueQuery', LIST_INPUT_DEBOUNCE_MS, () => {
      const list = document.getElementById('fll-issue-list');
      if (list) list.innerHTML = renderIssueList();
    });
    return;
  }
  // Giữ tên mẫu người dùng đang gõ: sửa bộ lọc sẽ vẽ lại tab, không giữ thì tên bay mất.
  if (target.id === 'fll-tplname') {
    tabUiState.templateName = target.value;
    return;
  }
  // Quét cả payload của mọi request nên nặng hơn ô tìm nhóm; vẫn chỉ vẽ lại danh sách HTTP.
  if (target.id === 'fll-httpq') {
    tabUiState.httpQuery = target.value;
    debounceInput('httpQuery', LIST_INPUT_DEBOUNCE_MS, () => {
      const list = document.getElementById('fll-http-list');
      if (list) list.innerHTML = renderHttpList();
    });
    return;
  }
  if (target.id === 'fll-tlq') {
    tabUiState.tlQuery = target.value;
    // Gõ lại từ đầu thì trả về trang đầu, không thì đang ở "đã hiện 240 mốc" mà lọc còn 3.
    tabUiState.tlLimit = TIMELINE_PAGE_SIZE;
    debounceInput('tlQuery', LIST_INPUT_DEBOUNCE_MS, () => {
      const list = document.getElementById('fll-tl-list');
      if (list) list.innerHTML = renderTimelineList();
    });
    return;
  }
  if (target.id === 'fll-modq') {
    tabUiState.moduleQuery = target.value;
    debounceInput('moduleQuery', LIST_INPUT_DEBOUNCE_MS, () => {
      const list = document.getElementById('fll-mod-list');
      if (list) list.innerHTML = renderModuleChips();
    });
    return;
  }
  // Đường nặng nhất: quét 4085 dòng, ghi class lên bảng log rồi vẽ lại cả tab. Để chờ lâu hơn.
  if (target.id === 'fll-re') {
    lensState.filter.text = target.value;
    debounceInput('filterText', FILTER_INPUT_DEBOUNCE_MS, () => {
      applyFilter(false);
      renderTabPreservingFocus();
    });
  }
}

/* -------------------------------------------------------------------- boot */

function startLens(startMinimized) {
  // Nhận quyền TRƯỚC khi dọn: nếu dọn xong mới nhận, nhịp watcher của instance cũ chạm vào đúng khe hở
  // đó sẽ tưởng root của nó bị gỡ oan và dựng lại ngay.
  // Không giành được (có bản hạng cao hơn đang chạy) thì đứng ngoài hẳn: không dựng panel, không quét
  // 4000 dòng, và bỏ luôn watcher của mình.
  if (!claimLensOwnership()) {
    if (pageWatcher) clearInterval(pageWatcher);
    pageWatcher = null;
    return;
  }
  disposePreviousInstance();
  registerInstance();

  const root = document.createElement('div');
  root.id = ROOT_ID;
  document.body.appendChild(root);
  lensState.el.root = root;
  lensState.mutedSignatures = loadMutedSignatures();
  lensState.filterTemplates = loadFilterTemplates();

  scanLog();
  // Mở bằng link chia sẻ thì luôn bung panel, kể cả khi đang chạy dưới dạng extension (mặc định thu gọn):
  // người nhận link chỉ thấy một cái pill trong khi bảng log đã bị lọc sẽ tưởng là không có gì xảy ra.
  const isRestoredFromLink = applyPermalinkFromHash();
  if (startMinimized && !isRestoredFromLink) showPill();
  else mountPanel();

  root.addEventListener('click', handleLensClick);
  root.addEventListener('input', handleLensInput);
  root.addEventListener('mouseover', handleLensTooltip);
  root.addEventListener('mouseleave', hideTooltip);
  // Bấm vào đâu là đang làm việc khác, không còn đợi đọc chú giải nữa. 'scroll' bắt ở pha capture vì
  // nó không nổi bọt lên.
  root.addEventListener('mousedown', hideTooltip);
  root.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('keydown', handleShortcut, LENS_KEY_LISTENER_OPTIONS);

  lensState.isDismissed = false;
  lastRowCount = countLogRows();
  startPageWatcher();
}

if (hasLogRows()) startLens(false);
// Chạy cả khi chưa gắn được: điều hướng trong SPA không tải lại tài liệu, watcher này là thứ duy nhất
// biết được "vừa vào một feedback detail mới".
startPageWatcher();
