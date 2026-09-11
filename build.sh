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

echo "extension/lens.js $(wc -c < extension/lens.js | tr -d ' ') bytes — cú pháp OK"
