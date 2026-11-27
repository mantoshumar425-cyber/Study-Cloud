import React, { useEffect, useState } from 'react';
import {
  User,
  Award,
  CheckCircle2,
  Download,
  LogOut,
  ShieldCheck,
  BookOpen,
  ClipboardCheck,
  Save,
  Loader2,
} from 'lucide-react';
import { AdventureState } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { getAdventureMetrics } from '../services/adventureService';

interface ProfileViewProps {
  adventureState: AdventureState;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ adventureState }) => {
  const {
    user,
    profile,
    openAuthModal,
    logout,
    updateStudentProfile,
    sendVerificationEmail,
    reloadSession,
    getIdToken,
  } = useAuth();
  const metrics = getAdventureMetrics(adventureState);

  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [mobile, setMobile] = useState(profile?.mobile || '');
  const [targetClass, setTargetClass] = useState(profile?.targetClass || 'Class 12');
  const [targetExam, setTargetExam] = useState(profile?.targetExam || 'IIT-JEE');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);

  useEffect(() => {
    setDisplayName(profile?.displayName || user?.displayName || '');
    setMobile(profile?.mobile || '');
    setTargetClass(profile?.targetClass || 'Class 12');
    setTargetExam(profile?.targetExam || 'IIT-JEE');
  }, [profile, user]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const token = await getIdToken();
      if (!token) return;
      const [aRes, eRes] = await Promise.all([
        fetch('/api/platform/tests/attempts', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/platform/enrollments', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const aData = await aRes.json().catch(() => ({}));
      const eData = await eRes.json().catch(() => ({}));
      if (aData?.success) setAttempts(aData.attempts || []);
      if (eData?.success) setEnrollments(eData.enrollments || []);
    })();
  }, [user, getIdToken]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(null);
    try {
      await updateStudentProfile({ displayName, mobile, targetClass, targetExam });
      setSavedNotice('Profile saved successfully.');
    } finally {
      setSaving(false);
    }
  };

  const downloadCertificate = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#061912';
    ctx.fillRect(0, 0, 1200, 800);
    ctx.strokeStyle = '#22C55E';
    ctx.lineWidth = 10;
    ctx.strokeRect(36, 36, 1128, 728);

    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('STUDY CLOUD · CERTIFICATE OF ACHIEVEMENT', 600, 150);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px sans-serif';
    ctx.fillText(displayName || 'Study Cloud Scholar', 600, 310);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '24px sans-serif';
    ctx.fillText(
      `For completing ${metrics.completedCount} lectures, maintaining a ${metrics.currentStreak}-day study streak,`,
      600,
      395
    );
    ctx.fillText(
      `and achieving Level ${metrics.level} (${metrics.rank}) with ${metrics.xp} XP in ${targetExam}.`,
      600,
      438
    );

    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`Issued on ${new Date().toLocaleDateString()} · studycloud-study.vercel.app`, 600, 620);

    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `StudyCloud-Certificate-${(displayName || 'Scholar').replace(/\s+/g, '-')}.png`;
    a.click();
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center space-y-4">
        <User className="h-12 w-12 text-[#22C55E] mx-auto" />
        <h2 className="font-['Sora'] text-xl font-extrabold">Student Profile &amp; Certificates</h2>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
          Sign in or register with your Name, Email, and Mobile Number to manage enrolled courses, view test performance, and download certificates.
        </p>
        <button
          type="button"
          onClick={openAuthModal}
          className="rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-6 py-2.5 text-sm font-bold text-white transition"
        >
          Login / Sign Up
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header Profile Card */}
      <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={displayName}
              className="h-16 w-16 rounded-2xl object-cover ring-2 ring-[#22C55E]"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#16A34A]/20 text-[#22C55E] font-['Sora'] text-2xl font-extrabold">
              {(displayName || 'S')[0].toUpperCase()}
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-['Sora'] text-xl font-extrabold">{displayName || 'Study Scholar'}</h1>
              {user.emailVerified && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" /> Verified
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)]">{user.email}</p>
            <p className="text-xs font-semibold text-emerald-400 mt-0.5">
              {targetClass} · {targetExam} · Lv.{metrics.level} {metrics.rank}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadCertificate}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-4 py-2 text-xs font-bold text-white transition"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download Certificate</span>
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/20 transition"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </div>

      {!user.emailVerified && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-amber-300 font-semibold">
            Your email is not verified yet. Verify via the link sent to {user.email} to enable cloud Firestore writes.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void sendVerificationEmail()}
              className="rounded-xl border border-amber-400/40 px-3 py-1.5 font-bold text-amber-200"
            >
              Resend Email
            </button>
            <button
              type="button"
              onClick={() => void reloadSession()}
              className="rounded-xl bg-[#16A34A] px-3 py-1.5 font-bold text-white"
            >
              Refresh Status
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Account Settings Form */}
        <form
          onSubmit={handleSave}
          className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-3.5"
        >
          <h2 className="font-['Sora'] text-base font-extrabold">Account Settings</h2>
          {savedNotice && (
            <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/30 p-2.5 text-xs text-emerald-300">
              {savedNotice}
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-bold text-[var(--text-secondary)]">Student Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs sm:text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-[var(--text-secondary)]">Mobile Number</label>
            <input
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="+91 ..."
              className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs sm:text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-[var(--text-secondary)]">Class</label>
              <select
                value={targetClass}
                onChange={(e) => setTargetClass(e.target.value)}
                className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs sm:text-sm"
              >
                <option value="Class 9">Class 9</option>
                <option value="Class 10">Class 10</option>
                <option value="Class 11">Class 11</option>
                <option value="Class 12">Class 12</option>
                <option value="Dropper">Dropper</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-[var(--text-secondary)]">Target Exam</label>
              <select
                value={targetExam}
                onChange={(e) => setTargetExam(e.target.value)}
                className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs sm:text-sm"
              >
                <option value="IIT-JEE">IIT-JEE</option>
                <option value="NEET">NEET</option>
                <option value="CBSE Boards">CBSE Boards</option>
                <option value="UPSC">UPSC</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-5 py-2 text-xs font-bold text-white transition"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            <span>Save Profile Changes</span>
          </button>
        </form>

        {/* Achievements, Enrolled Courses & Test Performance */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-2.5">
            <h2 className="font-['Sora'] text-base font-extrabold flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-400" />
              <span>Achievements &amp; Learning Progress</span>
            </h2>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-[var(--bg-secondary)] p-3">
                <div className="font-mono text-base font-extrabold text-emerald-400">{metrics.xp}</div>
                <div className="text-[var(--text-secondary)]">Total XP</div>
              </div>
              <div className="rounded-xl bg-[var(--bg-secondary)] p-3">
                <div className="font-mono text-base font-extrabold text-amber-400">{metrics.currentStreak}d</div>
                <div className="text-[var(--text-secondary)]">Streak</div>
              </div>
              <div className="rounded-xl bg-[var(--bg-secondary)] p-3">
                <div className="font-mono text-base font-extrabold">{metrics.completedCount}</div>
                <div className="text-[var(--text-secondary)]">Lectures</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-2.5">
            <h3 className="font-['Sora'] text-sm font-extrabold flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-[#22C55E]" />
              <span>Enrolled Store Courses ({enrollments.length})</span>
            </h3>
            {enrollments.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">No paid/free store courses enrolled yet.</p>
            ) : (
              <div className="space-y-1.5 text-xs">
                {enrollments.map((enr) => (
                  <div key={enr.courseId} className="flex items-center justify-between">
                    <span className="font-semibold">{enr.courseTitle}</span>
                    <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {enr.paymentStatus}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-2.5">
            <h3 className="font-['Sora'] text-sm font-extrabold flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-[#22C55E]" />
              <span>Recent Test Performance ({attempts.length})</span>
            </h3>
            {attempts.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">No test attempts recorded yet.</p>
            ) : (
              <div className="space-y-1.5 text-xs">
                {attempts.slice(0, 4).map((a) => (
                  <div key={a.attemptId} className="flex items-center justify-between">
                    <span className="truncate pr-2">{a.testTitle}</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {a.score}/{a.maxScore} · {a.accuracyPercent}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
