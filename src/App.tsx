import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Download,
  Send,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Settings,
  Volume2,
  VolumeX,
  KeyRound,
  Upload,
  Disc3,
  SkipBack,
  SkipForward,
} from 'lucide-react';

interface AudioFileCard {
  label: string;
  name: string;
  folder: string;
  duration: string;
  size_mb: string;
  stream_url: string;
  download_url: string;
  is_original?: boolean;
}

interface ChapterItem {
  id: number;
  title: string;
  mp3_url: string;
  duration?: string;
  uploaded?: boolean | 'uploading' | 'error';
  error_msg?: string;
}

interface PublishDraft {
  action: string;
  title: string;
  title_slug: string;
  author: string;
  narrator: string;
  category: string;
  description: string;
  is_hot: boolean;
  chapters: ChapterItem[];
}

interface VideoInfo {
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

interface JobState {
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
}

interface ProjectRecord {
  index: number;
  folder_name: string;
  video_id: string;
  title: string;
  created_at: string;
  video_info: VideoInfo;
  files: AudioFileCard[];
  publish_draft: PublishDraft;
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

const CATEGORIES = [
  'Truyện Ma',
  'Tiên Hiệp',
  'Kiếm Hiệp',
  'Ngôn Tình',
  'Trinh Thám',
  'Đời Thực',
  'Cổ Trang',
  'Truyện Ngắn',
];

function slugifyClient(str: string): string {
  if (!str) return 'truyen-audio';
  const cleaned = str
    .toLowerCase()
    .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a')
    .replace(/[èéẹẻẽêềếệểễ]/g, 'e')
    .replace(/[ìíịỉĩ]/g, 'i')
    .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o')
    .replace(/[ùúụủũưừứựửữ]/g, 'u')
    .replace(/[ỳýỵỷỹ]/g, 'y')
    .replace(/[đ]/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'truyen-audio';
}

function formatSec(sec: number): string {
  if (!sec || isNaN(sec) || sec < 0) return '00:00';
  const total = Math.floor(sec);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export default function App() {
  const [activeSection, setActiveSection] = useState<'workspace' | 'projects' | 'settings'>('workspace');
  const [inputMode, setInputMode] = useState<'youtube' | 'local'>('youtube');

  // Input state
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [forceReprocess, setForceReprocess] = useState(false);
  const [customPartsSelect, setCustomPartsSelect] = useState<number>(0);
  const [resplitCount, setResplitCount] = useState<number>(2);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localCustomTitle, setLocalCustomTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // YouTube Cookies State (managed in Settings)
  const [cookiesText, setCookiesText] = useState('');
  const [hasCookies, setHasCookies] = useState(false);

  // Jobs & Projects
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [currentJob, setCurrentJob] = useState<JobState | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectSearch, setProjectSearch] = useState('');

  // Story Publish Form
  const [storyTitle, setStoryTitle] = useState('');
  const [storyCategory, setStoryCategory] = useState('Truyện Ma');
  const [storyAuthor, setStoryAuthor] = useState('Nằm Nghe Audio Full');
  const [storyNarrator, setStoryNarrator] = useState('Nằm Nghe Audio');
  const [storyDescription, setStoryDescription] = useState('');
  const [storyIsHot, setStoryIsHot] = useState(false);
  const [chaptersData, setChaptersData] = useState<ChapterItem[]>([]);
  const [gatewayUrl, setGatewayUrl] = useState('https://namnghe.com/api/gateway');
  const [uploadAudioUrl, setUploadAudioUrl] = useState('https://namnghe.com/api/upload-audio');
  const [authToken, setAuthToken] = useState('');

  // Feedback
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState<'idle' | 'uploading' | 'publishing' | 'telegram'>('idle');
  const [publishStepText, setPublishStepText] = useState('');
  const [thumbFailed, setThumbFailed] = useState(false);

  // Spotify Bottom Audio Player State
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeTrackIndex, setActiveTrackIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Settings
  const [settings, setSettings] = useState<AppSettings>({
    default_author: 'Nằm Nghe Audio Full',
    default_narrator: 'Nằm Nghe Audio',
    gateway_url: 'https://namnghe.com/api/gateway',
    upload_audio_url: 'https://namnghe.com/api/upload-audio',
    telegram_bot_token: '8462358537:AAEDXMuykGCiCIkvnUH_733oNbpD0Kr510g',
    telegram_chat_id: '7967303802',
    split_chunk_mb: 90,
    preview_speed: 1.25,
    preview_duration_sec: 300,
    overlap_sec: 3,
    proxy_enabled: false,
    proxy_type: 'socks5',
    proxy_url: '',
    ip_version: 'auto',
  });
  const [settingsSavedMsg, setSettingsSavedMsg] = useState<string | null>(null);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyTestStatus, setProxyTestStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const pollTimerRef = useRef<number | null>(null);
  const populatedJobRef = useRef<string | null>(null);

  useEffect(() => {
    fetchProjectsAndInit();
    fetchSettings();
    fetchCookiesStatus();
    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, []);

  async function fetchCookiesStatus() {
    try {
      const res = await fetch('/api/cookies-status');
      if (res.ok) {
        const d = await res.json();
        setHasCookies(Boolean(d.has_cookies));
      }
    } catch {}
  }

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings({
          default_author: data.default_author || 'Nằm Nghe Audio Full',
          default_narrator: data.default_narrator || 'Nằm Nghe Audio',
          gateway_url: data.gateway_url || 'https://namnghe.com/api/gateway',
          upload_audio_url: data.upload_audio_url || 'https://namnghe.com/api/upload-audio',
          telegram_bot_token: data.telegram_bot_token || '8462358537:AAEDXMuykGCiCIkvnUH_733oNbpD0Kr510g',
          telegram_chat_id: data.telegram_chat_id || '7967303802',
          split_chunk_mb: Number(data.split_chunk_mb || 90),
          preview_speed: Number(data.preview_speed || 1.25),
          preview_duration_sec: Number(data.preview_duration_sec || 300),
          overlap_sec: Number(data.overlap_sec ?? 3),
          proxy_enabled: Boolean(data.proxy_enabled),
          proxy_type: data.proxy_type === 'http' ? 'http' : 'socks5',
          proxy_url: data.proxy_url || '',
          ip_version: data.ip_version === 'ipv4' || data.ip_version === 'ipv6' ? data.ip_version : 'auto',
        });
        if (typeof data.cookies_text === 'string') {
          setCookiesText(data.cookies_text);
        }
        if (typeof data.has_cookies === 'boolean') {
          setHasCookies(data.has_cookies);
        }
        setGatewayUrl(data.gateway_url || 'https://namnghe.com/api/gateway');
        setUploadAudioUrl(data.upload_audio_url || 'https://namnghe.com/api/upload-audio');
        setStoryAuthor(data.default_author || 'Nằm Nghe Audio Full');
        setStoryNarrator(data.default_narrator || 'Nằm Nghe Audio');
      }
    } catch {}
  }

  async function fetchProjectsAndInit() {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) return;
      const data = await res.json();
      const loadedProjects: ProjectRecord[] = data.projects || [];
      setProjects(loadedProjects);
      if (!currentJobId && loadedProjects.length > 0) {
        await handleLoadProject(loadedProjects[0].video_id, false);
      }
    } catch {}
  }

  function populatePublishForm(draft: PublishDraft, jobId: string) {
    populatedJobRef.current = jobId;
    setStoryTitle(draft.title || '');
    setStoryAuthor(draft.author || settings.default_author || 'Nằm Nghe Audio Full');
    setStoryNarrator(draft.narrator || settings.default_narrator || 'Nằm Nghe Audio');
    setStoryCategory(draft.category || 'Truyện Ma');
    setStoryDescription(draft.description || '');
    setStoryIsHot(Boolean(draft.is_hot));

    const titleSlug = slugifyClient(draft.title || 'truyen-audio');
    const mapped: ChapterItem[] = (draft.chapters || []).map((ch, idx) => {
      const chapNum = idx + 1;
      let clean = (ch.mp3_url || '').trim().replace(/^https?:\/\/[^/]+/i, '');
      if (!clean) clean = `/uploads/audio/${titleSlug}-phan-${chapNum}.mp3`;
      if (clean && !clean.startsWith('/')) clean = '/' + clean;
      return {
        id: ch.id || chapNum,
        title: ch.title || `Phần ${chapNum}`,
        mp3_url: clean,
        duration: ch.duration,
        uploaded: false,
      };
    });
    setChaptersData(mapped);
    if (mapped.length > 0) {
      setResplitCount(mapped.length);
    }
  }

  function startPolling(jobId: string) {
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/status?job_id=${encodeURIComponent(jobId)}`);
        const data: JobState = await res.json();
        if (data.status === 'idle' && !data.progress) return;

        setCurrentJob(data);

        if (data.status === 'completed') {
          if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
          setIsSubmitting(false);
          if (data.publish_draft && populatedJobRef.current !== data.job_id) {
            populatePublishForm(data.publish_draft, data.job_id);
          }
          fetch('/api/projects')
            .then((r) => r.json())
            .then((d) => {
              if (d.projects) setProjects(d.projects);
            })
            .catch(() => {});
        } else if (data.status === 'error') {
          if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
          setIsSubmitting(false);
          setErrorBanner(data.error || data.message || 'Đã xảy ra lỗi.');
        }
      } catch (e: unknown) {
        console.error('Lỗi cập nhật:', e);
      }
    }, 800);
  }

  async function handleStartYoutubeProcess(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const trimmed = youtubeUrl.trim();
    if (!trimmed) {
      setErrorBanner('Vui lòng nhập link YouTube.');
      return;
    }

    setErrorBanner(null);
    setSuccessBanner(null);
    setThumbFailed(false);
    setIsSubmitting(true);
    setActiveTrackIndex(null);
    setIsPlaying(false);

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: trimmed,
          force_reprocess: forceReprocess,
          custom_parts: customPartsSelect > 0 ? customPartsSelect : undefined,
        }),
      });
      const data = await response.json();
      if (data.status === 'started' && data.job_id) {
        setCurrentJobId(data.job_id);
        populatedJobRef.current = null;
        startPolling(data.job_id);
      } else {
        setIsSubmitting(false);
        setErrorBanner(data.message || 'Không thể bắt đầu xử lý.');
      }
    } catch (err: unknown) {
      setIsSubmitting(false);
      setErrorBanner('Lỗi kết nối: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleStartLocalUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!localFile) {
      setErrorBanner('Vui lòng chọn file âm thanh hoặc video.');
      return;
    }

    setErrorBanner(null);
    setSuccessBanner(null);
    setThumbFailed(false);
    setIsSubmitting(true);
    setActiveTrackIndex(null);
    setIsPlaying(false);

    try {
      const formData = new FormData();
      formData.append('file', localFile);
      if (localCustomTitle.trim()) {
        formData.append('title', localCustomTitle.trim());
      }
      if (customPartsSelect > 0) {
        formData.append('custom_parts', String(customPartsSelect));
      }

      const response = await fetch('/api/upload-local', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.status === 'started' && data.job_id) {
        setCurrentJobId(data.job_id);
        populatedJobRef.current = null;
        startPolling(data.job_id);
      } else {
        setIsSubmitting(false);
        setErrorBanner(data.message || 'Không thể tải file lên.');
      }
    } catch (err: unknown) {
      setIsSubmitting(false);
      setErrorBanner('Lỗi tải file: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleResplitCurrentProject() {
    if (!currentJob?.relative_folder) return;
    setErrorBanner(null);
    setSuccessBanner(null);
    setIsSubmitting(true);
    setActiveTrackIndex(null);
    setIsPlaying(false);
    try {
      const res = await fetch('/api/resplit-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_name: currentJob.relative_folder,
          num_parts: resplitCount,
        }),
      });
      const data = await res.json();
      if (data.status === 'started' && data.job_id) {
        setCurrentJobId(data.job_id);
        populatedJobRef.current = null;
        startPolling(data.job_id);
      } else {
        setIsSubmitting(false);
        setErrorBanner(data.message || 'Không thể cắt lại.');
      }
    } catch (e: unknown) {
      setIsSubmitting(false);
      setErrorBanner('Lỗi cắt lại: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleLoadProject(videoId: string, switchTab = true) {
    setErrorBanner(null);
    setSuccessBanner(null);
    setThumbFailed(false);
    setActiveTrackIndex(null);
    setIsPlaying(false);
    try {
      const res = await fetch('/api/load-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId }),
      });
      const data = await res.json();
      if (data.success && data.job) {
        setCurrentJobId(data.job_id);
        setCurrentJob(data.job);
        if (data.job.video_info?.url) {
          setYoutubeUrl(data.job.video_info.url);
        }
        if (data.job.publish_draft) {
          populatePublishForm(data.job.publish_draft, data.job_id);
        }
        if (switchTab) {
          setActiveSection('workspace');
        }
      } else {
        setErrorBanner(data.message || 'Không thể mở dự án.');
      }
    } catch (e: unknown) {
      setErrorBanner('Lỗi mở dự án: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleDeleteProject(videoId: string) {
    try {
      const res = await fetch('/api/delete-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId }),
      });
      const data = await res.json();
      if (data.success) {
        setProjects((prev) => prev.filter((p) => p.video_id !== videoId));
        if (currentJob?.video_info?.id === videoId) {
          setCurrentJob(null);
          setCurrentJobId(null);
          setActiveTrackIndex(null);
          setIsPlaying(false);
        }
        setSuccessBanner(data.message);
      }
    } catch {
      setErrorBanner('Không thể xóa dự án.');
    }
  }

  function handleTitleChange(newTitle: string) {
    setStoryTitle(newTitle);
    const slug = slugifyClient(newTitle.trim());
    setChaptersData((prev) =>
      prev.map((ch, idx) => ({
        ...ch,
        mp3_url: `/uploads/audio/${slug}-phan-${idx + 1}.mp3`,
        uploaded: false,
      }))
    );
  }

  function updateChapterTitle(idx: number, val: string) {
    setChaptersData((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, title: val, uploaded: false } : item))
    );
  }

  function updateChapterUrl(idx: number, val: string) {
    setChaptersData((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, mp3_url: val } : item))
    );
  }

  function addChapterRow() {
    const nextId = chaptersData.length + 1;
    const slug = slugifyClient(storyTitle.trim());
    setChaptersData((prev) => [
      ...prev,
      {
        id: nextId,
        title: `Phần ${nextId}`,
        mp3_url: `/uploads/audio/${slug}-phan-${nextId}.mp3`,
        uploaded: false,
      },
    ]);
  }

  function removeChapterRow(idx: number) {
    if (chaptersData.length <= 1) return;
    setChaptersData((prev) => prev.filter((_, i) => i !== idx));
  }

  async function uploadAudioToServer(): Promise<boolean> {
    setChaptersData((prev) => prev.map((ch) => ({ ...ch, uploaded: 'uploading' })));
    try {
      const res = await fetch('/api/upload-to-remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: currentJobId,
          folder_name: currentJob?.relative_folder || '',
          storyTitle: storyTitle.trim(),
          chapters: chaptersData.map((c) => c.title),
          auth_token: authToken.trim(),
          upload_url: uploadAudioUrl.trim(),
        }),
      });
      const resData = await res.json();
      if (resData.results && Array.isArray(resData.results)) {
        setChaptersData((prev) =>
          prev.map((ch, idx) => {
            const item = resData.results[idx];
            if (!item) return ch;
            if (item.uploaded && item.mp3_url) {
              return {
                ...ch,
                mp3_url: item.mp3_url,
                duration: item.duration || ch.duration,
                uploaded: true,
                error_msg: undefined,
              };
            }
            return {
              ...ch,
              uploaded: 'error',
              error_msg: item.error || 'Lỗi',
            };
          })
        );
      }
      if (resData.success) return true;
      setErrorBanner(resData.message || 'Lỗi tải MP3 lên Server.');
      return false;
    } catch (err: unknown) {
      setChaptersData((prev) => prev.map((ch) => ({ ...ch, uploaded: 'error' })));
      setErrorBanner('Lỗi upload MP3: ' + (err instanceof Error ? err.message : String(err)));
      return false;
    }
  }

  function buildGatewayPayload() {
    return {
      action: 'create',
      title: storyTitle.trim(),
      author: storyAuthor.trim(),
      narrator: storyNarrator.trim(),
      category: storyCategory,
      description: storyDescription.trim(),
      is_hot: storyIsHot,
      chapters: chaptersData.map((c, i) => {
        let finalUrl = (c.mp3_url || '').trim().replace(/^https?:\/\/[^/]+/i, '');
        if (finalUrl && !finalUrl.startsWith('/')) finalUrl = '/' + finalUrl;
        const chapObj: Record<string, any> = {
          id: i + 1,
          title: (c.title || `Phần ${i + 1}`).trim(),
          mp3_url: finalUrl,
        };
        if (c.duration) chapObj.duration = c.duration;
        return chapObj;
      }),
    };
  }

  async function handleUploadOnly() {
    setErrorBanner(null);
    setSuccessBanner(null);
    setPublishBusy('uploading');
    setPublishStepText(`Đang tải ${chaptersData.length} tập MP3 lên CDN...`);
    const ok = await uploadAudioToServer();
    setPublishBusy('idle');
    setPublishStepText('');
    if (ok) {
      setSuccessBanner(`Đã tải ${chaptersData.length} tập MP3 lên CDN.`);
    }
  }

  async function handleSendTelegramOnly() {
    setErrorBanner(null);
    setSuccessBanner(null);
    setPublishBusy('telegram');
    setPublishStepText('Đang gửi 5min.mp3 vào Telegram...');
    try {
      const payload = buildGatewayPayload();
      const res = await fetch('/api/send-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: currentJobId,
          folder_name: currentJob?.relative_folder || '',
          data: payload,
        }),
      });
      const resData = await res.json();
      setPublishBusy('idle');
      setPublishStepText('');
      if (resData.success) {
        setSuccessBanner(resData.message || 'Đã gửi Telegram thành công.');
      } else {
        setErrorBanner('Telegram: ' + (resData.message || 'Gửi thất bại'));
      }
    } catch (e: unknown) {
      setPublishBusy('idle');
      setPublishStepText('');
      setErrorBanner('Lỗi gửi Telegram: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleSubmitStory(e: React.FormEvent) {
    e.preventDefault();
    setErrorBanner(null);
    setSuccessBanner(null);

    const needUpload = chaptersData.some((ch) => ch.uploaded !== true);
    if (needUpload) {
      setPublishBusy('uploading');
      setPublishStepText(`Bước 1/2: Đang tải ${chaptersData.length} tập MP3 lên Server...`);
      const uploadOk = await uploadAudioToServer();
      if (!uploadOk) {
        setPublishBusy('idle');
        setPublishStepText('');
        return;
      }
    }

    setPublishBusy('publishing');
    setPublishStepText('Bước 2/2: Đang đăng truyện & gửi Telegram...');

    try {
      const payload = buildGatewayPayload();
      const res = await fetch('/api/publish-gateway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: currentJobId,
          folder_name: currentJob?.relative_folder || '',
          gateway_url: gatewayUrl.trim(),
          auth_token: authToken.trim(),
          data: payload,
        }),
      });

      const resData = await res.json();
      setPublishBusy('idle');
      setPublishStepText('');

      if (resData.success) {
        setSuccessBanner(resData.message || 'Đã đăng truyện thành công.');
      } else {
        setErrorBanner(resData.message || 'Đăng truyện thất bại.');
      }
    } catch (err: unknown) {
      setPublishBusy('idle');
      setPublishStepText('');
      setErrorBanner('Lỗi kết nối: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSettingsSavedMsg(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          cookies_text: cookiesText,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        setHasCookies(Boolean(data.has_cookies));
        if (typeof data.cookies_text === 'string') {
          setCookiesText(data.cookies_text);
        }
        setGatewayUrl(data.settings.gateway_url);
        setUploadAudioUrl(data.settings.upload_audio_url);
        setSettingsSavedMsg('Đã lưu cài đặt Cookie, Proxy và cấu hình mặc định.');
      }
    } catch {
      setErrorBanner('Không thể lưu cài đặt.');
    }
  }

  async function handleTestProxy() {
    if (!settings.proxy_url.trim()) {
      setProxyTestStatus({ ok: false, message: 'Vui lòng nhập địa chỉ Proxy trước khi kiểm tra.' });
      return;
    }
    setProxyTesting(true);
    setProxyTestStatus(null);
    try {
      const res = await fetch('/api/test-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxy_type: settings.proxy_type,
          proxy_url: settings.proxy_url.trim(),
          ip_version: settings.ip_version,
        }),
      });
      const data = await res.json();
      setProxyTestStatus({
        ok: Boolean(data.success),
        message: data.message || (data.success ? 'Kết nối Proxy thành công!' : 'Lỗi kết nối Proxy.'),
      });
    } catch {
      setProxyTestStatus({ ok: false, message: 'Lỗi khi kiểm tra kết nối Proxy.' });
    } finally {
      setProxyTesting(false);
    }
  }

  // Spotify Player Controls
  const filesList = currentJob?.files || [];
  const activeTrack = activeTrackIndex !== null ? filesList[activeTrackIndex] || null : null;

  function playTrackAtIndex(idx: number) {
    const target = filesList[idx];
    if (!target) return;
    if (activeTrackIndex === idx && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
      return;
    }
    setActiveTrackIndex(idx);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(true);
    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.load();
        audioRef.current.play().catch(() => {});
      }
    }, 30);
  }

  function handlePrevTrack() {
    if (activeTrackIndex === null || filesList.length === 0) return;
    const prevIdx = activeTrackIndex > 0 ? activeTrackIndex - 1 : filesList.length - 1;
    playTrackAtIndex(prevIdx);
  }

  function handleNextTrack() {
    if (activeTrackIndex === null || filesList.length === 0) return;
    const nextIdx = activeTrackIndex < filesList.length - 1 ? activeTrackIndex + 1 : 0;
    playTrackAtIndex(nextIdx);
  }

  function toggleMute() {
    if (!audioRef.current) return;
    const nextMute = !isMuted;
    audioRef.current.muted = nextMute;
    setIsMuted(nextMute);
  }

  const filteredProjects = projects.filter((p) => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) ||
      p.folder_name.toLowerCase().includes(q) ||
      p.video_id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen flex flex-col bg-black text-white pb-24">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-40 bg-black/95 backdrop-blur-md border-b border-[#282828]">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <a
            href="#workspace"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('workspace');
            }}
            className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Nằm Nghe Studio
          </a>

          {/* Zone 2: Single-line Nav Links */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-[#b3b3b3]">
            <a
              href="#workspace"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('workspace');
              }}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'workspace' ? 'text-white underline underline-offset-8 decoration-[#1ed760] decoration-2' : ''
              }`}
            >
              Tách & Đăng Truyện
            </a>
            <a
              href="#projects"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('projects');
              }}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'projects' ? 'text-white underline underline-offset-8 decoration-[#1ed760] decoration-2' : ''
              }`}
            >
              Thư Viện ({projects.length})
            </a>
            <a
              href="#settings"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('settings');
              }}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'settings' ? 'text-white underline underline-offset-8 decoration-[#1ed760] decoration-2' : ''
              }`}
            >
              Cài Đặt
            </a>
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center shrink-0">
            <a
              href="/api/download-python-script"
              className="px-4 py-2 text-xs font-bold text-black bg-[#1ed760] hover:bg-[#3be477] rounded-full transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Tải App Python</span>
            </a>
          </div>
        </div>
      </header>

      {/* Mobile Nav */}
      <div className="md:hidden bg-[#121212] border-b border-[#282828] px-4 py-2 flex items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveSection('workspace')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap shrink-0 ${
            activeSection === 'workspace' ? 'bg-[#1ed760] text-black' : 'bg-[#242424] text-[#b3b3b3]'
          }`}
        >
          Tách Audio
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('projects')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap shrink-0 ${
            activeSection === 'projects' ? 'bg-[#1ed760] text-black' : 'bg-[#242424] text-[#b3b3b3]'
          }`}
        >
          Thư Viện ({projects.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('settings')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap shrink-0 ${
            activeSection === 'settings' ? 'bg-[#1ed760] text-black' : 'bg-[#242424] text-[#b3b3b3]'
          }`}
        >
          Cài Đặt
        </button>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex-1 flex flex-col gap-6">
        {/* Notifications */}
        {errorBanner && (
          <div className="bg-[#2a1215] border border-rose-800/80 px-4 py-3 rounded-lg flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <p className="text-xs text-rose-200 break-words">{errorBanner}</p>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="text-xs font-semibold text-rose-300 hover:text-white whitespace-nowrap shrink-0"
            >
              Đóng
            </button>
          </div>
        )}

        {successBanner && (
          <div className="bg-[#0f291a] border border-[#1ed760]/40 px-4 py-3 rounded-lg flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-[#1ed760] shrink-0" />
              <p className="text-xs text-emerald-100 break-words">{successBanner}</p>
            </div>
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              className="text-xs font-semibold text-[#1ed760] hover:text-white whitespace-nowrap shrink-0"
            >
              Đóng
            </button>
          </div>
        )}

        {activeSection === 'workspace' && (
          <>
            {/* Input Panel */}
            <section className="bg-[#121212] border border-[#282828] rounded-xl p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#282828]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInputMode('youtube')}
                    className={`px-4 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      inputMode === 'youtube'
                        ? 'bg-white text-black'
                        : 'bg-[#242424] text-[#b3b3b3] hover:text-white'
                    }`}
                  >
                    Link YouTube
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('local')}
                    className={`px-4 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      inputMode === 'local'
                        ? 'bg-white text-black'
                        : 'bg-[#242424] text-[#b3b3b3] hover:text-white'
                    }`}
                  >
                    Tải File Lên
                  </button>
                </div>

                <div className="flex items-center gap-4 text-xs text-[#b3b3b3]">
                  <label className="flex items-center gap-2 cursor-pointer select-none hover:text-white">
                    <input
                      type="checkbox"
                      checked={forceReprocess}
                      onChange={(e) => setForceReprocess(e.target.checked)}
                      className="accent-[#1ed760] rounded w-3.5 h-3.5 cursor-pointer"
                    />
                    <span>Tải mới (Bỏ qua cache)</span>
                  </label>
                </div>
              </div>

              {inputMode === 'youtube' ? (
                <form onSubmit={handleStartYoutubeProcess} className="pt-4">
                  <div className="flex flex-col md:flex-row gap-3">
                    <input
                      id="urlInput"
                      type="text"
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      placeholder="Dán link YouTube cần tách MP3..."
                      className="flex-1 bg-[#242424] border border-transparent focus:border-[#1ed760] rounded-full px-5 py-2.5 text-sm text-white placeholder-[#727272] outline-none transition"
                    />

                    <select
                      value={customPartsSelect}
                      onChange={(e) => setCustomPartsSelect(Number(e.target.value))}
                      className="bg-[#242424] border border-transparent focus:border-[#1ed760] rounded-full px-4 py-2.5 text-xs font-semibold text-white outline-none transition shrink-0"
                    >
                      <option value={0}>Chia tự động ({settings.split_chunk_mb}MB/tập)</option>
                      <option value={2}>Chia 2 tập</option>
                      <option value={3}>Chia 3 tập</option>
                      <option value={4}>Chia 4 tập</option>
                      <option value={5}>Chia 5 tập</option>
                      <option value={6}>Chia 6 tập</option>
                      <option value={8}>Chia 8 tập</option>
                      <option value={10}>Chia 10 tập</option>
                    </select>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="bg-[#1ed760] hover:bg-[#3be477] disabled:opacity-50 text-black font-bold px-7 py-2.5 rounded-full transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer text-sm"
                    >
                      <span>{isSubmitting ? 'Đang xử lý...' : 'Xử Lý'}</span>
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleStartLocalUpload} className="pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    <div className="md:col-span-5">
                      <input
                        type="file"
                        accept="audio/*,video/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          setLocalFile(f);
                          if (f && !localCustomTitle) {
                            setLocalCustomTitle(f.name.replace(/\.[^/.]+$/, ''));
                          }
                        }}
                        className="w-full bg-[#242424] rounded-full px-4 py-2 text-xs text-[#b3b3b3] file:mr-3 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-[#1ed760] file:text-black cursor-pointer"
                      />
                    </div>
                    <div className="md:col-span-4">
                      <input
                        type="text"
                        value={localCustomTitle}
                        onChange={(e) => setLocalCustomTitle(e.target.value)}
                        placeholder="Tên truyện..."
                        className="w-full bg-[#242424] border border-transparent focus:border-[#1ed760] rounded-full px-4 py-2.5 text-sm text-white placeholder-[#727272] outline-none"
                      />
                    </div>
                    <div className="md:col-span-3 flex gap-2">
                      <select
                        value={customPartsSelect}
                        onChange={(e) => setCustomPartsSelect(Number(e.target.value))}
                        className="bg-[#242424] rounded-full px-3 py-2.5 text-xs font-semibold text-white outline-none flex-1"
                      >
                        <option value={0}>Tự động</option>
                        <option value={2}>2 tập</option>
                        <option value={3}>3 tập</option>
                        <option value={4}>4 tập</option>
                        <option value={5}>5 tập</option>
                        <option value={6}>6 tập</option>
                      </select>
                      <button
                        type="submit"
                        disabled={isSubmitting || !localFile}
                        className="bg-[#1ed760] hover:bg-[#3be477] disabled:opacity-50 text-black font-bold px-5 py-2.5 rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer text-xs"
                      >
                        {isSubmitting ? 'Đang cắt...' : 'Tải & Cắt'}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </section>

            {/* Active Progress Strip */}
            {currentJob && currentJob.status !== 'completed' && (
              <section className="bg-[#121212] border border-[#282828] rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {currentJob.status === 'error' ? (
                      <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                    ) : (
                      <RefreshCw className="w-5 h-5 text-[#1ed760] animate-spin shrink-0" />
                    )}
                    <span className="text-sm font-medium text-white truncate">{currentJob.message}</span>
                  </div>
                  <span className="text-sm font-bold font-mono tabular-nums text-[#1ed760]">
                    {currentJob.progress || 0}%
                  </span>
                </div>
                <div className="w-full bg-[#242424] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-[#1ed760] h-full transition-transform duration-200 origin-left"
                    style={{ transform: `scaleX(${Math.min(100, Math.max(0, currentJob.progress || 0)) / 100})` }}
                  />
                </div>
              </section>
            )}

            {/* Main Spotify Split Workspace: Left = Album & Tracklist, Right = Publish Form */}
            {currentJob && currentJob.status === 'completed' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Column (5 cols): Spotify Album Header & Tracklist */}
                <section className="lg:col-span-5 bg-[#121212] border border-[#282828] rounded-xl overflow-hidden">
                  {/* Album Header */}
                  <div className="p-5 bg-gradient-to-b from-[#242424] to-[#121212] flex gap-4 items-end">
                    {currentJob.video_info?.thumbnail && !thumbFailed ? (
                      <img
                        src={currentJob.video_info.thumbnail}
                        alt={currentJob.video_info.title}
                        referrerPolicy="no-referrer"
                        onError={() => setThumbFailed(true)}
                        className="w-24 h-24 object-cover rounded-lg shadow-lg shrink-0"
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-lg bg-[#282828] flex items-center justify-center shrink-0">
                        <Disc3 className="w-10 h-10 text-[#1ed760]" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1 space-y-1">
                      <span className="text-[11px] font-bold text-[#1ed760]">
                        Thư mục #{currentJob.relative_folder}
                      </span>
                      <h2 className="text-base font-bold text-white line-clamp-2 leading-snug">
                        {currentJob.video_info?.title}
                      </h2>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#b3b3b3] font-mono tabular-nums">
                        <span>{currentJob.video_info?.uploader || 'Nằm Nghe'}</span>
                        <span>·</span>
                        <span>{currentJob.video_info?.duration_formatted}</span>
                        {currentJob.video_info?.orig_size_mb && (
                          <>
                            <span>·</span>
                            <span>{currentJob.video_info.orig_size_mb}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quick Re-split Bar */}
                  <div className="px-5 py-3 border-b border-[#282828] flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => playTrackAtIndex(0)}
                      className="w-10 h-10 rounded-full bg-[#1ed760] hover:bg-[#3be477] text-black flex items-center justify-center transition-transform active:scale-95 cursor-pointer shrink-0"
                      title="Phát nhạc"
                    >
                      {isPlaying && activeTrackIndex !== null ? (
                        <Pause className="w-5 h-5 fill-current" />
                      ) : (
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      )}
                    </button>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#b3b3b3]">Chia lại:</span>
                      <select
                        value={resplitCount}
                        onChange={(e) => setResplitCount(Number(e.target.value))}
                        className="bg-[#242424] rounded-full px-3 py-1 text-xs font-semibold text-white outline-none"
                      >
                        {[2, 3, 4, 5, 6, 7, 8, 10, 12].map((n) => (
                          <option key={n} value={n}>
                            {n} tập
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={handleResplitCurrentProject}
                        className="px-3.5 py-1 text-xs font-bold bg-[#242424] hover:bg-[#333333] text-white rounded-full transition-colors cursor-pointer"
                      >
                        Cắt lại
                      </button>
                    </div>
                  </div>

                  {/* Tracklist Rows */}
                  <div className="p-2">
                    {currentJob.files.map((file, idx) => {
                      const isThisPlaying = activeTrackIndex === idx && isPlaying;
                      const isThisSelected = activeTrackIndex === idx;
                      return (
                        <div
                          key={file.name}
                          onClick={() => playTrackAtIndex(idx)}
                          className={`group flex items-center justify-between gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                            isThisSelected ? 'bg-[#282828]' : 'hover:bg-[#1f1f1f]'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-6 text-center font-mono text-xs text-[#b3b3b3] shrink-0">
                              {isThisPlaying ? (
                                <Pause className="w-3.5 h-3.5 text-[#1ed760] mx-auto fill-current" />
                              ) : (
                                <span className={isThisSelected ? 'text-[#1ed760] font-bold' : ''}>
                                  {idx + 1}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p
                                className={`text-sm font-semibold truncate ${
                                  isThisSelected ? 'text-[#1ed760]' : 'text-white'
                                }`}
                              >
                                {file.label}
                              </p>
                              <div className="flex items-center gap-1.5 text-xs text-[#b3b3b3] font-mono tabular-nums mt-0.5">
                                <span>{file.name}</span>
                                <span>·</span>
                                <span>{file.duration}</span>
                                <span>·</span>
                                <span>{file.size_mb}</span>
                              </div>
                            </div>
                          </div>

                          <a
                            href={file.download_url}
                            download={file.name}
                            onClick={(e) => e.stopPropagation()}
                            className="p-2 text-[#b3b3b3] hover:text-white rounded-full hover:bg-[#333333] transition-colors shrink-0"
                            title={`Tải ${file.name}`}
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Right Column (7 cols): Story Editor & Publish Panel */}
                <section
                  id="publish-section"
                  className="lg:col-span-7 bg-[#121212] border border-[#282828] rounded-xl p-5 space-y-5"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-[#282828]">
                    <h2 className="text-base font-bold text-white">Thông Tin Truyện</h2>

                    <label className="text-xs text-white cursor-pointer flex items-center gap-2 bg-[#242424] px-3.5 py-1.5 rounded-full">
                      <input
                        type="checkbox"
                        checked={storyIsHot}
                        onChange={(e) => setStoryIsHot(e.target.checked)}
                        className="accent-[#1ed760] rounded cursor-pointer w-3.5 h-3.5"
                      />
                      <span className="font-semibold">Truyện Hot</span>
                    </label>
                  </div>

                  <form onSubmit={handleSubmitStory} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                          Tên truyện
                        </label>
                        <input
                          type="text"
                          value={storyTitle}
                          onChange={(e) => handleTitleChange(e.target.value)}
                          required
                          className="w-full bg-[#242424] border border-transparent focus:border-[#1ed760] rounded-lg px-3.5 py-2 text-sm text-white outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                          Thể loại
                        </label>
                        <select
                          value={storyCategory}
                          onChange={(e) => setStoryCategory(e.target.value)}
                          className="w-full bg-[#242424] border border-transparent focus:border-[#1ed760] rounded-lg px-3.5 py-2 text-sm text-white outline-none"
                        >
                          {CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                          Tác giả
                        </label>
                        <input
                          type="text"
                          value={storyAuthor}
                          onChange={(e) => setStoryAuthor(e.target.value)}
                          required
                          className="w-full bg-[#242424] border border-transparent focus:border-[#1ed760] rounded-lg px-3.5 py-2 text-sm text-white outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                          Diễn đọc
                        </label>
                        <input
                          type="text"
                          value={storyNarrator}
                          onChange={(e) => setStoryNarrator(e.target.value)}
                          required
                          className="w-full bg-[#242424] border border-transparent focus:border-[#1ed760] rounded-lg px-3.5 py-2 text-sm text-white outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                        Tóm tắt
                      </label>
                      <textarea
                        rows={3}
                        value={storyDescription}
                        onChange={(e) => setStoryDescription(e.target.value)}
                        placeholder="Nội dung tóm tắt..."
                        className="w-full bg-[#242424] border border-transparent focus:border-[#1ed760] rounded-lg p-3 text-sm text-white outline-none"
                      />
                    </div>

                    {/* Chapters List */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#b3b3b3]">
                          Danh sách tập ({chaptersData.length})
                        </span>
                        <button
                          type="button"
                          onClick={addChapterRow}
                          className="text-xs font-semibold text-white bg-[#242424] hover:bg-[#333333] px-3 py-1 rounded-full flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5 text-[#1ed760]" />
                          <span>Thêm tập</span>
                        </button>
                      </div>

                      <div className="space-y-1.5">
                        {chaptersData.map((ch, idx) => (
                          <div
                            key={idx}
                            className="grid grid-cols-12 gap-2 items-center bg-[#181818] p-2 rounded-lg"
                          >
                            <div className="col-span-1 text-center font-mono text-xs text-[#b3b3b3]">
                              {idx + 1}
                            </div>
                            <div className="col-span-3">
                              <input
                                type="text"
                                value={ch.title}
                                onChange={(e) => updateChapterTitle(idx, e.target.value)}
                                className="w-full bg-[#242424] rounded px-2.5 py-1.5 text-xs text-white outline-none font-medium"
                              />
                            </div>
                            <div className="col-span-5">
                              <input
                                type="text"
                                value={ch.mp3_url}
                                onChange={(e) => updateChapterUrl(idx, e.target.value)}
                                className="w-full bg-[#242424] rounded px-2.5 py-1.5 text-xs text-[#1ed760] font-mono outline-none"
                              />
                            </div>
                            <div className="col-span-3 flex items-center justify-end gap-2">
                              <span
                                className={`text-[11px] font-mono whitespace-nowrap ${
                                  ch.uploaded === true
                                    ? 'text-[#1ed760]'
                                    : ch.uploaded === 'uploading'
                                    ? 'text-amber-400'
                                    : ch.uploaded === 'error'
                                    ? 'text-rose-400'
                                    : 'text-[#727272]'
                                }`}
                              >
                                {ch.uploaded === true
                                  ? 'Đã tải lên'
                                  : ch.uploaded === 'uploading'
                                  ? 'Đang tải...'
                                  : ch.uploaded === 'error'
                                  ? 'Lỗi'
                                  : 'Chờ tải'}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeChapterRow(idx)}
                                disabled={chaptersData.length <= 1}
                                className="text-[#727272] hover:text-rose-400 disabled:opacity-30 p-1 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Server & Token */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-[#282828]">
                      <div>
                        <label className="block text-xs font-semibold text-[#b3b3b3] mb-1">
                          Gateway URL
                        </label>
                        <input
                          type="text"
                          value={gatewayUrl}
                          onChange={(e) => setGatewayUrl(e.target.value)}
                          className="w-full bg-[#242424] rounded-lg px-3 py-2 text-xs font-mono text-[#b3b3b3] outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#b3b3b3] mb-1">
                          Token API
                        </label>
                        <input
                          type="text"
                          value={authToken}
                          onChange={(e) => setAuthToken(e.target.value)}
                          placeholder="Bearer token..."
                          className="w-full bg-[#242424] rounded-lg px-3 py-2 text-xs font-mono text-white outline-none"
                        />
                      </div>
                    </div>

                    {publishStepText && (
                      <div className="text-xs font-mono text-[#1ed760] bg-[#181818] rounded-lg px-3.5 py-2.5 flex items-center gap-2">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                        <span>{publishStepText}</span>
                      </div>
                    )}

                    {/* Action Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={publishBusy !== 'idle'}
                          onClick={handleUploadOnly}
                          className="px-4 py-2 text-xs font-bold text-white bg-[#242424] hover:bg-[#333333] disabled:opacity-50 rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Upload MP3</span>
                        </button>
                        <button
                          type="button"
                          disabled={publishBusy !== 'idle'}
                          onClick={handleSendTelegramOnly}
                          className="px-4 py-2 text-xs font-bold text-white bg-[#242424] hover:bg-[#333333] disabled:opacity-50 rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Gửi Telegram</span>
                        </button>
                      </div>

                      <button
                        type="submit"
                        disabled={publishBusy !== 'idle'}
                        className="bg-[#1ed760] hover:bg-[#3be477] disabled:opacity-50 text-black font-bold px-7 py-2.5 rounded-full transition-colors flex items-center gap-2 cursor-pointer text-sm"
                      >
                        <Send className="w-4 h-4" />
                        <span>Đăng Truyện</span>
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            )}
          </>
        )}

        {/* Section 2: Library */}
        {activeSection === 'projects' && (
          <section className="bg-[#121212] border border-[#282828] rounded-xl p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#282828]">
              <h1 className="text-lg font-bold text-white">Thư Viện Dự Án</h1>
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-[#b3b3b3] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  placeholder="Tìm kiếm truyện..."
                  className="w-full bg-[#242424] rounded-full pl-9 pr-4 py-2 text-xs text-white outline-none"
                />
              </div>
            </div>

            {filteredProjects.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <p className="text-sm text-[#b3b3b3]">Chưa có dự án nào trong thư viện.</p>
                <button
                  type="button"
                  onClick={() => setActiveSection('workspace')}
                  className="px-5 py-2 text-xs font-bold bg-[#1ed760] text-black rounded-full hover:bg-[#3be477] transition-colors cursor-pointer"
                >
                  Tách Truyện Mới
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#282828] text-xs font-semibold text-[#b3b3b3]">
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Tên truyện</th>
                      <th className="py-2.5 px-3 text-right">Thời lượng</th>
                      <th className="py-2.5 px-3 text-right">Số file</th>
                      <th className="py-2.5 px-3 text-right">Ngày tạo</th>
                      <th className="py-2.5 px-3 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#282828]/50 text-xs">
                    {filteredProjects.map((proj) => (
                      <tr key={proj.video_id} className="hover:bg-[#1f1f1f] transition-colors">
                        <td className="py-3 px-3 font-mono text-[#1ed760] font-semibold">
                          {proj.folder_name}
                        </td>
                        <td className="py-3 px-3 text-white font-semibold max-w-md truncate">
                          {proj.title}
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-[#b3b3b3] text-right">
                          {proj.video_info?.duration_formatted || '00:00'}
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-[#b3b3b3] text-right">
                          {proj.files?.length || 0}
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-[#b3b3b3] text-right">
                          {proj.created_at}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleLoadProject(proj.video_id, true)}
                              className="px-4 py-1.5 text-xs font-bold bg-[#1ed760] hover:bg-[#3be477] text-black rounded-full transition-colors cursor-pointer"
                            >
                              Mở
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteProject(proj.video_id)}
                              className="p-1.5 text-[#b3b3b3] hover:text-rose-400 cursor-pointer"
                              title="Xóa"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Section 3: Settings */}
        {activeSection === 'settings' && (
          <section className="bg-[#121212] border border-[#282828] rounded-xl p-5 max-w-3xl space-y-5">
            <div className="pb-3 border-b border-[#282828] flex items-center justify-between gap-4">
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#1ed760]" />
                <span>Cài Đặt Hệ Thống, Cookie & Proxy</span>
              </h1>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                    hasCookies ? 'bg-[#0f291a] text-[#1ed760]' : 'bg-[#242424] text-[#b3b3b3]'
                  }`}
                >
                  {hasCookies ? 'Cookie: Đã nạp' : 'Cookie: Chưa có'}
                </span>
                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                    settings.proxy_enabled && settings.proxy_url.trim()
                      ? 'bg-[#0f291a] text-[#1ed760]'
                      : 'bg-[#242424] text-[#b3b3b3]'
                  }`}
                >
                  {settings.proxy_enabled && settings.proxy_url.trim()
                    ? `Proxy: ${settings.proxy_type.toUpperCase()} (${settings.ip_version.toUpperCase()})`
                    : 'Proxy: Tắt'}
                </span>
              </div>
            </div>

            {settingsSavedMsg && (
              <div className="bg-[#0f291a] border border-[#1ed760]/40 px-4 py-2.5 rounded-lg text-xs text-[#1ed760] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{settingsSavedMsg}</span>
              </div>
            )}

            <form onSubmit={handleSaveSettings} className="space-y-5">
              {/* Block 1: Proxy Configuration (SOCKS5 / HTTP + IPv4 / IPv6) */}
              <div className="bg-[#181818] border border-[#282828] rounded-xl p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-white">Cấu Hình Proxy (SOCKS5 / HTTP · IPv4 & IPv6)</h2>
                    <p className="text-xs text-[#b3b3b3] mt-0.5">
                      Sử dụng Proxy để đổi IP tải YouTube, vượt chặn vùng hoặc giới hạn băng thông.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer select-none bg-[#242424] px-3.5 py-2 rounded-full">
                    <input
                      type="checkbox"
                      checked={settings.proxy_enabled}
                      onChange={(e) => setSettings({ ...settings, proxy_enabled: e.target.checked })}
                      className="rounded accent-[#1ed760]"
                    />
                    <span>Bật Proxy</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                      Loại giao thức Proxy
                    </label>
                    <select
                      value={settings.proxy_type}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          proxy_type: e.target.value === 'http' ? 'http' : 'socks5',
                        })
                      }
                      className="w-full bg-[#242424] rounded-lg px-3.5 py-2 text-xs font-semibold text-white outline-none cursor-pointer"
                    >
                      <option value="socks5">SOCKS5 (socks5://)</option>
                      <option value="http">HTTP / HTTPS (http://)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                      Chế độ định tuyến IP (IPv4 / IPv6)
                    </label>
                    <select
                      value={settings.ip_version}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          ip_version:
                            e.target.value === 'ipv4' || e.target.value === 'ipv6' ? e.target.value : 'auto',
                        })
                      }
                      className="w-full bg-[#242424] rounded-lg px-3.5 py-2 text-xs font-semibold text-white outline-none cursor-pointer"
                    >
                      <option value="auto">Tự động (Hỗ trợ cả IPv4 & IPv6)</option>
                      <option value="ipv4">Bắt buộc IPv4 (--force-ipv4)</option>
                      <option value="ipv6">Bắt buộc IPv6 (--force-ipv6)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                    Chuỗi kết nối Proxy (IPv4 hoặc IPv6)
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={settings.proxy_url}
                      onChange={(e) => setSettings({ ...settings, proxy_url: e.target.value })}
                      placeholder="VD: ip:port:user:pass, user:pass@ip:port, hoặc [2001:db8::1]:1080:user:pass"
                      className="flex-1 bg-[#242424] rounded-lg px-3.5 py-2 text-xs font-mono text-white placeholder-[#727272] outline-none"
                    />
                    <button
                      type="button"
                      disabled={proxyTesting}
                      onClick={handleTestProxy}
                      className="px-4 py-2 text-xs font-bold bg-[#242424] hover:bg-[#333333] text-[#1ed760] rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${proxyTesting ? 'animate-spin' : ''}`} />
                      <span>{proxyTesting ? 'Đang kiểm tra...' : 'Kiểm tra Proxy'}</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-[#727272] mt-1.5 font-mono">
                    Hỗ trợ: 103.x.x.x:1080:user:pass · user:pass@103.x.x.x:8080 · [2402:800::1]:1080:user:pass · socks5://...
                  </p>
                </div>

                {proxyTestStatus && (
                  <div
                    className={`px-3.5 py-2 rounded-lg text-xs font-mono flex items-center gap-2 ${
                      proxyTestStatus.ok
                        ? 'bg-[#0f291a] text-[#1ed760] border border-[#1ed760]/30'
                        : 'bg-[#2c1215] text-rose-300 border border-rose-500/30'
                    }`}
                  >
                    {proxyTestStatus.ok ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                    )}
                    <span className="break-all">{proxyTestStatus.message}</span>
                  </div>
                )}
              </div>

              {/* Block 2: Cookie YouTube (cookies.txt) */}
              <div className="bg-[#181818] border border-[#282828] rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-[#1ed760]" />
                      <span>Cookie YouTube (Netscape cookies.txt)</span>
                    </h2>
                    <p className="text-xs text-[#b3b3b3] mt-0.5">
                      Dán nội dung file cookies.txt hoặc chọn file từ máy để vượt xác minh chống Bot của YouTube.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="px-3 py-1.5 text-xs font-semibold bg-[#242424] hover:bg-[#333333] text-white rounded-full cursor-pointer transition-colors">
                      <span>Chọn file .txt</span>
                      <input
                        type="file"
                        accept=".txt"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => {
                            if (typeof reader.result === 'string') {
                              setCookiesText(reader.result);
                            }
                          };
                          reader.readAsText(file);
                        }}
                      />
                    </label>
                    {cookiesText && (
                      <button
                        type="button"
                        onClick={() => setCookiesText('')}
                        className="px-3 py-1.5 text-xs font-semibold bg-[#242424] hover:text-rose-400 text-[#b3b3b3] rounded-full cursor-pointer transition-colors"
                      >
                        Xóa trắng
                      </button>
                    )}
                  </div>
                </div>

                <textarea
                  rows={5}
                  value={cookiesText}
                  onChange={(e) => setCookiesText(e.target.value)}
                  placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	TRUE	1760000000	SID	..."
                  className="w-full bg-[#242424] rounded-lg p-3 text-xs font-mono text-white placeholder-[#727272] outline-none"
                />
              </div>

              {/* Block 3: Default Story & Server Config */}
              <div className="bg-[#181818] border border-[#282828] rounded-xl p-4 space-y-4">
                <h2 className="text-sm font-bold text-white">Cấu Hình Đăng Truyện & Cắt File</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                      Tác giả mặc định
                    </label>
                    <input
                      type="text"
                      value={settings.default_author}
                      onChange={(e) => setSettings({ ...settings, default_author: e.target.value })}
                      className="w-full bg-[#242424] rounded-lg px-3.5 py-2 text-sm text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                      Diễn đọc mặc định
                    </label>
                    <input
                      type="text"
                      value={settings.default_narrator}
                      onChange={(e) => setSettings({ ...settings, default_narrator: e.target.value })}
                      className="w-full bg-[#242424] rounded-lg px-3.5 py-2 text-sm text-white outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                      Gateway URL
                    </label>
                    <input
                      type="text"
                      value={settings.gateway_url}
                      onChange={(e) => setSettings({ ...settings, gateway_url: e.target.value })}
                      className="w-full bg-[#242424] rounded-lg px-3.5 py-2 text-xs font-mono text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                      Upload Audio URL
                    </label>
                    <input
                      type="text"
                      value={settings.upload_audio_url}
                      onChange={(e) => setSettings({ ...settings, upload_audio_url: e.target.value })}
                      className="w-full bg-[#242424] rounded-lg px-3.5 py-2 text-xs font-mono text-white outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#282828]">
                  <div>
                    <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                      Telegram Bot Token
                    </label>
                    <input
                      type="text"
                      value={settings.telegram_bot_token}
                      onChange={(e) => setSettings({ ...settings, telegram_bot_token: e.target.value })}
                      className="w-full bg-[#242424] rounded-lg px-3.5 py-2 text-xs font-mono text-[#1ed760] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                      Telegram Chat ID
                    </label>
                    <input
                      type="text"
                      value={settings.telegram_chat_id}
                      onChange={(e) => setSettings({ ...settings, telegram_chat_id: e.target.value })}
                      className="w-full bg-[#242424] rounded-lg px-3.5 py-2 text-xs font-mono text-white outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-[#282828]">
                  <div>
                    <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                      Dung lượng mỗi tập (MB)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={500}
                      value={settings.split_chunk_mb}
                      onChange={(e) => setSettings({ ...settings, split_chunk_mb: Number(e.target.value) })}
                      className="w-full bg-[#242424] rounded-lg px-3.5 py-2 text-sm font-mono text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                      Tốc độ 5 phút đầu (x)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      min={0.5}
                      max={2.0}
                      value={settings.preview_speed}
                      onChange={(e) => setSettings({ ...settings, preview_speed: Number(e.target.value) })}
                      className="w-full bg-[#242424] rounded-lg px-3.5 py-2 text-sm font-mono text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#b3b3b3] mb-1.5">
                      Gối đầu giữa các tập (giây)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={settings.overlap_sec}
                      onChange={(e) => setSettings({ ...settings, overlap_sec: Number(e.target.value) })}
                      className="w-full bg-[#242424] rounded-lg px-3.5 py-2 text-sm font-mono text-white outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-1 flex justify-end">
                <button
                  type="submit"
                  className="bg-[#1ed760] hover:bg-[#3be477] text-black font-bold px-7 py-2.5 rounded-full transition-colors text-xs cursor-pointer"
                >
                  Lưu Toàn Bộ Cài Đặt
                </button>
              </div>
            </form>
          </section>
        )}
      </main>

      {/* Spotify Bottom Now-Playing Bar */}
      <footer className="fixed bottom-0 left-0 right-0 z-50 bg-[#000000] border-t border-[#282828] px-4 py-2.5">
        <audio
          ref={audioRef}
          src={activeTrack?.stream_url || undefined}
          onTimeUpdate={() => {
            if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
          }}
          onLoadedMetadata={() => {
            if (audioRef.current) setDuration(audioRef.current.duration || 0);
          }}
          onEnded={handleNextTrack}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />

        <div className="max-w-7xl mx-auto grid grid-cols-12 items-center gap-4">
          {/* Left: Track Info */}
          <div className="col-span-4 flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded bg-[#181818] flex items-center justify-center shrink-0">
              <Disc3 className={`w-6 h-6 text-[#1ed760] ${isPlaying ? 'animate-spin' : ''}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">
                {activeTrack ? activeTrack.label : 'Chưa chọn file phát'}
              </p>
              <p className="text-[11px] text-[#b3b3b3] font-mono truncate">
                {activeTrack ? `${activeTrack.name} · ${activeTrack.size_mb}` : 'Chọn một tập bên trên để nghe thử'}
              </p>
            </div>
          </div>

          {/* Center: Playback Controls & Seek Bar */}
          <div className="col-span-5 flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-5">
              <button
                type="button"
                disabled={!activeTrack}
                onClick={handlePrevTrack}
                className="text-[#b3b3b3] hover:text-white disabled:opacity-30 cursor-pointer"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={filesList.length === 0}
                onClick={() => {
                  if (activeTrackIndex === null && filesList.length > 0) {
                    playTrackAtIndex(0);
                  } else if (activeTrackIndex !== null) {
                    playTrackAtIndex(activeTrackIndex);
                  }
                }}
                className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-30 cursor-pointer"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>
              <button
                type="button"
                disabled={!activeTrack}
                onClick={handleNextTrack}
                className="text-[#b3b3b3] hover:text-white disabled:opacity-30 cursor-pointer"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            <div className="w-full flex items-center gap-2 text-[11px] font-mono tabular-nums text-[#b3b3b3]">
              <span className="w-10 text-right">{formatSec(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                disabled={!activeTrack}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setCurrentTime(val);
                  if (audioRef.current) audioRef.current.currentTime = val;
                }}
                className="spotify-slider flex-1"
              />
              <span className="w-10">{formatSec(duration)}</span>
            </div>
          </div>

          {/* Right: Volume & Download */}
          <div className="col-span-3 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={toggleMute}
              className="text-[#b3b3b3] hover:text-white cursor-pointer"
            >
              {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                setIsMuted(v === 0);
                if (audioRef.current) {
                  audioRef.current.volume = v;
                  audioRef.current.muted = v === 0;
                }
              }}
              className="spotify-slider w-20 hidden sm:block"
            />
            {activeTrack && (
              <a
                href={activeTrack.download_url}
                download={activeTrack.name}
                className="p-2 text-[#b3b3b3] hover:text-[#1ed760] transition-colors"
                title="Tải file đang phát"
              >
                <Download className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
