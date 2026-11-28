# VPS Control cho Android

Ứng dụng đồng hành chỉ đọc trạng thái từ web panel và đưa tài nguyên VPS ra màn hình chính. Quản lý server và các thao tác thay đổi hệ thống thực hiện trên web theo quyền tài khoản.

**Stable: [1.3.0 / 10300](https://github.com/Milunice259/vps-assistant-for-no-code-user/releases/tag/android-v1.3.0).** Android10 trở lên, package `com.vpscontrol.widget`. [Feed stable](../../android/releases/stable.json) là nguồn metadata cập nhật; [STATUS.md](STATUS.md) ghi checksum và bằng chứng.

## Cài và ghép nối

1. Tải APK từ release chính thức. Nâng cấp stable bằng cách cài đè bản cùng chữ ký để giữ pairing, cấu hình và widget.
2. Trên panel có Mobile API, mở **Settings → Mobile Devices**, đặt tên thiết bị, chọn VPS và tạo mã dùng một lần. Mã hết hạn sau5 phút; giữ mã riêng tư.
3. Trên Android, mở Kết nối, nhập URL **HTTPS gốc** của panel và mã đầy đủ. Không thêm đường dẫn, username hoặc thông tin đăng nhập vào URL.
4. Kiểm dữ liệu và giờ quan sát trên Tổng quan. Điện thoại dùng quyền thiết bị theo VPS đã chọn, không cần giữ mật khẩu panel hoặc SSH.

## Chọn kiểu widget

| Mẫu | Cách dùng |
| --- | --- |
| Tổng quan 2×2 | Một nhóm VPS, trạng thái và số lượng theo từng nhóm |
| Một VPS 2×2 | Tài nguyên CPU/RAM/ổ đĩa của server được chọn |
| Thanh ngang 4×1 | Dải thông tin thấp, gọn trên màn hình chính |
| Chi tiết 4×4 | Nhiều chỗ cho tài nguyên hoặc danh sách VPS |

Thêm từ Cài đặt trong app hoặc nhấn giữ màn hình chính → Widget. Kéo đổi kích thước để bố cục thích ứng; số hàng và độ rộng thực tế phụ thuộc launcher. Khi chỉ chọn một VPS, widget hiển thị tài nguyên chi tiết.

Chạm **bánh răng** trên widget hoặc chọn widget trong Cài đặt app để chỉnh: VPS, nền sáng/tối/theo app, độ trong suốt0–100%, bốn màu nhấn, đồng hồ/thanh/số, mật độ danh sách. Preview chưa ghi thay đổi; **Lưu** mới áp dụng. **Hủy** giữ cấu hình trước đó, **Khôi phục mặc định** đặt lại giao diện trong bản nháp.

## Cập nhật và ý nghĩa số liệu

- Chọn **1/3/5/15/30/60 phút** tại Cài đặt → Làm mới widget. Cấu hình cũ giữ nguyên cho đến khi bạn đổi.
- Mốc1/3/5 phút cần **Báo thức và lời nhắc** trên Android12+. Bấm nút trong app để mở trang quyền của Android, bật cho VPS Control rồi quay lại. Khi chưa cấp hoặc bị thu hồi quyền, app thông báo lịch dự phòng15 phút.
- Lịch nhanh dùng chung cho các widget và không đánh thức máy mỗi phút. Máy ngủ, Doze hoặc tiết kiệm pin của hãng có thể làm trễ. App chính đang mở tự cập nhật mỗi phút; có nút làm mới thủ công.
- Giờ **quan sát** là thời điểm lấy mẫu ở server; giờ app nhận dữ liệu có thể khác. Dấu `—` nghĩa là chưa có số liệu, không phải0.
- **Đã lưu/Cached** là số liệu từng online rồi cũ đi trên điện thoại, được giữ tối đa24 giờ và hiển thị màu nhạt. Nó không xác nhận VPS đang online hiện tại. Backend offline/unknown/stale/disabled không được biến thành chỉ số hiện tại.

App kiểm tra feed GitHub khi mở. Khi có bản mới, bấm cập nhật để tải và xác minh APK; Android vẫn yêu cầu xác nhận cài đặt hoặc quyền nguồn cài đặt khi cần. File tải tạm được dọn theo quy trình cập nhật.

## Khi cần kiểm tra

| Hiện tượng | Cách xử lý |
| --- | --- |
| Mã ghép nối bị từ chối | Tạo mã mới nếu hết5 phút, đã dùng hoặc bị thu hồi |
| Không đủ VPS | Kiểm phạm vi thiết bị/tài khoản trên web; tạo ghép nối phù hợp khi cần |
| Chọn1 phút nhưng dữ liệu chưa đổi | Đọc trạng thái quyền, giờ quan sát, mạng và worker; chu kỳ collector server cũng ảnh hưởng |
| Có nhãn Đã lưu | Kiểm giờ quan sát và thử cập nhật; không diễn giải như số liệu live |
| Mất quyền thiết bị | Xác minh trên web rồi ghép nối lại; auth hết hạn/thu hồi xóa credentials và cache khi điện thoại phát hiện |

Nghiệm thu riêng Samsung về ngủ lâu, pin và khởi động lại của1.3.0 vẫn chờ thử trên thiết bị thật. Emulator Android10/15 đã kiểm timer thực, cập nhật giữ dữ liệu và widget. Xem [trạng thái](STATUS.md).

## Phát triển và vận hành

[Build/ký/phát hành](RELEASE.md) · [Update feed](UPDATES.md) · [Cơ chế refresh](REFRESH.md) · [Mobile API](MOBILE-API.md) · [Roadmap gốc](ROADMAP.md) · [Dọn dẹp](CLEANUP.md) · [Checkpoint lịch sử](archive/README.md).
