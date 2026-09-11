// @ts-check
// đọc "máy này là máy gì, chạy bản nào, nối vào đâu, xài miniapp version bao nhiêu" từ dòng request HTTP
//
// Vì sao lấy từ dòng HTTP chứ không từ module DeviceProfileManager: đếm trên ba log thật,
// DeviceProfileManager có 27 / 9 / 0 dòng — bằng 0 trên log production. Còn header thì có
// 52 / 66 / 94 lần. Đây là nguồn duy nhất trả lời được câu "máy gì, bản nào" trên log production.
//
// Một dòng RequestPayload mang HAI map đáng đọc, viết theo hai kiểu tên khác nhau:
//   --body:   {"appCode":"5.13.1","appId":"vn.momo.myvoucher","appVer":51310,"buildNumber":0,
//              "channel":"APP","lang":"vi","deviceName":"Redmi Note 11","deviceOS":"android"}
//   --header: {"deviceid":"6665…4e84b","device-name":"Oppo CPH2083","device-ip":"42.118.185.199",
//              "map_appId":"vn.momo.cvs_fund","map_miniAppVersion":"694","device_os":"ANDROID",
//              "app_version":"51500","app_code":"5.15.0","agent_id":"73217397","env":"production",
//              "M-Timezone":"Asia/Ho_Chi_Minh","User-Agent":"momotransfer/5.15.0.51500 Dalvik/2.1.0 …"}
//
// Bốn điều đã học khi viết phần này:
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
// 4. Header KHÔNG phải lúc nào cũng có tên máy, mà body thì có. Đo trên log production 9609 dòng
//    (autoId=5956756): `device-name` trong header **0 dòng**, `deviceName` trong body **153 dòng**,
//    tất cả cùng một giá trị "Redmi Note 11". Không đọc body thì panel chỉ ghi được mã máy moi từ
//    User-Agent — "2201117TG", đúng nhưng không ai đọc ra đó là Redmi Note 11.

const ENV_HEADER_KEYS = ['deviceid', 'device-name', 'device-ip', 'device_os', 'device_performance',
  'app_code', 'app_version', 'agent_id', 'lang', 'M-Lang', 'M-Timezone', 'channel', 'env', 'app_type',
  'map_appId', 'map_miniAppVersion', 'map_screen_name', 'User-Agent'];

// Body gọi cùng một thứ bằng tên khác, nên phải quy về một tên chung — nếu không thì hai nguồn nói
// về cùng một sự thật lại nằm ở hai khoá và không bao giờ gặp nhau.
const ENV_BODY_KEY_MAP = new Map([
  ['deviceName', 'device-name'],
  ['deviceOS', 'device_os'],
  ['devicePerformance', 'device_performance'],
  ['appCode', 'app_code'],
  ['appVer', 'app_version'],
  ['lang', 'lang'],
  ['channel', 'channel'],
]);
// Cố ý KHÔNG lấy từ body, cả bốn đều đo trên chính log trên:
//   appId             id của MINIAPP đang gọi (vn.momo.helpcenter, vn.momo.myvoucher, …) chứ không
//                     phải app mẹ — 7 giá trị khác nhau trong khi app_code chỉ có 2. Lấy nhầm thì
//                     dòng "Bản app" ghi tên một miniapp.
//   deviceNameSetting tên do chính người dùng đặt cho máy, hoàn toàn có thể là tên thật của họ.
//                     Mục này đi thẳng vào ticket, nên cùng luật với danh sách trắng của header.
//   DEVICE_IMEI / SECUREID / MODELID / DEVICE_TOKEN / checkSum  định danh máy và chữ ký.
//   buildNumber       bằng 0 ở cả 146/146 dòng, không nói lên gì.

// Chấp nhận cả giá trị trần: header viết "app_version":"51310" (có nháy) còn body viết "appVer":51310.
const RE_ENV_PAIR = /"([A-Za-z0-9_.\-]{1,40})"\s*:\s*(?:"([^"]*)"|(-?\d+(?:\.\d+)?))/g;
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

// Khối JSON phải nằm NGAY sau nhãn. Dòng "--body: null --encryptedBody:  --header: {…}" có thật —
// đo trên log trên: 20/291 dòng có body là null. Đi tìm dấu { đầu tiên kể từ nhãn --body thì vớ luôn
// map header của chính dòng đó, tức là đọc một nguồn rồi ghi vào tên của nguồn kia.
function envJsonAfter(raw, marker) {
  const at = raw.indexOf(marker);
  if (at < 0) return null;
  const block = extractJsonBlock(raw.slice(at + marker.length));
  return block && block.start <= 1 ? block.text : null;
}

function envHeaderKey(key) {
  return ENV_HEADER_KEYS.indexOf(key) >= 0 ? key : '';
}

function envBodyKey(key) {
  return ENV_BODY_KEY_MAP.get(key) || '';
}

// Map của MỘT dòng, chỉ giữ khoá mà resolveKey nhận — và trả về dưới tên chung.
function parseEnvMap(raw, marker, resolveKey) {
  const text = envJsonAfter(raw, marker);
  if (!text) return null;
  const map = Object.create(null);
  let count = 0;
  RE_ENV_PAIR.lastIndex = 0;
  let hit = RE_ENV_PAIR.exec(text);
  while (hit) {
    const name = resolveKey(hit[1]);
    const value = (hit[2] != null ? hit[2] : hit[3] || '').trim();
    if (name && value) {
      map[name] = value;
      count += 1;
    }
    hit = RE_ENV_PAIR.exec(text);
  }
  return count ? map : null;
}

function envBump(tally, key, value) {
  let byValue = tally.get(key);
  if (!byValue) {
    byValue = new Map();
    tally.set(key, byValue);
  }
  byValue.set(value, (byValue.get(value) || 0) + 1);
}

// Một lượt quét duy nhất qua các dòng request. Sàng bằng indexOf trước: dòng payload dài mà chạy
// regex lên tất cả thì riêng mục này ăn hết phần lớn thời gian khởi động. Body chỉ đọc trên dòng
// RequestPayload — dòng ResponsePayload cũng có "--body:" nhưng không khai máy, đọc nó là mất công
// bóc một khối JSON to cho mỗi call.
function collectEnvHeaders(entries) {
  const tally = new Map();
  const bodyTally = new Map();
  const miniApps = new Map();
  let lineCount = 0;
  let bodyLineCount = 0;
  entries.forEach((entry) => {
    const raw = entry.raw;
    if (!raw) return;
    if (raw.indexOf('--header:') >= 0) {
      const map = parseEnvMap(raw, '--header:', envHeaderKey);
      if (map) {
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
      }
    }
    if (raw.indexOf('--body:') >= 0 && raw.indexOf('RequestPayload') >= 0) {
      const map = parseEnvMap(raw, '--body:', envBodyKey);
      if (map) {
        bodyLineCount += 1;
        Object.keys(map).forEach((key) => envBump(bodyTally, key, map[key]));
      }
    }
  });
  return { tally, bodyTally, miniApps, lineCount, bodyLineCount };
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

// Header đi trước, body chỉ ĐIỀN VÀO CHỖ TRỐNG — cố ý không cộng dồn hai bên: một dòng request mang
// cả body lẫn header, gộp lại là mỗi lần xuất hiện bị đếm hai lượt mà số lần đó có hiện ra trên panel.
// Cộng dồn còn xẻ một sự thật thành hai giá trị khi hai bên viết khác kiểu chữ (header "ANDROID",
// body "android").
function envPick(headers, key) {
  const fromHeader = envValues(headers.tally, key);
  return fromHeader.length ? fromHeader : envValues(headers.bodyTally, key);
}

function envTop(headers, key) {
  const list = envPick(headers, key);
  return list.length ? list[0].value : '';
}

function buildEnvironment(entries, httpCalls) {
  const headers = collectEnvHeaders(entries);

  const ua = envTop(headers, 'User-Agent') || envFirst(entries, RE_ENV_UA, 0);
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
  const deviceOs = envTop(headers, 'device_os') || envFirst(entries, RE_ENV_OS);
  // Nhãn hệ điều hành do đây dựng, không để renderer tự ghép chữ "iOS": ghép cứng ở đó thì log Android
  // hiện ra "iOS 9". Không đoán được phiên bản thì chỉ ghi tên hệ điều hành.
  const osLabel = iosDevice.osVersion ? 'iOS ' + iosDevice.osVersion
    : (androidHit ? 'Android ' + androidHit[1] : '');

  // Hai cái tên của cùng một cái máy: tên người đọc được ("Redmi Note 11") và mã máy trong
  // User-Agent ("2201117TG"). Giữ cả hai — tên để người đọc nhận ra, mã để tra cứu và để so với
  // những log khác. Chỉ giữ mã riêng khi nó KHÁC tên, không thì dòng "Thiết bị" lặp lại chính nó.
  const uaModel = iosDevice.device || (androidModel ? androidModel[1] : '');
  const namedDevice = envTop(headers, 'device-name');
  const appVersions = envPick(headers, 'app_code');

  const miniApps = Array.from(headers.miniApps, (pair) => ({
    appId: pair[0],
    versions: Array.from(pair[1], (item) => ({ value: item[0], count: item[1] }))
      .sort((a, b) => b.count - a.count),
    count: Array.from(pair[1].values()).reduce((sum, n) => sum + n, 0),
  })).sort((a, b) => b.count - a.count);

  return {
    // Rỗng hết thì tab không vẽ mục này — log production cắt giữa chừng có thể không có request nào.
    available: !!(parsed || hosts.size || headers.lineCount || headers.bodyLineCount),
    flavor,
    appVersion: (parsed ? parsed[2] : '') || envTop(headers, 'app_code'),
    appVersions,
    appBuild: envTop(headers, 'app_version'),
    cfNetwork: parsed ? parsed[3] : '',
    darwin: parsed ? parsed[4] : '',
    device: namedDevice || uaModel,
    deviceModel: namedDevice && uaModel && uaModel !== namedDevice ? uaModel : '',
    osVersion: iosDevice.osVersion,
    osLabel,
    deviceOs,
    performance: envTop(headers, 'device_performance') || envFirst(entries, RE_ENV_PERF),
    lang: envTop(headers, 'lang') || envTop(headers, 'M-Lang') || envFirst(entries, RE_ENV_LANG),
    timezone: envTop(headers, 'M-Timezone'),
    channel: envTop(headers, 'channel'),
    envName: envTop(headers, 'env') || envTop(headers, 'app_type'),
    deviceIds: envPick(headers, 'deviceid'),
    ips: envPick(headers, 'device-ip'),
    agentIds: envPick(headers, 'agent_id'),
    miniApps,
    headerLineCount: headers.lineCount,
    bodyLineCount: headers.bodyLineCount,
    hostCount: hosts.size,
    nonProdHosts,
    // Bản Staging/UAT mà lại gọi toàn host không có dấu hiệu uat/dev — gặp thật trên một log. Chỉ NÓI
    // RA sự thật quan sát được, không kết luận "log này là prod hay không": bản build và host là hai
    // chuyện khác nhau, và danh sách host ở đây chỉ gồm những host có request trong log.
    mixedBuild: RE_ENV_NONPROD_BUILD.test(flavor) && hosts.size > 0 && nonProdHosts.length === 0,
  };
}
