import crypto from 'crypto';
import {
  isCircuitOpen,
  readVaultJson,
  recordUpstreamFailure,
  recordUpstreamSuccess,
  writeVaultJson,
} from './serverVault.ts';

export const STUDYPARCHAM_PW_API = 'https://pw.studyparcham.in/api/data';
export const STUDYPARCHAM_PI_API = 'https://pi.studyparcham.site/api/data';
export const STUDYPARCHAM_VIDEO_API = 'https://pw.studyparcham.in/api/video/';
const SP_VIDEO_SECRET = 'SP_X_NODE_V2_MASTER_2026xuthuxmadman';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface StudyParchamResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  raw: any;
  errorText: string;
  fromVault?: boolean;
}

const batchDetailsCache = new Map<string, { details: any; savedAt: number }>();
const BATCH_DETAILS_CACHE_MS = 5 * 60 * 1000;

interface CachedCloudfrontSig {
  batchId: string;
  subjectId: string;
  videoId: string;
  signedQuery: string;
  expiresAt: number;
}

const cfSigCache = new Map<string, CachedCloudfrontSig>();

function getCfRootFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (!/cloudfront\.net/i.test(parsed.hostname)) return '';
    const hlsIdx = parsed.pathname.indexOf('/hls/');
    if (hlsIdx !== -1) {
      return `${parsed.origin}${parsed.pathname.slice(0, hlsIdx + 1)}`;
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 1) {
      return `${parsed.origin}/${parts[0]}/`;
    }
    return '';
  } catch {
    return '';
  }
}

function decryptStudyParchamVideoPayload(encryptedB64: string): any {
  const raw = Buffer.from(encryptedB64, 'base64');
  const iv = raw.subarray(0, 12);
  const cipherAndTag = raw.subarray(12);
  const tag = cipherAndTag.subarray(cipherAndTag.length - 16);
  const ciphertext = cipherAndTag.subarray(0, cipherAndTag.length - 16);
  const key = crypto.createHash('sha256').update(SP_VIDEO_SECRET).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

export interface StudyParchamVideoStreamResult {
  ok: boolean;
  url: string;
  signedQuery: string;
  drmType?: string;
  keyIdB64?: string;
  keyValB64?: string;
  expiresAt?: number;
}

export async function resolveStudyParchamVideoStream(params: {
  batchId: string;
  subjectId?: string;
  videoId: string;
  findKey?: string;
  videoDetailsId?: string;
}): Promise<StudyParchamVideoStreamResult> {
  const batchId = String(params.batchId || '').trim();
  const rawSubjectId = String(params.subjectId || '').trim();
  const candidateIds = Array.from(
    new Set(
      [params.videoId, params.findKey, params.videoDetailsId]
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )
  );
  if (!batchId || candidateIds.length === 0) {
    return { ok: false, url: '', signedQuery: '' };
  }

  // Return unexpired cached signed URL immediately if available
  const cacheKey = `sp_stream:${batchId}:${candidateIds[0]}`;
  const cachedStream = readVaultJson<StudyParchamVideoStreamResult>(cacheKey);
  if (
    cachedStream?.data?.ok &&
    cachedStream.data.url &&
    cachedStream.data.expiresAt &&
    Date.now() < cachedStream.data.expiresAt - 15000
  ) {
    return cachedStream.data;
  }

  if (isCircuitOpen('studyparcham_video')) {
    return { ok: false, url: '', signedQuery: '' };
  }

  let subjectId = 'ABC';
  if (rawSubjectId) {
    subjectId = (await resolveStudyParchamSubjectId(batchId, rawSubjectId)) || rawSubjectId;
  }

  let sawTransportOrBlockedError = false;

  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) {
      if (isCircuitOpen('studyparcham_video')) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    const idsForPass = pass === 0 ? candidateIds : candidateIds.slice(0, 1);
    for (const cid of idsForPass) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      try {
        const ts = Math.floor(Date.now() / 1000).toString();
        const sig = crypto
          .createHmac('sha256', SP_VIDEO_SECRET)
          .update(`${ts}${SP_VIDEO_SECRET}`)
          .digest('hex');

        const qs = new URLSearchParams({
          batchId,
          contentId: cid,
          subjectId,
          batch_id: batchId,
          video_id: cid,
          subject_id: subjectId,
        });

        const res = await fetch(`${STUDYPARCHAM_VIDEO_API}?${qs.toString()}`, {
          signal: controller.signal,
          headers: {
            'x-sp-time': ts,
            'x-sp-signature': sig,
            Origin: 'https://pw.studyparcham.in',
            Referer: 'https://pw.studyparcham.in/',
            Accept: 'application/json, text/plain, */*',
            'User-Agent': DEFAULT_UA,
          },
        });

        const rawText = await res.text().catch(() => '');
        if (res.status === 403 && /cloudflare|attention required|just a moment/i.test(rawText)) {
          recordUpstreamFailure('studyparcham_video', 'Cloudflare 403', true);
          return { ok: false, url: '', signedQuery: '' };
        }
        let json: any = null;
        try {
          json = JSON.parse(rawText);
        } catch {
          json = null;
        }
        if (!res.ok || !json) {
          if (res.status >= 500 || res.status === 404) {
            sawTransportOrBlockedError = res.status >= 502;
          }
          continue;
        }

        let payload = json;
        if (json.encryptedData) {
          try {
            payload = decryptStudyParchamVideoPayload(String(json.encryptedData));
          } catch {
            continue;
          }
        }

        const d = payload?.data || payload;
        const baseUrl = String(d?.url || '').trim();
        const signedQueryRaw = String(d?.signedUrl || '').trim();
        if (!baseUrl) continue;

        const signedQuery = signedQueryRaw.startsWith('?')
          ? signedQueryRaw.slice(1)
          : signedQueryRaw;
        const fullUrl =
          signedQuery && !baseUrl.includes('Signature=')
            ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${signedQuery}`
            : baseUrl;

        const expiresAt = Number(d?.signatureExpireAt || 0) || Date.now() + 90 * 1000;
        const cfRoot = getCfRootFromUrl(baseUrl);
        if (cfRoot && signedQuery) {
          cfSigCache.set(cfRoot, {
            batchId,
            subjectId,
            videoId: cid,
            signedQuery,
            expiresAt,
          });
        }

        const drm = d?.drmDetails || {};
        const result: StudyParchamVideoStreamResult = {
          ok: true,
          url: fullUrl,
          signedQuery,
          drmType: String(d?.drmType || drm?.type || ''),
          keyIdB64: String(d?.keyId || drm?.kid || drm?.keyId || ''),
          keyValB64: String(d?.key || drm?.key || drm?.keyValue || ''),
          expiresAt,
        };
        recordUpstreamSuccess('studyparcham_video');
        writeVaultJson(cacheKey, result);
        return result;
      } catch {
        sawTransportOrBlockedError = true;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  if (sawTransportOrBlockedError) {
    recordUpstreamFailure('studyparcham_video', 'StudyParcham video upstream unavailable');
  }
  return { ok: false, url: '', signedQuery: '' };
}

function attachSigQueryToUrl(rawUrl: string, sigQuery: string): string {
  if (!sigQuery) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    const sigParams = new URLSearchParams(sigQuery.startsWith('?') ? sigQuery.slice(1) : sigQuery);
    sigParams.forEach((v, k) => {
      parsed.searchParams.set(k, v);
    });
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function applyCachedStudyParchamSig(rawUrl: string): string {
  const cfRoot = getCfRootFromUrl(rawUrl);
  if (!cfRoot) return rawUrl;
  const cached = cfSigCache.get(cfRoot);
  if (!cached || !cached.signedQuery) return rawUrl;
  if (Date.now() < cached.expiresAt - 15000) {
    return attachSigQueryToUrl(rawUrl, cached.signedQuery);
  }
  return rawUrl;
}

export async function refreshStudyParchamSigForUrl(rawUrl: string): Promise<string | null> {
  const cfRoot = getCfRootFromUrl(rawUrl);
  if (!cfRoot) return null;
  const cached = cfSigCache.get(cfRoot);
  if (!cached) return null;

  if (Date.now() < cached.expiresAt - 45000 && cached.signedQuery) {
    return attachSigQueryToUrl(rawUrl, cached.signedQuery);
  }

  const fresh = await resolveStudyParchamVideoStream({
    batchId: cached.batchId,
    subjectId: cached.subjectId,
    videoId: cached.videoId,
  });
  if (fresh.ok && fresh.signedQuery) {
    return attachSigQueryToUrl(rawUrl, fresh.signedQuery);
  }
  return null;
}

function makePwVaultKey(action: string, params: Record<string, any>): string {
  const ordered = Object.keys(params || {})
    .sort()
    .map((k) => `${k}=${String(params[k] ?? '')}`)
    .join('&');
  return `sp_pw:${action}:${ordered}`;
}

export async function callStudyParchamPw<T = any>(
  action: string,
  params: Record<string, any> = {},
  method: 'GET' | 'POST' = 'GET',
  payload: any = null,
  timeoutMs = 12000
): Promise<StudyParchamResult<T>> {
  const vaultKey = method === 'GET' ? makePwVaultKey(action, params) : '';

  if (isCircuitOpen('studyparcham_pw')) {
    if (vaultKey) {
      const snap = readVaultJson<{ inner: T; raw: any }>(vaultKey);
      if (snap?.data?.inner !== undefined) {
        return {
          ok: true,
          status: 200,
          data: snap.data.inner,
          raw: snap.data.raw,
          errorText: '',
          fromVault: true,
        };
      }
    }
    return {
      ok: false,
      status: 503,
      data: null,
      raw: null,
      errorText: 'StudyParcham mirror is temporarily paused (circuit open)',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(STUDYPARCHAM_PW_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://pw.studyparcham.in',
        Referer: 'https://pw.studyparcham.in/',
        'User-Agent': DEFAULT_UA,
      },
      body: JSON.stringify({ action, params, method, payload }),
    });

    const text = await res.text().catch(() => '');
    if (res.status === 403 && /cloudflare|attention required|just a moment/i.test(text)) {
      recordUpstreamFailure('studyparcham_pw', 'Cloudflare 403', true);
    }

    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!res.ok || !json || json.success === false) {
      if (res.status >= 502 || !json) {
        recordUpstreamFailure('studyparcham_pw', `HTTP ${res.status}`);
      }
      if (vaultKey) {
        const snap = readVaultJson<{ inner: T; raw: any }>(vaultKey);
        if (snap?.data?.inner !== undefined) {
          return {
            ok: true,
            status: 200,
            data: snap.data.inner,
            raw: snap.data.raw,
            errorText: '',
            fromVault: true,
          };
        }
      }
      return {
        ok: false,
        status: json?.statusCode || res.status || 502,
        data: null,
        raw: json,
        errorText:
          json?.error?.message ||
          json?.message ||
          (text && !text.startsWith('<') ? text.slice(0, 200) : `StudyParcham error (${res.status})`),
      };
    }

    recordUpstreamSuccess('studyparcham_pw');
    const inner = json.data !== undefined ? json.data : json;
    if (action === 'pw_btch_dtl' && params?.batchId && inner) {
      batchDetailsCache.set(String(params.batchId), { details: inner, savedAt: Date.now() });
    }
    if (vaultKey && inner !== undefined && inner !== null) {
      writeVaultJson(vaultKey, { inner, raw: json });
    }

    return {
      ok: true,
      status: json.statusCode || res.status || 200,
      data: inner as T,
      raw: json,
      errorText: '',
    };
  } catch (err: any) {
    recordUpstreamFailure('studyparcham_pw', err?.message || 'Network error');
    if (vaultKey) {
      const snap = readVaultJson<{ inner: T; raw: any }>(vaultKey);
      if (snap?.data?.inner !== undefined) {
        return {
          ok: true,
          status: 200,
          data: snap.data.inner,
          raw: snap.data.raw,
          errorText: '',
          fromVault: true,
        };
      }
    }
    return {
      ok: false,
      status: err?.name === 'AbortError' ? 504 : 502,
      data: null,
      raw: null,
      errorText: err?.message || 'StudyParcham network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function callStudyParchamPi<T = any>(
  action: string,
  params: Record<string, any> = {},
  method: 'GET' | 'POST' = 'GET',
  payload: any = null,
  timeoutMs = 10000
): Promise<StudyParchamResult<T>> {
  const vaultKey = method === 'GET' ? `sp_pi:${makePwVaultKey(action, params)}` : '';
  if (isCircuitOpen('studyparcham_pi')) {
    if (vaultKey) {
      const snap = readVaultJson<{ inner: T; raw: any }>(vaultKey);
      if (snap?.data?.inner !== undefined) {
        return { ok: true, status: 200, data: snap.data.inner, raw: snap.data.raw, errorText: '', fromVault: true };
      }
    }
    return { ok: false, status: 503, data: null, raw: null, errorText: 'Pi mirror paused' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(STUDYPARCHAM_PI_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://pi.studyparcham.site',
        Referer: 'https://pi.studyparcham.site/',
        'User-Agent': DEFAULT_UA,
      },
      body: JSON.stringify({ action, params, method, payload }),
    });
    const text = await res.text().catch(() => '');
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (!res.ok || !json || json.success === false || json.code === 401) {
      if (res.status >= 502 || !json) {
        recordUpstreamFailure('studyparcham_pi', `HTTP ${res.status}`);
      }
      if (vaultKey) {
        const snap = readVaultJson<{ inner: T; raw: any }>(vaultKey);
        if (snap?.data?.inner !== undefined) {
          return { ok: true, status: 200, data: snap.data.inner, raw: snap.data.raw, errorText: '', fromVault: true };
        }
      }
      return {
        ok: false,
        status: json?.httpStatus || json?.statusCode || res.status || 502,
        data: null,
        raw: json,
        errorText: json?.message || `StudyParcham Pi error (${res.status})`,
      };
    }
    recordUpstreamSuccess('studyparcham_pi');
    const inner = (json.data !== undefined ? json.data : json) as T;
    if (vaultKey && inner !== undefined && inner !== null) {
      writeVaultJson(vaultKey, { inner, raw: json });
    }
    return {
      ok: true,
      status: res.status || 200,
      data: inner,
      raw: json,
      errorText: '',
    };
  } catch (err: any) {
    recordUpstreamFailure('studyparcham_pi', err?.message || 'Pi network error');
    if (vaultKey) {
      const snap = readVaultJson<{ inner: T; raw: any }>(vaultKey);
      if (snap?.data?.inner !== undefined) {
        return { ok: true, status: 200, data: snap.data.inner, raw: snap.data.raw, errorText: '', fromVault: true };
      }
    }
    return {
      ok: false,
      status: 502,
      data: null,
      raw: null,
      errorText: err?.message || 'StudyParcham Pi network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getStudyParchamBatchDetails(batchId: string): Promise<any | null> {
  const cached = batchDetailsCache.get(batchId);
  if (cached && Date.now() - cached.savedAt < BATCH_DETAILS_CACHE_MS) {
    return cached.details;
  }
  const res = await callStudyParchamPw('pw_btch_dtl', { batchId });
  if (res.ok && res.data) {
    batchDetailsCache.set(batchId, { details: res.data, savedAt: Date.now() });
    writeVaultJson(`batch_details:${batchId}`, res.data);
    return res.data;
  }
  const vault = readVaultJson<any>(`batch_details:${batchId}`);
  return vault?.data || cached?.details || null;
}

export async function resolveStudyParchamSubjectId(
  batchId: string,
  subjectSlugOrId: string
): Promise<string> {
  if (!subjectSlugOrId) return '';
  if (/^[a-f0-9]{24}$/i.test(subjectSlugOrId)) {
    return subjectSlugOrId;
  }
  const details = await getStudyParchamBatchDetails(batchId);
  const subjects: any[] = Array.isArray(details?.subjects) ? details.subjects : [];
  const lower = subjectSlugOrId.toLowerCase();
  const matched = subjects.find(
    (s) =>
      String(s?._id || '') === subjectSlugOrId ||
      String(s?.slug || '').toLowerCase() === lower ||
      String(s?.subject || '').toLowerCase() === lower
  );
  return matched?._id ? String(matched._id) : subjectSlugOrId;
}

export function cacheBatchDetailsForStudyParcham(batchId: string, details: any): void {
  if (batchId && details) {
    batchDetailsCache.set(batchId, { details, savedAt: Date.now() });
    writeVaultJson(`batch_details:${batchId}`, details);
  }
}

