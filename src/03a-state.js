/*
File: src/03a-state.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — hang so dung chung, lensState, tat tieng chu ky, ham dinh dang
// Tach ra tu src/03-shell.js (992 dong / 67 ham). Cac file src/*.js duoc build.sh noi lai
// theo thu tu ten file va boc trong MOT IIFE nen van dung chung scope — tach chi de doc,
// khong doi cach chung goi nhau.

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
  // 'keep' = danh dau dong duoc giu, 'drop' = danh dau dong bi loai. Chon theo phia it hon,
  // vi chi phi loc nam o SO LAN cham class chu khong phai o layout.
  filterDomMode: 'keep',
  // Nguoi dung bam "x" tren feedback nay: dung tu gan lai nua (nhung sang feedback khac thi gan lai).
  isDismissed: false,
  // Nho lan truoc dang mo panel hay dang thu gon, de sang feedback khac tra ve dung dang do.
  wasPanelOpen: false,
  // Dong bi bo loc an nhung nguoi dung van nhay toi: phai dem rieng, khong thi con so
  // "dang hien N/total" se noi doi.
  forcedVisibleIndices: new Set(),
  filter: {
    levels: new Set(),
    modules: new Set(),
    text: '',
    useRegex: true,
    hideOthers: true,
    // Khoang thoi gian tuy y. Chip preset ghi (lastTs - N, lastTs); keo tren minimap ghi khoang bat ky.
    timeFrom: null,
    timeTo: null,
    session: null,
  },
  el: {},
};

/* ------------------------------------------- tat tieng chu ky (nho qua phien) */

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
    // Rieng tu / het dung luong: tat tieng van chay trong phien nay, chi khong nho sang lan sau.
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

// Cac tab doc qua day: co bo loc thi la thong ke cua tap dang hien, khong thi la ca file.
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

function formatClock(ts) {
  if (!ts) return '--:--:--';
  const date = new Date(ts + 7 * 3600000);
  return date.toISOString().slice(11, 19);
}

function formatDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
}

function formatCount(value) {
  return value >= 1000 ? (value / 1000).toFixed(1) + 'k' : String(value);
}
// AI-GENERATED END
