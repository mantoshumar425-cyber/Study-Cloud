import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Flame,
  GraduationCap,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Trophy,
  UserCheck,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import {
  BatchNoteItem,
  PiCategory,
  PiEpisodeItem,
  PiHomeResponse,
  PiQuizCard,
  PiSeriesDetailResponse,
  PiSeriesItem,
  PiTeacherItem,
  PiTeacherProfileResponse,
} from '../types';
import {
  askPwPi,
  buildPdfProxyUrl,
  downloadPdfFile,
  fetchPiOttCategories,
  fetchPiOttHome,
  fetchPiOttSeriesDetail,
  fetchPiOttTeacherProfile,
  prefetchPiHome,
  resolveAttachmentUrl,
  startPwQuiz,
} from '../services/batchService';
import { recordStudyActivity } from '../services/adventureService';
import { openLectureDownloadModal } from '../services/lectureDownloadManager';
import type { PlayLecturePayload } from './BatchDetailsModal';

interface PiViewProps {
  onAskAi: (prompt?: string) => void;
  onActivityUpdate?: () => void;
  onPlayLecture?: (lecture: PlayLecturePayload) => void;
  xp?: number;
}

const GOAL_STORAGE_KEY = 'studycloud_pi_goal_v1';
const FOLLOW_TEACHERS_KEY = 'studycloud_pi_followed_teachers_v1';

const PASTEL_BG = [
  'from-indigo-500/20 to-violet-500/10 border-indigo-500/25',
  'from-sky-500/20 to-cyan-500/10 border-sky-500/25',
  'from-emerald-500/20 to-teal-500/10 border-emerald-500/25',
  'from-amber-500/20 to-orange-500/10 border-amber-500/25',
  'from-rose-500/20 to-pink-500/10 border-rose-500/25',
  'from-purple-500/20 to-fuchsia-500/10 border-purple-500/25',
];

function getInitials(name: string): string {
  return (name || 'SC')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}

export const PiView: React.FC<PiViewProps> = ({
  onAskAi,
  onActivityUpdate,
  onPlayLecture,
  xp = 0,
}) => {
  // Categories & Selected Goal
  const [categories, setCategories] = useState<PiCategory[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string>(() => {
    try {
      return localStorage.getItem(GOAL_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [showGoalPicker, setShowGoalPicker] = useState<boolean>(false);

  // OTT Feed state
  const [activeSubId, setActiveSubId] = useState<string>('all');
  const [conceptQuery, setConceptQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [homeData, setHomeData] = useState<PiHomeResponse | null>(null);
  const [loadingHome, setLoadingHome] = useState<boolean>(true);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [heroIdx, setHeroIdx] = useState<number>(0);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  // Followed Teachers
  const [followedTeacherIds, setFollowedTeacherIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(FOLLOW_TEACHERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Teacher Profile Overlay
  const [selectedTeacher, setSelectedTeacher] = useState<PiTeacherItem | null>(null);
  const [teacherProfile, setTeacherProfile] = useState<PiTeacherProfileResponse | null>(null);
  const [loadingTeacher, setLoadingTeacher] = useState<boolean>(false);

  // Series / Playlist Episodes Modal
  const [selectedSeries, setSelectedSeries] = useState<PiSeriesItem | null>(null);
  const [seriesDetail, setSeriesDetail] = useState<PiSeriesDetailResponse | null>(null);
  const [loadingSeries, setLoadingSeries] = useState<boolean>(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  // Practice Quiz Modal inside Pi
  const [activeQuiz, setActiveQuiz] = useState<{
    title: string;
    subject: string;
    questions: Array<{
      question: string;
      options: string[];
      correctIndex: number;
      explanation: string;
      topic?: string;
    }>;
    durationMinutes: number;
  } | null>(null);
  const [loadingQuizId, setLoadingQuizId] = useState<string | null>(null);
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  // Concept Doubt Drawer inside Pi
  const [showConceptSolver, setShowConceptSolver] = useState(false);
  const [solverPrompt, setSolverPrompt] = useState('');
  const [solverAnswer, setSolverAnswer] = useState('');
  const [solverLoading, setSolverLoading] = useState(false);

  // Debounce concept search
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(conceptQuery), 320);
    return () => window.clearTimeout(t);
  }, [conceptQuery]);

  // Load Categories initially
  useEffect(() => {
    let cancelled = false;
    fetchPiOttCategories()
      .then((cats) => {
        if (cancelled || cats.length === 0) return;
        setCategories(cats);
        if (!selectedGoalId || !cats.some((c) => c.id === selectedGoalId)) {
          const defaultCat = cats.find((c) => /iit jee/i.test(c.name)) || cats[0];
          setSelectedGoalId(defaultCat.id);
          // Show subtle first-time goal chooser if user hasn't picked one yet
          try {
            if (!localStorage.getItem(GOAL_STORAGE_KEY)) {
              setShowGoalPicker(true);
            }
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Load Pi OTT Home Feed when Goal, Subcategory, or Concept Query changes
  useEffect(() => {
    if (!selectedGoalId) return;
    let cancelled = false;
    let warmTimer: number | null = null;
    setLoadingHome(true);
    setHomeError(null);
    fetchPiOttHome(selectedGoalId, activeSubId, debouncedQuery)
      .then((data) => {
        if (cancelled) return;
        setHomeData(data);
        setHeroIdx(0);
        // Idle prefetch top series, first teacher profile, and sibling goals so taps feel instant
        warmTimer = window.setTimeout(() => {
          if (cancelled) return;
          if (data.top10Series?.[0]) {
            const s = data.top10Series[0];
            void fetchPiOttSeriesDetail({
              seriesId: s.id,
              type: s.type,
              programId: s.programId,
              subjectId: s.subjectId,
            }).catch(() => {});
          }
          if (data.teachers?.[0]) {
            const t = data.teachers[0];
            void fetchPiOttTeacherProfile(t.id, t.programId).catch(() => {});
          }
          for (const c of categories.slice(0, 3)) {
            if (c.id !== selectedGoalId) prefetchPiHome(c.id);
          }
        }, 700);
      })
      .catch((err: any) => {
        if (!cancelled) setHomeError(err?.message || 'Unable to load Pi Pro OTT shows right now.');
      })
      .finally(() => {
        if (!cancelled) setLoadingHome(false);
      });
    return () => {
      cancelled = true;
      if (warmTimer) window.clearTimeout(warmTimer);
    };
  }, [selectedGoalId, activeSubId, debouncedQuery]);

  // Auto-rotate Hero Banner every 6s
  useEffect(() => {
    const slidesLen = homeData?.heroSlides?.length || 0;
    if (slidesLen <= 1) return;
    const timer = window.setInterval(() => {
      setHeroIdx((prev) => (prev + 1) % slidesLen);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [homeData?.heroSlides?.length]);

  const handleChooseGoal = (goalId: string) => {
    setSelectedGoalId(goalId);
    setActiveSubId('all');
    setShowGoalPicker(false);
    try {
      localStorage.setItem(GOAL_STORAGE_KEY, goalId);
    } catch {
      // ignore
    }
  };

  const handleToggleFollow = (teacherId: string) => {
    setFollowedTeacherIds((prev) => {
      const next = prev.includes(teacherId)
        ? prev.filter((id) => id !== teacherId)
        : [teacherId, ...prev];
      try {
        localStorage.setItem(FOLLOW_TEACHERS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleOpenTeacher = async (teacher: PiTeacherItem) => {
    setSelectedTeacher(teacher);
    setTeacherProfile(null);
    setLoadingTeacher(true);
    try {
      const res = await fetchPiOttTeacherProfile(teacher.id, teacher.programId);
      setTeacherProfile(res);
    } catch {
      // leave minimal fallback in overlay
    } finally {
      setLoadingTeacher(false);
    }
  };

  const handleOpenSeries = async (series: PiSeriesItem, subjectOverride?: string, topicOverride?: string) => {
    setSelectedSeries(series);
    setLoadingSeries(true);
    setSeriesError(null);
    try {
      const res = await fetchPiOttSeriesDetail({
        seriesId: series.id,
        type: series.type,
        programId: series.programId,
        subjectId: subjectOverride || series.subjectId,
        topicId: topicOverride,
      });
      setSeriesDetail(res);
    } catch (err: any) {
      setSeriesError(err?.message || 'Could not load episodes for this series.');
    } finally {
      setLoadingSeries(false);
    }
  };

  const handlePlayEpisode = (ep: PiEpisodeItem, seriesTitle?: string) => {
    if (!onPlayLecture) return;
    recordStudyActivity();
    onActivityUpdate?.();
    onPlayLecture({
      batchId: ep.batchId || ep.programId || 'pi-ott',
      batchName: seriesTitle || 'PW Pi Pro (OTT)',
      programId: ep.programId,
      subjectId: ep.subjectId,
      subjectName: homeData?.category?.name || 'Concept OTT',
      topicId: ep.topicId,
      topicName: ep.topicName || seriesTitle || 'Episode',
      videoId: ep.id,
      findKey: ep.findKey,
      videoDetailsId: ep.videoDetailsId,
      title: ep.title,
      videoImg: ep.thumb || '',
      videoType: ep.videoType || 'new',
      playType: 'Lecture',
      rawVideoUrl: ep.rawVideoUrl || '',
      durationText: ep.duration,
    });
  };

  const handleLaunchPiQuiz = async (card: PiQuizCard) => {
    if (loadingQuizId) return;
    setLoadingQuizId(card.id);
    try {
      const res = await startPwQuiz({
        batchName: homeData?.category?.name || 'PW Pi Pro',
        subjectName: card.subject,
        topicName: card.title,
        title: card.title,
        count: card.questionsCount || 8,
      });
      setActiveQuiz({
        title: card.title,
        subject: card.subject,
        questions: res.questions,
        durationMinutes: card.durationMinutes || 10,
      });
      setQuizIdx(0);
      setQuizAnswers({});
      setQuizSubmitted(false);
    } catch {
      onAskAi(`Create a quick ${card.questionsCount}-question MCQ practice test for ${card.subject}: ${card.title}`);
    } finally {
      setLoadingQuizId(null);
    }
  };

  const handleSolveConcept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!solverPrompt.trim() || solverLoading) return;
    setSolverLoading(true);
    try {
      const res = await askPwPi({
        query: solverPrompt.trim(),
        subject: homeData?.category?.name || 'Science',
        mode: 'concept',
      });
      setSolverAnswer(res.answer);
      recordStudyActivity();
      onActivityUpdate?.();
    } catch {
      onAskAi(solverPrompt.trim());
    } finally {
      setSolverLoading(false);
    }
  };

  const markImgFailed = (key: string) => {
    setFailedImages((prev) => ({ ...prev, [key]: true }));
  };

  const activeCategory = useMemo(
    () =>
      categories.find((c) => c.id === selectedGoalId) ||
      homeData?.category || {
        id: selectedGoalId || 'iit-jee',
        name: 'IIT JEE',
        tagline: 'Concept OTT Vault',
        icon: '',
        subcategories: [],
      },
    [categories, selectedGoalId, homeData?.category]
  );

  const heroSlides = homeData?.heroSlides || [];
  const currentHero = heroSlides[heroIdx] || heroSlides[0] || null;

  return (
    <div className="space-y-5">
      {/* Sticky PW Pi OTT Header Bar (StudyParcham style) */}
      <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3 sm:p-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Brand Logo (pı with gold accent) + Goal Switcher */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowGoalPicker(true)}
                className="group flex items-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-1.5 hover:border-amber-400/60 transition"
                title="Switch Study Goal"
              >
                <span className="font-['Sora'] text-xl sm:text-2xl font-black tracking-tight text-[var(--text-primary)] leading-none">
                  p<span className="text-amber-400">ı</span>
                </span>
                <span className="h-4 w-px bg-[var(--card-border)]" />
                <span className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[var(--text-primary)]">
                  {activeCategory.icon && !failedImages[`cat-hdr-${activeCategory.id}`] ? (
                    <img
                      src={activeCategory.icon}
                      alt={activeCategory.name}
                      referrerPolicy="no-referrer"
                      onError={() => markImgFailed(`cat-hdr-${activeCategory.id}`)}
                      className="h-4 w-4 rounded-sm object-contain"
                    />
                  ) : (
                    <GraduationCap className="h-4 w-4 text-amber-400" />
                  )}
                  <span>{activeCategory.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--text-secondary)] group-hover:translate-x-0.5 transition" />
                </span>
              </button>

              <span className="hidden sm:inline-block text-xs font-semibold text-[var(--text-secondary)]">
                Pi Pro OTT · Free Concept Series &amp; Lectures
              </span>
            </div>

            {/* Mobile XP + Quick Doubt toggle */}
            <div className="flex items-center gap-2 md:hidden">
              <div className="flex items-center gap-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 font-mono text-xs font-extrabold text-amber-400">
                <Trophy className="h-3.5 w-3.5" />
                <span>{xp}</span>
              </div>
            </div>
          </div>

          {/* Concept Search + Doubt Solver + XP Hex */}
          <div className="flex flex-1 md:max-w-xl items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
              <input
                type="text"
                value={conceptQuery}
                onChange={(e) => setConceptQuery(e.target.value)}
                placeholder="Search for a Concept, Series, or Star Teacher..."
                className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] py-2 pl-9 pr-12 text-xs sm:text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:outline-none"
              />
              {conceptQuery && (
                <button
                  type="button"
                  onClick={() => setConceptQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Clear
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowConceptSolver((v) => !v)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                showConceptSolver
                  ? 'border-[var(--primary-color)] bg-[var(--primary-color)] text-white'
                  : 'border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:border-[var(--primary-color)]'
              }`}
              title="Quick Concept & Formula Solver"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Pi Solver</span>
            </button>

            <div className="hidden md:flex shrink-0 items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 font-mono tabular-nums text-xs font-extrabold text-amber-400">
              <Trophy className="h-3.5 w-3.5" />
              <span>{xp} XP</span>
            </div>
          </div>
        </div>

        {/* Subcategory Filter Pills */}
        {(homeData?.subcategories || activeCategory.subcategories || []).length > 0 && (
          <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {(homeData?.subcategories || activeCategory.subcategories).map((sub) => {
              const isActive = activeSubId === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setActiveSubId(sub.id)}
                  className={`shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                    isActive
                      ? 'bg-[var(--primary-color)] text-white shadow-sm'
                      : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {sub.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Collapsible Pi Concept & Derivation Solver */}
      {showConceptSolver && (
        <div className="rounded-2xl border border-[var(--primary-color)]/35 bg-[var(--card-bg)] p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              <h3 className="font-['Sora'] text-sm font-extrabold text-[var(--text-primary)]">
                Quick Concept &amp; Formula Explainer ({activeCategory.name})
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowConceptSolver(false)}
              className="text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Close
            </button>
          </div>
          <form onSubmit={handleSolveConcept} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={solverPrompt}
              onChange={(e) => setSolverPrompt(e.target.value)}
              placeholder="Ask any Physics, Chem, Maths, or Exam concept (e.g., Rotational moment of inertia shortcuts)..."
              className="flex-1 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3.5 py-2 text-xs sm:text-sm text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={solverLoading || !solverPrompt.trim()}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50 transition"
            >
              {solverLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              <span>Explain Concept</span>
            </button>
          </form>
          {solverAnswer && (
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3.5 text-xs sm:text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
              {solverAnswer}
            </div>
          )}
        </div>
      )}

      {/* Loading / Error State */}
      {loadingHome ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] py-16 gap-3 text-xs sm:text-sm text-[var(--text-secondary)]">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--primary-color)]" />
          <span>Loading {activeCategory.name} OTT Concept Series &amp; Star Educators...</span>
        </div>
      ) : homeError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center space-y-2">
          <p className="text-xs sm:text-sm text-red-300">{homeError}</p>
          <button
            type="button"
            onClick={() => handleChooseGoal(selectedGoalId || categories[0]?.id || '')}
            className="rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs font-bold text-white"
          >
            Retry Loading OTT
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 1. Featured Hero Spotlight Carousel */}
          {currentHero && (
            <div className="relative overflow-hidden rounded-3xl border border-[var(--card-border)] bg-slate-950 shadow-lg">
              <div className="relative min-h-[220px] sm:min-h-[270px] lg:min-h-[300px] flex items-end">
                {currentHero.backdrop && !failedImages[`hero-${currentHero.id}`] ? (
                  <img
                    src={currentHero.backdrop}
                    alt={currentHero.title}
                    referrerPolicy="no-referrer"
                    onError={() => markImgFailed(`hero-${currentHero.id}`)}
                    className="absolute inset-0 h-full w-full object-cover object-center opacity-55"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/70 via-slate-900 to-purple-950/70" />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/75 to-black/30" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-transparent to-black/30" />

                <div className="relative z-10 flex w-full flex-col sm:flex-row sm:items-end justify-between gap-4 p-5 sm:p-7">
                  <div className="max-w-2xl space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                      <span className="rounded-md bg-amber-400 px-2 py-0.5 font-['Sora'] text-slate-950">
                        pı OTT Spotlight
                      </span>
                      <span className="text-indigo-300">{currentHero.subjectName}</span>
                      <span aria-hidden="true" className="text-slate-400">·</span>
                      <span className="text-slate-300">{currentHero.tag}</span>
                    </div>
                    <h2 className="font-['Sora'] text-xl sm:text-2xl lg:text-3xl font-extrabold text-white leading-tight line-clamp-2">
                      {currentHero.title}
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-300 line-clamp-2">
                      {currentHero.teacherName} · {currentHero.subtitle}
                    </p>
                    <div className="pt-1 flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleOpenSeries(currentHero)}
                        className="flex items-center gap-2 rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md hover:opacity-90 active:scale-95 transition"
                      >
                        <Play className="h-4 w-4 fill-white" />
                        <span>Watch Concept Series</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowGoalPicker(true)}
                        className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-bold text-white backdrop-blur hover:bg-white/15 transition"
                      >
                        Change Exam Goal
                      </button>
                    </div>
                  </div>

                  {/* Carousel Nav Controls */}
                  {heroSlides.length > 1 && (
                    <div className="flex items-center gap-2 self-end">
                      <button
                        type="button"
                        onClick={() => setHeroIdx((prev) => (prev - 1 + heroSlides.length) % heroSlides.length)}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white hover:bg-black/80"
                        aria-label="Previous featured series"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <div className="flex items-center gap-1.5">
                        {heroSlides.map((s, idx) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setHeroIdx(idx)}
                            className={`h-1.5 rounded-full transition-all ${
                              idx === heroIdx ? 'w-5 bg-amber-400' : 'w-1.5 bg-white/40'
                            }`}
                            aria-label={`Slide ${idx + 1}`}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setHeroIdx((prev) => (prev + 1) % heroSlides.length)}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white hover:bg-black/80"
                        aria-label="Next featured series"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 2. Top 10 Trending Series (Netflix/OTT Rank Typography) */}
          {(homeData?.top10Series || []).length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                  <Flame className="h-4 w-4 text-amber-400" />
                  <span>Top 10 Series in {activeCategory.name}</span>
                </h3>
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  Tap any series to stream
                </span>
              </div>

              <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
                {homeData!.top10Series.map((series, idx) => (
                  <button
                    key={series.id}
                    type="button"
                    onClick={() => handleOpenSeries(series)}
                    className="group relative flex shrink-0 items-end gap-0 text-left w-[200px] sm:w-[224px]"
                  >
                    <span className="font-['Sora'] text-6xl sm:text-7xl font-black leading-none tracking-tighter text-[var(--text-primary)]/15 group-hover:text-[var(--primary-color)]/60 select-none -mr-2.5 z-0 transition">
                      {idx + 1}
                    </span>
                    <div className="relative z-10 flex-1 overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] group-hover:border-[var(--primary-color)] transition shadow-sm">
                      <div className="relative aspect-[4/3] w-full bg-slate-900 overflow-hidden">
                        {series.poster && !failedImages[`top10-${series.id}`] ? (
                          <img
                            src={series.poster}
                            alt={series.title}
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            onError={() => markImgFailed(`top10-${series.id}`)}
                            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-900 to-slate-900 p-3">
                            <Video className="h-7 w-7 text-indigo-400" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                        <span className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary-color)] text-white shadow">
                          <Play className="h-3.5 w-3.5 fill-white ml-0.5" />
                        </span>
                      </div>
                      <div className="p-2.5">
                        <div className="text-[10px] font-bold text-[var(--primary-color)] truncate">
                          {series.subjectName}
                        </div>
                        <h4 className="font-['Sora'] text-xs font-extrabold text-[var(--text-primary)] line-clamp-1 mt-0.5">
                          {series.title}
                        </h4>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* 3. Star Teachers Grid (Click -> Full Teacher Profile Overlay) */}
          {(homeData?.teachers || []).length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)]">
                  Star Educators · Concept Mentors
                </h3>
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  {homeData!.teachers.length} Faculty
                </span>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {homeData!.teachers.map((teacher, idx) => {
                  const isFollowed = followedTeacherIds.includes(teacher.id);
                  const pastel = PASTEL_BG[idx % PASTEL_BG.length];
                  return (
                    <button
                      key={teacher.id}
                      type="button"
                      onClick={() => handleOpenTeacher(teacher)}
                      className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-b ${pastel} p-2.5 text-center transition hover:scale-[1.02] hover:border-[var(--primary-color)]`}
                    >
                      {isFollowed && (
                        <span
                          className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow"
                          title="Following"
                        >
                          <UserCheck className="h-3 w-3" />
                        </span>
                      )}
                      <div className="mx-auto aspect-square w-full max-w-[96px] overflow-hidden rounded-xl bg-[var(--bg-secondary)]/80">
                        {teacher.image && !failedImages[`tch-${teacher.id}`] ? (
                          <img
                            src={teacher.image}
                            alt={teacher.name}
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            onError={() => markImgFailed(`tch-${teacher.id}`)}
                            className="h-full w-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center font-['Sora'] text-lg font-extrabold text-[var(--primary-color)]">
                            {getInitials(teacher.name)}
                          </div>
                        )}
                      </div>
                      <h4 className="mt-2 font-['Sora'] text-xs font-extrabold text-[var(--text-primary)] truncate">
                        {teacher.name}
                      </h4>
                      <p className="text-[11px] font-semibold text-[var(--text-secondary)] truncate">
                        {teacher.subject}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* 4. Latest Concept Series (2:3 Poster Cards) */}
          {(homeData?.latestSeries || []).length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)]">
                  Latest Concept Series
                </h3>
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  Full Episodes &amp; PDFs
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {homeData!.latestSeries.map((series) => (
                  <button
                    key={`lat-${series.id}`}
                    type="button"
                    onClick={() => handleOpenSeries(series)}
                    className="group overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] text-left hover:border-[var(--primary-color)] transition"
                  >
                    <div className="relative aspect-[3/4] w-full bg-slate-900 overflow-hidden">
                      {series.poster && !failedImages[`lat-${series.id}`] ? (
                        <img
                          src={series.poster}
                          alt={series.title}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          onError={() => markImgFailed(`lat-${series.id}`)}
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-indigo-950 via-slate-900 to-purple-950 p-3 text-center">
                          <BookOpen className="h-7 w-7 text-indigo-400 mb-1.5" />
                          <span className="text-[11px] font-bold text-indigo-200 line-clamp-2">
                            {series.subjectName}
                          </span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                      <span className="absolute top-2 left-2 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur">
                        {series.tag}
                      </span>
                      <div className="absolute bottom-2 inset-x-2">
                        <h4 className="font-['Sora'] text-xs font-extrabold text-white line-clamp-2 leading-snug">
                          {series.title}
                        </h4>
                        <p className="mt-0.5 text-[10px] text-slate-300 truncate">{series.teacherName}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* 5. Popular Playlists (16:9 Landscape Strip) */}
          {(homeData?.conceptPlaylists || []).length > 0 && (
            <section className="space-y-3">
              <h3 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)]">
                Most Watched Concept Playlists
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {homeData!.conceptPlaylists.slice(0, 8).map((pl) => (
                  <button
                    key={`pl-${pl.id}`}
                    type="button"
                    onClick={() => handleOpenSeries(pl)}
                    className="group overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] text-left hover:border-[var(--primary-color)] transition"
                  >
                    <div className="relative aspect-video w-full bg-slate-900 overflow-hidden">
                      {pl.backdrop && !failedImages[`pl-${pl.id}`] ? (
                        <img
                          src={pl.backdrop}
                          alt={pl.title}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          onError={() => markImgFailed(`pl-${pl.id}`)}
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-tr from-slate-900 to-indigo-950">
                          <Video className="h-8 w-8 text-indigo-400" />
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary-color)] text-white shadow-lg">
                          <Play className="h-4 w-4 fill-white ml-0.5" />
                        </div>
                      </div>
                    </div>
                    <div className="p-3 space-y-0.5">
                      <div className="text-[11px] font-bold text-[var(--primary-color)] truncate">
                        {pl.subjectName} · {pl.year}
                      </div>
                      <h4 className="font-['Sora'] text-xs sm:text-sm font-extrabold text-[var(--text-primary)] line-clamp-1">
                        {pl.title}
                      </h4>
                      <p className="text-[11px] text-[var(--text-secondary)] truncate">{pl.teacherName}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* 6. Quiz of the Day & Rapid Practice Arena */}
          {(homeData?.quizCards || []).length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)]">
                  Quiz of the Day · Test Arena
                </h3>
                <span className="text-xs font-semibold text-emerald-400">
                  +4 / -1 NTA CBT Mode
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {homeData!.quizCards.map((card) => {
                  const isBusy = loadingQuizId === card.id;
                  return (
                    <div
                      key={card.id}
                      className="flex flex-col justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-bold">
                          <span className="text-amber-400">{card.badge}</span>
                          <span className="font-mono text-[var(--text-secondary)]">
                            {card.questionsCount} Qs · {card.durationMinutes} min
                          </span>
                        </div>
                        <h4 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)]">
                          {card.title}
                        </h4>
                        <p className="text-xs text-[var(--text-secondary)]">Subject: {card.subject}</p>
                      </div>

                      <button
                        type="button"
                        disabled={Boolean(loadingQuizId)}
                        onClick={() => handleLaunchPiQuiz(card)}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60 transition"
                      >
                        {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-white" />}
                        <span>{isBusy ? 'Preparing CBT...' : 'Attempt Now'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {/* MODAL 1: Choose Exam Goal Modal (StudyParcham 20+ PW Categories) */}
      {showGoalPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-5 backdrop-blur-sm">
          <div className="flex max-h-[88dvh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--card-border)] bg-[var(--bg-secondary)] px-5 py-4">
              <div>
                <h2 className="font-['Sora'] text-lg sm:text-xl font-extrabold text-[var(--text-primary)]">
                  Choose Your Target Goal in p<span className="text-amber-400">ı</span> OTT
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Select an exam stream to stream free Concept Series, Top Educators, and Quizzes
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGoalPicker(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                aria-label="Close goal chooser"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid flex-1 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 overflow-y-auto p-4 sm:p-5">
              {categories.map((cat) => {
                const isSelected = cat.id === selectedGoalId;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleChooseGoal(cat.id)}
                    className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${
                      isSelected
                        ? 'border-[var(--primary-color)] bg-[var(--primary-color)]/15'
                        : 'border-[var(--card-border)] bg-[var(--bg-secondary)] hover:border-[var(--primary-color)]/60'
                    }`}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--card-bg)] p-1.5">
                      {cat.icon && !failedImages[`cat-modal-${cat.id}`] ? (
                        <img
                          src={cat.icon}
                          alt={cat.name}
                          referrerPolicy="no-referrer"
                          onError={() => markImgFailed(`cat-modal-${cat.id}`)}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <GraduationCap className="h-5 w-5 text-[var(--primary-color)]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-['Sora'] text-xs sm:text-sm font-extrabold text-[var(--text-primary)] truncate">
                        {cat.name}
                      </div>
                      <div className="text-[10px] text-[var(--text-secondary)] truncate">{cat.tagline}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Full Teacher Profile Overlay */}
      {selectedTeacher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-sm">
          <div className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 sm:px-6 py-3.5">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setSelectedTeacher(null)}
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs font-bold text-[var(--text-primary)]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Back</span>
                </button>
                <span className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)] truncate">
                  {selectedTeacher.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTeacher(null)}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              {/* Teacher Hero Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-[var(--card-border)] bg-gradient-to-r from-indigo-950/60 via-[var(--bg-secondary)] to-[var(--bg-secondary)] p-4 sm:p-5">
                <div className="flex items-center gap-4">
                  <div className="h-20 w-20 sm:h-24 sm:w-24 shrink-0 overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--bg-tertiary)]">
                    {selectedTeacher.image && !failedImages[`tprof-${selectedTeacher.id}`] ? (
                      <img
                        src={selectedTeacher.image}
                        alt={selectedTeacher.name}
                        referrerPolicy="no-referrer"
                        onError={() => markImgFailed(`tprof-${selectedTeacher.id}`)}
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-['Sora'] text-2xl font-extrabold text-[var(--primary-color)]">
                        {getInitials(selectedTeacher.name)}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-[var(--primary-color)]">
                      {teacherProfile?.teacher?.subject || selectedTeacher.subject}
                    </div>
                    <h3 className="font-['Sora'] text-lg sm:text-xl font-extrabold text-[var(--text-primary)]">
                      {selectedTeacher.name}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {teacherProfile?.teacher?.experience || selectedTeacher.experience} ·{' '}
                      {teacherProfile?.teacher?.featuredLine || selectedTeacher.featuredLine}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggleFollow(selectedTeacher.id)}
                  className={`flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
                    followedTeacherIds.includes(selectedTeacher.id)
                      ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                      : 'bg-[var(--primary-color)] text-white shadow-sm'
                  }`}
                >
                  {followedTeacherIds.includes(selectedTeacher.id) ? (
                    <>
                      <UserCheck className="h-4 w-4" />
                      <span>Following</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      <span>Follow Mentor</span>
                    </>
                  )}
                </button>
              </div>

              {loadingTeacher ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-xs text-[var(--text-secondary)]">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--primary-color)]" />
                  <span>Loading faculty series &amp; lecture playlists...</span>
                </div>
              ) : (
                <>
                  {/* Teacher Series */}
                  {(teacherProfile?.series || []).length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)]">
                        Series &amp; Courses ({teacherProfile!.series.length})
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {teacherProfile!.series.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setSelectedTeacher(null);
                              handleOpenSeries(s);
                            }}
                            className="flex items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3 text-left hover:border-[var(--primary-color)] transition"
                          >
                            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-900">
                              {s.poster ? (
                                <img
                                  src={s.poster}
                                  alt={s.title}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-indigo-400">
                                  <BookOpen className="h-5 w-5" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-bold text-[var(--primary-color)] truncate">
                                {s.subjectName} · {s.year}
                              </div>
                              <div className="font-['Sora'] text-xs sm:text-sm font-extrabold text-[var(--text-primary)] line-clamp-2">
                                {s.title}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick Playlist Videos */}
                  {(teacherProfile?.playlistVideos || []).length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)]">
                        Quick Play Lectures
                      </h4>
                      <div className="space-y-2.5">
                        {teacherProfile!.playlistVideos.map((ep) => (
                          <div
                            key={ep.id}
                            onClick={() => handlePlayEpisode(ep, selectedTeacher.name)}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3 cursor-pointer hover:border-[var(--primary-color)] transition"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-color)]/15 text-[var(--primary-color)]">
                                <Play className="h-4 w-4 fill-current" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-['Sora'] text-xs sm:text-sm font-bold text-[var(--text-primary)] truncate">
                                  {ep.title}
                                </div>
                                <div className="text-[11px] text-[var(--text-secondary)] truncate">
                                  {ep.topicName} {ep.duration ? `· ${ep.duration}` : ''}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openLectureDownloadModal({
                                    batchId: ep.batchId || ep.programId || 'pi-ott',
                                    programId: ep.programId,
                                    subjectId: ep.subjectId,
                                    topicId: ep.topicId,
                                    videoId: ep.id,
                                    findKey: ep.findKey,
                                    videoDetailsId: ep.videoDetailsId,
                                    title: ep.title,
                                    videoImg: ep.thumb || '',
                                    videoType: ep.videoType || 'new',
                                    playType: 'Lecture',
                                    rawVideoUrl: ep.rawVideoUrl || '',
                                  });
                                }}
                                className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-emerald-400 hover:border-emerald-500/60 hover:bg-emerald-500/10 transition"
                                title="Download Lecture"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>
                              <span className="shrink-0 rounded-xl bg-[var(--primary-color)] px-3 py-1.5 text-xs font-bold text-white">
                                Watch
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Series Episodes & Notes Drawer */}
      {selectedSeries && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-sm">
          <div className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 sm:px-6 py-3.5 gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-[var(--primary-color)] truncate">
                  {selectedSeries.subjectName} · {selectedSeries.teacherName}
                </div>
                <h3 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)] truncate">
                  {selectedSeries.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSeries(null)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {/* Subject Switcher if Batch Series */}
              {(seriesDetail?.subjects || []).length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {seriesDetail!.subjects!.map((subj) => (
                    <button
                      key={subj.id}
                      type="button"
                      onClick={() => handleOpenSeries(selectedSeries, subj.id)}
                      className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                        seriesDetail?.activeSubjectId === subj.id
                          ? 'bg-[var(--primary-color)] text-white'
                          : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {subj.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Topic / Chapter Selector */}
              {(seriesDetail?.topics || []).length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {seriesDetail!.topics.map((tp) => (
                    <button
                      key={tp.id}
                      type="button"
                      onClick={() =>
                        handleOpenSeries(selectedSeries, seriesDetail?.activeSubjectId, tp.id)
                      }
                      className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                        seriesDetail?.activeTopicId === tp.id
                          ? 'bg-emerald-600 text-white'
                          : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {tp.name}
                    </button>
                  ))}
                </div>
              )}

              {loadingSeries ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-xs text-[var(--text-secondary)]">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--primary-color)]" />
                  <span>Loading Concept Episodes &amp; PDFs...</span>
                </div>
              ) : seriesError ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center text-xs text-red-300">
                  {seriesError}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Episodes */}
                  <div className="space-y-2.5">
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">
                      Concept Episodes ({seriesDetail?.episodes?.length || 0})
                    </h4>
                    {(seriesDetail?.episodes || []).length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[var(--card-border)] p-6 text-center text-xs text-[var(--text-secondary)]">
                        Try switching chapter or subject tab above to browse lectures.
                      </div>
                    ) : (
                      seriesDetail!.episodes.map((ep, idx) => (
                        <div
                          key={ep.id || idx}
                          onClick={() => handlePlayEpisode(ep, selectedSeries.title)}
                          className="group flex items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3 sm:p-3.5 cursor-pointer hover:border-[var(--primary-color)] transition"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-color)]/15 font-mono text-xs font-extrabold text-[var(--primary-color)]">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <div className="min-w-0">
                              <h5 className="font-['Sora'] text-xs sm:text-sm font-bold text-[var(--text-primary)] line-clamp-1 group-hover:text-[var(--primary-color)] transition">
                                {ep.title}
                              </h5>
                              <div className="text-[11px] text-[var(--text-secondary)] flex items-center gap-2">
                                <span>{ep.topicName}</span>
                                {ep.duration && (
                                  <>
                                    <span>·</span>
                                    <span className="font-mono">{ep.duration}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openLectureDownloadModal({
                                  batchId: ep.batchId || ep.programId || 'pi-ott',
                                  programId: ep.programId,
                                  subjectId: ep.subjectId,
                                  topicId: ep.topicId,
                                  videoId: ep.id,
                                  findKey: ep.findKey,
                                  videoDetailsId: ep.videoDetailsId,
                                  title: ep.title,
                                  videoImg: ep.thumb || '',
                                  videoType: ep.videoType || 'new',
                                  playType: 'Lecture',
                                  rawVideoUrl: ep.rawVideoUrl || '',
                                });
                              }}
                              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-emerald-400 hover:border-emerald-500/60 hover:bg-emerald-500/10 transition"
                              title="Download Episode"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            <span className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-3.5 py-2 text-xs font-bold text-white">
                              <Play className="h-3.5 w-3.5 fill-white" />
                              <span>Play</span>
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Attached Notes PDFs */}
                  {(seriesDetail?.notes || []).length > 0 && (
                    <div className="space-y-2.5 pt-2">
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">
                        Study Notes &amp; PDFs
                      </h4>
                      {seriesDetail!.notes.map((n: BatchNoteItem) =>
                        (n.homeworkIds || []).map((hw) =>
                          (hw.attachmentIds || []).map((att) => {
                            const directUrl = resolveAttachmentUrl(att);
                            if (!directUrl) return null;
                            const name = att.name || hw.topic || n.topic || 'Concept Notes.pdf';
                            return (
                              <div
                                key={`${hw._id}-${att._id}`}
                                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3.5 py-2.5"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <FileText className="h-4 w-4 shrink-0 text-pink-400" />
                                  <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                                    {name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <a
                                    href={buildPdfProxyUrl(directUrl, name, false)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-primary)]"
                                  >
                                    View
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => downloadPdfFile(directUrl, name)}
                                    className="rounded-lg bg-[var(--primary-color)] px-2.5 py-1 text-[11px] font-bold text-white"
                                  >
                                    Download
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Practice Quiz of the Day CBT Overlay */}
      {activeQuiz && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-sm">
          <div className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--card-border)] bg-[var(--bg-secondary)] px-5 py-3.5">
              <div>
                <div className="text-[11px] font-bold text-[var(--primary-color)]">
                  pı OTT Practice Arena · {activeQuiz.subject} (+4 / -1)
                </div>
                <h3 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)]">
                  {activeQuiz.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveQuiz(null)}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {!quizSubmitted ? (
                <>
                  <div className="flex items-center justify-between text-xs font-mono text-[var(--text-secondary)]">
                    <span>
                      Question {quizIdx + 1} / {activeQuiz.questions.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setQuizSubmitted(true);
                        recordStudyActivity();
                        onActivityUpdate?.();
                      }}
                      className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-sans font-bold text-white"
                    >
                      Submit Quiz
                    </button>
                  </div>

                  <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 space-y-3">
                    <p className="text-sm font-bold text-[var(--text-primary)] leading-relaxed">
                      {activeQuiz.questions[quizIdx].question}
                    </p>
                    <div className="space-y-2">
                      {activeQuiz.questions[quizIdx].options.map((opt, oIdx) => {
                        const picked = quizAnswers[quizIdx] === oIdx;
                        return (
                          <button
                            key={oIdx}
                            type="button"
                            onClick={() => setQuizAnswers((p) => ({ ...p, [quizIdx]: oIdx }))}
                            className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-xs sm:text-sm transition ${
                              picked
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
                      disabled={quizIdx === 0}
                      onClick={() => setQuizIdx((i) => Math.max(0, i - 1))}
                      className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-2 text-xs font-bold disabled:opacity-40"
                    >
                      Previous
                    </button>
                    {quizIdx < activeQuiz.questions.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => setQuizIdx((i) => i + 1)}
                        className="rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs font-bold text-white"
                      >
                        Next Question
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setQuizSubmitted(true);
                          recordStudyActivity();
                          onActivityUpdate?.();
                        }}
                        className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white"
                      >
                        Finish &amp; Check Score
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  {(() => {
                    let correct = 0;
                    let wrong = 0;
                    activeQuiz.questions.forEach((q, i) => {
                      if (quizAnswers[i] === undefined) return;
                      if (quizAnswers[i] === q.correctIndex) correct++;
                      else wrong++;
                    });
                    const score = correct * 4 - wrong;
                    return (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                        <div>
                          <div className="text-xs font-bold text-emerald-400">Practice Result (+4/-1)</div>
                          <div className="font-mono text-xl font-extrabold text-[var(--text-primary)]">
                            {score} / {activeQuiz.questions.length * 4} Marks ({correct} Correct · {wrong} Wrong)
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setQuizSubmitted(false);
                            setQuizAnswers({});
                            setQuizIdx(0);
                          }}
                          className="flex items-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-3.5 py-2 text-xs font-bold text-white"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Retake</span>
                        </button>
                      </div>
                    );
                  })()}

                  <div className="space-y-3">
                    {activeQuiz.questions.map((q, i) => {
                      const picked = quizAnswers[i];
                      const ok = picked === q.correctIndex;
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3.5 space-y-2"
                        >
                          <div className="flex items-center justify-between text-xs font-bold">
                            <span>Q{i + 1}</span>
                            <span className={picked === undefined ? 'text-slate-400' : ok ? 'text-emerald-400' : 'text-red-400'}>
                              {picked === undefined ? 'Skipped' : ok ? 'Correct (+4)' : 'Wrong (-1)'}
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm font-semibold text-[var(--text-primary)]">{q.question}</p>
                          <div className="text-xs text-emerald-300">
                            Answer: {String.fromCharCode(65 + q.correctIndex)}. {q.options[q.correctIndex]}
                          </div>
                          <div className="text-xs text-[var(--text-secondary)]">{q.explanation}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
