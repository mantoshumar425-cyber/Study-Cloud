import { useEffect, useState } from 'react';
import { ResolvedStream } from '../types';
import { resolveVideoStream } from './batchService';
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
  autoSaved?: boolean;
  saveTarget: DownloadSaveTarget;
  savedInApp?: boolean;
  offlineId?: string;
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

export function triggerBrowserFileSave(jobId: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = `/api/lecture-download/file/${encodeURIComponent(jobId)}`;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function saveJobToGallery(jobId: string, forceShareSheet = false): Promise<void> {
  const job = state.jobs.find((j) => j.id === jobId);
  const fileName = job?.fileName || 'lecture.mp4';
  const mimeType = job?.format === 'm4a' ? 'audio/mp4' : 'video/mp4';

  if (job?.offlineId) {
    const rec = await getOfflineLectureRecord(job.offlineId);
    if (rec?.blob) {
      await exportMediaToDeviceGallery({
        blob: rec.blob,
        fileName: rec.fileName,
        mimeType: rec.mimeType,
        title: rec.title,
        forceShareSheet,
      });
      return;
    }
  }

  if (forceShareSheet) {
    try {
      const res = await fetch(`/api/lecture-download/file/${encodeURIComponent(jobId)}`);
      if (res.ok) {
        const blob = await res.blob();
        await exportMediaToDeviceGallery({
          blob,
          fileName,
          mimeType,
          title: job?.title || fileName,
          forceShareSheet: true,
        });
        return;
      }
    } catch {
      // fallback below
    }
  }

  await exportMediaToDeviceGallery({
    fallbackUrl: `/api/lecture-download/file/${encodeURIComponent(jobId)}`,
    fileName,
    mimeType,
    title: job?.title || fileName,
  });
}

async function finalizeCompletedServerJob(
  jobSnapshot: LectureDownloadJobState,
  serverData: any
): Promise<void> {
  const fileName = String(serverData.fileName || jobSnapshot.fileName || 'lecture.mp4');
  const format = jobSnapshot.format;
  const mimeType = format === 'm4a' ? 'audio/mp4' : 'video/mp4';
  const saveTarget = jobSnapshot.saveTarget || 'both';
  const wantsInApp = saveTarget === 'app' || saveTarget === 'both';
  const wantsGallery = saveTarget === 'gallery' || saveTarget === 'both';

  let fetchedBlob: Blob | null = null;
  let savedOfflineOk = false;

  if (wantsInApp) {
    setState({
      jobs: state.jobs.map((j) =>
        j.id === jobSnapshot.id
          ? {
              ...j,
              status: 'finalizing',
              percent: 99,
              downloadedBytes: Number(serverData.downloadedBytes ?? j.downloadedBytes),
            }
          : j
      ),
    });

    try {
      const fileRes = await fetch(`/api/lecture-download/file/${encodeURIComponent(jobSnapshot.id)}`);
      if (fileRes.ok) {
        const rawBlob = await fileRes.blob();
        fetchedBlob = new Blob([rawBlob], { type: mimeType });
        await saveOfflineLecture({
          id: jobSnapshot.id,
          title: jobSnapshot.title,
          batchName: jobSnapshot.batchName,
          subjectName: jobSnapshot.subjectName,
          qualityLabel: jobSnapshot.qualityLabel,
          format,
          fileName,
          sizeBytes: fetchedBlob.size || Number(serverData.downloadedBytes || 0),
          durationSecs: Number(serverData.totalDurationSecs ?? jobSnapshot.totalDurationSecs ?? 0),
          thumbnail: jobSnapshot.thumbnail,
          savedAt: Date.now(),
          mimeType,
          blob: fetchedBlob,
        });
        savedOfflineOk = true;
      }
    } catch {
      savedOfflineOk = false;
    }
  }

  setState({
    jobs: state.jobs.map((j) =>
      j.id === jobSnapshot.id
        ? {
            ...j,
            status: 'ready',
            percent: 100,
            downloadedBytes: Number(
              fetchedBlob?.size ?? serverData.downloadedBytes ?? j.downloadedBytes
            ),
            totalDurationSecs: Number(serverData.totalDurationSecs ?? j.totalDurationSecs),
            processedSecs: Number(serverData.processedSecs ?? j.processedSecs),
            fileName,
            autoSaved: true,
            savedInApp: savedOfflineOk,
            offlineId: savedOfflineOk ? jobSnapshot.id : undefined,
          }
        : j
    ),
  });

  if (wantsGallery) {
    try {
      await exportMediaToDeviceGallery({
        blob: fetchedBlob,
        fallbackUrl: `/api/lecture-download/file/${encodeURIComponent(jobSnapshot.id)}`,
        fileName,
        mimeType,
        title: jobSnapshot.title,
      });
    } catch {
      // User can always tap "Gallery" directly on the card
    }
  }
}

function startPollingJob(jobId: string) {
  if (pollTimers.has(jobId)) return;

  const poll = async () => {
    try {
      const res = await fetch(`/api/lecture-download/status/${encodeURIComponent(jobId)}`);
      if (!res.ok) {
        stopPollingJob(jobId);
        return;
      }
      const data = await res.json();

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
    const stream =
      target.resolvedStream ||
      (await resolveVideoStream({
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
      }));

    if (stream.isYoutube) {
      setState({
        inspecting: false,
        isYoutubeNotice: true,
        youtubeUrl: stream.rawUrl || stream.youtubeEmbedUrl,
      });
      return;
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
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.message || 'Could not inspect video qualities.');
    }

    setState({
      inspecting: false,
      durationSecs: Number(json.durationSecs || 0),
      options: Array.isArray(json.options) ? json.options : [],
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

export async function startLectureDownload(option: LectureDownloadOption): Promise<void> {
  const currentTarget = state.target;
  const title = currentTarget?.title || 'PW Lecture';
  const durationSecs = state.durationSecs || 0;
  const saveTarget = state.saveTarget;

  closeLectureDownloadModal();
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
    const json = await res.json();
    if (!res.ok || !json.success || !json.jobId) {
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
    };
    setState({ jobs: [errJob, ...state.jobs], queueOpen: true });
  }
}

export async function cancelLectureDownload(jobId: string): Promise<void> {
  stopPollingJob(jobId);
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
  setState({
    jobs: state.jobs.filter(
      (j) => j.status === 'downloading' || j.status === 'preparing' || j.status === 'finalizing'
    ),
  });
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
