import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import crypto from 'crypto';
import multer from 'multer';

const PORT = 3000;
const ROOT_DIR = process.cwd();
const OUTPUT_DIR = '/tmp/namnghe_uploads';
const BIN_DIR = '/tmp/namnghe_bin';
const DB_FILE = path.join(OUTPUT_DIR, 'projects_db.json');
const SETTINGS_FILE = path.join(OUTPUT_DIR, 'settings.json');
const COOKIES_FILE = path.join(OUTPUT_DIR, 'youtube_cookies.txt');
const TMP_UPLOAD_DIR = path.join(OUTPUT_DIR, '_tmp');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(BIN_DIR, { recursive: true });
fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });

// Remove legacy heavy folders inside workspace root if present so workspace sync stays fast
try {
  const legacyBin = path.join(ROOT_DIR, 'bin');
  if (fs.existsSync(legacyBin)) fs.rmSync(legacyBin, { recursive: true, force: true });
  const legacyUploads = path.join(ROOT_DIR, 'uploads');
  if (fs.existsSync(legacyUploads)) fs.rmSync(legacyUploads, { recursive: true, force: true });
} catch {}

const DEFAULT_AUTHOR = 'Nằm Nghe Audio Full';
const DEFAULT_NARRATOR = 'Nằm Nghe Audio';
const DEFAULT_GATEWAY_URL = 'https://namnghe.com/api/gateway';
const DEFAULT_UPLOAD_AUDIO_URL = 'https://namnghe.com/api/upload-audio';
const DEFAULT_TELEGRAM_BOT_TOKEN = '8462358537:AAEDXMuykGCiCIkvnUH_733oNbpD0Kr510g';
const DEFAULT_TELEGRAM_CHAT_ID = '7967303802';

export interface AudioFileCard {
  label: string;
  name: string;
  folder: string;
  duration: string;
  size_mb: string;
  stream_url: string;
  download_url: string;
  is_original?: boolean;
}

export interface ChapterDraft {
  id: number;
  title: string;
  mp3_url: string;
  duration?: string;
}

export interface PublishDraft {
  action: string;
  title: string;
  title_slug: string;
  author: string;
  narrator: string;
  category: string;
  description: string;
  is_hot: boolean;
  chapters: ChapterDraft[];
}

export interface VideoInfo {
  id: string;
  title: string;
  duration: number;
  duration_formatted: string;
  thumbnail: string;
  uploader: string;
  description: string;
  url?: string;
  orig_size_mb?: string;
  num_parts?: number;
}

export interface ProjectRecord {
  index: number;
  folder_name: string;
  video_id: string;
  title: string;
  created_at: string;
  video_info: VideoInfo;
  files: AudioFileCard[];
  publish_draft: PublishDraft;
}

export interface JobState {
  job_id: string;
  status: 'idle' | 'fetching' | 'downloading' | 'rendering_master' | 'cutting' | 'completed' | 'error';
  progress: number;
  message: string;
  video_info: VideoInfo | null;
  project_folder: string | null;
  relative_folder: string | null;
  files: AudioFileCard[];
  error: string | null;
  needs_cookies?: boolean;
  publish_draft: PublishDraft | null;
  is_cached: boolean;
  created_at: string;
  logs: string[];
}

interface AppSettings {
  default_author: string;
  default_narrator: string;
  gateway_url: string;
  upload_audio_url: string;
  telegram_bot_token: string;
  telegram_chat_id: string;
  split_chunk_mb: number;
  preview_speed: number;
  preview_duration_sec: number;
  overlap_sec: number;
  proxy_enabled: boolean;
  proxy_type: 'http' | 'socks5';
  proxy_url: string;
  ip_version: 'auto' | 'ipv4' | 'ipv6';
}

function loadSettings(): AppSettings {
  const defaults: AppSettings = {
    default_author: DEFAULT_AUTHOR,
    default_narrator: DEFAULT_NARRATOR,
    gateway_url: DEFAULT_GATEWAY_URL,
    upload_audio_url: DEFAULT_UPLOAD_AUDIO_URL,
    telegram_bot_token: DEFAULT_TELEGRAM_BOT_TOKEN,
    telegram_chat_id: DEFAULT_TELEGRAM_CHAT_ID,
    split_chunk_mb: 90,
    preview_speed: 1.25,
    preview_duration_sec: 300,
    overlap_sec: 3,
    proxy_enabled: false,
    proxy_type: 'socks5',
    proxy_url: '',
    ip_version: 'auto',
  };
  if (!fs.existsSync(SETTINGS_FILE)) return defaults;
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    return { ...defaults, ...raw };
  } catch {
    return defaults;
  }
}

function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const merged = { ...loadSettings(), ...settings };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

function normalizeProxyString(rawInput: string, proxyType: 'http' | 'socks5' = 'socks5'): string | null {
  const raw = (rawInput || '').trim();
  if (!raw) return null;

  let scheme: string = proxyType === 'socks5' ? 'socks5' : 'http';
  let rest = raw;

  const schemeMatch = raw.match(/^(socks5h?|socks4a?|https?):\/\/(.+)$/i);
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase();
    rest = schemeMatch[2].trim();
  }

  // Case 1: user:pass@host:port
  if (rest.includes('@')) {
    const lastAt = rest.lastIndexOf('@');
    const auth = rest.slice(0, lastAt);
    let hostPort = rest.slice(lastAt + 1);
    if (!hostPort.startsWith('[') && (hostPort.match(/:/g) || []).length >= 2) {
      const lastColon = hostPort.lastIndexOf(':');
      hostPort = `[${hostPort.slice(0, lastColon)}]:${hostPort.slice(lastColon + 1)}`;
    }
    return `${scheme}://${auth}@${hostPort}`;
  }

  // Case 2: [ipv6]:port:user:pass
  const ipv6AuthMatch = rest.match(/^\[([^\]]+)\]:(\d+):([^:]+):(.+)$/);
  if (ipv6AuthMatch) {
    const [, ipv6, port, user, pass] = ipv6AuthMatch;
    return `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@[${ipv6}]:${port}`;
  }

  // Case 3: [ipv6]:port
  const ipv6Match = rest.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6Match) {
    return `${scheme}://[${ipv6Match[1]}]:${ipv6Match[2]}`;
  }

  // Case 4: ipv4_or_host:port:user:pass
  const ipv4AuthMatch = rest.match(/^([^:]+):(\d+):([^:]+):(.+)$/);
  if (ipv4AuthMatch) {
    const [, host, port, user, pass] = ipv4AuthMatch;
    return `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
  }

  // Case 5: ipv4_or_host:port
  const ipv4Match = rest.match(/^([^:]+):(\d+)$/);
  if (ipv4Match) {
    return `${scheme}://${ipv4Match[1]}:${ipv4Match[2]}`;
  }

  // Case 6: Unbracketed IPv6 + port (e.g. 2001:db8::1:1080)
  if ((rest.match(/:/g) || []).length >= 2) {
    const lastColon = rest.lastIndexOf(':');
    const maybePort = rest.slice(lastColon + 1);
    if (/^\d+$/.test(maybePort)) {
      return `${scheme}://[${rest.slice(0, lastColon)}]:${maybePort}`;
    }
  }

  return `${scheme}://${rest}`;
}

function buildYtDlpNetworkArgs(settings: AppSettings, hasCookies: boolean): string[] {
  const args: string[] = [];
  if (hasCookies) {
    args.push('--cookies', COOKIES_FILE);
  }
  if (settings.proxy_enabled && settings.proxy_url.trim()) {
    const normalizedProxy = normalizeProxyString(settings.proxy_url, settings.proxy_type);
    if (normalizedProxy) {
      args.push('--proxy', normalizedProxy);
    }
  }
  if (settings.ip_version === 'ipv4') {
    args.push('--force-ipv4');
  } else if (settings.ip_version === 'ipv6') {
    args.push('--force-ipv6');
  }
  return args;
}

interface DatabaseSchema {
  last_index: number;
  projects: Record<string, ProjectRecord>;
}

function loadDb(): DatabaseSchema {
  if (!fs.existsSync(DB_FILE)) {
    return { last_index: -1, projects: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return { last_index: -1, projects: {} };
  }
}

function saveDb(data: DatabaseSchema) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function slugify(text: string): string {
  if (!text) return 'truyen-audio';
  let str = text.toLowerCase();
  const patterns: Record<string, string> = {
    '[àáạảãâầấậẩẫăằắặẳẵ]': 'a',
    '[èéẹẻẽêềếệểễ]': 'e',
    '[ìíịỉĩ]': 'i',
    '[òóọỏõôồốộổỗơờớợởỡ]': 'o',
    '[ùúụủũưừứựửữ]': 'u',
    '[ỳýỵỷỹ]': 'y',
    '[đ]': 'd',
  };
  for (const [pattern, repl] of Object.entries(patterns)) {
    str = str.replace(new RegExp(pattern, 'g'), repl);
  }
  str = str.replace(/[^a-z0-9\s-]/g, '');
  str = str.replace(/[\s-]+/g, '-').replace(/^-+|-+$/g, '');
  return str || 'truyen-audio';
}

function generateAudioCdnPath(chapterNum: number, titleSlug: string): string {
  const cleanSlug = titleSlug || 'truyen-audio';
  return `/uploads/audio/${cleanSlug}-phan-${chapterNum}.mp3`;
}

function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:v=|\/)([0-9A-Za-z_-]{11}).*/,
    /(?:youtu\.be\/)([0-9A-Za-z_-]{11})/,
    /(?:embed\/)([0-9A-Za-z_-]{11})/,
    /(?:shorts\/)([0-9A-Za-z_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '00:00';
  const totalSec = Math.floor(seconds);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function formatNow(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function getNextFolderName(): { nextIdx: number; folderName: string } {
  const db = loadDb();
  let nextIdx = (db.last_index ?? -1) + 1;
  if (nextIdx > 99999) nextIdx = 0;
  const folderName = String(nextIdx).padStart(5, '0');
  db.last_index = nextIdx;
  saveDb(db);
  return { nextIdx, folderName };
}

function checkExistingProject(videoId: string): ProjectRecord | null {
  const db = loadDb();
  const record = db.projects[videoId];
  if (record) {
    const folderPath = path.join(OUTPUT_DIR, record.folder_name || '');
    const origMp3 = path.join(folderPath, 'goc.mp3');
    const file5Min = path.join(folderPath, '5min.mp3');
    const part1 = path.join(folderPath, 'phan_1.mp3');
    if (
      fs.existsSync(folderPath) &&
      fs.existsSync(origMp3) &&
      fs.existsSync(file5Min) &&
      fs.existsSync(part1) &&
      fs.statSync(origMp3).size > 20000 &&
      !(record.video_info as any)?.is_fallback_audio
    ) {
      return record;
    }
  }
  return null;
}

function registerProject(
  videoId: string,
  idx: number,
  folderName: string,
  videoInfo: VideoInfo,
  files: AudioFileCard[],
  publishDraft: PublishDraft
): ProjectRecord {
  const db = loadDb();
  if (idx > db.last_index) db.last_index = idx;
  const record: ProjectRecord = {
    index: idx,
    folder_name: folderName,
    video_id: videoId,
    title: videoInfo.title || '',
    created_at: formatNow(),
    video_info: videoInfo,
    files,
    publish_draft: publishDraft,
  };
  db.projects[videoId] = record;
  saveDb(db);
  return record;
}

const jobs: Record<string, JobState> = {};

function runProcess(
  cmd: string,
  args: string[],
  onLog?: (line: string) => void,
  timeoutMs = 600000
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          proc.kill('SIGKILL');
        } catch {}
        resolve({ ok: false, stdout, stderr: stderr + '\nQuá thời gian xử lý (Timeout).' });
      }
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (onLog) onLog(text);
    });
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onLog) onLog(text);
    });
    proc.on('error', (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve({ ok: false, stdout, stderr: stderr + '\n' + err.message });
      }
    });
    proc.on('close', (code) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, stdout, stderr });
      }
    });
  });
}

async function ensureStandaloneYtDlp(): Promise<string> {
  const localBin = path.join(BIN_DIR, 'yt-dlp');
  try {
    if (fs.existsSync(localBin)) {
      const stat = fs.statSync(localBin);
      // Standalone yt-dlp_linux ELF binary is ~39MB (> 15MB). Python zipapp is ~3MB and fails on Python 3.10.
      if (stat.size > 15 * 1024 * 1024) {
        fs.chmodSync(localBin, 0o755);
        return localBin;
      }
    }
    console.log('[INIT] Đang tải bản yt-dlp_linux độc lập (kèm Python 3.14)...');
    await runProcess(
      'curl',
      [
        '-L',
        '-s',
        '-S',
        '--max-time',
        '120',
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
        '-o',
        localBin,
      ],
      undefined,
      130000
    );
    if (fs.existsSync(localBin)) {
      fs.chmodSync(localBin, 0o755);
    }
  } catch (e) {
    console.error('[INIT] Không thể tải yt-dlp_linux:', e);
  }
  return fs.existsSync(localBin) ? localBin : 'yt-dlp';
}

function cleanInvalidProjectsOnStartup() {
  const db = loadDb();
  let changed = false;
  for (const [vid, proj] of Object.entries(db.projects)) {
    const isDemoOrFallback =
      vid === 'demo_truyen_ma_01' || Boolean((proj.video_info as any)?.is_fallback_audio);
    const folderPath = path.join(OUTPUT_DIR, path.basename(proj.folder_name || ''));
    const origMp3 = path.join(folderPath, 'goc.mp3');
    if (isDemoOrFallback || !fs.existsSync(origMp3) || fs.statSync(origMp3).size < 20000) {
      if (fs.existsSync(folderPath)) {
        try {
          fs.rmSync(folderPath, { recursive: true, force: true });
        } catch {}
      }
      delete db.projects[vid];
      changed = true;
    } else {
      // Ensure goc.mp3 is listed in files array so user can always see/download the original file
      const hasGoc = (proj.files || []).some((f) => f.name === 'goc.mp3');
      if (!hasGoc && fs.existsSync(origMp3)) {
        const gocCard = createAudioCard(
          origMp3,
          proj.folder_name,
          'File Gốc (128kbps)',
          `00:00 - ${proj.video_info?.duration_formatted || '00:00'}`,
          true
        );
        proj.files = [gocCard, ...(proj.files || [])];
        changed = true;
      }
    }
  }
  if (changed) {
    saveDb(db);
  }
}

async function probeAudioDuration(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) return 0;
  try {
    const res = await runProcess(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      undefined,
      30000
    );
    const parsed = parseFloat(res.stdout.trim());
    return isNaN(parsed) || parsed <= 0 ? 0 : parsed;
  } catch {
    return 0;
  }
}

/**
 * Step 2: Render / normalize raw audio into a clean, standard CBR 128kbps MP3 master file (goc.mp3)
 * with proper Xing/LAME headers so cutting and browser playback never have corrupt frames or wrong durations.
 */
async function renderMasterMp3(
  rawInputPath: string,
  masterMp3Path: string,
  expectedDurationSec: number,
  onProgress?: (pct: number) => void
) {
  const tempMaster = path.join(path.dirname(masterMp3Path), '_rendering_goc.mp3');
  const args = [
    '-y',
    '-hide_banner',
    '-i',
    rawInputPath,
    '-vn',
    '-sn',
    '-dn',
    '-map',
    '0:a:0',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-write_xing',
    '1',
    tempMaster,
  ];

  const res = await runProcess(
    'ffmpeg',
    args,
    (line) => {
      if (onProgress && expectedDurationSec > 0) {
        const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const secs = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
          const pct = Math.min(99, Math.floor((secs / expectedDurationSec) * 100));
          onProgress(pct);
        }
      }
    },
    900000
  );

  if (!res.ok || !fs.existsSync(tempMaster) || fs.statSync(tempMaster).size < 10000) {
    throw new Error(`Lỗi khi render file gốc goc.mp3 (128kbps): ${res.stderr.slice(-300)}`);
  }

  if (fs.existsSync(masterMp3Path)) {
    try {
      fs.unlinkSync(masterMp3Path);
    } catch {}
  }
  fs.renameSync(tempMaster, masterMp3Path);

  if (rawInputPath !== masterMp3Path && fs.existsSync(rawInputPath)) {
    try {
      fs.unlinkSync(rawInputPath);
    } catch {}
  }
}

/**
 * Step 3A: Render 5min.mp3 at 1.25x speed (128kbps MP3) from goc.mp3
 */
async function cutAndSpeed5Min(
  masterMp3Path: string,
  outputPath: string,
  speed = 1.25,
  targetDuration = 300
) {
  const args = [
    '-y',
    '-hide_banner',
    '-i',
    masterMp3Path,
    '-filter:a',
    `atempo=${speed}`,
    '-vn',
    '-sn',
    '-dn',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-write_xing',
    '1',
    '-t',
    String(targetDuration),
    outputPath,
  ];
  const res = await runProcess('ffmpeg', args, undefined, 300000);
  if (!res.ok || !fs.existsSync(outputPath) || fs.statSync(outputPath).size < 5000) {
    throw new Error(`Lỗi khi render 5min.mp3 (tốc độ ${speed}x): ${res.stderr.slice(-250)}`);
  }
}

/**
 * Step 3B: Cut each part (phan_1.mp3, phan_2.mp3, ...) from the normalized goc.mp3
 * Places -ss before -i for fast seeking on CBR 128k master and writes valid Xing headers
 * so every part has exact duration metadata and zero corrupt frames.
 */
async function cutMp3Part(
  masterMp3Path: string,
  outputPath: string,
  startTime: number,
  duration: number | null
) {
  const args = ['-y', '-hide_banner', '-ss', startTime.toFixed(2), '-i', masterMp3Path];
  if (duration !== null && duration > 0) {
    args.push('-t', duration.toFixed(2));
  }
  args.push('-vn', '-sn', '-dn', '-c:a', 'copy', '-write_xing', '1', outputPath);

  const res = await runProcess('ffmpeg', args, undefined, 300000);
  if (!res.ok || !fs.existsSync(outputPath) || fs.statSync(outputPath).size < 5000) {
    // Fallback to clean libmp3lame re-encode if stream copy fails
    const reArgs = ['-y', '-hide_banner', '-ss', startTime.toFixed(2), '-i', masterMp3Path];
    if (duration !== null && duration > 0) {
      reArgs.push('-t', duration.toFixed(2));
    }
    reArgs.push(
      '-vn',
      '-sn',
      '-dn',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-write_xing',
      '1',
      outputPath
    );
    const reRes = await runProcess('ffmpeg', reArgs, undefined, 300000);
    if (!reRes.ok || !fs.existsSync(outputPath)) {
      throw new Error(`Lỗi khi cắt phân đoạn ${path.basename(outputPath)}: ${reRes.stderr.slice(-250)}`);
    }
  }
}

function createAudioCard(
  fpath: string,
  folderName: string,
  label: string,
  durationText: string,
  isOriginal = false
): AudioFileCard {
  const fname = path.basename(fpath);
  const sizeBytes = fs.existsSync(fpath) ? fs.statSync(fpath).size : 0;
  const sizeMb = `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
  const encodedFolder = encodeURIComponent(folderName);
  const encodedFile = encodeURIComponent(fname);
  return {
    label,
    name: fname,
    folder: folderName,
    duration: durationText,
    size_mb: sizeMb,
    stream_url: `/uploads/${encodedFolder}/${encodedFile}`,
    download_url: `/uploads/${encodedFolder}/${encodedFile}?download=1`,
    is_original: isOriginal,
  };
}

async function fetchYoutubeMetadataFallback(url: string, videoId: string): Promise<VideoInfo> {
  let title = `Truyện Audio (${videoId})`;
  let uploader = DEFAULT_AUTHOR;
  let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  let description = '';
  let duration = 0;

  // Try Piped API first (returns full exact duration, title, uploader, description)
  try {
    const pipedRes = await runProcess(
      'curl',
      ['-4', '-s', '-S', '--max-time', '8', `https://api.piped.private.coffee/streams/${videoId}`],
      undefined,
      10000
    );
    if (pipedRes.ok && pipedRes.stdout.trim().startsWith('{')) {
      const data = JSON.parse(pipedRes.stdout.trim());
      if (data.title) title = data.title;
      if (data.uploader) uploader = data.uploader;
      if (data.thumbnailUrl) thumbnail = data.thumbnailUrl;
      if (data.description) description = data.description;
      if (data.duration && Number(data.duration) > 0) duration = Number(data.duration);
    }
  } catch {}

  // Also check YouTube oEmbed if title wasn't populated
  if (title.startsWith('Truyện Audio (')) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
      const oeRes = await runProcess('curl', ['-4', '-s', '-S', '--max-time', '6', oembedUrl], undefined, 8000);
      if (oeRes.ok && oeRes.stdout.trim().startsWith('{')) {
        const data = JSON.parse(oeRes.stdout.trim());
        if (data.title) title = data.title;
        if (data.author_name) uploader = data.author_name;
        if (data.thumbnail_url) thumbnail = data.thumbnail_url;
      }
    } catch {}
  }

  return {
    id: videoId,
    title,
    duration,
    duration_formatted: formatTime(duration),
    thumbnail,
    uploader,
    description,
    url,
  };
}

/**
 * Fallback downloader via NoTube remote conversion servers (s56..s64.notube.net) using IPv4 curl
 * when Cloud Run IP is blocked by YouTube bot verification and user hasn't uploaded cookies.txt yet.
 */
async function tryDownloadViaNotube(
  videoId: string,
  destPath: string,
  job: JobState
): Promise<boolean> {
  const cleanYtUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const servers = ['64', '63', '62', '60', '59', '58'];

  for (const srv of servers) {
    try {
      job.message = `Bước 1/3: Đang kết nối máy chủ chuyển đổi dự phòng s${srv} để tải file gốc...`;
      const wRes = await runProcess(
        'curl',
        [
          '-4',
          '-s',
          '-S',
          '--max-time',
          '15',
          '-X',
          'POST',
          `https://s${srv}.notube.net/recover_weight.php`,
          '-d',
          new URLSearchParams({
            url: cleanYtUrl,
            format: 'mp3',
            lang: 'en',
            subscribed: 'true',
          }).toString(),
        ],
        undefined,
        18000
      );

      if (!wRes.ok || !wRes.stdout.trim().startsWith('{')) continue;
      const wJson = JSON.parse(wRes.stdout.trim());
      if (!wJson.token) continue;

      job.progress = 22;
      job.message = `Bước 1/3: Máy chủ s${srv} đang trích xuất luồng âm thanh gốc từ YouTube...`;

      const fRes = await runProcess(
        'curl',
        [
          '-4',
          '-s',
          '-S',
          '--max-time',
          '120',
          '-X',
          'POST',
          `https://s${srv}.notube.net/recover_file.php`,
          '-d',
          new URLSearchParams({
            url: cleanYtUrl,
            format: 'mp3',
            name_mp4: wJson.name_mp4 || '',
            lang: 'en',
            token: wJson.token,
            subscribed: 'true',
            playlist: 'false',
            adblock: 'false',
          }).toString(),
        ],
        undefined,
        130000
      );

      let token = wJson.token;
      if (fRes.stdout.trim().startsWith('{')) {
        try {
          const fJson = JSON.parse(fRes.stdout.trim());
          if (fJson.token) token = fJson.token;
          if (fJson.retour && fJson.retour !== 'OK') continue;
        } catch {}
      }

      job.progress = 35;
      job.message = `Bước 1/3: Đang kết xuất file MP3 gốc trên máy chủ s${srv}...`;

      await runProcess(
        'curl',
        [
          '-4',
          '-s',
          '-S',
          '--max-time',
          '120',
          '-X',
          'POST',
          `https://s${srv}.notube.net/conversion.php`,
          '-d',
          new URLSearchParams({ token }).toString(),
        ],
        undefined,
        130000
      );

      // Fetch download page to get exact download link
      const pageRes = await runProcess(
        'curl',
        ['-4', '-L', '-s', '-S', '--max-time', '15', `https://notube.net/en/download?token=${encodeURIComponent(token)}`],
        undefined,
        18000
      );
      const match = pageRes.stdout.match(/https:\/\/s\d+\.notube\.net\/download\.php\?token=[^"'\s>]+/);
      const dlUrl = match ? match[0] : `https://s${srv}.notube.net/download.php?token=${token}&key=`;

      job.progress = 42;
      job.message = `Bước 1/3: Đang tải file âm thanh gốc về thư mục dự án...`;

      const dlRes = await runProcess(
        'curl',
        [
          '-4',
          '-L',
          '-s',
          '-S',
          '--max-time',
          '300',
          '-H',
          'Referer: https://notube.net/',
          '-A',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          dlUrl,
          '-o',
          destPath,
        ],
        undefined,
        310000
      );

      if (dlRes.ok && fs.existsSync(destPath) && fs.statSync(destPath).size > 50000) {
        // Check that downloaded file is actual audio and not an HTML error page
        const dur = await probeAudioDuration(destPath);
        if (dur > 5) {
          return true;
        }
      }
      if (fs.existsSync(destPath)) {
        try {
          fs.unlinkSync(destPath);
        } catch {}
      }
    } catch {
      // try next server
    }
  }
  return false;
}

/**
 * Master rendering & splitting pipeline:
 * 1. Verifies/renders goc.mp3 (128kbps CBR with valid headers)
 * 2. Probes exact duration and file size of goc.mp3
 * 3. Renders 5min.mp3 (1.25x speed)
 * 4. Cuts all parts phan_1.mp3 .. phan_N.mp3 according to max(2, ceil(Size / chunkMb)) or customParts
 */
async function renderMasterAndSplitAllParts(
  job: JobState,
  rawDownloadedPath: string,
  projectDir: string,
  folderName: string,
  nextIdx: number,
  videoInfo: VideoInfo,
  customPartsCount?: number
) {
  const settings = loadSettings();
  const origMp3Path = path.join(projectDir, 'goc.mp3');

  // Step 2/3: Render & normalize raw audio file into goc.mp3 (128kbps)
  job.status = 'rendering_master';
  job.progress = 50;
  job.message = 'Bước 2/3: Đang render chuẩn hóa file gốc goc.mp3 (MP3 128kbps, 44.1kHz)...';

  await renderMasterMp3(rawDownloadedPath, origMp3Path, videoInfo.duration || 0, (pct) => {
    job.progress = 50 + Math.floor(pct * 0.15);
    job.message = `Bước 2/3: Đang render chuẩn hóa file gốc goc.mp3 (${pct}%)...`;
  });

  // Probe the exact real duration and size of goc.mp3!
  const probedDuration = await probeAudioDuration(origMp3Path);
  if (probedDuration <= 0) {
    throw new Error('File gốc goc.mp3 sau khi tải bị lỗi hoặc không có luồng âm thanh hợp lệ.');
  }

  const totalDuration = probedDuration;
  videoInfo.duration = Math.round(totalDuration);
  videoInfo.duration_formatted = formatTime(totalDuration);

  const stats = fs.statSync(origMp3Path);
  const fileSizeMb = stats.size / (1024 * 1024);
  videoInfo.orig_size_mb = `${fileSizeMb.toFixed(2)} MB`;

  const chunkMb = Math.max(5, settings.split_chunk_mb || 90);
  const numParts =
    customPartsCount && customPartsCount >= 1
      ? customPartsCount
      : Math.max(2, Math.ceil(fileSizeMb / chunkMb));
  videoInfo.num_parts = numParts;

  const partDuration = totalDuration / numParts;
  const file5Min = path.join(projectDir, '5min.mp3');

  // Step 3/3: Render 5min.mp3 (1.25x)
  job.status = 'cutting';
  job.progress = 68;
  const speed = settings.preview_speed || 1.25;
  const previewDur = settings.preview_duration_sec || 300;
  job.message = `Bước 3/3: Đang render file nghe thử 5min.mp3 (Tốc độ ${speed}x - 128kbps)...`;

  const actual5MinDur = Math.min(previewDur, totalDuration / speed);
  await cutAndSpeed5Min(origMp3Path, file5Min, speed, previewDur);

  const probed5Min = await probeAudioDuration(file5Min);
  const final5MinDur = probed5Min > 0 ? probed5Min : actual5MinDur;

  const resultFiles: AudioFileCard[] = [
    createAudioCard(
      origMp3Path,
      folderName,
      'File Gốc (128kbps)',
      `00:00 - ${formatTime(totalDuration)}`,
      true
    ),
    createAudioCard(
      file5Min,
      folderName,
      `5 Phút Đầu (${speed}x)`,
      `00:00 - ${formatTime(final5MinDur)}`
    ),
  ];

  const chaptersDraft: ChapterDraft[] = [];
  const titleSlug = slugify(videoInfo.title);
  const overlapSec = settings.overlap_sec ?? 3;

  // Render each split part phan_1.mp3 .. phan_N.mp3 from goc.mp3
  for (let i = 1; i <= numParts; i++) {
    job.progress = 72 + Math.floor(26 * (i / numParts));
    const theoreticalStart = (i - 1) * partDuration;
    const theoreticalEnd = i * partDuration;

    const startTime = i === 1 ? 0 : Math.max(0, theoreticalStart - overlapSec);
    let duration: number | null;
    let endTimeStr: string;

    if (i === numParts) {
      duration = totalDuration - startTime;
      endTimeStr = formatTime(totalDuration);
    } else {
      duration = theoreticalEnd - startTime;
      endTimeStr = formatTime(theoreticalEnd);
    }

    job.message = `Bước 3/3: Đang cắt Phần ${i}/${numParts} -> phan_${i}.mp3 (${formatTime(startTime)} đến ${endTimeStr})...`;
    const partFile = path.join(projectDir, `phan_${i}.mp3`);
    await cutMp3Part(origMp3Path, partFile, startTime, duration);

    const probedPartDur = await probeAudioDuration(partFile);
    const actualEnd = i === numParts ? totalDuration : startTime + (probedPartDur || duration || 0);

    resultFiles.push(
      createAudioCard(
        partFile,
        folderName,
        `Phần ${i}/${numParts}`,
        `${formatTime(startTime)} - ${formatTime(Math.min(totalDuration, actualEnd))}`
      )
    );

    chaptersDraft.push({
      id: i,
      title: `Phần ${i}`,
      mp3_url: generateAudioCdnPath(i, titleSlug),
      duration: formatTime(probedPartDur || duration || 0),
    });
  }

  const publishDraft: PublishDraft = {
    action: 'create',
    title: videoInfo.title,
    title_slug: titleSlug,
    author: settings.default_author || DEFAULT_AUTHOR,
    narrator: settings.default_narrator || DEFAULT_NARRATOR,
    category: 'Truyện Ma',
    description: (videoInfo.description || '').trim(),
    is_hot: false,
    chapters: chaptersDraft,
  };

  registerProject(videoInfo.id, nextIdx, folderName, videoInfo, resultFiles, publishDraft);

  job.status = 'completed';
  job.progress = 100;
  job.message = `Hoàn tất! Đã tải file gốc goc.mp3 (${videoInfo.orig_size_mb}, ${videoInfo.duration_formatted}), tạo 5min.mp3 và cắt đủ ${numParts} phần vào uploads/${folderName}`;
  job.files = resultFiles;
  job.publish_draft = publishDraft;
}

async function runDownloadAndCut(
  url: string,
  jobId: string,
  forceReprocess = false,
  customPartsCount?: number
) {
  const job = jobs[jobId];
  if (!job) return;

  try {
    job.status = 'fetching';
    job.progress = 4;
    job.message = 'Đang lấy thông tin video gốc từ YouTube và kiểm tra dữ liệu...';

    const ytdlpBin = await ensureStandaloneYtDlp();
    const extractedId = extractYoutubeId(url);
    if (!extractedId) {
      throw new Error('Liên kết YouTube không hợp lệ. Vui lòng dán link dạng https://www.youtube.com/watch?v=... hoặc https://youtu.be/...');
    }
    const cleanWatchUrl = `https://www.youtube.com/watch?v=${extractedId}`;
    const hasCookies = fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 20;

    // Check existing valid project first if not forcing reprocess
    if (!forceReprocess && !customPartsCount) {
      const existing = checkExistingProject(extractedId);
      if (existing) {
        const folderName = existing.folder_name;
        const projectDir = path.join(OUTPUT_DIR, folderName);
        job.video_info = existing.video_info;
        job.project_folder = projectDir;
        job.relative_folder = folderName;
        job.files = existing.files || [];
        job.publish_draft = existing.publish_draft;
        job.status = 'completed';
        job.progress = 100;
        job.is_cached = true;
        job.message = `Dự án đã có sẵn file gốc và các phần cắt tại folder [${folderName}]. Đã nạp lại kết quả!`;
        return;
      }
    }

    const settings = loadSettings();
    const netArgs = buildYtDlpNetworkArgs(settings, hasCookies);

    let videoInfo: VideoInfo | null = null;
    const metaArgs = [
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--js-runtimes',
      'node',
      ...netArgs,
      cleanWatchUrl,
    ];

    const metaRes = await runProcess(ytdlpBin, metaArgs, undefined, 45000);
    if (metaRes.ok && metaRes.stdout.trim().startsWith('{')) {
      try {
        let meta = JSON.parse(metaRes.stdout.trim());
        if (meta.entries && Array.isArray(meta.entries)) {
          const validEntries = meta.entries.filter(Boolean);
          if (validEntries.length > 0) meta = validEntries[0];
        }
        const vid = meta.id || extractedId;
        const dur = Number(meta.duration || 0);
        videoInfo = {
          id: vid,
          title: (meta.title || 'Truyện Audio').trim(),
          duration: dur,
          duration_formatted: formatTime(dur),
          thumbnail: meta.thumbnail || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
          uploader: meta.uploader || DEFAULT_AUTHOR,
          description: meta.description || '',
          url: cleanWatchUrl,
        };
      } catch {
        videoInfo = null;
      }
    }

    if (!videoInfo) {
      videoInfo = await fetchYoutubeMetadataFallback(cleanWatchUrl, extractedId);
    }
    job.video_info = videoInfo;

    const { nextIdx, folderName } = getNextFolderName();
    const projectDir = path.join(OUTPUT_DIR, folderName);
    fs.mkdirSync(projectDir, { recursive: true });
    job.project_folder = projectDir;
    job.relative_folder = folderName;

    job.status = 'downloading';
    job.progress = 10;
    job.message = 'Bước 1/3: Đang tải file âm thanh gốc từ YouTube về máy chủ...';

    const outTmpl = path.join(projectDir, 'goc_raw.%(ext)s');
    const dlArgs = [
      '-f',
      'bestaudio/best',
      '-o',
      outTmpl,
      '--no-playlist',
      '--concurrent-fragments',
      '8',
      '--newline',
      '--js-runtimes',
      'node',
      ...netArgs,
      cleanWatchUrl,
    ];

    const dlRes = await runProcess(
      ytdlpBin,
      dlArgs,
      (line) => {
        const pctMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (pctMatch) {
          const rawPct = parseFloat(pctMatch[1]);
          job.progress = 10 + Math.floor((rawPct / 100) * 38);
          const speedMatch = line.match(/at\s+([0-9.]+[A-Za-z/]+)/);
          const speedStr = speedMatch ? ` (${speedMatch[1]})` : '';
          job.message = `Bước 1/3: Đang tải file gốc từ YouTube: ${Math.floor(rawPct)}%${speedStr}...`;
        }
      },
      600000
    );

    let downloadedRawFile: string | null = null;
    const filesInDir = fs.readdirSync(projectDir).filter((f) => f.startsWith('goc_raw.'));
    if (filesInDir.length > 0) {
      const candidate = path.join(projectDir, filesInDir[0]);
      if (fs.statSync(candidate).size > 20000) {
        downloadedRawFile = candidate;
      }
    }

    // If direct yt-dlp was blocked by YouTube bot verification on Cloud Run IP, try NoTube remote extractor
    if (!downloadedRawFile) {
      const fallbackRaw = path.join(projectDir, 'goc_raw.mp3');
      const notubeOk = await tryDownloadViaNotube(extractedId, fallbackRaw, job);
      if (notubeOk && fs.existsSync(fallbackRaw)) {
        downloadedRawFile = fallbackRaw;
      }
    }

    if (!downloadedRawFile) {
      // Clean up empty folder so we don't leave broken projects
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch {}
      job.needs_cookies = true;
      const isBotBlock =
        dlRes.stderr.includes('Sign in to confirm') || dlRes.stderr.includes('LOGIN_REQUIRED');
      throw new Error(
        isBotBlock
          ? 'YouTube đang yêu cầu xác thực chống Bot đối với địa chỉ IP máy chủ Cloud Run cho video này. Để tải trực tiếp file gốc 100% không giới hạn độ dài, vui lòng bấm "Cấu hình Cookies YouTube (cookies.txt)" ngay bên dưới hoặc chọn tab "Tải File MP3 / Video Từ Máy" để tải file gốc lên cắt!'
          : `Không thể tải file âm thanh gốc từ YouTube: ${dlRes.stderr.slice(-250)}`
      );
    }

    await renderMasterAndSplitAllParts(
      job,
      downloadedRawFile,
      projectDir,
      folderName,
      nextIdx,
      videoInfo,
      customPartsCount
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    job.status = 'error';
    job.error = errMsg;
    job.message = `Lỗi: ${errMsg}`;
  }
}

async function runLocalFileSplit(
  uploadedFilePath: string,
  originalName: string,
  customTitle: string,
  jobId: string,
  customPartsCount?: number
) {
  const job = jobs[jobId];
  if (!job) return;

  try {
    job.status = 'fetching';
    job.progress = 10;
    job.message = 'Bước 1/3: Đang kiểm tra file âm thanh/video gốc vừa tải lên...';

    const cleanTitle = (customTitle || originalName.replace(/\.[^/.]+$/, '') || 'Truyện Audio').trim();
    const fileHash = crypto
      .createHash('md5')
      .update(cleanTitle + '_' + fs.statSync(uploadedFilePath).size)
      .digest('hex')
      .slice(0, 11);

    const { nextIdx, folderName } = getNextFolderName();
    const projectDir = path.join(OUTPUT_DIR, folderName);
    fs.mkdirSync(projectDir, { recursive: true });
    job.project_folder = projectDir;
    job.relative_folder = folderName;

    const initialDuration = await probeAudioDuration(uploadedFilePath);
    if (initialDuration <= 0) {
      try {
        fs.unlinkSync(uploadedFilePath);
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch {}
      throw new Error('File tải lên không chứa luồng âm thanh hợp lệ hoặc bị hỏng.');
    }

    const videoInfo: VideoInfo = {
      id: `local_${fileHash}`,
      title: cleanTitle,
      duration: Math.round(initialDuration),
      duration_formatted: formatTime(initialDuration),
      thumbnail: '',
      uploader: loadSettings().default_author || DEFAULT_AUTHOR,
      description: `File âm thanh gốc: ${originalName}\nĐã render chuẩn hóa sang MP3 128kbps và cắt phân đoạn tự động.`,
    };
    job.video_info = videoInfo;

    await renderMasterAndSplitAllParts(
      job,
      uploadedFilePath,
      projectDir,
      folderName,
      nextIdx,
      videoInfo,
      customPartsCount
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    job.status = 'error';
    job.error = errMsg;
    job.message = `Lỗi: ${errMsg}`;
  }
}

async function getActiveTelegramChatId(botToken: string, configuredChatId: string): Promise<string | null> {
  if (configuredChatId && configuredChatId.trim()) {
    return configuredChatId.trim();
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, {
      headers: { 'User-Agent': 'curl/8.4.0' },
    });
    const data = (await resp.json()) as { result?: Array<Record<string, any>> };
    const results = data.result || [];
    for (let i = results.length - 1; i >= 0; i--) {
      const item = results[i];
      const msg = item.message || item.channel_post || item.my_chat_member || {};
      const chat = msg.chat || {};
      if (chat.id) return String(chat.id);
    }
  } catch {}
  return null;
}

async function sendTelegramStoryAnd5Min(
  storyPayload: Record<string, any>,
  projectDir: string | null
): Promise<{ ok: boolean; message: string }> {
  const settings = loadSettings();
  const botToken = settings.telegram_bot_token || DEFAULT_TELEGRAM_BOT_TOKEN;
  const chatId = await getActiveTelegramChatId(botToken, settings.telegram_chat_id);
  if (!chatId) {
    return { ok: false, message: 'Chưa nhận diện được chat_id từ Telegram Bot API' };
  }

  const file5Min = projectDir ? path.join(projectDir, '5min.mp3') : '';
  const title = storyPayload.title || 'Truyện Audio';
  const author = storyPayload.author || DEFAULT_AUTHOR;
  const narrator = storyPayload.narrator || DEFAULT_NARRATOR;
  const category = storyPayload.category || 'Truyện Ma';
  const isHot = storyPayload.is_hot ? '🔥 Có' : 'Không';
  const description = String(storyPayload.description || '').trim();

  const chapters: Array<{ title?: string; mp3_url?: string }> = storyPayload.chapters || [];
  const chapLines = chapters.map((ch) => `• ${ch.title || ''}: https://namnghe.com${ch.mp3_url || ''}`);
  const chaptersText = chapLines.join('\n');

  const shortDesc = description.slice(0, 350) + (description.length > 350 ? '...' : '');
  const caption = (
    `✅ ĐĂNG TRUYỆN MỚI LÊN SERVER\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📖 Tên truyện: ${title}\n` +
    `🏷 Thể loại: ${category} | Hot: ${isHot}\n` +
    `✍️ Tác giả: ${author}\n` +
    `🎙 Diễn đọc: ${narrator}\n` +
    `🔗 Danh sách tập:\n${chaptersText}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📝 Tóm tắt: ${shortDesc}`
  ).slice(0, 1020);

  if (file5Min && fs.existsSync(file5Min)) {
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendAudio`;
    const res = await runProcess(
      'curl',
      [
        '-s',
        '-S',
        '--max-time',
        '180',
        '-X',
        'POST',
        apiUrl,
        '-F',
        `chat_id=${chatId}`,
        '-F',
        `title=${title} (5 phút đầu - 1.25x)`,
        '-F',
        `performer=${narrator}`,
        '-F',
        `caption=${caption}`,
        '-F',
        `audio=@${file5Min};type=audio/mpeg`,
      ],
      undefined,
      190000
    );
    if (res.ok && res.stdout.trim()) {
      try {
        const resJson = JSON.parse(res.stdout.trim());
        if (resJson.ok) {
          return { ok: true, message: 'Đã gửi thông tin & 5min.mp3 vào Telegram' };
        }
        return { ok: false, message: resJson.description || 'Lỗi từ Telegram API' };
      } catch {}
    }
  }

  try {
    const msgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const resp = await fetch(msgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: caption }),
    });
    const resJson = (await resp.json()) as { ok?: boolean; description?: string };
    if (resJson.ok) {
      return { ok: true, message: 'Đã gửi thông tin vào Telegram' };
    }
    return { ok: false, message: resJson.description || 'Lỗi Telegram API' };
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

async function uploadFileMultipart(
  url: string,
  filepath: string,
  fieldName = 'audio',
  extraFields: Record<string, string> = {},
  authToken = ''
): Promise<Record<string, any>> {
  const args = [
    '-s',
    '-S',
    '--max-time',
    '300',
    '-w',
    '\n%{http_code}',
    '-X',
    'POST',
    url,
    '-F',
    `${fieldName}=@${filepath};type=audio/mpeg`,
  ];
  if (authToken) {
    args.push('-H', `Authorization: ${authToken}`);
  }
  for (const [k, v] of Object.entries(extraFields)) {
    args.push('-F', `${k}=${v}`);
  }
  const res = await runProcess('curl', args, undefined, 310000);
  if (res.ok && res.stdout.trim()) {
    const lines = res.stdout.trim().split('\n');
    const lastLine = lines[lines.length - 1]?.trim() || '200';
    const rawBody = lines.length > 1 ? lines.slice(0, -1).join('\n').trim() : res.stdout.trim();
    const httpCode = /^\d+$/.test(lastLine) ? parseInt(lastLine, 10) : 200;
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = { raw: rawBody };
    }
    parsed._http_code = httpCode;
    return parsed;
  }
  throw new Error(res.stderr || 'Không thể kết nối tới máy chủ Upload Audio.');
}

function extractUploadedUrl(respDict: Record<string, any>): { urlVal: string | null; errReason: string | null } {
  if (!respDict || typeof respDict !== 'object') {
    return { urlVal: null, errReason: 'Phản hồi không phải định dạng JSON' };
  }
  const httpCode = respDict._http_code || 200;
  if (httpCode >= 400) {
    return {
      urlVal: null,
      errReason: `HTTP ${httpCode} (${respDict.message || 'Lỗi xác thực hoặc máy chủ từ chối'})`,
    };
  }
  if (respDict.success === false) {
    return { urlVal: null, errReason: respDict.message || 'Server từ chối file' };
  }
  const dataObj = respDict.data && typeof respDict.data === 'object' ? respDict.data : {};
  let urlVal = respDict.url || respDict.mp3_url || respDict.path || dataObj.url || dataObj.mp3_url;
  if (!urlVal) {
    return { urlVal: null, errReason: 'Server không trả về đường dẫn' };
  }
  urlVal = String(urlVal).trim().replace(/^https?:\/\/[^/]+/i, '');
  if (!urlVal.startsWith('/')) urlVal = '/' + urlVal;
  return { urlVal, errReason: null };
}

const uploadMiddleware = multer({
  dest: TMP_UPLOAD_DIR,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB max local audio/video upload
});

async function startServer() {
  cleanInvalidProjectsOnStartup();
  ensureStandaloneYtDlp().catch(() => {});

  const app = express();
  app.use(express.json({ limit: '20mb' }));

  // Serve generated MP3 files from /uploads/:folder/:file with full byte-range streaming support
  app.get('/uploads/:folder/:file', (req, res) => {
    const folder = path.basename(req.params.folder);
    const file = path.basename(req.params.file);
    const filepath = path.join(OUTPUT_DIR, folder, file);
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: 'Không tìm thấy file âm thanh' });
      return;
    }
    const stat = fs.statSync(filepath);
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', String(chunksize));
      fs.createReadStream(filepath, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', String(stat.size));
      fs.createReadStream(filepath).pipe(res);
    }
  });

  // Start processing a YouTube URL
  app.post('/api/process', (req, res) => {
    const url = String(req.body?.url || '').trim();
    const forceReprocess = Boolean(req.body?.force_reprocess);
    const customParts = req.body?.custom_parts ? Number(req.body.custom_parts) : undefined;
    if (!url) {
      res.status(400).json({ status: 'error', message: 'Vui lòng nhập URL YouTube hợp lệ' });
      return;
    }

    const jobId = `job_${Date.now()}_${crypto.randomInt(100, 999)}`;
    jobs[jobId] = {
      job_id: jobId,
      status: 'fetching',
      progress: 2,
      message: 'Đang khởi tạo tiến trình tải file gốc...',
      video_info: null,
      project_folder: null,
      relative_folder: null,
      files: [],
      error: null,
      publish_draft: null,
      is_cached: false,
      created_at: formatNow(),
      logs: [],
    };

    runDownloadAndCut(url, jobId, forceReprocess, customParts);
    res.json({ status: 'started', job_id: jobId });
  });

  // Upload a local MP3/Audio/Video file to render goc.mp3 -> 5min.mp3 -> phan_1..N.mp3
  app.post('/api/upload-local', uploadMiddleware.single('file'), (req, res) => {
    const file = req.file;
    if (!file) {
      res
        .status(400)
        .json({ status: 'error', message: 'Vui lòng chọn một file âm thanh hoặc video (.mp3, .m4a, .wav, .mp4)' });
      return;
    }
    const customTitle = String(req.body?.title || '').trim();
    const customParts = req.body?.custom_parts ? Number(req.body.custom_parts) : undefined;
    const jobId = `job_${Date.now()}_${crypto.randomInt(100, 999)}`;
    jobs[jobId] = {
      job_id: jobId,
      status: 'fetching',
      progress: 5,
      message: 'Đang nhận file gốc tải lên...',
      video_info: null,
      project_folder: null,
      relative_folder: null,
      files: [],
      error: null,
      publish_draft: null,
      is_cached: false,
      created_at: formatNow(),
      logs: [],
    };

    runLocalFileSplit(file.path, file.originalname, customTitle, jobId, customParts);
    res.json({ status: 'started', job_id: jobId });
  });

  // Re-split an existing project's goc.mp3 into a chosen number of parts without re-downloading!
  app.post('/api/resplit-project', async (req, res) => {
    const folderName = path.basename(String(req.body?.folder_name || ''));
    const numParts = Math.max(1, Number(req.body?.num_parts || 2));
    const projectDir = path.join(OUTPUT_DIR, folderName);
    const origMp3Path = path.join(projectDir, 'goc.mp3');

    if (!folderName || !fs.existsSync(origMp3Path)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy file gốc goc.mp3 trong thư mục dự án để cắt lại.' });
      return;
    }

    const db = loadDb();
    const projEntry = Object.values(db.projects).find((p) => p.folder_name === folderName);
    if (!projEntry) {
      res.status(404).json({ success: false, message: 'Không tìm thấy thông tin dự án trong Database.' });
      return;
    }

    // Remove old phan_*.mp3 files before re-splitting
    for (const f of fs.readdirSync(projectDir)) {
      if (/^phan_\d+\.mp3$/.test(f)) {
        try {
          fs.unlinkSync(path.join(projectDir, f));
        } catch {}
      }
    }

    const jobId = `job_resplit_${Date.now()}`;
    jobs[jobId] = {
      job_id: jobId,
      status: 'cutting',
      progress: 50,
      message: `Đang cắt lại file gốc goc.mp3 thành ${numParts} phần...`,
      video_info: projEntry.video_info,
      project_folder: projectDir,
      relative_folder: folderName,
      files: [],
      error: null,
      publish_draft: projEntry.publish_draft,
      is_cached: false,
      created_at: formatNow(),
      logs: [],
    };

    renderMasterAndSplitAllParts(
      jobs[jobId],
      origMp3Path,
      projectDir,
      folderName,
      projEntry.index,
      projEntry.video_info,
      numParts
    ).catch((e) => {
      jobs[jobId].status = 'error';
      jobs[jobId].error = e instanceof Error ? e.message : String(e);
      jobs[jobId].message = `Lỗi cắt lại: ${jobs[jobId].error}`;
    });

    res.json({ status: 'started', job_id: jobId });
  });

  // Save/check YouTube cookies.txt for bypassing Cloud Run bot checks
  app.get('/api/cookies-status', (_req, res) => {
    const exists = fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 20;
    const size = exists ? fs.statSync(COOKIES_FILE).size : 0;
    res.json({ has_cookies: exists, size });
  });

  app.post('/api/cookies', (req, res) => {
    const content = String(req.body?.cookies_text || '').trim();
    if (!content) {
      if (fs.existsSync(COOKIES_FILE)) fs.unlinkSync(COOKIES_FILE);
      res.json({ success: true, has_cookies: false, message: 'Đã xóa Cookies YouTube.' });
      return;
    }
    fs.writeFileSync(COOKIES_FILE, content + '\n', 'utf-8');
    res.json({
      success: true,
      has_cookies: true,
      message: 'Đã lưu Cookies YouTube (cookies.txt). Bây giờ yt-dlp có thể tải mọi video gốc không bị chặn Bot!',
    });
  });

  // Poll job status
  app.get('/api/status', (req, res) => {
    const jobId = String(req.query.job_id || '');
    const job = jobs[jobId];
    if (!job) {
      res.json({ status: 'idle', progress: 0 });
      return;
    }
    res.json(job);
  });

  // List all active jobs + saved projects in projects_db.json
  app.get('/api/projects', (_req, res) => {
    const db = loadDb();
    const projectList = Object.values(db.projects).sort((a, b) => b.index - a.index);
    const activeJobs = Object.values(jobs).sort((a, b) => b.job_id.localeCompare(a.job_id));
    res.json({
      last_index: db.last_index,
      projects: projectList,
      jobs: activeJobs,
    });
  });

  // Load an existing project into a job session
  app.post('/api/load-project', (req, res) => {
    const videoId = String(req.body?.video_id || '');
    const db = loadDb();
    const project = db.projects[videoId];
    if (!project) {
      res.status(404).json({ success: false, message: 'Không tìm thấy dự án trong cơ sở dữ liệu' });
      return;
    }
    const jobId = `job_cached_${project.folder_name}_${Date.now()}`;
    const projectDir = path.join(OUTPUT_DIR, project.folder_name);
    jobs[jobId] = {
      job_id: jobId,
      status: 'completed',
      progress: 100,
      message: `Đã nạp dự án [${project.folder_name}] từ cơ sở dữ liệu.`,
      video_info: project.video_info,
      project_folder: projectDir,
      relative_folder: project.folder_name,
      files: project.files,
      error: null,
      publish_draft: project.publish_draft,
      is_cached: true,
      created_at: project.created_at,
      logs: [],
    };
    res.json({ success: true, job_id: jobId, job: jobs[jobId] });
  });

  // Delete a project from DB and disk
  app.post('/api/delete-project', (req, res) => {
    const videoId = String(req.body?.video_id || '');
    const db = loadDb();
    const project = db.projects[videoId];
    if (!project) {
      res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      return;
    }
    const folderPath = path.join(OUTPUT_DIR, path.basename(project.folder_name));
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
    }
    delete db.projects[videoId];
    saveDb(db);
    res.json({ success: true, message: `Đã xóa dự án [${project.folder_name}]` });
  });

  // Upload split MP3 chapters to remote server (https://namnghe.com/api/upload-audio)
  app.post('/api/upload-to-remote', async (req, res) => {
    const jobId = String(req.body?.job_id || '');
    const folderName = String(req.body?.folder_name || '');
    const storyTitle = String(req.body?.storyTitle || '').trim() || 'Truyen Audio';
    const customChapters: string[] = Array.isArray(req.body?.chapters) ? req.body.chapters : ['Phần 1', 'Phần 2'];
    const authToken = String(req.body?.auth_token || '').trim();
    const uploadUrl =
      String(req.body?.upload_url || '').trim() || loadSettings().upload_audio_url || DEFAULT_UPLOAD_AUDIO_URL;

    let projectDir = jobs[jobId]?.project_folder || null;
    if (!projectDir && folderName) {
      projectDir = path.join(OUTPUT_DIR, path.basename(folderName));
    }

    if (!projectDir || !fs.existsSync(projectDir)) {
      res.status(400).json({ success: false, message: 'Không tìm thấy thư mục dự án chứa file MP3' });
      return;
    }

    const results: Array<Record<string, any>> = [];
    const errorMessages: string[] = [];
    let allOk = true;

    for (let idx = 1; idx <= customChapters.length; idx++) {
      const chapLabel = customChapters[idx - 1];
      const ppath = path.join(projectDir, `phan_${idx}.mp3`);
      if (!fs.existsSync(ppath)) {
        allOk = false;
        const errTxt = `Không tìm thấy file phan_${idx}.mp3`;
        errorMessages.push(errTxt);
        results.push({ chapter: idx, uploaded: false, error: errTxt });
        continue;
      }

      try {
        const rawRes = await uploadFileMultipart(
          uploadUrl,
          ppath,
          'audio',
          { storyTitle, chapterTitle: chapLabel },
          authToken
        );
        const { urlVal, errReason } = extractUploadedUrl(rawRes);
        if (urlVal) {
          const dataObj = rawRes.data && typeof rawRes.data === 'object' ? rawRes.data : {};
          const durVal = rawRes.duration || dataObj.duration || '';
          results.push({ chapter: idx, uploaded: true, mp3_url: urlVal, duration: durVal });
        } else {
          allOk = false;
          errorMessages.push(`${chapLabel}: ${errReason}`);
          results.push({ chapter: idx, uploaded: false, error: errReason });
        }
      } catch (e: unknown) {
        allOk = false;
        const msg = e instanceof Error ? e.message : String(e);
        errorMessages.push(`${chapLabel}: ${msg}`);
        results.push({ chapter: idx, uploaded: false, error: msg });
      }
    }

    res.json({
      success: allOk,
      message: allOk ? 'Tải toàn bộ tập MP3 lên Server hoàn tất!' : errorMessages.join(' | '),
      results,
    });
  });

  // Publish story metadata to Gateway + send 5min.mp3 & story summary to Telegram
  app.post('/api/publish-gateway', async (req, res) => {
    const jobId = String(req.body?.job_id || '');
    const folderName = String(req.body?.folder_name || '');
    const gatewayUrl = String(req.body?.gateway_url || '').trim() || loadSettings().gateway_url || DEFAULT_GATEWAY_URL;
    const authToken = String(req.body?.auth_token || '').trim();
    const payloadData = req.body?.data || {};

    let projectDir = jobs[jobId]?.project_folder || null;
    if (!projectDir && folderName) {
      projectDir = path.join(OUTPUT_DIR, path.basename(folderName));
    }

    const rawChapters: Array<Record<string, any>> = Array.isArray(payloadData.chapters) ? payloadData.chapters : [];
    const cleanChapters: ChapterDraft[] = rawChapters.map((ch, idx) => {
      let mp3Url = String(ch.mp3_url || '').trim().replace(/^https?:\/\/[^/]+/i, '');
      if (mp3Url && !mp3Url.startsWith('/')) mp3Url = '/' + mp3Url;
      const chapItem: ChapterDraft = {
        id: Number(ch.id || idx + 1),
        title: String(ch.title || `Phần ${idx + 1}`).trim(),
        mp3_url: mp3Url,
      };
      if (ch.duration) chapItem.duration = String(ch.duration);
      return chapItem;
    });

    const strictPayload = {
      action: 'create',
      title: String(payloadData.title || '').trim(),
      author: String(payloadData.author || DEFAULT_AUTHOR).trim(),
      narrator: String(payloadData.narrator || DEFAULT_NARRATOR).trim(),
      category: String(payloadData.category || 'Truyện Ma').trim(),
      description: String(payloadData.description || '').trim(),
      is_hot: Boolean(payloadData.is_hot),
      chapters: cleanChapters,
    };

    const db = loadDb();
    for (const proj of Object.values(db.projects)) {
      if (
        proj.folder_name === folderName ||
        (jobs[jobId]?.relative_folder && proj.folder_name === jobs[jobId]?.relative_folder)
      ) {
        proj.publish_draft = {
          ...strictPayload,
          title_slug: slugify(strictPayload.title),
        };
        proj.title = strictPayload.title;
        saveDb(db);
        break;
      }
    }

    try {
      const curlArgs = [
        '-s',
        '-S',
        '--max-time',
        '30',
        '-w',
        '\n%{http_code}',
        '-X',
        'POST',
        gatewayUrl,
        '-H',
        'Content-Type: application/json',
      ];
      if (authToken) {
        curlArgs.push('-H', `Authorization: ${authToken}`);
      }
      curlArgs.push('--data-raw', JSON.stringify(strictPayload));

      const gwRes = await runProcess('curl', curlArgs, undefined, 35000);
      if (gwRes.ok && gwRes.stdout.trim()) {
        const lines = gwRes.stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1]?.trim() || '200';
        const respBody = lines.length > 1 ? lines.slice(0, -1).join('\n').trim() : gwRes.stdout.trim();
        const httpCode = /^\d+$/.test(lastLine) ? parseInt(lastLine, 10) : 200;

        let respJson: Record<string, any>;
        try {
          respJson = JSON.parse(respBody);
        } catch {
          respJson = { raw: respBody };
        }

        const isBizSuccess = httpCode < 400 && respJson.success !== false;
        let bizMsg = isBizSuccess
          ? respJson.message || 'Đã đăng truyện thành công!'
          : `HTTP ${httpCode}: ${respJson.message || respJson.error || 'Gateway từ chối yêu cầu (Kiểm tra lại Auth Token)'}`;

        const tgRes = await sendTelegramStoryAnd5Min(strictPayload, projectDir);
        if (isBizSuccess && tgRes.ok) {
          bizMsg = `${bizMsg} (Đã gửi Telegram & 5min.mp3)`;
        }

        res.json({
          success: isBizSuccess,
          message: bizMsg,
          telegram: tgRes,
          http_code: httpCode,
        });
        return;
      }
      res.json({ success: false, message: 'Không nhận được phản hồi hợp lệ từ Gateway' });
    } catch (e: unknown) {
      res.json({
        success: false,
        message: e instanceof Error ? e.message : 'Lỗi kết nối Gateway',
      });
    }
  });

  // Direct Telegram push endpoint
  app.post('/api/send-telegram', async (req, res) => {
    const jobId = String(req.body?.job_id || '');
    const folderName = String(req.body?.folder_name || '');
    const payloadData = req.body?.data || {};

    let projectDir = jobs[jobId]?.project_folder || null;
    if (!projectDir && folderName) {
      projectDir = path.join(OUTPUT_DIR, path.basename(folderName));
    }

    const result = await sendTelegramStoryAnd5Min(payloadData, projectDir);
    res.json({
      success: result.ok,
      message: result.message,
    });
  });

  // Get & update system configuration (including Cookie & Proxy)
  app.get('/api/settings', (_req, res) => {
    const currentSettings = loadSettings();
    const hasCookies = fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 20;
    const cookiesText = hasCookies ? fs.readFileSync(COOKIES_FILE, 'utf-8') : '';
    res.json({
      ...currentSettings,
      has_cookies: hasCookies,
      cookies_text: cookiesText,
    });
  });

  app.post('/api/settings', (req, res) => {
    const body = req.body || {};
    if (typeof body.cookies_text === 'string') {
      const trimmedCookies = body.cookies_text.trim();
      if (trimmedCookies) {
        fs.writeFileSync(COOKIES_FILE, trimmedCookies + '\n', 'utf-8');
      } else if (fs.existsSync(COOKIES_FILE)) {
        fs.unlinkSync(COOKIES_FILE);
      }
    }
    const { cookies_text, has_cookies, ...settingsOnly } = body;
    const updated = saveSettings(settingsOnly);
    const existsNow = fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 20;
    res.json({
      success: true,
      settings: updated,
      has_cookies: existsNow,
      cookies_text: existsNow ? fs.readFileSync(COOKIES_FILE, 'utf-8') : '',
    });
  });

  // Test Proxy (SOCKS5 / HTTP + IPv4 / IPv6)
  app.post('/api/test-proxy', async (req, res) => {
    const proxyType: 'http' | 'socks5' = req.body?.proxy_type === 'http' ? 'http' : 'socks5';
    const rawProxyUrl = String(req.body?.proxy_url || '').trim();
    const ipVersion: 'auto' | 'ipv4' | 'ipv6' =
      req.body?.ip_version === 'ipv4' || req.body?.ip_version === 'ipv6' ? req.body.ip_version : 'auto';

    const normalized = normalizeProxyString(rawProxyUrl, proxyType);
    if (!normalized) {
      res.status(400).json({ success: false, message: 'Vui lòng nhập địa chỉ Proxy.' });
      return;
    }

    const curlArgs = ['-s', '-S', '--max-time', '12', '--proxy', normalized];
    if (ipVersion === 'ipv4') curlArgs.push('-4');
    if (ipVersion === 'ipv6') curlArgs.push('-6');
    curlArgs.push('https://api64.ipify.org?format=json');

    const testRes = await runProcess('curl', curlArgs, undefined, 15000);
    if (testRes.ok && testRes.stdout.trim()) {
      try {
        const parsed = JSON.parse(testRes.stdout.trim());
        const detectedIp = parsed.ip || testRes.stdout.trim();
        const isV6 = detectedIp.includes(':');
        res.json({
          success: true,
          ip: detectedIp,
          protocol: isV6 ? 'IPv6' : 'IPv4',
          normalized_proxy: normalized,
          message: `Kết nối Proxy thành công! IP đầu ra: ${detectedIp} (${isV6 ? 'IPv6' : 'IPv4'})`,
        });
        return;
      } catch {
        res.json({
          success: true,
          ip: testRes.stdout.trim(),
          normalized_proxy: normalized,
          message: `Kết nối Proxy thành công! Phản hồi: ${testRes.stdout.trim().slice(0, 80)}`,
        });
        return;
      }
    }

    res.json({
      success: false,
      normalized_proxy: normalized,
      message: `Không thể kết nối qua Proxy (${normalized}): ${(testRes.stderr || 'Timeout').trim().slice(-180)}`,
    });
  });

  // Serve the original Python script with all 4 fixes from the approved Plan Mode
  app.get('/api/download-python-script', (_req, res) => {
    const origPyPath = path.join(ROOT_DIR, 'public/assets/aistudio/8888_adf6279a.py');
    if (fs.existsSync(origPyPath)) {
      let content = fs.readFileSync(origPyPath, 'utf-8');
      // 1. Upgrade HTTPServer to ThreadingHTTPServer for true non-blocking multi-tab streaming
      content = content.replace(
        'from http.server import HTTPServer, BaseHTTPRequestHandler',
        'from http.server import ThreadingHTTPServer as HTTPServer, BaseHTTPRequestHandler'
      );
      // 2. Add -write_xing 1 to cut_mp3 so split MP3 headers are always accurate
      content = content.replace(
        "cmd.extend(['-vn', '-sn', '-dn', '-c:a', 'copy', output_path])",
        "cmd.extend(['-vn', '-sn', '-dn', '-c:a', 'copy', '-write_xing', '1', output_path])"
      );
      // 3. Include goc.mp3 in result_files so the master file is also accessible
      content = content.replace(
        'result_files = [\n            create_audio_card(file_5min, "5 Phút Đầu (1.25x)", f"00:00 - {format_time(actual_5min_dur)}")\n        ]',
        'result_files = [\n            create_audio_card(orig_mp3_path, "File Gốc (128kbps)", f"00:00 - {format_time(total_duration)}"),\n            create_audio_card(file_5min, "5 Phút Đầu (1.25x)", f"00:00 - {format_time(actual_5min_dur)}")\n        ]'
      );
      // 4. Fix the truncated showCustomError function at line 1063
      content = content.replace(
        `    function showCustomError(msg) {\n      document.getElementById('errorMessage').innerText = msg;\n      document.getElementById('errorPanel').classList.remove('hidden');\n      document.getElementById('statusPanel').classList.add('hidden');\ndef upload_file_multipart`,
        `    function showCustomError(msg) {\n      document.getElementById('errorMessage').innerText = msg;\n      document.getElementById('errorPanel').classList.remove('hidden');\n      document.getElementById('statusPanel').classList.add('hidden');\n      document.getElementById('btnSubmit').disabled = false;\n    }\n  </script>\n</body>\n</html>"""\n\ndef upload_file_multipart`
      );
      res.setHeader('Content-Disposition', 'attachment; filename="youtube_mp3_splitter_pro_fixed.py"');
      res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
      res.send(content);
      return;
    }
    res.status(404).send('File not found');
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
