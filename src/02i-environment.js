// @ts-check
// đọc "máy này là máy gì, chạy bản nào, nối vào đâu, xài miniapp version bao nhiêu" từ header HTTP
//
// Vì sao lấy từ header chứ không từ module DeviceProfileManager: đếm trên ba log thật,
// DeviceProfileManager có 27 / 9 / 0 dòng — bằng 0 trên log production. Còn header thì có
// 52 / 66 / 94 lần. Đây là nguồn duy nhất trả lời được câu "máy gì, bản nào" trên log production.
//
// Một dòng RequestPayload mang nguyên map header, ví dụ (đã làm mờ):
//   --header: {"deviceid":"6665…4e84b","device-name":"Oppo CPH2083","device-ip":"42.118.185.199",
//              "map_appId":"vn.momo.cvs_fund","map_miniAppVersion":"694","device_os":"ANDROID",
//              "app_version":"51500","app_code":"5.15.0","agent_id":"73217397","env":"production",
//              "M-Timezone":"Asia/Ho_Chi_Minh","User-Agent":"momotransfer/5.15.0.51500 Dalvik/2.1.0 …"}
//
// Ba điều đã học khi viết phần này:
//
// 1. KHÔNG JSON.parse được map đó. Header bị làm mờ để lại giá trị trần không có khoá
//    (`"agent_id":"73217397","****","****","sessionKey":…`) — JSON.parse ném lỗi ngay. Quét từng cặp
//    "khoá":"giá trị" thì mấy token trần đó tự bị bỏ qua.
// 2. Danh sách khoá là DANH SÁCH TRẮNG, cố ý không phải "đọc hết rồi lọc thứ nhạy cảm". Cùng map đó
//    còn có authorization, cvs-token, sessionKey, M-Signature — bỏ sót một cái tên trong danh sách đen
//    là đưa token lên panel và vào ticket.
// 3. Không chỉ có iOS. Bản cũ chỉ khớp User-Agent kiểu iOS (MoMoPlatform … CFNetwork … Darwin), nên
//    trên log Android nó bỏ trống cả tên máy lẫn phiên bản app — đo trên đúng một dòng log Android
//    thật: chỉ ra được device_os / device_performance / lang, mất device-name, app_code, app_version.

const ENV_HEADER_KEYS = ['deviceid', 'device-name', 'device-ip', 'device_os', 'device_performance',
  'app_code', 'app_version', 'agent_id', 'lang', 'M-Lang', 'M-Timezone', 'channel', 'env', 'app_type',
  'map_appId', 'map_miniAppVersion', 'map_screen_name', 'User-Agent'];

const RE_ENV_HEADER_PAIR = /"([A-Za-z0-9_.\-]{1,40})"\s*:\s*"([^"]*)"/g;
// iOS: MoMoPlatform UAT/5.15.0.51500 CFNetwork/1410.1 Darwin/22.6.0 (iPhone 8 Plus iOS/16.7.16)
const RE_ENV_UA = /MoMoPlatform\s*([A-Za-z]*)\s*\/?([\d.]+)\s+CFNetwork\/([\d.]+)\s+Darwin\/([\d.]+)\s+\(([^)]*)\)/;
const RE_ENV_DEVICE = /^(.*?)\s+iOS\/([\d.]+)$/;
// Android: momotransfer/5.15.0.51500 Dalvik/2.1.0 (Linux; U; Android 9; CPH2083 Build/PPR1.180610.011)
const RE_ENV_ANDROID = /\bAndroid\s+([\d.]+)/;
const RE_ENV_ANDROID_MODEL = /;\s*([^;()]{2,40}?)\s+Build\//;
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

// Map header của MỘT dòng, chỉ giữ khoá trong danh sách trắng.
function parseEnvHeaderMap(raw) {
  const at = raw.indexOf('--header:');
  if (at < 0) return null;
  const block = extractJsonBlock(raw.slice(at));
  if (!block) return null;
  const map = {};
  RE_ENV_HEADER_PAIR.lastIndex = 0;
  let hit = RE_ENV_HEADER_PAIR.exec(block.text);
  while (hit) {
    if (ENV_HEADER_KEYS.indexOf(hit[1]) >= 0 && hit[2].trim()) map[hit[1]] = hit[2].trim();
    hit = RE_ENV_HEADER_PAIR.exec(block.text);
  }
  return map;
}

function envBump(tally, key, value) {
  let byValue = tally.get(key);
  if (!byValue) {
    byValue = new Map();
    tally.set(key, byValue);
  }
  byValue.set(value, (byValue.get(value) || 0) + 1);
}

// Một lượt quét duy nhất qua các dòng CÓ header. Sàng bằng indexOf trước: dòng payload dài 10KB mà
// chạy regex lên tất cả thì riêng mục này ăn hết phần lớn thời gian khởi động.
function collectEnvHeaders(entries) {
  const tally = new Map();
  const miniApps = new Map();
  let lineCount = 0;
  entries.forEach((entry) => {
    const raw = entry.raw;
    if (!raw || raw.indexOf('--header:') < 0) return;
    const map = parseEnvHeaderMap(raw);
    if (!map) return;
    lineCount += 1;
    Object.keys(map).forEach((key) => envBump(tally, key, map[key]));
    // Cặp (miniapp, version) phải đọc TRONG CÙNG một dòng: gom riêng hai danh sách rồi ghép lại là
    // gán nhầm version của miniapp này cho miniapp kia.
    if (map.map_appId && map.map_miniAppVersion) {
      let versions = miniApps.get(map.map_appId);
      if (!versions) {
        versions = new Map();
        miniApps.set(map.map_appId, versions);
      }
      versions.set(map.map_miniAppVersion, (versions.get(map.map_miniAppVersion) || 0) + 1);
    }
  });
  return { tally, miniApps, lineCount };
}

// Mọi giá trị của một khoá, nhiều lần nhất đứng trước. Trả về danh sách chứ không trả về một giá trị:
// nhiều deviceid hay nhiều IP trong cùng một log là thứ đáng nhìn thấy, không phải thứ để chọn đại
// lấy cái đầu (IP đổi = đổi mạng giữa chừng; deviceid đổi thì log đã bị trộn từ hai máy).
function envValues(tally, key) {
  const byValue = tally.get(key);
  if (!byValue) return [];
  return Array.from(byValue, (pair) => ({ value: pair[0], count: pair[1] }))
    .sort((a, b) => b.count - a.count);
}

function envTop(tally, key) {
  const list = envValues(tally, key);
  return list.length ? list[0].value : '';
}

function buildEnvironment(entries, httpCalls) {
  const headers = collectEnvHeaders(entries);
  const tally = headers.tally;

  const ua = envTop(tally, 'User-Agent') || envFirst(entries, RE_ENV_UA, 0);
  const parsed = ua ? RE_ENV_UA.exec(ua) : null;
  const iosDevice = parseEnvDevice(parsed ? parsed[5] : '');
  const androidHit = ua ? RE_ENV_ANDROID.exec(ua) : null;
  const androidModel = ua ? RE_ENV_ANDROID_MODEL.exec(ua) : null;

  const hosts = new Map();
  (httpCalls || []).forEach((call) => {
    if (!call.host) return;
    hosts.set(call.host, (hosts.get(call.host) || 0) + 1);
  });
  const nonProdHosts = Array.from(hosts.keys()).filter((host) => RE_ENV_NONPROD_HOST.test(host));

  const flavor = parsed ? parsed[1] : '';
  const deviceOs = envTop(tally, 'device_os') || envFirst(entries, RE_ENV_OS);
  // Nhãn hệ điều hành do đây dựng, không để renderer tự ghép chữ "iOS": ghép cứng ở đó thì log Android
  // hiện ra "iOS 9". Không đoán được phiên bản thì chỉ ghi tên hệ điều hành.
  const osLabel = iosDevice.osVersion ? 'iOS ' + iosDevice.osVersion
    : (androidHit ? 'Android ' + androidHit[1] : '');

  const miniApps = Array.from(headers.miniApps, (pair) => ({
    appId: pair[0],
    versions: Array.from(pair[1], (item) => ({ value: item[0], count: item[1] }))
      .sort((a, b) => b.count - a.count),
    count: Array.from(pair[1].values()).reduce((sum, n) => sum + n, 0),
  })).sort((a, b) => b.count - a.count);

  return {
    // Rỗng hết thì tab không vẽ mục này — log production cắt giữa chừng có thể không có request nào.
    available: !!(parsed || hosts.size || headers.lineCount),
    flavor,
    appVersion: (parsed ? parsed[2] : '') || envTop(tally, 'app_code'),
    appBuild: envTop(tally, 'app_version'),
    cfNetwork: parsed ? parsed[3] : '',
    darwin: parsed ? parsed[4] : '',
    device: envTop(tally, 'device-name') || iosDevice.device || (androidModel ? androidModel[1] : ''),
    osVersion: iosDevice.osVersion,
    osLabel,
    deviceOs,
    performance: envTop(tally, 'device_performance') || envFirst(entries, RE_ENV_PERF),
    lang: envTop(tally, 'lang') || envTop(tally, 'M-Lang') || envFirst(entries, RE_ENV_LANG),
    timezone: envTop(tally, 'M-Timezone'),
    channel: envTop(tally, 'channel'),
    envName: envTop(tally, 'env') || envTop(tally, 'app_type'),
    deviceIds: envValues(tally, 'deviceid'),
    ips: envValues(tally, 'device-ip'),
    agentIds: envValues(tally, 'agent_id'),
    miniApps,
    headerLineCount: headers.lineCount,
    hostCount: hosts.size,
    nonProdHosts,
    // Bản Staging/UAT mà lại gọi toàn host không có dấu hiệu uat/dev — gặp thật trên một log. Chỉ NÓI
    // RA sự thật quan sát được, không kết luận "log này là prod hay không": bản build và host là hai
    // chuyện khác nhau, và danh sách host ở đây chỉ gồm những host có request trong log.
    mixedBuild: RE_ENV_NONPROD_BUILD.test(flavor) && hosts.size > 0 && nonProdHosts.length === 0,
  };
}
