import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  Headphones,
  Maximize2,
  Minimize2,
  Moon,
  RotateCcw,
  RotateCw,
  Gauge,
  FileText,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Loader2,
  AlertTriangle,
  SlidersHorizontal,
  PictureInPicture2,
  Download,
  X,
  CheckCircle2,
  Sparkles,
  Smartphone,
  Expand,
} from 'lucide-react';
import { ResolvedStream } from '../types';
import {
  buildPdfProxyUrl,
  downloadPdfFile,
  openPdfViewer,
  resolveAttachmentUrl,
  resolveVideoStream,
  saveWatchHistory,
} from '../services/batchService';
import {
  isLectureCompleted,
  markLectureCompleted,
  recordStudyActivity,
  toggleLectureCompleted,
} from '../services/adventureService';
import { StudyAiPanel } from './StudyAiPanel';
import { getOfflineLectureRecord } from '../services/offlineLectureDb';
import { openLectureDownloadModal } from '../services/lectureDownloadManager';

export interface ActiveLectureInput {
  batchId: string;
  batchName?: string;
  programId?: string;
  subjectId: string;
  subjectName?: string;
  topicId: string;
  topicName?: string;
  videoId: string;
  findKey?: string;
  videoDetailsId?: string;
  typeId?: string;
  title: string;
  videoImg?: string;
  videoType?: string;
  playType?: string;
  rawVideoUrl?: string;
  resumeSeconds?: number;
  offlineId?: string;
  offlineFormat?: 'mp4' | 'm4a';
}

interface VideoPlayerViewProps {
  lecture: ActiveLectureInput;
  onBack: () => void;
  onAdventureUpdate?: () => void;
}

export const VideoPlayerView: React.FC<VideoPlayerViewProps> = ({
  lecture,
  onBack,
  onAdventureUpdate,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const seekFeedbackTimerRef = useRef<number | null>(null);
  const offlineBlobUrlRef = useRef<string | null>(null);

  // Stream resolution state
  const [resolving, setResolving] = useState(true);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [streamData, setStreamData] = useState<ResolvedStream | null>(null);

  // Video playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isAudioOnly, setIsAudioOnly] = useState(false);
  const [seekToast, setSeekToast] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<{ ratio: number; time: number } | null>(null);

  // Fullscreen, Landscape & Scaling state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [forceCssLandscape, setForceCssLandscape] = useState(false);
  const [isPortraitViewport, setIsPortraitViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false
  );
  const [fillMode, setFillMode] = useState<'contain' | 'cover'>('contain');
  const [controlsVisible, setControlsVisible] = useState(true);

  // Quality levels
  const [qualityLevels, setQualityLevels] = useState<Array<{ index: number; label: string }>>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1); // -1 = Auto

  // Popups & Drawers
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [showNotesDrawer, setShowNotesDrawer] = useState(false);
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const [downloadingAttIdx, setDownloadingAttIdx] = useState<number | null>(null);
  const [downloadedAttIdx, setDownloadedAttIdx] = useState<number | null>(null);
  const [completed, setCompleted] = useState<boolean>(() =>
    isLectureCompleted(lecture.batchId, lecture.videoId)
  );

  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  // Auto-detect viewport portrait/landscape so CSS rotate never double-rotates
  useEffect(() => {
    const updateOrientation = () => {
      setIsPortraitViewport(window.innerHeight > window.innerWidth);
    };
    const onFsChange = () => {
      const nativeFs = Boolean(
        document.fullscreenElement || (document as any).webkitFullscreenElement
      );
      if (!nativeFs) {
        setIsFullscreen((prev) => (forceCssLandscape ? prev : false));
        try {
          (screen.orientation as any)?.unlock?.();
        } catch {
          // ignore
        }
      } else {
        setIsFullscreen(true);
      }
      updateOrientation();
    };
    window.addEventListener('resize', updateOrientation);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      window.removeEventListener('resize', updateOrientation);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, [forceCssLandscape]);

  // Clean up orientation lock & offline blob URLs on unmount
  useEffect(() => {
    return () => {
      if (offlineBlobUrlRef.current) {
        URL.revokeObjectURL(offlineBlobUrlRef.current);
        offlineBlobUrlRef.current = null;
      }
      if (seekFeedbackTimerRef.current) {
        window.clearTimeout(seekFeedbackTimerRef.current);
      }
      try {
        (screen.orientation as any)?.unlock?.();
      } catch {
        // ignore
      }
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, []);

  const isCssRotatedLandscape = (isFullscreen || forceCssLandscape) && isPortraitViewport;
  const isImmersiveFullscreen = isFullscreen || forceCssLandscape;

  // Netflix-style auto-hide overlay controls smoothly while playing (in both normal & fullscreen)
  const scheduleAutoHide = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (
      !isPlaying ||
      resolving ||
      Boolean(resolveError) ||
      showSpeedMenu ||
      showQualityMenu ||
      showSleepMenu ||
      showNotesDrawer ||
      showAiDrawer
    ) {
      setControlsVisible(true);
      return;
    }
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 3200);
  }, [
    isPlaying,
    resolving,
    resolveError,
    showSpeedMenu,
    showQualityMenu,
    showSleepMenu,
    showNotesDrawer,
    showAiDrawer,
  ]);

  useEffect(() => {
    scheduleAutoHide();
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [scheduleAutoHide]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleAutoHide();
  }, [scheduleAutoHide]);

  // 1. Resolve real stream (or load offline saved Blob) on mount & record daily streak activity
  const loadStream = async () => {
    setResolving(true);
    setResolveError(null);
    setIsBuffering(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedPercent(0);
    try {
      if (lecture.offlineId) {
        const rec = await getOfflineLectureRecord(lecture.offlineId);
        if (!rec || !rec.blob) {
          throw new Error('Offline lecture file was not found in your device vault.');
        }
        if (offlineBlobUrlRef.current) {
          URL.revokeObjectURL(offlineBlobUrlRef.current);
        }
        const objUrl = URL.createObjectURL(rec.blob);
        offlineBlobUrlRef.current = objUrl;
        setStreamData({
          success: true,
          isYoutube: false,
          isDirectMp4: true,
          streamUrl: objUrl,
          attachments: [],
        });
        return;
      }

      const data = await resolveVideoStream({
        batchId: lecture.batchId,
        programId: lecture.programId,
        subjectId: lecture.subjectId,
        topicId: lecture.topicId,
        videoId: lecture.videoId,
        findKey: lecture.findKey,
        videoDetailsId: lecture.videoDetailsId,
        typeId: lecture.typeId,
        videoName: lecture.title,
        videoImg: lecture.videoImg,
        videoType: lecture.videoType || 'new',
        playType: lecture.playType || 'Lecture',
        videoUrl: lecture.rawVideoUrl,
      });
      setStreamData(data);
    } catch (err: any) {
      setResolveError(err?.message || 'Unable to load video stream.');
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    recordStudyActivity();
    setCompleted(isLectureCompleted(lecture.batchId, lecture.videoId));
    onAdventureUpdate?.();
    loadStream();
  }, [lecture.batchId, lecture.programId, lecture.subjectId, lecture.topicId, lecture.videoId, lecture.offlineId]);

  // 2. Attach HLS.js or native <video> source
  useEffect(() => {
    if (!streamData || streamData.isYoutube || !streamData.streamUrl) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const src = streamData.streamUrl;

    const safeAttemptPlay = () => {
      videoEl
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => {
          // Browser blocked unmuted autoplay — leave paused cleanly with prominent Netflix Play button
          setIsPlaying(false);
          setControlsVisible(true);
        });
    };

    if (streamData.isDirectMp4) {
      videoEl.src = src;
      if (lecture.resumeSeconds && lecture.resumeSeconds > 5) {
        const onMeta = () => {
          if (videoEl.duration && lecture.resumeSeconds && lecture.resumeSeconds < videoEl.duration - 5) {
            videoEl.currentTime = lecture.resumeSeconds;
          }
          videoEl.removeEventListener('loadedmetadata', onMeta);
        };
        videoEl.addEventListener('loadedmetadata', onMeta);
      }
      safeAttemptPlay();
      return;
    }

    if (Hls.isSupported()) {
      let networkRetries = 0;
      let mediaRetries = 0;

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        maxBufferLength: 45,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(videoEl);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        networkRetries = 0;
        mediaRetries = 0;
        const levels = (data.levels || []).map((lvl, idx) => ({
          index: idx,
          label: lvl.height ? `${lvl.height}p` : `Level ${idx + 1}`,
        }));
        setQualityLevels(levels);
        setCurrentLevel(-1);
        if (lecture.resumeSeconds && lecture.resumeSeconds > 5) {
          videoEl.currentTime = lecture.resumeSeconds;
        }
        safeAttemptPlay();
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
          networkRetries++;
          setTimeout(() => {
            if (hlsRef.current === hls) hls.startLoad();
          }, 500 * networkRetries);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
          mediaRetries++;
          hls.recoverMediaError();
        } else {
          setIsBuffering(false);
          setResolveError('Stream connection failed or expired. Tap Retry Stream to reload.');
        }
      });
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = src;
      const onLoaded = () => {
        if (lecture.resumeSeconds && lecture.resumeSeconds > 5) {
          videoEl.currentTime = lecture.resumeSeconds;
        }
        safeAttemptPlay();
        videoEl.removeEventListener('loadedmetadata', onLoaded);
      };
      videoEl.addEventListener('loadedmetadata', onLoaded);
    } else {
      setResolveError('HLS video playback is not supported in this browser.');
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamData]);

  // 3. Persist watch history periodically
  useEffect(() => {
    const historyId = `${lecture.batchId}-${lecture.videoId}`;
    const saveNow = () => {
      const vid = videoRef.current;
      const cur = vid ? Math.floor(vid.currentTime) : Math.floor(currentTime);
      const dur = vid && vid.duration ? Math.floor(vid.duration) : Math.floor(duration) || 3600;
      saveWatchHistory({
        id: historyId,
        batchId: lecture.batchId,
        batchName: lecture.batchName,
        subjectId: lecture.subjectId,
        topicId: lecture.topicId,
        videoId: lecture.videoId,
        videoType: lecture.videoType,
        playType: lecture.playType,
        title: lecture.title,
        videoUrl: lecture.rawVideoUrl,
        duration: dur,
        progressSeconds: cur,
        progressPercent: dur > 0 ? Math.round((cur / dur) * 100) : 0,
      });
    };

    saveNow();
    const timer = setInterval(saveNow, 5000);
    return () => {
      clearInterval(timer);
      saveNow();
    };
  }, [lecture, duration]);

  // 4. Sleep timer
  useEffect(() => {
    if (sleepTimerMinutes === null) return;
    const timer = setTimeout(() => {
      videoRef.current?.pause();
      setSleepTimerMinutes(null);
    }, sleepTimerMinutes * 60 * 1000);
    return () => clearTimeout(timer);
  }, [sleepTimerMinutes]);

  // Sync speed & mute
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const togglePlayPause = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          setIsPlaying(false);
          setControlsVisible(true);
        });
    } else {
      vid.pause();
      setIsPlaying(false);
    }
    revealControls();
  }, [revealControls]);

  const seekBy = useCallback(
    (delta: number) => {
      const vid = videoRef.current;
      if (!vid) return;
      const next = Math.max(0, Math.min(vid.duration || 0, vid.currentTime + delta));
      vid.currentTime = next;
      setCurrentTime(next);
      setSeekToast(delta > 0 ? `+${delta}s` : `${delta}s`);
      if (seekFeedbackTimerRef.current) window.clearTimeout(seekFeedbackTimerRef.current);
      seekFeedbackTimerRef.current = window.setTimeout(() => setSeekToast(null), 650);
      revealControls();
    },
    [revealControls]
  );

  const handleQualityChange = (lvlIndex: number) => {
    setCurrentLevel(lvlIndex);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = lvlIndex;
    }
    setShowQualityMenu(false);
    revealControls();
  };

  const togglePiP = async () => {
    const vid = videoRef.current;
    if (!vid) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await vid.requestPictureInPicture();
      }
    } catch {
      // ignore if unsupported
    }
  };

  const enterLandscapeFullscreen = async () => {
    setIsFullscreen(true);
    setForceCssLandscape(true);
    setControlsVisible(true);
    const el: any = containerRef.current;
    try {
      if (el?.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el?.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
    } catch {
      // CSS landscape fallback works automatically
    }
    try {
      await (screen.orientation as any)?.lock?.('landscape');
    } catch {
      // CSS rotate handles portrait viewports
    }
  };

  const exitLandscapeFullscreen = async () => {
    setIsFullscreen(false);
    setForceCssLandscape(false);
    setFillMode('contain');
    setControlsVisible(true);
    try {
      (screen.orientation as any)?.unlock?.();
    } catch {
      // ignore
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if ((document as any).webkitFullscreenElement) {
        await (document as any).webkitExitFullscreen?.();
      }
    } catch {
      // ignore
    }
  };

  const toggleFullscreen = useCallback(() => {
    if (isImmersiveFullscreen) {
      exitLandscapeFullscreen();
    } else {
      enterLandscapeFullscreen();
    }
  }, [isImmersiveFullscreen]);

  const toggleLandscapeRotate = async () => {
    if (forceCssLandscape) {
      setForceCssLandscape(false);
      setIsFullscreen(Boolean(document.fullscreenElement));
      try {
        (screen.orientation as any)?.unlock?.();
      } catch {
        // ignore
      }
    } else {
      await enterLandscapeFullscreen();
    }
  };

  // Keyboard shortcuts (Space/K play-pause, J/Left -10s, L/Right +10s, M mute, F fullscreen)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'j') {
        e.preventDefault();
        seekBy(-10);
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'l') {
        e.preventDefault();
        seekBy(10);
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setIsMuted((prev) => !prev);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlayPause, seekBy, toggleFullscreen]);

  const formatTime = (secs: number) => {
    if (!secs || !isFinite(secs)) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const attachments = streamData?.attachments || [];
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const isHudVisible = controlsVisible || !isPlaying || showSpeedMenu || showQualityMenu || showSleepMenu;

  return (
    <div
      ref={containerRef}
      onMouseMove={revealControls}
      style={
        isCssRotatedLandscape
          ? {
              width: '100dvh',
              height: '100dvw',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%) rotate(90deg)',
            }
          : undefined
      }
      className={`fixed z-50 flex flex-col bg-black text-white overflow-hidden select-none ${
        isCssRotatedLandscape ? 'origin-center' : 'inset-0 h-[100dvh] w-full'
      }`}
    >
      {/* Netflix-Style Full-Bleed Cinema Viewport */}
      <div
        onClick={() => {
          if (streamData?.isYoutube || resolving || resolveError) return;
          setControlsVisible((prev) => {
            const next = !prev;
            if (next) scheduleAutoHide();
            return next;
          });
        }}
        className="relative flex flex-1 items-center justify-center bg-black overflow-hidden"
      >
        {/* Top Netflix Gradient Scrim Bar */}
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-0 left-0 right-0 z-20 flex h-16 sm:h-20 items-center justify-between gap-3 px-3 sm:px-6 bg-gradient-to-b from-black/95 via-black/60 to-transparent transition-all duration-300 ${
            isHudVisible || resolving || resolveError || streamData?.isYoutube
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 -translate-y-4 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => {
                if (isImmersiveFullscreen) {
                  exitLandscapeFullscreen();
                } else {
                  onBack();
                }
              }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/45 text-white border border-white/15 hover:bg-white/20 active:scale-95 transition backdrop-blur-md"
              title={isImmersiveFullscreen ? 'Exit Fullscreen' : 'Back'}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="hidden sm:inline-flex shrink-0 items-center rounded bg-[#E50914] px-1.5 py-0.5 font-['Sora'] text-[10px] font-black uppercase tracking-wider text-white">
                  {lecture.offlineId ? 'Offline' : 'HD'}
                </span>
                <h2 className="font-['Sora'] text-sm sm:text-base font-bold tracking-tight text-white truncate">
                  {lecture.title}
                </h2>
              </div>
              <span className="text-[11px] sm:text-xs font-medium text-neutral-300/90 truncate">
                {lecture.batchName || 'VidCloud Stream'}
                {lecture.subjectName ? ` • ${lecture.subjectName}` : ''}
              </span>
            </div>
          </div>

          {/* Top Right Netflix Tools (AI ONLY here during lecture!) */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={() => {
                setShowAiDrawer((prev) => !prev);
                setShowNotesDrawer(false);
                revealControls();
              }}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs sm:text-sm font-bold transition whitespace-nowrap backdrop-blur-md border ${
                showAiDrawer
                  ? 'bg-[#E50914] border-[#E50914] text-white shadow-[0_0_20px_rgba(229,9,20,0.45)]'
                  : 'bg-black/50 border-white/20 text-white hover:bg-white/20'
              }`}
              title="Ask Study AI about this lecture"
            >
              <Sparkles className="h-4 w-4 text-amber-300" />
              <span>Ask AI</span>
            </button>

            {!lecture.offlineId && !streamData?.isYoutube && (
              <button
                onClick={() => {
                  openLectureDownloadModal({
                    batchId: lecture.batchId,
                    programId: lecture.programId,
                    subjectId: lecture.subjectId,
                    topicId: lecture.topicId,
                    videoId: lecture.videoId,
                    findKey: lecture.findKey,
                    videoDetailsId: lecture.videoDetailsId,
                    typeId: lecture.typeId,
                    title: lecture.title,
                    videoImg: lecture.videoImg,
                    videoType: lecture.videoType || 'new',
                    playType: lecture.playType || 'Lecture',
                    rawVideoUrl: lecture.rawVideoUrl,
                    resolvedStream: streamData,
                  });
                }}
                className="flex h-10 items-center gap-1.5 rounded-full bg-black/50 border border-white/20 px-3 text-xs font-bold text-emerald-300 hover:bg-white/20 transition backdrop-blur-md"
                title="Download Lecture (MP4 / Audio)"
              >
                <Download className="h-4 w-4" />
                <span className="hidden md:inline">Download</span>
              </button>
            )}

            <button
              onClick={() => {
                const nextState = toggleLectureCompleted({
                  batchId: lecture.batchId,
                  subjectId: lecture.subjectId,
                  topicId: lecture.topicId,
                  videoId: lecture.videoId,
                  title: lecture.title,
                });
                setCompleted(isLectureCompleted(lecture.batchId, lecture.videoId, nextState));
                onAdventureUpdate?.();
              }}
              className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold transition whitespace-nowrap backdrop-blur-md border ${
                completed
                  ? 'bg-emerald-600/90 border-emerald-400/50 text-white'
                  : 'bg-black/50 border-white/20 text-neutral-200 hover:bg-white/20'
              }`}
              title={completed ? 'Stage Completed (+50 XP)' : 'Mark Lecture Complete (+50 XP)'}
            >
              <CheckCircle2 className="h-4 w-4" />
              <span className="hidden lg:inline">{completed ? 'Cleared' : 'Complete'}</span>
            </button>

            {!streamData?.isYoutube && (
              <button
                onClick={() => setIsAudioOnly(!isAudioOnly)}
                className={`hidden sm:flex h-10 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition backdrop-blur-md border ${
                  isAudioOnly
                    ? 'bg-emerald-600 border-emerald-400 text-white'
                    : 'bg-black/50 border-white/20 text-neutral-200 hover:bg-white/20'
                }`}
                title="Audio-Only Mode"
              >
                <Headphones className="h-4 w-4" />
              </button>
            )}

            {/* Sleep Timer */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setShowSleepMenu(!showSleepMenu)}
                className={`flex h-10 w-10 items-center justify-center rounded-full border transition backdrop-blur-md ${
                  sleepTimerMinutes
                    ? 'bg-[#E50914] border-[#E50914] text-white'
                    : 'bg-black/50 border-white/20 text-neutral-200 hover:bg-white/20'
                }`}
                title="Sleep Timer"
              >
                <Moon className="h-4 w-4" />
              </button>
              {showSleepMenu && (
                <div className="absolute right-0 top-12 z-50 w-44 rounded-xl border border-white/15 bg-neutral-950/95 p-2 shadow-2xl backdrop-blur-lg text-xs">
                  <div className="px-2 py-1 font-bold text-neutral-400">Sleep Timer</div>
                  {[15, 30, 45, 60].map((mins) => (
                    <button
                      key={mins}
                      onClick={() => {
                        setSleepTimerMinutes(mins);
                        setShowSleepMenu(false);
                      }}
                      className={`w-full rounded-lg px-2.5 py-2 text-left font-medium transition ${
                        sleepTimerMinutes === mins
                          ? 'bg-[#E50914] text-white'
                          : 'text-neutral-200 hover:bg-white/10'
                      }`}
                    >
                      {mins} minutes
                    </button>
                  ))}
                  {sleepTimerMinutes !== null && (
                    <button
                      onClick={() => {
                        setSleepTimerMinutes(null);
                        setShowSleepMenu(false);
                      }}
                      className="mt-1 w-full rounded-lg px-2.5 py-2 text-left text-red-400 hover:bg-red-500/10"
                    >
                      Turn off timer
                    </button>
                  )}
                </div>
              )}
            </div>

            {!streamData?.isYoutube && (
              <button
                onClick={togglePiP}
                className="hidden md:flex h-10 w-10 items-center justify-center rounded-full bg-black/50 border border-white/20 text-neutral-200 hover:bg-white/20 transition backdrop-blur-md"
                title="Picture in Picture"
              >
                <PictureInPicture2 className="h-4 w-4" />
              </button>
            )}

            <button
              onClick={toggleLandscapeRotate}
              className={`flex h-10 w-10 items-center justify-center rounded-full border transition backdrop-blur-md ${
                forceCssLandscape
                  ? 'bg-[#E50914] border-[#E50914] text-white'
                  : 'bg-black/50 border-white/20 text-white hover:bg-white/20'
              }`}
              title="Rotate Video to Landscape"
            >
              <Smartphone className="h-4 w-4 -rotate-90" />
            </button>
          </div>
        </div>

        {resolving ? (
          <div className="flex flex-col items-center gap-3.5 text-center p-6">
            <Loader2 className="h-12 w-12 animate-spin text-[#E50914]" />
            <p className="font-['Sora'] text-base sm:text-lg font-bold text-white tracking-tight">
              Loading secure lecture stream...
            </p>
            <p className="text-xs sm:text-sm text-neutral-400">
              Preparing adaptive HD video playback
            </p>
          </div>
        ) : resolveError ? (
          <div className="flex flex-col items-center gap-3.5 text-center p-6 max-w-md">
            <AlertTriangle className="h-12 w-12 text-[#E50914]" />
            <h3 className="font-['Sora'] text-lg font-bold text-white">
              Could Not Play Video
            </h3>
            <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed">{resolveError}</p>
            <div className="flex flex-wrap justify-center gap-2.5 mt-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  loadStream();
                }}
                className="rounded-md bg-[#E50914] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#f40612] transition shadow-lg"
              >
                Retry Stream
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onBack();
                }}
                className="rounded-md border border-white/20 bg-white/10 px-6 py-2.5 text-sm font-bold text-white hover:bg-white/20 transition"
              >
                Go Back
              </button>
            </div>
          </div>
        ) : streamData?.isYoutube ? (
          <iframe
            src={streamData.youtubeEmbedUrl}
            title={lecture.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="h-full w-full border-none pt-16"
          />
        ) : (
          <>
            {/* Real HTML5 Video Element */}
            <video
              ref={videoRef}
              playsInline
              onPlay={() => {
                setIsPlaying(true);
                setIsBuffering(false);
              }}
              onPause={() => setIsPlaying(false)}
              onWaiting={() => setIsBuffering(true)}
              onPlaying={() => {
                setIsPlaying(true);
                setIsBuffering(false);
              }}
              onCanPlay={() => setIsBuffering(false)}
              onError={() => {
                if (streamData?.isDirectMp4) {
                  setResolveError('Offline or direct video file could not be played.');
                }
              }}
              onProgress={(e) => {
                const vid = e.currentTarget;
                if (vid.duration && vid.buffered.length > 0) {
                  const end = vid.buffered.end(vid.buffered.length - 1);
                  setBufferedPercent(Math.min(100, (end / vid.duration) * 100));
                }
              }}
              onTimeUpdate={(e) => {
                const vid = e.currentTarget;
                const cur = vid.currentTime;
                const dur = vid.duration || 0;
                setCurrentTime(cur);
                if (dur > 0 && vid.buffered.length > 0) {
                  const end = vid.buffered.end(vid.buffered.length - 1);
                  setBufferedPercent(Math.min(100, (end / dur) * 100));
                }
                if (dur > 0 && cur / dur >= 0.8 && !completed) {
                  markLectureCompleted({
                    batchId: lecture.batchId,
                    subjectId: lecture.subjectId,
                    topicId: lecture.topicId,
                    videoId: lecture.videoId,
                    title: lecture.title,
                  });
                  setCompleted(true);
                  onAdventureUpdate?.();
                }
              }}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
              className={`h-full w-full cursor-pointer ${
                fillMode === 'cover' ? 'object-cover' : 'object-contain'
              } ${isAudioOnly ? 'opacity-0 pointer-events-none absolute inset-0' : ''}`}
            />

            {/* Netflix-Style Center Transport Controls (Always shown when paused or HUD visible!) */}
            {(isHudVisible || !isPlaying) && !isAudioOnly && !isBuffering && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="pointer-events-auto absolute z-10 flex items-center gap-7 sm:gap-12 transition-opacity duration-200"
              >
                <button
                  onClick={() => seekBy(-10)}
                  className="group relative flex h-13 w-13 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md border border-white/25 hover:bg-white/20 active:scale-90 transition"
                  title="Rewind 10s"
                >
                  <RotateCcw className="h-6 w-6 sm:h-7 sm:w-7" />
                  <span className="absolute -bottom-5 text-[10px] font-bold text-neutral-300 opacity-0 group-hover:opacity-100 transition">
                    -10s
                  </span>
                </button>

                <button
                  onClick={togglePlayPause}
                  className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-full bg-[#E50914] text-white shadow-[0_0_36px_rgba(229,9,20,0.65)] hover:bg-[#f40612] hover:scale-105 active:scale-95 transition"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="h-8 w-8 sm:h-10 sm:w-10 fill-current" />
                  ) : (
                    <Play className="h-8 w-8 sm:h-10 sm:w-10 fill-current ml-1" />
                  )}
                </button>

                <button
                  onClick={() => seekBy(10)}
                  className="group relative flex h-13 w-13 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md border border-white/25 hover:bg-white/20 active:scale-90 transition"
                  title="Forward 10s"
                >
                  <RotateCw className="h-6 w-6 sm:h-7 sm:w-7" />
                  <span className="absolute -bottom-5 text-[10px] font-bold text-neutral-300 opacity-0 group-hover:opacity-100 transition">
                    +10s
                  </span>
                </button>
              </div>
            )}

            {/* Quick Seek Indicator Toast */}
            {seekToast && (
              <div className="pointer-events-none absolute top-24 z-20 rounded-full bg-black/80 border border-white/15 px-4 py-1.5 font-mono text-xs sm:text-sm font-bold text-white backdrop-blur-md shadow-xl">
                {seekToast}
              </div>
            )}

            {/* Buffering Spinner */}
            {isBuffering && !isAudioOnly && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
                <Loader2 className="h-12 w-12 animate-spin text-[#E50914]" />
              </div>
            )}

            {/* Audio-Only Overlay */}
            {isAudioOnly && (
              <div className="flex flex-col items-center justify-center p-6 text-center z-10">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#E50914]/20 border border-[#E50914]/50 shadow-2xl">
                  <Headphones className="h-12 w-12 text-[#E50914] animate-pulse" />
                </div>
                <h3 className="mt-6 font-['Sora'] text-lg sm:text-xl font-bold text-white max-w-md">
                  {lecture.title}
                </h3>
                <p className="mt-1 text-xs sm:text-sm text-emerald-400 font-semibold">
                  Audio-Only Mode Active • Saving Battery &amp; Data
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAudioOnly(false);
                  }}
                  className="mt-5 rounded-md bg-[#E50914] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#f40612] transition"
                >
                  Turn Video Back On
                </button>
              </div>
            )}

            {/* Bottom Netflix Control Scrim */}
            <div
              onClick={(e) => e.stopPropagation()}
              className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-3 sm:px-6 pb-3.5 sm:pb-5 pt-10 transition-all duration-300 ${
                isHudVisible
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-4 pointer-events-none'
              }`}
            >
              {/* Netflix Red Scrub Bar */}
              <div className="flex items-center gap-3 mb-3">
                <div
                  onMouseMove={(e) => {
                    if (!duration) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    setHoverTime({ ratio, time: ratio * duration });
                  }}
                  onMouseLeave={() => setHoverTime(null)}
                  onClick={(e) => {
                    const vid = videoRef.current;
                    if (!vid || !duration) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    vid.currentTime = ratio * duration;
                    setCurrentTime(ratio * duration);
                    revealControls();
                  }}
                  className="group relative flex-1 h-1.5 hover:h-2.5 cursor-pointer rounded-full bg-white/25 transition-all"
                >
                  {hoverTime && (
                    <div
                      className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-neutral-900/95 border border-white/15 px-2 py-0.5 font-mono text-[11px] font-bold text-white shadow-lg"
                      style={{ left: `${hoverTime.ratio * 100}%` }}
                    >
                      {formatTime(hoverTime.time)}
                    </div>
                  )}
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-white/35 pointer-events-none"
                    style={{ width: `${bufferedPercent}%` }}
                  />
                  <div
                    className="relative h-full rounded-full bg-[#E50914]"
                    style={{ width: `${progressPercent}%` }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 -ml-1.5 rounded-full bg-[#E50914] ring-2 ring-white shadow-md transition-transform group-hover:scale-125"
                    style={{ left: `${progressPercent}%` }}
                  />
                </div>
                <span className="font-mono text-[11px] sm:text-xs font-semibold tabular-nums text-neutral-200 shrink-0">
                  {formatTime(currentTime)} <span className="text-neutral-500">/</span> {formatTime(duration)}
                </span>
              </div>

              {/* Bottom Controls Row */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 sm:gap-2.5">
                  <button
                    onClick={togglePlayPause}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/15 active:scale-95 transition"
                    title={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? (
                      <Pause className="h-5 w-5 fill-current" />
                    ) : (
                      <Play className="h-5 w-5 fill-current ml-0.5" />
                    )}
                  </button>

                  <button
                    onClick={() => seekBy(-10)}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-200 hover:bg-white/15 hover:text-white active:scale-95 transition"
                    title="Rewind 10s"
                  >
                    <RotateCcw className="h-5 w-5" />
                  </button>

                  <button
                    onClick={() => seekBy(10)}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-200 hover:bg-white/15 hover:text-white active:scale-95 transition"
                    title="Forward 10s"
                  >
                    <RotateCw className="h-5 w-5" />
                  </button>

                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-200 hover:bg-white/15 hover:text-white transition"
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? <VolumeX className="h-5 w-5 text-[#E50914]" /> : <Volume2 className="h-5 w-5" />}
                  </button>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2">
                  {/* Fit vs Fill */}
                  <button
                    onClick={() => {
                      setFillMode((prev) => (prev === 'contain' ? 'cover' : 'contain'));
                      revealControls();
                    }}
                    className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      fillMode === 'cover'
                        ? 'bg-[#E50914] text-white'
                        : 'text-neutral-200 hover:bg-white/15'
                    }`}
                    title="Toggle Fit / Fill Screen"
                  >
                    <Expand className="h-3.5 w-3.5" />
                    <span className="hidden xs:inline">{fillMode === 'cover' ? 'Fill' : 'Fit'}</span>
                  </button>

                  {/* Quality Picker */}
                  {qualityLevels.length > 0 && (
                    <div className="relative">
                      <button
                        onClick={() => {
                          setShowQualityMenu(!showQualityMenu);
                          setShowSpeedMenu(false);
                          revealControls();
                        }}
                        className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-neutral-200 hover:bg-white/15 transition"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-400" />
                        <span>
                          {currentLevel === -1
                            ? 'Auto'
                            : qualityLevels.find((q) => q.index === currentLevel)?.label || 'Auto'}
                        </span>
                      </button>
                      {showQualityMenu && (
                        <div className="absolute right-0 bottom-12 z-50 w-32 rounded-xl border border-white/15 bg-neutral-950/95 p-1.5 shadow-2xl backdrop-blur-lg">
                          <button
                            onClick={() => handleQualityChange(-1)}
                            className={`w-full rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${
                              currentLevel === -1
                                ? 'bg-[#E50914] text-white'
                                : 'text-neutral-200 hover:bg-white/10'
                            }`}
                          >
                            Auto
                          </button>
                          {qualityLevels.map((lvl) => (
                            <button
                              key={lvl.index}
                              onClick={() => handleQualityChange(lvl.index)}
                              className={`w-full rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${
                                currentLevel === lvl.index
                                  ? 'bg-[#E50914] text-white'
                                  : 'text-neutral-200 hover:bg-white/10'
                              }`}
                            >
                              {lvl.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Speed Picker */}
                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowSpeedMenu(!showSpeedMenu);
                        setShowQualityMenu(false);
                        revealControls();
                      }}
                      className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-neutral-200 hover:bg-white/15 transition"
                    >
                      <Gauge className="h-3.5 w-3.5 text-neutral-300" />
                      <span>{playbackSpeed}x</span>
                    </button>
                    {showSpeedMenu && (
                      <div className="absolute right-0 bottom-12 z-50 w-28 rounded-xl border border-white/15 bg-neutral-950/95 p-1.5 shadow-2xl backdrop-blur-lg max-h-52 overflow-y-auto">
                        {speedOptions.map((spd) => (
                          <button
                            key={spd}
                            onClick={() => {
                              setPlaybackSpeed(spd);
                              setShowSpeedMenu(false);
                              revealControls();
                            }}
                            className={`w-full rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${
                              playbackSpeed === spd
                                ? 'bg-[#E50914] text-white'
                                : 'text-neutral-200 hover:bg-white/10'
                            }`}
                          >
                            {spd}x
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Notes Button */}
                  <button
                    onClick={() => {
                      setShowNotesDrawer(!showNotesDrawer);
                      setShowAiDrawer(false);
                      revealControls();
                    }}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      showNotesDrawer
                        ? 'bg-[#E50914] text-white'
                        : 'text-neutral-200 hover:bg-white/15'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span className="hidden xs:inline">Notes ({attachments.length})</span>
                  </button>

                  {/* Fullscreen Quick Toggle */}
                  <button
                    onClick={toggleFullscreen}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/15 transition"
                    title={isImmersiveFullscreen ? 'Exit Fullscreen' : 'Landscape Fullscreen'}
                  >
                    {isImmersiveFullscreen ? (
                      <Minimize2 className="h-5 w-5" />
                    ) : (
                      <Maximize2 className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Attachments / Notes Drawer */}
        {showNotesDrawer && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 bottom-0 z-30 w-full max-w-md border-l border-white/15 bg-neutral-950/95 p-4 backdrop-blur-xl flex flex-col"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-[#E50914]" />
                <h4 className="font-['Sora'] text-sm sm:text-base font-bold text-white">
                  Lecture Notes &amp; Attachments
                </h4>
              </div>
              <button
                onClick={() => setShowNotesDrawer(false)}
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3 flex-1 overflow-y-auto space-y-2.5">
              {attachments.length === 0 ? (
                <p className="text-xs sm:text-sm text-neutral-400 py-6 text-center">
                  No PDF attachments linked directly to this lecture. Check the Chapter Notes tab!
                </p>
              ) : (
                attachments.map((att, i) => {
                  const rawHref = resolveAttachmentUrl(att);
                  const fileName = att.name || `Attachment ${i + 1}.pdf`;
                  if (!rawHref) {
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3.5 text-xs sm:text-sm opacity-70"
                      >
                        <span className="font-semibold text-white truncate pr-2">
                          {fileName}
                        </span>
                        <span className="text-xs text-neutral-400 shrink-0">Unavailable</span>
                      </div>
                    );
                  }
                  const isDownloading = downloadingAttIdx === i;
                  const isDone = downloadedAttIdx === i;
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 p-3.5 text-xs sm:text-sm hover:border-[#E50914]/50 transition"
                    >
                      <span className="font-semibold text-white truncate pr-2 flex-1">
                        {fileName}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openPdfViewer(rawHref, fileName)}
                          className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-neutral-200 hover:bg-white/20 transition"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          disabled={isDownloading}
                          onClick={async () => {
                            setDownloadingAttIdx(i);
                            try {
                              await downloadPdfFile(rawHref, fileName);
                              setDownloadedAttIdx(i);
                              setTimeout(() => setDownloadedAttIdx(null), 2500);
                            } catch {
                              window.location.assign(buildPdfProxyUrl(rawHref, fileName, true));
                            } finally {
                              setDownloadingAttIdx(null);
                            }
                          }}
                          className="flex items-center gap-1 rounded-lg bg-[#E50914] px-3 py-2 text-xs font-bold text-white hover:bg-[#f40612] disabled:opacity-60 transition"
                        >
                          {isDownloading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : isDone ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          <span>{isDone ? 'Saved' : 'PDF'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* In-Player Study AI Doubt Drawer (AI ONLY during lecture) */}
        {showAiDrawer && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 bottom-0 z-30 w-full max-w-md border-l border-white/15 shadow-2xl"
          >
            <StudyAiPanel
              variant="drawer"
              scopeKey={`lecture:${lecture.batchId}:${lecture.videoId}`}
              context={{
                batchName: lecture.batchName,
                subjectName: lecture.subjectName,
                topicName: lecture.topicName,
                lectureTitle: lecture.title,
              }}
              onClose={() => setShowAiDrawer(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
