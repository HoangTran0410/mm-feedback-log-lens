/*
File: src/02d-trace.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// AI-GENERATED START — loi doc tu Grafana trace, va nhan dien nhieu cua chinh lop do luong
// Tach ra tu src/02-insights.js (946 dong). Cac file src/*.js duoc build.sh noi lai theo thu tu
// ten file va boc trong MOT IIFE nen van dung chung scope — tach chi de doc.

/* ------------------------------------------- nhieu tu chinh he thong do luong */

// Do tren 50 feedback PRODUCTION that (25 iOS, 25 Android, ngay 2026-09-10): 2488 dong ERROR, trong do
// 1267 dong (51%) khong phai loi user gap ma la loi cua chinh lop do luong. 24/49 log co qua nua so
// dong ERROR la loai nay. Chung deu ghi bang logger.e truc tiep nen KHONG bi cat boi co Debug Tool —
// tuc chung co mat tren may user that, khac han cac dong "@@ grafana >>" khac.
//
// Khong tu dong tat tieng: do la quyet dinh cua nguoi doc. Chi tach ra mot khoi rieng de danh sach
// van de con lai la nhung thu dang doc.
const TELEMETRY_NOISE_PATTERNS = [
  // withTraceId() lam buffer.remove() nen traceId chi dung duoc mot lan; goi stop lan hai la mat.
  { re: /GrafanaTrace\.\w+:: no traceId/, label: 'GrafanaTrace mất traceId' },
  // resolveFormatter() tra null khi Koin scope da dong.
  { re: /GrafanaTrace\.\w+ PaymentSession is null/, label: 'GrafanaTrace không có PaymentSession' },
  { re: /GrafanaTrace\.exceptionHandler/, label: 'GrafanaTrace nuốt exception' },
  // Hang doi gui trace cua chinh Grafana bi loi.
  { re: /grafana >> DefaultRequestQueue >> handleError/, label: 'Hàng đợi gửi trace Grafana lỗi' },
];

function telemetryNoiseLabel(text) {
  for (let i = 0; i < TELEMETRY_NOISE_PATTERNS.length; i += 1) {
    if (TELEMETRY_NOISE_PATTERNS[i].re.test(text)) return TELEMETRY_NOISE_PATTERNS[i].label;
  }
  return '';
}

/* -------------------------------------------------- loi doc tu Grafana trace */

// Grafana ghi o muc INFO nen khong dong nao lot vao buildIssueGroups, trong khi traceFail mang san
// flow + step + errorCode + errorMessage — tuc mo ta loi RO HON bat ky dong ERROR nao trong log.
//
// Gom theo errorMessage chu khong theo step: trong GrafanaTracker.generateParams, voi miniapp thi
// `flow` bi ghi de bang appId va `step` bi doi thanh "flow.step", nen MOT su co ha tang hien ra
// thanh hang chuc dong khac nhau. Do tren mot log that: cung mot loi "500 - B07 No version found
// from remote" xuat hien o 17 miniapp khac nhau. Gom theo errorMessage thi 17 dong do ve mot hang,
// kem so app bi anh huong — nhin la biet ngay ha tang chet chu khong phai bug cua tinh nang.
const TRACE_VERBS = ['startTrace', 'traceSuccess', 'traceFail', 'countTrace', 'durationStopTrace',
  'durationTrace', 'errorTrace'];

// Hau to _start/_success/_fail do generateParams tu gan, va tien to "<flow>." cung do no gan khi
// appId khong phai platform. Bo ca hai de con lai ten buoc that.
function traceStepRoot(step) {
  const text = journeyValue(step).replace(/_(start|success|fail|duration)$/i, '');
  const dot = text.lastIndexOf('.');
  return dot >= 0 ? text.slice(dot + 1) : text;
}

function buildTraceIssues(entries) {
  const counts = {};
  TRACE_VERBS.forEach((verb) => {
    counts[verb] = 0;
  });
  let lineCount = 0;
  const failMap = new Map();

  entries.forEach((entry) => {
    if (!entry.traceVerb) return;
    lineCount += 1;
    if (counts[entry.traceVerb] !== undefined) counts[entry.traceVerb] += 1;
    if (entry.traceVerb !== 'traceFail' || !entry.traceParams) return;

    const params = entry.traceParams;
    const message = journeyValue(params.errorMessage);
    const code = journeyValue(params.errorCode).replace(/\.0$/, '');
    const step = traceStepRoot(params.step);
    // Co errorMessage thi gom theo no — do moi la thu chung giua cac app cung dinh mot su co.
    // Khong co thi KHONG duoc gom theo moi errorCode: tren mot log that, "code 200" om chung
    // TransactionResultV3_call_api_V1_REWARDS_PREDICT va TabBarContainer_call_api_RIGVER_APPVERSION
    // — hai chuyen khac han nhau. Luc do lay ten buoc lam khoa.
    const key = message || (step ? step + (code ? ' · errorCode ' + code : '') : 'errorCode ' + code);

    let row = failMap.get(key);
    if (!row) {
      row = { key, count: 0, indices: [], codes: new Set(), steps: new Set(), apps: new Set(),
        firstTs: entry.ts, lastTs: entry.ts };
      failMap.set(key, row);
    }
    row.count += 1;
    row.indices.push(entry.domIndex);
    if (code) row.codes.add(code);
    if (step) row.steps.add(step);
    const app = journeyValue(params.appId) || journeyValue(params.flow);
    if (app) row.apps.add(app);
    if (entry.ts) {
      if (!row.firstTs || entry.ts < row.firstTs) row.firstTs = entry.ts;
      if (!row.lastTs || entry.ts > row.lastTs) row.lastTs = entry.ts;
    }
  });

  const fails = Array.from(failMap.values())
    .map((row) => ({ key: row.key, count: row.count, indices: row.indices, firstTs: row.firstTs,
      lastTs: row.lastTs, codes: Array.from(row.codes), steps: Array.from(row.steps),
      apps: Array.from(row.apps) }))
    .sort((a, b) => b.apps.length - a.apps.length || b.count - a.count);

  // Phan biet hai chuyen khac han nhau:
  // - gated: cac dong "@@ grafana >>" di qua GrafanaTracker.log(), bi cat boi co Debug Tool.
  //   Do tren 50 feedback production that: chi 2/50 log (4%) co startTrace/traceFail.
  // - available: co bat ky dong trace nao khong. Mot so dong ("generateOffsetBase", handleError)
  //   ghi thang bang logger nen KHONG bi cat — 68% log production co chung. Neu chi nhin
  //   available thi se tuong log nao cung co du lieu trace, trong khi thuc te gan nhu khong log nao co.
  return { available: lineCount > 0, hasGated: counts.startTrace + counts.traceSuccess + counts.traceFail > 0,
    lineCount, counts, fails };
}

// Moi thu phu thuoc "dang nhin nhung dong nao". Goi mot lan cho ca file luc quet,
// va goi lai tren tap da loc moi khi bo loc doi — do duoc 2.5ms cho 4085 dong, 0.4ms cho tap ~850 dong.
// AI-GENERATED END
