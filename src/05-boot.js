/*
File: src/05-boot.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — gan panel vao trang, dieu phoi tab, uy quyen su kien, tu quet lai khi doi tab log

const ROOT_ID = 'fll-root';
const TAB_DEFS = [
  { id: 'sum', label: 'Tổng quan' },
  { id: 'iss', label: 'Vấn đề', badge: countUnmutedErrorGroups, danger: true },
  { id: 'http', label: 'HTTP', badge: (data) => data.httpCalls.length },
  { id: 'slow', label: 'Chậm' },
  // Tab duy nhat co the tu an: log nao khong co dong cau hinh nao thi tab bien mat thay vi hien
  // mot tab rong. Panel chi rong 480px, moi tab thua deu an vao cho cua tab con lai.
  { id: 'cfg', label: 'Cấu hình', badge: (data) => data.configs.total || null,
    hide: (data) => !data.configs.hasAny },
  { id: 'flt', label: 'Lọc', badge: () => getActiveFilterFacets().length || null, tone: 'act' },
  { id: 'tl', label: 'Diễn biến' },
];

// Chay lai ca file (reload extension khi tab dang mo) = sinh mot the he closure moi.
// The he cu van con listener keydown tren document va interval dang chay: no se bat phim
// roi thao tac len panel cua the he moi. Vi vay moi lan khoi dong phai don the he truoc qua bien global nay.
const LENS_GLOBAL_KEY = '__feedbackLogLens';

// Con duong don qua window[LENS_GLOBAL_KEY] chi hoat dong khi hai the he dung chung mot window.
// Moc thu hai nay di qua DOM nen khong phu thuoc dieu do: instance nao khoi dong sau se ghi ten minh
// len the html; instance cu doc thay ten khac thi tu rut lui, neu khong luoi an toan "root bi go thi
// gan lai" cua no se dung dai root cu ve moi 2 giay.
// CHUA XAC MINH: co truong hop nao con lai khien hai the he KHONG chung window hay khong. Moc nay ra doi
// tu thoi con ban bookmarklet chay o page world; ban bookmarklet da bo, nhung chua kiem duoc reload
// extension luc tab dang mo thi the he cu nam o dau, nen giu lai.
const LENS_OWNER_ATTR = 'data-fll-owner';
const lensInstanceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function claimLensOwnership() {
  document.documentElement.setAttribute(LENS_OWNER_ATTR, lensInstanceId);
}

function isLensOwner() {
  return document.documentElement.getAttribute(LENS_OWNER_ATTR) === lensInstanceId;
}

// WebAdmin la SPA React: bam tu danh sach sang feedback detail KHONG tai lai tai lieu,
// nen content script (chay o document_idle) khong bao gio chay lai. Ban dau dung waitForLogRows
// poll 30 giay roi bo cuoc — ngoi o trang danh sach lau hon the la mat luon co hoi gan.
// Thay bang mot watcher thuong tru: gan khi bang log xuat hien, thao khi roi khoi trang detail.
const PAGE_WATCH_INTERVAL_MS = 1000;
// O loc noi dung cho lau hon vi no keo theo ca luot quet 4085 dong; hai o kia chi ve lai mot manh.
const FILTER_INPUT_DEBOUNCE_MS = 180;
const LIST_INPUT_DEBOUNCE_MS = 120;

let pageWatcher = null;
let lastRowCount = 0;
// Moi o tim mot timer rieng: dung chung mot bien thi go o nay se huy mat cap nhat dang cho cua o kia.
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

// Phai go dung root CUA CHINH instance nay, khong duoc lay getElementById: khi mot instance khac
// da tiep quan thi id do dang tro toi panel cua no.
// shouldRestorePage=false khi minh rut lui vi nguoi khac tiep quan — luc ay class loc tren bang log
// la cua chu moi, dung dong vao.
function disposeSelf(shouldRestorePage) {
  window.removeEventListener('keydown', handleShortcut, LENS_KEY_LISTENER_OPTIONS);
  if (pageWatcher) clearInterval(pageWatcher);
  pageWatcher = null;
  // Timer con treo se chay tren panel da bi go, phai don.
  clearInputTimers();
  if (lensState.el.root) lensState.el.root.remove();
  if (shouldRestorePage) {
    document.querySelectorAll('.fll-filtering, .fll-dropping, .fll-drop, .fll-hit')
      .forEach((el) => el.classList.remove('fll-filtering', 'fll-dropping', 'fll-drop', 'fll-hit'));
  }
}

function registerInstance() {
  window[LENS_GLOBAL_KEY] = { dispose: function dispose() { disposeSelf(true); } };
}

function scanLog() {
  const data = attachInsights(analyzeLog(lensState.gapThresholdMs));
  data.gapThresholdLabel = lensState.gapThresholdMs / 1000 + 's';
  lensState.data = data;
  lensState.view = data;
  // Ket qua loc cu tro toi mang entries cu (va DOM cu), phai bo di de lan ve tab sau tinh lai.
  lensState.lastFilterResult = null;
  lensState.forcedVisibleIndices.clear();
  lensState.el.lastHit = null;
  lensState.isFiltering = false;
  lensState.visibleCount = data.entries.length;
  // Doi sang log khac (trang admin thay noi dung ma khong tai lai) co the lam tab dang mo bien mat.
  // Khong bat lai thi than panel ve tab do trong khi tren thanh tab khong con nut nao sang.
  const current = TAB_DEFS.find((tab) => tab.id === lensState.tab);
  if (current && current.hide && current.hide(data)) lensState.tab = 'sum';
  return data;
}

function renderTab() {
  const body = lensState.el.body;
  if (!body) return;
  if (lensState.tab === 'sum') body.innerHTML = renderSummaryTab();
  else if (lensState.tab === 'iss') body.innerHTML = renderIssuesTab();
  else if (lensState.tab === 'http') body.innerHTML = renderHttpTab();
  else if (lensState.tab === 'slow') body.innerHTML = renderSlowTab();
  else if (lensState.tab === 'cfg') body.innerHTML = renderConfigTab();
  else if (lensState.tab === 'flt') body.innerHTML = renderFilterTab();
  else body.innerHTML = renderTimelineTab();
  // Muc dang tro toi vua bi thay the -> mui ten tro vao hu khong, don truoc khi gom muc.
  hideAim();
  collapsifySections(body, lensState.tab);
  body.scrollTop = 0;
  renderTabBar();
  refreshFilterBar();
}

// Go trong o tim thi moi con so trong tab deu doi theo (chip dem faceted, danh sach ID, trang thai
// nut luu mau). Truoc day khong ve lai vi so mat con tro — nhung nhu the ca tab dung yen o trang thai cu,
// nguoi dung thay "1 bo loc dang bat" ma phan Mau bo loc van bao chua co dieu kien nao.
// Ve lai het roi tra lai tieu diem + vi tri con tro + vi tri cuon.
function renderTabPreservingFocus() {
  const body = lensState.el.body;
  // selectionStart/setSelectionRange chi co tren o nhap. Kiem bang typeof roi moi dung, con ep kieu
  // o day la de trinh kiem kieu biet dieu do — khong doi hanh vi luc chay.
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
    .filter((tab) => !(tab.hide && tab.hide(getView())))
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
  lensState.el.sub.textContent = data.entries.length + ' dòng · ' + data.sessionCount + ' phiên · ' +
    data.levels.ERROR + ' lỗi · ' + data.gaps.length + ' khoảng lặng';
}

// Dem con cua container (O(1)) thay vi querySelectorAll ca tai lieu 8000+ node moi 2 giay.
// PHAI dung dung ham nay cho ca gia tri khoi tao lan moi lan kiem: container con 2 div dem
// ngoai cac dong log (4087 vs 4085), lay hai nguon khac nhau la tick dau tien se rescan oan
// va xoa sach trang thai loc trong khi DOM van dang bi loc.
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
  // Bang log vua duoc dung lai: ap lai bo loc dang bat de DOM va state khong lech nhau.
  applyFilter(false);
  renderTab();
}

// Co y KHONG go listener phim va KHONG dung pageWatcher: chung la duong de Alt+L mo lai
// ma khong phai reload trang. Co isDismissed nen watcher se khong tu gan lai tren feedback nay.
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

// Roi khoi trang detail (SPA doi route): thao panel nhung giu watcher va phim tat,
// de vao feedback khac la gan lai. Bo loc dat cho feedback cu phai xoa — giu lai la du lieu
// feedback moi hien ra thieu ma nguoi dung khong biet. Rieng danh sach tat tieng thi giu.
function detachLens() {
  clearInputTimers();
  if (lensState.el.root) lensState.el.root.remove();
  // Tra bang log ve nguyen trang TRUOC khi bo data: SPA co the dung lai chinh container do cho feedback
  // ke tiep. Con sot .fll-filtering/.fll-keep thi feedback moi chi hien vai chuc dong trong khi panel
  // bao "khong co bo loc nao" — dung kieu sai ma nguoi dung khong biet.
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
  lensState.filter.session = null;
  lensState.isDismissed = false;
  lastRowCount = 0;
}

function tickPageWatcher() {
  if (!lensState.data || !lensState.el.root) {
    if (!lensState.isDismissed && hasLogRows()) startLens(!lensState.wasPanelOpen);
    return;
  }
  // Mot instance moi hon da tiep quan: rut lui han.
  if (!isLensOwner()) {
    disposeSelf(false);
    return;
  }
  if (!hasLogRows()) {
    detachLens();
    return;
  }
  // Luoi an toan: trang admin tung go #fll-root khoi body khi xu ly phim. Neu bi go thi gan lai.
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
    countUnmutedErrorGroups(getView()) + '</b> nhóm lỗi · ' + getView().gaps.length + ' khoảng lặng' +
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
    '<button class="fll-ico" data-act="rescan" title="Quét lại (khi đổi tab log)">⟳</button>' +
    '<button class="fll-ico" data-act="minimize" title="Thu nhỏ (Esc)">–</button>' +
    '<button class="fll-ico" data-act="close" title="Đóng hẳn — Alt+L để mở lại">×</button></header>' +
    '<nav class="fll-tabs"></nav>' +
    '<div class="fll-bar" hidden></div>' +
    '<div class="fll-map" title="Bấm để nhảy tới mốc đó. Kéo để chọn khoảng thời gian; ' +
    'kéo giữa vùng sáng để dời, kéo mép để co giãn, nháy đúp để bỏ chọn."></div>' +
    '<div class="fll-maplbl"></div>' +
    '<div class="fll-body"></div>' +
    '<footer class="fll-ft" hidden>' +
    '<button class="fll-nav" data-act="prev" title="Dòng trước — phím p">&#9664;<em>p</em></button>' +
    '<div class="fll-info"></div>' +
    '<button class="fll-nav" data-act="next" title="Dòng sau — phím n"><em>n</em>&#9654;</button></footer>' +
    '<div class="fll-corner" title="Kéo để đổi cả chiều rộng và chiều cao"></div></div>';

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
  // Gan o PANEL chu khong o than: nhu vay cac hang trong tam truot (.fll-sheet) cung duoc ve mui ten.
  panel.addEventListener('mouseover', handleLensHover);
  panel.addEventListener('mouseleave', hideAim);
  // 'scroll' khong noi bot len, phai bat o pha capture moi thay duoc cuon cua than va cua tam truot.
  panel.addEventListener('scroll', handleAimScroll, true);

  applyPanelGeometry(panel);
  enableDragAndResize(panel, root.querySelector('.fll-hd'), root.querySelector('.fll-grip'),
    root.querySelector('.fll-corner'));
  renderMinimap();
  refreshHeader();
  renderTab();
  renderFooter();
}

/* ---------------------------------------------------------- uy quyen click */

function handleLensClick(event) {
  const hit = event.target.closest('[data-act],[data-tab],[data-jump],[data-group],[data-module],' +
    '[data-level],[data-call],[data-bucket],[data-event],[data-saw],[data-apifail],' +
    '[data-jscreen],[data-jtap],[data-tracefail],[data-jload]');
  if (!hit) return;
  // groups/httpCalls doc theo view (dang loc thi la cua tap dang hien, dung nhu tab vua ve);
  // correlations van lay tu data vi chuoi mot request phai xem tron ven.
  const data = lensState.data;
  const view = getView();
  const value = hit.getAttribute('data-value');

  if (hit.dataset.tab) return switchTab(hit.dataset.tab);
  if (hit.dataset.jump) return jumpToIndex(Number(hit.dataset.jump));
  if (hit.dataset.bucket) {
    // Vua keo chon khoang xong: cu click di kem mouseup khong duoc bien thanh lenh nhay dong.
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
    switchTab('flt');
    return applyFilter(true);
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
    switchTab('flt');
    return applyFilter(true);
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
  if (action === 'moreIssues') {
    tabUiState.issueLimit += ISSUE_PAGE_SIZE;
    const list = document.getElementById('fll-issue-list');
    if (list) list.innerHTML = renderIssueList();
    return undefined;
  }
  if (action === 'tglSec') return toggleSection(hit);
  if (action === 'rescan') return rescan();
  if (action === 'minimize') return showPill();
  if (action === 'open') return mountPanel();
  if (action === 'prev') return moveMatch(-1);
  if (action === 'next') return moveMatch(1);
  if (action === 'gotoIssues') {
    switchTab('iss');
    // Muc mac dinh dang thu lai. Bam "47 ERROR" ma sang tab chi thay may dong tieu de thi coi nhu
    // khong di den dau — mo san dung muc chua danh sach loi.
    const first = lensState.el.body && lensState.el.body.querySelector('[data-group]');
    if (first) revealElement(first);
    return undefined;
  }
  if (action === 'gotoHttp') return switchTab('http');
  if (action === 'gotoTimeline') return switchTab('tl');
  if (action === 'gotoSessions') {
    switchTab('flt');
    // Tab Loc co 9 muc; nhay thang toi muc Phien app thay vi de nguoi dung tu do tim.
    const chip = lensState.el.body && lensState.el.body.querySelector('[data-act="setSession"]');
    if (chip) {
      // Muc mac dinh dang thu lai: khong mo ra thi cuon toi cung khong thay gi.
      revealElement(chip);
      chip.scrollIntoView({ block: 'center' });
    }
    return undefined;
  }
  if (action === 'issueLevel') {
    tabUiState.issueLevel = value;
    return renderTab();
  }
  if (action === 'tlGroup') {
    // Bam lai dung nhom dang chon = bo chon, quay ve xem tat ca.
    tabUiState.tlGroup = tabUiState.tlGroup === value ? 'all' : value;
    tabUiState.tlLimit = TIMELINE_PAGE_SIZE;
    return renderTab();
  }
  if (action === 'moreTimeline') {
    tabUiState.tlLimit += TIMELINE_PAGE_SIZE;
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
  if (action === 'copyVisible') return copyVisibleLines(hit);
  return undefined;
}

function toggleSetValue(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function copyTextToClipboard(text, button, doneLabel) {
  navigator.clipboard.writeText(text).then(() => {
    const original = button.textContent;
    button.textContent = doneLabel;
    setTimeout(() => {
      button.textContent = original;
    }, 1600);
  });
}

function copyVisibleLines(button) {
  const text = lensState.data.entries
    .filter((entry) => entry.el && isRowVisible(entry))
    .map((entry) => entry.raw)
    .join('\n');
  copyTextToClipboard(text, button, 'Đã copy ' + text.split('\n').length + ' dòng');
}

/* ----------------------------------------------------- uy quyen go phim */

function handleLensInput(event) {
  const target = event.target;
  // Ve lai toi 50 the nhom, moi the mot sparkline 26 cot — do duoc 2 khung hinh roi neu chay moi phim.
  if (target.id === 'fll-q') {
    tabUiState.issueQuery = target.value;
    debounceInput('issueQuery', LIST_INPUT_DEBOUNCE_MS, () => {
      const list = document.getElementById('fll-issue-list');
      if (list) list.innerHTML = renderIssueList();
    });
    return;
  }
  // Giu ten mau nguoi dung dang go: sua bo loc se ve lai tab, khong giu thi ten bay mat.
  if (target.id === 'fll-tplname') {
    tabUiState.templateName = target.value;
    return;
  }
  // Quet ca payload cua moi request nen nang hon o tim nhom; van chi ve lai danh sach HTTP.
  if (target.id === 'fll-httpq') {
    tabUiState.httpQuery = target.value;
    debounceInput('httpQuery', LIST_INPUT_DEBOUNCE_MS, () => {
      const list = document.getElementById('fll-http-list');
      if (list) list.innerHTML = renderHttpList();
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
  // Duong nang nhat: quet 4085 dong, ghi class len bang log roi ve lai ca tab. De cho lau hon.
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
  // Nhan quyen TRUOC khi don: neu don xong moi nhan, nhip watcher cua instance cu cham vao dung khe ho
  // do se tuong root cua no bi go oan va dung lai ngay.
  claimLensOwnership();
  disposePreviousInstance();
  registerInstance();

  const root = document.createElement('div');
  root.id = ROOT_ID;
  document.body.appendChild(root);
  lensState.el.root = root;
  lensState.mutedSignatures = loadMutedSignatures();
  lensState.filterTemplates = loadFilterTemplates();

  scanLog();
  // Mo bang link chia se thi luon bung panel, ke ca khi dang chay duoi dang extension (mac dinh thu gon):
  // nguoi nhan link chi thay mot cai pill trong khi bang log da bi loc se tuong la khong co gi xay ra.
  const isRestoredFromLink = applyPermalinkFromHash();
  if (startMinimized && !isRestoredFromLink) showPill();
  else mountPanel();

  root.addEventListener('click', handleLensClick);
  root.addEventListener('input', handleLensInput);
  window.addEventListener('keydown', handleShortcut, LENS_KEY_LISTENER_OPTIONS);

  lensState.isDismissed = false;
  lastRowCount = countLogRows();
  startPageWatcher();
}

if (hasLogRows()) startLens(false);
// Chay ca khi chua gan duoc: dieu huong trong SPA khong tai lai tai lieu, watcher nay la thu duy nhat
// biet duoc "vua vao mot feedback detail moi".
startPageWatcher();
// AI-GENERATED END
