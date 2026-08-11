"use client";

import { useEffect } from "react";
import type { AppLanguage } from "./localization";

/**
 * Compatibility catalog for existing UI copy. New and frequently edited
 * components should use `useI18n`; this boundary keeps legacy dialogs and
 * accessibility attributes bilingual without translating market/user data.
 */
export const VI_UI_COPY: Readonly<Record<string, string>> = {
  "Account": "Tài khoản",
  "Account menu": "Menu tài khoản",
  "Account security": "Bảo mật tài khoản",
  "Accounts": "Tài khoản",
  "Active": "Đang hoạt động",
  "Activity": "Hoạt động",
  "Add": "Thêm",
  "Add alert": "Thêm cảnh báo",
  "Add custom interval": "Thêm khoảng thời gian tùy chỉnh",
  "Add custom interval...": "Thêm khoảng thời gian tùy chỉnh...",
  "Add level": "Thêm mức",
  "Add section": "Thêm phần",
  "Add to favorites": "Thêm vào mục yêu thích",
  "Alert Center": "Trung tâm cảnh báo",
  "Alert creation is disabled during Replay": "Không thể tạo cảnh báo trong Chế độ Phát lại",
  "Alerts": "Cảnh báo",
  "All charts": "Tất cả biểu đồ",
  "Analytics": "Phân tích",
  "Angles": "Góc",
  "Approve trade": "Phê duyệt giao dịch",
  "Authentication is managed by Google and Firebase.": "Google và Firebase quản lý việc xác thực.",
  "Bar index": "Chỉ số thanh",
  "Bracket": "Lệnh chốt lời/cắt lỗ",
  "Cancel": "Hủy",
  "Back": "Quay lại",
  "Back to trade security": "Quay lại bảo mật giao dịch",
  "Cancel turning off protection": "Hủy tắt bảo vệ",
  "Incorrect trade password. Please try again.": "Mật khẩu giao dịch không đúng. Vui lòng thử lại.",
  "Keep protection on": "Giữ bật bảo vệ",
  "Turn off protection": "Tắt bảo vệ",
  "Cancel live order": "Hủy lệnh thật",
  "Cancel order": "Hủy lệnh",
  "Cancel Replay bar selection": "Hủy chọn thanh Phát lại",
  "Chart actions": "Thao tác biểu đồ",
  "Chart arrangement": "Bố cục biểu đồ",
  "Chart captures": "Ảnh chụp biểu đồ",
  "Chart display": "Hiển thị biểu đồ",
  "Chart interval": "Khung thời gian biểu đồ",
  "Chart time zone": "Múi giờ biểu đồ",
  "Chart tools": "Công cụ biểu đồ",
  "Check the MT5 catalog connection or try another search.": "Kiểm tra kết nối danh mục MT5 hoặc thử tìm kiếm khác.",
  "Clear": "Xóa",
  "Clear chart": "Xóa biểu đồ",
  "Close": "Đóng",
  "Close connection settings": "Đóng cài đặt kết nối",
  "Close settings": "Đóng cài đặt",
  "Collapse bottom panel": "Thu gọn bảng phía dưới",
  "Collapse group": "Thu gọn nhóm",
  "Commission": "Hoa hồng",
  "Compiled release": "Bản phát hành đã biên dịch",
  "Configured": "Đã cấu hình",
  "Confirm turning off protection": "Xác nhận tắt bảo vệ",
  "Connections": "Kết nối",
  "Copy": "Sao chép",
  "Copy EA gateway URL": "Sao chép URL cổng EA",
  "Copy image": "Sao chép hình ảnh",
  "Copy pairing token": "Sao chép mã ghép nối",
  "Copy PNG to clipboard": "Sao chép PNG vào bộ nhớ tạm",
  "Copy routing": "Định tuyến sao chép",
  "Create alert": "Tạo cảnh báo",
  "Create drawing alert": "Tạo cảnh báo hình vẽ",
  "Create, compile and manage source code": "Tạo, biên dịch và quản lý mã nguồn",
  "Current": "Hiện tại",
  "Current trade password": "Mật khẩu giao dịch hiện tại",
  "New trade password": "Mật khẩu giao dịch mới",
  "Confirm trade password": "Xác nhận mật khẩu giao dịch",
  "Forgot trade password?": "Quên mật khẩu giao dịch?",
  "Reset trade password": "Đặt lại mật khẩu giao dịch",
  "Send confirmation code": "Gửi mã xác nhận",
  "Send another code": "Gửi mã khác",
  "Confirmation code": "Mã xác nhận",
  "Reset password": "Đặt lại mật khẩu",
  "Sent to": "Đã gửi tới",
  "We will send a confirmation code to the verified email on your account. Protection stays on while you reset the password.": "Chúng tôi sẽ gửi mã xác nhận đến email đã xác minh của tài khoản. Bảo vệ vẫn được bật trong khi bạn đặt lại mật khẩu.",
  "The code expires after 10 minutes. Your new password must contain 8-128 characters.": "Mã hết hạn sau 10 phút. Mật khẩu mới phải có 8-128 ký tự.",
  "Please wait before requesting another code.": "Vui lòng chờ trước khi yêu cầu mã khác.",
  "Enter the 6-digit confirmation code.": "Nhập mã xác nhận gồm 6 chữ số.",
  "The confirmation code is incorrect.": "Mã xác nhận không đúng.",
  "The confirmation code expired. Request a new code.": "Mã xác nhận đã hết hạn. Hãy yêu cầu mã mới.",
  "Too many attempts. Request a new confirmation code.": "Đã thử quá nhiều lần. Hãy yêu cầu mã xác nhận mới.",
  "Trade password reset. All browser trade unlocks were revoked.": "Đã đặt lại mật khẩu giao dịch. Tất cả phiên mở khóa giao dịch trên trình duyệt đã bị thu hồi.",
  "Current chart": "Biểu đồ hiện tại",
  "Currently dark": "Hiện đang dùng giao diện tối",
  "Currently light": "Hiện đang dùng giao diện sáng",
  "Dark theme": "Giao diện tối",
  "Dataset progress": "Tiến độ dữ liệu",
  "Date": "Ngày",
  "Date / time": "Ngày / giờ",
  "Delete": "Xóa",
  "Delete alert": "Xóa cảnh báo",
  "Delete expired alert": "Xóa cảnh báo đã hết hạn",
  "Delete group": "Xóa nhóm",
  "Delete layout": "Xóa bố cục",
  "Delete script": "Xóa tập lệnh",
  "Delete section": "Xóa phần",
  "Delete selected": "Xóa mục đã chọn",
  "Delete template": "Xóa mẫu",
  "Delete this script?": "Xóa tập lệnh này?",
  "Demo and Live use the same process.": "Tài khoản Demo và Live dùng cùng một quy trình.",
  "Destructive actions": "Thao tác không thể hoàn tác",
  "Dismiss": "Bỏ qua",
  "Double click to rename section": "Nhấp đúp để đổi tên phần",
  "Download image": "Tải hình ảnh",
  "Drawing settings sections": "Các phần cài đặt hình vẽ",
  "Drawing target": "Mục tiêu hình vẽ",
  "Drawing tools": "Công cụ vẽ",
  "Drawings": "Hình vẽ",
  "Drag to reorder · Arrow Up/Down": "Kéo để sắp xếp · Mũi tên Lên/Xuống",
  "Edit": "Chỉnh sửa",
  "Edit alert": "Chỉnh sửa cảnh báo",
  "Entry": "Giá vào lệnh",
  "Enter your current trade password.": "Nhập mật khẩu giao dịch hiện tại.",
  "Enter your current trade password to turn off protection for live orders and execution actions.": "Nhập mật khẩu giao dịch hiện tại để tắt bảo vệ cho lệnh thật và các thao tác khớp lệnh.",
  "Equity": "Vốn chủ sở hữu",
  "Equity & Drawdown Curve": "Đường cong Vốn và Sụt giảm",
  "Equity proportional": "Theo tỷ lệ vốn",
  "Equity pulse": "Diễn biến vốn",
  "Execution mode": "Chế độ khớp lệnh",
  "Exit fullscreen": "Thoát toàn màn hình",
  "Expand group": "Mở rộng nhóm",
  "Export replay report": "Xuất báo cáo Phát lại",
  "Favorite": "Yêu thích",
  "Fit price and time scale": "Khớp thang giá và thời gian",
  "Fullscreen": "Toàn màn hình",
  "Gann scale": "Tỷ lệ Gann",
  "Go to": "Đi đến",
  "Grid lines": "Đường lưới",
  "Group and reorder the shared watchlist": "Nhóm và sắp xếp lại danh sách theo dõi dùng chung",
  "Group selected": "Nhóm mục đã chọn",
  "Hide": "Ẩn",
  "Hide password": "Ẩn mật khẩu",
  "Hide selected": "Ẩn mục đã chọn",
  "History": "Lịch sử",
  "Info": "Thông tin",
  "Institutional workspace": "Không gian giao dịch chuyên nghiệp",
  "Instruments": "Công cụ giao dịch",
  "Interactive price chart": "Biểu đồ giá tương tác",
  "Interval": "Khung thời gian",
  "Journal entries": "Mục nhật ký",
  "Journal performance summary": "Tóm tắt hiệu suất nhật ký",
  "Journal sync is limited": "Đồng bộ nhật ký đang bị giới hạn",
  "Key metrics": "Chỉ số chính",
  "Labels": "Nhãn",
  "Layout": "Bố cục",
  "Levels": "Mức",
  "Light theme": "Giao diện sáng",
  "Live": "Trực tiếp",
  "Loading indicator catalog...": "Đang tải danh mục chỉ báo...",
  "Loading journal": "Đang tải nhật ký",
  "Loading market data": "Đang tải dữ liệu thị trường",
  "Loading performance analytics": "Đang tải phân tích hiệu suất",
  "Loading public indicators...": "Đang tải chỉ báo công khai...",
  "Loading terminal": "Đang tải terminal",
  "Lock": "Khóa",
  "Lock selected": "Khóa mục đã chọn",
  "Make default": "Đặt làm mặc định",
  "Manage watchlists": "Quản lý danh sách theo dõi",
  "Market data": "Dữ liệu thị trường",
  "Market desk": "Bàn thị trường",
  "Market sidebar": "Thanh bên thị trường",
  "Market, chart, synchronization and execution messages will appear here.": "Thông báo thị trường, biểu đồ, đồng bộ và khớp lệnh sẽ xuất hiện ở đây.",
  "Message (optional)": "Tin nhắn (không bắt buộc)",
  "Monthly Performance": "Hiệu suất theo tháng",
  "Monthly performance": "Hiệu suất theo tháng",
  "Move down": "Di chuyển xuống",
  "Move up": "Di chuyển lên",
  "Net": "Ròng",
  "Net equity": "Vốn ròng",
  "Net performance": "Hiệu suất ròng",
  "New": "Mới",
  "New script": "Tập lệnh mới",
  "No active alerts.": "Không có cảnh báo đang hoạt động.",
  "No closed trades yet": "Chưa có giao dịch đã đóng",
  "No completed trades yet": "Chưa có giao dịch hoàn tất",
  "No drawings on this chart": "Không có hình vẽ trên biểu đồ này",
  "No events yet": "Chưa có sự kiện",
  "No execution events yet.": "Chưa có sự kiện khớp lệnh.",
  "No indicators found.": "Không tìm thấy chỉ báo.",
  "No journal entries yet": "Chưa có mục nhật ký",
  "No markets found": "Không tìm thấy thị trường",
  "No open positions": "Không có vị thế mở",
  "No saved layouts": "Không có bố cục đã lưu",
  "No saved layouts yet.": "Chưa có bố cục đã lưu.",
  "No sections yet.": "Chưa có phần nào.",
  "Normal": "Bình thường",
  "Notifications": "Thông báo",
  "Object tree": "Cây đối tượng",
  "Open in editor": "Mở trong trình soạn thảo",
  "Open P/L": "Lãi/Lỗ đang mở",
  "Open Pine Editor": "Mở Trình soạn thảo Pine",
  "Open Pine workspace": "Mở không gian Pine",
  "Open positions": "Vị thế mở",
  "Order ticket": "Phiếu lệnh",
  "Overlay visibility": "Hiển thị lớp phủ",
  "P/L": "Lãi/Lỗ",
  "Partial": "Một phần",
  "Percent": "Phần trăm",
  "Performance": "Hiệu suất",
  "Performance intelligence": "Phân tích hiệu suất",
  "Pine Editor": "Trình soạn thảo Pine",
  "Pine source": "Mã nguồn Pine",
  "Pine source code": "Mã nguồn Pine",
  "Play / Pause (Space)": "Phát / Tạm dừng (Space)",
  "Positions": "Vị thế",
  "Preparing backend Replay...": "Đang chuẩn bị Phát lại từ backend...",
  "Previous month": "Tháng trước",
  "Next month": "Tháng sau",
  "Price": "Giá",
  "Price levels": "Mức giá",
  "Private Pine workspace": "Không gian Pine riêng tư",
  "Profit level": "Mức chốt lời",
  "Publish script": "Xuất bản tập lệnh",
  "Quantity": "Khối lượng",
  "Realized": "Đã chốt",
  "Realized P/L": "Lãi/Lỗ đã chốt",
  "Realtime monitor": "Theo dõi thời gian thực",
  "Re-arm alert": "Kích hoạt lại cảnh báo",
  "Recent activity": "Hoạt động gần đây",
  "Remove": "Xóa",
  "Remove list": "Xóa danh sách",
  "Rename": "Đổi tên",
  "Rename watchlist": "Đổi tên danh sách theo dõi",
  "Replay controls": "Điều khiển Phát lại",
  "Replay scope": "Phạm vi Phát lại",
  "Replay start bar": "Thanh bắt đầu Phát lại",
  "Replay timing": "Thời gian Phát lại",
  "Reset account": "Đặt lại tài khoản",
  "Reset chart view": "Đặt lại chế độ xem biểu đồ",
  "Return": "Lợi nhuận",
  "Risk percent": "Phần trăm rủi ro",
  "Runtime activity": "Hoạt động hệ thống",
  "Runtime logs": "Nhật ký hệ thống",
  "Same quantity": "Cùng khối lượng",
  "Save": "Lưu",
  "Save and add to chart": "Lưu và thêm vào biểu đồ",
  "Save current": "Lưu hiện tại",
  "Save current as…": "Lưu hiện tại thành…",
  "Save PNG to this device": "Lưu PNG vào thiết bị này",
  "Saved layouts": "Bố cục đã lưu",
  "Saved scripts": "Tập lệnh đã lưu",
  "Script name": "Tên tập lệnh",
  "Search": "Tìm kiếm",
  "Search markets": "Tìm kiếm thị trường",
  "Search symbol": "Tìm kiếm mã",
  "Search symbol or market": "Tìm mã hoặc thị trường",
  "Search symbol, market or venue": "Tìm mã, thị trường hoặc sàn",
  "Search the MT5 catalog to add your first instrument.": "Tìm trong danh mục MT5 để thêm công cụ giao dịch đầu tiên.",
  "Sections": "Phần",
  "Select copy target accounts": "Chọn tài khoản đích sao chép",
  "Select interval": "Chọn khung thời gian",
  "Select market": "Chọn thị trường",
  "Select Replay bar": "Chọn thanh Phát lại",
  "Select time zone": "Chọn múi giờ",
  "Select an execution account to inspect account-scoped events.": "Chọn tài khoản khớp lệnh để xem các sự kiện của tài khoản.",
  "Shared settings": "Cài đặt dùng chung",
  "Show": "Hiện",
  "Show bottom panel": "Hiện bảng phía dưới",
  "Show chart grid": "Hiện lưới biểu đồ",
  "Show password": "Hiện mật khẩu",
  "Show saved templates": "Hiện mẫu đã lưu",
  "Side": "Phía",
  "Sign in to create, save and run private indicators.": "Đăng nhập để tạo, lưu và chạy chỉ báo riêng tư.",
  "Sign in to save layouts": "Đăng nhập để lưu bố cục",
  "Sign in to your workspace": "Đăng nhập vào không gian làm việc",
  "Sign in with Google": "Đăng nhập bằng Google",
  "Sign out": "Đăng xuất",
  "Simulator mode is active": "Chế độ mô phỏng đang hoạt động",
  "Smart Money Concepts": "Khái niệm Dòng tiền Thông minh",
  "Snapshot": "Ảnh chụp nhanh",
  "Sort instruments": "Sắp xếp công cụ giao dịch",
  "Speed": "Tốc độ",
  "Stats": "Thống kê",
  "Status": "Trạng thái",
  "Stop level": "Mức cắt lỗ",
  "Switch or manage the shared lists": "Chuyển đổi hoặc quản lý danh sách dùng chung",
  "Symbol": "Mã",
  "Sync layouts, drawings, indicators, watchlists and private Pine scripts across desktop and mobile.": "Đồng bộ bố cục, hình vẽ, chỉ báo, danh sách theo dõi và tập lệnh Pine riêng tư giữa máy tính và điện thoại.",
  "Synced to your account": "Đã đồng bộ với tài khoản",
  "Table": "Bảng",
  "Tap the active field again to reverse direction": "Chạm lại trường đang chọn để đảo chiều",
  "Target accounts": "Tài khoản đích",
  "Template": "Mẫu",
  "Text": "Văn bản",
  "Text alignment": "Căn chỉnh văn bản",
  "This watchlist is empty": "Danh sách theo dõi này đang trống",
  "Time": "Thời gian",
  "Time levels": "Mức thời gian",
  "Time zone": "Múi giờ",
  "Trade data": "Dữ liệu giao dịch",
  "Trade desk": "Bàn giao dịch",
  "Trade notes / rationale…": "Ghi chú / lý do giao dịch…",
  "Trade quality": "Chất lượng giao dịch",
  "Trade security": "Bảo mật giao dịch",
  "Trade workspace": "Không gian giao dịch",
  "Trades": "Giao dịch",
  "Trading workspace": "Không gian giao dịch",
  "Triggered": "Đã kích hoạt",
  "Turn the optional second password for live trades on or off.": "Bật hoặc tắt mật khẩu thứ hai tùy chọn cho giao dịch thật.",
  "Type": "Loại",
  "Undo": "Hoàn tác",
  "Ungroup selected": "Bỏ nhóm mục đã chọn",
  "Unix time": "Thời gian Unix",
  "Unsectioned": "Chưa phân phần",
  "Unlock": "Mở khóa",
  "Update": "Cập nhật",
  "Update selected": "Cập nhật mục đã chọn",
  "Use selected Replay bar": "Dùng thanh Phát lại đã chọn",
  "Use the entire display": "Dùng toàn bộ màn hình",
  "Uses the same supported chart intervals as desktop": "Dùng cùng các khung thời gian được hỗ trợ như trên máy tính",
  "Verified": "Đã xác minh",
  "Visibility": "Khả năng hiển thị",
  "Volume": "Khối lượng",
  "Volume Profile": "Hồ sơ Khối lượng",
  "Wait up to 5 min": "Chờ tối đa 5 phút",
  "Watchlist": "Danh sách theo dõi",
  "Watchlists": "Danh sách theo dõi",
  "What was the setup, thesis and lesson?": "Thiết lập, luận điểm và bài học là gì?",
  "Width": "Độ rộng",
  "Win / Loss Distribution (R)": "Phân bổ Thắng / Thua (R)",
  "Win rate": "Tỷ lệ thắng",
  "You": "Bạn",
  "Your execution history and performance insights will appear here.": "Lịch sử khớp lệnh và phân tích hiệu suất sẽ xuất hiện ở đây.",
  "Your Pine script · Tap to add to chart": "Tập lệnh Pine của bạn · Chạm để thêm vào biểu đồ",
  "and its source code will be removed permanently.": "và mã nguồn của nó sẽ bị xóa vĩnh viễn.",
  "Add symbol": "Thêm mã",
  "Backend login failed": "Đăng nhập backend thất bại",
  "Chart settings": "Cài đặt biểu đồ",
  "Chg": "Thay đổi",
  "Chg%": "Thay đổi %",
  "Connecting": "Đang kết nối",
  "Grid view (not available)": "Chế độ lưới (chưa khả dụng)",
  "Hide indicator": "Ẩn chỉ báo",
  "Indicator settings": "Cài đặt chỉ báo",
  "Indicators": "Chỉ báo",
  "Last": "Giá cuối",
  "More": "Thêm",
  "MT5 symbol catalog failed": "Tải danh mục mã MT5 thất bại",
  "Object Tree": "Cây đối tượng",
  "Open source code": "Mở mã nguồn",
  "Remove indicator": "Xóa chỉ báo",
  "Show indicator": "Hiện chỉ báo",
  "Source unavailable": "Không có mã nguồn",
  "Start Replay": "Bắt đầu Phát lại",
  "Toggle watchlist": "Bật/tắt danh sách theo dõi",
  "Sign in to use backend Replay.": "Đăng nhập để sử dụng Phát lại từ backend.",
  "Replay is idle. Sign in and select a UTC time; the Go backend owns the clock, aggregation, revealed bars, and isolated trading ledger.": "Phát lại đang chờ. Hãy đăng nhập và chọn thời gian UTC; backend Go quản lý đồng hồ, tổng hợp nến, các thanh đã hiển thị và sổ giao dịch tách biệt.",
  "Common execution workspace · MT5 EA and native venue adapters": "Không gian khớp lệnh chung · MT5 EA và bộ kết nối sàn gốc",
  "One MT5 terminal runs one account. Attach the same EA to every terminal to populate this list.": "Mỗi terminal MT5 chạy một tài khoản. Gắn cùng EA vào từng terminal để đưa tài khoản vào danh sách này.",
  "Orders, positions and copy execution": "Lệnh, vị thế và sao chép giao dịch",
  "Simulator ready": "Trình mô phỏng đã sẵn sàng",
  "No open positions. Place an order or press B / S.": "Không có vị thế mở. Hãy đặt lệnh hoặc nhấn B / S.",
  "Qty": "Khối lượng",
  "market": "thị trường",
  "limit": "giới hạn",
  "stop": "dừng",
  "Stop loss": "Cắt lỗ",
  "Take profit": "Chốt lời",
  "Risk %": "Rủi ro %",
  "Size": "Khối lượng",
  "Risk": "Rủi ro",
  "Reward": "Lợi nhuận kỳ vọng",
  "Buy": "Mua",
  "Sell": "Bán",
  "Close All": "Đóng tất cả",
  "Market": "Thị trường",
  "Markets": "Thị trường",
  "Draw": "Vẽ",
  "Tools": "Công cụ",
  "Replay": "Phát lại",
  "Chart": "Biểu đồ",
  "Trade": "Giao dịch",
  "Portfolio": "Danh mục",
  "Menu": "Trình đơn",
  "Move indicator legend. Use drag or arrow keys to move; Home resets the position.": "Di chuyển chú giải chỉ báo. Kéo hoặc dùng phím mũi tên; Home đặt lại vị trí.",
  "Move chart actions. Use drag or arrow keys to move; Home resets the position.": "Di chuyển thanh thao tác biểu đồ. Kéo hoặc dùng phím mũi tên; Home đặt lại vị trí.",
};

/** Legacy trade screens that predate localization and were authored in Vietnamese. */
export const EN_UI_COPY: Readonly<Record<string, string>> = {
  "Ngắt kết nối EA?": "Disconnect EA?",
  "Ngắt kết nối": "Disconnect",
  "Giữ kết nối": "Keep connected",
  "Đã ngắt kết nối account": "Account disconnected",
  "EA cần một pairing token mới để kết nối lại.": "The EA needs a new pairing token to reconnect.",
  "Không thể ngắt kết nối": "Unable to disconnect",
  "Account chưa thay đổi. Vui lòng thử lại.": "The account was not changed. Please try again.",
  "Xóa account khỏi SMC Terminal?": "Remove account from SMC Terminal?",
  "Xóa account": "Remove account",
  "Hủy": "Cancel",
  "Đã xóa account": "Account removed",
  "Lịch sử lệnh và security audit vẫn được lưu an toàn.": "Order history and the security audit remain stored securely.",
  "Không thể xóa account": "Unable to remove account",
  "Quản lý execution account": "Manage execution account",
  "Đóng quản lý account": "Close account management",
  "Đóng": "Close",
  "Pairing token mới": "New pairing token",
  "Token dùng một lần trong 5 phút. Kết nối hiện tại chỉ bị thay thế sau khi EA ghép nối thành công bằng token mới.": "The token is valid for one use within 5 minutes. The current connection is replaced only after the EA pairs successfully with the new token.",
  "Lấy token mới": "Get new token",
  "Hết hạn": "Expires",
  "Đã sao chép": "Copied",
  "Sao chép": "Copy",
  "Không thể tạo token. Hãy đăng nhập lại và thử lần nữa.": "Unable to create a token. Sign in again and retry.",
  "Ngắt kết nối EA": "Disconnect EA",
  "Các thao tác trên không đóng position đang mở tại broker. Hãy kiểm tra MT5 trước khi ngắt hoặc xóa account.": "These actions do not close positions at the broker. Check MT5 before disconnecting or removing the account.",
  "Hướng dẫn cài MarketLensExecutionEA": "MarketLensExecutionEA setup guide",
  "Một EA dùng chung cho FTMO, Exness và các broker MT5. Hoàn tất khoảng 5 phút.": "One EA for FTMO, Exness, and other MT5 brokers. Setup takes about 5 minutes.",
  "Đóng hướng dẫn cài EA": "Close EA setup guide",
  "Đã hiểu": "Got it",
  "EA chính thức đã được kiểm tra SHA-256.": "The official EA has been SHA-256 verified.",
  "Demo và Live sử dụng cùng một quy trình.": "Demo and Live use the same process.",
  "Mỗi account cần một terminal MT5 riêng đang chạy": "Each account needs its own running MT5 terminal",
  "Tải EA chính thức": "Download the official EA",
  "Tải file đã compile; user không cần truy cập source hoặc tự dùng MetaEditor.": "Download the compiled file; users do not need source access or MetaEditor.",
  "Tải MarketLensExecutionEA.ex5": "Download MarketLensExecutionEA.ex5",
  "Tải SHA-256": "Download SHA-256",
  "Chép EA vào MT5": "Copy the EA into MT5",
  "Trong MT5 chọn File → Open Data Folder.": "In MT5, choose File → Open Data Folder.",
  "Cho phép WebRequest": "Allow WebRequest",
  "URL thêm vào WebRequest allow-list": "URL to add to the WebRequest allow-list",
  "Tạo pairing token": "Create pairing token",
  "Token chỉ dùng một lần và hết hạn sau 5 phút. Hãy tạo token ngay trước khi kéo EA vào chart.": "The token is single-use and expires after 5 minutes. Create it immediately before attaching the EA to a chart.",
  "Token sẵn sàng · hết hạn": "Token ready · expires",
  "Sao chép pairing token": "Copy pairing token",
  "Tạo token mới": "Create new token",
  "Tạo token 5 phút": "Create 5-minute token",
  "Gắn EA vào chart và kết nối": "Attach the EA to a chart and connect",
  "Kéo MarketLensExecutionEA vào đúng một chart trong terminal.": "Attach MarketLensExecutionEA to exactly one chart in the terminal.",
  "Bật Allow Algo Trading trong tab Common.": "Enable Allow Algo Trading on the Common tab.",
  "Bật nút Algo Trading trên thanh công cụ MT5.": "Enable Algo Trading on the MT5 toolbar.",
  "Dùng nhiều tài khoản": "Use multiple accounts",
  "Nếu chưa kết nối": "If it does not connect",
  "Cài MT5 EA": "Install MT5 EA",
  "Quản lý account": "Manage account",
  "Hướng dẫn cài đặt": "Setup guide",
  "Token được tạo ở bước 4": "Token created in step 4",
};

const ATTRIBUTE_NAMES = ["aria-label", "title", "placeholder"] as const;
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();

type Pattern = readonly [RegExp, (...matches: string[]) => string];
const VI_PATTERNS: readonly Pattern[] = [
  [/^Active \((\d+)\)$/, (count) => `Đang hoạt động (${count})`],
  [/^Triggered \((\d+)\)$/, (count) => `Đã kích hoạt (${count})`],
  [/^Expired \((\d+)\)$/, (count) => `Đã hết hạn (${count})`],
  [/^History \((\d+)\)$/, (count) => `Lịch sử (${count})`],
  [/^Object Tree \((\d+)\)$/, (count) => `Cây đối tượng (${count})`],
  [/^(\d+) instruments$/, (count) => `${count} công cụ giao dịch`],
  [/^(\d+) recent events · newest first$/, (count) => `${count} sự kiện gần đây · mới nhất trước`],
  [/^(\d+) closed$/, (count) => `${count} đã đóng`],
  [/^(\d+) analyzed trades$/, (count) => `${count} giao dịch đã phân tích`],
  [/^(\d+) trades$/, (count) => `${count} giao dịch`],
  [/^(\d+) execution target$/, (count) => `${count} tài khoản khớp lệnh`],
  [/^(\d+) execution targets$/, (count) => `${count} tài khoản khớp lệnh`],
  [/^Market data (.+)$/, (status) => `Dữ liệu thị trường ${translateCore(status) ?? status}`],
  [/^Reorder (.+)\. Drag or use Arrow Up and Arrow Down\.$/, (value) => `Sắp xếp lại ${value}. Kéo hoặc dùng phím Mũi tên Lên và Xuống.`],
  [/^Close (.+)$/, (value) => `Đóng ${value}`],
  [/^Remove (.+) from watchlist$/, (value) => `Xóa ${value} khỏi danh sách theo dõi`],
  [/^Add (.+) to watchlist$/, (value) => `Thêm ${value} vào danh sách theo dõi`],
  [/^Rename (.+)$/, (value) => `Đổi tên ${value}`],
  [/^Delete (.+)$/, (value) => `Xóa ${value}`],
  [/^Move (.+) up$/, (value) => `Di chuyển ${value} lên`],
  [/^Move (.+) down$/, (value) => `Di chuyển ${value} xuống`],
  [/^Section for (.+)$/, (value) => `Phần của ${value}`],
  [/^Close (.+)$/, (value) => `Đóng ${value}`],
  [/^Chart (\d+), active$/, (slot) => `Biểu đồ ${slot}, đang hoạt động`],
  [/^Chart (\d+)$/, (slot) => `Biểu đồ ${slot}`],
];

function translateCore(source: string): string | null {
  const exact = VI_UI_COPY[source];
  if (exact) return exact;
  for (const [pattern, render] of VI_PATTERNS) {
    const match = pattern.exec(source);
    if (match) return render(...match.slice(1));
  }
  return null;
}

export function translateDocumentText(
  language: AppLanguage,
  source: string,
): string {
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  const core = source.trim();
  const translated =
    language === "vi"
      ? translateCore(core)
      : EN_UI_COPY[core] ?? null;
  return translated === null ? source : `${leading}${translated}${trailing}`;
}

function localizeTextNode(node: Text, language: AppLanguage): void {
  const current = node.data;
  const core = current.trim();
  if (!core) return;
  const knownSource = originalText.get(node);
  const source = knownSource ?? current;
  const desired = translateDocumentText(language, source);
  if (desired !== current) {
    if (knownSource === undefined) originalText.set(node, source);
    node.data = desired;
  }
}

function localizeAttribute(
  element: Element,
  name: (typeof ATTRIBUTE_NAMES)[number],
  language: AppLanguage,
): void {
  const current = element.getAttribute(name);
  if (!current) return;
  let sources = originalAttributes.get(element);
  const knownSource = sources?.get(name);
  const source = knownSource ?? current;
  const translated = translateDocumentText(language, source);
  if (translated === current) return;
  if (!sources) {
    sources = new Map();
    originalAttributes.set(element, sources);
  }
  if (knownSource === undefined) sources.set(name, source);
  element.setAttribute(name, translated);
}

function localizeTree(root: Node, language: AppLanguage): void {
  if (root instanceof Text) {
    localizeTextNode(root, language);
    return;
  }
  if (!(root instanceof Element) && !(root instanceof Document)) return;
  if (root instanceof Element) {
    if (root.closest("[data-no-translate], pre, code, textarea, [contenteditable='true']")) return;
    for (const name of ATTRIBUTE_NAMES) localizeAttribute(root, name, language);
  }
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let node = walker.nextNode();
  while (node) {
    if (node instanceof Element) {
      if (node.matches("[data-no-translate], pre, code, textarea, [contenteditable='true']")) {
        node = walker.nextSibling();
        continue;
      }
      for (const name of ATTRIBUTE_NAMES) localizeAttribute(node, name, language);
    } else if (node instanceof Text) {
      localizeTextNode(node, language);
    }
    node = walker.nextNode();
  }
}

export function useDocumentLocalization(language: AppLanguage): void {
  useEffect(() => {
    const root = document.body;
    localizeTree(root, language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          localizeTree(mutation.target, language);
        } else if (mutation.type === "attributes") {
          localizeTree(mutation.target, language);
        } else {
          for (const node of mutation.addedNodes) localizeTree(node, language);
        }
      }
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTE_NAMES],
    });
    return () => observer.disconnect();
  }, [language]);
}
