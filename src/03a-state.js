// @ts-check
// hằng số dùng chung, lensState, tắt tiếng chữ ký, hàm định dạng
// Tách ra từ src/03-shell.js (992 dòng / 67 hàm). Các file src/*.js được build.sh nối lại
// theo thứ tự tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc,
// không đổi cách chúng gọi nhau.

const MINIMAP_BUCKETS = 90;
const SPARKLINE_BUCKETS = 26;
const DEFAULT_GAP_MS = 2000;
const PANEL_MIN_WIDTH = 360;
const PANEL_MIN_HEIGHT = 260;
const VIEWPORT_MARGIN = 8;

const LEVEL_COLOR = {
  ERROR: '#ff5f6d',
  WARNING: '#ffb648',
  INFO: '#58c4ff',
  DEBUG: '#7d8590',
};

const MUTE_STORAGE_KEY = 'fll.mutedSignatures';
const TEMPLATE_STORAGE_KEY = 'fll.filterTemplates';
const MAX_FILTER_TEMPLATES = 20;
const PERMALINK_PREFIX = '#fll=';
const TIME_WINDOW_CHOICES = [30000, 60000, 120000, 300000];

const lensState = {
  data: null,
  geometry: null,
  tab: 'sum',
  matches: [],
  matchPos: -1,
  matchLabel: '',
  gapThresholdMs: DEFAULT_GAP_MS,
  mutedSignatures: new Set(),
  filterTemplates: [],
  isShowingMuted: false,
  // 'keep' = đánh dấu dòng được giữ, 'drop' = đánh dấu dòng bị loại. Chọn theo phía ít hơn,
  // vì chi phí lọc nằm ở SỐ LẦN chạm class chứ không phải ở layout.
  filterDomMode: 'keep',
  // Người dùng bấm "x" trên feedback này: đừng tự gắn lại nữa (nhưng sang feedback khác thì gắn lại).
  isDismissed: false,
  // Nhớ lần trước đang mở panel hay đang thu gọn, để sang feedback khác trả về đúng dạng đó.
  wasPanelOpen: false,
  // Dòng bị bộ lọc ẩn nhưng người dùng vẫn nhảy tới: phải đếm riêng, không thì con số
  // "đang hiện N/total" sẽ nói dối.
  forcedVisibleIndices: new Set(),
  filter: {
    levels: new Set(),
    modules: new Set(),
    text: '',
    useRegex: true,
    hideOthers: true,
    // Khoảng thời gian tuỳ ý. Chip preset ghi (lastTs - N, lastTs); kéo trên minimap ghi khoảng bất kỳ.
    timeFrom: null,
    timeTo: null,
    // Preset đang bật, tính bằng ms ("2 phút cuối" = 120000), null = khoảng tự chọn hoặc không lọc.
    // Phải NHỚ chứ không suy ngược từ (timeFrom, timeTo): setTimeWindowPreset kẹp timeFrom về firstTs,
    // nên trên log ngắn hơn preset thì hiệu hai mốc không còn bằng preset và chip không sáng, nhãn
    // lại đổi thành hai mốc giờ tuyệt đối. Đo trên ba log thật (dài 291s / 572s / 234s): preset
    // "5 phút cuối" hỏng ở CẢ BA. Nhớ preset còn cho phép tính lại cửa sổ khi sang log khác.
    windowPreset: null,
    session: null,
    // Bỏ qua khối dòng bị lặp lại nguyên xi. Mặc định TẮT: báo trước rồi để người đọc bấm, vì khử nhầm
    // một khối không lặp thì số liệu cũng sai — chỉ là sai theo hướng khác và không còn dấu hiệu nào.
    skipDuplicate: false,
  },
  // Mục đang di chuột qua, để biết lúc nào phải vẽ lại mũi tên lên minimap (và lúc nào thì thôi).
  aimEl: null,
  // Phần tử chuột đang dừng trên, để biết lúc nào phải hiện tooltip tự vẽ (và lúc nào thì thôi).
  tipEl: null,
  // Khoảng thời gian minimap đang VẼ (null = vẽ nguyên cả log). Độc lập với bộ lọc: phóng to chỉ đổi
  // cái nhìn, không đổi tập dòng đang hiện.
  mapZoom: null,
  // Các nấc phóng to trước đó, để lùi từng nấc một thay vì nhảy thẳng về cả log.
  mapZoomStack: [],
  el: {},
};

/* ------------------------------------------- tắt tiếng chữ ký (nhớ qua phiên) */

function loadMutedSignatures() {
  try {
    return new Set(JSON.parse(localStorage.getItem(MUTE_STORAGE_KEY)) || []);
  } catch (error) {
    return new Set();
  }
}

function persistMutedSignatures() {
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, JSON.stringify(Array.from(lensState.mutedSignatures)));
  } catch (error) {
    // Riêng tư / hết dung lượng: tắt tiếng vẫn chạy trong phiên này, chỉ không nhớ sang lần sau.
  }
}

function toggleMutedSignature(groupKey) {
  if (lensState.mutedSignatures.has(groupKey)) lensState.mutedSignatures.delete(groupKey);
  else lensState.mutedSignatures.add(groupKey);
  persistMutedSignatures();
}

function isGroupMuted(group) {
  return lensState.mutedSignatures.has(group.key);
}

function countUnmutedErrorGroups(source) {
  return source.groups.filter((group) => group.level === 'ERROR' && !isGroupMuted(group)).length;
}

// Các tab đọc qua đây: có bộ lọc thì là thống kê của tập đang hiện, không thì là cả file.
function getView() {
  return lensState.view || lensState.data;
}

function escapeHtml(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    return '&#39;';
  });
}

// Tên một phiên app. Đoạn đầu log nằm trước mốc khởi động đầu tiên không có số thứ tự nào đúng cả:
// nó là đuôi của một lần chạy mà log không giữ được điểm bắt đầu, nên gọi thẳng ra như vậy.
function sessionLabel(index) {
  return index === SESSION_ORPHAN_INDEX ? 'Đuôi phiên trước' : 'Phiên ' + index;
}

const SESSION_ORPHAN_TIP = 'Đoạn đầu log, nằm trước lần khởi động đầu tiên thấy được — không có điểm ' +
  'bắt đầu phiên trong file này (log bị cắt bớt, hoặc app đã chạy từ trước đó). Số liệu của nó là số ' +
  'liệu của một phần phiên, không phải cả phiên.';

function formatClock(ts) {
  if (!ts) return '--:--:--';
  const date = new Date(ts + 7 * 3600000);
  return date.toISOString().slice(11, 19);
}

function formatDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
  // Khoảng lặng giữa hai lần mở app có thể dài vài tiếng. "14182s" thì không ai đọc ra là gần bốn
  // tiếng — phải tự chia trong đầu. Trên một phút thì đổi sang phút/giờ.
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours) return hours + 'h' + String(minutes).padStart(2, '0') + 'm';
  return minutes + 'm' + String(totalSeconds % 60).padStart(2, '0') + 's';
}

function formatCount(value) {
  return value >= 1000 ? (value / 1000).toFixed(1) + 'k' : String(value);
}
