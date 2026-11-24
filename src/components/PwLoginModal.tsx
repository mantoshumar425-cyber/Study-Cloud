import React, { useState } from 'react';
import { X, Smartphone, KeyRound, Loader2, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
import { sendPwOtp, verifyPwOtp } from '../services/batchService';

interface PwLoginModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export const PwLoginModal: React.FC<PwLoginModalProps> = ({ onClose, onSuccess }) => {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }
    setLoading(true);
    try {
      const res = await sendPwOtp(digits);
      setInfoMsg(res.message || 'OTP sent to your mobile number.');
      setStep('otp');
    } catch (err: any) {
      setError(err?.message || 'Could not send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!otp.trim()) {
      setError('Please enter the OTP received on your phone.');
      return;
    }
    setLoading(true);
    try {
      await verifyPwOtp(phone.replace(/\D/g, ''), otp.trim());
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Invalid or expired OTP.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-md rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-xl p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-color)]/15 text-[var(--primary-color)]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-['Sora'] text-base font-bold text-[var(--text-primary)]">
              Sign in with Physics Wallah
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Direct PenPencil OTP login for chapters, notes &amp; lectures
            </p>
          </div>
        </div>

        {step === 'phone' ? (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                Registered Mobile Number (+91)
              </label>
              <div className="relative">
                <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="10-digit mobile number"
                  maxLength={13}
                  className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] py-2.5 pl-10 pr-3.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs font-bold text-white shadow-md hover:opacity-90 disabled:opacity-60 transition"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>{loading ? 'Sending OTP...' : 'Send OTP'}</span>
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            {infoMsg && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{infoMsg}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                Enter OTP sent to +91 {phone.replace(/\D/g, '').slice(-10)}
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="Enter 6-digit OTP"
                  maxLength={8}
                  className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] py-2.5 pl-10 pr-3.5 text-sm font-mono tracking-widest text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setOtp('');
                  setError(null);
                }}
                className="text-xs font-semibold text-[var(--primary-color)] hover:underline"
              >
                Change number
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs font-bold text-white shadow-md hover:opacity-90 disabled:opacity-60 transition"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span>{loading ? 'Verifying...' : 'Verify & Connect'}</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
