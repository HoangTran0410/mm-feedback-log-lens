#!/bin/bash
# File: build.sh
# Created At: 2026-09-08 16:00:00 +07:00
# Created By: AI
# AI Agent: Claude Code
# Model: claude-opus-5
#
# AI-GENERATED START — nối src/*.js thành một IIFE rồi ghi thẳng vào extension/lens.js,
# chạy bộ test, và ghi số liệu thật vào README (không ai gõ tay số nữa).
# Từng có thêm dist/ nhưng sau khi bỏ bản bookmarklet thì nó chỉ còn là bản sao y hệt
# của extension/lens.js — một đầu ra, một chỗ, khỏi lệch nhau.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p extension

{
  echo '(function(){"use strict";'
  cat $(ls src/*.js | sort)
  echo '})();'
} > extension/lens.js

node --check extension/lens.js

# Kiem kieu bang tsc neu may co san. Co y KHONG bat buoc: build.sh phai chay duoc tren may khong cai
# gi ngoai node. Moi file src/*.js co "// @ts-check" o dau, va vi chung khong co import/export nen
# TypeScript coi chung la script dung chung mot global scope — dung nhu cach build.sh boc tat ca vao
# mot IIFE. Khong sinh file nao: tsconfig.json dat noEmit.
if command -v tsc >/dev/null 2>&1; then
  tsc --noEmit
  echo "kiểu OK (tsc)"
else
  echo "bỏ qua kiểm kiểu — máy không có tsc (cài: npm i -g typescript)"
fi

TEST_OUT="$(node test/run.js)"
echo "$TEST_OUT"

# Số liệu trong README luôn là của bản vừa build. Trước đây gõ tay nên README ghi bookmarklet
# "~114KB" trong khi thực tế đã 177KB — sai suốt mà không ai biết.
node - "$TEST_OUT" <<'NODE'
const fs = require('fs');

const bytes = fs.statSync('extension/lens.js').size;
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
  '| `extension/lens.js` | **' + kb + ' KB** (' + bytes.toLocaleString('en-US') + ' bytes) |',
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

echo "extension/lens.js $(wc -c < extension/lens.js | tr -d ' ') bytes — cú pháp OK"
# AI-GENERATED END
