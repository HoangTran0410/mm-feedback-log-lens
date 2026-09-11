Chào cả nhà 👋

Trang feedback detail vừa có thêm một panel đọc log, mình đặt tên là *Log Lens*. Không phải cài gì cả:
mở feedback như mọi ngày, đợi bảng log hiện xong là có một cái pill ở góc dưới phải, bấm vào là panel
bung ra. (Cảm ơn team WebAdmin đã giúp đưa lên trang.)

Nó chỉ đọc đúng bảng log đang hiện trên trang — không gọi API, không gửi gì đi đâu, không đổi gì trên
server.

*Nó đọc hộ bạn những gì:*
• Gom hàng nghìn dòng lỗi thành vài chục nhóm theo chữ ký, và tách riêng đám nhiễu của lớp đo lường
• Ghép sẵn request ↔ response: call nào fail, call nào không có response, call nào chậm nhất
• Dựng lại dòng thời gian: user chạm gì → màn nào hiện ra → app đứng im đoạn nào → lỗi nổ ở đâu
• Lọc ngay trên bảng log theo mức độ / module / phiên app / khoảng thời gian / regex
• Máy gì, bản app nào, miniapp version bao nhiêu, nhánh A/B nào đang bật — moi từ header request
• Một nút copy tóm tắt dán thẳng vào Jira, một nút copy link để gửi đúng lát cắt bạn đang xem

*Vài con số làm mình bất ngờ khi đem đếm thử log thật:*
• *51%* dòng ERROR (1267/2488, đếm trên 50 feedback production) là lỗi của chính lớp đo lường, không
  phải lỗi user gặp — tức đọc tay thì mất nửa thời gian vào thứ không liên quan
• Một log 4222 dòng hoá ra là *2111 dòng đầu lặp lại y hệt* → mọi con số nhân đôi, mà mở danh sách lỗi
  ra nhìn thì hoàn toàn bình thường (số nhóm không đổi, chỉ số lần gấp đôi)
• Một log có khoảng lặng *3m52s* nhìn như app treo — thật ra user bấm Home. Bỏ mấy đoạn app ở nền ra
  thì khoảng im lặng thật dài nhất chỉ còn *8.5 giây*
• 94 dòng request + 94 dòng response mà ghép kiểu thường ra *104 call, 10 cái báo thiếu response* — vì
  logger ghi theo lô nên dòng response có thể nằm *trước* dòng request của chính nó

Mấy con số trên là đo trên log cụ thể, không phải hằng số — log của team khác có thể ra khác.

Ai mở thử thấy sai chỗ nào, hoặc thiếu thứ gì team mình hay cần, cứ ping mình nhé 🙏
