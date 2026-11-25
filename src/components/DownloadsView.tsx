import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Film,
  FolderDown,
  HardDrive,
  Headphones,
  Loader2,
  Play,
  Search,
  Share2,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import {
  cancelLectureDownload,
  formatBytes,
  useLectureDownloads,
} from '../services/lectureDownloadManager';
import {
  canShareMediaFiles,
  clearAllOfflineLectures,
  deleteOfflineLecture,
  exportMediaToDeviceGallery,
  getOfflineLectureRecord,
  listOfflineLectureMeta,
  OfflineLectureMeta,
  subscribeOfflineVault,
} from '../services/offlineLectureDb';

interface DownloadsViewProps {
  onPlayOffline: (item: OfflineLectureMeta) => void;
  onBrowseBatches: () => void;
}

function formatDuration(secs: number): string {
  if (!secs || secs <= 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)} min`;
}

function formatSavedDate(ts: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({
  onPlayOffline,
  onBrowseBatches,
}) => {
  const { jobs } = useLectureDownloads();
  const [savedItems, setSavedItems] = useState<OfflineLectureMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<'all' | 'mp4' | 'm4a'>('all');
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportFeedbackId, setExportFeedbackId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const loadSaved = async () => {
    const list = await listOfflineLectureMeta();
    setSavedItems(list);
    setLoading(false);
  };

  useEffect(() => {
    loadSaved();
    return subscribeOfflineVault(() => {
      void loadSaved();
    });
  }, []);

  const activeJobs = useMemo(
    () =>
      jobs.filter(
        (j) => j.status === 'preparing' || j.status === 'downloading' || j.status === 'finalizing'
      ),
    [jobs]
  );

  const totalBytes = useMemo(
    () => savedItems.reduce((acc, item) => acc + (item.sizeBytes || 0), 0),
    [savedItems]
  );

  const filteredItems = useMemo(() => {
    return savedItems.filter((item) => {
      if (formatFilter !== 'all' && item.format !== formatFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${item.title} ${item.batchName || ''} ${item.subjectName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [savedItems, formatFilter, searchQuery]);

  const handleSaveToGallery = async (item: OfflineLectureMeta, forceShareSheet = false) => {
    setExportingId(item.id);
    try {
      const rec = await getOfflineLectureRecord(item.id);
      if (rec?.blob) {
        await exportMediaToDeviceGallery({
          blob: rec.blob,
          fileName: rec.fileName,
          mimeType: rec.mimeType,
          title: rec.title,
          forceShareSheet,
        });
        setExportFeedbackId(item.id);
        window.setTimeout(() => {
          setExportFeedbackId((curr) => (curr === item.id ? null : curr));
        }, 2500);
      }
    } finally {
      setExportingId(null);
    }
  };

  const shareSupported = canShareMediaFiles();

  return (
    <div className="space-y-5">
      {/* Header Card */}
      <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-400">
              <FolderDown className="h-4 w-4" />
              <span>App Offline Vault · No Internet Needed</span>
            </div>
            <h1 className="font-['Sora'] text-xl sm:text-2xl font-extrabold text-[var(--text-primary)]">
              My Offline Downloads
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
              Yahan saare downloaded lectures seedha app ke andar save rehte hain — kabhi bhi offline chalayein ya 1 tap mein Phone Gallery mein save karein.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3.5 py-2.5">
              <HardDrive className="h-4 w-4 text-[var(--primary-color)]" />
              <div className="text-left">
                <div className="text-[11px] text-[var(--text-secondary)] font-semibold">Saved Storage</div>
                <div className="font-mono text-xs sm:text-sm font-extrabold text-[var(--text-primary)]">
                  {savedItems.length} files · {formatBytes(totalBytes)}
                </div>
              </div>
            </div>

            {savedItems.length > 0 && (
              confirmClearAll ? (
                <div className="flex items-center gap-1.5 rounded-2xl border border-red-500/40 bg-red-500/10 p-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      await clearAllOfflineLectures();
                      setConfirmClearAll(false);
                    }}
                    className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 transition"
                  >
                    Confirm Delete All
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="rounded-xl px-2.5 py-1.5 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="flex items-center gap-1.5 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3.5 py-2.5 text-xs font-bold text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Clear Vault</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Search + Format Filter */}
        {savedItems.length > 0 && (
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search downloaded lectures, batches, subjects..."
                className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] py-2.5 pl-10 pr-4 text-xs sm:text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-1">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'mp4', label: 'Video MP4' },
                  { id: 'm4a', label: 'Audio M4A' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFormatFilter(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    formatFilter === tab.id
                      ? 'bg-[var(--primary-color)] text-white shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Live Active Downloads Section */}
      {activeJobs.length > 0 && (
        <div className="rounded-3xl border border-indigo-500/30 bg-[var(--card-bg)] p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-indigo-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Downloading Right Now ({activeJobs.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeJobs.map((job) => (
              <div
                key={job.id}
                className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 font-extrabold text-indigo-400">
                        {job.qualityLabel}
                      </span>
                      <span className="font-mono text-[var(--text-secondary)]">
                        {formatBytes(job.downloadedBytes)}
                      </span>
                    </div>
                    <h4 className="mt-1 text-xs sm:text-sm font-bold text-[var(--text-primary)] line-clamp-1">
                      {job.title}
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => cancelLectureDownload(job.id)}
                    className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-red-500/15 hover:text-red-400 transition"
                    title="Cancel download"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300"
                      style={{ width: `${Math.max(4, job.percent)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                    <span>
                      {job.status === 'finalizing'
                        ? 'Saving to app vault...'
                        : 'Downloading segments...'}
                    </span>
                    <span className="font-mono font-bold text-[var(--text-primary)]">
                      {job.percent}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saved Offline Lectures List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--primary-color)]" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--card-border)] bg-[var(--bg-secondary)]/50 p-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--primary-color)]/15 text-[var(--primary-color)] mb-3">
            <Download className="h-7 w-7" />
          </div>
          <h3 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)]">
            {savedItems.length === 0
              ? 'Abhi Koi Offline Lecture Saved Nahi Hai'
              : 'No matching downloaded lectures'}
          </h3>
          <p className="mt-1.5 max-w-md text-xs sm:text-sm text-[var(--text-secondary)]">
            {savedItems.length === 0
              ? 'Kisi bhi Batch, Khazana ya Pi OTT lecture ke Download button par click karein — wo seedha yahan App mein save ho jayega aur saath mein Phone Gallery mein bhi jayega!'
              : 'Search filter reset karke saare saved lectures dekhein.'}
          </p>
          {savedItems.length === 0 ? (
            <button
              type="button"
              onClick={onBrowseBatches}
              className="mt-4 rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm hover:opacity-90 transition"
            >
              Browse Batches & Lectures
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setFormatFilter('all');
              }}
              className="mt-4 rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm hover:opacity-90 transition"
            >
              Show All Downloads
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const isAudio = item.format === 'm4a';
            const isExporting = exportingId === item.id;
            const justExported = exportFeedbackId === item.id;

            return (
              <div
                key={item.id}
                className="group flex flex-col overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-sm transition hover:border-[var(--primary-color)]/60"
              >
                {/* Thumbnail / Cover */}
                <div
                  onClick={() => onPlayOffline(item)}
                  className="relative aspect-video w-full cursor-pointer overflow-hidden bg-slate-900"
                >
                  {item.thumbnail && !isAudio ? (
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
                      {isAudio ? (
                        <Headphones className="h-12 w-12 text-emerald-400" />
                      ) : (
                        <Film className="h-12 w-12 text-indigo-400" />
                      )}
                    </div>
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                  {/* Play overlay */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="sc-play-orb h-13 w-13">
                      <Play className="h-5 w-5 fill-current ml-0.5" />
                    </div>
                  </div>

                  {/* Top Badges */}
                  <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2">
                    <span className="rounded-lg bg-black/70 px-2 py-0.5 text-[11px] font-extrabold text-emerald-300 backdrop-blur-sm">
                      {item.qualityLabel} · {item.format.toUpperCase()}
                    </span>
                    <span className="rounded-lg bg-black/70 px-2 py-0.5 font-mono text-[11px] font-bold text-white backdrop-blur-sm">
                      {formatBytes(item.sizeBytes)}
                    </span>
                  </div>

                  {/* Bottom Duration */}
                  {item.durationSecs > 0 && (
                    <div className="absolute bottom-2.5 right-2.5 rounded-lg bg-black/75 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                      {formatDuration(item.durationSecs)}
                    </div>
                  )}
                </div>

                {/* Info & Actions */}
                <div className="flex flex-1 flex-col justify-between p-4 space-y-3">
                  <div className="space-y-1">
                    {(item.batchName || item.subjectName) && (
                      <div className="text-[11px] font-bold text-[var(--primary-color)] truncate">
                        {[item.batchName, item.subjectName].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    <h3
                      onClick={() => onPlayOffline(item)}
                      className="cursor-pointer font-['Sora'] text-sm font-extrabold text-[var(--text-primary)] line-clamp-2 hover:text-[var(--primary-color)] transition"
                    >
                      {item.title}
                    </h3>
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      Saved offline · {formatSavedDate(item.savedAt)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onPlayOffline(item)}
                      className="sc-play-btn flex-1 justify-center px-3 py-2 text-xs"
                    >
                      <span className="sc-play-btn-badge h-5 w-5">
                        <Play className="h-3 w-3 fill-current ml-0.5" />
                      </span>
                      <span>Play Offline</span>
                    </button>

                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={() => handleSaveToGallery(item, false)}
                      className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                        justExported
                          ? 'border-emerald-500/40 bg-emerald-600 text-white'
                          : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-600 hover:text-white'
                      }`}
                      title="Save MP4 directly to Phone Gallery / Downloads"
                    >
                      {isExporting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : justExported ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Smartphone className="h-3.5 w-3.5" />
                      )}
                      <span>{justExported ? 'Saved!' : 'Gallery'}</span>
                    </button>

                    {shareSupported && (
                      <button
                        type="button"
                        disabled={isExporting}
                        onClick={() => handleSaveToGallery(item, true)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--primary-color)] hover:text-[var(--text-primary)] transition"
                        title="Share / Save Video to Photos"
                      >
                        <Share2 className="h-4 w-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => deleteOfflineLecture(item.id)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-red-500/40 hover:bg-red-500/15 hover:text-red-400 transition"
                      title="Delete from offline storage"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
