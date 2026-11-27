export type DownloadHistoryStatus = 'downloaded' | 'deleted' | 'failed' | 'cancelled';

export interface DownloadRetryTarget {
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
}

export interface DownloadHistoryItem {
  id: string;
  title: string;
  batchName?: string;
  subjectName?: string;
  thumbnail?: string;
  qualityLabel: string;
  format: 'mp4' | 'm4a';
  fileName: string;
  sizeBytes: number;
  durationSecs: number;
  saveTarget?: 'both' | 'app' | 'gallery';
  savedInApp?: boolean;
  status: DownloadHistoryStatus;
  error?: string | null;
  startedAt: number;
  completedAt?: number;
  deletedAt?: number;
  updatedAt: number;
  retryTarget?: DownloadRetryTarget;
}

const HISTORY_STORAGE_KEY = 'studycloud_download_history_v1';
const MAX_HISTORY_ITEMS = 200;

const listeners = new Set<() => void>();

function notifyHistoryChanged() {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      // ignore listener errors
    }
  }
}

export function subscribeDownloadHistory(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readRawHistory(): DownloadHistoryItem[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is DownloadHistoryItem => Boolean(item && typeof item.id === 'string'))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch {
    return [];
  }
}

function writeRawHistory(items: DownloadHistoryItem[]): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  const trimmed = [...items]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_HISTORY_ITEMS);
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Fallback if storage is tight: trim older thumbnails/entries
    try {
      const compact = trimmed.slice(0, 60).map((item) => ({
        ...item,
        thumbnail: undefined,
      }));
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(compact));
    } catch {
      // ignore storage quota errors
    }
  }
  notifyHistoryChanged();
}

export function listDownloadHistory(): DownloadHistoryItem[] {
  return readRawHistory();
}

export function upsertDownloadHistory(entry: DownloadHistoryItem): void {
  const list = readRawHistory();
  const idx = list.findIndex((item) => item.id === entry.id);
  if (idx >= 0) {
    const existing = list[idx];
    list[idx] = {
      ...existing,
      ...entry,
      startedAt: existing.startedAt || entry.startedAt,
      retryTarget: entry.retryTarget || existing.retryTarget,
      thumbnail: entry.thumbnail || existing.thumbnail,
      batchName: entry.batchName || existing.batchName,
      subjectName: entry.subjectName || existing.subjectName,
    };
  } else {
    list.unshift(entry);
  }
  writeRawHistory(list);
}

export function syncOfflineMetaToDownloadHistory(
  metas: Array<{
    id: string;
    title: string;
    batchName?: string;
    subjectName?: string;
    qualityLabel: string;
    format: 'mp4' | 'm4a';
    fileName: string;
    sizeBytes: number;
    durationSecs: number;
    thumbnail?: string;
    savedAt: number;
  }>
): void {
  if (!metas.length) return;
  const list = readRawHistory();
  const existingIds = new Set(list.map((item) => item.id));
  let changed = false;

  for (const meta of metas) {
    if (!existingIds.has(meta.id)) {
      list.push({
        id: meta.id,
        title: meta.title,
        batchName: meta.batchName,
        subjectName: meta.subjectName,
        thumbnail: meta.thumbnail,
        qualityLabel: meta.qualityLabel,
        format: meta.format,
        fileName: meta.fileName,
        sizeBytes: meta.sizeBytes,
        durationSecs: meta.durationSecs,
        saveTarget: 'app',
        savedInApp: true,
        status: 'downloaded',
        startedAt: meta.savedAt || Date.now(),
        completedAt: meta.savedAt || Date.now(),
        updatedAt: meta.savedAt || Date.now(),
      });
      changed = true;
    }
  }

  if (changed) {
    writeRawHistory(list);
  }
}

export function markDownloadHistoryDeleted(
  id: string,
  fallbackMeta?: {
    id: string;
    title: string;
    batchName?: string;
    subjectName?: string;
    qualityLabel: string;
    format: 'mp4' | 'm4a';
    fileName: string;
    sizeBytes: number;
    durationSecs: number;
    thumbnail?: string;
    savedAt: number;
  } | null
): void {
  const now = Date.now();
  const list = readRawHistory();
  const idx = list.findIndex((item) => item.id === id);

  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      status: 'deleted',
      savedInApp: false,
      deletedAt: now,
      updatedAt: now,
    };
    writeRawHistory(list);
    return;
  }

  if (fallbackMeta) {
    list.unshift({
      id: fallbackMeta.id,
      title: fallbackMeta.title,
      batchName: fallbackMeta.batchName,
      subjectName: fallbackMeta.subjectName,
      thumbnail: fallbackMeta.thumbnail,
      qualityLabel: fallbackMeta.qualityLabel,
      format: fallbackMeta.format,
      fileName: fallbackMeta.fileName,
      sizeBytes: fallbackMeta.sizeBytes,
      durationSecs: fallbackMeta.durationSecs,
      saveTarget: 'app',
      savedInApp: false,
      status: 'deleted',
      startedAt: fallbackMeta.savedAt || now,
      completedAt: fallbackMeta.savedAt || now,
      deletedAt: now,
      updatedAt: now,
    });
    writeRawHistory(list);
  }
}

export function markManyDownloadHistoryDeleted(
  metas: Array<{
    id: string;
    title: string;
    batchName?: string;
    subjectName?: string;
    qualityLabel: string;
    format: 'mp4' | 'm4a';
    fileName: string;
    sizeBytes: number;
    durationSecs: number;
    thumbnail?: string;
    savedAt: number;
  }>
): void {
  const now = Date.now();
  const list = readRawHistory();
  const metaMap = new Map(metas.map((m) => [m.id, m]));
  let changed = false;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (metaMap.has(item.id) || (item.status === 'downloaded' && item.savedInApp)) {
      list[i] = {
        ...item,
        status: 'deleted',
        savedInApp: false,
        deletedAt: now,
        updatedAt: now,
      };
      metaMap.delete(item.id);
      changed = true;
    }
  }

  for (const meta of metaMap.values()) {
    list.unshift({
      id: meta.id,
      title: meta.title,
      batchName: meta.batchName,
      subjectName: meta.subjectName,
      thumbnail: meta.thumbnail,
      qualityLabel: meta.qualityLabel,
      format: meta.format,
      fileName: meta.fileName,
      sizeBytes: meta.sizeBytes,
      durationSecs: meta.durationSecs,
      saveTarget: 'app',
      savedInApp: false,
      status: 'deleted',
      startedAt: meta.savedAt || now,
      completedAt: meta.savedAt || now,
      deletedAt: now,
      updatedAt: now,
    });
    changed = true;
  }

  if (changed) {
    writeRawHistory(list);
  }
}

export function deleteDownloadHistoryEntry(id: string): void {
  const list = readRawHistory();
  const next = list.filter((item) => item.id !== id);
  if (next.length !== list.length) {
    writeRawHistory(next);
  }
}

export function clearDownloadHistory(statusFilter?: DownloadHistoryStatus | 'all'): void {
  if (!statusFilter || statusFilter === 'all') {
    writeRawHistory([]);
    return;
  }
  const list = readRawHistory();
  const next = list.filter((item) => item.status !== statusFilter);
  writeRawHistory(next);
}
