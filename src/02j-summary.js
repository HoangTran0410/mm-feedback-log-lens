// @ts-check
// dựng một khối markdown ~25 dòng để dán thẳng vào ticket
//
// Bước trống nhất trong quy trình của dev: đọc log xong vẫn phải gõ tay lại vào ticket. "Copy dòng đang
// hiện" cho ra vài nghìn dòng thô — không ai dán được, mà lại kèm nguyên số điện thoại và token trong
// payload.
//
// LUẬT CỦA KHỐI NÀY: chỉ liệt kê SỰ KIỆN CÓ GIỜ, tuyệt đối không có câu "nguyên nhân là X". Xếp hạng
// nguyên nhân là suy đoán, mà cái này sẽ nằm lại trong ticket cho người khác đọc như sự thật.
// Và chỉ lấy những trường ĐÃ HIỆN trên panel — không nhét payload thô vào.

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
  // env.osLabel chứ không ghép cứng chữ "iOS" ở đây: log Android sẽ ra "iOS 9".
  out += summaryLine('Thiết bị', [env.device, env.osLabel, env.performance].filter(Boolean).join(' · '));
  out += summaryLine('Bản app', [env.appVersion, env.appBuild ? 'build ' + env.appBuild : '',
    env.flavor ? 'build ' + env.flavor : '', context['App Info']].filter(Boolean).join(' · '));
  // Version miniapp là thứ quyết định "chạy đoạn code nào" — thiếu nó thì ticket không tái hiện được.
  out += summaryLine('MiniApp', env.miniApps
    .map((app) => app.appId + ' ' + app.versions.map((item) => item.value).join('/')).join(' · '));
  out += summaryLine('Mạng', context.Network);
  out += summaryLine('Màn / tính năng', [context.Feature, context.ScreenID, context.MiniApp]
    .filter(Boolean).join(' · '));
  out += summaryLine('Vào từ', context['Entry Point']);
  out += summaryLine('Gửi lúc', context.submittedAt || formatClock(data.lastTs));
  return out;
}

// Những gì log KHÔNG trả lời được cũng phải nằm trong ticket: người đọc sau sẽ biết vì sao không có
// phần đó, thay vì tưởng là "đã kiểm, không có vấn đề".
function summaryBlindSpots(data) {
  const notes = [];
  // LUÔN nhắc, chỉ đổi câu chữ. Trước đây chỗ bật "bỏ khối lặp" thì câu này biến mất — người đọc ticket
  // không còn một dấu hiệu nào rằng file gốc bị nối đôi.
  if (data.duplicate) {
    notes.push(lensState.filter.skipDuplicate
      ? 'file gốc có ' + data.duplicate.length + ' dòng lặp lại nguyên xi; các con số trên đã trừ chúng ra'
      : 'log có ' + data.duplicate.length + ' dòng lặp lại nguyên xi — các con số trên đang tính cả hai lần');
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
  if (data.hasOrphanTail) {
    notes.push('đoạn đầu log nằm trước lần khởi động đầu tiên thấy được — không biết phiên đó bắt đầu ' +
      'lúc nào và đã chạy bao lâu trước đó');
  }
  const spanMs = data.lastTs - data.firstTs;
  if (spanMs > 0) {
    notes.push('log chỉ phủ ' + formatDuration(spanMs) + ' (' + formatClock(data.firstTs) + ' → ' +
      formatClock(data.lastTs) + '), thao tác trước đó không nằm trong file');
  }
  return notes;
}

// Ticket mô tả CẢ LOG chứ không mô tả lát cắt người đọc đang mở — nhưng "bỏ khối lặp" không phải một
// lát cắt, nó là sửa dữ liệu về đúng. Nên đây là ngoại lệ duy nhất được lọc.
function summaryData(data) {
  if (!data.duplicate || !lensState.filter.skipDuplicate) return data;
  const entries = data.entries.filter((entry) => !entry.isDuplicate);
  return Object.assign({}, data, deriveStats(entries, data.gaps), { entries });
}

function buildTicketSummary(fullData) {
  const data = summaryData(fullData);
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

  const blind = summaryBlindSpots(fullData);
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
