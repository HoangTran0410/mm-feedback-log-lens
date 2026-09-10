/*
File: src/02e-derive.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — gom moi thong ke phu thuoc "dang nhin nhung dong nao" vao mot cho
// Tach ra tu src/02-insights.js (946 dong). Cac file src/*.js duoc build.sh noi lai theo thu tu
// ten file va boc trong MOT IIFE nen van dung chung scope — tach chi de doc.

function deriveStats(entries) {
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
    tags: countBy(entries, (entry) => entry.tag),
    flows: countBy(entries, (entry) => entry.flow),
    events: countBy(entries, (entry) => entry.event),
    journey: buildJourney(entries),
    traceIssues: buildTraceIssues(entries),
    configs: buildConfigs(entries, httpCalls),
    environment: buildEnvironment(entries, httpCalls),
  };
}

function attachInsights(data) {
  // Correlation KHONG scope theo bo loc: mot cmdId la mot chuoi request, xem chuoi thi phai xem tron ven
  // ke ca nhung dong dang bi bo loc giau di.
  data.correlations = buildCorrelations(data.entries);
  data.correlationValueSet = new Set(data.correlations.map((bucket) => bucket.value));
  data.sessions = buildSessions(data.entries);
  data.feedback = readFeedbackContext();
  return data;
}
// AI-GENERATED END
