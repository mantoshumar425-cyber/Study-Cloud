import React, { useState } from 'react';
import {
  X,
  Mail,
  Lock,
  User,
  Phone,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  KeyRound,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { FIREBASE_PROJECT_ID } from '../lib/firebase';
import { STUDY_CLOUD_LOGO } from './Sidebar';

export const AuthModal: React.FC = () => {
  const {
    user,
    isAuthModalOpen,
    closeAuthModal,
    loginWithGoogle,
    loginWithEmail,
    signupWithEmail,
    sendVerificationEmail,
    resetPassword,
    reloadSession,
  } = useAuth();

  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [targetClass, setTargetClass] = useState('Class 12');
  const [targetExam, setTargetExam] = useState('IIT-JEE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!isAuthModalOpen) return null;

  const formatAuthError = (err: any): string => {
    const code = String(err?.code || '');
    const raw = String(err?.message || 'Authentication failed');
    if (code.includes('operation-not-allowed') || raw.includes('operation-not-allowed')) {
      return `Email/Password sign-in is not yet enabled in Firebase Console (${FIREBASE_PROJECT_ID} -> Authentication -> Sign-in method -> Email/Password). Use Google Sign-In below or enable Email/Password in Firebase Console.`;
    }
    if (code.includes('invalid-credential') || code.includes('wrong-password')) {
      return 'Invalid email or password. Try again or click Forgot Password.';
    }
    if (code.includes('email-already-in-use')) {
      return 'An account with this email already exists. Please sign in instead.';
    }
    if (code.includes('weak-password')) {
      return 'Password must be at least 6 characters long.';
    }
    if (code.includes('popup-closed-by-user')) {
      return 'Google sign-in popup was closed before completing login.';
    }
    return raw;
  };

  const handleGoogle = async () => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await loginWithEmail(email, password);
      } else if (mode === 'signup') {
        if (!name.trim()) throw new Error('Full name is required.');
        if (!mobile.trim()) throw new Error('Mobile number is required.');
        await signupWithEmail({ name, email, mobile, password, targetClass, targetExam });
        setNotice(
          'Account created! A verification link has been sent to your email. Please verify your email and click "I Verified — Refresh Session".'
        );
      } else {
        await resetPassword(email);
        setNotice('Password reset link sent to your email inbox.');
      }
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-md p-3">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--card-border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <img
              src={STUDY_CLOUD_LOGO}
              alt="Study Cloud"
              className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/15"
            />
            <div>
              <h3 className="font-['Sora'] text-base font-extrabold">Study Cloud Student Portal</h3>
              <p className="text-[11px] text-[var(--text-secondary)]">
                Firebase Verified Authentication &amp; Cloud Sync
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeAuthModal}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
          {user && !user.emailVerified && (
            <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3.5 space-y-2.5 text-xs">
              <div className="flex items-start gap-2 text-amber-300 font-bold">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Verify your email ({user.email}) to unlock cloud saving, live chat &amp; tests.</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      const ok = await reloadSession();
                      if (ok) {
                        setNotice('Email verified successfully!');
                        closeAuthModal();
                      } else {
                        setError('Email is still unverified. Check your inbox spam folder or resend.');
                      }
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#16A34A] px-3 py-1.5 font-bold text-white hover:bg-[#22C55E]"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>I Verified — Refresh Session</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await sendVerificationEmail();
                      setNotice('Verification email resent!');
                    } catch (e: any) {
                      setError(e?.message || 'Could not resend verification email.');
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] px-3 py-1.5 font-semibold text-[var(--text-primary)]"
                >
                  Resend Email
                </button>
              </div>
            </div>
          )}

          {/* Mode Tabs */}
          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-[var(--bg-primary)] p-1 border border-[var(--card-border)] text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setNotice(null);
              }}
              className={`rounded-lg py-2 transition ${
                mode === 'login' ? 'bg-[#16A34A] text-white' : 'text-[var(--text-secondary)]'
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError(null);
                setNotice(null);
              }}
              className={`rounded-lg py-2 transition ${
                mode === 'signup' ? 'bg-[#16A34A] text-white' : 'text-[var(--text-secondary)]'
              }`}
            >
              Sign Up
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('reset');
                setError(null);
                setNotice(null);
              }}
              className={`rounded-lg py-2 transition ${
                mode === 'reset' ? 'bg-[#16A34A] text-white' : 'text-[var(--text-secondary)]'
              }`}
            >
              Reset
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{notice}</span>
            </div>
          )}

          {/* Google One-Click Sign-In */}
          <button
            type="button"
            disabled={loading}
            onClick={handleGoogle}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] py-2.5 text-xs sm:text-sm font-bold text-[var(--text-primary)] hover:border-[#22C55E] transition disabled:opacity-60"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span>Continue with Google (Verified Instant Login)</span>
          </button>

          <div className="relative flex items-center justify-center text-[11px] uppercase tracking-wider text-[var(--text-secondary)]">
            <div className="h-px flex-1 bg-[var(--card-border)]" />
            <span className="px-3">or use email</span>
            <div className="h-px flex-1 bg-[var(--card-border)]" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'signup' && (
              <>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full Student Name"
                    className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] py-2.5 pl-9 pr-3 text-xs sm:text-sm focus:border-[#22C55E] focus:outline-none"
                  />
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
                  <input
                    type="tel"
                    required
                    maxLength={24}
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    placeholder="Mobile Number (e.g. +91 9876543210)"
                    className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] py-2.5 pl-9 pr-3 text-xs sm:text-sm focus:border-[#22C55E] focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={targetClass}
                    onChange={(e) => setTargetClass(e.target.value)}
                    className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs font-semibold focus:border-[#22C55E] focus:outline-none"
                  >
                    <option value="Class 9">Class 9</option>
                    <option value="Class 10">Class 10</option>
                    <option value="Class 11">Class 11</option>
                    <option value="Class 12">Class 12</option>
                    <option value="Dropper">Dropper</option>
                  </select>
                  <select
                    value={targetExam}
                    onChange={(e) => setTargetExam(e.target.value)}
                    className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs font-semibold focus:border-[#22C55E] focus:outline-none"
                  >
                    <option value="IIT-JEE">IIT-JEE</option>
                    <option value="NEET">NEET</option>
                    <option value="CBSE Boards">CBSE Boards</option>
                    <option value="UPSC">UPSC</option>
                  </select>
                </div>
              </>
            )}

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
              <input
                type="email"
                required
                maxLength={160}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email Address"
                className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] py-2.5 pl-9 pr-3 text-xs sm:text-sm focus:border-[#22C55E] focus:outline-none"
              />
            </div>

            {mode !== 'reset' && (
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password (min 6 characters)"
                  className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] py-2.5 pl-9 pr-3 text-xs sm:text-sm focus:border-[#22C55E] focus:outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] py-2.5 text-xs sm:text-sm font-bold text-white shadow-md transition disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === 'reset' ? (
                <KeyRound className="h-4 w-4" />
              ) : null}
              <span>
                {mode === 'login'
                  ? 'Sign In to Study Cloud'
                  : mode === 'signup'
                  ? 'Create Student Account'
                  : 'Send Password Reset Email'}
              </span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
