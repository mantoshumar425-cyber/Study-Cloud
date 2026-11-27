import React, { useEffect, useState } from 'react';
import {
  Play,
  Radio,
  Flame,
  Trophy,
  BookOpen,
  Bell,
  ClipboardCheck,
  Sparkles,
  ArrowRight,
  Clock,
  GraduationCap,
  LogIn,
} from 'lucide-react';
import {
  AdventureState,
  LiveClassSession,
  NavTab,
  PlatformCourse,
  PlatformNotification,
  WatchHistoryItem,
} from '../types';
import { useAuth } from '../contexts/AuthContext';
import { getAdventureMetrics } from '../services/adventureService';

interface DashboardViewProps {
  adventureState: AdventureState;
  watchHistory: WatchHistoryItem[];
  onNavigateTab: (tab: NavTab) => void;
  onResumeHistory: (item: WatchHistoryItem) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  adventureState,
  watchHistory,
  onNavigateTab,
  onResumeHistory,
}) => {
  const { user, profile, openAuthModal, getIdToken } = useAuth();
  const metrics = getAdventureMetrics(adventureState);

  const [courses, setCourses] = useState<PlatformCourse[]>([]);
  const [liveClasses, setLiveClasses] = useState<LiveClassSession[]>([]);
  const [notifications, setNotifications] = useState<PlatformNotification[]>([]);
  const [recentAttempts, setRecentAttempts] = useState<any[]>([]);

  useEffect(() => {
    void fetch('/api/platform/courses')
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && Array.isArray(d.courses)) setCourses(d.courses.slice(0, 4));
      })
      .catch(() => {});

    void fetch('/api/live-classes')
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && Array.isArray(d.classes)) setLiveClasses(d.classes.slice(0, 3));
      })
      .catch(() => {});

    void fetch('/api/notifications')
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && Array.isArray(d.notifications)) setNotifications(d.notifications.slice(0, 4));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) {
      setRecentAttempts([]);
      return;
    }
    void (async () => {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/platform/tests/attempts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && Array.isArray(data.attempts)) {
        setRecentAttempts(data.attempts.slice(0, 3));
      }
    })();
  }, [user, getIdToken]);

  const studentName = profile?.displayName || user?.displayName || 'Study Scholar';
  const continueList = watchHistory.slice(0, 4);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-[var(--card-border)] bg-gradient-to-br from-[var(--card-bg)] via-[var(--card-bg)] to-emerald-500/15 p-5 sm:p-7 shadow-sm">
        <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[#16A34A]/15 blur-3xl" />
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-400">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Study Cloud · Student Workspace</span>
            </div>
            <h1 className="font-['Sora'] text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">
              Welcome back, {studentName}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-2xl">
              {profile?.targetClass || 'Class 12'} · {profile?.targetExam || 'IIT-JEE'} · Continue your
              recorded lectures, join live classes, solve daily DPPs, and track your All-India percentile.
            </p>
            {!user && (
              <button
                type="button"
                onClick={openAuthModal}
                className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-4 py-2 text-xs font-bold text-white shadow-sm transition"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Sign In / Register to Sync Cloud Progress</span>
              </button>
            )}
          </div>

          {/* Live Metrics Grid */}
          <div className="grid grid-cols-3 gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3.5 text-center shrink-0">
            <div>
              <div className="flex items-center justify-center gap-1 font-mono text-lg font-extrabold text-amber-400">
                <Flame className="h-4 w-4" />
                <span>{metrics.currentStreak}d</span>
              </div>
              <div className="text-[11px] text-[var(--text-secondary)]">Streak</div>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('leaderboard')}
              className="rounded-lg hover:bg-emerald-500/10 px-2 transition"
            >
              <div className="flex items-center justify-center gap-1 font-mono text-lg font-extrabold text-emerald-400">
                <Trophy className="h-4 w-4" />
                <span>{metrics.xp}</span>
              </div>
              <div className="text-[11px] text-[var(--text-secondary)]">Total XP</div>
            </button>
            <div>
              <div className="font-mono text-lg font-extrabold text-[var(--text-primary)]">
                {metrics.completedCount}
              </div>
              <div className="text-[11px] text-[var(--text-secondary)]">Cleared</div>
            </div>
          </div>
        </div>
      </div>

      {/* Continue Learning Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-['Sora'] text-base sm:text-lg font-extrabold flex items-center gap-2">
            <Play className="h-4 w-4 text-[#22C55E]" />
            <span>Continue Learning</span>
          </h2>
          <button
            type="button"
            onClick={() => onNavigateTab('history')}
            className="text-xs font-bold text-[#22C55E] hover:underline flex items-center gap-1"
          >
            <span>Watch History</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {continueList.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-center text-xs sm:text-sm text-[var(--text-secondary)]">
            Start watching any batch lecture or recorded vault session — your exact resume timestamp will appear here automatically.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {continueList.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onResumeHistory(item)}
                className="group text-left rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3.5 hover:border-[#22C55E] transition space-y-2.5"
              >
                <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                  <span className="truncate font-semibold text-emerald-400">
                    {item.batchName || 'Recorded Lecture'}
                  </span>
                  <span className="font-mono">{item.progressPercent || 0}%</span>
                </div>
                <div className="font-['Sora'] text-xs sm:text-sm font-bold line-clamp-2 text-[var(--text-primary)] group-hover:text-[#22C55E]">
                  {item.title}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                  <div
                    className="h-full rounded-full bg-[#16A34A]"
                    style={{ width: `${Math.min(100, Math.max(4, item.progressPercent || 0))}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Live Classes + Notifications Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <section className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-['Sora'] text-base sm:text-lg font-extrabold flex items-center gap-2">
              <Radio className="h-4 w-4 text-rose-400" />
              <span>Upcoming &amp; Live Classes</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigateTab('live')}
              className="text-xs font-bold text-[#22C55E] hover:underline flex items-center gap-1"
            >
              <span>Open Live Classroom</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-2.5">
            {liveClasses.map((cls) => (
              <div
                key={cls.classId}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-bold">
                    <span
                      className={`rounded-md px-2 py-0.5 uppercase ${
                        cls.status === 'live'
                          ? 'bg-rose-500/20 text-rose-400'
                          : 'bg-amber-500/20 text-amber-400'
                      }`}
                    >
                      {cls.status === 'live' ? 'LIVE NOW' : 'UPCOMING'}
                    </span>
                    <span className="text-[var(--text-secondary)]">{cls.subject}</span>
                  </div>
                  <div className="font-['Sora'] text-sm font-bold text-[var(--text-primary)] truncate">
                    {cls.title}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <span>By {cls.teacherName}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1 font-mono">
                      <Clock className="h-3 w-3" />
                      {new Date(cls.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('live')}
                  className="shrink-0 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-4 py-2 text-xs font-bold text-white transition"
                >
                  {cls.status === 'live' ? 'Join Live' : 'Set Reminder'}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Announcements & Recent Test Results */}
        <section className="space-y-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="font-['Sora'] text-base font-extrabold flex items-center gap-2">
                <Bell className="h-4 w-4 text-amber-400" />
                <span>Announcements</span>
              </h2>
              <button
                type="button"
                onClick={() => onNavigateTab('notifications')}
                className="text-xs font-bold text-[#22C55E] hover:underline"
              >
                All Alerts
              </button>
            </div>
            <div className="space-y-2 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3.5">
              {notifications.map((n) => (
                <div key={n.notificationId} className="border-b last:border-b-0 border-[var(--card-border)] pb-2 last:pb-0">
                  <div className="text-xs font-bold text-[var(--text-primary)]">{n.title}</div>
                  <div className="text-[11px] text-[var(--text-secondary)] line-clamp-2">{n.body}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="font-['Sora'] text-base font-extrabold flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-emerald-400" />
                <span>Recent Test Results</span>
              </h2>
              <button
                type="button"
                onClick={() => onNavigateTab('test')}
                className="text-xs font-bold text-[#22C55E] hover:underline"
              >
                Take Test
              </button>
            </div>
            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3.5 space-y-2">
              {recentAttempts.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  Attempt any Weekly or Chapter test to view your live score &amp; accuracy here.
                </p>
              ) : (
                recentAttempts.map((att) => (
                  <div key={att.attemptId} className="flex items-center justify-between text-xs">
                    <span className="truncate font-semibold pr-2">{att.testTitle}</span>
                    <span className="font-mono font-bold text-emerald-400 shrink-0">
                      {att.score}/{att.maxScore} ({att.accuracyPercent}%)
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Featured Courses & Batches */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-['Sora'] text-base sm:text-lg font-extrabold flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-[var(--primary-color)]" />
            <span>Featured Courses (Class 9–12, JEE &amp; NEET)</span>
          </h2>
          <button
            type="button"
            onClick={() => onNavigateTab('cart')}
            className="text-xs font-bold text-[#22C55E] hover:underline flex items-center gap-1"
          >
            <span>Course Store &amp; Cart</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {courses.map((course) => (
            <div
              key={course.courseId}
              className="flex flex-col overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-sm"
            >
              <div className="aspect-video w-full bg-[var(--bg-tertiary)] overflow-hidden">
                <img
                  src={course.thumbnail}
                  alt={course.title}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2.5">
                <div>
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span className="text-emerald-400">{course.classLevel}</span>
                    <span className="text-[var(--text-secondary)]">{course.category}</span>
                  </div>
                  <h3 className="font-['Sora'] text-sm font-bold text-[var(--text-primary)] line-clamp-2 mt-0.5">
                    {course.title}
                  </h3>
                  <p className="text-[11px] text-[var(--text-secondary)] truncate mt-0.5">
                    {course.facultyName}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-[var(--card-border)]">
                  <span className="font-mono text-sm font-extrabold text-[var(--text-primary)]">
                    {course.isFree || course.price === 0 ? 'FREE' : `₹${course.price}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('cart')}
                    className="rounded-lg bg-[#16A34A] hover:bg-[#22C55E] px-3 py-1.5 text-xs font-bold text-white transition"
                  >
                    <BookOpen className="inline h-3 w-3 mr-1" />
                    Enroll
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
