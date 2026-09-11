// @ts-check
// gom MỌI mã lỗi xuất hiện trong log về một chỗ
//
// Mã lỗi đang nằm rải ở bốn nguồn khác nhau và không chỗ nào đếm chúng lại: `entry.http.errorCode`
// (payload HTTP), `error_code` trong params của MoMoTracker, `errorCode` trong TraceParameter của
// Grafana, và `"errorCode": 413` nằm trong thân JSON của response hoặc của một khối config. Muốn biết
// "log này có những mã nào, mã nào nổ nhiều nhất" thì phải tự đọc từng mục một rồi cộng tay.
//
// Vì vậy đọc bằng MỘT regex chung trên chính dòng text, thay vì đi gom từ bốn cấu trúc đã parse: bốn
// nguồn đó viết mã lỗi theo bốn kiểu (`errorCode=`, `error_code=`, `"errorCode":`, `"errorCode": "`)
// nhưng đều là cùng một chữ. Sàng bằng indexOf trước vì đại đa số dòng không có chữ nào trong hai chữ
// đó — cùng lý do với chữ ký lỗi và với buildCorrelations.
const RE_ERROR_CODE_ANY = /(?:errorCode|error_code)"?\s*[=:]\s*"?(-?\d+)/g;

// Mã 0 và mã rỗng nghĩa là KHÔNG lỗi: `ops_receive_be` ghi `error_code=0` cho mọi call thành công, để
// lẫn vào thì mã hay gặp nhất trong log luôn là 0 và mục này thành vô dụng.
function buildErrorCodes(entries) {
  const byCode = new Map();
  entries.forEach((entry) => {
    const raw = entry.raw;
    if (!raw || (raw.indexOf('errorCode') < 0 && raw.indexOf('error_code') < 0)) return;
    RE_ERROR_CODE_ANY.lastIndex = 0;
    let hit = RE_ERROR_CODE_ANY.exec(raw);
    while (hit) {
      const code = Number(hit[1]);
      if (code !== 0) {
        let bucket = byCode.get(code);
        if (!bucket) {
          bucket = { code, count: 0, indices: [], firstTs: entry.ts || entry.windowTs || 0, modules: new Set() };
          byCode.set(code, bucket);
        }
        bucket.count += 1;
        if (entry.module) bucket.modules.add(entry.module);
        // Một dòng có thể ghi cùng một mã hai lần (payload lồng nhau); chỉ giữ dòng một lần để bấm vào
        // duyệt không bị lặp.
        if (bucket.indices[bucket.indices.length - 1] !== entry.domIndex) bucket.indices.push(entry.domIndex);
      }
      hit = RE_ERROR_CODE_ANY.exec(raw);
    }
  });
  return Array.from(byCode.values())
    .map((bucket) => ({ code: bucket.code, count: bucket.count, indices: bucket.indices,
      firstTs: bucket.firstTs, modules: Array.from(bucket.modules) }))
    .sort((a, b) => b.count - a.count || a.code - b.code);
}
