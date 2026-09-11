#!/bin/bash
# nối src/*.js thành một IIFE rồi ghi thẳng vào extension/lens.js, rồi chạy bộ test.
# Từng có thêm bước ghi số liệu bản build vào README; bỏ vì README nay không mang con số nào —
# số liệu (KB, số dòng, số test) đọc thẳng từ đầu ra của chính lệnh này.
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

# Kiểm kiểu bằng tsc nếu máy có sẵn. Cố ý KHÔNG bắt buộc: build.sh phải chạy được trên máy không cài
# gì ngoài node. Mọi file src/*.js có "// @ts-check" ở đầu, và vì chúng không có import/export nên
# TypeScript coi chúng là script dùng chung một global scope — đúng như cách build.sh bọc tất cả vào
# một IIFE. Không sinh file nào: tsconfig.json đặt noEmit.
if command -v tsc >/dev/null 2>&1; then
  tsc --noEmit
  echo "kiểu OK (tsc)"
else
  echo "bỏ qua kiểm kiểu — máy không có tsc (cài: npm i -g typescript)"
fi

node test/run.js

# Bản rút gọn, DÀNH RIÊNG cho WebAdmin. Trang đó chở file này cho mọi người dùng thật nên kích thước là
# chuyện của họ; còn extension vẫn nạp bản đọc được, vì debug tool thì cần đọc được stack trace.
# Hai đầu ra sinh ra trong CÙNG một lần build từ cùng một nguồn nên không lệch nhau được — khác với
# dist/ ngày xưa (một bản sao thủ công, đã bỏ).
#
# Không bắt buộc, cùng lý do với tsc: build phải chạy được trên máy chỉ có node. Không có esbuild thì
# báo rồi đi tiếp, extension/lens.js vẫn là đầu ra chính.
MINIFIER=""
if command -v esbuild >/dev/null 2>&1; then
  MINIFIER="esbuild"
elif command -v npx >/dev/null 2>&1; then
  MINIFIER="npx --yes esbuild@0.25.0"
fi

if [ -n "$MINIFIER" ] && $MINIFIER extension/lens.js --minify --target=chrome100 \
    --outfile=extension/lens.min.js >/dev/null 2>&1; then
  node --check extension/lens.min.js
  echo "extension/lens.min.js $(wc -c < extension/lens.min.js | tr -d ' ') bytes" \
    "(gzip $(gzip -9 -c extension/lens.min.js | wc -c | tr -d ' ')) — bản gửi cho WebAdmin"
else
  echo "bỏ qua bản rút gọn — không chạy được esbuild (cài: npm i -g esbuild)"
fi

echo "extension/lens.js $(wc -c < extension/lens.js | tr -d ' ') bytes — cú pháp OK"
