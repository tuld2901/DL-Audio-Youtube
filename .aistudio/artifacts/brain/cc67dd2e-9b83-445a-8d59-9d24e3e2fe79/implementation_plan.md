# YouTube Audio Splitter & Story Publisher Pro — Kế Hoạch Tổng Thể (Plan Mode)

Kế hoạch này chuẩn hóa toàn bộ quy trình chuyển đổi từ công cụ Python `8888_adf6279a.py` (`888.py`) sang hệ thống Website Full-Stack đa luồng hoàn chỉnh, đảm bảo tải đúng file âm thanh gốc (`goc.mp3`), render chính xác `5min.mp3` (1.25x) cùng các phân đoạn `phan_1..N.mp3`, đồng thời tối ưu hóa cấu trúc để **tiết kiệm tối đa lượng token** trong suốt vòng đời phát triển.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Vui lòng xem qua bản thiết kế kiến trúc, kết quả rà soát lỗi từ file `888.py` gốc và chiến lược tiết kiệm token dưới đây. Khi bạn nhấn **Proceed (Thực thi)**, toàn bộ công việc sẽ được triển khai đồng bộ trong một lượt duy nhất để không tốn thêm token hội thoại.

- **Quy trình xử lý âm thanh gốc (`goc.mp3` Master-First)**: Bắt buộc tải xong luồng âm thanh gốc từ YouTube (hoặc từ file tải lên) -> Render chuẩn hóa sang `goc.mp3` (CBR 128kbps, 44.1kHz, 2 kênh, gắn `-write_xing 1` header) -> Dùng `ffprobe` đo chính xác thời lượng và dung lượng thực tế của `goc.mp3` -> Sau đó mới cắt `5min.mp3` (tốc độ `1.25x`) và các phân đoạn `phan_1.mp3 .. phan_N.mp3`. Tuyệt đối không tạo file âm thanh giả lập.
- **Khắc phục triệt để 4 điểm nghẽn trong file `888.py` gốc**:
  1. *Vá lỗi đứt đoạn mã nguồn ở dòng 1063–1064*: Khôi phục phần đóng hàm JS `showCustomError(msg)` và thẻ đóng `</script></body></html>"""` bị thiếu trong file `8888_adf6279a.py`.
  2. *Xử lý bất đồng bộ thực sự (True Multi-Thread / Non-blocking Streaming)*: Trong `888.py`, `HTTPServer` mặc định của Python xử lý tuần tự từng request nên khi nghe thử `<audio>` (`shutil.copyfileobj`) sẽ làm nghẽn việc cập nhật tiến độ `/api/status` ở các tab khác. Bản Web chuyển sang luồng bất đồng bộ kèm HTTP Range Requests (`206 Partial Content`) giúp tua nhạc và mở nhiều tab cùng lúc mượt mà.
  3. *Sửa lỗi lệch thời lượng khi cắt Stream Copy (`cut_mp3`)*: Bổ sung cờ `-write_xing 1` và kiểm tra hậu kỳ bằng `ffprobe` cho từng file `phan_i.mp3` để trình phát nhạc và Telegram luôn hiển thị đúng số phút/giây.
  4. *Vượt rào cản chống Bot của YouTube trên máy chủ Cloud*: Tích hợp trình quản lý `cookies.txt` (Netscape format), `--js-runtimes node` cho `yt-dlp_linux`, luồng tải dự phòng đa cụm máy chủ, và chế độ tải file gốc trực tiếp từ máy tính.

---

## 1. Overview & Core Concept

- **Mục tiêu cốt lõi**: Tự động hóa hoàn toàn khâu sản xuất và xuất bản truyện audio từ YouTube lên hệ thống **Nằm Nghe Audio (`namnghe.com`)** và kênh **Telegram Bot** quản trị.
- **Đối tượng sử dụng**: Quản trị viên, biên tập viên nội dung audio mở nhiều tab Chrome song song để xử lý hàng loạt bộ truyện dài (1–5 tiếng/bộ).
- **Chiến lược Tiết Kiệm Token Tối Đa (Zero-Waste Token Strategy)**:
  1. **Kiến trúc 2-Module Tinh Gọn (Compact Monolith)**: Thay vì chia nhỏ thành 15–20 file component khiến mỗi lần sửa phải đọc/ghi lại nhiều file (tốn hàng chục nghìn token ngữ cảnh), toàn bộ dự án được cô đọng vào 2 hạt nhân chính (1 Backend điều phối + 1 Frontend giao diện hợp nhất).
  2. **Làm việc qua Plan Mode (Single-Shot Execution)**: Mọi thay đổi về thuật toán, giao diện, API đều được chốt tại tài liệu kế hoạch này trước khi chạm vào code, giúp hoàn tất bản dựng trong **1 lượt chạy duy nhất** thay vì sửa đi sửa lại nhiều vòng.
  3. **Tách vùng nhớ Media ra ngoài Workspace (`/tmp/namnghe_uploads`)**: Toàn bộ binary `yt-dlp` (~40MB) và các file âm thanh `goc.mp3`, `5min.mp3`, `phan_i.mp3` (hàng trăm MB) được lưu tại `/tmp` ngoài cây thư mục mã nguồn. Điều này giúp hệ thống không tốn token hay thời gian quét các file nhị phân nặng.
  4. **Thực thi Thuần Thuật Toán (0 Runtime AI Tokens)**: Mọi bước từ tách ID YouTube, chuyển đổi chữ có dấu thành `slug`, chia phần `max(2, ceil(Size / 90))`, upload `multipart/form-data` lên CDN đến gửi thông báo Telegram đều chạy bằng mã lệnh hệ thống, không gọi API AI khi vận hành.

---

## 2. User Experience & Visual Design

- **Luồng trải nghiệm người dùng (End-to-End Workflow)**:
  1. **Nhập nguồn âm thanh**: Người dùng dán link YouTube (hoặc chọn file `.mp3`/`.mp4` gốc từ máy), chọn chế độ chia phần (*Tự động theo 90MB/phần* hoặc *Chia cố định 2, 3, 4... phần*), tích chọn *Tải & Render lại từ đầu* nếu muốn bỏ qua bộ nhớ đệm, rồi bấm **Tải & Render**.
  2. **Theo dõi tiến trình 3 giai đoạn thời gian thực**:
     - *Giai đoạn 1 (10% – 48%)*: `yt-dlp` tải luồng âm thanh gốc chất lượng cao nhất (`bestaudio/best`) về thư mục dự án `0000X`.
     - *Giai đoạn 2 (50% – 65%)*: `ffmpeg` chuẩn hóa file gốc thành `goc.mp3` (CBR 128kbps, 44.1kHz, Stereo) và `ffprobe` đo chính xác thời lượng, dung lượng MB thực tế.
     - *Giai đoạn 3 (68% – 100%)*: Tạo `5min.mp3` (5 phút đầu tốc độ `1.25x`) và cắt tuần tự `phan_1.mp3`, `phan_2.mp3`, ... với khoảng gối đầu 3 giây (`start_time = max(0, theoretical_start - 3)`).
  3. **Kiểm tra, Nghe thử & Cắt lại tức thì**:
     - Cột trái hiển thị đầy đủ danh sách: **File Gốc (`goc.mp3`)**, **5 Phút Đầu (`5min.mp3`)**, và **Phần 1..N (`phan_1.mp3` .. `phan_N.mp3`)** kèm trình phát nhạc hỗ trợ tua nhanh và nút tải lẻ từng file.
     - Thanh công cụ **Chia lại từ `goc.mp3`** cho phép đổi số phần muốn cắt (ví dụ từ 2 phần sang 4 phần) và cắt lại ngay lập tức từ file `goc.mp3` sẵn có mà không cần tải lại từ YouTube.
  4. **Biên tập & Xuất bản (2 Bước Tự Động)**:
     - Cột phải tự động điền Tiêu đề, Slug, Tác giả (`Nằm Nghe Audio Full`), Diễn đọc (`Nằm Nghe Audio`), Thể loại (`Truyện Ma`, `Tiên Hiệp`, ...), Tóm tắt và danh sách tập `/uploads/audio/{slug}-phan-{i}.mp3`.
     - Khi bấm **Đăng Truyện Lên Server**:
       - *Bước 1/2*: Tự động đẩy từng file `phan_i.mp3` lên `https://namnghe.com/api/upload-audio` và cập nhật đường dẫn CDN thực tế + thời lượng từng tập.
       - *Bước 2/2*: Gửi bản tin JSON (`action: "create"`) tới `https://namnghe.com/api/gateway`, đồng thời đính kèm file `5min.mp3` và danh sách link tập gửi thẳng vào nhóm/kênh **Telegram Bot**.
- **Nhận diện thị giác & Bố cục (Visual Identity)**:
  - *Phong cách*: Studio xử lý âm thanh chuyên nghiệp trên nền tối (Dark Slate Canvas `#020617` / `#0F172A`), độ tương phản cao, tập trung hoàn toàn vào bảng điều khiển và thông số kỹ thuật.
  - *Bảng màu (60-30-10)*:
    - `60%` Nền chính tối sâu (`bg-slate-950`).
    - `30%` Bề mặt khung làm việc (`bg-slate-900`) với đường viền mảnh `1px` (`border-slate-800`).
    - `10%` Điểm nhấn thao tác chính màu Vàng Hổ Phách (`bg-amber-400` / `text-amber-400`) và Xanh Ngọc Lục Bảo (`bg-emerald-600`) cho nút xuất bản.
  - *Typography*: Kết hợp font chữ hiển thị hiện đại `Plus Jakarta Sans` cho tiêu đề/nhãn điều khiển và `JetBrains Mono` (`tabular-nums`) cho mọi thông số thời gian (`00:00:00`), dung lượng (`MB`), phần trăm tiến độ (`%`) và đường dẫn CDN.

---

## 3. Key Product Decisions & Trade-Offs

- **Quyết định 1: Lưu trữ toàn bộ file gốc `goc.mp3` và chuẩn hóa CBR 128kbps trước khi cắt**
  - *Cách tiếp cận*: Luôn tạo file chuẩn `goc.mp3` kèm Xing header hoàn chỉnh rồi mới cắt các phần con.
  - *Lý do*: Khắc phục triệt để hiện tượng file cắt ra bị lỗi header, không tua được trên trình duyệt, bị lệch số phút hoặc bị thiếu phần cuối khi nguồn YouTube dùng mã hóa Opus/WebM VBR.
- **Quyết định 2: Hỗ trợ song song Web Cloud và Bản Python Local đã vá lỗi**
  - *Cách tiếp cận*: Cung cấp đầy đủ tính năng trên Web (kèm ô nạp `cookies.txt` và tải file từ máy), đồng thời tích hợp cổng xuất file Python độc lập đã sửa lỗi cú pháp dòng 1063 và nâng cấp lên `ThreadingHTTPServer`.
  - *Lý do*: Khi chạy trên mạng gia đình (Local PC), IP dân cư không bao giờ bị YouTube hỏi xác minh Bot, trong khi bản Web cho phép làm việc mọi lúc mọi nơi và quản lý tập trung.

---

## 4. Technical Architecture & Data Strategy

### Sơ đồ Kiến trúc Hệ thống & Cấu trúc Dự án Tối ưu Token

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                   CẤU TRÚC DỰ ÁN TINH GỌN (TIẾT KIỆM TOKEN)                  │
├──────────────────────────────────────────────────────────────────────────────┤
│  [1] TẦNG GIAO DIỆN (Single-Module SPA Frontend)                             │
│      ├── Thanh Điều Hướng 3 Vùng (Xử Lý Audio | Kho Dự Án | Cấu Hình)        │
│      ├── Khối Nhập Nguồn (YouTube URL + Cookies.txt | Upload File Gốc)       │
│      ├── Trạm Theo Dõi Tiến Độ Đa Luồng (Polling 800ms theo job_id)          │
│      ├── Bảng Kết Quả MP3 (goc.mp3 + 5min.mp3 + phan_1..N.mp3 + Cắt Lại)     │
│      └── Trình Biên Tập & Xuất Bản (Upload Audio CDN -> Gateway -> Telegram) │
│                                      │                                       │
│                                      ▼ (REST JSON & Byte-Range Audio Stream) │
│  [2] TẦNG ĐIỀU PHỐI BACKEND (Unified Express + FFmpeg + yt-dlp Engine)       │
│      ├── /api/process          -> Khởi chạy luồng tải & cắt theo job_id      │
│      ├── /api/upload-local     -> Nhận file gốc từ máy & đưa vào luồng cắt   │
│      ├── /api/resplit-project  -> Cắt lại từ goc.mp3 theo số phần tùy chọn   │
│      ├── /api/status           -> Trả trạng thái thời gian thực từng job_id  │
│      ├── /api/upload-to-remote -> Đẩy phan_1..N.mp3 lên namnghe.com CDN      │
│      ├── /api/publish-gateway  -> Đăng JSON lên Gateway & bắn 5min Telegram  │
│      └── /api/download-python-script -> Xuất file 888.py đã vá lỗi hoàn chỉnh│
│                                      │                                       │
│                                      ▼ (Tách biệt khỏi mã nguồn để nhẹ máy)  │
│  [3] TẦNG LƯU TRỮ NGOÀI WORKSPACE (/tmp/namnghe_uploads & /tmp/namnghe_bin)  │
│      ├── projects_db.json      -> Lưu lịch sử dự án & chống trùng video_id   │
│      ├── settings.json         -> Lưu cấu hình Token, Telegram, ngưỡng 90MB  │
│      ├── youtube_cookies.txt   -> Lưu Cookies vượt xác minh Bot YouTube      │
│      └── 00000/, 00001/...     -> Chứa goc.mp3, 5min.mp3, phan_1..N.mp3      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Luồng Dữ liệu & Ánh xạ Trạng thái (Interactive State Mapping)

1. **Kiểm tra & Chống trùng lặp (`checkExistingProject`)**:
   - Khi nhận `url`, hệ thống trích xuất `video_id` (11 ký tự) và đối chiếu trong `projects_db.json`.
   - Chỉ sử dụng lại kết quả bộ nhớ đệm khi thư mục `0000X` thực sự tồn tại đủ `goc.mp3` (> 20KB), `5min.mp3`, và `phan_1.mp3`. Nếu thiếu hoặc người dùng bật *Tải & Render lại từ đầu*, hệ thống tự động tạo tiến trình mới.
2. **Thuật toán Chia Phần & Gối Đầu (`renderMasterAndSplitAllParts`)**:
   - Đọc kích thước thực của `goc.mp3`: $\text{Size}_{\text{MB}} = \frac{\text{bytes}}{1024 \times 1024}$.
   - Tính số phần: $N = \max\left(2, \lceil \text{Size}_{\text{MB}} / 90 \rceil\right)$ (hoặc lấy giá trị $N$ do người dùng chỉ định).
   - Thời lượng mỗi phần: $D_{\text{part}} = \frac{T_{\text{total}}}{N}$, trong đó $T_{\text{total}}$ lấy từ `ffprobe` trên `goc.mp3`.
   - Với mỗi phần $i \in \{1..N\}$:
     - Nếu $i = 1$: $\text{start} = 0$.
     - Nếu $i > 1$: $\text{start} = \max(0, (i - 1) \times D_{\text{part}} - 3)$ (lùi 3 giây gối đầu).
     - Cắt xuất `phan_i.mp3` kèm cờ `-write_xing 1` và kiểm tra lại bằng `ffprobe`.
3. **Đồng bộ Xuất bản & Telegram (`uploadAudioToServer` -> `publishGateway` -> `sendTelegram`)**:
   - Từng tập `phan_i.mp3` được gửi qua `curl` multipart tới `https://namnghe.com/api/upload-audio` kèm `storyTitle`, `chapterTitle`, và `Authorization` header.
   - Sau khi nhận về đường dẫn `mp3_url` từ server, hệ thống đóng gói JSON chuẩn gửi tới `https://namnghe.com/api/gateway`, đồng thời gọi API `https://api.telegram.org/bot<TOKEN>/sendAudio` để gửi file `5min.mp3` kèm bảng thông tin tóm tắt vào Telegram.
