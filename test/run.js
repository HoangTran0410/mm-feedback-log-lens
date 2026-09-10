/*
File: test/run.js
Created At: 2026-09-10 10:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// AI-GENERATED START — chay dist/lens.js that trong node voi DOM gia, tren log fixture bia.
// Khong dependency, khong test runner: `node test/run.js`.
//
// Cac phep thu o day deu sinh ra tu bug THAT gap luc phat trien, khong phai bia ra cho du so:
//   - so call BE phong gan gap doi vi log ghi hai dong cho mot call
//   - so buoc fail lech voi so call fail dem duoc, vi buoc fail bi gop nham theo cua so thoi gian
//   - detail cua buoc dau bi gan cho ca nhom du cac buoc khac nhau boi canh

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
  global.window = { addEventListener: noop, removeEventListener: noop, innerHeight: 800, innerWidth: 1200,
    location: { hash: '' }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop } };
  global.localStorage = global.window.localStorage;
  global.alert = noop;
  global.setInterval = () => 0;
  global.clearInterval = noop;
  global.setTimeout = () => 0;
  global.navigator = { clipboard: null };
}

// Cac ham nam trong IIFE cua ban build nen khong voi toi tu ngoai duoc.
// Chen mot dong export vao TRUOC dau ')();' de lay chung ra — van la chinh ban dist se chay that,
// khong phai mot ban sao rieng cho test.
function loadLens() {
  const src = fs.readFileSync(path.join(REPO, 'dist/lens.js'), 'utf8');
  const exportLine = 'globalThis.__LENS={analyzeLog,attachInsights,deriveStats,buildJourney,' +
    'parseKeyValueMap,renderSummaryTab,renderIssuesTab,renderHttpTab,renderSlowTab,renderFilterTab,' +
    'renderTimelineTab,tabUiState,lensState,TAB_DEFS,TIMELINE_GROUPS};';
  const wired = src.replace(/\n\}\)\(\);\s*$/, '\n' + exportLine + '\n})();\n');
  if (wired === src) throw new Error('khong chen duoc dong export vao IIFE cua dist/lens.js');
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
  return false; // fixture khong tat tieng chu ky nao
}

function ok(condition, what) {
  if (!condition) throw new Error(what || 'dieu kien khong dung');
}

/* ------------------------------------------------------------------- chuan bi */

installFakeDom();
rows = fixture.build().map(makeRow);
const L = loadLens();

function scan() {
  const data = L.attachInsights(L.analyzeLog(2000));
  // scanLog() moi gan nhan nay; o day goi thang analyzeLog nen phai gan tay.
  data.gapThresholdLabel = L.lensState.gapThresholdMs / 1000 + 's';
  L.lensState.data = data;
  L.lensState.view = data;
  return data;
}

const data = scan();
const journey = data.journey;
const stepsOf = (kind) => journey.steps.filter((step) => step.kind === kind);

/* ----------------------------------------------------------------- phep thu */

check('moc phien nhan ca dang co duoi "in <N>ms" lan dang khong', () => {
  eq(data.sessionCount, 2, 'fixture co hai lan khoi dong');
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
  // fixture co 5 dong ops_receive_be nhung chi 4 trace_id khac nhau (TRACE-0001 bi ghi lap)
  eq(journey.apiTotal, 4, 'apiTotal');
  eq(journey.apiFail, 3, 'apiFail');
});

check('so buoc fail khop voi so call fail', () => {
  // day chinh la cho tung lech 25 vs 23 tren log that
  eq(journey.counts.fail, journey.apiFail, 'counts.fail phai bang apiFail');
  const tong = journey.fails.reduce((sum, row) => sum + row.count, 0);
  eq(tong, journey.apiFail, 'tong cua danh sach fail phai bang apiFail');
});

check('hai buoc fail sat nhau KHONG bi gop', () => {
  // TRACE-0002 va TRACE-0003 cach nhau 300ms, cung api va cung error_code:
  // moi trace_id la mot call that nen phai dem rieng
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
  const saw = journey.saw.find((row) => row.key === 'Popup Bia Canh Bao');
  ok(saw, 'phai bat duoc popup; hien co: ' + journey.saw.map((r) => r.key).join(', '));
  eq(saw.count, 1, 'so lan');
  // va no KHONG duoc lot vao nhom loi, vi no la INFO
  ok(data.groups.every((g) => g.sample.indexOf('Popup Bia Canh Bao') < 0),
    'popup INFO khong duoc gom vao nhom ERROR/WARNING');
});

check('nhom theo nhan bo detail khi cac buoc khac boi canh', () => {
  // nut_lap xuat hien o man_hai ca hai lan nen detail dong nhat -> duoc giu
  const row = journey.taps.find((r) => r.key === 'nut_lap');
  ok(row, 'phai co hang nut_lap');
  eq(row.count, 2, 'dem theo so thao tac, khong phai so dong log');
  eq(row.indices.length, 3, 'nhung van giu du ca 3 dong log');
});

check('tab HTTP van doc dong [Method:] nhu cu', () => {
  eq(data.httpCalls.length, 2, 'so call HTTP ghep tu dong [Method:]');
  eq(data.badHttpCalls.length, 1, 'call bat thuong (errorCode 404)');
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

/* --------------------------------------------- nhieu tu chinh lop do luong */

check('nhom nhieu do luong bi danh dau, nhom that thi khong', () => {
  const noise = data.groups.filter((g) => g.noiseLabel);
  // Hai dong "no traceId" khac ten buoc nen khac chu ky -> hai nhom; cong handleError la ba.
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

/* ------------------------------------------------------- render moi tab, moi trang thai */

function renderAll(label) {
  L.TAB_DEFS.forEach((tab) => {
    const render = { sum: L.renderSummaryTab, iss: L.renderIssuesTab, http: L.renderHttpTab,
      slow: L.renderSlowTab, flt: L.renderFilterTab, tl: L.renderTimelineTab }[tab.id];
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

renderAll('log day du');

L.TIMELINE_GROUPS.forEach((group) => {
  check('tab Dien bien — chip ' + group.label, () => {
    L.tabUiState.tlGroup = group.id;
    const html = L.renderTimelineTab();
    eq((html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length, 'the <div> can bang');
  });
});
L.tabUiState.tlGroup = 'all';

check('badge cua moi tab tinh duoc, khong ngã', () => {
  L.TAB_DEFS.forEach((tab) => {
    if (tab.badge) tab.badge(data);
  });
});

// log khong co dong Grafana nao — phai BAO la khong co, khong duoc de trong
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

// log khong co dong tracker nao
rows = fixture.build().filter((text) => text.indexOf('MoMoTracker') < 0).map(makeRow);
scan();
renderAll('log khong co tracker');
check('log khong tracker: journey rong nhung khong ngã', () => {
  eq(L.lensState.data.journey.steps.length, 0, 'so buoc');
  eq(L.lensState.data.journey.apiTotal, 0, 'apiTotal');
});

// log rong
rows = [];
scan();
renderAll('log rong');

/* -------------------------------------------------------------------- ket qua */

const total = passed + failures.length;
if (failures.length) {
  console.error('\n' + failures.length + '/' + total + ' phep thu HONG:\n');
  failures.forEach((f) => console.error('  ✗ ' + f.name + '\n      ' + f.message));
  process.exit(1);
}
console.log(passed + '/' + total + ' phep thu OK');
// AI-GENERATED END
