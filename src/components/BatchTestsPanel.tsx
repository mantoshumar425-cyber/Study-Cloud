import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Sparkles,
  Play,
  Flag,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Loader2,
  AlertCircle,
  Trophy,
  RefreshCw,
  Download,
  Eye,
  Award,
} from 'lucide-react';
import { BatchItem, BatchSubject, OfficialBatchTest } from '../types';
import {
  buildPdfProxyUrl,
  downloadPdfFile,
  fetchPwBatchQuizzes,
  PwBatchQuizItem,
  startPwQuiz,
} from '../services/batchService';
import { recordStudyActivity } from '../services/adventureService';

interface BatchTestQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  topic?: string;
}

interface BatchTestPack {
  id: string;
  title: string;
  subject: string;
  exam: string;
  durationMinutes: number;
  questions: BatchTestQuestion[];
}

interface BatchTestsPanelProps {
  batch: BatchItem;
  subjects: BatchSubject[];
  onAskAi: (prompt: string) => void;
  onActivityUpdate?: () => void;
}

export const BatchTestsPanel: React.FC<BatchTestsPanelProps> = ({
  batch,
  subjects,
  onAskAi,
  onActivityUpdate,
}) => {
  const academicSubjects = useMemo(
    () =>
      subjects.filter(
        (s) => s?.slug && !/notice|guidance|orientation|planner/i.test(String(s.subject || ''))
      ),
    [subjects]
  );

  const [pwSubjects, setPwSubjects] = useState<Array<{ _id: string; subject: string; slug: string }>>([]);
  const [selectedSubjectSlug, setSelectedSubjectSlug] = useState<string>('');
  const [pwTopics, setPwTopics] = useState<Array<{ _id: string; name: string; exercises: number }>>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [quizzes, setQuizzes] = useState<PwBatchQuizItem[]>([]);
  const [officialTests, setOfficialTests] = useState<OfficialBatchTest[]>([]);
  const [testSubTab, setTestSubTab] = useState<'official' | 'quizzes'>('official');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  // Custom AI Test Builder scoped to this batch
  const [customSubject, setCustomSubject] = useState<string>(
    () => academicSubjects[0]?.subject || 'Physics'
  );
  const [customTopic, setCustomTopic] = useState<string>('');
  const [customCount, setCustomCount] = useState<number>(5);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Active CBT Exam Runner State
  const [activePack, setActivePack] = useState<BatchTestPack | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [marked, setMarked] = useState<Record<number, boolean>>({});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  // Reset subject/quizzes when batch changes
  useEffect(() => {
    setSelectedSubjectSlug('');
    setSelectedTopicId('');
    setActivePack(null);
    setSubmitted(false);
    setError(null);
    setCustomSubject(academicSubjects[0]?.subject || 'Physics');
  }, [batch.batch_id]);

  // Fetch PW official tests + quizzes for this batch
  const loadQuizzes = async (subjSlug?: string, topicId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPwBatchQuizzes(batch.batch_id, subjSlug || undefined, topicId || undefined);
      setPwSubjects(res.subjects || []);
      if (!subjSlug && res.activeSubjectSlug) {
        setSelectedSubjectSlug(res.activeSubjectSlug);
      }
      setPwTopics(res.topics || []);
      setQuizzes(res.quizzes || []);
      setOfficialTests(res.officialTests || []);
    } catch (err: any) {
      setError(err?.message || 'Could not load tests for this batch.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuizzes(selectedSubjectSlug || undefined, selectedTopicId || undefined);
  }, [batch.batch_id, selectedSubjectSlug, selectedTopicId]);

  useEffect(() => {
    if (!activePack || submitted) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activePack, submitted]);

  const startPack = (pack: BatchTestPack) => {
    setActivePack(pack);
    setCurrentIdx(0);
    setAnswers({});
    setMarked({});
    setSecondsLeft(Math.max(1, pack.durationMinutes * 60));
    setSubmitted(false);
  };

  const summary = useMemo(() => {
    if (!activePack) return null;
    let correct = 0;
    let incorrect = 0;
    let skipped = 0;
    activePack.questions.forEach((q, idx) => {
      const chosen = answers[idx];
      if (chosen === undefined) skipped++;
      else if (chosen === q.correctIndex) correct++;
      else incorrect++;
    });
    const score = correct * 4 - incorrect;
    const maxScore = activePack.questions.length * 4;
    const attempted = correct + incorrect;
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    return { correct, incorrect, skipped, score, maxScore, accuracy };
  }, [activePack, answers]);

  const handleSubmitTest = () => {
    if (!activePack || submitted) return;
    setSubmitted(true);
    recordStudyActivity();
    onActivityUpdate?.();

    let correct = 0;
    let incorrect = 0;
    activePack.questions.forEach((q, idx) => {
      const chosen = answers[idx];
      if (chosen === undefined) return;
      if (chosen === q.correctIndex) correct++;
      else incorrect++;
    });
    const score = correct * 4 - incorrect;
    const maxScore = activePack.questions.length * 4;
    const attempted = correct + incorrect;
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;

    try {
      const raw = localStorage.getItem('studycloud_test_attempts_v1');
      const prev = raw ? JSON.parse(raw) : [];
      const next = [
        { title: `${batch.name} · ${activePack.title}`, score, maxScore, accuracy, date: Date.now() },
        ...(Array.isArray(prev) ? prev.slice(0, 9) : []),
      ];
      localStorage.setItem('studycloud_test_attempts_v1', JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    if (activePack && !submitted && secondsLeft === 0) {
      handleSubmitTest();
    }
  }, [activePack, submitted, secondsLeft]);

  const handleLaunchPwQuiz = async (quiz: PwBatchQuizItem) => {
    if (launchingId) return;
    setLaunchingId(quiz.id);
    setError(null);
    try {
      const res = await startPwQuiz({
        exerciseId: quiz.exerciseId,
        batchName: batch.name,
        subjectName: quiz.subjectName,
        topicName: quiz.topicName,
        title: quiz.title,
        count: Math.min(10, Math.max(5, quiz.totalQuestions || 8)),
      });
      startPack({
        id: `batch-pw-${quiz.id}-${Date.now()}`,
        title: quiz.title,
        subject: quiz.subjectName,
        exam: batch.exam || batch.name,
        durationMinutes: Math.max(8, (res.questions.length || 8) * 2),
        questions: res.questions,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to launch this batch quiz.');
    } finally {
      setLaunchingId(null);
    }
  };

  const handleLaunchOfficialTest = async (test: OfficialBatchTest) => {
    if (launchingId) return;
    setLaunchingId(test.id);
    setError(null);
    try {
      const res = await startPwQuiz({
        exerciseId: test.exerciseId || undefined,
        batchName: batch.name,
        subjectName: test.subjectName,
        topicName: test.syllabus || test.title,
        title: test.title,
        count: Math.min(12, Math.max(8, test.totalQuestions || 10)),
      });
      startPack({
        id: `batch-official-${test.id}-${Date.now()}`,
        title: test.title,
        subject: test.subjectName,
        exam: batch.exam || batch.name,
        durationMinutes: Math.max(15, test.maxDuration || res.questions.length * 2),
        questions: res.questions,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to launch official test.');
    } finally {
      setLaunchingId(null);
    }
  };

  const handleGenerateCustomTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTopic = customTopic.trim();
    if (!cleanTopic || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch('/api/ai/generate-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: customSubject || 'Science',
          exam: batch.exam || `Class ${batch.class || '10'}`,
          topic: `${cleanTopic} (${batch.name})`,
          count: customCount,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success || !Array.isArray(json.questions)) {
        throw new Error(json.message || 'Could not generate test paper.');
      }
      startPack({
        id: `batch-ai-${Date.now()}`,
        title: `${customSubject}: ${cleanTopic}`,
        subject: customSubject,
        exam: batch.name,
        durationMinutes: Math.max(5, customCount * 2),
        questions: json.questions,
      });
    } catch (err: any) {
      setGenerateError(err?.message || 'Unable to generate chapter test right now.');
    } finally {
      setGenerating(false);
    }
  };

  const formatClock = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Result Analysis Screen
  if (activePack && submitted && summary) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4">
          <div>
            <div className="text-xs font-bold text-[var(--primary-color)]">
              {batch.name} · {activePack.subject} · +4 / -1 NTA Marking
            </div>
            <h3 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)] mt-0.5">
              {activePack.title} — Result Analysis
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => startPack(activePack)}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3.5 py-2 text-xs font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Retake</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePack(null)}
              className="rounded-xl bg-[var(--primary-color)] px-3.5 py-2 text-xs font-bold text-white hover:opacity-90 transition"
            >
              All Batch Tests
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Score', value: `${summary.score} / ${summary.maxScore}`, accent: 'text-[var(--primary-color)]' },
            { label: 'Accuracy', value: `${summary.accuracy}%`, accent: 'text-emerald-400' },
            { label: 'Correct', value: `${summary.correct}`, accent: 'text-emerald-400' },
            { label: 'Wrong / Skipped', value: `${summary.incorrect} / ${summary.skipped}`, accent: 'text-amber-400' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3.5"
            >
              <div className="text-[11px] text-[var(--text-secondary)]">{stat.label}</div>
              <div className={`mt-0.5 font-mono tabular-nums text-lg font-extrabold ${stat.accent}`}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {activePack.questions.map((q, idx) => {
            const chosen = answers[idx];
            const isCorrect = chosen === q.correctIndex;
            const isSkipped = chosen === undefined;
            return (
              <div
                key={idx}
                className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 space-y-2.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-bold text-[var(--text-secondary)]">
                    Q{idx + 1} {q.topic ? `· ${q.topic}` : ''}
                  </span>
                  <span
                    className={`flex items-center gap-1 font-bold ${
                      isSkipped ? 'text-slate-400' : isCorrect ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {isSkipped ? (
                      'Skipped (0)'
                    ) : isCorrect ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Correct (+4)</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Incorrect (-1)</span>
                      </>
                    )}
                  </span>
                </div>
                <p className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] leading-relaxed">
                  {q.question}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {q.options.map((opt, oIdx) => {
                    const isAnswerKey = oIdx === q.correctIndex;
                    const isUserPick = chosen === oIdx;
                    return (
                      <div
                        key={oIdx}
                        className={`rounded-xl border px-3 py-2 text-xs ${
                          isAnswerKey
                            ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300 font-semibold'
                            : isUserPick
                            ? 'border-red-500/60 bg-red-500/10 text-red-300'
                            : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)]'
                        }`}
                      >
                        <span className="font-mono font-bold mr-1.5">
                          {String.fromCharCode(65 + oIdx)}.
                        </span>
                        {opt}
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-xl bg-[var(--card-bg)] p-3 text-xs text-[var(--text-secondary)]">
                  <strong className="text-[var(--text-primary)]">Solution: </strong>
                  {q.explanation}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      onAskAi(
                        `Explain this ${activePack.subject} question from ${batch.name}:\n${q.question}\nOptions: ${q.options.join(' | ')}`
                      )
                    }
                    className="flex items-center gap-1 text-xs font-bold text-[var(--primary-color)] hover:underline"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Ask Study AI</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Active CBT Runner Screen
  if (activePack && !submitted) {
    const q = activePack.questions[currentIdx];
    const selectedOpt = answers[currentIdx];
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs text-[var(--text-secondary)]">
              {batch.name} · {activePack.subject} · +4 / -1 Marking
            </div>
            <h3 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)] truncate">
              {activePack.title}
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 font-mono tabular-nums text-xs sm:text-sm font-extrabold text-amber-400">
              <Clock className="h-4 w-4" />
              <span>{formatClock(secondsLeft)}</span>
            </div>
            <button
              type="button"
              onClick={handleSubmitTest}
              className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs sm:text-sm font-bold text-white hover:bg-emerald-500 transition"
            >
              Submit Test
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-8 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--card-border)] pb-2 text-xs">
              <span className="font-mono font-bold text-[var(--primary-color)]">
                Question {currentIdx + 1} of {activePack.questions.length}
              </span>
              {q.topic && <span className="text-[var(--text-secondary)]">{q.topic}</span>}
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)] leading-relaxed">
              {q.question}
            </p>
            <div className="space-y-2">
              {q.options.map((opt, idx) => {
                const active = selectedOpt === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setAnswers((prev) => ({ ...prev, [currentIdx]: idx }))}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-xs sm:text-sm transition ${
                      active
                        ? 'border-[var(--primary-color)] bg-[var(--primary-color)]/15 text-[var(--text-primary)] font-semibold'
                        : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-primary)] hover:border-[var(--primary-color)]/50'
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold ${
                        active
                          ? 'bg-[var(--primary-color)] text-white'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className="flex-1">{opt}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--card-border)] pt-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setAnswers((prev) => {
                      const next = { ...prev };
                      delete next[currentIdx];
                      return next;
                    })
                  }
                  className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setMarked((prev) => ({ ...prev, [currentIdx]: !prev[currentIdx] }))}
                  className={`flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                    marked[currentIdx]
                      ? 'border-amber-500 bg-amber-500/15 text-amber-400'
                      : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)]'
                  }`}
                >
                  <Flag className="h-3.5 w-3.5" />
                  <span>{marked[currentIdx] ? 'Marked' : 'Review'}</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentIdx === 0}
                  onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                  className="flex items-center gap-1 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs font-bold text-[var(--text-primary)] disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span>Prev</span>
                </button>
                <button
                  type="button"
                  disabled={currentIdx === activePack.questions.length - 1}
                  onClick={() =>
                    setCurrentIdx((i) => Math.min(activePack.questions.length - 1, i + 1))
                  }
                  className="flex items-center gap-1 rounded-xl bg-[var(--primary-color)] px-3.5 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                >
                  <span>Next</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-['Sora'] text-sm font-extrabold text-[var(--text-primary)]">
                Question Palette
              </h4>
              <button
                type="button"
                onClick={() => setActivePack(null)}
                className="text-xs font-bold text-[var(--text-secondary)] hover:text-red-400"
              >
                Exit Test
              </button>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {activePack.questions.map((_, idx) => {
                const isAns = answers[idx] !== undefined;
                const isMarked = Boolean(marked[idx]);
                const isCurrent = idx === currentIdx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setCurrentIdx(idx)}
                    className={`h-8 rounded-lg font-mono text-xs font-bold transition border ${
                      isCurrent
                        ? 'ring-2 ring-[var(--primary-color)] border-[var(--primary-color)]'
                        : 'border-[var(--card-border)]'
                    } ${
                      isMarked
                        ? 'bg-amber-500/20 text-amber-300'
                        : isAns
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[var(--card-bg)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Batch Tests Catalog
  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div>
            <h3 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)] flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-[var(--primary-color)]" />
              <span>{batch.name} — Tests & DPP Quizzes</span>
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Attempt this batch&apos;s subject-wise DPP quizzes & practice tests in CBT mode.
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadQuizzes(selectedSubjectSlug || undefined, selectedTopicId || undefined)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[var(--primary-color)] ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Official Tests vs Chapter DHA/DPP Quizzes Switcher */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--card-border)] pt-3">
          <button
            type="button"
            onClick={() => setTestSubTab('official')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
              testSubTab === 'official'
                ? 'bg-[var(--primary-color)] text-white shadow-sm'
                : 'border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)]'
            }`}
          >
            <Award className="h-3.5 w-3.5" />
            <span>Official Batch Tests ({officialTests.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTestSubTab('quizzes')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
              testSubTab === 'quizzes'
                ? 'bg-[var(--primary-color)] text-white shadow-sm'
                : 'border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)]'
            }`}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            <span>Chapter DPP &amp; DHA Quizzes ({quizzes.length})</span>
          </button>
        </div>

        {/* Subject & Chapter Filters (shown when browsing quizzes) */}
        {testSubTab === 'quizzes' && (pwSubjects.length > 0 || academicSubjects.length > 0) && (
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="flex flex-1 items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {(pwSubjects.length > 0 ? pwSubjects : academicSubjects).map((subj) => {
                const isSelected = selectedSubjectSlug === subj.slug;
                return (
                  <button
                    key={subj._id}
                    type="button"
                    onClick={() => {
                      setSelectedSubjectSlug(subj.slug);
                      setSelectedTopicId('');
                    }}
                    className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                      isSelected
                        ? 'bg-[var(--primary-color)] text-white'
                        : 'border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {subj.subject}
                  </button>
                );
              })}
            </div>

            {pwTopics.filter((t) => t.exercises > 0).length > 0 && (
              <select
                value={selectedTopicId}
                onChange={(e) => setSelectedTopicId(e.target.value)}
                className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none sm:max-w-[230px]"
              >
                <option value="">All Chapters with Quizzes</option>
                {pwTopics
                  .filter((t) => t.exercises > 0)
                  .map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name} ({t.exercises})
                    </option>
                  ))}
              </select>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 gap-2.5 text-xs sm:text-sm text-[var(--text-secondary)]">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--primary-color)]" />
          <span>Loading official tests &amp; quizzes for {batch.name}...</span>
        </div>
      ) : testSubTab === 'official' ? (
        officialTests.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--bg-secondary)] p-6 text-center text-xs sm:text-sm text-[var(--text-secondary)]">
            No official test updates found yet. Switch to Chapter DPP &amp; DHA Quizzes or build a mock test below!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {officialTests.map((t) => {
              const isLaunching = launchingId === t.id;
              return (
                <div
                  key={t.id}
                  className="flex flex-col justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 hover:border-[var(--primary-color)]/60 transition"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] font-bold">
                      <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-400">
                        {t.category}
                      </span>
                      <span className="font-mono text-[var(--text-secondary)]">
                        {t.totalQuestions} Qs · {t.totalMarks} Marks · {t.maxDuration}m
                      </span>
                    </div>
                    <h4 className="font-['Sora'] text-sm font-extrabold text-[var(--text-primary)] line-clamp-2">
                      {t.title}
                    </h4>
                    <p className="text-xs font-semibold text-[var(--primary-color)] truncate">
                      {t.subjectName}
                    </p>
                    {t.syllabus && (
                      <p className="text-xs text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                        {t.syllabus}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--card-border)] pt-2.5">
                    {t.pdfUrl ? (
                      <div className="flex items-center gap-1.5">
                        <a
                          href={buildPdfProxyUrl(t.pdfUrl, t.pdfName || 'Test Syllabus.pdf', false)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--text-primary)]"
                        >
                          <Eye className="h-3.5 w-3.5 text-indigo-400" />
                          <span>Syllabus</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => downloadPdfFile(t.pdfUrl!, t.pdfName || 'Test Syllabus.pdf')}
                          className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1.5 text-[11px] font-bold text-[var(--text-primary)]"
                          title="Download Syllabus PDF"
                        >
                          <Download className="h-3.5 w-3.5 text-pink-400" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1">
                        <Trophy className="h-3.5 w-3.5 text-amber-400" />
                        Official Pattern CBT
                      </span>
                    )}

                    <button
                      type="button"
                      disabled={Boolean(launchingId)}
                      onClick={() => handleLaunchOfficialTest(t)}
                      className="flex items-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-3.5 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60 transition"
                    >
                      {isLaunching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-white" />}
                      <span>{isLaunching ? 'Starting...' : 'Attempt Official'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : quizzes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--bg-secondary)] p-6 text-center text-xs sm:text-sm text-[var(--text-secondary)]">
          No pre-uploaded DPP / DHA quiz found for this subject yet. Switch subject above or try Official Batch Tests!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {quizzes.map((quiz) => {
            const isLaunching = launchingId === quiz.id;
            return (
              <div
                key={quiz.id}
                className="flex flex-col justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 hover:border-[var(--primary-color)]/60 transition"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                    <span className="font-bold text-[var(--primary-color)]">{quiz.subjectName}</span>
                    {quiz.isDha && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                        DHA
                      </span>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{quiz.totalQuestions} Qs</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{quiz.totalMarks} Marks</span>
                  </div>
                  <h4 className="font-['Sora'] text-sm font-extrabold text-[var(--text-primary)] line-clamp-2">
                    {quiz.title}
                  </h4>
                  {quiz.topicName && (
                    <p className="text-xs text-[var(--text-secondary)] truncate">
                      {quiz.topicName}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-[var(--card-border)] pt-2.5">
                  <span className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1">
                    <Trophy className="h-3.5 w-3.5 text-amber-400" />
                    +4 / -1 CBT
                  </span>
                  <button
                    type="button"
                    disabled={Boolean(launchingId)}
                    onClick={() => handleLaunchPwQuiz(quiz)}
                    className="flex items-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-3.5 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60 transition"
                  >
                    {isLaunching ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5 fill-white" />
                    )}
                    <span>{isLaunching ? 'Loading...' : 'Attempt Test'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Batch-Scoped AI Mock Test Builder */}
      <form
        onSubmit={handleGenerateCustomTest}
        className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--primary-color)]" />
          <h4 className="font-['Sora'] text-sm font-extrabold text-[var(--text-primary)]">
            Generate Instant Practice Test for {batch.name}
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
          <select
            value={customSubject}
            onChange={(e) => setCustomSubject(e.target.value)}
            className="sm:col-span-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
          >
            {academicSubjects.length > 0 ? (
              academicSubjects.map((s) => (
                <option key={s._id} value={s.subject}>
                  {s.subject}
                </option>
              ))
            ) : (
              <>
                <option value="Physics">Physics</option>
                <option value="Chemistry">Chemistry</option>
                <option value="Mathematics">Mathematics</option>
                <option value="Biology">Biology</option>
              </>
            )}
          </select>

          <input
            type="text"
            value={customTopic}
            onChange={(e) => setCustomTopic(e.target.value)}
            placeholder="Enter chapter name (e.g. Carbon Compounds, Electrostatics)"
            className="sm:col-span-5 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:outline-none"
          />

          <select
            value={customCount}
            onChange={(e) => setCustomCount(Number(e.target.value))}
            className="sm:col-span-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-2 font-mono text-xs font-semibold text-[var(--text-primary)] focus:outline-none"
          >
            <option value={5}>5 Qs</option>
            <option value={8}>8 Qs</option>
            <option value={10}>10 Qs</option>
          </select>

          <button
            type="submit"
            disabled={generating || !customTopic.trim()}
            className="sm:col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50 transition"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            <span>{generating ? 'Building...' : 'Start'}</span>
          </button>
        </div>

        {generateError && (
          <div className="text-xs text-red-400">{generateError}</div>
        )}
      </form>
    </div>
  );
};
