// @ts-check
// "miniapp này đang chạy bản build nào, và nó vừa nhảy từ bản nào lên"
//
// Dòng nguồn là Map.toString() của Kotlin (không phải JSON), dùng chung lớp đọc với tracker và Grafana:
//   [Module: BundleLoader] [BundleExecutorManager][e@14ffac7] [vn.momo.expense] execute version:
//   {deploymentTarget=150, cdnUrl=…, buildNumber=3449, size=1619017, appId=vn.momo.expense,
//    installMode=1, diffChange={url=…, fromBuildNumber=3420, toBuildNumber=3449, size=544980}}
//
// Vì sao đáng đọc riêng: header request chỉ khai `map_miniAppVersion` tại lúc gọi, tức chỉ thấy bản
// CUỐI. Dòng này mới nói ra cả đường đi. Đo trên log production (autoId=5956827): `vn.momo.expense`
// chạy 3420, vá lên 3449 rồi vá tiếp lên 3494 — ba bản trong một log, mà mục MiniApp cũ chỉ hiện một.
//
// Cùng chuỗi "execute version" còn một dòng KHÁC hẳn, không phải map:
//   "execute version.appId: vn.momo.expense loaded event. bridge data: com.facebook.react…"
// Đo trên log trên: 54 dòng chứa chuỗi đó thì **20 dòng là loại này**. Vì vậy phải đòi đúng dấu hai
// chấm rồi tới dấu ngoặc (`RE_BUNDLE_EXEC`), sàng bằng indexOf trước cho rẻ.

const BUNDLE_MARK = 'execute version';
const RE_BUNDLE_EXEC = /execute version:\s*\{/;
// Những khoá đáng hiện. Danh sách trắng chứ không phải "đọc hết": cùng map đó có `signature` dài hơn
// 1000 ký tự và `checksum`, `jsBundlePath`, `cdnUrl`, `downloadUrls` — không có chỗ nào trên panel
// rộng 480px cho chúng, mà đưa vào ticket thì chỉ làm loãng.
const BUNDLE_KEYS = ['buildNumber', 'size', 'installMode', 'platform', 'deploymentTarget',
  'trackingFlag', 'versionFromSource'];

function bundleNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Một dòng "execute version" -> thông tin gọn của lần nạp bundle đó, hoặc null nếu không phải dòng map.
function parseBundleExec(raw) {
  if (!raw || raw.indexOf(BUNDLE_MARK) < 0) return null;
  const hit = RE_BUNDLE_EXEC.exec(raw);
  if (!hit) return null;
  const block = extractJsonBlock(raw.slice(hit.index));
  const map = block ? parseKeyValueMap(block.text) : null;
  if (!map || !map.appId) return null;
  const info = { appId: String(map.appId) };
  BUNDLE_KEYS.forEach((key) => {
    if (map[key] != null && map[key] !== '') info[key] = String(map[key]);
  });
  // diffChange có nghĩa là bản này được VÁ từ một bản cũ chứ không tải trọn gói: đó chính là chỗ nhìn
  // ra đường đi của version. Không có nó thì đây là lần nạp thẳng một bản.
  const diff = map.diffChange && typeof map.diffChange === 'object' ? map.diffChange : null;
  if (diff) {
    info.from = String(diff.fromBuildNumber || '');
    info.to = String(diff.toBuildNumber || '');
    info.patchSize = bundleNumber(diff.size);
  }
  return info;
}

// Gom theo (miniapp, bản build, vá từ bản nào). Giữ thứ tự GẶP LẦN ĐẦU chứ không sắp theo số lần:
// câu chuyện ở đây là "đi từ bản nào lên bản nào", sắp lại theo số lần là đọc ngược dòng thời gian.
function buildMiniAppBundles(entries) {
  const byApp = new Map();
  entries.forEach((entry) => {
    const info = parseBundleExec(entry.raw);
    if (!info) return;
    let list = byApp.get(info.appId);
    if (!list) {
      list = [];
      byApp.set(info.appId, list);
    }
    const key = (info.buildNumber || '') + '|' + (info.from || '');
    let seen = list.find((item) => item.key === key);
    if (!seen) {
      seen = Object.assign({ key, count: 0, indices: [], firstTs: entry.ts, lastTs: entry.ts }, info);
      list.push(seen);
    }
    seen.count += 1;
    seen.indices.push(entry.domIndex);
    if (entry.ts) {
      if (!seen.firstTs) seen.firstTs = entry.ts;
      seen.lastTs = entry.ts;
    }
  });
  return byApp;
}

// Miniapp có đổi bản trong tập đang xem không. Một lần nạp DUY NHẤT mà là bản vá thì vẫn là có đổi:
// chính chữ "vá từ 3420 lên 3449" đã nói ra điều đó, không cần thấy đủ hai lần nạp.
function miniAppChangedBuild(app) {
  return app.bundles.length > 1 || !!(app.bundles[0] && app.bundles[0].from);
}

// Đường đi của version, ví dụ "3420 → 3449 → 3494". Phải bắt đầu từ bản ĐƯỢC VÁ LÊN của lần nạp đầu,
// không thì mất mất bản gốc: trên log thật lần nạp đầu của vn.momo.expense đã là "3449 vá từ 3420",
// liệt kê trơn số build sẽ ra "3449 → 3494" và bản 3420 biến mất.
function miniAppBuildPath(app) {
  const first = app.bundles[0];
  if (!first) return '';
  return (first.from ? [first.from] : []).concat(app.bundles.map((item) => item.buildNumber)).join(' → ');
}
