import React, { useEffect, useState } from 'react';
import {
  Shield,
  Plus,
  Trash2,
  Send,
  Radio,
  BookOpen,
  Tag,
  HelpCircle,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { DoubtTicket, LiveClassSession, PlatformCourse } from '../types';
import { useAuth } from '../contexts/AuthContext';

export const AdminDashboardView: React.FC = () => {
  const { user, isAdmin, getIdToken, openAuthModal } = useAuth();
  const [courses, setCourses] = useState<PlatformCourse[]>([]);
  const [liveClasses, setLiveClasses] = useState<LiveClassSession[]>([]);
  const [doubts, setDoubts] = useState<DoubtTicket[]>([]);
  const [setupStatus, setSetupStatus] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Course creation state
  const [courseTitle, setCourseTitle] = useState('');
  const [courseClass, setCourseClass] = useState('Class 10');
  const [courseCat, setCourseCat] = useState('CBSE Boards');
  const [coursePrice, setCoursePrice] = useState('0');
  const [courseFaculty, setCourseFaculty] = useState('');
  const [courseSyllabus, setCourseSyllabus] = useState('');

  // Live class creation
  const [liveTitle, setLiveTitle] = useState('');
  const [liveSubject, setLiveSubject] = useState('Physics');
  const [liveTeacher, setLiveTeacher] = useState('');
  const [liveUrl, setLiveUrl] = useState('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');

  // Notification & Coupon
  const [notifTitle, setNotifTitle] = useState('');
  const [notifBody, setNotifBody] = useState('');
  const [notifType, setNotifType] = useState<'live' | 'lecture' | 'notes' | 'test' | 'course'>('live');
  const [couponCode, setCouponCode] = useState('');
  const [couponPercent, setCouponPercent] = useState('15');
  const [replyMap, setReplyMap] = useState<Record<string, string>>({});

  const loadAll = async () => {
    void fetch('/api/platform/courses')
      .then((r) => r.json())
      .then((d) => d?.success && setCourses(d.courses || []));
    void fetch('/api/live-classes')
      .then((r) => r.json())
      .then((d) => d?.success && setLiveClasses(d.classes || []));
    void fetch('/api/platform/setup-status')
      .then((r) => r.json())
      .then((d) => d?.success && setSetupStatus(d.integrations));

    const token = await getIdToken();
    if (token) {
      void fetch('/api/doubts', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((d) => d?.success && setDoubts(d.doubts || []));
    }
  };

  useEffect(() => {
    void loadAll();
  }, [user]);

  if (!user || !isAdmin) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center space-y-4">
        <Shield className="h-12 w-12 text-amber-400 mx-auto" />
        <h2 className="font-['Sora'] text-xl font-extrabold">Admin Dashboard Restricted</h2>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
          Sign in with a verified administrator account ({setupStatus?.bootstrapAdminEmail || 'mantoshumar425@gmail.com'}) to manage courses, live classes, tests, coupons, and student doubts.
        </p>
        {!user && (
          <button
            type="button"
            onClick={openAuthModal}
            className="rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-5 py-2.5 text-xs font-bold text-white"
          >
            Sign In as Admin
          </button>
        )}
      </div>
    );
  }

  const adminPost = async (url: string, payload: any, method = 'POST') => {
    setMsg(null);
    setErr(null);
    const token = await getIdToken();
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: method === 'DELETE' ? undefined : JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setErr(data?.message || 'Admin request failed.');
      return false;
    }
    await loadAll();
    return true;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-['Sora'] text-xl sm:text-2xl font-extrabold flex items-center gap-2">
          <Shield className="h-5 w-5 text-[#22C55E]" />
          <span>Study Cloud Admin Control Panel</span>
        </h1>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
          Manage courses, live classes, student doubts, coupons, announcements, and backend setup status.
        </p>
      </div>

      {msg && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">{msg}</div>}
      {err && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{err}</div>}

      {/* Setup Health & Environment Variables Checklist */}
      {setupStatus && (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-3">
          <h2 className="font-['Sora'] text-sm font-extrabold">Integration &amp; Environment Health</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl bg-[var(--bg-secondary)] p-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>Firebase: {setupStatus.firebaseProjectId}</span>
            </div>
            <div className="rounded-xl bg-[var(--bg-secondary)] p-3 flex items-center gap-2">
              {setupStatus.geminiConfigured ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              )}
              <span>GEMINI_API_KEY: {setupStatus.geminiConfigured ? 'Ready' : 'Missing'}</span>
            </div>
            <div className="rounded-xl bg-[var(--bg-secondary)] p-3 flex items-center gap-2">
              {setupStatus.stripeConfigured ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              )}
              <span>STRIPE_SECRET_KEY: {setupStatus.stripeConfigured ? 'Active' : 'Add for Paid'}</span>
            </div>
            <div className="rounded-xl bg-[var(--bg-secondary)] p-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>WebSocket Live Hub: Active</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Create Course */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await adminPost('/api/platform/admin/courses', {
              title: courseTitle,
              classLevel: courseClass,
              category: courseCat,
              price: Number(coursePrice) || 0,
              facultyName: courseFaculty,
              syllabus: courseSyllabus,
            });
            if (ok) {
              setCourseTitle('');
              setCourseSyllabus('');
              setMsg('Course published cleanly!');
            }
          }}
          className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-3"
        >
          <h2 className="font-['Sora'] text-base font-extrabold flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[#22C55E]" /> Create Course / Batch
          </h2>
          <input
            type="text"
            required
            value={courseTitle}
            onChange={(e) => setCourseTitle(e.target.value)}
            placeholder="Course Title (e.g. Sankalp Class 10 CBSE)"
            className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
          />
          <div className="grid grid-cols-3 gap-2">
            <select
              value={courseClass}
              onChange={(e) => setCourseClass(e.target.value)}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-2.5 py-2 text-xs"
            >
              <option value="Class 9">Class 9</option>
              <option value="Class 10">Class 10</option>
              <option value="Class 11">Class 11</option>
              <option value="Class 12">Class 12</option>
            </select>
            <input
              type="text"
              value={courseCat}
              onChange={(e) => setCourseCat(e.target.value)}
              placeholder="Category"
              className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-2.5 py-2 text-xs"
            />
            <input
              type="number"
              min="0"
              value={coursePrice}
              onChange={(e) => setCoursePrice(e.target.value)}
              placeholder="Price INR"
              className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-2.5 py-2 text-xs"
            />
          </div>
          <input
            type="text"
            value={courseFaculty}
            onChange={(e) => setCourseFaculty(e.target.value)}
            placeholder="Faculty Names"
            className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
          />
          <textarea
            rows={2}
            value={courseSyllabus}
            onChange={(e) => setCourseSyllabus(e.target.value)}
            placeholder="Syllabus overview..."
            className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] p-2.5 text-xs"
          />
          <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl bg-[#16A34A] px-4 py-2 text-xs font-bold text-white">
            <Plus className="h-3.5 w-3.5" /> Publish Course
          </button>

          <div className="pt-2 border-t border-[var(--card-border)] space-y-1.5 max-h-40 overflow-y-auto">
            {courses.map((c) => (
              <div key={c.courseId} className="flex items-center justify-between text-xs">
                <span className="truncate font-semibold">{c.title} ({c.isFree ? 'FREE' : `₹${c.price}`})</span>
                <button
                  type="button"
                  onClick={() => void adminPost(`/api/platform/admin/courses/${c.courseId}`, {}, 'DELETE')}
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </form>

        {/* Live Class Scheduler */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await adminPost('/api/platform/admin/live-classes', {
              title: liveTitle,
              subject: liveSubject,
              teacherName: liveTeacher,
              streamUrl: liveUrl,
              status: 'live',
            });
            if (ok) {
              setLiveTitle('');
              setMsg('Live classroom started!');
            }
          }}
          className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-3"
        >
          <h2 className="font-['Sora'] text-base font-extrabold flex items-center gap-2">
            <Radio className="h-4 w-4 text-rose-400" /> Schedule / Start Live Class
          </h2>
          <input
            type="text"
            required
            value={liveTitle}
            onChange={(e) => setLiveTitle(e.target.value)}
            placeholder="Live Lecture Title"
            className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={liveSubject}
              onChange={(e) => setLiveSubject(e.target.value)}
              placeholder="Subject"
              className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
            />
            <input
              type="text"
              value={liveTeacher}
              onChange={(e) => setLiveTeacher(e.target.value)}
              placeholder="Teacher Name"
              className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
            />
          </div>
          <input
            type="url"
            value={liveUrl}
            onChange={(e) => setLiveUrl(e.target.value)}
            placeholder="HLS (.m3u8) / MP4 Stream URL"
            className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
          />
          <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-bold text-white">
            <Radio className="h-3.5 w-3.5" /> Launch Live Class
          </button>

          <div className="pt-2 border-t border-[var(--card-border)] space-y-1.5 max-h-40 overflow-y-auto">
            {liveClasses.map((lc) => (
              <div key={lc.classId} className="flex items-center justify-between text-xs gap-2">
                <span className="truncate font-semibold">{lc.title}</span>
                <select
                  value={lc.status}
                  onChange={(e) =>
                    void adminPost(`/api/platform/admin/live-classes/${lc.classId}`, { status: e.target.value }, 'PATCH')
                  }
                  className="rounded-lg border border-[var(--card-border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px]"
                >
                  <option value="live">live</option>
                  <option value="scheduled">scheduled</option>
                  <option value="ended">ended</option>
                </select>
              </div>
            ))}
          </div>
        </form>

        {/* Broadcast Push Notification & Coupons */}
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await adminPost('/api/platform/admin/notifications', {
                title: notifTitle,
                body: notifBody,
                type: notifType,
              });
              if (ok) {
                setNotifTitle('');
                setNotifBody('');
                setMsg('Notification broadcasted via WebSocket!');
              }
            }}
            className="space-y-2.5"
          >
            <h2 className="font-['Sora'] text-base font-extrabold flex items-center gap-2">
              <Send className="h-4 w-4 text-[#22C55E]" /> Broadcast Live Notification
            </h2>
            <input
              type="text"
              required
              value={notifTitle}
              onChange={(e) => setNotifTitle(e.target.value)}
              placeholder="Alert Title"
              className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
            />
            <textarea
              rows={2}
              required
              value={notifBody}
              onChange={(e) => setNotifBody(e.target.value)}
              placeholder="Announcement text..."
              className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] p-2.5 text-xs"
            />
            <div className="flex gap-2">
              <select
                value={notifType}
                onChange={(e) => setNotifType(e.target.value as any)}
                className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
              >
                <option value="live">Live Reminder</option>
                <option value="lecture">New Lecture</option>
                <option value="notes">New Notes</option>
                <option value="test">Test Alert</option>
                <option value="course">Course Update</option>
              </select>
              <button type="submit" className="rounded-xl bg-[#16A34A] px-4 py-2 text-xs font-bold text-white">
                Push Broadcast
              </button>
            </div>
          </form>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await adminPost('/api/platform/admin/coupons', {
                code: couponCode,
                discountPercent: Number(couponPercent) || 10,
                maxDiscount: 1000,
              });
              if (ok) {
                setCouponCode('');
                setMsg('Coupon code saved!');
              }
            }}
            className="border-t border-[var(--card-border)] pt-3 space-y-2"
          >
            <h3 className="font-['Sora'] text-sm font-extrabold flex items-center gap-2">
              <Tag className="h-4 w-4 text-amber-400" /> Create Discount Coupon
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="CODE (e.g. FEST25)"
                className="flex-1 rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs uppercase"
              />
              <input
                type="number"
                min="1"
                max="100"
                value={couponPercent}
                onChange={(e) => setCouponPercent(e.target.value)}
                className="w-20 rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-2.5 py-2 text-xs"
              />
              <button type="submit" className="rounded-xl bg-[#16A34A] px-3.5 py-2 text-xs font-bold text-white">
                Add
              </button>
            </div>
          </form>
        </div>

        {/* Pending Student Doubts Queue */}
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-3">
          <h2 className="font-['Sora'] text-base font-extrabold flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-amber-400" /> Student Doubts Queue ({doubts.filter((d) => d.status === 'open').length} Open)
          </h2>
          <div className="space-y-2.5 max-h-72 overflow-y-auto">
            {doubts.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">No doubts submitted yet.</p>
            ) : (
              doubts.map((d) => (
                <div key={d.doubtId} className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3 text-xs space-y-2">
                  <div className="flex justify-between font-bold">
                    <span className="text-emerald-400">{d.subject} · {d.studentName}</span>
                    <span>{d.status.toUpperCase()}</span>
                  </div>
                  <p>{d.questionText}</p>
                  {d.status === 'open' && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={replyMap[d.doubtId] || ''}
                        onChange={(e) => setReplyMap((prev) => ({ ...prev, [d.doubtId]: e.target.value }))}
                        placeholder="Write faculty answer..."
                        className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          void adminPost(`/api/doubts/${d.doubtId}/reply`, {
                            teacherReply: replyMap[d.doubtId] || '',
                          })
                        }
                        className="rounded-lg bg-[#16A34A] px-3 py-1.5 font-bold text-white"
                      >
                        Reply
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
