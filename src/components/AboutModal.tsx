import React from 'react';
import { X, Compass, Flame, Trophy, PlayCircle } from 'lucide-react';

import { STUDY_CLOUD_LOGO } from './Sidebar';

interface AboutModalProps {
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-sm rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-center shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-xl p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mx-auto mb-3.5 flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl shadow-xl ring-1 ring-white/15">
          <img
            src={STUDY_CLOUD_LOGO}
            alt="Study Cloud Logo"
            className="h-full w-full object-cover scale-[1.04]"
          />
        </div>

        <h3 className="font-['Sora'] text-xl font-extrabold text-[var(--text-primary)]">
          Study Cloud
        </h3>
        <p className="mt-1 text-xs font-semibold text-[var(--primary-color)]">
          Learn · Practice · Grow
        </p>

        <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          Distraction-free lecture player with Khazana archive, CBT practice tests, Pi study
          sandbox, Community lounge, Study Cloud AI, and daily learning streak tracking.
        </p>

        <div className="mt-5 space-y-2 text-left text-xs">
          <div className="flex items-center gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3">
            <PlayCircle className="h-4 w-4 shrink-0 text-indigo-400" />
            <span className="text-[var(--text-primary)] font-medium">
              Direct HD lecture & audio-only playback
            </span>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3">
            <Compass className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="text-[var(--text-primary)] font-medium">
              Stage-by-stage Batch Adventure paths
            </span>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3">
            <Flame className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="text-[var(--text-primary)] font-medium">
              Daily study streak & XP rank progression
            </span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary-color)] py-2.5 text-xs font-bold text-white shadow-md hover:opacity-90 transition"
        >
          <Trophy className="h-4 w-4" />
          <span>Continue Studying</span>
        </button>
      </div>
    </div>
  );
};
