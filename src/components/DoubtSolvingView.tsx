import React, { useEffect, useState } from 'react';
import { HelpCircle, ImagePlus, Send, CheckCircle2, Clock, Loader2, X } from 'lucide-react';
import { DoubtTicket } from '../types';
import { useAuth } from '../contexts/AuthContext';

export const DoubtSolvingView: React.FC = () => {
  const { user, isAdmin, getIdToken, openAuthModal } = useAuth();
  const [doubts, setDoubts] = useState<DoubtTicket[]>([]);
  const [subject, setSubject] = useState('Physics');
  const [questionText, setQuestionText] = useState('');
  const [imagePreview, setImagePreview] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filterSubject, setFilterSubject] = useState('all');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const loadDoubts = async () => {
    const token = await getIdToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/doubts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && Array.isArray(data.doubts)) {
        setDoubts(data.doubts);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) void loadDoubts();
  }, [user]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 720;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setImagePreview(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitDoubt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuthModal();
      return;
    }
    if (questionText.trim().length < 3) return;
    setSubmitting(true);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/doubts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          subject,
          questionText: questionText.trim(),
          imageUrl: imagePreview || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && data.doubt) {
        setDoubts((prev) => [data.doubt, ...prev]);
        setQuestionText('');
        setImagePreview('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleTeacherReply = async (doubtId: string) => {
    const reply = (replyDrafts[doubtId] || '').trim();
    if (!reply) return;
    const token = await getIdToken();
    if (!token) return;
    const res = await fetch(`/api/doubts/${encodeURIComponent(doubtId)}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ teacherReply: reply }),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.success && data.doubt) {
      setDoubts((prev) => prev.map((d) => (d.doubtId === doubtId ? data.doubt : d)));
    }
  };

  const visibleDoubts =
    filterSubject === 'all'
      ? doubts
      : doubts.filter((d) => d.subject.toLowerCase() === filterSubject.toLowerCase());

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="font-['Sora'] text-xl sm:text-2xl font-extrabold flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-[#22C55E]" />
          <span>Doubt Solving Center</span>
        </h1>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
          Upload question photos or type text doubts by subject to receive faculty answers and track your doubt history.
        </p>
      </div>

      {/* Ask a Doubt Form */}
      <form
        onSubmit={handleSubmitDoubt}
        className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-3.5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs sm:text-sm font-semibold focus:border-[#22C55E] focus:outline-none"
          >
            <option value="Physics">Physics</option>
            <option value="Chemistry">Chemistry</option>
            <option value="Mathematics">Mathematics</option>
            <option value="Biology">Biology</option>
            <option value="Science">Science (Class 9/10)</option>
            <option value="General">General</option>
          </select>

          <label className="sm:col-span-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:border-[#22C55E]">
            <ImagePlus className="h-4 w-4 text-[#22C55E]" />
            <span>{imagePreview ? 'Image Attached — Tap to Change' : 'Upload Question Image (Optional)'}</span>
            <input type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
          </label>
        </div>

        {imagePreview && (
          <div className="relative inline-block">
            <img src={imagePreview} alt="Doubt preview" className="max-h-40 rounded-xl border border-[var(--card-border)]" />
            <button
              type="button"
              onClick={() => setImagePreview('')}
              className="absolute -top-2 -right-2 rounded-full bg-red-600 p-1 text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <textarea
          rows={3}
          required
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          placeholder="Type your exact question or chapter problem..."
          className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] p-3 text-xs sm:text-sm focus:border-[#22C55E] focus:outline-none"
        />

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-5 py-2.5 text-xs sm:text-sm font-bold text-white transition disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span>{user ? 'Submit Doubt Ticket' : 'Sign In & Submit Doubt'}</span>
          </button>
        </div>
      </form>

      {/* Doubt History */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-['Sora'] text-base font-extrabold">Your Doubt History</h2>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {['all', 'Physics', 'Chemistry', 'Mathematics', 'Biology'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilterSubject(s)}
                className={`rounded-xl px-3 py-1 text-xs font-bold ${
                  filterSubject === s
                    ? 'bg-[#16A34A] text-white'
                    : 'border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)]'
                }`}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
        </div>

        {!user ? (
          <div className="rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-center text-xs sm:text-sm text-[var(--text-secondary)]">
            Sign in with your student account to view your submitted doubts and teacher answers.
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-xs text-[var(--text-secondary)]">Loading doubts...</div>
        ) : visibleDoubts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-center text-xs text-[var(--text-secondary)]">
            No doubt tickets found yet. Ask your first question above!
          </div>
        ) : (
          <div className="space-y-3">
            {visibleDoubts.map((d) => (
              <div
                key={d.doubtId}
                className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 space-y-2.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-[#16A34A]/15 px-2.5 py-0.5 font-bold text-emerald-400">
                      {d.subject}
                    </span>
                    <span className="font-semibold text-[var(--text-secondary)]">{d.studentName}</span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 font-bold ${
                      d.status === 'resolved' ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {d.status === 'resolved' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                    {d.status === 'resolved' ? 'Resolved' : 'Awaiting Reply'}
                  </span>
                </div>
                <p className="text-sm text-[var(--text-primary)]">{d.questionText}</p>
                {d.imageUrl && (
                  <img
                    src={d.imageUrl}
                    alt="Question attachment"
                    className="max-h-48 rounded-xl border border-[var(--card-border)]"
                  />
                )}
                {d.teacherReply && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs sm:text-sm text-emerald-200">
                    <div className="font-bold text-emerald-400 mb-1">
                      Reply from {d.repliedBy || 'Faculty'}:
                    </div>
                    <p>{d.teacherReply}</p>
                  </div>
                )}
                {isAdmin && d.status !== 'resolved' && (
                  <div className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={replyDrafts[d.doubtId] || ''}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({ ...prev, [d.doubtId]: e.target.value }))
                      }
                      placeholder="Write official teacher response..."
                      className="flex-1 rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void handleTeacherReply(d.doubtId)}
                      className="rounded-xl bg-[#16A34A] px-3.5 py-1.5 text-xs font-bold text-white"
                    >
                      Send Reply
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
