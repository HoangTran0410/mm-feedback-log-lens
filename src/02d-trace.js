// @ts-check
// lỗi đọc từ Grafana trace, và nhận diện nhiễu của chính lớp đo lường
// Tách ra từ src/02-insights.js (946 dòng). Các file src/*.js được build.sh nối lại theo thứ tự
// tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc.

/* ------------------------------------------- nhiễu từ chính hệ thống đo lường */

// Đo trên 50 feedback PRODUCTION thật (25 iOS, 25 Android, ngày 2026-09-10): 2488 dòng ERROR, trong đó
// 1267 dòng (51%) không phải lỗi user gặp mà là lỗi của chính lớp đo lường. 24/49 log có quá nửa số
// dòng ERROR là loại này. Chúng đều ghi bằng logger.e trực tiếp nên KHÔNG bị cắt bởi cờ Debug Tool —
// tức chúng có mặt trên máy user thật, khác hẳn các dòng "@@ grafana >>" khác.
//
// Không tự động tắt tiếng: đó là quyết định của người đọc. Chỉ tách ra một khối riêng để danh sách
// vấn đề còn lại là những thứ đáng đọc.
const TELEMETRY_NOISE_PATTERNS = [
  // withTraceId() làm buffer.remove() nên traceId chỉ dùng được một lần; gọi stop lần hai là mất.
  { re: /GrafanaTrace\.\w+:: no traceId/, label: 'GrafanaTrace mất traceId' },
  // resolveFormatter() trả null khi Koin scope đã đóng.
  { re: /GrafanaTrace\.\w+ PaymentSession is null/, label: 'GrafanaTrace không có PaymentSession' },
  { re: /GrafanaTrace\.exceptionHandler/, label: 'GrafanaTrace nuốt exception' },
  // Hàng đợi gửi trace của chính Grafana bị lỗi.
  { re: /grafana >> DefaultRequestQueue >> handleError/, label: 'Hàng đợi gửi trace Grafana lỗi' },
];

function telemetryNoiseLabel(text) {
  for (let i = 0; i < TELEMETRY_NOISE_PATTERNS.length; i += 1) {
    if (TELEMETRY_NOISE_PATTERNS[i].re.test(text)) return TELEMETRY_NOISE_PATTERNS[i].label;
  }
  return '';
}

/* -------------------------------------------------- lỗi đọc từ Grafana trace */

// Grafana ghi ở mức INFO nên không dòng nào lọt vào buildIssueGroups, trong khi traceFail mang sẵn
// flow + step + errorCode + errorMessage — tức mô tả lỗi RÕ HƠN bất kỳ dòng ERROR nào trong log.
//
// Gom theo errorMessage chứ không theo step: trong GrafanaTracker.generateParams, với miniapp thì
// `flow` bị ghi đè bằng appId và `step` bị đổi thành "flow.step", nên MỘT sự cố hạ tầng hiện ra
// thành hàng chục dòng khác nhau. Đo trên một log thật: cùng một lỗi "500 - B07 No version found
// from remote" xuất hiện ở 17 miniapp khác nhau. Gom theo errorMessage thì 17 dòng đó về một hàng,
// kèm số app bị ảnh hưởng — nhìn là biết ngay hạ tầng chết chứ không phải bug của tính năng.
const TRACE_VERBS = ['startTrace', 'traceSuccess', 'traceFail', 'countTrace', 'durationStopTrace',
  'durationTrace', 'errorTrace'];

// Hậu tố _start/_success/_fail do generateParams tự gắn, và tiền tố "<flow>." cũng do nó gắn khi
// appId không phải platform. Bỏ cả hai để còn lại tên bước thật.
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
    // Có errorMessage thì gom theo nó — đó mới là thứ chung giữa các app cùng dính một sự cố.
    // Không có thì KHÔNG được gom theo mỗi errorCode: trên một log thật, "code 200" ôm chung
    // TransactionResultV3_call_api_V1_REWARDS_PREDICT va TabBarContainer_call_api_RIGVER_APPVERSION
    // — hai chuyện khác hẳn nhau. Lúc đó lấy tên bước làm khoá.
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

  // Phân biệt hai chuyện khác hẳn nhau:
  // - gated: các dòng "@@ grafana >>" đi qua GrafanaTracker.log(), bị cắt bởi cờ Debug Tool.
  //   Đo trên 50 feedback production thật: chỉ 2/50 log (4%) có startTrace/traceFail.
  // - available: có bất kỳ dòng trace nào không. Một số dòng ("generateOffsetBase", handleError)
  //   ghi thẳng bằng logger nên KHÔNG bị cắt — 68% log production có chúng. Nếu chỉ nhìn
  //   available thì sẽ tưởng log nào cũng có dữ liệu trace, trong khi thực tế gần như không log nào có.
  return { available: lineCount > 0, hasGated: counts.startTrace + counts.traceSuccess + counts.traceFail > 0,
    lineCount, counts, fails };
}

// Mọi thứ phụ thuộc "đang nhìn những dòng nào". Gọi một lần cho cả file lúc quét,
// và gọi lại trên tập đã lọc mỗi khi bộ lọc đổi — đo được 2.5ms cho 4085 dòng, 0.4ms cho tập ~850 dòng.
