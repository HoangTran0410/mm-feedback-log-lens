# Log Lens — từ giờ mở feedback là có sẵn, khỏi cài gì hết

Chào cả nhà 👋

Tin vui trước: **team WebAdmin đã nhúng thẳng Log Lens vào trang rồi.** Từ giờ mở một feedback detail
là tự nhiên có một cái pill ở góc dưới phải, bấm vào là panel bung ra. Không cài extension, không bật
developer mode, không làm gì cả. Cứ mở feedback như mọi ngày thôi.

Nó chỉ đọc đúng cái bảng log đang hiện trên trang — không gọi API, không gửi gì đi đâu, không đổi gì
trên server. Trang vẫn là trang cũ, chỉ là có thêm một người ngồi đọc log hộ bạn.

Phần dưới mình kể hai chuyện: **panel đó làm được gì**, và **mấy thứ giật mình lòi ra khi đem đếm thử
log thật** — phần sau đáng đọc kể cả khi bạn không định dùng tool, vì có mấy chỗ đọc log bằng mắt sẽ
ra kết luận sai chứ không phải sai sót nhỏ.

> Mọi con số dưới đây là số mình đo trên log cụ thể, có ghi rõ đo ở đâu. Không phải hằng số của hệ
> thống — log khác có thể ra khác.

---

## Ngày xưa chúng ta đọc log thế nào

Mở feedback lên, 4000 dòng. Ô tìm kiếm của trang tìm theo chữ. Thế là bắt đầu cuộn.

Muốn biết *"rốt cuộc có mấy loại lỗi"* → cuộn và tự nhớ. Muốn biết *"call nào hỏng"* → tìm dòng
request, rồi dò xuống mấy chục dòng để kiếm dòng response của đúng call đó. Muốn biết *"user bấm gì
trước khi lỗi"* → cuộn ngược lên và ghép trong đầu.

Và đây mới là chỗ đau: **quá nửa số dòng ERROR không phải lỗi của user.** Mình đếm trên 50 feedback
production: **1267/2488 dòng ERROR (51%)** là lỗi của chính lớp đo lường — tracker, trace, telemetry.
Tức là một nửa thời gian cuộn đó dành cho thứ chẳng liên quan gì tới cái user đang than.

---

## Mở lên thì thấy gì

![Tab Tổng quan](tong-quan.png)

**Hàng nghìn dòng lỗi gom lại còn vài chục nhóm.** Cùng một lỗi in ra 40 lần với 40 mã giao dịch khác
nhau — nó vẫn là *một* vấn đề thôi. Nhóm nào là nhiễu của lớp đo lường thì được để riêng ra một chỗ,
nhưng **không tự tắt** — biết đâu hôm nay chính lớp đo lường hỏng mới là manh mối. Chữ ký nào bạn tắt
tiếng thì nó nhớ luôn cho các feedback sau, khỏi tắt lại.

**Dòng thời gian của user, ghép sẵn.** User chạm gì → màn nào hiện ra → popup nào bật → app đứng im
đoạn nào → lỗi nổ ở đâu. Sắp theo **thời gian thật**, không theo thứ tự dòng trong file (hai cái đó
khác nhau, phần dưới mình kể).

**Lọc ngay trên bảng log của trang.** Theo mức độ, module, phiên app, khoảng thời gian, hay regex. Bảng
log co lại còn đúng phần cần đọc, và mọi con số trên panel chạy theo tập dòng đang hiện — không có
chuyện panel nói một đằng bảng log một nẻo.

![Rê chuột lên một hàng](mui-ten-minimap.png)

**Cái này mình thích nhất: rê chuột lên hàng nào là có mũi tên chỉ thẳng lên minimap**, kèm vạch đánh
dấu *mọi* dòng mà hàng đó đại diện. Một nhóm lỗi 22 dòng thì hiện 22 vạch — nhìn phát biết nó rải đều
cả phiên hay dồn cục vào một chỗ. Mà rê chuột trên chính bảng log của trang cũng được: panel tự mờ đi
cho bạn đọc xuyên qua, riêng minimap vẫn sáng và chỉ đúng dòng bạn đang rê.

**Nút "Copy tóm tắt cho ticket".** Một cú bấm, ra khối markdown dán thẳng vào Jira: máy gì, bản app
nào, các nhóm lỗi kèm giờ, call HTTP bất thường, mấy bước cuối trước lúc user bấm gửi, nhánh A/B đang
bật. Khỏi ngồi gõ lại.

**Và nút "Copy link".** Link mang theo cả bộ lọc, tab đang mở và dòng đang đứng. Gửi cho đồng nghiệp là
họ mở ra thấy **đúng cái bạn đang thấy**, không phải "ờ bạn cuộn xuống khoảng dòng 2600 gì đó".

---

## Mấy thứ lòi ra khi đem đếm thử

Đoạn này mình viết dài nhất, vì nó không phải chuyện tool. Nó là chuyện **log của chúng ta đang nói
những gì mà lâu nay không ai nghe.**

### Số call BE đang bị phồng, do logger ghi theo lô

Cái này làm mình ngồi nghi ngờ bản thân một buổi: dòng `ResponsePayload` **có thể nằm trước** dòng
`RequestPayload` của chính nó. Không phải lỗi gì cả — hai dòng ra trong cùng một lần flush nên thứ tự
đảo. Đo trên ba log thật: **0 / 3 / 16** cặp bị đảo, và cặp nào đảo cũng lệch đúng một dòng.

Ghép kiểu ngây thơ ("response là của request đứng ngay trên") thì hỏng cả hai đầu: request thật bị báo
*không có response*, rồi chính cái response đó lại đẻ thêm một call ma. Trên một log production:
**94 dòng request + 94 dòng response mà ra 104 call, 10 cái báo thiếu response.** Ghép đúng thì còn
**94 call, 0 cái thiếu**.

Nên lần sau ai nhìn log rồi bảo "sao lắm call lỗi thế" — khoan đã nhé 🙂

### Một sự kiện tracking đang chạy hai lần cho cùng một request

Cái này mình nghĩ team tracking sẽ quan tâm. Trên một log thật: **140 `trace_id` xuất hiện hơn một
lần** — thoạt nhìn tưởng log bị ghi đôi. Nhưng chỉ **6 cặp** trong đó có cùng `miniapp_track_timestamp`
(mốc `now` tính riêng mỗi lần chạy khối tracking). 134 cặp còn lại lệch nhau vài ms.

Lệch vài ms nghĩa là: **khối tracking chạy thật sự hai lần**, chứ không phải một lần chạy bị in log
đôi. `trace_id` giống nhau vì nó lấy từ attribute của request.

*Mình chưa xác minh được vì sao* — interceptor đăng ký trùng, hay client cài plugin hai lần, cái đó
phải người trong team đó nhìn mới biết. Nhưng con số thì rõ.

### "App treo 4 phút" — thật ra user bấm Home đi ăn cơm

Log không có dòng lifecycle riêng nào cả: `didEnterBackground`, `willEnterForeground`, `onPause` đều
**0 lần** trên cả ba log mình xem. Trạng thái app chỉ nằm ghép lén trong dòng MQTT
(`appState: BACKGROUND`).

Kết quả đo trên một log thật: **22 khoảng lặng**, hai cái dài nhất là **2m23s** và **3m52s** — cả hai
đều là app ở nền. Bỏ hai cái đó ra thì khoảng im lặng thật dài nhất chỉ còn **8.5 giây**.

Nếu không biết chuyện này, cái ticket viết ra sẽ là *"app treo 4 phút"*. Sai hoàn toàn, mà lại rất
thuyết phục.

### Có log bị nối đôi, mà nhìn vào không thể nhận ra

Đây là cái làm mình sợ nhất. Một log feedback production dài 4222 dòng — hoá ra là **2111 dòng đầu lặp
lại y hệt** (md5 hai nửa bằng nhau, chỗ nối nằm ngay sau một dòng `LOGGER: END OF BATCH`).

Bỏ khối lặp đi rồi đếm lại: call HTTP **104 → 53**, sự kiện `ops_receive_be` **232 → 116**, nhóm lỗi
**2 → 1** và **10 → 5**.

Chỗ hiểm là: **số nhóm lỗi không đổi**, chỉ số *lần* trong mỗi nhóm là gấp đôi. Nghĩa là bạn mở danh
sách lỗi ra nhìn sẽ thấy mọi thứ hoàn toàn bình thường, trong khi mọi con số đang nhân hai.

### Một lần mở app đẻ ra ba cái mốc "khởi động"

Ba chuỗi khác nhau cùng báo app khởi động, và cả ba đều nổ trong cùng một lần mở app, cách nhau vài
trăm ms. Đếm từng mốc thì một lần mở app thành ba phiên.

Đo trên ba log: khoảng cách trong cùng một chùm là **369–2078ms**, còn giữa hai lần mở app thật là
**75 440ms** và **163 029ms**. Cách nhau 36 lần — nên tách được sạch.

Còn phần đầu log thì thường **chẳng thuộc phiên nào cả**: nó là cái đuôi của lần chạy trước mà file
không giữ được điểm bắt đầu. Tool gọi thẳng nó là *"Đuôi phiên trước"*, thay vì nhét đại vào phiên 1
rồi làm bạn tưởng mấy dòng đó xảy ra sau lần khởi động.

### Chỗ lấy thông tin máy đã chết trên production từ lâu

Muốn biết "máy gì, bản nào" thì ai cũng nghĩ tới `DeviceProfileManager`. Đếm trên ba log thật: module
đó có **27 / 9 / 0** dòng. Vâng, **0 trên log production** 😅

Trong khi header của request HTTP thì có **52 / 66 / 94** lần, và mỗi log chỉ đúng một giá trị. Mà một
dòng header đó chở sẵn hơn chục thứ chưa ai đọc: tên máy, hệ điều hành, đời máy, `app_code` +
`app_version`, ngôn ngữ, múi giờ, môi trường, kênh, `deviceid`, IP, `agent_id`, và **version của từng
miniapp**.

Panel hiện **tất cả giá trị khác nhau** chứ không chọn hộ bạn một cái — vì hai IP trong cùng một log
nghĩa là user đổi mạng giữa chừng, còn hai `deviceid` nghĩa là log đã bị trộn từ hai máy. Hai chuyện
đó đáng thấy chứ không đáng giấu.

### `momo_proxy_to_http_duration: null` không phải đo hỏng đâu

Trên một log thử, **115/168 dòng** là `null`. Đọc mã nguồn thì `null` nghĩa là call **không đi qua
maxAPI proxy** — tức phần lớn call gọi thẳng. Phép đo vẫn ổn, chỉ là nó đang nói một chuyện khác với
cái ta tưởng.

### Hai màn hình khác hẳn nhau đang xài chung một cái tên

Trên log thật, hai màn cùng ghi `screen_name=result` nhưng là hai lớp khác nhau
(`TransactionResultRevampScreenDisplayed` và `TransactionResultWidgetDisplayed`). Gộp làm một hàng là
mất luôn cái để phân biệt.

Nhưng đời không đơn giản thế: ở một log khác, **64/64** dòng mang trường phân biệt đó lại là
`PromotionEventParams` — một lớp chứa *tham số*, không phải tên màn. Lấy bừa thì mọi màn đều bị đặt
tên đó. Nên tool chỉ nhận những lớp kết thúc bằng `Displayed` / `Interacted` / `Viewed`.

---

## Nếu bạn là team sinh ra log

Mấy cái dưới đây là quan sát được từ log, gửi lại để ai sở hữu phần nào thì ngó qua — không phải phàn
nàn đâu nhé 🙂

| Nhìn thấy gì trong log | Có thể team nào muốn xem lại |
|---|---|
| Khối tracking chạy hai lần cho cùng một `trace_id` | Team tracking / interceptor |
| Log feedback bị nối đôi nguyên file | Chỗ ghép log trước khi gửi lên |
| `DeviceProfileManager` bằng 0 dòng trên production | Team sở hữu module đó — thông tin máy giờ chỉ còn sống trong header |
| Hai màn khác nhau dùng chung `screen_name` | Team đặt tên sự kiện |
| Header in nguyên `authorization`, `cvs-token`, `sessionKey`, `M-Signature` vào log | Team sinh log — nên che trước khi ghi |
| JSON in nhiều dòng, mỗi dòng thành một bản ghi riêng | Team sinh log — in một dòng thì máy đọc được, người vẫn xem thoải mái bằng tool |

Riêng dòng cuối: tool **đã** nối lại được mấy khối JSON bị tách để mở ra xem tử tế, nhưng tìm kiếm và
thống kê thì vẫn chạy trên từng dòng — nên in một dòng vẫn hơn.

Muốn tự soi xem log của mình đang lộ những gì: gõ vào ô **Tìm trong nội dung** một regex có nhóm bắt,
ví dụ `"(authorization|cvs-token|sessionKey)":"([^"]+)"`, panel sẽ liệt kê luôn **giá trị → số lần**.
Tiện cho việc rà soát định kỳ.

---

## Mấy thứ tool cố tình KHÔNG làm

Cái này mình muốn nói rõ, vì một công cụ đọc log mà đoán bừa thì tệ hơn là không có:

- **Không xếp hạng nguyên nhân.** Bạn sẽ không thấy câu "nguyên nhân là X" ở đâu cả, nhất là trong khối
  ticket. Nó liệt kê sự kiện có giờ; kết luận để người đọc tự rút. Suy đoán mà nằm lại trong ticket thì
  ba tháng sau người khác đọc lại tưởng là sự thật.
- **Không đoán nhãn.** Dòng cấu hình không tự khai nguồn thì vào nhóm *"Chưa rõ nguồn"*, không gán bừa
  cho BE.
- **Nói thẳng ra cái nó không biết.** Ticket luôn có mục *"log này không trả lời được"*: máy gửi không
  bật Debug Tool nên không có Grafana trace, log chỉ phủ mấy phút nên thao tác trước đó không có trong
  file, bao nhiêu dòng có timestamp lùi về trước, đoạn đầu log không thấy điểm bắt đầu phiên… Để người
  đọc sau biết vì sao chỗ đó trống, thay vì tưởng "đã kiểm rồi, không có gì".

---

## Bắt đầu trong 30 giây

1. Mở một feedback detail như bình thường.
2. Đợi bảng log hiện xong → có pill ở góc dưới phải → bấm.
3. Xong. Bắt đầu đọc từ khối trên cùng: nó lấy nét sẵn vào mấy giây cuối trước lúc user bấm gửi
   feedback — chỗ có vấn đề gần như luôn nằm ở đó.

Phím tắt cho ai thích nhanh: `Alt+L` mở lại panel đã đóng, `n` / `p` nhảy tới lui giữa các dòng đang
duyệt, `Esc` thu panel về pill.

---

## Nói trước mấy chỗ nó chưa làm được

- Tool chỉ đọc **những gì log có**. Log không ghi thì nó chịu — và nó sẽ nói ra là chịu, chứ không đoán.
- Con số trong bài là đo trên log cụ thể, **không phải hằng số**. Log của bạn có thể ra khác.
- Tìm một chuỗi **vắt qua hai dòng** thì không ra, vì bộ lọc làm việc trên từng dòng (giống hệt cách
  mọi con số được tính).
- Đây là đồ chơi cá nhân mình làm, không phải sản phẩm chính thức của tổ chức nào.

Dùng thấy sai chỗ nào, hoặc muốn thêm gì, cứ ping mình nhé. Log của team nào cũng có cái hay riêng, mà
mình thì mới xem được vài chục cái thôi 😄
