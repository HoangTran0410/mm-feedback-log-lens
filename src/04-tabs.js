// @ts-check
// nội dung 5 tab: Tổng quan, Vấn đề, Cấu hình, Lọc, Diễn biến

// Dùng log thật có 262 nhóm sau khi gom; vẽ hết một lượt là một chuỗi HTML rất lớn và phải
// dựng lại mỗi lần gõ phím trong ô tìm. Vẽ theo lô, còn lại bấm "Hiện thêm".
const ISSUE_PAGE_SIZE = 50;

const TIMELINE_PAGE_SIZE = 80;

const tabUiState = { issueLevel: 'all', issueQuery: '', httpOnlyBad: false, httpQuery: '', moduleQuery: '',
  issueLimit: ISSUE_PAGE_SIZE, templateName: '', tlKinds: new Set(), tlQuery: '',
  tlLimit: TIMELINE_PAGE_SIZE, showNoise: false };

// Mọi thứ trong tabUiState đều là trạng thái của MỘT feedback đang mở. Sang feedback khác mà còn sót
// thì danh sách đã bị lọc sẵn bằng câu tìm của log trước, mà thanh bộ lọc không hề báo gì.
function resetTabUiState() {
  tabUiState.issueLevel = 'all';
  tabUiState.issueQuery = '';
  tabUiState.httpOnlyBad = false;
  tabUiState.httpQuery = '';
  tabUiState.moduleQuery = '';
  tabUiState.issueLimit = ISSUE_PAGE_SIZE;
  tabUiState.templateName = '';
  tabUiState.tlKinds = new Set();
  tabUiState.tlQuery = '';
  tabUiState.tlLimit = TIMELINE_PAGE_SIZE;
  tabUiState.showNoise = false;
}

function renderSparkline(indices, color) {
  const data = lensState.data;
  const span = Math.max(1, data.lastTs - data.firstTs);
  const buckets = new Array(SPARKLINE_BUCKETS).fill(0);
  indices.forEach((domIndex) => {
    const entry = data.entries[domIndex];
    if (!entry || !entry.ts) return;
    buckets[Math.min(SPARKLINE_BUCKETS - 1, Math.floor(((entry.ts - data.firstTs) / span) * SPARKLINE_BUCKETS))] += 1;
  });
  const peak = Math.max(1, ...buckets);
  return '<div class="fll-spark">' + buckets
    .map((count) => '<i style="height:' + (count ? 20 + (count / peak) * 80 : 8) + '%;background:' +
      (count ? color : '#2a2436') + '"></i>')
    .join('') + '</div>';
}

// Vẽ HẾT hàng: việc cắt bớt để capSectionRows() làm sau khi vẽ, nhờ vậy badge trên tiêu đề vẫn là
// tổng thật và ô tìm nhanh vẫn chạm tới được phần bị giấu. Hàng đã sort giảm dần nên peak là hàng đầu.
function renderRankList(rows, dataAttr) {
  const peak = Math.max(1, ...rows.map((row) => row.count));
  return '<div class="fll-rank">' + rows
    .map((row) =>
      '<div class="fll-rk" ' + dataAttr + '="' + escapeHtml(row.key) + '">' +
      '<u style="width:' + ((row.count / peak) * 100).toFixed(1) + '%"></u>' +
      '<span>' + escapeHtml(row.key) + '</span><b>' + row.count + '</b></div>')
    .join('') + '</div>';
}

// Thẻ thống kê hiện số chính xác; chỉ badge trên tab mới rút gọn kiểu 4.1k.
// Khi đang lọc thì kèm theo tổng của cả file (47/958) để không ai giật mình "warning của tôi đâu mất rồi".
function statCard(value, label, color, attrs, total) {
  const suffix = total != null && total !== value ? '<em>/' + total + '</em>' : '';
  return '<button class="fll-stat" ' + attrs + '><b' + (color ? ' style="color:' + color + '"' : '') + '>' +
    value + suffix + '</b><span>' + escapeHtml(label) + '</span></button>';
}

// Tiêu đề một mục. data-sec giữ tên GỐC: collapsifySections() lấy thuộc tính này làm khoá nhớ trạng
// thái đóng/mở, không được lấy textContent vì trong đó có cả badge — badge đổi theo từng log, lấy nó
// vào khoá thì mở một mục ở log này, sang log khác lại thấy mục đó đang đóng.
// Badge là thứ duy nhất nhìn thấy khi mục đang thu lại, nên nó phải trả lời được "trong này có gì".
// tone 'act' = đang có bộ lọc bật, dùng màu accent giống chip bộ lọc.
function secTitle(title, badge, tone) {
  const chip = badge == null || badge === '' ? ''
    : '<i class="fll-secbdg' + (tone ? ' ' + tone : '') + '">' + escapeHtml(String(badge)) + '</i>';
  return '<div class="fll-sec" data-sec="' + escapeHtml(title) + '">' + escapeHtml(title) + chip + '</div>';
}

function renderWindowChips(includeAllChip) {
  const choices = includeAllChip ? TIME_WINDOW_CHOICES.concat([0]) : TIME_WINDOW_CHOICES;
  return '<div class="fll-row">' +
    choices
      .map((ms) => '<button class="fll-chip' + (isWindowPresetActive(ms) ? ' on' : '') +
        '" data-act="setWindow" data-value="' + ms + '">' +
        (ms ? formatWindowPresetLabel(ms) : 'Toàn bộ') + '</button>')
      .join('') +
    '</div><div class="fll-hint" style="margin-top:6px">Hoặc kéo thẳng trên minimap để chọn khoảng ' +
    'bất kỳ.</div>';
}

/* ---------------------------------------------------------------- Tổng quan */

// Log được chụp đúng lúc user bấm gửi feedback, nên mép phải của trục thời gian chính là thời điểm xảy ra vấn đề.
// Một log production thật (autoId 45490371) dài 4222 dòng hoá ra là 2111 dòng đầu lặp lại y hệt.
// Không báo thì tool đếm gấp đôi mọi thứ mà không ai nhận ra — "lỗi này 4 lần" thật ra là 2 lần.
function renderDuplicateBanner(data) {
  const block = data.duplicate;
  if (!block) return '';
  const isSkipping = lensState.filter.skipDuplicate;
  const share = ((block.length / data.entries.length) * 100).toFixed(0);
  return '<div class="fll-note' + (isSkipping ? ' ok' : '') + '">' +
    '<span>' + (isSkipping ? '&#10003;' : '&#9888;') + '</span><div>' +
    (isSkipping
      ? '<b>Đang bỏ ' + block.length + ' dòng lặp.</b> Mọi con số bên dưới tính trên phần còn lại.'
      : '<b>File này có ' + block.length + ' dòng lặp lại nguyên xi</b> (' + share + '% cả log): ' +
        'dòng ' + block.sourceLineFrom + ' trở đi xuất hiện lại ở dòng ' + block.lineFrom + '–' +
        block.lineTo + '. <b>Mọi con số bên dưới đang tính cả hai lần.</b>') +
    '<div class="fll-row" style="margin-top:8px">' +
    '<button class="fll-btn' + (isSkipping ? '' : ' pri') + '" data-act="tglSkipDuplicate">' +
    (isSkipping ? 'Tính lại cả phần lặp' : 'Bỏ khối lặp, tính lại') + '</button>' +
    '<button class="fll-btn" data-act="jumpDuplicate">Tới chỗ nối</button></div>' +
    '</div></div>';
}

// Giá trị dài (deviceid 64 ký tự) không vừa panel 480px: cắt giữa, giữ hai đầu để còn đối chiếu được,
// nguyên văn để trong chú giải.
function envShortValue(value) {
  return value.length > 24 ? value.slice(0, 12) + '…' + value.slice(-6) : value;
}

function envRankRow(left, right, tip) {
  return '<div class="fll-rk" style="cursor:default"' +
    (tip ? ' data-tip="' + escapeHtml(tip) + '"' : '') + '>' +
    '<span>' + escapeHtml(left) + '</span><b style="color:var(--txt)">' + escapeHtml(right) + '</b></div>';
}

// Một khoá có NHIỀU giá trị là thứ đáng nhìn thấy cả danh sách, không phải thứ để chọn đại lấy cái
// hay gặp nhất: IP đổi giữa chừng = đổi mạng, deviceid đổi = log đã bị trộn từ hai máy, bản app đổi =
// người dùng vừa nâng cấp giữa log nên mọi con số phía trên đang trộn hai bản.
// Đúng một giá trị thì nó đã nằm ở bảng trên rồi, không lặp lại ở đây.
function renderEnvValueList(label, list) {
  if (list.length < 2) return '';
  return '<div class="fll-hint" style="margin:10px 0 4px">' + escapeHtml(label) + ' — <b>' +
    list.length + '</b> giá trị khác nhau</div>' +
    '<div class="fll-rank">' + list
      .map((item) => envRankRow(envShortValue(item.value), item.count + ' lần', item.value))
      .join('') + '</div>';
}

function renderEnvMiniApps(miniApps) {
  if (!miniApps.length) return '';
  return '<div class="fll-hint" style="margin:10px 0 4px">MiniApp đã gọi request — <b>' +
    miniApps.length + '</b></div>' +
    '<div class="fll-rank">' + miniApps
      .map((app) => envRankRow(app.appId, app.versions.map((item) => item.value).join(', '),
        app.appId + '\n' + app.versions.map((item) => 'version ' + item.value + ': ' + item.count + ' request')
          .join('\n')))
      .join('') + '</div>';
}

// Mục này trả lời câu đầu tiên của bước TÁI HIỆN: máy gì, hệ điều hành nào, bản nào, miniapp version
// bao nhiêu, nối vào đâu. Đọc từ header request HTTP vì đó là nguồn duy nhất còn sống trên log
// production (xem 02i) — và cũng vì một dòng header mang sẵn hơn chục trường đáng đọc.
function renderEnvironmentSection(data) {
  const env = data.environment;
  const full = lensState.data ? lensState.data.environment : env;
  if (!env.available) {
    // Chỉ được nói "log này không có" khi CẢ LOG không có — cùng luật với tab Cấu hình.
    if (env === full || !full.available) return '';
    return secTitle('Máy & môi trường', 'bị lọc hết') +
      emptyBecauseOfFilter(full.headerLineCount + full.bodyLineCount,
        'dòng request HTTP nào mang thông tin máy');
  }
  const context = data.feedback || {};
  const only = (list) => (list.length === 1 ? list[0].value : '');
  const rows = [
    // Hai cái tên của cùng một cái máy: tên người đọc được và mã máy trong User-Agent. Giữ cả hai,
    // xem chú thích ở buildEnvironment.
    ['Thiết bị', [env.device + (env.deviceModel ? ' (' + env.deviceModel + ')' : ''),
      env.osLabel || env.deviceOs].filter(Boolean).join(' · ')],
    ['Đời máy', env.performance],
    ['Bản app', [env.appVersion, env.appBuild ? 'build ' + env.appBuild : '',
      env.flavor ? 'build ' + env.flavor : ''].filter(Boolean).join(' · ')],
    ['Mạng', context.Network || ''],
    ['Ngôn ngữ', env.lang],
    ['Múi giờ', env.timezone],
    ['Môi trường', [env.envName, env.channel].filter(Boolean).join(' · ')],
    ['CFNetwork / Darwin', [env.cfNetwork, env.darwin].filter(Boolean).join(' / ')],
    ['Agent ID', only(env.agentIds)],
    // Cắt ở đây chứ không cắt trong 02i: nguyên văn vẫn phải còn trong dữ liệu để chú giải hiện ra
    // được và để ai đọc code sau không tưởng tool chỉ đọc được một phần deviceid.
    ['Device ID', envShortValue(only(env.deviceIds)), only(env.deviceIds)],
    ['IP', only(env.ips)],
    ['Host đã gọi', env.hostCount
      ? env.hostCount + ' host' + (env.nonProdHosts.length
        ? ' · ' + env.nonProdHosts.length + ' host có dấu hiệu uat/dev: ' + env.nonProdHosts.join(', ')
        : ' · không host nào có dấu hiệu uat/dev')
      : ''],
  ].filter((row) => row[1]);
  const lists = renderEnvValueList('Bản app', env.appVersions) +
    renderEnvValueList('Agent ID', env.agentIds) +
    renderEnvValueList('Device ID', env.deviceIds) +
    renderEnvValueList('IP', env.ips) +
    renderEnvMiniApps(env.miniApps);
  if (!rows.length && !lists) return '';

  // Bản build và host là HAI chuyện khác nhau — chỉ nói ra sự thật quan sát được, không kết luận hộ.
  const mixed = env.mixedBuild
    ? '<div class="fll-note" style="margin-top:8px"><span>&#9888;</span><div>Bản <b>' +
      escapeHtml(env.flavor) + '</b> nhưng mọi host trong log đều không có dấu hiệu uat/dev. ' +
      'Bản build và host là hai chuyện khác nhau — đây chỉ là điều quan sát được, không phải kết luận.' +
      '</div></div>'
    : '';
  const sources = [env.headerLineCount ? env.headerLineCount + ' header' : '',
    env.bodyLineCount ? env.bodyLineCount + ' body' : ''].filter(Boolean).join(' và ');
  return secTitle('Máy & môi trường', env.device || env.appVersion || '') +
    (sources
      ? '<div class="fll-hint" style="margin-bottom:8px">Đọc từ ' + sources +
        ' của request HTTP — nguồn duy nhất còn sống trên log production.</div>'
      : '') +
    '<div class="fll-rank">' + rows.map((row) => envRankRow(row[0], row[1], row[2] || row[1])).join('') +
    '</div>' +
    lists + mixed;
}

function renderFeedbackBanner() {
  const data = lensState.data;
  const context = data.feedback || {};
  const bits = [context.Feature, context.ScreenID, context.MiniApp].filter(Boolean);
  const device = [context['Device OS'], context['App Info'], context.Network].filter(Boolean).join(' · ');

  // Thiết bị/phiên bản chỉ để trong tooltip: dòng này bị cắt giữa chừng thì đọc càng khó hơn là không có.
  return '<div class="fll-focus">' +
    '<div class="fll-focus-t">User gửi lúc <b>' + formatClock(data.lastTs) + '</b>' +
    (context['Entry Point'] ? ' từ <b>' + escapeHtml(context['Entry Point']) + '</b>' : '') + '</div>' +
    (bits.length ? '<div class="fll-focus-d" data-tip="' +
      escapeHtml(bits.join(' · ') + (device ? '\n' + device : '')) + '">' +
      escapeHtml(bits.join(' · ')) + '</div>' : '') +
    '<div class="fll-focus-hint">Vấn đề thường nằm ở cuối log — thu hẹp lại:</div>' +
    renderWindowChips(false) +
    '<div class="fll-row" style="margin-top:9px">' +
    '<button class="fll-btn pri" data-act="copySummary" data-tip="Khối markdown gọn để dán thẳng vào ' +
    'ticket — liệt kê sự kiện có giờ, không kết luận nguyên nhân.">Copy tóm tắt cho ticket</button>' +
    '</div>' +
    (context.Feature ? '<button class="fll-btn" style="margin-top:9px" data-act="filterFeature" data-value="' +
      escapeHtml(context.Feature) + '">Chỉ dòng có "' + escapeHtml(context.Feature) + '"</button>' : '') +
    '</div>';
}

function renderSummaryTab() {
  const data = getView();
  const full = lensState.data;
  const isScoped = data !== full;
  const errorGroups = data.groups.filter((group) => group.level === 'ERROR' && !isGroupMuted(group));

  // Không lặp lại "đang lọc N dòng" ở đây: thanh bộ lọc ngay phía trên đã nói rồi,
  // và mỗi thẻ thống kê đều tự hiện dạng scope/tổng.
  let html = renderFeedbackBanner() +
    '<div class="fll-stats">' +
    statCard(data.scopedEntries.length, 'dòng log', '', 'data-act="noop"',
      isScoped ? full.entries.length : null) +
    statCard(data.levels.ERROR, 'ERROR', LEVEL_COLOR.ERROR, 'data-level="ERROR"',
      isScoped ? full.levels.ERROR : null) +
    statCard(data.levels.WARNING, 'WARNING', LEVEL_COLOR.WARNING, 'data-level="WARNING"',
      isScoped ? full.levels.WARNING : null) +
    // Bấm vào đây phải ra đúng CHỖ LỌC theo phiên (tab Lọc), không phải tab Diễn biến — trước đây
    // nó dẫn sang Diễn biến trong khi chỗ chọn phiên lại nằm ở Lọc. Một phiên thì không có gì để
    // chọn, để nút bấm được chỉ làm người dùng bấm hụt.
    statCard(full.sessionCount, 'phiên app', '#3ddc97',
      (full.sessionCount > 1 ? 'data-act="gotoSessions"' : 'data-act="noop"') +
      (full.hasOrphanTail ? ' data-tip="' + escapeHtml('Trong đó có một đoạn không đếm được trọn vẹn. ' +
        SESSION_ORPHAN_TIP) + '"' : '')) +
    statCard(data.gaps.filter((gap) => gap.cause !== 'background').length,
      'khoảng lặng ≥ ' + full.gapThresholdLabel, LEVEL_COLOR.WARNING,
      'data-act="gotoTimeline" data-tip="' +
      (data.gaps.some((gap) => gap.cause === 'background')
        ? 'Đã trừ ' + data.gaps.filter((gap) => gap.cause === 'background').length +
          ' khoảng do app xuống nền — những khoảng đó không phải app treo.'
        : 'Không khoảng nào trùng với lúc app xuống nền.') + '"',
      isScoped ? full.gaps.filter((gap) => gap.cause !== 'background').length : null) +
    statCard(data.badHttpCalls.length, 'HTTP bất thường', LEVEL_COLOR.ERROR, 'data-act="gotoHttp"',
      isScoped ? full.badHttpCalls.length : null) +
    '</div>';

  // Băng này phải đứng TRÊN mọi con số, vì nếu log bị nối đôi thì mọi con số bên dưới đều gấp đôi.
  html += renderDuplicateBanner(full);

  if (full.outOfOrder > 0) {
    html += '<div class="fll-note" data-tip="Logger flush theo lô (' + full.batchCount +
      ' mốc END OF BATCH). Minimap, khoảng lặng và tab Timeline đều đã sắp lại theo timestamp thật.">' +
      '<span>&#9888;</span><div><b>' + full.outOfOrder + ' dòng có timestamp lùi về trước</b> — ' +
      'thứ tự dòng không phải thứ tự thời gian.</div></div>';
  }

  html += secTitle('Tỷ lệ mức độ', data.levels.ERROR + ' lỗi', data.levels.ERROR ? 'err' : '');
  const levelTotal = Math.max(1, LEVEL_ORDER.reduce((sum, level) => sum + data.levels[level], 0));
  html += '<div class="fll-lvbar">' + LEVEL_ORDER
    .map((level) => '<i style="width:' + ((data.levels[level] / levelTotal) * 100).toFixed(2) + '%;background:' +
      LEVEL_COLOR[level] + '" data-tip="' + level + ': ' + data.levels[level] + '"></i>')
    .join('') + '</div>';
  html += '<div class="fll-lvkey">' + LEVEL_ORDER
    .map((level) => '<button class="fll-chip" data-level="' + level + '">' +
      '<i class="fll-sw" style="background:' + LEVEL_COLOR[level] + '"></i>' + level +
      ' <em>' + data.levels[level] + '</em></button>')
    .join('') + '</div>';

  if (errorGroups.length) {
    html += secTitle('Lỗi nổi bật', errorGroups.length, 'err') +
      errorGroups.slice(0, 3).map((group) => renderGroupCard(group, data.groups.indexOf(group))).join('') +
      '<button class="fll-btn" data-act="gotoIssues" style="width:100%">Xem tất cả ' + data.groups.length +
      ' nhóm vấn đề</button>';
  }

  // Popup/bottom sheet đắt giá nhất nên nằm ngay tab đầu, không phải giấu sau vài lần bấm:
  // chúng đều ghi ở mức INFO nên phần "Lỗi nổi bật" ngay trên không bao giờ nhắc tới.
  if (data.journey.saw.length) {
    html += secTitle('User đã nhìn thấy gì', data.journey.saw.length, 'warn') +
      '<div class="fll-hint" style="margin-bottom:8px">Popup và bottom sheet thật sự hiện lên màn hình. ' +
      'Tất cả đều ghi ở mức <b>INFO</b> nên tab Vấn đề không đếm chúng.</div>' +
      data.journey.saw.map(renderSawCard).join('');
  }
  if (data.journey.taps.length) {
    html += secTitle('Chạm nhiều nhất', data.journey.taps.length) +
      renderRankList(data.journey.taps, 'data-jtap');
  }

  // Mục này chạy theo bộ lọc như mọi mục khác của tab: lọc vào đúng một phiên app thì "bản app"
  // phải là bản của phiên đó. Đo trên log production 9609 dòng: cả log có hai bản (5.13.1 và 5.15.0,
  // người dùng nâng cấp giữa chừng), đọc theo cả log thì panel ghi bản hay gặp nhất — tức bản CŨ,
  // trong khi feedback được gửi từ bản mới.
  html += renderEnvironmentSection(data);
  html += renderSlowSections();
  html += secTitle('Module nói nhiều nhất', data.modules.length) +
    renderRankList(data.modules, 'data-module');
  if (data.events.length) {
    html += secTitle('Tracker event', data.events.length) + renderRankList(data.events, 'data-event') +
      '<div class="fll-hint" style="margin-top:6px">Tên event thô, kể cả loại chưa dựng thành thao tác ' +
      'được — bấm để lọc thẳng ra những dòng đó.</div>';
  }
  return html;
}

/* ------------------------------------------------------------------ Vấn đề */

function renderGroupCard(group, groupIndex) {
  const color = group.level === 'ERROR' ? LEVEL_COLOR.ERROR : LEVEL_COLOR.WARNING;
  const muted = isGroupMuted(group);
  return '<div class="fll-grp' + (group.level === 'ERROR' ? ' err' : '') + (muted ? ' muted' : '') +
    '" data-group="' + groupIndex + '">' +
    '<div class="fll-grp-top">' +
    '<span class="fll-cnt">' + group.indices.length + '&times;</span>' +
    (group.module ? '<span class="fll-mod">' + escapeHtml(group.module) + '</span>' : '') +
    '<span class="fll-when">' + formatClock(group.firstTs) +
    (group.indices.length > 1 ? ' &rarr; ' + formatClock(group.lastTs) : '') + '</span>' +
    '<button class="fll-ico fll-mute" data-act="mute" data-value="' + groupIndex + '" data-tip="' +
    (muted ? 'Bật lại nhóm này' : 'Tắt tiếng chữ ký này, nhớ cho các feedback sau') + '">' +
    (muted ? '&#128266;' : '&#128263;') + '</button></div>' +
    '<div class="fll-msg">' + escapeHtml(group.sample) + '</div>' +
    (group.indices.length > 1 ? renderSparkline(group.indices, color) : '') +
    '</div>';
}

function renderIssueList() {
  const view = getView();
  const query = tabUiState.issueQuery.toLowerCase();
  const groups = view.groups.filter((group) => {
    // Nhiễu đo lường có khối riêng bên dưới, không trộn vào đây.
    if (group.noiseLabel) return false;
    if (isGroupMuted(group) && !lensState.isShowingMuted) return false;
    if (tabUiState.issueLevel !== 'all' && group.level !== tabUiState.issueLevel) return false;
    if (!query) return true;
    return (group.sample + ' ' + group.module).toLowerCase().indexOf(query) >= 0;
  });
  if (!groups.length) return '<div class="fll-empty">Không có nhóm nào khớp.</div>';
  const shown = groups.slice(0, tabUiState.issueLimit);
  return shown.map((group) => renderGroupCard(group, view.groups.indexOf(group))).join('') +
    (groups.length > shown.length
      ? '<button class="fll-btn" style="width:100%" data-act="moreIssues">Hiện thêm — còn ' +
        (groups.length - shown.length) + ' nhóm</button>'
      : '');
}

function renderIssuesTab() {
  const data = getView();
  const counts = { all: 0, ERROR: 0, WARNING: 0 };
  let mutedCount = 0;
  data.groups.forEach((group) => {
    if (group.noiseLabel) return;
    if (isGroupMuted(group)) {
      mutedCount += 1;
      return;
    }
    counts.all += 1;
    counts[group.level] += 1;
  });

  return renderTraceFailSection(data) +
    secTitle('Nhóm theo chữ ký dòng log', counts.all, counts.ERROR ? 'err' : '') +
    '<div class="fll-row" style="margin-bottom:8px">' +
    ['all', 'ERROR', 'WARNING']
      .map((key) => '<button class="fll-chip' + (tabUiState.issueLevel === key ? ' on' : '') +
        '" data-act="issueLevel" data-value="' + key + '">' + (key === 'all' ? 'Tất cả' : key) +
        ' <em>' + counts[key] + '</em></button>')
      .join('') +
    (mutedCount ? '<button class="fll-chip' + (lensState.isShowingMuted ? ' on' : '') +
      '" data-act="toggleMutedView">&#128263; Đã tắt tiếng <em>' + mutedCount + '</em></button>' : '') +
    '</div>' +
    '<input class="fll-in" id="fll-q" placeholder="Lọc nhanh trong các nhóm..." value="' +
    escapeHtml(tabUiState.issueQuery) + '">' +
    '<div class="fll-hint" style="margin:6px 0 10px">Bấm một nhóm để nhảy đến, rồi <b>n</b> / <b>p</b> đi tiếp. ' +
    'Bấm &#128263; để tắt tiếng chữ ký nhiễu — nhớ luôn cho các feedback mở sau này.</div>' +
    '<div id="fll-issue-list">' + renderIssueList() + '</div>' +
    renderTelemetryNoiseSection(data) +
    renderErrorCodeSection(data) +
    renderHttpSection();
}

// Mã lỗi đang nằm rải ở bốn nguồn (payload HTTP, params tracker, TraceParameter của Grafana, thân JSON
// của response) và không chỗ nào cộng lại. Mục này trả lời "log có những mã nào, mã nào nổ nhiều nhất,
// mã nào chỉ nổ đúng một lần" — câu hay hỏi nhất khi mở một log lạ, mà trước đây phải tự đọc từng mục
// rồi cộng tay.
function renderErrorCodeSection(data) {
  const codes = data.errorCodes || [];
  if (!codes.length) return '';
  const tong = codes.reduce((sum, item) => sum + item.count, 0);
  return secTitle('Mọi mã lỗi', codes.length + ' mã · ' + tong + ' lần', 'err') +
    '<div class="fll-hint" style="margin-bottom:8px">Bấm một mã để duyệt những dòng có nó. ' +
    'Mã <b>0</b> không tính — đó là mã của call thành công.</div>' +
    '<div class="fll-rank">' + codes
      .map((item) => '<div class="fll-rk" data-lines="' + item.indices.slice(0, 200).join(',') +
        '" data-label="mã lỗi ' + item.code + '" data-tip="' +
        escapeHtml((item.modules.length ? item.modules.join(', ') + ' · ' : '') +
          (item.firstTs ? 'lần đầu ' + formatClock(item.firstTs) : 'không có giờ')) + '">' +
        '<span>' + item.code + '</span><b style="color:var(--txt)">' + item.count + ' lần</b></div>')
      .join('') + '</div>';
}

// Đo trên 50 feedback PRODUCTION thật: 1267/2488 dòng ERROR (51%) không phải lỗi user gặp mà là lỗi
// của chính lớp đo lường, và 24/49 log có quá nửa số dòng ERROR là loại này. Để chúng lẫn trong danh
// sách thì người đọc mất một nửa thời gian vào thứ không liên quan.
// Tách ra chứ KHÔNG tự động tắt tiếng: tắt tiếng là quyết định của người đọc, và đôi khi chính lớp
// đo lường hỏng lại là manh mối.
function renderTelemetryNoiseSection(data) {
  const noise = data.groups.filter((group) => group.noiseLabel);
  if (!noise.length) return '';

  const lineCount = noise.reduce((sum, group) => sum + group.indices.length, 0);
  const byLabel = new Map();
  noise.forEach((group) => {
    byLabel.set(group.noiseLabel, (byLabel.get(group.noiseLabel) || 0) + group.indices.length);
  });
  const breakdown = Array.from(byLabel, (pair) => pair[0] + ' <b>' + pair[1] + '</b>')
    .sort()
    .join(' · ');

  return secTitle('Nhiễu từ hệ thống đo lường', noise.length) +
    '<div class="fll-note" style="background:rgba(88,196,255,.08);border-color:rgba(88,196,255,.28);' +
    'color:#bfe4ff"><span>&#9432;</span><div>' +
    '<b>' + lineCount + ' dòng</b> trong ' + noise.length + ' nhóm là lỗi của <b>chính lớp đo lường</b>, ' +
    'không phải lỗi user gặp — đã tách khỏi danh sách trên.<br>' +
    '<span style="opacity:.75">' + breakdown + '</span></div></div>' +
    '<button class="fll-btn" style="width:100%" data-act="toggleNoise">' +
    (tabUiState.showNoise ? 'Ẩn lại' : 'Vẫn muốn xem ' + noise.length + ' nhóm này') + '</button>' +
    (tabUiState.showNoise
      ? '<div style="margin-top:8px">' +
        noise.map((group) => renderGroupCard(group, data.groups.indexOf(group))).join('') + '</div>'
      : '');
}

// Đặt TRƯỚC danh sách nhóm chữ ký vì đây là loại lỗi mà danh sách đó không thể thấy: Grafana ghi ở
// mức INFO. Một log có thể không có dòng Grafana nào — lúc đó phải nói thẳng là không có, chứ để
// trống thì người đọc tưởng là "không có lỗi".
// "Log này không có X" là một khẳng định về CẢ LOG, mà các renderer lại đọc view đang lọc: lọc còn
// ERROR xong thì tab Cấu hình in "log này không có dòng cấu hình nào đọc được" trong khi cả log có 34
// khoá. Repo đã áp luật này cho hide() của tab (src/05-boot.js) — đây là áp nốt cho CÂU CHỮ.
//
// countFull trả về số lượng trong lensState.data (đầy đủ). Rỗng thật thì câu "log này không có" mới
// được phép; view rỗng mà data có thì đổi sang câu khác hẳn, kèm nút bỏ lọc.
function emptyBecauseOfFilter(countFull, whatIsMissing) {
  if (!countFull) {
    return '<div class="fll-empty">Log này không có ' + whatIsMissing + '.</div>';
  }
  return '<div class="fll-empty">Bộ lọc hiện tại không còn ' + whatIsMissing + ' nào — ' +
    'cả log có <b>' + countFull + '</b>. ' +
    '<button class="fll-chip" data-act="clearFilters">Xoá bộ lọc</button></div>';
}

function renderTraceFailSection(data) {
  const trace = data.traceIssues;
  if (!trace.available) {
    // Cùng một luật với tab Cấu hình: chỉ được nói "log này không có" khi CẢ LOG không có.
    const full = lensState.data ? lensState.data.traceIssues : trace;
    if (full !== trace && full.available) {
      return secTitle('Lỗi từ Grafana trace', 'bị lọc hết', 'warn') +
        '<div class="fll-hint" style="margin-bottom:4px">Bộ lọc hiện tại không còn dòng Grafana trace ' +
        'nào, nhưng cả log có <b>' + full.lineCount + '</b> dòng. ' +
        '<button class="fll-chip" data-act="clearFilters">Xoá bộ lọc</button></div>';
    }
    return secTitle('Lỗi từ Grafana trace', 'không có dòng nào') +
      '<div class="fll-hint" style="margin-bottom:4px">Log này <b>không có dòng Grafana trace nào</b>. ' +
      'Những dòng đó chỉ được ghi khi máy gửi feedback bật Debug Tool, nên vắng mặt là bình thường — ' +
      'chỉ là ở log này không có thêm nguồn lỗi nào ngoài các nhóm chữ ký bên dưới.</div>';
  }
  // Có dòng Grafana nhưng KHÔNG có dòng nào đi qua cờ debug (startTrace/traceFail) thì không được nói
  // "không luồng nào báo lỗi": những dòng đang có chỉ là log thường của lớp Grafana, còn đường ghi
  // traceFail chưa bao giờ được mở. README đã cảnh báo đừng nhầm available với hasGated — và trước đây
  // hasGated tính ra rồi không renderer nào đọc.
  if (!trace.hasGated) {
    return secTitle('Lỗi từ Grafana trace', 'không kết luận được', 'warn') +
      '<div class="fll-hint" style="margin-bottom:4px">Log có <b>' + trace.lineCount + '</b> dòng của lớp ' +
      'Grafana nhưng <b>không có <code>startTrace</code> hay <code>traceFail</code></b> nào — máy gửi ' +
      'feedback không bật Debug Tool nên đường ghi trace chưa từng chạy. <b>Không kết luận được</b> là ' +
      'không có lỗi; chỉ là log này không có nguồn đó.</div>';
  }
  if (!trace.fails.length) {
    return secTitle('Lỗi từ Grafana trace', 'không lỗi', 'ok') +
      '<div class="fll-hint" style="margin-bottom:4px">Có <b>' + trace.lineCount + '</b> dòng Grafana trace ' +
      'nhưng <b>không có <code>traceFail</code></b> nào — theo Grafana thì không luồng nào báo lỗi.</div>';
  }

  return secTitle('Lỗi từ Grafana trace', trace.fails.length, 'err') +
    '<div class="fll-hint" style="margin-bottom:8px">Đọc từ <code>traceFail</code> — mang sẵn ' +
    '<code>errorCode</code> và <code>errorMessage</code>, mô tả lỗi rõ hơn hầu hết dòng ERROR trong log, ' +
    'nhưng ghi ở mức <b>INFO</b> nên các nhóm chữ ký bên dưới không đếm chúng. Gom theo ' +
    '<code>errorMessage</code>: một sự cố hạ tầng hiện ra ở nhiều app khác nhau vẫn về <b>một</b> hàng.' +
    '</div>' + trace.fails.map(renderTraceFailCard).join('');
}

function renderTraceFailCard(row, rowIndex) {
  const meta = [];
  if (row.apps.length > 1) meta.push('<b>' + row.apps.length + ' app</b>');
  else if (row.apps.length === 1) meta.push(escapeHtml(row.apps[0]));
  if (row.steps.length) {
    meta.push(escapeHtml(row.steps.slice(0, 3).join(', ')) +
      (row.steps.length > 3 ? ' +' + (row.steps.length - 3) : ''));
  }
  return '<div class="fll-grp err" data-tracefail="' + rowIndex + '" data-tip="' +
    escapeHtml(row.apps.join('\n')) + '">' +
    '<div class="fll-grp-top">' +
    '<span class="fll-cnt">' + row.count + '&times;</span>' +
    (row.codes.length ? '<span class="fll-mod">code ' + escapeHtml(row.codes.join('/')) + '</span>' : '') +
    '<span class="fll-when">' + formatClock(row.firstTs) +
    (row.count > 1 ? ' &rarr; ' + formatClock(row.lastTs) : '') + '</span></div>' +
    '<div class="fll-msg">' + escapeHtml(row.key) +
    (meta.length ? '<br><span style="opacity:.6">' + meta.join(' · ') + '</span>' : '') +
    '</div></div>';
}

/* --------------------------------------------------------------------- HTTP */

function findCorrelationForEntry(entry) {
  if (!entry || !entry.correlationIds) return null;
  return entry.correlationIds.find((item) => lensState.data.correlationValueSet.has(item.value)) || null;
}

// Tìm cả trong payload chứ không chỉ trong URL: phần lớn lúc cần là dò theo một cmdId /
// request_id nhìn thấy ở dòng khác, mà giá trị đó chỉ nằm trong body.
function httpCallMatches(call, query, entries) {
  if (!query) return true;
  const head = (call.method + ' ' + call.url + ' ' + (call.status || '') + ' ' +
    (call.errorCode == null ? '' : 'e' + call.errorCode)).toLowerCase();
  if (head.indexOf(query) >= 0) return true;
  const req = call.reqIndex != null ? entries[call.reqIndex] : null;
  if (req && req.raw.toLowerCase().indexOf(query) >= 0) return true;
  const res = call.resIndex != null ? entries[call.resIndex] : null;
  return !!res && res.raw.toLowerCase().indexOf(query) >= 0;
}

function renderHttpCall(call, data) {
  let statusClass = 'fll-st';
  let statusText = call.status ? String(call.status) : '?';
  if (call.resIndex === null) {
    statusClass += ' wait';
    statusText = 'no res';
  } else if ((call.status && call.status >= 400) || (call.errorCode != null && call.errorCode !== 0)) {
    statusClass += ' bad';
    if (call.errorCode != null && call.errorCode !== 0) statusText = 'e' + call.errorCode;
  }
  // Hai đầu có payload khác nhau: --header / --encrypted nằm ở dòng request, --status ở dòng response.
  // Trước đây chỉ mở được dòng response nên phần header không bao giờ xem được từ đây.
  const payloadIndex = call.resIndex != null ? call.resIndex : call.reqIndex;
  const correlation = findCorrelationForEntry(data.entries[payloadIndex]);
  const payloadButton = '<button class="fll-ico fll-mini" data-act="payload" data-req="' +
    (call.reqIndex == null ? '' : call.reqIndex) + '" data-res="' +
    (call.resIndex == null ? '' : call.resIndex) + '" data-tip="Xem payload request / response">{ }</button>';
  return '<div class="fll-call" data-call="' + data.httpCalls.indexOf(call) + '">' +
    '<span class="fll-verb">' + escapeHtml(call.method) + '</span>' +
    '<span class="' + statusClass + '">' + escapeHtml(statusText) + '</span>' +
    '<span class="fll-path" data-tip="' + escapeHtml(call.url) + '">' + escapeHtml(call.path) + '</span>' +
    '<span class="fll-dur">' + (call.duration != null ? formatDuration(call.duration) : call.time.slice(0, 8)) +
    '</span>' +
    payloadButton +
    (correlation ? '<button class="fll-ico fll-mini" data-act="correlate" data-value="' +
      escapeHtml(correlation.value) + '" data-tip="Gom theo ' + correlation.key + '">&#128279;</button>' : '') +
    '</div>';
}

function renderHttpList() {
  const data = getView();
  const pool = tabUiState.httpOnlyBad ? data.badHttpCalls : data.httpCalls;
  const query = tabUiState.httpQuery.trim().toLowerCase();
  const calls = pool.filter((call) => httpCallMatches(call, query, data.entries));
  if (!calls.length) {
    return '<div class="fll-empty">' + (query ? 'Không request nào khớp.' : 'Không có request nào.') + '</div>';
  }
  const count = query ? '<div class="fll-hint" style="margin:0 0 8px">Khớp <b>' + calls.length + '</b>/' +
    pool.length + ' request.</div>' : '';
  return count + calls.map((call) => renderHttpCall(call, data)).join('');
}

// Không còn là một tab: "call nào hỏng" và "lỗi gì đã nổ" là cùng một câu hỏi, trước phải mở hai tab
// mới ghép lại được. Nay là hai mục cạnh nhau trong tab Vấn đề.
function renderHttpSection() {
  const data = getView();
  return secTitle('Call HTTP', data.badHttpCalls.length
    ? data.badHttpCalls.length + '/' + data.httpCalls.length + ' bất thường'
    : data.httpCalls.length, data.badHttpCalls.length ? 'err' : '') +
    '<div class="fll-row" style="margin-bottom:9px">' +
    '<button class="fll-chip' + (tabUiState.httpOnlyBad ? '' : ' on') + '" data-act="httpAll">Tất cả <em>' +
    data.httpCalls.length + '</em></button>' +
    '<button class="fll-chip' + (tabUiState.httpOnlyBad ? ' on' : '') + '" data-act="httpBad">Bất thường <em>' +
    data.badHttpCalls.length + '</em></button></div>' +
    '<input class="fll-in" id="fll-httpq" placeholder="Tìm theo URL, method, status hoặc nội dung payload..." ' +
    'value="' + escapeHtml(tabUiState.httpQuery) + '">' +
    '<div class="fll-hint" style="margin:6px 0 10px">Bất thường = status &ge; 400, errorCode khác 0, ' +
    'hoặc request không tìm thấy response. <b>{ }</b> mở payload (đổi qua lại request / response), ' +
    '<b>&#128279;</b> gom mọi dòng cùng ID.</div>' +
    '<div id="fll-http-list">' + renderHttpList() + '</div>' +
    renderTrackerFailSection(data);
}

// Nguồn thứ hai cho cùng câu hỏi "call nào hỏng": ops_receive_be do chính app ghi, có sẵn
// status/error_code/duration. Không trộn vào bảng trên vì hai bên đếm theo hai cách khác nhau
// (bảng trên ghép dòng [Method:] req/res, đây khử trùng theo trace_id) — để cạnh nhau mới đối chiếu được.
function renderTrackerFailSection(data) {
  const journey = data.journey;
  if (!journey.fails.length) return '';
  // Badge phải nói rõ đơn vị: fails là số NHÓM chữ ký, apiFail là số LẦN fail thật. Hai số lệch nhau
  // nhiều (đo trên log thật: 12 nhóm / 25 lần) nên ghi một số trơn sẽ bị đọc nhầm thành số kia.
  return secTitle('Call BE fail — theo tracker',
    journey.fails.length + ' nhóm · ' + journey.apiFail + ' lần', 'err') +
    '<div class="fll-hint" style="margin-bottom:8px">Lấy từ <code>ops_receive_be</code> có ' +
    '<code>status=fail</code>. Đây là nguồn khác với bảng trên (bảng đó đọc dòng <code>[Method:]</code>) ' +
    'nên hai bên lệch nhau là bình thường: log này có <b>' + journey.apiTotal + '</b> call theo tracker ' +
    'và <b>' + data.httpCalls.length + '</b> call theo dòng HTTP.</div>' +
    journey.fails.map(renderTrackerFailRow).join('');
}

/* --------------------------------------------------------------------- Chậm */

// Khác hẳn mục "Ở lâu nhất trên màn": đây là thời gian TẢI màn, số có sẵn trong log chứ không phải
// số tính ra. Đặt trước vì nó trả lời thẳng câu "màn nào tải lâu", còn bảng dưới là mọi con số thô.
function renderScreenLoadSection(view) {
  const rows = view.journey.screenLoads;
  if (!rows.length) return '';
  const peak = rows[0].worstMs;
  return secTitle('Màn tải lâu nhất', rows.length) +
    '<div class="fll-hint" style="margin-bottom:8px">Số <b>có sẵn trong log</b> — trường ' +
    '<code>duration</code> của <code>auto_screen_displayed</code> (lúc <code>state=load</code>) và ' +
    '<code>auto_load_progress_tracked</code>. Hiện lần chậm nhất; ngoặc là số lần đo và trung bình.</div>' +
    '<div class="fll-rank">' + rows
      .map((row) => {
        const color = row.worstMs >= 3000 ? LEVEL_COLOR.ERROR
          : row.worstMs >= 1000 ? LEVEL_COLOR.WARNING : LEVEL_COLOR.INFO;
        return '<div class="fll-rk" data-jload="' + escapeHtml(row.key) + '">' +
          '<u style="width:' + ((row.worstMs / peak) * 100).toFixed(1) + '%;background:' + color + '22"></u>' +
          '<span>' + escapeHtml(row.key) + '</span>' +
          '<b style="color:' + color + '">' + formatDuration(row.worstMs) + '</b>' +
          '<b>' + row.count + '× · tb ' + formatDuration(row.avgMs) + '</b></div>';
      })
      .join('') + '</div>';
}

// Không còn là một tab: ba mục này đều là "số rút từ log" y hệt các mục khác của Tổng quan, tách ra
// một tab riêng chỉ bắt người đọc nhảy qua lại. Từ khi mỗi mục tự thu lại được thì một tab nhiều mục
// không còn đắt chỗ nữa.
function renderSlowSections() {
  const view = getView();
  const rows = view.durations;
  const header = renderScreenLoadSection(view) + renderScreenDwellSection(view) +
    secTitle('Mọi con số thời lượng', rows.length) +
    '<div class="fll-hint" style="margin-bottom:10px">Mọi con số thời lượng rút được từ log ' +
    '(<code>duration=</code>, <code>in Nms</code>, <code>duration KMM</code>, <code>totalWaited</code>), ' +
    'xếp giảm dần. Giá trị trên ' + MAX_PLAUSIBLE_DURATION_MS / 1000 + 's bị bỏ vì log có chỗ ghi nhầm ' +
    'epoch vào <code>duration=</code>.</div>';
  if (!rows.length) return header + '<div class="fll-empty">Không tìm thấy trường thời lượng nào.</div>';

  const peak = rows[0].ms;
  return header + rows
    .map((row) => {
      const color = row.ms >= 3000 ? LEVEL_COLOR.ERROR : row.ms >= 1000 ? LEVEL_COLOR.WARNING : LEVEL_COLOR.INFO;
      return '<div class="fll-slow" data-jump="' + row.domIndex + '">' +
        '<u style="width:' + ((row.ms / peak) * 100).toFixed(1) + '%;background:' + color + '22"></u>' +
        '<span class="fll-slow-ms" style="color:' + color + '">' + formatDuration(row.ms) + '</span>' +
        '<span class="fll-slow-txt">' + escapeHtml(row.message.slice(0, 110)) + '</span>' +
        '<span class="fll-dur">' + escapeHtml(row.time.slice(0, 8)) + '</span></div>';
    })
    .join('');
}

/* ----------------------------------------- mảnh dùng chung cho hành trình user */

// Ba mảnh dưới đây không còn tab riêng: chúng nằm trong tab đã có đúng chủ đề của chúng —
// "user thấy gì" + "chạm nhiều nhất" ở Tổng quan, "call BE fail" ở Vấn đề, "ở lâu trên màn" ở phần Chậm.
// Bản thân dòng thời gian thì trộn thẳng vào tab Diễn biến.
function renderSawCard(row, rowIndex) {
  return '<div class="fll-grp err" data-saw="' + rowIndex + '">' +
    '<div class="fll-grp-top">' +
    '<span class="fll-cnt">' + row.count + '&times;</span>' +
    '<span class="fll-when">' + formatClock(row.firstTs) +
    (row.count > 1 ? ' &rarr; ' + formatClock(row.lastTs) : '') + '</span></div>' +
    '<div class="fll-msg">' + escapeHtml(row.key) +
    (row.detail ? '<br><span style="opacity:.6">' + escapeHtml(row.detail) + '</span>' : '') +
    '</div></div>';
}

function renderTrackerFailRow(row, rowIndex) {
  return '<div class="fll-call" data-apifail="' + rowIndex + '">' +
    '<span class="fll-st bad">' + row.count + '&times;</span>' +
    '<span class="fll-path" style="direction:ltr">' + escapeHtml(row.key) + '</span>' +
    '<span class="fll-dur">' + escapeHtml(row.detail.slice(0, 60)) + '</span></div>';
}

function renderScreenDwellSection(view) {
  const screens = view.journey.screens.filter((row) => row.ms > 0);
  if (!screens.length) return '';
  const peak = Math.max(1, screens[0].ms);
  return secTitle('Ở lâu nhất trên màn', screens.length) +
    '<div class="fll-hint" style="margin-bottom:8px"><b>Tổng</b> thời gian ở trên màn đó, cộng qua các ' +
    'lần vào. Số <b>tính ra</b> từ khoảng cách tới bước màn hình kế tiếp chứ không có sẵn trong log — ' +
    'nên khoảng cách vắt qua hai phiên app, hoặc dài quá ' + MAX_PLAUSIBLE_DURATION_MS / 60000 +
    ' phút (app nằm dưới nền chứ không phải người dùng ngồi nhìn), đều bị bỏ.</div>' +
    '<div class="fll-rank">' + screens
      .map((row) => '<div class="fll-rk" data-jscreen="' + escapeHtml(row.key) + '" data-tip="' +
        row.count + ' lần vào, lần lâu nhất ' + formatDuration(row.maxMs) + '">' +
        '<u style="width:' + ((row.ms / peak) * 100).toFixed(1) + '%"></u>' +
        '<span>' + escapeHtml(row.key) + '</span>' +
        '<b>' + formatDuration(row.ms) + (row.count > 1 ? ' &middot; ' + row.count + ' lần' : '') +
        '</b></div>')
      .join('') + '</div>';
}

/* ---------------------------------------------------------------------- Lọc */

function renderModuleChips() {
  const query = tabUiState.moduleQuery.toLowerCase();
  // Đếm theo các điều kiện KHÁC, bỏ qua chính điều kiện module: có thể đổi module đang chọn.
  const tally = tallyFacetCandidates('modules', (entry) => entry.module);
  lensState.filter.modules.forEach((name) => {
    if (!tally.has(name)) tally.set(name, 0);
  });
  const modules = Array.from(tally, (pair) => ({ key: pair[0], count: pair[1] }))
    .filter((row) => !query || row.key.toLowerCase().indexOf(query) >= 0)
    .sort((a, b) => b.count - a.count);
  if (!modules.length) return '<div class="fll-hint">Không có module nào khớp.</div>';
  return modules
    .map((row) => '<button class="fll-chip' + (lensState.filter.modules.has(row.key) ? ' on' : '') +
      '" data-act="tglModule" data-value="' + escapeHtml(row.key) + '">' + escapeHtml(row.key) +
      ' <em>' + row.count + '</em></button>')
    .join('');
}

function renderSessionChips() {
  const sessions = lensState.data.sessions;
  if (sessions.length < 2) return '';
  const picked = lensState.filter.session;
  return secTitle('Phiên app', picked ? sessionLabel(picked) : sessions.length + ' phiên', picked ? 'act' : '') +
    renderSessionChipRow();
}

// Chỉ riêng dãy chip, không kèm tiêu đề mục: tab Diễn biến không chia mục nên phải đặt thẳng chip vào
// hàng công cụ, còn tab Lọc thì bọc thêm tiêu đề ở trên.
function renderSessionChipRow() {
  const sessions = lensState.data.sessions;
  if (sessions.length < 2) return '';
  const tally = tallyFacetCandidates('session', (entry) => entry.session);
  return '<div class="fll-lvkey">' +
    sessions
      .map((session) => {
        const count = tally.get(session.index) || 0;
        // Đoạn mồ côi không có "bắt đầu" để ghi: mốc duy nhất biết chắc là chỗ nó kết thúc.
        const tip = session.isOrphanTail
          ? SESSION_ORPHAN_TIP + ' Đoạn này kết thúc lúc ' + formatClock(session.endTs) + '.'
          : 'Bắt đầu ' + formatClock(session.startTs);
        // data-aim: rê chuột lên chip thì mũi tên chỉ thẳng ra chỗ phiên đó BẮT ĐẦU trên minimap,
        // giống hệt rê lên một hàng trong danh sách. Bấm vào vẫn là lọc theo phiên — xem chú thích
        // của data-aim trong aimIndicesFor().
        return '<button class="fll-chip' + (lensState.filter.session === session.index ? ' on' : '') +
          (count ? '' : ' dim') + (session.isOrphanTail ? ' fll-chip-orphan' : '') +
          '" data-act="setSession" data-value="' + session.index +
          '" data-aim="' + session.firstIndex +
          '" data-tip="' + escapeHtml(tip) + '">' + escapeHtml(sessionLabel(session.index)) +
          ' <em>' + count + '</em></button>';
      })
      .join('') +
    '<button class="fll-chip' + (lensState.filter.session ? '' : ' on') +
    '" data-act="setSession" data-value="0">Tất cả</button></div>';
}

// Mục này là ngoại lệ duy nhất trong panel: CHUỖI của một ID không bao giờ bị cắt theo bộ lọc, vì
// xem một cmdId đi qua mấy lớp mà thiếu mất vài lớp thì đúng là thứ làm người đọc kết luận sai.
//
// Nhưng "không cắt chuỗi" không có nghĩa là "không cắt danh sách". Trước đây mục này liệt kê MỌI ID
// của cả log kể cả khi đang bật cửa sổ thời gian, trong khi mọi mục xung quanh đều theo bộ lọc — và
// không có một dòng chữ nào nói ra chuyện đó. Nay danh sách chỉ giữ ID nào CÓ ÍT NHẤT MỘT DÒNG nằm
// trong tập đang xem; bấm vào thì vẫn mở trọn chuỗi như cũ, và chữ ngay dưới nói rõ điều đó.
function correlationBucketsInView() {
  const buckets = lensState.data.correlations;
  const view = getView();
  if (view === lensState.data) return buckets;
  const inView = new Set(view.scopedEntries.map((entry) => entry.domIndex));
  return buckets.filter((bucket) => bucket.indices.some((index) => inView.has(index)));
}

// Ô tìm regex vốn đã là bộ trích xuất vạn năng, chỉ thiếu bước gom: nó hiện ra DÒNG chứ không hiện ra
// GIÁ TRỊ. Mục này chỉ xuất hiện khi mẫu có nhóm bắt — tức chỉ khi người dùng đã cố ý hỏi "liệt kê giá
// trị", nên không tốn gì cho những lần tìm bình thường.
function renderCaptureSection(result) {
  const tally = buildCaptureTally(result.visible);
  if (!tally || !tally.values.length) return '';
  const gioiHan = (tally.cappedLines ? ' · chỉ quét ' + tally.scannedLines + ' dòng đầu' : '') +
    (tally.cappedValues ? ' · đã cắt ở ' + tally.values.length + ' giá trị' : '');
  return secTitle('Giá trị bắt được', tally.values.length + ' giá trị · ' + tally.total + ' lần', 'act') +
    '<div class="fll-hint" style="margin-bottom:8px">Nhóm bắt đầu tiên trong mẫu regex, gom theo giá ' +
    'trị' + gioiHan + '. Bấm một giá trị để duyệt những dòng có nó.</div>' +
    '<div class="fll-rank">' + tally.values
      .map((item) => '<div class="fll-rk" data-lines="' + item.indices.slice(0, 100).join(',') +
        '" data-label="' + escapeHtml(item.value.slice(0, 40)) + '" data-tip="' +
        escapeHtml(item.value) + '">' +
        '<span>' + escapeHtml(envShortValue(item.value)) + '</span>' +
        '<b style="color:var(--txt)">' + item.count + '</b></div>')
      .join('') + '</div>';
}

function renderCorrelationList() {
  const all = lensState.data.correlations;
  if (!all.length) return '';
  const buckets = correlationBucketsInView();
  const isScoped = buckets.length !== all.length;
  const note = isScoped
    ? 'Đang lọc nên chỉ liệt kê <b>' + buckets.length + '</b>/' + all.length +
      ' ID còn dòng trong tập đang xem — nhưng bấm vào vẫn mở <b>trọn</b> chuỗi, kể cả những dòng bộ lọc đang giấu.'
    : 'Một ID xuất hiện ở nhiều dòng là một request đi qua nhiều lớp. Bấm để xem trọn chuỗi.';
  const body = buckets.length
    ? '<div class="fll-rank">' + buckets
      .map((bucket) => '<div class="fll-rk" data-act="correlate" data-value="' + escapeHtml(bucket.value) + '">' +
        '<u style="width:' + ((bucket.indices.length / buckets[0].indices.length) * 100).toFixed(1) + '%"></u>' +
        '<span>' + escapeHtml(bucket.key) + ' · ' + escapeHtml(bucket.value.slice(-16)) + '</span>' +
        '<b>' + bucket.indices.length + '</b></div>')
      .join('') + '</div>'
    : emptyBecauseOfFilter(all.length, 'ID nào');
  return secTitle('Gom theo ID', isScoped ? buckets.length + '/' + all.length : buckets.length,
    isScoped ? 'act' : '') +
    '<div class="fll-hint" style="margin-bottom:8px">' + note + '</div>' + body;
}

// Mẫu bộ lọc dùng chung định dạng với permalink, chỉ khác là nằm trong localStorage
// và không kéo theo tab/dòng đang đứng — những thứ đó vô nghĩa ở feedback khác.
function renderTemplateSection() {
  const templates = lensState.filterTemplates;
  const canSave = hasAnyFilterFacet();
  const suggestion = suggestTemplateName();

  const chips = templates.length
    ? '<div class="fll-lvkey" style="margin-bottom:8px">' + templates
      .map((template) => '<span class="fll-fchip fll-tpl" data-tip="' +
        escapeHtml(describeTemplatePayload(template.payload)) + '">' +
        '<b data-act="applyTemplate" data-value="' + escapeHtml(template.name) + '">' +
        escapeHtml(template.name) + '</b>' +
        '<button data-act="deleteTemplate" data-value="' + escapeHtml(template.name) +
        '" data-tip="Xoá mẫu">&times;</button></span>')
      .join('') + '</div>'
    : '<div class="fll-hint" style="margin-bottom:8px">Chưa có mẫu nào. Đặt điều kiện rồi lưu lại ' +
      'để lần sau áp một phát.</div>';

  return secTitle('Mẫu bộ lọc', lensState.filterTemplates.length) + chips +
    '<div class="fll-row">' +
    '<input class="fll-in" id="fll-tplname" style="flex:1;min-width:140px" value="' +
    escapeHtml(tabUiState.templateName) + '" placeholder="' +
    escapeHtml(suggestion || 'Đặt điều kiện trước đã...') + '"' + (canSave ? '' : ' disabled') + '>' +
    '<button class="fll-btn" data-act="saveTemplate"' + (canSave ? '' : ' disabled') + '>Lưu mẫu</button>' +
    '</div>' +
    (canSave ? '' : '<div class="fll-hint" style="margin-top:6px">Chỉ lưu được khi đang có ít nhất ' +
      'một điều kiện.</div>');
}

function renderFilterTab() {
  const data = lensState.data;
  const filter = lensState.filter;
  const result = getFilterResult();
  // Chip đếm kiểu faceted: bỏ qua chính điều kiện của nó, nếu không thì chọn ERROR xong
  // chip WARNING về 0 và không còn đường nới rộng lại.
  const levelTally = tallyFacetCandidates('levels', (entry) => entry.level);

  const hasWindow = filter.timeFrom !== null || filter.timeTo !== null;
  return renderTemplateSection() +
    secTitle('Cửa sổ thời gian', hasWindow ? formatWindowLabel() : 'toàn bộ', hasWindow ? 'act' : '') +
    renderWindowChips(true) +
    renderSessionChips() +

    secTitle('Mức độ', filter.levels.size ? Array.from(filter.levels).join(' + ') : 'tất cả',
      filter.levels.size ? 'act' : '') +
    '<div class="fll-lvkey">' + LEVEL_ORDER
      .map((level) => '<button class="fll-chip' + (filter.levels.has(level) ? ' on' : '') +
        '" data-act="tglLevel" data-value="' + level + '">' +
        '<i class="fll-sw" style="background:' + LEVEL_COLOR[level] + '"></i>' + level +
        ' <em>' + (levelTally.get(level) || 0) + '</em></button>')
      .join('') + '</div>' +

    secTitle('Module', filter.modules.size ? 'đã chọn ' + filter.modules.size : data.modules.length,
      filter.modules.size ? 'act' : '') +
    '<input class="fll-in" id="fll-modq" placeholder="Tìm module..." value="' +
    escapeHtml(tabUiState.moduleQuery) + '" style="margin-bottom:7px">' +
    '<div class="fll-lvkey" id="fll-mod-list" style="max-height:150px;overflow-y:auto">' +
    renderModuleChips() + '</div>' +

    secTitle('Tìm trong nội dung',
      filter.text ? (filter.useRegex ? '/' + filter.text + '/' : '"' + filter.text + '"') : 'chưa đặt',
      filter.text ? 'act' : '') +
    '<input class="fll-in' + (result.isBadPattern ? ' bad' : '') + '" id="fll-re" placeholder="' +
    (filter.useRegex ? 'Regex, ví dụ: timeout|retry|88\\d{7}' : 'Chuỗi con...') + '" value="' +
    escapeHtml(filter.text) + '">' +
    '<div class="fll-row" style="margin-top:7px">' +
    '<button class="fll-chip' + (filter.useRegex ? ' on' : '') + '" data-act="tglRegex">Regex</button>' +
    '<button class="fll-chip' + (filter.hideOthers ? ' on' : '') +
    '" data-act="tglHide">Ẩn dòng không khớp</button></div>' +
    (result.isBadPattern ? '<div class="fll-hint" style="color:var(--err)">Regex không hợp lệ.</div>' : '') +
    renderCaptureSection(result) +

    renderCorrelationList() +

    secTitle('Kết quả', result.visible.length + '/' + data.entries.length,
      result.visible.length === data.entries.length ? '' : 'act') +
    '<div class="fll-hint" style="margin-bottom:10px">Đang hiện <b id="fll-count" style="color:var(--txt)">' +
    result.visible.length + '</b> / ' + data.entries.length + ' dòng.</div>' +
    '<div class="fll-row">' +
    '<button class="fll-btn pri" data-act="applyFilter">Duyệt kết quả</button>' +
    '<button class="fll-btn" data-act="copySummary" data-tip="Khối markdown gọn để dán thẳng vào ' +
    'ticket: máy, bản app, nhóm lỗi, call fail, các bước cuối, nhánh A/B, và cả những gì log KHÔNG ' +
    'trả lời được.">Copy tóm tắt</button>' +
    '<button class="fll-btn" data-act="copyVisible">Copy dòng đang hiện</button>' +
    '<button class="fll-btn" data-act="copyLink">Copy link</button>' +
    '<button class="fll-btn" data-act="resetFilter">Xoá lọc</button></div>';
}

/* ---------------------------------------------------------------- Diễn biến */

// Trước đây đây là tab "Timeline" chỉ có 3 loại mốc của APP (khởi động / khoảng lặng / nhóm lỗi):
// 29 mốc, tab mỏng nhất trong cả panel. Bước tương tác của user từng nằm ở một tab riêng — nhưng cả hai
// đều là "sắp theo timestamp thật rồi vẽ .fll-tl", tức cùng một thứ với hai nguồn khác nhau, và phải
// nhảy qua lại giữa hai tab mới ghép được câu "user bấm gì -> app đứng im -> lỗi gì". Trộn làm một.
// Trước đây loại mốc chỉ phân biệt bằng MÀU của một chấm tròn 7px ở lề trái. Màu không tự nói ra
// nghĩa: người đọc phải nhớ "hồng là chạm, xanh là màn hình" — không ai nhớ. Nay mỗi loại có một biểu
// tượng + một cái tên, và có cả hàng chú giải ngay trên danh sách.
const TIMELINE_KINDS = {
  boot: { icon: '\uD83D\uDE80', label: 'App khởi động', short: 'Khởi động' },
  gap: { icon: '\uD83D\uDCA4', label: 'Khoảng lặng, không có log', short: 'Lặng' },
  'gap-bg': { icon: '\uD83C\uDF19', label: 'App xuống nền (không phải treo)', short: 'Xuống nền' },
  err: { icon: '\u274C', label: 'Nhóm lỗi', short: 'Lỗi' },
  'jr-screen': { icon: '\uD83D\uDCF1', label: 'Màn hình hiện ra', short: 'Màn hình' },
  'jr-move': { icon: '\uD83D\uDD00', label: 'Đổi luồng tính năng', short: 'Đổi luồng' },
  'jr-tap': { icon: '\uD83D\uDC46', label: 'User chạm', short: 'Chạm' },
  'jr-saw': { icon: '\uD83D\uDC40', label: 'User nhìn thấy popup', short: 'Popup' },
  'jr-fail': { icon: '\u26A0\uFE0F', label: 'Call BE fail', short: 'Call fail' },
};

// Trước đây đây là sáu nhóm thô (App / Màn hình / Chạm / User thấy / API fail) trong khi mốc thì có
// tám loại — "App" gom cả khởi động, khoảng lặng và nhóm lỗi vào một chỗ. Nay chip chính là từng loại
// mốc, mang đúng biểu tượng của nó, và chọn được nhiều loại cùng lúc. Hàng chú giải riêng bỏ đi:
// chip đã vừa là chú giải vừa là bộ lọc.
const TIMELINE_KIND_ORDER = ['boot', 'gap', 'gap-bg', 'err', 'jr-screen', 'jr-move', 'jr-tap',
  'jr-saw', 'jr-fail'];

function timelineIcon(kind) {
  const meta = TIMELINE_KINDS[kind];
  if (!meta) return '';
  return '<span class="fll-ev-ic" data-tip="' + escapeHtml(meta.label) + '">' + meta.icon + '</span>';
}

function buildTimelineEvents(data) {
  const events = [];

  data.scopedEntries.forEach((entry) => {
    if (entry.isSessionStart) {
      events.push({ ts: entry.ts, kind: 'boot', title: 'App khởi động — phiên ' + entry.session,
        detail: entry.message, index: entry.domIndex });
    }
  });

  // Khoảng lặng là một KHOẢNG, không phải một điểm. Trước đây hàng này hiện giờ của dòng TRƯỚC khoảng
  // lặng nhưng bấm (và mũi tên) lại trỏ tới dòng SAU nó — hai đầu cách nhau cả tiếng đồng hồ, nên nhìn
  // vào thấy giao diện tự mâu thuẫn. Nay hiện cả hai mốc, và mũi tên đánh dấu cả hai đầu trên minimap.
  //
  // Hàng này ứng với HAI dòng log, nên nó đưa cả hai vào thanh duyệt (`data-lines`) chứ không nhảy tới
  // một dòng: bấm là tới dòng dừng lại, bấm `n` là sang thẳng dòng mở lại. Bản trước nhảy thẳng tới
  // dòng SAU khoảng lặng trong khi chữ trên hàng là của dòng TRƯỚC, và không có đường nào xem dòng kia.
  data.gaps.forEach((gap) => {
    // Xuống nền và treo là HAI chuyện khác hẳn nhau; gọi chung một tên thì đọc log thành đoán mò.
    const isBackground = gap.cause === 'background';
    events.push({ ts: gap.before.ts, tsEnd: gap.after.ts, kind: isBackground ? 'gap-bg' : 'gap',
      title: (isBackground ? 'App xuống nền ' : 'Khoảng lặng ') + formatDuration(gap.ms),
      detail: isBackground
        ? 'xuống nền ' + formatClock(gap.downTs) + ', trở lại ' + formatClock(gap.upTs) +
          ' — im lặng vì user rời app, không phải app treo'
        : 'dừng sau: ' + gap.before.message.slice(0, 90),
      lines: [gap.before.domIndex, gap.after.domIndex],
      linesLabel: isBackground ? 'hai đầu đoạn xuống nền' : 'hai đầu khoảng lặng' });
  });

  data.groups.filter((group) => group.level === 'ERROR' && !isGroupMuted(group)).forEach((group) => {
    events.push({ ts: group.firstTs, kind: 'err',
      title: group.indices.length + '× ' + (group.module || 'ERROR'),
      detail: group.sample.slice(0, 90), index: group.indices[0] });
  });

  // "Đổi luồng" (feature_source) đi chung nhóm với màn hình: nó cũng là chuyện dịch chuyển, và tách
  // ra thành chip thứ bảy thì hàng chip bắt đầu cuộn ngang.
  data.journey.steps.forEach((step) => {
    events.push({ ts: step.ts, kind: 'jr-' + step.kind,
      title: step.label, detail: [step.detail, step.note].filter(Boolean).join(' · '),
      index: step.domIndex, count: step.count, ms: step.ms });
  });

  return events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

function renderTimelineTab() {
  const data = getView();
  const all = buildTimelineEvents(data);
  const picked = tabUiState.tlKinds;

  let header = '<div class="fll-row" style="margin-bottom:9px">' +
    '<button class="fll-chip' + (picked.size ? '' : ' on') + '" data-act="tlKindAll">Tất cả <em>' +
    all.length + '</em></button>' +
    TIMELINE_KIND_ORDER
      .map((kind) => ({ kind, count: all.filter((event) => event.kind === kind).length }))
      .filter((row) => row.count)
      .map((row) => '<button class="fll-chip' + (picked.has(row.kind) ? ' on' : '') +
        '" data-act="tlKind" data-value="' + row.kind + '" data-tip="' +
        escapeHtml(TIMELINE_KINDS[row.kind].label) + '"><i class="fll-chip-ic">' +
        TIMELINE_KINDS[row.kind].icon + '</i>' + escapeHtml(TIMELINE_KINDS[row.kind].short) +
        ' <em>' + row.count + '</em></button>')
      .join('') + '</div>';

  // Lọc theo phiên ngay tại đây. Trước đó muốn xem riêng một phiên phải sang tab Lọc rồi quay lại —
  // mà dòng thời gian chính là chỗ để ý "phiên này khác phiên kia chỗ nào" nhất.
  const sessionRow = renderSessionChipRow();
  if (sessionRow) header += '<div style="margin-bottom:9px">' + sessionRow + '</div>';

  // Chip ngưỡng khoảng lặng chỉ có nghĩa khi mốc khoảng lặng đang hiện.
  if (!picked.size || picked.has('gap')) {
    header += '<div class="fll-row" style="margin-bottom:9px">' +
      [1000, 2000, 5000, 10000]
        .map((ms) => '<button class="fll-chip' + (lensState.gapThresholdMs === ms ? ' on' : '') +
          '" data-act="setGap" data-value="' + ms + '">lặng &ge; ' + ms / 1000 + 's</button>')
        .join('') + '</div>';
  }

  // Bốn con số ở đầu đoạn này đã nằm sẵn trên chip và trên phụ đề panel. Giữ lại một câu — cái duy
  // nhất không nhìn ra được từ giao diện.
  header += '<div class="fll-hint" style="margin:0 0 10px" data-tip="Bước tương tác đọc từ event ' +
    'MoMoTracker, đều ghi ở mức INFO nên tab Vấn đề không đếm chúng.">Sắp theo thời gian thật, ' +
    'không theo thứ tự dòng. Bước giống hệt nhau cách nhau dưới 1s gộp thành <b>N&times;</b> — ' +
    'bấm vẫn duyệt đủ từng dòng.' +
    (data !== lensState.data
      ? ' <b>Khoảng lặng chỉ cắt theo cửa sổ thời gian</b>, không đổi theo mức độ hay module.'
      : '') + '</div>';

  header += '<input class="fll-in" id="fll-tlq" placeholder="Tìm trong mốc — tên màn, tên nút, mã lỗi..." ' +
    'value="' + escapeHtml(tabUiState.tlQuery) + '" style="margin-bottom:9px">';

  return header + '<div id="fll-tl-list">' + renderTimelineList() + '</div>';
}

// Tách riêng để ô tìm chỉ vẽ lại danh sách, không đụng tới chip và chú giải ở trên — gõ một phím mà
// vẽ lại cả tab thì mất luôn tiêu điểm trong ô đang gõ.
function renderTimelineList() {
  const data = getView();
  const all = buildTimelineEvents(data);
  const picked = tabUiState.tlKinds;
  const grouped = picked.size ? all.filter((event) => picked.has(event.kind)) : all;
  const query = tabUiState.tlQuery.trim().toLowerCase();
  const events = query
    ? grouped.filter((event) => (event.title + ' ' + (event.detail || '')).toLowerCase().indexOf(query) >= 0)
    : grouped;

  if (!events.length) {
    return '<div class="fll-empty">' +
      (query ? 'Không mốc nào khớp "' + escapeHtml(tabUiState.tlQuery) + '".' : 'Không có mốc nào đáng chú ý.') +
      '</div>';
  }
  const found = query
    ? '<div class="fll-hint" style="margin:0 0 8px">Khớp <b>' + events.length + '</b>/' + grouped.length +
      ' mốc.</div>'
    : '';

  const shown = events.slice(0, tabUiState.tlLimit);
  return found + '<div class="fll-tl">' + shown
    .map((event) => '<div class="fll-ev ' + event.kind + '"' +
      (event.lines
        ? ' data-lines="' + event.lines.join(',') + '" data-label="' + escapeHtml(event.linesLabel) + '"'
        : ' data-jump="' + event.index + '"') + '>' +
      '<div class="fll-ev-t">' + timelineIcon(event.kind) +
      (event.count > 1 ? '<span class="fll-jn">' + event.count + '&times;</span>' : '') +
      escapeHtml(event.title) +
      (event.ms >= 1000 ? '<span class="fll-jms">' + formatDuration(event.ms) + '</span>' : '') +
      '<em>' + formatClock(event.ts) +
      (event.tsEnd ? ' &rarr; ' + formatClock(event.tsEnd) : '') + '</em></div>' +
      (event.detail ? '<div class="fll-ev-d">' + escapeHtml(event.detail) + '</div>' : '') +
      '</div>')
    .join('') + '</div>' +
    (events.length > shown.length
      ? '<button class="fll-btn" style="width:100%;margin-top:8px" data-act="moreTimeline">Hiện thêm — còn ' +
        (events.length - shown.length) + ' mốc</button>'
      : '');
}
/* ---------------------------------------------------------------- Cấu hình */

// Một dòng config có thể dài 5000 ký tự. Hàng chỉ hiện một đoạn; muốn xem hết thì bấm "JSON" để
// mở tấm trượt dựng sẵn (nó đã biết cắt khối JSON ra khỏi dòng log và tô màu).
function renderConfigValue(item, value, isLatest) {
  const json = value.hasJson
    ? '<button class="fll-btn fll-cfg-js" data-act="json" data-value="' + value.domIndex + '">JSON</button>'
    : '';
  // data-lines chứ không phải data-jump: một giá trị có thể được ghi lại nhiều lần, bấm vào phải
  // duyệt được cả chùm bằng n/p ở thanh dưới chứ không dừng lại ở dòng đầu tiên.
  return '<div class="fll-cfg-val' + (isLatest ? ' last' : '') +
    '" data-lines="' + value.indices.join(',') + '" data-label="' + escapeHtml(item.key) + '">' +
    '<div class="fll-cfg-vm">' + escapeHtml(value.time.slice(0, 8)) + ' · dòng ' + value.lineNo +
    (value.indices.length > 1 ? ' · ' + value.indices.length + ' dòng' : '') +
    (isLatest && item.values.length > 1 ? ' · mới nhất' : '') + '</div>' +
    '<div class="fll-cfg-v">' + escapeHtml(value.value.slice(0, 260)) +
    (value.value.length > 260 ? '…' : '') + '</div>' + json + '</div>';
}

// Một dòng config có thể dài 5000 ký tự. Hàng chỉ hiện một đoạn; muốn xem hết thì bấm "JSON" để
// mở tấm trượt dựng sẵn (nó đã biết cắt khối JSON ra khỏi dòng log và tô màu).
// Khoá nào có nhiều giá trị khác nhau thì bày hết ra (tối đa 4 giá trị gần nhất) — chính chỗ lệch
// nhau mới là thứ cần nhìn, gấp lại chỉ còn "giá trị cuối" thì mất luôn.
function renderConfigRow(item) {
  const many = item.values.length > 1
    ? '<i class="fll-cfg-chg" data-tip="Khoá này ghi ra ' + item.values.length + ' giá trị khác nhau. ' +
      'Có thể là cấu hình đổi giữa phiên — thứ dễ làm bug chỉ tái hiện được một lần. Cũng có thể chỉ ' +
      'vì payload mang theo id hoặc thời điểm khác nhau mỗi lần: bấm từng dòng dưới đây mà so.">' +
      item.values.length + ' giá trị khác nhau</i>'
    : '';
  const note = item.note ? '<i class="fll-cfg-note">' + escapeHtml(item.note) + '</i>' : '';
  const shown = item.values.slice(-4);
  const values = shown
    .map((value, index) => renderConfigValue(item, value, index === shown.length - 1))
    .join('');
  // Bản thân tiêu đề khoá cũng bấm được: duyệt HẾT mọi dòng của khoá đó, kể cả các giá trị cũ.
  return '<div class="fll-cfg' + (item.changed ? ' chg' : '') + '">' +
    '<div class="fll-cfg-hd" data-lines="' + item.indices.join(',') + '" data-label="' +
    escapeHtml(item.key) + '" data-tip="Bấm để duyệt cả ' + item.count + ' dòng của khoá này">' +
    '<b>' + escapeHtml(item.key) + '</b>' + many + note +
    '<em>' + (item.count > 1 ? item.count + '&times;' : '1 dòng') + '</em></div>' +
    (item.values.length > shown.length
      ? '<div class="fll-cfg-vm">(còn ' + (item.values.length - shown.length) + ' giá trị cũ hơn)</div>'
      : '') +
    values + '</div>';
}

function renderConfigSection(source, rows) {
  if (!rows.length) return '';
  const meta = CONFIG_SOURCE_META[source];
  return secTitle(meta.label, rows.length) +
    '<div class="fll-hint" style="margin-bottom:8px">' + meta.hint + '</div>' +
    rows.map(renderConfigRow).join('');
}

// Các call này nằm ở module HTTP nên vòng quét cấu hình cố ý bỏ qua. Dùng lại hàng của tab HTTP
// (có sẵn nút xem payload) thay vì vẽ kiểu riêng — cùng một thứ thì phải nhìn giống nhau.
function renderConfigCallSection(cfg, view) {
  if (!cfg.calls.length) return '';
  return secTitle('Call BE xin cấu hình', cfg.calls.length) +
    '<div class="fll-hint" style="margin-bottom:8px">Call có chữ <code>config</code> trên đường dẫn. ' +
    'Bấm <code>{ }</code> để xem BE trả về.</div>' +
    cfg.calls.map((call) => renderHttpCall(call, view)).join('');
}

function renderConfigTab() {
  const view = getView();
  const cfg = view.configs;
  // Đoạn này từng dài bốn câu, giải thích bằng lời những thứ chính giao diện đã nói. Nay một dòng;
  // phần cần cảnh báo (nhiều giá trị không chắc là cấu hình đổi) nằm trong chú giải của chính cái nhãn đó.
  const header = '<div class="fll-hint" style="margin-bottom:10px">Cấu hình app <b>nhận được</b> ' +
    'hoặc <b>áp dụng</b>, gom theo khóa. Bấm một dòng để nhảy tới dòng log.</div>';
  if (!cfg.hasAny) {
    return header + emptyBecauseOfFilter(lensState.data.configs.total, 'dòng cấu hình nào đọc được');
  }
  const summary = '<div class="fll-stats">' +
    statCard(cfg.total, 'khóa cấu hình', LEVEL_COLOR.INFO, 'data-act="noop"') +
    statCard(cfg.changedCount, 'đổi giữa chừng',
      cfg.changedCount ? LEVEL_COLOR.WARNING : '', 'data-act="noop"') +
    statCard(cfg.lineCount, 'dòng log gốc', '', 'data-act="noop"') + '</div>';
  return header + summary +
    CONFIG_SOURCE_ORDER.map((source) => renderConfigSection(source, cfg.bySource[source])).join('') +
    renderConfigCallSection(cfg, view);
}
