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

**Comment viết bằng tiếng Việt CÓ DẤU.** Toàn bộ `src/` từng viết không dấu; đã chuyển hết. Tài liệu,
chữ trên giao diện và commit message đều có dấu, để riêng code không dấu là chỗ duy nhất lạc điệu và
đọc chậm hơn hẳn. Cũng không còn dòng `// AI-GENERATED START/END` và không còn khối `File: / Created
By: / AI Agent: / Model:` ở đầu file — repo này không dùng.

**Không `import`/`export` trong `src/`.** `build.sh` nối mọi file thành MỘT IIFE nên chúng dùng chung
global scope. Đây cũng chính là thứ làm `// @ts-check` chạy được mà không cần bước biên dịch. Thêm một
dòng `import` là hỏng cả hai.

**Một lần mở app = một CHÙM mốc, không phải một mốc.** `RE_SESSION` cũ khớp ba chuỗi và cả ba đều nổ
trong cùng một lần khởi động, cách nhau vài trăm ms — đếm từng mốc thì một lần mở app thành ba phiên.
Đo trên ba log thật: khoảng cách trong cùng một chùm là 369–2078ms, giữa hai lần khởi động thật là
75 440ms và 163 029ms. Ngưỡng `SESSION_BURST_MS = 5000` nằm giữa khoảng trống 36 lần đó. Điều kiện phụ
"gặp lại đúng loại mốc đã thấy trong chùm" bắt trường hợp mở lại ngay — nhưng mới dựa trên bốn chùm
quan sát được, nên **CHƯA XÁC MINH** rằng không log nào lặp một loại mốc giữa cùng một lần chạy.

**Dòng đứng TRƯỚC mốc khởi động đầu tiên không thuộc phiên 1.** Chúng là đuôi của một lần chạy trước
đó mà log không còn giữ điểm bắt đầu (file bị cắt bớt, hoặc app đã chạy từ lâu). Gộp vào phiên 1 là
nói rằng chúng xảy ra SAU lần khởi động đó — sai cả thứ tự lẫn việc ta thật sự biết gì. Chúng mang
`SESSION_ORPHAN_INDEX`, hiện ra là **"Đuôi phiên trước"** (không phải "Phiên -1"), chip có viền đứt
bên trái, chú giải nói rõ là không có điểm bắt đầu trong file, và `summaryBlindSpots()` ghi nó vào mục
"Log này không trả lời được" của ticket.

Ba chỗ dễ sai khi sửa lại:
- **Chỉ số âm chứ không phải 0.** `filter.session` được kiểm theo kiểu truthy ở rất nhiều chỗ
  (`hasAnyFilterFacet`, `compiled.session`, `getVisibleTimeRange`, `Number(value) || null`), nên phiên 0
  sẽ bị đọc thành "không lọc phiên nào" — lọc vào đúng đoạn đó thành ra không lọc gì.
- **`buildSessions` phải đánh theo Map, không theo vị trí mảng.** `sessions[index - 1]` với index âm ghi
  ra một *thuộc tính* chứ không phải phần tử, và `filter(Boolean)` sau đó nuốt luôn cả phiên.
- **`sessionCount` đếm cả đoạn mồ côi** (nó là một lần chạy khác thật, chỉ là không thấy điểm đầu). Log
  không có mốc nào vẫn ra đúng 1 như trước, chỉ khác ở chỗ đoạn đó nay tự khai là không rõ điểm đầu.

**Ghép request/response HTTP theo THỨ TỰ DÒNG, không theo trục thời gian — và phải chừa một dòng lùi.**
Logger ghi theo lô nên dòng `ResponsePayload` có thể nằm **trước** dòng `RequestPayload` của chính nó.
Đo trên ba log thật: **0 / 3 / 16** cặp nằm ngược, và mọi cặp ngược quan sát được đều lệch **đúng một
dòng** (Δdòng = -1, Δts = 0 hoặc -2ms) — hai dòng ra trong cùng một lần flush. Vì vậy
`HTTP_PAIR_LOOKAHEAD = 1`. Bản cũ ghép response với request đứng trước nó nên hỏng cả hai đầu: request
thật bị báo "không có response" (vào `badHttpCalls`, vào thẻ "HTTP bất thường", vào ticket) rồi chính
response đó lại sinh thêm một hàng "call ma". Đo trên log production: 94 dòng request và 94 dòng
response mà ra **104 call, 10 cái báo thiếu response**; sau khi sửa còn đúng **94 call, 0 thiếu**.
Ba log thật sau khi sửa: 58 / 67 / 94 call, cả ba đều 0 cái thiếu response.

Đã **thử và bỏ** cách ghép theo trục thời gian: trục thời gian nhiễu hơn nhiều — trên log uat1 có một
cặp nằm đúng thứ tự dòng mà timestamp lệch **ngược 728ms**, chặn theo `ts` là xẻ đôi cặp đó. **CHƯA XÁC
MINH** giả định "một URL trả về theo đúng thứ tự gọi": dòng HTTP chỉ có `[Method:]` và `[URL:]`, không
có trường nào nối hai đầu.

**Cửa sổ thời gian: nhớ preset, đừng suy ngược từ hai mốc.** `setTimeWindowPreset` kẹp `timeFrom` về
`firstTs`, nên trên log **ngắn hơn preset** thì hiệu `timeTo - timeFrom` không còn bằng preset — chip
tắt và nhãn đổi thành hai mốc giờ tuyệt đối. Ba log thật dài 291s / 572s / 234s nên preset "5 phút
cuối" hỏng ở **cả ba**. Nay `filter.windowPreset` được nhớ riêng.

Cùng một trường đó xử lý nốt việc **đổi feedback trong SPA**: `timeFrom/timeTo` là mốc tuyệt đối, bấm
sang log khác là chúng vô nghĩa. Đo được: log 1 bật "2 phút cuối" rồi sang log 2 → **0/7107 dòng** lọt,
chip ghi một khoảng giờ không tồn tại trong log 2. `retargetTimeWindow()` tính lại preset theo `lastTs`
mới; còn khoảng tự kéo tay thì không đoán được ý người dùng nên chỉ giữ khi còn giao với log mới.

**Permalink phải mang đủ thứ người gửi đang THẤY, không riêng bộ điều kiện lọc.** Link từng chỉ chở
levels / modules / text / phiên / cửa sổ thời gian, nên cùng một link mà hai bên nhìn hai thứ khác nhau.
Đo bằng round-trip thật trên trang demo (log bịa, 1431 dòng, Chrome):

- **`hideOthers`** (chip "Ẩn dòng không khớp", bấm tắt được) không được ghi và `applyFilterPayload` lại
  gán cứng `true`: người gửi đang xem **cả 1431 dòng** với panel tính theo ERROR, người nhận mở đúng
  link đó thấy bảng log xén còn **53 dòng**. Vắng khoá `h` = bật, nên link cũ vẫn đọc đúng.
- **Danh sách dòng khớp**: `setMatches([mộtDòng])` làm thanh dưới ghi `1/1` và `n`/`p` chết, trong khi
  người gửi đang ở `3/53`. Nay giữ cả tập khớp và chỉ đặt con trỏ vào dòng của link (`setMatches` có
  tham số `startPos`) — đo lại: hai bên đều `3/53`, bấm `n` ra `4/53`. Không có điều kiện nào thì
  `visible` là cả log, lúc đó "duyệt kết quả" vô nghĩa: giữ nguyên cách cũ, chỉ nhảy tới dòng đó.
- **Không đoán preset từ khoảng kéo tay.** Nhánh cũ `|to - lastTs| < 1000` biến khoảng kéo tay thành
  "N cuối": nhãn người gửi `10:59:35 → 11:00:14` thành `39.5 giây cuối` bên người nhận, và tệ hơn,
  `windowPreset` khác `null` kéo theo `retargetTimeWindow()` tự tính lại cửa sổ khi sang log khác —
  một hành vi người gửi không hề chọn. Cùng lý do với luật ngay trên: kéo tay thì không đoán.
- **Trạng thái trong tab** (ô tìm, chip loại mốc, chip chỉ-call-hỏng), **ngưỡng khoảng lặng** và **vùng
  phóng to minimap** vào `payload.u` / `.g` / `.z` của permalink, **không** vào `serializeFilter()`:
  mẫu bộ lọc là bộ điều kiện dùng lại được ở feedback khác, mấy thứ kia là "đang xem lát nào của log
  này". Ngưỡng khoảng lặng đi vào `buildGaps` nên phải đặt trước rồi `scanLog()` lại — không gọi
  `rescan()`, vì `startLens` gọi `applyPermalinkFromHash` giữa `scanLog` và `mountPanel`.

Danh sách tắt tiếng chữ ký cố ý **không** vào link: nó nằm ở `localStorage` của từng người, chở cờ
"đang xem nhóm đã tắt tiếng" sang máy khác thì cờ đó chẳng trỏ vào gì.

**CHƯA XÁC MINH:** `applyPermalinkFromHash()` chạy trong **mọi** lần `startLens()`, kể cả lần watcher
gắn lại sau khi đổi feedback, mà không chỗ nào xoá `location.hash`. Nếu router của trang admin giữ
nguyên hash khi đổi route thì bộ lọc của feedback cũ sẽ được áp lại cho feedback mới — đúng thứ mà
`detachLens()` cố ý dọn. Phải bấm thử trên trang thật mới biết router có giữ hash không.

**Dòng không có giờ thừa hưởng giờ của dòng trên nó — nhưng chỉ cho cửa sổ thời gian.** Đo trên ba log
thật: **240 / 180 / 85** dòng không có timestamp (dòng tiếp nối của stack trace, dòng trống, "END OF
BATCH"). Cửa sổ thời gian từng loại thẳng chúng, tức bật cửa sổ quanh đúng lúc lỗi nổ ra thì mất luôn
phần dưới của chính stack trace đó. Giá trị nằm ở `entry.windowTs`, **không** nhập vào `entry.ts`: `ts`
đi vào khoảng lặng, minimap và phiên app — thêm giờ giả vào đó là đổi số liệu.

**Máy & môi trường đọc từ hai map của dòng request HTTP, và có sáu luật riêng.** Một dòng
`RequestPayload` chở sẵn hai map đáng đọc: `--header:` (hơn chục trường: `device-name`, `device-ip`,
`deviceid`, `device_os`, `device_performance`, `app_code`, `app_version`, `agent_id`, `lang`,
`M-Timezone`, `channel`, `env`, `map_appId`, `map_miniAppVersion`, `User-Agent`) và `--body:`
(`deviceName`, `deviceOS`, `devicePerformance`, `appCode`, `appVer`, `lang`, `channel`).

- **Header KHÔNG phải lúc nào cũng có tên máy, body thì có.** Đo trên log production 9609 dòng
  (`autoId=5956756`): `device-name` trong header **0 dòng**, `deviceName` trong body **153 dòng**, tất
  cả cùng một giá trị "Redmi Note 11". Trước khi đọc body, panel chỉ ghi được mã máy moi từ User-Agent
  — `2201117TG`: đúng, nhưng không ai đọc ra đó là Redmi Note 11. Chi phí của lượt quét body: **13.2ms**
  trên 9609 dòng (so với ~150ms cả lượt khởi động).
- **Giữ CẢ HAI cái tên của cùng một cái máy.** `env.device` là tên người đọc được, `env.deviceModel` là
  mã model trong User-Agent, hiện ra là `Redmi Note 11 (2201117TG)`. Mã model mới là thứ search
  internet ra đúng mẫu máy, tên thương mại thì không tra ngược được — bỏ mã đi là mất khả năng đó.
  Chỉ giữ mã riêng khi nó KHÁC tên, không thì dòng "Thiết bị" lặp lại chính nó.
- **Header đi trước, body chỉ ĐIỀN VÀO CHỖ TRỐNG — cố ý không cộng dồn hai bên.** Một dòng request mang
  cả body lẫn header, gộp lại là mỗi lần xuất hiện bị đếm hai lượt mà số lần đó có hiện ra trên panel.
  Cộng dồn còn xẻ một sự thật thành hai giá trị khi hai bên viết khác kiểu chữ: header ghi `"ANDROID"`,
  body ghi `"android"`.
- **Khối JSON phải nằm NGAY sau nhãn** (`block.start <= 1`). Dòng `--body: null --encryptedBody:
  --header: {…}` có thật — 20/291 dòng trên log trên. Đi tìm dấu `{` đầu tiên kể từ nhãn `--body` là
  vớ luôn map header của chính dòng đó, tức đọc một nguồn rồi ghi vào tên của nguồn kia. Có phép thử:
  bỏ điều kiện đó ra thì `bodyLineCount` nhảy từ 2 lên 3 trên fixture.
- **Không `JSON.parse` được hai map đó.** Header bị làm mờ để lại giá trị trần không có khoá
  (`"agent_id":"73217397","****","****","sessionKey":…`) nên `JSON.parse` ném lỗi ngay. Quét từng cặp
  `"khoá":"giá trị"` thì mấy token trần đó tự bị bỏ qua. Regex phải nhận cả giá trị trần vì header ghi
  `"app_version":"51310"` (có nháy) còn body ghi `"appVer":51310`.
- **Danh sách khoá là DANH SÁCH TRẮNG, cố ý không phải "đọc hết rồi lọc thứ nhạy cảm".** Cùng hai map
  đó có `authorization`, `cvs-token`, `sessionKey`, `M-Signature`, `DEVICE_IMEI`, `SECUREID`,
  `MODELID`, `checkSum` — bỏ sót một cái tên trong danh sách đen là đưa token lên panel và vào ticket
  (ticket đi thẳng ra Jira). Có phép thử quét cả panel lẫn ticket để bắt token lọt ra. Ba thứ trong
  body cố ý không lấy, đều đo trên log trên: `appId` là id của **miniapp** đang gọi (7 giá trị khác
  nhau, trong khi `app_code` chỉ có 2) — lấy nhầm thì dòng "Bản app" ghi tên một miniapp;
  `deviceNameSetting` là tên do chính người dùng đặt cho máy, hoàn toàn có thể là tên thật của họ;
  `buildNumber` bằng 0 ở cả 146/146 dòng.
- **Body chỉ đọc trên dòng `RequestPayload`.** Dòng `ResponsePayload` cũng có `--body:` nhưng không khai
  máy — đọc nó là bóc một khối JSON to cho mỗi call mà không được gì.
- **Cặp (`map_appId`, `map_miniAppVersion`) phải đọc TRONG CÙNG một dòng.** Gom riêng hai danh sách rồi
  ghép lại là gán nhầm version của miniapp này cho miniapp kia.
- **Một khoá nhiều giá trị thì giữ CẢ DANH SÁCH, đừng lấy cái hay gặp nhất — và luật này áp cho MỌI
  trường đáng lẽ không đổi, không riêng bốn cái.** Panel hiện đúng một giá trị thì để trong bảng, từ
  hai giá trị trở lên thì **bảng im** và tách thành danh sách kèm số lần: bảng ghi một giá trị trong
  khi ngay dưới là danh sách hai giá trị thì đọc ra là một khẳng định, còn nó chỉ là cái hay gặp nhất.
  Danh sách trường nằm ở `ENV_WATCHED_FIELDS` (`src/02i`), mỗi trường kèm sẵn câu nói rõ **đổi thì
  nghĩa là gì** — một danh sách trần không gắn với câu hỏi nào thì người đọc chỉ thấy hai dòng chữ:
  tên máy / hệ điều hành / đời máy / bản app / ngôn ngữ / múi giờ / kênh / môi trường / agent_id /
  deviceid / IP. Thêm trường mới thì khai ở đó, renderer tự có — nó chỉ biết một luật, không nhớ tên
  từng trường.

  Bốn chỗ dễ sai, cả bốn đều đã dính:
  - **Mã model chỉ giữ riêng khi tên máy CHƯA CHỨA nó.** Có log ghi `device-name` là `Oppo CPH2083`
    còn User-Agent ghi `CPH2083` — so bằng `!==` thì dòng Thiết bị ra `Oppo CPH2083 (CPH2083)`.
  - **Hệ điều hành phải gộp theo NHÃN, không theo chuỗi User-Agent.** Đo trên log thật: **8 chuỗi UA
    khác nhau mà chỉ một hệ điều hành** — chúng chỉ khác cái đuôi `AgentID/…`. Lấy UA thô làm danh sách
    thì log nào cũng báo "8 giá trị khác nhau".
  - **Đừng bỏ đường dự phòng của từng trường khi gom về một cơ chế.** `lang` còn có `M-Lang` và một
    đường quét chữ trong dòng log, `env` còn có `app_type`, `device_performance` còn có đường quét —
    chúng sinh ra cho log **không có request HTTP nào**. Gom xong mà chỉ đọc đúng một khoá là mất sạch.
    Cùng lý do, `available` phải tính cả `watched.length`, không thì đọc được rồi nhưng mục không hiện.
  - **Cố ý KHÔNG theo dõi:** `map_screen_name` (đổi theo từng request — đó là bản chất của nó, không
    phải "thay đổi"), `map_appId`/`map_miniAppVersion` (đã có mục MiniApp riêng, nhiều miniapp là bình
    thường), `User-Agent` thô (lý do ngay trên).

  Khối ticket có một dòng **"Đổi giữa chừng"** liệt kê những trường này khi chúng đổi: người đọc ticket
  cần biết điều đó TRƯỚC khi tin mấy con số phía trên, vì chúng đang cộng của cả hai bên.

**Lỗi do CHÍNH miniapp báo về: đọc từ `MiniAppErrorContext`, và lớp này ghi BA loại dòng.**

| loại | dạng | mang trường lỗi? |
|---|---|---|
| `add` | `Add error context key: <uuid> {errorMiniAppId=…, errorCode=…, errorMessage=…, errorStack=…` | **có, đủ** |
| `report` | `report error with params: {…} baseParams: {…}` | **có, đủ** (thêm `screenId`, `source`) |
| `remove` | `Remove error context <uuid> true` | không — đây mới là sổ sách |

Đây là một trong số rất ít chỗ trong log nói thẳng "lỗi gì" bằng câu người đọc được, kèm
`errorCode`, `miniAppVersion`, `featureCode`. Đo trên hai log production:

- `autoId=5956827` (8541 dòng): 7 dòng của lớp này = **3 add + 2 report + 2 remove**, xếp theo thời
  gian thành `add → (report) → remove` cho từng sự cố. Ra **2 nhóm**: `cinema/223` (2 add + 2 report =
  **2 sự cố**) và `platform/40000 "Bạn hãy thử lại sau vài phút nhé."` (**chỉ có add**).
- `autoId=5956906` (8357 dòng): cả log **đúng một dòng `add`**, không có `report` nào — lỗi
  `groupfund/1407/223` kèm stack `java.lang.IllegalStateException: addViewAt: failed to insert view
  [1964] into parent [1192] at index 1`.
- Chi phí: **5.2ms** trên 8541 dòng.

- **Một sự cố ghi ra tối đa MỘT dòng add và MỘT dòng report, nên cộng hai loại lại là đếm đôi.** Số lần
  của một nhóm lấy `max(số add, số report)`: log chỉ có add thì ra số add, chỉ có report thì ra số
  report. Chú giải của hàng nói ra cách đếm đó, không thì người đọc đếm dòng trong log rồi thấy lệch.
- **Map cuối không đóng.** Dòng kết thúc ngay ở `errorStack=` hoặc cụt giữa stack (554–559 ký tự — chưa
  chạm ngưỡng cắt 10000 của logger, nên đây là hình dạng bình thường chứ không phải log hỏng).
  `parseKeyValueMap` đòi ký tự cuối là `}` nên phải tự đóng trước khi parse; không thì mất sạch
  `errorCode`/`errorMessage`, tức mất đúng thứ đáng đọc nhất của dòng.
- **Dòng ghi ở mức WARNING** nên nhóm chữ ký có đếm nhưng không bao giờ nêu bật — cùng loại với popup
  ghi ở mức INFO. Vì vậy nó có mục riêng ở tab Vấn đề và một mục riêng trong ticket, đặt TRƯỚC các
  nguồn lỗi khác.
- Gom theo (miniapp, mã lỗi, câu lỗi): hai miniapp cùng dính một câu lỗi vẫn là hai hàng, vì lỗi của
  miniapp nào là chuyện của đội đó. Khác hẳn cách gom của Grafana trace (gom theo `errorMessage` để một
  sự cố hạ tầng ở nhiều app về một hàng). Dòng `report` mang thêm `screenId`/`source` mà dòng `add`
  không có, nên điền bù vào chỗ còn trống của nhóm.
- `errorStack` cắt còn 400 ký tự và chỉ nằm trong chú giải, **không vào ticket** — cùng luật với payload thô.

*Một phép đo đã lừa, ghi lại kẻo lặp:* bản đầu chỉ đọc `report` vì tôi nhìn **220 ký tự đầu** của 5
dòng add/remove rồi kết luận cả 5 là "sổ sách của lớp đó". Thật ra trường lỗi nằm sau ký tự thứ 220.
Hậu quả: mất hẳn lỗi `40000` ở log trên, và log `5956906` thì mục này rỗng trơn dù có lỗi thật. Người
dùng bắt được. **Đọc nguyên văn dòng trước khi phân loại nó** — cắt bớt để nhìn cho gọn là đang tự bịt
mắt mình.

**Version của miniapp: header chỉ thấy bản CUỐI, đường đi nằm ở dòng nạp bundle.** `map_miniAppVersion`
trong header là version tại lúc gọi request, nên một miniapp cập nhật giữa log thì mục MiniApp chỉ hiện
một con số. Dòng `[BundleExecutorManager] [<appId>] execute version: {…}` (Map.toString của Kotlin, đọc
bằng `parseKeyValueMap`) mới nói ra cả `buildNumber`, `size`, `installMode`, `deploymentTarget`,
`trackingFlag`, và quan trọng nhất là `diffChange={fromBuildNumber, toBuildNumber, size}` — tức bản này
được **vá** lên từ bản nào. Đo trên log production (`autoId=5956827`): `vn.momo.expense` đi
**3420 → 3449 → 3494** ngay trong một log; `vn.momo.bank` 10773 → 10808; `vn.momo.financial_hub`
1868 → 1880. Chi phí **6.8ms** trên 8541 dòng.

- **`map_miniAppVersion` trong header và `buildNumber` trong dòng nạp bundle là CÙNG một dãy số.** Đo
  trên log thật (`autoId=5956827`): app duy nhất mang cả hai khai header **3449**, còn bundle log khai
  **3449 và 3494** — tức header nói bản đang chạy lúc gọi request, bundle log nói thêm bản vừa vá lên.
  Panel vì vậy để số version ở cột phải của hàng miniapp và bản build ở hàng con, không đổi tên gọi.
  Nguồn thứ ba nói cùng một điều: dòng `MiniAppErrorContext` của `vn.momo.cinema` khai
  `miniAppVersion=4042`, còn bundle log của chính app đó khai `buildNumber=4042`.
  **CHƯA XÁC MINH trên diện rộng:** mới hai app trong một log có từ hai nguồn trở lên. Vì vậy chữ trên panel chỉ nói mỗi con số ĐẾN TỪ ĐÂU, không khẳng định quan hệ.

  *Một câu đã viết sai và phải rút lại:* dòng chữ đầu mục từng ghi "hai cách đánh số khác nhau" — tôi
  tự nghĩ ra, không đo. Người dùng bắt được vì log demo bịa hai dãy số rời nhau (header 694 nằm cạnh
  build 3420) nên đọc ra như tool tính sai. Log demo nay dùng chung một dãy số cho cùng một miniapp.
- **Phải đòi đúng `execute version:` rồi tới `{`.** Cùng chuỗi "execute version" còn một dòng khác hẳn:
  `execute version.appId: vn.momo.expense loaded event. bridge data: …`. Đo trên log trên: 54 dòng chứa
  chuỗi đó thì **20 dòng là loại này**. Sàng `indexOf` trước cho rẻ, rồi mới regex.
- **Danh sách trắng, y như header.** Cùng map đó có `signature` dài hơn 1000 ký tự, `checksum`,
  `cdnUrl`, `downloadUrls`, `jsBundlePath` — panel rộng 480px không có chỗ, mà ticket thì loãng. Có
  phép thử quét cả panel lẫn ticket để bắt chữ ký lọt ra.
- **Giữ thứ tự GẶP LẦN ĐẦU, đừng sắp theo số lần.** Câu chuyện ở đây là "đi từ bản nào lên bản nào";
  sắp theo số lần là đọc ngược dòng thời gian.
- **Đường đi phải bắt đầu từ `from` của lần nạp ĐẦU.** Trên log thật lần nạp đầu tiên của
  `vn.momo.expense` đã là "3449 vá từ 3420" — liệt kê trơn số build ra "3449 → 3494" và bản gốc 3420
  biến mất khỏi ticket. Cùng lý do, **một lần nạp duy nhất mà là bản vá thì vẫn tính là có đổi bản**.
- **Miniapp chỉ thấy trong log nạp bundle mà chưa gọi request nào vẫn phải có mặt** trong mục MiniApp —
  nó là một miniapp đã chạy. Hàng của nó không bấm được (không có request để duyệt), nên cũng không
  được để con trỏ mời bấm.
- Hàng bundle trỏ bằng `data-envapp="<miniapp>:<bundle>"`, hàng miniapp là `data-envapp="<miniapp>"`.
  Hàng con nằm **phẳng** trong cùng khối `.fll-rank`, thụt lề bằng class `.fll-rk.sub` (lề trái + vạch
  dọc) chứ không lồng thêm div: lồng thì ô tìm nhanh và bước cắt bớt hàng của mục không còn nhận ra
  hàng nữa. Bản đầu chỉ lùi bằng ký tự `↳` — nhìn ra một danh sách phẳng dài thượt, không thấy hàng
  nào thuộc hàng nào.
- **MiniApp là MỤC RIÊNG, không nằm trong "Máy & môi trường".** Lý do đo được: mục chung có **bốn khối
  `.fll-rank`** (bảng, danh sách trường đổi, danh sách miniapp) mà `sectionRowContainer()` chỉ gỡ được
  **đúng một** khối bọc — nhiều khối thì nó đếm ra 4 "hàng", dưới ngưỡng 6 nên mục đó **không bao giờ**
  được chèn ô tìm và cũng không bao giờ bị cắt bớt. Tách ra thì mục MiniApp có đúng một khối, tự có ô
  tìm, tự bị cắt ở 12 hàng, có badge riêng, và **mặc định thu lại** như mọi mục khác.
- **Ô tìm: hàng con đi theo hàng cha, CẢ HAI CHIỀU.** Gõ tên miniapp thì mấy hàng bản build của nó phải
  còn (chữ trong hàng con không hề chứa tên app), mà gõ số build thì hàng miniapp chứa nó cũng phải còn
  — không thì hàng build hiện ra trơ trọi, không biết của app nào. Phải quét **hai lượt**: lượt một
  chưa biết hàng con phía sau có khớp không. Đo trong Chrome: gõ `ngan_hang` ra hàng app + 2 hàng
  build; gõ `3449` ra hàng app `quy_dau_tu` + 2 hàng build có số đó.

**Nhãn hệ điều hành dựng trong `02i`, không ghép chữ ở renderer.** Bản cũ chỉ khớp User-Agent kiểu iOS
(`MoMoPlatform … CFNetwork … Darwin`) rồi renderer tự ghép `'iOS ' + osVersion`. Đo trên một dòng log
Android thật: ra được đúng `device_os` / `device_performance` / `lang`, mất sạch tên máy, `app_code`,
`app_version` — và nếu đoán bừa thì panel ghi "iOS 9" cho máy Oppo. Nay `env.osLabel` do module dựng
(`Android 9` hoặc `iOS 16.7.16`), không đoán được thì chỉ ghi tên hệ điều hành.

**JSON in ra nhiều dòng: nối lại CHỈ cho đường mở payload, tuyệt đối không nhập vào `entry.raw`.**
Trang admin in JSON nhiều dòng thì mỗi dòng vật lý là một `logRow` riêng — dòng mở khối có `{` mà không
bao giờ đóng trong chính nó, những dòng sau không có giờ, không có mức độ. Gặp thật trên log production
(một khối config dài từ dòng 2643 trở đi). `logicalPayloadText()` nối thêm các dòng tiếp nối cho tới khi
cân ngoặc; `entry.raw` giữ nguyên vì raw đi vào tìm kiếm, chữ ký lỗi, khoảng lặng, dò khối lặp — thêm
chữ của dòng khác vào đó là đổi mọi con số. Cùng lý do với `windowTs` không được nhập vào `ts`.

- **Dừng ở dòng có `ts` riêng.** Đó là một dòng log mới; khối chưa cân thì thà hiện phần đọc được còn
  hơn nuốt luôn dòng log sau vào khối.
- **Đếm ngoặc phải phân biệt trong/ngoài chuỗi**, nếu không thì một dấu ngoặc nằm trong giá trị text
  (`"url": "https://a/{id}"`) làm lệch độ sâu và khối không bao giờ cân.
- Đo trên trang demo: một response bị tách thành **15 dòng** nay mở ra đúng **240 B** JSON trọn vẹn,
  kết thúc ở `"message": "Thành công"`.

Đo trên chính khối JSON nhiều dòng đó, những cơ chế khác **không bị ảnh hưởng**: dòng tiếp nối không có
mức độ nên không lọt vào tỉ lệ mức độ hay nhóm chữ ký, không có `ts` nên không lọt vào khoảng lặng /
phiên app / minimap, và vẫn nằm trong cửa sổ thời gian nhờ `windowTs`. Hai chỗ **không** sửa: tìm một
chuỗi vắt qua hai dòng thì không ra (bộ lọc làm việc trên từng dòng, đổi chỗ này là đổi mọi con số), và
**CHƯA XÁC MINH** khối JSON lặp lại có làm bộ dò "log bị nối đôi" báo nhầm không.

**Mọi mã lỗi: đọc bằng MỘT regex trên text, không đi gom từ bốn cấu trúc đã parse.** Mã lỗi nằm rải ở
bốn nguồn viết theo bốn kiểu — `entry.http.errorCode` (payload HTTP), `error_code=` trong params của
MoMoTracker, `errorCode=` trong TraceParameter của Grafana, và `"errorCode": 413` nằm trong thân JSON
(kể cả khi thân đó bị tách ra nhiều dòng). Gom từ bốn cấu trúc thì phải nhớ bốn chỗ và sẽ quên chỗ thứ
năm; một regex trên chính dòng text bắt hết. Sàng bằng `indexOf` trước, cùng lý do với chữ ký lỗi.
**Mã 0 bị loại**: `ops_receive_be` ghi `error_code=0` cho mọi call thành công, để lẫn vào thì mã hay
gặp nhất trong log nào cũng là 0.

**"Giá trị bắt được": ô tìm regex tự gom, thay cho những mục trích xuất dựng sẵn.** Từng tính làm hẳn
mấy mục "mọi IP / mọi email / mọi URL". Bỏ, vì: phần lớn đã có nơi khác *kèm ngữ cảnh* (URL ở mục Call
HTTP có status và thời lượng, IP ở Máy & môi trường, ID ở Gom theo ID), một danh sách trần không gắn
với câu hỏi nào, và quét 7 regex trên 4085 dòng lúc khởi động là lặp lại đúng cái bẫy đã đo ở chữ ký
lỗi. Thay vào đó ô tìm regex — vốn đã là bộ trích xuất vạn năng — chỉ thiếu một bước: nó hiện ra DÒNG
chứ không hiện ra GIÁ TRỊ. Nay mẫu có nhóm bắt thì hiện thêm danh sách `giá trị → số lần`, bấm vào
duyệt được những dòng chứa nó. Không tốn gì lúc khởi động, không có mục nào nằm thường trực, và không
phải đoán trước loại nào đáng quét.

Ba chỗ dễ sai trong đó, đều có phép thử:
- **Mẫu khớp chuỗi RỖNG** (`(\d*)`) thì `lastIndex` không tiến và vòng lặp treo cứng trang. Phải tự
  cộng `lastIndex` khi `hit[0] === ''`.
- **Lấy nhóm đầu tiên CÓ giá trị, không phải `hit[1]`**: mẫu có nhánh (`a(x)|b(y)`) thì nhóm 1 rỗng khi
  nhánh sau khớp, lấy cứng `hit[1]` ra một danh sách toàn `undefined`.
- **Đếm số nhóm bắt bằng cách thêm một nhánh rỗng** (`new RegExp(source + '|').exec('')`) chứ đừng tự
  parse regex; mẫu hỏng thì trả 0 chứ không được ngã.

**Nhãn nguồn cấu hình không được suy đoán.** `src/02g-config.js` chỉ gán nguồn khi chính dòng log nói
ra (chữ `webadmin`, url CDN, tên lớp `ABTestingExpTag`...). Dòng không tự khai thì vào nhóm
`oth` = "Chưa rõ nguồn", tuyệt đối không gán bừa vào BE.

**Badge của mục nằm NGOÀI khoá nhớ trạng thái.** `collapsifySections()` lấy `data-sec` làm khoá; nếu
lấy `textContent` thì badge lọt vào khoá, mà badge đổi theo từng log — mở một mục ở log này, sang log
khác lại thấy đóng. Mọi tiêu đề mục phải đi qua `secTitle(title, badge, tone)`.

**"Gom theo ID": lọc DANH SÁCH, không cắt CHUỖI.** `buildCorrelations` cố ý đọc `data.entries` chứ
không đọc view — xem một `cmdId` đi qua mấy lớp mà thiếu mất vài lớp là đúng thứ làm người đọc kết luận
sai. Nhưng "không cắt chuỗi" khác "không cắt danh sách": mục này từng liệt kê MỌI ID của cả log ngay cả
khi đang bật cửa sổ thời gian, trong khi mọi mục xung quanh đều theo bộ lọc, và không có một dòng chữ
nào nói ra. Nay danh sách chỉ giữ ID còn ít nhất một dòng trong tập đang xem, badge ghi `N/tổng`, chữ
nói rõ là bấm vào vẫn mở trọn chuỗi.

**`hide()` của tab đọc data ĐẦY ĐỦ, không phải view đang lọc.** Lọc hẹp lại thì tab tự ẩn sẽ biến mất
giữa chừng. Tab có hay không là tính chất của cả log; nội dung bên trong mới chạy theo bộ lọc.

Luật đó áp cho cả **câu chữ**: "log này không có X" là khẳng định về CẢ LOG nên chỉ được đọc
`lensState.data`. Lọc còn ERROR xong tab Cấu hình từng in "Log này không có dòng cấu hình nào đọc được"
trong khi cả log có 34 khoá. Khi data có mà view rỗng thì đổi hẳn câu (`emptyBecauseOfFilter()`): nói
rõ là do bộ lọc, kèm số của cả log và một nút bỏ lọc.

**Mục "Máy & môi trường" chạy theo bộ lọc như mọi mục khác — nó là mục CUỐI CÙNG còn đọc thẳng
`lensState.data`.** Lọc vào đúng một phiên app thì "bản app" phải là bản của phiên đó. Đo trên log
production 9609 dòng: cả log có hai bản (người dùng nâng cấp giữa chừng), đọc theo cả log thì panel ghi
bản **hay gặp nhất** — tức bản CŨ — trong khi feedback được gửi từ bản mới. Lọc hết dòng request thì
mục không được im lặng biến mất: `emptyBecauseOfFilter()` nói rõ là do bộ lọc và kèm nút bỏ lọc, đúng
luật "log này không có X" ở trên. Hai phép thử khoá cả hai đầu.

**Lọc TRƯỚC rồi mới chuyển tab, không được làm ngược lại.** `switchTab()` vẽ tab ngay lập tức, còn
`renderFilterTab()` thì đọc `getFilterResult()` — tức kết quả ĐÃ tính. Vẽ trước khi lọc thì tab Lọc
hiện ra với mục "Mức độ: ERROR" nhưng "Kết quả" vẫn là số của cả log, và nó đứng nguyên như vậy cho tới
lần vẽ sau. Đo trên log production: bấm thẻ ERROR (56/9609 dòng) xong tab Lọc vẫn ghi **9609/9609**, cả
danh sách module lẫn "Gom theo ID" cũng là của cả log. Bốn chỗ từng sai: `filterByLevel`,
`filterByModule`, nhánh `data-event` và `filterFeature`. `applyFilter()` không tự vẽ lại tab nên đổi thứ
tự không tốn thêm lần vẽ nào. `setSession` vốn đã đúng (lọc xong mới `renderTab()`).

**Chữ hướng dẫn trên giao diện: một câu.** Giải thích dài để trong chú giải của chính phần tử nó nói
về. Panel chỉ rộng 480px, mỗi câu thừa đẩy nội dung thật xuống dưới màn.

**Khối tóm tắt ticket chỉ chứa sự kiện có giờ.** `buildTicketSummary()` đi thẳng ra ngoài repo — vào
Jira, vào chat — nên hai luật cứng, cả hai đều có phép thử: (1) **không xếp hạng nguyên nhân**, không
câu "nguyên nhân là X"; suy đoán nằm lại trong ticket sẽ được người sau đọc như sự thật; (2) **không
kéo payload thô vào**, chỉ lấy trường đã hiển thị trên panel — payload chứa số điện thoại và token.
Nó cũng luôn đọc `lensState.data` (đầy đủ) chứ không đọc view đang lọc: ticket phải mô tả cả log, không
phải mô tả lát cắt người đọc đang mở.

**macOS chặn DÁN khối ticket vào Terminal/VSCode — không phải lỗi của tool, và cũng đừng đi sửa
định dạng để né.** Người dùng báo: bấm "Copy tóm tắt cho ticket" rồi dán vào VSCode thì macOS hiện
*"Your copy and paste was blocked because it contains malware… Malicious instructions can look
legitimate…"*. Đã đo trên máy thật, log production (`autoId=5956756`, khối ticket 2404 ký tự):

- **Clipboard KHÔNG rỗng.** Dán vào một `<textarea>` ngay trong trình duyệt ra đủ **2404 ký tự**. Cùng
  lúc đó `pbpaste` trong Terminal trả về **0 byte** và AppleScript ném lỗi pasteboard `-25133`. Tức
  macOS chặn theo **ứng dụng đích**, không phải chặn lúc copy. Suýt kết luận ngược: thấy clipboard
  "rỗng" qua `pbpaste` nên tưởng cú copy bị xoá trắng.
- **Không khoanh được vào mục nào.** Bỏ mục Call HTTP, bỏ mục nhóm lỗi, bỏ mục bước cuối — **cả ba đều
  vẫn bị chặn**. Bỏ sạch markdown (`##`, `**`, backtick, gạch đầu dòng) cũng **vẫn bị chặn**. Trong khi
  một bản dựng lại 945 ký tự gồm ba mục tương tự thì **qua được**, và 945 ký tự chữ vô nghĩa cũng qua.
- **Tín hiệu không ổn định.** Đúng một chuỗi 945 ký tự: lần đầu bị chặn, lần sau qua. Nên mọi kết luận
  kiểu "backtick là thủ phạm" đều sai — đã suýt viết ra đúng câu đó.

Vì vậy: **không đổi định dạng khối ticket để né bộ lọc này.** Sửa theo một tín hiệu không tái hiện được
thì chỉ là mê tín, mà lại làm hỏng thứ đang đọc tốt. Cách dùng được ngay: **dán thẳng vào Jira/chat
trên trình duyệt** (đã đo là chạy) — vốn cũng là nơi khối này sinh ra để đến.

**Khoảng lặng ≠ app treo.** Trạng thái app chỉ nằm ghép trong dòng MQTT (`... - appState: BACKGROUND -`)
— không có dòng lifecycle riêng nào (`didEnterBackground`, `willEnterForeground`, `onPause` đều **0 lần**
trên cả ba log). `markBackgroundGaps()` gắn nhãn khoảng lặng nào là do user rời app. Đo trên ba log
thật: log `33112319` có 22 khoảng lặng, **hai cái dài nhất** (2m23s và 3m52s) đều là app ở nền — bỏ ra
thì khoảng im lặng thật dài nhất chỉ còn **8.5s**. Trước đó tool báo cả hai loại như nhau, tức nói
"app đứng im 4 phút" trong khi user chỉ bấm Home.

Hai chỗ dễ sai khi sửa lại: (1) mốc đổi trạng thái nằm **sớm hơn** `gap.before.ts` vài chục ms, vì ba
module MQTT cùng ghi một lúc và dòng cuối trước khoảng lặng là dòng thứ ba — chặn cứng
`mốc >= gap.before.ts` thì trượt hết; (2) phải có **cả hai** đầu (xuống nền *và* trở lại), chỉ thấy một
đầu thì không kết luận — có thể app xuống nền rồi bị giết hẳn.

**Log có thể bị nối đôi — kiểm trước khi tin bất kỳ con số nào.** Một log feedback production thật
(`autoId=45490371`) dài 4222 dòng hoá ra là 2111 dòng đầu **lặp lại nguyên xi**: `md5` hai nửa bằng
nhau, chỗ nối ngay sau một dòng `LOGGER: END OF BATCH`. Đo bằng chính tool sau khi bỏ khối lặp: call
HTTP `104 → 53`, `ops_receive_be` `232 → 116`, mỗi nhóm lỗi `2 → 1` và `10 → 5`. Số **nhóm** thì không
đổi (chữ ký vẫn thế), chỉ số **lần** trong mỗi nhóm gấp đôi — nên nhìn danh sách nhóm sẽ không thấy gì
bất thường. `src/02h-duplicate.js` bỏ phiếu theo độ lệch giữa hai lần một dòng xuất hiện, rồi xác minh
bằng chuỗi liên tiếp dài nhất. Hai điều đã học khi làm:
- **Dòng ngắn phải trung tính**, không được cắt đứt chuỗi: coi dòng trống là cắt đứt thì khối 2111 dòng
  chỉ nhận ra được **491** dòng.
- **Không tự động bỏ khối lặp.** Báo trước, để người đọc bấm — khử nhầm một khối không lặp thì số liệu
  cũng sai, chỉ là sai theo hướng khác và lúc đó không còn dấu hiệu nào để nhận ra.
- **Chỉ dòng CÓ GIỜ RIÊNG mới được bỏ phiếu và mới tính là khớp.** Nội dung lặp không phải file lặp:
  app fetch config hai lần thì in ra hai khối JSON vài trăm dòng giống hệt nhau, mà dòng bên trong khối
  JSON không có giờ riêng. Log bị nối đôi thì ngược lại — chính những dòng CÓ giờ lặp lại nguyên xi
  (md5 hai nửa bằng nhau). Gặp thật: người dùng báo một log production bị cảnh báo lặp ngay chỗ khối
  JSON xuống dòng. Dựng lại đúng hình đó (khối config 300 dòng, in hai lần, cách nhau 30 dòng): bản cũ
  báo **"khối lặp 301 dòng, 91 dòng khớp"** — tức nói rằng cả file bị nối đôi và mọi con số đang đếm
  gấp đôi. Sau khi lọc theo `ts`: khối JSON hết phiếu, còn log nối đôi thật vẫn nhận ra (**92 dòng
  khớp**, gấp đôi ngưỡng 40). Đánh đổi đã biết: log nối đôi mà phần lặp *toàn* dòng không có giờ thì
  nay sẽ bị bỏ sót — thà sót còn hơn báo sai, vì cảnh báo này đi thẳng vào ticket.

**Đặt tên một bước hành trình: đi theo bậc, không lấy một trường duy nhất.** `pickJourneyLabel()`
lấy trường đầu tiên không rỗng theo thứ tự *"càng riêng cho bước này và càng giống thứ user nhìn thấy
thì càng ưu tiên"*: (1) chữ user thật sự đọc được — `title`, `button_name`; (2) tên thành phần do dev
đặt — `component_name`, `popup_name`, đuôi của `component_id`; (3) bối cảnh rộng hơn — `feature_code`,
`service_name`. Bậc 3 không bao giờ nên đứng một mình ở chỗ khác (một `feature_code` có hàng chục
popup), nhưng vẫn hơn chữ "popup" trơn. Lý do có luật này: trên log thật `title=null` khá thường, và
khi đó hai popup khác hẳn nhau bị gom thành một hàng `2× popup` — mất sạch cái để phân biệt.

**Thêm thứ dùng chung cho MỌI mục thì làm bằng một lượt quét sau khi vẽ, đừng sửa từng renderer.**
Đã trả giá đúng ba lần và cả ba lần cách này đều thắng: mục đóng/mở được (`collapsifySections`), ô
tìm nhanh trong từng mục (`addSectionSearch`), và cắt bớt hàng thừa của mục dài (`capSectionRows`). Đối chứng: mỗi ô tìm kiểu cũ (`#fll-q`, `#fll-httpq`,
`#fll-modq`, `#fll-tlq`) phải sửa ở **hai file** — một trường `tabUiState`, một nhánh trong
`handleLensInput`, một thẻ `<input>`, một id container. Nhân lên ~20 mục là ~80 chỗ sửa, và mỗi mục
thêm sau này lại phải nhớ làm theo.

Hai cái bẫy của cách này, đều đã gặp: (1) hàng của một mục **không phải lúc nào cũng là con trực tiếp**
của thân mục — nhiều danh sách bọc trong đúng một thẻ (`.fll-rank`, `.fll-lvkey`), đếm con trực tiếp ra
1 nên ô tìm không bao giờ được chèn; (2) mục nào **đã có ô tìm riêng** (tìm trên toàn bộ dữ liệu, không
chỉ trang đang hiện) thì phải bỏ qua, đừng chèn chồng.

**Cắt bớt hàng phải làm SAU khi vẽ, không cắt trong renderer.** Cắt trong renderer thì tổng bị mất
luôn: `extractDurations` từng cắt còn 80 hàng **trước khi trả về**, nên badge của mục ghi "80" trong
khi log có 160 con số — mà chữ ngay dưới lại ghi "**Mọi** con số thời lượng". Nay renderer trả về đủ,
`capSectionRows` giấu phần thừa (`SECTION_MAX_ROWS = 12`) và thêm nút "Hiện thêm". Nhờ vậy badge là
tổng thật, và ô tìm nhanh vẫn chạm tới được phần bị giấu (chúng nằm trong DOM, chỉ đang `hidden`) —
gõ đúng tên một hàng bị cắt vẫn ra kết quả. Mục **tự quản lý phân trang** (danh sách nhóm lỗi, danh
sách mốc) thì bỏ qua, đừng cắt chồng lên phân trang của nó. Đo trong Chrome trên trang demo: bung
476 hàng bị cắt mất **2.9ms**.

**`momoClassDiscriminator` là tên màn chính xác — nhưng KHÔNG phải lúc nào cũng là tên màn.** Trên log
thật, hai màn cùng ghi `screen_name=result` mà là hai lớp khác hẳn
(`TransactionResultRevampScreenDisplayed` vs `TransactionResultWidgetDisplayed`) nên bị gom làm một
hàng. Nhưng ở một log khác, **64/64** dòng mang trường này đều là `PromotionEventParams` — lớp chứa
*tham số*, không phải tên màn; lấy bừa thì mọi màn đều bị đặt tên đó. `journeySurfaceName()` vì vậy chỉ
nhận lớp kết thúc bằng `Displayed` / `Interacted` / `Viewed`. Đo trên 10 đuôi lớp quan sát được ở hai
log: 7 cái khớp đều là tên bề mặt thật, 3 cái không khớp đều không phải. **CHƯA XÁC MINH** trên dải lớp
rộng hơn — mới có hai log mang trường này.

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

Nối `src/*.js` theo thứ tự tên file thành một IIFE rồi xuất **hai** file:

- `extension/lens.js` — bản đọc được. Extension nạp bản này, và mọi phép thử chạy trên nó.
- `extension/lens.min.js` — bản rút gọn, **đây là bản gửi cho WebAdmin**. Trang đó chở file này cho
  người dùng thật nên kích thước là chuyện của họ; còn debug tool thì cần đọc được stack trace.

Đo trên bản build hiện tại: **371 579 → 155 536 bytes** (−58%), gzip **109 630 → 47 243** (−57%),
brotli **89 478 → 41 260** (−54%). Nói rõ vì dễ nhầm: con số "hơn 300KB" là kích thước file chưa nén —
thứ đi qua đường truyền là bản nén, tức ~90–110KB trước khi rút gọn.

Hai đầu ra này KHÁC với `dist/` ngày xưa (một bản sao thủ công, đã bỏ): chúng sinh ra trong cùng một
lần build từ cùng một nguồn nên không lệch nhau được.

Bước rút gọn **không bắt buộc**, cùng lý do với `tsc`: không có `esbuild` (kể cả qua `npx`) thì báo rồi
đi tiếp, `extension/lens.js` vẫn là đầu ra chính. Đã kiểm không có chỗ nào phụ thuộc tên hàm/biến lúc
chạy (`.name` trong `src/` toàn là field của object dữ liệu, không có `eval`/`new Function`), và không
bật `--mangle-props` nên tên thuộc tính giữ nguyên.

**Bộ test KHÔNG chạy được trên bản rút gọn**: harness lấy hàm ra bằng cách chèn một dòng
`globalThis.__LENS={analyzeLog,...}` — toàn tên, mà minify đổi hết tên. Vì vậy bản rút gọn phải được
**thử tay trên trang demo**: mở panel, đi qua cả năm tab, lọc, mở tấm trượt payload, rê chuột trên bảng
log, và xem console có lỗi nào không.

*Một lần suýt kết luận sai, ghi lại kẻo lặp:* lúc thử bản rút gọn, mục Call HTTP hiện mọi call là
"no res" → tưởng minify làm hỏng ghép request/response. Thật ra lúc đó **vẫn còn bộ lọc regex đang
bật**, mà mục HTTP đọc theo view đang lọc — chỉ dòng request khớp bộ lọc đó nên mọi call mất response.
Bisect bằng ba biến thể (`--minify-whitespace`, `--minify-identifiers`, `--minify-syntax`) và cả bản
gốc: cả bốn đều ra **70/70 call có response**. Thử bản rút gọn thì phải thử trên trạng thái SẠCH.

Build kiểm cú pháp (`node --check`), **kiểm kiểu** (`tsc --noEmit`) và chạy bộ test (`node test/run.js`).

Từng có thêm một bước ghi số liệu bản build (KB, số dòng nguồn, số phép thử) vào khối
`<!-- build-stats -->` trong README — sinh ra vì hồi đó số gõ tay: README ghi bookmarklet "~114KB"
trong khi thực tế đã 177KB, sai suốt một thời gian dài mà không ai biết. Nay **README không mang con
số nào** (con số và tên tính năng để trong README thì cũ dần theo từng lần sửa), nên bước đó bỏ luôn.
Cần số liệu thì đọc đầu ra của chính `./build.sh`. Thêm số vào README là quay lại đúng cái bẫy cũ.

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

- Mỗi dòng log là `div[class*="logRow"]`, con thứ nhất là số dòng, con thứ hai là `span` chứa cả dòng
  text. Đo lại ngày **2026-09-11** trên một log production, ngay trên một dòng dài: hàng có đúng **2 ô**,
  ô thứ hai dài **633** ký tự trong khi cả hàng là **637** — chênh đúng 4 ký tự của ô số dòng. Tức
  `el.children[1]` vẫn là trọn dòng kể cả với dòng dài, không bị chia nhỏ.

  Từng viết một hàm `rowText()` nối hết các ô sau ô đầu để phòng trường hợp trang chia dòng thành
  nhiều ô, khi đi tìm nguyên nhân một dòng tìm-không-ra. Đã **bỏ** (revert) sau khi phép đo trên chứng
  minh giả thuyết đó sai: giữ lại thì chỉ là code phòng một chuyện chưa xảy ra, mà bản thân nó cũng có
  đường hỏng im lặng riêng — trang thêm một ô phụ (nút copy chẳng hạn) là chữ của ô đó bị dán thẳng
  vào `entry.raw`.
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
- **Đọc xuyên qua panel: KHÔNG đặt `opacity` lên chính `.fll-panel`.** Panel rộng 480px đè lên đuôi của
  những dòng log dài, nên trong lúc chuột ở trên bảng log thì nó mờ đi (`.fll-xray`). Nhưng `opacity`
  gộp cả cây con thành MỘT lớp — con không bao giờ sáng hơn cha, mà minimap lại đúng là thứ cần nhìn rõ
  lúc đó. Cách làm: nền panel chuyển sang màu **có alpha** (`background:rgba(...)`, bỏ luôn bóng mờ 70px
  vì vùng tối quanh panel cũng che chữ), rồi mờ **từng đứa con** và chừa `.fll-map` cùng `.fll-maplbl`
  ra. Có phép thử đọc thẳng `PANEL_CSS` để bắt ai đó gom lại thành `opacity` trên panel.
- **Mốc bật xuyên thấu là "chuột đang trên bảng log", không phải "chuột rời khỏi panel".** Chuột nằm
  ngoài panel gần như suốt thời gian, lấy mốc đó thì mờ là trạng thái mặc định và panel nhấp nháy mỗi
  lần chuột đi ngang.
- **Rê chuột trên bảng log chỉ vị trí dòng đó lên minimap.** Dùng lại `updateMinimapCursor()` sẵn có,
  không vẽ mũi tên SVG: `.fll-panel` có `overflow:hidden` nên đường kẻ từ trang vào panel bị cắt ngay
  mép, muốn vẽ thật thì phải bê cả lớp `.fll-aim` ra ngoài `#fll-root`. Mà mũi tên trong panel có giá
  trị vì một hàng đại diện cho NHIỀU dòng (nhóm lỗi 22 dòng → 22 vạch); một dòng log trên trang chỉ ứng
  với đúng một điểm, nên cái vạch đã nói đủ.
  Dòng không có giờ riêng thì lấy `windowTs` (giờ thừa hưởng của dòng trên nó) — không thì rê vào giữa
  một stack trace là vạch tắt ngóm. Tra `phần tử → entry` bằng `WeakMap` dựng lại mỗi lần quét.

  Đo trên trang demo (1431 dòng, Chrome, có ép tính lại style+layout ngay trong phép đo): bật lớp xuyên
  thấu **1.69ms** (max 2.90), tắt **1.67ms**; quét chuột qua 300 dòng hết **28.6ms** — tức **0.095ms
  mỗi dòng**, và **0.097ms** khi KHÔNG bật xuyên thấu, tức phần xuyên thấu không thêm chi phí cho mỗi
  dòng. **CHƯA XÁC MINH** trên trang admin thật (10k dòng): chi phí duy nhất chưa đo được là raster lại
  dải log nằm dưới panel khi panel hết đục.

  *Bẫy khi đo:* tab chạy nền thì **transition không chạy**, `getComputedStyle` trả về giá trị ĐẦU của
  thuộc tính đang chuyển — đo ra "CSS không ăn" trong khi rule vẫn đúng. Tắt `transition` rồi mới đọc.
- **"Có khoảng đang chọn trên minimap" phải hỏi `getVisibleTimeRange()`, đừng hỏi `timeFrom/timeTo`.**
  Lọc theo **phiên app** cũng thu khoảng đang xem về đúng phiên đó (hàm trên cắt theo `startTs/endTs`
  của phiên) mà không đụng tới hai trường kia. Hậu quả của việc hỏi nhầm: minimap vẫn tô mờ hai bên
  đúng phiên nhưng **không hiện nút "phóng to"**, nên cách duy nhất để phóng vào một phiên là tự kéo
  tay lại đúng khoảng mà chính tool vừa tô sẵn. Phần tô và cái nút phải trả lời cùng một câu hỏi:
  `hasSelectedTimeRange()`.
- **Hàng ứng với NHIỀU dòng log thì dùng `data-lines`, đừng dùng `data-jump`.** `data-jump` nhảy tới
  một dòng và thanh dưới không có gì để duyệt. Hàng "Khoảng lặng" là ca kinh điển: nó có hai dòng
  (dòng dừng lại và dòng mở lại), chữ trên hàng là của dòng ĐẦU mà cú bấm lại nhảy tới dòng CUỐI, và
  đầu kia không có đường nào mở ra. Nay nó đưa cả hai vào thanh duyệt (`data-lines` + `data-label`):
  bấm là tới dòng dừng lại, bấm `n` là sang dòng mở lại.
- **Hàng trong "Máy & môi trường" trỏ tới dòng bằng CHỈ SỐ, đừng nhét cả danh sách dòng vào thuộc
  tính.** `data-env="<thứ tự trường>:<thứ tự giá trị>"` (và `data-envapp` cho miniapp) tra ngược vào
  `view.environment.watched`, vì một giá trị có thể ứng với hàng nghìn dòng — viết hết ra HTML là mỗi
  hàng nặng cả chục KB. Chỉ số dòng được gom sẵn lúc quét (`envBump` nhớ luôn `entry.domIndex`) chứ
  không quét lại lúc rê chuột: rê chuột bắn liên tục, mà quét lại là đi qua cả vạn dòng mỗi lần. Đo
  trên log demo: rê vào "Asia/Bangkok" ra **35 vạch** nằm đúng nửa sau timeline, bấm vào ra
  `1/35 · Múi giờ: Asia/Bangkok` trong thanh duyệt.
- **Thử mũi tên bằng sự kiện giả thì phải cuộn hàng vào TRONG panel và đổi phần tử đang trỏ trước.**
  `drawAim()` cố ý không vẽ khi hàng nằm ngoài panel hoặc bị minimap che, còn `handleLensHover()` bỏ
  qua khi rê lại đúng phần tử cũ (`hit === lensState.aimEl`). Bắn `mouseover` hai lần vào cùng một
  hàng, hoặc vào hàng đang nằm dưới đáy panel, sẽ ra "aim không bật" — đã mất công đi tìm bug không
  tồn tại đúng một lần vì chuyện này.
- **`data-aim` = "trỏ tới dòng này, nhưng bấm vào thì làm việc khác".** Nó từng tồn tại chỉ để phục vụ
  hàng khoảng lặng (hồi đó bấm vào chỉ tới được một đầu), rồi bị bỏ khi hàng đó chuyển sang
  `data-lines`. Nay nó quay lại với nghĩa khác hẳn: **chip phiên app** bấm vào là LỌC, nhưng rê chuột
  vẫn phải chỉ ra được chỗ phiên đó bắt đầu trên minimap. Vì vậy `data-aim` nằm trong `AIM_SELECTOR`
  nhưng **không** nằm trong danh sách của `handleLensClick` — thêm vào đó là cú bấm biến thành lệnh
  nhảy dòng và mất luôn bộ lọc.
- **Vùng phóng to phải tự lùi khi khoảng đang chọn rơi ra ngoài nó.** Phóng vào phiên 1 rồi bấm sang
  phiên 2: minimap vẫn vẽ khung cũ nên phần tô nằm ngoài khung và biến mất sạch — người dùng thấy
  "chọn phiên 2 mà chẳng có gì được chọn", không có dấu hiệu nào nói rằng phải lùi phóng to ra mới
  thấy. `releaseZoomOutsideRange()` lùi từng nấc theo đúng ngăn xếp phóng to (nấc ngoài mà đã thấy
  được khoảng mới thì dừng ngay ở đó). Điều kiện là **không giao nhau**, cố ý KHÔNG phải "không chứa
  trọn": chứa trọn thì bỏ hết bộ lọc (khoảng = cả log) cũng làm bung sạch phóng to, tức là bộ lọc lại
  điều khiển cái nhìn — đúng thứ mà hai trạng thái này cố ý tách ra. Hàm này đặt TRƯỚC mọi guard DOM
  trong `updateMinimapRange()`: nó sửa trạng thái chứ không phải phần vẽ.
- **Nút "phóng to" không được đổi chiều cao dòng nhãn minimap.** Nó hiện/ẩn theo việc có khoảng đang
  chọn hay không; đo trong Chrome: dòng nhãn cao **15.22px** khi không có nút, **18.50px** khi có, tức
  mỗi lần bấm là cả phần dưới panel bị đẩy rồi tụt 3.28px. Nay nút cao cố định 18.5px (không suy ra từ
  `line-height` thừa hưởng) và `.fll-maplbl` có `min-height` đúng bằng đó — đo lại sau khi sửa: 18.31
  so với 18.32px. Đổi cỡ chữ cả bộ thì đo lại hai số này.
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
- **Thanh tab phải vừa bề ngang mặc định — đo lại mỗi lần đổi cỡ chữ.** Hồi còn bảy tab, đo trên panel
  480px: `gap:3px` + padding ngang 7px cần **507px** trong khi chỗ chỉ có **478px** — tab cuối bị cắt
  mất chữ mà không có dấu hiệu gì là còn cuộn được; `gap:2px` + padding 5px lại còn **473px**. Nay còn
  năm tab và cỡ chữ đã tăng 1.12×: đo lại trong Chrome ra đúng **478/478**, vẫn vừa khít. Vẫn giữ
  `overflow-x:auto` cho trường hợp người dùng kéo panel hẹp hơn.
- **Cỡ chữ trong `PANEL_CSS` là px cứng ở ~70 chỗ, muốn đổi thì nhân đều cả bộ.** Lần gần nhất nhân
  1.12× và làm tròn về 0.5px (13px → 14.5px, 10.5px → 12px, 21px → 23.5px) để giữ nguyên tỉ lệ thiết
  kế. `line-height` đều không đơn vị nên tự theo; chỉ hai chỗ có hộp cố định phải sửa tay là
  `.fll-ev-ic` (vòng tròn quanh biểu tượng) và thanh tab.
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

**Trong lúc kéo, KHÔNG đụng vào thuộc tính kế thừa trên `<body>`.** `user-select` là thuộc tính kế
thừa, nên `document.body.style.userSelect = 'none'` bắt trình duyệt tính lại style cho **toàn bộ tài
liệu**. Đo trên trang admin thật (9363 dòng log, 40 537 node): bật mất **213.7ms**, trả lại mất
**176.5ms**. Chặn bôi đen bằng cách nuốt sự kiện `selectstart` trong lúc kéo thì tốn 0.

Cách cái lỗi này lộ ra đáng nhớ hơn con số: giữa cú kéo hoàn toàn mượt (p50 **16.7ms**), lúc không kéo
thì **181 khung liên tiếp không rớt cái nào** — chỉ có đúng **một** khung khựng ngay sau `mousedown` và
đúng một khung nữa ngay sau `mouseup`, mỗi cái ~216ms. Nhìn vào chỉ thấy "kéo panel bị giật". Phép thử
tách bạch: `panel.classList.add('fll-dragging')` chỉ tốn **1.3ms**, và số node TRONG panel không ảnh
hưởng gì (4406 node so với 400 node cho ra cùng một con số) — nên đừng đi tối ưu nhầm chỗ đó. Phép thử
quyết định là đặt sẵn `userSelect='none'` TRƯỚC khi kéo: cú khựng lúc `mousedown` biến mất, chỉ còn cú
lúc `mouseup` (chỗ trả lại `''`).

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

**Và từ khi WebAdmin nhúng thẳng `extension/lens.js` vào trang, ca hai-world đó quay lại đúng như cũ**:
bản của trang chạy ở **page world**, bản extension (người đang sửa tool vẫn load unpacked) chạy ở
**isolated world**. Đây lại là lý do sống của `data-fll-owner`, không còn là di sản của bookmarklet.

**Quyền sở hữu có XẾP HẠNG, vì "ai chạy sau thì thắng" là sai cho ca này.** Trang chở một bản CỐ ĐỊNH,
còn người đang sửa tool cần bản mới của mình ăn trước — mà thứ tự nạp thì không kiểm soát được (bundle
của SPA hoàn toàn có thể chạy sau `document_idle`). Nhãn nay là `"<hạng>:<id>"`: bản extension hạng 2,
bản nhúng trong trang hạng 1, **hạng cao luôn thắng bất kể thứ tự**. Hạng bằng nhau thì vẫn theo luật
cũ (ai claim sau thì thắng) — đó là ca reload extension, thế hệ mới phải thay được thế hệ cũ. Nhãn kiểu
cũ (chưa có hạng) đọc ra hạng 0 nên bản mới luôn giành được, không kẹt lúc nâng cấp.

Ba chỗ phải giữ đúng, sai một cái là hỏng:
- **Bản thua đứng ngoài HẲN**: `startLens()` thất bại lúc claim thì không dựng panel, không quét 4000
  dòng, và tự dừng watcher của mình. Không thì nó cứ thử gắn lại mỗi nhịp trong khi đã có chủ khác.
- **Kiểm quyền ở ĐẦU `tickPageWatcher()`**, trước nhánh "chưa gắn được". Để sau thì bản bị vượt hạng mà
  chưa gắn vào trang nào sẽ không bao giờ đi tới chỗ kiểm.
- **Đọc `chrome` qua `globalThis`**, đừng viết thẳng tên biến: trình duyệt không có nó sẽ ném
  `ReferenceError` ngay lúc nạp file, mà đây là dòng chạy đầu tiên.

Đã đo (Chrome, page world thật, bằng cách chèn thẻ `<script>` vào trang): `typeof chrome` là `object`
nhưng **`chrome.runtime` là `undefined`** → hạng tính ra đúng 1. Và mô phỏng bản hạng 2 xuất hiện giữa
chừng: bản của trang **gỡ panel của mình trong vòng một nhịp watcher và không giành lại** ở các nhịp
sau. **CHƯA XÁC MINH:** chưa chạy thật một bản extension (isolated world) song song với bản nhúng trong
trang — nửa còn lại của phép thử là `chrome.runtime.id` CÓ giá trị trong content script, cái đó mới chỉ
dựa trên tài liệu của Chrome chứ chưa đo tại chỗ.

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
