// @ts-check
// dựng lại thao tác của user từ event MoMoTracker
// Tách ra từ src/02-insights.js (946 dòng). Các file src/*.js được build.sh nối lại theo thứ tự
// tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc.

/* ---------------------------------------------- hành trình tương tác của user */

// Mọi dòng MoMoTracker đều ghi ở mức INFO nên không dòng nào lọt vào buildIssueGroups: những gì user
// THẤY và CHẠM hoàn toàn vô hình với phần gom nhóm lỗi. Đo trên log thật (33112319): 955 dòng tracker,
// 46 loại event, trong đó popup "MAX-API SPAM DETECTED" đập vào mặt user 5 lần mà không kèm một ERROR nào.
// Log ghi lặp: nhiều event tracker xuất hiện 2 dòng giống hệt nhau. Đo trên log thật (78 cặp trùng
// nội dung), khoảng cách chia làm hai cụm tách bạch — một cụm 0..~1.1s (ghi lặp) và một cụm từ 70s trở
// lên (user làm lại thật sự ở phiên sau). Chọn 1000ms nằm giữa hai cụm: thà đếm dư còn hơn gộp nhầm
// hai lần bấm thật thành một, vì "user bấm lại vì app không phản hồi" chính là thứ cần nhìn thấy.
const JOURNEY_MERGE_WINDOW_MS = 1000;
const JOURNEY_KINDS = ['screen', 'tap', 'saw', 'move', 'fail'];
const JOURNEY_KIND_LABEL = {
  screen: 'Màn hình', tap: 'Chạm', saw: 'User thấy', move: 'Đổi luồng', fail: 'API fail',
};

// Tracker ghi thẳng chuỗi "null"/"" cho trường rỗng; để nguyên thì nhãn hiện ra là chữ "null".
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

// detail = bối cảnh ỔN ĐỊNH của bước (màn hình, service) — dùng để gom nhóm và so sánh khi gộp.
// note   = số đo RIÊNG của lần đó (duration, dwell_time) — chỉ hiện trên dòng hành trình.
// Tách hai thứ này ra vì nếu trộn chung thì hai lần cùng một lỗi chỉ khác 1ms duration sẽ bị coi là
// hai thứ khác nhau, và nhãn nhóm sẽ mất sạch phần errorCode.
// Bảng duy nhất quyết định event nào vào hành trình. Trả null = bỏ qua (impression, ops_request_be,
// trail_*, sync_* ... không phải thao tác của user). Cố ý KHÔNG lấy roothome_component_impressed (76),
// service_component_displayed (41), roothome_block_viewed (33): đó là cái màn hình vẽ ra, không phải
// cái user làm, và số lượng của chúng sẽ nhấn chìm phần còn lại.
// Lấy nguyên văn từ AppEvent.FeatureMiniAppLoad.Stage (momo-app). Chỉ giữ những stage báo hiệu
// user nhìn thấy một màn hình/toast/popup — các stage đo lường khác không vào hành trình.
const MINIAPP_FAIL_STAGES = {
  scr_fail_loading_miniapp: 'màn hình lỗi tải miniapp',
  toast_fail_loading_miniapp: 'toast lỗi tải miniapp',
  miniapp_web_js_crash: 'miniapp crash JS',
  pu_waiting_load_bundle: 'popup chờ tải bundle',
  pu_version_update: 'popup bắt cập nhật app',
  pu_recording: 'popup đang ghi màn hình',
};

// Quy tắc đặt nhãn: lấy trường đầu tiên KHÔNG rỗng, xếp theo "càng riêng cho bước này và càng giống
// thứ user nhìn thấy thì càng ưu tiên". Ba bậc:
//   1. Chữ user THẬT SỰ đọc được trên màn: title, button_name, item_title
//   2. Tên thành phần do dev đặt: component_name, popup_name, đuôi của component_id
//   3. Bối cảnh rộng hơn: feature_code, service_name
// Bậc 3 không bao giờ nên đứng một mình ở chỗ khác, vì một feature_code có hàng chục popup; nhưng khi
// hai bậc trên đều rỗng thì nó vẫn hơn chữ "popup" trơn — ít ra còn biết popup đó thuộc chỗ nào.
// Vì sao cần: trên log thật có popup ghi title=null, nhãn ra đúng chữ "popup", nên hai popup khác hẳn
// nhau bị gom thành một hàng "2x popup" mà không còn gì để phân biệt.
const JOURNEY_LABEL_MAX = 48;

function pickJourneyLabel(candidates, fallback) {
  for (let i = 0; i < candidates.length; i += 1) {
    const value = journeyValue(candidates[i]);
    if (!value) continue;
    // component_id là đường dẫn "<appId>/<feature>/<screen>/Popup/<tên>" — chỉ đoạn cuối mới là tên.
    const tail = value.indexOf('/') >= 0 ? value.slice(value.lastIndexOf('/') + 1).trim() : value;
    const name = tail || value;
    return name.length > JOURNEY_LABEL_MAX ? name.slice(0, JOURNEY_LABEL_MAX - 1) + '…' : name;
  }
  return fallback;
}

// momoClassDiscriminator là tên LỚP đầy đủ của event, đuôi của nó là tên bề mặt thật sự hiện ra.
// Vì sao cần: trên log thật có hai màn đều ghi screen_name=result nhưng là hai lớp khác hẳn —
// TransactionResultRevampScreenDisplayed và TransactionResultWidgetDisplayed — nên chúng bị gom làm
// một hàng, mất sạch cái để phân biệt.
//
// NHƯNG không được dùng bừa: cũng trên log thật, một log có 64 dòng mang discriminator mà TẤT CẢ đều
// là "PromotionEventParams" — đó là lớp chứa THAM SỐ, không phải tên màn. Lấy bừa thì mọi màn đều bị
// đặt tên "PromotionEventParams".
// Vì vậy chỉ nhận lớp nào kết thúc bằng Displayed / Interacted / Viewed: đó là lớp mô tả một bề mặt
// vừa hiện ra. Đo trên 10 đuôi lớp khác nhau quan sát được ở hai log: 7 cái khớp đều là tên bề mặt
// thật, 3 cái không khớp (PromotionEventParams, CheckoutRequested, CheckoutResponse) đều không phải.
// CHƯA XÁC MINH trên dải lớp rộng hơn — mới có hai log mang trường này.
const RE_JOURNEY_SURFACE = /(Displayed|Interacted|Viewed)$/;

function journeySurfaceName(params) {
  const full = journeyValue(params.momoClassDiscriminator);
  if (!full) return '';
  const tail = full.slice(full.lastIndexOf('.') + 1);
  if (!RE_JOURNEY_SURFACE.test(tail)) return '';
  // Bỏ đuôi mô tả hành động rồi bỏ nốt chữ "Screen" còn thừa: TransactionResultRevampScreenDisplayed
  // -> TransactionResultRevamp, còn TransactionResultWidgetDisplayed -> TransactionResultWidget.
  return tail.replace(RE_JOURNEY_SURFACE, '').replace(/Screen$/, '');
}

// Tên màn = tên màn hình + tên bề mặt (nếu đọc được). Hai thứ này khác cấp độ chi tiết nên nối bằng
// dấu chấm giữa, không trộn làm một.
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
    // component_id = "<appId>/<feature>/<screen>/Button/<nhãn tiếng Việt đúng như user nhìn thấy>".
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
  // Tên stage lấy từ AppEvent.FeatureMiniAppLoad.Stage trong source app, không phải đoán từ log.
  // Đây là những stage mà user THẤY: màn lỗi, toast lỗi, popup. Chúng ghi ở mức INFO như mọi event
  // tracker khác nên phần gom nhóm lỗi không đếm được.
  // Đo trên hai log thử: cả hai đều 0 lần — hai log đó không gặp sự cố tải miniapp, không phải sai tên.
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
  // ops_receive_be là kết quả call BE do chính tracker ghi, có sẵn status/error_code/duration.
  // Chỉ lấy bản fail: 45/307 trên log thật, và tab HTTP không thấy hết số này vì nó đọc dòng [Method:].
  if (event === 'ops_receive_be') {
    if (journeyValue(params.status) !== 'fail') return null;
    const code = journeyValue(params.error_code);
    const api = journeyValue(params.api) || journeyValue(params.api_path) || 'API';
    // errorCode vào NHÃN chứ không vào detail: cùng một api fail với hai mã khác nhau là hai chuyện
    // khác nhau, gom chung một dòng sẽ giấu mất mã lỗi.
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
    // Đếm SỐ THAO TÁC (số bước đã gộp), không phải số dòng log — để con số ở đây khớp với thẻ thống kê
    // đầu tab. Số dòng thô vẫn còn nguyên trong row.indices để duyệt từng dòng.
    row.count += 1;
    // ms là TỔNG của mọi lần vào màn đó; maxMs là lần lâu nhất. Chỉ hiện tổng mà để cạnh "2x" thì
    // người đọc dễ tưởng 2 lần mỗi lần bằng từng đó.
    row.ms += step.ms;
    if (step.ms > row.maxMs) row.maxMs = step.ms;
    step.indices.forEach((domIndex) => row.indices.push(domIndex));
    // Nhiều bước cùng nhãn nhưng khác bối cảnh (nút "transfer" ở bill_detail và ở detail_input):
    // giữ detail của bước đầu cho cả nhóm là nói sai. Chỉ giữ khi mọi bước đều giống nhau.
    if (row.detail !== step.detail) row.detail = '';
    if (step.ts && (!row.firstTs || step.ts < row.firstTs)) row.firstTs = step.ts;
    if (step.lastTs && (!row.lastTs || step.lastTs > row.lastTs)) row.lastTs = step.lastTs;
  });
  return Array.from(map.values());
}

// Gộp các bước LIÊN TIẾP y hệt nhau và sát nhau về thời gian thành một bước mang count.
// Không xoá dòng nào: indices giữ đủ cả N dòng để vẫn nhảy được tới từng dòng trong bảng log.
function mergeAdjacentJourneySteps(steps) {
  const merged = [];
  steps.forEach((step) => {
    const last = merged[merged.length - 1];
    // Bước 'fail' KHÔNG gộp: mỗi call BE đã có trace_id riêng và đã khử trùng chính xác theo đó.
    // Hai call thật sự khác nhau cách nhau vài trăm ms là chuyện bình thường — gộp thì số ở đây
    // sẽ lệch với số call fail đếm được từ trace_id.
    if (step.kind !== 'fail' &&
      last && last.kind === step.kind && last.label === step.label && last.detail === step.detail &&
      step.ts && last.lastTs && step.ts - last.lastTs <= JOURNEY_MERGE_WINDOW_MS) {
      last.count += 1;
      last.lastTs = step.ts;
      last.indices.push(step.domIndex);
      return;
    }
    // PHẢI mang theo session: thiếu nó thì guard "không đo vắt qua hai phiên app" ở dưới so
    // undefined === undefined, tức luôn đúng, tức guard đó chưa bao giờ chạy.
    merged.push({ kind: step.kind, label: step.label, detail: step.detail, note: step.note,
      event: step.event, ts: step.ts, lastTs: step.ts, domIndex: step.domIndex, session: step.session,
      indices: [step.domIndex], count: 1, ms: 0 });
  });
  return merged;
}

// Thời gian TẢI một màn, khác hẳn "ở lâu trên màn" (dwell): đây là số có sẵn trong log
// (auto_screen_displayed.duration khi state=load, và auto_load_progress_tracked.duration),
// không phải số tính ra. Tab Chậm vốn gom mọi "duration=" vào một rổ mà không gắn với màn nào.
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
      row = { key, count: 0, worstMs: 0, totalMs: 0, indices: [] };
      map.set(key, row);
    }
    row.count += 1;
    row.totalMs += ms;
    if (ms > row.worstMs) row.worstMs = ms;
    row.indices.push(entry.domIndex);
  });
  // Đã bỏ trường `sources` (một Set mỗi hàng, rồi đổi thành mảng): không renderer nào đọc.
  return Array.from(map.values())
    .map((row) => ({ key: row.key, count: row.count, worstMs: row.worstMs,
      avgMs: Math.round(row.totalMs / row.count), indices: row.indices }))
    .sort((a, b) => b.worstMs - a.worstMs);
}

// Thời gian "ở trên màn" không được tính cả lúc app nằm dưới nền. Đo thật: một màn báo 7m08s trong khi
// 3m52s trong số đó là lúc user rời hẳn app — 88% con số là thứ không ai nhìn. Tool đã tính sẵn các
// khoảng đó cho thẻ thống kê ở Tổng quan, chỉ là chưa trừ ở đây.
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
      // Một call BE được ghi thành 2 dòng ops_receive_be giống hệt nhau. Đo trên log thật: 307 dòng
      // nhưng chỉ 166 trace_id (139 trace xuất hiện đúng 2 lần, 26 một lần, 1 ba lần) — trong khi
      // ops_request_be là 166 dòng / 166 trace_id, tức 166 mới là số call thật.
      // trace_id là ID của chính call đó nên khử trùng theo nó là chắc chắn, không phải phỏng đoán.
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

  // Cùng lý do như tab Timeline: log có dòng timestamp lùi về trước, thứ tự dòng không phải thứ tự thời gian.
  raw.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const steps = mergeAdjacentJourneySteps(raw);
  steps.forEach((step) => {
    counts[step.kind] += 1;
  });

  // ms của một bước "screen" = khoảng cách tới bước screen/move kế tiếp. Đây là SỐ TÍNH RA, không phải
  // trường nào trong log — các event nổ liên tục trong cùng một lần chuyển màn sẽ ra ~0ms, chỉ bước cuối
  // của chùm mới mang con số thật. Trường dwell_time có sẵn của roothome nằm riêng trong detail.
  //
  // Hai chỗ phải chặn, nếu không con số ra vô nghĩa (đã gặp thật: một màn báo "11h24m" trong khi hai
  // dòng log của nó cách nhau 2 giây):
  //   - bước màn hình cuối của MỘT PHIÊN không được đo sang bước đầu của phiên sau: giữa hai phiên app
  //     đã bị tắt, không ai "ở trên màn" cả.
  //   - khoảng cách quá MAX_PLAUSIBLE_DURATION_MS thì gần như chắc chắn là app bị đẩy xuống nền chứ
  //     không phải người dùng ngồi nhìn. Bỏ hẳn (0 = không biết) chứ không báo một con số sai.
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
