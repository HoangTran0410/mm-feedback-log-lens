/*
File: src/02c-journey.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — dung lai thao tac cua user tu event MoMoTracker
// Tach ra tu src/02-insights.js (946 dong). Cac file src/*.js duoc build.sh noi lai theo thu tu
// ten file va boc trong MOT IIFE nen van dung chung scope — tach chi de doc.

/* ---------------------------------------------- hanh trinh tuong tac cua user */

// Moi dong MoMoTracker deu ghi o muc INFO nen khong dong nao lot vao buildIssueGroups: nhung gi user
// THAY va CHAM hoan toan vo hinh voi phan gom nhom loi. Do tren log that (33112319): 955 dong tracker,
// 46 loai event, trong do popup "MAX-API SPAM DETECTED" dap vao mat user 5 lan ma khong kem mot ERROR nao.
// Log ghi lap: nhieu event tracker xuat hien 2 dong giong het nhau. Do tren log that (78 cap trung
// noi dung), khoang cach chia lam hai cum tach bach — mot cum 0..~1.1s (ghi lap) va mot cum tu 70s tro
// len (user lam lai that su o phien sau). Chon 1000ms nam giua hai cum: tha dem du con hon gop nham
// hai lan bam that thanh mot, vi "user bam lai vi app khong phan hoi" chinh la thu can nhin thay.
const JOURNEY_MERGE_WINDOW_MS = 1000;
const JOURNEY_KINDS = ['screen', 'tap', 'saw', 'move', 'fail'];
const JOURNEY_KIND_LABEL = {
  screen: 'Màn hình', tap: 'Chạm', saw: 'User thấy', move: 'Đổi luồng', fail: 'API fail',
};

// Tracker ghi thang chuoi "null"/"" cho truong rong; de nguyen thi nhan hien ra la chu "null".
function journeyValue(raw) {
  const text = raw == null ? '' : String(raw).trim();
  return text === 'null' || text === 'undefined' || text === '{}' || text === '[]' ? '' : text;
}

function journeyParts(list) {
  return list.map(journeyValue).filter(Boolean).join(' · ');
}

function journeyMs(raw) {
  const ms = Number(journeyValue(raw));
  return Number.isFinite(ms) && ms > 0 && ms <= MAX_PLAUSIBLE_DURATION_MS ? Math.round(ms) : 0;
}

// detail = boi canh ON DINH cua buoc (man hinh, service) — dung de gom nhom va so sanh khi gop.
// note   = so do RIENG cua lan do (duration, dwell_time) — chi hien tren dong hanh trinh.
// Tach hai thu nay ra vi neu tron chung thi hai lan cung mot loi chi khac 1ms duration se bi coi la
// hai thu khac nhau, va nhan nhom se mat sach phan errorCode.
// Bang duy nhat quyet dinh event nao vao hanh trinh. Tra null = bo qua (impression, ops_request_be,
// trail_*, sync_* ... khong phai thao tac cua user). Co y KHONG lay roothome_component_impressed (76),
// service_component_displayed (41), roothome_block_viewed (33): do la cai man hinh ve ra, khong phai
// cai user lam, va so luong cua chung se nhan chim phan con lai.
// Lay nguyen van tu AppEvent.FeatureMiniAppLoad.Stage (momo-app). Chi giu nhung stage bao hieu
// user nhin thay mot man hinh/toast/popup — cac stage do luong khac khong vao hanh trinh.
const MINIAPP_FAIL_STAGES = {
  scr_fail_loading_miniapp: 'màn hình lỗi tải miniapp',
  toast_fail_loading_miniapp: 'toast lỗi tải miniapp',
  miniapp_web_js_crash: 'miniapp crash JS',
  pu_waiting_load_bundle: 'popup chờ tải bundle',
  pu_version_update: 'popup bắt cập nhật app',
  pu_recording: 'popup đang ghi màn hình',
};

// Quy tac dat nhan: lay truong dau tien KHONG rong, xep theo "cang rieng cho buoc nay va cang giong
// thu user nhin thay thi cang uu tien". Ba bac:
//   1. Chu user THAT SU doc duoc tren man: title, button_name, item_title
//   2. Ten thanh phan do dev dat: component_name, popup_name, duoi cua component_id
//   3. Boi canh rong hon: feature_code, service_name
// Bac 3 khong bao gio nen dung mot minh o cho khac, vi mot feature_code co hang chuc popup; nhung khi
// hai bac tren deu rong thi no van hon chu "popup" tron — it ra con biet popup do thuoc cho nao.
// Vi sao can: tren log that co popup ghi title=null, nhan ra dung chu "popup", nen hai popup khac han
// nhau bi gom thanh mot hang "2x popup" ma khong con gi de phan biet.
const JOURNEY_LABEL_MAX = 48;

function pickJourneyLabel(candidates, fallback) {
  for (let i = 0; i < candidates.length; i += 1) {
    const value = journeyValue(candidates[i]);
    if (!value) continue;
    // component_id la duong dan "<appId>/<feature>/<screen>/Popup/<ten>" — chi doan cuoi moi la ten.
    const tail = value.indexOf('/') >= 0 ? value.slice(value.lastIndexOf('/') + 1).trim() : value;
    const name = tail || value;
    return name.length > JOURNEY_LABEL_MAX ? name.slice(0, JOURNEY_LABEL_MAX - 1) + '…' : name;
  }
  return fallback;
}

// momoClassDiscriminator la ten LOP day du cua event, duoi cua no la ten be mat that su hien ra.
// Vi sao can: tren log that co hai man deu ghi screen_name=result nhung la hai lop khac han —
// TransactionResultRevampScreenDisplayed va TransactionResultWidgetDisplayed — nen chung bi gom lam
// mot hang, mat sach cai de phan biet.
//
// NHUNG khong duoc dung bua: cung tren log that, mot log co 64 dong mang discriminator ma TAT CA deu
// la "PromotionEventParams" — do la lop chua THAM SO, khong phai ten man. Lay bua thi moi man deu bi
// dat ten "PromotionEventParams".
// Vi vay chi nhan lop nao ket thuc bang Displayed / Interacted / Viewed: do la lop mo ta mot be mat
// vua hien ra. Do tren 10 duoi lop khac nhau quan sat duoc o hai log: 7 cai khop deu la ten be mat
// that, 3 cai khong khop (PromotionEventParams, CheckoutRequested, CheckoutResponse) deu khong phai.
// CHUA XAC MINH tren dai lop rong hon — moi co hai log mang truong nay.
const RE_JOURNEY_SURFACE = /(Displayed|Interacted|Viewed)$/;

function journeySurfaceName(params) {
  const full = journeyValue(params.momoClassDiscriminator);
  if (!full) return '';
  const tail = full.slice(full.lastIndexOf('.') + 1);
  if (!RE_JOURNEY_SURFACE.test(tail)) return '';
  // Bo duoi mo ta hanh dong roi bo not chu "Screen" con thua: TransactionResultRevampScreenDisplayed
  // -> TransactionResultRevamp, con TransactionResultWidgetDisplayed -> TransactionResultWidget.
  return tail.replace(RE_JOURNEY_SURFACE, '').replace(/Screen$/, '');
}

// Ten man = ten man hinh + ten be mat (neu doc duoc). Hai thu nay khac cap do chi tiet nen noi bang
// dau cham giua, khong tron lam mot.
function journeyScreenLabel(params, fallback) {
  const base = journeyValue(params.screen_name) || fallback || '';
  const surface = journeySurfaceName(params);
  if (!surface) return base;
  return base ? base + ' · ' + surface : surface;
}

function pickJourneyStep(event, params) {
  const screen = journeyValue(params.screen_name);
  if (event === 'auto_screen_navigated') {
    const from = journeyValue(params.pre_screen_name);
    return { kind: 'screen', label: screen || journeyValue(params.feature_code),
      detail: journeyParts([from ? from + ' → ' + (screen || '?') : screen, params.action]) };
  }
  if (event === 'auto_screen_displayed' || event === 'service_screen_displayed' ||
    event === 'service_screen_viewed' || event === 'roothome_screen_displayed') {
    const load = journeyMs(params.duration);
    return { kind: 'screen', label: journeyScreenLabel(params, journeyValue(params.service_name)),
      detail: journeyParts([params.service_name, params.status]),
      note: load ? 'load ' + formatDuration(load) : '' };
  }
  if (event === 'feature_source') {
    const from = journeyValue(params.from);
    const to = journeyValue(params.to);
    if (!from && !to) return null;
    return { kind: 'move', label: (from || '?') + ' → ' + (to || '?'), detail: journeyValue(params.action) };
  }
  if (event === 'service_button_clicked') {
    return { kind: 'tap', label: journeyValue(params.button_name) || 'button',
      detail: journeyParts([params.screen_name, params.service_name]) };
  }
  if (event === 'auto_button_clicked') {
    // component_id = "<appId>/<feature>/<screen>/Button/<nhan tieng Viet dung nhu user nhin thay>".
    const id = journeyValue(params.component_id);
    return { kind: 'tap', label: (id ? id.slice(id.lastIndexOf('/') + 1) : journeyValue(params.component_name)) || 'button',
      detail: journeyParts([params.screen_name, params.action]) };
  }
  if (event === 'service_component_clicked') {
    return { kind: 'tap', label: journeyValue(params.component_name) || 'component',
      detail: journeyParts([params.screen_name, params.component_type]) };
  }
  if (event === 'roothome_component_clicked') {
    const dwell = journeyMs(params.dwell_time);
    return { kind: 'tap',
      label: journeyValue(params.button_name) || journeyValue(params.component_name) ||
        journeyValue(params.service) || 'component',
      detail: journeyParts([params.item_title, params.block]),
      note: dwell ? 'đứng ' + formatDuration(dwell) : '' };
  }
  if (event === 'roothome_screen_scrolled') {
    const dwell = journeyMs(params.dwell_time);
    return { kind: 'tap', label: 'cuộn ' + (screen || 'home'), detail: '',
      note: dwell ? 'đứng ' + formatDuration(dwell) : '' };
  }
  if (event === 'auto_popup_displayed') {
    return { kind: 'saw',
      label: 'popup ' + pickJourneyLabel([params.title, params.component_name, params.component_id,
        params.desc, params.feature_code], '?'),
      detail: journeyParts([params.screen_name, params.feature_code, params.desc]) };
  }
  if (event === 'service_popup_displayed') {
    return { kind: 'saw',
      label: 'popup ' + pickJourneyLabel([params.popup_name, params.title, params.component_name,
        params.service_name], '?'),
      detail: journeyParts([params.screen_name, params.service_name]) };
  }
  if (event === 'auto_bottomsheet_displayed') {
    return { kind: 'saw',
      label: 'sheet ' + pickJourneyLabel([params.title, params.component_name, params.component_id,
        params.feature_code], '?'),
      detail: journeyParts([params.screen_name, params.feature_code]) };
  }
  // Ten stage lay tu AppEvent.FeatureMiniAppLoad.Stage trong source app, khong phai doan tu log.
  // Day la nhung stage ma user THAY: man loi, toast loi, popup. Chung ghi o muc INFO nhu moi event
  // tracker khac nen phan gom nhom loi khong dem duoc.
  // Do tren hai log thu: ca hai deu 0 lan — hai log do khong gap su co tai miniapp, khong phai sai ten.
  if (event === 'feature_miniapp_load') {
    const stage = journeyValue(params.stage);
    const seen = MINIAPP_FAIL_STAGES[stage];
    if (!seen) return null;
    return { kind: 'saw', label: seen,
      detail: journeyParts([params.app_id, params.feature_code]),
      note: journeyValue(params.error_message) || journeyValue(params.error_code) };
  }
  if (event === 'service_screenshot') {
    return { kind: 'saw', label: 'user chụp màn hình',
      detail: journeyParts([params.screen_name, params.service_name]) };
  }
  // ops_receive_be la ket qua call BE do chinh tracker ghi, co san status/error_code/duration.
  // Chi lay ban fail: 45/307 tren log that, va tab HTTP khong thay het so nay vi no doc dong [Method:].
  if (event === 'ops_receive_be') {
    if (journeyValue(params.status) !== 'fail') return null;
    const code = journeyValue(params.error_code);
    const api = journeyValue(params.api) || journeyValue(params.api_path) || 'API';
    // errorCode vao NHAN chu khong vao detail: cung mot api fail voi hai ma khac nhau la hai chuyen
    // khac nhau, gom chung mot dong se giau mat ma loi.
    return { kind: 'fail', label: code ? api + ' · ' + code : api,
      detail: journeyParts([params.error_message, params.screen_name]),
      note: journeyMs(params.duration) ? formatDuration(journeyMs(params.duration)) : '' };
  }
  return null;
}

function groupJourneySteps(steps, kind) {
  const map = new Map();
  steps.forEach((step) => {
    if (step.kind !== kind) return;
    let row = map.get(step.label);
    if (!row) {
      row = { key: step.label, count: 0, ms: 0, maxMs: 0, indices: [], detail: step.detail,
        firstTs: step.ts, lastTs: step.ts };
      map.set(step.label, row);
    }
    // Dem SO THAO TAC (so buoc da gop), khong phai so dong log — de con so o day khop voi the thong ke
    // dau tab. So dong tho van con nguyen trong row.indices de duyet tung dong.
    row.count += 1;
    // ms la TONG cua moi lan vao man do; maxMs la lan lau nhat. Chi hien tong ma de canh "2x" thi
    // nguoi doc de tuong 2 lan moi lan bang tung do.
    row.ms += step.ms;
    if (step.ms > row.maxMs) row.maxMs = step.ms;
    step.indices.forEach((domIndex) => row.indices.push(domIndex));
    // Nhieu buoc cung nhan nhung khac boi canh (nut "transfer" o bill_detail va o detail_input):
    // giu detail cua buoc dau cho ca nhom la noi sai. Chi giu khi moi buoc deu giong nhau.
    if (row.detail !== step.detail) row.detail = '';
    if (step.ts && (!row.firstTs || step.ts < row.firstTs)) row.firstTs = step.ts;
    if (step.lastTs && (!row.lastTs || step.lastTs > row.lastTs)) row.lastTs = step.lastTs;
  });
  return Array.from(map.values());
}

// Gop cac buoc LIEN TIEP y het nhau va sat nhau ve thoi gian thanh mot buoc mang count.
// Khong xoa dong nao: indices giu du ca N dong de van nhay duoc toi tung dong trong bang log.
function mergeAdjacentJourneySteps(steps) {
  const merged = [];
  steps.forEach((step) => {
    const last = merged[merged.length - 1];
    // Buoc 'fail' KHONG gop: moi call BE da co trace_id rieng va da khu trung chinh xac theo do.
    // Hai call that su khac nhau cach nhau vai tram ms la chuyen binh thuong — gop thi so o day
    // se lech voi so call fail dem duoc tu trace_id.
    if (step.kind !== 'fail' &&
      last && last.kind === step.kind && last.label === step.label && last.detail === step.detail &&
      step.ts && last.lastTs && step.ts - last.lastTs <= JOURNEY_MERGE_WINDOW_MS) {
      last.count += 1;
      last.lastTs = step.ts;
      last.indices.push(step.domIndex);
      return;
    }
    // PHAI mang theo session: thieu no thi guard "khong do vat qua hai phien app" o duoi so
    // undefined === undefined, tuc luon dung, tuc guard do chua bao gio chay.
    merged.push({ kind: step.kind, label: step.label, detail: step.detail, note: step.note,
      event: step.event, ts: step.ts, lastTs: step.ts, domIndex: step.domIndex, session: step.session,
      indices: [step.domIndex], count: 1, ms: 0 });
  });
  return merged;
}

// Thoi gian TAI mot man, khac han "o lau tren man" (dwell): day la so co san trong log
// (auto_screen_displayed.duration khi state=load, va auto_load_progress_tracked.duration),
// khong phai so tinh ra. Tab Cham von gom moi "duration=" vao mot ro ma khong gan voi man nao.
function buildScreenLoads(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    if (!entry.eventParams) return;
    if (entry.event !== 'auto_screen_displayed' && entry.event !== 'auto_load_progress_tracked') return;
    const params = entry.eventParams;
    if (entry.event === 'auto_screen_displayed' && journeyValue(params.state) !== 'load') return;
    const ms = journeyMs(params.duration);
    if (!ms) return;
    const key = journeyValue(params.screen_name) || journeyValue(params.end_point) ||
      journeyValue(params.feature_code);
    if (!key) return;
    let row = map.get(key);
    if (!row) {
      row = { key, count: 0, worstMs: 0, totalMs: 0, indices: [], sources: new Set() };
      map.set(key, row);
    }
    row.count += 1;
    row.totalMs += ms;
    if (ms > row.worstMs) row.worstMs = ms;
    row.indices.push(entry.domIndex);
    row.sources.add(entry.event);
  });
  return Array.from(map.values())
    .map((row) => ({ key: row.key, count: row.count, worstMs: row.worstMs,
      avgMs: Math.round(row.totalMs / row.count), indices: row.indices,
      sources: Array.from(row.sources) }))
    .sort((a, b) => b.worstMs - a.worstMs);
}

// Thoi gian "o tren man" khong duoc tinh ca luc app nam duoi nen. Do that: mot man bao 7m08s trong khi
// 3m52s trong so do la luc user roi han app — 88% con so la thu khong ai nhin. Tool da tinh san cac
// khoang do cho the thong ke o Tong quan, chi la chua tru o day.
function subtractBackground(fromTs, toTs, backgrounds) {
  let overlap = 0;
  backgrounds.forEach((gap) => {
    const start = Math.max(fromTs, gap.downTs || gap.before.ts);
    const end = Math.min(toTs, gap.upTs || gap.after.ts);
    if (end > start) overlap += end - start;
  });
  return Math.max(0, toTs - fromTs - overlap);
}

function buildJourney(entries, gaps) {
  const raw = [];
  const counts = { screen: 0, tap: 0, saw: 0, move: 0, fail: 0 };
  const seenTraceIds = new Set();
  let apiTotal = 0;
  let apiFail = 0;

  entries.forEach((entry) => {
    if (!entry.event || !entry.eventParams) return;
    if (entry.event === 'ops_receive_be') {
      // Mot call BE duoc ghi thanh 2 dong ops_receive_be giong het nhau. Do tren log that: 307 dong
      // nhung chi 166 trace_id (139 trace xuat hien dung 2 lan, 26 mot lan, 1 ba lan) — trong khi
      // ops_request_be la 166 dong / 166 trace_id, tuc 166 moi la so call that.
      // trace_id la ID cua chinh call do nen khu trung theo no la chac chan, khong phai phong doan.
      const traceId = journeyValue(entry.eventParams.trace_id);
      if (traceId && seenTraceIds.has(traceId)) return;
      if (traceId) seenTraceIds.add(traceId);
      apiTotal += 1;
      if (journeyValue(entry.eventParams.status) === 'fail') apiFail += 1;
    }
    const step = pickJourneyStep(entry.event, entry.eventParams);
    if (!step || !step.label) return;
    raw.push({ kind: step.kind, label: step.label, detail: step.detail || '', note: step.note || '',
      event: entry.event, ts: entry.ts, domIndex: entry.domIndex, session: entry.session });
  });

  // Cung ly do nhu tab Timeline: log co dong timestamp lui ve truoc, thu tu dong khong phai thu tu thoi gian.
  raw.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const steps = mergeAdjacentJourneySteps(raw);
  steps.forEach((step) => {
    counts[step.kind] += 1;
  });

  // ms cua mot buoc "screen" = khoang cach toi buoc screen/move ke tiep. Day la SO TINH RA, khong phai
  // truong nao trong log — cac event no lien tuc trong cung mot lan chuyen man se ra ~0ms, chi buoc cuoi
  // cua chum moi mang con so that. Truong dwell_time co san cua roothome nam rieng trong detail.
  //
  // Hai cho phai chan, neu khong con so ra vo nghia (da gap that: mot man bao "11h24m" trong khi hai
  // dong log cua no cach nhau 2 giay):
  //   - buoc man hinh cuoi cua MOT PHIEN khong duoc do sang buoc dau cua phien sau: giua hai phien app
  //     da bi tat, khong ai "o tren man" ca.
  //   - khoang cach qua MAX_PLAUSIBLE_DURATION_MS thi gan nhu chac chan la app bi day xuong nen chu
  //     khong phai nguoi dung ngoi nhin. Bo han (0 = khong biet) chu khong bao mot con so sai.
  const backgrounds = (gaps || []).filter((gap) => gap.cause === 'background');
  let boundaryTs = steps.length ? steps[steps.length - 1].ts : null;
  let boundarySession = steps.length ? steps[steps.length - 1].session : null;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step.kind === 'screen' && step.ts && boundaryTs && step.session === boundarySession) {
      const span = subtractBackground(step.ts, boundaryTs, backgrounds);
      step.ms = span <= MAX_PLAUSIBLE_DURATION_MS ? span : 0;
    }
    if (step.kind === 'screen' || step.kind === 'move') {
      boundaryTs = step.ts || boundaryTs;
      boundarySession = step.session;
    }
  }

  const byCount = (a, b) => b.count - a.count;
  return {
    steps,
    counts,
    apiTotal,
    apiFail,
    screens: groupJourneySteps(steps, 'screen').sort((a, b) => b.ms - a.ms || b.count - a.count),
    taps: groupJourneySteps(steps, 'tap').sort(byCount),
    saw: groupJourneySteps(steps, 'saw').sort(byCount),
    fails: groupJourneySteps(steps, 'fail').sort(byCount),
    screenLoads: buildScreenLoads(entries),
  };
}
// AI-GENERATED END
