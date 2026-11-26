import {
  BatchAttachmentItem,
  BatchItem,
  BatchSubject,
  BatchTopic,
  BatchVideoItem,
  BatchNoteItem,
  TodayScheduleResponse,
  WeeklyScheduleResponse,
  ResolvedStream,
  WatchHistoryItem,
  AppControls,
  ThemeId,
  OfficialBatchTest,
  KhazanaProgramSummary,
  KhazanaSubjectOption,
  KhazanaTeacher,
  KhazanaChapter,
  KhazanaTopic,
  KhazanaSubTopic,
  KhazanaContentItem,
  PiCategory,
  PiHomeResponse,
  PiSeriesDetailResponse,
  PiTeacherProfileResponse,
} from '../types';

const LEGACY_CACHE_KEY = 'vidcloud_batches_cache';
const LEGACY_CACHE_TIME_KEY = 'vidcloud_batches_cache_time';
const IDB_NAME = 'vidcloud_catalog_db';
const IDB_STORE = 'catalog';
const IDB_RECORD_KEY = 'batches_v3';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const FAVORITES_KEY = 'studystark_favorites';
const HISTORY_KEY = 'studystark_history';
const THEME_KEY = 'theme-mode';

type BatchCatalogResult = {
  batches: BatchItem[];
  vidyapeeth: BatchItem[];
};

let memoryCatalog: { data: BatchCatalogResult; savedAt: number } | null = null;

function sortBatchesNewestFirst(list: BatchItem[]): BatchItem[] {
  const seen = new Set<string>();
  const deduped: BatchItem[] = [];
  for (const item of list) {
    if (!item?.batch_id || seen.has(item.batch_id)) continue;
    seen.add(item.batch_id);
    deduped.push(item);
  }
  return deduped.sort((a, b) => {
    const ta = a.start_date ? Date.parse(a.start_date) : 0;
    const tb = b.start_date ? Date.parse(b.start_date) : 0;
    const va = Number.isFinite(ta) ? ta : 0;
    const vb = Number.isFinite(tb) ? tb : 0;
    return vb - va;
  });
}

function openCatalogDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open catalog DB'));
  });
}

async function readIdbCatalog(): Promise<{ data: BatchCatalogResult; savedAt: number } | null> {
  try {
    const db = await openCatalogDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get(IDB_RECORD_KEY);
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeIdbCatalog(data: BatchCatalogResult): Promise<void> {
  try {
    const db = await openCatalogDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put({ data, savedAt: Date.now() }, IDB_RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore storage failures
  }
}

export async function clearBatchCatalogCache(): Promise<void> {
  memoryCatalog = null;
  try {
    localStorage.removeItem(LEGACY_CACHE_KEY);
    localStorage.removeItem(LEGACY_CACHE_TIME_KEY);
  } catch {
    // ignore
  }
  try {
    const db = await openCatalogDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

function purgeLegacyTruncatedCache(): void {
  try {
    localStorage.removeItem(LEGACY_CACHE_KEY);
    localStorage.removeItem(LEGACY_CACHE_TIME_KEY);
  } catch {
    // ignore
  }
}

export async function fetchAllBatches(): Promise<BatchCatalogResult> {
  purgeLegacyTruncatedCache();

  if (memoryCatalog && memoryCatalog.data.batches.length > 5000) {
    if (Date.now() - memoryCatalog.savedAt > CACHE_TTL_MS) {
      refreshBatchesInBackground();
    }
    return memoryCatalog.data;
  }

  const cached = await readIdbCatalog();
  if (
    cached &&
    Array.isArray(cached.data?.batches) &&
    cached.data.batches.length > 5000 &&
    Date.now() - cached.savedAt < CACHE_TTL_MS
  ) {
    memoryCatalog = cached;
    refreshBatchesInBackground();
    return cached.data;
  }

  return fetchFreshBatches();
}

export async function fetchFastBatchesAndHydrate(
  onHydrate?: (fullData: BatchCatalogResult) => void
): Promise<BatchCatalogResult> {
  purgeLegacyTruncatedCache();

  if (memoryCatalog && memoryCatalog.data.batches.length > 0) {
    if (Date.now() - memoryCatalog.savedAt > CACHE_TTL_MS && onHydrate) {
      fetchFreshBatches()
        .then((fresh) => {
          if (fresh.batches.length > 0) onHydrate(fresh);
        })
        .catch(() => {});
    }
    return memoryCatalog.data;
  }

  const cached = await readIdbCatalog();
  if (cached && Array.isArray(cached.data?.batches) && cached.data.batches.length > 0) {
    memoryCatalog = cached;
    if (onHydrate) {
      fetchFreshBatches()
        .then((fresh) => {
          if (fresh.batches.length > 0) onHydrate(fresh);
        })
        .catch(() => {});
    }
    return cached.data;
  }

  return fetchFreshBatches();
}

async function fetchFreshBatches(): Promise<BatchCatalogResult> {
  try {
    let response = await fetch('/api/batches');
    if (!response.ok) {
      response = await fetch('https://studystark.github.io/batches/batches.json');
    }
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }
    const json = await response.json();
    const batches: BatchItem[] = sortBatchesNewestFirst(
      (json.data || []).map((b: any) => ({
        batch_id: b.batch_id,
        name: b.name,
        byName: b.byName,
        language: b.language,
        exam: b.exam,
        photo: b.photo,
        class: b.class,
        start_date: b.start_date,
        end_date: b.end_date,
        amount: b.amount,
        isVidyapeeth: false,
      }))
    );
    const vidyapeeth: BatchItem[] = sortBatchesNewestFirst(
      (json.vidyapeeth_batches || []).map((b: any) => ({
        batch_id: b.batch_id,
        name: b.name,
        byName: b.byName,
        language: b.language,
        exam: b.exam,
        photo: b.photo,
        class: b.class,
        start_date: b.start_date,
        end_date: b.end_date,
        amount: b.amount,
        isVidyapeeth: true,
      }))
    );

    const result: BatchCatalogResult = { batches, vidyapeeth };
    memoryCatalog = { data: result, savedAt: Date.now() };
    void writeIdbCatalog(result);
    return result;
  } catch (err) {
    console.warn('Failed to fetch batches, trying cached catalog:', err);
    const cached = await readIdbCatalog();
    if (cached?.data?.batches?.length) {
      return cached.data;
    }
    return getFallbackBatches();
  }
}

function refreshBatchesInBackground() {
  fetchFreshBatches().catch(() => {});
}

const PW_TOKEN_KEY = 'vidcloud_pw_access_token';
const PW_USER_KEY = 'vidcloud_pw_user';

export interface PwUserInfo {
  id?: string;
  name?: string;
  phone?: string;
}

export function getPwAccessToken(): string {
  try {
    return localStorage.getItem(PW_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function getPwUser(): PwUserInfo | null {
  try {
    const raw = localStorage.getItem(PW_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setPwSession(token: string, user?: PwUserInfo | null): void {
  try {
    localStorage.setItem(PW_TOKEN_KEY, token);
    if (user) {
      localStorage.setItem(PW_USER_KEY, JSON.stringify(user));
    }
  } catch {
    // ignore storage errors
  }
}

export function clearPwSession(): void {
  try {
    localStorage.removeItem(PW_TOKEN_KEY);
    localStorage.removeItem(PW_USER_KEY);
  } catch {
    // ignore
  }
}

export async function sendPwOtp(phone: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/pw-auth/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, countryCode: '+91' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || `Failed to send OTP (${res.status})`);
  }
  return json;
}

export async function verifyPwOtp(
  phone: string,
  otp: string
): Promise<{ accessToken: string; user: PwUserInfo }> {
  const res = await fetch('/api/pw-auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success || !json?.accessToken) {
    throw new Error(json?.message || `OTP verification failed (${res.status})`);
  }
  setPwSession(json.accessToken, json.user || { phone });
  return { accessToken: json.accessToken, user: json.user || { phone } };
}

export async function logoutPwUser(): Promise<void> {
  clearPwSession();
  try {
    await fetch('/api/pw-auth/logout', { method: 'POST' });
  } catch {
    // ignore
  }
}

function getPwRequestHeaders(): Record<string, string> {
  const token = getPwAccessToken();
  return token ? { 'x-pw-token': token } : {};
}

async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries = 2
): Promise<Response> {
  let lastErr: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status < 500 || res.status === 501 || attempt === retries) {
        return res;
      }
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw err;
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  throw lastErr || new Error('Network request failed');
}

async function buildApiError(res: Response, fallbackLabel: string): Promise<Error> {
  let msg = `${fallbackLabel} (${res.status})`;
  let needsPwLogin = false;
  try {
    const json = await res.json();
    if (json?.message && typeof json.message === 'string') {
      msg = json.message;
    }
    if (json?.needsPwLogin) {
      needsPwLogin = true;
    }
  } catch {
    // keep default msg
  }
  const err = new Error(msg);
  (err as any).status = res.status;
  (err as any).needsPwLogin = needsPwLogin;
  return err;
}

export async function safeReadJson<T = any>(
  res: Response,
  fallbackLabel = 'Request failed'
): Promise<T> {
  const raw = await res.text().catch(() => '');
  let parsed: any = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const msg =
      (parsed && typeof parsed.message === 'string' && parsed.message) ||
      `${fallbackLabel} (${res.status})`;
    const err = new Error(msg);
    (err as any).status = res.status;
    (err as any).needsPwLogin = Boolean(parsed?.needsPwLogin);
    throw err;
  }
  if (parsed === null) {
    throw new Error(`${fallbackLabel}: Invalid server response`);
  }
  return parsed as T;
}

type BatchDetailsResult = {
  batch: any;
  subjects: BatchSubject[];
  mahapackBatches: any[];
  announcements: any[];
};

const batchDetailsCache = new Map<string, { data: BatchDetailsResult; savedAt: number }>();
const batchDetailsInFlight = new Map<string, Promise<BatchDetailsResult>>();
const BATCH_DETAILS_TTL_MS = 2 * 60 * 1000;

export async function fetchBatchDetails(batchId: string): Promise<BatchDetailsResult> {
  const tokenKey = getPwAccessToken() ? 'u' : 'g';
  const cacheKey = `${batchId}:${tokenKey}`;
  const cached = batchDetailsCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < BATCH_DETAILS_TTL_MS) {
    return cached.data;
  }

  const existing = batchDetailsInFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const reqPromise = (async () => {
    const res = await fetchWithRetry(`/api/batch/${encodeURIComponent(batchId)}`, {
      headers: getPwRequestHeaders(),
    });
    if (!res.ok) {
      throw await buildApiError(res, 'Failed to load batch details');
    }
    const data = (await res.json()) as BatchDetailsResult;
    batchDetailsCache.set(cacheKey, { data, savedAt: Date.now() });
    return data;
  })().finally(() => {
    batchDetailsInFlight.delete(cacheKey);
  });

  batchDetailsInFlight.set(cacheKey, reqPromise);
  return reqPromise;
}

export function prefetchBatch(batchId: string): void {
  if (!batchId) return;
  fetchBatchDetails(batchId).catch(() => {
    // ignore prefetch failures silently
  });
}

export async function fetchSubjectTopics(
  batchId: string,
  subjectSlug: string,
  page = 1
): Promise<{ topics: BatchTopic[]; paginate: any }> {
  const res = await fetchWithRetry(
    `/api/topics/${encodeURIComponent(batchId)}/${encodeURIComponent(subjectSlug)}?page=${page}`,
    { headers: getPwRequestHeaders() }
  );
  if (!res.ok) {
    throw await buildApiError(res, 'Failed to load chapters');
  }
  return res.json();
}

export async function fetchTopicContents(
  batchId: string,
  subjectSlug: string,
  topicId: string,
  contentType: 'videos' | 'notes' | 'DppNotes' | 'DppVideos' = 'videos',
  page = 1
): Promise<{ items: Array<BatchVideoItem | BatchNoteItem>; paginate: any }> {
  const params = new URLSearchParams({
    topicId,
    contentType,
    page: String(page),
  });
  const res = await fetchWithRetry(
    `/api/contents/${encodeURIComponent(batchId)}/${encodeURIComponent(subjectSlug)}?${params.toString()}`,
    { headers: getPwRequestHeaders() }
  );
  if (!res.ok) {
    throw await buildApiError(res, 'Failed to load contents');
  }
  return res.json();
}

export async function fetchTodaySchedule(batchId: string): Promise<TodayScheduleResponse> {
  const res = await fetch(`/api/schedule/${encodeURIComponent(batchId)}/today`, {
    headers: getPwRequestHeaders(),
  });
  if (!res.ok) {
    throw await buildApiError(res, 'Failed to load today schedule');
  }
  return res.json();
}

export async function fetchWeeklySchedule(
  batchId: string,
  startDate: string,
  endDate: string,
  page = 1
): Promise<WeeklyScheduleResponse> {
  const qs = new URLSearchParams({
    startDate,
    endDate,
    page: String(page),
  });
  const res = await fetch(`/api/schedule/${encodeURIComponent(batchId)}/weekly?${qs.toString()}`, {
    headers: getPwRequestHeaders(),
  });
  if (!res.ok) {
    throw await buildApiError(res, 'Failed to load weekly schedule');
  }
  return res.json();
}

export function resolveAttachmentUrl(att: BatchAttachmentItem): string {
  if (!att) return '';
  if (att.resolvedUrl) {
    return att.resolvedUrl.replace(/^https?:\/\/cors\.testfile\.eu\.org\//i, 'https://');
  }
  if (att.url) {
    return att.url.replace(/^https?:\/\/cors\.testfile\.eu\.org\//i, 'https://');
  }
  const cleanBase = (att.baseUrl || '').replace(/^https?:\/\/cors\.testfile\.eu\.org\//i, 'https://');
  const key = (att.key || '').trim();
  if (!cleanBase || !key) return '';
  return `${cleanBase.endsWith('/') ? cleanBase : `${cleanBase}/`}${key.replace(/^\//, '')}`;
}

export function buildPdfProxyUrl(rawUrl: string, fileName?: string, download = false): string {
  const qs = new URLSearchParams({
    url: rawUrl,
    name: fileName || 'study-notes.pdf',
  });
  if (download) qs.set('download', '1');
  return `/api/pdf-proxy?${qs.toString()}`;
}

export const PDF_VIEWER_EVENT = 'studycloud:open-pdf';

export function openPdfViewer(rawUrl: string, title?: string): void {
  const cleanUrl = (rawUrl || '').trim();
  if (!cleanUrl || typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PDF_VIEWER_EVENT, {
      detail: {
        url: cleanUrl,
        title: (title || 'Study Notes.pdf').trim(),
      },
    })
  );
}

export async function downloadPdfFile(rawUrl: string, fileName?: string): Promise<void> {
  const safeName = (fileName || 'study-notes.pdf').trim();
  const finalName = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
  const proxyUrl = buildPdfProxyUrl(rawUrl, finalName, true);

  const res = await fetch(proxyUrl);
  if (!res.ok) {
    throw new Error(`PDF download failed (${res.status})`);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = finalName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
}

export interface ResolveVideoStreamParams {
  batchId: string;
  programId?: string;
  subjectId: string;
  topicId: string;
  videoId: string;
  findKey?: string;
  videoDetailsId?: string;
  parentScheduleId?: string;
  videoName: string;
  videoImg?: string;
  videoType?: string;
  playType?: string;
  videoUrl?: string;
  typeId?: string;
  isLive?: boolean;
  urlType?: string;
}

const streamCache = new Map<string, { data: ResolvedStream; savedAt: number }>();
const streamInFlight = new Map<string, Promise<ResolvedStream>>();
const STREAM_CACHE_TTL_MS = 90 * 1000;

export async function resolveVideoStream(params: ResolveVideoStreamParams): Promise<ResolvedStream> {
  const cacheKey = `${params.batchId}:${params.programId || ''}:${params.videoId}:${params.findKey || ''}:${params.playType || 'Lecture'}`;
  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < STREAM_CACHE_TTL_MS) {
    return cached.data;
  }
  const existing = streamInFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const reqPromise = (async () => {
    const qs = new URLSearchParams({
      batch_id: params.batchId,
      subject_id: params.subjectId,
      topic_id: params.topicId,
      video_id: params.videoId,
      video_name: params.videoName,
      video_img: params.videoImg || '',
      video_type: params.videoType || 'new',
      play_type: params.playType || 'Lecture',
    });
    if (params.programId) qs.set('program_id', params.programId);
    if (params.findKey) qs.set('find_key', params.findKey);
    if (params.videoDetailsId) qs.set('video_details_id', params.videoDetailsId);
    if (params.parentScheduleId) qs.set('parent_schedule_id', params.parentScheduleId);
    if (params.videoUrl) qs.set('video_url', params.videoUrl);
    if (params.typeId) qs.set('typeId', params.typeId);
    if (params.urlType) qs.set('url_type', params.urlType);

    const res = await fetchWithRetry(`/api/stream?${qs.toString()}`, {
      headers: getPwRequestHeaders(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      const err = new Error(json.message || `Stream resolution failed (${res.status})`);
      (err as any).status = res.status;
      (err as any).needsPwLogin = Boolean(json?.needsPwLogin);
      throw err;
    }
    streamCache.set(cacheKey, { data: json, savedAt: Date.now() });
    return json;
  })().finally(() => {
    streamInFlight.delete(cacheKey);
  });

  streamInFlight.set(cacheKey, reqPromise);
  return reqPromise;
}

export function prefetchVideoStream(params: ResolveVideoStreamParams): void {
  if (!params?.videoId) return;
  resolveVideoStream(params).catch(() => {
    // silent prefetch
  });
}

export async function fetchAppControls(): Promise<AppControls> {
  try {
    const res = await fetch('https://vidcloud.eu.org/app-controls.php?_t=' + Date.now(), {
      headers: { 'X-Requested-With': 'SPA-Client' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.data) {
        return data.data;
      }
    }
  } catch {
    // fallback
  }

  return {
    maintenance_mode: false,
    community_tab: true,
    tests_tab: true,
    dpp_quiz_tab: true,
    action_buttons: [
      {
        id: 1,
        name: 'Add Batches',
        url: 'https://studystark.in/login/',
        active: true,
        sort_order: 1,
      },
      {
        id: 3,
        name: 'Join Telegram',
        url: 'https://telegram.me/studystark',
        active: true,
        sort_order: 3,
      },
      {
        id: 4,
        name: 'Join WhatsApp',
        url: 'https://www.whatsapp.com/channel/0029Vb7phJILikgEjnTVsx34',
        active: true,
        sort_order: 4,
      },
    ],
    download_button: {
      name: 'Download APK',
      url: 'https://studystark.com/install/',
      active: true,
    },
  };
}

// Favorites helper
export function getFavorites(): string[] {
  try {
    const data = localStorage.getItem(FAVORITES_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function toggleFavorite(batchId: string): boolean {
  const current = getFavorites();
  const exists = current.includes(batchId);
  const updated = exists ? current.filter((id) => id !== batchId) : [batchId, ...current];
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
  return !exists;
}

// Watch History helper
export function getWatchHistory(): WatchHistoryItem[] {
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveWatchHistory(item: Omit<WatchHistoryItem, 'watchedAt'>): void {
  try {
    const list = getWatchHistory();
    const filtered = list.filter((x) => x.id !== item.id && x.title !== item.title);
    const updated: WatchHistoryItem[] = [
      {
        ...item,
        watchedAt: Date.now(),
      },
      ...filtered.slice(0, 49),
    ];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}

export function clearWatchHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}

// Theme helper
export function getStoredTheme(): ThemeId {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    if (
      theme &&
      [
        'dark',
        'sandalwood',
        'forest-emerald',
        'ocean-deep',
        'sakura-blossom',
        'dracula-midnight',
        'lavender-mist',
        'cyberpunk-neon',
        'light',
      ].includes(theme)
    ) {
      return theme as ThemeId;
    }
  } catch {
    // ignore
  }
  return 'dark';
}

export function setStoredTheme(theme: ThemeId): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
    const body = document.body;
    const themeClasses = [
      'sandalwood',
      'forest-emerald',
      'ocean-deep',
      'sakura-blossom',
      'dracula-midnight',
      'lavender-mist',
      'cyberpunk-neon',
      'dark',
      'light',
      'dark-mode',
    ];
    themeClasses.forEach((cls) => body.classList.remove(cls));
    body.classList.add(theme);
    if (theme !== 'light') {
      body.classList.add('dark-mode');
    }
  } catch {
    // ignore
  }
}

function getFallbackBatches(): { batches: BatchItem[]; vidyapeeth: BatchItem[] } {
  return {
    batches: [
      {
        batch_id: '65d862392b1da90018ad8f3b',
        name: 'Lakshya JEE 2025',
        byName: 'For Class 12 JEE 2025 Aspirants',
        language: 'Hinglish',
        exam: 'IIT-JEE',
        photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/1da7fd49-8e2c-44da-a186-5134e41d4d01.png',
        class: '12',
        amount: 5300,
        isVidyapeeth: false,
      },
    ],
    vidyapeeth: [],
  };
}

// ---------- PW Community Feed ----------
export interface PwCommunityChannel {
  batchId: string;
  batchName: string;
}

export interface PwCommunityPost {
  id: string;
  batchId: string;
  batchName: string;
  type: string;
  announcement: string;
  createdAt?: string;
  attachmentUrl?: string;
  attachmentName?: string;
}

export async function fetchPwCommunityFeed(
  batchIds?: string[]
): Promise<{ channels: PwCommunityChannel[]; posts: PwCommunityPost[] }> {
  const qs = new URLSearchParams();
  if (batchIds && batchIds.length > 0) {
    qs.set('batchIds', batchIds.join(','));
  }
  const url = qs.toString() ? `/api/pw/community?${qs.toString()}` : '/api/pw/community';
  const res = await fetch(url, { headers: getPwRequestHeaders() });
  const json = await safeReadJson<any>(res, 'Failed to load community feed');
  return {
    channels: Array.isArray(json.channels) ? json.channels : [],
    posts: Array.isArray(json.posts) ? json.posts : [],
  };
}

// ---------- PW Batch Quizzes & Official Tests ----------
export interface PwBatchQuizItem {
  id: string;
  exerciseId: string;
  title: string;
  batchId: string;
  batchName: string;
  subjectName: string;
  topicId: string;
  topicName: string;
  totalQuestions: number;
  totalMarks: number;
  isDha?: boolean;
}

export async function fetchPwBatchQuizzes(
  batchId: string,
  subjectSlug?: string,
  topicId?: string
): Promise<{
  subjects: Array<{ _id: string; subject: string; slug: string }>;
  activeSubjectSlug: string;
  topics: Array<{ _id: string; name: string; exercises: number }>;
  quizzes: PwBatchQuizItem[];
  officialTests: OfficialBatchTest[];
}> {
  const qs = new URLSearchParams({ batchId });
  if (subjectSlug) qs.set('subjectSlug', subjectSlug);
  if (topicId) qs.set('topicId', topicId);
  const res = await fetch(`/api/pw/quizzes?${qs.toString()}`, {
    headers: getPwRequestHeaders(),
  });
  return safeReadJson(res, 'Failed to load batch tests & quizzes');
}

export async function startPwQuiz(params: {
  exerciseId?: string;
  batchName?: string;
  subjectName?: string;
  topicName?: string;
  title?: string;
  count?: number;
}): Promise<{
  success: boolean;
  source?: string;
  questions: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    topic?: string;
  }>;
}> {
  const res = await fetch('/api/pw/quiz-start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getPwRequestHeaders(),
    },
    body: JSON.stringify(params),
  });
  return safeReadJson(res, 'Unable to start quiz');
}

// ---------- Khazana Explorer ----------
const khazanaOverviewCache = new Map<string, any>();

export async function fetchKhazanaPrograms(): Promise<KhazanaProgramSummary[]> {
  const res = await fetch('/api/khazana/programs', { headers: getPwRequestHeaders() });
  const json = await safeReadJson<{ programs?: KhazanaProgramSummary[] }>(
    res,
    'Failed to load Khazana programs'
  );
  return Array.isArray(json.programs) ? json.programs : [];
}

export async function fetchKhazanaOverview(programId: string): Promise<{
  name?: string;
  subjects: KhazanaSubjectOption[];
  subjectPreviews: Record<string, KhazanaChapter[]>;
  teachers: KhazanaTeacher[];
  paginate?: any;
}> {
  if (khazanaOverviewCache.has(programId)) {
    return khazanaOverviewCache.get(programId);
  }
  const qs = new URLSearchParams({ programId });
  const res = await fetchWithRetry(`/api/khazana/overview?${qs.toString()}`, {
    headers: getPwRequestHeaders(),
  });
  const json = await safeReadJson<any>(res, 'Failed to load Khazana overview');
  khazanaOverviewCache.set(programId, json);
  return json;
}

export async function fetchKhazanaTeachers(
  programId: string,
  page = 1
): Promise<{ teachers: KhazanaTeacher[]; paginate?: any }> {
  const qs = new URLSearchParams({ programId, page: String(page) });
  const res = await fetch(`/api/khazana/teachers?${qs.toString()}`, {
    headers: getPwRequestHeaders(),
  });
  return safeReadJson(res, 'Failed to load Khazana teachers');
}

export async function fetchKhazanaSubjectChapters(
  programId: string,
  subjectId: string,
  page = 1,
  limit = 16
): Promise<{ chapters: KhazanaChapter[]; paginate?: any }> {
  const qs = new URLSearchParams({
    programId,
    subjectId,
    page: String(page),
    limit: String(limit),
  });
  const res = await fetch(`/api/khazana/subject-chapters?${qs.toString()}`, {
    headers: getPwRequestHeaders(),
  });
  return safeReadJson(res, 'Failed to load subject chapters');
}

export async function fetchKhazanaTeacherChapters(
  programId: string,
  teacherId: string,
  page = 1,
  limit = 20
): Promise<{ chapters: KhazanaChapter[]; paginate?: any }> {
  const qs = new URLSearchParams({
    programId,
    teacherId,
    page: String(page),
    limit: String(limit),
  });
  const res = await fetch(`/api/khazana/teacher-chapters?${qs.toString()}`, {
    headers: getPwRequestHeaders(),
  });
  return safeReadJson(res, 'Failed to load teacher chapters');
}

export async function fetchKhazanaTopics(
  programId: string,
  subjectId: string,
  chapterId: string,
  page = 1,
  limit = 20
): Promise<{ topics: KhazanaTopic[]; paginate?: any }> {
  const qs = new URLSearchParams({
    programId,
    subjectId,
    chapterId,
    page: String(page),
    limit: String(limit),
  });
  const res = await fetch(`/api/khazana/topics?${qs.toString()}`, {
    headers: getPwRequestHeaders(),
  });
  return safeReadJson(res, 'Failed to load Khazana topics');
}

export async function fetchKhazanaSubTopics(
  programId: string,
  subjectId: string,
  chapterId: string,
  topicId: string
): Promise<{ subTopics: KhazanaSubTopic[] }> {
  const qs = new URLSearchParams({ programId, subjectId, chapterId, topicId });
  const res = await fetch(`/api/khazana/sub-topics?${qs.toString()}`, {
    headers: getPwRequestHeaders(),
  });
  return safeReadJson(res, 'Failed to load Khazana sub-topics');
}

export async function fetchKhazanaContents(
  programId: string,
  subjectId: string,
  chapterId: string,
  topicId: string,
  subTopicId: string,
  page = 1,
  limit = 20
): Promise<{ items: KhazanaContentItem[]; paginate?: any }> {
  const qs = new URLSearchParams({
    programId,
    subjectId,
    chapterId,
    topicId,
    subTopicId,
    page: String(page),
    limit: String(limit),
  });
  const res = await fetch(`/api/khazana/contents?${qs.toString()}`, {
    headers: getPwRequestHeaders(),
  });
  return safeReadJson(res, 'Failed to load Khazana contents');
}

export function prefetchKhazanaProgram(programId: string): void {
  if (!programId) return;
  fetchKhazanaOverview(programId).catch(() => {});
}

export function prefetchKhazanaTopics(
  programId: string,
  subjectId: string,
  chapterId: string
): void {
  if (!programId || !subjectId || !chapterId) return;
  fetchKhazanaTopics(programId, subjectId, chapterId, 1, 20).catch(() => {});
}

export function prefetchKhazanaTopicFirstContents(
  programId: string,
  subjectId: string,
  chapterId: string,
  topicId: string
): void {
  if (!programId || !subjectId || !chapterId || !topicId) return;
  fetchKhazanaContents(programId, subjectId, chapterId, topicId, 'videos', 1, 20).catch(() => {});
}

// ---------- PW Pi Pro OTT ----------
const piHomeCache = new Map<string, PiHomeResponse>();

export async function fetchPiOttCategories(): Promise<PiCategory[]> {
  const res = await fetch('/api/pi/categories', { headers: getPwRequestHeaders() });
  const json = await safeReadJson<{ categories?: PiCategory[] }>(
    res,
    'Failed to load Pi OTT categories'
  );
  return Array.isArray(json.categories) ? json.categories : [];
}

export async function fetchPiOttHome(
  goalId: string,
  subId = 'all',
  q = ''
): Promise<PiHomeResponse> {
  const cacheKey = `${goalId}:${subId}:${q}`;
  if (!q && piHomeCache.has(cacheKey)) {
    return piHomeCache.get(cacheKey)!;
  }
  const qs = new URLSearchParams({ goalId, subId });
  if (q) qs.set('q', q);
  const res = await fetch(`/api/pi/home?${qs.toString()}`, {
    headers: getPwRequestHeaders(),
  });
  const json = await safeReadJson<PiHomeResponse>(res, 'Failed to load Pi OTT feed');
  if (!q) piHomeCache.set(cacheKey, json);
  return json;
}

export async function fetchPiOttSeriesDetail(params: {
  seriesId: string;
  type?: string;
  programId?: string;
  subjectId?: string;
  topicId?: string;
}): Promise<PiSeriesDetailResponse> {
  const qs = new URLSearchParams({ seriesId: params.seriesId });
  if (params.type) qs.set('type', params.type);
  if (params.programId) qs.set('programId', params.programId);
  if (params.subjectId) qs.set('subjectId', params.subjectId);
  if (params.topicId) qs.set('topicId', params.topicId);
  const res = await fetch(`/api/pi/series?${qs.toString()}`, {
    headers: getPwRequestHeaders(),
  });
  return safeReadJson<PiSeriesDetailResponse>(res, 'Failed to load Pi series details');
}

export async function fetchPiOttTeacherProfile(
  teacherId: string,
  programId?: string
): Promise<PiTeacherProfileResponse> {
  const qs = new URLSearchParams({ teacherId });
  if (programId) qs.set('programId', programId);
  const res = await fetch(`/api/pi/teacher?${qs.toString()}`, {
    headers: getPwRequestHeaders(),
  });
  return safeReadJson<PiTeacherProfileResponse>(res, 'Failed to load faculty profile');
}

export function prefetchPiHome(goalId: string): void {
  if (!goalId) return;
  fetchPiOttHome(goalId, 'all', '').catch(() => {});
}

export async function askPwPi(params: {
  query: string;
  subject?: string;
  mode?: string;
}): Promise<{ success: boolean; answer: string }> {
  const res = await fetch('/api/pi/ask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getPwRequestHeaders(),
    },
    body: JSON.stringify(params),
  });
  return safeReadJson(res, 'Pi Concept Solver failed');
}
