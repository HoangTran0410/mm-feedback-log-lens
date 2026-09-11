// chạy extension/lens.js thật trong node với DOM giả, trên log fixture bịa.
// Không dependency, không test runner: `node test/run.js`.
//
// Các phép thử ở đây đều sinh ra từ bug THẬT gặp lúc phát triển, không phải bịa ra cho đủ số:
//   - số call BE phồng gần gấp đôi vì log ghi hai dòng cho một call
//   - số bước fail lệch với số call fail đếm được, vì bước fail bị gộp nhầm theo cửa sổ thời gian
//   - detail của bước đầu bị gán cho cả nhóm dù các bước khác bối cảnh

const fs = require('fs');
const path = require('path');
const fixture = require('./fixture.js');

const REPO = path.join(__dirname, '..');
const noop = () => {};

let rows = [];
const makeRow = (text) => ({
  textContent: text, children: [], parentElement: null,
  classList: { add: noop, remove: noop, toggle: noop },
  getBoundingClientRect: () => ({ top: 0, height: 10 }),
});

function installFakeDom() {
  const scroller = {
    scrollTop: 0, clientHeight: 400, scrollHeight: 4000,
    classList: { add: noop, remove: noop, toggle: noop },
    getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
  };
  global.document = {
    querySelectorAll: (sel) => (String(sel).indexOf('logRow') >= 0 ? rows : []),
    querySelector: () => null,
    documentElement: { getAttribute: () => null, setAttribute: noop,
      classList: { add: noop, remove: noop, toggle: noop } },
    scrollingElement: scroller,
    body: { appendChild: noop },
    getElementById: () => null,
    createElement: () => ({ style: {}, appendChild: noop, setAttribute: noop, classList: { add: noop } }),
    addEventListener: noop, contains: () => false, activeElement: null,
  };
  // localStorage thật (trong bộ nhớ): các phép thử về nhớ trạng thái mục đóng/mở cần đọc lại được
  // đúng thứ vừa ghi, stub trả về null thì không kiểm được gì.
  const store = new Map();
  // buildPermalink đọc thẳng `location` (biến toàn cục trong trình duyệt), không qua window.
  global.location = { origin: 'https://adminapp.momocdn.net',
    pathname: '/utilities/feedback/detail', search: '?autoId=33112319', hash: '' };
  global.window = { addEventListener: noop, removeEventListener: noop, innerHeight: 800, innerWidth: 1200,
    location: global.location,
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear(),
    } };
  global.localStorage = global.window.localStorage;
  global.alert = noop;
  global.setInterval = () => 0;
  global.clearInterval = noop;
  global.setTimeout = () => 0;
  global.navigator = { clipboard: null };
}

// Các hàm nằm trong IIFE của bản build nên không với tới từ ngoài được.
// Chèn một dòng export vào TRƯỚC dấu ')();' để lấy chúng ra — vẫn là chính bản dist sẽ chạy thật,
// không phải một bản sao riêng cho test.
function loadLens() {
  const src = fs.readFileSync(path.join(REPO, 'extension/lens.js'), 'utf8');
  const exportLine = 'globalThis.__LENS={analyzeLog,attachInsights,deriveStats,buildJourney,' +
    'parseKeyValueMap,renderSummaryTab,renderIssuesTab,renderHttpSection,renderSlowSections,' +
    'renderFilterTab,' +
    'renderTimelineTab,renderConfigTab,buildConfigs,tabUiState,lensState,TAB_DEFS,' +
    'applyFilter,aimIndicesFor,sectionKey,isSectionOpen,setSectionOpen,loadOpenSections,' +
    'buildTimelineEvents,formatDuration,renderTimelineList,TIMELINE_KIND_ORDER,TIMELINE_KINDS,' +
    'canZoomFurther,minimapBounds,pickJourneyLabel,findDuplicateBlock,entryMatches,compileFilter,' +
    'SECTION_SEARCH_MIN_ROWS,buildEnvironment,buildTicketSummary,journeySurfaceName,' +
    'PANEL_CSS,detachLens,serializeFilter,applyFilterPayload,describeTemplatePayload,' +
    'buildPermalink,applyPermalinkFromHash,PERMALINK_PREFIX,setMatches,resetTabUiState,' +
    'hasSelectedTimeRange,hasAnyTimeRange,getVisibleTimeRange,buildSessions,sessionLabel,' +
    'updateMinimapRange,renderSessionChipRow,indexRowElements,handlePageRowHover,handlePageLeave,' +
    'buildErrorCodes,buildCaptureTally,regexCaptureCount,renderErrorCodeSection,' +
    'logicalPayloadText,buildPayloadSections,' +
    'renderTraceFailSection,isBadHttpCall,setTimeWindowPreset,isWindowPresetActive,' +
    'formatWindowLabel,retargetTimeWindow,extractDurations,renderCorrelationList};';
  const wired = src.replace(/\n\}\)\(\);\s*$/, '\n' + exportLine + '\n})();\n');
  if (wired === src) throw new Error('khong chen duoc dong export vao IIFE cua extension/lens.js');
  (0, eval)(wired);
  return globalThis.__LENS;
}

/* ------------------------------------------------------------------ khung test */

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push({ name, message: error.message });
  }
}

function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error((what || 'gia tri') + ': mong ' + JSON.stringify(expected) +
      ', nhan ' + JSON.stringify(actual));
  }
}

function isMutedForTest() {
  return false; // fixture không tắt tiếng chữ ký nào
}

function ok(condition, what) {
  if (!condition) throw new Error(what || 'dieu kien khong dung');
}

/* ------------------------------------------------------------------- chuẩn bị */

installFakeDom();
rows = fixture.build().map(makeRow);
const L = loadLens();

function scan() {
  const data = L.attachInsights(L.analyzeLog(2000));
  // scanLog() mới gắn nhãn này; ở đây gọi thẳng analyzeLog nên phải gắn tay.
  data.gapThresholdLabel = L.lensState.gapThresholdMs / 1000 + 's';
  L.lensState.data = data;
  L.lensState.view = data;
  return data;
}

const data = scan();
const journey = data.journey;
const stepsOf = (kind) => journey.steps.filter((step) => step.kind === kind);

/* ----------------------------------------------------------------- phép thử */

check('moc phien nhan ca dang co duoi "in <N>ms" lan dang khong', () => {
  eq(data.sessionCount, 2, 'fixture co hai lan khoi dong');
  // Phiên 2 ghi đủ ba mốc cách nhau 369ms và 382ms. Đếm từng mốc thì ra 4 phiên.
  const starts = data.entries.filter((entry) => entry.isSessionStart);
  eq(starts.length, 2, 'so dong duoc danh dau la moc bat dau phien');
});

check('doc duoc log fixture', () => {
  ok(data.entries.length >= 25, 'so dong doc duoc: ' + data.entries.length);
  eq(data.sessionCount, 2, 'so phien app');
});

check('parse params cua event tracker', () => {
  const nav = data.entries.find((e) => e.event === 'auto_screen_navigated');
  ok(nav && nav.eventParams, 'dong auto_screen_navigated phai co eventParams');
  eq(nav.eventParams.screen_name, 'ManHinhMot', 'screen_name');
  eq(nav.eventParams.pre_screen_name, 'ManHinhGoc', 'pre_screen_name');
});

check('gia tri co dau phay ben trong khong lam vo map', () => {
  const disp = data.entries.find((e) => e.event === 'auto_screen_displayed');
  eq(disp.eventParams.bundle_sof, '1,2', 'bundle_sof giu nguyen ca dau phay');
  eq(disp.eventParams.last_component.ten, 'NutBia', 'map long nhau');
});

check('event khong co params thi khong ngã', () => {
  const bare = data.entries.find((e) => e.event === 'su_kien_bia');
  ok(bare, 'phai van bat duoc ten event');
  eq(bare.eventParams, null, 'eventParams');
});

check('call BE khu trung theo trace_id', () => {
  // fixture có 5 dòng ops_receive_be nhưng chỉ 4 trace_id khác nhau (TRACE-0001 bị ghi lặp)
  eq(journey.apiTotal, 4, 'apiTotal');
  eq(journey.apiFail, 3, 'apiFail');
});

check('so buoc fail khop voi so call fail', () => {
  // đây chính là chỗ từng lệch 25 vs 23 trên log thật
  eq(journey.counts.fail, journey.apiFail, 'counts.fail phai bang apiFail');
  const tong = journey.fails.reduce((sum, row) => sum + row.count, 0);
  eq(tong, journey.apiFail, 'tong cua danh sach fail phai bang apiFail');
});

check('hai buoc fail sat nhau KHONG bi gop', () => {
  // TRACE-0002 và TRACE-0003 cách nhau 300ms, cùng api và cùng error_code:
  // mỗi trace_id là một call thật nên phải đếm riêng
  const haiFail = stepsOf('fail').filter((s) => s.label.indexOf('API_BIA_HAI') === 0);
  eq(haiFail.length, 2, 'so buoc fail cua API_BIA_HAI');
  haiFail.forEach((s) => eq(s.count, 1, 'moi buoc fail phai la mot call rieng'));
});

check('errorCode nam trong nhan cua buoc fail', () => {
  ok(stepsOf('fail').every((s) => /·\s*\d+$/.test(s.label)), 'nhan phai kem errorCode: ' +
    stepsOf('fail').map((s) => s.label).join(' / '));
});

check('hai dong ghi lap cach 2ms gop thanh mot buoc', () => {
  const lap = stepsOf('tap').filter((s) => s.label === 'nut_lap');
  ok(lap.length >= 1, 'phai co buoc nut_lap');
  eq(lap[0].count, 2, 'hai dong log gop thanh mot buoc count=2');
  eq(lap[0].indices.length, 2, 'van giu du ca hai dong de duyet');
});

check('hai thao tac cach 5s KHONG gop', () => {
  const lap = stepsOf('tap').filter((s) => s.label === 'nut_lap');
  eq(lap.length, 2, 'phai la hai buoc rieng, khong phai mot');
});

check('popup muc INFO van vao duoc muc "user da thay"', () => {
  const saw = journey.saw.find((row) => row.key === 'popup Popup Bia Canh Bao');
  ok(saw, 'phai bat duoc popup; hien co: ' + journey.saw.map((r) => r.key).join(', '));
  eq(saw.count, 1, 'so lan');
  // và nó KHÔNG được lọt vào nhóm lỗi, vì nó là INFO
  ok(data.groups.every((g) => g.sample.indexOf('Popup Bia Canh Bao') < 0),
    'popup INFO khong duoc gom vao nhom ERROR/WARNING');
});

check('nhom theo nhan bo detail khi cac buoc khac boi canh', () => {
  // nut_lap xuất hiện ở man_hai cả hai lần nên detail đồng nhất -> được giữ
  const row = journey.taps.find((r) => r.key === 'nut_lap');
  ok(row, 'phai co hang nut_lap');
  eq(row.count, 2, 'dem theo so thao tac, khong phai so dong log');
  eq(row.indices.length, 3, 'nhung van giu du ca 3 dong log');
});

check('tab HTTP van doc dong [Method:] nhu cu', () => {
  // 6 = hai call nghiệp vụ + một call xin cấu hình (call này cũng phải ghép req/res bình thường, việc
  // nó được tab Cấu hình mượn lại không được động gì đến tab HTTP) + một cặp bị ghi ngược thứ tự +
  // một response mồ côi + một cặp bình thường sau cái mồ côi đó.
  eq(data.httpCalls.length, 6, 'so call HTTP ghep tu dong [Method:]');
  eq(data.badHttpCalls.length, 1, 'call bat thuong (errorCode 404)');
});

// Bug thật: log ghi ResponsePayload TRƯỚC RequestPayload của chính nó (đo 0 / 3 / 16 lần trên ba log
// thật). Bản cũ ghép response với request đứng trước nó theo thứ tự dòng nên một call thành HAI hàng:
// một hàng "không có response" và một hàng chỉ có response. Trên log production thật: 94 request và
// 94 response mà ra 104 call, 10 cái báo thiếu response.
check('response ghi truoc request van la MOT call', () => {
  const nguoc = data.httpCalls.filter((call) => call.url.indexOf('/bia/nguoc') >= 0);
  eq(nguoc.length, 1, 'cap bi ghi nguoc phai ra dung mot call');
  ok(nguoc[0].reqIndex != null && nguoc[0].resIndex != null, 'call do phai co ca hai dau');
  ok(nguoc[0].resIndex < nguoc[0].reqIndex, 'va dung la dong response nam truoc dong request');
  ok(!L.isBadHttpCall(nguoc[0]), 'khong duoc bi dem la call bat thuong');
});

// Mặt kia của cùng một phép ghép: response không có request (log bị cắt đầu) KHÔNG được phép cướp
// request của lần gọi sau trên cùng URL — nếu cướp thì lần gọi sau lại thành "không có response".
check('response mo coi khong cuop request cua lan goi sau', () => {
  const mocoi = data.httpCalls.filter((call) => call.url.indexOf('/bia/mocoi') >= 0);
  eq(mocoi.length, 2, 'mot hang mo coi + mot cap day du');
  eq(mocoi.filter((call) => call.reqIndex === null).length, 1, 'dung mot hang khong co request');
  eq(mocoi.filter((call) => call.resIndex === null).length, 0, 'khong hang nao bi mat response');
});

check('HTTP va tracker la hai nguon dem doc lap', () => {
  ok(data.httpCalls.length !== journey.apiTotal,
    'fixture co y de hai so khac nhau, de con phat hien khi ai do tron hai nguon');
});

check('gom nhom loi bo qua chu so trong chu ky', () => {
  const group = data.groups.find((g) => g.level === 'ERROR');
  ok(group, 'phai co nhom ERROR');
  eq(group.indices.length, 2, 'hai dong chi khac con so phai ve mot nhom');
});

check('khoang lang bat duoc', () => {
  ok(data.gaps.length >= 1, 'phai thay khoang lang 6s');
});

check('journey ton trong bo loc, khong phai luc nao cung ca file', () => {
  const nua = data.entries.filter((e) => e.ts && e.ts >= data.lastTs - 3000);
  const scoped = L.deriveStats(nua);
  ok(scoped.journey.steps.length < journey.steps.length,
    'loc hep lai thi so buoc phai giam: ' + scoped.journey.steps.length + ' vs ' + journey.steps.length);
});

/* ------------------------------------------------------------ Grafana trace */

check('nhan ra log CO Grafana trace', () => {
  ok(data.traceIssues.available, 'phai bao la co');
  eq(data.traceIssues.counts.startTrace, 1, 'so startTrace');
  eq(data.traceIssues.counts.traceSuccess, 1, 'so traceSuccess');
  eq(data.traceIssues.counts.traceFail, 4, 'so traceFail');
});

check('traceFail cung errorMessage o nhieu app gom ve MOT hang', () => {
  const row = data.traceIssues.fails.find((r) => r.key.indexOf('khong tim thay ban nao') >= 0);
  ok(row, 'phai co hang do; hien co: ' + data.traceIssues.fails.map((r) => r.key).join(' | '));
  eq(row.count, 2, 'so lan');
  eq(row.apps.length, 2, 'so app bi anh huong');
  eq(row.steps.length, 1, 'goc buoc chung sau khi bo tien to flow va hau to _fail');
  eq(row.steps[0], 'lay_ban', 'ten buoc goc');
});

check('traceFail khong co errorMessage thi tach theo buoc, khong gom theo moi ma loi', () => {
  const rows = data.traceIssues.fails.filter((r) => r.codes.indexOf('200') >= 0);
  eq(rows.length, 2, 'hai buoc khac nhau phai la hai hang');
  ok(rows.every((r) => r.key.indexOf('errorCode 200') >= 0), 'nhan phai kem ma loi');
});

check('traceFail KHONG lot vao nhom chu ky (vi no la INFO)', () => {
  ok(data.groups.every((g) => g.sample.indexOf('khong tim thay ban nao') < 0),
    'dong Grafana muc INFO khong duoc gom vao nhom ERROR/WARNING');
});

check('tab Van de co nhac toi loi Grafana', () => {
  const html = L.renderIssuesTab();
  ok(html.indexOf('Grafana trace') >= 0, 'phai co muc');
  ok(html.indexOf('khong tim thay ban nao') >= 0, 'phai hien noi dung loi');
});

/* ------------------------------------------------- đánh dấu dòng khi lọc */

check('loc HEP thi danh dau dong duoc giu', () => {
  L.lensState.filter.levels.clear();
  L.lensState.filter.levels.add('ERROR');
  L.lensState.filter.hideOthers = true;
  L.applyFilter(false);
  eq(L.lensState.filterDomMode, 'keep', 'giu it dong thi danh dau phia giu');
  const giu = data.entries.filter((e) => e.isMarked).length;
  const tong = data.entries.length;
  ok(giu * 2 <= tong, 'so dong mang dau (' + giu + ') phai la phia it hon trong ' + tong);
});

check('loc RONG thi dao lai, danh dau dong bi loai', () => {
  L.lensState.filter.levels.clear();
  // Giữ gần hết: bỏ mọi mức TRỪ một mức hiếm
  ['ERROR', 'WARNING', 'INFO'].forEach((lv) => L.lensState.filter.levels.add(lv));
  L.applyFilter(false);
  const giuLai = data.entries.filter((e) => e.isKept).length;
  const mangDau = data.entries.filter((e) => e.isMarked).length;
  eq(L.lensState.filterDomMode, 'drop', 'giu gan het thi phai dao sang danh dau phia bi loai');
  ok(mangDau <= data.entries.length - giuLai + 1,
    'so dau (' + mangDau + ') phai bam theo so dong BI LOAI, khong phai so dong giu (' + giuLai + ')');
  ok(mangDau * 2 <= data.entries.length, 'va van la phia it hon');
});

check('doi qua doi lai khong de sot dau cu', () => {
  L.lensState.filter.levels.clear();
  L.lensState.filter.levels.add('ERROR');
  L.applyFilter(false);
  eq(L.lensState.filterDomMode, 'keep', 've lai che do keep');
  // Mọi dòng mang dấu đều phải là dòng được giữ; nếu sót dấu 'drop' cũ thì điều này sai.
  const sai = data.entries.filter((e) => e.isMarked && !e.isKept).length;
  eq(sai, 0, 'khong dong nao vua mang dau vua bi loai');
  L.lensState.filter.levels.clear();
  L.applyFilter(false);
});

/* ------------------------------------------ miniapp tải lỗi + thời gian tải */

check('stage loi tai miniapp vao muc "user da thay"', () => {
  const nhan = journey.saw.map((r) => r.key);
  ok(nhan.indexOf('màn hình lỗi tải miniapp') >= 0, 'phai co man loi; hien co: ' + nhan.join(', '));
  ok(nhan.indexOf('miniapp crash JS') >= 0, 'phai co crash JS');
  // stage đo lường thuần tuý thì KHÔNG được vào
  ok(nhan.indexOf('miniapp_load_start') < 0, 'stage do luong khong duoc coi la thu user thay');
});

check('thoi gian tai man: lay so co san, khong lay state=interaction', () => {
  const loads = journey.screenLoads;
  const cham = loads.find((r) => r.key === 'ManHinhCham');
  ok(cham, 'phai co ManHinhCham; hien co: ' + loads.map((r) => r.key).join(', '));
  eq(cham.count, 2, 'so lan do');
  eq(cham.worstMs, 4200, 'lan cham nhat');
  eq(cham.avgMs, 3150, 'trung binh');
  ok(loads.some((r) => r.key === 'ManHinhNhanh'), 'auto_load_progress_tracked cung phai duoc tinh');
  ok(!loads.some((r) => r.key === 'ManHinhKhac'), 'state=interaction khong phai thoi gian tai');
  eq(loads[0].key, 'ManHinhCham', 'sap theo lan cham nhat');
});

check('tab Cham hien muc man tai lau', () => {
  const html = L.renderSlowSections();
  ok(html.indexOf('Màn tải lâu nhất') >= 0, 'phai co muc');
  ok(html.indexOf('ManHinhCham') >= 0, 'phai hien ten man');
});

/* --------------------------------------------- nhiễu từ chính lớp đo lường */

check('nhom nhieu do luong bi danh dau, nhom that thi khong', () => {
  const noise = data.groups.filter((g) => g.noiseLabel);
  // Hai dòng "no traceId" khác tên bước nên khác chữ ký -> hai nhóm; cộng handleError là ba.
  eq(noise.length, 3, 'so nhom nhieu');
  const nhan = Array.from(new Set(noise.map((g) => g.noiseLabel))).sort();
  eq(nhan.length, 2, 'hai loai nhan');
  eq(nhan[0], 'GrafanaTrace mất traceId', 'nhan 1');
  eq(nhan[1], 'Hàng đợi gửi trace Grafana lỗi', 'nhan 2');
  const that = data.groups.filter((g) => !g.noiseLabel && g.level === 'ERROR');
  ok(that.length >= 1, 'nhom loi that phai con nguyen');
  ok(that.every((g) => g.sample.indexOf('Grafana') < 0), 'nhom that khong duoc dinh Grafana');
});

check('nhieu bi tach khoi danh sach chinh nhung van xem duoc', () => {
  L.tabUiState.showNoise = false;
  const an = L.renderIssuesTab();
  ok(an.indexOf('Nhiễu từ hệ thống đo lường') >= 0, 'phai co khoi rieng');
  ok(an.indexOf('no traceId') < 0, 'khi dang an thi khong duoc hien noi dung nhieu');
  L.tabUiState.showNoise = true;
  const hien = L.renderIssuesTab();
  ok(hien.indexOf('no traceId') >= 0, 'bam mo thi phai hien');
  L.tabUiState.showNoise = false;
});

check('chip dem dau tab Van de khong tinh nhom nhieu', () => {
  const html = L.renderIssuesTab();
  const conLai = data.groups.filter((g) => !g.noiseLabel && !isMutedForTest(g)).length;
  ok(html.indexOf('Tất cả <em>' + conLai + '</em>') >= 0,
    'chip "Tat ca" phai la ' + conLai + ' (da tru nhom nhieu)');
});

check('phan biet co traceFail that hay chi co dong khong bi cat', () => {
  ok(data.traceIssues.available, 'fixture co dong trace');
  ok(data.traceIssues.hasGated, 'fixture co ca startTrace/traceFail');
});

/* ------------------------------------------------------- render mọi tab, mọi trạng thái */

function renderAll(label) {
  L.TAB_DEFS.forEach((tab) => {
    const render = { sum: L.renderSummaryTab, iss: L.renderIssuesTab, cfg: L.renderConfigTab,
      flt: L.renderFilterTab, tl: L.renderTimelineTab }[tab.id];
    check('render tab ' + tab.label + ' — ' + label, () => {
      const html = render();
      const opens = (html.match(/<div/g) || []).length;
      const closes = (html.match(/<\/div>/g) || []).length;
      eq(opens, closes, 'so the <div> mo va dong');
      ok(!/undefined|NaN|\[object Object\]/.test(html),
        'HTML lot chu undefined/NaN: ' + (html.match(/.{0,50}(undefined|NaN)/) || [''])[0]);
    });
  });
}

/* ------------------------------------------------------------ tab Cấu hình */

const cfg = data.configs;
const cfgKey = (source, key) => cfg.bySource[source].find((item) => item.key === key);

check('cau hinh: doc duoc du 4 nguon co trong fixture', () => {
  ok(cfgKey('be', 'cau_hinh_bia'), 'thieu khoa tu Persist ... raw=');
  ok(cfgKey('wa', 'tabbar_bia'), 'thieu khoa webadmin');
  ok(cfgKey('cdn', 'bang_loi_bia.json'), 'thieu file config tren CDN');
  ok(cfgKey('ab', 'BIA_THU_NGHIEM'), 'thieu namespace A/B');
});

check('cau hinh: gia tri va ghi chu lay dung', () => {
  eq(cfgKey('wa', 'tabbar_bia').latest.value, '200K', 'gia tri webadmin');
  eq(cfgKey('ab', 'BIA_THU_NGHIEM').latest.value, 'nhanh_moi', 'nhanh A/B');
  ok(cfgKey('ab', 'BIA_THU_NGHIEM').note.indexOf('bia.2') >= 0, 'ghi chu phai co ten thi nghiem');
  ok(cfgKey('be', 'cau_hinh_bia').latest.value.indexOf('"tiLe":0.3') >= 0, 'raw JSON');
});

// Hai dòng A/B ghi CÙNG một tag: đếm 2 lần xuất hiện nhưng chỉ MỘT giá trị.
// Nếu chỗ nào đó so sánh sai thì chỗ này báo "2 giá trị khác nhau" mà thực tế không đổi gì.
check('cau hinh: ghi lai cung gia tri thi khong tinh la doi', () => {
  const item = cfgKey('ab', 'BIA_THU_NGHIEM');
  eq(item.count, 2, 'so dong');
  eq(item.values.length, 1, 'so gia tri khac nhau');
  eq(item.changed, false, 'changed');
});

check('cau hinh: doi gia tri thi giu ca hai va len dau bang', () => {
  const item = cfgKey('be', 'cau_hinh_doi');
  eq(item.values.length, 2, 'so gia tri');
  eq(item.changed, true, 'changed');
  eq(item.values[0].value, '{"enable":true}', 'gia tri cu');
  eq(item.latest.value, '{"enable":false}', 'gia tri moi nhat');
  eq(cfg.items[0].key, 'cau_hinh_doi', 'khoa co nhieu gia tri phai xep truoc');
});

// Nút "JSON" chỉ được hiện khi GIÁ TRỊ thật sự có JSON. Đo trên cả dòng log thì hỏng: dòng nào cũng
// có "[Module: ...]" nên hàng nào cũng mọc ra nút, bấm vào lại rỗng.
check('cau hinh: nut JSON chi hien khi gia tri co JSON that', () => {
  eq(cfgKey('be', 'cau_hinh_bia').latest.hasJson, true, 'gia tri raw={...} phai co nut');
  eq(cfgKey('wa', 'tabbar_bia').latest.hasJson, false, 'gia tri "200K" khong duoc co nut');
  eq(cfgKey('cdn', 'bang_loi_bia.json').latest.hasJson, false, 'gia tri la url, khong co nut');
});

// Bug thật: một khoá ghi 4 lần cùng một giá trị chỉ giữ được chỉ số của dòng đầu. Bấm vào là nhảy tới
// dòng đó rồi kẹt — thanh dưới không có gì để duyệt vì nó chỉ biết danh sách khớp bộ lọc.
check('cau hinh: giu du chi so dong de duyet duoc ca nhom', () => {
  const abKey = cfgKey('ab', 'BIA_THU_NGHIEM');
  eq(abKey.count, 2, 'so dong cua khoa');
  eq(abKey.indices.length, 2, 'phai giu ca hai chi so o cap nhom');
  eq(abKey.values.length, 1, 'van chi mot gia tri');
  eq(abKey.values[0].indices.length, 2, 'ca hai dong deu thuoc gia tri do');
  const doi = cfgKey('be', 'cau_hinh_doi');
  eq(doi.indices.length, 2, 'khoa doi gia tri: hai dong');
  eq(doi.values[0].indices.length, 1, 'moi gia tri mot dong');
  eq(doi.values[1].indices.length, 1, 'moi gia tri mot dong');
});

check('cau hinh: hang va tieu de khoa deu phat ra data-lines de duyet', () => {
  const html = L.renderConfigTab();
  const abKey = cfgKey('ab', 'BIA_THU_NGHIEM');
  ok(html.indexOf('data-lines="' + abKey.indices.join(',') + '"') >= 0,
    'tieu de khoa phai mang du chi so');
  ok(html.indexOf('data-lines="' + abKey.values[0].indices.join(',') + '"') >= 0,
    'hang gia tri phai mang du chi so');
  ok(html.indexOf('data-jump="' + abKey.values[0].domIndex + '"') < 0,
    'khong duoc quay lai data-jump: nhay mot dong thi khong duyet duoc nhom');
  eq(L.aimIndicesFor({ dataset: { lines: abKey.indices.join(',') } }).length, abKey.indices.length,
    'mui ten cung phai danh dau ca nhom');
});

check('cau hinh: call BE xin cau hinh tach rieng khoi bang khoa', () => {
  eq(cfg.calls.length, 1, 'so call');
  eq(cfg.calls[0].path, '/user-config/lay-bia', 'duong dan');
  ok(!cfg.items.some((item) => item.key.indexOf('user-config') >= 0),
    'call HTTP khong duoc lot vao bang khoa');
});

// Hai cái bẫy: payload khuyến mãi dài (chữ displayConfig nằm SAU dấu "{") và động từ "configure".
check('cau hinh: khong nhan nham payload va dong tu configure', () => {
  const all = cfg.items.map((item) => item.key).join(' | ');
  ok(all.indexOf('onMoKhuyenMai') < 0, 'payload khuyen mai lot vao: ' + all);
  ok(all.indexOf('configure') < 0, 'dong "configure xong" lot vao: ' + all);
});

check('cau hinh: tab tu an khi log khong co cau hinh nao', () => {
  const tab = L.TAB_DEFS.find((item) => item.id === 'cfg');
  ok(tab && typeof tab.hide === 'function', 'tab Cau hinh phai co ham hide');
  eq(tab.hide(data), false, 'log fixture co cau hinh nen KHONG duoc an');
  eq(tab.hide({ configs: L.buildConfigs([], []) }), true, 'log rong thi phai an');
  // Hàm này phải được gọi với data ĐẦY ĐỦ. Gọi với view đang lọc thì lọc hẹp lại là tab biến mất
  // giữa chừng, kéo người dùng về tab khác mà không hiểu tại sao.
  ok(!tab.hide(L.lensState.data), 'data day du van con cau hinh');
});

/* --------------------------------------------- mũi tên trỏ lên minimap + mục đóng/mở */

// Mũi tên phải chỉ tới ĐÚNG những dòng mà hàng đó đại diện — cùng cách đọc như lúc bấm.
// Làm sai chỗ này thì mũi tên vẫn hiện, chỉ là trỏ nhầm chỗ, nên phép thử này giữ cho nó đúng.
check('mui ten: hang nao tro toi dong nao', () => {
  eq(L.aimIndicesFor({ dataset: { jump: '7' } })[0], 7, 'data-jump');
  eq(L.aimIndicesFor({ dataset: { bucket: '-1' } }).length, 0, 'o minimap rong thi khong tro dau ca');
  const group = data.groups[0];
  const fromGroup = L.aimIndicesFor({ dataset: { group: '0' } });
  eq(fromGroup.length, group.indices.length, 'so dong cua mot nhom loi');
  const call = data.httpCalls[0];
  const fromCall = L.aimIndicesFor({ dataset: { call: '0' } });
  eq(fromCall.length, [call.reqIndex, call.resIndex].filter((i) => i != null).length,
    'mot call tro toi ca dong request lan response');
  eq(L.aimIndicesFor({ dataset: {} }).length, 0, 'khong co gi de tro thi tra ve rong');
});

check('mui ten: hang tro toi hang tram dong van tra du, viec cat bot la o luc ve', () => {
  const big = data.groups.reduce((a, b) => (a.indices.length > b.indices.length ? a : b));
  const index = data.groups.indexOf(big);
  eq(L.aimIndicesFor({ dataset: { group: String(index) } }).length, big.indices.length, 'so dong');
});

check('muc dong/mo: mac dinh dong, mo roi thi nho', () => {
  const key = L.sectionKey('sum', 'Lỗi nổi bật');
  eq(key, 'sum::Lỗi nổi bật', 'khoa gom ca ten tab');
  eq(L.isSectionOpen('sum', 'Lỗi nổi bật'), false, 'mac dinh phai la dong');
  L.setSectionOpen(key, true);
  eq(L.isSectionOpen('sum', 'Lỗi nổi bật'), true, 'mo roi');
  eq(localStorage.getItem('fll.openSections'), JSON.stringify([key]), 'da ghi vao localStorage');
  L.setSectionOpen(key, false);
  eq(L.isSectionOpen('sum', 'Lỗi nổi bật'), false, 'thu lai');
  eq(localStorage.getItem('fll.openSections'), '[]', 'xoa khoi localStorage');
});

// Cùng tên mục ở hai tab khác nhau là HAI mục: mở ở tab này không được kéo tab kia mở theo.
check('muc dong/mo: trung ten o hai tab van la hai muc rieng', () => {
  L.setSectionOpen(L.sectionKey('flt', 'Phiên app'), true);
  eq(L.isSectionOpen('flt', 'Phiên app'), true, 'tab Loc');
  eq(L.isSectionOpen('sum', 'Phiên app'), false, 'tab Tong quan phai van dong');
  L.setSectionOpen(L.sectionKey('flt', 'Phiên app'), false);
});

/* ------------------------------------------- tab đã gộp + badge trên tiêu đề mục */

check('gop tab: chi con nam tab, khong con http/slow', () => {
  const ids = L.TAB_DEFS.map((tab) => tab.id).join(',');
  eq(ids, 'sum,iss,cfg,flt,tl', 'danh sach tab');
});

check('gop tab: muc cua Cham nam trong Tong quan, muc HTTP nam trong Van de', () => {
  const sum = L.renderSummaryTab();
  ok(sum.indexOf('data-sec="Mọi con số thời lượng"') >= 0, 'Tong quan phai co muc thoi luong');
  const iss = L.renderIssuesTab();
  ok(iss.indexOf('data-sec="Call HTTP"') >= 0, 'Van de phai co muc Call HTTP');
  ok(iss.indexOf('id="fll-httpq"') >= 0, 'o tim HTTP phai di theo');
});

// data-sec là khoá nhớ trạng thái đóng/mở. Badge đổi theo từng log, lọt vào khoá thì mở một mục ở log
// này sang log khác lại thấy đóng — nên badge phải nằm NGOÀI giá trị data-sec.
check('badge: khong duoc lot vao khoa nho trang thai', () => {
  const cfg = L.renderConfigTab();
  ok(cfg.indexOf('data-sec="A/B testing"') >= 0, 'ten muc phai sach, khong kem so');
  ok(cfg.indexOf('data-sec="A/B testing — ') < 0, 'so khong duoc nam trong data-sec');
});

check('badge: to accent khi muc do dang co bo loc bat', () => {
  const before = L.lensState.filter.text;
  L.lensState.filter.text = 'bia';
  const html = L.renderFilterTab();
  ok(html.indexOf('fll-secbdg act') >= 0, 'phai co it nhat mot badge accent');
  ok(html.indexOf('/bia/') >= 0, 'badge phai hien chuoi dang tim');
  L.lensState.filter.text = before;
  ok(L.renderFilterTab().indexOf('chưa đặt') >= 0, 'bo loc rong thi badge bao chua dat');
});

check('tab Dien bien: co chip loc theo phien app', () => {
  ok(L.renderTimelineTab().indexOf('data-act="setSession"') >= 0,
    'log fixture co 2 phien nen phai co chip chon phien');
});

// Bug thật: ba mốc khởi động nổ trong cùng một lần mở app, cách nhau vài trăm ms, mà mỗi mốc lại
// tính thành một phiên. Đo trên log thật: khoảng cách trong cùng một chùm tối đa 2078ms, còn giữa hai
// lần khởi động thật tối thiểu 75 440ms.
check('phien app: ba moc sat nhau chi la MOT lan khoi dong', () => {
  eq(data.sessionCount, 2, 'so phien');
  const perSession = {};
  data.entries.forEach((entry) => {
    if (entry.isSessionStart) perSession[entry.session] = (perSession[entry.session] || 0) + 1;
  });
  eq(JSON.stringify(perSession), '{"1":1,"2":1}', 'moi phien dung mot moc bat dau');
});

check('phien app: tab Dien bien khong ve ba moc "App khoi dong" chong nhau', () => {
  const html = L.renderTimelineTab();
  // Đếm thẻ hàng, không đếm chữ: chữ "App khởi động" còn nằm cả trong hàng chú giải và trong
  // chú giải của biểu tượng.
  eq((html.match(/class="fll-ev boot"/g) || []).length, 2, 'so moc khoi dong tren dong thoi gian');
});

// Chấm tròn màu không tự nói ra loại mốc. Mỗi loại phải có biểu tượng + tên đọc được, và chính dãy
// chip lọc cũng là hàng chú giải — không còn hàng chú giải riêng nữa.
check('dong thoi gian: moi loai moc co bieu tuong va ten', () => {
  L.tabUiState.tlKinds = new Set();
  const html = L.renderTimelineTab();
  ok(html.indexOf('class="fll-ev-ic" data-tip="User chạm"') >= 0, 'moc cham phai co bieu tuong kem ten');
  ok(html.indexOf('class="fll-ev-ic" data-tip="Khoảng lặng, không có log"') >= 0, 'moc khoang lang');
  ok(html.indexOf('class="fll-ev-ic" data-tip="App khởi động"') >= 0, 'moc khoi dong');
  ok(html.indexOf('data-act="tlKind" data-value="jr-tap"') >= 0, 'phai co chip loc theo loai moc');
  ok(html.indexOf('class="fll-chip-ic">' + L.TIMELINE_KINDS['jr-tap'].icon) >= 0,
    'chip phai mang dung bieu tuong cua loai do');
});

// Chọn được NHIỀU loại cùng lúc, không phải một nhóm một lúc như trước.
check('dong thoi gian: loc theo nhieu loai moc cung luc', () => {
  const all = L.buildTimelineEvents(L.lensState.data);
  const taps = all.filter((event) => event.kind === 'jr-tap').length;
  const boots = all.filter((event) => event.kind === 'boot').length;
  ok(taps && boots, 'fixture phai co ca hai loai');
  L.tabUiState.tlKinds = new Set(['jr-tap', 'boot']);
  const html = L.renderTimelineList();
  eq((html.match(/class="fll-ev jr-tap"/g) || []).length, taps, 'so moc cham');
  eq((html.match(/class="fll-ev boot"/g) || []).length, boots, 'so moc khoi dong');
  ok(html.indexOf('class="fll-ev jr-screen"') < 0, 'loai khong chon thi khong duoc hien');
  L.tabUiState.tlKinds = new Set();
});

// Ô tìm mốc: chỉ vẽ lại danh sách, và phải báo rõ khi không có gì khớp.
check('dong thoi gian: o tim loc theo ten moc', () => {
  L.tabUiState.tlQuery = 'khong-the-nao-co-chuoi-nay';
  ok(L.renderTimelineList().indexOf('Không mốc nào khớp') >= 0, 'phai bao khong khop');
  L.tabUiState.tlQuery = '';
  ok(L.renderTimelineTab().indexOf('id="fll-tlq"') >= 0, 'tab phai co o tim');
});

// Bug thật: hàng "Khoảng lặng" hiện giờ của dòng TRƯỚC khoảng lặng, nhưng bấm (và mũi tên) lại trỏ
// tới dòng SAU nó. Hai đầu có thể cách nhau cả tiếng đồng hồ -> nhìn vào thấy giao diện tự mâu thuẫn.
//
// Bug thứ hai, cùng một hàng đó: một khoảng lặng có HAI dòng log nhưng bấm vào chỉ tới được một, đầu
// kia không có đường nào mở ra. Nay hàng dùng data-lines nên cả hai vào thanh duyệt, bấm `n` là sang.
check('khoang lang: hang mang ca hai dau vao thanh duyet, mui ten danh dau ca hai', () => {
  const gapEvent = L.buildTimelineEvents(L.lensState.data).find((event) => event.kind === 'gap');
  ok(gapEvent, 'fixture phai co it nhat mot khoang lang');
  ok(gapEvent.tsEnd && gapEvent.tsEnd > gapEvent.ts, 'phai co moc ket thuc, va no o sau moc bat dau');
  eq(gapEvent.lines.length, 2, 'hang ung voi dung hai dong log');
  ok(gapEvent.lines[0] < gapEvent.lines[1], 'dau khoang lang phai dung truoc cuoi khoang lang');
  ok(gapEvent.linesLabel, 'phai co nhan de thanh duoi noi dang duyet cai gi');
  const html = L.renderTimelineTab();
  ok(html.indexOf('data-lines="' + gapEvent.lines.join(',') + '"') >= 0,
    'thuoc tinh data-lines phai co trong HTML — no la thu dua ca hai dong vao thanh duyet');
  ok(html.indexOf('data-label="' + gapEvent.linesLabel + '"') >= 0, 'kem nhan cho thanh duoi');
  eq(L.aimIndicesFor({ dataset: { lines: gapEvent.lines.join(',') } }).length, 2,
    'mui ten van danh dau ca hai dau');
  // Bấm vào hàng đó phải đứng ở ĐẦU khoảng lặng — đúng dòng mà chữ trên hàng đang nói tới.
  L.setMatches(gapEvent.lines, gapEvent.linesLabel);
  eq(L.lensState.matches.length, 2, 'thanh duoi co hai dong de duyet');
  eq(L.lensState.data.entries[L.lensState.matches[0]].domIndex, gapEvent.lines[0], 'dung o dau khoang lang');
});

// "14182s" không ai đọc ra là gần bốn tiếng.
check('thoi luong dai phai doc duoc', () => {
  eq(L.formatDuration(950), '950ms', 'duoi mot giay');
  eq(L.formatDuration(4200), '4.2s', 'vai giay');
  eq(L.formatDuration(45000), '45s', 'duoi mot phut');
  eq(L.formatDuration(155000), '2m35s', 'vai phut');
  eq(L.formatDuration(14182000), '3h56m', 'vai tieng');
});

// Bug thật: một màn báo "11h24m · 2×" trong khi hai dòng log của nó cách nhau 2 giây. Nguyên nhân:
// khoảng cách đo sang bước màn hình kế tiếp, mà bước đó nằm ở LẦN MỞ APP SAU, cách cả tiếng đồng hồ.
check('o lau tren man: khong do vat qua hai phien app', () => {
  const cuoiPhien = journey.screens.find((row) => row.key.indexOf('ManHinhCuoiPhien') >= 0);
  ok(cuoiPhien, 'fixture phai co man cuoi phien 1');
  eq(cuoiPhien.ms, 0, 'man cuoi mot phien khong duoc mang thoi gian cua khoang app bi tat');
  journey.screens.forEach((row) => {
    ok(row.ms <= 600000, 'khong man nao duoc vuot nguong hop ly: ' + row.key + ' = ' + row.ms + 'ms');
  });
});

// Hiện tổng mà để cạnh "2x" thì dễ tưởng mỗi lần bằng từng đó. Phải giữ cả lần lâu nhất.
check('o lau tren man: giu ca tong lan lan lau nhat', () => {
  journey.screens.forEach((row) => {
    ok(row.maxMs <= row.ms, row.key + ': lan lau nhat khong the lon hon tong');
  });
  const html = L.renderSummaryTab();
  if (journey.screens.some((row) => row.ms > 0)) {
    ok(html.indexOf('lần vào, lần lâu nhất') >= 0, 'hang phai co chu giai noi ro tong va lan lau nhat');
  }
});

// Phóng to minimap: nút "phóng to" phải còn hiện khi đã phóng rồi mà người dùng chọn tiếp một khoảng
// NHỎ HƠN bên trong vùng đó — nếu không thì phóng một lần là hết đường phóng sâu.
check('minimap: con phong to duoc khi chon nho hon vung dang ve', () => {
  const bounds = { from: 1000, to: 2000 };
  eq(L.canZoomFurther({ from: 1200, to: 1800 }, bounds), true, 'nho hon ca hai dau');
  eq(L.canZoomFurther({ from: 1200, to: 2000 }, bounds), true, 'nho hon o dau trai');
  eq(L.canZoomFurther({ from: 1000, to: 1800 }, bounds), true, 'nho hon o dau phai');
  eq(L.canZoomFurther({ from: 1000, to: 2000 }, bounds), false, 'trung khit thi bam cung khong doi gi');
  eq(L.canZoomFurther({ from: 900, to: 2100 }, bounds), false, 'rong hon khung dang ve');
});

check('minimap: khong phong to thi khung ve la ca log', () => {
  L.lensState.mapZoom = null;
  const bounds = L.minimapBounds();
  eq(bounds.from, L.lensState.data.firstTs, 'mep trai');
  eq(bounds.to, L.lensState.data.lastTs, 'mep phai');
  L.lensState.mapZoom = { from: 111, to: 222 };
  eq(JSON.stringify(L.minimapBounds()), '{"from":111,"to":222}', 'dang phong thi lay dung vung do');
  L.lensState.mapZoom = null;
});

// Độ trễ trước khi hiện title="" của trình duyệt do HỆ ĐIỀU HÀNH quyết định, không đổi được bằng CSS
// hay JS. Panel này đầy chú giải nên lướt chuột qua là tooltip nhảy liên tục. Mọi chú giải phải đi qua
// data-tip để còn tự vẽ — còn sót title= nào là cái đó lại nhảy như cũ.
check('chu giai: khong con thuoc tinh title= nao trong HTML sinh ra', () => {
  const html = [L.renderSummaryTab(), L.renderIssuesTab(), L.renderConfigTab(),
    L.renderFilterTab(), L.renderTimelineTab()].join('');
  const sot = html.match(/\stitle="/g) || [];
  eq(sot.length, 0, 'con ' + sot.length + ' cho dung title= thay vi data-tip=');
  ok(html.indexOf('data-tip="') >= 0, 'va phai that su co data-tip');
});

// Lùi TỪNG NẤC chứ không nhảy thẳng về cả log: phóng ba nấc rồi muốn xem lại nấc hai thì không phải
// phóng lại từ đầu.
check('minimap: lui tung nac phong to', () => {
  L.lensState.mapZoom = null;
  L.lensState.mapZoomStack = [];
  const nac1 = { from: 100, to: 900 };
  const nac2 = { from: 300, to: 500 };
  L.lensState.mapZoomStack.push(L.lensState.mapZoom);
  L.lensState.mapZoom = nac1;
  L.lensState.mapZoomStack.push(L.lensState.mapZoom);
  L.lensState.mapZoom = nac2;
  eq(L.lensState.mapZoomStack.length, 2, 'hai nac da luu');
  L.lensState.mapZoom = L.lensState.mapZoomStack.pop();
  eq(JSON.stringify(L.lensState.mapZoom), JSON.stringify(nac1), 'lui mot nac ve nac 1');
  L.lensState.mapZoom = L.lensState.mapZoomStack.pop();
  eq(L.lensState.mapZoom, null, 'lui tiep la ve ca log');

  // Nút "xoá hết" phải dọn CẢ hai: quên dọn ngăn xếp thì lần phóng sau sẽ lùi về những nấc cũ đã chết.
  L.lensState.mapZoomStack = [null, nac1];
  L.lensState.mapZoom = nac2;
  L.lensState.mapZoom = null;
  L.lensState.mapZoomStack = [];
  eq(L.lensState.mapZoom, null, 'khung ve la ca log');
  eq(L.lensState.mapZoomStack.length, 0, 'ngan xep phai rong theo');
});

// Bug thật: popup ghi title=null thì nhãn ra đúng chữ "popup", nên hai popup khác hẳn nhau bị gom
// thành một hàng "2x popup" — người đọc không còn gì để phân biệt. Quy tắc ưu tiên phải tụt xuống
// component_name, rồi component_id, rồi feature_code.
check('nhan buoc: popup khong co title thi lay ten thanh phan', () => {
  const keys = journey.saw.map((row) => row.key);
  ok(keys.indexOf('popup goi_y_yeu_thich') >= 0, 'phai lay component_name; hien co: ' + keys.join(', '));
  ok(keys.indexOf('popup nhac_cap_nhat') >= 0, 'component_id phai cat lay doan cuoi');
  eq(keys.filter((key) => key === 'popup ?').length, 0, 'khong duoc con hang nao ten tron');
  // Hai popup đó khác nhau thật -> phải là HAI hàng, không được gom thành một "2x"
  const gopNham = journey.saw.filter((row) => row.key === 'popup' && row.count > 1);
  eq(gopNham.length, 0, 'khong duoc gom hai popup khac nhau vao mot hang');
});

check('nhan buoc: cat bot nhan qua dai', () => {
  const dai = L.pickJourneyLabel(['x'.repeat(120)], '?');
  eq(dai.length, 48, 'nhan phai bi cat con 48 ky tu');
  ok(dai.endsWith('…'), 'va co dau cat');
  eq(L.pickJourneyLabel(['null', '', 'undefined', 'ten_that'], '?'), 'ten_that', 'bo qua gia tri rong');
  eq(L.pickJourneyLabel(['a/b/c/ten_cuoi'], '?'), 'ten_cuoi', 'component_id lay doan cuoi');
  eq(L.pickJourneyLabel(['null'], 'du_phong'), 'du_phong', 'het lua chon thi dung du phong');
});

/* ------------------------------------------------------- khối log bị lặp nguyên xi */

// Một log feedback production thật dài 4222 dòng hoá ra là 2111 dòng đầu LẶP LẠI y hệt (md5 hai nửa
// bằng nhau). Tool không biết nên đếm gấp đôi mọi thứ: "lỗi này 4 lần" thật ra 2 lần.
const fakeEntries = (texts) => texts.map((raw, index) => ({ raw, lineNo: index + 1, isDuplicate: false }));
const dongDai = (n) => 'dong log gia du dai de khong bi coi la trung ngau nhien #' + n;

check('khoi lap: nhan ra khoi bi noi doi', () => {
  const goc = [];
  for (let i = 0; i < 60; i += 1) goc.push(dongDai(i));
  const block = L.findDuplicateBlock(fakeEntries(goc.concat(goc)));
  ok(block, 'phai nhan ra');
  eq(block.offset, 60, 'do lech');
  eq(block.matched, 60, 'so dong khop');
  eq(block.lineFrom, 61, 'khoi lap bat dau o dong 61');
  eq(block.lineTo, 120, 'va ket thuc o dong 120');
  eq(block.sourceLineFrom, 1, 'khoi goc bat dau o dong 1');
});

// Dòng trống / dòng phân cách nằm xen giữa khối lặp là chuyện bình thường. Coi chúng là cắt đứt chuỗi
// thì khối 2111 dòng của log thật chỉ nhận ra được 491 dòng — đã đo.
check('khoi lap: dong trong xen giua khong duoc cat dut chuoi', () => {
  const goc = [];
  for (let i = 0; i < 60; i += 1) goc.push(i % 10 === 9 ? '' : dongDai(i));
  const block = L.findDuplicateBlock(fakeEntries(goc.concat(goc)));
  ok(block, 'phai nhan ra');
  ok(block.matched >= 50, 'so dong khop phai gan het, nhan duoc ' + block.matched);
  ok(block.length >= 59, 'doan bi lap phai trai het khoi, nhan duoc ' + block.length);
});

check('khoi lap: log sach thi khong bao gi', () => {
  eq(L.findDuplicateBlock(fakeEntries(Array.from({ length: 200 }, (unused, i) => dongDai(i)))), null,
    'moi dong khac nhau');
  // Vài dòng lặp lẻ tẻ (heartbeat, dòng phân cách) không được tính là khối lặp.
  const leTe = [];
  for (let i = 0; i < 200; i += 1) leTe.push(i % 25 === 0 ? dongDai(0) : dongDai(i));
  eq(L.findDuplicateBlock(fakeEntries(leTe)), null, 'trung le te khong phai khoi lap');
  eq(L.findDuplicateBlock(fakeEntries([])), null, 'log rong');
});

check('khoi lap: log fixture khong bi lap', () => {
  eq(data.duplicate, null, 'fixture phai sach');
});

// Bộ lọc "bỏ khối lặp" phải thật sự loại dòng ra khỏi mọi thống kê.
check('khoi lap: bo loc loai dong lap ra khoi thong ke', () => {
  const entry = { raw: 'x', level: 'INFO', module: '', session: 1, ts: 1, isDuplicate: true };
  L.lensState.filter.skipDuplicate = false;
  ok(L.entryMatches(entry, L.compileFilter(), null), 'chua bat thi van tinh');
  L.lensState.filter.skipDuplicate = true;
  ok(!L.entryMatches(entry, L.compileFilter(), null), 'bat roi thi phai loai');
  entry.isDuplicate = false;
  ok(L.entryMatches(entry, L.compileFilter(), null), 'dong khong lap van giu');
  L.lensState.filter.skipDuplicate = false;
});

// False positive lớn nhất của tính năng khoảng lặng: "user bấm Home" bị đọc thành "app đứng im".
// Đo trên ba log thật sau khi sửa: log 33112319 có 22 khoảng lặng, hai cái dài nhất (2m23s và 3m52s)
// đều là app ở nền — bỏ chúng ra thì khoảng im lặng thật dài nhất chỉ còn 8.5s.
check('khoang lang: tach duoc "app xuong nen" khoi "app treo"', () => {
  const nen = data.gaps.filter((gap) => gap.cause === 'background');
  eq(nen.length, 1, 'fixture co dung mot khoang do app xuong nen');
  ok(nen[0].downTs && nen[0].upTs && nen[0].upTs > nen[0].downTs, 'phai co ca moc xuong lan moc len');
  const conLai = data.gaps.filter((gap) => gap.cause !== 'background');
  ok(conLai.length >= 1, 'va con khoang lang khong co moc trang thai nao');
  conLai.forEach((gap) => eq(gap.cause, '', 'khoang khong co moc thi khong duoc gan nguyen nhan'));
});

check('khoang lang: doc duoc appState tu dong MQTT', () => {
  const co = data.entries.filter((entry) => entry.appState);
  eq(co.length, 2, 'so dong mang trang thai app');
  eq(co[0].appState, 'BACKGROUND', 'dong dau');
  eq(co[1].appState, 'FOREGROUND', 'dong sau');
});

check('khoang lang: hai loai hien khac nhau tren dong thoi gian', () => {
  L.tabUiState.tlKinds = new Set();
  const html = L.renderTimelineTab();
  ok(html.indexOf('App xuống nền') >= 0, 'phai goi dung ten, khong goi la "khoang lang"');
  ok(html.indexOf('không phải app treo') >= 0, 'va noi ro khong phai app treo');
  ok(html.indexOf('data-act="tlKind" data-value="gap-bg"') >= 0, 'co chip loc rieng cho loai nay');
});

// Ô tìm của từng mục được CHÈN SAU KHI VẼ, không renderer nào biết đến nó. Kiểm ở đây chỉ là kiểm
// ngưỡng và hai cái bẫy đã gặp; phần chèn/lọc DOM đã đo trong Chrome trên trang demo.
check('o tim tung muc: nguong hop ly va khong am tham doi', () => {
  eq(L.SECTION_SEARCH_MIN_ROWS, 6, 'duoi 6 hang thi liec mat la thay het, khong can o tim');
});

/* --------------------------------------------------- vân tay môi trường từ header HTTP */

// Đọc từ header request chứ không từ DeviceProfileManager: đo trên ba log thật, module đó có
// 27 / 9 / 0 dòng — bằng 0 trên log production, còn User-Agent thì 52 / 66 / 94 lần.
check('moi truong: doc duoc may, iOS, ban app tu User-Agent', () => {
  const env = data.environment;
  eq(env.available, true, 'phai doc duoc');
  eq(env.device, 'iPhone Bia Plus', 'ten may');
  eq(env.osVersion, '18.7.16', 'phien ban iOS');
  eq(env.appVersion, '9.9.9.99900', 'ban app');
  eq(env.flavor, 'GIALAP', 'ten build');
  eq(env.cfNetwork, '1410.1', 'CFNetwork');
  eq(env.darwin, '22.6.0', 'Darwin');
  eq(env.performance, 'low-end', 'doi may');
  eq(env.lang, 'vi', 'ngon ngu');
});

// Bẫy falsy: envFirst(entries, re, 0) — nhóm 0 là cả chuỗi khớp, nhưng "0 || 1" ra 1 nên hàm trả về
// nhóm thứ nhất và cả User-Agent không parse được. Đã dính thật, phép thử này giữ cho nó không tái diễn.
check('moi truong: lay duoc nhom 0 (ca chuoi khop)', () => {
  ok(data.environment.device && data.environment.appVersion,
    'ca hai deu phai co gia tri; rong tuc la lai dinh bay nhom 0');
});

check('moi truong: log khong co header thi bao khong co, khong doan bua', () => {
  const env = L.buildEnvironment([{ raw: 'khong co gi' }], []);
  eq(env.available, false, 'khong co header lan khong co call thi coi nhu khong doc duoc');
  eq(env.device, '', 'khong duoc bia ten may');
  eq(env.mixedBuild, false, 'khong co du lieu thi khong canh bao gi');
});

// Bản build và host là HAI chuyện khác nhau. Chỉ nói ra điều quan sát được, không kết luận hộ.
check('moi truong: nhan ra ban khong-production ma host khong co dau hieu uat/dev', () => {
  const entries = [{ raw: 'x "User-Agent":"MoMoPlatform Staging/5.16 CFNetwork/1.0 Darwin/25.6.0 (iPhone 16 iOS/26.6.1)" y' }];
  eq(L.buildEnvironment(entries, [{ host: 'api.momo.vn' }]).mixedBuild, true, 'Staging + host sach');
  eq(L.buildEnvironment(entries, [{ host: 'm.dev.mservice.io' }]).mixedBuild, false, 'co host dev thi khong lech');
  const env = L.buildEnvironment(entries, [{ host: 'm.dev.mservice.io' }]);
  eq(env.nonProdHosts.length, 1, 'phai nhan ra host dev');

  // Bản production trên App Store ghi flavor là "Store". Coi mọi thứ khác chữ "production" là đáng ngờ
  // thì log thật nào cũng bị cảnh báo nhầm — đã dính đúng lỗi đó khi test trên trang admin thật.
  const store = [{ raw: 'x "User-Agent":"MoMoPlatform Store/5.15.0.51500 CFNetwork/1.0 Darwin/25.6.0 (iPhone 16 Pro iOS/26.6)" y' }];
  eq(L.buildEnvironment(store, [{ host: 'api.momo.vn' }]).mixedBuild, false,
    'ban Store la ban that, khong duoc canh bao');
  eq(L.buildEnvironment(store, [{ host: 'api.momo.vn' }]).flavor, 'Store', 'van doc duoc ten build');
  const trong = [{ raw: 'x "User-Agent":"MoMoPlatform/5.15.0 CFNetwork/1.0 Darwin/25.6.0 (iPhone iOS/26.6)" y' }];
  eq(L.buildEnvironment(trong, [{ host: 'api.momo.vn' }]).mixedBuild, false,
    'khong co ten build thi cung khong canh bao');
});

/* ------------------------------------------------------ tóm tắt để dán vào ticket */

check('tom tat: co du phan de nguoi doc ticket hieu chuyen', () => {
  const md = L.buildTicketSummary(L.lensState.data);
  ok(md.indexOf('iPhone Bia Plus') >= 0, 'phai co thiet bi');
  ok(md.indexOf('9.9.9.99900') >= 0, 'phai co ban app');
  ok(md.indexOf('nhóm lỗi nổi bật') >= 0, 'phai co nhom loi');
  ok(md.indexOf('bước cuối trước lúc gửi') >= 0, 'phai co cac buoc cuoi');
  ok(md.indexOf('Log này không trả lời được') >= 0, 'phai co muc vung mu');
  ok(md.split('\n').length < 70, 'phai gon de dan duoc, dang ' + md.split('\n').length + ' dong');
});

// Luật của khối này: chỉ liệt kê SỰ KIỆN CÓ GIỜ. Xếp hạng nguyên nhân là suy đoán, mà nó sẽ nằm lại
// trong ticket cho người khác đọc như sự thật.
check('tom tat: khong ket luan nguyen nhan', () => {
  const md = L.buildTicketSummary(L.lensState.data);
  ok(md.indexOf('không phải kết luận nguyên nhân') >= 0, 'phai ghi ro day khong phai ket luan');
  ok(!/nguyên nhân là|do lỗi|gây ra bởi/i.test(md), 'khong duoc co cau khang dinh nhan qua');
});

// Không nhét payload thô vào: ticket đi ra ngoài, mà payload chứa số điện thoại và token.
check('tom tat: khong keo payload tho vao', () => {
  const md = L.buildTicketSummary(L.lensState.data);
  ok(md.indexOf('RequestPayload') < 0 && md.indexOf('ResponsePayload') < 0, 'khong duoc co payload');
  ok(md.indexOf('User-Agent') < 0, 'khong duoc dan ca header vao');
  md.split('\n').forEach((line) => {
    ok(line.length < 200, 'moi dong phai ngan, dong dai nhat: ' + line.slice(0, 80));
  });
});

check('tom tat: bao ro khi log bi noi doi', () => {
  const goc = L.lensState.data.duplicate;
  L.lensState.data.duplicate = { length: 2110, from: 0, to: 2109 };
  ok(L.buildTicketSummary(L.lensState.data).indexOf('2110 dòng lặp lại nguyên xi') >= 0,
    'phai canh bao ngay trong ticket');
  L.lensState.data.duplicate = goc;
});

// Đo trên log thật 9363 dòng: phụ đề header ghi "34 khoảng lặng" trong khi thẻ thống kê ghi 28 — hai
// con số cho cùng một thứ. Người đọc không biết tin cái nào.
check('phu de header va the thong ke phai dem khoang lang giong nhau', () => {
  const gapsThat = data.gaps.filter((gap) => gap.cause !== 'background').length;
  const nen = data.gaps.length - gapsThat;
  ok(nen >= 1, 'fixture phai co it nhat mot khoang do xuong nen');
  const html = L.renderSummaryTab();
  const the = /<b[^>]*>(\d+)<\/b><span>khoảng lặng/.exec(html);
  ok(the, 'phai tim duoc the thong ke khoang lang');
  eq(Number(the[1]), gapsThat, 'the thong ke phai la so da tru phan xuong nen');
});

/* ------------------------------------------- tên bề mặt từ momoClassDiscriminator */

// Bug thật: hai màn đều ghi screen_name=result nhưng là hai lớp khác hẳn nhau, nên bị gom làm một hàng.
check('ten man: tach duoc hai be mat cung screen_name', () => {
  const keys = journey.screens.map((row) => row.key);
  ok(keys.indexOf('result · KetQuaRevamp') >= 0, 'phai co be mat thu nhat; hien co: ' + keys.join(', '));
  ok(keys.indexOf('result · KetQuaWidget') >= 0, 'phai co be mat thu hai');
  eq(keys.filter((key) => key === 'result').length, 0, 'khong duoc con hang "result" tron gom ca hai');
});

// Cái bẫy: một log thật có 64 dòng mang discriminator mà TẤT CẢ đều là "PromotionEventParams" — lớp
// chứa tham số, không phải tên màn. Lấy bừa thì mọi màn đều bị đặt tên đó.
check('ten man: bo qua lop chua tham so', () => {
  const keys = journey.screens.map((row) => row.key);
  ok(keys.indexOf('ManHinhThuong') >= 0, 'man do phai giu nguyen ten');
  ok(!keys.some((key) => key.indexOf('EventParams') >= 0), 'khong duoc lay ten lop tham so lam ten man');
});

check('ten man: chi nhan lop mo ta mot be mat vua hien ra', () => {
  const goi = (tail) => L.journeySurfaceName({ momoClassDiscriminator: 'a.b.' + tail });
  eq(goi('TransactionResultRevampScreenDisplayed'), 'TransactionResultRevamp', 'bo ca ScreenDisplayed');
  eq(goi('TransactionResultWidgetDisplayed'), 'TransactionResultWidget', 'bo Displayed');
  eq(goi('PaymentScreenInteracted'), 'Payment', 'bo ScreenInteracted');
  eq(goi('SofCarouselViewed'), 'SofCarousel', 'bo Viewed');
  eq(goi('PromotionEventParams'), '', 'lop tham so thi bo');
  eq(goi('CheckoutRequested'), '', 'lop request/response cung khong phai be mat');
  eq(L.journeySurfaceName({}), '', 'khong co truong thi tra ve rong');
  eq(L.journeySurfaceName({ momoClassDiscriminator: 'null' }), '', 'gia tri null thi cung rong');
});

/* ------------------------------- những chỗ agent review tìm ra, đã sửa */

// Thuộc tính hidden mặc định là display:none của trình duyệt, nhưng MỌI rule .fll-* có display đều đè
// lên nó. Trước đây chỉ khai riêng cho .fll-bar và .fll-ft, nên ô tìm trong từng mục đặt hidden=true
// mà hàng vẫn hiện nguyên (.fll-rk, .fll-call, .fll-slow, .fll-chip đều display:flex).
check('CSS: co rule [hidden] chung cho ca panel', () => {
  ok(L.PANEL_CSS.indexOf('#fll-root [hidden]{display:none!important}') >= 0,
    'thieu rule nay thi o tim tung muc khong an duoc hang nao');
});

// Mang bộ lọc của feedback trước sang feedback sau là một loại lỗi đã có luật trong CLAUDE.md.
check('doi feedback: don sach ca skipDuplicate lan tabUiState', () => {
  L.lensState.filter.skipDuplicate = true;
  L.tabUiState.issueQuery = 'timeout';
  L.tabUiState.httpOnlyBad = true;
  L.tabUiState.tlKinds = new Set(['jr-tap']);
  L.lensState.isShowingMuted = true;
  L.detachLens();
  eq(L.lensState.filter.skipDuplicate, false, 'bo loc bo-khoi-lap phai duoc don');
  eq(L.tabUiState.issueQuery, '', 'o tim nhom loi phai duoc don');
  eq(L.tabUiState.httpOnlyBad, false, 'chip HTTP phai ve mac dinh');
  eq(L.tabUiState.tlKinds.size, 0, 'chip loai moc phai duoc don');
  eq(L.lensState.isShowingMuted, false, 'che do xem nhom da tat tieng phai ve mac dinh');
  scan();
});

// Thiếu chỗ này thì mẫu bộ lọc lưu xong mô tả là "không có điều kiện nào" và bấm vào không làm gì.
check('mau bo loc va permalink mang duoc "bo khoi lap"', () => {
  L.lensState.filter.skipDuplicate = true;
  const payload = L.serializeFilter();
  eq(payload.d, 1, 'phai co trong payload');
  ok(L.describeTemplatePayload(payload).indexOf('bỏ khối lặp') >= 0, 'mo ta mau phai nhac toi');
  L.lensState.filter.skipDuplicate = false;
  L.applyFilterPayload(payload);
  eq(L.lensState.filter.skipDuplicate, true, 'ap lai payload phai bat lai');
  // Áp một mẫu KHÔNG có điều kiện này thì phải TẮT nó, không được giữ.
  L.applyFilterPayload({ lv: ['ERROR'] });
  eq(L.lensState.filter.skipDuplicate, false, 'ap mau khac phai tat, khong duoc giu lai');
  L.lensState.filter.levels = new Set();
});

// Chip phiên bấm vào là LỌC, nhưng rê chuột vẫn phải chỉ ra được chỗ phiên đó bắt đầu trên minimap —
// giống hệt rê lên một hàng trong danh sách. Đó là việc của data-aim, và nó cố ý không nằm trong danh
// sách mà handleLensClick đọc (thêm vào đó là cú bấm biến thành lệnh nhảy dòng, mất luôn bộ lọc).
check('chip phien tro duoc len minimap ma van giu duoc cu bam la loc', () => {
  const html = L.renderSessionChipRow();
  const session = L.lensState.data.sessions[1];
  ok(html.indexOf('data-aim="' + session.firstIndex + '"') >= 0, 'chip phai mang data-aim = dong dau phien');
  ok(html.indexOf('data-act="setSession" data-value="' + session.index + '"') >= 0,
    'va van giu data-act de bam vao thi loc');
  eq(L.aimIndicesFor({ dataset: { aim: String(session.firstIndex) } })[0], session.firstIndex,
    'mui ten doc duoc data-aim');
  // data-aim phải được đọc TRƯỚC mọi thứ khác: chip vừa có data-aim vừa có data-value.
  eq(L.aimIndicesFor({ dataset: { aim: '7', jump: '99' } })[0], 7, 'data-aim di truoc data-jump');
});

// Bug thật: phóng minimap vào phiên 1 rồi bấm sang phiên 2 thì khoảng đang chọn nằm NGOÀI vùng đang
// phóng — minimap vẫn vẽ vùng cũ nên phần tô biến mất sạch, người dùng thấy "chọn phiên 2 mà không có
// gì được chọn" và không có dấu hiệu nào nói rằng phải lùi phóng to ra mới thấy.
check('doi phien khi dang phong to: vung phong lui ra cho toi khi con thay khoang chon', () => {
  L.lensState.filter.session = 1;
  const phien1 = L.getVisibleTimeRange();
  L.lensState.mapZoomStack = [null];
  L.lensState.mapZoom = { from: phien1.from, to: phien1.to }; // như vừa bấm "phóng to"
  L.lensState.filter.session = 2;
  L.updateMinimapRange();
  eq(L.lensState.mapZoom, null, 'phai lui ra, khong duoc de khoang chon nam ngoai khung');

  // Ngược lại: bỏ hết bộ lọc (khoảng = cả log) thì vùng phóng PHẢI được giữ. Phóng to là cái nhìn,
  // bộ lọc là tập dòng — để bộ lọc bung được phóng to là trộn lại hai thứ vốn cố ý tách ra.
  const phien2 = L.getVisibleTimeRange();
  L.lensState.mapZoom = { from: phien2.from, to: phien2.to };
  L.lensState.mapZoomStack = [null];
  L.lensState.filter.session = null;
  L.updateMinimapRange();
  ok(L.lensState.mapZoom !== null, 'bo loc thi khong duoc tu bung phong to');
  L.lensState.mapZoom = null;
  L.lensState.mapZoomStack = [];
  L.applyFilter(false);
});

// Bug thật: lọc theo PHIÊN APP thu khoảng đang xem về đúng phiên đó (getVisibleTimeRange cắt theo
// start/endTs của phiên) nên minimap vẫn tô mờ hai bên — nhưng nút "phóng to" lại hỏi riêng
// timeFrom/timeTo nên không bao giờ hiện. Muốn phóng vào một phiên phải tự kéo tay lại đúng khoảng
// mà chính tool đã tô sẵn. Hai câu hỏi đó phải cho cùng một câu trả lời.
check('loc theo phien app cung duoc coi la "dang co khoang chon" tren minimap', () => {
  L.lensState.filter.session = 2;
  ok(!L.hasAnyTimeRange(), 'loc theo phien khong dat timeFrom/timeTo');
  ok(L.hasSelectedTimeRange(), 'nhung van la mot khoang dang chon');
  const range = L.getVisibleTimeRange();
  ok(range.from > L.lensState.data.firstTs || range.to < L.lensState.data.lastTs,
    'khoang do phai hep hon ca log');
  ok(L.canZoomFurther(range, L.minimapBounds()), 'va phai con cho de phong to vao');
  L.lensState.filter.session = null;
  ok(!L.hasSelectedTimeRange(), 'bo loc phien thi khong con khoang nao dang chon');
});

/* --------------------------------------------- permalink: link phải mang đúng thứ đang thấy */

// Mở link giống hệt lúc trang vừa tải: bộ lọc về mặc định rồi mới đọc hash.
function openPermalink(link) {
  const filter = L.lensState.filter;
  filter.levels = new Set();
  filter.modules = new Set();
  filter.text = '';
  filter.session = null;
  filter.skipDuplicate = false;
  filter.timeFrom = null;
  filter.timeTo = null;
  filter.windowPreset = null;
  filter.hideOthers = true;
  L.lensState.matches = [];
  L.lensState.matchPos = -1;
  L.lensState.mapZoom = null;
  L.resetTabUiState();
  global.location.hash = link.slice(link.indexOf(L.PERMALINK_PREFIX));
  const applied = L.applyPermalinkFromHash();
  global.location.hash = '';
  return applied;
}

// Bug thật đo được: chip "Ẩn dòng không khớp" tắt được (data-act="tglHide") nhưng serializeFilter không
// ghi nó, còn applyFilterPayload thì gán cứng true. Người gửi thấy CẢ log với panel tính theo ERROR,
// người nhận mở đúng link đó thấy bảng log bị xén còn mấy chục dòng.
check('permalink mang duoc chip "An dong khong khop" dang tat', () => {
  L.lensState.filter.levels = new Set(['ERROR']);
  L.lensState.filter.hideOthers = false;
  L.applyFilter(false);
  const link = L.buildPermalink();
  eq(L.lensState.isFiltering, false, 'tat chip thi khong duoc an dong nao');
  openPermalink(link);
  eq(L.lensState.filter.hideOthers, false, 'phia nhan phai giu nguyen trang thai chip');
  eq(L.lensState.isFiltering, false, 'bang log phia nhan cung khong duoc bi xen');
  ok(L.lensState.filter.levels.has('ERROR'), 'dieu kien loc van phai con');
  L.lensState.filter.levels = new Set();
  L.lensState.filter.hideOthers = true;
  L.applyFilter(false);
});

// Bug thật: applyPermalinkFromHash đặt matches thành ĐÚNG MỘT dòng, nên thanh dưới ghi "1/1" và phím
// n/p chết — trong khi người gửi đang duyệt cả tập dòng khớp.
check('mo permalink van duyet duoc ca tap dong khop, dung o dong duoc tro', () => {
  L.lensState.filter.levels = new Set(['ERROR']);
  L.lensState.filter.hideOthers = true;
  const result = L.applyFilter(true);
  ok(result.visible.length >= 3, 'fixture phai co du dong ERROR de duyet');
  L.setMatches(result.visible, 'dòng khớp bộ lọc', 2); // người gửi đã bấm n hai lần
  const soKhop = L.lensState.matches.length;
  const dongDangDung = L.lensState.data.entries[L.lensState.matches[2]].lineNo;
  const link = L.buildPermalink();
  openPermalink(link);
  eq(L.lensState.matches.length, soKhop, 'phai giu nguyen ca danh sach khop, khong co ve 1');
  eq(L.lensState.matchPos, 2, 'phai dung dung o dong ma link tro toi');
  eq(L.lensState.data.entries[L.lensState.matches[L.lensState.matchPos]].lineNo, dongDangDung,
    'dong dang duyet phai la dong cua nguoi gui');
  L.lensState.filter.levels = new Set();
  L.applyFilter(false);
});

// Bug thật: nhánh Math.abs(to - lastTs) < 1000 đoán khoảng KÉO TAY thành preset "N cuối". Hậu quả không
// chỉ là nhãn khác nhau — windowPreset khác null thì retargetTimeWindow() tự tính lại cửa sổ khi sang
// log khác, tức người nhận được một hành vi mà người gửi không hề chọn.
check('khoang keo tay ket thuc gan cuoi log khong bi doan thanh preset', () => {
  const filter = L.lensState.filter;
  filter.windowPreset = null;
  filter.timeFrom = data.lastTs - 40000;
  filter.timeTo = data.lastTs - 500; // kéo tay, hụt 500ms so với cuối log
  L.applyFilter(false);
  const nhanNguoiGui = L.formatWindowLabel();
  const link = L.buildPermalink();
  openPermalink(link);
  eq(L.lensState.filter.windowPreset, null, 'keo tay thi khong duoc thanh preset');
  eq(L.lensState.filter.timeTo, data.lastTs - 500, 'moc cuoi phai giu nguyen, khong keo ve lastTs');
  eq(L.formatWindowLabel(), nhanNguoiGui, 'nhan hai ben phai giong nhau');
  filter.timeFrom = null;
  filter.timeTo = null;
  L.applyFilter(false);
});

// Link ghi "tab Vấn đề" nhưng không ghi ĐANG XEM LÁT NÀO của tab đó: người gửi lọc còn 3 nhóm, người
// nhận mở ra thấy cả danh sách. Cùng loại với việc để sót ô tìm khi đổi feedback, chỉ ngược chiều.
check('permalink mang trang thai trong tab, nguong khoang lang va vung phong to minimap', () => {
  L.tabUiState.issueQuery = 'timeout';
  L.tabUiState.issueLevel = 'ERROR';
  L.tabUiState.httpOnlyBad = true;
  L.tabUiState.tlKinds = new Set(['jr-tap']);
  L.lensState.gapThresholdMs = 5000;
  L.lensState.mapZoom = { from: data.firstTs + 1000, to: data.firstTs + 9000 };
  const link = L.buildPermalink();
  openPermalink(link);
  eq(L.tabUiState.issueQuery, 'timeout', 'o tim nhom loi phai sang duoc phia nhan');
  eq(L.tabUiState.issueLevel, 'ERROR', 'chip muc do trong tab phai sang duoc');
  eq(L.tabUiState.httpOnlyBad, true, 'chip chi-call-hong phai sang duoc');
  eq(Array.from(L.tabUiState.tlKinds).join(','), 'jr-tap', 'chip loai moc phai sang duoc');
  eq(L.lensState.gapThresholdMs, 5000, 'nguong khoang lang phai sang duoc');
  ok(L.lensState.mapZoom && L.lensState.mapZoom.from === data.firstTs + 1000,
    'vung phong to minimap phai sang duoc');
  // Link KHÔNG mang gì thì phía nhận phải về mặc định, không giữ lại của link trước.
  L.resetTabUiState();
  L.lensState.mapZoom = null;
  L.lensState.gapThresholdMs = 2000;
  const linkTrong = L.buildPermalink();
  L.tabUiState.issueQuery = 'con sot lai';
  L.lensState.mapZoom = { from: data.firstTs, to: data.firstTs + 1000 };
  openPermalink(linkTrong);
  eq(L.tabUiState.issueQuery, '', 'link sau khong mang thi phai don sach');
  eq(L.lensState.mapZoom, null, 'link sau khong mang thi khong duoc giu vung phong to');
  scan();
});

// Bug thật: setTimeWindowPreset kẹp timeFrom về firstTs, còn isWindowPresetActive lại suy ngược
// preset từ hiệu (timeTo - timeFrom). Trên log NGẮN HƠN preset thì hiệu đó nhỏ hơn preset => chip
// không sáng và nhãn đổi thành hai mốc giờ tuyệt đối. Ba log thật dài 291s / 572s / 234s nên preset
// "5 phút cuối" hỏng ở cả ba.
check('chip preset van sang tren log ngan hon chinh preset do', () => {
  const nam = 300000;
  // Log giả dài 90 giây — ngắn hơn preset 5 phút. Fixture thật dài hơn một tiếng (có hai phiên app)
  // nên phải dùng log giả ở đây.
  const logNgan = { firstTs: data.firstTs, lastTs: data.firstTs + 90000 };
  const that = L.lensState.data;
  L.lensState.data = logNgan;
  L.setTimeWindowPreset(nam);
  ok(L.isWindowPresetActive(nam), 'chip "5 phut cuoi" phai sang');
  eq(L.formatWindowLabel(), '5 phút cuối', 'nhan phai la ten preset, khong phai hai moc gio');
  eq(L.lensState.filter.timeFrom, logNgan.firstTs, 'van kep ve dau log de khong loc mat gi');
  L.setTimeWindowPreset(0);
  ok(!L.isWindowPresetActive(nam), 'bo preset thi chip phai tat');
  L.lensState.data = that;
});

// Bug thật: trang admin là SPA, bấm sang feedback khác thì log đổi nội dung nhưng timeFrom/timeTo
// (mốc TUYỆT ĐỐI) vẫn còn. Đo được: ở log 1 bật "2 phút cuối" rồi sang log 2 -> 0/7107 dòng lọt, chip
// ghi một khoảng giờ không hề tồn tại trong log 2.
check('doi feedback: preset tinh lai, khoang keo tay khong con giao thi bo', () => {
  const logKhac = { firstTs: data.lastTs + 3600000, lastTs: data.lastTs + 3900000 };
  L.setTimeWindowPreset(60000);
  L.retargetTimeWindow(logKhac);
  eq(L.lensState.filter.timeTo, logKhac.lastTs, 'preset phai bam theo lastTs cua log moi');
  eq(L.lensState.filter.timeFrom, logKhac.lastTs - 60000, 'va lui dung mot phut tu do');

  L.setTimeWindowPreset(0);
  L.lensState.filter.timeFrom = data.firstTs;
  L.lensState.filter.timeTo = data.firstTs + 1000;
  L.retargetTimeWindow(logKhac);
  eq(L.lensState.filter.timeFrom, null, 'khoang keo tay khong giao voi log moi thi phai bo han');
  eq(L.lensState.filter.timeTo, null, 'ca hai dau');

  // Còn log dài thêm (vẫn là log cũ) thì khoảng cũ vẫn giao — không được bỏ oan.
  L.lensState.filter.timeFrom = data.firstTs;
  L.lensState.filter.timeTo = data.firstTs + 1000;
  L.retargetTimeWindow({ firstTs: data.firstTs, lastTs: data.lastTs + 60000 });
  eq(L.lensState.filter.timeFrom, data.firstTs, 'log dai them thi giu nguyen khoang dang chon');
  L.setTimeWindowPreset(0);
});

// Bug thật: cửa sổ thời gian loại thẳng mọi dòng không có giờ (dòng tiếp nối của stack trace, dòng
// trống, dòng "END OF BATCH") — đo trên ba log thật: 240 / 180 / 85 dòng. Bật cửa sổ quanh đúng lúc
// lỗi nổ ra thì chính phần dưới của stack trace đó bị giấu đi.
check('dong khong co gio thua huong gio cua dong tren no', () => {
  const khongGio = data.entries.filter((entry) => !entry.ts);
  ok(khongGio.length > 0, 'fixture phai co dong khong co gio');
  eq(khongGio.filter((entry) => !entry.windowTs).length, 0,
    'moi dong khong co gio phai thua huong duoc gio cua dong tren no');
  L.lensState.filter.timeFrom = data.firstTs;
  L.lensState.filter.timeTo = data.lastTs;
  const compiled = L.compileFilter();
  eq(data.entries.filter((entry) => !L.entryMatches(entry, compiled)).length, 0,
    'cua so phu ca log thi khong duoc rot dong nao');
  L.lensState.filter.timeFrom = null;
  L.lensState.filter.timeTo = null;
});

// Bug thật: extractDurations cắt còn 80 hàng TRƯỚC khi trả về, nên badge của mục ghi "80" trong khi
// log có 160 con số — mà chữ ngay dưới lại ghi "MỌI con số thời lượng". Cắt bớt phải làm sau khi vẽ
// (capSectionRows), lúc đó tổng thật vẫn còn để ghi badge.
check('bang thoi luong khong bi cat truoc khi tra ve', () => {
  const raw = data.entries.filter((entry) => /duration=\d|in \d+ ?ms|totalWaited/.test(entry.message || ''));
  ok(data.durations.length > 0, 'phai rut duoc con so thoi luong nao do');
  ok(data.durations.length <= raw.length, 'khong the nhieu hon so dong nguon');
  const html = L.renderSlowSections();
  ok(html.indexOf('data-sec="Mọi con số thời lượng"') >= 0, 'phai co muc do');
  const badge = /data-sec="Mọi con số thời lượng"[^>]*>[^<]*<i class="fll-secbdg[^"]*">([^<]*)</.exec(html);
  ok(badge, 'muc phai co badge');
  eq(badge[1], String(data.durations.length), 'badge phai la TONG that, khong phai so hang duoc ve');
});

// Bug thật: renderConfigTab đọc getView() nên lọc còn ERROR xong tab in "Log này không có dòng cấu
// hình nào đọc được" trong khi cả log có 34 khoá. Câu "log này không có X" là khẳng định về CẢ LOG.
check('dang loc thi khong duoc khang dinh "log nay khong co"', () => {
  ok(data.configs.hasAny, 'fixture phai co dong cau hinh');
  const rong = Object.assign({}, data, { configs: { hasAny: false, total: 0, changedCount: 0,
    lineCount: 0, bySource: {}, calls: [] } });
  L.lensState.view = rong;
  const html = L.renderConfigTab();
  ok(html.indexOf('Log này không có') < 0, 'khong duoc noi ca log khong co');
  ok(html.indexOf('Bộ lọc hiện tại') >= 0, 'phai noi la do bo loc');
  ok(html.indexOf(String(data.configs.total)) >= 0, 'va phai noi ca log co bao nhieu');
  ok(html.indexOf('data-act="clearFilters"') >= 0, 'kem nut bo loc');
  L.lensState.view = data;
  // Còn log THẬT SỰ không có thì câu cũ vẫn phải giữ.
  const thatData = L.lensState.data;
  L.lensState.data = rong;
  L.lensState.view = rong;
  ok(L.renderConfigTab().indexOf('Log này không có') >= 0, 'log rong that thi van noi nhu cu');
  L.lensState.data = thatData;
  L.lensState.view = thatData;
});

// Mục "Gom theo ID" từng liệt kê MỌI ID của cả log kể cả khi đang bật cửa sổ thời gian, trong khi mọi
// mục xung quanh đều theo bộ lọc — và không có dòng chữ nào nói ra. Nay danh sách theo bộ lọc, còn
// CHUỖI của một ID thì vẫn nguyên vẹn (đó mới là thứ không được cắt).
check('Gom theo ID: danh sách theo bộ lọc, chuỗi thì vẫn trọn vẹn', () => {
  ok(data.correlations.length > 0, 'fixture phải có ID gom được');
  L.lensState.view = data;
  const dayDu = L.renderCorrelationList();
  ok(dayDu.indexOf('Đang lọc nên chỉ liệt kê') < 0, 'không lọc thì không được nói là đang lọc');

  // View chỉ còn đúng những dòng của ID đầu tiên -> các ID khác phải rụng khỏi danh sách.
  const giu = new Set(data.correlations[0].indices);
  const hep = Object.assign({}, data, {
    scopedEntries: data.entries.filter((entry) => giu.has(entry.domIndex)),
  });
  L.lensState.view = hep;
  const loc = L.renderCorrelationList();
  ok(loc.indexOf('Đang lọc nên chỉ liệt kê') >= 0, 'phải nói rõ là danh sách đang bị lọc');
  ok(loc.indexOf('trọn') >= 0, 'và nói rõ chuỗi vẫn mở trọn vẹn');
  const soHang = (loc.match(/data-act="correlate"/g) || []).length;
  ok(soHang < data.correlations.length, 'số hàng phải ít hơn khi lọc hẹp, nhận được ' + soHang);
  ok(soHang >= 1, 'ID có dòng trong tập đang xem thì phải còn lại');
  // Chuỗi vẫn phải đầy đủ: buildCorrelations đọc data.entries chứ không đọc view.
  eq(data.correlations[0].indices.length,
    giu.size, 'chuỗi của ID đó không được ngắn đi vì bộ lọc');
  L.lensState.view = data;
});

// available = có dòng Grafana nào không. hasGated = có dòng nào đi qua cờ debug không. Trước đây
// hasGated tính ra rồi không renderer nào đọc, nên tool trấn an "không luồng nào báo lỗi" ngay trên
// log mà đường ghi trace chưa bao giờ chạy.
check('Grafana: co dong nhung khong co startTrace thi phai noi "khong ket luan duoc"', () => {
  const gia = { traceIssues: { available: true, hasGated: false, lineCount: 22, fails: [] } };
  const html = L.renderTraceFailSection(gia);
  ok(html.indexOf('Không kết luận được') >= 0, 'phai noi ro la khong ket luan duoc');
  ok(html.indexOf('không luồng nào báo lỗi') < 0, 'khong duoc tran an');
  const coGate = { traceIssues: { available: true, hasGated: true, lineCount: 3207, fails: [] } };
  ok(L.renderTraceFailSection(coGate).indexOf('không luồng nào báo lỗi') >= 0,
    'co gate that su ma khong fail thi moi duoc noi cau do');
});

// Bước gộp bị đánh rơi trường session, nên guard "không đo vắt qua hai phiên app" luôn so
// undefined === undefined, tức luôn đúng, tức chưa bao giờ chạy.
check('hanh trinh: buoc gop van mang session', () => {
  const thieu = journey.steps.filter((step) => step.session === undefined);
  eq(thieu.length, 0, thieu.length + ' buoc mat session sau khi gop');
});

renderAll('log day du');

L.TIMELINE_KIND_ORDER.forEach((kind) => {
  check('tab Dien bien — chip ' + kind, () => {
    L.tabUiState.tlKinds = new Set([kind]);
    const html = L.renderTimelineTab();
    eq((html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length, 'the <div> can bang');
  });
});
L.tabUiState.tlKinds = new Set();

check('badge cua moi tab tinh duoc, khong ngã', () => {
  L.TAB_DEFS.forEach((tab) => {
    if (tab.badge) tab.badge(data);
  });
});

// log không có dòng Grafana nào — phải BÁO là không có, không được để trống
rows = fixture.build().filter((text) => text.indexOf('[Module: Grafana]') < 0).map(makeRow);
scan();
check('log khong co Grafana: bao ro la khong co', () => {
  const trace = L.lensState.data.traceIssues;
  eq(trace.available, false, 'available');
  eq(trace.lineCount, 0, 'lineCount');
  eq(trace.fails.length, 0, 'so hang loi');
  const html = L.renderIssuesTab();
  ok(html.indexOf('không có dòng Grafana trace nào') >= 0,
    'tab Van de phai noi thang la log nay khong co');
});
renderAll('log khong co Grafana');

// log không có dòng tracker nào
rows = fixture.build().filter((text) => text.indexOf('MoMoTracker') < 0).map(makeRow);
scan();
renderAll('log khong co tracker');
check('log khong tracker: journey rong nhung khong ngã', () => {
  eq(L.lensState.data.journey.steps.length, 0, 'so buoc');
  eq(L.lensState.data.journey.apiTotal, 0, 'apiTotal');
});

// Log bị cắt đầu: hai dòng của một lần chạy trước rồi mới tới mốc khởi động đầu tiên. Trước đây chúng
// bị gộp thẳng vào phiên 1, tức nói rằng chúng xảy ra SAU lần khởi động đó.
rows = ['2026-01-02 09:59:58:010 GMT+07:00 INFO    [Module: ViDemo] dang o giua mot phien truoc do',
  '2026-01-02 09:59:59:010 GMT+07:00 ERROR   [Module: ViDemo] loi cua phien truoc do']
  .concat(fixture.build()).map(makeRow);
scan();
renderAll('log bi cat dau');
check('dong truoc moc khoi dong dau tien khong duoc gop vao phien 1', () => {
  const d = L.lensState.data;
  eq(d.hasOrphanTail, true, 'phai nhan ra doan cut dau');
  eq(d.entries[0].session, -1, 'dong dau thuoc doan cut dau');
  eq(d.entries[1].session, -1, 'ca dong thu hai nua');
  eq(d.entries[2].session, 1, 'tu moc khoi dong tro di moi la phien 1');
  eq(d.sessions[0].index, -1, 'doan cut dau dung dau danh sach phien');
  eq(d.sessions[0].isOrphanTail, true, 'va tu khai la khong thay diem bat dau');
  eq(d.sessions[0].lineCount, 2, 'dung hai dong vua them');
  eq(d.sessionCount, 3, '2 lan khoi dong thay duoc + 1 doan cut dau');
  eq(L.sessionLabel(-1), 'Đuôi phiên trước', 'ten hien ra khong duoc la "Phien -1"');
});

// Chỉ số âm chứ không phải 0: filter.session được kiểm theo kiểu truthy ở nhiều chỗ nên phiên 0 sẽ bị
// đọc thành "khong loc phien nao".
check('loc duoc rieng doan cut dau', () => {
  L.lensState.filter.session = -1;
  const result = L.applyFilter(false);
  eq(result.visible.length, 2, 'chi con hai dong cua doan do');
  ok(L.renderFilterTab().indexOf('Đuôi phiên trước') >= 0, 'chip phai goi thang ten');
  ok(L.hasSelectedTimeRange(), 'minimap phai coi day la mot khoang dang chon');
  L.lensState.filter.session = null;
  L.applyFilter(false);
});

// Ticket đi thẳng ra ngoài repo: chỗ này đúng là thứ "log không trả lời được".
check('ticket noi ro khong thay diem bat dau cua phien dau', () => {
  const out = L.buildTicketSummary(L.lensState.data);
  ok(out.indexOf('trước lần khởi động đầu tiên') >= 0, 'phai co trong muc khong tra loi duoc');
});

// Máy & môi trường đọc từ header HTTP. Ba dòng dưới đây bịa hoàn toàn nhưng tái tạo đúng những đặc
// tính đã gặp trên log thật: header là map KHÔNG parse được bằng JSON.parse (giá trị bị làm mờ để lại
// chuỗi trần không khoá), User-Agent kiểu Android, IP đổi giữa chừng, và hai miniapp khác nhau.
const dongHeader = (ip, appId, version, them) =>
  '2026-01-02 10:00:0' + version.slice(-1) + ':100 GMT+07:00 INFO    [Module: HTTP] [Method: GET] ' +
  '[URL: https://api.demo/vi/x] [RequestPayload: --encrypted: false --body: null --header: ' +
  '{"deviceid":"66654e3ac9b5a4509fa697f401d3bc6d3fc01f2be49e1b524c26a9ed0024e84b",' +
  '"device-name":"Oppo CPH2083","device-ip":"' + ip + '","authorization":"BI-MAT-KHONG-DUOC-LO",' +
  '"map_appId":"' + appId + '","map_miniAppVersion":"' + version + '","device_os":"ANDROID",' +
  '"device_performance":"low-end","app_version":"51500","app_code":"5.15.0","channel":"APP","lang":"vi",' +
  '"User-Agent":"momotransfer/5.15.0.51500 Dalvik/2.1.0 (Linux; U; Android 9; CPH2083 Build/PPR1.180610.011)",' +
  '"agent_id":"73217397","****","****","sessionKey":"KHOA-PHIEN-KHONG-DUOC-LO",' +
  '"M-Signature":"CHU-KY-KHONG-DUOC-LO","M-Timezone":"Asia/Ho_Chi_Minh","env":"production"' +
  (them || '') + '}]--exception: none';

rows = [
  '2026-01-02 10:00:00:010 GMT+07:00 INFO    [Module: GiaLapDb] MomoDatabase init OK',
  dongHeader('42.118.185.199', 'vn.momo.cvs_fund', '694'),
  dongHeader('42.118.185.199', 'vn.momo.cvs_fund', '695'),
  dongHeader('10.20.30.40', 'vn.momo.financial_hub', '1901'),
].map(makeRow);
scan();
renderAll('log co header HTTP');

check('may & moi truong doc duoc het cac truong trong header', () => {
  const env = L.lensState.data.environment;
  eq(env.headerLineCount, 3, 'ba dong co header');
  eq(env.device, 'Oppo CPH2083', 'ten may lay tu device-name');
  // Bản cũ chỉ khớp User-Agent kiểu iOS nên log Android bỏ trống cả tên máy lẫn phiên bản app.
  eq(env.osLabel, 'Android 9', 'he dieu hanh doc tu User-Agent kieu Android');
  eq(env.appVersion, '5.15.0', 'app_code');
  eq(env.appBuild, '51500', 'app_version');
  eq(env.timezone, 'Asia/Ho_Chi_Minh', 'mui gio');
  eq(env.envName, 'production', 'moi truong');
  eq(env.channel, 'APP', 'kenh');
  eq(env.performance, 'low-end', 'doi may');
});

// Nhiều giá trị cho cùng một khoá là thứ đáng thấy cả danh sách: IP đổi giữa chừng = đổi mạng.
check('nhieu IP thi giu ca danh sach, sap theo so lan', () => {
  const env = L.lensState.data.environment;
  eq(env.ips.length, 2, 'hai IP khac nhau');
  eq(env.ips[0].value, '42.118.185.199', 'IP gap nhieu lan nhat dung truoc');
  eq(env.ips[0].count, 2, 'dung so lan');
  eq(env.deviceIds.length, 1, 'chi mot deviceid');
  eq(env.agentIds.length, 1, 'chi mot agent_id');
  const html = L.renderSummaryTab();
  ok(html.indexOf('10.20.30.40') >= 0 && html.indexOf('42.118.185.199') >= 0,
    'ca hai IP phai hien ra, khong phai chi cai hay gap nhat');
});

// Cặp (miniapp, version) phải đọc trong CÙNG một dòng, gom hai danh sách rồi ghép là gán nhầm version.
check('version cua tung miniapp, khong gan nham cho nhau', () => {
  const apps = L.lensState.data.environment.miniApps;
  eq(apps.length, 2, 'hai miniapp');
  const fund = apps.find((app) => app.appId === 'vn.momo.cvs_fund');
  const hub = apps.find((app) => app.appId === 'vn.momo.financial_hub');
  eq(fund.versions.map((item) => item.value).sort().join(','), '694,695', 'cvs_fund chay hai version');
  eq(hub.versions.map((item) => item.value).join(','), '1901', 'financial_hub chi mot version');
  ok(L.renderSummaryTab().indexOf('vn.momo.financial_hub') >= 0, 'phai hien ra tren panel');
  ok(L.buildTicketSummary(L.lensState.data).indexOf('vn.momo.cvs_fund 694/695') >= 0,
    'ticket phai ghi version miniapp — thieu no thi khong tai hien duoc');
});

// Danh sách khoá là DANH SÁCH TRẮNG. Cùng map header đó có authorization, sessionKey, M-Signature —
// lọt một cái lên panel là lọt luôn vào ticket, mà ticket thì đi thẳng ra Jira.
check('token trong header khong duoc lot ra panel hay ticket', () => {
  const html = L.renderSummaryTab() + L.buildTicketSummary(L.lensState.data);
  ['BI-MAT-KHONG-DUOC-LO', 'KHOA-PHIEN-KHONG-DUOC-LO', 'CHU-KY-KHONG-DUOC-LO'].forEach((bimat) => {
    ok(html.indexOf(bimat) < 0, 'lo mat: ' + bimat);
  });
});

// Rê chuột trên bảng log của trang: panel mờ đi để đọc xuyên qua, minimap chỉ đúng vị trí dòng đó.
// Hai dòng cuối cố ý KHÔNG có timestamp — dòng tiếp nối của stack trace phải thừa hưởng giờ của dòng
// trên nó, nếu không thì rê vào giữa stack trace là vạch trên minimap tắt ngóm.
rows = [
  '2026-01-02 10:00:00:010 GMT+07:00 INFO    [Module: GiaLapDb] MomoDatabase init OK',
  '2026-01-02 10:00:05:010 GMT+07:00 ERROR   [Module: ViDemo] khong tai duoc so du',
  '    at vn.momo.demo.Vi.taiSoDu(Vi.kt:42)',
].map(makeRow);
scan();

const lopGia = () => {
  const co = new Set();
  return { add: (c) => co.add(c), remove: (c) => co.delete(c), contains: (c) => co.has(c),
    toggle: (c, bat) => (bat ? co.add(c) : co.delete(c)) };
};

check('re chuot tren bang log: panel mo di, minimap chi dung dong do', () => {
  const data = L.lensState.data;
  L.indexRowElements(data);
  eq(L.lensState.rowEntries.get(data.entries[1].el), data.entries[1], 'tra duoc phan tu -> entry');

  L.lensState.el.panel = { classList: lopGia() };
  L.lensState.el.cursor = { style: {} };
  L.lensState.el.mapText = { textContent: '', classList: lopGia() };
  const reVao = (index) => L.handlePageRowHover({ target: { closest: () => data.entries[index].el } });

  reVao(1);
  ok(L.lensState.el.panel.classList.contains('fll-xray'), 'panel phai mo di de doc xuyen qua');
  ok(L.lensState.el.mapText.textContent.indexOf('dòng ' + data.entries[1].lineNo) >= 0,
    'nhan minimap phai ghi so dong dang re: ' + L.lensState.el.mapText.textContent);
  ok(L.lensState.el.cursor.style.opacity !== '0', 'vach tren minimap phai hien');

  // Dòng tiếp nối không có giờ riêng: phải dùng giờ thừa hưởng, không được tắt vạch.
  reVao(2);
  eq(data.entries[2].ts, null, 'dong nay dung la khong co timestamp');
  ok(L.lensState.el.cursor.style.opacity !== '0', 'van phai hien vach nho windowTs');
  ok(L.lensState.el.mapText.textContent.indexOf('10:00:05') >= 0,
    'gio hien ra la gio thua huong tu dong tren: ' + L.lensState.el.mapText.textContent);

  L.handlePageLeave();
  ok(!L.lensState.el.panel.classList.contains('fll-xray'), 'roi bang log thi panel sang lai');
  eq(L.lensState.el.cursor.style.opacity, '0', 'va vach tat di');
  L.lensState.el = {};
});

// Accent (#ff2e88) cùng hệ hồng với cột ERROR của minimap (#ff5f6d): vạch vị trí tô accent thì đặt
// đúng vào chỗ có lỗi là chìm nghỉm — mà đó lại là chỗ hay phải nhìn nhất. Vạch của mũi tên đã đổi sang
// trắng từ trước, .fll-cursor hồi đó bị bỏ sót.
check('vach vi tri tren minimap khong duoc to accent', () => {
  const css = L.PANEL_CSS;
  const at = css.indexOf('.fll-cursor{');
  ok(at >= 0, 'phai co rule vach vi tri');
  const rule = css.slice(at, css.indexOf('}', at));
  ok(rule.indexOf('var(--acc)') < 0, 'khong duoc dung accent: trung he mau voi cot ERROR');
  ok(rule.indexOf('background:#fff') >= 0, 'phai la mau sang, giong vach cua mui ten');
});

// Cái bẫy của cách làm này: opacity gộp cả cây con thành MỘT lớp, con không bao giờ sáng hơn cha. Đặt
// opacity lên chính .fll-panel là minimap mờ theo — mà minimap đúng là thứ cần nhìn rõ lúc đó.
check('xuyen thau khong duoc dat opacity len chinh panel', () => {
  const css = L.PANEL_CSS;
  const at = css.indexOf('.fll-panel.fll-xray{');
  ok(at >= 0, 'phai co rule xuyen thau');
  const rule = css.slice(at, css.indexOf('}', at));
  ok(rule.indexOf('opacity') < 0, 'rule cua chinh panel khong duoc co opacity, phai dung nen co alpha');
  ok(rule.indexOf('background:rgba') >= 0, 'nen phai co alpha thi moi nhin xuyen qua duoc');
  ok(css.indexOf('.fll-panel.fll-xray > *:not(.fll-map):not(.fll-maplbl){opacity:') >= 0,
    'mo tung dua con va chua minimap cung nhan cua no ra');
});

// Mã lỗi nằm rải ở bốn kiểu viết khác nhau, không chỗ nào cộng lại. Bốn dòng dưới đây tái tạo đúng
// bốn kiểu đó, kèm một dòng error_code=0 (call THÀNH CÔNG) phải bị loại ra — để lẫn thì mã hay gặp
// nhất trong mọi log luôn là 0 và mục này thành vô dụng.
rows = [
  '2026-01-02 10:00:00:010 GMT+07:00 INFO    [Module: GiaLapDb] MomoDatabase init OK',
  '2026-01-02 10:00:01:010 GMT+07:00 INFO    [Module: HTTP] [Method: POST] [URL: https://api.demo/a] ' +
    '[ResponsePayload: --status: 500 --body: {"cmdId":"CMD-1","errorCode":-2001}]',
  '2026-01-02 10:00:02:010 GMT+07:00 INFO    [Module: MoMoTracker] event: ops_receive_be | params: ' +
    '{api=API_A, trace_id=TRACE-1, status=fail, error_code=-2001, duration=190.0}',
  '2026-01-02 10:00:03:010 GMT+07:00 INFO    [Module: Grafana] @@ grafana >> traceFail >> generateParams ' +
    '>> parameter: TraceParameter(flow=http_request_v2, errorCode=413, errorMessage=qua lon)',
  '2026-01-02 10:00:04:010 GMT+07:00 INFO    [Module: MoMoTracker] event: ops_receive_be | params: ' +
    '{api=API_B, trace_id=TRACE-2, status=success, error_code=0, duration=20.0}',
  // JSON in đẹp tách thành nhiều dòng — mã lỗi nằm trên một dòng KHÔNG có giờ, không có mức độ.
  '2026-01-02 10:00:05:010 GMT+07:00 INFO    [OFL_fetchingConfigURL] storage == {',
  '"errorCode": 413,',
  '"regionCode": "VN"',
  '}',
].map(makeRow);
scan();
renderAll('log co ma loi');

check('gom moi ma loi tu ca bon kieu viet, bo ma 0', () => {
  const codes = L.lensState.data.errorCodes;
  const thay = codes.map((item) => item.code + '×' + item.count).join(' ');
  eq(thay, '-2001×2 413×2', 'sap theo so lan, ma 0 bi loai: ' + thay);
  const ma413 = codes.find((item) => item.code === 413);
  eq(ma413.indices.length, 2, 'ca dong Grafana lan dong JSON tach roi deu duoc tinh');
  const html = L.renderErrorCodeSection(L.lensState.data);
  ok(html.indexOf('data-lines="' + ma413.indices.join(',') + '"') >= 0,
    'bam vao mot ma phai duyet duoc nhung dong co no');
  ok(html.indexOf('Mọi mã lỗi') >= 0, 'phai co tieu de muc');
});

// Ô tìm regex vốn đã là bộ trích xuất vạn năng, chỉ thiếu bước gom giá trị.
check('o tim regex co nhom bat thi gom duoc gia tri', () => {
  const filter = L.lensState.filter;
  filter.useRegex = true;
  filter.text = 'errorCode[":= ]+(-?\\d+)';
  const result = L.applyFilter(false);
  const tally = L.buildCaptureTally(result.visible);
  ok(tally, 'phai gom duoc');
  // 413 hai lần (Grafana + dòng JSON tách rời), -2001 một lần: mẫu này chỉ khớp `errorCode`, không
  // khớp `error_code=` của tracker — đúng như người dùng gõ.
  eq(tally.values.map((item) => item.value + '×' + item.count).join(' '), '413×2 -2001×1',
    'gom theo gia tri, sap theo so lan');
  ok(tally.values[0].indices.length >= 1, 'moi gia tri nho duoc dong chua no');
  // Mẫu KHÔNG có nhóm bắt thì không hiện mục này — người dùng chỉ đang tìm dòng.
  filter.text = 'errorCode';
  L.applyFilter(false);
  eq(L.buildCaptureTally(L.applyFilter(false).visible), null, 'khong co nhom bat thi thoi');
  filter.text = '';
  L.applyFilter(false);
});

check('dem nhom bat va chon nhom dau tien CO gia tri', () => {
  eq(L.regexCaptureCount('abc'), 0, 'khong co nhom');
  eq(L.regexCaptureCount('(a)(b)'), 2, 'hai nhom');
  eq(L.regexCaptureCount('(a'), 0, 'regex hong thi coi nhu khong co nhom, khong duoc nga');
  // Regex có nhánh: nhóm 1 rỗng khi nhánh sau khớp. Lấy cứng hit[1] là ra danh sách toàn undefined.
  const filter = L.lensState.filter;
  filter.useRegex = true;
  filter.text = 'status=(fail)|errorCode[":= ]+(-?\\d+)';
  const tally = L.buildCaptureTally(L.applyFilter(false).visible);
  ok(tally.values.some((item) => item.value === 'fail'), 'nhanh truoc');
  ok(tally.values.some((item) => item.value === '413'), 'nhanh sau — lay nhom dau tien CO gia tri');
  // Mẫu khớp chuỗi rỗng: không có guard thì lastIndex đứng yên và trang treo cứng.
  filter.text = '(\\d*)';
  const rong = L.buildCaptureTally(L.applyFilter(false).visible);
  ok(rong && rong.values.length > 0, 'mau khop chuoi rong van phai tra ve duoc, khong treo');
  filter.text = '';
  L.applyFilter(false);
});

// Trang admin in JSON nhiều dòng thì mỗi dòng vật lý là một logRow riêng: dòng mở khối có "{" mà không
// bao giờ đóng trong chính nó. Gặp thật trên log production (khối config dài từ dòng 2643 trở đi).
rows = [
  '2026-01-02 10:00:00:010 GMT+07:00 INFO    [Module: GiaLapDb] MomoDatabase init OK',
  '2026-01-02 10:00:01:010 GMT+07:00 INFO    [Module: HTTP] [Method: GET] [URL: https://api.demo/cfg] ' +
    '[ResponsePayload: --status: 200 --body: {',
  '"lstCountry": [',
  '{',
  '"countryName": "Việt Nam",',
  '"flagUrl": "https://static.demo/img_flag_vn.png",',
  '"regionCode": "VN"',
  '}',
  '],',
  '"dauHieuCuoiKhoi": "TRONG-KHOI"',
  '}]',
  '2026-01-02 10:00:02:010 GMT+07:00 INFO    [Module: ViDemo] DONG-SAU-KHOI',
].map(makeRow);
scan();
renderAll('log co JSON nhieu dong');

check('JSON in ra nhieu dong: noi lai duoc de xem, ma khong dung vao entry.raw', () => {
  const data = L.lensState.data;
  const moKhoi = data.entries[1];
  ok(moKhoi.raw.indexOf('dauHieuCuoiKhoi') < 0, 'entry.raw cua dong mo khoi VAN chi la dong do');

  const text = L.logicalPayloadText(moKhoi);
  ok(text.indexOf('TRONG-KHOI') >= 0, 'noi den het khoi JSON');
  // Dừng đúng chỗ: dòng có giờ riêng là một dòng log mới, không được nuốt vào khối.
  ok(text.indexOf('DONG-SAU-KHOI') < 0, 'khong duoc nuot dong log ke tiep vao khoi');

  const sections = L.buildPayloadSections(text);
  const json = sections.find((item) => item.kind === 'json');
  ok(json, 'phai ra duoc mot khoi JSON');
  ok(json.isParsed, 'va parse duoc, khong phai chuoi cut');
  ok(json.pretty.indexOf('TRONG-KHOI') >= 0, 'noi dung day du');

  // Dòng tự nó đã cân ngoặc thì không được nối gì thêm.
  const dongThuong = data.entries[data.entries.length - 1];
  eq(L.logicalPayloadText(dongThuong), dongThuong.raw, 'dong binh thuong giu nguyen');
});

// Thống kê không được đổi vì khối JSON: các dòng tiếp nối không có giờ, không có mức độ.
check('khoi JSON nhieu dong khong lam sai thong ke', () => {
  const data = L.lensState.data;
  eq(data.levels.INFO, 3, 'chi ba dong that su co muc do INFO');
  eq(data.entries.filter((entry) => !entry.level).length, 9, 'chin dong cua khoi khong mang muc do');
  // windowTs: dòng trong khối thừa hưởng giờ của dòng mở khối, để cửa sổ thời gian không xén mất khối.
  eq(data.entries[5].windowTs, data.entries[1].ts, 'dong giua khoi thua huong gio cua dong mo khoi');
  eq(data.entries[5].ts, null, 'nhung ts van phai la null');
});

// log rỗng
rows = [];
scan();
renderAll('log rong');

/* -------------------------------------------------------------------- kết quả */

const total = passed + failures.length;
if (failures.length) {
  console.error('\n' + failures.length + '/' + total + ' phep thu HONG:\n');
  failures.forEach((f) => console.error('  ✗ ' + f.name + '\n      ' + f.message));
  process.exit(1);
}
console.log(passed + '/' + total + ' phep thu OK');
