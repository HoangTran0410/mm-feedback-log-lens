// @ts-check
// đọc "máy này là máy gì, chạy bản nào, nối vào đâu" từ header của request HTTP
//
// Vì sao lấy từ header chứ không từ module DeviceProfileManager: đếm trên ba log thật,
// DeviceProfileManager có 27 / 9 / 0 dòng — bằng 0 trên log production. Còn header User-Agent thì có
// 52 / 66 / 94 lần, và mỗi log chỉ có ĐÚNG MỘT giá trị. Đây là nguồn duy nhất trả lời được câu "máy
// gì, iOS mấy, bản nào" trên cả log production.
//
// Dạng thật (đã làm mờ id): MoMoPlatform UAT/5.15.0.51500 CFNetwork/1410.1 Darwin/22.6.0
//                           (iPhone 8 Plus iOS/16.7.16) AgentID/<AN>

const RE_ENV_UA = /MoMoPlatform\s*([A-Za-z]*)\s*\/?([\d.]+)\s+CFNetwork\/([\d.]+)\s+Darwin\/([\d.]+)\s+\(([^)]*)\)/;
const RE_ENV_DEVICE = /^(.*?)\s+iOS\/([\d.]+)$/;
const RE_ENV_PERF = /device_performance[=:"\s]+([a-z-]{3,20})/;
const RE_ENV_OS = /device_os[=:"\s]+([A-Za-z0-9._ ]{2,30})/;
// Ký tự đóng phải gồm cả "}": trên log thật lang nằm giữa map nên sau nó là dấu phẩy, nhưng khi nó là
// trường CUỐI của map thì sau nó là dấu đóng ngoặc.
const RE_ENV_LANG = /[",\s]lang[=:"\s]+([a-z]{2,5})[",\s}]/;
// Dấu hiệu KHÔNG phải production trên hostname. Không làm danh sách host production: danh sách đó sẽ
// cứ phải cập nhật, còn dấu hiệu uat/dev/staging thì ổn định hơn nhiều.
const RE_ENV_NONPROD_HOST = /(^|[.\-/])(uat|dev|staging|test|sandbox)([.\-:/]|$)/i;
// Tìm DẤU HIỆU không-production, không phải "khác chữ production". Bản production trên App Store ghi
// flavor là "Store" — coi mọi thứ khác chữ "production" là đáng ngờ thì log thật nào cũng bị cảnh báo
// nhầm. Đã dính đúng lỗi đó khi test trên trang admin thật.
const RE_ENV_NONPROD_BUILD = /^(uat|staging|dev|test|sandbox|alpha|beta|debug)$/i;

function envFirst(entries, re, group) {
  for (let i = 0; i < entries.length; i += 1) {
    const raw = entries[i].raw;
    if (!raw) continue;
    const hit = re.exec(raw);
    // group == null chứ không phải "group || 1": gọi với group = 0 (lấy cả chuỗi khớp) thì 0 là falsy,
    // "0 || 1" ra 1 và hàm trả về nhóm thứ nhất. Đã dính đúng bẫy này.
    if (hit) return hit[group == null ? 1 : group];
  }
  return '';
}

// Tên máy + phiên bản iOS nằm chung trong ngoặc: "iPhone 8 Plus iOS/16.7.16".
function parseEnvDevice(inside) {
  const hit = RE_ENV_DEVICE.exec(inside || '');
  if (!hit) return { device: inside || '', osVersion: '' };
  return { device: hit[1].trim(), osVersion: hit[2] };
}

function buildEnvironment(entries, httpCalls) {
  const ua = envFirst(entries, RE_ENV_UA, 0);
  const parsed = ua ? RE_ENV_UA.exec(ua) : null;
  const device = parseEnvDevice(parsed ? parsed[5] : '');

  const hosts = new Map();
  (httpCalls || []).forEach((call) => {
    if (!call.host) return;
    hosts.set(call.host, (hosts.get(call.host) || 0) + 1);
  });
  const nonProdHosts = Array.from(hosts.keys()).filter((host) => RE_ENV_NONPROD_HOST.test(host));

  const flavor = parsed ? parsed[1] : '';
  return {
    // Rỗng hết thì tab không vẽ mục này — log production cắt giữa chừng có thể không có request nào.
    available: !!(parsed || hosts.size),
    flavor,
    appVersion: parsed ? parsed[2] : '',
    cfNetwork: parsed ? parsed[3] : '',
    darwin: parsed ? parsed[4] : '',
    device: device.device,
    osVersion: device.osVersion,
    deviceOs: envFirst(entries, RE_ENV_OS),
    performance: envFirst(entries, RE_ENV_PERF),
    lang: envFirst(entries, RE_ENV_LANG),
    hostCount: hosts.size,
    nonProdHosts,
    // Bản Staging/UAT mà lại gọi toàn host không có dấu hiệu uat/dev — gặp thật trên một log. Chỉ NÓI
    // RA sự thật quan sát được, không kết luận "log này là prod hay không": bản build và host là hai
    // chuyện khác nhau, và danh sách host ở đây chỉ gồm những host có request trong log.
    mixedBuild: RE_ENV_NONPROD_BUILD.test(flavor) && hosts.size > 0 && nonProdHosts.length === 0,
  };
}
