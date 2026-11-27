import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Film,
  FolderDown,
  HardDrive,
  Headphones,
  History,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Share2,
  Smartphone,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  cancelLectureDownload,
  formatBytes,
  openLectureDownloadModal,
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
import {
  clearDownloadHistory,
  deleteDownloadHistoryEntry,
  DownloadHistoryItem,
  listDownloadHistory,
  subscribeDownloadHistory,
} from '../services/downloadHistoryDb';

interface DownloadsViewProps {
  onPlayOffline: (item: OfflineLectureMeta) => void;
  onBrowseBatches: () => void;
}

type DownloadsTab = 'saved' | 'history' | 'deleted';
type HistoryStatusFilter = 'all' | 'downloaded' | 'deleted' | 'failed';

function formatDuration(secs: number): string {
  if (!secs || secs <= 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)} min`;
}

function formatSavedDate(ts?: number): string {
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
  const [activeView, setActiveView] = useState<DownloadsTab>('saved');
  const [savedItems, setSavedItems] = useState<OfflineLectureMeta[]>([]);
  const [historyItems, setHistoryItems] = useState<DownloadHistoryItem[]>(() =>
    listDownloadHistory()
  );
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<'all' | 'mp4' | 'm4a'>('all');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<HistoryStatusFilter>('all');
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportFeedbackId, setExportFeedbackId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const loadSaved = async () => {
    const list = await listOfflineLectureMeta();
    setSavedItems(list);
    setHistoryItems(listDownloadHistory());
    setLoading(false);
  };

  useEffect(() => {
    void loadSaved();
    const unsubVault = subscribeOfflineVault(() => {
      void loadSaved();
    });
    const unsubHistory = subscribeDownloadHistory(() => {
      setHistoryItems(listDownloadHistory());
    });
    return () => {
      unsubVault();
      unsubHistory();
    };
  }, []);

  const switchView = (tab: DownloadsTab) => {
    setActiveView(tab);
    setConfirmClearAll(false);
  };

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

  const savedMetaMap = useMemo(
    () => new Map(savedItems.map((item) => [item.id, item])),
    [savedItems]
  );

  const deletedHistoryItems = useMemo(
    () => historyItems.filter((item) => item.status === 'deleted'),
    [historyItems]
  );

  const filteredSavedItems = useMemo(() => {
    return savedItems.filter((item) => {
      if (formatFilter !== 'all' && item.format !== formatFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${item.title} ${item.batchName || ''} ${item.subjectName || ''} ${item.qualityLabel || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [savedItems, formatFilter, searchQuery]);

  const filteredHistoryItems = useMemo(() => {
    const source = activeView === 'deleted' ? deletedHistoryItems : historyItems;
    return source.filter((item) => {
      if (activeView === 'history' && historyStatusFilter !== 'all') {
        if (historyStatusFilter === 'failed') {
          if (item.status !== 'failed' && item.status !== 'cancelled') return false;
        } else if (item.status !== historyStatusFilter) {
          return false;
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${item.title} ${item.batchName || ''} ${item.subjectName || ''} ${item.qualityLabel || ''} ${item.fileName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeView, historyItems, deletedHistoryItems, historyStatusFilter, searchQuery]);

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

  const handleConfirmClear = async () => {
    if (activeView === 'saved') {
      await clearAllOfflineLectures();
    } else if (activeView === 'deleted') {
      clearDownloadHistory('deleted');
    } else {
      clearDownloadHistory('all');
    }
    setConfirmClearAll(false);
  };

  const canClearCurrentView =
    (activeView === 'saved' && savedItems.length > 0) ||
    (activeView === 'history' && historyItems.length > 0) ||
    (activeView === 'deleted' && deletedHistoryItems.length > 0);

  const clearButtonLabel =
    activeView === 'saved'
      ? 'Clear Vault'
      : activeView === 'deleted'
        ? 'Clear Deleted'
        : 'Clear History';

  const confirmClearLabel =
    activeView === 'saved'
      ? 'Confirm Delete All'
      : activeView === 'deleted'
        ? 'Confirm Clear Deleted'
        : 'Confirm Clear History';

  const shareSupported = canShareMediaFiles();

  const renderStatusBadge = (item: DownloadHistoryItem) => {
    switch (item.status) {
      case 'downloaded':
        return (
          <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            <span>Downloaded</span>
          </span>
        );
      case 'deleted':
        return (
          <span className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-extrabold text-red-400">
            <Trash2 className="h-3 w-3" />
            <span>Deleted</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-extrabold text-amber-400">
            <XCircle className="h-3 w-3" />
            <span>Cancelled</span>
          </span>
        );
      case 'failed':
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[10px] font-extrabold text-rose-400">
            <AlertCircle className="h-3 w-3" />
            <span>Failed</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Card */}
      <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-400">
              <FolderDown className="h-4 w-4" />
              <span>App Offline Vault · Download & Delete History</span>
            </div>
            <h1 className="font-['Sora'] text-xl sm:text-2xl font-extrabold text-[var(--text-primary)]">
              My Offline Downloads
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
              Downloaded lectures app mein save rehte hain, aur har download ya delete kiya gaya lecture history mein track hota hai.
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

            {canClearCurrentView && (
              confirmClearAll ? (
                <div className="flex items-center gap-1.5 rounded-2xl border border-red-500/40 bg-red-500/10 p-1.5">
                  <button
                    type="button"
                    onClick={() => void handleConfirmClear()}
                    className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 transition"
                  >
                    {confirmClearLabel}
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
                  <span>{clearButtonLabel}</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--card-border)] pt-4">
          <button
            type="button"
            onClick={() => switchView('saved')}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
              activeView === 'saved'
                ? 'bg-[var(--primary-color)] text-white shadow-sm'
                : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <FolderDown className="h-3.5 w-3.5" />
            <span>Saved Offline</span>
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                activeView === 'saved' ? 'bg-white/20 text-white' : 'bg-white/10 text-[var(--text-primary)]'
              }`}
            >
              {savedItems.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => switchView('history')}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
              activeView === 'history'
                ? 'bg-[var(--primary-color)] text-white shadow-sm'
                : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>Download History</span>
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                activeView === 'history' ? 'bg-white/20 text-white' : 'bg-white/10 text-[var(--text-primary)]'
              }`}
            >
              {historyItems.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => switchView('deleted')}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
              activeView === 'deleted'
                ? 'bg-red-600 text-white shadow-sm'
                : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-red-400'
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Deleted History</span>
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                activeView === 'deleted' ? 'bg-white/20 text-white' : 'bg-red-500/15 text-red-400'
              }`}
            >
              {deletedHistoryItems.length}
            </span>
          </button>
        </div>

        {/* Search + Sub-Filters */}
        {((activeView === 'saved' && savedItems.length > 0) ||
          (activeView === 'history' && historyItems.length > 0) ||
          (activeView === 'deleted' && deletedHistoryItems.length > 0)) && (
          <div className="mt-3 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search lectures, batches, subjects..."
                className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] py-2.5 pl-10 pr-4 text-xs sm:text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:outline-none"
              />
            </div>

            {activeView === 'saved' ? (
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
            ) : activeView === 'history' ? (
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-1">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'downloaded', label: 'Downloaded' },
                    { id: 'deleted', label: 'Deleted' },
                    { id: 'failed', label: 'Failed' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setHistoryStatusFilter(tab.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      historyStatusFilter === tab.id
                        ? 'bg-[var(--primary-color)] text-white shadow-sm'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            ) : null}
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

      {/* VIEW 1: SAVED OFFLINE VAULT */}
      {activeView === 'saved' ? (
        loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--primary-color)]" />
          </div>
        ) : filteredSavedItems.length === 0 ? (
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
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={onBrowseBatches}
                  className="rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm hover:opacity-90 transition"
                >
                  Browse Batches & Lectures
                </button>
                {historyItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => switchView('history')}
                    className="flex items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2.5 text-xs sm:text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
                  >
                    <History className="h-4 w-4 text-[var(--primary-color)]" />
                    <span>View History ({historyItems.length})</span>
                  </button>
                )}
              </div>
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
            {filteredSavedItems.map((item) => {
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
                        onClick={() => void deleteOfflineLecture(item.id)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-red-500/40 hover:bg-red-500/15 hover:text-red-400 transition"
                        title="Delete offline video (moves to Deleted History)"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : filteredHistoryItems.length === 0 ? (
        /* VIEW 2 & 3 EMPTY STATE: DOWNLOAD HISTORY / DELETED HISTORY */
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--card-border)] bg-[var(--bg-secondary)]/50 p-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--primary-color)]/15 text-[var(--primary-color)] mb-3">
            {activeView === 'deleted' ? (
              <Trash2 className="h-7 w-7 text-red-400" />
            ) : (
              <Clock className="h-7 w-7" />
            )}
          </div>
          <h3 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)]">
            {activeView === 'deleted'
              ? deletedHistoryItems.length === 0
                ? 'Koi Deleted Lecture History Nahi Hai'
                : 'No matching deleted lectures'
              : historyItems.length === 0
                ? 'Abhi Koi Download History Nahi Hai'
                : 'No matching history records'}
          </h3>
          <p className="mt-1.5 max-w-md text-xs sm:text-sm text-[var(--text-secondary)]">
            {activeView === 'deleted'
              ? 'Jab aap koi offline downloaded lecture delete karte hain, uska record yahan Deleted History mein dikhega jisse aap jab chahein re-download ya history se delete kar sakte hain.'
              : 'Har downloaded, deleted, failed ya cancelled lecture ka complete record yahan save rahega.'}
          </p>
          {(searchQuery.trim() || historyStatusFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setHistoryStatusFilter('all');
              }}
              className="mt-4 rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm hover:opacity-90 transition"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        /* VIEW 2 & 3 LIST: DOWNLOAD HISTORY / DELETED HISTORY */
        <div className="space-y-2.5">
          {filteredHistoryItems.map((item) => {
            const isAudio = item.format === 'm4a';
            const savedOfflineMeta = savedMetaMap.get(item.id);
            const primaryDate = item.deletedAt
              ? `Deleted ${formatSavedDate(item.deletedAt)}`
              : item.completedAt
                ? `Downloaded ${formatSavedDate(item.completedAt)}`
                : `Started ${formatSavedDate(item.startedAt)}`;

            return (
              <div
                key={item.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3.5 sm:p-4 shadow-sm transition hover:border-[var(--primary-color)]/45"
              >
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  {/* Thumbnail */}
                  <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-xl bg-slate-900 border border-[var(--card-border)]">
                    {item.thumbnail && !isAudio ? (
                      <img
                        src={item.thumbnail}
                        alt={item.title}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 via-emerald-950/60 to-slate-900">
                        {isAudio ? (
                          <Headphones className="h-6 w-6 text-emerald-400" />
                        ) : (
                          <Film className="h-6 w-6 text-emerald-400" />
                        )}
                      </div>
                    )}
                    {item.durationSecs > 0 && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                        {formatDuration(item.durationSecs)}
                      </span>
                    )}
                  </div>

                  {/* Metadata */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {renderStatusBadge(item)}
                      <span className="rounded-md bg-[var(--bg-secondary)] border border-[var(--card-border)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-primary)]">
                        {item.qualityLabel} · {item.format.toUpperCase()}
                      </span>
                      {item.sizeBytes > 0 && (
                        <span className="font-mono text-[11px] font-semibold text-[var(--text-secondary)]">
                          {formatBytes(item.sizeBytes)}
                        </span>
                      )}
                    </div>

                    <h3 className="font-['Sora'] text-xs sm:text-sm font-extrabold text-[var(--text-primary)] line-clamp-1">
                      {item.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-secondary)]">
                      {(item.batchName || item.subjectName) && (
                        <span className="font-semibold text-[var(--primary-color)] truncate max-w-[240px]">
                          {[item.batchName, item.subjectName].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      <span>{primaryDate}</span>
                      {item.deletedAt && item.completedAt && (
                        <span className="opacity-75">
                          · Downloaded {formatSavedDate(item.completedAt)}
                        </span>
                      )}
                    </div>

                    {item.error && item.status === 'failed' && (
                      <div className="text-[11px] font-medium text-rose-400 line-clamp-1">
                        {item.error}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 sm:shrink-0 self-end sm:self-center">
                  {savedOfflineMeta && (
                    <button
                      type="button"
                      onClick={() => onPlayOffline(savedOfflineMeta)}
                      className="sc-play-btn px-3 py-2 text-xs"
                    >
                      <span className="sc-play-btn-badge h-4 w-4">
                        <Play className="h-2.5 w-2.5 fill-current ml-0.5" />
                      </span>
                      <span>Play</span>
                    </button>
                  )}

                  {item.retryTarget && (
                    <button
                      type="button"
                      onClick={() =>
                        void openLectureDownloadModal({
                          ...item.retryTarget!,
                          resolvedStream: null,
                        })
                      }
                      className="flex items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-600 hover:text-white transition"
                      title="Re-download this lecture"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Re-download</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => deleteDownloadHistoryEntry(item.id)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-red-500/40 hover:bg-red-500/15 hover:text-red-400 transition"
                    title="Delete from history"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
