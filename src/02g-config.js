/*
File: src/02g-config.js
Created At: 2026-09-10 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — rut cac dong "config" ma app nhan tu BE / webadmin / CDN / A-B testing
//
// Vi sao tach rieng khoi buildIssueGroups: nhung dong nay deu o muc INFO nen khong bao gio loi qua
// nhom loi, va chung khong phai su kien nguoi dung nen khong vao hanh trinh. Chung tra loi mot cau
// khac han: "luc do may nay dang chay voi cau hinh gi".
//
// Nguon (source) KHONG suy doan: moi nhan duoi day deu doc duoc thang tu chinh dong log
// (chu "webadmin", url CDN, ten lop ABTesting...). Dong nao khong tu noi nguon thi vao nhom 'oth'
// chu khong doan bua.

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
// Kotlin/KMM in data class ra dang TenLop(a=1, b=2). Chi nhan khi TEN LOP co chu Config/Setting —
// khong the bat moi cap ngoac, gan nua dong log nao cung co ngoac.
const RE_CFG_DATA_CLASS = /([A-Z]\w*(?:Config|Setting)\w*)\((.{20,})\)\s*$/;
// Duong dan API co chu "config": xet tren path da bo query, vi query cua API khac cung co
// "displayConfig=" ma do khong phai API cau hinh.
const RE_CFG_URL = /config/i;

// Khong dat \b truoc "config": trong log chu nay hau het dinh lien voi tu khac (fetchConfig,
// getTabMeConfigBE, displayConfig) nen \b se truot het.
// Loai rieng dong tu "configure/configuring/configured" (dong bao da dung xong mot buoc, khong
// mang gia tri cau hinh nao); "configuration(s)" thi van nhan.
const RE_CFG_WORD = /config(?!ur(?:e|ing|ed)\b)|setting|feature.?flag|toggle|kill.?switch/i;
// Dong tu noi la nhan ve tu mot loi goi -> xep vao 'be'. Khong co dau hieu nay thi de 'oth'.
const RE_CFG_FROM_BE = /response|payload|fetched|downloaded/i;
const RE_CFG_BLOB = /[{[]/;
// Nam module nay deu da co cho rieng (tab HTTP, nhom loi Grafana, hanh trinh tracker; con MQTT va
// NOTIFICATION la ban tin day xuong chu khong phai cau hinh) — de chung vao day chi lam loang.
const RE_CFG_SKIP_MODULE = /^(HTTP|Grafana|MoMoTracker|MQTT|NOTIFICATION)/;

function cfgHit(source, key, value, note) {
  const trimmed = String(key).trim();
  if (!trimmed) return null;
  return { source, key: trimmed.slice(0, 90), value: String(value).trim(), note: note || '' };
}

// Cat duoi url lay ten file, vi chinh ten file moi la "khoa" cua cau hinh do.
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

// Luoi vet cuoi cung, co y hep: chu "config" phai nam TRUOC khoi JSON. Nho vay dong payload khuyen mai
// dai 5000 ky tu (mo dau bang "{", chu displayConfig nam sau do) khong bi keo vao day.
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
      group = { key: hit.key, source: hit.source, note: hit.note, count: 0, values: [] };
      groups.set(id, group);
    }
    group.count += 1;
    if (hit.note && !group.note) group.note = hit.note;
    // Chi ghi khi gia tri KHAC lan truoc. Nho vay values.length > 1 co dung mot nghia:
    // cau hinh nay doi giua chung phien — thu dang de y nhat khi "pha an".
    const last = group.values[group.values.length - 1];
    if (last && last.value === hit.value) return;
    group.values.push({
      value: hit.value,
      domIndex: entry.domIndex,
      lineNo: entry.lineNo,
      time: entry.time,
      // Xet tren GIA TRI chu khong phai ca dong: dong log nao cung co "[Module: X]" nen do tren
      // entry.raw thi hang nao cung moc ra nut JSON, bam vao lai chang co JSON nao.
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
  // Call BE co chu "config" tren duong dan: chinh no la cho app di XIN cau hinh. Cac dong nay nam o
  // module HTTP nen bi loai khoi vong quet ben tren; keo rieng ra day de tab tra loi duoc ca cau
  // "app xin cau hinh gi tu BE" chu khong chi "app nhan duoc gi".
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
// AI-GENERATED END
