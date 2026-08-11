<div align="center">

🇻🇳 **Tiếng Việt** · [🇬🇧 English](README.en.md)

# ✦ MarketLens ✦

### Thấu thị trường. Thử mọi ý tưởng. Giao dịch vững tin.

**MarketLens là không gian giao dịch chuẩn production lấy cảm hứng từ TradingView—nơi biểu đồ chuyên sâu,**<br>
**phát lại thị trường, thực thi MT5 có kiểm soát rủi ro, cảnh báo và dữ liệu thông minh hội tụ trong một terminal.**

[![Production](https://img.shields.io/badge/Production-Live-00C853?style=for-the-badge&logo=vercel&logoColor=white)](https://tradingterminal.io.vn)
![Next.js](https://img.shields.io/badge/Next.js_16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React_19-149ECA?style=for-the-badge&logo=react&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-CE412B?style=for-the-badge&logo=rust&logoColor=white)

[**Mở terminal trực tiếp →**](https://tradingterminal.io.vn) ·
[Khám phá kiến trúc](docs/PROJECT_STRUCTURE.md) ·
[Tài liệu vận hành production](docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md)

</div>

---

## Một không gian. Trọn vẹn hành trình giao dịch.

MarketLens dành cho những nhà giao dịch muốn sự mượt mà của một nền
tảng biểu đồ hiện đại mà không phải chia nhỏ nghiên cứu, luyện tập, thực thi và
đánh giá trên nhiều công cụ rời rạc. Từ lần quan sát thị trường đầu tiên đến bản
ghi giao dịch cuối cùng, mọi giai đoạn đều nằm trong một không gian liền mạch và
thích ứng trên mọi màn hình.

### Vì sao dự án này tồn tại?

Thị trường không thiếu biểu đồ. Điều còn thiếu là một hành trình không đứt gãy.
Trader thường nhìn cấu trúc ở một nơi, kiểm chứng ý tưởng ở nơi khác, đặt lệnh
trên một terminal riêng rồi quay lại thêm một công cụ nữa để theo dõi và đánh
giá. Mỗi lần chuyển đổi là một lần ngữ cảnh bị mất, thao tác bị lặp lại và rủi ro
sai lệch tăng lên.

MarketLens bắt đầu từ một câu hỏi đầy tham vọng:

> **Điều gì sẽ xảy ra nếu một nét vẽ trên biểu đồ không kết thúc ở biểu đồ?**

### Từ một nét vẽ đến quyết định thật

<div align="center">

**Quan sát** → **Vẽ kịch bản** → **Replay** → **Kiểm soát rủi ro** → **MT5** → **Cảnh báo & đánh giá**

</div>

Bạn có thể phát hiện một cấu trúc giá, dựng kịch bản bằng công cụ Long/Short
Position, quay lại lịch sử để kiểm chứng, rồi mở ticket với entry, stop loss và
take profit đã được chuẩn bị từ chính hình vẽ đó. Chỉ sau khi bạn xác nhận, lệnh
mới đi qua lớp kiểm soát rủi ro và được định tuyến tới các tài khoản MT5 đã chọn.
Trong lúc bạn rời màn hình, cảnh báo giá hoặc hình học tiếp tục canh thị trường;
khi quay lại, journal và analytics giúp biến kết quả thành kinh nghiệm.

### Khác biệt nằm ở những gì nối liền bên dưới

| Ý tưởng | Điều dự án thực sự làm |
| --- | --- |
| **Hình vẽ không chỉ để trang trí** | Drawing có thể tạo cảnh báo, chuẩn bị kế hoạch giao dịch và duy trì liên kết với trạng thái lệnh/vị thế. |
| **Replay không chỉ là xem lại** | Dữ liệu lịch sử trở thành môi trường luyện tập để kiểm chứng quy trình và quyết định trước khi dùng vốn thật. |
| **Thực thi không chỉ là một nút bấm** | Go, Rust và EA MT5 phối hợp để xác thực, kiểm tra rủi ro, lưu lệnh bền vững và giữ biên thực thi riêng tư. |
| **Đa tài khoản không đồng nghĩa sao chép mù quáng** | Mỗi copy target có ánh xạ symbol, giới hạn rủi ro và dấu vết trạng thái độc lập. |

### Hơn cả một biểu đồ

- **Biểu đồ chuyên nghiệp** — bố cục đa khung thích ứng, zoom sâu, công cụ vẽ
  chính xác, chỉ báo, mẫu và workspace đồng bộ.
- **Phát lại và nghiên cứu** — phát lại thị trường nhất quán, giao dịch mô phỏng,
  nhật ký, ảnh chụp, phân tích và quy trình backtest.
- **Thực thi production** — định tuyến MT5 trung lập với broker, sao chép đa tài
  khoản, kiểm soát rủi ro tập trung, lệnh bền vững và trạng thái có thể kiểm toán.
- **Bảo mật từ thiết kế** — biên thực thi riêng tư và không lưu mật khẩu MT5;
  mỗi tài khoản luôn kết nối qua EA runtime dùng chung.
- **Một trải nghiệm nhất quán** — xuyên suốt desktop, mobile, tiếng Anh, tiếng
  Việt, cảnh báo trực tiếp và cài đặt đồng bộ với backend.

> **MarketLens biến biểu đồ thành hệ điều hành cho toàn bộ hành trình
> giao dịch—lung linh ở bề mặt, kỷ luật trong từng lớp vận hành.**

## Kiến trúc vận hành

| Thư mục | Vai trò |
| --- | --- |
| `frontend/` | Không gian biểu đồ và giao dịch sử dụng Next.js 16 / React 19 |
| `backend/` | BFF Go có xác thực, lưu trữ, cảnh báo, Replay và dữ liệu thị trường |
| `backend/execution/` | Kiểm soát rủi ro Rust, copy routing, sổ lệnh bền vững và venue adapter |
| `backend/bridge/mt5_ea/` | Một EA MT5 dùng chung cho FTMO, Exness và các broker MT5 khác |
| `backend/bridge/mt5_stream/` | Sidecar Python MT5 riêng tư chỉ phục vụ dữ liệu thị trường, không thực thi lệnh |
| `docs/` | Tài liệu vận hành, bảo mật và thiết kế của monorepo |
| `.codebase-memory/` | Knowledge graph nén và dùng chung cho coding agent |

Giao dịch là một workspace cấp cao nhất, không nằm trong bảng dưới có thể thay
đổi kích thước. Mỗi tài khoản MT5 chạy trong terminal riêng và kết nối với cùng
một EA. Tài khoản Demo và Live đi qua cùng một luồng thực thi. Alias symbol của
broker được ánh xạ theo từng tài khoản; mỗi copy target đều được kiểm tra rủi ro
và ghi nhận độc lập.

FTMO Python Connector cũ, Connector tải về, trình xác minh thông tin đăng nhập,
giao thức thực thi browser-to-loopback và cơ chế lưu mật khẩu MT5 đã được loại
bỏ. Ứng dụng không bao giờ cần mật khẩu MT5 của người dùng.

Thiết kế thực thi và các release gate hiện tại:

- [`docs/TRADE_EXECUTION_ARCHITECTURE.md`](docs/TRADE_EXECUTION_ARCHITECTURE.md)
- [`docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md`](docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md)

## Phát triển

```powershell
cd frontend
npm install
npm run dev
```

```powershell
cd backend
go run ./cmd/api
```

Rust workspace nằm tại `backend/execution/Cargo.toml`. Durable gateway yêu cầu
PostgreSQL và `EXECUTION_ADMIN_TOKEN` có ít nhất 32 ký tự.

## Bộ nhớ codebase dành cho agent

Coding agent phải sử dụng knowledge graph dùng chung trước khi thay đổi code.
Startup gate bắt buộc được định nghĩa trong [`AGENTS.md`](AGENTS.md); quy trình
cài đặt, lập chỉ mục, xuất artifact, giao diện và khôi phục được ghi tại
[`docs/CODEBASE_MEMORY.md`](docs/CODEBASE_MEMORY.md).

## Production

Trên máy chủ production Windows, chạy runner chuẩn từ thư mục gốc của repository:

```powershell
.\run-backend-production.ps1
```

Runner lấy clean worktree, build artifact Go và Rust theo từng giai đoạn, chuẩn
bị private market-data runtime, áp dụng forward migration, khởi động lại an toàn
các listener thuộc quyền sở hữu và chạy health gate local/public. Hai listener
Rust chỉ lắng nghe trên loopback. Go API public chỉ mở `/execution-ea/*` làm relay
nghiêm ngặt tới EA listener; Rust admin listener không có public route.

Frontend production: `https://tradingterminal.io.vn`<br>
Go API: `https://api.tradingterminal.io.vn`

## Kiểm tra cốt lõi

```powershell
cd frontend
npm run typecheck
npm run test:trade
npm run test:ui
```

```powershell
cd backend
go test ./...
```

```powershell
cargo test --manifest-path backend/execution/Cargo.toml --workspace --all-targets
```
