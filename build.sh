#!/bin/bash
# File: build.sh
# Created At: 2026-09-08 16:00:00 +07:00
# Created By: AI
# AI Agent: Claude Code
# Model: claude-opus-5
#
# AI-GENERATED START — nối src/*.js thành một IIFE rồi xuất ra content script cho extension,
# chạy bộ test, và ghi số liệu thật vào README (không ai gõ tay số nữa).
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p dist extension

{
  echo '(function(){"use strict";'
  cat $(ls src/*.js | sort)
  echo '})();'
} > dist/lens.js

cp dist/lens.js extension/lens.js

node --check dist/lens.js
TEST_OUT="$(node test/run.js)"
echo "$TEST_OUT"

# Số liệu trong README luôn là của bản vừa build. Trước đây gõ tay nên README ghi bookmarklet
# "~114KB" trong khi thực tế đã 177KB — sai suốt mà không ai biết.
node - "$TEST_OUT" <<'NODE'
const fs = require('fs');

const bytes = fs.statSync('dist/lens.js').size;
const srcFiles = fs.readdirSync('src').filter((name) => name.endsWith('.js')).sort();
const srcLines = srcFiles.reduce(
  (sum, name) => sum + fs.readFileSync('src/' + name, 'utf8').split('\n').length, 0);
const testCount = (/(\d+)\/(\d+)/.exec(process.argv[2] || '') || [])[2] || '?';
const kb = (bytes / 1024).toFixed(0);

const block = [
  '<!-- build-stats -->',
  '<!-- Khối này do build.sh ghi lại mỗi lần build. Đừng sửa tay. -->',
  '',
  '| | |',
  '|---|---|',
  '| `dist/lens.js` | **' + kb + ' KB** (' + bytes.toLocaleString('en-US') + ' bytes) |',
  '| Nguồn | ' + srcLines.toLocaleString('en-US') + ' dòng trong ' + srcFiles.length + ' file `src/` |',
  '| Dependency lúc chạy | không có |',
  '| Test | ' + testCount + ' phép thử, `node test/run.js` |',
  '',
  '<!-- /build-stats -->',
].join('\n');

const readme = fs.readFileSync('README.md', 'utf8');
const re = /<!-- build-stats -->[\s\S]*?<!-- \/build-stats -->/;
if (!re.test(readme)) {
  console.error('README.md thiếu khối <!-- build-stats --> ... <!-- /build-stats -->');
  process.exit(1);
}
const updated = readme.replace(re, block);
if (updated !== readme) {
  fs.writeFileSync('README.md', updated);
  console.log('README: cập nhật số liệu (' + kb + ' KB, ' + srcLines + ' dòng nguồn)');
} else {
  console.log('README: số liệu đã đúng');
}
NODE

echo "dist/lens.js $(wc -c < dist/lens.js | tr -d ' ') bytes — cú pháp OK"
# AI-GENERATED END
