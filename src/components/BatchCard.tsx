import React, { useRef, useState } from 'react';
import { Heart, Play, BookOpen, GraduationCap } from 'lucide-react';
import { BatchItem } from '../types';
import { prefetchBatch } from '../services/batchService';

interface BatchCardProps {
  batch: BatchItem;
  isFavorite: boolean;
  onToggleFavorite: (batchId: string) => void;
  onSelect: (batch: BatchItem) => void;
  onQuickPlay?: (batch: BatchItem) => void;
}

export const BatchCard: React.FC<BatchCardProps> = ({
  batch,
  isFavorite,
  onToggleFavorite,
  onSelect,
  onQuickPlay,
}) => {
  const [imgError, setImgError] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);

  const schedulePrefetch = () => {
    if (hoverTimerRef.current) return;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      prefetchBatch(batch.batch_id);
    }, 120);
  };

  const cancelPrefetch = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite(batch.batch_id);
  };

  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onQuickPlay) {
      onQuickPlay(batch);
    } else {
      onSelect(batch);
    }
  };

  return (
    <div
      onClick={() => onSelect(batch)}
      onMouseEnter={schedulePrefetch}
      onMouseLeave={cancelPrefetch}
      onTouchStart={schedulePrefetch}
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-[var(--card-shadow)] transition-all duration-300 hover:-translate-y-1 hover:border-[var(--primary-color)]/70 hover:shadow-xl cursor-pointer"
    >
      {/* Banner / Thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden bg-slate-900/60">
        {!imgError && batch.photo ? (
          <img
            src={batch.photo}
            alt={batch.name}
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-indigo-950 via-slate-900 to-purple-950 p-4 text-center">
            <GraduationCap className="h-10 w-10 text-indigo-400 opacity-80 mb-1.5" />
            <span className="font-['Sora'] text-xs sm:text-sm font-bold text-slate-200 line-clamp-2">
              {batch.name}
            </span>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/25" />

        {/* Favorite Heart Button */}
        <button
          onClick={handleFavoriteClick}
          className={`absolute top-2.5 right-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-md transition-all active:scale-90 ${
            isFavorite
              ? 'bg-pink-600 text-white shadow-md shadow-pink-600/40'
              : 'bg-black/55 text-white hover:bg-black/75 hover:text-pink-400'
          }`}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart className={`h-4 w-4 ${isFavorite ? 'fill-white' : ''}`} />
        </button>

        {/* Exam & Class Strip */}
        {(batch.exam || batch.class) && (
          <div className="absolute top-2.5 left-2.5 rounded-lg bg-black/70 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-white backdrop-blur-md border border-white/10">
            {[batch.exam, batch.class ? `Class ${batch.class}` : ''].filter(Boolean).join(' · ')}
          </div>
        )}

        {/* Hover Signature Quick Play Orb */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <button
            onClick={handlePlayClick}
            className="sc-play-orb h-14 w-14"
            title="Start Lectures"
          >
            <Play className="h-6 w-6 fill-current ml-0.5" />
          </button>
        </div>

        {/* Language Tag */}
        {batch.language && (
          <div className="absolute bottom-2.5 left-2.5 rounded-md bg-[var(--primary-color)]/95 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-sm">
            {batch.language}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-['Sora'] text-sm sm:text-[15px] font-extrabold text-[var(--text-primary)] line-clamp-2 leading-snug group-hover:text-[var(--primary-color)] transition-colors">
          {batch.name}
        </h3>

        {batch.byName && (
          <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-1">
            {batch.byName}
          </p>
        )}

        <div className="mt-auto pt-3 flex items-center justify-between border-t border-[var(--card-border)] text-xs text-[var(--text-secondary)]">
          <div className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-[var(--primary-color)]" />
            <span className="font-semibold">{batch.isVidyapeeth ? 'Vidyapeeth' : 'Lectures + Notes'}</span>
          </div>
          {batch.amount !== undefined && (
            <span className="font-extrabold text-emerald-400">
              {batch.amount > 0 ? `₹${batch.amount}` : 'Free Access'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
