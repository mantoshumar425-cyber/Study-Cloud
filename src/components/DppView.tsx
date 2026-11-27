import React, { useEffect, useState } from 'react';
import { BookOpenCheck, CheckCircle2, Loader2, Sparkles, ArrowLeft } from 'lucide-react';
import { DppSheet, DppSubmissionItem } from '../types';
import { useAuth } from '../contexts/AuthContext';

export const DppView: React.FC = () => {
  const { user, getIdToken, openAuthModal } = useAuth();
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [dpps, setDpps] = useState<DppSheet[]>([]);
  const [submissions, setSubmissions] = useState<DppSubmissionItem[]>([]);
  const [activeDpp, setActiveDpp] = useState<DppSheet | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [subjectiveAnswer, setSubjectiveAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DppSubmissionItem | null>(null);

  const loadDpps = async (subj = subjectFilter) => {
    const res = await fetch(`/api/dpp?subject=${encodeURIComponent(subj)}`);
    const data = await res.json().catch(() => ({}));
    if (data?.success && Array.isArray(data.dpps)) {
      setDpps(data.dpps);
    }
  };

  const loadSubmissions = async () => {
    const token = await getIdToken();
    if (!token) return;
    const res = await fetch('/api/dpp/submissions', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (data?.success && Array.isArray(data.submissions)) {
      setSubmissions(data.submissions);
    }
  };

  useEffect(() => {
    void loadDpps(subjectFilter);
  }, [subjectFilter]);

  useEffect(() => {
    if (user) void loadSubmissions();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDpp) return;
    if (!user) {
      openAuthModal();
      return;
    }
    setSubmitting(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/dpp/${encodeURIComponent(activeDpp.dppId)}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ answers, subjectiveAnswer }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && data.submission) {
        setResult(data.submission);
        void loadSubmissions();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const subjects = ['all', 'Physics', 'Chemistry', 'Biology', 'Mathematics'];
  const solvedCount = submissions.length;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-['Sora'] text-xl sm:text-2xl font-extrabold flex items-center gap-2">
            <BookOpenCheck className="h-5 w-5 text-[#22C55E]" />
            <span>Daily Practice Problems (DPP)</span>
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
            Chapter-wise daily MCQs &amp; subjective questions with verified solution explanations.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 font-mono text-xs font-bold text-emerald-400">
          Completed DPPs: {solvedCount}
        </div>
      </div>

      {activeDpp ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setActiveDpp(null);
              setResult(null);
              setAnswers({});
              setSubjectiveAnswer('');
            }}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#22C55E] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to All DPPs</span>
          </button>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
              <div className="text-xs font-bold text-emerald-400">
                {activeDpp.subject} · {activeDpp.chapter} · {activeDpp.classLevel}
              </div>
              <h2 className="font-['Sora'] text-lg font-extrabold mt-0.5">{activeDpp.title}</h2>
            </div>

            {activeDpp.questions.map((q, idx) => (
              <div
                key={q.id}
                className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs font-extrabold text-[#22C55E]">
                    Q{idx + 1} · {q.kind.toUpperCase()}
                  </span>
                </div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{q.prompt}</p>

                {q.kind === 'mcq' && q.options ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {q.options.map((opt, optIdx) => {
                      const selected = answers[q.id] === optIdx;
                      const showSolution = Boolean(result);
                      const isCorrect = q.correctIndex === optIdx;
                      return (
                        <button
                          key={optIdx}
                          type="button"
                          disabled={showSolution}
                          onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: optIdx }))}
                          className={`rounded-xl border p-3 text-left text-xs font-semibold transition ${
                            showSolution
                              ? isCorrect
                                ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                                : selected
                                ? 'border-red-500 bg-red-500/15 text-red-300'
                                : 'border-[var(--card-border)] opacity-70'
                              : selected
                              ? 'border-[#22C55E] bg-[#16A34A]/20 text-emerald-300'
                              : 'border-[var(--card-border)] bg-[var(--bg-secondary)] hover:border-[#22C55E]/60'
                          }`}
                        >
                          {String.fromCharCode(65 + optIdx)}. {opt}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <textarea
                    rows={3}
                    disabled={Boolean(result)}
                    value={subjectiveAnswer}
                    onChange={(e) => setSubjectiveAnswer(e.target.value)}
                    placeholder="Write your step-by-step derivation or subjective solution here..."
                    className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] p-3 text-xs sm:text-sm focus:border-[#22C55E] focus:outline-none"
                  />
                )}

                {result && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                    <div className="font-bold flex items-center gap-1 mb-1">
                      <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Solution Explanation</span>
                    </div>
                    <p>{q.explanation}</p>
                  </div>
                )}
              </div>
            ))}

            {result ? (
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/15 p-5 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-emerald-300">DPP Submitted &amp; Recorded</div>
                  <div className="font-['Sora'] text-xl font-extrabold text-white">
                    MCQ Score: {result.score} / {result.total}
                  </div>
                </div>
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
              </div>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-6 py-3 text-sm font-bold text-white shadow-md transition disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Submit DPP &amp; Unlock Solutions</span>
              </button>
            )}
          </form>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {subjects.map((subj) => (
              <button
                key={subj}
                type="button"
                onClick={() => setSubjectFilter(subj)}
                className={`shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                  subjectFilter === subj
                    ? 'bg-[#16A34A] text-white'
                    : 'border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)]'
                }`}
              >
                {subj === 'all' ? 'All Subjects' : subj}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {dpps.map((dpp) => {
              const prevSub = submissions.find((s) => s.dppId === dpp.dppId);
              return (
                <div
                  key={dpp.dppId}
                  className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span className="text-emerald-400">{dpp.subject}</span>
                      <span className="text-[var(--text-secondary)]">{dpp.classLevel}</span>
                    </div>
                    <h3 className="font-['Sora'] text-sm font-bold text-[var(--text-primary)]">{dpp.title}</h3>
                    <p className="text-xs text-[var(--text-secondary)]">Chapter: {dpp.chapter}</p>
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--card-border)] pt-3">
                    {prevSub ? (
                      <span className="font-mono text-xs font-bold text-emerald-400">
                        Score: {prevSub.score}/{prevSub.total}
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-[var(--text-secondary)]">
                        {dpp.questions.length} Questions
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveDpp(dpp)}
                      className="rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-3.5 py-1.5 text-xs font-bold text-white transition"
                    >
                      {prevSub ? 'Review' : 'Solve DPP'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
