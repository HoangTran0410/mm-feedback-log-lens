// @ts-check
// lỗi do CHÍNH miniapp báo về: có mã, có câu mô tả đọc được, mà lại ghi ở mức WARNING
//
// Dòng nguồn (hai map Kotlin nối nhau trên cùng một dòng):
//   [Module: MiniAppErrorContext] [vn.momo.cinema][b@d15d18f] report error with params:
//   {source=background, miniAppId=vn.momo.cinema, featureCode=cinema_mini, screenId=Cinema,
//    miniAppVersion=4042}  baseParams: {requestId=…, issueDesc=223 - M01 - Cannot read property
//    'status' of undefined, …, errorCode=223, errorMessage=Cannot read property 'status' of
//    undefined, errorStack=
//
// Lớp này ghi BA loại dòng, và hai trong ba mang đủ trường lỗi:
//   add     "Add error context key: <uuid> {errorMiniAppId=…, errorCode=223, errorMessage=…, errorStack=…"
//           mở một context lỗi, mang đủ mã + câu lỗi + stack.
//   report  "report error with params: {…} baseParams: {…}" — lúc gửi báo cáo đi, cũng đủ trường.
//   remove  "Remove error context <uuid> true" — đóng lại, KHÔNG mang trường nào.
//
// Đo trên log production (autoId=5956827, 8541 dòng), 7 dòng của lớp này xếp thành:
//   13:15:34 add 95c3f166 code 40000 "Bạn hãy thử lại sau vài phút nhé." → 13:15:37 remove
//   00:23:25 add 0be42f9f code 223 … → 00:23:28 report (cùng lỗi) → 00:23:28 remove
//   16:32:03 add 839d15b1 code 223 … → 16:32:11 report (cùng lỗi)
// Tức: **add đi trước report vài giây cho CÙNG MỘT sự cố**, và có sự cố chỉ có add chứ không có report.
//
// Bản đầu chỉ đọc `report` vì tôi đo 5 dòng add/remove bằng cách nhìn 220 ký tự đầu rồi kết luận là
// "sổ sách" — sai: chỉ `remove` mới là sổ sách. Hậu quả: lỗi code 40000 ở trên **không hiện ra ở đâu
// cả**, và trên log autoId=5956906 (8357 dòng) thì cả log chỉ có đúng một dòng `add` nên mục này rỗng
// trơn. Người dùng bắt được. Bài học: đọc NGUYÊN VĂN dòng trước khi phân loại nó.
//
// Hai điều còn lại, cũng đo được:
//  - **Map cuối không đóng**: dòng kết thúc ngay ở `errorStack=` hoặc giữa stack (554–559 ký tự — chưa
//    chạm ngưỡng cắt 10000 của logger, nên đây là hình dạng bình thường chứ không phải log hỏng).
//    `parseKeyValueMap` đòi ký tự cuối là `}` nên phải tự đóng trước khi parse, không thì mất sạch
//    `errorCode`/`errorMessage` — đúng thứ đáng đọc nhất của dòng.
//  - Dòng ghi ở mức **WARNING**, nên nhóm chữ ký của tab Vấn đề có đếm nhưng không bao giờ nêu bật —
//    cùng loại với popup ghi ở mức INFO.

const MINIAPP_ERROR_REPORT = 'report error with params';
const MINIAPP_ERROR_ADD = 'Add error context key:';
const MINIAPP_ERROR_BASE = 'baseParams:';
// Chỉ giữ những khoá đọc được thành câu. Cùng map đó còn có requestId và timestamp (mốc epoch, đã có
// giờ ngay đầu dòng) — thêm vào chỉ làm hàng dài ra.
const MINIAPP_ERROR_STACK_MAX = 400;

function miniAppErrorValue(map, key) {
  const value = map && map[key];
  return typeof value === 'string' ? value.trim() : '';
}

// Map nằm ở CUỐI dòng nên thường bị cắt cụt: tự đóng lại rồi mới parse.
function parseOpenKvMap(text) {
  const at = text.indexOf('{');
  if (at < 0) return null;
  let body = text.slice(at).trim();
  if (body.slice(-1) !== '}') body += '}';
  return parseKeyValueMap(body);
}

function parseMiniAppError(raw) {
  if (!raw) return null;
  const reportAt = raw.indexOf(MINIAPP_ERROR_REPORT);
  const addAt = reportAt < 0 ? raw.indexOf(MINIAPP_ERROR_ADD) : -1;
  if (reportAt < 0 && addAt < 0) return null;

  let params = null;
  let base = null;
  if (reportAt >= 0) {
    // Dòng report có HAI map: map đầu đóng kín (còn baseParams đi sau nó), map sau mới bị cắt cụt.
    const head = extractJsonBlock(raw.slice(reportAt));
    params = head ? parseKeyValueMap(head.text) : null;
    const baseAt = raw.indexOf(MINIAPP_ERROR_BASE, reportAt);
    if (baseAt >= 0) base = parseOpenKvMap(raw.slice(baseAt + MINIAPP_ERROR_BASE.length));
  } else {
    base = parseOpenKvMap(raw.slice(addAt));
  }
  if (!params && !base) return null;

  const message = miniAppErrorValue(base, 'errorMessage') || miniAppErrorValue(base, 'issueDesc');
  const code = miniAppErrorValue(base, 'errorCode');
  if (!message && !code) return null;
  return {
    kind: reportAt >= 0 ? 'report' : 'add',
    appId: miniAppErrorValue(base, 'errorMiniAppId') || miniAppErrorValue(params, 'miniAppId'),
    version: miniAppErrorValue(base, 'errorMiniAppVersion') || miniAppErrorValue(params, 'miniAppVersion'),
    featureCode: miniAppErrorValue(base, 'errorFeatureCode') || miniAppErrorValue(params, 'featureCode'),
    screenId: miniAppErrorValue(params, 'screenId'),
    source: miniAppErrorValue(params, 'source'),
    issueDesc: miniAppErrorValue(base, 'issueDesc'),
    stack: miniAppErrorValue(base, 'errorStack').slice(0, MINIAPP_ERROR_STACK_MAX),
    message,
    code,
  };
}

// Gom theo (miniapp, mã lỗi, câu lỗi): cùng một lỗi nổ nhiều lần là MỘT hàng, còn hai miniapp cùng
// dính một câu lỗi thì vẫn là hai hàng — lỗi của miniapp nào là chuyện của đội đó.
function buildMiniAppErrors(entries) {
  const byKey = new Map();
  let lineCount = 0;
  entries.forEach((entry) => {
    const info = parseMiniAppError(entry.raw);
    if (!info) return;
    lineCount += 1;
    const key = info.appId + '|' + info.code + '|' + info.message;
    let row = byKey.get(key);
    if (!row) {
      row = Object.assign({ key, adds: 0, reports: 0, indices: [], firstTs: entry.ts, lastTs: entry.ts }, info);
      byKey.set(key, row);
    }
    if (info.kind === 'add') row.adds += 1;
    else row.reports += 1;
    // Dòng report mang thêm screenId/source mà dòng add không có — điền vào chỗ còn trống.
    if (!row.screenId) row.screenId = info.screenId;
    if (!row.source) row.source = info.source;
    if (!row.stack) row.stack = info.stack;
    row.indices.push(entry.domIndex);
    if (entry.ts) {
      if (!row.firstTs) row.firstTs = entry.ts;
      row.lastTs = entry.ts;
    }
  });
  const rows = Array.from(byKey.values());
  rows.forEach((row) => {
    // Một sự cố ghi ra tối đa một dòng add và một dòng report, nên CỘNG hai loại lại là đếm đôi:
    // nhóm cinema/223 trên log thật có 2 add + 2 report mà chỉ là 2 sự cố (08-30 và 09-11).
    // Lấy số lớn hơn: log chỉ có add thì ra số add, chỉ có report thì ra số report.
    row.count = Math.max(row.adds, row.reports);
  });
  return {
    available: lineCount > 0,
    lineCount,
    rows: rows.sort((a, b) => b.count - a.count),
  };
}
