// @ts-check
// rút các dòng "config" mà app nhận từ BE / webadmin / CDN / A-B testing
//
// Vì sao tách riêng khỏi buildIssueGroups: những dòng này đều ở mức INFO nên không bao giờ lọt qua
// nhóm lỗi, và chúng không phải sự kiện người dùng nên không vào hành trình. Chúng trả lời một câu
// khác hẳn: "lúc đó máy này đang chạy với cấu hình gì".
//
// Nguồn (source) KHÔNG suy đoán: mọi nhãn dưới đây đều đọc được thẳng từ chính dòng log
// (chữ "webadmin", url CDN, tên lớp ABTesting...). Dòng nào không tự nói nguồn thì vào nhóm 'oth'
// chứ không đoán bừa.

const CONFIG_SOURCE_ORDER = ['ab', 'be', 'wa', 'cdn', 'app', 'oth'];
const CONFIG_SOURCE_META = {
  ab: {
    label: 'A/B testing',
    hint: 'Nhánh máy này rơi vào — hai máy khác nhánh chạy hai đoạn code khác nhau. ' +
      '<code>DEFAULT_GROUP</code> = không nằm trong thí nghiệm.',
  },
  be: {
    label: 'BE trả về',
    hint: 'Dòng log tự nói là nhận từ server.',
  },
  wa: {
    label: 'Webadmin',
    hint: 'Feature và giá trị webadmin đẩy xuống.',
  },
  cdn: {
    label: 'File JSON trên CDN',
    hint: 'Cấu hình dạng file tĩnh. Muốn xem nội dung thì mở url.',
  },
  app: {
    label: 'App đã áp dụng',
    hint: 'Giá trị app tự ghi sau khi dựng xong — so với khối "BE trả về" xem có khớp không.',
  },
  oth: {
    label: 'Chưa rõ nguồn',
    hint: 'Tự gọi mình là config nhưng không nói lấy từ đâu.',
  },
};

const RE_CFG_AB_TAG =
  /ABTestingExpTag\(namespace=([^,)]*),\s*exp_definition=([^,)]*),\s*exp_name=([^,)]*),\s*tag=([^,)]*)/;
const RE_CFG_AB_FLOW = /-\s*defaultFlow:\s*(\S+)/;
const RE_CFG_AB_AUTH = /ABTest tag for namespace (\S+)\s*=>\s*(\S+)/;
const RE_CFG_AB_FULLSCREEN = /resolveFullscreenAbTag\s*::\s*tagName=(\S+) for nameSpace=(\S+)/;
const RE_CFG_PERSIST = /\bPersist\s+(\S+)\s+key=(\S+)\s+raw=([\s\S]+)$/;
const RE_CFG_WEBADMIN = /webadmin config\s+(\S+)\s*([\s\S]*)$/;
const RE_CFG_CDN = /configs\s*>>\s*fetchConfig\s*>>\s*url:\s*(\S+)/;
const RE_CFG_DYNA_KEYS = /@@DynamicConfig\s*::\s*Transformed config for (\S+) with (\d+) namespaced keys/;
const RE_CFG_DYNA_BODY = /@@DynamicConfig\s*::\s*responseBody:\s*([\s\S]+)$/;
const RE_CFG_FEATURE_CONF = /getFeatureConfigurations\(\)\]\s*Config\s*->\s*([\s\S]+)$/;
const RE_CFG_OMEGA = /OMEGA FEATURE TESTINGS LIST CODE:\s*([\s\S]+)$/;
const RE_CFG_SENTRY_KMP = /@@SentryKMP\s*::\s*(.+?)\s+(\w+=[\s\S]+)$/;
const RE_CFG_SPAM = /(ApiSpamDetector):\s*Config:\s*([\s\S]+)$/;
const RE_CFG_AUTH_BG = /(AuthenticationBackgroundConfigApi)\s*>>\s*fetchConfig\s*>>\s*loaded\s+([\s\S]+)$/;
// Kotlin/KMM in data class ra dạng TenLop(a=1, b=2). Chỉ nhận khi TÊN LỚP có chữ Config/Setting —
// không thể bắt mọi cặp ngoặc, gần nửa dòng log nào cũng có ngoặc.
const RE_CFG_DATA_CLASS = /([A-Z]\w*(?:Config|Setting)\w*)\((.{20,})\)\s*$/;
// Đường dẫn API có chữ "config": xét trên path đã bỏ query, vì query của API khác cũng có
// "displayConfig=" mà đó không phải API cấu hình.
const RE_CFG_URL = /config/i;

// Không đặt \b trước "config": trong log chữ này hầu hết dính liền với từ khác (fetchConfig,
// getTabMeConfigBE, displayConfig) nên \b sẽ trượt hết.
// Loại riêng động từ "configure/configuring/configured" (dòng báo đã dùng xong một bước, không
// mang giá trị cấu hình nào); "configuration(s)" thì vẫn nhận.
const RE_CFG_WORD = /config(?!ur(?:e|ing|ed)\b)|setting|feature.?flag|toggle|kill.?switch/i;
// Động từ nói là nhận về từ một lời gọi -> xếp vào 'be'. Không có dấu hiệu này thì để 'oth'.
const RE_CFG_FROM_BE = /response|payload|fetched|downloaded/i;
const RE_CFG_BLOB = /[{[]/;
// Năm module này đều đã có chỗ riêng (tab HTTP, nhóm lỗi Grafana, hành trình tracker; còn MQTT và
// NOTIFICATION là bản tin đẩy xuống chứ không phải cấu hình) — để chúng vào đây chỉ làm loãng.
const RE_CFG_SKIP_MODULE = /^(HTTP|Grafana|MoMoTracker|MQTT|NOTIFICATION)/;

function cfgHit(source, key, value, note) {
  const trimmed = String(key).trim();
  if (!trimmed) return null;
  return { source, key: trimmed.slice(0, 90), value: String(value).trim(), note: note || '' };
}

// Cắt đuôi url lấy tên file, vì chính tên file mới là "khoá" của cấu hình đó.
function cdnConfigName(url) {
  const clean = url.split('?')[0].replace(/\/+$/, '');
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  return name || clean;
}

function matchConfigSpecific(message) {
  const abTag = RE_CFG_AB_TAG.exec(message);
  if (abTag) {
    const flow = RE_CFG_AB_FLOW.exec(message);
    const expName = abTag[3].trim();
    const note = (expName ? 'exp ' + expName : 'không nằm trong thí nghiệm') +
      (flow ? ' · nhánh mặc định ' + flow[1] : '');
    return cfgHit('ab', abTag[1], abTag[4], note);
  }
  const abAuth = RE_CFG_AB_AUTH.exec(message);
  if (abAuth) return cfgHit('ab', abAuth[1], abAuth[2], '');
  const abFull = RE_CFG_AB_FULLSCREEN.exec(message);
  if (abFull) return cfgHit('ab', abFull[2], abFull[1], '');

  const persist = RE_CFG_PERSIST.exec(message);
  if (persist) return cfgHit('be', persist[2], persist[3], persist[1]);

  const webadmin = RE_CFG_WEBADMIN.exec(message);
  if (webadmin) return cfgHit('wa', webadmin[1], webadmin[2] || '(rỗng)', '');

  const cdn = RE_CFG_CDN.exec(message);
  if (cdn) return cfgHit('cdn', cdnConfigName(cdn[1]), cdn[1], '');

  const dynaKeys = RE_CFG_DYNA_KEYS.exec(message);
  if (dynaKeys) return cfgHit('be', 'DynamicConfig ' + dynaKeys[1], dynaKeys[2] + ' khóa', '');
  const dynaBody = RE_CFG_DYNA_BODY.exec(message);
  if (dynaBody) return cfgHit('be', 'DynamicConfig responseBody', dynaBody[1], '');

  const featureConf = RE_CFG_FEATURE_CONF.exec(message);
  if (featureConf) return cfgHit('wa', 'AppFeatureUpdater', featureConf[1], '');
  const omega = RE_CFG_OMEGA.exec(message);
  if (omega) {
    const codes = omega[1].split(/\s+-\s+/).filter((part) => part.trim());
    return cfgHit('wa', 'OMEGA feature testings', omega[1], codes.length + ' feature');
  }

  const sentry = RE_CFG_SENTRY_KMP.exec(message);
  if (sentry) return cfgHit('app', 'SentryKMP ' + sentry[1], sentry[2], '');
  const spam = RE_CFG_SPAM.exec(message);
  if (spam) return cfgHit('app', spam[1], spam[2], '');
  const authBg = RE_CFG_AUTH_BG.exec(message);
  if (authBg) return cfgHit('be', authBg[1], authBg[2], '');

  const dataClass = RE_CFG_DATA_CLASS.exec(message);
  if (dataClass) {
    const head = message.slice(0, dataClass.index);
    return cfgHit(RE_CFG_FROM_BE.test(head) ? 'be' : 'oth', dataClass[1], dataClass[2], '');
  }
  return null;
}

// Lưới vét cuối cùng, cố ý hẹp: chữ "config" phải nằm TRƯỚC khối JSON. Nhờ vậy dòng payload khuyến mãi
// dài 5000 ký tự (mở đầu bằng "{", chữ displayConfig nằm sau đó) không bị kéo vào đây.
function matchConfigGeneric(message) {
  const blob = message.search(RE_CFG_BLOB);
  if (blob < 0) return null;
  const head = message.slice(0, blob);
  if (!RE_CFG_WORD.test(head)) return null;
  const value = message.slice(blob);
  if (value.length < 20) return null;
  const key = head.replace(/[\s:=>|-]+$/, '');
  const source = RE_CFG_FROM_BE.test(head) ? 'be' : 'oth';
  return cfgHit(source, key, value, '');
}

function matchConfigLine(entry) {
  if (!entry.message || entry.kind !== 'log') return null;
  if (RE_CFG_SKIP_MODULE.test(entry.module || '')) return null;
  return matchConfigSpecific(entry.message) || matchConfigGeneric(entry.message);
}

function buildConfigs(entries, httpCalls) {
  const groups = new Map();
  let lineCount = 0;
  entries.forEach((entry) => {
    const hit = matchConfigLine(entry);
    if (!hit) return;
    lineCount += 1;
    const id = hit.source + ' ' + hit.key;
    let group = groups.get(id);
    if (!group) {
      group = { key: hit.key, source: hit.source, note: hit.note, count: 0, values: [], indices: [] };
      groups.set(id, group);
    }
    group.count += 1;
    group.indices.push(entry.domIndex);
    if (hit.note && !group.note) group.note = hit.note;
    // Chỉ ghi khi giá trị KHÁC lần trước. Nhờ vậy values.length > 1 có đúng một nghĩa:
    // cấu hình này đổi giữa chừng phiên — thứ đáng để ý nhất khi "phá án".
    // Nhưng vẫn phải gom ĐỦ chỉ số dòng của mọi giá trị: một khoá ghi 4 lần cùng một giá trị thì
    // vẫn là 4 dòng log có thật, phải duyệt được cả bốn chứ không chỉ nhảy tới dòng đầu.
    const last = group.values[group.values.length - 1];
    if (last && last.value === hit.value) {
      last.indices.push(entry.domIndex);
      return;
    }
    group.values.push({
      value: hit.value,
      indices: [entry.domIndex],
      domIndex: entry.domIndex,
      lineNo: entry.lineNo,
      time: entry.time,
      // Xét trên GIÁ TRỊ chứ không phải cả dòng: dòng log nào cũng có "[Module: X]" nên đo trên
      // entry.raw thì hàng nào cũng mọc ra nút JSON, bấm vào lại chẳng có JSON nào.
      hasJson: RE_CFG_BLOB.test(hit.value),
    });
  });

  const items = Array.from(groups.values());
  items.forEach((item) => {
    item.changed = item.values.length > 1;
    item.latest = item.values[item.values.length - 1];
  });
  items.sort((a, b) => {
    if (a.changed !== b.changed) return a.changed ? -1 : 1;
    const order = CONFIG_SOURCE_ORDER.indexOf(a.source) - CONFIG_SOURCE_ORDER.indexOf(b.source);
    if (order) return order;
    return a.key.localeCompare(b.key);
  });

  const bySource = {};
  CONFIG_SOURCE_ORDER.forEach((source) => {
    bySource[source] = items.filter((item) => item.source === source);
  });
  // Call BE có chữ "config" trên đường dẫn: chính nó là chỗ app đi XIN cấu hình. Các dòng này nằm ở
  // module HTTP nên bị loại khỏi vòng quét bên trên; kéo riêng ra đây để tab trả lời được cả câu
  // "app xin cấu hình gì từ BE" chứ không chỉ "app nhận được gì".
  const calls = (httpCalls || []).filter((call) => RE_CFG_URL.test(call.path || ''));
  return {
    items,
    bySource,
    calls,
    total: items.length,
    lineCount,
    changedCount: items.filter((item) => item.changed).length,
    hasAny: items.length > 0 || calls.length > 0,
  };
}
