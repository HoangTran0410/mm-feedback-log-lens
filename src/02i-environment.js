/*
File: src/02i-environment.js
Created At: 2026-09-11 02:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — doc "may nay la may gi, chay ban nao, noi vao dau" tu header cua request HTTP
//
// Vi sao lay tu header chu khong tu module DeviceProfileManager: dem tren ba log that,
// DeviceProfileManager co 27 / 9 / 0 dong — bang 0 tren log production. Con header User-Agent thi co
// 52 / 66 / 94 lan, va moi log chi co DUNG MOT gia tri. Day la nguon duy nhat tra loi duoc cau "may
// gi, iOS may, ban nao" tren ca log production.
//
// Dang that (da lam mo id): MoMoPlatform UAT/5.15.0.51500 CFNetwork/1410.1 Darwin/22.6.0
//                           (iPhone 8 Plus iOS/16.7.16) AgentID/<AN>

const RE_ENV_UA = /MoMoPlatform\s*([A-Za-z]*)\s*\/?([\d.]+)\s+CFNetwork\/([\d.]+)\s+Darwin\/([\d.]+)\s+\(([^)]*)\)/;
const RE_ENV_DEVICE = /^(.*?)\s+iOS\/([\d.]+)$/;
const RE_ENV_PERF = /device_performance[=:"\s]+([a-z-]{3,20})/;
const RE_ENV_OS = /device_os[=:"\s]+([A-Za-z0-9._ ]{2,30})/;
// Ky tu dong phai gom ca "}": tren log that lang nam giua map nen sau no la dau phay, nhung khi no la
// truong CUOI cua map thi sau no la dau dong ngoac.
const RE_ENV_LANG = /[",\s]lang[=:"\s]+([a-z]{2,5})[",\s}]/;
// Dau hieu KHONG phai production tren hostname. Khong lam danh sach host production: danh sach do se
// cu phai cap nhat, con dau hieu uat/dev/staging thi on dinh hon nhieu.
const RE_ENV_NONPROD_HOST = /(^|[.\-/])(uat|dev|staging|test|sandbox)([.\-:/]|$)/i;
// Tim DAU HIEU khong-production, khong phai "khac chu production". Ban production tren App Store ghi
// flavor la "Store" — coi moi thu khac chu "production" la dang ngo thi log that nao cung bi canh bao
// nham. Da dinh dung loi do khi test tren trang admin that.
const RE_ENV_NONPROD_BUILD = /^(uat|staging|dev|test|sandbox|alpha|beta|debug)$/i;

function envFirst(entries, re, group) {
  for (let i = 0; i < entries.length; i += 1) {
    const raw = entries[i].raw;
    if (!raw) continue;
    const hit = re.exec(raw);
    // group == null chu khong phai "group || 1": goi voi group = 0 (lay ca chuoi khop) thi 0 la falsy,
    // "0 || 1" ra 1 va ham tra ve nhom thu nhat. Da dinh dung bay nay.
    if (hit) return hit[group == null ? 1 : group];
  }
  return '';
}

// Ten may + phien ban iOS nam chung trong ngoac: "iPhone 8 Plus iOS/16.7.16".
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
    // Rong het thi tab khong ve muc nay — log production cat giua chung co the khong co request nao.
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
    // Ban Staging/UAT ma lai goi toan host khong co dau hieu uat/dev — gap that tren mot log. Chi NOI
    // RA su that quan sat duoc, khong ket luan "log nay la prod hay khong": ban build va host la hai
    // chuyen khac nhau, va danh sach host o day chi gom nhung host co request trong log.
    mixedBuild: RE_ENV_NONPROD_BUILD.test(flavor) && hosts.size > 0 && nonProdHosts.length === 0,
  };
}
// AI-GENERATED END
