import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  Share2,
  Calendar,
  CalendarDays,
  BookOpen,
  GraduationCap,
  Heart,
  FileText,
  Clock,
  CheckCircle2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Layers,
  Video,
  Download,
  Compass,
  Flame,
  Trophy,
  Plus,
  Check,
  Radio,
  Eye,
  Sparkles,
  Gem,
  ClipboardCheck,
  Users,
} from 'lucide-react';
import {
  AdventureState,
  BatchExerciseItem,
  BatchItem,
  BatchSubject,
  BatchTopic,
  BatchVideoItem,
  BatchNoteItem,
  ScheduledClassItem,
  WeeklyRoutineSlot,
} from '../types';
import {
  buildPdfProxyUrl,
  downloadPdfFile,
  fetchBatchDetails,
  fetchPwBatchQuizzes,
  fetchSubjectTopics,
  fetchTodaySchedule,
  fetchTopicContents,
  fetchWeeklySchedule,
  prefetchSubjectTopics,
  prefetchVideoStream,
  resolveAttachmentUrl,
  startPwQuiz,
} from '../services/batchService';
import { getAdventureMetrics, isLectureCompleted } from '../services/adventureService';
import { openLectureDownloadModal } from '../services/lectureDownloadManager';
import { StudyAiPanel } from './StudyAiPanel';
import { KhazanaExplorer } from './KhazanaExplorer';
import { BatchTestsPanel } from './BatchTestsPanel';
import { BatchCommunityPanel } from './BatchCommunityPanel';
import { SubjectIconBadge } from './SubjectIconBadge';

export interface PlayLecturePayload {
  batchId: string;
  batchName: string;
  programId?: string;
  subjectId: string;
  subjectName: string;
  topicId: string;
  topicName: string;
  videoId: string;
  findKey?: string;
  videoDetailsId?: string;
  parentScheduleId?: string;
  typeId?: string;
  title: string;
  videoImg?: string;
  videoType: string;
  playType: string;
  rawVideoUrl?: string;
  durationText?: string;
  isLive?: boolean;
  urlType?: string;
}

interface BatchDetailsModalProps {
  batch: BatchItem | null;
  onClose: () => void;
  isFavorite: boolean;
  onToggleFavorite: (batchId: string) => void;
  adventureState: AdventureState;
  isEnrolled: boolean;
  onToggleEnroll: (batchId: string) => void;
  onToggleLectureComplete: (params: {
    batchId: string;
    subjectId: string;
    topicId: string;
    videoId: string;
    title: string;
  }) => void;
  onPlayLecture: (lecture: PlayLecturePayload) => void;
  onSelectSubBatch?: (batch: BatchItem) => void;
}

function getIstTodayStr(): string {
  const nowIst = new Date(Date.now() + 330 * 60 * 1000);
  return nowIst.toISOString().slice(0, 10);
}

function getWeekBoundsMonToSun(anchorDateStr: string): {
  startDate: string;
  endDate: string;
  days: Array<{ dateStr: string; dayShort: string; dayNum: string; weekday: number }>;
} {
  const [y, m, d] = anchorDateStr.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d));
  const dow = utcDate.getUTCDay(); // 0=Sun..6=Sat
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(utcDate.getTime() + diffToMon * 86400000);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days: Array<{ dateStr: string; dayShort: string; dayNum: string; weekday: number }> = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(mon.getTime() + i * 86400000);
    const dateStr = cur.toISOString().slice(0, 10);
    const wd = cur.getUTCDay();
    days.push({
      dateStr,
      dayShort: dayNames[wd],
      dayNum: String(cur.getUTCDate()),
      weekday: wd,
    });
  }
  return {
    startDate: days[0].dateStr,
    endDate: days[6].dateStr,
    days,
  };
}

function formatTimeRangeIst(startIso?: string, endIso?: string): string {
  if (!startIso) return 'Scheduled';
  const fmt = (iso: string) => {
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return '';
    return new Date(ts).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };
  const s = fmt(startIso);
  const e = endIso ? fmt(endIso) : '';
  return e ? `${s} – ${e}` : s;
}

function formatRelativeClassTime(startIso?: string, endIso?: string): string {
  const startTs = startIso ? Date.parse(startIso) : NaN;
  const endTs = endIso ? Date.parse(endIso) : NaN;
  if (!Number.isFinite(startTs)) return 'Today';
  const now = Date.now();
  const diffMins = Math.round((now - startTs) / 60000);
  if (diffMins < -60) {
    const h = Math.round(Math.abs(diffMins) / 60);
    return `in ${h}h`;
  }
  if (diffMins < 0) {
    return `in ${Math.abs(diffMins)}m`;
  }
  if (Number.isFinite(endTs) && now > endTs) {
    const agoEnd = Math.round((now - endTs) / 60000);
    if (agoEnd < 60) return `${Math.max(1, agoEnd)}m ago`;
    const h = Math.floor(agoEnd / 60);
    return `${h}h ago`;
  }
  if (diffMins < 60) {
    return `${Math.max(1, diffMins)}m ago`;
  }
  return `${Math.floor(diffMins / 60)}h ago`;
}

export const BatchDetailsModal: React.FC<BatchDetailsModalProps> = ({
  batch,
  onClose,
  isFavorite,
  onToggleFavorite,
  adventureState,
  isEnrolled,
  onToggleEnroll,
  onToggleLectureComplete,
  onPlayLecture,
  onSelectSubBatch,
}) => {
  const [activeTopTab, setActiveTopTab] = useState<'subjects' | 'tests' | 'khazana' | 'community' | 'schedule'>('subjects');

  // Step 1: Batch details & Subjects
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<BatchSubject[]>([]);
  const [mahapackBatches, setMahapackBatches] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [khazanaProgramId, setKhazanaProgramId] = useState<string | null>(null);

  // Today's classes & Weekly Schedule state
  const todayStr = getIstTodayStr();
  const [todayClasses, setTodayClasses] = useState<ScheduledClassItem[]>([]);
  const [loadingToday, setLoadingToday] = useState(false);
  const [selectedScheduleDate, setSelectedScheduleDate] = useState<string>(todayStr);
  const [weeklyClasses, setWeeklyClasses] = useState<ScheduledClassItem[]>([]);
  const [weeklyRoutine, setWeeklyRoutine] = useState<WeeklyRoutineSlot[]>([]);
  const [loadingWeekly, setLoadingWeekly] = useState(false);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const [scheduleSubjectFilter, setScheduleSubjectFilter] = useState<string>('all');
  const [scheduleNoticeMsg, setScheduleNoticeMsg] = useState<string | null>(null);
  const [todayScrollPct, setTodayScrollPct] = useState(32);
  const [failedTeacherImgs, setFailedTeacherImgs] = useState<Record<string, boolean>>({});

  // Step 2: Selected Subject -> Topics
  const [selectedSubject, setSelectedSubject] = useState<BatchSubject | null>(null);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [topics, setTopics] = useState<BatchTopic[]>([]);
  const [topicsPage, setTopicsPage] = useState(1);
  const [hasMoreTopics, setHasMoreTopics] = useState(false);

  // Step 3: Selected Topic -> Contents (videos, notes, DppNotes, DppVideos, exercises/DHA)
  const [selectedTopic, setSelectedTopic] = useState<BatchTopic | null>(null);
  const [contentTab, setContentTab] = useState<'videos' | 'notes' | 'DppNotes' | 'DppVideos' | 'exercises'>('videos');
  const [loadingContents, setLoadingContents] = useState(false);
  const [videos, setVideos] = useState<BatchVideoItem[]>([]);
  const [notes, setNotes] = useState<BatchNoteItem[]>([]);
  const [dppNotes, setDppNotes] = useState<BatchNoteItem[]>([]);
  const [dppVideos, setDppVideos] = useState<BatchVideoItem[]>([]);
  const [exercises, setExercises] = useState<BatchExerciseItem[]>([]);
  const [contentsError, setContentsError] = useState<string | null>(null);

  // Inline DHA Quiz CBT Overlay inside Batch Modal
  const [dhaQuizModal, setDhaQuizModal] = useState<{
    title: string;
    questions: Array<{ question: string; options: string[]; correctIndex: number; explanation: string; topic?: string }>;
  } | null>(null);
  const [launchingDhaId, setLaunchingDhaId] = useState<string | null>(null);
  const [dhaIdx, setDhaIdx] = useState(0);
  const [dhaAnswers, setDhaAnswers] = useState<Record<number, number>>({});
  const [dhaSubmitted, setDhaSubmitted] = useState(false);

  // PDF Download indicator state
  const [downloadingPdfKey, setDownloadingPdfKey] = useState<string | null>(null);
  const [downloadedPdfKey, setDownloadedPdfKey] = useState<string | null>(null);
  const [pdfDownloadError, setPdfDownloadError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const [aiInitialPrompt, setAiInitialPrompt] = useState<string | null>(null);
  const hoverVideoTimerRef = React.useRef<number | null>(null);

  const handleOpenAiWithPrompt = (prompt: string) => {
    setAiInitialPrompt(prompt);
    setShowAiDrawer(true);
  };

  // Lock background page scroll while full-screen batch view is open
  useEffect(() => {
    if (!batch) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAiDrawer) {
          setShowAiDrawer(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [batch, onClose, showAiDrawer]);

  // Load batch details & Today's Schedule when batch changes
  useEffect(() => {
    if (!batch) return;
    setSelectedSubject(null);
    setSelectedTopic(null);
    setTopics([]);
    setVideos([]);
    setNotes([]);
    setDppNotes([]);
    setDppVideos([]);
    setExercises([]);
    setDhaQuizModal(null);
    setActiveTopTab('subjects');
    setSelectedScheduleDate(getIstTodayStr());
    setScheduleSubjectFilter('all');
    setWeeklyClasses([]);
    setWeeklyRoutine([]);
    setScheduleNoticeMsg(null);
    setPdfDownloadError(null);
    setShowAiDrawer(false);
    setAiInitialPrompt(null);
    setKhazanaProgramId(null);
    setFailedTeacherImgs({});
    setTodayScrollPct(32);

    setLoadingDetails(true);
    setDetailsError(null);
    fetchBatchDetails(batch.batch_id)
      .then((res) => {
        const subjList = res.subjects || [];
        setSubjects(subjList);
        setMahapackBatches(res.mahapackBatches || []);
        setAnnouncements(res.announcements || []);
        setKhazanaProgramId(res.khazanaProgramId || res.batch?.khazanaProgramId || null);

        // Background prefetch: first 2 academic subjects' chapters & batch tests
        const acadSubjs = subjList.filter(
          (s) => (s.slug || s._id) && !/notice|guidance|orientation|planner/i.test(String(s.subject || ''))
        );
        for (const s of acadSubjs.slice(0, 2)) {
          prefetchSubjectTopics(batch.batch_id, s.slug || s._id);
        }
        void fetchPwBatchQuizzes(batch.batch_id).catch(() => {});
      })
      .catch((err) => {
        setDetailsError(err.message || 'Could not load batch subjects.');
      })
      .finally(() => {
        setLoadingDetails(false);
      });

    setLoadingToday(true);
    fetchTodaySchedule(batch.batch_id)
      .then((res) => {
        setTodayClasses(res.classes || []);
      })
      .catch(() => {
        setTodayClasses([]);
      })
      .finally(() => {
        setLoadingToday(false);
      });
  }, [batch]);

  // Load weekly schedule whenever schedule tab is active or week bounds change
  const weekBounds = getWeekBoundsMonToSun(selectedScheduleDate);
  useEffect(() => {
    if (!batch || activeTopTab !== 'schedule') return;
    let cancelled = false;
    setLoadingWeekly(true);
    setWeeklyError(null);
    fetchWeeklySchedule(batch.batch_id, weekBounds.startDate, weekBounds.endDate, 1)
      .then((res) => {
        if (cancelled) return;
        setWeeklyClasses(res.classes || []);
        setWeeklyRoutine(res.weeklyRoutine || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setWeeklyError(err?.message || 'Could not load weekly schedule.');
      })
      .finally(() => {
        if (!cancelled) setLoadingWeekly(false);
      });
    return () => {
      cancelled = true;
    };
  }, [batch, activeTopTab, weekBounds.startDate, weekBounds.endDate]);

  // Load topics when subject selected
  const handleSelectSubject = async (subj: BatchSubject) => {
    if (!batch) return;
    setSelectedSubject(subj);
    setSelectedTopic(null);
    setTopics([]);
    setTopicsPage(1);
    setLoadingTopics(true);
    try {
      const slugOrId = subj.slug || subj._id;
      const res = await fetchSubjectTopics(batch.batch_id, slugOrId, 1);
      setTopics(res.topics || []);
      setHasMoreTopics((res.topics || []).length >= 20);
    } catch (err: any) {
      setDetailsError(err.message || 'Failed to load chapters');
    } finally {
      setLoadingTopics(false);
    }
  };

  const handleLoadMoreTopics = async () => {
    if (!batch || !selectedSubject) return;
    const nextPage = topicsPage + 1;
    setLoadingTopics(true);
    try {
      const slugOrId = selectedSubject.slug || selectedSubject._id;
      const res = await fetchSubjectTopics(batch.batch_id, slugOrId, nextPage);
      const nextList = res.topics || [];
      setTopics((prev) => [...prev, ...nextList]);
      setTopicsPage(nextPage);
      setHasMoreTopics(nextList.length >= 20);
    } catch {
      setHasMoreTopics(false);
    } finally {
      setLoadingTopics(false);
    }
  };

  // Load contents when topic or contentTab changes
  const loadTopicTab = async (
    topic: BatchTopic,
    tab: 'videos' | 'notes' | 'DppNotes' | 'DppVideos' | 'exercises',
    silent = false
  ) => {
    if (!batch || !selectedSubject) return;
    if (!silent) {
      setLoadingContents(true);
      setContentsError(null);
    }
    try {
      const slugOrId = selectedSubject.slug || selectedSubject._id;
      const res = await fetchTopicContents(batch.batch_id, slugOrId, topic._id, tab, 1);
      const items = res.items || [];
      if (tab === 'videos') setVideos(items as BatchVideoItem[]);
      if (tab === 'notes') setNotes(items as BatchNoteItem[]);
      if (tab === 'DppNotes') setDppNotes(items as BatchNoteItem[]);
      if (tab === 'DppVideos') setDppVideos(items as BatchVideoItem[]);
      if (tab === 'exercises') setExercises(items as BatchExerciseItem[]);
    } catch (err: any) {
      if (!silent) setContentsError(err.message || 'Could not load chapter materials.');
    } finally {
      if (!silent) setLoadingContents(false);
    }
  };

  const handleSelectTopic = (topic: BatchTopic) => {
    setSelectedTopic(topic);
    const defaultTab: 'videos' | 'notes' =
      (topic.videos || 0) > 0 || (topic.notes || 0) === 0 ? 'videos' : 'notes';
    setContentTab(defaultTab);
    setVideos([]);
    setNotes([]);
    setDppNotes([]);
    setDppVideos([]);
    setExercises([]);
    loadTopicTab(topic, defaultTab);
    // Preload chapter DHA PDFs, DHA MCQ quizzes & DPP solution videos in background so every lecture card displays its DHA!
    void loadTopicTab(topic, 'DppNotes', true);
    void loadTopicTab(topic, 'exercises', true);
    void loadTopicTab(topic, 'DppVideos', true);
  };

  const handleSwitchContentTab = (tab: 'videos' | 'notes' | 'DppNotes' | 'DppVideos' | 'exercises') => {
    setContentTab(tab);
    if (!selectedTopic) return;
    if (tab === 'videos' && videos.length === 0) loadTopicTab(selectedTopic, 'videos');
    if (tab === 'notes' && notes.length === 0) loadTopicTab(selectedTopic, 'notes');
    if (tab === 'DppNotes' && dppNotes.length === 0) loadTopicTab(selectedTopic, 'DppNotes');
    if (tab === 'DppVideos' && dppVideos.length === 0) loadTopicTab(selectedTopic, 'DppVideos');
    if (tab === 'exercises' && exercises.length === 0) loadTopicTab(selectedTopic, 'exercises');
  };

  const handleLaunchDhaQuiz = async (
    quizId: string,
    exerciseId: string,
    quizTitle: string,
    totalQs = 10
  ) => {
    if (!batch || launchingDhaId) return;
    setLaunchingDhaId(quizId);
    try {
      const res = await startPwQuiz({
        exerciseId,
        batchName: batch.name,
        subjectName: selectedSubject?.subject || 'Subject',
        topicName: selectedTopic?.name || 'Chapter DHA',
        title: quizTitle,
        count: Math.min(10, Math.max(5, totalQs || 8)),
      });
      setDhaQuizModal({ title: quizTitle, questions: res.questions });
      setDhaIdx(0);
      setDhaAnswers({});
      setDhaSubmitted(false);
    } catch (err: any) {
      setPdfDownloadError(err?.message || 'Unable to launch this DHA quiz right now.');
    } finally {
      setLaunchingDhaId(null);
    }
  };

  if (!batch) return null;

  const batchMetrics = getAdventureMetrics(adventureState, batch.batch_id);

  const handleShare = () => {
    const shareUrl = `${window.location.origin}/?batch_id=${batch.batch_id}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const triggerPlayVideo = (vid: BatchVideoItem, isDpp = false) => {
    if (!selectedSubject || !selectedTopic) return;
    const urlType = (vid.urlType || '').toLowerCase();
    const isYt = urlType === 'youtube';
    const rawUrl = vid.videoDetails?.embedCode || vid.videoDetails?.videoUrl || vid.url || '';
    const title = vid.topic || vid.videoDetails?.name || 'Lecture Video';
    const img = vid.videoDetails?.image || '';

    onPlayLecture({
      batchId: batch.batch_id,
      batchName: batch.name,
      subjectId: selectedSubject.slug || selectedSubject._id,
      subjectName: selectedSubject.subject,
      topicId: selectedTopic._id,
      topicName: selectedTopic.name,
      videoId: vid._id,
      findKey: vid.videoDetails?.findKey,
      videoDetailsId: vid.videoDetails?.id || vid.videoDetails?._id,
      typeId: vid.typeId,
      title,
      videoImg: img,
      videoType: isYt ? 'youtube' : 'new',
      playType: isDpp ? 'solutions' : 'Lecture',
      rawVideoUrl: rawUrl,
      durationText: vid.videoDetails?.duration,
    });
  };

  const handlePdfDownload = async (itemKey: string, rawUrl: string, fileName: string) => {
    setPdfDownloadError(null);
    setDownloadingPdfKey(itemKey);
    try {
      await downloadPdfFile(rawUrl, fileName);
      setDownloadedPdfKey(itemKey);
      setTimeout(() => setDownloadedPdfKey((prev) => (prev === itemKey ? null : prev)), 2500);
    } catch {
      try {
        window.location.assign(buildPdfProxyUrl(rawUrl, fileName, true));
      } catch {
        setPdfDownloadError('Could not download this PDF right now. Try "View PDF".');
      }
    } finally {
      setDownloadingPdfKey(null);
    }
  };

  const handlePlayScheduledClass = (cls: ScheduledClassItem) => {
    if (cls.isCancelled) {
      setScheduleNoticeMsg(
        `${cls.subjectName || 'Class'}: ${cls.topic || 'This class was cancelled.'}`
      );
      return;
    }
    if (cls.liveStatus === 'UPCOMING') {
      setScheduleNoticeMsg(
        `${cls.topic} (${cls.subjectName || 'Class'}) starts at ${formatTimeRangeIst(cls.startTime, cls.endTime)} IST.`
      );
      return;
    }
    setScheduleNoticeMsg(null);
    const urlType = (cls.urlType || '').toLowerCase();
    const rawUrl =
      cls.ytStreamUrl ||
      cls.newCdnLink ||
      cls.videoDetails?.embedCode ||
      cls.videoDetails?.hls_url ||
      cls.videoDetails?.videoUrl ||
      cls.url ||
      '';
    const isYt = urlType === 'youtube' || /youtu\.?be/i.test(rawUrl);
    const subjSlug = cls.subjectSlug || cls.batchSubjectId || 'subject';
    const topicId = cls.topicId || cls.tags?.[0]?._id || cls._id;
    onPlayLecture({
      batchId: batch.batch_id,
      batchName: batch.name,
      subjectId: subjSlug,
      subjectName: cls.subjectName || 'Class',
      topicId,
      topicName: cls.topicName || cls.tags?.[0]?.name || 'Scheduled Class',
      videoId: cls._id,
      findKey: cls.videoDetails?.findKey,
      videoDetailsId: cls.videoDetails?.id || cls.videoDetails?._id,
      parentScheduleId: cls.parentScheduleId,
      typeId: cls.typeId,
      title: cls.topic || cls.videoDetails?.name || 'Scheduled Lecture',
      videoImg: cls.videoDetails?.image || '',
      videoType: isYt ? 'youtube' : 'new',
      playType: cls.isDPPVideos ? 'solutions' : 'Lecture',
      rawVideoUrl: rawUrl,
      durationText: cls.videoDetails?.duration,
      isLive: cls.liveStatus === 'LIVE',
      urlType: cls.urlType,
    });
  };

  const renderPdfList = (list: BatchNoteItem[], emptyMsg: string) => {
    if (loadingContents) {
      return (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-xs text-[var(--text-secondary)]">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--primary-color)]" />
          <span>Loading PDF materials...</span>
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-8 text-center text-xs text-[var(--text-secondary)]">
          {emptyMsg}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {pdfDownloadError && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs sm:text-sm text-amber-300">
            {pdfDownloadError}
          </div>
        )}
        {list.map((noteItem) =>
          (noteItem.homeworkIds || []).map((hw) =>
            (hw.attachmentIds || []).map((att) => {
              const itemKey = `${hw._id}-${att._id}`;
              const directUrl = resolveAttachmentUrl(att);
              const fileName = att.name || hw.topic || noteItem.topic || 'Study Notes.pdf';
              const viewUrl = directUrl ? buildPdfProxyUrl(directUrl, fileName, false) : '';
              const isDownloading = downloadingPdfKey === itemKey;
              const isDone = downloadedPdfKey === itemKey;

              return (
                <div
                  key={itemKey}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 sm:p-5"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pink-500/10 text-pink-400">
                      <FileText className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <h5 className="font-['Sora'] text-sm sm:text-base font-bold text-[var(--text-primary)] truncate">
                        {fileName}
                      </h5>
                      <p className="text-xs sm:text-sm text-[var(--text-secondary)] truncate">
                        {hw.topic || 'PDF Attachment'}
                      </p>
                    </div>
                  </div>
                  {directUrl ? (
                    <div className="flex items-center gap-2.5 shrink-0">
                      <a
                        href={viewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] px-4 py-2.5 text-xs sm:text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
                      >
                        <Eye className="h-4 w-4 text-indigo-400" />
                        <span>View PDF</span>
                      </a>
                      <button
                        type="button"
                        disabled={isDownloading}
                        onClick={() => handlePdfDownload(itemKey, directUrl, fileName)}
                        className="flex items-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-60 transition"
                      >
                        {isDownloading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isDone ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        <span>{isDownloading ? 'Saving...' : isDone ? 'Downloaded' : 'Download'}</span>
                      </button>
                    </div>
                  ) : (
                    <span className="shrink-0 rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] px-3.5 py-2 text-xs font-semibold text-[var(--text-secondary)]">
                      PDF Unavailable
                    </span>
                  )}
                </div>
              );
            })
          )
        )}
      </div>
    );
  };

  const extractLecNum = (text: string): string | null => {
    const m =
      text.match(/(?:lec|lecture|class|l)\s*[-#:]?\s*0*(\d+)/i) ||
      text.match(/\b0*(\d{1,2})\s*:/);
    return m ? m[1] : null;
  };

  const matchLectureDhaNote = (vid: BatchVideoItem) => {
    const title = vid.topic || vid.videoDetails?.name || '';
    const lecNum = extractLecNum(title);
    const vidDate = vid.date ? vid.date.slice(0, 10) : '';
    for (const dn of dppNotes) {
      const dnDate = dn.date ? dn.date.slice(0, 10) : '';
      for (const hw of dn.homeworkIds || []) {
        const hwTopic = hw.topic || dn.topic || '';
        const ofLecMatch = hwTopic.match(/of\s*lec(?:ture)?\s*0*(\d+)/i);
        if (lecNum && ofLecMatch && ofLecMatch[1] === lecNum) {
          const att = hw.attachmentIds?.[0];
          const url = att ? resolveAttachmentUrl(att) : '';
          if (url) return { title: hwTopic, url, name: att?.name || `${hwTopic}.pdf` };
        }
        if (vidDate && dnDate && vidDate === dnDate) {
          const att = hw.attachmentIds?.[0];
          const url = att ? resolveAttachmentUrl(att) : '';
          if (url) return { title: hwTopic, url, name: att?.name || `${hwTopic}.pdf` };
        }
      }
    }
    return null;
  };

  const matchLectureDhaQuiz = (vid: BatchVideoItem) => {
    const title = vid.topic || vid.videoDetails?.name || '';
    const lecNum = extractLecNum(title);
    const vidDate = vid.date ? vid.date.slice(0, 10) : '';
    for (const exItem of exercises) {
      const exDate = exItem.date ? exItem.date.slice(0, 10) : '';
      for (const ex of exItem.exerciseIds || []) {
        const exTitle = ex.title || exItem.topic || 'DHA Quiz';
        const ofLecMatch = exTitle.match(/of\s*lec(?:ture)?\s*0*(\d+)/i);
        const firstC = ex.content?.[0];
        const eid = ex.resolvedExerciseId || firstC?.exerciseId || ex._id || exItem._id;
        if (lecNum && ofLecMatch && ofLecMatch[1] === lecNum) {
          return {
            id: exItem._id,
            exerciseId: String(eid),
            title: exTitle,
            totalQuestions: Number(ex.totalQuestions || firstC?.exerciseDetails?.totalQuestions || 10),
          };
        }
        if (vidDate && exDate && vidDate === exDate) {
          return {
            id: exItem._id,
            exerciseId: String(eid),
            title: exTitle,
            totalQuestions: Number(ex.totalQuestions || firstC?.exerciseDetails?.totalQuestions || 10),
          };
        }
      }
    }
    return null;
  };

  const renderExercisesList = () => {
    if (loadingContents) {
      return (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-xs text-[var(--text-secondary)]">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--primary-color)]" />
          <span>Loading chapter DHA &amp; MCQ quizzes...</span>
        </div>
      );
    }
    if (exercises.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-8 text-center text-xs text-[var(--text-secondary)]">
          No DHA / MCQ Quizzes uploaded under this chapter yet. Check DPP PDFs or Chapter Tests!
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {exercises.map((exItem) =>
          (exItem.exerciseIds || []).map((ex, idx) => {
            const firstC = ex.content?.[0];
            const exId = String(ex.resolvedExerciseId || firstC?.exerciseId || ex._id || exItem._id);
            const title = ex.title || exItem.topic || 'Chapter DHA MCQ Quiz';
            const totalQs = Number(ex.totalQuestions || firstC?.exerciseDetails?.totalQuestions || 10);
            const totalMarks = Number(ex.totalMarks || firstC?.exerciseDetails?.totalMarks || totalQs * 4);
            const key = `${exItem._id}-${exId}-${idx}`;
            const isBusy = launchingDhaId === key;
            return (
              <div
                key={key}
                className="flex flex-col justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[11px] font-bold text-amber-400">
                    <ClipboardCheck className="h-3.5 w-3.5" />
                    <span>Lecture DHA Quiz</span>
                    <span className="font-mono text-[var(--text-secondary)]">
                      · {totalQs} Qs · {totalMarks} Marks
                    </span>
                  </div>
                  <h4 className="font-['Sora'] text-sm font-extrabold text-[var(--text-primary)] line-clamp-2">
                    {title}
                  </h4>
                  {exItem.date && (
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      {new Date(exItem.date).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={Boolean(launchingDhaId)}
                  onClick={() => handleLaunchDhaQuiz(key, exId, title, totalQs)}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60 transition"
                >
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-white" />}
                  <span>{isBusy ? 'Preparing Quiz...' : 'Attempt DHA Quiz'}</span>
                </button>
              </div>
            );
          })
        )}
      </div>
    );
  };

  const renderVideoList = (list: BatchVideoItem[], isDpp = false) => {
    if (loadingContents) {
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-sm text-[var(--text-secondary)]">
          <Loader2 className="h-7 w-7 animate-spin text-[var(--primary-color)]" />
          <span>Loading video lectures...</span>
        </div>
      );
    }
    if (contentsError) {
      return (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-center text-sm text-red-400">
          {contentsError}
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-10 text-center text-sm text-[var(--text-secondary)]">
          No videos found in this section. Check the Notes PDF or DHA Quizzes tab!
        </div>
      );
    }
    return (
      <div className="space-y-3.5">
        {list.map((vid) => {
          const thumb = vid.videoDetails?.image;
          const dur = vid.videoDetails?.duration;
          const dateStr = vid.date ? new Date(vid.date).toLocaleDateString() : '';
          const title = vid.topic || vid.videoDetails?.name || 'Recorded Lecture';
          const isCleared = isLectureCompleted(batch.batch_id, vid._id, adventureState);
          const matchedDhaPdf = !isDpp ? matchLectureDhaNote(vid) : null;
          const matchedDhaQuiz = !isDpp ? matchLectureDhaQuiz(vid) : null;
          return (
            <div
              key={vid._id}
              onClick={() => triggerPlayVideo(vid, isDpp)}
              onMouseEnter={() => {
                if (!selectedSubject || !selectedTopic) return;
                if (hoverVideoTimerRef.current) window.clearTimeout(hoverVideoTimerRef.current);
                hoverVideoTimerRef.current = window.setTimeout(() => {
                  hoverVideoTimerRef.current = null;
                  const rawUrl = vid.videoDetails?.embedCode || vid.videoDetails?.videoUrl || vid.url || '';
                  const isYt = vid.urlType === 'youtube' || /youtu\.?be/i.test(rawUrl);
                  if (!isYt) {
                    prefetchVideoStream({
                      batchId: batch.batch_id,
                      subjectId: selectedSubject.slug || selectedSubject._id,
                      topicId: selectedTopic._id,
                      videoId: vid._id,
                      findKey: vid.videoDetails?.findKey,
                      videoDetailsId: vid.videoDetails?.id || vid.videoDetails?._id,
                      typeId: vid.typeId,
                      videoName: title,
                      videoImg: thumb || '',
                      videoType: 'new',
                      playType: isDpp ? 'solutions' : 'Lecture',
                      videoUrl: rawUrl,
                    });
                  }
                }, 220);
              }}
              onMouseLeave={() => {
                if (hoverVideoTimerRef.current) {
                  window.clearTimeout(hoverVideoTimerRef.current);
                  hoverVideoTimerRef.current = null;
                }
              }}
              className="group flex flex-col gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 sm:p-5 cursor-pointer transition hover:border-[var(--primary-color)]/60 hover:bg-[var(--bg-tertiary)]"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 min-w-0 flex-1">
                  <div className="relative aspect-video w-full sm:h-24 sm:w-44 md:h-28 md:w-48 shrink-0 overflow-hidden rounded-2xl bg-slate-900">
                    {thumb ? (
                      <img src={thumb} alt={vid.topic} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-indigo-950">
                        <Video className="h-8 w-8 text-indigo-400" />
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/20 transition">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--primary-color)] text-white shadow-lg">
                        <Play className="h-5 w-5 fill-white ml-0.5" />
                      </div>
                    </div>
                    {dur && (
                      <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/85 px-2 py-0.5 font-mono text-xs font-bold text-white">
                        {dur}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4 className="font-['Sora'] text-sm sm:text-base lg:text-lg font-extrabold text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--primary-color)] transition">
                      {title}
                    </h4>
                    <div className="mt-2 flex flex-wrap items-center gap-2.5 text-xs sm:text-sm text-[var(--text-secondary)]">
                      {dateStr && (
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          {dateStr}
                        </span>
                      )}
                      {dur && (
                        <span className="flex items-center gap-1.5 font-mono tabular-nums">
                          <Clock className="h-3.5 w-3.5 text-indigo-400" />
                          {dur}
                        </span>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>{vid.urlType === 'youtube' ? 'YouTube' : 'HD Stream'}</span>
                      {isCleared && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-bold text-emerald-400">Cleared (+50 XP)</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!selectedSubject || !selectedTopic) return;
                      onToggleLectureComplete({
                        batchId: batch.batch_id,
                        subjectId: selectedSubject.slug || selectedSubject._id,
                        topicId: selectedTopic._id,
                        videoId: vid._id,
                        title,
                      });
                    }}
                    className={`flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
                      isCleared
                        ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                        : 'border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                    title={isCleared ? 'Stage cleared' : 'Mark lecture complete (+50 XP)'}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="hidden sm:inline">{isCleared ? 'Cleared' : 'Complete'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!selectedSubject || !selectedTopic) return;
                      const rawUrl = vid.videoDetails?.embedCode || vid.videoDetails?.videoUrl || vid.url || '';
                      const isYt = (vid.urlType || '').toLowerCase() === 'youtube';
                      openLectureDownloadModal({
                        batchId: batch.batch_id,
                        subjectId: selectedSubject.slug || selectedSubject._id,
                        topicId: selectedTopic._id,
                        videoId: vid._id,
                        findKey: vid.videoDetails?.findKey,
                        videoDetailsId: vid.videoDetails?.id || vid.videoDetails?._id,
                        typeId: vid.typeId,
                        title,
                        videoImg: thumb || '',
                        videoType: isYt ? 'youtube' : 'new',
                        playType: isDpp ? 'solutions' : 'Lecture',
                        rawVideoUrl: rawUrl,
                      });
                    }}
                    className="flex h-10 w-10 sm:w-auto sm:px-3.5 items-center justify-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-xs font-bold text-emerald-400 hover:border-emerald-500/60 hover:bg-emerald-500/10 transition"
                    title="Download Lecture (MP4 / Audio)"
                  >
                    <Download className="h-4 w-4" />
                    <span className="hidden lg:inline">Download</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerPlayVideo(vid, isDpp);
                    }}
                    className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md hover:opacity-90 active:scale-95 transition"
                  >
                    <Play className="h-4 w-4 fill-white" />
                    <span>Play</span>
                  </button>
                </div>
              </div>

              {/* Inline Lecture DHA Bar (DHA PDF + DHA MCQ Quiz + Quick Link) */}
              {(matchedDhaPdf || matchedDhaQuiz) && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2"
                >
                  <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1.5">
                    <ClipboardCheck className="h-3.5 w-3.5" />
                    <span>Lecture DHA:</span>
                    <span className="font-normal text-[var(--text-secondary)] truncate max-w-[200px] sm:max-w-xs">
                      {matchedDhaQuiz?.title || matchedDhaPdf?.title}
                    </span>
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {matchedDhaPdf && (
                      <>
                        <a
                          href={buildPdfProxyUrl(matchedDhaPdf.url, matchedDhaPdf.name, false)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-primary)] hover:border-amber-400 transition"
                        >
                          <Eye className="h-3 w-3 text-amber-400" />
                          <span>DHA PDF</span>
                        </a>
                        <button
                          type="button"
                          onClick={() =>
                            handlePdfDownload(`dha-${vid._id}`, matchedDhaPdf.url, matchedDhaPdf.name)
                          }
                          className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-primary)] hover:border-amber-400 transition"
                        >
                          <Download className="h-3 w-3 text-pink-400" />
                          <span>Save DHA</span>
                        </button>
                      </>
                    )}
                    {matchedDhaQuiz && (
                      <button
                        type="button"
                        disabled={Boolean(launchingDhaId)}
                        onClick={() =>
                          handleLaunchDhaQuiz(
                            `lec-${vid._id}`,
                            matchedDhaQuiz.exerciseId,
                            matchedDhaQuiz.title,
                            matchedDhaQuiz.totalQuestions
                          )
                        }
                        className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1 text-[11px] font-extrabold text-slate-950 hover:bg-amber-400 disabled:opacity-60 transition"
                      >
                        {launchingDhaId === `lec-${vid._id}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3 fill-slate-950" />
                        )}
                        <span>Attempt DHA Quiz ({matchedDhaQuiz.totalQuestions} Qs)</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Compact Sticky Top Navigation Header */}
      <div className="flex h-14 sm:h-16 shrink-0 items-center justify-between gap-2 border-b border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 sm:px-6">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => {
              if (selectedTopic) {
                setSelectedTopic(null);
              } else if (selectedSubject) {
                setSelectedSubject(null);
              } else {
                onClose();
              }
            }}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] px-3.5 text-xs sm:text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
            title="Back"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs sm:text-sm">
            <button
              onClick={() => {
                setSelectedSubject(null);
                setSelectedTopic(null);
                setActiveTopTab('subjects');
              }}
              className={`font-bold whitespace-nowrap transition ${
                !selectedSubject && activeTopTab === 'subjects'
                  ? 'text-[var(--primary-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Subjects
            </button>

            {selectedSubject && (
              <>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                <button
                  onClick={() => setSelectedTopic(null)}
                  className={`font-bold whitespace-nowrap transition ${
                    !selectedTopic
                      ? 'text-[var(--primary-color)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {selectedSubject.subject}
                </button>
              </>
            )}

            {selectedTopic && (
              <>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                <span className="font-bold text-[var(--primary-color)] truncate max-w-[180px] sm:max-w-[300px]">
                  {selectedTopic.name}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowAiDrawer(true)}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-3 text-xs sm:text-sm font-bold text-white shadow-sm hover:opacity-90 transition"
            title="Ask Study AI about this batch, subject, or chapter"
          >
            <Sparkles className="h-4 w-4" />
            <span>Ask AI</span>
          </button>

          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:border-red-500/50 hover:text-red-400 transition"
            title="Close Batch"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {copied && (
        <div className="fixed top-16 right-4 z-30 flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4" />
          <span>Batch link copied!</span>
        </div>
      )}

      {/* Full-Screen Scrollable Study Workspace */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="w-full space-y-5">
          {/* Batch Banner + Actions Card */}
          <div className="relative overflow-hidden rounded-3xl border border-[var(--card-border)] bg-slate-900 shadow-lg">
            <div className="relative h-36 sm:h-48 lg:h-56 w-full overflow-hidden">
              {batch.photo ? (
                <img src={batch.photo} alt={batch.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-r from-indigo-900 via-purple-900 to-slate-900">
                  <GraduationCap className="h-16 w-16 text-indigo-400 opacity-60" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/45 to-black/50" />

              {/* Top Banner Pills & Actions */}
              <div className="absolute top-3.5 left-4 right-4 flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-black/65 px-3.5 py-1.5 text-xs sm:text-sm font-bold text-white backdrop-blur-md border border-white/15">
                  {batch.exam || 'All Exams'} · Class {batch.class || 'All'}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onToggleEnroll(batch.batch_id)}
                    className={`flex h-10 items-center gap-1.5 rounded-full px-4 text-xs sm:text-sm font-bold backdrop-blur-md transition whitespace-nowrap ${
                      isEnrolled
                        ? 'bg-emerald-600 text-white'
                        : 'bg-black/65 text-white hover:bg-black/80 border border-white/15'
                    }`}
                  >
                    {isEnrolled ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    <span>{isEnrolled ? 'In My Batches' : 'Add to My Batch'}</span>
                  </button>
                  <button
                    onClick={() => onToggleFavorite(batch.batch_id)}
                    className={`flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-md transition ${
                      isFavorite ? 'bg-pink-600 text-white' : 'bg-black/65 text-white hover:text-pink-400'
                    }`}
                    title={isFavorite ? 'Remove Favorite' : 'Add to Favorites'}
                  >
                    <Heart className={`h-4 w-4 ${isFavorite ? 'fill-white' : ''}`} />
                  </button>
                  <button
                    onClick={handleShare}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-md hover:bg-black/80 transition"
                    title="Share Batch Link"
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Batch Name */}
              <div className="absolute bottom-4 left-4 right-4">
                <h2 className="font-['Sora'] text-xl sm:text-2xl lg:text-3xl font-extrabold text-white drop-shadow-md line-clamp-2">
                  {batch.name}
                </h2>
                {batch.byName && (
                  <p className="mt-1 text-xs sm:text-sm text-slate-200 drop-shadow line-clamp-1">
                    {batch.byName}
                  </p>
                )}
              </div>
            </div>

            {/* Batch Adventure Progress Bar */}
            <div className="border-t border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 sm:px-6 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                <div className="flex items-center gap-2">
                  <Compass className="h-5 w-5 text-[var(--primary-color)] shrink-0" />
                  <span className="font-['Sora'] font-bold text-[var(--text-primary)]">
                    Batch Adventure
                  </span>
                  <span aria-hidden="true" className="text-[var(--text-secondary)]">·</span>
                  <span className="text-[var(--text-secondary)] font-semibold">
                    Lv.{batchMetrics.level} {batchMetrics.rank}
                  </span>
                </div>
                <div className="flex items-center gap-3.5 font-mono tabular-nums text-xs sm:text-sm text-[var(--text-secondary)]">
                  <span className="flex items-center gap-1 text-emerald-400 font-bold">
                    <Trophy className="h-4 w-4" />
                    {batchMetrics.xp} XP
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{batchMetrics.completedCount} Cleared</span>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1 text-amber-400 font-bold">
                    <Flame className="h-4 w-4" />
                    {batchMetrics.currentStreak}d Streak
                  </span>
                </div>
              </div>
              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                <div
                  className="h-full rounded-full bg-[var(--primary-color)] transition-all duration-300"
                  style={{ width: `${batchMetrics.levelProgressPercent}%` }}
                />
              </div>
            </div>
          </div>

          {loadingDetails ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-sm text-[var(--text-secondary)]">
              <Loader2 className="h-9 w-9 animate-spin text-[var(--primary-color)]" />
              <span>Loading batch subjects, tests &amp; Khazana...</span>
            </div>
          ) : detailsError && subjects.length === 0 && mahapackBatches.length === 0 && !khazanaProgramId ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center">
              <AlertCircle className="h-8 w-8 text-red-400 mb-2" />
              <p className="text-xs text-red-300 max-w-md">{detailsError}</p>
            </div>
          ) : activeTopTab === 'schedule' && !selectedSubject ? (
            /* Weekly Schedule View (Today + Weekly Strip + Routine) */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setActiveTopTab('subjects')}
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3.5 py-2 text-xs font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Back to Batch Tabs</span>
                </button>
              </div>
              {/* Week Navigation Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 sm:p-5">
                <div>
                  <h3 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-[var(--primary-color)]" />
                    <span>
                      {selectedScheduleDate === todayStr
                        ? "Today's Classes"
                        : new Date(`${selectedScheduleDate}T00:00:00Z`).toLocaleDateString('en-IN', {
                            timeZone: 'UTC',
                            weekday: 'long',
                            day: 'numeric',
                            month: 'short',
                          })}
                    </span>
                  </h3>
                  <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">
                    Week: {weekBounds.startDate} to {weekBounds.endDate} (IST)
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const d = new Date(`${selectedScheduleDate}T00:00:00Z`);
                      d.setUTCDate(d.getUTCDate() - 7);
                      setSelectedScheduleDate(d.toISOString().slice(0, 10));
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
                    title="Previous Week"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => setSelectedScheduleDate(todayStr)}
                    className={`rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition ${
                      selectedScheduleDate === todayStr
                        ? 'bg-[var(--primary-color)] text-white'
                        : 'border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:border-[var(--primary-color)]'
                    }`}
                  >
                    Today
                  </button>
                  <button
                    onClick={() => {
                      const d = new Date(`${selectedScheduleDate}T00:00:00Z`);
                      d.setUTCDate(d.getUTCDate() + 7);
                      setSelectedScheduleDate(d.toISOString().slice(0, 10));
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
                    title="Next Week"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* 7-Day Interactive Strip */}
              <div className="grid grid-cols-7 gap-2 sm:gap-3">
                {weekBounds.days.map((day) => {
                  const isSelected = selectedScheduleDate === day.dateStr;
                  const isToday = day.dateStr === todayStr;
                  const dayCount = weeklyClasses.filter(
                    (c) =>
                      (c.dateKey || (c.date ? c.date.slice(0, 10) : '')) === day.dateStr ||
                      (isToday && todayClasses.some((tc) => tc._id === c._id))
                  ).length;

                  return (
                    <button
                      key={day.dateStr}
                      onClick={() => {
                        setSelectedScheduleDate(day.dateStr);
                        setScheduleNoticeMsg(null);
                      }}
                      className={`flex flex-col items-center justify-center rounded-2xl border py-3.5 px-1 transition ${
                        isSelected
                          ? 'border-[var(--primary-color)] bg-[var(--primary-color)] text-white shadow-md'
                          : isToday
                          ? 'border-[var(--primary-color)]/50 bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                          : 'border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <span className="text-xs font-bold uppercase">{day.dayShort}</span>
                      <span className="mt-1 font-mono text-base sm:text-lg font-extrabold tabular-nums">
                        {day.dayNum}
                      </span>
                      <span
                        className={`mt-1.5 h-2 w-2 rounded-full ${
                          dayCount > 0
                            ? isSelected
                              ? 'bg-white'
                              : 'bg-emerald-400'
                            : 'bg-transparent'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>

              {/* Subject Filter Bar */}
              {(() => {
                const combinedForWeek =
                  selectedScheduleDate === todayStr
                    ? [...todayClasses, ...weeklyClasses.filter((w) => !todayClasses.some((t) => t._id === w._id))]
                    : weeklyClasses;
                const subjectOptions = Array.from(
                  new Set(combinedForWeek.map((c) => c.subjectName || 'General').filter(Boolean))
                );
                if (subjectOptions.length <= 1) return null;
                return (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                    <button
                      onClick={() => setScheduleSubjectFilter('all')}
                      className={`shrink-0 rounded-2xl px-4 py-2 text-xs sm:text-sm font-bold transition ${
                        scheduleSubjectFilter === 'all'
                          ? 'bg-[var(--primary-color)] text-white'
                          : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                      }`}
                    >
                      All Subjects
                    </button>
                    {subjectOptions.map((sName) => (
                      <button
                        key={sName}
                        onClick={() => setScheduleSubjectFilter(sName)}
                        className={`shrink-0 rounded-2xl px-4 py-2 text-xs sm:text-sm font-bold transition ${
                          scheduleSubjectFilter === sName
                            ? 'bg-[var(--primary-color)] text-white'
                            : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {sName}
                      </button>
                    ))}
                  </div>
                );
              })()}

              {scheduleNoticeMsg && (
                <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-xs sm:text-sm text-sky-300">
                  {scheduleNoticeMsg}
                </div>
              )}

              {/* Day's Scheduled Classes */}
              {loadingWeekly ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-sm text-[var(--text-secondary)]">
                  <Loader2 className="h-8 w-8 animate-spin text-[var(--primary-color)]" />
                  <span>Loading weekly schedule...</span>
                </div>
              ) : weeklyError ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-center text-sm text-red-400">
                  {weeklyError}
                </div>
              ) : (
                (() => {
                  const combinedSource =
                    selectedScheduleDate === todayStr
                      ? [
                          ...todayClasses,
                          ...weeklyClasses.filter((w) => !todayClasses.some((t) => t._id === w._id)),
                        ]
                      : weeklyClasses;

                  const dayClasses = combinedSource.filter((cls) => {
                    const key = cls.dateKey || (cls.date ? cls.date.slice(0, 10) : '');
                    const matchesDay =
                      key === selectedScheduleDate ||
                      (selectedScheduleDate === todayStr &&
                        todayClasses.some((t) => t._id === cls._id));
                    const matchesSubj =
                      scheduleSubjectFilter === 'all' ||
                      (cls.subjectName || 'General') === scheduleSubjectFilter;
                    return matchesDay && matchesSubj;
                  });

                  const selectedDow = new Date(`${selectedScheduleDate}T00:00:00Z`).getUTCDay();
                  const dayRoutine = weeklyRoutine.filter((r) => {
                    const matchesDow = r.weekday === selectedDow;
                    const matchesSubj =
                      scheduleSubjectFilter === 'all' || r.subjectName === scheduleSubjectFilter;
                    return matchesDow && matchesSubj;
                  });

                  return (
                    <div className="space-y-4">
                      {dayClasses.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-10 text-center text-sm text-[var(--text-secondary)]">
                          No live or uploaded class found on {selectedScheduleDate}.
                          {dayRoutine.length > 0 && ' Check typical subject slots for this weekday below.'}
                        </div>
                      ) : (
                        <div className="space-y-3.5">
                          {dayClasses.map((cls) => {
                            const status = cls.liveStatus || 'COMPLETED';
                            const statusClass =
                              status === 'LIVE'
                                ? 'bg-red-500/15 text-red-400 border-red-500/30'
                                : status === 'UPCOMING'
                                ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                                : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';

                            const firstAtt = cls.homeworkIds?.flatMap((h) => h.attachmentIds || [])[0];
                            const firstAttUrl = firstAtt ? resolveAttachmentUrl(firstAtt) : '';

                            return (
                              <div
                                key={cls._id}
                                onClick={() => handlePlayScheduledClass(cls)}
                                className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 sm:p-5 cursor-pointer transition hover:border-[var(--primary-color)]/60 hover:bg-[var(--bg-tertiary)]"
                              >
                                <div className="space-y-2 min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2.5 text-xs sm:text-sm">
                                    <span
                                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-0.5 font-bold ${statusClass}`}
                                    >
                                      {status === 'LIVE' && <Radio className="h-3.5 w-3.5 animate-pulse" />}
                                      {status === 'LIVE'
                                        ? 'LIVE'
                                        : status === 'UPCOMING'
                                        ? 'Upcoming'
                                        : 'Completed'}
                                    </span>
                                    <span className="font-bold text-[var(--primary-color)]">
                                      {cls.subjectName || 'General'}
                                    </span>
                                    <span aria-hidden="true" className="text-[var(--text-secondary)]">
                                      ·
                                    </span>
                                    <span className="flex items-center gap-1.5 font-mono text-[var(--text-secondary)] tabular-nums">
                                      <Clock className="h-3.5 w-3.5" />
                                      {formatTimeRangeIst(cls.startTime, cls.endTime)}
                                    </span>
                                  </div>

                                  <h4 className="font-['Sora'] text-sm sm:text-base lg:text-lg font-extrabold text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--primary-color)] transition">
                                    {cls.topic}
                                  </h4>

                                  <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[var(--text-secondary)]">
                                    {cls.teacherNames && cls.teacherNames.length > 0 && (
                                      <span>By {cls.teacherNames.join(', ')}</span>
                                    )}
                                    {cls.topicName && (
                                      <>
                                        {cls.teacherNames && cls.teacherNames.length > 0 && (
                                          <span aria-hidden="true">·</span>
                                        )}
                                        <span>Chapter: {cls.topicName}</span>
                                      </>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {firstAttUrl && firstAtt && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePdfDownload(
                                          `ws-${cls._id}`,
                                          firstAttUrl,
                                          firstAtt.name || `${cls.topic}.pdf`
                                        );
                                      }}
                                      className="flex items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] px-3.5 py-2.5 text-xs sm:text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
                                    >
                                      <Download className="h-4 w-4 text-pink-400" />
                                      <span>Notes</span>
                                    </button>
                                  )}
                                  {status !== 'UPCOMING' && !cls.isCancelled && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const urlType = (cls.urlType || '').toLowerCase();
                                        const rawUrl =
                                          cls.ytStreamUrl ||
                                          cls.newCdnLink ||
                                          cls.videoDetails?.embedCode ||
                                          cls.videoDetails?.hls_url ||
                                          cls.videoDetails?.videoUrl ||
                                          cls.url ||
                                          '';
                                        const isYt = urlType === 'youtube' || /youtu\.?be/i.test(rawUrl);
                                        openLectureDownloadModal({
                                          batchId: batch.batch_id,
                                          subjectId: cls.subjectSlug || cls.batchSubjectId || 'subject',
                                          topicId: cls.topicId || cls.tags?.[0]?._id || cls._id,
                                          videoId: cls._id,
                                          findKey: cls.videoDetails?.findKey,
                                          videoDetailsId: cls.videoDetails?.id || cls.videoDetails?._id,
                                          parentScheduleId: cls.parentScheduleId,
                                          typeId: cls.typeId,
                                          title: cls.topic || cls.videoDetails?.name || 'Scheduled Lecture',
                                          videoImg: cls.videoDetails?.image || '',
                                          videoType: isYt ? 'youtube' : 'new',
                                          playType: 'Lecture',
                                          rawVideoUrl: rawUrl,
                                          isLive: status === 'LIVE',
                                          urlType: cls.urlType,
                                        });
                                      }}
                                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-emerald-400 hover:border-emerald-500/60 hover:bg-emerald-500/10 transition"
                                      title="Download Lecture"
                                    >
                                      <Download className="h-4 w-4" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePlayScheduledClass(cls);
                                    }}
                                    className="flex items-center gap-2 rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md hover:opacity-90 transition"
                                  >
                                    <Play className="h-4 w-4 fill-white" />
                                    <span>{status === 'UPCOMING' ? 'Timing' : 'Watch'}</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {dayClasses.length === 0 && dayRoutine.length > 0 && (
                        <div className="space-y-3">
                          <h4 className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">
                            Regular Timetable Pattern for {weekBounds.days.find((d) => d.dateStr === selectedScheduleDate)?.dayShort}
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {dayRoutine.map((slot, idx) => (
                              <button
                                key={`${slot.weekday}-${slot.subjectName}-${idx}`}
                                onClick={() => {
                                  const matchedSubj = subjects.find(
                                    (s) =>
                                      s.slug === slot.subjectSlug ||
                                      s._id === slot.batchSubjectId ||
                                      s.subject === slot.subjectName
                                  );
                                  if (matchedSubj) {
                                    setActiveTopTab('subjects');
                                    handleSelectSubject(matchedSubj);
                                  }
                                }}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 sm:p-5 text-left hover:border-[var(--primary-color)] transition"
                              >
                                <div className="min-w-0">
                                  <div className="text-sm sm:text-base font-bold text-[var(--primary-color)] truncate">
                                    {slot.subjectName}
                                  </div>
                                  <div className="text-xs sm:text-sm text-[var(--text-secondary)] truncate mt-1">
                                    {formatTimeRangeIst(slot.startTime, slot.endTime)}
                                    {slot.teacherNames?.length ? ` · ${slot.teacherNames.join(', ')}` : ''}
                                  </div>
                                </div>
                                <ChevronRight className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </div>
          ) : selectedTopic ? (
            /* Topic Contents (Videos / Notes / DPP & DHA) */
            <div className="space-y-4">
              {/* Sub-tabs */}
              <div className="flex items-center gap-2.5 overflow-x-auto pb-1 no-scrollbar">
                {[
                  { id: 'videos' as const, label: 'Lectures', count: selectedTopic.videos },
                  { id: 'notes' as const, label: 'Class Notes PDF', count: selectedTopic.notes },
                  { id: 'DppNotes' as const, label: 'DHA / DPP PDFs', count: dppNotes.length || undefined },
                  { id: 'exercises' as const, label: 'DHA Quizzes', count: selectedTopic.exercises || exercises.length || undefined },
                  { id: 'DppVideos' as const, label: 'DPP Videos', count: selectedTopic.dppVideos },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => handleSwitchContentTab(tab.id)}
                    className={`flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-xs sm:text-sm font-bold transition ${
                      contentTab === tab.id
                        ? 'bg-[var(--primary-color)] text-white shadow-sm'
                        : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.count !== undefined && (
                      <span className="rounded-lg bg-black/20 px-2 py-0.5 text-xs">
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {contentTab === 'videos' && renderVideoList(videos, false)}
              {contentTab === 'DppVideos' && renderVideoList(dppVideos, true)}
              {contentTab === 'notes' &&
                renderPdfList(notes, 'No class notes PDFs available for this chapter.')}
              {contentTab === 'DppNotes' &&
                renderPdfList(dppNotes, 'No DHA or DPP PDFs available for this chapter.')}
              {contentTab === 'exercises' && renderExercisesList()}
            </div>
          ) : selectedSubject ? (
            /* STEP 2: Subject Chapters / Topics */
            <div className="space-y-4">
              {loadingTopics && topics.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-sm text-[var(--text-secondary)]">
                  <Loader2 className="h-8 w-8 animate-spin text-[var(--primary-color)]" />
                  <span>Loading chapters for {selectedSubject.subject}...</span>
                </div>
              ) : topics.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-10 text-center text-sm text-[var(--text-secondary)]">
                  No chapters uploaded under {selectedSubject.subject} yet.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {topics.map((topic, idx) => {
                      const clearedCount = batchMetrics.completedTopicCounts[topic._id] || 0;
                      const totalVids = topic.videos || 0;
                      const pct = totalVids > 0 ? Math.min(100, Math.round((clearedCount / totalVids) * 100)) : 0;
                      const stageDone = totalVids > 0 && clearedCount >= totalVids;
                      return (
                        <button
                          key={topic._id}
                          onClick={() => handleSelectTopic(topic)}
                          className="group flex flex-col gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-5 text-left transition hover:border-[var(--primary-color)]/60 hover:bg-[var(--bg-tertiary)]"
                        >
                          <div className="flex items-center justify-between gap-3 w-full">
                            <div className="flex items-start gap-3.5 min-w-0">
                              <span
                                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl font-mono tabular-nums text-sm font-extrabold ${
                                  stageDone
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-indigo-500/15 text-indigo-400'
                                }`}
                              >
                                {stageDone ? <CheckCircle2 className="h-5 w-5" /> : String(idx + 1).padStart(2, '0')}
                              </span>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-[var(--text-secondary)] font-mono tabular-nums">
                                  Stage {String(idx + 1).padStart(2, '0')}
                                  {clearedCount > 0 ? ` · ${clearedCount}/${totalVids || clearedCount} cleared` : ''}
                                </div>
                                <h4 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--primary-color)] transition">
                                  {topic.name}
                                </h4>
                                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)] font-mono tabular-nums">
                                  <span>{totalVids} Videos</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{topic.notes || 0} Notes</span>
                                </div>
                              </div>
                            </div>
                            <ChevronRight className="h-5 w-5 shrink-0 text-[var(--text-secondary)] group-hover:translate-x-0.5 group-hover:text-[var(--primary-color)] transition" />
                          </div>
                          {totalVids > 0 && (
                            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  stageDone ? 'bg-emerald-500' : 'bg-[var(--primary-color)]'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {hasMoreTopics && (
                    <div className="flex justify-center pt-2">
                      <button
                        onClick={handleLoadMoreTopics}
                        disabled={loadingTopics}
                        className="flex items-center gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-5 py-3 text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)]"
                      >
                        {loadingTopics && <Loader2 className="h-4 w-4 animate-spin" />}
                        <span>Load More Chapters</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            /* BATCH HUB: Today Classes Teacher Carousel + Underline Tabs (SUBJECTS | TESTS | KHAZANA | COMMUNITY) */
            <div className="space-y-4">
              {/* Today Classes Carousel Card (Matches Reference Screenshot) */}
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3.5 sm:p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="h-5 w-1 rounded-full bg-[var(--primary-color)]" />
                    <h3 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)]">
                      Today Classes
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTopTab('schedule')}
                    className="flex items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
                  >
                    <CalendarDays className="h-3.5 w-3.5 text-[var(--primary-color)]" />
                    <span>Weekly Schedule</span>
                  </button>
                </div>

                {loadingToday ? (
                  <div className="flex items-center gap-2 py-4 text-xs sm:text-sm text-[var(--text-secondary)]">
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--primary-color)]" />
                    <span>Loading today&apos;s scheduled classes &amp; teachers...</span>
                  </div>
                ) : todayClasses.length === 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 text-xs text-[var(--text-secondary)]">
                    <span>No live class scheduled today — check Weekly Schedule for upcoming timings.</span>
                    <button
                      type="button"
                      onClick={() => setActiveTopTab('schedule')}
                      className="font-bold text-[var(--primary-color)] hover:underline"
                    >
                      View Weekly Schedule
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {scheduleNoticeMsg && (
                      <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-xs text-sky-300">
                        {scheduleNoticeMsg}
                      </div>
                    )}
                    <div
                      onScroll={(e) => {
                        const el = e.currentTarget;
                        const maxScroll = el.scrollWidth - el.clientWidth;
                        if (maxScroll <= 0) {
                          setTodayScrollPct(100);
                        } else {
                          const ratio = Math.min(1, Math.max(0, el.scrollLeft / maxScroll));
                          setTodayScrollPct(Math.round(30 + ratio * 70));
                        }
                      }}
                      className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory scroll-smooth no-scrollbar"
                    >
                      {todayClasses.map((cls) => {
                        const teacherLabel =
                          cls.teacherNames && cls.teacherNames.length > 0
                            ? cls.teacherNames[0]
                            : cls.subjectName || 'Faculty';
                        const imgSrc = !failedTeacherImgs[cls._id] ? cls.teacherImage : '';
                        const initials = teacherLabel
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((w) => w[0])
                          .join('')
                          .toUpperCase();

                        const status = cls.liveStatus || 'COMPLETED';
                        const isCancelled = Boolean(cls.isCancelled);
                        const relTime = formatRelativeClassTime(cls.startTime, cls.endTime);

                        return (
                          <button
                            key={cls._id}
                            type="button"
                            onClick={() => handlePlayScheduledClass(cls)}
                            className="group w-[245px] sm:w-[260px] shrink-0 snap-start overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] text-left transition hover:border-[var(--primary-color)] hover:shadow-md"
                          >
                            {/* Teacher Portrait + Patterned Stage + Black Name Banner */}
                            <div className="relative h-32 w-full overflow-hidden bg-[var(--bg-tertiary)]">
                              {/* Soft decorative geometric circles behind portrait */}
                              <div className="pointer-events-none absolute -top-4 left-3 h-10 w-10 rounded-full bg-[var(--text-primary)]/[0.06]" />
                              <div className="pointer-events-none absolute top-4 right-2 h-14 w-14 rounded-full bg-[var(--text-primary)]/[0.06]" />
                              <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 h-24 w-24 rounded-full bg-[var(--text-primary)]/[0.08]" />

                              {imgSrc ? (
                                <img
                                  src={imgSrc}
                                  alt={teacherLabel}
                                  onError={() =>
                                    setFailedTeacherImgs((prev) => ({ ...prev, [cls._id]: true }))
                                  }
                                  className="relative z-10 mx-auto h-full w-auto max-w-full object-contain object-bottom pt-1.5 transition-transform duration-200 group-hover:scale-105"
                                />
                              ) : (
                                <div className="relative z-10 flex h-full w-full items-center justify-center pb-5">
                                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[var(--primary-color)]/30 bg-[var(--primary-color)]/15 font-['Sora'] text-xl font-extrabold text-[var(--primary-color)]">
                                    {initials || 'SC'}
                                  </div>
                                </div>
                              )}

                              <div className="absolute inset-x-0 bottom-0 z-20 bg-black/90 px-2.5 py-1.5 text-center text-xs font-bold text-white truncate">
                                {teacherLabel}
                              </div>
                            </div>

                            {/* Class Details */}
                            <div className="p-3 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className={`text-[11px] font-bold ${
                                    isCancelled || status === 'LIVE'
                                      ? 'text-rose-400'
                                      : status === 'UPCOMING'
                                      ? 'text-sky-400'
                                      : 'text-[var(--text-secondary)]'
                                  }`}
                                >
                                  {relTime}
                                </span>

                                {isCancelled ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-400">
                                    Cancelled
                                  </span>
                                ) : status === 'LIVE' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-red-500/35 bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">
                                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                                    Live
                                  </span>
                                ) : status === 'UPCOMING' ? (
                                  <span className="inline-flex items-center rounded-full border border-sky-500/35 bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-400">
                                    Upcoming
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                                    Ended
                                  </span>
                                )}
                              </div>

                              <h4 className="font-['Sora'] text-xs sm:text-sm font-extrabold text-[var(--text-primary)] truncate group-hover:text-[var(--primary-color)] transition">
                                {cls.subjectName || 'Class'}
                              </h4>
                              <p className="text-xs text-[var(--text-secondary)] truncate">
                                {cls.topic}
                              </p>

                              <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--card-border)] pt-2 font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                                <Clock className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">
                                  {formatTimeRangeIst(cls.startTime, cls.endTime)}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Horizontal Scroll Indicator Track */}
                    <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                      <div
                        className="h-full rounded-full bg-[var(--primary-color)] transition-all duration-150"
                        style={{
                          width: `${todayClasses.length <= 1 ? 100 : todayScrollPct}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Per-Batch Underline Tabs (SUBJECTS | TESTS | KHAZANA | COMMUNITY) */}
              <div className="border-b border-[var(--card-border)]">
                <nav
                  aria-label="Batch sections"
                  className="flex items-center gap-2 sm:gap-6 overflow-x-auto no-scrollbar"
                >
                  {[
                    { id: 'subjects' as const, label: 'SUBJECTS', icon: BookOpen },
                    { id: 'tests' as const, label: 'TESTS', icon: ClipboardCheck },
                    { id: 'khazana' as const, label: 'KHAZANA', icon: Gem },
                    {
                      id: 'community' as const,
                      label:
                        announcements.length > 0
                          ? `COMMUNITY (${announcements.length})`
                          : 'COMMUNITY',
                      icon: Users,
                    },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTopTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTopTab(tab.id)}
                        className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-xs sm:text-sm font-extrabold tracking-wide transition ${
                          active
                            ? 'border-[var(--primary-color)] text-[var(--primary-color)]'
                            : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>

              {/* Tab Content */}
              {activeTopTab === 'tests' ? (
                <BatchTestsPanel
                  batch={batch}
                  subjects={subjects}
                  onAskAi={handleOpenAiWithPrompt}
                />
              ) : activeTopTab === 'khazana' ? (
                <KhazanaExplorer
                  programId={khazanaProgramId || undefined}
                  batchId={batch.batch_id}
                  batchName={batch.name}
                  adventureState={adventureState}
                  onToggleLectureComplete={onToggleLectureComplete}
                  onPlayLecture={onPlayLecture}
                />
              ) : activeTopTab === 'community' ? (
                <BatchCommunityPanel
                  batch={batch}
                  announcements={announcements}
                  onAskAi={handleOpenAiWithPrompt}
                />
              ) : (
                <div className="space-y-5">
                  {subjects.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {subjects.map((subj) => {
                        const imgUrl =
                          subj.imageId?.baseUrl && subj.imageId?.key
                            ? `${subj.imageId.baseUrl}${subj.imageId.key}`
                            : null;
                        return (
                          <button
                            key={subj._id}
                            onClick={() => handleSelectSubject(subj)}
                            className="group flex items-center gap-3.5 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3.5 sm:p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--primary-color)]/60 hover:shadow-md"
                          >
                            <SubjectIconBadge subjectName={subj.subject} imageUrl={imgUrl} />
                            <div className="min-w-0 flex-1">
                              <h4 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)] truncate group-hover:text-[var(--primary-color)] transition">
                                {subj.subject}
                              </h4>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                                <span className="inline-flex items-center gap-1">
                                  <BookOpen className="h-3.5 w-3.5 text-[var(--primary-color)]" />
                                  <span>{subj.tagCount || 0} chapters</span>
                                </span>
                                <span aria-hidden="true">•</span>
                                <span className="inline-flex items-center gap-1">
                                  <Video className="h-3.5 w-3.5 text-[var(--primary-color)]" />
                                  <span>{subj.lectureCount || 0} lectures</span>
                                </span>
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-secondary)] group-hover:text-[var(--primary-color)] transition" />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {mahapackBatches.length > 0 && (
                    <div>
                      <h3 className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">
                        <Layers className="h-4 w-4 text-purple-400" />
                        <span>Included Mahapack Batches ({mahapackBatches.length})</span>
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {mahapackBatches.map((mb: any) => (
                          <button
                            key={mb._id || mb.batchId}
                            onClick={() => {
                              if (onSelectSubBatch) {
                                onSelectSubBatch({
                                  batch_id: mb._id || mb.batchId,
                                  name: mb.name,
                                  byName: mb.byName,
                                  photo: mb.previewImage?.baseUrl
                                    ? `${mb.previewImage.baseUrl}${mb.previewImage.key}`
                                    : batch.photo,
                                  language: mb.language,
                                  exam: mb.exam?.[0] || batch.exam,
                                });
                              }
                            }}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 text-left hover:border-[var(--primary-color)] transition"
                          >
                            <div className="min-w-0">
                              <h4 className="font-['Sora'] text-sm font-bold text-[var(--text-primary)] truncate">
                                {mb.name}
                              </h4>
                              <p className="mt-0.5 text-xs text-[var(--text-secondary)] truncate">
                                Tap to open batch subjects, tests &amp; Khazana
                              </p>
                            </div>
                            <ExternalLink className="h-4 w-4 shrink-0 text-indigo-400" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {subjects.length === 0 && mahapackBatches.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-10 text-center text-sm text-[var(--text-secondary)]">
                      No subjects found for this batch yet. Switch to Tests, Khazana, or Community above!
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Inline Lecture DHA CBT Quiz Modal */}
      {dhaQuizModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-sm">
          <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--card-border)] bg-[var(--bg-secondary)] px-5 py-3.5">
              <div>
                <div className="text-[11px] font-bold text-amber-400">
                  Lecture DHA CBT Quiz (+4 / -1)
                </div>
                <h3 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)]">
                  {dhaQuizModal.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDhaQuizModal(null)}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {!dhaSubmitted ? (
                <>
                  <div className="flex items-center justify-between text-xs font-mono text-[var(--text-secondary)]">
                    <span>
                      Question {dhaIdx + 1} / {dhaQuizModal.questions.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDhaSubmitted(true)}
                      className="rounded-lg bg-emerald-600 px-3 py-1 font-sans text-xs font-bold text-white"
                    >
                      Submit DHA
                    </button>
                  </div>

                  <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 space-y-3">
                    <p className="text-sm font-bold text-[var(--text-primary)] leading-relaxed">
                      {dhaQuizModal.questions[dhaIdx].question}
                    </p>
                    <div className="space-y-2">
                      {dhaQuizModal.questions[dhaIdx].options.map((opt, oIdx) => {
                        const active = dhaAnswers[dhaIdx] === oIdx;
                        return (
                          <button
                            key={oIdx}
                            type="button"
                            onClick={() => setDhaAnswers((p) => ({ ...p, [dhaIdx]: oIdx }))}
                            className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-xs sm:text-sm transition ${
                              active
                                ? 'border-[var(--primary-color)] bg-[var(--primary-color)]/15 font-bold text-[var(--text-primary)]'
                                : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)]'
                            }`}
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--bg-tertiary)] font-mono text-xs font-bold">
                              {String.fromCharCode(65 + oIdx)}
                            </span>
                            <span>{opt}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      disabled={dhaIdx === 0}
                      onClick={() => setDhaIdx((i) => Math.max(0, i - 1))}
                      className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-2 text-xs font-bold disabled:opacity-40"
                    >
                      Previous
                    </button>
                    {dhaIdx < dhaQuizModal.questions.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => setDhaIdx((i) => i + 1)}
                        className="rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs font-bold text-white"
                      >
                        Next Question
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDhaSubmitted(true)}
                        className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white"
                      >
                        Finish &amp; See Solutions
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    let correct = 0;
                    let wrong = 0;
                    dhaQuizModal.questions.forEach((q, i) => {
                      if (dhaAnswers[i] === undefined) return;
                      if (dhaAnswers[i] === q.correctIndex) correct++;
                      else wrong++;
                    });
                    return (
                      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 font-mono text-sm font-extrabold text-emerald-300">
                        DHA Score: {correct * 4 - wrong} / {dhaQuizModal.questions.length * 4} ({correct} Correct · {wrong} Wrong)
                      </div>
                    );
                  })()}
                  {dhaQuizModal.questions.map((q, i) => {
                    const ok = dhaAnswers[i] === q.correctIndex;
                    return (
                      <div key={i} className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3.5 space-y-1.5">
                        <div className="flex justify-between text-xs font-bold">
                          <span>Q{i + 1}</span>
                          <span className={dhaAnswers[i] === undefined ? 'text-slate-400' : ok ? 'text-emerald-400' : 'text-red-400'}>
                            {dhaAnswers[i] === undefined ? 'Skipped' : ok ? 'Correct (+4)' : 'Wrong (-1)'}
                          </span>
                        </div>
                        <p className="text-xs sm:text-sm font-semibold text-[var(--text-primary)]">{q.question}</p>
                        <div className="text-xs text-emerald-300">
                          Ans: {String.fromCharCode(65 + q.correctIndex)}. {q.options[q.correctIndex]}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)]">{q.explanation}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Context-Aware Study AI Slide-Over Drawer */}
      {showAiDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
          <div className="h-full w-full max-w-lg border-l border-[var(--card-border)] shadow-2xl">
            <StudyAiPanel
              variant="drawer"
              scopeKey={`batch:${batch.batch_id}`}
              initialPrompt={aiInitialPrompt}
              onConsumeInitialPrompt={() => setAiInitialPrompt(null)}
              context={{
                batchName: batch.name,
                subjectName: selectedSubject?.subject,
                topicName: selectedTopic?.name,
              }}
              onClose={() => setShowAiDrawer(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
