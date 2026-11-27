import {
  markDownloadHistoryDeleted,
  markManyDownloadHistoryDeleted,
  syncOfflineMetaToDownloadHistory,
} from './downloadHistoryDb';

const DB_NAME = 'studycloud_offline_vault';
const DB_VERSION = 1;
const STORE_NAME = 'lectures';

export interface OfflineLectureMeta {
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
  mimeType: string;
}

export interface OfflineLectureRecord extends OfflineLectureMeta {
  blob: Blob;
}

const listeners = new Set<() => void>();

export function subscribeOfflineVault(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notifyVaultChanged() {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      // ignore listener errors
    }
  }
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Offline storage is not supported in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open offline storage.'));
  });
}

export async function saveOfflineLecture(record: OfflineLectureRecord): Promise<void> {
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not save offline lecture.'));
    tx.onabort = () => reject(tx.error || new Error('Offline save aborted.'));
  });
  notifyVaultChanged();
}

export async function listOfflineLectureMeta(): Promise<OfflineLectureMeta[]> {
  try {
    const db = await openVaultDb();
    const rows = await new Promise<OfflineLectureRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as OfflineLectureRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    const metas = rows
      .map(({ blob: _blob, ...meta }) => meta)
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    syncOfflineMetaToDownloadHistory(metas);
    return metas;
  } catch {
    return [];
  }
}

export async function getOfflineLectureRecord(id: string): Promise<OfflineLectureRecord | null> {
  try {
    const db = await openVaultDb();
    return await new Promise<OfflineLectureRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as OfflineLectureRecord) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteOfflineLecture(id: string): Promise<void> {
  let deletedMeta: OfflineLectureMeta | null = null;
  try {
    const existing = await getOfflineLectureRecord(id);
    if (existing) {
      const { blob: _blob, ...meta } = existing;
      deletedMeta = meta;
    }
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    markDownloadHistoryDeleted(id, deletedMeta);
    notifyVaultChanged();
  }
}

export async function clearAllOfflineLectures(): Promise<void> {
  let existingMetas: OfflineLectureMeta[] = [];
  try {
    existingMetas = await listOfflineLectureMeta();
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    markManyDownloadHistoryDeleted(existingMetas);
    notifyVaultChanged();
  }
}

export function isMobileIosBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent);
}

export function canShareMediaFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof File === 'undefined') return false;
  return typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
}

/**
 * Triggers direct download into Device Downloads / Phone Gallery.
 * If Blob is passed, creates zero-network local object URL.
 * On iOS or when forceShareSheet=true, invokes native Share Sheet ("Save Video" -> Photos/Gallery).
 */
export async function exportMediaToDeviceGallery(params: {
  blob?: Blob | null;
  blobUrl?: string | null;
  fallbackUrl?: string;
  fileName: string;
  mimeType: string;
  title?: string;
  forceShareSheet?: boolean;
}): Promise<'shared' | 'downloaded'> {
  const { blob, blobUrl, fallbackUrl, fileName, mimeType, title, forceShareSheet } = params;

  if (blob && (forceShareSheet || isMobileIosBrowser()) && canShareMediaFiles()) {
    try {
      const file = new File([blob], fileName, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: title || fileName,
        });
        return 'shared';
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return 'shared';
      // Fall through to local blob <a download> below
    }
  }

  let href = blobUrl || '';
  let ownedRevokeUrl: string | null = null;
  if (!href && blob) {
    ownedRevokeUrl = URL.createObjectURL(blob);
    href = ownedRevokeUrl;
  }
  if (!href && fallbackUrl && fallbackUrl.startsWith('blob:')) {
    href = fallbackUrl;
  }

  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (ownedRevokeUrl) {
      window.setTimeout(() => URL.revokeObjectURL(ownedRevokeUrl!), 60000);
    }
  }

  return 'downloaded';
}
