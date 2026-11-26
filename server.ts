import express from 'express';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Content, Part } from '@google/genai';
import {
  callStudyParchamPw,
  getStudyParchamBatchDetails,
  resolveStudyParchamSubjectId,
  cacheBatchDetailsForStudyParcham,
  resolveStudyParchamVideoStream,
  applyCachedStudyParchamSig,
  refreshStudyParchamSigForUrl,
} from './serverStudyParcham.ts';
import { registerFeatureRoutes } from './serverFeatureRoutes.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const VIDCLOUD_API_BASE = 'https://vidcloud.eu.org/api';
const PENPENCIL_API_BASE = 'https://api.penpencil.co';
const AES_KEY = Buffer.from('UjdAa1A0I3hMOSFtUTIkdg==', 'base64');
const AES_IV = Buffer.from('VDMhblc4JHFaNUBySzEjcA==', 'base64');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Server-side token cache
let cachedToken: string | null = null;
let tokenFetchedAt = 0;
let vidcloudBlockedUntil = 0;
const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const VIDCLOUD_BLOCK_COOLDOWN_MS = 60 * 1000; // 1 minute cooldown on Cloudflare 403

// Server-side batches cache
let cachedBatchesPayload: any = null;
let batchesFetchedAt = 0;
const BATCHES_TTL_MS = 60 * 60 * 1000; // 1 hour

function isCloudflareBlockHtml(status: number, body: string): boolean {
  if (status !== 403 && status !== 503) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes('cloudflare') ||
    lower.includes('attention required') ||
    lower.includes('you have been blocked') ||
    lower.includes('just a moment...') ||
    lower.includes('cf-error-details')
  );
}

function getRequestUserToken(req: express.Request): string {
  const headerToken = String(req.headers['x-pw-token'] || '').trim();
  if (headerToken) return headerToken.replace(/^Bearer\s+/i, '');

  const cookieHeader = String(req.headers.cookie || '');
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === 'pw_token' && rest.length > 0) {
        try {
          const val = decodeURIComponent(rest.join('=')).trim();
          if (val) return val;
        } catch {
          // ignore malformed cookie
        }
      }
    }
  }

  return String(process.env.PW_ACCESS_TOKEN || '').trim();
}

async function getBearerToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && Date.now() - tokenFetchedAt < TOKEN_TTL_MS) {
    return cachedToken;
  }
  if (Date.now() < vidcloudBlockedUntil) {
    if (cachedToken) return cachedToken;
    const err = new Error('VidCloud token endpoint is temporarily blocked by Cloudflare.');
    (err as any).code = 'VIDCLOUD_BLOCKED';
    throw err;
  }

  try {
    const res = await fetch(`https://vidcloud.eu.org/generate_token.php?_t=${Date.now()}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://vidcloud.eu.org/',
        Accept: 'application/json, text/plain, */*',
      },
    });
    const rawText = await res.text().catch(() => '');
    if (isCloudflareBlockHtml(res.status, rawText)) {
      vidcloudBlockedUntil = Date.now() + VIDCLOUD_BLOCK_COOLDOWN_MS;
      if (cachedToken) return cachedToken;
      const err = new Error('VidCloud token server blocked this server IP (Cloudflare 403).');
      (err as any).code = 'VIDCLOUD_BLOCKED';
      throw err;
    }
    if (!res.ok) {
      if (cachedToken) return cachedToken;
      throw new Error(`Token fetch failed with status ${res.status}`);
    }
    let json: any = {};
    try {
      json = JSON.parse(rawText);
    } catch {
      json = {};
    }
    const token = json.access_token || json.token;
    if (!token) {
      // generate_token.php sometimes rate-limits rapid requests; keep existing valid token if available
      if (cachedToken) return cachedToken;
      throw new Error('Token missing from generate_token.php response');
    }
    cachedToken = token;
    tokenFetchedAt = Date.now();
    return token;
  } catch (err) {
    if (cachedToken) return cachedToken;
    throw err;
  }
}

function sortBatchesNewestFirst(list: any[]): any[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const item of list) {
    const id = item?.batch_id || item?._id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push(item);
  }
  const activeHorizonMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
  return deduped.sort((a, b) => {
    const ta = a?.start_date ? Date.parse(a.start_date) : 0;
    const tb = b?.start_date ? Date.parse(b.start_date) : 0;
    const va = Number.isFinite(ta) ? ta : 0;
    const vb = Number.isFinite(tb) ? tb : 0;

    // Demote far-future placeholder batches (e.g. late 2027 / 2028) below active batches
    const aFuture = va > activeHorizonMs ? 1 : 0;
    const bFuture = vb > activeHorizonMs ? 1 : 0;
    if (aFuture !== bFuture) return aFuture - bFuture;

    // Within same tier, prefer entries with cover image and valid exam metadata slightly if dates tie
    if (vb !== va) return vb - va;
    const aReady = (a?.photo ? 1 : 0) + (a?.exam ? 1 : 0);
    const bReady = (b?.photo ? 1 : 0) + (b?.exam ? 1 : 0);
    return bReady - aReady;
  });
}

function buildPwHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'Client-Id': '5eb393ee95fab7468a79d189',
    'Client-Type': 'WEB',
    'Client-Version': '2.1.6',
    Origin: 'https://www.pw.live',
    Referer: 'https://www.pw.live/',
    Randomid: crypto.randomUUID(),
    Version: '0.0.1',
    'User-Agent': USER_AGENT,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

const UNLOCK_CONTENTS_BATCH_ID = '634bd315ed7a360018558283';
const scheduleCache = new Map<string, { data: any; savedAt: number }>();
const SCHEDULE_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

interface UpstreamResult {
  ok: boolean;
  status: number;
  data: any;
  errorText: string;
  needsPwLogin?: boolean;
}

async function fetchPublicPenPencilRaw(apiPath: string): Promise<UpstreamResult> {
  try {
    const res = await fetch(`${PENPENCIL_API_BASE}${apiPath}`, {
      headers: buildPwHeaders(),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, status: res.status, data: null, errorText: errText };
    }
    const data = await res.json().catch(() => null);
    return { ok: true, status: res.status, data, errorText: '' };
  } catch (err: any) {
    return { ok: false, status: 502, data: null, errorText: err?.message || 'Network error' };
  }
}

async function fetchPenPencilWithToken(
  base: string,
  apiPath: string,
  token: string
): Promise<UpstreamResult> {
  try {
    const res = await fetch(`${base}${apiPath}`, {
      headers: buildPwHeaders(token),
    });
    const rawText = await res.text().catch(() => '');
    if (base === VIDCLOUD_API_BASE && isCloudflareBlockHtml(res.status, rawText)) {
      vidcloudBlockedUntil = Date.now() + VIDCLOUD_BLOCK_COOLDOWN_MS;
      return {
        ok: false,
        status: 403,
        data: null,
        errorText: 'Cloudflare blocked vidcloud proxy',
      };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, data: null, errorText: rawText };
    }
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
    return { ok: true, status: res.status, data, errorText: '' };
  } catch (err: any) {
    return { ok: false, status: 502, data: null, errorText: err?.message || 'Upstream network error' };
  }
}

async function fetchVidcloudApiRaw(
  apiPath: string,
  userToken?: string
): Promise<UpstreamResult> {
  // 1. If the user signed in with their own PW token, talk directly to api.penpencil.co
  if (userToken) {
    const directRes = await fetchPenPencilWithToken(PENPENCIL_API_BASE, apiPath, userToken);
    return directRes;
  }

  // 2. Try shared token from vidcloud.eu.org/generate_token.php
  let token = '';
  try {
    token = await getBearerToken(false);
  } catch (err: any) {
    return {
      ok: false,
      status: 401,
      data: null,
      errorText:
        err?.code === 'VIDCLOUD_BLOCKED'
          ? 'Shared content token server is temporarily blocked by Cloudflare. Please sign in with your Physics Wallah account (OTP) to load chapters, notes, and lectures.'
          : err?.message || 'Could not obtain upstream session token.',
      needsPwLogin: true,
    };
  }

  // Prefer direct api.penpencil.co with the token (avoids Cloudflare blocks on vidcloud.eu.org/api)
  let res = await fetchPenPencilWithToken(PENPENCIL_API_BASE, apiPath, token);

  // Refresh bearer token ONLY on 401 (expired/invalid token)
  if (res.status === 401) {
    try {
      token = await getBearerToken(true);
      res = await fetchPenPencilWithToken(PENPENCIL_API_BASE, apiPath, token);
    } catch {
      // ignore refresh failure
    }
  }

  // Fallback to vidcloud.eu.org/api if direct api.penpencil.co failed and vidcloud is not in cooldown
  if (!res.ok && Date.now() >= vidcloudBlockedUntil && res.status !== 404) {
    const proxyRes = await fetchPenPencilWithToken(VIDCLOUD_API_BASE, apiPath, token);
    if (proxyRes.ok) return proxyRes;
  }

  if (res.status === 401) {
    res.needsPwLogin = true;
  }
  return res;
}

function extractPenPencilErrorMessage(errorText: string, fallback: string): string {
  if (!errorText) return fallback;
  try {
    const parsed = JSON.parse(errorText);
    const msg = parsed?.error?.message || parsed?.message || parsed?.data;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  } catch {
    // plain text
  }
  if (errorText.toLowerCase().includes('<html')) return fallback;
  return errorText.slice(0, 180) || fallback;
}

function normalizeAttachment(att: any) {
  const rawBase = String(att?.baseUrl || '').replace(/^https?:\/\/cors\.testfile\.eu\.org\//i, 'https://');
  const key = String(att?.key || '').trim();
  const resolvedUrl = att?.url
    ? String(att.url).replace(/^https?:\/\/cors\.testfile\.eu\.org\//i, 'https://')
    : rawBase && key
    ? `${rawBase.endsWith('/') ? rawBase : `${rawBase}/`}${key.replace(/^\//, '')}`
    : '';
  return {
    ...att,
    baseUrl: rawBase,
    key,
    resolvedUrl,
  };
}

function normalizeNoteItems(items: any[]): any[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    ...item,
    homeworkIds: Array.isArray(item?.homeworkIds)
      ? item.homeworkIds.map((hw: any) => ({
          ...hw,
          attachmentIds: Array.isArray(hw?.attachmentIds)
            ? hw.attachmentIds.map(normalizeAttachment)
            : [],
        }))
      : [],
  }));
}

function getIstDateKey(isoStr?: string): string {
  if (!isoStr) return '';
  const ts = Date.parse(isoStr);
  if (!Number.isFinite(ts)) return '';
  const ist = new Date(ts + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function dedupeById<T>(list: T[], getKey: (item: T) => string | undefined | null): T[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    const key = getKey(item);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(item);
  }
  return out;
}

function mergeScheduleById(primary: any[], secondary: any[]): any[] {
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const item of [...primary, ...secondary]) {
    if (!item?._id) continue;
    const id = String(item._id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(item);
  }
  return merged.sort((a, b) => {
    const ta = Date.parse(a?.startTime || a?.date || '') || 0;
    const tb = Date.parse(b?.startTime || b?.date || '') || 0;
    return ta - tb;
  });
}

function buildTeacherAndSubjectMaps(details: any) {
  const teacherMap = new Map<string, string>();
  const subjectById = new Map<string, { name: string; slug: string }>();

  const subjects = Array.isArray(details?.subjects) ? details.subjects : [];
  for (const subj of subjects) {
    if (subj?._id) {
      subjectById.set(String(subj._id), {
        name: subj.subject || subj.name || 'Subject',
        slug: subj.slug || String(subj._id),
      });
    }
    const tList = Array.isArray(subj?.teacherIds) ? subj.teacherIds : [];
    for (const t of tList) {
      if (t?._id) {
        const fullName = [t.firstName, t.lastName].filter(Boolean).join(' ').trim();
        if (fullName) teacherMap.set(String(t._id), fullName);
      }
    }
  }
  return { teacherMap, subjectById };
}

function enrichScheduleItems(items: any[], details: any): any[] {
  const { teacherMap, subjectById } = buildTeacherAndSubjectMaps(details);
  const now = Date.now();

  return items.map((rawItem) => {
    const outerType = String(rawItem?.type || '').toUpperCase();
    const wrapper =
      rawItem?.bulkScheduleDetails ||
      rawItem?.scheduleDetails ||
      rawItem?.notesDetails ||
      (rawItem?.videoDetails && (rawItem.videoDetails.startTime || rawItem.videoDetails.date || rawItem.videoDetails.topic)
        ? rawItem.videoDetails
        : null);
    const item = wrapper ? { ...rawItem, ...wrapper, _id: rawItem._id || wrapper._id, type: rawItem.type || wrapper.type } : rawItem;

    const subjMeta =
      (item?.batchSubjectId && subjectById.get(String(item.batchSubjectId))) ||
      (item?.subjectId?._id && subjectById.get(String(item.subjectId._id))) ||
      null;
    const subjectName = item?.subjectId?.name || subjMeta?.name || 'General';
    const subjectSlug = item?.subjectId?.slug || subjMeta?.slug || String(item?.batchSubjectId || '');

    const rawTeachers = Array.isArray(item?.teachers) ? item.teachers : [];
    const teacherNames = rawTeachers
      .map((t: any) => {
        if (typeof t === 'string') return teacherMap.get(t) || '';
        const name = [t?.firstName, t?.lastName].filter(Boolean).join(' ').trim() || t?.name || '';
        return name;
      })
      .filter(Boolean);

    const startTs = Date.parse(item?.startTime || item?.date || '') || 0;
    const endTs = Date.parse(item?.endTime || '') || (startTs ? startTs + 2 * 60 * 60 * 1000 : 0);
    const rawStatus = String(item?.status || '').toUpperCase();
    let liveStatus: 'LIVE' | 'UPCOMING' | 'COMPLETED' = 'COMPLETED';
    if (startTs && endTs && now >= startTs && now <= endTs && rawStatus !== 'COMPLETED' && rawStatus !== 'CANCELED') {
      liveStatus = 'LIVE';
    } else if (startTs && now < startTs) {
      liveStatus = 'UPCOMING';
    } else if (rawStatus === 'PENDING' && startTs > now) {
      liveStatus = 'UPCOMING';
    } else if (rawStatus === 'LIVE') {
      liveStatus = 'LIVE';
    }

    const homeworkList = Array.isArray(item?.homeworkIds)
      ? item.homeworkIds.map((hw: any) => ({
          ...hw,
          attachmentIds: Array.isArray(hw?.attachmentIds)
            ? hw.attachmentIds.map(normalizeAttachment)
            : [],
        }))
      : [];

    const firstTag = Array.isArray(item?.tags) && item.tags.length > 0 ? item.tags[0] : null;
    const dateKey = getIstDateKey(item?.startTime || item?.date);
    const resolvedTopic =
      item?.topic ||
      item?.videoDetails?.name ||
      homeworkList[0]?.topic ||
      rawItem?.topic ||
      'Scheduled Session';

    return {
      ...item,
      type: outerType || item?.type,
      topic: resolvedTopic,
      dateKey,
      subjectName,
      subjectSlug,
      topicName: firstTag?.name || '',
      topicId: firstTag?._id || '',
      teacherNames,
      liveStatus,
      homeworkIds: homeworkList,
    };
  }).sort((a, b) => {
    const ta = Date.parse(a?.startTime || a?.date || '') || 0;
    const tb = Date.parse(b?.startTime || b?.date || '') || 0;
    return ta - tb;
  });
}

function enrichRoutineItems(items: any[], details: any): any[] {
  const { teacherMap } = buildTeacherAndSubjectMaps(details);
  return items
    .map((r) => ({
      ...r,
      teacherNames: (Array.isArray(r.teachers) ? r.teachers : [])
        .map((t: any) => (typeof t === 'string' ? teacherMap.get(t) || '' : t?.name || ''))
        .filter(Boolean),
    }))
    .sort((a, b) => a.weekday - b.weekday);
}

function decryptAesCbc(b64: string): string {
  if (!b64 || !b64.trim()) return '';
  const trimmed = b64.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', AES_KEY, AES_IV);
    let out = decipher.update(trimmed, 'base64', 'utf8');
    out += decipher.final('utf8');
    return out;
  } catch {
    return '';
  }
}

function extractHiddenInput(html: string, id: string): string {
  const re = new RegExp(`<input[^>]*id=["']${id}["'][^>]*value=["']([^"']*)["']`, 'i');
  const m = html.match(re);
  if (m) return decodeHtmlEntities(m[1]);
  const reAlt = new RegExp(`<input[^>]*value=["']([^"']*)["'][^>]*id=["']${id}["']`, 'i');
  const mAlt = html.match(reAlt);
  return mAlt ? decodeHtmlEntities(mAlt[1]) : '';
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
}

function b64UrlToHex(b64url: string): string {
  if (!b64url) return '';
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('hex');
}

function extractYoutubeEmbed(url: string): string | null {
  if (!url) return null;
  const regExp = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;
  const match = url.match(regExp);
  if (match && match[1]) {
    return `https://www.youtube.com/embed/${match[1]}?autoplay=1&rel=0`;
  }
  return null;
}

function isAllowedProxyHost(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const h = parsed.hostname.toLowerCase();
    // Block localhost/private metadata IPs
    if (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '0.0.0.0' ||
      h.startsWith('10.') ||
      h.startsWith('192.168.') ||
      h.startsWith('169.254.') ||
      h.endsWith('.local')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function createApiApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  function inferExamFromTitle(name: string): string {
    const n = name.toLowerCase();
    if (/iit[\s-]*jee|\bjee\b|prayas|arjuna jee|lakshya jee|manzil/i.test(n)) return 'IIT-JEE';
    if (/\bneet\b|yakeen|arjuna neet|lakshya neet|umeed|pnst|nursing/i.test(n)) return 'NEET';
    if (/\bupsc\b|ias\b|csat|sankalp|prahar/i.test(n)) return 'UPSC';
    if (/\bclat\b|law\b/i.test(n)) return 'CLAT';
    if (/\bssc\b|cgl|chsl|mts|railways/i.test(n)) return 'SSC';
    if (/\bgate\b/i.test(n)) return 'GATE';
    if (/\bnda\b|\bcds\b|defence|afcat/i.test(n)) return 'Defence';
    if (/\bcommerce\b|\bca\b|cuet/i.test(n)) return 'Commerce';
    if (/class[\s-]*(9|10|11|12)|udaan|neev|board|project\s*(45|60)/i.test(n)) return 'Boards';
    return '';
  }

  function inferClassFromTitle(name: string): string {
    const n = name.toLowerCase();
    if (/dropper|prayas|yakeen|12\+/i.test(n)) return 'Dropper';
    if (/class[\s-]*12\b|\b12th\b|lakshya/i.test(n)) return '12';
    if (/class[\s-]*11\b|\b11th\b|arjuna/i.test(n)) return '11';
    if (/class[\s-]*10\b|\b10th\b|udaan/i.test(n)) return '10';
    if (/class[\s-]*9\b|\b9th\b|neev/i.test(n)) return '9';
    return '';
  }

  function parseIsoDateSafe(raw: any, fallbackIso = ''): string {
    if (!raw) return fallbackIso;
    const str = String(raw).trim();
    if (!str) return fallbackIso;
    const ms = Date.parse(str);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
    return fallbackIso;
  }

  function normalizeExternalBatch(b: any, isVidyapeeth = false, defaultDateIso = ''): any | null {
    const batchId = String(b?.batch_id || b?._id || b?.id || '').trim();
    const name = String(b?.name || b?.batchName || '').trim();
    if (!batchId || !name) return null;

    let photo = '';
    if (typeof b?.photo === 'string' && b.photo) photo = b.photo;
    else if (typeof b?.imageUrl === 'string' && b.imageUrl) photo = b.imageUrl;
    else if (typeof b?.previewImage === 'string' && b.previewImage) photo = b.previewImage;
    else if (b?.previewImage?.baseUrl && b?.previewImage?.key) {
      photo = `${b.previewImage.baseUrl}${b.previewImage.key}`;
    }

    const exam = String(b?.exam || '').trim() || inferExamFromTitle(name);
    const cls = String(b?.class || b?.className || '').trim() || inferClassFromTitle(name);

    return {
      batch_id: batchId,
      name,
      byName: String(b?.byName || (b?.slug ? '' : 'PW StudyParcham Batch')).trim(),
      language: String(b?.language || 'Hinglish').trim(),
      exam,
      photo,
      class: cls,
      start_date: parseIsoDateSafe(b?.start_date || b?.startDate, defaultDateIso),
      end_date: parseIsoDateSafe(b?.end_date || b?.endDate, ''),
      amount: Number(b?.amount ?? b?.feeTotal ?? 0) || 0,
      ...(isVidyapeeth ? { isVidyapeeth: true } : {}),
    };
  }

  async function fetchJsonSafe(url: string, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<any | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: controller.signal, headers });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensureBatchesCatalog(): Promise<{ batches: any[]; vidyapeeth: any[]; rawPayload: any }> {
    if (cachedBatchesPayload && Date.now() - batchesFetchedAt < BATCHES_TTL_MS) {
      return {
        batches: cachedBatchesPayload.data || [],
        vidyapeeth: cachedBatchesPayload.vidyapeeth_batches || [],
        rawPayload: cachedBatchesPayload,
      };
    }

    const spHeaders = {
      'User-Agent': USER_AGENT,
      Referer: 'https://pw.studyparcham.in/',
    };

    const [ssRes, spApiRes, spBatchaRes, spAllRes] = await Promise.allSettled([
      fetchJsonSafe(`https://studystark.github.io/batches/batches.json?_t=${Date.now()}`, { 'User-Agent': USER_AGENT }, 18000),
      fetchJsonSafe('https://pw.studyparcham.in/api/batches', spHeaders, 10000),
      fetchJsonSafe('https://pw.studyparcham.in/data/batcha.json', spHeaders, 18000),
      fetchJsonSafe('https://pw.studyparcham.in/data/allbatches.json', spHeaders, 18000),
    ]);

    const ssJson = ssRes.status === 'fulfilled' ? ssRes.value : null;
    const spApiJson = spApiRes.status === 'fulfilled' ? spApiRes.value : null;
    const spBatchaJson = spBatchaRes.status === 'fulfilled' ? spBatchaRes.value : null;
    const spAllJson = spAllRes.status === 'fulfilled' ? spAllRes.value : null;

    if (!ssJson && !spBatchaJson && !spAllJson && !spApiJson) {
      if (cachedBatchesPayload) {
        return {
          batches: cachedBatchesPayload.data || [],
          vidyapeeth: cachedBatchesPayload.vidyapeeth_batches || [],
          rawPayload: cachedBatchesPayload,
        };
      }
      throw new Error('Failed to load batches catalog from upstreams');
    }

    const batchMap = new Map<string, any>();
    const vidyapeethMap = new Map<string, any>();

    const upsertBatch = (targetMap: Map<string, any>, rawItem: any, isVp = false, defaultDateIso = '') => {
      const item = normalizeExternalBatch(rawItem, isVp, defaultDateIso);
      if (!item) return;
      const existing = targetMap.get(item.batch_id);
      if (!existing) {
        targetMap.set(item.batch_id, item);
      } else {
        targetMap.set(item.batch_id, {
          ...item,
          ...existing,
          photo: existing.photo || item.photo,
          exam: existing.exam || item.exam,
          class: existing.class || item.class,
          byName: existing.byName || item.byName,
          start_date: existing.start_date || item.start_date,
          end_date: existing.end_date || item.end_date,
          amount: existing.amount || item.amount,
        });
      }
    };

    // 1. Base catalog from StudyStark
    for (const b of ssJson?.data || []) upsertBatch(batchMap, b, false);
    for (const b of ssJson?.vidyapeeth_batches || []) upsertBatch(vidyapeethMap, b, true);

    // 2. StudyParcham batcha.json (includes newer PW + Vidyapeeth batches missing in StudyStark)
    const spBatchaMain = Array.isArray(spBatchaJson)
      ? spBatchaJson
      : spBatchaJson?.data || spBatchaJson?.batches || [];
    for (const b of spBatchaMain) upsertBatch(batchMap, b, false);
    for (const b of spBatchaJson?.vidyapeeth_batches || []) upsertBatch(vidyapeethMap, b, true);

    // 3. StudyParcham allbatches.json
    const spAllMain = Array.isArray(spAllJson)
      ? spAllJson
      : spAllJson?.batches || spAllJson?.data || [];
    for (const b of spAllMain) upsertBatch(batchMap, b, false);

    // 4. StudyParcham /api/batches (use stable fallback date so entries without start_date don't crowd out active batches)
    const spApiMain = Array.isArray(spApiJson)
      ? spApiJson
      : spApiJson?.data || spApiJson?.batches || [];
    const fallbackBaseMs = Date.parse('2026-04-01T00:00:00.000Z');
    spApiMain.forEach((b: any, i: number) => {
      const fallbackIso = new Date(fallbackBaseMs - i * 60000).toISOString();
      upsertBatch(batchMap, b, false, fallbackIso);
    });

    const normalized = {
      success: true,
      data: sortBatchesNewestFirst(Array.from(batchMap.values())),
      vidyapeeth_batches: sortBatchesNewestFirst(Array.from(vidyapeethMap.values())),
    };
    cachedBatchesPayload = normalized;
    batchesFetchedAt = Date.now();
    return {
      batches: normalized.data,
      vidyapeeth: normalized.vidyapeeth_batches,
      rawPayload: normalized,
    };
  }

  // 1. Batches catalog proxy & cache (full catalog, newest batches sorted first)
  app.get('/api/batches', async (_req, res) => {
    try {
      const catalog = await ensureBatchesCatalog();
      return res.json(catalog.rawPayload);
    } catch (err: any) {
      if (cachedBatchesPayload) return res.json(cachedBatchesPayload);
      return res.status(500).json({ success: false, message: err?.message || 'Batches load error' });
    }
  });

  // 1b. Physics Wallah Student OTP Login routes (direct api.penpencil.co)
  app.post('/api/pw-auth/send-otp', async (req, res) => {
    try {
      const rawPhone = String(req.body?.phone || '').replace(/\D/g, '');
      const countryCode = String(req.body?.countryCode || '+91').trim() || '+91';
      if (rawPhone.length < 10) {
        return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
      }
      const phone = rawPhone.slice(-10);
      const r = await fetch(`${PENPENCIL_API_BASE}/v1/users/get-otp?smsType=0&fallback=true`, {
        method: 'POST',
        headers: {
          ...buildPwHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: phone,
          countryCode,
          organizationId: '5eb393ee95fab7468a79d189',
        }),
      });
      const json = (await r.json().catch(() => ({}))) as any;
      if (!r.ok || json?.success === false) {
        const msg = json?.error?.message || json?.message || `Failed to send OTP (${r.status})`;
        return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
          success: false,
          message: msg,
        });
      }
      return res.json({ success: true, message: 'OTP sent to your mobile number.' });
    } catch (err: any) {
      return res.status(502).json({ success: false, message: err?.message || 'Could not reach PW OTP service.' });
    }
  });

  app.post('/api/pw-auth/verify-otp', async (req, res) => {
    try {
      const rawPhone = String(req.body?.phone || '').replace(/\D/g, '');
      const otp = String(req.body?.otp || '').trim();
      if (rawPhone.length < 10 || !otp) {
        return res.status(400).json({ success: false, message: 'Phone number and OTP are required.' });
      }
      const phone = rawPhone.slice(-10);
      const r = await fetch(`${PENPENCIL_API_BASE}/v3/oauth/token`, {
        method: 'POST',
        headers: {
          ...buildPwHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: phone,
          otp,
          grant_type: 'password',
          client_id: '5eb393ee95fab7468a79d189',
          organizationId: '5eb393ee95fab7468a79d189',
        }),
      });
      const json = (await r.json().catch(() => ({}))) as any;
      const accessToken = json?.data?.access_token || json?.access_token || '';
      if (!r.ok || !accessToken) {
        const msg = json?.error?.message || json?.message || `OTP verification failed (${r.status})`;
        return res.status(r.status >= 400 && r.status < 500 ? r.status : 401).json({
          success: false,
          message: msg,
        });
      }

      const user = json?.data?.user || json?.user || { primaryNumber: phone };
      res.cookie('pw_token', accessToken, {
        httpOnly: true,
        sameSite: 'none',
        secure: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      return res.json({
        success: true,
        accessToken,
        user: {
          id: user?._id || '',
          name: [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.username || phone,
          phone: user?.primaryNumber || phone,
        },
      });
    } catch (err: any) {
      return res.status(502).json({ success: false, message: err?.message || 'OTP verification failed.' });
    }
  });

  app.post('/api/pw-auth/logout', (_req, res) => {
    res.clearCookie('pw_token');
    return res.json({ success: true });
  });

  // 2. Batch details + subjects + announcements + mahapack mapping
  app.get('/api/batch/:batchId', async (req, res) => {
    const { batchId } = req.params;
    const userToken = getRequestUserToken(req);
    try {
      const detailsPath = `/v3/batches/${encodeURIComponent(batchId)}/details?type=EXPLORE_LEAD`;
      const [detailsRes, announcementsRes, spNotifsRes] = await Promise.all([
        fetchPublicPenPencilRaw(detailsPath).then((pub) =>
          pub.ok ? pub : userToken ? fetchVidcloudApiRaw(detailsPath, userToken) : pub
        ),
        userToken
          ? fetchVidcloudApiRaw(`/v1/batches/${encodeURIComponent(batchId)}/announcement?page=1`, userToken)
          : Promise.resolve({ ok: false, status: 401, data: null, errorText: '' } as UpstreamResult),
        callStudyParchamPw('pw_notifs', { batchId, page: 1, limit: 15 }),
      ]);

      let details = detailsRes.ok ? detailsRes.data?.data || null : null;
      if (!details) {
        details = await getStudyParchamBatchDetails(batchId);
      } else {
        cacheBatchDetailsForStudyParcham(batchId, details);
      }

      const announcements =
        announcementsRes.ok && Array.isArray(announcementsRes.data?.data) && announcementsRes.data.data.length > 0
          ? announcementsRes.data.data
          : spNotifsRes.ok && Array.isArray(spNotifsRes.data)
          ? spNotifsRes.data
          : [];

      let mahapackBatches: any[] = [];
      if (details && (!details?.subjects?.length || details?.type === 'MAHAPACK') && userToken) {
        const mpRes = await fetchVidcloudApiRaw(
          `/v3/batch-service/mahapack-mapping?mahapackId=${encodeURIComponent(batchId)}&page=1`,
          userToken
        );
        if (mpRes.ok && Array.isArray(mpRes.data?.data)) {
          mahapackBatches = mpRes.data.data;
        }
      }

      if (!details) {
        return res.status(detailsRes.status >= 400 && detailsRes.status < 600 ? detailsRes.status : 502).json({
          success: false,
          needsPwLogin: Boolean(detailsRes.needsPwLogin),
          message: extractPenPencilErrorMessage(detailsRes.errorText, 'Failed to fetch batch details'),
        });
      }

      return res.json({
        success: true,
        batch: details,
        subjects: dedupeById(details?.subjects || [], (s: any) => (s?._id ? String(s._id) : null)),
        mahapackBatches: dedupeById(mahapackBatches, (mb: any) =>
          mb?._id || mb?.batchId ? String(mb._id || mb.batchId) : null
        ),
        announcements: dedupeById(announcements, (a: any) => (a?._id ? String(a._id) : null)),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to fetch batch details' });
    }
  });

  // 3. Subject chapters / topics
  app.get('/api/topics/:batchId/:subjectId', async (req, res) => {
    const { batchId, subjectId } = req.params;
    const page = String(req.query.page || '1');
    const pageNum = Math.max(1, Number(page) || 1);
    const userToken = getRequestUserToken(req);

    const fetchViaStudyParcham = async () => {
      const resolvedSubjId = await resolveStudyParchamSubjectId(batchId, subjectId);
      if (!resolvedSubjId) return null;
      const spRes = await callStudyParchamPw('pw_sub_topics', {
        batchId,
        subjectId: resolvedSubjId,
        page: pageNum,
        tagType: 'UNITS',
        limit: 50,
      });
      if (spRes.ok && Array.isArray(spRes.data)) {
        return {
          topics: spRes.data,
          paginate: spRes.raw?.paginate || { totalCount: spRes.data.length },
        };
      }
      return null;
    };

    try {
      // Without userToken, StudyParcham is fast & never CF-blocked
      if (!userToken) {
        const sp = await fetchViaStudyParcham();
        if (sp) {
          return res.json({
            success: true,
            topics: dedupeById(sp.topics, (t: any) => (t?._id ? String(t._id) : null)),
            paginate: sp.paginate,
          });
        }
      }

      let result = await fetchVidcloudApiRaw(
        `/v2/batches/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subjectId)}/topics?page=${encodeURIComponent(page)}`,
        userToken
      );

      if (!result.ok && userToken) {
        const sp = await fetchViaStudyParcham();
        if (sp) {
          return res.json({
            success: true,
            topics: dedupeById(sp.topics, (t: any) => (t?._id ? String(t._id) : null)),
            paginate: sp.paginate,
          });
        }
      }

      // If batchId returns 403 Scope Access, try unlocked batch fallback for shared subject slugs
      if (!result.ok && result.status === 403 && !result.needsPwLogin) {
        const fallback = await fetchVidcloudApiRaw(
          `/v2/batches/${UNLOCK_CONTENTS_BATCH_ID}/subject/${encodeURIComponent(subjectId)}/topics?page=${encodeURIComponent(page)}`,
          userToken
        );
        if (fallback.ok) result = fallback;
      }

      if (!result.ok) {
        if (result.status === 404) {
          return res.json({ success: true, topics: [], paginate: null });
        }
        const spFallback = await fetchViaStudyParcham();
        if (spFallback) {
          return res.json({
            success: true,
            topics: dedupeById(spFallback.topics, (t: any) => (t?._id ? String(t._id) : null)),
            paginate: spFallback.paginate,
          });
        }
        const statusCode = result.needsPwLogin
          ? 401
          : result.status >= 400 && result.status < 600
          ? result.status
          : 502;
        return res.status(statusCode).json({
          success: false,
          needsPwLogin: Boolean(result.needsPwLogin),
          message: result.needsPwLogin
            ? result.errorText
            : extractPenPencilErrorMessage(result.errorText, `Failed to load chapters (${statusCode})`),
        });
      }

      const rawTopicList = Array.isArray(result.data?.data) ? result.data.data : [];
      return res.json({
        success: true,
        topics: dedupeById(rawTopicList, (t: any) => (t?._id ? String(t._id) : null)),
        paginate: result.data?.paginate || null,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to fetch topics' });
    }
  });

  // 4. Chapter contents (videos, notes, DppNotes, DppVideos)
  app.get('/api/contents/:batchId/:subjectId', async (req, res) => {
    const { batchId, subjectId } = req.params;
    const topicId = String(req.query.topicId || '');
    const contentType = String(req.query.contentType || 'videos');
    const page = String(req.query.page || '1');
    const pageNum = Math.max(1, Number(page) || 1);
    const isNotesType = contentType === 'notes' || contentType === 'DppNotes';
    const userToken = getRequestUserToken(req);

    const fetchContentsViaStudyParcham = async () => {
      const resolvedSubjId = await resolveStudyParchamSubjectId(batchId, subjectId);
      if (!resolvedSubjId) return null;
      let spRes = await callStudyParchamPw('pw_v2_list', {
        batchId,
        subjectId: resolvedSubjId,
        tagId: topicId,
        contentType,
        page: pageNum,
        limit: 50,
      });
      if (
        spRes.ok &&
        Array.isArray(spRes.data) &&
        spRes.data.length === 0 &&
        contentType === 'DppVideos'
      ) {
        const altRes = await callStudyParchamPw('pw_v2_list', {
          batchId,
          subjectId: resolvedSubjId,
          tagId: topicId,
          contentType: 'exercises-videos',
          page: pageNum,
          limit: 50,
        });
        if (altRes.ok && Array.isArray(altRes.data) && altRes.data.length > 0) {
          spRes = altRes;
        }
      }
      if (spRes.ok && Array.isArray(spRes.data)) {
        const dedupedRaw = dedupeById(spRes.data, (it: any) => (it?._id ? String(it._id) : null));
        const items = isNotesType ? normalizeNoteItems(dedupedRaw) : dedupedRaw;
        return {
          items,
          paginate: spRes.raw?.paginate || { totalCount: items.length },
        };
      }
      return null;
    };

    try {
      // Without a user token, StudyParcham fetches real batch contents without CF blocks or 403/500
      if (!userToken) {
        const sp = await fetchContentsViaStudyParcham();
        if (sp) {
          return res.json({ success: true, items: sp.items, paginate: sp.paginate });
        }
      }

      const buildPath = (targetBatchId: string) =>
        `/v2/batches/${encodeURIComponent(targetBatchId)}/subject/${encodeURIComponent(subjectId)}/contents?tag=${encodeURIComponent(topicId)}&contentType=${encodeURIComponent(contentType)}&page=${encodeURIComponent(page)}`;

      let finalRes: UpstreamResult | null = null;

      if (isNotesType && !userToken) {
        const unlockedRes = await fetchVidcloudApiRaw(buildPath(UNLOCK_CONTENTS_BATCH_ID), userToken);
        if (unlockedRes.ok && Array.isArray(unlockedRes.data?.data) && unlockedRes.data.data.length > 0) {
          finalRes = unlockedRes;
        }
      }

      if (!finalRes) {
        const primaryRes = await fetchVidcloudApiRaw(buildPath(batchId), userToken);
        if (primaryRes.ok) {
          finalRes = primaryRes;
          if (isNotesType && Array.isArray(primaryRes.data?.data) && primaryRes.data.data.length > 0) {
            const hasKeys = primaryRes.data.data.some((it: any) =>
              it?.homeworkIds?.some((hw: any) => hw?.attachmentIds?.some((a: any) => Boolean(a?.key || a?.url)))
            );
            if (!hasKeys) {
              const spNotes = await fetchContentsViaStudyParcham();
              if (spNotes && spNotes.items.length > 0) {
                return res.json({ success: true, items: spNotes.items, paginate: spNotes.paginate });
              }
            }
          }
        } else {
          const spFallback = await fetchContentsViaStudyParcham();
          if (spFallback) {
            return res.json({ success: true, items: spFallback.items, paginate: spFallback.paginate });
          }
          if (primaryRes.needsPwLogin) {
            return res.status(401).json({
              success: false,
              needsPwLogin: true,
              message: primaryRes.errorText,
            });
          }
          finalRes = primaryRes;
        }
      }

      if (!finalRes || !finalRes.ok) {
        if (finalRes?.status === 404) {
          return res.json({ success: true, items: [], paginate: null });
        }
        const statusCode = finalRes?.needsPwLogin
          ? 401
          : finalRes && finalRes.status >= 400 && finalRes.status < 600
          ? finalRes.status
          : 502;
        const msg =
          statusCode === 403
            ? 'This chapter material requires an enrolled Physics Wallah account or batch access.'
            : statusCode === 429
            ? 'Server is busy (rate limit). Please wait a few seconds and tap Retry.'
            : extractPenPencilErrorMessage(finalRes?.errorText || '', `Failed to load contents (${statusCode})`);
        return res.status(statusCode).json({
          success: false,
          needsPwLogin: Boolean(finalRes?.needsPwLogin || (statusCode === 403 && !userToken)),
          message: msg,
        });
      }

      const rawItems = dedupeById(
        Array.isArray(finalRes.data?.data) ? finalRes.data.data : [],
        (it: any) => (it?._id ? String(it._id) : null)
      );
      const items = isNotesType ? normalizeNoteItems(rawItems) : rawItems;

      return res.json({
        success: true,
        items,
        paginate: finalRes.data?.paginate || null,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to fetch contents' });
    }
  });

  // 4b. Today's Schedule (live PW todays-schedule + StudyParcham fallback + teacher/subject enrichment)
  app.get('/api/schedule/:batchId/today', async (req, res) => {
    const { batchId } = req.params;
    const userToken = getRequestUserToken(req);
    const cacheKey = `today:${batchId}:${userToken ? 'u' : 's'}`;
    const cached = scheduleCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < SCHEDULE_CACHE_TTL_MS) {
      return res.json(cached.data);
    }

    try {
      const [detailsRes, spDetails, v1Res, spTodayRes] = await Promise.all([
        fetchPublicPenPencilRaw(`/v3/batches/${encodeURIComponent(batchId)}/details?type=EXPLORE_LEAD`),
        getStudyParchamBatchDetails(batchId),
        userToken
          ? fetchVidcloudApiRaw(
              `/v1/batches/${encodeURIComponent(batchId)}/todays-schedule?batchId=${encodeURIComponent(batchId)}&isNewStudyMaterialFlow=true`,
              userToken
            )
          : Promise.resolve({ ok: false, status: 401, data: null, errorText: '' } as UpstreamResult),
        callStudyParchamPw('pw_tdy_sch', { batchId }),
      ]);

      const details = (detailsRes.ok ? detailsRes.data?.data : null) || spDetails;
      let items: any[] =
        v1Res.ok && Array.isArray(v1Res.data?.data) && v1Res.data.data.length > 0
          ? v1Res.data.data
          : spTodayRes.ok && Array.isArray(spTodayRes.data)
          ? spTodayRes.data
          : [];

      if (items.length === 0 && userToken) {
        const v2Res = await fetchVidcloudApiRaw(
          `/v2/batches/${encodeURIComponent(batchId)}/todays-schedule`,
          userToken
        );
        if (v2Res.ok && Array.isArray(v2Res.data?.data)) {
          items = v2Res.data.data;
        }
      }

      const enriched = dedupeById(enrichScheduleItems(items, details), (c: any) => (c?._id ? String(c._id) : null));
      const payload = {
        success: true,
        source: 'live-todays-schedule',
        date: new Date().toISOString().slice(0, 10),
        classes: enriched,
      };
      scheduleCache.set(cacheKey, { data: payload, savedAt: Date.now() });
      return res.json(payload);
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to fetch today schedule' });
    }
  });

  // 4c. Weekly Schedule (tries StudyParcham + PW weekly-schedules, falls back gracefully to real dated classes)
  app.get('/api/schedule/:batchId/weekly', async (req, res) => {
    const { batchId } = req.params;
    const startDate = String(req.query.startDate || '').slice(0, 10);
    const endDate = String(req.query.endDate || '').slice(0, 10);
    const page = String(req.query.page || '1');
    const userToken = getRequestUserToken(req);

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'startDate and endDate (YYYY-MM-DD) are required' });
    }

    const cacheKey = `weekly:${batchId}:${startDate}:${endDate}:${page}:${userToken ? 'u' : 's'}`;
    const cached = scheduleCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < SCHEDULE_CACHE_TTL_MS) {
      return res.json(cached.data);
    }

    try {
      const [detailsRes, spDetails, todayRes, w2Res, spTodayRes, spWeeklyRes] = await Promise.all([
        fetchPublicPenPencilRaw(`/v3/batches/${encodeURIComponent(batchId)}/details?type=EXPLORE_LEAD`),
        getStudyParchamBatchDetails(batchId),
        userToken
          ? fetchVidcloudApiRaw(
              `/v1/batches/${encodeURIComponent(batchId)}/todays-schedule?batchId=${encodeURIComponent(batchId)}&isNewStudyMaterialFlow=true`,
              userToken
            )
          : Promise.resolve({ ok: false, status: 401, data: null, errorText: '' } as UpstreamResult),
        userToken
          ? fetchVidcloudApiRaw(
              `/v2/batches/${encodeURIComponent(batchId)}/weekly-schedules?batchId=${encodeURIComponent(batchId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&page=${encodeURIComponent(page)}`,
              userToken
            )
          : Promise.resolve({ ok: false, status: 401, data: null, errorText: '' } as UpstreamResult),
        callStudyParchamPw('pw_tdy_sch', { batchId }),
        callStudyParchamPw('pw_wkly_sch', { batchId, startDate, endDate, page: Number(page) || 1 }),
      ]);

      const details = (detailsRes.ok ? detailsRes.data?.data : null) || spDetails;
      const todayRaw: any[] =
        todayRes.ok && Array.isArray(todayRes.data?.data)
          ? todayRes.data.data
          : spTodayRes.ok && Array.isArray(spTodayRes.data)
          ? spTodayRes.data
          : [];

      const spWeekList: any[] = spWeeklyRes.ok && Array.isArray(spWeeklyRes.data) ? spWeeklyRes.data : [];

      if ((w2Res.ok && Array.isArray(w2Res.data?.data)) || spWeekList.length > 0) {
        let weekItems =
          w2Res.ok && Array.isArray(w2Res.data?.data) ? [...w2Res.data.data] : [...spWeekList];
        if (w2Res.ok && page === '1' && weekItems.length >= 6 && userToken) {
          for (const extraPage of [2, 3]) {
            const extraRes = await fetchVidcloudApiRaw(
              `/v2/batches/${encodeURIComponent(batchId)}/weekly-schedules?batchId=${encodeURIComponent(batchId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&page=${extraPage}`,
              userToken
            );
            if (extraRes.ok && Array.isArray(extraRes.data?.data) && extraRes.data.data.length > 0) {
              weekItems.push(...extraRes.data.data);
            } else {
              break;
            }
          }
        } else if (!w2Res.ok && page === '1' && spWeekList.length >= 6) {
          for (const extraPage of [2, 3]) {
            const extraSp = await callStudyParchamPw('pw_wkly_sch', { batchId, startDate, endDate, page: extraPage });
            if (extraSp.ok && Array.isArray(extraSp.data) && extraSp.data.length > 0) {
              weekItems.push(...extraSp.data);
            } else {
              break;
            }
          }
        }
        const merged = mergeScheduleById(todayRaw, weekItems);
        const payload = {
          success: true,
          source: 'weekly-schedules',
          classes: dedupeById(enrichScheduleItems(merged, details), (c: any) => (c?._id ? String(c._id) : null)),
          weeklyRoutine: [],
        };
        scheduleCache.set(cacheKey, { data: payload, savedAt: Date.now() });
        return res.json(payload);
      }

      // Derive real dated classes from batch subjects' latest lectures via StudyParcham + PenPencil
      const academicSubjects = (details?.subjects || []).filter(
        (s: any) =>
          (s?._id || s?.slug) &&
          !/notice|guidance|orientation|planner/i.test(String(s.subject || ''))
      );

      const collectedLectures: any[] = [];
      for (const subj of academicSubjects.slice(0, 6)) {
        try {
          let topicsList: any[] = [];
          const spTopics = subj._id
            ? await callStudyParchamPw('pw_sub_topics', {
                batchId,
                subjectId: subj._id,
                page: 1,
                tagType: 'UNITS',
                limit: 30,
              })
            : null;
          if (spTopics?.ok && Array.isArray(spTopics.data)) {
            topicsList = spTopics.data;
          } else if (userToken && subj.slug) {
            const tRes = await fetchVidcloudApiRaw(
              `/v2/batches/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subj.slug)}/topics?page=1`,
              userToken
            );
            topicsList = tRes.ok && Array.isArray(tRes.data?.data) ? tRes.data.data : [];
          }
          const activeTopics = topicsList.filter((t) => (t?.videos || 0) > 0).slice(0, 2);
          for (const topic of activeTopics) {
            let vids: any[] = [];
            const spVids = subj._id
              ? await callStudyParchamPw('pw_v2_list', {
                  batchId,
                  subjectId: subj._id,
                  tagId: topic._id,
                  contentType: 'videos',
                  page: 1,
                  limit: 20,
                })
              : null;
            if (spVids?.ok && Array.isArray(spVids.data)) {
              vids = spVids.data;
            } else if (userToken && subj.slug) {
              const cRes = await fetchVidcloudApiRaw(
                `/v2/batches/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subj.slug)}/contents?tag=${encodeURIComponent(topic._id)}&contentType=videos&page=1`,
                userToken
              );
              vids = cRes.ok && Array.isArray(cRes.data?.data) ? cRes.data.data : [];
            }
            for (const v of vids) {
              collectedLectures.push({
                ...v,
                batchSubjectId: subj._id,
                subjectId: { _id: subj._id, name: subj.subject, slug: subj.slug },
                tags: Array.isArray(v.tags) && v.tags.length > 0 ? v.tags : [{ _id: topic._id, name: topic.name }],
              });
            }
          }
        } catch {
          // continue cleanly across subjects
        }
      }

      const inRangeLectures = collectedLectures.filter((item) => {
        const dStr = getIstDateKey(item.startTime || item.date);
        return dStr && dStr >= startDate && dStr <= endDate;
      });

      const routineMap = new Map<string, any>();
      for (const item of collectedLectures) {
        const refTime = item.startTime || item.date;
        if (!refTime) continue;
        const dt = new Date(refTime);
        if (Number.isNaN(dt.getTime())) continue;
        const ist = new Date(dt.getTime() + 330 * 60 * 1000);
        const weekday = ist.getUTCDay();
        const subjName = item.subjectId?.name || 'Subject';
        const key = `${weekday}:${subjName}`;
        if (!routineMap.has(key)) {
          routineMap.set(key, {
            weekday,
            subjectName: subjName,
            subjectSlug: item.subjectId?.slug || '',
            batchSubjectId: item.batchSubjectId || '',
            startTime: item.startTime || item.date,
            endTime: item.endTime || '',
            sampleTopic: item.topic || '',
            teachers: item.teachers || [],
          });
        }
      }

      const merged = mergeScheduleById(todayRaw, inRangeLectures);
      const enriched = enrichScheduleItems(merged, details);
      const enrichedRoutine = enrichRoutineItems(Array.from(routineMap.values()), details);

      const payload = {
        success: true,
        source: 'subject-timetable-fallback',
        classes: enriched,
        weeklyRoutine: enrichedRoutine,
      };
      scheduleCache.set(cacheKey, { data: payload, savedAt: Date.now() });
      return res.json(payload);
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to fetch weekly schedule' });
    }
  });

  // 5. Resolve real video stream (direct PenPencil video-url-details + play.php fallback + attachments)
  app.get('/api/stream', async (req, res) => {
    const batchId = String(req.query.batch_id || '');
    const programId = String(req.query.program_id || req.query.programId || '');
    const subjectId = String(req.query.subject_id || '');
    const topicId = String(req.query.topic_id || '');
    const videoId = String(req.query.video_id || '');
    const findKey = String(req.query.find_key || '');
    const videoDetailsId = String(req.query.video_details_id || '');
    const videoName = String(req.query.video_name || 'Lecture');
    const videoImg = String(req.query.video_img || '');
    const videoType = String(req.query.video_type || 'new');
    const playType = String(req.query.play_type || 'Lecture');
    const rawVideoUrl = String(req.query.video_url || '');
    const typeId = String(req.query.typeId || '');
    const userToken = getRequestUserToken(req);

    try {
      // Handle YouTube URLs directly (by videoType OR by URL pattern)
      const directYt = extractYoutubeEmbed(rawVideoUrl);
      if ((videoType === 'youtube' && rawVideoUrl) || directYt) {
        return res.json({
          success: true,
          isYoutube: true,
          youtubeEmbedUrl: directYt || rawVideoUrl,
          rawUrl: rawVideoUrl,
          attachments: [],
        });
      }

      const candidateIds = Array.from(
        new Set([videoId, findKey, videoDetailsId].filter((id) => Boolean(id && id.trim())))
      );

      let token = userToken;
      let resolvedUrl = '';
      let keyIdB64 = '';
      let keyValB64 = '';
      let drmType = '';
      let attachmentsRaw = '';
      const spAttachments: any[] = [];

      // Check StudyParcham pw_sch_dtl first if we have batch/subject/videoId (can supply direct URL, findKey & attachments)
      const effectiveParentBatch = batchId || programId;
      if (effectiveParentBatch && videoId) {
        try {
          const resolvedSubj = subjectId
            ? await resolveStudyParchamSubjectId(effectiveParentBatch, subjectId)
            : '';
          const schRes = await callStudyParchamPw('pw_sch_dtl', {
            batchId: effectiveParentBatch,
            subjectId: resolvedSubj,
            scheduleId: videoId,
          });
          if (schRes.ok && schRes.data) {
            const d = schRes.data;
            const extraFindKey = d?.videoDetails?.findKey || '';
            const extraVdId = d?.videoDetails?._id || d?.videoDetails?.id || '';
            if (extraFindKey && !candidateIds.includes(extraFindKey)) candidateIds.push(extraFindKey);
            if (extraVdId && !candidateIds.includes(extraVdId)) candidateIds.push(extraVdId);

            const schUrl = d?.url || d?.videoDetails?.videoUrl || d?.videoDetails?.embedCode || '';
            const ytFromSch = extractYoutubeEmbed(schUrl);
            if (ytFromSch) {
              return res.json({
                success: true,
                isYoutube: true,
                youtubeEmbedUrl: ytFromSch,
                rawUrl: schUrl,
                attachments: (d?.homeworkIds || []).flatMap((hw: any) => hw?.attachmentIds || []).map(normalizeAttachment),
              });
            }
            if (schUrl && /\.(m3u8|mpd|mp4)(\?|$)/i.test(schUrl) && /Signature=|Policy=|Expires=/i.test(schUrl)) {
              resolvedUrl = schUrl;
            }
            for (const hw of d?.homeworkIds || []) {
              for (const att of hw?.attachmentIds || []) {
                spAttachments.push(att);
              }
            }
          }
        } catch {
          // non-fatal
        }
      }

      // 5a. Resolve signed stream directly via StudyParcham /api/video/ (no user login required)
      if (!resolvedUrl && effectiveParentBatch && candidateIds.length > 0) {
        const spStream = await resolveStudyParchamVideoStream({
          batchId: effectiveParentBatch,
          subjectId,
          videoId: candidateIds[0] || videoId,
          findKey: candidateIds[1] || findKey,
          videoDetailsId: candidateIds[2] || videoDetailsId,
        });
        if (spStream.ok && spStream.url) {
          resolvedUrl = spStream.url;
          drmType = spStream.drmType || drmType;
          keyIdB64 = spStream.keyIdB64 || keyIdB64;
          keyValB64 = spStream.keyValB64 || keyValB64;
        } else if (programId && programId !== effectiveParentBatch) {
          const spProgramStream = await resolveStudyParchamVideoStream({
            batchId: programId,
            subjectId,
            videoId: candidateIds[0] || videoId,
            findKey: candidateIds[1] || findKey,
            videoDetailsId: candidateIds[2] || videoDetailsId,
          });
          if (spProgramStream.ok && spProgramStream.url) {
            resolvedUrl = spProgramStream.url;
            drmType = spProgramStream.drmType || drmType;
            keyIdB64 = spProgramStream.keyIdB64 || keyIdB64;
            keyValB64 = spProgramStream.keyValB64 || keyValB64;
          }
        }
      }

      // 5b. Try direct PenPencil video-url-details if still unresolved
      const tryPenPencilVideoDetails = async (activeToken: string) => {
        if (!activeToken) return '';
        const reqTypes = programId ? ['KHAZANA', 'PROGRAMS', 'BATCHES'] : ['BATCHES'];
        const parentIds = Array.from(new Set([batchId, programId, UNLOCK_CONTENTS_BATCH_ID].filter(Boolean)));
        for (const rType of reqTypes) {
          for (const container of ['HLS', 'DASH']) {
            for (const parentBatch of parentIds) {
              for (const cid of candidateIds) {
                const qs = new URLSearchParams({
                  type: rType,
                  videoContainerType: container,
                  reqType: 'query',
                  childId: cid,
                  parentId: parentBatch,
                });
                const r = await fetchPenPencilWithToken(
                  PENPENCIL_API_BASE,
                  `/v1/videos/video-url-details?${qs.toString()}`,
                  activeToken
                );
                const urlPart = r.data?.data?.url || '';
                const signedPart = r.data?.data?.signedUrl || '';
                if (r.ok && urlPart) {
                  return `${urlPart}${signedPart}`;
                }
              }
            }
          }
        }
        return '';
      };

      if (!resolvedUrl) {
        if (!token) {
          try {
            token = await getBearerToken(false);
          } catch {
            // fallback token unavailable
          }
        }
        if (token) {
          resolvedUrl = await tryPenPencilVideoDetails(token);
        }
      }

      const tryPlayPhp = async (candidateVid: string, currentToken: string) => {
        if (Date.now() < vidcloudBlockedUntil) {
          return { ok: false, status: 403, blocked: true };
        }
        const params = new URLSearchParams({
          batch_id: batchId,
          subject_id: subjectId,
          topic_id: topicId,
          video_id: candidateVid,
          video_name: videoName,
          video_img: videoImg,
          video_type: videoType,
          play_type: playType,
        });
        if (typeId) params.set('typeId', typeId);
        if (currentToken) params.set('token', currentToken);

        const playUrl = `https://vidcloud.eu.org/play.php?${params.toString()}`;
        const playRes = await fetch(playUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            Referer: 'https://vidcloud.eu.org/',
            ...(currentToken ? { Cookie: `token=${currentToken}; access_token=${currentToken}` } : {}),
          },
        });
        const html = await playRes.text().catch(() => '');
        if (isCloudflareBlockHtml(playRes.status, html)) {
          vidcloudBlockedUntil = Date.now() + VIDCLOUD_BLOCK_COOLDOWN_MS;
          return { ok: false, status: 403, blocked: true };
        }
        if (!playRes.ok) {
          return { ok: false, status: playRes.status };
        }

        const encVideoUrl = extractHiddenInput(html, 'enc_video_url');
        const encStatusUrl = extractHiddenInput(html, 'enc_status_url');
        const encKeyId = extractHiddenInput(html, 'enc_key_id');
        const encKeyValue = extractHiddenInput(html, 'enc_key_value');
        const encDrmType = extractHiddenInput(html, 'enc_drm_type');
        const attRaw = extractHiddenInput(html, 'attachments_data');

        let urlOut = decryptAesCbc(encVideoUrl);
        const kId = decryptAesCbc(encKeyId);
        const kVal = decryptAesCbc(encKeyValue);
        const dType = decryptAesCbc(encDrmType);

        if (!urlOut && encStatusUrl) {
          const statusUrl = decryptAesCbc(encStatusUrl) || encStatusUrl;
          if (statusUrl.startsWith('http')) {
            for (let i = 0; i < 12; i++) {
              await new Promise((r) => setTimeout(r, 1100));
              const stRes = await fetch(statusUrl, {
                headers: {
                  'User-Agent': USER_AGENT,
                  Referer: 'https://vidcloud.eu.org/',
                  ...(currentToken ? { Cookie: `token=${currentToken}; access_token=${currentToken}` } : {}),
                },
              }).catch(() => null);
              if (stRes && stRes.ok) {
                const stJson = (await stRes.json().catch(() => null)) as any;
                const cand = stJson?.video_url || stJson?.url || '';
                if (stJson?.status === 'success' && cand) {
                  urlOut = decryptAesCbc(cand) || cand;
                  break;
                }
              }
            }
          }
        }

        return {
          ok: Boolean(urlOut),
          urlOut,
          kId,
          kVal,
          dType,
          attRaw,
          isExpiredPage: html.includes('token has expired') || html.includes('Video Not Available'),
        };
      };

      // 5b. Fallback to vidcloud play.php if direct video-url-details didn't resolve and vidcloud isn't Cloudflare-blocked
      if (!resolvedUrl && Date.now() >= vidcloudBlockedUntil) {
        const backoffMs = [0, 400, 800];
        for (let attempt = 0; attempt < backoffMs.length && !resolvedUrl; attempt++) {
          if (Date.now() < vidcloudBlockedUntil) break;
          if (backoffMs[attempt] > 0) {
            await new Promise((r) => setTimeout(r, backoffMs[attempt]));
          }

          let attemptToken = attempt === 0 ? token : '';
          if (attempt === 2 && !userToken) {
            try {
              token = await getBearerToken(true);
              attemptToken = token;
            } catch {
              attemptToken = '';
            }
          }

          const primaryId = candidateIds[0] || videoId;
          const primaryAttempt: any = await tryPlayPhp(primaryId, attemptToken);
          if (primaryAttempt.blocked) break;
          if (primaryAttempt.ok && primaryAttempt.urlOut) {
            resolvedUrl = primaryAttempt.urlOut;
            keyIdB64 = primaryAttempt.kId || '';
            keyValB64 = primaryAttempt.kVal || '';
            drmType = primaryAttempt.dType || '';
            attachmentsRaw = primaryAttempt.attRaw || '';
            break;
          }

          if (attempt >= 1 && candidateIds.length > 1) {
            for (const altId of candidateIds.slice(1)) {
              const altAttempt: any = await tryPlayPhp(altId, attemptToken);
              if (altAttempt.blocked) break;
              if (altAttempt.ok && altAttempt.urlOut) {
                resolvedUrl = altAttempt.urlOut;
                keyIdB64 = altAttempt.kId || '';
                keyValB64 = altAttempt.kVal || '';
                drmType = altAttempt.dType || '';
                attachmentsRaw = altAttempt.attRaw || '';
                break;
              }
            }
          }
        }
      }

      // Direct stream URL fallback (only if direct MP4/HLS is public or already CloudFront-signed)
      const isUnsignedCloudfront =
        /cloudfront\.net/i.test(rawVideoUrl) && !/Signature=|Policy=|Expires=/i.test(rawVideoUrl);
      if (!resolvedUrl && rawVideoUrl && /\.(m3u8|mpd|mp4)(\?|$)/i.test(rawVideoUrl) && !isUnsignedCloudfront) {
        resolvedUrl = rawVideoUrl;
      }

      if (!resolvedUrl) {
        return res.status(404).json({
          success: false,
          needsPwLogin: false,
          message:
            'Video stream URL could not be resolved for this lecture. It may not have uploaded VOD yet or upstream is busy—please tap Retry.',
        });
      }

      // Check if resolvedUrl is YouTube
      const ytCheck = extractYoutubeEmbed(resolvedUrl);
      if (ytCheck) {
        return res.json({
          success: true,
          isYoutube: true,
          youtubeEmbedUrl: ytCheck,
          rawUrl: resolvedUrl,
          attachments: [],
        });
      }

      // Convert master.mpd to master.m3u8 (preserving CloudFront signature query!)
      const isDirectMp4 = /\.mp4(\?|$)/i.test(resolvedUrl);
      const hlsUrl = isDirectMp4
        ? resolvedUrl
        : resolvedUrl.replace(/master\.mpd/i, 'master.m3u8');

      // Parse attachments if available
      let attachments: any[] = [...spAttachments];
      try {
        if (attachmentsRaw) {
          const parsedAtt = JSON.parse(attachmentsRaw);
          if (parsedAtt?.notes?.length) attachments.push(...parsedAtt.notes);
          if (parsedAtt?.dpp_pdf?.length) attachments.push(...parsedAtt.dpp_pdf);
        }
      } catch {
        // ignore
      }

      // Also check data-api.php for attachments if vidcloud is not blocked
      if (attachments.length === 0 && videoId && Date.now() >= vidcloudBlockedUntil) {
        try {
          const attToken = token || (await getBearerToken(false));
          const attUrl = `https://vidcloud.eu.org/data-api.php?action=attachments&batch_id=${encodeURIComponent(
            batchId
          )}&subject_id=${encodeURIComponent(subjectId)}&topic_id=${encodeURIComponent(
            topicId
          )}&video_id=${encodeURIComponent(videoId)}&token=${encodeURIComponent(attToken)}`;
          const attRes = await fetch(attUrl, {
            headers: {
              'X-Requested-With': 'SPA-Client',
              Referer: 'https://vidcloud.eu.org/',
              'User-Agent': USER_AGENT,
            },
          });
          if (attRes.ok) {
            const attJson = (await attRes.json().catch(() => null)) as any;
            if (attJson?.notes?.length) attachments.push(...attJson.notes);
            if (attJson?.dpp_pdf?.length) attachments.push(...attJson.dpp_pdf);
          }
        } catch {
          // ignore
        }
      }

      // If still empty and subjectId/topicId are known, resolve matching notes from StudyParcham / contents API
      if (attachments.length === 0 && subjectId && topicId) {
        try {
          const targetBatch = batchId || programId;
          const resolvedSubj = targetBatch ? await resolveStudyParchamSubjectId(targetBatch, subjectId) : '';
          let noteList: any[] = [];
          if (targetBatch && resolvedSubj) {
            const spNotes = await callStudyParchamPw('pw_v2_list', {
              batchId: targetBatch,
              subjectId: resolvedSubj,
              tagId: topicId,
              contentType: 'notes',
              page: 1,
              limit: 20,
            });
            if (spNotes.ok && Array.isArray(spNotes.data)) {
              noteList = spNotes.data;
            }
          }
          if (noteList.length === 0 && userToken) {
            const notesRes = await fetchVidcloudApiRaw(
              `/v2/batches/${encodeURIComponent(targetBatch || UNLOCK_CONTENTS_BATCH_ID)}/subject/${encodeURIComponent(subjectId)}/contents?tag=${encodeURIComponent(topicId)}&contentType=notes&page=1`,
              userToken
            );
            noteList = notesRes.ok && Array.isArray(notesRes.data?.data) ? notesRes.data.data : [];
          }
          const cleanVidTitle = videoName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          for (const item of noteList) {
            for (const hw of item?.homeworkIds || []) {
              const hwTopic = String(hw?.topic || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
              const isMatch =
                noteList.length <= 3 ||
                (cleanVidTitle && hwTopic && (hwTopic.includes(cleanVidTitle.slice(0, 18)) || cleanVidTitle.includes(hwTopic.slice(0, 18))));
              if (isMatch) {
                for (const att of hw?.attachmentIds || []) {
                  attachments.push(att);
                }
              }
            }
          }
        } catch {
          // ignore
        }
      }

      attachments = attachments.map(normalizeAttachment);

      const proxiedUrl = `/api/hls-proxy?url=${encodeURIComponent(hlsUrl)}`;

      return res.json({
        success: true,
        isYoutube: false,
        isDirectMp4,
        streamUrl: proxiedUrl,
        hlsUrl,
        dashUrl: resolvedUrl,
        drmType,
        clearKey:
          keyIdB64 && keyValB64
            ? {
                kidB64: keyIdB64,
                keyB64: keyValB64,
                kidHex: b64UrlToHex(keyIdB64),
                keyHex: b64UrlToHex(keyValB64),
              }
            : null,
        attachments,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err?.message || 'Error resolving video stream',
      });
    }
  });

  // 6. CORS-free HLS / Segment / Key / MP4 Proxy
  app.get('/api/hls-proxy', async (req, res) => {
    const targetUrl = String(req.query.url || '');
    const sigQuery = String(req.query.sig || '');

    if (!targetUrl || !isAllowedProxyHost(targetUrl)) {
      return res.status(400).send('Invalid or disallowed URL');
    }

    try {
      let parsedTarget = new URL(targetUrl);
      // Re-attach CloudFront signature query if passed separately and missing on target
      if (sigQuery && !parsedTarget.searchParams.has('Signature')) {
        const sigParams = new URLSearchParams(sigQuery);
        sigParams.forEach((v, k) => {
          if (!parsedTarget.searchParams.has(k)) {
            parsedTarget.searchParams.set(k, v);
          }
        });
      }

      // Apply newer cached CloudFront signature if available so long lectures never expire mid-stream
      const withFreshCache = applyCachedStudyParchamSig(parsedTarget.toString());
      if (withFreshCache !== parsedTarget.toString()) {
        parsedTarget = new URL(withFreshCache);
      }

      const upstreamHeaders: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Referer: 'https://pw.studyparcham.in/',
      };
      if (req.headers.range) {
        upstreamHeaders.Range = String(req.headers.range);
      }

      let upstream = await fetch(parsedTarget.toString(), { headers: upstreamHeaders });

      // If CloudFront signature expired mid-lecture (403), refresh once via StudyParcham and retry
      if (upstream.status === 403) {
        const refreshedUrl = await refreshStudyParchamSigForUrl(parsedTarget.toString());
        if (refreshedUrl) {
          parsedTarget = new URL(refreshedUrl);
          upstream = await fetch(parsedTarget.toString(), { headers: upstreamHeaders });
        }
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');

      if (!upstream.ok && upstream.status !== 206) {
        return res.status(upstream.status).send(`Upstream returned ${upstream.status}`);
      }

      const contentType = upstream.headers.get('content-type') || '';
      const isM3u8 =
        parsedTarget.pathname.toLowerCase().endsWith('.m3u8') ||
        contentType.includes('mpegurl') ||
        contentType.includes('x-mpegURL');

      if (isM3u8) {
        const text = await upstream.text();
        const currentQuery = parsedTarget.search ? parsedTarget.search.slice(1) : sigQuery;

        // Compute CloudFront root base for /get-hls-key rewriting:
        // e.g. https://d1d34p8vz63oiq.cloudfront.net/<uuid>/hls/360/main.m3u8 -> https://d1d34p8vz63oiq.cloudfront.net/<uuid>/
        const hlsIndex = parsedTarget.pathname.indexOf('/hls/');
        const cfRootPath =
          hlsIndex !== -1
            ? parsedTarget.pathname.slice(0, hlsIndex + 1)
            : parsedTarget.pathname.replace(/[^/]+$/, '');
        const cfRoot = `${parsedTarget.origin}${cfRootPath}`;
        const currentDir = `${parsedTarget.origin}${parsedTarget.pathname.replace(/[^/]+$/, '')}`;

        const rewritten = text
          .split(/\r?\n/)
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;

            // Rewrite #EXT-X-KEY URI
            if (trimmed.startsWith('#EXT-X-KEY')) {
              return trimmed.replace(/URI="([^"]+)"/i, (_m, keyUri) => {
                let resolvedKeyUrl = keyUri;
                if (keyUri.includes('/get-hls-key')) {
                  resolvedKeyUrl = `${cfRoot}hls/enc.key`;
                } else if (!keyUri.startsWith('http')) {
                  resolvedKeyUrl = new URL(keyUri, currentDir).toString();
                }
                const proxiedKey = `/api/hls-proxy?url=${encodeURIComponent(resolvedKeyUrl)}${
                  currentQuery ? `&sig=${encodeURIComponent(currentQuery)}` : ''
                }`;
                return `URI="${proxiedKey}"`;
              });
            }

            // Rewrite #EXT-X-MAP URI (if fMP4 HLS)
            if (trimmed.startsWith('#EXT-X-MAP')) {
              return trimmed.replace(/URI="([^"]+)"/i, (_m, mapUri) => {
                const absMap = mapUri.startsWith('http')
                  ? mapUri
                  : new URL(mapUri, currentDir).toString();
                const proxiedMap = `/api/hls-proxy?url=${encodeURIComponent(absMap)}${
                  currentQuery ? `&sig=${encodeURIComponent(currentQuery)}` : ''
                }`;
                return `URI="${proxiedMap}"`;
              });
            }

            // Rewrite #EXT-X-MEDIA URI (if separate audio track)
            if (trimmed.startsWith('#EXT-X-MEDIA')) {
              return trimmed.replace(/URI="([^"]+)"/i, (_m, mediaUri) => {
                const absMedia = mediaUri.startsWith('http')
                  ? mediaUri
                  : new URL(mediaUri, currentDir).toString();
                const proxiedMedia = `/api/hls-proxy?url=${encodeURIComponent(absMedia)}${
                  currentQuery ? `&sig=${encodeURIComponent(currentQuery)}` : ''
                }`;
                return `URI="${proxiedMedia}"`;
              });
            }

            if (trimmed.startsWith('#')) return line;

            // Regular URI line (sub-playlist or .ts segment)
            const absLine = trimmed.startsWith('http')
              ? trimmed
              : new URL(trimmed, currentDir).toString();
            return `/api/hls-proxy?url=${encodeURIComponent(absLine)}${
              currentQuery ? `&sig=${encodeURIComponent(currentQuery)}` : ''
            }`;
          })
          .join('\n');

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(rewritten);
      }

      // Stream binary segments, keys, mp4s
      res.status(upstream.status);
      if (contentType) res.setHeader('Content-Type', contentType);
      const contentLen = upstream.headers.get('content-length');
      if (contentLen) res.setHeader('Content-Length', contentLen);
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
      const acceptRanges = upstream.headers.get('accept-ranges');
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.send(buf);
    } catch (err: any) {
      return res.status(502).send(`Proxy error: ${err?.message || 'Unknown'}`);
    }
  });

  // 7. Same-Origin PDF Proxy (forces clean download / inline viewing inside iframe & PWA)
  app.get('/api/pdf-proxy', async (req, res) => {
    const rawTarget = String(req.query.url || '').trim();
    const cleanTarget = rawTarget.replace(/^https?:\/\/cors\.testfile\.eu\.org\//i, 'https://');
    const download = String(req.query.download || '') === '1';
    const rawName = String(req.query.name || 'study-notes.pdf').trim();
    const safeName =
      rawName
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .slice(0, 120) || 'study-notes.pdf';
    const fileName = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;

    if (!cleanTarget || !isAllowedProxyHost(cleanTarget)) {
      return res.status(400).send('Invalid or disallowed PDF URL');
    }

    try {
      const upstream = await fetch(cleanTarget, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: 'https://www.pw.live/',
          Accept: 'application/pdf,*/*',
        },
        redirect: 'follow',
      });

      if (!upstream.ok) {
        return res.status(upstream.status).send(`PDF upstream returned ${upstream.status}`);
      }

      const contentType = upstream.headers.get('content-type') || 'application/pdf';
      const buf = Buffer.from(await upstream.arrayBuffer());

      res.setHeader('Content-Type', contentType.includes('pdf') ? contentType : 'application/pdf');
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
      res.setHeader(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="${fileName.replace(/"/g, '')}"`
      );
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(buf);
    } catch (err: any) {
      return res.status(502).send(`PDF proxy error: ${err?.message || 'Unknown'}`);
    }
  });

  // 8. Study Cloud AI Doubt Solver & Tutor (Server-Side Gemini API)
  const getGeminiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Study Cloud AI is not ready yet because GEMINI_API_KEY is not set in Settings > Secrets.'
      );
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  };

  app.post('/api/ai/chat', async (req, res) => {
    try {
      const {
        messages = [],
        context = {},
        mode = 'doubt',
        language = 'hinglish',
      } = (req.body || {}) as {
        messages?: Array<{
          role: 'user' | 'model';
          text?: string;
          image?: { mimeType: string; data: string };
        }>;
        context?: {
          batchName?: string;
          subjectName?: string;
          topicName?: string;
          lectureTitle?: string;
        };
        mode?: 'doubt' | 'formula' | 'quiz' | 'summary';
        language?: 'hinglish' | 'hindi' | 'english';
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ success: false, message: 'Please type a question or upload an image.' });
      }

      const ai = getGeminiClient();

      const langGuide =
        language === 'hindi'
          ? 'Respond primarily in clean Devanagari Hindi, keeping mathematical symbols, SI units, and chemical formulas in standard notation.'
          : language === 'english'
          ? 'Respond in crisp, clear English tailored for Indian competitive and board exam preparation.'
          : 'Respond in natural Hinglish (conversational Hindi written in Roman script mixed with clear English technical/scientific terms) just like top Indian PW/JEE/NEET mentors.';

      const modeGuide =
        mode === 'formula'
          ? 'Task focus: Provide a well-organized Formula Sheet, key laws, units, constants, and quick memory tricks for the requested topic.'
          : mode === 'quiz'
          ? 'Task focus: Create 5 exam-level practice MCQs with options (A, B, C, D) first, followed by a clear Answer Key and brief step-by-step solutions.'
          : mode === 'summary'
          ? 'Task focus: Give concise high-yield revision notes, key definitions, and common exam pitfalls in bullet points.'
          : 'Task focus: Solve the student doubt step-by-step clearly, explain the underlying concept, verify calculations carefully, and highlight any common exam trap.';

      const contextLines: string[] = [];
      if (context?.batchName) contextLines.push(`Batch: ${context.batchName}`);
      if (context?.subjectName) contextLines.push(`Subject: ${context.subjectName}`);
      if (context?.topicName) contextLines.push(`Chapter/Topic: ${context.topicName}`);
      if (context?.lectureTitle) contextLines.push(`Current Lecture: ${context.lectureTitle}`);

      const systemInstruction = [
        'You are Study Cloud AI, an expert Indian academic mentor & doubt solver built inside VidCloud (for Class 9-12, IIT-JEE, NEET, and UPSC students).',
        langGuide,
        modeGuide,
        contextLines.length > 0 ? `Active Study Context:\n${contextLines.join('\n')}` : '',
        'Formatting rules: Use clean headings (###), bullet points, bold key terms (**term**), and readable formulas. Keep explanations direct, encouraging, and accurate without inventing external links.',
      ]
        .filter(Boolean)
        .join('\n\n');

      const recentMessages = messages.slice(-14);
      const contents: Content[] = [];

      for (const msg of recentMessages) {
        const parts: Part[] = [];
        if (msg.image?.mimeType && msg.image?.data) {
          parts.push({
            inlineData: {
              mimeType: msg.image.mimeType,
              data: msg.image.data,
            },
          });
        }
        if (msg.text && msg.text.trim()) {
          parts.push({ text: msg.text.trim() });
        } else if (parts.length > 0) {
          parts.push({ text: 'Please solve and explain this uploaded question step by step.' });
        }
        if (parts.length > 0) {
          contents.push({
            role: msg.role === 'model' ? 'model' : 'user',
            parts,
          });
        }
      }

      if (contents.length === 0) {
        return res.status(400).json({ success: false, message: 'Message content cannot be empty.' });
      }

      let responseText = '';
      let lastErr: any = null;
      const retryDelays = [700, 1500];
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents,
            config: {
              systemInstruction,
            },
          });
          responseText = response.text?.trim() || '';
          lastErr = null;
          break;
        } catch (err: any) {
          lastErr = err;
          const status = Number(err?.status || 0);
          const msgStr = String(err?.message || '');
          const isTransient =
            status === 500 ||
            status === 502 ||
            status === 503 ||
            status === 504 ||
            msgStr.includes('"code":503') ||
            msgStr.includes('UNAVAILABLE');
          if (attempt < retryDelays.length && isTransient) {
            await new Promise((r) => setTimeout(r, retryDelays[attempt]));
            continue;
          }
          break;
        }
      }

      if (lastErr) {
        let status = Number(lastErr?.status || 500);
        let cleanMsg = String(lastErr?.message || 'AI request failed');
        try {
          const parsed = JSON.parse(cleanMsg);
          if (parsed?.error?.message) cleanMsg = String(parsed.error.message);
          if (parsed?.error?.code) status = Number(parsed.error.code);
        } catch {
          // keep cleanMsg as-is
        }

        if (status === 403 || cleanMsg.includes('PERMISSION_DENIED') || cleanMsg.includes('API_KEY_INVALID')) {
          return res.status(status === 403 ? 403 : 400).json({
            success: false,
            message: 'Please check your GEMINI_API_KEY in the Settings > Secrets panel.',
          });
        }
        if (status === 429 || cleanMsg.includes('RESOURCE_EXHAUSTED')) {
          return res.status(429).json({
            success: false,
            message: 'AI rate limit reached right now. Please wait a few seconds and try again.',
          });
        }
        if (status === 503 || cleanMsg.includes('UNAVAILABLE') || cleanMsg.includes('high demand')) {
          return res.status(503).json({
            success: false,
            message: 'Study Cloud AI abhi busy hai (high demand). 5 second baad dubara Ask par tap karein.',
          });
        }
        return res.status(status >= 400 && status < 600 ? status : 500).json({
          success: false,
          message: cleanMsg,
        });
      }

      if (!responseText) {
        return res.status(502).json({
          success: false,
          message: 'Study Cloud AI returned an empty answer. Please rephrase your question and try again.',
        });
      }

      return res.json({
        success: true,
        reply: responseText,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err?.message || 'Could not reach Study Cloud AI right now.',
      });
    }
  });

  // 9. Register AI Test, Community, Quizzes, Khazana, Pi OTT, and Lecture Download routes
  registerFeatureRoutes(app, {
    getGeminiClient,
    getCachedBatches: async () => {
      try {
        const cat = await ensureBatchesCatalog();
        return { batches: cat.batches, vidyapeeth: cat.vidyapeeth };
      } catch {
        return {
          batches: cachedBatchesPayload?.data || [],
          vidyapeeth: cachedBatchesPayload?.vidyapeeth_batches || [],
        };
      }
    },
    getUserToken: getRequestUserToken,
    getBearerToken,
    fetchPublicPenPencilRaw,
    fetchVidcloudApiRaw,
    fetchPenPencilWithToken,
    normalizeAttachment,
    normalizeNoteItems,
    PENPENCIL_API_BASE,
    USER_AGENT,
  });

  return app;
}

async function startServer() {
  const app = createApiApp();
  const httpServer = http.createServer(app);

  // Vite dev middleware or static dist
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`VidCloud App Server listening on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
