# Feedback Log Lens — đọc log feedback bằng mắt người, không phải bằng Ctrl+F

Một extension Chrome gắn thêm panel đọc log ngay trên trang xem feedback nội bộ. Nó **chỉ đọc bảng log
đang hiển thị sẵn trên trang** — không gọi API, không gửi dữ liệu đi đâu, không đổi gì trên server.
Cài bằng Load unpacked, mở một feedback là thấy.

Bài này không giới thiệu tính năng theo kiểu danh sách. Nó kể **đọc log kiểu cũ đau ở đâu**, và
**những gì đã lộ ra khi đem thống kê áp lên log thật** — trong đó có vài thứ đáng để chính team sinh
ra log sửa lại.

> Mọi con số trong bài đều kèm chỗ đo được. Chúng là số đo trên những log cụ thể tại thời điểm đó,
> không phải hằng số của hệ thống.

---

## 1. Đọc log kiểu cũ đau ở đâu

**Một feedback là vài nghìn dòng, mà trang chỉ có ô tìm theo chữ.** Muốn biết "có mấy loại lỗi" thì
phải cuộn và tự nhớ. Muốn biết "call nào hỏng" thì phải tự ghép dòng request với dòng response nằm
cách nhau hàng chục dòng.

**Quá nửa số dòng ERROR không phải lỗi mà user gặp.** Đo trên 50 feedback production:
**1267/2488 dòng ERROR (51%)** là lỗi của chính lớp đo lường (tracker, trace, telemetry) chứ không
phải thứ làm user khó chịu. Đọc tay thì mất một nửa thời gian vào đó mà không biết.

**Con mắt không đếm được.** "Lỗi này xảy ra mấy lần", "call này chậm bao nhiêu so với các call khác",
"log này phủ bao nhiêu phút" — toàn câu phải đếm, mà đếm tay trên 4000 dòng thì không ai làm.

**Và vài thứ đọc tay sẽ đọc SAI, không phải đọc chậm.** Phần 3 nói kỹ chuyện này — nó là lý do chính
đáng nhất để dùng tool.

---

## 2. Những gì tool làm được mà cuộn tay không làm được

![Tab Tổng quan](tong-quan.png)

**Gom hàng nghìn dòng lỗi thành vài chục nhóm theo chữ ký.** Cùng một lỗi in ra 40 lần với 40 mã giao
dịch khác nhau vẫn là *một* vấn đề. Nhóm nhiễu của lớp đo lường được tách riêng chứ không tự tắt —
tắt tiếng là quyết định của người đọc, và đôi khi chính lớp đo lường hỏng lại là manh mối. Chữ ký nào
đã tắt tiếng thì nhớ luôn cho các feedback mở sau này.

**Dựng lại dòng thời gian của user.** Ghép chung: user chạm gì, màn nào hiện ra, popup nào bật, app
đứng im lúc nào, lỗi nổ ở đâu — sắp theo **thời gian thật**, không theo thứ tự dòng trong file.

**Lọc tại chỗ trên chính bảng log của trang.** Theo mức độ, module, phiên app, cửa sổ thời gian, hoặc
regex. Bảng log thu lại đúng phần cần đọc; mọi con số trên panel chạy theo tập dòng đang hiện.

![Rê chuột lên một hàng](mui-ten-minimap.png)

**Minimap trả lời câu "chỗ này nằm đâu trong cả log".** Rê chuột lên một hàng bất kỳ là có mũi tên chỉ
thẳng lên vị trí của nó, kèm vạch đánh dấu **mọi** dòng mà hàng đó đại diện — thấy ngay chúng rải đều
hay dồn vào một chỗ. Rê chuột trên chính bảng log của trang thì panel mờ đi để đọc xuyên qua, còn
minimap vẫn sáng và chỉ đúng dòng đang rê.

**Copy tóm tắt cho ticket.** Một nút, ra khối markdown dán thẳng vào Jira: máy và bản app, các nhóm lỗi
kèm giờ, call HTTP bất thường, các bước cuối trước lúc user bấm gửi, nhánh A/B đang bật — và một mục
**"log này không trả lời được"**. Khối đó cố ý **chỉ liệt kê sự kiện có giờ, không xếp hạng nguyên
nhân**: suy đoán nằm lại trong ticket sẽ được người sau đọc như sự thật.

**Copy link.** Permalink mang theo bộ lọc, tab đang mở và dòng đang đứng — gửi cho đồng nghiệp là họ mở
ra thấy đúng lát cắt đó, không phải cả log.

---

## 3. Những thứ chỉ lộ ra khi đem thống kê áp lên log

Phần này đáng đọc nhất, kể cả với người không định dùng tool: đây là những chỗ **đọc tay sẽ ra kết luận
sai**, và vài chỗ là vấn đề ở phía sinh ra log.

### Số call BE đang bị phồng lên, vì logger ghi theo lô

Dòng `ResponsePayload` có thể nằm **trước** dòng `RequestPayload` của chính nó — hai dòng ra trong cùng
một lần flush. Đo trên ba log thật: **0 / 3 / 16** cặp nằm ngược, và mọi cặp ngược đều lệch đúng một
dòng. Ghép theo kiểu "response thuộc về request đứng trước nó" thì hỏng cả hai đầu: request thật bị báo
"không có response", rồi chính response đó lại sinh thêm một hàng call ma.

Đo trên một log production: **94 dòng request + 94 dòng response ra 104 call, 10 cái báo thiếu
response**. Ghép đúng thì còn **94 call, 0 cái thiếu**.

> Nếu bạn từng nhìn số call trong log rồi thấy "sao lắm call lỗi thế", nhiều khả năng một phần là
> chuyện này.

### Một sự kiện đo lường đang được ghi hai lần cho cùng một request

Trên một log thật: **140 `trace_id` xuất hiện hơn một lần**, nhưng **chỉ 6 cặp** có cùng
`miniapp_track_timestamp` — mốc `now` tính riêng trong mỗi lần chạy khối tracking. 134 cặp còn lại lệch
nhau vài ms.

Tức không phải một lần chạy bị ghi log đôi, mà là **khối tracking response chạy hai lần cho cùng một
request**. Đây là thứ đáng để team sở hữu phần tracking xem lại: interceptor đăng ký trùng, hay client
cài plugin hai lần. *Chưa xác minh được nguyên nhân từ phía log.*

### "App đứng im 4 phút" thường là user bấm Home

Log không có dòng lifecycle riêng — `didEnterBackground`, `willEnterForeground`, `onPause` đều **0 lần**
trên cả ba log thật. Trạng thái app chỉ nằm ghép trong dòng MQTT (`appState: BACKGROUND`).

Đo trên một log thật: **22 khoảng lặng**, hai cái dài nhất (**2m23s** và **3m52s**) đều là app ở nền.
Bỏ hai cái đó ra thì khoảng im lặng thật dài nhất chỉ còn **8.5 giây**. Đọc tay mà không biết chuyện
này là viết vào ticket "app treo 4 phút" — một câu sai hoàn toàn.

### Có log bị nối đôi, và nhìn danh sách lỗi không thấy gì bất thường

Một log feedback production dài 4222 dòng hoá ra là **2111 dòng đầu lặp lại nguyên xi** (md5 hai nửa
bằng nhau, chỗ nối ngay sau một dòng `LOGGER: END OF BATCH`). Đo bằng chính tool sau khi bỏ khối lặp:
call HTTP **104 → 53**, sự kiện `ops_receive_be` **232 → 116**, mỗi nhóm lỗi **2 → 1** và **10 → 5**.

Điểm nguy hiểm: **số nhóm lỗi không đổi**, chỉ số *lần* trong mỗi nhóm gấp đôi. Nhìn danh sách nhóm thì
mọi thứ trông hoàn toàn bình thường.

### Một lần mở app sinh ra một *chùm* mốc, không phải một mốc

Ba chuỗi khác nhau cùng báo "app khởi động" và cả ba đều nổ trong cùng một lần mở app, cách nhau vài
trăm ms. Đếm từng mốc thì một lần mở app thành ba phiên. Đo trên ba log thật: khoảng cách trong cùng
một chùm là **369–2078ms**, còn giữa hai lần khởi động thật là **75 440ms** và **163 029ms** — cách
nhau 36 lần.

Và phần đầu log thường **không thuộc phiên nào thấy được**: đó là đuôi của một lần chạy trước mà file
không còn giữ điểm bắt đầu. Tool gọi thẳng nó là *"Đuôi phiên trước"* thay vì gộp vào phiên 1.

### Nguồn thông tin thiết bị đã chết trên production mà không ai biết

Muốn biết "máy gì, bản nào" thì chỗ tự nhiên nhất là module `DeviceProfileManager`. Đếm trên ba log
thật: module đó có **27 / 9 / 0** dòng — **bằng 0 trên log production**. Trong khi header của request
HTTP có **52 / 66 / 94** lần và mỗi log chỉ đúng một giá trị.

Một dòng header còn chở sẵn hơn chục trường đáng đọc mà chưa ai đọc: tên máy, hệ điều hành, đời máy,
`app_code` + `app_version`, ngôn ngữ, múi giờ, môi trường, kênh, `deviceid`, IP, `agent_id`, và
**version của từng miniapp**. Panel hiện **tất cả các giá trị khác nhau** chứ không chọn hộ một cái:
hai IP trong cùng một log nghĩa là đổi mạng giữa chừng; hai `deviceid` nghĩa là log đã bị trộn từ hai
máy.

### `momo_proxy_to_http_duration: null` không phải đo hỏng

Trên một log thử, **115/168 dòng** là `null`. Đọc mã nguồn thì `null` nghĩa là call **không đi qua
maxAPI proxy** — tức phần lớn call gọi thẳng. Không phải hỏng phép đo. (Dòng này dùng `logger.d` nên
chỉ có ở log máy nội bộ, bản production nuốt mất.)

### Hai màn hình khác hẳn nhau đang dùng chung một tên

Trên log thật, hai màn cùng ghi `screen_name=result` nhưng là hai lớp khác nhau
(`TransactionResultRevampScreenDisplayed` và `TransactionResultWidgetDisplayed`) — gộp làm một hàng là
mất sạch cái để phân biệt. Nhưng ở một log khác, **64/64** dòng mang trường phân biệt đó lại là
`PromotionEventParams` — một lớp chứa *tham số*, không phải tên màn. Lấy bừa thì mọi màn đều bị đặt tên
đó.

### Mã lỗi đang nằm rải ở bốn kiểu viết khác nhau

`errorCode=`, `error_code=`, `"errorCode":`, và `"errorCode": ` bên trong thân JSON — bốn nguồn, không
chỗ nào cộng lại. Panel gom hết về một mục: mã nào nổ nhiều nhất, mã nào chỉ nổ một lần, bấm vào duyệt
được đúng những dòng có nó. (Mã `0` bị loại — đó là mã của call thành công.)

---

## 4. Những thứ team sinh log có thể sửa

Đây là phần "báo lại cho nhau", không phải phàn nàn:

| Quan sát được | Đáng xem lại ở phía nào |
|---|---|
| Khối tracking response chạy hai lần cho cùng một `trace_id` | Team sở hữu tracking / interceptor |
| Log feedback bị nối đôi nguyên file | Chỗ ghép log trước khi gửi lên |
| `DeviceProfileManager` bằng 0 dòng trên production | Team sở hữu module đó — thông tin máy đang chỉ còn sống trong header |
| Hai màn khác nhau dùng chung `screen_name` | Team đặt tên sự kiện |
| Header request in nguyên `authorization`, `cvs-token`, `sessionKey`, `M-Signature` vào log | Team sinh log — nên che trước khi ghi |
| JSON in nhiều dòng, mỗi dòng là một bản ghi log riêng | Team sinh log — in một dòng thì máy đọc được, người vẫn xem được bằng tool |

Riêng dòng cuối: tool **đã** nối lại được những khối JSON bị tách để mở ra xem, nhưng mọi thứ khác
(tìm kiếm, thống kê) vẫn làm việc trên từng dòng — in một dòng vẫn tốt hơn.

Muốn tự soi xem log của mình đang lộ những gì: gõ vào ô **Tìm trong nội dung** một regex có nhóm bắt,
ví dụ `"(authorization|cvs-token|sessionKey)":"([^"]+)"`, panel sẽ liệt kê **giá trị → số lần**.

---

## 5. Tool cố ý KHÔNG làm gì

Ba nguyên tắc, vì một công cụ đọc log mà đoán bừa thì tệ hơn là không có:

- **Không xếp hạng nguyên nhân.** Không có câu "nguyên nhân là X" ở bất cứ đâu, đặc biệt là trong khối
  ticket. Nó liệt kê sự kiện có giờ; kết luận là việc của người đọc.
- **Không suy đoán nhãn.** Dòng cấu hình không tự khai nguồn thì vào nhóm *"Chưa rõ nguồn"*, không gán
  bừa cho BE.
- **Nói ra cái nó không biết.** Ticket luôn có mục *"log này không trả lời được"*: máy gửi không bật
  Debug Tool nên không có dòng Grafana trace, log chỉ phủ mấy phút nên thao tác trước đó không nằm
  trong file, có bao nhiêu dòng timestamp lùi về trước, đoạn đầu log không thấy điểm bắt đầu phiên…
  Người đọc sau sẽ biết vì sao phần đó trống, thay vì tưởng "đã kiểm, không có vấn đề".

---

## 6. Dùng trong một phút

1. `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục `extension/`.
2. Mở một feedback. Bảng log render xong là có pill ở góc dưới phải — bấm để mở panel.
3. Phím tắt: `Alt+L` mở lại panel đã đóng, `n` / `p` đi tới lui giữa các dòng đang duyệt, `Esc` thu về
   pill.

Mở ra thì bắt đầu ở khối trên cùng: nó lấy nét sẵn vào mấy giây cuối trước lúc user bấm gửi feedback —
chỗ vấn đề gần như luôn nằm.

---

## 7. Giới hạn, nói trước

- Tool đọc **những gì log có**. Log không ghi thì tool không biết, và nó sẽ nói ra điều đó thay vì đoán.
- Các con số trong bài là số đo trên những log cụ thể, **không phải hằng số của hệ thống**. Log khác có
  thể ra khác.
- Tìm một chuỗi **vắt qua hai dòng** thì không ra: bộ lọc làm việc trên từng dòng, giống hệt cách mọi
  con số được tính.
- Đây là công cụ cá nhân, không phải sản phẩm chính thức của tổ chức nào.
