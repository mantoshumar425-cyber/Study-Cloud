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
  BarChart3,
} from 'lucide-react';
import { AdventureState, LeaderboardEntry } from '../types';
import {
  fetchLeaderboard,
  getAdventureMetrics,
  getLeaderboardProfile,
  saveLeaderboardProfile,
  syncLeaderboardScore,
} from '../services/adventureService';
import { useAuth } from '../contexts/AuthContext';

interface AirRankingEntry {
  userId: string;
  studentName: string;
  totalScore: number;
  totalMaxScore: number;
  testsTaken: number;
  avgAccuracy: number;
  lastAttemptAt: number;
  airRank: number;
  percentile: number;
}

interface LeaderboardViewProps {
  adventureState: AdventureState;
  onBrowseBatches: () => void;
  onAttemptTests?: () => void;
}

const EXAM_OPTIONS = ['IIT-JEE', 'NEET', 'Class 12', 'Class 11', 'Class 10', 'UPSC', 'All Exams'];

export const LeaderboardView: React.FC<LeaderboardViewProps> = ({
  adventureState,
  onBrowseBatches,
  onAttemptTests,
}) => {
  const { user, profile } = useAuth();
  const initialProfile = useMemo(() => getLeaderboardProfile(), []);
  const myMetrics = useMemo(() => getAdventureMetrics(adventureState), [adventureState]);

  const [boardMode, setBoardMode] = useState<'air' | 'total' | 'weekly' | 'monthly'>('air');
  const [playerName, setPlayerName] = useState(profile?.displayName || initialProfile.name);
  const [playerExam, setPlayerExam] = useState(profile?.targetExam || initialProfile.exam);
  const [examFilter, setExamFilter] = useState<string>('all');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [airEntries, setAirEntries] = useState<AirRankingEntry[]>([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [totalTestTakers, setTotalTestTakers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.displayName) setPlayerName(profile.displayName);
    if (profile?.targetExam && EXAM_OPTIONS.includes(profile.targetExam)) {
      setPlayerExam(profile.targetExam);
    }
  }, [profile]);

  const loadAndSync = useCallback(
    async (filter = examFilter) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        await syncLeaderboardScore(adventureState);
        const [xpData, airRes] = await Promise.all([
          fetchLeaderboard(filter),
          fetch('/api/platform/air-rankings').then((r) => r.json()).catch(() => null),
        ]);
        setEntries(xpData.entries);
        setTotalStudents(xpData.totalStudents);
        if (airRes?.success && Array.isArray(airRes.rankings)) {
          setAirEntries(airRes.rankings);
          setTotalTestTakers(Number(airRes.totalTestTakers || airRes.rankings.length));
        }
      } catch (err: any) {
        setErrorMsg(err?.message || 'Unable to load leaderboard data');
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
      setErrorMsg(err?.message || 'Unable to update leaderboard profile');
    } finally {
      setSaving(false);
    }
  };

  // Compute Weekly / Monthly filtered & sorted XP entries based on actual updatedAt timestamps
  const visibleXpEntries = useMemo(() => {
    const now = Date.now();
    if (boardMode === 'weekly') {
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
      return entries
        .filter((e) => (e.updatedAt || 0) >= weekAgo)
        .map((e) => ({
          ...e,
          displayXp: e.weeklyXp ?? Math.round(e.xp * 0.35 + e.currentStreak * 20),
        }))
        .sort((a, b) => b.displayXp - a.displayXp);
    }
    if (boardMode === 'monthly') {
      const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
      return entries
        .filter((e) => (e.updatedAt || 0) >= monthAgo)
        .map((e) => ({
          ...e,
          displayXp: e.monthlyXp ?? Math.round(e.xp * 0.75 + e.completedCount * 10),
        }))
        .sort((a, b) => b.displayXp - a.displayXp);
    }
    return entries.map((e) => ({ ...e, displayXp: e.xp }));
  }, [entries, boardMode]);

  const myAirEntry = user ? airEntries.find((a) => a.userId === user.uid) : null;
  const myIndex = visibleXpEntries.findIndex((item) => item.playerId === initialProfile.playerId);
  const myRankPosition = boardMode === 'air' ? (myAirEntry ? myAirEntry.airRank : null) : myIndex >= 0 ? myIndex + 1 : null;
  const topThreeXp = visibleXpEntries.slice(0, 3);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Header Banner + My Rank & XP Card */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-[var(--card-bg)] via-[var(--card-bg)] to-emerald-500/10 p-5 sm:p-6 shadow-sm">
        <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-400">
              <Trophy className="h-4 w-4" />
              <span>Study Cloud · AIR, Percentile &amp; XP Rankings</span>
            </div>
            <h1 className="font-['Sora'] text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">
              All-India Rank &amp; Scholar Leaderboard
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-xl leading-relaxed">
              All-India Rank &amp; Percentile are computed strictly from submitted Online Test Series
              attempts. Track Weekly, Monthly, Batch-wise &amp; Total XP rankings live.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2.5 sm:gap-3 rounded-2xl border border-emerald-500/25 bg-[var(--bg-secondary)] p-3.5 text-center shrink-0">
            <div>
              <div className="font-mono text-lg sm:text-xl font-extrabold text-emerald-400">
                {myRankPosition ? `#${myRankPosition}` : '--'}
              </div>
              <div className="text-[11px] font-semibold text-[var(--text-secondary)]">
                {boardMode === 'air' ? 'Your AIR' : 'Your Rank'}
              </div>
            </div>
            <div>
              <div className="font-mono text-lg sm:text-xl font-extrabold text-[var(--text-primary)]">
                {boardMode === 'air'
                  ? myAirEntry
                    ? `${myAirEntry.percentile}%`
                    : '--'
                  : myMetrics.xp.toLocaleString()}
              </div>
              <div className="text-[11px] font-semibold text-[var(--text-secondary)]">
                {boardMode === 'air' ? 'Percentile' : 'Total XP'}
              </div>
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

        {/* Ranking Mode Tabs: All-India Rank | Total XP | Weekly | Monthly */}
        <div className="relative mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
          {[
            { id: 'air', label: 'All-India Test Rank (AIR)' },
            { id: 'total', label: 'Total XP' },
            { id: 'weekly', label: 'Weekly Leaderboard' },
            { id: 'monthly', label: 'Monthly Leaderboard' },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setBoardMode(m.id as any)}
              className={`rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
                boardMode === m.id
                  ? 'bg-[#16A34A] text-white shadow-sm'
                  : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Editable Profile Form for XP Leaderboard */}
        {boardMode !== 'air' && (
          <form
            onSubmit={handleSaveProfile}
            className="relative mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
          >
            <div className="relative flex-1">
              <User className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
              <input
                type="text"
                maxLength={32}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter your display name"
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
        )}
      </div>

      {errorMsg && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs sm:text-sm text-red-300">
          {errorMsg}
        </div>
      )}

      {/* VIEW A: REAL ALL-INDIA RANKINGS FROM ACTUAL TEST SUBMISSIONS */}
      {boardMode === 'air' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="flex items-center gap-1.5 font-bold text-[var(--text-primary)]">
              <BarChart3 className="h-4 w-4 text-emerald-400" />
              <span>Real Submitted Test Rankings</span>
            </span>
            <span className="font-mono font-semibold">
              {totalTestTakers} Verified {totalTestTakers === 1 ? 'Candidate' : 'Candidates'} Ranked
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-sm">
            {loading && airEntries.length === 0 ? (
              <div className="p-8 text-center text-xs sm:text-sm text-[var(--text-secondary)]">
                Loading real test attempt rankings...
              </div>
            ) : airEntries.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <Trophy className="h-10 w-10 text-emerald-400 mx-auto" />
                <h3 className="font-['Sora'] text-base font-bold text-[var(--text-primary)]">
                  No Official Test Attempts Recorded Yet
                </h3>
                <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-md mx-auto">
                  All-India Rank &amp; Percentile are calculated strictly from real submitted test attempts.
                  Sign in and attempt any Chapter, Weekly, Monthly, or Full-Syllabus test to appear on AIR.
                </p>
                {onAttemptTests && (
                  <button
                    type="button"
                    onClick={onAttemptTests}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-4 py-2 text-xs font-bold text-white transition"
                  >
                    <span>Go to Online Test Series</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-[var(--card-border)]">
                {airEntries.map((item) => {
                  const isMe = user?.uid === item.userId;
                  return (
                    <div
                      key={item.userId}
                      className={`flex items-center justify-between gap-3 px-4 py-3.5 text-xs sm:text-sm ${
                        isMe ? 'bg-[#16A34A]/15' : 'hover:bg-[var(--bg-secondary)]/60'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`flex h-9 w-12 shrink-0 items-center justify-center rounded-xl font-mono text-xs font-extrabold ${
                            item.airRank === 1
                              ? 'bg-amber-500/20 text-amber-400'
                              : item.airRank === 2
                              ? 'bg-slate-400/20 text-slate-300'
                              : item.airRank === 3
                              ? 'bg-orange-500/20 text-orange-400'
                              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                          }`}
                        >
                          AIR {item.airRank}
                        </div>
                        <div className="min-w-0">
                          <div className="font-['Sora'] font-bold text-[var(--text-primary)] truncate">
                            {item.studentName} {isMe ? '(You)' : ''}
                          </div>
                          <div className="text-[11px] text-[var(--text-secondary)]">
                            {item.testsTaken} {item.testsTaken === 1 ? 'Test' : 'Tests'} · {item.avgAccuracy}% Avg Accuracy
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 font-mono">
                        <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-xs font-extrabold text-emerald-400">
                          {item.percentile}%ile
                        </span>
                        <span className="text-xs sm:text-sm font-extrabold text-[var(--text-primary)]">
                          {item.totalScore}/{item.totalMaxScore}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* VIEW B: WEEKLY / MONTHLY / TOTAL XP & BATCH-WISE RANKINGS */
        <>
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
                    {opt === 'all' ? 'All Batches' : opt}
                  </button>
                );
              })}
            </div>

            <span className="font-mono text-xs font-semibold text-[var(--text-secondary)]">
              {visibleXpEntries.length} / {totalStudents} Ranked
            </span>
          </div>

          {topThreeXp.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {topThreeXp.map((entry, idx) => {
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
                        {entry.displayXp.toLocaleString()} XP
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

          <div className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-sm">
            {loading && visibleXpEntries.length === 0 ? (
              <div className="p-8 text-center text-xs sm:text-sm text-[var(--text-secondary)]">
                Loading live XP leaderboard...
              </div>
            ) : visibleXpEntries.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <Trophy className="h-10 w-10 text-emerald-400 mx-auto" />
                <h3 className="font-['Sora'] text-base font-bold text-[var(--text-primary)]">
                  No Scholars in This Window Yet
                </h3>
                <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-md mx-auto">
                  Watch &amp; complete lectures or tests to earn XP and climb the rankings.
                </p>
                <button
                  type="button"
                  onClick={onBrowseBatches}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-4 py-2 text-xs font-bold text-white transition"
                >
                  <span>Browse Lectures &amp; Earn XP</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[var(--card-border)]">
                {visibleXpEntries.map((entry, idx) => {
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
                          {entry.displayXp.toLocaleString()} XP
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
