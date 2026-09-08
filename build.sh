#!/bin/bash
# File: build.sh
# Created At: 2026-09-08 16:00:00 +07:00
# Created By: AI
# AI Agent: Claude Code
# Model: claude-opus-5
#
# AI-GENERATED START — nối src/*.js thành một IIFE rồi xuất ra 2 dạng dùng được:
#   dist/lens.js         -> content script cho extension
#   dist/bookmarklet.txt -> một dòng javascript: dán vào bookmark
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p dist extension

{
  echo '(function(){"use strict";'
  cat $(ls src/*.js | sort)
  echo '})();'
} > dist/lens.js

cp dist/lens.js extension/lens.js

# Bookmarklet: bỏ thụt đầu dòng, dòng comment `//` và dòng trống, rồi percent-encode toàn bộ.
# Giữ nguyên xuống dòng (ASI) và không đụng vào nội dung chuỗi — mọi string trong src đều nằm gọn một dòng.
{
  printf 'javascript:'
  sed -e 's|^[[:space:]]*||' -e '/^\/\//d' -e '/^$/d' dist/lens.js \
    | perl -pe 's/([^A-Za-z0-9\-_.!~*()\x27])/sprintf("%%%02X", ord($1))/ge'
} > dist/bookmarklet.txt

echo "dist/lens.js         $(wc -c < dist/lens.js | tr -d ' ') bytes"
echo "dist/bookmarklet.txt $(wc -c < dist/bookmarklet.txt | tr -d ' ') bytes"

# Kiểm tra cả hai đầu ra, không chỉ bản gốc: bước sed có thể làm hỏng cú pháp bản rút gọn,
# và bước percent-encode phải giải mã lại ra đúng byte cũ.
node --check dist/lens.js
node -e '
const fs = require("fs");
const url = fs.readFileSync("dist/bookmarklet.txt", "utf8");
if (!url.startsWith("javascript:")) throw new Error("thiếu tiền tố javascript:");
const code = decodeURIComponent(url.slice("javascript:".length));
new Function(code);
console.log("bookmarklet giải mã + parse OK (" + code.split("\n").length + " dòng)");
'
echo "cú pháp OK"
# AI-GENERATED END
