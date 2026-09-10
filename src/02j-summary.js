/*
File: src/02j-summary.js
Created At: 2026-09-11 02:40:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — dung mot khoi markdown ~25 dong de dan thang vao ticket
//
// Buoc trong nhat trong quy trinh cua dev: doc log xong van phai go tay lai vao ticket. "Copy dong dang
// hien" cho ra vai nghin dong tho — khong ai dan duoc, ma lai kem nguyen so dien thoai va token trong
// payload.
//
// LUAT CUA KHOI NAY: chi liet ke SU KIEN CO GIO, tuyet doi khong co cau "nguyen nhan la X". Xep hang
// nguyen nhan la suy doan, ma cai nay se nam lai trong ticket cho nguoi khac doc nhu su that.
// Va chi lay nhung truong DA HIEN tren panel — khong nhet payload tho vao.

const SUMMARY_MAX_GROUPS = 5;
const SUMMARY_MAX_CALLS = 5;
const SUMMARY_MAX_STEPS = 8;

function summaryLine(label, value) {
  return value ? '- **' + label + ':** ' + value + '\n' : '';
}

function summaryEnvironment(data) {
  const env = data.environment;
  const context = data.feedback || {};
  let out = '';
  out += summaryLine('Thiết bị', [env.device, env.osVersion ? 'iOS ' + env.osVersion : '',
    env.performance].filter(Boolean).join(' · '));
  out += summaryLine('Bản app', [env.appVersion, env.flavor ? 'build ' + env.flavor : '',
    context['App Info']].filter(Boolean).join(' · '));
  out += summaryLine('Mạng', context.Network);
  out += summaryLine('Màn / tính năng', [context.Feature, context.ScreenID, context.MiniApp]
    .filter(Boolean).join(' · '));
  out += summaryLine('Vào từ', context['Entry Point']);
  out += summaryLine('Gửi lúc', context.submittedAt || formatClock(data.lastTs));
  return out;
}

// Nhung gi log KHONG tra loi duoc cung phai nam trong ticket: nguoi doc sau se biet vi sao khong co
// phan do, thay vi tuong la "da kiem, khong co van de".
function summaryBlindSpots(data) {
  const notes = [];
  if (data.duplicate && !lensState.filter.skipDuplicate) {
    notes.push('log có ' + data.duplicate.length + ' dòng lặp lại nguyên xi — các con số dưới đây ' +
      'đang tính cả hai lần');
  }
  if (!data.traceIssues.available) {
    notes.push('không có dòng Grafana trace (máy gửi không bật Debug Tool) nên không có nguồn lỗi này');
  }
  if (!data.journey.steps.length) {
    notes.push('không có event MoMoTracker nên không dựng được thao tác của user');
  }
  if (data.outOfOrder) {
    notes.push(data.outOfOrder + ' dòng có timestamp lùi về trước — thứ tự dòng không phải thứ tự thời gian');
  }
  const spanMs = data.lastTs - data.firstTs;
  if (spanMs > 0) {
    notes.push('log chỉ phủ ' + formatDuration(spanMs) + ' (' + formatClock(data.firstTs) + ' → ' +
      formatClock(data.lastTs) + '), thao tác trước đó không nằm trong file');
  }
  return notes;
}

function buildTicketSummary(data) {
  const context = data.feedback || {};
  const groups = data.groups
    .filter((group) => group.level === 'ERROR' && !isGroupMuted(group) && !group.noiseLabel)
    .slice(0, SUMMARY_MAX_GROUPS);
  const calls = data.badHttpCalls.slice(0, SUMMARY_MAX_CALLS);
  const steps = data.journey.steps.slice(-SUMMARY_MAX_STEPS);
  const abTags = data.configs.bySource.ab || [];

  let out = '## Feedback' + (context.AgentID ? ' · ' + context.AgentID : '') + '\n\n';
  out += summaryEnvironment(data);
  out += '\n';

  if (groups.length) {
    out += '### ' + groups.length + ' nhóm lỗi nổi bật\n';
    groups.forEach((group) => {
      out += '- `' + (group.module || 'no module') + '` ×' + group.indices.length + ' — ' +
        group.sample.replace(/\s+/g, ' ').slice(0, 120) + ' _(' + formatClock(group.firstTs) + ')_\n';
    });
    out += '\n';
  }

  if (data.traceIssues.fails.length) {
    out += '### Lỗi từ Grafana trace\n';
    data.traceIssues.fails.slice(0, SUMMARY_MAX_GROUPS).forEach((row) => {
      out += '- ×' + row.indices.length + ' — ' + row.key.replace(/\s+/g, ' ').slice(0, 120) + '\n';
    });
    out += '\n';
  }

  if (calls.length) {
    out += '### Call HTTP bất thường (' + data.badHttpCalls.length + '/' + data.httpCalls.length + ')\n';
    calls.forEach((call) => {
      const status = call.resIndex === null ? 'không có response'
        : (call.errorCode != null && call.errorCode !== 0 ? 'errorCode ' + call.errorCode : call.status);
      out += '- `' + call.method + ' ' + call.path + '` → ' + status +
        (call.duration != null ? ' · ' + formatDuration(call.duration) : '') + '\n';
    });
    out += '\n';
  }

  if (steps.length) {
    out += '### ' + steps.length + ' bước cuối trước lúc gửi\n';
    steps.forEach((step) => {
      out += '- `' + formatClock(step.ts) + '` ' + step.label +
        (step.count > 1 ? ' ×' + step.count : '') + (step.detail ? ' — ' + step.detail : '') + '\n';
    });
    out += '\n';
  }

  if (abTags.length) {
    out += '### Nhánh A/B đang bật\n';
    abTags.forEach((item) => {
      out += '- `' + item.key + '` = ' + item.latest.value + '\n';
    });
    out += '\n';
  }

  const blind = summaryBlindSpots(data);
  if (blind.length) {
    out += '### Log này không trả lời được\n';
    blind.forEach((note) => {
      out += '- ' + note + '\n';
    });
    out += '\n';
  }

  out += '_Trích bằng Feedback Log Lens từ ' + data.entries.length + ' dòng log. ' +
    'Đây là danh sách sự kiện có giờ, không phải kết luận nguyên nhân._\n';
  return out;
}
// AI-GENERATED END
