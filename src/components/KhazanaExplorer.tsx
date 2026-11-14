import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileText,
  Gem,
  GraduationCap,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  UserCheck,
  Users,
  Video,
  AlertCircle,
} from 'lucide-react';
import {
  AdventureState,
  KhazanaChapter,
  KhazanaContentItem,
  KhazanaProgramSummary,
  KhazanaSubTopic,
  KhazanaSubjectOption,
  KhazanaTeacher,
  KhazanaTopic,
} from '../types';
import {
  buildPdfProxyUrl,
  downloadPdfFile,
  fetchKhazanaContents,
  fetchKhazanaFilters,
  fetchKhazanaPrograms,
  fetchKhazanaSubjectChapters,
  fetchKhazanaSubTopics,
  fetchKhazanaTeacherChapters,
  fetchKhazanaTeachers,
  fetchKhazanaTopics,
  resolveAttachmentUrl,
} from '../services/batchService';
import { isLectureCompleted } from '../services/adventureService';
import type { PlayLecturePayload } from './BatchDetailsModal';

interface KhazanaExplorerProps {
  programId?: string;
  batchId?: string;
  batchName?: string;
  adventureState: AdventureState;
  onToggleLectureComplete: (params: {
    batchId: string;
    subjectId: string;
    topicId: string;
    videoId: string;
    title: string;
  }) => void;
  onPlayLecture: (lecture: PlayLecturePayload) => void;
}

type ExplorerLevel = 'programs' | 'overview' | 'chapters' | 'topics' | 'contents';

function resolveChapterSubjectId(chapter: KhazanaChapter | null, fallback = ''): string {
  if (!chapter) return fallback;
  if (typeof chapter.subjectId === 'string') return chapter.subjectId || fallback;
  if (chapter.subjectId && typeof chapter.subjectId === 'object') {
    return chapter.subjectId._id || fallback;
  }
  return fallback;
}

function resolveChapterSubjectName(chapter: KhazanaChapter | null, fallback = 'Subject'): string {
  if (!chapter) return fallback;
  if (chapter.subjectId && typeof chapter.subjectId === 'object' && chapter.subjectId.name) {
    return chapter.subjectId.name;
  }
  return fallback;
}

function resolveChapterImage(chapter: KhazanaChapter): string {
  if (chapter.backgroundImage) return chapter.backgroundImage;
  if (chapter.imageId?.baseUrl && chapter.imageId?.key) {
    return `${chapter.imageId.baseUrl}${chapter.imageId.key}`;
  }
  if (chapter.teacher?.imageId?.baseUrl && chapter.teacher?.imageId?.key) {
    return `${chapter.teacher.imageId.baseUrl}${chapter.teacher.imageId.key}`;
  }
  return '';
}

function resolveTeacherImage(teacher?: { imageId?: { baseUrl?: string; key?: string } }): string {
  if (teacher?.imageId?.baseUrl && teacher?.imageId?.key) {
    return `${teacher.imageId.baseUrl}${teacher.imageId.key}`;
  }
  return '';
}

export const KhazanaExplorer: React.FC<KhazanaExplorerProps> = ({
  programId: initialProgramId,
  batchId: initialBatchId,
  batchName: initialBatchName,
  adventureState,
  onToggleLectureComplete,
  onPlayLecture,
}) => {
  const isEmbedded = Boolean(initialProgramId);

  // Program selection state (Standalone Hub)
  const [programs, setPrograms] = useState<KhazanaProgramSummary[]>([]);
  const [loadingPrograms, setLoadingPrograms] = useState(!isEmbedded);
  const [programsError, setProgramsError] = useState<string | null>(null);
  const [programSearch, setProgramSearch] = useState('');
  const [selectedExamFilter, setSelectedExamFilter] = useState<string>('all');

  // Active Program context
  const [activeProgram, setActiveProgram] = useState<KhazanaProgramSummary | null>(
    initialProgramId
      ? {
          programId: initialProgramId,
          batchId: initialBatchId || initialProgramId,
          title: initialBatchName ? `${initialBatchName} Khazana` : 'Batch Khazana',
          subtitle: 'Recorded Khazana Vault',
          exam: '',
          classLevel: '',
          batchName: initialBatchName || 'Batch',
        }
      : null
  );

  // Navigation level inside Khazana
  const [level, setLevel] = useState<ExplorerLevel>(isEmbedded ? 'overview' : 'programs');

  // Program overview data: subjects, preview chapters per subject, teachers
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [programDisplayName, setProgramDisplayName] = useState(initialBatchName || '');
  const [subjects, setSubjects] = useState<KhazanaSubjectOption[]>([]);
  const [subjectPreviews, setSubjectPreviews] = useState<Record<string, KhazanaChapter[]>>({});
  const [loadingSubjectId, setLoadingSubjectId] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<KhazanaTeacher[]>([]);
  const [teachersPage, setTeachersPage] = useState(1);
  const [hasMoreTeachers, setHasMoreTeachers] = useState(false);
  const [loadingMoreTeachers, setLoadingMoreTeachers] = useState(false);
  const [teacherSearch, setTeacherSearch] = useState('');

  // Chapters grid (either by Subject or by Teacher)
  const [chapterSourceMode, setChapterSourceMode] = useState<'subject' | 'teacher'>('subject');
  const [selectedSubject, setSelectedSubject] = useState<KhazanaSubjectOption | null>(null);
  const [selectedTeacher, setSelectedTeacher] = useState<KhazanaTeacher | null>(null);
  const [chapters, setChapters] = useState<KhazanaChapter[]>([]);
  const [chaptersPage, setChaptersPage] = useState(1);
  const [hasMoreChapters, setHasMoreChapters] = useState(false);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [chaptersError, setChaptersError] = useState<string | null>(null);

  // Topics list inside selected course/chapter
  const [selectedChapter, setSelectedChapter] = useState<KhazanaChapter | null>(null);
  const [topics, setTopics] = useState<KhazanaTopic[]>([]);
  const [topicsPage, setTopicsPage] = useState(1);
  const [hasMoreTopics, setHasMoreTopics] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);

  // Contents inside selected topic
  const [selectedTopic, setSelectedTopic] = useState<KhazanaTopic | null>(null);
  const [subTopics, setSubTopics] = useState<KhazanaSubTopic[]>([]);
  const [activeSubTopic, setActiveSubTopic] = useState<KhazanaSubTopic | null>(null);
  const [loadingSubTopics, setLoadingSubTopics] = useState(false);
  const [contents, setContents] = useState<KhazanaContentItem[]>([]);
  const [contentsPage, setContentsPage] = useState(1);
  const [hasMoreContents, setHasMoreContents] = useState(false);
  const [loadingContents, setLoadingContents] = useState(false);
  const [contentsError, setContentsError] = useState<string | null>(null);

  // PDF Download state
  const [downloadingPdfKey, setDownloadingPdfKey] = useState<string | null>(null);
  const [downloadedPdfKey, setDownloadedPdfKey] = useState<string | null>(null);
  const [pdfDownloadError, setPdfDownloadError] = useState<string | null>(null);

  // Load curated Khazana programs list in standalone mode
  useEffect(() => {
    if (isEmbedded) return;
    let cancelled = false;
    setLoadingPrograms(true);
    setProgramsError(null);
    fetchKhazanaPrograms()
      .then((list) => {
        if (!cancelled) setPrograms(list);
      })
      .catch((err) => {
        if (!cancelled) setProgramsError(err?.message || 'Could not load Khazana programs.');
      })
      .finally(() => {
        if (!cancelled) setLoadingPrograms(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isEmbedded]);

  // Sync embedded program prop changes
  useEffect(() => {
    if (!initialProgramId) return;
    setActiveProgram({
      programId: initialProgramId,
      batchId: initialBatchId || initialProgramId,
      title: initialBatchName ? `${initialBatchName} Khazana` : 'Batch Khazana',
      subtitle: 'Recorded Khazana Vault',
      exam: '',
      classLevel: '',
      batchName: initialBatchName || 'Batch',
    });
    setLevel('overview');
    setSelectedSubject(null);
    setSelectedTeacher(null);
    setSelectedChapter(null);
    setSelectedTopic(null);
  }, [initialProgramId, initialBatchId, initialBatchName]);

  // Load active program overview (filters + subject previews + page 1 of teachers)
  useEffect(() => {
    if (!activeProgram?.programId) return;
    let cancelled = false;
    const progId = activeProgram.programId;

    setLoadingOverview(true);
    setOverviewError(null);
    setSubjects([]);
    setSubjectPreviews({});
    setTeachers([]);
    setTeachersPage(1);
    setHasMoreTeachers(false);
    setTeacherSearch('');

    Promise.all([
      fetchKhazanaFilters(progId),
      fetchKhazanaTeachers(progId, 1).catch(() => ({ teachers: [], paginate: null })),
    ])
      .then(async ([filtersRes, teachersRes]) => {
        if (cancelled) return;
        const subjList = filtersRes.subjects || [];
        setSubjects(subjList);
        if (filtersRes.name) {
          setProgramDisplayName(filtersRes.name);
        } else {
          setProgramDisplayName(activeProgram.title);
        }

        const tList = teachersRes.teachers || [];
        setTeachers(tList);
        const totalTeachers = Number(teachersRes.paginate?.totalCount || 0);
        setHasMoreTeachers(totalTeachers > tList.length || tList.length >= 20);

        // Preload top preview courses for first 6 subjects cleanly in parallel
        const previewTargets = subjList.slice(0, 6);
        const results = await Promise.allSettled(
          previewTargets.map((subj) =>
            fetchKhazanaSubjectChapters(progId, subj._id, 1, 8).then((res) => ({
              subjectId: subj._id,
              chapters: res.chapters || [],
            }))
          )
        );
        if (cancelled) return;
        const previewMap: Record<string, KhazanaChapter[]> = {};
        for (const r of results) {
          if (r.status === 'fulfilled') {
            previewMap[r.value.subjectId] = r.value.chapters;
          }
        }
        setSubjectPreviews(previewMap);
      })
      .catch((err) => {
        if (!cancelled) {
          setOverviewError(err?.message || 'Failed to load Khazana archive for this program.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingOverview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProgram?.programId]);

  const filteredPrograms = useMemo(() => {
    return programs.filter((p) => {
      const matchesExam =
        selectedExamFilter === 'all' ||
        p.exam.toLowerCase().includes(selectedExamFilter.toLowerCase());
      if (!matchesExam) return false;
      if (!programSearch.trim()) return true;
      const q = programSearch.toLowerCase().trim();
      const hay = `${p.title} ${p.subtitle} ${p.exam} ${p.classLevel} ${p.batchName}`.toLowerCase();
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
  }, [programs, selectedExamFilter, programSearch]);

  const filteredTeachers = useMemo(() => {
    if (!teacherSearch.trim()) return teachers;
    const q = teacherSearch.toLowerCase().trim();
    return teachers.filter((t) => {
      const hay = `${t.name || ''} ${t.firstName || ''} ${t.lastName || ''} ${t.subject || ''} ${t.featuredLine || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [teachers, teacherSearch]);

  const effectiveBatchId = initialBatchId || activeProgram?.batchId || activeProgram?.programId || '';

  const handleSelectProgram = (prog: KhazanaProgramSummary) => {
    setActiveProgram(prog);
    setLevel('overview');
    setSelectedSubject(null);
    setSelectedTeacher(null);
    setSelectedChapter(null);
    setSelectedTopic(null);
  };

  const handleLoadMoreTeachers = async () => {
    if (!activeProgram || loadingMoreTeachers) return;
    const nextPage = teachersPage + 1;
    setLoadingMoreTeachers(true);
    try {
      const res = await fetchKhazanaTeachers(activeProgram.programId, nextPage);
      const nextList = res.teachers || [];
      setTeachers((prev) => {
        const seen = new Set(prev.map((t) => t._id));
        const merged = [...prev];
        for (const t of nextList) {
          if (!seen.has(t._id)) merged.push(t);
        }
        const total = Number(res.paginate?.totalCount || 0);
        setHasMoreTeachers(total > 0 ? merged.length < total : nextList.length >= 20);
        return merged;
      });
      setTeachersPage(nextPage);
    } catch {
      setHasMoreTeachers(false);
    } finally {
      setLoadingMoreTeachers(false);
    }
  };

  const handleOpenSubjectChapters = async (subj: KhazanaSubjectOption) => {
    if (!activeProgram) return;
    setChapterSourceMode('subject');
    setSelectedSubject(subj);
    setSelectedTeacher(null);
    setSelectedChapter(null);
    setSelectedTopic(null);
    setChapters([]);
    setChaptersPage(1);
    setChaptersError(null);
    setLevel('chapters');
    setLoadingChapters(true);
    setLoadingSubjectId(subj._id);

    try {
      const res = await fetchKhazanaSubjectChapters(activeProgram.programId, subj._id, 1, 16);
      const list = res.chapters || [];
      setChapters(list);
      const total = Number(res.paginate?.totalCount || 0);
      setHasMoreChapters(total > 0 ? list.length < total : list.length >= 16);
    } catch (err: any) {
      setChaptersError(err?.message || 'Failed to load subject courses.');
    } finally {
      setLoadingChapters(false);
      setLoadingSubjectId(null);
    }
  };

  const handleOpenTeacherChapters = async (teacher: KhazanaTeacher) => {
    if (!activeProgram) return;
    setChapterSourceMode('teacher');
    setSelectedTeacher(teacher);
    setSelectedSubject(null);
    setSelectedChapter(null);
    setSelectedTopic(null);
    setChapters([]);
    setChaptersPage(1);
    setChaptersError(null);
    setLevel('chapters');
    setLoadingChapters(true);

    try {
      const res = await fetchKhazanaTeacherChapters(activeProgram.programId, teacher._id, 1, 20);
      const list = res.chapters || [];
      setChapters(list);
      const total = Number(res.paginate?.totalCount || 0);
      setHasMoreChapters(total > 0 ? list.length < total : list.length >= 20);
    } catch (err: any) {
      setChaptersError(err?.message || 'Failed to load faculty courses.');
    } finally {
      setLoadingChapters(false);
    }
  };

  const handleLoadMoreChapters = async () => {
    if (!activeProgram || loadingChapters) return;
    const nextPage = chaptersPage + 1;
    setLoadingChapters(true);
    try {
      const res =
        chapterSourceMode === 'teacher' && selectedTeacher
          ? await fetchKhazanaTeacherChapters(activeProgram.programId, selectedTeacher._id, nextPage, 20)
          : selectedSubject
          ? await fetchKhazanaSubjectChapters(activeProgram.programId, selectedSubject._id, nextPage, 16)
          : { chapters: [], paginate: null };
      const nextList = res.chapters || [];
      setChapters((prev) => {
        const merged = [...prev, ...nextList];
        const total = Number(res.paginate?.totalCount || 0);
        setHasMoreChapters(total > 0 ? merged.length < total : nextList.length >= 16);
        return merged;
      });
      setChaptersPage(nextPage);
    } catch {
      setHasMoreChapters(false);
    } finally {
      setLoadingChapters(false);
    }
  };

  const handleOpenChapterTopics = async (chapter: KhazanaChapter, fallbackSubject?: KhazanaSubjectOption) => {
    if (!activeProgram) return;
    const subjectId = resolveChapterSubjectId(
      chapter,
      fallbackSubject?._id || selectedSubject?._id || subjects[0]?._id || ''
    );
    if (!subjectId) return;

    if (fallbackSubject) {
      setSelectedSubject(fallbackSubject);
    } else if (!selectedSubject) {
      const matched = subjects.find((s) => s._id === subjectId);
      if (matched) setSelectedSubject(matched);
    }

    setSelectedChapter(chapter);
    setSelectedTopic(null);
    setTopics([]);
    setTopicsPage(1);
    setTopicsError(null);
    setLevel('topics');
    setLoadingTopics(true);

    try {
      const res = await fetchKhazanaTopics(activeProgram.programId, subjectId, chapter._id, 1, 20);
      const list = res.topics || [];
      setTopics(list);
      const total = Number(res.paginate?.totalCount || 0);
      setHasMoreTopics(total > 0 ? list.length < total : list.length >= 20);
    } catch (err: any) {
      setTopicsError(err?.message || 'Failed to load chapter topics.');
    } finally {
      setLoadingTopics(false);
    }
  };

  const handleLoadMoreTopics = async () => {
    if (!activeProgram || !selectedChapter || loadingTopics) return;
    const subjectId = resolveChapterSubjectId(selectedChapter, selectedSubject?._id || '');
    if (!subjectId) return;
    const nextPage = topicsPage + 1;
    setLoadingTopics(true);
    try {
      const res = await fetchKhazanaTopics(
        activeProgram.programId,
        subjectId,
        selectedChapter._id,
        nextPage,
        20
      );
      const nextList = res.topics || [];
      setTopics((prev) => {
        const merged = [...prev, ...nextList];
        const total = Number(res.paginate?.totalCount || 0);
        setHasMoreTopics(total > 0 ? merged.length < total : nextList.length >= 20);
        return merged;
      });
      setTopicsPage(nextPage);
    } catch {
      setHasMoreTopics(false);
    } finally {
      setLoadingTopics(false);
    }
  };

  const loadSubTopicContents = async (
    topic: KhazanaTopic,
    subTopic: KhazanaSubTopic,
    page = 1,
    append = false
  ) => {
    if (!activeProgram || !selectedChapter) return;
    const subjectId =
      topic.subjectId || resolveChapterSubjectId(selectedChapter, selectedSubject?._id || '');
    const chapterId = topic.chapterId || selectedChapter._id;
    setLoadingContents(true);
    setContentsError(null);

    try {
      const res = await fetchKhazanaContents(
        activeProgram.programId,
        subjectId,
        chapterId,
        topic._id,
        subTopic._id,
        page,
        20
      );
      const list = res.items || [];
      setContents((prev) => {
        const merged = append ? [...prev, ...list] : list;
        const total = Number(res.paginate?.totalCount || 0);
        setHasMoreContents(total > 0 ? merged.length < total : list.length >= 20);
        return merged;
      });
      setContentsPage(page);
    } catch (err: any) {
      setContentsError(err?.message || 'Could not load contents for this tab.');
    } finally {
      setLoadingContents(false);
    }
  };

  const handleOpenTopic = async (topic: KhazanaTopic) => {
    if (!activeProgram || !selectedChapter) return;
    const subjectId =
      topic.subjectId || resolveChapterSubjectId(selectedChapter, selectedSubject?._id || '');
    const chapterId = topic.chapterId || selectedChapter._id;

    setSelectedTopic(topic);
    setSubTopics([]);
    setActiveSubTopic(null);
    setContents([]);
    setContentsPage(1);
    setContentsError(null);
    setPdfDownloadError(null);
    setLevel('contents');
    setLoadingSubTopics(true);

    try {
      const res = await fetchKhazanaSubTopics(
        activeProgram.programId,
        subjectId,
        chapterId,
        topic._id
      );
      const list = [...(res.subTopics || [])].sort(
        (a, b) => (a.displayOrder ?? 99) - (b.displayOrder ?? 99)
      );
      setSubTopics(list);
      if (list.length > 0) {
        setActiveSubTopic(list[0]);
        await loadSubTopicContents(topic, list[0], 1, false);
      }
    } catch (err: any) {
      setContentsError(err?.message || 'Failed to load topic materials.');
    } finally {
      setLoadingSubTopics(false);
    }
  };

  const handleBack = () => {
    if (level === 'contents') {
      setSelectedTopic(null);
      setLevel('topics');
    } else if (level === 'topics') {
      setSelectedChapter(null);
      if (selectedSubject || selectedTeacher) {
        setLevel('chapters');
      } else {
        setLevel('overview');
      }
    } else if (level === 'chapters') {
      setSelectedSubject(null);
      setSelectedTeacher(null);
      setLevel('overview');
    } else if (level === 'overview' && !isEmbedded) {
      setActiveProgram(null);
      setLevel('programs');
    }
  };

  const handlePlayKhazanaLecture = (item: KhazanaContentItem) => {
    if (!activeProgram || !selectedChapter || !selectedTopic) return;
    const d = item.data || ({} as KhazanaContentItem['data']);
    const vd = d.videoDetails;
    const subjectId =
      d.subjectId ||
      selectedTopic.subjectId ||
      resolveChapterSubjectId(selectedChapter, selectedSubject?._id || 'khazana');
    const subjectName =
      d.subject?.name ||
      resolveChapterSubjectName(selectedChapter, selectedSubject?.name || 'Khazana');
    const rawUrl = vd?.embedCode || vd?.videoUrl || d.videoUrl || '';
    const isYt = (d.videoType || '').toLowerCase() === 'youtube';
    const title = d.title || d.name || vd?.name || 'Khazana Lecture';
    const subLabel = (activeSubTopic?.name || '').toLowerCase();
    const isDpp = subLabel.includes('dpp') || subLabel.includes('sol');

    onPlayLecture({
      batchId: effectiveBatchId,
      batchName: programDisplayName || activeProgram.title,
      programId: activeProgram.programId,
      subjectId,
      subjectName,
      topicId: selectedTopic._id,
      topicName: selectedTopic.name,
      videoId: d._id,
      findKey: vd?.findKey,
      videoDetailsId: vd?._id || vd?.id,
      typeId: vd?._id || vd?.id,
      title,
      videoImg: vd?.image || '',
      videoType: isYt ? 'youtube' : 'khazana',
      playType: isDpp ? 'solutions' : 'Lecture',
      rawVideoUrl: rawUrl,
      durationText: vd?.duration,
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

  // RENDER STEP 0: Standalone Khazana Program Directory
  if (level === 'programs' && !isEmbedded) {
    const examFilters = ['all', 'IIT-JEE', 'NEET', 'Boards', 'Foundation', 'UPSC'];
    return (
      <div className="space-y-6">
        {/* Khazana Vault Header Banner */}
        <div className="relative overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 sm:p-7 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-amber-400">
                <Gem className="h-4 w-4" />
                <span>Khazana Archive · Faculty & Concept Vault</span>
              </div>
              <h1 className="font-['Sora'] text-2xl sm:text-3xl md:text-4xl font-extrabold text-[var(--text-primary)]">
                Khazana Recorded Courses & Faculty Library
              </h1>
              <p className="text-sm sm:text-base text-[var(--text-secondary)] max-w-2xl">
                Access complete subject-wise and teacher-wise recorded chapter playlists across
                IIT-JEE, NEET, Boards, Foundation, and UPSC.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-5 py-3.5 shrink-0">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="font-mono tabular-nums text-lg font-extrabold text-[var(--text-primary)]">
                  {programs.length || '10'} Programs
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Star Faculty Archives
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Search + Exam Filters */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--text-secondary)]" />
            <input
              type="text"
              value={programSearch}
              onChange={(e) => setProgramSearch(e.target.value)}
              placeholder="Search Khazana by exam, class (11th, 12th, Dropper), or batch..."
              className="w-full rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] py-3.5 pl-12 pr-14 text-sm sm:text-base text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:outline-none"
            />
            {programSearch && (
              <button
                onClick={() => setProgramSearch('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {examFilters.map((exam) => {
              const isActive = selectedExamFilter === exam;
              return (
                <button
                  key={exam}
                  onClick={() => setSelectedExamFilter(exam)}
                  className={`shrink-0 rounded-2xl px-4 py-2.5 text-xs sm:text-sm font-bold transition ${
                    isActive
                      ? 'bg-[var(--primary-color)] text-white shadow-md'
                      : 'border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:border-[var(--primary-color)]/50 hover:text-[var(--text-primary)]'
                  }`}
                >
                  {exam === 'all' ? 'All Streams' : exam}
                </button>
              );
            })}
          </div>
        </div>

        {/* Program Cards Grid */}
        {loadingPrograms ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden animate-pulse"
              >
                <div className="aspect-video bg-[var(--bg-tertiary)]" />
                <div className="p-5 space-y-2.5">
                  <div className="h-5 w-2/3 rounded bg-[var(--bg-tertiary)]" />
                  <div className="h-4 w-1/2 rounded bg-[var(--bg-tertiary)]" />
                </div>
              </div>
            ))}
          </div>
        ) : programsError ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-red-500/30 bg-red-500/10 p-10 text-center gap-3">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-sm text-red-300">{programsError}</p>
          </div>
        ) : filteredPrograms.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[var(--card-border)] bg-[var(--bg-secondary)]/50 p-12 text-center">
            <Gem className="h-12 w-12 mx-auto text-slate-500 mb-3" />
            <h3 className="font-['Sora'] text-lg font-bold text-[var(--text-primary)]">
              No Khazana Program Found
            </h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Try another exam stream or clear your search query.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredPrograms.map((prog) => (
              <div
                key={prog.programId}
                onClick={() => handleSelectProgram(prog)}
                className="group cursor-pointer flex flex-col overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-sm transition hover:-translate-y-1 hover:border-[var(--primary-color)]/60 hover:shadow-xl"
              >
                <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                  {prog.photo ? (
                    <img
                      src={prog.photo}
                      alt={prog.title}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-amber-900/60 via-indigo-950 to-slate-900">
                      <Gem className="h-12 w-12 text-amber-400/70" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                  <div className="absolute top-3 left-3 flex items-center gap-2">
                    <span className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-extrabold text-slate-950 shadow">
                      KHAZANA
                    </span>
                    <span className="rounded-lg bg-black/65 px-2.5 py-1 text-xs font-bold text-white backdrop-blur-md">
                      {prog.exam}
                    </span>
                  </div>
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs text-slate-200">
                    <span className="font-semibold truncate">{prog.batchName}</span>
                    <span className="rounded-md bg-white/15 px-2 py-0.5 font-mono text-[11px] font-bold">
                      Class {prog.classLevel}
                    </span>
                  </div>
                </div>

                <div className="flex flex-1 flex-col justify-between p-5 space-y-3">
                  <div>
                    <h3 className="font-['Sora'] text-lg font-extrabold text-[var(--text-primary)] group-hover:text-[var(--primary-color)] transition">
                      {prog.title}
                    </h3>
                    <p className="mt-1 text-xs sm:text-sm text-[var(--text-secondary)] line-clamp-2">
                      {prog.subtitle}
                    </p>
                  </div>

                  <div className="flex items-center justify-between border-t border-[var(--card-border)] pt-3">
                    <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      Faculty & Subjects
                    </span>
                    <span className="flex items-center gap-1 text-xs sm:text-sm font-bold text-[var(--primary-color)]">
                      <span>Explore Vault</span>
                      <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition" />
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Deep Khazana Browser (Inside activeProgram)
  return (
    <div className="space-y-5">
      {/* Breadcrumb & Back Navigation Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {(level !== 'overview' || !isEmbedded) && (
            <button
              onClick={handleBack}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] px-3 text-xs sm:text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </button>
          )}

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs sm:text-sm">
            {!isEmbedded && (
              <>
                <button
                  onClick={() => {
                    setActiveProgram(null);
                    setLevel('programs');
                  }}
                  className="font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] whitespace-nowrap"
                >
                  Khazana
                </button>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
              </>
            )}

            <button
              onClick={() => {
                setSelectedSubject(null);
                setSelectedTeacher(null);
                setSelectedChapter(null);
                setSelectedTopic(null);
                setLevel('overview');
              }}
              className={`font-bold whitespace-nowrap transition ${
                level === 'overview'
                  ? 'text-[var(--primary-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {programDisplayName || activeProgram?.title || 'Khazana Vault'}
            </button>

            {(selectedTeacher || selectedSubject) && level !== 'overview' && (
              <>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                <button
                  onClick={() => {
                    setSelectedChapter(null);
                    setSelectedTopic(null);
                    setLevel('chapters');
                  }}
                  className={`font-bold whitespace-nowrap transition ${
                    level === 'chapters'
                      ? 'text-[var(--primary-color)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {selectedTeacher ? selectedTeacher.name : selectedSubject?.name}
                </button>
              </>
            )}

            {selectedChapter && (level === 'topics' || level === 'contents') && (
              <>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                <button
                  onClick={() => {
                    setSelectedTopic(null);
                    setLevel('topics');
                  }}
                  className={`font-bold truncate max-w-[160px] sm:max-w-[240px] transition ${
                    level === 'topics'
                      ? 'text-[var(--primary-color)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {selectedChapter.name}
                </button>
              </>
            )}

            {selectedTopic && level === 'contents' && (
              <>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                <span className="font-bold text-[var(--primary-color)] truncate max-w-[160px] sm:max-w-[260px]">
                  {selectedTopic.name}
                </span>
              </>
            )}
          </div>
        </div>

        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-400">
          <Gem className="h-3.5 w-3.5" />
          <span>Khazana Archive</span>
        </span>
      </div>

      {/* LEVEL 1: PROGRAM OVERVIEW (Subjects Carousels + Browse by Teachers) */}
      {level === 'overview' && (
        <>
          {loadingOverview ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-sm text-[var(--text-secondary)]">
              <Loader2 className="h-9 w-9 animate-spin text-[var(--primary-color)]" />
              <span>Loading Khazana subjects & faculty courses...</span>
            </div>
          ) : overviewError ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center gap-2">
              <AlertCircle className="h-7 w-7 text-red-400" />
              <p className="text-sm text-red-300">{overviewError}</p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Quick Subject Jump Strip */}
              {subjects.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">
                    Browse by Subject ({subjects.length})
                  </h3>
                  <div className="flex items-center gap-2.5 overflow-x-auto pb-1 no-scrollbar">
                    {subjects.map((subj) => (
                      <button
                        key={subj._id}
                        onClick={() => handleOpenSubjectChapters(subj)}
                        disabled={loadingSubjectId === subj._id}
                        className="flex shrink-0 items-center gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-2.5 text-xs sm:text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] hover:text-[var(--primary-color)] transition"
                      >
                        <BookOpen className="h-4 w-4 text-amber-400" />
                        <span>{subj.name}</span>
                        <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Subject-wise Course Carousels */}
              {subjects.map((subj) => {
                const list = subjectPreviews[subj._id] || [];
                if (list.length === 0) return null;
                return (
                  <div key={subj._id} className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                        <Layers className="h-4 w-4 text-[var(--primary-color)]" />
                        <span>{subj.name}</span>
                      </h3>
                      <button
                        onClick={() => handleOpenSubjectChapters(subj)}
                        className="flex items-center gap-1 text-xs sm:text-sm font-bold text-[var(--primary-color)] hover:underline"
                      >
                        <span>View All</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
                      {list.map((chap) => {
                        const thumb = resolveChapterImage(chap);
                        return (
                          <button
                            key={chap._id}
                            onClick={() => handleOpenChapterTopics(chap, subj)}
                            className="group flex w-64 sm:w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-left transition hover:-translate-y-0.5 hover:border-[var(--primary-color)]/60 hover:shadow-lg"
                          >
                            <div className="relative h-32 w-full overflow-hidden bg-slate-900">
                              {thumb ? (
                                <img
                                  src={thumb}
                                  alt={chap.name}
                                  className="h-full w-full object-cover object-top transition duration-300 group-hover:scale-105"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-900 to-slate-900">
                                  <GraduationCap className="h-10 w-10 text-indigo-400/70" />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                              <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                                {chap.year?.name && (
                                  <span className="rounded-md bg-black/70 px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                                    {chap.year.name}
                                  </span>
                                )}
                                {chap.batchType?.name && (
                                  <span className="rounded-md bg-amber-500/90 px-2 py-0.5 text-[10px] font-extrabold text-slate-950">
                                    {chap.batchType.name}
                                  </span>
                                )}
                              </div>
                              {chap.teacherName && (
                                <span className="absolute bottom-2 left-2.5 right-2.5 truncate text-xs font-bold text-white">
                                  {chap.teacherName}
                                </span>
                              )}
                            </div>

                            <div className="p-3.5 space-y-1">
                              <h4 className="font-['Sora'] text-sm font-extrabold text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--primary-color)] transition">
                                {chap.name}
                              </h4>
                              <p className="text-xs text-[var(--text-secondary)] truncate">
                                {chap.courseType?.name || subj.name}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Browse by Teachers Grid */}
              {teachers.length > 0 && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                        <UserCheck className="h-5 w-5 text-amber-400" />
                        <span>Browse by Star Faculty ({teachers.length})</span>
                      </h3>
                      <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
                        Pick a teacher to view all recorded Khazana playlists by them
                      </p>
                    </div>

                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
                      <input
                        type="text"
                        value={teacherSearch}
                        onChange={(e) => setTeacherSearch(e.target.value)}
                        placeholder="Filter faculty by name or subject..."
                        className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] py-2 pl-9 pr-3 text-xs sm:text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                    {filteredTeachers.map((teacher) => {
                      const img = resolveTeacherImage(teacher);
                      return (
                        <button
                          key={teacher._id}
                          onClick={() => handleOpenTeacherChapters(teacher)}
                          className="group flex items-center gap-3.5 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--primary-color)]/60 hover:bg-[var(--bg-tertiary)]"
                        >
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-indigo-500/15 border border-[var(--card-border)] flex items-center justify-center">
                            {img ? (
                              <img
                                src={img}
                                alt={teacher.name}
                                className="h-full w-full object-cover object-top"
                                loading="lazy"
                              />
                            ) : (
                              <span className="font-['Sora'] text-base font-extrabold text-indigo-400">
                                {(teacher.name || 'T').slice(0, 2).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="font-['Sora'] text-sm font-extrabold text-[var(--text-primary)] truncate group-hover:text-[var(--primary-color)] transition">
                              {teacher.name}
                            </h4>
                            <p className="text-xs font-semibold text-amber-400 truncate mt-0.5">
                              {teacher.subject || teacher.tags?.[0] || 'Faculty'}
                            </p>
                            {(teacher.experience || teacher.featuredLine) && (
                              <p className="text-[11px] text-[var(--text-secondary)] truncate mt-0.5">
                                {teacher.experience || teacher.featuredLine}
                              </p>
                            )}
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-secondary)] group-hover:text-[var(--primary-color)] transition" />
                        </button>
                      );
                    })}
                  </div>

                  {hasMoreTeachers && !teacherSearch && (
                    <div className="flex justify-center pt-1">
                      <button
                        onClick={handleLoadMoreTeachers}
                        disabled={loadingMoreTeachers}
                        className="flex items-center gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-5 py-2.5 text-xs sm:text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
                      >
                        {loadingMoreTeachers ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 text-[var(--primary-color)]" />
                        )}
                        <span>Load More Faculty</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* LEVEL 2: CHAPTERS / COURSES GRID (By Subject or By Teacher) */}
      {level === 'chapters' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-['Sora'] text-lg sm:text-xl font-extrabold text-[var(--text-primary)]">
                {selectedTeacher
                  ? `${selectedTeacher.name} — Courses`
                  : `${selectedSubject?.name || 'Subject'} Courses`}
              </h3>
              <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
                Select a playlist below to browse recorded chapters, lectures & PDFs
              </p>
            </div>
          </div>

          {loadingChapters && chapters.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-sm text-[var(--text-secondary)]">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--primary-color)]" />
              <span>Loading Khazana playlists...</span>
            </div>
          ) : chaptersError ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-300">
              {chaptersError}
            </div>
          ) : chapters.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-10 text-center text-sm text-[var(--text-secondary)]">
              No Khazana playlists available here yet.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {chapters.map((chap) => {
                  const thumb = resolveChapterImage(chap);
                  const subjName = resolveChapterSubjectName(
                    chap,
                    selectedSubject?.name || chap.courseType?.name || 'Khazana'
                  );
                  return (
                    <button
                      key={chap._id}
                      onClick={() => handleOpenChapterTopics(chap)}
                      className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-left transition hover:-translate-y-0.5 hover:border-[var(--primary-color)]/60 hover:shadow-lg"
                    >
                      <div className="relative h-36 w-full overflow-hidden bg-slate-900">
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={chap.name}
                            className="h-full w-full object-cover object-top transition duration-300 group-hover:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-900 to-slate-900">
                            <GraduationCap className="h-10 w-10 text-indigo-400/70" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                          <span className="rounded-lg bg-black/65 px-2.5 py-0.5 text-xs font-bold text-white backdrop-blur-md">
                            {subjName}
                          </span>
                          {chap.year?.name && (
                            <span className="rounded-lg bg-amber-500 px-2 py-0.5 font-mono text-xs font-extrabold text-slate-950">
                              {chap.year.name}
                            </span>
                          )}
                        </div>
                        {chap.teacherName && (
                          <span className="absolute bottom-2.5 left-3 right-3 truncate text-xs sm:text-sm font-bold text-white">
                            By {chap.teacherName}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col justify-between p-4 space-y-2">
                        <div>
                          <h4 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--primary-color)] transition">
                            {chap.name}
                          </h4>
                          {chap.description && (
                            <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">
                              {chap.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center justify-between pt-2 text-xs font-bold text-[var(--primary-color)]">
                          <span>{chap.batchType?.name || 'Recorded Playlist'}</span>
                          <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {hasMoreChapters && (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={handleLoadMoreChapters}
                    disabled={loadingChapters}
                    className="flex items-center gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-6 py-3 text-xs sm:text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
                  >
                    {loadingChapters && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>Load More Courses</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* LEVEL 3: CHAPTER TOPICS LIST */}
      {level === 'topics' && selectedChapter && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 sm:p-5">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-amber-400">
                <span>
                  {resolveChapterSubjectName(selectedChapter, selectedSubject?.name || 'Khazana')}
                </span>
                {selectedChapter.teacherName && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[var(--text-secondary)]">{selectedChapter.teacherName}</span>
                  </>
                )}
              </div>
              <h3 className="font-['Sora'] text-base sm:text-xl font-extrabold text-[var(--text-primary)]">
                {selectedChapter.name}
              </h3>
              {selectedChapter.description && (
                <p className="text-xs sm:text-sm text-[var(--text-secondary)] line-clamp-2">
                  {selectedChapter.description}
                </p>
              )}
            </div>
          </div>

          {loadingTopics && topics.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-sm text-[var(--text-secondary)]">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--primary-color)]" />
              <span>Loading chapters...</span>
            </div>
          ) : topicsError ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-300">
              {topicsError}
            </div>
          ) : topics.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-10 text-center text-sm text-[var(--text-secondary)]">
              No chapters listed inside this course yet.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
                {topics.map((topic, idx) => (
                  <button
                    key={topic._id}
                    onClick={() => handleOpenTopic(topic)}
                    className="group flex items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 sm:p-5 text-left transition hover:border-[var(--primary-color)]/60 hover:bg-[var(--bg-tertiary)]"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 font-mono tabular-nums text-xs sm:text-sm font-extrabold text-amber-400">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-bold text-[var(--text-secondary)]">
                          {topic.chapter || `CH - ${String(idx + 1).padStart(2, '0')}`}
                        </div>
                        <h4 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--primary-color)] transition">
                          {topic.name}
                        </h4>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-[var(--text-secondary)] group-hover:translate-x-0.5 group-hover:text-[var(--primary-color)] transition" />
                  </button>
                ))}
              </div>

              {hasMoreTopics && (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={handleLoadMoreTopics}
                    disabled={loadingTopics}
                    className="flex items-center gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-6 py-3 text-xs sm:text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)]"
                  >
                    {loadingTopics && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>Load More Chapters</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* LEVEL 4: TOPIC CONTENTS (Sub-topic tabs: Lectures / Notes / DPP / Sol) */}
      {level === 'contents' && selectedTopic && (
        <div className="space-y-4">
          {loadingSubTopics ? (
            <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-secondary)]">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--primary-color)]" />
              <span>Loading content categories...</span>
            </div>
          ) : subTopics.length > 0 ? (
            <div className="flex items-center gap-2.5 overflow-x-auto pb-1 no-scrollbar">
              {subTopics.map((st) => {
                const isActive = activeSubTopic?._id === st._id;
                return (
                  <button
                    key={st._id}
                    onClick={() => {
                      setActiveSubTopic(st);
                      setContents([]);
                      setContentsPage(1);
                      loadSubTopicContents(selectedTopic, st, 1, false);
                    }}
                    className={`shrink-0 rounded-2xl px-4 py-2.5 text-xs sm:text-sm font-bold transition ${
                      isActive
                        ? 'bg-[var(--primary-color)] text-white shadow-sm'
                        : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {st.name}
                  </button>
                );
              })}
            </div>
          ) : null}

          {pdfDownloadError && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs sm:text-sm text-amber-300">
              {pdfDownloadError}
            </div>
          )}

          {loadingContents && contents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-sm text-[var(--text-secondary)]">
              <Loader2 className="h-7 w-7 animate-spin text-[var(--primary-color)]" />
              <span>Loading Khazana {activeSubTopic?.name || 'materials'}...</span>
            </div>
          ) : contentsError ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-300">
              {contentsError}
            </div>
          ) : contents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-10 text-center text-sm text-[var(--text-secondary)]">
              No items found under {activeSubTopic?.name || 'this tab'} yet.
            </div>
          ) : (
            <>
              <div className="space-y-3.5">
                {contents.map((entry) => {
                  const d = entry.data || ({} as KhazanaContentItem['data']);
                  const isLecture =
                    entry.type === 'LECTURE' ||
                    Boolean(d.videoDetails?._id || d.videoDetails?.id || d.videoUrl);
                  const title = d.title || d.name || d.videoDetails?.name || 'Khazana Material';

                  if (isLecture) {
                    const thumb = d.videoDetails?.image;
                    const dur = d.videoDetails?.duration;
                    const dateStr = d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '';
                    const teacherFullName = [d.teacher?.firstName, d.teacher?.lastName]
                      .filter(Boolean)
                      .join(' ');
                    const subjectIdForState =
                      d.subjectId ||
                      selectedTopic.subjectId ||
                      resolveChapterSubjectId(selectedChapter, selectedSubject?._id || 'khazana');
                    const isCleared = isLectureCompleted(effectiveBatchId, d._id, adventureState);

                    return (
                      <div
                        key={d._id}
                        onClick={() => handlePlayKhazanaLecture(entry)}
                        className="group flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 sm:p-5 cursor-pointer transition hover:border-[var(--primary-color)]/60 hover:bg-[var(--bg-tertiary)]"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4 min-w-0 flex-1">
                          <div className="relative aspect-video w-full sm:h-24 sm:w-44 md:h-28 md:w-48 shrink-0 overflow-hidden rounded-2xl bg-slate-900">
                            {thumb ? (
                              <img src={thumb} alt={title} className="h-full w-full object-cover" />
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
                              {teacherFullName && (
                                <>
                                  <span className="font-semibold text-[var(--text-primary)]">
                                    {teacherFullName}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                </>
                              )}
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
                              {isCleared && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-bold text-emerald-400">Cleared (+50 XP)</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleLectureComplete({
                                batchId: effectiveBatchId,
                                subjectId: subjectIdForState,
                                topicId: selectedTopic._id,
                                videoId: d._id,
                                title,
                              });
                            }}
                            className={`flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
                              isCleared
                                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                                : 'border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            <span>{isCleared ? 'Cleared' : 'Complete'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayKhazanaLecture(entry);
                            }}
                            className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md hover:opacity-90 active:scale-95 transition"
                          >
                            <Play className="h-4 w-4 fill-white" />
                            <span>Play</span>
                          </button>
                        </div>
                      </div>
                    );
                  }

                  // NOTES / PDF / Attachment item
                  const att = d.fileId || d.imageId;
                  const directUrl = att ? resolveAttachmentUrl(att) : '';
                  const fileName = att?.name || `${title}.pdf`;
                  const viewUrl = directUrl ? buildPdfProxyUrl(directUrl, fileName, false) : '';
                  const itemKey = `kh-pdf-${d._id}`;
                  const isDownloading = downloadingPdfKey === itemKey;
                  const isDone = downloadedPdfKey === itemKey;

                  return (
                    <div
                      key={d._id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 sm:p-5"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pink-500/10 text-pink-400">
                          <FileText className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                          <h5 className="font-['Sora'] text-sm sm:text-base font-bold text-[var(--text-primary)] truncate">
                            {title}
                          </h5>
                          <p className="text-xs sm:text-sm text-[var(--text-secondary)] truncate">
                            {activeSubTopic?.name || entry.type || 'Study Material'}
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
                            <span>
                              {isDownloading ? 'Saving...' : isDone ? 'Downloaded' : 'Download'}
                            </span>
                          </button>
                        </div>
                      ) : (
                        <span className="shrink-0 rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] px-3.5 py-2 text-xs font-semibold text-[var(--text-secondary)]">
                          PDF Unavailable
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {hasMoreContents && activeSubTopic && (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={() =>
                      loadSubTopicContents(selectedTopic, activeSubTopic, contentsPage + 1, true)
                    }
                    disabled={loadingContents}
                    className="flex items-center gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-6 py-3 text-xs sm:text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)]"
                  >
                    {loadingContents && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>Load More Items</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
