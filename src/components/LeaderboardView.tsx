import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Trophy,
  Flame,
  Crown,
  Medal,
  RefreshCw,
  Check,
  CheckCircle2,
  User,
  Award,
  ArrowRight,
} from 'lucide-react';
import { AdventureState, LeaderboardEntry } from '../types';
import {
  fetchLeaderboard,
  getAdventureMetrics,
  getLeaderboardProfile,
  saveLeaderboardProfile,
  syncLeaderboardScore,
} from '../services/adventureService';

interface LeaderboardViewProps {
  adventureState: AdventureState;
  onBrowseBatches: () => void;
}

const EXAM_OPTIONS = ['IIT-JEE', 'NEET', 'Class 12', 'Class 11', 'Class 10', 'UPSC', 'All Exams'];

export const LeaderboardView: React.FC<LeaderboardViewProps> = ({
  adventureState,
  onBrowseBatches,
}) => {
  const initialProfile = useMemo(() => getLeaderboardProfile(), []);
  const myMetrics = useMemo(() => getAdventureMetrics(adventureState), [adventureState]);

  const [playerName, setPlayerName] = useState(initialProfile.name);
  const [playerExam, setPlayerExam] = useState(initialProfile.exam);
  const [examFilter, setExamFilter] = useState<string>('all');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadAndSync = useCallback(
    async (filter = examFilter) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        await syncLeaderboardScore(adventureState);
        const data = await fetchLeaderboard(filter);
        setEntries(data.entries);
        setTotalStudents(data.totalStudents);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Leaderboard load nahi ho paya');
      } finally {
        setLoading(false);
      }
    },
    [adventureState, examFilter]
  );

  useEffect(() => {
    void loadAndSync(examFilter);
  }, [examFilter, loadAndSync]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    try {
      const updated = saveLeaderboardProfile({ name: playerName, exam: playerExam });
      setPlayerName(updated.name);
      setPlayerExam(updated.exam);
      await syncLeaderboardScore(adventureState);
      const data = await fetchLeaderboard(examFilter);
      setEntries(data.entries);
      setTotalStudents(data.totalStudents);
      setSavedToast(true);
      window.setTimeout(() => setSavedToast(false), 2200);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Profile update nahi ho paya');
    } finally {
      setSaving(false);
    }
  };

  const myIndex = entries.findIndex((item) => item.playerId === initialProfile.playerId);
  const myRankPosition = myIndex >= 0 ? myIndex + 1 : null;
  const topThree = entries.slice(0, 3);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Header Banner + My XP Rank Card */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-[var(--card-bg)] via-[var(--card-bg)] to-emerald-500/10 p-5 sm:p-6 shadow-sm">
        <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-400">
              <Trophy className="h-4 w-4" />
              <span>Study Cloud · Total XP Leaderboard</span>
            </div>
            <h1 className="font-['Sora'] text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">
              Top Scholars &amp; XP Rankings
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-xl leading-relaxed">
              Har lecture complete karne par <strong className="text-emerald-400">+50 XP</strong> aur
              har active study day par <strong className="text-amber-400">+20 XP</strong> milta hai.
              Apna naam set karein aur leaderboard par apni live rank dekhein.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2.5 sm:gap-3 rounded-2xl border border-emerald-500/25 bg-[var(--bg-secondary)] p-3.5 text-center shrink-0">
            <div>
              <div className="font-mono text-lg sm:text-xl font-extrabold text-emerald-400">
                {myRankPosition ? `#${myRankPosition}` : '--'}
              </div>
              <div className="text-[11px] font-semibold text-[var(--text-secondary)]">Your Rank</div>
            </div>
            <div>
              <div className="font-mono text-lg sm:text-xl font-extrabold text-[var(--text-primary)]">
                {myMetrics.xp.toLocaleString()}
              </div>
              <div className="text-[11px] font-semibold text-[var(--text-secondary)]">Total XP</div>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1 font-mono text-lg sm:text-xl font-extrabold text-amber-400">
                <Flame className="h-4 w-4" />
                <span>{myMetrics.currentStreak}d</span>
              </div>
              <div className="text-[11px] font-semibold text-[var(--text-secondary)]">Streak</div>
            </div>
          </div>
        </div>

        {/* Editable Profile Form */}
        <form
          onSubmit={handleSaveProfile}
          className="relative mt-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 border-t border-white/10 pt-4"
        >
          <div className="relative flex-1">
            <User className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
            <input
              type="text"
              maxLength={32}
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Apna naam likhein (e.g. Aman Kumar)"
              className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] py-2 pl-9 pr-3 text-xs sm:text-sm font-semibold text-[var(--text-primary)] focus:border-[#22C55E] focus:outline-none"
            />
          </div>

          <select
            value={playerExam}
            onChange={(e) => setPlayerExam(e.target.value)}
            className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs sm:text-sm font-semibold text-[var(--text-primary)] focus:border-[#22C55E] focus:outline-none"
          >
            {EXAM_OPTIONS.map((ex) => (
              <option key={ex} value={ex}>
                {ex}
              </option>
            ))}
          </select>

          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-sm transition active:scale-95 disabled:opacity-60 whitespace-nowrap"
          >
            {savedToast ? (
              <>
                <Check className="h-4 w-4" />
                <span>Rank Updated!</span>
              </>
            ) : (
              <>
                <Award className="h-4 w-4" />
                <span>{saving ? 'Syncing...' : 'Save & Sync XP'}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => void loadAndSync(examFilter)}
            disabled={loading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[#22C55E] hover:text-emerald-400 transition self-end sm:self-auto"
            title="Refresh Leaderboard"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </form>
      </div>

      {/* Exam Filter Row + Total Scholars Count */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {['all', ...EXAM_OPTIONS].map((opt) => {
            const active = examFilter === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setExamFilter(opt)}
                className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  active
                    ? 'bg-[#16A34A] text-white shadow-sm'
                    : 'border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:border-[#22C55E]/50 hover:text-[var(--text-primary)]'
                }`}
              >
                {opt === 'all' ? 'All Students' : opt}
              </button>
            );
          })}
        </div>

        <span className="font-mono text-xs font-semibold text-[var(--text-secondary)]">
          {totalStudents} {totalStudents === 1 ? 'Scholar' : 'Scholars'} Ranked
        </span>
      </div>

      {errorMsg && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs sm:text-sm text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Top 3 Podium */}
      {topThree.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {topThree.map((entry, idx) => {
            const isMe = entry.playerId === initialProfile.playerId;
            const badgeColors =
              idx === 0
                ? 'border-amber-400/50 bg-gradient-to-br from-amber-500/20 via-[var(--card-bg)] to-[var(--card-bg)]'
                : idx === 1
                ? 'border-slate-300/35 bg-gradient-to-br from-slate-400/15 via-[var(--card-bg)] to-[var(--card-bg)]'
                : 'border-orange-400/35 bg-gradient-to-br from-orange-500/15 via-[var(--card-bg)] to-[var(--card-bg)]';
            const iconColor =
              idx === 0 ? 'text-amber-400' : idx === 1 ? 'text-slate-300' : 'text-orange-400';

            return (
              <div
                key={entry.playerId}
                className={`relative rounded-2xl border p-4 shadow-sm transition ${badgeColors} ${
                  isMe ? 'ring-2 ring-[#22C55E]' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-black/30 ${iconColor}`}>
                      {idx === 0 ? <Crown className="h-5 w-5" /> : <Medal className="h-5 w-5" />}
                    </div>
                    <div>
                      <div className="font-mono text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">
                        Rank #{idx + 1}
                      </div>
                      <div className="font-['Sora'] text-sm font-extrabold text-[var(--text-primary)] truncate max-w-[160px]">
                        {entry.name} {isMe ? '(You)' : ''}
                      </div>
                    </div>
                  </div>
                  <span className="rounded-lg bg-[#16A34A]/20 border border-[#22C55E]/30 px-2 py-0.5 font-mono text-[11px] font-bold text-[#4ade80]">
                    {entry.exam}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2.5 text-xs">
                  <span className="font-mono text-base font-extrabold text-emerald-400">
                    {entry.xp.toLocaleString()} XP
                  </span>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-[var(--text-secondary)]">
                    <span>Lv.{entry.level}</span>
                    <span className="text-amber-400 font-bold">{entry.currentStreak}d</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full Leaderboard Table */}
      <div className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-sm">
        {loading && entries.length === 0 ? (
          <div className="p-8 text-center text-xs sm:text-sm text-[var(--text-secondary)]">
            Loading live XP leaderboard...
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <Trophy className="h-10 w-10 text-emerald-400 mx-auto" />
            <h3 className="font-['Sora'] text-base font-bold text-[var(--text-primary)]">
              No Scholars in This Category Yet
            </h3>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-md mx-auto">
              Lectures watch aur complete karke XP earn karein aur apni rank top par le jayein.
            </p>
            <button
              type="button"
              onClick={onBrowseBatches}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-4 py-2 text-xs font-bold text-white transition"
            >
              <span>Watch Lectures &amp; Earn XP</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--card-border)]">
            {entries.map((entry, idx) => {
              const isMe = entry.playerId === initialProfile.playerId;
              return (
                <div
                  key={entry.playerId}
                  className={`flex items-center justify-between gap-3 px-4 py-3 text-xs sm:text-sm transition ${
                    isMe ? 'bg-[#16A34A]/15' : 'hover:bg-[var(--bg-secondary)]/70'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-mono text-xs font-extrabold ${
                        idx === 0
                          ? 'bg-amber-500/20 text-amber-400'
                          : idx === 1
                          ? 'bg-slate-400/20 text-slate-300'
                          : idx === 2
                          ? 'bg-orange-500/20 text-orange-400'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                      }`}
                    >
                      #{idx + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-['Sora'] font-bold text-[var(--text-primary)] truncate">
                        <span className="truncate">{entry.name}</span>
                        {isMe && (
                          <span className="rounded bg-[#16A34A] px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-white">
                            You
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                        <span>Lv.{entry.level} · {entry.rank}</span>
                        <span>·</span>
                        <span>{entry.exam}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="hidden sm:flex items-center gap-1 font-mono text-xs text-[var(--text-secondary)]">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span>{entry.completedCount} lec</span>
                    </div>
                    <div className="hidden xs:flex items-center gap-1 font-mono text-xs text-amber-400 font-bold">
                      <Flame className="h-3.5 w-3.5" />
                      <span>{entry.currentStreak}d</span>
                    </div>
                    <div className="rounded-xl bg-[#16A34A]/20 border border-[#22C55E]/30 px-2.5 py-1 font-mono text-xs sm:text-sm font-extrabold text-[#4ade80] tabular-nums">
                      {entry.xp.toLocaleString()} XP
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
