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

// Nhớ luôn DÒNG NÀO đã cho ra giá trị này: có vậy thì rê chuột lên một giá trị mới chỉ được ra nó
// xuất hiện lúc nào trên minimap, và bấm vào mới duyệt được đúng những dòng đó. Lưu thẳng chỉ số chứ
// không quét lại lúc hover: hover bắn liên tục, mà quét lại là đi qua cả vạn dòng mỗi lần.
function envBump(tally, key, value, index) {
  let byValue = tally.get(key);
  if (!byValue) {
    byValue = new Map();
    tally.set(key, byValue);
  }
  let seen = byValue.get(value);
  if (!seen) {
    seen = { count: 0, indices: [] };
    byValue.set(value, seen);
  }
  seen.count += 1;
  seen.indices.push(index);
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
        Object.keys(map).forEach((key) => envBump(tally, key, map[key], entry.domIndex));
        // Cặp (miniapp, version) phải đọc TRONG CÙNG một dòng: gom riêng hai danh sách rồi ghép lại là
        // gán nhầm version của miniapp này cho miniapp kia.
        if (map.map_appId && map.map_miniAppVersion) {
          let versions = miniApps.get(map.map_appId);
          if (!versions) {
            versions = new Map();
            miniApps.set(map.map_appId, versions);
          }
          let seen = versions.get(map.map_miniAppVersion);
          if (!seen) {
            seen = { count: 0, indices: [] };
            versions.set(map.map_miniAppVersion, seen);
          }
          seen.count += 1;
          seen.indices.push(entry.domIndex);
        }
      }
    }
    if (raw.indexOf('--body:') >= 0 && raw.indexOf('RequestPayload') >= 0) {
      const map = parseEnvMap(raw, '--body:', envBodyKey);
      if (map) {
        bodyLineCount += 1;
        Object.keys(map).forEach((key) => envBump(bodyTally, key, map[key], entry.domIndex));
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
  return Array.from(byValue, (pair) => ({ value: pair[0], count: pair[1].count, indices: pair[1].indices }))
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

// Nhãn hệ điều hành dựng từ MỘT chuỗi User-Agent. Tách riêng vì còn phải chạy lên cả danh sách UA:
// log phủ cả tuần thì người dùng hoàn toàn có thể lên đời hệ điều hành giữa chừng.
function osLabelFromUa(ua) {
  const parsed = RE_ENV_UA.exec(ua || '');
  const ios = parseEnvDevice(parsed ? parsed[5] : '');
  if (ios.osVersion) return 'iOS ' + ios.osVersion;
  const android = RE_ENV_ANDROID.exec(ua || '');
  return android ? 'Android ' + android[1] : '';
}

// Gộp danh sách User-Agent lại theo nhãn hệ điều hành: cùng một Android 13 nhưng khác AgentID thì UA
// là hai chuỗi khác nhau — đo trên log thật có 8 chuỗi UA mà chỉ một hệ điều hành.
function envOsLabels(uaValues) {
  const byLabel = new Map();
  uaValues.forEach((item) => {
    const label = osLabelFromUa(item.value);
    if (!label) return;
    let seen = byLabel.get(label);
    if (!seen) {
      seen = { count: 0, indices: [] };
      byLabel.set(label, seen);
    }
    seen.count += item.count;
    // Gộp chỉ số của mọi chuỗi UA cùng nhãn, giữ đúng thứ tự dòng để vạch trên minimap không nhảy cóc.
    seen.indices = seen.indices.concat(item.indices);
  });
  return Array.from(byLabel, (pair) => ({ value: pair[0], count: pair[1].count,
    indices: pair[1].indices.slice().sort((a, b) => a - b) }))
    .sort((a, b) => b.count - a.count);
}

// Những trường ĐÁNG LẼ không đổi trong suốt một log. Đổi là có chuyện đáng kể ra, nên mỗi trường ở đây
// đều đi kèm câu nói rõ "đổi thì nghĩa là gì" — một danh sách trần không gắn với câu hỏi nào thì người
// đọc chỉ thấy hai dòng chữ mà không biết nên nghĩ gì.
//
// Cố ý KHÔNG đưa vào đây: map_screen_name (đổi theo từng request, đó là bản chất của nó, không phải
// "thay đổi"), map_appId / map_miniAppVersion (đã có mục MiniApp riêng, và nhiều miniapp là bình
// thường), User-Agent thô (8 chuỗi khác nhau trên log thật mà chỉ khác đuôi AgentID).
const ENV_WATCHED_FIELDS = [
  { key: 'device-name', label: 'Tên máy',
    tip: 'Hai tên máy trong cùng một log nghĩa là log đã bị trộn từ hai máy — mọi con số phía trên đang cộng của cả hai.' },
  { key: 'osLabel', label: 'Hệ điều hành',
    tip: 'Hệ điều hành lên đời giữa log. Lỗi chỉ xuất hiện ở một bên là một manh mối.' },
  { key: 'device_performance', label: 'Đời máy', scan: RE_ENV_PERF,
    tip: 'Đời máy đổi thì không còn là một máy nữa — cùng loại với việc đổi deviceid.' },
  { key: 'app_code', label: 'Bản app',
    tip: 'Người dùng nâng cấp app giữa log — mọi con số phía trên đang trộn hai bản.' },
  { key: 'lang', label: 'Ngôn ngữ', alt: ['M-Lang'], scan: RE_ENV_LANG,
    tip: 'Người dùng đổi ngôn ngữ app giữa chừng. Chữ trên màn và cả nội dung BE trả về đều đổi theo.' },
  { key: 'M-Timezone', label: 'Múi giờ',
    tip: 'Múi giờ đổi: người dùng đi vùng khác, tự sửa giờ máy, hoặc máy vừa đồng bộ lại giờ. Mọi mốc thời gian trong log đọc theo múi giờ này.' },
  { key: 'channel', label: 'Kênh',
    tip: 'Kênh gọi request đổi giữa chừng.' },
  { key: 'env', label: 'Môi trường', alt: ['app_type'],
    tip: 'Môi trường đổi giữa log (production ↔ uat) — app không được phép làm vậy trong một lần chạy.' },
  { key: 'agent_id', label: 'Agent ID',
    tip: 'Nhiều agent_id: người dùng đăng nhập tài khoản khác, hoặc log gộp nhiều người.' },
  { key: 'deviceid', label: 'Device ID',
    tip: 'deviceid đổi nghĩa là log đã bị trộn từ hai máy.' },
  { key: 'device-ip', label: 'IP',
    tip: 'IP đổi giữa chừng = đổi mạng (wifi sang 4G, hoặc đổi wifi).' },
];

function buildEnvironment(entries, httpCalls) {
  const headers = collectEnvHeaders(entries);

  const ua = envTop(headers, 'User-Agent') || envFirst(entries, RE_ENV_UA, 0);
  const parsed = ua ? RE_ENV_UA.exec(ua) : null;
  const iosDevice = parseEnvDevice(parsed ? parsed[5] : '');
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
  const osLabels = envOsLabels(envPick(headers, 'User-Agent'));
  const osLabel = osLabelFromUa(ua) || (osLabels.length ? osLabels[0].value : '');

  // Hai cái tên của cùng một cái máy: tên người đọc được ("Redmi Note 11") và mã máy trong
  // User-Agent ("2201117TG"). Giữ cả hai — tên để người đọc nhận ra, mã để tra cứu và để so với
  // những log khác. Chỉ giữ mã riêng khi tên CHƯA CHỨA nó: có log ghi device-name là "Oppo CPH2083"
  // còn User-Agent ghi "CPH2083", hiện cả hai thì ra "Oppo CPH2083 (CPH2083)".
  const uaModel = iosDevice.device || (androidModel ? androidModel[1] : '');
  const namedDevice = envTop(headers, 'device-name');
  const modelIsNew = !!uaModel && namedDevice.toLowerCase().indexOf(uaModel.toLowerCase()) < 0;
  const appVersions = envPick(headers, 'app_code');

  const miniApps = Array.from(headers.miniApps, (pair) => ({
    appId: pair[0],
    versions: Array.from(pair[1], (item) => ({ value: item[0], count: item[1].count }))
      .sort((a, b) => b.count - a.count),
    indices: Array.from(pair[1].values()).reduce((all, item) => all.concat(item.indices), [])
      .sort((a, b) => a - b),
    count: Array.from(pair[1].values()).reduce((sum, item) => sum + item.count, 0),
  })).sort((a, b) => b.count - a.count);

  // Mỗi trường đáng theo dõi kèm mọi giá trị của nó. Renderer chỉ cần một luật: đúng một giá trị thì
  // để trong bảng, từ hai trở lên thì tách thành danh sách — không phải nhớ tên từng trường nữa.
  // `alt` và `scan` là những đường dự phòng vốn có của từng trường, đừng bỏ khi gom về một cơ chế:
  // không có header thì `lang` còn đọc được từ chữ trong dòng log, `env` còn có `app_type`.
  const watchedValues = (field) => {
    if (field.key === 'osLabel') return osLabels;
    let values = envPick(headers, field.key);
    (field.alt || []).forEach((key) => {
      if (!values.length) values = envPick(headers, key);
    });
    if (!values.length && field.scan) {
      const hit = envFirst(entries, field.scan);
      // Đường quét bằng regex chỉ trả về giá trị ĐẦU TIÊN gặp, nên không đếm được số lần — và cũng
      // không dùng để nói "đổi giữa chừng", nó luôn là một giá trị.
      if (hit) values = [{ value: hit, count: 1, indices: [] }];
    }
    return values;
  };
  const watched = ENV_WATCHED_FIELDS
    .map((field) => Object.assign({}, field, { values: watchedValues(field) }))
    .filter((field) => field.values.length);

  return {
    watched,
    // Những trường đổi giữa chừng, để ticket nói ra được mà không phải kể lại cả bảng.
    changed: watched.filter((field) => field.values.length > 1),
    // Rỗng hết thì tab không vẽ mục này — log production cắt giữa chừng có thể không có request nào.
    // watched.length cũng tính: log không có request HTTP nào vẫn có thể khai máy trong chữ của chính
    // dòng log (DeviceProfileManager), và mấy đường quét dự phòng sinh ra là để đọc đúng ca đó.
    available: !!(parsed || hosts.size || headers.lineCount || headers.bodyLineCount || watched.length),
    flavor,
    appVersion: (parsed ? parsed[2] : '') || envTop(headers, 'app_code'),
    appVersions,
    appBuild: envTop(headers, 'app_version'),
    cfNetwork: parsed ? parsed[3] : '',
    darwin: parsed ? parsed[4] : '',
    device: namedDevice || uaModel,
    deviceModel: namedDevice && modelIsNew ? uaModel : '',
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
