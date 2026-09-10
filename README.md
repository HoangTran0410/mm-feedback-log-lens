# Feedback Log Lens

Đọc nhanh log feedback trên `adminapp.momocdn.net/utilities/feedback/detail`.
Trang admin chỉ có search theo text; tool này gom nhóm lỗi, thống kê, lọc tại chỗ và dựng timeline.

> Công cụ cá nhân, không phải sản phẩm chính thức của tổ chức nào. Chỉ đọc DOM sẵn có trên trang,
> không gọi API, không gửi dữ liệu đi đâu. Repo này **không** chứa log thật hay dữ liệu người dùng —
> mọi ví dụ trong code và tài liệu đều là dữ liệu bịa.

Đo trên một log thật (4085 dòng, 1.1MB). Mọi con số `4085` trong tài liệu này đều là số đo trên
chính log đó — chúng minh hoạ, **không tự cập nhật** (log thật không nằm trong repo). Số liệu về
bản build thì ngược lại: khối ngay dưới do `build.sh` ghi lại mỗi lần build.

| | Trang admin | Log Lens |
|---|---|---|
| 47 dòng ERROR | đọc từng dòng | **10 nhóm** theo chữ ký |
| 958 dòng WARNING | đọc từng dòng | **252 nhóm**, sắp theo số lần, tắt tiếng được vĩnh viễn |
| 110 dòng HTTP | lẫn trong log | bảng riêng, lọc 8 call bất thường, mở payload JSON |
| 160 con số thời lượng nằm rải rác | không thấy | bảng xếp hạng — **chậm nhất 54s** |
| 52 giá trị `cmdId`/`request_id` lặp ở nhiều dòng | không dùng được | gom thành chuỗi một request |
| 3 phiên app trong cùng file | không thấy | tách ra, lọc theo phiên |
| 93 dòng timestamp lùi | không cảnh báo | báo ngay, và sắp lại theo thời gian thật |
| Vấn đề nằm ở cuối log | cuộn từ dòng 1 | tự lấy nét vào N giây cuối trước lúc gửi feedback |

---

<!-- build-stats -->
<!-- Khối này do build.sh ghi lại mỗi lần build. Đừng sửa tay. -->

| | |
|---|---|
| `dist/lens.js` | **187 KB** (191,047 bytes) |
| Nguồn | 4,244 dòng trong 7 file `src/` |
| Dependency lúc chạy | không có |
| Test | 63 phép thử, `node test/run.js` |

<!-- /build-stats -->

## Cài

1. `chrome://extensions` (Brave: `brave://extensions`) → bật **Developer mode**
2. **Load unpacked** → chọn thư mục `extension/`
3. Mở một feedback bất kỳ. Khi bảng log render xong sẽ có pill `◆ Log Lens · N nhóm lỗi` ở góc dưới phải — bấm để mở panel.

> Từng có thêm bản bookmarklet (một dòng `javascript:` dán vào bookmark, không cần cài). **Đã bỏ.**
> Nó buộc mọi chuỗi trong `src/` phải nằm gọn một dòng để bước rút gọn không làm hỏng cú pháp, và
> bản thân nó đã phình tới 198KB — quá dài để nhiều trình duyệt chịu lưu thành bookmark. Gỡ nó đi thì
> `build.sh` chỉ còn một đầu ra, và `src/` không còn bị ràng buộc định dạng nào.

---

## Dùng

| Tab | Trả lời câu hỏi |
|---|---|
| **Tổng quan** | User gặp chuyện gì, lúc nào, ở màn nào? Log có gì bất thường? |
| **Vấn đề** | Thật sự có mấy loại lỗi khác nhau? Mỗi loại bao nhiêu lần, lúc nào? Có sự cố hạ tầng nào đứng sau không? |
| **HTTP** | Call nào fail, `errorCode` bao nhiêu, call nào không có response? |
| **Chậm** | Thao tác nào tốn thời gian nhất? |
| **Lọc** | Chỉ hiện dòng của module X / mức ERROR / phiên 2 / khớp regex. |
| **Diễn biến** | Một dòng thời gian: user bấm gì, thấy popup gì, app đứng im lúc nào, lỗi nổ ở đâu. |

**Minimap** dưới thanh tab là mật độ log theo thời gian, đỏ = có ERROR.

| Thao tác trên minimap | Kết quả |
|---|---|
| Bấm | nhảy tới mốc đó |
| Kéo trên vùng tối | chọn một khoảng thời gian bất kỳ |
| Kéo giữa vùng sáng | dời cả khoảng, giữ nguyên độ dài |
| Kéo mép sáng | co giãn một đầu |
| Nháy đúp | bỏ chọn khoảng |

Chip `30 giây cuối` / `1 phút` /… chỉ là lối tắt cho những khoảng hay dùng — cả hai cùng ghi vào một chỗ.
Trong lúc kéo chỉ vẽ lại hai miếng mờ; bộ lọc thật chỉ áp lúc thả tay, vì mỗi lần áp là một lượt
4085 dòng cộng layout lại bảng log, quá nặng để chạy theo từng nhịp chuột.

### Mọi con số đều theo dữ liệu đang lọc

Chọn 5 phút cuối thì tỷ lệ mức độ, stat card, module ranking, tracker event, nhóm Vấn đề, HTTP, Chậm,
Diễn biến đều tính trên đúng 5 phút đó — kèm tổng của cả file để đối chiếu (`21/47`).
Về cấu trúc: `data` là kết quả parse (một lần, bất biến), `view` là thống kê của tập đang hiện;
tính lại `view` tốn ~2.5ms nên áp mỗi lần đổi lọc thoải mái.

Ba thứ **cố ý không** scope:

- **Chip đếm trong tab Lọc.** Mỗi facet đếm theo *các facet khác*, bỏ qua chính nó. Nếu không thì chọn
  ERROR xong chip WARNING về 0 và không còn đường nới rộng lại — người dùng tự khoá mình.
- **Tổng số dòng, số phiên app, cảnh báo timestamp lùi.** Là tính chất của file.
- **Khoảng lặng.** Chỉ cắt theo *cửa sổ thời gian*, không theo tập dòng: lọc "chỉ ERROR" mà tính lại
  khoảng lặng thì sinh ra những khoảng giả giữa hai lỗi, sai bản chất.
- **Chuỗi theo ID** cũng không scope: xem một request thì phải xem trọn vẹn.

### Năm thứ tiết kiệm nhiều thời gian nhất

**Miniapp tải lỗi.** `feature_miniapp_load` có một nhóm `stage` báo hiệu user vừa nhìn thấy màn lỗi
chứ không phải chỉ số đo: `scr_fail_loading_miniapp`, `toast_fail_loading_miniapp`,
`miniapp_web_js_crash`, `pu_waiting_load_bundle`, `pu_version_update`, `pu_recording`. Tên lấy nguyên
văn từ `AppEvent.FeatureMiniAppLoad.Stage` trong source app, không đoán từ log. Chúng vào thẳng mục
*User đã nhìn thấy gì*. Hai log dùng để thử đều **0 lần** — hai log đó không gặp sự cố tải miniapp,
không phải sai tên.

**Màn tải lâu nhất.** Khác hẳn *Ở lâu nhất trên màn*: đây là **số có sẵn trong log** (`duration` của
`auto_screen_displayed` lúc `state=load`, và của `auto_load_progress_tracked`), không phải số tính ra.
Tab Chậm vốn gom mọi `duration=` vào một rổ mà không gắn với màn nào; mục này gắn được, và trên log
production dùng để thử nó lôi ra ngay màn `Feedback` mất **30 268ms**.

**Cố ý không ghép cặp `stage`.** Nhìn qua thì `<stage>_start` / `<stage>_status` trông như ghép được
thành cặp để tính "bước nào chưa xong". Nhưng trên log thật, UAT có `miniapp_load_start` ×14 mà không
có `_status` nào cùng tên, còn production thì `miniapp_load_start` ×10 đi cùng `miniapp_render_status`
×10 — tên kết thúc không khớp tên bắt đầu. Ghép theo gốc tên là suy đoán, nên không làm.

**Nhiễu từ chính hệ thống đo lường.** Đo trên **50 feedback production thật** (25 iOS, 25 Android,
lấy qua API danh sách của trang admin): **1267 / 2488 dòng ERROR — 51% — không phải lỗi user gặp**,
mà là lỗi của lớp tracing. **24 / 49 log có quá nửa số dòng ERROR** thuộc loại này.

| chữ ký | dòng (trên 50 log) | nguyên nhân trong app |
|---|---|---|
| `GrafanaTrace.*:: no traceId` | 1099 | `withTraceId()` gọi `buffer.remove()` nên traceId chỉ dùng được một lần |
| `grafana >> DefaultRequestQueue >> handleError` | 138 | hàng đợi gửi trace của chính Grafana lỗi |
| `GrafanaTrace.* PaymentSession is null` | 30 | `resolveFormatter()` trả null khi Koin scope đã đóng |

Chúng ghi bằng `logger.e` trực tiếp nên **không** bị cờ Debug Tool cắt — tức có mặt trên máy user thật,
khác hẳn các dòng `@@ grafana >> startTrace` (chỉ 2/50 log có).

Tab Vấn đề tách chúng thành một khối riêng ở cuối, không trộn vào danh sách chính và không tính vào
chip đếm. Trên log UAT dùng để thử: **40/44 dòng ERROR là nhiễu**, tách xong còn đúng 4 dòng đáng đọc.

Cố ý **không** tự động tắt tiếng: tắt tiếng là quyết định của người đọc, và đôi khi chính lớp đo lường
hỏng lại là manh mối. Bấm một nút là xem lại được.

**Đừng nhầm `available` với `hasGated`.** `available` chỉ nói log có dòng trace nào không — 68% log
production có, vì vài dòng không bị cờ chặn. `hasGated` mới nói có `startTrace`/`traceFail` thật hay
không — chỉ **4%** log production có. Nhìn nhầm `available` là tưởng log nào cũng có dữ liệu trace.

**Mốc phiên app.** Nhận ba chuỗi thay vì một: `MomoDatabase init OK`, `@@ appSync >> syncStartApp`,
`[PERF] SyncAppFeature, start`. Cả ba đều ghi đúng một lần mỗi lần process khởi động, ở mức INFO, và
không bị cờ debug nào chặn (đã đọc source app). Chuỗi đầu có mặt ở **44/50** log production — 6 log
còn lại cần mốc dự phòng, vì file log bị xoay vòng thì dòng khởi động là dòng bị cắt đầu tiên. Thêm
hai mốc kia làm số phiên nhận ra trên log thử tăng từ 1 lên 3.

**Lỗi từ Grafana trace.** Ngoài các nhóm chữ ký dòng log, tab Vấn đề còn đọc `traceFail` của
`[Module: Grafana]`. Những dòng này mang sẵn `flow` + `step` + `errorCode` + `errorMessage` — mô tả
lỗi rõ hơn hầu hết dòng ERROR trong log — nhưng ghi ở mức **INFO** nên phần gom nhóm không đếm chúng.

Chúng được gom theo **`errorMessage`**, không theo `step`. Lý do nằm trong `GrafanaTracker.generateParams`:

```kotlin
if (!isPlatform(appId) && !isComposeApp(appId) && params.isStaticFlow != true) {
    this.flow = this.appId
    this.step = "${params.flow}.${params.step}"
}
```

Với miniapp thì `flow` bị ghi đè bằng `appId` và `step` bị đổi thành `"flow.step"`, nên **một** sự cố
hạ tầng hiện ra thành hàng chục dòng trông khác nhau. Gom theo `errorMessage` thì chúng về một hàng,
kèm số app bị ảnh hưởng — đo trên một log thật: 45 lần cùng lỗi `500 - B07 No version found from
remote` trải khắp **16 miniapp**, gộp lại thành một hàng thay vì 16 dòng rời tưởng là 16 sự cố lẻ.

Khi `errorMessage` rỗng thì gom theo tên bước, **không** gom theo mỗi `errorCode`: trên log thật,
gom theo mã sẽ nhét chung `TransactionResultV3_call_api_V1_REWARDS_PREDICT` với
`TabBarContainer_call_api_RIGVER_APPVERSION_V1_FEATURES` chỉ vì cả hai đều là `code 200`.

Dòng Grafana chỉ được ghi khi máy gửi feedback bật Debug Tool, nên **có log không có dòng nào**. Lúc
đó tab Vấn đề nói thẳng là log này không có, chứ không để trống — để trống thì người đọc tưởng là
không có lỗi. Đã chạy trên cả log UAT lẫn log production; hai môi trường khác nhau ở lượng dữ liệu
chứ không khác định dạng.

**Tương tác của user.** Mọi event `[Module: MoMoTracker]` đều ghi ở mức **INFO**, nên phần gom nhóm lỗi
(chỉ đọc ERROR/WARNING) không bao giờ nhắc tới chúng — kể cả khi log đang nói user vừa bị một popup
đập vào mặt 5 lần. Lens đọc `params: {k=v}` của các event đó, dựng lại thao tác của user, rồi **đặt
từng phần vào tab đã có đúng chủ đề** chứ không mở thêm tab:

| Đọc ra được | Nằm ở |
|---|---|
| Popup / bottom sheet đã hiện lên | **Tổng quan** — thứ đắt nhất, để ngay tab đầu |
| Nút đã bấm (kèm nhãn tiếng Việt user thật sự thấy, lấy từ `component_id`) | **Tổng quan** |
| Call BE fail theo `ops_receive_be` | **HTTP** — một cửa duy nhất cho câu "call nào hỏng" |
| Màn nào user ở lâu nhất | **Chậm** |
| Toàn bộ bước, trộn cùng mốc app | **Diễn biến** |

Tab **Diễn biến** trước đây tên là Timeline và chỉ có 3 loại mốc của *app* (khởi động / khoảng lặng /
nhóm lỗi) — 29 mốc, tab mỏng nhất panel. Bước tương tác của user cũng là "sắp theo timestamp thật rồi
vẽ dòng thời gian", tức cùng một thứ với hai nguồn khác nhau; tách hai tab thì phải nhảy qua nhảy lại
mới ghép được câu *user bấm gì → app đứng im 3s → lỗi gì*. Nay chung một dòng, lọc bằng chip
`App / Màn hình / Chạm / User thấy / API fail`.

Hai chỗ dữ liệu đánh lừa, đã xử lý:

- **Log ghi lặp.** Cùng một event thường xuất hiện 2 dòng. Với call BE thì khử trùng theo `trace_id`
  — chắc chắn, vì đó là ID của chính call đó (đo trên một log thật: 307 dòng `ops_receive_be` nhưng
  chỉ 166 `trace_id`, đúng bằng số dòng `ops_request_be`). Với thao tác thì không có ID nào để dựa,
  nên chỉ gộp các bước **giống hệt nhau và cách nhau dưới 1s** thành `N×`, không xoá dòng nào —
  bấm vào vẫn duyệt đủ. Ngưỡng 1s chọn theo phân bố thật: các cặp trùng chia hai cụm tách bạch,
  một cụm dưới ~1.1s và một cụm từ 70s trở lên (user làm lại thật ở phiên sau). Riêng bước API fail
  thì **không** gộp thêm: mỗi `trace_id` đã là một call riêng, gộp nữa là lệch với chính số đếm được.
- **"Ở lâu nhất trên màn" là số tính ra**, không phải trường có sẵn trong log: nó là khoảng cách tới
  bước màn hình kế tiếp. Các event nổ liên tiếp trong cùng một lần chuyển màn sẽ ra ~0ms. Trường
  `dwell_time` có sẵn của `roothome_*` để riêng trong phần mô tả, không trộn vào.

**Lấy nét theo feedback.** Khối đầu tab Tổng quan đọc metadata ngay trên trang (`Feature`, `ScreenID`,
`Entry Point`, thiết bị) và cho chip `30 giây cuối` / `1 phút` / `2 phút` / `5 phút`.
Log được chụp đúng lúc user bấm gửi, nên mép phải trục thời gian chính là lúc xảy ra vấn đề —
không phải cuộn từ dòng 1 nữa. Có sẵn nút lọc theo đúng feature của feedback.

**Tắt tiếng chữ ký (🔇 trên mỗi nhóm).** Tắt một chữ ký nhiễu (`SomeModule >> handleError`) một lần,
lưu vào `localStorage`,
mọi feedback mở sau này đều sạch. Badge tab Vấn đề và tab Diễn biến đều bỏ qua nhóm đã tắt.
Bấm chip `🔇 Đã tắt tiếng (N)` để xem lại và bật lại.

**Gom theo ID (🔗).** Một `cmdId` xuất hiện ở 5 dòng là một request đi qua 5 lớp.
Bấm 🔗 ở hàng HTTP, hoặc mục *Gom theo ID* trong tab Lọc, để xem trọn chuỗi rồi `n`/`p` duyệt tại chỗ.

**Payload (`{ }`).** Một request HTTP nằm ở hai dòng log khác nhau và mỗi dòng mang trường khác nhau
(`--encrypted` / `--body` / `--header` / `--exception` ở dòng request, `--status` ở dòng response),
nên `{ }` mở **một tấm trượt có hai tab Request / Response**, badge ghi kích thước nguyên văn của payload.
Mỗi trường là một khối riêng, có tô màu cú pháp, nút copy riêng, và chip **↩ Xuống dòng** (mặc định bật,
nhớ trong `localStorage`) để khỏi cuộn ngang khi gặp chuỗi chữ ký dài mấy nghìn ký tự.

Ba thứ hay làm `JSON.parse` chết đã xử lý sẵn (đo trên log 4085 dòng: 919 khối, 900 khối ra được cấu trúc):

- **Chỗ bị che `****`** — 118 khối. Log che theo hai kiểu: `"****"` trơ trọi giữa object, và `****`
  trần không có nháy; có chỗ che luôn cả *tên* trường (`,****{"displayName":...}`). Quét có phân biệt
  trong/ngoài chuỗi rồi chỉ dọn đúng chỗ bị che, nên `"accountNo":"**** **** **32"` không bị đụng.
  Khối nào phải dọn thì gắn nhãn *đã bỏ \*\*\*\* để parse* — không im lặng sửa dữ liệu.
- **`Map.toString()` của Kotlin/Java** (`{stage=sync_step, location={lat=0.0}}`) — 585 khối,
  chiếm đa số. Không phải JSON, trước đây hiện nguyên văn kèm cảnh báo sai ("do bị che ****").
  Nay đọc thành cây, gắn nhãn *map k=v*. Giá trị giữ nguyên dạng chuỗi vì bản thân log không có kiểu.
- **Payload bị chính logger cắt** — 19 khối. Logger của app cắt message dài
  (`... Log message truncated; exceeds 10000 characters.`) nên khối JSON không bao giờ đóng lại.
  Tool tìm **điểm cắt an toàn gần nhất** — ngay sau một giá trị hoàn chỉnh, sau dấu mở ngoặc, hoặc
  ngay trước dấu phẩy — rồi tự đóng nốt các ngoặc còn mở. 17/17 khối trong log mẫu đọc được,
  16 khối giữ được 98–100% nội dung. Nhãn ghi rõ mất bao nhiêu ký tự cuối.

  Hai chỗ dễ làm sai, đã xử lý:

  - **Số bị cắt không được nhận là giá trị.** `1788464400000` cắt còn `1788` vẫn parse được nhưng là
    số SAI. Thà bỏ hẳn còn hơn đưa ra một con số bịa.
  - **Cắt giữa một chuỗi** (`"payload":"[{\"id\":…`) thì đóng chuỗi lại và thêm `…` vào cuối giá trị
    đó, thay vì vứt cả trường. Không có bước này thì có khối chỉ đọc được 1% nội dung.

**Ô tìm trong tab HTTP.** Tìm theo URL / method / status, **và cả nội dung payload** — phần lớn lúc cần
là dò theo một `cmdId` hay `request_id` nhìn thấy ở dòng khác mà giá trị đó chỉ nằm trong body.
Gõ có debounce 120ms, dòng đầu danh sách ghi *khớp X/Y request*.

### Thanh bộ lọc thường trú

Bộ lọc là state chung nhưng nó cắt bảng log của **trang**, không cắt nội dung các tab.
Nếu chỉ nhìn thấy được ở tab Lọc thì đổi sang tab khác là mất hết dấu hiệu, rất dễ đọc nhầm dữ liệu
mà không biết. Vì vậy khi có bất kỳ điều kiện nào đang bật, một thanh hiện **ở mọi tab**:

```
2 BỘ LỌC ĐANG BẬT              hiện 21/4085 dòng
[2 phút cuối ×] [ERROR ×] [Xoá tất cả]
```

Mỗi điều kiện gỡ riêng được, tab Lọc mang badge số điều kiện, và pill lúc thu nhỏ cũng ghi `· 2 bộ lọc`.

Khi bạn nhảy tới một dòng bị bộ lọc loại (bấm một call HTTP chẳng hạn), dòng đó được hiện ra
và thanh nói thẳng: `hiện 22/4085 dòng · 1 dòng ngoài lọc` — thay vì im lặng làm sai con số.

### Mẫu bộ lọc

Đầu tab Lọc có mục **Mẫu bộ lọc**: đặt điều kiện xong, gõ tên (hoặc để trống lấy tên gợi ý từ chính
các điều kiện đang bật) rồi bấm **Lưu mẫu**. Lần sau bấm một phát là áp lại. Lưu trong `localStorage`
nên còn qua mọi feedback và mọi phiên; bấm `×` trên chip để xoá. Rê chuột lên chip thấy mô tả điều kiện.

Mẫu và permalink dùng **chung một bộ tuần tự hoá** (`serializeFilter` / `applyFilterPayload`),
khác nhau hai chỗ:

- Mẫu **không** mang theo tab đang xem và dòng đang đứng — hai thứ đó vô nghĩa ở feedback khác.
- Khoảng thời gian kết thúc đúng ở `lastTs` được lưu dạng **`wLast: 120000`** ("2 phút cuối") chứ không
  phải mốc tuyệt đối. Nhờ vậy mẫu *"lỗi 2 phút cuối"* dùng lại được ở bất kỳ feedback nào.
  Khoảng brush tuỳ ý thì đành lưu offset so với `firstTs` và kẹp lại theo độ dài log hiện tại.

**Copy link** trong tab Lọc nhét bộ lọc + dòng đang đứng vào URL hash; gửi cho đồng nghiệp là họ
mở ra đúng chỗ đó. Hash chỉ được đọc lúc khởi động và không bao giờ ghi đè `location`,
tránh làm router của SPA chạy lại.

**Phím tắt**

| Phím | Việc |
|---|---|
| `n` / `p` | dòng khớp kế tiếp / trước đó |
| `Esc` | thu panel về pill — **không** mất, bấm pill là mở lại |
| `Alt` + `L` | mở lại sau khi đã bấm `×` đóng hẳn (khỏi reload trang) |

Bấm một nhóm lỗi sẽ đặt nhóm đó làm danh sách duyệt, rồi `n`/`p` đi qua từng lần xuất hiện.

**Kích thước & vị trí:** kéo header để di chuyển; kéo **tay nắm góc dưới phải** để đổi cả rộng lẫn cao;
kéo mép trái nếu chỉ muốn đổi bề rộng mà giữ nguyên mép phải.
Kích thước được nhớ lại khi thu về pill rồi mở ra, và khi đóng rồi mở lại bằng `Alt+L`.

Đổi tab log (Log 1 → Log 2) thì panel tự quét lại sau ~2s, hoặc bấm `⟳`.

---

## Build lại

```sh
./build.sh
```

Nối `src/*.js` theo thứ tự tên file thành một IIFE rồi xuất:

- `dist/lens.js` + `extension/lens.js` — content script

Build kiểm cú pháp (`node --check`), chạy bộ test (`node test/run.js`), rồi ghi số liệu thật của bản
vừa build vào khối `<!-- build-stats -->` trong README. Trước đây số đó gõ tay, nên README ghi
bookmarklet "~114KB" trong khi thực tế đã 177KB — sai suốt một thời gian dài mà không ai biết.

`build.sh` nối mọi file trong `src/` theo thứ tự tên, nên thêm module chỉ cần đặt tên đúng chỗ.

| File | Việc |
|---|---|
| `src/01-analyzer.js` | đọc DOM → entry có cấu trúc, gom chữ ký, ghép HTTP, tính gap |
| `src/02-insights.js` | thời lượng, ID liên kết, phiên app, metadata feedback, tách khối JSON, hành trình user |
| `src/02-theme.js` | CSS |
| `src/03-shell.js` | state, nhảy dòng, bộ lọc, minimap, kéo thả, tắt tiếng, permalink |
| `src/04-sheet.js` | tấm trượt chi tiết: payload JSON và chuỗi theo ID |
| `src/04-tabs.js` | nội dung 6 tab |
| `src/05-boot.js` | gắn panel, uỷ quyền sự kiện, tự quét lại |

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
- **Tô màu JSON: quét token trước, escape từng mảnh sau.** Escape cả chuỗi rồi mới tô sẽ ăn luôn thẻ
  `<i>`; tô trước escape sau thì thẻ biến thành chữ hiển thị. Xem `highlightJson()` trong `src/04-sheet.js`.
- **Đổi bộ lọc thì vẽ lại cả tab, đừng vá từng phần tử.** Ô "Tìm trong nội dung" từng chỉ cập nhật
  thanh bộ lọc và `#fll-count` để khỏi mất con trỏ — hậu quả là chip đếm, danh sách Gom theo ID và
  nút Lưu mẫu đều đứng ở trạng thái cũ, người dùng thấy "1 bộ lọc đang bật" mà phần Mẫu vẫn bảo
  chưa có điều kiện nào. Dùng `renderTabPreservingFocus()`: vẽ lại hết rồi trả lại tiêu điểm,
  vị trí con trỏ và vị trí cuộn. Giá trị người dùng đang gõ dở phải nằm trong `tabUiState`
  (`templateName`, `issueQuery`, `moduleQuery`) chứ không phải chỉ trong DOM, nếu không vẽ lại là bay.

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

- **Lọc bằng cách đánh dấu dòng ĐƯỢC GIỮ**, không phải ẩn từng dòng bị loại: bật `.fll-filtering`
  trên container rồi gắn `.fll-keep` cho vài chục dòng khớp. Cách cũ ghi class lên ~4000 dòng mỗi lần.
- `entry.isKept` phải luôn khớp class thật trên DOM, kể cả lúc không lọc — nhờ vậy lần lọc sau
  chỉ ghi đúng phần chênh lệch.
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

## Cạm bẫy đọc log mà tool cảnh báo sẵn

Logger của app flush theo lô (`-------- LOGGER: END OF BATCH --------`). Vì vậy **thứ tự dòng không phải thứ tự thời gian**:
trong log mẫu có 93 dòng mang timestamp nhỏ hơn dòng ngay trước nó.
Minimap, gap và tab Diễn biến đều sort lại theo timestamp thật; tab Vấn đề và Lọc thì giữ thứ tự dòng gốc để còn khớp với những gì trang hiển thị.
