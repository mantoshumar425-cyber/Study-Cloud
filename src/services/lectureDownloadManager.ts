import { useEffect, useState } from 'react';
import { ResolvedStream } from '../types';
import { resolveVideoStream, safeReadJson } from './batchService';
import {
  exportMediaToDeviceGallery,
  getOfflineLectureRecord,
  OfflineLectureMeta,
  saveOfflineLecture,
} from './offlineLectureDb';
import {
  DownloadHistoryStatus,
  DownloadRetryTarget,
  upsertDownloadHistory,
} from './downloadHistoryDb';
import { downloadLectureInBrowser } from './clientLectureDownloader';

export type DownloadSaveTarget = 'both' | 'app' | 'gallery';

export interface LectureDownloadTarget {
  batchId: string;
  batchName?: string;
  programId?: string;
  subjectId: string;
  subjectName?: string;
  topicId: string;
  videoId: string;
  findKey?: string;
  videoDetailsId?: string;
  parentScheduleId?: string;
  typeId?: string;
  title: string;
  videoImg?: string;
  videoType?: string;
  playType?: string;
  rawVideoUrl?: string;
  isLive?: boolean;
  urlType?: string;
  resolvedStream?: ResolvedStream | null;
}

export interface LectureDownloadOption {
  id: string;
  label: string;
  subLabel: string;
  qualityTag: string;
  format: 'mp4' | 'm4a';
  url: string;
  estimatedMb?: number;
  isDirectMp4?: boolean;
}

export interface LectureDownloadJobState {
  id: string;
  title: string;
  batchName?: string;
  subjectName?: string;
  thumbnail?: string;
  qualityLabel: string;
  format: 'mp4' | 'm4a';
  fileName: string;
  status: 'preparing' | 'downloading' | 'finalizing' | 'ready' | 'error' | 'cancelled';
  percent: number;
  downloadedBytes: number;
  totalDurationSecs: number;
  processedSecs: number;
  error?: string | null;
  inAppWarning?: string | null;
  autoSaved?: boolean;
  saveTarget: DownloadSaveTarget;
  savedInApp?: boolean;
  offlineId?: string;
  galleryBlobUrl?: string;
  savingToGallery?: boolean;
  startedAt?: number;
  retryTarget?: LectureDownloadTarget;
  retryOption?: LectureDownloadOption;
}

function toRetryTarget(target?: LectureDownloadTarget | null): DownloadRetryTarget | undefined {
  if (!target) return undefined;
  const { resolvedStream: _rs, ...rest } = target;
  return rest;
}

function recordJobHistory(
  job: LectureDownloadJobState,
  status: DownloadHistoryStatus,
  overrides?: {
    sizeBytes?: number;
    durationSecs?: number;
    savedInApp?: boolean;
    error?: string | null;
    completedAt?: number;
  }
) {
  const now = Date.now();
  upsertDownloadHistory({
    id: job.id,
    title: job.title,
    batchName: job.batchName,
    subjectName: job.subjectName,
    thumbnail: job.thumbnail,
    qualityLabel: job.qualityLabel,
    format: job.format,
    fileName: job.fileName,
    sizeBytes: overrides?.sizeBytes ?? job.downloadedBytes ?? 0,
    durationSecs: overrides?.durationSecs ?? job.totalDurationSecs ?? 0,
    saveTarget: job.saveTarget,
    savedInApp: overrides?.savedInApp ?? job.savedInApp ?? false,
    status,
    error: overrides?.error !== undefined ? overrides.error : job.error,
    startedAt: job.startedAt || now,
    completedAt: overrides?.completedAt ?? (status === 'downloaded' ? now : undefined),
    updatedAt: now,
    retryTarget: toRetryTarget(job.retryTarget),
  });
}

interface ManagerState {
  target: LectureDownloadTarget | null;
  inspecting: boolean;
  inspectError: string | null;
  isYoutubeNotice: boolean;
  youtubeUrl?: string;
  durationSecs: number;
  options: LectureDownloadOption[];
  jobs: LectureDownloadJobState[];
  queueOpen: boolean;
  saveTarget: DownloadSaveTarget;
}

const SAVE_TARGET_KEY = 'sc_dl_save_target_v1';

function loadInitialSaveTarget(): DownloadSaveTarget {
  try {
    const raw = localStorage.getItem(SAVE_TARGET_KEY);
    if (raw === 'both' || raw === 'app' || raw === 'gallery') return raw;
  } catch {
    // ignore storage errors
  }
  return 'both';
}

let state: ManagerState = {
  target: null,
  inspecting: false,
  inspectError: null,
  isYoutubeNotice: false,
  youtubeUrl: undefined,
  durationSecs: 0,
  options: [],
  jobs: [],
  queueOpen: false,
  saveTarget: loadInitialSaveTarget(),
};

const listeners = new Set<() => void>();
const pollTimers = new Map<string, number>();
const finalizingJobs = new Set<string>();
const activeAbortControllers = new Map<string, AbortController>();
const transientJobBlobs = new Map<string, Blob>();
let navigateToDownloadsHandler: (() => void) | null = null;
let playOfflineHandler: ((meta: OfflineLectureMeta) => void) | null = null;

export function registerDownloadActionHandlers(handlers: {
  onOpenDownloadsTab?: () => void;
  onPlayOffline?: (meta: OfflineLectureMeta) => void;
}) {
  if (handlers.onOpenDownloadsTab) navigateToDownloadsHandler = handlers.onOpenDownloadsTab;
  if (handlers.onPlayOffline) playOfflineHandler = handlers.onPlayOffline;
}

export function openDownloadsTab(): void {
  setDownloadQueueOpen(false);
  navigateToDownloadsHandler?.();
}

export function playOfflineById(meta: OfflineLectureMeta): void {
  setDownloadQueueOpen(false);
  playOfflineHandler?.(meta);
}

function emit() {
  for (const fn of listeners) fn();
}

function setState(patch: Partial<ManagerState>) {
  state = { ...state, ...patch };
  emit();
}

export function setDownloadSaveTarget(target: DownloadSaveTarget): void {
  try {
    localStorage.setItem(SAVE_TARGET_KEY, target);
  } catch {
    // ignore
  }
  setState({ saveTarget: target });
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

const TRANSFER_CHUNK_BYTES = 6 * 1024 * 1024; // 6MB (< Cloud Run 32MB limit)

async function fetchChunkWithRetry(
  jobId: string,
  offset: number,
  length: number,
  attempts = 3
): Promise<{ buffer: Uint8Array<ArrayBuffer>; totalBytes: number }> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      const url = `/api/lecture-download/chunk/${encodeURIComponent(jobId)}?offset=${offset}&length=${length}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const totalBytes = Number(res.headers.get('X-Total-Bytes') || 0);
      const ab = await res.arrayBuffer();
      return { buffer: new Uint8Array(ab), totalBytes };
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 350 * (i + 1)));
      }
    }
  }
  throw lastErr || new Error('Chunk transfer failed');
}

async function fetchChunkedBlobFromServer(
  jobId: string,
  knownTotalBytes: number,
  mimeType: string,
  onProgress: (receivedBytes: number, totalBytes: number) => void
): Promise<Blob> {
  // Fetch first 6MB chunk to learn authoritative total byte size
  const first = await fetchChunkWithRetry(jobId, 0, TRANSFER_CHUNK_BYTES, 3);
  const totalBytes = first.totalBytes || knownTotalBytes || first.buffer.byteLength;

  if (first.buffer.byteLength >= totalBytes) {
    onProgress(first.buffer.byteLength, totalBytes);
    return new Blob([first.buffer], { type: mimeType });
  }

  const totalChunks = Math.ceil(totalBytes / TRANSFER_CHUNK_BYTES);
  const parts: Uint8Array<ArrayBuffer>[] = new Array(totalChunks);
  parts[0] = first.buffer;
  let received = first.buffer.byteLength;
  onProgress(received, totalBytes);

  let nextIdx = 1;
  const workerCount = Math.min(3, Math.max(1, totalChunks - 1));
  const worker = async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= totalChunks) return;
      const offset = idx * TRANSFER_CHUNK_BYTES;
      const chunkLen = Math.min(TRANSFER_CHUNK_BYTES, totalBytes - offset);
      const { buffer } = await fetchChunkWithRetry(jobId, offset, chunkLen, 3);
      parts[idx] = buffer;
      received += buffer.byteLength;
      onProgress(received, totalBytes);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const finalBlob = new Blob(parts, { type: mimeType });
  parts.length = 0;
  return finalBlob;
}

export async function saveJobToGallery(jobId: string, forceShareSheet = false): Promise<void> {
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) return;
  const fileName = job.fileName || 'lecture.mp4';
  const mimeType = job.format === 'm4a' ? 'audio/mp4' : 'video/mp4';

  if (job.offlineId) {
    const rec = await getOfflineLectureRecord(job.offlineId);
    if (rec?.blob) {
      let galleryBlobUrl = job.galleryBlobUrl;
      if (!galleryBlobUrl) {
        galleryBlobUrl = URL.createObjectURL(rec.blob);
        setState({
          jobs: state.jobs.map((j) =>
            j.id === jobId ? { ...j, galleryBlobUrl, inAppWarning: null } : j
          ),
        });
      }
      await exportMediaToDeviceGallery({
        blob: rec.blob,
        blobUrl: galleryBlobUrl,
        fileName: rec.fileName,
        mimeType: rec.mimeType,
        title: rec.title,
        forceShareSheet,
      });
      return;
    }
  }

  const transientBlob = transientJobBlobs.get(jobId);
  if (transientBlob) {
    const galleryBlobUrl = job.galleryBlobUrl || URL.createObjectURL(transientBlob);
    if (!job.galleryBlobUrl) {
      setState({
        jobs: state.jobs.map((j) =>
          j.id === jobId ? { ...j, galleryBlobUrl, inAppWarning: null } : j
        ),
      });
    }
    await exportMediaToDeviceGallery({
      blob: transientBlob,
      blobUrl: galleryBlobUrl,
      fileName,
      mimeType,
      title: job.title || fileName,
      forceShareSheet,
    });
    return;
  }

  if (job.galleryBlobUrl && !forceShareSheet) {
    await exportMediaToDeviceGallery({
      blobUrl: job.galleryBlobUrl,
      fileName,
      mimeType,
      title: job.title || fileName,
    });
    return;
  }

  setState({
    jobs: state.jobs.map((j) =>
      j.id === jobId
        ? {
            ...j,
            savingToGallery: false,
            inAppWarning: 'File expire ho chuki hai — Retry dabakar fir se download karein.',
          }
        : j
    ),
  });
}

async function finalizeCompletedServerJob(
  jobSnapshot: LectureDownloadJobState,
  serverData: any
): Promise<void> {
  if (finalizingJobs.has(jobSnapshot.id)) return;
  finalizingJobs.add(jobSnapshot.id);

  try {
    const fileName = String(serverData.fileName || jobSnapshot.fileName || 'lecture.mp4');
    const format = jobSnapshot.format;
    const mimeType = format === 'm4a' ? 'audio/mp4' : 'video/mp4';
    const saveTarget = jobSnapshot.saveTarget || 'both';
    const wantsInApp = saveTarget === 'app' || saveTarget === 'both';
    const wantsGallery = saveTarget === 'gallery' || saveTarget === 'both';
    const serverBytes = Number(serverData.downloadedBytes ?? jobSnapshot.downloadedBytes ?? 0);

    let fetchedBlob: Blob | null = null;
    let galleryBlobUrl: string | undefined;
    let savedOfflineOk = false;
    let inAppWarning: string | null = null;

    if (wantsInApp || wantsGallery) {
      setState({
        jobs: state.jobs.map((j) =>
          j.id === jobSnapshot.id
            ? {
                ...j,
                status: 'finalizing',
                percent: 95,
                downloadedBytes: serverBytes,
              }
            : j
        ),
      });

      try {
        fetchedBlob = await fetchChunkedBlobFromServer(
          jobSnapshot.id,
          serverBytes,
          mimeType,
          (received, total) => {
            const denom = total > 0 ? total : serverBytes;
            const subPct = denom > 0 ? Math.min(99, 95 + Math.round((received / denom) * 4)) : 97;
            setState({
              jobs: state.jobs.map((j) =>
                j.id === jobSnapshot.id && j.status === 'finalizing'
                  ? { ...j, percent: subPct }
                  : j
              ),
            });
          }
        );

        if (fetchedBlob && fetchedBlob.size > 0) {
          galleryBlobUrl = URL.createObjectURL(fetchedBlob);
          if (wantsInApp) {
            try {
              await saveOfflineLecture({
                id: jobSnapshot.id,
                title: jobSnapshot.title,
                batchName: jobSnapshot.batchName,
                subjectName: jobSnapshot.subjectName,
                qualityLabel: jobSnapshot.qualityLabel,
                format,
                fileName,
                sizeBytes: fetchedBlob.size || serverBytes,
                durationSecs: Number(serverData.totalDurationSecs ?? jobSnapshot.totalDurationSecs ?? 0),
                thumbnail: jobSnapshot.thumbnail,
                savedAt: Date.now(),
                mimeType,
                blob: fetchedBlob,
              });
              savedOfflineOk = true;
            } catch (idbErr: any) {
              savedOfflineOk = false;
              const isQuota =
                idbErr?.name === 'QuotaExceededError' ||
                String(idbErr?.message || '').toLowerCase().includes('quota');
              inAppWarning = isQuota
                ? 'Browser storage full hai — niche Gallery button se phone mein save karein.'
                : 'In-App vault save blocked — niche Gallery button se save karein.';
            }
          }
        }
      } catch (xferErr: any) {
        savedOfflineOk = false;
        inAppWarning = `Transfer ruk gaya (${xferErr?.message || 'network'}) — niche Gallery dabakar fir try karein.`;
      }
    }

    const finalSize = fetchedBlob?.size || serverBytes;
    const finalDuration = Number(serverData.totalDurationSecs ?? jobSnapshot.totalDurationSecs ?? 0);

    setState({
      jobs: state.jobs.map((j) =>
        j.id === jobSnapshot.id
          ? {
              ...j,
              status: 'ready',
              percent: 100,
              downloadedBytes: finalSize,
              totalDurationSecs: finalDuration,
              processedSecs: Number(serverData.processedSecs ?? j.processedSecs),
              fileName,
              autoSaved: true,
              savedInApp: savedOfflineOk,
              inAppWarning,
              offlineId: savedOfflineOk ? jobSnapshot.id : undefined,
              galleryBlobUrl,
            }
          : j
      ),
    });

    recordJobHistory(
      { ...jobSnapshot, fileName },
      'downloaded',
      {
        sizeBytes: finalSize,
        durationSecs: finalDuration,
        savedInApp: savedOfflineOk,
        error: null,
        completedAt: Date.now(),
      }
    );

    if (wantsGallery && fetchedBlob) {
      try {
        await exportMediaToDeviceGallery({
          blob: fetchedBlob,
          blobUrl: galleryBlobUrl,
          fileName,
          mimeType,
          title: jobSnapshot.title,
        });
      } catch {
        // User has instant local blob <a download> Gallery link right on the card
      }
    }

    fetchedBlob = null;
  } finally {
    finalizingJobs.delete(jobSnapshot.id);
  }
}

function startPollingJob(jobId: string) {
  if (pollTimers.has(jobId)) return;

  const poll = async () => {
    try {
      const res = await fetch(`/api/lecture-download/status/${encodeURIComponent(jobId)}`);
      if (!res.ok) {
        stopPollingJob(jobId);
        if (res.status === 404) {
          const expireMsg = 'Download session expire ho gaya — Retry dabakar fir se download karein.';
          const targetJob = state.jobs.find((j) => j.id === jobId);
          setState({
            jobs: state.jobs.map((j) =>
              j.id === jobId && j.status !== 'ready' && j.status !== 'cancelled'
                ? {
                    ...j,
                    status: 'error',
                    error: expireMsg,
                  }
                : j
            ),
          });
          if (targetJob && targetJob.status !== 'ready' && targetJob.status !== 'cancelled') {
            recordJobHistory(targetJob, 'failed', { error: expireMsg });
          }
        }
        return;
      }
      const data = await safeReadJson<any>(res, 'Failed to check download status');

      if (data.status === 'ready') {
        stopPollingJob(jobId);
        const existing = state.jobs.find((j) => j.id === jobId);
        if (existing && !existing.autoSaved) {
          await finalizeCompletedServerJob(existing, data);
        }
        return;
      }

      const updated = state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        return {
          ...j,
          status: data.status,
          percent: Number(data.percent ?? j.percent),
          downloadedBytes: Number(data.downloadedBytes ?? j.downloadedBytes),
          totalDurationSecs: Number(data.totalDurationSecs ?? j.totalDurationSecs),
          processedSecs: Number(data.processedSecs ?? j.processedSecs),
          error: data.error || null,
        };
      });
      setState({ jobs: updated });

      if (data.status === 'error' || data.status === 'cancelled') {
        stopPollingJob(jobId);
        const finishedJob = updated.find((j) => j.id === jobId);
        if (finishedJob) {
          recordJobHistory(
            finishedJob,
            data.status === 'cancelled' ? 'cancelled' : 'failed',
            { error: data.error || (data.status === 'error' ? 'Download failed' : null) }
          );
        }
        return;
      }
    } catch {
      // keep trying silently on transient network hiccup
    }
    const t = window.setTimeout(poll, 450);
    pollTimers.set(jobId, t);
  };

  const t = window.setTimeout(poll, 350);
  pollTimers.set(jobId, t);
}

function stopPollingJob(jobId: string) {
  const t = pollTimers.get(jobId);
  if (t !== undefined) {
    window.clearTimeout(t);
    pollTimers.delete(jobId);
  }
}

export async function openLectureDownloadModal(target: LectureDownloadTarget): Promise<void> {
  setState({
    target,
    inspecting: true,
    inspectError: null,
    isYoutubeNotice: false,
    youtubeUrl: undefined,
    durationSecs: 0,
    options: [],
  });

  try {
    const fetchStreamAndInspect = async (useCached: boolean) => {
      const stream =
        useCached && target.resolvedStream
          ? target.resolvedStream
          : await resolveVideoStream({
              batchId: target.batchId,
              programId: target.programId,
              subjectId: target.subjectId,
              topicId: target.topicId,
              videoId: target.videoId,
              findKey: target.findKey,
              videoDetailsId: target.videoDetailsId,
              parentScheduleId: target.parentScheduleId,
              typeId: target.typeId,
              videoName: target.title,
              videoImg: target.videoImg,
              videoType: target.videoType || 'new',
              playType: target.playType || 'Lecture',
              videoUrl: target.rawVideoUrl,
              isLive: target.isLive,
              urlType: target.urlType,
            });

      if (stream.isYoutube) {
        return { isYoutube: true as const, stream, json: null };
      }

      const hlsUrl = stream.hlsUrl || stream.streamUrl || '';
      if (!hlsUrl) {
        throw new Error('Is lecture ka video link abhi available nahi hai.');
      }

      const qs = new URLSearchParams({
        hls_url: hlsUrl,
        is_direct_mp4: stream.isDirectMp4 ? '1' : '0',
      });
      if (stream.dashUrl) qs.set('dash_url', stream.dashUrl);

      const res = await fetch(`/api/lecture-download/inspect?${qs.toString()}`);
      const json = await safeReadJson<any>(res, 'Could not inspect video qualities');
      if (!json.success) {
        throw new Error(json.message || 'Could not inspect video qualities.');
      }
      return { isYoutube: false as const, stream, json };
    };

    let inspected;
    try {
      inspected = await fetchStreamAndInspect(true);
    } catch (firstErr) {
      if (target.resolvedStream) {
        inspected = await fetchStreamAndInspect(false);
      } else {
        throw firstErr;
      }
    }

    if (inspected.isYoutube) {
      setState({
        inspecting: false,
        isYoutubeNotice: true,
        youtubeUrl: inspected.stream.rawUrl || inspected.stream.youtubeEmbedUrl,
      });
      return;
    }

    setState({
      inspecting: false,
      durationSecs: Number(inspected.json.durationSecs || 0),
      options: Array.isArray(inspected.json.options) ? inspected.json.options : [],
    });
  } catch (err: any) {
    setState({
      inspecting: false,
      inspectError: err?.message || 'Could not prepare lecture download options.',
    });
  }
}

export function closeLectureDownloadModal(): void {
  setState({ target: null, inspecting: false, inspectError: null, options: [] });
}

export async function startLectureDownload(
  option: LectureDownloadOption,
  overrideTarget?: LectureDownloadTarget | null
): Promise<void> {
  const currentTarget = overrideTarget ?? state.target;
  const title = currentTarget?.title || 'PW Lecture';
  const durationSecs = state.durationSecs || 0;
  const saveTarget = state.saveTarget;
  const qualityLabel = option.qualityTag || option.label;
  const safeTitle =
    String(title)
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'PW_Lecture';
  const fileName = `${safeTitle} (${qualityLabel}).${option.format}`;
  const jobId = `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = Date.now();

  if (!overrideTarget) {
    closeLectureDownloadModal();
  }

  const abortController = new AbortController();
  activeAbortControllers.set(jobId, abortController);

  const newJob: LectureDownloadJobState = {
    id: jobId,
    title,
    batchName: currentTarget?.batchName,
    subjectName: currentTarget?.subjectName,
    thumbnail: currentTarget?.videoImg,
    qualityLabel,
    format: option.format,
    fileName,
    status: 'downloading',
    percent: 1,
    downloadedBytes: 0,
    totalDurationSecs: durationSecs,
    processedSecs: 0,
    autoSaved: false,
    saveTarget,
    startedAt,
    retryTarget: currentTarget || undefined,
    retryOption: option,
  };

  setState({ jobs: [newJob, ...state.jobs], queueOpen: true });

  let lastUiUpdateAt = 0;

  try {
    const result = await downloadLectureInBrowser({
      url: option.url,
      format: option.format,
      isDirectMp4: Boolean(option.isDirectMp4),
      durationSecs,
      signal: abortController.signal,
      onProgress: (p) => {
        if (abortController.signal.aborted) return;
        const now = Date.now();
        if (now - lastUiUpdateAt < 180 && p.percent < 94) return;
        lastUiUpdateAt = now;
        setState({
          jobs: state.jobs.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: 'downloading',
                  percent: p.percent,
                  downloadedBytes: p.downloadedBytes,
                  processedSecs: p.processedSecs,
                  totalDurationSecs: p.totalDurationSecs || j.totalDurationSecs,
                }
              : j
          ),
        });
      },
    });

    if (abortController.signal.aborted) return;

    const wantsInApp = saveTarget === 'app' || saveTarget === 'both';
    const wantsGallery = saveTarget === 'gallery' || saveTarget === 'both';

    setState({
      jobs: state.jobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              status: 'finalizing',
              percent: 97,
              downloadedBytes: result.sizeBytes,
              totalDurationSecs: result.durationSecs || j.totalDurationSecs,
            }
          : j
      ),
    });

    const galleryBlobUrl = URL.createObjectURL(result.blob);
    transientJobBlobs.set(jobId, result.blob);

    let savedOfflineOk = false;
    let inAppWarning: string | null = null;

    if (wantsInApp) {
      try {
        await saveOfflineLecture({
          id: jobId,
          title,
          batchName: currentTarget?.batchName,
          subjectName: currentTarget?.subjectName,
          qualityLabel,
          format: option.format,
          fileName,
          sizeBytes: result.sizeBytes,
          durationSecs: result.durationSecs || durationSecs,
          thumbnail: currentTarget?.videoImg,
          savedAt: Date.now(),
          mimeType: result.mimeType,
          blob: result.blob,
        });
        savedOfflineOk = true;
      } catch (idbErr: any) {
        savedOfflineOk = false;
        const isQuota =
          idbErr?.name === 'QuotaExceededError' ||
          String(idbErr?.message || '').toLowerCase().includes('quota');
        inAppWarning = isQuota
          ? 'Browser storage full hai — niche Gallery button se phone mein save karein.'
          : 'In-App vault save blocked — niche Gallery button se save karein.';
      }
    }

    const completedSnapshot: LectureDownloadJobState = {
      ...newJob,
      status: 'ready',
      percent: 100,
      downloadedBytes: result.sizeBytes,
      totalDurationSecs: result.durationSecs || durationSecs,
      processedSecs: result.durationSecs || durationSecs,
      autoSaved: true,
      savedInApp: savedOfflineOk,
      inAppWarning,
      offlineId: savedOfflineOk ? jobId : undefined,
      galleryBlobUrl,
    };

    setState({
      jobs: state.jobs.map((j) => (j.id === jobId ? completedSnapshot : j)),
    });

    recordJobHistory(completedSnapshot, 'downloaded', {
      sizeBytes: result.sizeBytes,
      durationSecs: result.durationSecs || durationSecs,
      savedInApp: savedOfflineOk,
      error: null,
      completedAt: Date.now(),
    });

    if (wantsGallery) {
      try {
        await exportMediaToDeviceGallery({
          blob: result.blob,
          blobUrl: galleryBlobUrl,
          fileName,
          mimeType: result.mimeType,
          title,
        });
      } catch {
        // User has instant local blob Gallery button on the card
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || abortController.signal.aborted) {
      return;
    }
    const errMsg = err?.message || 'Download failed';
    const errSnapshot: LectureDownloadJobState = {
      ...newJob,
      status: 'error',
      percent: 0,
      error: errMsg,
    };
    setState({
      jobs: state.jobs.map((j) => (j.id === jobId ? errSnapshot : j)),
      queueOpen: true,
    });
    recordJobHistory(errSnapshot, 'failed', { error: errMsg });
  } finally {
    activeAbortControllers.delete(jobId);
  }
}

export async function retryLectureDownload(jobId: string): Promise<void> {
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) return;
  await cancelLectureDownload(jobId);

  if (job.retryTarget) {
    await openLectureDownloadModal({ ...job.retryTarget, resolvedStream: null });
    return;
  }
  if (job.retryOption) {
    await startLectureDownload(job.retryOption, {
      batchId: '',
      subjectId: '',
      topicId: '',
      videoId: job.id,
      title: job.title,
      batchName: job.batchName,
      subjectName: job.subjectName,
      videoImg: job.thumbnail,
    });
  }
}

export async function cancelLectureDownload(jobId: string): Promise<void> {
  stopPollingJob(jobId);
  const controller = activeAbortControllers.get(jobId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(jobId);
  }
  transientJobBlobs.delete(jobId);

  const existing = state.jobs.find((j) => j.id === jobId);
  if (
    existing &&
    (existing.status === 'preparing' ||
      existing.status === 'downloading' ||
      existing.status === 'finalizing')
  ) {
    recordJobHistory(existing, 'cancelled');
  }
  if (existing?.galleryBlobUrl) {
    try {
      URL.revokeObjectURL(existing.galleryBlobUrl);
    } catch {
      // ignore
    }
  }
  setState({
    jobs: state.jobs.filter((j) => j.id !== jobId),
  });
}

export function clearFinishedDownloads(): void {
  const remaining: LectureDownloadJobState[] = [];
  for (const j of state.jobs) {
    if (j.status === 'downloading' || j.status === 'preparing' || j.status === 'finalizing') {
      remaining.push(j);
    } else {
      transientJobBlobs.delete(j.id);
      if (j.galleryBlobUrl) {
        try {
          URL.revokeObjectURL(j.galleryBlobUrl);
        } catch {
          // ignore
        }
      }
    }
  }
  setState({ jobs: remaining });
}

export function setDownloadQueueOpen(open: boolean): void {
  setState({ queueOpen: open });
}

export function useLectureDownloads(): ManagerState {
  const [snapshot, setSnapshot] = useState<ManagerState>(state);
  useEffect(() => {
    const onChange = () => setSnapshot(state);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  return snapshot;
}
