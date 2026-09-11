# Feedback Log Lens

Một panel đọc log ngay trên trang xem feedback nội bộ (`adminapp.momocdn.net`). Trang gốc chỉ có ô tìm
theo chữ, nên mỗi lần điều tra một feedback là cuộn tay qua vài nghìn dòng. Tool này gắn thêm một panel
đọc chính bảng log đang hiển thị: gom các dòng lỗi giống nhau thành nhóm, dựng lại dòng thời gian của
phiên, và lọc tại chỗ mà không rời trang.

> Công cụ cá nhân, không phải sản phẩm chính thức của tổ chức nào. Nó chỉ đọc DOM sẵn có trên trang —
> không gọi API, không gửi dữ liệu đi đâu. Repo này **không** chứa log thật hay dữ liệu người dùng:
> mọi ví dụ trong code, test và ảnh chụp đều là dữ liệu bịa.

Muốn giới thiệu cho team khác: [docs/gioi-thieu.md](docs/gioi-thieu.md) — kể những chỗ đọc log kiểu cũ
ra kết luận sai, kèm số đo trên log thật.

## Cài

**Không cần cài gì**: trang WebAdmin đã nhúng sẵn `extension/lens.js`. Mở một feedback, đợi bảng log
render xong là có pill ở góc dưới phải — bấm để mở panel.

Chỉ khi muốn chạy bản mới hơn bản trang đang chở (đang sửa tool chẳng hạn) thì mới cần bản extension:

1. `chrome://extensions` (Brave: `brave://extensions`) → bật **Developer mode**
2. **Load unpacked** → chọn thư mục `extension/`

Lúc đó hai bản cùng sống: bản của trang chạy ở page world, bản extension ở isolated world. Chúng không
thấy `window` của nhau nên việc nhường quyền đi qua `data-fll-owner` trên thẻ `html` — bản mới ghi tên
mình vào đó, bản cũ đọc thấy tên khác thì tự rút lui. Xem [CLAUDE.md](CLAUDE.md).

Phím tắt: `Alt+L` mở lại panel đã đóng, `n` / `p` đi tới lui giữa các dòng đang duyệt, `Esc` thu panel về pill.

## Nhìn thử

Ảnh chụp trên log **bịa** do `test/demo-log.js` sinh ra.

Mọi mục đều thu sẵn, badge nói trong đó có gì. Khối trên cùng lấy nét vào mấy giây cuối trước lúc user
bấm gửi feedback — chỗ vấn đề gần như luôn nằm.

<img src="docs/tong-quan.png" width="480" alt="Panel với các thẻ thống kê và những mục đang thu gọn">

Rê chuột lên một hàng bất kỳ thì có mũi tên chỉ lên đúng vị trí của nó trên minimap, kèm vạch đánh dấu
mọi dòng mà hàng đó đại diện — thấy ngay chúng rải đều hay dồn vào một chỗ.

<img src="docs/mui-ten-minimap.png" width="480" alt="Mũi tên nối từ một hàng trong panel lên vị trí tương ứng trên minimap">

Dòng thời gian ghép chung thao tác của user, màn hình hiện ra, khoảng app đứng im và lỗi nổ ra, sắp
theo thời gian thật chứ không theo thứ tự dòng trong file.

<img src="docs/dien-bien.png" width="480" alt="Danh sách các mốc sự kiện nằm trên một đường thời gian, kèm chip lọc theo loại mốc">

Lọc thì thu hết mục lại vẫn biết mình đang lọc gì, vì badge của mỗi mục chính là trạng thái bộ lọc.
Bộ lọc đang bật copy ra link được, gửi cho người khác mở lên là thấy đúng thứ mình đang thấy.

<img src="docs/loc.png" width="480" alt="Tab lọc với vài điều kiện đang bật, badge tô màu accent">

## Dùng

Panel chia thành vài tab, mỗi tab trả lời một câu hỏi khi điều tra: chuyện gì đã xảy ra và lúc nào,
thật sự có mấy loại lỗi khác nhau, máy đó lúc ấy chạy với cấu hình nào, và muốn nhìn hẹp lại thì lọc.

Hai thứ hay dùng nhất khi đã tìm ra vấn đề:

- **Copy tóm tắt cho ticket** — ra một khối markdown dán thẳng vào Jira: máy và bản app, các nhóm lỗi
  kèm giờ, call HTTP bất thường, các bước cuối trước lúc gửi feedback, và cả một mục nói rõ những gì
  log này **không** trả lời được. Khối đó cố ý chỉ liệt kê sự kiện có giờ, không xếp hạng nguyên nhân.
- **Copy link** — permalink mang theo bộ lọc, tab đang mở và dòng đang đứng, nên người nhận mở ra thấy
  đúng lát cắt đó chứ không phải cả log.

## Sửa repo này

```sh
./build.sh
```

Nối `src/*.js` thành `extension/lens.js`, kiểm cú pháp, kiểm kiểu và chạy bộ test (`node test/run.js`).
Không có dependency lúc chạy, không có bước biên dịch.

Kiến trúc, các ràng buộc bất biến, những phép đo đã làm và các kết luận từng sai rồi mới sửa lại đều
nằm trong [CLAUDE.md](CLAUDE.md) — đọc file đó trước khi sửa.
