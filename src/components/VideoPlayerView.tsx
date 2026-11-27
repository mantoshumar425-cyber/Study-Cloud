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
  FileText,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Loader2,
  AlertTriangle,
  PictureInPicture2,
  Download,
  X,
  CheckCircle2,
  Smartphone,
  Expand,
  Lock,
  Unlock,
  MoreVertical,
  Settings,
  List,
  Captions,
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
  const scrubBarRef = useRef<HTMLDivElement>(null);

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
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

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
  const [currentLevel, setCurrentLevel] = useState<number>(-1);

  // Captions & Subtitles
  const [subtitleTracks, setSubtitleTracks] = useState<Array<{ id: number; name: string; lang?: string }>>([]);
  const [activeSubtitleTrack, setActiveSubtitleTrack] = useState<number>(-1);
  const [captionsEnabled, setCaptionsEnabled] = useState<boolean>(false);
  const [customSubtitleUrl, setCustomSubtitleUrl] = useState<string | null>(null);
  const [customSubtitleName, setCustomSubtitleName] = useState<string>('');
  const customSubtitleRef = useRef<string | null>(null);
  const subtitleFileInputRef = useRef<HTMLInputElement>(null);

  // Popups & Drawers
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
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
      if (customSubtitleRef.current) {
        URL.revokeObjectURL(customSubtitleRef.current);
        customSubtitleRef.current = null;
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

  const scheduleAutoHide = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (
      !isPlaying ||
      resolving ||
      Boolean(resolveError) ||
      showSettingsMenu ||
      showMoreMenu ||
      showNotesDrawer ||
      showAiDrawer
    ) {
      setControlsVisible(true);
      return;
    }
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 3400);
  }, [isPlaying, resolving, resolveError, showSettingsMenu, showMoreMenu, showNotesDrawer, showAiDrawer]);

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

  // 1. Resolve real stream (or load offline saved Blob) on mount
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
        const hlsSubs = (hls.subtitleTracks || []).map((t: any, idx: number) => ({
          id: idx,
          name: t.name || t.lang || `Subtitle ${idx + 1}`,
          lang: t.lang,
        }));
        setSubtitleTracks(hlsSubs);
        if (lecture.resumeSeconds && lecture.resumeSeconds > 5) {
          videoEl.currentTime = lecture.resumeSeconds;
        }
        safeAttemptPlay();
      });

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
        const list = (data.subtitleTracks || []).map((t: any, idx: number) => ({
          id: idx,
          name: t.name || t.lang || `Subtitle ${idx + 1}`,
          lang: t.lang,
        }));
        setSubtitleTracks(list);
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

  // Sync captions/subtitles across HLS & native <video> textTracks
  useEffect(() => {
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = captionsEnabled ? Math.max(0, activeSubtitleTrack) : -1;
      hlsRef.current.subtitleDisplay = captionsEnabled;
    }
    const vid = videoRef.current;
    if (vid && vid.textTracks) {
      for (let i = 0; i < vid.textTracks.length; i++) {
        const tr = vid.textTracks[i];
        tr.mode = captionsEnabled ? 'showing' : 'hidden';
      }
    }
  }, [captionsEnabled, activeSubtitleTrack, customSubtitleUrl]);

  const handleLoadSubtitleFile = async (file: File) => {
    try {
      let text = await file.text();
      if (file.name.toLowerCase().endsWith('.srt') && !text.trimStart().startsWith('WEBVTT')) {
        text =
          'WEBVTT\n\n' +
          text
            .replace(/\r+/g, '')
            .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      }
      const blob = new Blob([text], { type: 'text/vtt' });
      const url = URL.createObjectURL(blob);
      if (customSubtitleRef.current) {
        URL.revokeObjectURL(customSubtitleRef.current);
      }
      customSubtitleRef.current = url;
      setCustomSubtitleUrl(url);
      setCustomSubtitleName(file.name);
      setCaptionsEnabled(true);
      setShowSettingsMenu(false);
    } catch {
      // ignore invalid subtitle file
    }
  };

  const toggleCaptions = () => {
    if (captionsEnabled) {
      setCaptionsEnabled(false);
    } else if (subtitleTracks.length > 0 || customSubtitleUrl || (videoRef.current?.textTracks?.length || 0) > 0) {
      if (activeSubtitleTrack < 0 && subtitleTracks.length > 0) {
        setActiveSubtitleTrack(0);
      }
      setCaptionsEnabled(true);
    } else {
      setShowSettingsMenu(true);
    }
    revealControls();
  };

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

  const cycleSpeed = () => {
    const idx = speedOptions.indexOf(playbackSpeed);
    const next = speedOptions[(idx + 1) % speedOptions.length];
    setPlaybackSpeed(next);
    revealControls();
  };

  const handleQualityChange = (lvlIndex: number) => {
    setCurrentLevel(lvlIndex);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = lvlIndex;
    }
    setShowSettingsMenu(false);
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

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isLocked) return;
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
  }, [isLocked, togglePlayPause, seekBy, toggleFullscreen]);

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
  const effectiveTime = scrubTime !== null ? scrubTime : currentTime;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (effectiveTime / duration) * 100)) : 0;
  const isHudVisible =
    !isLocked && (controlsVisible || !isPlaying || showSettingsMenu || showMoreMenu || isScrubbing);

  const getScrubRatio = useCallback(
    (clientX: number, clientY: number) => {
      const bar = scrubBarRef.current;
      if (!bar) return 0;
      const rect = bar.getBoundingClientRect();
      if (isCssRotatedLandscape) {
        if (!rect.height) return 0;
        return Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      }
      if (!rect.width) return 0;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    },
    [isCssRotatedLandscape]
  );

  const handleScrubPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!duration) return;
      e.preventDefault();
      e.stopPropagation();

      const updateAtPointer = (clientX: number, clientY: number, commit: boolean) => {
        const ratio = getScrubRatio(clientX, clientY);
        const targetTime = ratio * duration;
        setScrubTime(targetTime);
        setHoverTime({ ratio, time: targetTime });
        if (commit && videoRef.current) {
          videoRef.current.currentTime = targetTime;
          setCurrentTime(targetTime);
        }
        return targetTime;
      };

      setIsScrubbing(true);
      updateAtPointer(e.clientX, e.clientY, true);
      revealControls();

      const onMove = (ev: PointerEvent) => {
        updateAtPointer(ev.clientX, ev.clientY, true);
      };

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        updateAtPointer(ev.clientX, ev.clientY, true);
        setIsScrubbing(false);
        setScrubTime(null);
        setHoverTime(null);
        revealControls();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [duration, getScrubRatio, revealControls]
  );

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
      {/* Full-Bleed Black Viewport */}
      <div
        onClick={() => {
          setShowSettingsMenu(false);
          setShowMoreMenu(false);
          if (streamData?.isYoutube || resolving || resolveError) return;
          setControlsVisible((prev) => {
            const next = !prev;
            if (next) scheduleAutoHide();
            return next;
          });
        }}
        className="relative flex flex-1 items-center justify-center bg-black overflow-hidden"
      >
        {/* Top Minimal Header Bar (Back + Title + 3-dots menu) */}
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-0 left-0 right-0 z-20 flex h-14 sm:h-16 items-center justify-between gap-3 px-3 sm:px-5 bg-gradient-to-b from-black/90 via-black/45 to-transparent transition-all duration-200 ${
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
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white hover:bg-[#16A34A]/25 hover:text-[#4ade80] active:scale-95 transition"
              title={isImmersiveFullscreen ? 'Exit Fullscreen' : 'Back'}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h2 className="font-['Sora'] text-sm sm:text-base font-semibold tracking-tight text-white truncate">
              {lecture.title}
            </h2>
          </div>

          {/* 3-Dots Overflow Menu */}
          <div className="relative shrink-0">
            <button
              onClick={() => {
                setShowMoreMenu((prev) => !prev);
                setShowSettingsMenu(false);
                revealControls();
              }}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
                showMoreMenu
                  ? 'bg-[#16A34A] text-white'
                  : 'text-white hover:bg-[#16A34A]/25 hover:text-[#4ade80]'
              }`}
              title="More options"
            >
              <MoreVertical className="h-5 w-5" />
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-white/15 bg-neutral-950/95 p-1.5 shadow-2xl backdrop-blur-xl text-xs">
                {!lecture.offlineId && !streamData?.isYoutube && (
                  <button
                    onClick={() => {
                      setShowMoreMenu(false);
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
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-semibold text-white hover:bg-[#16A34A]/20"
                  >
                    <Download className="h-4 w-4 text-[#16A34A]" />
                    <span>Download Lecture (MP4/Audio)</span>
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
                    setShowMoreMenu(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-semibold text-white hover:bg-[#16A34A]/20"
                >
                  <CheckCircle2
                    className={`h-4 w-4 ${completed ? 'text-emerald-400' : 'text-[#16A34A]'}`}
                  />
                  <span>{completed ? 'Lecture Cleared (+50 XP)' : 'Mark Lecture Complete'}</span>
                </button>

                <button
                  onClick={() => {
                    setFillMode((prev) => (prev === 'contain' ? 'cover' : 'contain'));
                    setShowMoreMenu(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-semibold text-white hover:bg-[#16A34A]/20"
                >
                  <Expand className="h-4 w-4 text-[#16A34A]" />
                  <span>Screen Scaling: {fillMode === 'cover' ? 'Fill' : 'Fit'}</span>
                </button>

                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    toggleLandscapeRotate();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-semibold text-white hover:bg-[#16A34A]/20"
                >
                  <Smartphone className="h-4 w-4 -rotate-90 text-[#16A34A]" />
                  <span>{forceCssLandscape ? 'Exit Landscape Rotate' : 'Rotate to Landscape'}</span>
                </button>

                <div className="my-1 border-t border-white/10" />
                <div className="px-3 py-1 text-[11px] font-bold text-neutral-400 flex items-center gap-1.5">
                  <Moon className="h-3.5 w-3.5 text-[#16A34A]" />
                  <span>Sleep Timer {sleepTimerMinutes ? `(${sleepTimerMinutes}m)` : ''}</span>
                </div>
                <div className="grid grid-cols-4 gap-1 px-2 pb-1">
                  {[15, 30, 45, 60].map((mins) => (
                    <button
                      key={mins}
                      onClick={() => {
                        setSleepTimerMinutes(sleepTimerMinutes === mins ? null : mins);
                        setShowMoreMenu(false);
                      }}
                      className={`rounded-md py-1.5 font-mono text-[11px] font-bold transition ${
                        sleepTimerMinutes === mins
                          ? 'bg-[#16A34A] text-white'
                          : 'bg-white/10 text-neutral-200 hover:bg-[#16A34A]/30'
                      }`}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Left Middle Screen Lock / Unlock Button */}
        {!streamData?.isYoutube && !resolving && !resolveError && (isHudVisible || isLocked) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsLocked((prev) => !prev);
              revealControls();
            }}
            className={`absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-md transition active:scale-95 ${
              isLocked
                ? 'border-[#16A34A] bg-[#16A34A] text-white shadow-[0_0_20px_rgba(34,197,94,0.6)]'
                : 'border-white/30 bg-black/55 text-white hover:border-[#16A34A] hover:bg-[#16A34A]/85'
            }`}
            title={isLocked ? 'Unlock Player Controls' : 'Lock Screen Controls'}
          >
            {isLocked ? <Lock className="h-5 w-5" /> : <Unlock className="h-5 w-5" />}
          </button>
        )}

        {/* Loading State */}
        {resolving ? (
          <div className="flex flex-col items-center gap-3 text-center p-6">
            <Loader2 className="h-12 w-12 animate-spin text-[#16A34A]" />
            <p className="text-sm sm:text-base font-medium text-neutral-200">
              Loading Lecture...
            </p>
          </div>
        ) : resolveError ? (
          <div className="flex flex-col items-center gap-3.5 text-center p-6 max-w-md">
            <AlertTriangle className="h-12 w-12 text-[#16A34A]" />
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
                className="rounded-lg bg-[#16A34A] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#22C55E] transition shadow-lg"
              >
                Retry Stream
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onBack();
                }}
                className="rounded-lg border border-white/20 bg-white/10 px-6 py-2.5 text-sm font-bold text-white hover:bg-white/20 transition"
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
            className="h-full w-full border-none pt-14"
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
            >
              {customSubtitleUrl && (
                <track
                  kind="subtitles"
                  src={customSubtitleUrl}
                  srcLang="en"
                  label={customSubtitleName || 'Custom Captions'}
                  default={captionsEnabled}
                />
              )}
            </video>

            {/* Center Red Play Overlay when paused & not buffering */}
            {!isLocked && !isPlaying && !isBuffering && !isAudioOnly && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlayPause();
                }}
                className="pointer-events-auto absolute z-10 flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-full bg-[#16A34A] text-white shadow-[0_0_32px_rgba(34,197,94,0.65)] hover:bg-[#22C55E] hover:scale-105 active:scale-95 transition"
                title="Play Lecture"
              >
                <Play className="h-8 w-8 sm:h-9 sm:w-9 fill-current ml-1" />
              </button>
            )}

            {/* Quick Seek Toast */}
            {seekToast && (
              <div className="pointer-events-none absolute top-20 z-20 rounded-full bg-[#16A34A] px-4 py-1.5 font-mono text-xs sm:text-sm font-bold text-white shadow-xl">
                {seekToast}
              </div>
            )}

            {/* Red Buffering Spinner ("Loading Lecture...") */}
            {isBuffering && !isAudioOnly && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/35">
                <Loader2 className="h-12 w-12 animate-spin text-[#16A34A]" />
                <span className="text-xs sm:text-sm font-medium text-neutral-200">
                  Loading Lecture...
                </span>
              </div>
            )}

            {/* Audio-Only Overlay */}
            {isAudioOnly && (
              <div className="flex flex-col items-center justify-center p-6 text-center z-10">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#16A34A]/20 border border-[#16A34A] shadow-2xl">
                  <Headphones className="h-12 w-12 text-[#16A34A] animate-pulse" />
                </div>
                <h3 className="mt-5 font-['Sora'] text-lg sm:text-xl font-bold text-white max-w-md">
                  {lecture.title}
                </h3>
                <p className="mt-1 text-xs sm:text-sm text-neutral-300 font-medium">
                  Audio-Only Mode Active • Saving Battery &amp; Data
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAudioOnly(false);
                  }}
                  className="mt-5 rounded-lg bg-[#16A34A] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#22C55E] transition"
                >
                  Turn Video Back On
                </button>
              </div>
            )}

            {/* Bottom Controls Scrim (Matches screenshot layout, all buttons & accents RED!) */}
            <div
              onClick={(e) => e.stopPropagation()}
              className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-3 sm:px-6 pb-3 sm:pb-4 pt-8 transition-all duration-200 ${
                isHudVisible
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-4 pointer-events-none'
              }`}
            >
              {/* Time & Speed Row above Seek Bar */}
              <div className="flex items-center justify-between mb-1.5 px-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs sm:text-sm font-semibold tabular-nums text-white">
                    {formatTime(effectiveTime)}
                  </span>
                  <button
                    onClick={cycleSpeed}
                    className="rounded-md bg-[#16A34A] hover:bg-[#22C55E] px-2 py-0.5 font-mono text-[11px] font-bold text-white shadow-sm transition active:scale-95"
                    title="Tap to change playback speed"
                  >
                    {playbackSpeed}x
                  </button>
                </div>
                <span className="font-mono text-xs sm:text-sm font-semibold tabular-nums text-white">
                  {formatTime(duration)}
                </span>
              </div>

              {/* Draggable Red Scrub Bar (grab & drag to jump to any time) */}
              <div
                ref={scrubBarRef}
                onPointerDown={handleScrubPointerDown}
                onMouseMove={(e) => {
                  if (!duration || isScrubbing) return;
                  const ratio = getScrubRatio(e.clientX, e.clientY);
                  setHoverTime({ ratio, time: ratio * duration });
                }}
                onMouseLeave={() => {
                  if (!isScrubbing) setHoverTime(null);
                }}
                className="group relative w-full py-2 -my-1 mb-2 cursor-pointer touch-none select-none"
              >
                <div className={`relative w-full rounded-full bg-white/25 transition-all ${isScrubbing ? 'h-2.5' : 'h-1.5 group-hover:h-2.5'}`}>
                  {(hoverTime || isScrubbing) && (
                    <div
                      className="pointer-events-none absolute -top-9 -translate-x-1/2 rounded-md bg-[#16A34A] px-2.5 py-0.5 font-mono text-[11px] font-bold text-white shadow-lg"
                      style={{ left: `${(hoverTime ? hoverTime.ratio : progressPercent / 100) * 100}%` }}
                    >
                      {formatTime(hoverTime ? hoverTime.time : effectiveTime)}
                    </div>
                  )}
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-white/35 pointer-events-none"
                    style={{ width: `${bufferedPercent}%` }}
                  />
                  <div
                    className="relative h-full rounded-full bg-[#16A34A]"
                    style={{ width: `${progressPercent}%` }}
                  />
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 -ml-2 rounded-full bg-[#16A34A] ring-2 ring-white shadow-md transition-transform ${
                      isScrubbing ? 'h-4.5 w-4.5 scale-125' : 'h-3.5 w-3.5 group-hover:scale-125'
                    }`}
                    style={{ left: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Bottom Controls Row: Left [Play, -10s, +10s, Vol] | Right [Ask AI, Notes, PiP, Audio, Download, Settings, Fullscreen] */}
              <div className="flex items-center justify-between gap-2">
                {/* Left Transport Icons */}
                <div className="flex items-center gap-1.5 sm:gap-3">
                  <button
                    onClick={togglePlayPause}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[#16A34A] text-white hover:bg-[#22C55E] active:scale-95 transition shadow-[0_0_14px_rgba(34,197,94,0.55)]"
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
                    className="relative flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-[#16A34A] active:scale-95 transition"
                    title="Rewind 10s"
                  >
                    <RotateCcw className="h-5 w-5" />
                    <span className="absolute text-[8px] font-extrabold leading-none mt-0.5">10</span>
                  </button>

                  <button
                    onClick={() => seekBy(10)}
                    className="relative flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-[#16A34A] active:scale-95 transition"
                    title="Forward 10s"
                  >
                    <RotateCw className="h-5 w-5" />
                    <span className="absolute text-[8px] font-extrabold leading-none mt-0.5">10</span>
                  </button>

                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className={`flex h-10 w-10 items-center justify-center rounded-full transition active:scale-95 ${
                      isMuted
                        ? 'bg-[#16A34A] text-white'
                        : 'text-white hover:bg-[#16A34A]'
                    }`}
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                  </button>
                </div>

                {/* Right Utility Icons + Full-Circle AI Button */}
                <div className="flex items-center gap-1.5 sm:gap-2">
                  {/* AI Avatar Button (Full circle fill, zero gap, icon only) */}
                  <button
                    onClick={() => {
                      setShowAiDrawer((prev) => !prev);
                      setShowNotesDrawer(false);
                      setShowSettingsMenu(false);
                      revealControls();
                    }}
                    className={`relative flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center overflow-hidden rounded-full transition active:scale-95 ${
                      showAiDrawer
                        ? 'ring-2 ring-[#22C55E] shadow-[0_0_18px_rgba(34,197,94,0.8)]'
                        : 'ring-2 ring-[#22C55E]/85 hover:ring-[#22C55E]'
                    }`}
                    aria-label="Study Cloud AI Doubt Solver"
                    title="Study Cloud AI Doubt Solver"
                  >
                    <img
                      src="/assets/aistudio/Screenshot_2026_1126_234908_5c427dc1.png"
                      alt="Study Cloud AI"
                      className="h-full w-full rounded-full object-cover scale-[2.02] -translate-x-[1.5%]"
                    />
                  </button>

                  {/* Notes / Attachments */}
                  <button
                    onClick={() => {
                      setShowNotesDrawer((prev) => !prev);
                      setShowAiDrawer(false);
                      setShowSettingsMenu(false);
                      revealControls();
                    }}
                    className={`relative flex h-10 w-10 items-center justify-center rounded-full transition active:scale-95 ${
                      showNotesDrawer
                        ? 'bg-[#16A34A] text-white'
                        : 'text-white hover:bg-[#16A34A]'
                    }`}
                    title={`Lecture Notes (${attachments.length})`}
                  >
                    <List className="h-5 w-5" />
                    {attachments.length > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#16A34A] px-1 font-mono text-[9px] font-bold text-white ring-1 ring-black">
                        {attachments.length}
                      </span>
                    )}
                  </button>

                  {/* Picture in Picture */}
                  <button
                    onClick={togglePiP}
                    className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full text-white hover:bg-[#16A34A] transition active:scale-95"
                    title="Picture in Picture"
                  >
                    <PictureInPicture2 className="h-4 w-4 sm:h-5 sm:w-5" />
                  </button>

                  {/* Audio-Only Toggle */}
                  <button
                    onClick={() => setIsAudioOnly(!isAudioOnly)}
                    className={`flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full transition active:scale-95 ${
                      isAudioOnly
                        ? 'bg-[#16A34A] text-white'
                        : 'text-white hover:bg-[#16A34A]'
                    }`}
                    title="Audio-Only Mode"
                  >
                    <Headphones className="h-4 w-4 sm:h-5 sm:w-5" />
                  </button>

                  {/* Lecture Download */}
                  {!lecture.offlineId && (
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
                      className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full text-white hover:bg-[#16A34A] transition active:scale-95"
                      title="Download Lecture (MP4 / Audio)"
                    >
                      <Download className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                  )}

                  {/* Captions / Subtitles Toggle */}
                  <button
                    onClick={toggleCaptions}
                    className={`flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full transition active:scale-95 ${
                      captionsEnabled
                        ? 'bg-[#16A34A] text-white'
                        : 'text-white hover:bg-[#16A34A]'
                    }`}
                    title={captionsEnabled ? 'Disable Captions (CC)' : 'Captions & Subtitles (CC)'}
                  >
                    <Captions className="h-4 w-4 sm:h-5 sm:w-5" />
                  </button>

                  {/* Settings (Quality, Speed & Captions) */}
                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowSettingsMenu((prev) => !prev);
                        setShowMoreMenu(false);
                        revealControls();
                      }}
                      className={`flex h-10 w-10 items-center justify-center rounded-full transition active:scale-95 ${
                        showSettingsMenu
                          ? 'bg-[#16A34A] text-white'
                          : 'text-white hover:bg-[#16A34A]'
                      }`}
                      title="Quality, Speed & Captions"
                    >
                      <Settings className="h-5 w-5" />
                    </button>

                    <input
                      ref={subtitleFileInputRef}
                      type="file"
                      accept=".vtt,.srt,text/vtt"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleLoadSubtitleFile(file);
                        e.target.value = '';
                      }}
                    />

                    {showSettingsMenu && (
                      <div className="absolute right-0 bottom-12 z-50 w-60 rounded-xl border border-white/15 bg-neutral-950/95 p-3 shadow-2xl backdrop-blur-xl text-xs space-y-3">
                        {qualityLevels.length > 0 && (
                          <div>
                            <div className="mb-1.5 font-bold text-neutral-400 uppercase tracking-wider text-[10px]">
                              Video Quality
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                              <button
                                onClick={() => handleQualityChange(-1)}
                                className={`rounded-md py-1.5 font-semibold transition ${
                                  currentLevel === -1
                                    ? 'bg-[#16A34A] text-white'
                                    : 'bg-white/10 text-neutral-200 hover:bg-[#16A34A]/30'
                                }`}
                              >
                                Auto
                              </button>
                              {qualityLevels.map((lvl) => (
                                <button
                                  key={lvl.index}
                                  onClick={() => handleQualityChange(lvl.index)}
                                  className={`rounded-md py-1.5 font-semibold transition ${
                                    currentLevel === lvl.index
                                      ? 'bg-[#16A34A] text-white'
                                      : 'bg-white/10 text-neutral-200 hover:bg-[#16A34A]/30'
                                  }`}
                                >
                                  {lvl.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="mb-1.5 font-bold text-neutral-400 uppercase tracking-wider text-[10px]">
                            Playback Speed
                          </div>
                          <div className="grid grid-cols-3 gap-1">
                            {speedOptions.map((spd) => (
                              <button
                                key={spd}
                                onClick={() => {
                                  setPlaybackSpeed(spd);
                                  setShowSettingsMenu(false);
                                  revealControls();
                                }}
                                className={`rounded-md py-1.5 font-mono font-semibold transition ${
                                  playbackSpeed === spd
                                    ? 'bg-[#16A34A] text-white'
                                    : 'bg-white/10 text-neutral-200 hover:bg-[#16A34A]/30'
                                }`}
                              >
                                {spd}x
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="mb-1.5 flex items-center justify-between font-bold text-neutral-400 uppercase tracking-wider text-[10px]">
                            <span>Captions / Subtitles</span>
                            <button
                              type="button"
                              onClick={() => subtitleFileInputRef.current?.click()}
                              className="text-[#4ade80] hover:underline normal-case font-semibold"
                            >
                              + Load .VTT/.SRT
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <button
                              onClick={() => {
                                setCaptionsEnabled(false);
                                setActiveSubtitleTrack(-1);
                                setShowSettingsMenu(false);
                              }}
                              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                                !captionsEnabled
                                  ? 'bg-[#16A34A] text-white'
                                  : 'bg-white/10 text-neutral-200 hover:bg-[#16A34A]/30'
                              }`}
                            >
                              Off
                            </button>
                            {subtitleTracks.map((tr) => (
                              <button
                                key={tr.id}
                                onClick={() => {
                                  setActiveSubtitleTrack(tr.id);
                                  setCaptionsEnabled(true);
                                  setShowSettingsMenu(false);
                                }}
                                className={`rounded-md px-2.5 py-1 font-semibold transition ${
                                  captionsEnabled && activeSubtitleTrack === tr.id
                                    ? 'bg-[#16A34A] text-white'
                                    : 'bg-white/10 text-neutral-200 hover:bg-[#16A34A]/30'
                                }`}
                              >
                                {tr.name}
                              </button>
                            ))}
                            {customSubtitleUrl && (
                              <button
                                onClick={() => {
                                  setCaptionsEnabled(true);
                                  setShowSettingsMenu(false);
                                }}
                                className={`rounded-md px-2.5 py-1 font-semibold transition truncate max-w-[140px] ${
                                  captionsEnabled ? 'bg-[#16A34A] text-white' : 'bg-white/10 text-neutral-200'
                                }`}
                              >
                                {customSubtitleName || 'Uploaded CC'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Fullscreen Toggle */}
                  <button
                    onClick={toggleFullscreen}
                    className={`flex h-10 w-10 items-center justify-center rounded-full transition active:scale-95 ${
                      isImmersiveFullscreen
                        ? 'bg-[#16A34A] text-white'
                        : 'text-white hover:bg-[#16A34A]'
                    }`}
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
                <FileText className="h-5 w-5 text-[#16A34A]" />
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
                      className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 p-3.5 text-xs sm:text-sm hover:border-[#16A34A]/50 transition"
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
                          className="flex items-center gap-1 rounded-lg bg-[#16A34A] px-3 py-2 text-xs font-bold text-white hover:bg-[#22C55E] disabled:opacity-60 transition"
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

        {/* In-Player Study Cloud AI Doubt Drawer (AI ONLY during lecture) */}
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
