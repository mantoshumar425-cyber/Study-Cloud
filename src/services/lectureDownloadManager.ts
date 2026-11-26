import { useEffect, useState } from 'react';
import { ResolvedStream } from '../types';
import { resolveVideoStream, safeReadJson } from './batchService';
import {
  exportMediaToDeviceGallery,
  getOfflineLectureRecord,
  OfflineLectureMeta,
  saveOfflineLecture,
} from './offlineLectureDb';

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
  retryTarget?: LectureDownloadTarget;
  retryOption?: LectureDownloadOption;
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
      j.id === jobId ? { ...j, savingToGallery: true, inAppWarning: null } : j
    ),
  });
  try {
    const blob = await fetchChunkedBlobFromServer(
      jobId,
      job.downloadedBytes || 0,
      mimeType,
      () => {}
    );
    if (blob.size > 0) {
      const galleryBlobUrl = job.galleryBlobUrl || URL.createObjectURL(blob);
      setState({
        jobs: state.jobs.map((j) =>
          j.id === jobId ? { ...j, galleryBlobUrl, savingToGallery: false } : j
        ),
      });
      await exportMediaToDeviceGallery({
        blob,
        blobUrl: galleryBlobUrl,
        fileName,
        mimeType,
        title: job.title || fileName,
        forceShareSheet,
      });
      return;
    }
    throw new Error('Empty file received');
  } catch (err: any) {
    setState({
      jobs: state.jobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              savingToGallery: false,
              inAppWarning: `Gallery save error: ${err?.message || 'Session expire — Retry karein.'}`,
            }
          : j
      ),
    });
  }
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

    setState({
      jobs: state.jobs.map((j) =>
        j.id === jobSnapshot.id
          ? {
              ...j,
              status: 'ready',
              percent: 100,
              downloadedBytes: finalSize,
              totalDurationSecs: Number(serverData.totalDurationSecs ?? j.totalDurationSecs),
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
          setState({
            jobs: state.jobs.map((j) =>
              j.id === jobId && j.status !== 'ready' && j.status !== 'cancelled'
                ? {
                    ...j,
                    status: 'error',
                    error: 'Download session expire ho gaya — Retry dabakar fir se download karein.',
                  }
                : j
            ),
          });
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

  if (!overrideTarget) {
    closeLectureDownloadModal();
  }
  setState({ queueOpen: true });

  try {
    const res = await fetch('/api/lecture-download/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: option.url,
        title,
        qualityLabel: option.qualityTag || option.label,
        format: option.format,
        durationSecs,
        isDirectMp4: Boolean(option.isDirectMp4),
      }),
    });
    const json = await safeReadJson<any>(res, 'Could not start download');
    if (!json.success || !json.jobId) {
      throw new Error(json.message || 'Could not start download.');
    }

    const newJob: LectureDownloadJobState = {
      id: json.jobId,
      title,
      batchName: currentTarget?.batchName,
      subjectName: currentTarget?.subjectName,
      thumbnail: currentTarget?.videoImg,
      qualityLabel: option.qualityTag || option.label,
      format: option.format,
      fileName: json.fileName || `${title}.${option.format}`,
      status: 'downloading',
      percent: 1,
      downloadedBytes: 0,
      totalDurationSecs: durationSecs,
      processedSecs: 0,
      autoSaved: false,
      saveTarget,
      retryTarget: currentTarget || undefined,
      retryOption: option,
    };

    setState({ jobs: [newJob, ...state.jobs] });
    startPollingJob(json.jobId);
  } catch (err: any) {
    const errJob: LectureDownloadJobState = {
      id: `err-${Date.now()}`,
      title,
      batchName: currentTarget?.batchName,
      subjectName: currentTarget?.subjectName,
      thumbnail: currentTarget?.videoImg,
      qualityLabel: option.qualityTag || option.label,
      format: option.format,
      fileName: `${title}.${option.format}`,
      status: 'error',
      percent: 0,
      downloadedBytes: 0,
      totalDurationSecs: 0,
      processedSecs: 0,
      error: err?.message || 'Download failed to start',
      saveTarget,
      retryTarget: currentTarget || undefined,
      retryOption: option,
    };
    setState({ jobs: [errJob, ...state.jobs], queueOpen: true });
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
  const existing = state.jobs.find((j) => j.id === jobId);
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
  if (!jobId.startsWith('err-')) {
    await fetch(`/api/lecture-download/${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(
      () => {}
    );
  }
}

export function clearFinishedDownloads(): void {
  const remaining: LectureDownloadJobState[] = [];
  for (const j of state.jobs) {
    if (j.status === 'downloading' || j.status === 'preparing' || j.status === 'finalizing') {
      remaining.push(j);
    } else if (j.galleryBlobUrl) {
      try {
        URL.revokeObjectURL(j.galleryBlobUrl);
      } catch {
        // ignore
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
