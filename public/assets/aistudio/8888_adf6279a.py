#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
YouTube Audio Splitter & Story Publisher Pro (Multi-thread / Đa Tab Chrome)
Thuật toán chia file: max(2, ceil(Size / 90)) - Chia đều thời lượng
- Chuẩn hóa âm thanh về MP3 128kbps.
- Tạo file 5 phút đầu (1.25x tốc độ).
"""

import os
import sys
import json
import re
import shutil
import threading
import subprocess
import time
import secrets
import math
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse
import urllib.request
import urllib.error

if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

try:
    import yt_dlp
except ImportError:
    print("[LỖI] Chưa cài đặt yt-dlp. Vui lòng chạy lệnh: pip install yt-dlp")
    sys.exit(1)

OUTPUT_DIR = os.path.abspath("./uploads")
os.makedirs(OUTPUT_DIR, exist_ok=True)
DB_FILE = os.path.join(OUTPUT_DIR, "projects_db.json")

DEFAULT_AUTHOR = "Nằm Nghe Audio Full"
DEFAULT_NARRATOR = "Nằm Nghe Audio"
DEFAULT_GATEWAY_URL = "https://namnghe.com/api/gateway"
DEFAULT_UPLOAD_AUDIO_URL = "https://namnghe.com/api/upload-audio"

TELEGRAM_BOT_TOKEN = "8462358537:AAEDXMuykGCiCIkvnUH_733oNbpD0Kr510g"
TELEGRAM_CHAT_ID = "7967303802"

def get_active_telegram_chat_id():
    if TELEGRAM_CHAT_ID:
        return str(TELEGRAM_CHAT_ID).strip()
    try:
        api_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
        req = urllib.request.Request(api_url, headers={'User-Agent': 'curl/8.4.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            results = data.get("result", [])
            for item in reversed(results):
                msg = item.get("message") or item.get("channel_post") or item.get("my_chat_member", {})
                chat = msg.get("chat", {})
                if chat.get("id"):
                    return str(chat.get("id"))
    except Exception:
        pass
    return None

def send_telegram_story_and_5min(story_payload, project_dir, server_msg=""):
    chat_id = get_active_telegram_chat_id()
    if not chat_id:
        return False, "Chưa nhận diện được chat_id từ Telegram Bot API"

    file_5min = os.path.join(project_dir, "5min.mp3") if project_dir else ""
    title = story_payload.get("title", "Truyện Audio")
    author = story_payload.get("author", DEFAULT_AUTHOR)
    narrator = story_payload.get("narrator", DEFAULT_NARRATOR)
    category = story_payload.get("category", "Truyện Ma")
    is_hot = "🔥 Có" if story_payload.get("is_hot") else "Không"
    description = (story_payload.get("description") or "").strip()

    chapters = story_payload.get("chapters", [])
    chap_lines = []
    for ch in chapters:
        c_title = ch.get("title", "")
        c_url = ch.get("mp3_url", "")
        chap_lines.append(f"• {c_title}: https://namnghe.com{c_url}")
    chapters_text = "\n".join(chap_lines)

    short_desc = description[:350] + ("..." if len(description) > 350 else "")
    caption = (
        f"✅ ĐĂNG TRUYỆN MỚI LÊN SERVER\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"📖 Tên truyện: {title}\n"
        f"🏷 Thể loại: {category} | Hot: {is_hot}\n"
        f"✍️ Tác giả: {author}\n"
        f"🎙 Diễn đọc: {narrator}\n"
        f"🔗 Danh sách tập:\n{chapters_text}\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"📝 Tóm tắt: {short_desc}"
    )
    caption = caption[:1020]

    if file_5min and os.path.exists(file_5min):
        api_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendAudio"
        curl_bin = shutil.which("curl.exe") or shutil.which("curl")
        if curl_bin:
            try:
                cmd = [
                    curl_bin, "-s", "-S", "-X", "POST", api_url,
                    "-F", f"chat_id={chat_id}",
                    "-F", f"title={title} (5 phút đầu - 1.25x)",
                    "-F", f"performer={narrator}",
                    "-F", f"caption={caption}",
                    "-F", f"audio=@{file_5min};type=audio/mpeg"
                ]
                proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=180)
                if proc.returncode == 0 and proc.stdout.strip():
                    res_json = json.loads(proc.stdout.strip())
                    if res_json.get("ok"):
                        return True, "Đã gửi thông tin & 5min.mp3 vào Telegram"
                    return False, res_json.get("description", "Lỗi từ Telegram API")
            except Exception:
                pass

        try:
            boundary = '----TelegramBoundary' + secrets.token_hex(12)
            body = bytearray()
            fields = {
                "chat_id": chat_id,
                "title": f"{title} (5 phút đầu - 1.25x)",
                "performer": narrator,
                "caption": caption
            }
            for k, v in fields.items():
                body.extend(f'--{boundary}\r\n'.encode('utf-8'))
                body.extend(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode('utf-8'))
                body.extend(f'{v}\r\n'.encode('utf-8'))

            body.extend(f'--{boundary}\r\n'.encode('utf-8'))
            body.extend(b'Content-Disposition: form-data; name="audio"; filename="5min.mp3"\r\n')
            body.extend(b'Content-Type: audio/mpeg\r\n\r\n')
            with open(file_5min, 'rb') as f:
                body.extend(f.read())
            body.extend(f'\r\n--{boundary}--\r\n'.encode('utf-8'))

            req = urllib.request.Request(
                api_url,
                data=bytes(body),
                headers={
                    'Content-Type': f'multipart/form-data; boundary={boundary}',
                    'Content-Length': str(len(body))
                },
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=180) as resp:
                res_json = json.loads(resp.read().decode('utf-8'))
                if res_json.get("ok"):
                    return True, "Đã gửi thông tin & 5min.mp3 vào Telegram"
        except Exception as e:
            return False, str(e)

    try:
        msg_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload_bytes = json.dumps({"chat_id": chat_id, "text": caption}).encode('utf-8')
        req = urllib.request.Request(msg_url, data=payload_bytes, headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=30) as resp:
            res_json = json.loads(resp.read().decode('utf-8'))
            return bool(res_json.get("ok")), "Đã gửi thông tin vào Telegram"
    except Exception as e:
        return False, str(e)

def slugify(text):
    if not text:
        return "truyen-audio"
    text = text.lower()
    patterns = {
        '[àáạảãâầấậẩẫăằắặẳẵ]': 'a',
        '[èéẹẻẽêềếệểễ]': 'e',
        '[ìíịỉĩ]': 'i',
        '[òóọỏõôồốộổỗơờớợởỡ]': 'o',
        '[ùúụủũưừứựửữ]': 'u',
        '[ỳýỵỷỹ]': 'y',
        '[đ]': 'd'
    }
    for pattern, repl in patterns.items():
        text = re.sub(pattern, repl, text)
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    text = re.sub(r'[\s-]+', '-', text).strip('-')
    return text or "truyen-audio"

def generate_audio_cdn_path(chapter_num, title_slug):
    clean_slug = title_slug if title_slug else "truyen-audio"
    return f"/uploads/audio/{clean_slug}-phan-{chapter_num}.mp3"

db_lock = threading.Lock()

def load_db():
    if not os.path.exists(DB_FILE):
        return {"last_index": -1, "projects": {}}
    try:
        with open(DB_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"last_index": -1, "projects": {}}

def save_db(data):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def extract_youtube_id(url):
    patterns = [
        r'(?:v=|\/)([0-9A-Za-z_-]{11}).*',
        r'(?:youtu\.be\/)([0-9A-Za-z_-]{11})',
        r'(?:embed\/)([0-9A-Za-z_-]{11})',
        r'(?:shorts\/)([0-9A-Za-z_-]{11})'
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

def get_next_folder_name():
    with db_lock:
        db = load_db()
        last_idx = db.get("last_index", -1)
        next_idx = last_idx + 1
        if next_idx > 99999:
            next_idx = 0
        folder_name = f"{next_idx:05d}"
        return next_idx, folder_name

def check_existing_project(video_id):
    with db_lock:
        db = load_db()
        projects = db.get("projects", {})
        if video_id in projects:
            record = projects[video_id]
            folder_path = os.path.join(OUTPUT_DIR, record.get("folder_name", ""))
            if os.path.exists(folder_path):
                return record
    return None

def register_project(video_id, idx, folder_name, video_info, files, publish_draft):
    with db_lock:
        db = load_db()
        db["last_index"] = idx
        db["projects"][video_id] = {
            "index": idx,
            "folder_name": folder_name,
            "video_id": video_id,
            "title": video_info.get("title", ""),
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "video_info": video_info,
            "files": files,
            "publish_draft": publish_draft
        }
        save_db(db)

jobs = {}

def format_time(seconds):
    if not seconds:
        return "00:00"
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"

def run_command(cmd):
    print(f"\n[CHẠY LỆNH FFMPEG] {' '.join(cmd)}")
    start_t = time.time()
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors='ignore')
    elapsed = time.time() - start_t
    print(f"[LỆNH HOÀN TẤT] Mất: {elapsed:.2f} giây | Mã lỗi (0 là OK): {res.returncode}")
    
    if res.stderr:
        print(f"[LOG FFMPEG]:\n{res.stderr.strip()}")
        
    return res.returncode == 0, res.stderr

def cut_mp3(input_path, output_path, start_time, duration=None):
    cmd = [
        'ffmpeg', '-y', '-hide_banner',
        '-ss', str(start_time),
        '-i', input_path
    ]
    if duration is not None:
        cmd.extend(['-t', str(duration)])
    
    cmd.extend(['-vn', '-sn', '-dn', '-c:a', 'copy', output_path])
    
    success, err = run_command(cmd)
    if not success:
        raise Exception(f"Lỗi khi cắt MP3 (Stream Copy): {err[:200]}")

def cut_and_speed_5min(input_path, output_path, speed=1.25, target_duration=300):
    cmd = [
        'ffmpeg', '-y', '-hide_banner',
        '-i', input_path,
        '-filter:a', f'atempo={speed}',
        '-vn', '-sn', '-dn',
        '-c:a', 'libmp3lame',
        '-b:a', '128k', 
        '-t', str(target_duration),
        output_path
    ]
    
    success, err = run_command(cmd)
    if not success:
        raise Exception(f"Lỗi khi tạo 5min.mp3 (tốc độ {speed}x): {err[:200]}")

def run_download_and_cut(url, job_id):
    job = jobs.get(job_id)
    if not job:
        return

    try:
        job["status"] = "fetching"
        job["progress"] = 5
        job["message"] = "Đang lấy siêu dữ liệu và kiểm tra trùng lặp..."
        
        ydl_info_opts = {'quiet': True, 'no_warnings': True, 'noplaylist': True}
        with yt_dlp.YoutubeDL(ydl_info_opts) as ydl:
            meta = ydl.extract_info(url, download=False)
            if 'entries' in meta:
                entries = [e for e in meta['entries'] if e]
                if not entries:
                    raise Exception("Không tìm thấy video hợp lệ trong danh sách phát.")
                meta = entries[0]
            video_id = meta.get('id') or extract_youtube_id(url)
            total_duration = meta.get('duration', 0) or 0
            title = meta.get('title', 'audio').strip()
            thumbnail = meta.get('thumbnail', '')
            uploader = meta.get('uploader', '')
            description = meta.get('description', '')

        video_info = {
            "id": video_id,
            "title": title,
            "duration": total_duration,
            "duration_formatted": format_time(total_duration),
            "thumbnail": thumbnail,
            "uploader": uploader,
            "description": description
        }
        job["video_info"] = video_info

        if video_id:
            existing = check_existing_project(video_id)
            if existing:
                folder_name = existing["folder_name"]
                project_dir = os.path.join(OUTPUT_DIR, folder_name)
                job["project_folder"] = project_dir
                job["relative_folder"] = folder_name
                job["files"] = existing.get("files", [])
                job["publish_draft"] = existing.get("publish_draft")
                job["status"] = "completed"
                job["progress"] = 100
                job["is_cached"] = True
                job["message"] = f"⚡ Dự án đã có sẵn tại folder [{folder_name}]. Đã nạp lại kết quả!"
                return

        next_idx, folder_name = get_next_folder_name()
        project_dir = os.path.join(OUTPUT_DIR, folder_name)
        os.makedirs(project_dir, exist_ok=True)
        job["project_folder"] = project_dir
        job["relative_folder"] = folder_name

        job["status"] = "downloading"
        orig_mp3_path = os.path.join(project_dir, 'goc.mp3')

        def progress_hook(d):
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
                downloaded = d.get('downloaded_bytes') or 0
                if total > 0:
                    pct = int((downloaded / total) * 40)
                    job["progress"] = 10 + pct
                    speed = d.get('speed', 0)
                    speed_str = f"{speed / (1024*1024):.1f} MB/s" if speed else ""
                    real_pct = int((downloaded / total) * 100)
                    job["message"] = f"Bước 1/3: Đang tải dữ liệu gốc từ YouTube ({real_pct}%) - {speed_str}..."
            elif d['status'] == 'finished':
                job["progress"] = 50
                job["message"] = "Tải dữ liệu hoàn tất. Chuẩn bị trích xuất âm thanh..."

        def pp_hook(d):
            if d['status'] == 'started':
                job["progress"] = 55
                job["message"] = "Bước 2/3: Đang trích xuất và chuẩn hóa về MP3 (128kbps)..."
            elif d['status'] == 'finished':
                job["progress"] = 60
                job["message"] = "Trích xuất MP3 thành công. Chuyển sang giai đoạn cắt phân đoạn..."

        class MyYtdlLogger(object):
            def debug(self, msg):
                if not msg.startswith('[download]'):
                    print(f"[YTDL DEBUG] {msg}")
            def warning(self, msg):
                print(f"[YTDL CẢNH BÁO] {msg}")
            def error(self, msg):
                print(f"[YTDL LỖI] {msg}")

        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(project_dir, 'goc.%(ext)s'),
            'noplaylist': True,
            'concurrent_fragment_downloads': 8,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '128',
            }],
            'progress_hooks': [progress_hook],
            'postprocessor_hooks': [pp_hook],
            'quiet': False,
            'no_warnings': False,
            'verbose': True,
            'logger': MyYtdlLogger(),
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            print("\n[BẮT ĐẦU TẢI VÀ POST-PROCESS QUA YT-DLP]")
            ydl.download([url])

        if not os.path.exists(orig_mp3_path):
            candidates = [os.path.join(project_dir, f) for f in os.listdir(project_dir) if f.endswith('.mp3')]
            if candidates:
                orig_mp3_path = candidates[0]
            else:
                raise Exception("Không tìm thấy file MP3 sau khi tải về và chuyển đổi.")

        file_size_mb = os.path.getsize(orig_mp3_path) / (1024 * 1024)
        num_parts = max(2, math.ceil(file_size_mb / 90.0))
        part_duration = (total_duration / num_parts) if total_duration > 0 else 600

        file_5min = os.path.join(project_dir, "5min.mp3")

        job["status"] = "cutting"
        job["progress"] = 65
        job["message"] = f"Bước 3/3: Đang tạo file 5 phút đầu (Tốc độ 1.25x - 128kbps)..."
        
        actual_5min_dur = min(300, total_duration / 1.25) if total_duration > 0 else 300
        cut_and_speed_5min(orig_mp3_path, file_5min, speed=1.25, target_duration=300)

        def create_audio_card(fpath, label, duration_text):
            fname = os.path.basename(fpath)
            size_mb = f"{os.path.getsize(fpath) / (1024*1024):.2f} MB" if os.path.exists(fpath) else "0 MB"
            return {
                "label": label,
                "name": fname,
                "folder": folder_name,
                "duration": duration_text,
                "size_mb": size_mb,
                "stream_url": f"/uploads/{urllib.parse.quote(folder_name)}/{urllib.parse.quote(fname)}"
            }

        result_files = [
            create_audio_card(file_5min, "5 Phút Đầu (1.25x)", f"00:00 - {format_time(actual_5min_dur)}")
        ]
            
        chapters_draft = []
        title_slug = slugify(title)
        
        for i in range(1, num_parts + 1):
            job["progress"] = 65 + int(30 * (i / num_parts))
            
            theoretical_start = (i - 1) * part_duration
            theoretical_end = i * part_duration
            
            if i == 1:
                start_time = 0
            else:
                start_time = max(0, theoretical_start - 3)
            
            if i == num_parts:
                duration = (total_duration - start_time) if total_duration > 0 else None
                end_time_str = format_time(total_duration)
            else:
                duration = theoretical_end - start_time
                end_time_str = format_time(theoretical_end)
                
            job["message"] = f"Đang cắt Phần {i}/{num_parts} -> phan_{i}.mp3 ({format_time(start_time)} đến {end_time_str})...."
            
            part_file = os.path.join(project_dir, f"phan_{i}.mp3")
            cut_mp3(orig_mp3_path, part_file, start_time=start_time, duration=duration)
            
            result_files.append(
                create_audio_card(part_file, f"Phần {i}", f"{format_time(start_time)} - {end_time_str}")
            )
            
            chapters_draft.append({
                "id": i,
                "title": f"Phần {i}",
                "mp3_url": generate_audio_cdn_path(i, title_slug)
            })

        publish_draft = {
            "action": "create",
            "title": title,
            "title_slug": title_slug,
            "author": DEFAULT_AUTHOR,
            "narrator": DEFAULT_NARRATOR,
            "category": "Truyện Ma",
            "description": description.strip() if description else "",
            "is_hot": False,
            "chapters": chapters_draft
        }

        register_project(video_id, next_idx, folder_name, video_info, result_files, publish_draft)

        job["status"] = "completed"
        job["progress"] = 100
        job["message"] = f"Hoàn thành xuất {num_parts + 1} file MP3 (128kbps) vào thư mục uploads/{folder_name}"
        job["files"] = result_files
        job["publish_draft"] = publish_draft

    except Exception as e:
        job["status"] = "error"
        err_str = str(e)
        if "404" in err_str or "not found" in err_str.lower():
            err_str = f"Không tìm thấy video (Lỗi 404). Vui lòng kiểm tra lại link YouTube (video có thể đã bị xóa hoặc để riêng tư). Chi tiết: {err_str}"
        job["error"] = err_str
        job["message"] = f"Lỗi: {err_str}"

HTML_PAGE = r"""<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YouTube MP3 Splitter & Publisher Pro (Đa luồng)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col font-sans selection:bg-amber-500 selection:text-black">

  <header class="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50 shadow-md">
    <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-400 flex items-center justify-center shadow-lg shadow-amber-950/50 text-slate-950 font-bold">
          <i class="fa-solid fa-headphones-simple text-xl"></i>
        </div>
        <div>
          <h1 class="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
            YT Audio Splitter Multi-Thread
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">Đa luồng</span>
          </h1>
          <p class="text-xs text-slate-400">Có thể mở nhiều Tab Chrome xử lý độc lập</p>
        </div>
      </div>
    </div>
  </header>

  <main class="max-w-4xl w-full mx-auto px-4 py-6 sm:py-8 flex-1 flex flex-col gap-6">

    <div class="bg-slate-900 border border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xl">
      <label class="block text-sm font-semibold text-slate-200 mb-2">
        <i class="fa-solid fa-link text-amber-400 mr-1.5"></i> Dán liên kết video / audio YouTube:
      </label>
      <div class="flex flex-col sm:flex-row gap-3">
        <div class="relative flex-1">
          <input 
            type="text" 
            id="urlInput"
            placeholder="https://www.youtube.com/watch?v=..." 
            class="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition font-medium"
          />
        </div>
        <button 
          id="btnSubmit" 
          onclick="startProcess()" 
          class="bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 active:scale-[0.98] text-slate-950 font-bold px-6 py-3 rounded-xl transition duration-200 flex items-center justify-center gap-2 shadow-lg shadow-amber-950/50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <i class="fa-solid fa-scissors"></i>
          <span>Kiểm Tra &amp; Xử Lý</span>
        </button>
      </div>
    </div>

    <div id="statusPanel" class="hidden bg-slate-900 border border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xl transition-all">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <div id="statusSpinner" class="w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin"></div>
          <div>
            <h3 id="statusHeading" class="text-sm font-semibold text-white">Đang xử lý âm thanh...</h3>
            <p id="statusMessage" class="text-xs text-slate-400">Đang khởi tạo...</p>
          </div>
        </div>
        <span id="percentText" class="text-lg font-bold font-mono text-amber-400">0%</span>
      </div>

      <div class="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-800 p-0.5">
        <div id="progressBar" class="bg-gradient-to-r from-amber-500 to-yellow-400 h-full rounded-full transition-all duration-300 w-0"></div>
      </div>

      <div id="cachedNotice" class="hidden mt-4 bg-emerald-950/40 border border-emerald-500/40 rounded-xl p-3 flex items-center gap-3 text-emerald-300 text-xs">
        <i class="fa-solid fa-circle-check text-emerald-400 text-base"></i>
        <span><strong>Dự án đã từng tải:</strong> Đã tìm thấy dữ liệu trong Database. Hệ thống tự động nạp lại kết quả và thư mục lưu trữ.</span>
      </div>

      <div id="videoMetaCard" class="hidden mt-4 bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col sm:flex-row gap-4 items-center">
        <img id="videoThumb" src="" alt="Thumbnail" class="w-full sm:w-36 h-24 object-cover rounded-lg shadow border border-slate-800">
        <div class="flex-1 w-full flex flex-col justify-between">
          <div>
            <h4 id="videoTitle" class="text-sm font-semibold text-slate-100 line-clamp-2"></h4>
            <p id="videoAuthor" class="text-xs text-slate-400 mt-1"></p>
          </div>
          <div class="flex items-center gap-3 mt-2 text-xs">
            <span class="bg-slate-900 text-slate-300 px-2.5 py-1 rounded-md border border-slate-800 flex items-center gap-1.5">
              <i class="fa-solid fa-clock text-amber-400"></i>
              Thời lượng gốc: <strong id="videoDuration" class="text-white"></strong>
            </span>
          </div>
        </div>
      </div>
    </div>

    <div id="resultPanel" class="hidden flex flex-col gap-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90 p-4 rounded-xl border border-slate-800">
        <div>
          <h2 class="text-sm sm:text-base font-bold text-white flex items-center gap-2">
            <i class="fa-solid fa-folder-closed text-amber-400"></i>
            Thư mục dự án: <span id="projectFolderName" class="text-amber-400 font-mono text-base font-bold px-2 py-0.5 bg-amber-500/10 rounded border border-amber-500/20"></span>
          </h2>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="openFolder()" class="bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs px-3.5 py-2 rounded-lg font-medium transition flex items-center gap-2 border border-slate-700 cursor-pointer">
            <i class="fa-solid fa-arrow-up-right-from-square text-amber-400"></i>
            <span>Mở Folder</span>
          </button>
        </div>
      </div>
      <div id="fileList" class="grid grid-cols-1 gap-3"></div>
    </div>

    <div id="publishPanel" class="hidden bg-slate-900 border border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xl transition-all">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 mb-5 gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-emerald-950/40">
            <i class="fa-solid fa-cloud-arrow-up text-lg"></i>
          </div>
          <div>
            <h2 class="text-base font-bold text-white flex items-center gap-2">
              Chỉnh Sửa &amp; Đăng Truyện
            </h2>
          </div>
        </div>
        <div class="flex items-center gap-2 self-start sm:self-auto">
          <label class="text-xs text-slate-300 cursor-pointer flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700">
            <input type="checkbox" id="storyIsHot" class="accent-amber-500 rounded cursor-pointer w-4 h-4">
            <span class="font-medium text-slate-200">🔥 HOT</span>
          </label>
        </div>
      </div>

      <form id="publishForm" onsubmit="event.preventDefault(); submitStory();" class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="md:col-span-2">
            <label class="block text-xs font-semibold text-slate-300 mb-1.5">Tên / Tiêu đề truyện:</label>
            <input type="text" id="storyTitle" oninput="handleTitleChange()" class="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none transition" required />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1.5">Thể loại:</label>
            <select id="storyCategory" class="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none transition">
              <option value="Truyện Ma" selected>Truyện Ma</option>
              <option value="Tiên Hiệp">Tiên Hiệp</option>
              <option value="Kiếm Hiệp">Kiếm Hiệp</option>
              <option value="Ngôn Tình">Ngôn Tình</option>
              <option value="Trinh Thám">Trinh Thám</option>
              <option value="Đời Thực">Đời Thực</option>
              <option value="Cổ Trang">Cổ Trang</option>
              <option value="Truyện Ngắn">Truyện Ngắn</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1.5">Tác giả:</label>
            <input type="text" id="storyAuthor" value="Nằm Nghe Audio Full" class="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none transition" required />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1.5">Diễn đọc / MC:</label>
            <input type="text" id="storyNarrator" value="Nằm Nghe Audio" class="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none transition" required />
          </div>
        </div>

        <div>
          <label class="text-xs font-semibold text-slate-300">Giới thiệu tóm tắt nội dung:</label>
          <textarea id="storyDescription" rows="5" class="w-full mt-1.5 bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl p-3 text-sm text-slate-200 outline-none transition placeholder-slate-600"></textarea>
        </div>

        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-xs font-bold text-slate-200 uppercase flex items-center gap-1.5">Danh sách tập MP3 đăng bài</h3>
            <button type="button" onclick="addChapterRow()" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 transition flex items-center gap-1 cursor-pointer">
              <i class="fa-solid fa-plus text-amber-400"></i> Thêm tập
            </button>
          </div>
          <div id="chaptersContainer" class="space-y-2"></div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/60 border border-slate-800 p-4 rounded-xl">
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1.5">Gateway URL:</label>
            <input type="text" id="gatewayUrl" value="https://namnghe.com/api/gateway" class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs outline-none focus:border-amber-500" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1.5">Token / Authorization (Khắc phục lỗi 401):</label>
            <input type="text" id="authToken" placeholder="Bearer your_token_here hoặc Token API..." class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-amber-300 font-mono text-xs outline-none focus:border-amber-500" />
          </div>
        </div>

        <div class="flex items-center justify-end gap-3 pt-2">
          <button type="submit" id="btnPublishStory" class="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] text-white font-medium px-7 py-3 rounded-xl transition duration-200 flex items-center gap-2 shadow-lg cursor-pointer disabled:opacity-50">
            <i class="fa-solid fa-paper-plane"></i> <span>Đăng Truyện Lên Server</span>
          </button>
        </div>
      </form>
    </div>

    <div id="errorPanel" class="hidden bg-rose-950/40 border border-rose-800/80 p-4 sm:p-5 rounded-2xl flex items-start gap-3">
      <i class="fa-solid fa-triangle-exclamation text-rose-400 text-lg mt-0.5"></i>
      <div class="flex-1">
        <h4 class="text-sm font-semibold text-rose-200">Đã xảy ra lỗi</h4>
        <p id="errorMessage" class="text-xs text-rose-300/90 mt-1 break-words"></p>
      </div>
    </div>
  </main>

  <script>
    let pollInterval = null;
    let chaptersData = [];
    let currentJobId = null;

    async function startProcess() {
      const urlInput = document.getElementById('urlInput');
      const url = urlInput.value.trim();
      if (!url) {
        showCustomError("Vui lòng dán liên kết video / audio YouTube!");
        return;
      }

      document.getElementById('errorPanel').classList.add('hidden');
      document.getElementById('resultPanel').classList.add('hidden');
      document.getElementById('publishPanel').classList.add('hidden');
      document.getElementById('cachedNotice').classList.add('hidden');
      document.getElementById('statusPanel').classList.remove('hidden');
      document.getElementById('btnSubmit').disabled = true;

      try {
        const response = await fetch('/api/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url })
        });
        const data = await response.json();
        
        if (data.status === 'started' && data.job_id) {
          currentJobId = data.job_id;
          startPolling(currentJobId);
        } else {
          showCustomError(data.message || "Không thể khởi động tác vụ.");
        }
      } catch (err) {
        showCustomError("Lỗi kết nối tới máy chủ: " + err.message);
      }
    }

    function startPolling(jobId) {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/status?job_id=' + jobId);
          const data = await res.json();
          
          if (data.status === 'idle' && !data.progress) return; 

          updateUI(data);

          if (data.status === 'completed' || data.status === 'error') {
            clearInterval(pollInterval);
            document.getElementById('btnSubmit').disabled = false;
          }
        } catch (e) {
          console.error("Lỗi cập nhật tiến trình:", e);
        }
      }, 800);
    }

    function updateUI(data) {
      const progressBar = document.getElementById('progressBar');
      const percentText = document.getElementById('percentText');
      const statusMessage = document.getElementById('statusMessage');
      const statusHeading = document.getElementById('statusHeading');
      const statusSpinner = document.getElementById('statusSpinner');
      const cachedNotice = document.getElementById('cachedNotice');

      progressBar.style.width = (data.progress || 0) + '%';
      percentText.innerText = (data.progress || 0) + '%';
      statusMessage.innerText = data.message || '';

      if (data.is_cached) cachedNotice.classList.remove('hidden');
      else cachedNotice.classList.add('hidden');

      if (data.video_info) {
        document.getElementById('videoMetaCard').classList.remove('hidden');
        document.getElementById('videoThumb').src = data.video_info.thumbnail || '';
        document.getElementById('videoTitle').innerText = data.video_info.title || '';
        document.getElementById('videoAuthor').innerText = data.video_info.uploader || '';
        document.getElementById('videoDuration').innerText = data.video_info.duration_formatted || '';
      }

      if (data.status === 'completed') {
        statusHeading.innerText = 'Hoàn tất xử lý!';
        statusSpinner.classList.remove('animate-spin', 'border-t-transparent');
        statusSpinner.classList.add('bg-emerald-500', 'border-emerald-500');
        document.getElementById('projectFolderName').innerText = 'uploads/' + (data.relative_folder || '');
        renderResults(data.files || []);
        if (data.publish_draft) populatePublishForm(data.publish_draft, data.files || []);
      } else if (data.status === 'error') {
        showCustomError(data.error || data.message || 'Có lỗi xảy ra.');
      } else {
        statusHeading.innerText = 'Đang xử lý âm thanh...';
        statusSpinner.classList.add('animate-spin', 'border-t-transparent');
        statusSpinner.classList.remove('bg-emerald-500', 'border-emerald-500');
      }
    }

    function slugifyClient(str) {
      if (!str) return 'truyen-audio';
      str = str.toLowerCase().replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a').replace(/[èéẹẻẽêềếệểễ]/g, 'e').replace(/[ìíịỉĩ]/g, 'i').replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o').replace(/[ùúụủũưừứựửữ]/g, 'u').replace(/[ỳýỵỷỹ]/g, 'y').replace(/[đ]/g, 'd').replace(/[^a-z0-9\s-]/g, '').replace(/[\s-]+/g, '-').replace(/^-+|-+$/g, '');
      return str || 'truyen-audio';
    }

    function populatePublishForm(draft, files) {
      document.getElementById('storyTitle').value = draft.title || '';
      document.getElementById('storyAuthor').value = draft.author || 'Nằm Nghe Audio Full';
      document.getElementById('storyNarrator').value = draft.narrator || 'Nằm Nghe Audio';
      document.getElementById('storyCategory').value = draft.category || 'Truyện Ma';
      document.getElementById('storyDescription').value = draft.description || '';
      document.getElementById('storyIsHot').checked = draft.is_hot || false;

      const titleSlug = slugifyClient(draft.title || 'truyen-audio');
      chaptersData = (draft.chapters || []).map((ch, idx) => {
        const chapNum = idx + 1;
        let clean = (ch.mp3_url || '').trim().replace(/^https?:\/\/[^\/]+/i, '');
        if (!clean) clean = `/uploads/audio/${titleSlug}-phan-${chapNum}.mp3`;
        if (clean && !clean.startsWith('/')) clean = '/' + clean;
        return { id: ch.id || chapNum, title: ch.title || `Phần ${chapNum}`, mp3_url: clean, uploaded: false, upload_status: "Chưa tải" };
      });
      renderChaptersUI();
      document.getElementById('publishPanel').classList.remove('hidden');
    }

    function handleTitleChange() {
      const slug = slugifyClient(document.getElementById('storyTitle').value.trim());
      chaptersData.forEach((ch, idx) => {
        ch.mp3_url = `/uploads/audio/${slug}-phan-${idx + 1}.mp3`;
        ch.uploaded = false;
      });
      renderChaptersUI();
    }

    function renderChaptersUI() {
      const container = document.getElementById('chaptersContainer');
      container.innerHTML = '';
      chaptersData.forEach((ch, idx) => {
        let badgeHtml = `<span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">Sẵn sàng</span>`;
        if (ch.uploaded === true) badgeHtml = `<span class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">Đã lên Server</span>`;
        else if (ch.uploaded === 'uploading') badgeHtml = `<span class="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400">Đang tải...</span>`;
        else if (ch.uploaded === 'error') badgeHtml = `<span class="text-[10px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400">Lỗi tải lên</span>`;
        
        const row = document.createElement('div');
        row.className = "grid grid-cols-12 gap-2 items-center bg-slate-900/90 p-2.5 rounded-lg border border-slate-800";
        row.innerHTML = `
          <div class="col-span-1 text-center font-mono text-xs text-amber-400 font-bold">#${idx + 1}</div>
          <div class="col-span-3">
            <input type="text" value="${(ch.title || '').replace(/"/g, '&quot;')}" oninput="chaptersData[${idx}].title = this.value; chaptersData[${idx}].uploaded = false;" class="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-amber-500 font-medium"/>
          </div>
          <div class="col-span-6">
            <input type="text" value="${(ch.mp3_url || '').replace(/"/g, '&quot;')}" oninput="chaptersData[${idx}].mp3_url = this.value" class="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-amber-300 font-mono outline-none focus:border-amber-500"/>
          </div>
          <div class="col-span-2 flex items-center justify-end gap-1.5">
            ${badgeHtml}
            <button type="button" onclick="removeChapterRow(${idx})" class="text-rose-400 hover:text-rose-300 text-xs px-1.5 py-1 rounded hover:bg-rose-500/10 cursor-pointer"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        `;
        container.appendChild(row);
      });
    }

    function addChapterRow() {
      const nextId = chaptersData.length + 1;
      const slug = slugifyClient(document.getElementById('storyTitle').value.trim());
      chaptersData.push({ id: nextId, title: `Phần ${nextId}`, mp3_url: `/uploads/audio/${slug}-phan-${nextId}.mp3`, uploaded: false });
      renderChaptersUI();
    }

    function removeChapterRow(idx) {
      if (chaptersData.length <= 1) return;
      chaptersData.splice(idx, 1);
      renderChaptersUI();
    }

    async function uploadAudioToServer() {
      chaptersData.forEach(ch => ch.uploaded = 'uploading');
      renderChaptersUI();
      try {
        const titleVal = document.getElementById('storyTitle').value.trim();
        const tokenVal = document.getElementById('authToken').value.trim();
        const res = await fetch('/api/upload-to-remote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: currentJobId,
            storyTitle: titleVal,
            chapters: chaptersData.map(c => c.title),
            auth_token: tokenVal
          })
        });
        const resData = await res.json();
        if (resData.results && Array.isArray(resData.results)) {
          resData.results.forEach((item, idx) => {
            if (chaptersData[idx]) {
              if (item.uploaded && item.mp3_url) {
                chaptersData[idx].mp3_url = item.mp3_url;
                if (item.duration) chaptersData[idx].duration = item.duration;
                chaptersData[idx].uploaded = true;
              } else {
                chaptersData[idx].uploaded = 'error';
              }
            }
          });
          renderChaptersUI();
        }
        if (resData.success) return true;
        showCustomError(resData.message || "Lỗi tải MP3 lên Server.");
        return false;
      } catch (err) {
        chaptersData.forEach(ch => ch.uploaded = 'error');
        renderChaptersUI();
        showCustomError("Lỗi kết nối khi upload MP3: " + err.message);
        return false;
      }
    }

    async function submitStory() {
      const btn = document.getElementById('btnPublishStory');
      document.getElementById('errorPanel').classList.add('hidden');
      btn.disabled = true;

      const needUpload = chaptersData.some(ch => ch.uploaded !== true);
      if (needUpload) {
        btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up animate-bounce"></i> <span>Bước 1/2: Đang tải ${chaptersData.length} file MP3 lên Server...</span>`;
        const uploadOk = await uploadAudioToServer();
        if (!uploadOk) {
          btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <span>Lỗi tải MP3! Thử lại</span>';
          btn.disabled = false;
          return;
        }
      }

      const payload = {
        action: "create",
        title: document.getElementById('storyTitle').value.trim(),
        author: document.getElementById('storyAuthor').value.trim(),
        narrator: document.getElementById('storyNarrator').value.trim(),
        category: document.getElementById('storyCategory').value,
        description: document.getElementById('storyDescription').value.trim(),
        is_hot: document.getElementById('storyIsHot').checked,
        chapters: chaptersData.map((c, i) => {
          let finalUrl = (c.mp3_url || '').trim().replace(/^https?:\/\/[^\/]+/i, '');
          if (finalUrl && !finalUrl.startsWith('/')) finalUrl = '/' + finalUrl;
          const chapObj = { id: i + 1, title: (c.title || `Phần ${i + 1}`).trim(), mp3_url: finalUrl };
          if (c.duration) chapObj.duration = c.duration;
          return chapObj;
        })
      };

      btn.innerHTML = '<i class="fa-solid fa-circle-notch animate-spin"></i> <span>Bước 2/2: Đang đăng truyện...</span>';
      try {
        const res = await fetch('/api/publish-gateway', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: currentJobId,
            gateway_url: document.getElementById('gatewayUrl').value.trim(),
            auth_token: document.getElementById('authToken').value.trim(),
            data: payload
          })
        });

        const resData = await res.json();
        if (resData.success) {
          btn.innerHTML = `<i class="fa-solid fa-circle-check text-lg"></i> <span>${resData.message || 'Thành công!'}</span>`;
          btn.className = "bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-7 py-3 rounded-xl transition flex items-center gap-2 shadow-lg";
          btn.disabled = false;
        } else {
          btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <span>Đăng thất bại!</span>';
          btn.disabled = false;
          showCustomError("Phản hồi từ Server: " + (resData.message || "Lỗi không xác định"));
        }
      } catch (err) {
        btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <span>Lỗi kết nối!</span>';
        btn.disabled = false;
        showCustomError("Lỗi kết nối khi đăng bài: " + err.message);
      }
    }

    async function openFolder() {
      try {
        const res = await fetch('/api/open-folder', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: currentJobId })
        });
        const data = await res.json();
      } catch (e) {
        console.error(e);
      }
    }

    function renderResults(files) {
      const fileList = document.getElementById('fileList');
      fileList.innerHTML = '';
      files.forEach((file, index) => {
        let badgeColor = index === 0 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
        let icon = index === 0 ? "fa-clock" : "fa-" + index;
        const card = document.createElement('div');
        card.className = "bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4";
        card.innerHTML = `
          <div class="flex items-start gap-3 flex-1 min-w-0">
            <div class="w-10 h-10 rounded-lg ${badgeColor} border flex items-center justify-center shrink-0 font-bold text-sm">
              <i class="fa-solid ${icon}"></i>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs px-2 py-0.5 rounded font-medium border ${badgeColor}">${file.label}</span>
                <span class="text-xs text-slate-400 font-mono">${file.duration}</span>
                <span class="text-xs text-slate-500 font-mono">(${file.size_mb})</span>
              </div>
              <p class="text-sm text-amber-300 font-mono font-medium truncate mt-1.5"><i class="fa-solid fa-file-audio mr-1.5 text-amber-400"></i>${file.name}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-center">
            <audio controls preload="none" class="h-8 w-48 sm:w-64 rounded">
              <source src="${file.stream_url}" type="audio/mpeg">
            </audio>
          </div>
        `;
        fileList.appendChild(card);
      });
      document.getElementById('resultPanel').classList.remove('hidden');
    }

    function showCustomError(msg) {
      document.getElementById('errorMessage').innerText = msg;
      document.getElementById('errorPanel').classList.remove('hidden');
      document.getElementById('statusPanel').classList.add('hidden');
def upload_file_multipart(url, filepath, field_name='audio', extra_fields=None, auth_token=None):
    curl_bin = shutil.which("curl.exe") or shutil.which("curl")
    if curl_bin:
        try:
            cmd = [
                curl_bin, "-s", "-S", "-w", "\n%{http_code}",
                "-X", "POST", url, "-F", f"{field_name}=@{filepath};type=audio/mpeg"
            ]
            if auth_token:
                cmd.extend(["-H", f"Authorization: {auth_token}" if not auth_token.lower().startswith("bearer ") else f"Authorization: {auth_token}"])
            if extra_fields:
                for k, v in extra_fields.items():
                    cmd.extend(["-F", f"{k}={v}"])
            proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=300)
            if proc.returncode == 0 and proc.stdout.strip():
                lines = proc.stdout.strip().rsplit("\n", 1)
                raw_body = lines[0].strip() if len(lines) > 1 else proc.stdout.strip()
                http_code = int(lines[1].strip()) if len(lines) > 1 and lines[1].strip().isdigit() else 200
                try:
                    parsed = json.loads(raw_body)
                except Exception:
                    parsed = {"raw": raw_body}
                parsed["_http_code"] = http_code
                return parsed
        except Exception:
            pass

    boundary = '----WebKitFormBoundary' + secrets.token_hex(16)
    body = bytearray()
    if extra_fields:
        for k, v in extra_fields.items():
            body.extend(f'--{boundary}\r\n'.encode('utf-8'))
            body.extend(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode('utf-8'))
            body.extend(f'{v}\r\n'.encode('utf-8'))
    filename = os.path.basename(filepath)
    body.extend(f'--{boundary}\r\n'.encode('utf-8'))
    body.extend(f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode('utf-8'))
    body.extend(b'Content-Type: audio/mpeg\r\n\r\n')
    with open(filepath, 'rb') as f:
        body.extend(f.read())
    body.extend(f'\r\n--{boundary}--\r\n'.encode('utf-8'))
    
    headers = {
        'Content-Type': f'multipart/form-data; boundary={boundary}',
        'Content-Length': str(len(body)),
        'User-Agent': 'curl/8.4.0'
    }
    if auth_token:
        headers['Authorization'] = auth_token

    req = urllib.request.Request(url, data=bytes(body), headers=headers)
    with urllib.request.urlopen(req, timeout=300) as resp:
        resp_data = json.loads(resp.read().decode('utf-8'))
        if isinstance(resp_data, dict):
            resp_data["_http_code"] = resp.getcode()
        return resp_data

def extract_uploaded_url(resp_dict):
    if not isinstance(resp_dict, dict): return None, "Phản hồi không phải định dạng JSON"
    http_code = resp_dict.get("_http_code", 200)
    if http_code >= 400: return None, f"HTTP {http_code}"
    if resp_dict.get("success") is False: return None, "Server từ chối file"
    url_val = (resp_dict.get("url") or resp_dict.get("mp3_url") or resp_dict.get("path") or 
               (resp_dict.get("data", {}) if isinstance(resp_dict.get("data"), dict) else {}).get("url"))
    if not url_val: return None, "Server không trả về đường dẫn"
    url_val = str(url_val).strip()
    url_val = re.sub(r'^https?://[^/]+', '', url_val, flags=re.IGNORECASE)
    if not url_val.startswith("/"): url_val = "/" + url_val
    return url_val, None

class AudioSplitterServer(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path in ['/', '/index.html']:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode('utf-8'))
            return

        elif path == '/api/status':
            qs = urllib.parse.parse_qs(parsed.query)
            job_id = qs.get('job_id', [''])[0]
            job = jobs.get(job_id)
            if not job:
                job = {"status": "idle", "progress": 0}
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(job, ensure_ascii=False).encode('utf-8'))
            return

        elif path.startswith('/uploads/'):
            parts = [urllib.parse.unquote(p) for p in path.strip('/').split('/')[1:]]
            if len(parts) == 2: filepath = os.path.join(OUTPUT_DIR, parts[0], parts[1])
            elif len(parts) == 1: filepath = os.path.join(OUTPUT_DIR, parts[0])
            else:
                self.send_response(404)
                self.end_headers()
                return
            if os.path.exists(filepath):
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(os.path.getsize(filepath)))
                self.end_headers()
                with open(filepath, 'rb') as f: shutil.copyfileobj(f, self.wfile)
                return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/open-folder':
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                body = self.rfile.read(content_length)
                req_data = json.loads(body.decode('utf-8'))
                job_id = req_data.get('job_id')
                folder = jobs.get(job_id, {}).get("project_folder")
            else:
                folder = None

            if folder and os.path.exists(folder):
                if sys.platform == 'win32': os.startfile(folder)
                elif sys.platform == 'darwin': subprocess.Popen(['open', folder])
                else: subprocess.Popen(['xdg-open', folder])
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                return
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "message": "Thư mục không tồn tại"}).encode('utf-8'))
            return

        elif self.path == '/api/process':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))
            url = data.get('url', '').strip()

            if not url:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": "Vui lòng nhập URL hợp lệ"}).encode('utf-8'))
                return

            job_id = f"job_{int(time.time() * 1000)}_{secrets.randbelow(1000)}"
            jobs[job_id] = {
                "status": "idle", "progress": 0, "message": "Sẵn sàng",
                "video_info": None, "project_folder": None, "relative_folder": None,
                "files": [], "error": None, "publish_draft": None, "is_cached": False
            }

            thread = threading.Thread(target=run_download_and_cut, args=(url, job_id))
            thread.daemon = True
            thread.start()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "started", "job_id": job_id}).encode('utf-8'))
            return

        elif self.path == '/api/upload-to-remote':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            req_data = json.loads(body.decode('utf-8')) if body else {}
            
            job_id = req_data.get('job_id')
            story_title = req_data.get('storyTitle', '').strip() or "Truyen Audio"
            custom_chapters = req_data.get('chapters') or ["Phần 1", "Phần 2"]
            auth_token = req_data.get('auth_token', '').strip()
            
            project_dir = jobs.get(job_id, {}).get("project_folder")
            if not project_dir or not os.path.exists(project_dir):
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "message": "Không tìm thấy thư mục dự án"}).encode('utf-8'))
                return

            results, error_messages = [], []
            all_ok = True

            for idx, chap_label in enumerate(custom_chapters, start=1):
                ppath = os.path.join(project_dir, f"phan_{idx}.mp3")
                if not os.path.exists(ppath):
                    all_ok = False
                    err_txt = f"Không tìm thấy file {os.path.basename(ppath)}"
                    error_messages.append(err_txt)
                    results.append({"chapter": idx, "uploaded": False, "error": err_txt})
                    continue

                try:
                    raw_res = upload_file_multipart(
                        DEFAULT_UPLOAD_AUDIO_URL, ppath, field_name='audio',
                        extra_fields={'storyTitle': story_title, 'chapterTitle': chap_label},
                        auth_token=auth_token
                    )
                    verified_url, err_reason = extract_uploaded_url(raw_res)
                    if verified_url:
                        dur_val = ""
                        if isinstance(raw_res, dict):
                            dur_val = raw_res.get("duration") or (raw_res.get("data", {}) if isinstance(raw_res.get("data"), dict) else {}).get("duration") or ""
                        results.append({"chapter": idx, "uploaded": True, "mp3_url": verified_url, "duration": dur_val})
                    else:
                        all_ok = False
                        error_messages.append(f"{chap_label}: {err_reason}")
                        results.append({"chapter": idx, "uploaded": False, "error": err_reason})
                except Exception as e:
                    all_ok = False
                    results.append({"chapter": idx, "uploaded": False, "error": str(e)})

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": all_ok,
                "message": "Upload hoàn tất!" if all_ok else " | ".join(error_messages),
                "results": results
            }, ensure_ascii=False).encode('utf-8'))
            return

        elif self.path == '/api/publish-gateway':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            req_data = json.loads(body.decode('utf-8'))
            job_id = req_data.get('job_id')
            gateway_url = req_data.get('gateway_url') or DEFAULT_GATEWAY_URL
            auth_token = req_data.get('auth_token', '').strip()
            payload_data = req_data.get('data') or {}

            clean_chapters = []
            for idx, ch in enumerate(payload_data.get("chapters", []), start=1):
                mp3_url = str(ch.get("mp3_url", "")).strip()
                mp3_url = re.sub(r'^https?://[^/]+', '', mp3_url, flags=re.IGNORECASE)
                if mp3_url and not mp3_url.startswith("/"): mp3_url = "/" + mp3_url
                chap_item = {"id": int(ch.get("id", idx)), "title": str(ch.get("title", f"Phần {idx}")).strip(), "mp3_url": mp3_url}
                if ch.get("duration"): chap_item["duration"] = str(ch.get("duration"))
                clean_chapters.append(chap_item)

            strict_payload = {
                "action": "create", "title": str(payload_data.get("title", "")).strip(),
                "author": str(payload_data.get("author", DEFAULT_AUTHOR)).strip(),
                "narrator": str(payload_data.get("narrator", DEFAULT_NARRATOR)).strip(),
                "category": str(payload_data.get("category", "Truyện Ma")).strip(),
                "description": str(payload_data.get("description", "")).strip(),
                "is_hot": bool(payload_data.get("is_hot", False)), "chapters": clean_chapters
            }
            json_str = json.dumps(strict_payload, ensure_ascii=False)

            def verify_gateway_response(http_status, resp_json):
                if http_status >= 400: return False, f"HTTP {http_status}"
                if not isinstance(resp_json, dict) or resp_json.get("success") is False: return False, "Gateway từ chối"
                srv_msg = resp_json.get("message") or "Đã đăng truyện thành công!"
                return True, srv_msg

            current_job_dict = jobs.get(job_id, {})
            curl_bin = shutil.which("curl.exe") or shutil.which("curl")
            if curl_bin:
                try:
                    cmd = [curl_bin, "-s", "-S", "-w", "\n%{http_code}", "-X", "POST", gateway_url, "-H", "Content-Type: application/json"]
                    if auth_token:
                        cmd.extend(["-H", f"Authorization: {auth_token}"])
                    cmd.extend(["--data-raw", json_str])

                    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=30)
                    if proc.returncode == 0 and proc.stdout.strip():
                        lines = proc.stdout.strip().rsplit("\n", 1)
                        resp_body = lines[0].strip() if len(lines) > 1 else proc.stdout.strip()
                        http_code = int(lines[1].strip()) if len(lines) > 1 and lines[1].strip().isdigit() else 200
                        try: resp_json = json.loads(resp_body)
                        except: resp_json = {"raw": resp_body}

                        is_biz_success, biz_msg = verify_gateway_response(http_code, resp_json)
                        tg_ok, tg_msg = send_telegram_story_and_5min(strict_payload, current_job_dict.get("project_folder"), biz_msg)
                        if is_biz_success and tg_ok: biz_msg = f"{biz_msg} (Đã gửi Telegram)"

                        self.send_response(200)
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                        self.end_headers()
                        self.wfile.write(json.dumps({"success": is_biz_success, "message": biz_msg}, ensure_ascii=False).encode('utf-8'))
                        return
                except Exception: pass

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "message": "Lỗi Gateway"}, ensure_ascii=False).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

def check_dependencies():
    if not shutil.which('ffmpeg'):
        print("\n[CẢNH BÁO] Chưa tìm thấy 'ffmpeg' trong hệ thống!\n")

if __name__ == '__main__':
    check_dependencies()
    preferred_ports = [8686, 8899, 9090, 9696, 5050]
    httpd, port = None, 8686

    for p in preferred_ports:
        try:
            httpd = HTTPServer(('', p), AudioSplitterServer)
            port = p
            break
        except OSError: continue

    if httpd is None:
        httpd = HTTPServer(('', 0), AudioSplitterServer)
        port = httpd.server_port
        
    print("\n" + "="*60)
    print("  🎧 YOUTUBE MP3 SPLITTER PRO ĐÃ KHỞI CHẠY (MULTI-THREAD)!")
    print(f"  👉 Truy cập: http://localhost:{port}")
    print("="*60 + "\n")
    
    try: httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nĐã dừng server.")
        httpd.server_close()