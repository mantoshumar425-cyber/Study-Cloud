import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  Film,
  FolderDown,
  Headphones,
  Loader2,
  Play,
  RotateCcw,
  Share2,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import {
  cancelLectureDownload,
  clearFinishedDownloads,
  closeLectureDownloadModal,
  DownloadSaveTarget,
  formatBytes,
  openDownloadsTab,
  openLectureDownloadModal,
  playOfflineById,
  retryLectureDownload,
  saveJobToGallery,
  setDownloadQueueOpen,
  setDownloadSaveTarget,
  startLectureDownload,
  useLectureDownloads,
} from '../services/lectureDownloadManager';
import { canShareMediaFiles, isMobileIosBrowser } from '../services/offlineLectureDb';

function formatDurationLabel(secs: number): string {
  if (!secs || secs <= 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)} min`;
}

const SAVE_MODES: Array<{
  id: DownloadSaveTarget;
  label: string;
  desc: string;
}> = [
  { id: 'both', label: 'App + Gallery', desc: 'Dono jagah save' },
  { id: 'app', label: 'Sirf App Mein', desc: 'In-App Offline' },
  { id: 'gallery', label: 'Direct Gallery', desc: 'Phone / Downloads' },
];

export const LectureDownloadCenter: React.FC = () => {
  const {
    target,
    inspecting,
    inspectError,
    isYoutubeNotice,
    youtubeUrl,
    durationSecs,
    options,
    jobs,
    queueOpen,
    saveTarget,
  } = useLectureDownloads();

  const activeJobs = jobs.filter(
    (j) => j.status === 'downloading' || j.status === 'preparing' || j.status === 'finalizing'
  );
  const activeCount = activeJobs.length;
  const topActive = activeJobs[0];

  return (
    <>
      {/* 1. Quality Picker Modal */}
      {target && (
        <div
          onClick={closeLectureDownloadModal}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-primary)] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-[var(--card-border)] bg-[var(--bg-secondary)] px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-indigo-400">
                  <Download className="h-3.5 w-3.5" />
                  <span>Download Lecture</span>
                  {durationSecs > 0 && (
                    <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
                      {formatDurationLabel(durationSecs)}
                    </span>
                  )}
                </div>
                <h3 className="mt-1 font-['Sora'] text-sm sm:text-base font-extrabold line-clamp-2">
                  {target.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeLectureDownloadModal}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-3.5">
              {/* Save Destination Selector */}
              {!isYoutubeNotice && !inspectError && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Kahan Save Karna Hai?
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-1">
                    {SAVE_MODES.map((m) => {
                      const active = saveTarget === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setDownloadSaveTarget(m.id)}
                          className={`rounded-xl px-2 py-2 text-center transition ${
                            active
                              ? 'bg-[var(--primary-color)] text-white shadow-sm'
                              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <div className="text-[11px] font-extrabold leading-tight">{m.label}</div>
                          <div
                            className={`text-[10px] mt-0.5 ${
                              active ? 'text-white/85' : 'text-[var(--text-secondary)]'
                            }`}
                          >
                            {m.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {inspecting ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[var(--primary-color)]" />
                  <div>
                    <p className="text-sm font-bold">Fetching video qualities...</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      Checking 360p / 480p / 720p / 1080p & Audio formats
                    </p>
                  </div>
                </div>
              ) : isYoutubeNotice ? (
                <div className="space-y-4 py-2 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/15 text-red-400">
                    <ExternalLink className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-['Sora'] text-sm font-bold">YouTube Stream Lecture</h4>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      Yeh lecture YouTube par hosted hai. Isse seedha app ke Video Player me dekhein ya
                      YouTube par kholein.
                    </p>
                  </div>
                  {youtubeUrl && (
                    <a
                      href={youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-500 transition"
                    >
                      <ExternalLink className="h-4 w-4" />
                      <span>Open on YouTube</span>
                    </a>
                  )}
                </div>
              ) : inspectError ? (
                <div className="space-y-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-center">
                  <AlertCircle className="h-7 w-7 mx-auto text-red-400" />
                  <p className="text-xs sm:text-sm text-red-300">{inspectError}</p>
                  <button
                    type="button"
                    onClick={() => openLectureDownloadModal(target)}
                    className="rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs font-bold text-white"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-xs font-semibold text-[var(--text-secondary)]">
                    Select quality ({saveTarget === 'both' ? 'Saves in App + Phone Gallery' : saveTarget === 'app' ? 'Saves inside App Offline Vault' : 'Saves directly to Phone Gallery'}):
                  </p>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {options.map((opt) => {
                      const isAudio = opt.format === 'm4a';
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => startLectureDownload(opt)}
                          className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-3 text-left transition hover:border-[var(--primary-color)] hover:bg-[var(--bg-tertiary)]"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                isAudio
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-indigo-500/15 text-indigo-400'
                              }`}
                            >
                              {isAudio ? (
                                <Headphones className="h-5 w-5" />
                              ) : (
                                <Film className="h-5 w-5" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-extrabold text-[var(--text-primary)] group-hover:text-[var(--primary-color)] transition">
                                {opt.label}
                              </div>
                              <div className="text-xs text-[var(--text-secondary)] truncate">
                                {opt.subLabel}
                              </div>
                            </div>
                          </div>
                          <span className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-3 py-1.5 text-xs font-bold text-white">
                            <Download className="h-3.5 w-3.5" />
                            <span>Start</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Floating Download Queue Pill + Expanded Drawer */}
      {jobs.length > 0 && (
        <div className="fixed bottom-20 sm:bottom-5 right-3 sm:right-5 z-[75] flex flex-col items-end gap-2 max-w-[calc(100vw-24px)]">
          {queueOpen && (
            <div className="w-80 sm:w-96 overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-primary)] shadow-2xl">
              <div className="flex items-center justify-between border-b border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-3">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-extrabold">
                  <Download className="h-4 w-4 text-[var(--primary-color)]" />
                  <span>Downloads ({jobs.length})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={openDownloadsTab}
                    className="flex items-center gap-1 rounded-lg bg-[var(--primary-color)]/15 px-2 py-1 text-[11px] font-bold text-[var(--primary-color)] hover:bg-[var(--primary-color)] hover:text-white transition"
                  >
                    <FolderDown className="h-3 w-3" />
                    <span>Vault</span>
                  </button>
                  {jobs.some((j) => j.status === 'ready' || j.status === 'error') && (
                    <button
                      type="button"
                      onClick={clearFinishedDownloads}
                      className="rounded-lg px-2 py-1 text-[11px] font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDownloadQueueOpen(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    title="Minimize"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto p-3 space-y-2.5">
                {jobs.map((job) => {
                  const isRunning =
                    job.status === 'preparing' ||
                    job.status === 'downloading' ||
                    job.status === 'finalizing';
                  return (
                    <div
                      key={job.id}
                      className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-indigo-400">
                              {job.qualityLabel}
                            </span>
                            <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                              {job.downloadedBytes > 0 ? formatBytes(job.downloadedBytes) : job.format.toUpperCase()}
                            </span>
                            {job.savedInApp && (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                                In App
                              </span>
                            )}
                          </div>
                          <h5 className="mt-1 text-xs font-bold text-[var(--text-primary)] line-clamp-1">
                            {job.title}
                          </h5>
                        </div>

                        <button
                          type="button"
                          onClick={() => cancelLectureDownload(job.id)}
                          className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-red-500/15 hover:text-red-400 transition"
                          title={isRunning ? 'Cancel download' : 'Remove from list'}
                        >
                          {isRunning ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>

                      {isRunning ? (
                        <div className="space-y-1">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300"
                              style={{ width: `${Math.max(4, job.percent)}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                            <span>
                              {job.status === 'finalizing'
                                ? 'Saving in App & Gallery...'
                                : 'Downloading segments...'}
                            </span>
                            <span className="font-mono font-bold text-[var(--text-primary)]">
                              {job.percent}%
                            </span>
                          </div>
                        </div>
                      ) : job.status === 'ready' ? (
                        <div className="space-y-1.5 pt-0.5">
                          {job.inAppWarning && (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-300">
                              {job.inAppWarning}
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>{job.savedInApp ? 'Saved in App!' : 'Ready to Save!'}</span>
                            </span>
                            <div className="flex items-center gap-1.5">
                              {job.offlineId && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    playOfflineById({
                                      id: job.offlineId!,
                                      title: job.title,
                                      batchName: job.batchName,
                                      subjectName: job.subjectName,
                                      qualityLabel: job.qualityLabel,
                                      format: job.format,
                                      fileName: job.fileName,
                                      sizeBytes: job.downloadedBytes,
                                      durationSecs: job.totalDurationSecs,
                                      thumbnail: job.thumbnail,
                                      savedAt: Date.now(),
                                      mimeType: job.format === 'm4a' ? 'audio/mp4' : 'video/mp4',
                                    })
                                  }
                                  className="sc-play-btn !rounded-lg !px-2.5 !py-1 text-[11px]"
                                >
                                  <Play className="h-3 w-3 fill-current" />
                                  <span>Play</span>
                                </button>
                              )}
                              {job.galleryBlobUrl && !isMobileIosBrowser() ? (
                                <a
                                  href={job.galleryBlobUrl}
                                  download={job.fileName}
                                  className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 transition"
                                  title="Save directly to Phone Gallery / Downloads"
                                >
                                  <Smartphone className="h-3 w-3" />
                                  <span>Gallery</span>
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  disabled={Boolean(job.savingToGallery)}
                                  onClick={() => void saveJobToGallery(job.id)}
                                  className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-60 transition"
                                  title="Save directly to Phone Gallery / Downloads"
                                >
                                  {job.savingToGallery ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Smartphone className="h-3 w-3" />
                                  )}
                                  <span>{job.savingToGallery ? 'Saving...' : 'Gallery'}</span>
                                </button>
                              )}
                              {canShareMediaFiles() && (
                                <button
                                  type="button"
                                  onClick={() => void saveJobToGallery(job.id, true)}
                                  className="flex h-6 w-6 items-center justify-center rounded-lg border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
                                  title="Share / Save Video to Photos"
                                >
                                  <Share2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <span className="text-[11px] text-red-400 font-medium line-clamp-2">
                            {job.error || 'Download failed'}
                          </span>
                          {(job.retryTarget || job.retryOption) && (
                            <button
                              type="button"
                              onClick={() => void retryLectureDownload(job.id)}
                              className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--primary-color)] px-2.5 py-1 text-[11px] font-bold text-white hover:opacity-90 transition"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Retry</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Compact Pill Trigger */}
          <button
            type="button"
            onClick={() => setDownloadQueueOpen(!queueOpen)}
            className="flex items-center gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2.5 text-xs font-extrabold text-[var(--text-primary)] shadow-xl hover:border-[var(--primary-color)] transition"
          >
            {activeCount > 0 ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[var(--primary-color)]" />
                <span>
                  Downloading {topActive ? `${topActive.percent}%` : ''} ({activeCount})
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Downloads ({jobs.length})</span>
              </>
            )}
          </button>
        </div>
      )}
    </>
  );
};
