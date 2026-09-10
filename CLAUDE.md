# CLAUDE.md — tài liệu cho agent sửa repo này

Đọc file này trước khi sửa. `README.md` là tài liệu cho **người dùng tool**; file này là mọi thứ một
agent cần để không phá thứ đã chạy được: kiến trúc, ràng buộc bất biến, các phép đo đã làm, và những
kết luận từng SAI rồi mới sửa lại.

Nguyên tắc bao trùm: **mọi khẳng định về lúc chạy phải có bằng chứng lúc chạy.** Đọc code tĩnh trả lời
được "đoạn này làm gì", không trả lời được "nó chạy khi nào, mấy lần, theo thứ tự nào". Với những câu
sau, hoặc đo rồi mới viết, hoặc dán nhãn **CHƯA XÁC MINH** ngay tại chỗ. Commit message chỉ chứa thứ
đã verify — giả thuyết để trong hội thoại, message sai nằm lại vĩnh viễn.

---

## Luật bất biến (phá là hỏng thật)

**Không commit log thật, không chụp ảnh trang thật.** `.gitignore` chặn `*.yml`, `*.log`, `*.har`,
`*.png` vì log feedback chứa số điện thoại, token, mã giao dịch của người dùng thật — và ảnh chụp thì
lộ nguyên văn. Ngoại lệ duy nhất là `docs/*.png`, chụp trên log **bịa** do `test/demo-log.js` sinh ra.
Muốn cập nhật ảnh:

```sh
node test/demo-log.js /tmp/demo.html && cp extension/lens.js /tmp/lens.js
cd /tmp && python3 -m http.server 8791     # phải qua http, file:// không chạy được extension
```

Chụp thì **thu cửa sổ trình duyệt xuống ~1000px trước đã**. Bộ chụp màn hình có giới hạn bề ngang
(~1568px); cửa sổ rộng hơn thì ảnh bị thu nhỏ rồi phóng lại — mờ, và vùng cắt lệch đi vì toạ độ đo
bằng px CSS còn ảnh đã bị co. Cửa sổ hẹp hơn giới hạn đó thì tỉ lệ 1:1, cắt đúng khung panel.

Test fixture (`test/fixture.js`) cũng bịa hoàn toàn, nhưng tái tạo đúng những ĐẶC TÍNH đã gặp trên log
thật: ghi lặp, `trace_id` trùng, popup ở mức INFO, giá trị có dấu phẩy bên trong.

**Không `import`/`export` trong `src/`.** `build.sh` nối mọi file thành MỘT IIFE nên chúng dùng chung
global scope. Đây cũng chính là thứ làm `// @ts-check` chạy được mà không cần bước biên dịch. Thêm một
dòng `import` là hỏng cả hai.

**Một lần mở app = một CHÙM mốc, không phải một mốc.** `RE_SESSION` cũ khớp ba chuỗi và cả ba đều nổ
trong cùng một lần khởi động, cách nhau vài trăm ms — đếm từng mốc thì một lần mở app thành ba phiên.
Đo trên ba log thật: khoảng cách trong cùng một chùm là 369–2078ms, giữa hai lần khởi động thật là
75 440ms và 163 029ms. Ngưỡng `SESSION_BURST_MS = 5000` nằm giữa khoảng trống 36 lần đó. Điều kiện phụ
"gặp lại đúng loại mốc đã thấy trong chùm" bắt trường hợp mở lại ngay — nhưng mới dựa trên bốn chùm
quan sát được, nên **CHƯA XÁC MINH** rằng không log nào lặp một loại mốc giữa cùng một lần chạy.

**Nhãn nguồn cấu hình không được suy đoán.** `src/02g-config.js` chỉ gán nguồn khi chính dòng log nói
ra (chữ `webadmin`, url CDN, tên lớp `ABTestingExpTag`...). Dòng không tự khai thì vào nhóm
`oth` = "Chưa rõ nguồn", tuyệt đối không gán bừa vào BE.

**Badge của mục nằm NGOÀI khoá nhớ trạng thái.** `collapsifySections()` lấy `data-sec` làm khoá; nếu
lấy `textContent` thì badge lọt vào khoá, mà badge đổi theo từng log — mở một mục ở log này, sang log
khác lại thấy đóng. Mọi tiêu đề mục phải đi qua `secTitle(title, badge, tone)`.

**`hide()` của tab đọc data ĐẦY ĐỦ, không phải view đang lọc.** Lọc hẹp lại thì tab tự ẩn sẽ biến mất
giữa chừng. Tab có hay không là tính chất của cả log; nội dung bên trong mới chạy theo bộ lọc.

**Chữ hướng dẫn trên giao diện: một câu.** Giải thích dài để trong chú giải của chính phần tử nó nói
về. Panel chỉ rộng 480px, mỗi câu thừa đẩy nội dung thật xuống dưới màn.

**Đặt tên một bước hành trình: đi theo bậc, không lấy một trường duy nhất.** `pickJourneyLabel()`
lấy trường đầu tiên không rỗng theo thứ tự *"càng riêng cho bước này và càng giống thứ user nhìn thấy
thì càng ưu tiên"*: (1) chữ user thật sự đọc được — `title`, `button_name`; (2) tên thành phần do dev
đặt — `component_name`, `popup_name`, đuôi của `component_id`; (3) bối cảnh rộng hơn — `feature_code`,
`service_name`. Bậc 3 không bao giờ nên đứng một mình ở chỗ khác (một `feature_code` có hàng chục
popup), nhưng vẫn hơn chữ "popup" trơn. Lý do có luật này: trên log thật `title=null` khá thường, và
khi đó hai popup khác hẳn nhau bị gom thành một hàng `2× popup` — mất sạch cái để phân biệt.

**Chú giải dùng `data-tip`, KHÔNG dùng `title`.** Độ trễ trước khi hiện `title=""` do hệ điều hành
quyết định — không CSS hay JS nào đổi được. Panel này có tới 120 chỗ mang chú giải, nên lướt chuột qua
là tooltip của trình duyệt nhảy liên tục và che mất giao diện phía sau. `src/03j-tooltip.js` tự vẽ:
chờ 600ms, rộng tối đa 300px, đặt lệch xuống dưới - sang phải con trỏ (hướng người dùng vừa rời khỏi),
lật lên trên khi sát đáy màn. Có một phép thử quét HTML của cả năm tab và bắt lỗi nếu còn sót `title=`.

---

## Build lại

```sh
./build.sh
```

Nối `src/*.js` theo thứ tự tên file thành một IIFE rồi xuất:

- `extension/lens.js` — content script, đầu ra duy nhất

Build kiểm cú pháp (`node --check`), **kiểm kiểu** (`tsc --noEmit`), chạy bộ test (`node test/run.js`),
rồi ghi số liệu thật của bản vừa build vào khối `<!-- build-stats -->` trong README. Trước đây số đó gõ tay, nên README ghi
bookmarklet "~114KB" trong khi thực tế đã 177KB — sai suốt một thời gian dài mà không ai biết.

**Vì sao `ops_receive_be` khử trùng theo `trace_id`.** `MAPInterceptor.kt` ghi sự kiện này ở hai chỗ:
trong `invokeOnCompletion` khi request kết thúc có exception (`status=fail`, `error_code=HTTP-<mã>-<tên
lớp exception>`), và trong response interceptor ở đường bình thường. Nhưng log trùng cả ở
`status=success`, nên hai chỗ đó không giải thích hết.

Bằng chứng quyết định nằm ở `miniapp_track_timestamp` — mốc `now` tính riêng trong mỗi lần chạy khối
tracking. Trên một log thật: 140 `trace_id` xuất hiện hơn một lần, nhưng **chỉ 6 cặp có cùng
`miniapp_track_timestamp`**; 134 cặp còn lại lệch nhau vài ms. Tức không phải một lần chạy bị ghi log
đôi, mà là **khối tracking response chạy hai lần cho cùng một request**. `trace_id` thì lấy từ attribute
của request nên vẫn là một — vì vậy khử trùng theo nó là đúng.

*Chưa xác minh:* vì sao khối đó chạy hai lần (interceptor đăng ký trùng, hay client cài plugin hai lần).

**`momo_proxy_to_http_duration: null` không phải đo hỏng.** `MAPInterceptor.kt:132-136`:

```kotlin
val maxApiToHttpDuration = maxApiStartTime?.let { it.toLongOrNull()?.let { s -> now - s } }
logger.d("momo_proxy_to_http_duration: $maxApiToHttpDuration ms (proxy_start: $maxApiStartTime, ...)")
```

`null` khi attribute `MAX_API_START_TIME` không có — tức **call không đi qua maxAPI proxy**. Trên log thử
115/168 dòng là `null`, nghĩa là phần lớn call gọi thẳng chứ không qua proxy. Lưu ý dòng này dùng
`logger.d`, mà trên bản production chỉ `d()` bị nuốt — nên `[Module: MAPTiming]` chỉ có ở log máy nội bộ.

**Kiểm kiểu mà không đổi ngôn ngữ.** Mỗi file `src/*.js` mở đầu bằng `// @ts-check`, cấu hình ở
`tsconfig.json` với `noEmit` — nên đây thuần tuý là một lớp kiểm, không có bước biên dịch, `dist/`
không đổi một byte, và mã vẫn là JavaScript đọc thẳng được.

Nó hoạt động được đúng nhờ cùng một tính chất mà `build.sh` dựa vào: các file `src/*.js` **không có
`import`/`export`**, nên TypeScript coi chúng là *script* dùng chung một global scope — khớp y hệt việc
`build.sh` bọc tất cả vào một IIFE. Không cần thêm `import` nào để chúng thấy nhau.

`build.sh` chỉ chạy `tsc` **nếu máy có sẵn**, không có thì báo rồi đi tiếp — build phải chạy được trên
máy chỉ cài `node`. Không thêm `package.json`, không thêm dependency lúc chạy.

Lần bật đầu tiên nó bắt được 8 lỗi trên ~4400 dòng, trong đó hai chỗ đáng sửa thật chứ không phải
nhiễu kiểu: một biến `data` khai báo rồi không dùng, và `origin.committedLeft` được gán thêm sau khi
tạo object thay vì khai báo hẳn trong đó — kiểu gõ sai một chữ là hỏng im lặng. Còn lại là chỗ cần
nói cho trình kiểm biết rằng phần tử đang thao tác là ô nhập.

`build.sh` nối mọi file trong `src/` theo thứ tự tên, nên thêm module chỉ cần đặt tên đúng chỗ.
Hai file trong `test/` không phải test: `test/fixture.js` sinh log bịa cho bộ test, `test/demo-log.js`
sinh log bịa **to hơn nhiều** để chụp ảnh cho README.

| File | Việc |
|---|---|
| `src/01-analyzer.js` | đọc DOM → entry có cấu trúc, gom chữ ký, ghép HTTP, tính gap |
| `src/02a-insights.js` | thời lượng, ID liên kết, phiên app, metadata feedback |
| `src/02b-payload.js` | tách khối JSON trong dòng log; lớp `k=v` dùng chung cho tracker lẫn Grafana |
| `src/02c-journey.js` | dựng lại thao tác của user từ event MoMoTracker |
| `src/02d-trace.js` | lỗi đọc từ Grafana trace, nhận diện nhiễu của lớp đo lường |
| `src/02e-derive.js` | gom mọi thống kê phụ thuộc "đang nhìn những dòng nào" vào một chỗ |
| `src/02f-theme.js` | CSS |
| `src/02g-config.js` | rút cấu hình app nhận từ BE / webadmin / CDN / A-B testing |
| `src/03a-state.js` | hằng dùng chung, `lensState`, tắt tiếng chữ ký, hàm định dạng |
| `src/03b-nav.js` | nhảy tới dòng log, duyệt kết quả khớp, thanh điều hướng dưới |
| `src/03c-filter.js` | lõi bộ lọc: biến điều kiện thành hàm, lọc tập dòng, dựng view |
| `src/03d-permalink.js` | permalink qua hash URL, mẫu bộ lọc lưu sẵn |
| `src/03e-filterbar.js` | thanh bộ lọc thường trú: chip facet, cửa sổ thời gian, gỡ từng điều kiện |
| `src/03f-minimap.js` | minimap mật độ log và thao tác kéo chọn khoảng trên nó |
| `src/03g-panel.js` | kéo thả panel, đổi kích thước, nhớ vị trí |
| `src/03h-aim.js` | mũi tên từ hàng đang rê chuột lên vị trí của nó trên minimap |
| `src/03i-sections.js` | biến `.fll-sec` thành mục đóng/mở được, nhớ trạng thái qua `localStorage` |
| `src/04-sheet.js` | tấm trượt chi tiết: payload JSON và chuỗi theo ID |
| `src/04-tabs.js` | nội dung 5 tab |
| `src/05-boot.js` | gắn panel, uỷ quyền sự kiện, tự quét lại |

`03-shell.js` từng là 992 dòng / 67 hàm và `02-insights.js` lên tới 946 dòng — quá lớn để giữ trong đầu
khi sửa. Đã tách theo đúng các mục comment vốn có, **không đổi một dòng code nào**: kiểm bằng cách nối
lại `dist/lens.js` trước và sau rồi `diff` phần thân, phải giống hệt. File lớn nhất giờ là 721 dòng.

---

---

## Tool bám vào cái gì của trang (đọc khi trang đổi giao diện)

Đã kiểm trên DOM thật ngày 2026-09-08:

- Mỗi dòng log là `div[class*="logRow"]`, con thứ nhất là số dòng, con thứ hai là `span` chứa cả dòng text.
- Mức độ nằm ở class của `span` đó (`_error_`, `_warn_`, `_info_`; DEBUG không có class) — nhưng tool **parse level từ chính text**, nên đổi tên class cũng không sao.
- Toàn bộ ~4000 dòng nằm sẵn trong DOM, không virtual scroll.
- Log cuộn trong một div lồng bên trong, không phải window — `getLogScrollContainer()` tự dò.
- Trang không có CSP nên inline script chạy được.

Nếu trang bỏ `logRow` khỏi tên class thì sửa `ROW_SELECTOR` trong `src/01-analyzer.js`.

**WebAdmin là SPA React — content script chỉ chạy một lần lúc tải tài liệu.** Bấm từ danh sách sang
feedback detail không tải lại tài liệu, nên script không bao giờ chạy lại. Hai chỗ phải giữ đúng:

- `manifest.json` khớp **cả host** (`https://adminapp.momocdn.net/*`), không riêng trang detail.
  Nếu chỉ khớp `/utilities/feedback/*` mà người dùng vào trang khác trước rồi mới bấm sang feedback
  thì script chưa từng được inject lần nào.
- `startPageWatcher()` chạy **thường trú** (nhịp 1s), kể cả khi chưa gắn được: thấy bảng log thì gắn,
  bảng log biến mất thì `detachLens()`. Bản đầu dùng `waitForLogRows` poll 30 giây rồi bỏ cuộc —
  ngồi ở trang danh sách lâu hơn thế là mất luôn cơ hội gắn.

`detachLens()` phải trả bảng log về nguyên trạng (`setLogFilteringMode(false)` + gỡ `.fll-keep`)
**trước khi** bỏ `data`: SPA có thể dùng lại chính container đó cho feedback kế tiếp, còn sót class lọc
thì feedback mới chỉ hiện vài chục dòng trong khi panel báo "không có bộ lọc nào".
Bộ lọc cũng bị xoá khi rời trang — mang bộ lọc của feedback trước sang feedback sau là cùng một loại lỗi.
Riêng danh sách tắt tiếng thì giữ, vì đó là mục đích của nó.

**Trang admin tự gỡ node của tool khi nhận Escape.** Đã đo được: nhấn `Esc` lần đầu thì chính trang gọi
`removeChild` bỏ `#fll-root` khỏi `body` (không phải code trong đây — bẫy `Element.prototype.remove` không bắt được gì).
Vì vậy listener bàn phím gắn ở **capture phase trên `window`** và `stopPropagation()` những phím tool xử lý,
để trang không bao giờ nhìn thấy `Esc` lúc panel đang mở. Ngoài ra `rowCountWatcher` mỗi 2s có kiểm
`root.isConnected` và gắn lại nếu bị gỡ. Bỏ một trong hai chỗ đó là lỗi quay lại.

**Container có 4087 con nhưng chỉ 4085 dòng log** (2 div đệm). `rowCountWatcher` so số con để biết
người dùng đã đổi tab log chưa; nếu lấy giá trị khởi tạo từ một nguồn khác (`entries.length`) thì
nhịp đầu tiên tưởng log vừa đổi, rescan oan và xoá sạch trạng thái lọc trong khi DOM vẫn đang bị lọc.
Cả hai chỗ phải gọi chung `countLogRows()`.

---

## Quy tắc giao diện (đừng vô tình phá)

Panel từng bị rối vì mấy thói quen dưới đây, sửa rồi thì giữ:

- **Mỗi lúc chỉ một thứ màu accent.** Thanh bộ lọc là thứ duy nhất được tô hồng, vì nó là cảnh báo
  "dữ liệu đang bị cắt". Khối lấy nét và mọi card khác dùng nền trung tính. Ba khối hồng chồng nhau
  thì accent không còn nghĩa gì.
- **Không nói lại điều thanh bộ lọc đã nói.** Từng có băng "Mọi số dưới đây tính trên N dòng" ngay
  dưới thanh đã ghi "hiện N/4085" — bỏ, vì mỗi stat card đã tự hiện `scope/tổng`.
- **Tiêu đề mục dính lại khi cuộn (`position:sticky`).** Tab Lọc có 8 mục, tab Diễn biến vẽ 80 mốc một
  lô — cuộn một lát là không còn biết đang đọc mục nào. Ba điều kiện để sticky không vỡ, đều nằm trong
  `.fll-sec`: nền phải **đục và tràn hết chiều rộng** (kéo bằng `margin` ngang âm 16px đúng bằng padding
  của `.fll-body` rồi `padding` bù lại), nếu không thì nội dung trôi qua ngay dưới chữ; `top` phải là **số
  âm đúng bằng `padding-top` của `.fll-body`** (`calc(var(--pad-y) * -1)`); và `z-index:3` đủ đè lên nội
  dung nhưng vẫn nằm dưới `.fll-sheet` (`z-index:8`) nên tấm trượt không bị đâm xuyên.

  Chỗ `top` là chỗ dễ đoán sai nhất, nên đo thẳng trong Chrome trên một trang test dùng đúng bộ CSS này:

  | `top` | Hở giữa tiêu đề đã dính và mép trên `.fll-body` | Bị `overflow` cắt? |
  |---|---|---|
  | `0` | **13.9px** — đúng bằng `padding-top:14px`, nội dung vẫn trôi qua bên trên | không |
  | `calc(var(--pad-y) * -1)` | **0px** | **không** |

  Tức offset của sticky tính từ **content box**, không phải padding box. Số âm cũng không bị cắt vì nó chỉ
  nhô đúng tới mép padding box — chính là chỗ `overflow` bắt đầu clip. Hai số này lấy chung từ `--pad-y`
  / `--pad-x` nên đổi padding của `.fll-body` là tiêu đề tự theo, không phải sửa hai nơi.
- **Từng không kẻ đường ngang, nay có** — vì lý do cũ đã hết hiệu lực. Nguyên tắc cũ là "tab Lọc có 8 mục,
  8 vạch kẻ biến nó thành súp vạch", đúng khi tiêu đề trong suốt và vạch trôi nổi giữa nội dung. Nay vạch
  gắn liền dải nền của chính tiêu đề nên nó đọc ra là *mép dưới của một dải*, không phải một vạch riêng.
  Dấu đầu mục vẫn là thanh dọc ngắn màu accent.
- **Tương phản chữ tiêu đề.** Từng là `#7f7793`, chỉ đạt **4.31:1** trên nền panel (dưới ngưỡng WCAG AA
  4.5:1) ở cỡ 10px in hoa nên đọc được mà không nhảy ra được. Nay `#d5cfe2` ở 11px, đạt **10.53:1** ngay
  cả trên chỗ đậm nhất của dải nền.
- **Hướng dẫn dài để trong `title`, không để giữa form.** Cách dùng minimap nằm ở tooltip của minimap,
  trong form chỉ còn một dòng ngắn.
- **Chip hết dòng khớp thì làm mờ (`.fll-chip.dim`), không xoá.** Vẫn bấm được để nới rộng.
- **Bốn ô tìm, bốn timer riêng, hai mức chờ khác nhau.** `#fll-re` (lọc nội dung) chờ 180ms vì nó kéo
  theo cả lượt quét 4085 dòng; `#fll-q`, `#fll-modq` và `#fll-httpq` chờ 120ms vì chỉ vẽ lại một mảnh
  (`#fll-httpq` quét cả payload của mọi request, vẫn chỉ thay `#fll-http-list`).
  Dùng chung một biến timer là sai: gõ ô này sẽ huỷ mất cập nhật đang chờ của ô kia.
  Timer phải được dọn trong `disposeSelf` và `detachLens`, không thì nó bắn lên panel đã bị gỡ.
- **Tấm trượt payload bắt đầu ngay dưới minimap, không phủ lên nó.** `.fll-sheet` từng đặt cứng
  `top:52px` (dưới header) nên nó che luôn minimap — mà lúc đọc payload lại chính là lúc cần biết
  "dòng này nằm chỗ nào trong log" nhất. Nay `openSheet()` đo `lensState.el.body.offsetTop` rồi gán,
  vì phần trên panel không cố định chiều cao: thanh bộ lọc lúc hiện lúc ẩn. `refreshFilterBar()` gọi
  lại phép đo đó **sau khi** đã đổ nội dung vào thanh — đo lúc thanh còn rỗng thì ra chiều cao sai.
- **Lớp mũi tên (`.fll-aim`) phải nằm TRÊN tấm trượt.** Đường kẻ đi *từ trong* tấm trượt (`z-index:8`)
  *ra tới* minimap nằm ngoài nó, nên lớp SVG để `z-index:9` và `pointer-events:none`. SVG không đặt
  `viewBox`: không có viewBox thì một đơn vị SVG = một px CSS, nên toạ độ lấy từ
  `getBoundingClientRect()` dùng thẳng được, khỏi quy đổi.
  Mũi tên vẽ **bên trong** mép dưới minimap chứ không thò xuống dưới: bản đầu để nó chạm mép dưới rồi
  thò xuống 8px, đúng chỗ dòng nhãn giờ cao ~14px — thấy khi chụp màn hình.
- **Bảy tab phải vừa bề ngang mặc định.** Đo trên panel 480px: với `gap:3px` + padding ngang 7px, bảy
  tab cần **507px** trong khi chỗ chỉ có **478px** — tab cuối bị cắt mất chữ mà không có dấu hiệu gì
  là còn cuộn được. `gap:2px` + padding 5px lại còn **473px**. Vẫn giữ `overflow-x:auto` cho trường
  hợp người dùng kéo panel hẹp hơn.
- **Badge phải nằm NGOÀI khoá nhớ trạng thái.** `collapsifySections()` lấy `data-sec` làm khoá, không
  lấy `textContent` — trong `textContent` có cả badge (`"Phiên app9 phiên"`), mà badge đổi theo từng
  log, lấy nó vào khoá thì mở một mục ở log này, sang log khác lại thấy đóng. Mọi tiêu đề mục đi qua
  `secTitle(title, badge, tone)`, không viết tay `<div class="fll-sec">` nữa.
- **`hide()` của tab phải đọc data ĐẦY ĐỦ, không phải view đang lọc.** Lọc xuống còn 3 dòng thì trong
  tập đó không còn dòng cấu hình nào, và tab Cấu hình **biến mất giữa chừng** — thấy khi chụp màn hình.
  Tab có hay không là tính chất của cả log; nội dung bên trong mới chạy theo bộ lọc.
- **Lề trên của mục chuyển từ `.fll-sec` sang khối bao ngoài.** `collapsifySections()` bọc mỗi mục vào
  một `.fll-secw` sau khi vẽ, nên `.fll-sec` luôn là con đầu tiên của khối — rule
  `.fll-sec:first-child{margin-top:0}` sẽ ăn mất lề của **mọi** mục. Lề 22px nay nằm ở `.fll-secw`.
- **Tô màu JSON: quét token trước, escape từng mảnh sau.** Escape cả chuỗi rồi mới tô sẽ ăn luôn thẻ
  `<i>`; tô trước escape sau thì thẻ biến thành chữ hiển thị. Xem `highlightJson()` trong `src/04-sheet.js`.
- **Đổi bộ lọc thì vẽ lại cả tab, đừng vá từng phần tử.** Ô "Tìm trong nội dung" từng chỉ cập nhật
  thanh bộ lọc và `#fll-count` để khỏi mất con trỏ — hậu quả là chip đếm, danh sách Gom theo ID và
  nút Lưu mẫu đều đứng ở trạng thái cũ, người dùng thấy "1 bộ lọc đang bật" mà phần Mẫu vẫn bảo
  chưa có điều kiện nào. Dùng `renderTabPreservingFocus()`: vẽ lại hết rồi trả lại tiêu điểm,
  vị trí con trỏ và vị trí cuộn. Giá trị người dùng đang gõ dở phải nằm trong `tabUiState`
  (`templateName`, `issueQuery`, `moduleQuery`) chứ không phải chỉ trong DOM, nếu không vẽ lại là bay.

---

## Ghi chú hiệu năng (đo trên log 4085 dòng)

| Thao tác | Thời gian |
|---|---|
| Khởi động (parse + dựng hết) | ~150ms |
| Bấm `n` sang dòng kế | 0.6ms |
| Áp thêm một điều kiện lọc | ~10ms |
| Áp điều kiện lọc đầu tiên | ~63ms |
| Xoá tất cả bộ lọc | ~250ms |

Hai con số cuối **không phải chi phí của tool**: đo tách bạch thì việc ghi class chỉ tốn **0.1ms**,
229ms còn lại là trình duyệt layout lại 4085 dòng của bảng log — trang admin không dùng virtual scroll,
mọi dòng đều nằm thật trong DOM và cao 174378px.

**Kéo di chuyển panel** dùng `transform: translate3d()` rồi mới chốt thành `left/top` lúc thả tay,
và gom `mousemove` lại một lần cập nhật mỗi khung hình. Lý do: ghi `left/top` mỗi nhịp chuột thì
trình duyệt phải layout + vẽ lại vùng panel (kèm bóng mờ bán kính 70px) đè lên bảng log 4085 dòng,
không dùng được compositor.

Số đo thì cần nói rõ, vì hai lần đo cho hai kết quả khác nhau:

| | p95 | max |
|---|---|---|
| Lúc **máy đang tải nặng** (đang build iOS) — `left/top` | 20.8ms | 49.7ms |
| Lúc **máy đang tải nặng** — `transform` | 14.6ms | 18.1ms |
| Lúc **máy rảnh** — `left/top` | 14.3ms | 16.6ms |
| Lúc **máy rảnh** — `transform` | 15.4ms | 17.3ms |

Nghĩa là: máy rảnh thì **hai cách không phân biệt được**, cả hai đều 0 khung hình rớt.
Khác biệt chỉ lộ ra khi máy hết headroom — đúng lúc người dùng thấy giật.
Giữ `transform` vì nó làm ít việc hơn hẳn mỗi khung hình chứ không phải vì đo được nhanh hơn lúc bình thường.
Đo riêng còn cho thấy **bóng mờ gần như vô can** (đổi transform mà giữ bóng lớn: p95 14.3ms) —
việc thay bóng lúc kéo chỉ là phụ.

Những chỗ đã tối ưu, đừng vô tình làm ngược lại:

- **Đánh dấu theo phía ÍT hơn.** Chi phí lọc nằm gần như hoàn toàn ở *số lần chạm class của dòng*,
  không phải ở layout. Đo trên trang admin thật với **10 362 dòng**:

  | thao tác | thời gian |
  |---|---|
  | 10k `classList.add` | **7 025ms** |
  | bật `.fll-filtering` khi cả 10k dòng đều mang `.fll-keep` | 224ms |
  | 83 `classList.add` | **5ms** |
  | tắt lọc, hiện lại toàn bộ | 13ms |

  10k lần chạm class đắt gấp **1 400 lần** 83 lần chạm. Vì thế lọc hẹp (vài chục dòng khớp) thì gắn
  `.fll-keep` cho dòng **được giữ**; lọc rộng thì đảo lại, gắn `.fll-drop` cho dòng **bị loại** và bật
  `.fll-dropping`. Số lần chạm luôn là `min(giữ, loại)`.

  Lọc theo **phiên app** là ca bắt buộc phải có cách đảo này: một phiên có thể chiếm 10 279 / 10 362
  dòng. Trước khi sửa, chọn phiên đó làm trang **đứng hình 7,1 giây**; sau khi sửa còn **dưới 300ms**.
- `entry.isKept` phải luôn khớp class thật trên DOM, kể cả lúc không lọc — nhờ vậy lần lọc sau
  chỉ ghi đúng phần chênh lệch. Guard `entry.isMarked !== wanted` là thiết yếu chứ không phải tối ưu
  vụn: đo cho thấy gọi `classList.remove` lên cả 10 362 dòng (dù chỉ 83 dòng thật sự mang class) vẫn
  tốn **6 484ms** — trình duyệt tính tiền theo lần chạm, không theo số dòng đổi thật.
- **Chữ ký chỉ tính cho dòng ERROR/WARNING.** Tính cho cả 4085 dòng nghĩa là chạy 7 lượt `replace`
  trên những dòng payload HTTP dài 10KB mà không ai dùng tới — riêng việc này chiếm gần nửa thời gian khởi động.
- `buildCorrelations` và `extractDurations` **sàng bằng `indexOf` trước khi chạy regex**.
- `jumpToIndex` nhớ dòng vừa highlight, không quét lại cả mảng để gỡ class.
- Tab Vấn đề vẽ 50 nhóm một lô (`ISSUE_PAGE_SIZE`), còn lại bấm "Hiện thêm".
- Vẽ lại tab Lọc **không** được tự quét lại: dùng `getFilterResult()` đọc kết quả đã tính.

Đã thử `content-visibility: auto` trên các dòng — giảm thời gian xoá lọc từ 229ms xuống 46ms,
nhưng **loại bỏ**: nó làm `scrollHeight` sai (174378 → 82001) và nhảy dòng trượt mục tiêu,
tức là hỏng đúng chức năng cốt lõi để đổi lấy tốc độ.

Một lưu ý nữa: chạy lại cả file (reload extension lúc tab đang mở) sinh một thế hệ closure mới.
Thế hệ cũ vẫn còn listener và interval, sẽ thao tác lên panel của thế hệ mới.
`disposePreviousInstance()` (qua `window.__feedbackLogLens`) dọn việc đó.

**Còn một mốc dọn thứ hai đi qua DOM, không qua `window`.** Nếu có hai instance cùng sống thì có hai
`#fll-root`, và lưới an toàn `root.isConnected` của bên cũ sẽ dựng lại root của nó mỗi 2 giây. Nên
instance mới ghi tên mình vào `data-fll-owner` trên thẻ `html`; bên cũ đọc thấy tên khác thì tự rút lui.

Mốc này ra đời từ thời còn bản bookmarklet — bookmarklet chạy ở page world, extension ở isolated
world, hai bên không thấy `window` của nhau nên `window.__feedbackLogLens` không dọn chéo được. Bản
bookmarklet đã bỏ, nhưng **chưa xác minh** được reload extension lúc tab đang mở thì thế hệ cũ nằm ở
đâu, nên vẫn giữ mốc DOM này thay vì gỡ theo suy đoán.

Ba chi tiết trong cơ chế đó, sai một cái là hỏng:

- **Nhận quyền trước, dọn sau.** Dọn trước rồi mới nhận thì có một khe hở để nhịp watcher bên cũ
  tưởng root của nó bị gỡ oan và dựng lại ngay.
- **Tự dọn chính mình, không dọn qua biến global.** `window[LENS_GLOBAL_KEY]` lúc đó đã trỏ tới
  instance mới, gọi `dispose()` trên đó là giết nhầm bên đang làm chủ (đã dính đúng bug này khi test).
  Cũng vì vậy phải gỡ `lensState.el.root` chứ không phải `getElementById(ROOT_ID)`.
- **Rút lui thì đừng đụng class trên bảng log.** `.fll-filtering` / `.fll-keep` lúc ấy là của chủ mới;
  dọn đi là xoá luôn bộ lọc người ta vừa áp. Đó là lý do `disposeSelf()` có tham số `shouldRestorePage`.

Mở bằng permalink thì **luôn bung panel**, kể cả bản extension (vốn mặc định thu gọn):
người nhận link mà chỉ thấy một cái pill trong khi bảng log đã bị lọc sẽ tưởng link không có tác dụng.

---

---
