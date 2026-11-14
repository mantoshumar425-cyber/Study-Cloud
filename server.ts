import express from 'express';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Content, Part, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const API_BASE = 'https://vidcloud.eu.org/api';
const AES_KEY = Buffer.from('UjdAa1A0I3hMOSFtUTIkdg==', 'base64');
const AES_IV = Buffer.from('VDMhblc4JHFaNUBySzEjcA==', 'base64');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Server-side token cache
let cachedToken: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Server-side batches cache
let cachedBatchesPayload: any = null;
let batchesFetchedAt = 0;
const BATCHES_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getBearerToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && Date.now() - tokenFetchedAt < TOKEN_TTL_MS) {
    return cachedToken;
  }
  try {
    const res = await fetch(`https://vidcloud.eu.org/generate_token.php?_t=${Date.now()}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://vidcloud.eu.org/',
      },
    });
    if (!res.ok) {
      if (cachedToken) return cachedToken;
      throw new Error(`Token fetch failed with status ${res.status}`);
    }
    const json = (await res.json().catch(() => ({}))) as any;
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
  return deduped.sort((a, b) => {
    const ta = a?.start_date ? Date.parse(a.start_date) : 0;
    const tb = b?.start_date ? Date.parse(b.start_date) : 0;
    const va = Number.isFinite(ta) ? ta : 0;
    const vb = Number.isFinite(tb) ? tb : 0;
    return vb - va;
  });
}

function buildPwHeaders(token: string, extraHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
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
    ...extraHeaders,
  };
}

const UNLOCK_CONTENTS_BATCH_ID = '634bd315ed7a360018558283';
const scheduleCache = new Map<string, { data: any; savedAt: number }>();
const SCHEDULE_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const khazanaCache = new Map<string, { data: any; savedAt: number }>();
const KHAZANA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchVidcloudApiRaw(
  apiPath: string,
  extraHeaders: Record<string, string> = {}
): Promise<{ ok: boolean; status: number; data: any; errorText: string }> {
  let token = await getBearerToken(false);
  let res = await fetch(`${API_BASE}${apiPath}`, {
    headers: buildPwHeaders(token, extraHeaders),
  });

  // Refresh bearer token ONLY on 401 (expired/invalid token), NOT 403 (scope restriction),
  // to avoid hammering generate_token.php into a 429 cooldown.
  if (res.status === 401) {
    token = await getBearerToken(true);
    res = await fetch(`${API_BASE}${apiPath}`, {
      headers: buildPwHeaders(token, extraHeaders),
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { ok: false, status: res.status, data: null, errorText: errText };
  }
  const data = await res.json().catch(() => null);
  return { ok: true, status: res.status, data, errorText: '' };
}

async function fetchVidcloudApi(apiPath: string, extraHeaders: Record<string, string> = {}): Promise<any> {
  const result = await fetchVidcloudApiRaw(apiPath, extraHeaders);
  if (!result.ok) {
    throw new Error(`API ${apiPath} returned ${result.status}: ${result.errorText.slice(0, 200)}`);
  }
  return result.data;
}

const KHAZANA_EXTRA_HEADERS: Record<string, string> = {
  'If-None-Match': 'W/"428-hT7bz047ONtYfHPB7gUh9/xUDPY"',
};

async function fetchKhazanaCached(cacheKey: string, apiPath: string): Promise<any> {
  const cached = khazanaCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < KHAZANA_CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await fetchVidcloudApi(apiPath, KHAZANA_EXTRA_HEADERS);
  khazanaCache.set(cacheKey, { data, savedAt: Date.now() });
  return data;
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

function resolveTeacherAvatarUrl(imgObj: any): string {
  if (!imgObj || typeof imgObj !== 'object') return '';
  const base = String(imgObj.baseUrl || '').replace(/^https?:\/\/cors\.testfile\.eu\.org\//i, 'https://');
  const key = String(imgObj.key || '').trim();
  if (!base || !key) return '';
  return `${base.endsWith('/') ? base : `${base}/`}${key.replace(/^\//, '')}`;
}

function buildTeacherAndSubjectMaps(details: any) {
  const teacherMap = new Map<string, string>();
  const teacherImageMap = new Map<string, string>();
  const subjectById = new Map<string, { name: string; slug: string }>();
  const subjectPrimaryTeacherMap = new Map<string, { name: string; image: string }>();

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
        const tId = String(t._id);
        const fullName = [t.firstName, t.lastName].filter(Boolean).join(' ').trim() || t.name || '';
        const imgUrl = resolveTeacherAvatarUrl(t.imageId);
        if (fullName) teacherMap.set(tId, fullName);
        if (imgUrl) teacherImageMap.set(tId, imgUrl);
        if (subj?._id && !subjectPrimaryTeacherMap.has(String(subj._id)) && (fullName || imgUrl)) {
          subjectPrimaryTeacherMap.set(String(subj._id), { name: fullName, image: imgUrl });
        }
      }
    }
  }
  return { teacherMap, teacherImageMap, subjectById, subjectPrimaryTeacherMap };
}

function enrichScheduleItems(items: any[], details: any): any[] {
  const { teacherMap, teacherImageMap, subjectById, subjectPrimaryTeacherMap } = buildTeacherAndSubjectMaps(details);
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

    const batchSubjIdStr = String(item?.batchSubjectId || item?.subjectId?._id || '');
    const subjMeta =
      (item?.batchSubjectId && subjectById.get(String(item.batchSubjectId))) ||
      (item?.subjectId?._id && subjectById.get(String(item.subjectId._id))) ||
      null;
    const subjectName = item?.subjectId?.name || subjMeta?.name || 'General';
    const subjectSlug = item?.subjectId?.slug || subjMeta?.slug || String(item?.batchSubjectId || '');

    const rawTeachers = Array.isArray(item?.teachers) ? item.teachers : [];
    const teacherNames: string[] = [];
    const teacherImages: string[] = [];

    for (const t of rawTeachers) {
      if (typeof t === 'string') {
        const name = teacherMap.get(t) || '';
        const img = teacherImageMap.get(t) || '';
        if (name) teacherNames.push(name);
        if (img) teacherImages.push(img);
      } else if (t && typeof t === 'object') {
        const tId = String(t?._id || '');
        const name = [t?.firstName, t?.lastName].filter(Boolean).join(' ').trim() || t?.name || (tId ? teacherMap.get(tId) || '' : '');
        const img = resolveTeacherAvatarUrl(t?.imageId) || (tId ? teacherImageMap.get(tId) || '' : '');
        if (name) teacherNames.push(name);
        if (img) teacherImages.push(img);
      }
    }

    const subjPrimaryTeacher = batchSubjIdStr ? subjectPrimaryTeacherMap.get(batchSubjIdStr) : undefined;
    if (teacherNames.length === 0 && subjPrimaryTeacher?.name) {
      teacherNames.push(subjPrimaryTeacher.name);
    }
    if (teacherImages.length === 0 && subjPrimaryTeacher?.image) {
      teacherImages.push(subjPrimaryTeacher.image);
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

    const startTs = Date.parse(item?.startTime || item?.date || '') || 0;
    const endTs = Date.parse(item?.endTime || '') || (startTs ? startTs + 2 * 60 * 60 * 1000 : 0);
    const rawStatus = String(item?.status || '').toUpperCase();
    const isCancelled =
      rawStatus === 'CANCELED' ||
      rawStatus === 'CANCELLED' ||
      /class\s*cancel|cancelled/i.test(resolvedTopic);

    let liveStatus: 'LIVE' | 'UPCOMING' | 'COMPLETED' = 'COMPLETED';
    if (!isCancelled && startTs && endTs && now >= startTs && now <= endTs && rawStatus !== 'COMPLETED') {
      liveStatus = 'LIVE';
    } else if (!isCancelled && startTs && now < startTs) {
      liveStatus = 'UPCOMING';
    } else if (!isCancelled && rawStatus === 'PENDING' && startTs > now) {
      liveStatus = 'UPCOMING';
    } else if (!isCancelled && rawStatus === 'LIVE') {
      liveStatus = 'LIVE';
    }

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
      teacherImages,
      teacherImage: teacherImages[0] || item?.videoDetails?.image || '',
      tag: String(item?.tag || rawItem?.tag || ''),
      isCancelled,
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

export function createApiApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, runtime: process.env.VERCEL ? 'vercel' : 'node' });
  });

  // 1. Batches catalog proxy & cache (full catalog, newest batches sorted first)
  app.get('/api/batches', async (_req, res) => {
    try {
      if (cachedBatchesPayload && Date.now() - batchesFetchedAt < BATCHES_TTL_MS) {
        return res.json(cachedBatchesPayload);
      }
      const r = await fetch(`https://studystark.github.io/batches/batches.json?_t=${Date.now()}`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!r.ok) {
        if (cachedBatchesPayload) return res.json(cachedBatchesPayload);
        return res.status(r.status).json({ success: false, message: 'Failed to load batches catalog' });
      }
      const json = (await r.json()) as any;
      const normalized = {
        ...json,
        data: sortBatchesNewestFirst(json?.data || []),
        vidyapeeth_batches: sortBatchesNewestFirst(json?.vidyapeeth_batches || []),
      };
      cachedBatchesPayload = normalized;
      batchesFetchedAt = Date.now();
      return res.json(normalized);
    } catch (err: any) {
      if (cachedBatchesPayload) return res.json(cachedBatchesPayload);
      return res.status(500).json({ success: false, message: err?.message || 'Batches load error' });
    }
  });

  const sanitizeAnnouncementText = (txt: string) =>
    String(txt || '')
      .replace(/https?:\/\/(?:t\.me|telegram\.me|telegram\.dog|wa\.me|chat\.whatsapp\.com|whatsapp\.com)[^\s)]*/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  // Curated Khazana programs & batch-to-Khazana fallback matcher
  const KHAZANA_PROGRAMS = [
    {
      programId: '62cd3a81c521a200190acaca',
      batchId: '65dc6fbabb55350018d555b7',
      title: '12th JEE Khazana',
      subtitle: 'Physics, Chemistry & Maths by Rajwant Sir, Saleem Sir, Pankaj Sir & Top JEE Faculty',
      exam: 'IIT-JEE',
      classLevel: '12',
      batchName: 'Lakshya JEE',
      photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/1da7fd49-8e2c-44da-a186-5134e41d4d01.png',
    },
    {
      programId: '62cc7a39ea773600110bec2f',
      batchId: '676e4dee1ec923bc192f38c9',
      title: '11th JEE Khazana',
      subtitle: 'Complete Class 11 JEE foundation lectures, chapter notes & DPP vaults',
      exam: 'IIT-JEE',
      classLevel: '11',
      batchName: 'Arjuna JEE',
      photo: 'https://d2bps9p1kiy4ka.cloudfront.net/5eb393ee95fab7468a79d189/61e8fafe-0891-4741-a76d-b3f7dedae5b7.png',
    },
    {
      programId: '62c7bcec812cae001195d121',
      batchId: '67738e4a5787b05d8ec6e07f',
      title: 'Dropper JEE Khazana',
      subtitle: 'Full 11th + 12th JEE Advanced & Mains archive for droppers',
      exam: 'IIT-JEE',
      classLevel: 'Dropper',
      batchName: 'Prayas JEE',
      photo: 'https://d2bps9p1kiy4ka.cloudfront.net/5eb393ee95fab7468a79d189/b3aaed00-621d-42a2-b382-9e9541251672.png',
    },
    {
      programId: '62cd4128972ca20018b4c092',
      batchId: '65d75d320531c20018ade9bb',
      title: '12th NEET Khazana',
      subtitle: 'Botany, Zoology, Physics & Chemistry by Alakh Sir, MR Sir, Tarun Sir & more',
      exam: 'NEET',
      classLevel: '12',
      batchName: 'Lakshya NEET',
      photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/4ccf204a-a9fd-44d2-a2b0-39542a282c0d.png',
    },
    {
      programId: '62cc8e68ae30df00118980dc',
      batchId: '676e5677418e84037bd6247c',
      title: '11th NEET Khazana',
      subtitle: 'Complete Class 11 NEET medical prep lectures & practice sheets',
      exam: 'NEET',
      classLevel: '11',
      batchName: 'Arjuna NEET',
      photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/faaf5401-7378-41fc-89bf-14e8cad4d25c.png',
    },
    {
      programId: '62c7bd151690a10018df0307',
      batchId: '67738e4c6e30ac746bcb34d7',
      title: 'Dropper NEET Khazana',
      subtitle: 'High-yield Yakeen NEET recorded masterclasses across all 4 subjects',
      exam: 'NEET',
      classLevel: 'Dropper',
      batchName: 'Yakeen NEET',
      photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/bda01e28-e8dc-4930-a0f9-6a578e1b5afe.png',
    },
    {
      programId: '63e635e601fada0018af9a35',
      batchId: '65d8a0214592220018befbe7',
      title: 'Class 12th Boards Khazana',
      subtitle: 'Board-focused NCERT derivations, sample papers & chapter marathons',
      exam: 'Boards',
      classLevel: '12',
      batchName: 'Parishram',
      photo: '',
    },
    {
      programId: '62e6939eedf07d00114c9f06',
      batchId: '65d898a774dfb200182ce11b',
      title: 'Class 10th Khazana',
      subtitle: 'Complete Class 10 Science, Maths, SST & English recorded lectures',
      exam: 'Foundation',
      classLevel: '10',
      batchName: 'Udaan',
      photo: '',
    },
    {
      programId: '62e541ce2d69e6001129d8bd',
      batchId: '63fc94f4769ef90018fd8551',
      title: 'Class 9th Khazana',
      subtitle: 'Strong Class 9 foundation courses for Science, Maths & Olympiad prep',
      exam: 'Foundation',
      classLevel: '9',
      batchName: 'Neev',
      photo: '',
    },
    {
      programId: '644b86cbc8de6400183fe8a2',
      batchId: '64d76d08873c2600194d2bf0',
      title: 'UPSC Khazana',
      subtitle: '23+ GS, Optional, Polity, Economy, Geography & CSAT faculty modules',
      exam: 'UPSC',
      classLevel: 'Graduation',
      batchName: 'Sankalp UPSC',
      photo: '',
    },
  ];

  const inferKhazanaProgramId = (details: any): string | null => {
    if (details?.khazanaProgramId) return String(details.khazanaProgramId);
    const haystack = [
      details?.name,
      details?.byName,
      details?.class,
      ...(Array.isArray(details?.exam) ? details.exam : [details?.exam]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack) return null;

    if (/upsc|ias|sankalp/.test(haystack)) return '644b86cbc8de6400183fe8a2';
    if (/neet|yakeen/.test(haystack)) {
      if (/yakeen|dropper|12\+|13/.test(haystack)) return '62c7bd151690a10018df0307';
      if (/arjuna|11th|\b11\b/.test(haystack)) return '62cc8e68ae30df00118980dc';
      return '62cd4128972ca20018b4c092';
    }
    if (/jee|prayas/.test(haystack)) {
      if (/prayas|dropper|12\+|13/.test(haystack)) return '62c7bcec812cae001195d121';
      if (/arjuna|11th|\b11\b/.test(haystack)) return '62cc7a39ea773600110bec2f';
      return '62cd3a81c521a200190acaca';
    }
    if (/udaan|10th|\b10\b/.test(haystack)) return '62e6939eedf07d00114c9f06';
    if (/neev|9th|\b9\b/.test(haystack)) return '62e541ce2d69e6001129d8bd';
    if (/parishram|board|12th|\b12\b/.test(haystack)) return '63e635e601fada0018af9a35';
    return null;
  };

  // 2. Batch details + subjects + announcements + mahapack mapping
  app.get('/api/batch/:batchId', async (req, res) => {
    const { batchId } = req.params;
    try {
      const [detailsRes, announcementsRes] = await Promise.allSettled([
        fetchVidcloudApi(`/v3/batches/${encodeURIComponent(batchId)}/details?type=EXPLORE_LEAD`),
        fetchVidcloudApi(`/v1/batches/${encodeURIComponent(batchId)}/announcement?page=1`),
      ]);

      const details = detailsRes.status === 'fulfilled' ? detailsRes.value?.data || null : null;
      const rawAnnouncements =
        announcementsRes.status === 'fulfilled' && Array.isArray(announcementsRes.value?.data)
          ? announcementsRes.value.data
          : [];

      const announcements = rawAnnouncements
        .map((a: any) => {
          const cleanBody = sanitizeAnnouncementText(a?.announcement || a?.title || '');
          if (!cleanBody) return null;
          return {
            ...a,
            announcement: cleanBody,
            attachment: a?.attachment ? normalizeAttachment(a.attachment) : a?.attachment,
          };
        })
        .filter(Boolean);

      let mahapackBatches: any[] = [];
      if (!details?.subjects?.length || details?.type === 'MAHAPACK') {
        try {
          const mp = await fetchVidcloudApi(
            `/v3/batch-service/mahapack-mapping?mahapackId=${encodeURIComponent(batchId)}&page=1`
          );
          if (Array.isArray(mp?.data)) {
            mahapackBatches = mp.data;
          }
        } catch {
          // ignore if not a mahapack
        }
      }

      return res.json({
        success: true,
        batch: details,
        khazanaProgramId: inferKhazanaProgramId(details),
        subjects: details?.subjects || [],
        mahapackBatches,
        announcements,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to fetch batch details' });
    }
  });

  app.get('/api/khazana/programs', (_req, res) => {
    return res.json({
      success: true,
      programs: KHAZANA_PROGRAMS,
    });
  });

  app.get('/api/khazana/:programId/filters', async (req, res) => {
    const { programId } = req.params;
    try {
      const data = await fetchKhazanaCached(
        `filters:${programId}`,
        `/v2/programs/${encodeURIComponent(programId)}/filters`
      );
      const progData = data?.data || {};
      const subjectFilter = Array.isArray(progData.filters)
        ? progData.filters.find((f: any) => f.key === 'subjectId')
        : null;
      const subjects = Array.isArray(subjectFilter?.options)
        ? subjectFilter.options.filter((o: any) => o?.value && o.value !== 'all')
        : [];
      return res.json({
        success: true,
        programId: progData._id || programId,
        name: progData.name || 'Khazana',
        subjects,
        filters: progData.filters || [],
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load Khazana filters' });
    }
  });

  app.get('/api/khazana/:programId/teachers', async (req, res) => {
    const { programId } = req.params;
    const page = String(req.query.page || '1');
    try {
      const data = await fetchKhazanaCached(
        `teachers:${programId}:${page}`,
        `/v2/programs/${encodeURIComponent(programId)}/teachers?page=${encodeURIComponent(page)}`
      );
      const list = Array.isArray(data?.data) ? data.data : [];
      return res.json({
        success: true,
        teachers: list,
        paginate: data?.paginate || null,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load Khazana teachers' });
    }
  });

  app.get('/api/khazana/:programId/subjects/:subjectId/chapters', async (req, res) => {
    const { programId, subjectId } = req.params;
    const page = String(req.query.page || '1');
    const limit = String(req.query.limit || '12');
    try {
      const data = await fetchKhazanaCached(
        `subj-chaps:${programId}:${subjectId}:${page}:${limit}`,
        `/v2/programs/${encodeURIComponent(programId)}/subjects/${encodeURIComponent(subjectId)}/chapters/list?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`
      );
      return res.json({
        success: true,
        chapters: Array.isArray(data?.data) ? data.data : [],
        paginate: data?.paginate || null,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load Khazana chapters' });
    }
  });

  app.get('/api/khazana/:programId/teachers/:teacherId/chapters', async (req, res) => {
    const { programId, teacherId } = req.params;
    const page = String(req.query.page || '1');
    const limit = String(req.query.limit || '20');
    try {
      const data = await fetchKhazanaCached(
        `teacher-chaps:${programId}:${teacherId}:${page}:${limit}`,
        `/v2/programs/${encodeURIComponent(programId)}/teacher/${encodeURIComponent(teacherId)}/chapters?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`
      );
      return res.json({
        success: true,
        chapters: Array.isArray(data?.data) ? data.data : [],
        paginate: data?.paginate || null,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load teacher chapters' });
    }
  });

  app.get('/api/khazana/:programId/subjects/:subjectId/chapters/:chapterId/topics', async (req, res) => {
    const { programId, subjectId, chapterId } = req.params;
    const page = String(req.query.page || '1');
    const limit = String(req.query.limit || '20');
    try {
      const data = await fetchKhazanaCached(
        `topics:${programId}:${subjectId}:${chapterId}:${page}:${limit}`,
        `/v2/programs/${encodeURIComponent(programId)}/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}/topics/list?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`
      );
      return res.json({
        success: true,
        topics: Array.isArray(data?.data) ? data.data : [],
        paginate: data?.paginate || null,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load Khazana topics' });
    }
  });

  app.get('/api/khazana/:programId/subjects/:subjectId/chapters/:chapterId/topics/:topicId/sub-topics', async (req, res) => {
    const { programId, subjectId, chapterId, topicId } = req.params;
    try {
      const data = await fetchKhazanaCached(
        `subtopics:${programId}:${subjectId}:${chapterId}:${topicId}`,
        `/v2/programs/${encodeURIComponent(programId)}/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}/topics/${encodeURIComponent(topicId)}/contents/sub-topic?page=1&limit=50`
      );
      return res.json({
        success: true,
        subTopics: Array.isArray(data?.data) ? data.data : [],
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load Khazana sub-topics' });
    }
  });

  app.get('/api/khazana/:programId/subjects/:subjectId/chapters/:chapterId/topics/:topicId/sub-topics/:subTopicId/contents', async (req, res) => {
    const { programId, subjectId, chapterId, topicId, subTopicId } = req.params;
    const page = String(req.query.page || '1');
    const limit = String(req.query.limit || '20');
    try {
      const data = await fetchKhazanaCached(
        `contents:${programId}:${subjectId}:${chapterId}:${topicId}:${subTopicId}:${page}:${limit}`,
        `/v2/programs/${encodeURIComponent(programId)}/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}/topics/${encodeURIComponent(topicId)}/sub-topic/${encodeURIComponent(subTopicId)}/contents?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`
      );
      const rawItems = Array.isArray(data?.data) ? data.data : [];
      const items = rawItems.map((entry: any) => {
        const inner = entry?.data || {};
        const normalizedFile = inner?.fileId ? normalizeAttachment(inner.fileId) : null;
        const normalizedImg = inner?.imageId ? normalizeAttachment(inner.imageId) : null;
        return {
          ...entry,
          data: {
            ...inner,
            fileId: normalizedFile || inner.fileId,
            imageId: normalizedImg || inner.imageId,
          },
        };
      });
      return res.json({
        success: true,
        items,
        paginate: data?.paginate || null,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load Khazana contents' });
    }
  });

  // 3. Subject chapters / topics
  app.get('/api/topics/:batchId/:subjectId', async (req, res) => {
    const { batchId, subjectId } = req.params;
    const page = req.query.page || '1';
    try {
      const data = await fetchVidcloudApi(
        `/v2/batches/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subjectId)}/topics?page=${encodeURIComponent(String(page))}`
      );
      return res.json({
        success: true,
        topics: Array.isArray(data?.data) ? data.data : [],
        paginate: data?.paginate || null,
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
    const isNotesType = contentType === 'notes' || contentType === 'DppNotes';

    try {
      let data: any = null;

      if (isNotesType) {
        // PW strips attachment `key` on unpaid batchIds, while querying the unlocked prefix returns real PDF keys
        const unlockedRes = await fetchVidcloudApiRaw(
          `/v2/batches/${UNLOCK_CONTENTS_BATCH_ID}/subject/${encodeURIComponent(subjectId)}/contents?tag=${encodeURIComponent(topicId)}&contentType=${encodeURIComponent(contentType)}&page=${encodeURIComponent(page)}`
        );
        if (unlockedRes.ok && Array.isArray(unlockedRes.data?.data) && unlockedRes.data.data.length > 0) {
          data = unlockedRes.data;
        }
      }

      if (!data) {
        data = await fetchVidcloudApi(
          `/v2/batches/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subjectId)}/contents?tag=${encodeURIComponent(topicId)}&contentType=${encodeURIComponent(contentType)}&page=${encodeURIComponent(page)}`
        );
      }

      const rawItems = Array.isArray(data?.data) ? data.data : [];
      const items = isNotesType ? normalizeNoteItems(rawItems) : rawItems;

      return res.json({
        success: true,
        items,
        paginate: data?.paginate || null,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to fetch contents' });
    }
  });

  // 4b. Today's Schedule (live PW todays-schedule + teacher/subject enrichment)
  app.get('/api/schedule/:batchId/today', async (req, res) => {
    const { batchId } = req.params;
    const cacheKey = `today:${batchId}`;
    const cached = scheduleCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < SCHEDULE_CACHE_TTL_MS) {
      return res.json(cached.data);
    }

    try {
      const [detailsRes, v1Res] = await Promise.allSettled([
        fetchVidcloudApiRaw(`/v3/batches/${encodeURIComponent(batchId)}/details?type=EXPLORE_LEAD`),
        fetchVidcloudApiRaw(
          `/v1/batches/${encodeURIComponent(batchId)}/todays-schedule?batchId=${encodeURIComponent(batchId)}&isNewStudyMaterialFlow=true`
        ),
      ]);

      const details = detailsRes.status === 'fulfilled' && detailsRes.value.ok ? detailsRes.value.data?.data : null;
      let items: any[] =
        v1Res.status === 'fulfilled' && v1Res.value.ok && Array.isArray(v1Res.value.data?.data)
          ? v1Res.value.data.data
          : [];

      if (items.length === 0) {
        const v2Res = await fetchVidcloudApiRaw(`/v2/batches/${encodeURIComponent(batchId)}/todays-schedule`);
        if (v2Res.ok && Array.isArray(v2Res.data?.data)) {
          items = v2Res.data.data;
        }
      }

      const enriched = enrichScheduleItems(items, details);
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

  // 4c. Weekly Schedule (tries PW weekly-schedules, falls back gracefully to real dated classes + todays-schedule)
  app.get('/api/schedule/:batchId/weekly', async (req, res) => {
    const { batchId } = req.params;
    const startDate = String(req.query.startDate || '').slice(0, 10);
    const endDate = String(req.query.endDate || '').slice(0, 10);
    const page = String(req.query.page || '1');

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'startDate and endDate (YYYY-MM-DD) are required' });
    }

    const cacheKey = `weekly:${batchId}:${startDate}:${endDate}:${page}`;
    const cached = scheduleCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < SCHEDULE_CACHE_TTL_MS) {
      return res.json(cached.data);
    }

    try {
      const [detailsRes, todayRes, w2Res] = await Promise.allSettled([
        fetchVidcloudApiRaw(`/v3/batches/${encodeURIComponent(batchId)}/details?type=EXPLORE_LEAD`),
        fetchVidcloudApiRaw(
          `/v1/batches/${encodeURIComponent(batchId)}/todays-schedule?batchId=${encodeURIComponent(batchId)}&isNewStudyMaterialFlow=true`
        ),
        fetchVidcloudApiRaw(
          `/v2/batches/${encodeURIComponent(batchId)}/weekly-schedules?batchId=${encodeURIComponent(batchId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&page=${encodeURIComponent(page)}`
        ),
      ]);

      const details = detailsRes.status === 'fulfilled' && detailsRes.value.ok ? detailsRes.value.data?.data : null;
      const todayRaw: any[] =
        todayRes.status === 'fulfilled' && todayRes.value.ok && Array.isArray(todayRes.value.data?.data)
          ? todayRes.value.data.data
          : [];

      if (w2Res.status === 'fulfilled' && w2Res.value.ok && Array.isArray(w2Res.value.data?.data)) {
        let weekItems = [...w2Res.value.data.data];
        // PW paginates weekly-schedules cleanly (~6-10 per page); fetch page 2 & 3 so full Mon-Sun appears
        if (page === '1' && weekItems.length >= 6) {
          for (const extraPage of [2, 3]) {
            const extraRes = await fetchVidcloudApiRaw(
              `/v2/batches/${encodeURIComponent(batchId)}/weekly-schedules?batchId=${encodeURIComponent(batchId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&page=${extraPage}`
            );
            if (extraRes.ok && Array.isArray(extraRes.data?.data) && extraRes.data.data.length > 0) {
              weekItems.push(...extraRes.data.data);
            } else {
              break;
            }
          }
        }
        const merged = mergeScheduleById(todayRaw, weekItems);
        const payload = {
          success: true,
          source: 'weekly-schedules',
          classes: enrichScheduleItems(merged, details),
          weeklyRoutine: [],
        };
        scheduleCache.set(cacheKey, { data: payload, savedAt: Date.now() });
        return res.json(payload);
      }

      // Upstream weekly-schedules returned 403 Scope Access: derive real dated classes from batch subjects' latest lectures + today's live classes
      const academicSubjects = (details?.subjects || []).filter(
        (s: any) =>
          s?.slug &&
          !/notice|guidance|orientation|planner/i.test(String(s.subject || ''))
      );

      const collectedLectures: any[] = [];
      for (const subj of academicSubjects.slice(0, 6)) {
        try {
          const tRes = await fetchVidcloudApiRaw(
            `/v2/batches/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subj.slug)}/topics?page=1`
          );
          const topicsList: any[] = tRes.ok && Array.isArray(tRes.data?.data) ? tRes.data.data : [];
          // Pick most recent active topics that actually have videos
          const activeTopics = topicsList.filter((t) => (t?.videos || 0) > 0).slice(0, 2);
          for (const topic of activeTopics) {
            const cRes = await fetchVidcloudApiRaw(
              `/v2/batches/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subj.slug)}/contents?tag=${encodeURIComponent(topic._id)}&contentType=videos&page=1`
            );
            const vids: any[] = cRes.ok && Array.isArray(cRes.data?.data) ? cRes.data.data : [];
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

      // Filter dated classes within [startDate, endDate] (buffered +-1 day for IST timezone)
      const inRangeLectures = collectedLectures.filter((item) => {
        const dStr = getIstDateKey(item.startTime || item.date);
        return dStr && dStr >= startDate && dStr <= endDate;
      });

      // Build typical weekday timetable per subject from real uploaded lecture timestamps
      const routineMap = new Map<string, any>();
      for (const item of collectedLectures) {
        const refTime = item.startTime || item.date;
        if (!refTime) continue;
        const dt = new Date(refTime);
        if (Number.isNaN(dt.getTime())) continue;
        // Convert UTC to IST (UTC+5:30)
        const ist = new Date(dt.getTime() + 330 * 60 * 1000);
        const weekday = ist.getUTCDay(); // 0=Sun..6=Sat
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

  // 5. Resolve real video stream (passes token+cookie to play.php, retries transient failures, decrypts AES-128-CBC + attachments)
  app.get('/api/stream', async (req, res) => {
    const batchId = String(req.query.batch_id || '');
    const programId = String(req.query.program_id || '');
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

      let token = '';
      try {
        token = await getBearerToken(false);
      } catch {
        // play.php may still work with its server pool
      }

      let resolvedUrl = '';
      let keyIdB64 = '';
      let keyValB64 = '';
      let drmType = '';
      let attachmentsRaw = '';

      const tryPlayPhp = async (
        candidateVid: string,
        currentToken: string,
        overrideType?: string,
        overrideTypeId?: string
      ) => {
        const params = new URLSearchParams({
          batch_id: batchId,
          subject_id: subjectId,
          topic_id: topicId,
          video_id: candidateVid,
          video_name: videoName,
          video_img: videoImg,
          video_type: overrideType || videoType,
          play_type: playType,
        });
        if (programId) params.set('program_id', programId);
        const effectiveTypeId = overrideTypeId !== undefined ? overrideTypeId : typeId;
        if (effectiveTypeId) params.set('typeId', effectiveTypeId);
        if (currentToken) params.set('token', currentToken);

        const playUrl = `https://vidcloud.eu.org/play.php?${params.toString()}`;
        const playRes = await fetch(playUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            Referer: 'https://vidcloud.eu.org/',
            ...(currentToken ? { Cookie: `token=${currentToken}; access_token=${currentToken}` } : {}),
          },
        });
        if (!playRes.ok) {
          return { ok: false, status: playRes.status };
        }
        const html = await playRes.text();

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

      // Up to 5 attempts alternating cached token, upstream server pool (no token), and refreshed token
      // to avoid reusing a 429 rate-limited PenPencil token.
      // For Khazana (programId present), try upstream pool first since Khazana uses play.php's Khazana pool.
      const backoffMs = [0, 400, 800, 1200, 1600];
      for (let attempt = 0; attempt < backoffMs.length && !resolvedUrl; attempt++) {
        if (backoffMs[attempt] > 0) {
          await new Promise((r) => setTimeout(r, backoffMs[attempt]));
        }

        let attemptToken = '';
        if (programId) {
          attemptToken = attempt === 0 || attempt === 2 ? '' : token;
        } else if (attempt === 0) {
          attemptToken = token;
        } else if (attempt === 1 || attempt === 3) {
          attemptToken = ''; // Let play.php use its own rotating pool
        } else {
          try {
            token = await getBearerToken(true);
            attemptToken = token;
          } catch {
            attemptToken = '';
          }
        }

        const primaryId = candidateIds[0] || videoId;
        const primaryAttempt = await tryPlayPhp(primaryId, attemptToken);
        if (primaryAttempt.ok && primaryAttempt.urlOut) {
          resolvedUrl = primaryAttempt.urlOut;
          keyIdB64 = primaryAttempt.kId || '';
          keyValB64 = primaryAttempt.kVal || '';
          drmType = primaryAttempt.dType || '';
          attachmentsRaw = primaryAttempt.attRaw || '';
          break;
        }

        // Khazana fallback: try video_type=new with videoDetailsId as video_id and lecId as typeId
        if (programId && videoDetailsId && videoId) {
          const khFallback = await tryPlayPhp(videoDetailsId, attemptToken, 'new', videoId);
          if (khFallback.ok && khFallback.urlOut) {
            resolvedUrl = khFallback.urlOut;
            keyIdB64 = khFallback.kId || '';
            keyValB64 = khFallback.kVal || '';
            drmType = khFallback.dType || '';
            attachmentsRaw = khFallback.attRaw || '';
            break;
          }
        }

        // On retry attempts, also check secondary candidate IDs (e.g. findKey / videoDetailsId) if different
        if (attempt >= 1 && candidateIds.length > 1) {
          for (const altId of candidateIds.slice(1)) {
            const altAttempt = await tryPlayPhp(altId, attemptToken);
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

      // Direct stream URL fallback (if lecture JSON already carries a direct .m3u8/.mpd/.mp4 URL)
      if (!resolvedUrl && rawVideoUrl && /\.(m3u8|mpd|mp4)(\?|$)/i.test(rawVideoUrl)) {
        resolvedUrl = rawVideoUrl;
      }

      if (!resolvedUrl) {
        return res.status(404).json({
          success: false,
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
      let attachments: any[] = [];
      try {
        if (attachmentsRaw) {
          const parsedAtt = JSON.parse(attachmentsRaw);
          if (parsedAtt?.notes?.length) attachments.push(...parsedAtt.notes);
          if (parsedAtt?.dpp_pdf?.length) attachments.push(...parsedAtt.dpp_pdf);
        }
      } catch {
        // ignore
      }

      // Also check data-api.php for attachments in case hidden input was empty
      if (attachments.length === 0 && videoId) {
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

      // If still empty and subjectId/topicId are known, resolve matching notes from unlocked contents
      if (attachments.length === 0 && subjectId && topicId) {
        try {
          const notesRes = await fetchVidcloudApiRaw(
            `/v2/batches/${UNLOCK_CONTENTS_BATCH_ID}/subject/${encodeURIComponent(subjectId)}/contents?tag=${encodeURIComponent(topicId)}&contentType=notes&page=1`
          );
          const noteList: any[] = notesRes.ok && Array.isArray(notesRes.data?.data) ? notesRes.data.data : [];
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
      const parsedTarget = new URL(targetUrl);
      // Re-attach CloudFront signature query if passed separately and missing on target
      if (sigQuery && !parsedTarget.searchParams.has('Signature')) {
        const sigParams = new URLSearchParams(sigQuery);
        sigParams.forEach((v, k) => {
          if (!parsedTarget.searchParams.has(k)) {
            parsedTarget.searchParams.set(k, v);
          }
        });
      }

      const upstreamHeaders: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Referer: 'https://vidcloud.eu.org/',
      };
      if (req.headers.range) {
        upstreamHeaders.Range = String(req.headers.range);
      }

      const upstream = await fetch(parsedTarget.toString(), { headers: upstreamHeaders });

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

  // 8. Study AI Doubt Solver & Tutor (Server-Side Gemini API)
  const getGeminiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Study AI is not ready yet because GEMINI_API_KEY is not set in Settings > Secrets.'
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
        'You are Study AI, an expert Indian academic mentor & doubt solver built inside Study Cloud (for Class 9-12, IIT-JEE, NEET, and UPSC students).',
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
            message: 'Study AI abhi busy hai (high demand). 5 second baad dubara Ask par tap karein.',
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
          message: 'Study AI returned an empty answer. Please rephrase your question and try again.',
        });
      }

      return res.json({
        success: true,
        reply: responseText,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err?.message || 'Could not reach Study AI right now.',
      });
    }
  });

  app.post('/api/ai/generate-test', async (req, res) => {
    try {
      const {
        subject = 'Physics',
        topic = 'Mechanics & Laws of Motion',
        exam = 'IIT-JEE',
        count = 5,
      } = (req.body || {}) as {
        subject?: string;
        topic?: string;
        exam?: string;
        count?: number;
      };
      const cleanTopic = String(topic || '').trim();
      if (!cleanTopic) {
        return res.status(400).json({ success: false, message: 'Please enter a chapter or topic name.' });
      }
      const safeCount = Math.max(3, Math.min(10, Number(count) || 5));
      const ai = getGeminiClient();

      const prompt = [
        `Generate ${safeCount} original, exam-accurate multiple-choice questions for ${exam} (${subject} — Topic: ${cleanTopic}).`,
        'Each question must have exactly 4 concise options, a valid correctIndex (0 to 3), a clear 1-2 line solution explanation, and topic label.',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctIndex: { type: Type.INTEGER },
                explanation: { type: Type.STRING },
                topic: { type: Type.STRING },
              },
              required: ['question', 'options', 'correctIndex', 'explanation'],
            },
          },
        },
      });

      const rawText = (response.text || '').trim();
      const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return res.status(502).json({ success: false, message: 'Could not generate test questions.' });
      }
      const questions = parsed
        .filter((q: any) => q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length >= 2)
        .map((q: any) => {
          const opts = q.options.slice(0, 4).map((o: any) => String(o));
          while (opts.length < 4) opts.push('None of these');
          const idx = Math.max(0, Math.min(3, Number(q.correctIndex) || 0));
          return {
            question: String(q.question),
            options: opts,
            correctIndex: idx,
            explanation: String(q.explanation || 'Review the core formula and verify step by step.'),
            topic: String(q.topic || cleanTopic),
          };
        });
      if (questions.length === 0) {
        return res.status(502).json({ success: false, message: 'Could not parse generated test questions.' });
      }
      return res.json({ success: true, questions });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err?.message || 'Test generation failed.',
      });
    }
  });

  // 9. Clean App Controls Proxy (removes any Telegram/WhatsApp promo links)
  app.get('/api/app-controls', async (_req, res) => {
    const cleanButtons = (btns: any[]) =>
      (Array.isArray(btns) ? btns : []).filter((b) => {
        const name = String(b?.name || '').toLowerCase();
        const url = String(b?.url || '').toLowerCase();
        return (
          !name.includes('telegram') &&
          !name.includes('whatsapp') &&
          !url.includes('telegram') &&
          !url.includes('t.me') &&
          !url.includes('whatsapp') &&
          !url.includes('wa.me')
        );
      });

    try {
      const upstream = await fetch(`https://vidcloud.eu.org/app-controls.php?_t=${Date.now()}`, {
        headers: { 'User-Agent': USER_AGENT, 'X-Requested-With': 'SPA-Client' },
      });
      if (upstream.ok) {
        const json = (await upstream.json()) as any;
        if (json?.success && json?.data) {
          return res.json({
            success: true,
            data: {
              ...json.data,
              action_buttons: cleanButtons(json.data.action_buttons),
            },
          });
        }
      }
    } catch {
      // fallback below
    }

    return res.json({
      success: true,
      data: {
        maintenance_mode: false,
        community_tab: true,
        tests_tab: true,
        dpp_quiz_tab: true,
        action_buttons: [],
      },
    });
  });

  // 10. PW Test Proxy (Live Batch DPP Quizzes, Exercises & CBT Start/Preview Proxy)
  const pwProxyCache = new Map<string, { data: any; savedAt: number }>();
  const PW_PROXY_TTL_MS = 4 * 60 * 1000;

  app.get('/api/pw/batch-quizzes/:batchId', async (req, res) => {
    const { batchId } = req.params;
    const requestedSubjectSlug = String(req.query.subjectSlug || '').trim();
    const requestedTopicId = String(req.query.topicId || '').trim();
    const cacheKey = `pw-quiz:${batchId}:${requestedSubjectSlug}:${requestedTopicId}`;
    const cached = pwProxyCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < PW_PROXY_TTL_MS) {
      return res.json(cached.data);
    }

    try {
      const detailsRes = await fetchVidcloudApiRaw(
        `/v3/batches/${encodeURIComponent(batchId)}/details?type=EXPLORE_LEAD`
      );
      const details = detailsRes.ok ? detailsRes.data?.data : null;
      const batchName = details?.name || 'PW Batch';
      const allSubjects: any[] = Array.isArray(details?.subjects) ? details.subjects : [];
      const academicSubjects = allSubjects.filter(
        (s: any) => s?.slug && !/notice|guidance|orientation|planner/i.test(String(s.subject || ''))
      );

      const targetSubject =
        (requestedSubjectSlug && academicSubjects.find((s: any) => s.slug === requestedSubjectSlug)) ||
        academicSubjects[0] ||
        null;

      if (!targetSubject) {
        return res.json({
          success: true,
          batchId,
          batchName,
          subjects: [],
          topics: [],
          quizzes: [],
          testCats: details?.testCats || [],
        });
      }

      const topicsRes = await fetchVidcloudApiRaw(
        `/v2/batches/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(targetSubject.slug)}/topics?page=1`
      );
      const rawTopics: any[] = topicsRes.ok && Array.isArray(topicsRes.data?.data) ? topicsRes.data.data : [];
      const quizTopics = rawTopics.filter((t) => (t?.exercises || 0) > 0 || (t?.notes || 0) > 0);

      const topicsToFetch = requestedTopicId
        ? quizTopics.filter((t) => String(t._id) === requestedTopicId)
        : quizTopics.filter((t) => (t?.exercises || 0) > 0).slice(0, 4);

      const quizzes: any[] = [];
      const seenEx = new Set<string>();

      await Promise.allSettled(
        topicsToFetch.map(async (topic) => {
          const exRes = await fetchVidcloudApiRaw(
            `/v2/batches/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(targetSubject.slug)}/contents?tag=${encodeURIComponent(topic._id)}&contentType=exercises&page=1`
          );
          const items: any[] = exRes.ok && Array.isArray(exRes.data?.data) ? exRes.data.data : [];
          for (const item of items) {
            const exList = Array.isArray(item?.exerciseIds) ? item.exerciseIds : [];
            for (const ex of exList) {
              const firstContent = Array.isArray(ex?.content) ? ex.content[0] : null;
              const exerciseId = String(firstContent?.exerciseId || ex?._id || item?._id || '');
              if (!exerciseId || seenEx.has(exerciseId)) continue;
              seenEx.add(exerciseId);
              const exDet = firstContent?.exerciseDetails || {};
              quizzes.push({
                id: String(item?._id || exerciseId),
                exerciseId,
                title: String(ex?.title || item?.topic || 'DPP Quiz'),
                batchId,
                batchName,
                subjectName: targetSubject.subject || targetSubject.name || 'Subject',
                subjectSlug: targetSubject.slug,
                topicId: String(topic._id),
                topicName: String(topic.name || ''),
                totalQuestions: Number(exDet.totalQuestions || 10),
                totalMarks: Number(exDet.totalMarks || (Number(exDet.totalQuestions || 10) * 4)),
                maxDuration: Number(exDet.maxDuration || 0),
                startTime: item?.startTime || item?.date || '',
                status: item?.status || 'COMPLETED',
              });
            }
          }
        })
      );

      const payload = {
        success: true,
        batchId,
        batchName,
        subjects: academicSubjects.map((s: any) => ({
          _id: s._id,
          subject: s.subject || s.name,
          slug: s.slug,
          lectureCount: s.lectureCount || 0,
        })),
        activeSubjectSlug: targetSubject.slug,
        topics: quizTopics.map((t: any) => ({
          _id: t._id,
          name: t.name,
          exercises: t.exercises || 0,
          notes: t.notes || 0,
          videos: t.videos || 0,
        })),
        quizzes,
        testCats: Array.isArray(details?.testCats) ? details.testCats : [],
      };
      pwProxyCache.set(cacheKey, { data: payload, savedAt: Date.now() });
      return res.json(payload);
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err?.message || 'Failed to load PW batch quizzes',
      });
    }
  });

  app.post('/api/pw/start-quiz', async (req, res) => {
    try {
      const {
        exerciseId = '',
        batchName = 'PW Batch',
        subjectName = 'Physics',
        topicName = 'Chapter Practice',
        title = 'PW DPP Quiz',
        count = 10,
      } = (req.body || {}) as {
        exerciseId?: string;
        batchName?: string;
        subjectName?: string;
        topicName?: string;
        title?: string;
        count?: number;
      };

      // 1. Try upstream PenPencil exercise/test proxy first if exerciseId is provided
      if (exerciseId) {
        const upRes = await fetchVidcloudApiRaw(
          `/v3/test-service/tests/${encodeURIComponent(exerciseId)}/preview-test`
        ).catch(() => null);
        const upQuestions = upRes?.ok && Array.isArray(upRes.data?.data?.questions)
          ? upRes.data.data.questions
          : null;
        if (upQuestions && upQuestions.length > 0) {
          const formatted = upQuestions.slice(0, 15).map((q: any) => {
            const opts = (Array.isArray(q.options) ? q.options : [])
              .slice(0, 4)
              .map((o: any) => String(o?.texts?.en || o?.text || o || 'Option'));
            while (opts.length < 4) opts.push('None of these');
            const solIdx = Array.isArray(q.solutions) ? Number(q.solutions[0] ?? 0) : 0;
            return {
              question: String(q?.texts?.en || q?.question || 'Question'),
              options: opts,
              correctIndex: Math.max(0, Math.min(3, solIdx)),
              explanation: String(q?.solutionDescription?.en || 'Verify using standard PW concept notes.'),
              topic: topicName,
            };
          });
          return res.json({ success: true, source: 'pw-upstream', questions: formatted });
        }
      }

      // 2. Seamlessly construct matching exam-level CBT questions for the exact PW DPP Quiz
      const safeCount = Math.max(3, Math.min(12, Number(count) || 8));
      const ai = getGeminiClient();
      const prompt = [
        `Create ${safeCount} authentic competitive-exam MCQs matching the PW batch quiz "${title}" (${batchName} · Subject: ${subjectName} · Chapter: ${topicName}).`,
        'Each question must have 4 crisp options, correctIndex (0-3), and a clear 1-2 line solution explanation.',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctIndex: { type: Type.INTEGER },
                explanation: { type: Type.STRING },
                topic: { type: Type.STRING },
              },
              required: ['question', 'options', 'correctIndex', 'explanation'],
            },
          },
        },
      });

      const rawText = (response.text || '').trim();
      const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return res.status(502).json({ success: false, message: 'Could not prepare quiz paper.' });
      }
      const questions = parsed
        .filter((q: any) => q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length >= 2)
        .map((q: any) => {
          const opts = q.options.slice(0, 4).map((o: any) => String(o));
          while (opts.length < 4) opts.push('None of these');
          return {
            question: String(q.question),
            options: opts,
            correctIndex: Math.max(0, Math.min(3, Number(q.correctIndex) || 0)),
            explanation: String(q.explanation || 'Review the core formula and verify step by step.'),
            topic: String(q.topic || topicName),
          };
        });
      return res.json({ success: true, source: 'pw-quiz-builder', questions });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err?.message || 'Failed to launch PW Quiz',
      });
    }
  });

  // 11. PW Community Proxy (Live Multi-Batch Announcements, Notices & Community Metadata)
  app.get('/api/pw/community', async (req, res) => {
    const rawIds = String(req.query.batchIds || '').trim();
    const defaultBatchIds = [
      '65dc6fbabb55350018d555b7', // Lakshya JEE
      '676e4dee1ec923bc192f38c9', // Arjuna JEE
      '65d75d320531c20018ade9bb', // Lakshya NEET
      '676e5677418e84037bd6247c', // Arjuna NEET
    ];
    const batchIds = Array.from(
      new Set(
        (rawIds ? rawIds.split(',').map((s) => s.trim()).filter(Boolean) : defaultBatchIds).slice(0, 5)
      )
    );

    const cacheKey = `pw-comm:${batchIds.join(',')}`;
    const cached = pwProxyCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < PW_PROXY_TTL_MS) {
      return res.json(cached.data);
    }

    try {
      const posts: any[] = [];
      const channels: any[] = [];

      await Promise.allSettled(
        batchIds.map(async (bId) => {
          const [detRes, annRes] = await Promise.allSettled([
            fetchVidcloudApiRaw(`/v3/batches/${encodeURIComponent(bId)}/details?type=EXPLORE_LEAD`),
            fetchVidcloudApiRaw(`/v1/batches/${encodeURIComponent(bId)}/announcement?page=1`),
          ]);

          const details = detRes.status === 'fulfilled' && detRes.value.ok ? detRes.value.data?.data : null;
          const batchName = details?.name || 'Study Batch';
          const batchPhoto = details?.previewImage
            ? `${details.previewImage.baseUrl || ''}${details.previewImage.key || ''}`
            : '';

          channels.push({
            batchId: bId,
            batchName,
            batchPhoto,
            enableCommunity: Boolean(details?.enableCommunityWeb || details?.enableCommunity),
            exam: Array.isArray(details?.exam) ? details.exam.join(', ') : details?.exam || '',
          });

          const rawAnn: any[] =
            annRes.status === 'fulfilled' && annRes.value.ok && Array.isArray(annRes.value.data?.data)
              ? annRes.value.data.data
              : [];

          for (const a of rawAnn.slice(0, 12)) {
            const cleanBody = sanitizeAnnouncementText(a?.announcement || a?.title || '');
            if (!cleanBody) continue;
            const att = a?.attachment ? normalizeAttachment(a.attachment) : null;
            posts.push({
              id: String(a?._id || `${bId}-${posts.length}`),
              batchId: bId,
              batchName,
              batchPhoto,
              type: String(a?.type || 'ANNOUNCEMENT'),
              announcement: cleanBody,
              attachmentUrl: att?.resolvedUrl || '',
              attachmentName: att?.name || '',
              createdAt: a?.createdAt || '',
            });
          }
        })
      );

      posts.sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));

      const payload = {
        success: true,
        channels,
        posts,
      };
      pwProxyCache.set(cacheKey, { data: payload, savedAt: Date.now() });
      return res.json(payload);
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err?.message || 'Failed to load PW Community feed',
      });
    }
  });

  // 12. PW Pi Proxy (Interactive STEM Concept, Derivation, Shortcut & Numerical Solver)
  app.post('/api/pw/pi', async (req, res) => {
    try {
      const {
        query = '',
        subject = 'Physics',
        mode = 'solve',
        batchName = '',
      } = (req.body || {}) as {
        query?: string;
        subject?: string;
        mode?: 'solve' | 'concept' | 'trick' | 'formula';
        batchName?: string;
      };

      const cleanQuery = String(query || '').trim();
      if (!cleanQuery) {
        return res.status(400).json({ success: false, message: 'Please enter a numerical, formula, or topic.' });
      }

      const modeInstructions: Record<string, string> = {
        solve: 'Solve the numerical or question step-by-step, clearly listing Given Data, Formula Used, Substitution, and Final Answer with SI units.',
        concept: 'Explain the core concept from first principles with intuitive analogy, key equations, and common exam traps.',
        trick: 'Give a fast JEE/NEET shortcut method, dimensional check, and 30-second solving strategy.',
        formula: 'Provide a structured Formula Sheet for the requested topic with variable meanings, units, and boundary conditions.',
      };

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [{ role: 'user', parts: [{ text: cleanQuery }] }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction: [
            'You are PW Pi Proxy inside Study Cloud, an expert JEE/NEET/Board STEM reasoning engine.',
            `Subject Focus: ${subject}${batchName ? ` · Batch Context: ${batchName}` : ''}.`,
            modeInstructions[mode] || modeInstructions.solve,
            'Keep formatting clean with headings (###), bullet points, bold formulas, and clear Hinglish/English technical clarity.',
          ].join('\n\n'),
        },
      });

      const answer = (response.text || '').trim();
      if (!answer) {
        return res.status(502).json({ success: false, message: 'PW Pi returned an empty answer.' });
      }
      return res.json({ success: true, answer });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err?.message || 'PW Pi proxy request failed.',
      });
    }
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
    console.log(`Study Cloud Server listening on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

