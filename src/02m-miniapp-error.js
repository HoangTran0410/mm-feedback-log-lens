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
// Ba điều đã đo trên log production (autoId=5956827, 8541 dòng):
//  - 7 dòng mang `MiniAppErrorContext` nhưng **chỉ 2 dòng** là lỗi thật; 5 dòng còn lại là sổ sách của
//    chính lớp đó ("Add error context key: <uuid>", "Remove error context <uuid> true"). Vì vậy sàng
//    bằng đúng chuỗi `report error with params`, không sàng theo tên module.
//  - **Map thứ hai không đóng**: dòng kết thúc ngay ở `errorStack=` (559 ký tự, chưa chạm ngưỡng cắt
//    10000 của logger). `parseKeyValueMap` đòi ký tự cuối là `}` nên phải tự đóng lại trước khi parse,
//    không thì mất sạch `errorCode`/`errorMessage` — tức mất đúng thứ đáng đọc nhất của dòng này.
//  - Dòng ghi ở mức **WARNING**, nên nhóm chữ ký của tab Vấn đề có đếm nhưng không bao giờ nêu bật —
//    cùng loại với popup ghi ở mức INFO.

const MINIAPP_ERROR_MARK = 'report error with params';
const MINIAPP_ERROR_BASE = 'baseParams:';
// Chỉ giữ những khoá đọc được thành câu. Cùng map đó còn có requestId và timestamp (mốc epoch, đã có
// giờ ngay đầu dòng) — thêm vào chỉ làm hàng dài ra.
const MINIAPP_ERROR_STACK_MAX = 400;

function miniAppErrorValue(map, key) {
  const value = map && map[key];
  return typeof value === 'string' ? value.trim() : '';
}

function parseMiniAppError(raw) {
  if (!raw || raw.indexOf(MINIAPP_ERROR_MARK) < 0) return null;
  const at = raw.indexOf(MINIAPP_ERROR_MARK);
  const head = extractJsonBlock(raw.slice(at));
  const params = head ? parseKeyValueMap(head.text) : null;

  const baseAt = raw.indexOf(MINIAPP_ERROR_BASE, at);
  let base = null;
  if (baseAt >= 0) {
    let text = raw.slice(baseAt + MINIAPP_ERROR_BASE.length).trim();
    // Tự đóng map bị cắt cụt: xem chú thích đầu file.
    if (text.charAt(0) === '{' && text.slice(-1) !== '}') text += '}';
    base = parseKeyValueMap(text);
  }
  if (!params && !base) return null;

  const message = miniAppErrorValue(base, 'errorMessage') || miniAppErrorValue(base, 'issueDesc');
  const code = miniAppErrorValue(base, 'errorCode');
  if (!message && !code) return null;
  return {
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
      row = Object.assign({ key, count: 0, indices: [], firstTs: entry.ts, lastTs: entry.ts }, info);
      byKey.set(key, row);
    }
    row.count += 1;
    row.indices.push(entry.domIndex);
    if (entry.ts) {
      if (!row.firstTs) row.firstTs = entry.ts;
      row.lastTs = entry.ts;
    }
  });
  return {
    available: lineCount > 0,
    lineCount,
    rows: Array.from(byKey.values()).sort((a, b) => b.count - a.count),
  };
}
