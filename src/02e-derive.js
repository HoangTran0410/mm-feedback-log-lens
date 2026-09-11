// @ts-check
// gom mọi thống kê phụ thuộc "đang nhìn những dòng nào" vào một chỗ
// Tách ra từ src/02-insights.js (946 dòng). Các file src/*.js được build.sh nối lại theo thứ tự
// tên file và bọc trong MỘT IIFE nên vẫn dùng chung scope — tách chỉ để đọc.

function deriveStats(entries, gaps) {
  const levels = {};
  LEVEL_ORDER.forEach((level) => {
    levels[level] = 0;
  });
  entries.forEach((entry) => {
    if (levels[entry.level] !== undefined) levels[entry.level] += 1;
  });
  const httpCalls = buildHttpCalls(entries);
  return {
    scopedEntries: entries,
    levels,
    groups: buildIssueGroups(entries),
    httpCalls,
    badHttpCalls: httpCalls.filter(isBadHttpCall),
    durations: extractDurations(entries),
    modules: countBy(entries, (entry) => entry.module),
    // Đã bỏ `tags` và `flows`: hai lượt countBy trên toàn bộ dòng, chạy lại mỗi lần đổi bộ lọc, mà
    // không renderer nào đọc. entry.tag / entry.flow vẫn còn vì bộ lọc nội dung đọc chúng.
    events: countBy(entries, (entry) => entry.event),
    journey: buildJourney(entries, gaps),
    traceIssues: buildTraceIssues(entries),
    errorCodes: buildErrorCodes(entries),
    configs: buildConfigs(entries, httpCalls),
    environment: buildEnvironment(entries, httpCalls),
  };
}

function attachInsights(data) {
  // Correlation KHÔNG scope theo bộ lọc: một cmdId là một chuỗi request, xem chuỗi thì phải xem trọn vẹn
  // kể cả những dòng đang bị bộ lọc giấu đi.
  data.correlations = buildCorrelations(data.entries);
  data.correlationValueSet = new Set(data.correlations.map((bucket) => bucket.value));
  data.sessions = buildSessions(data.entries);
  data.feedback = readFeedbackContext();
  return data;
}
