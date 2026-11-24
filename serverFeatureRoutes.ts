import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { GoogleGenAI, Type } from '@google/genai';
import {
  callStudyParchamPi,
  callStudyParchamPw,
  getStudyParchamBatchDetails,
  resolveStudyParchamSubjectId,
  applyCachedStudyParchamSig,
  refreshStudyParchamSigForUrl,
} from './serverStudyParcham.ts';

export interface FeatureRouteDeps {
  getGeminiClient: () => GoogleGenAI;
  getCachedBatches: () => Promise<{ batches: any[]; vidyapeeth: any[] }>;
  getUserToken: (req: express.Request) => string;
  getBearerToken: (forceRefresh?: boolean) => Promise<string>;
  fetchPublicPenPencilRaw: (apiPath: string) => Promise<{ ok: boolean; status: number; data: any; errorText: string }>;
  fetchVidcloudApiRaw: (
    apiPath: string,
    userToken?: string
  ) => Promise<{ ok: boolean; status: number; data: any; errorText: string; needsPwLogin?: boolean }>;
  fetchPenPencilWithToken: (
    base: string,
    apiPath: string,
    token: string
  ) => Promise<{ ok: boolean; status: number; data: any; errorText: string }>;
  normalizeAttachment: (att: any) => any;
  normalizeNoteItems: (items: any[]) => any[];
  PENPENCIL_API_BASE: string;
  USER_AGENT: string;
}

const CURATED_KHAZANA_PROGRAMS = [
  {
    programId: '65d862392b1da90018ad8f3b',
    batchId: '65d862392b1da90018ad8f3b',
    title: 'Lakshya JEE Khazana Vault',
    subtitle: 'Class 12 Full JEE Main & Advanced Recorded Archive',
    exam: 'IIT-JEE',
    classLevel: '12',
    batchName: 'Lakshya JEE',
    photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/1da7fd49-8e2c-44da-a186-5134e41d4d01.png',
  },
  {
    programId: '676e4dee1ec923bc192f38c9',
    batchId: '676e4dee1ec923bc192f38c9',
    title: 'Arjuna JEE Khazana Vault',
    subtitle: 'Class 11 JEE Core Physics, Chemistry & Mathematics',
    exam: 'IIT-JEE',
    classLevel: '11',
    batchName: 'Arjuna JEE',
    photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/63f4c892-62e2-406d-a07a-1b42a1b43b6b.png',
  },
  {
    programId: '65d75d320531c20018ade9bb',
    batchId: '65d75d320531c20018ade9bb',
    title: 'Lakshya NEET Khazana Vault',
    subtitle: 'Class 12 NEET Medical Physics, Chemistry, Botany & Zoology',
    exam: 'NEET',
    classLevel: '12',
    batchName: 'Lakshya NEET',
    photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/7b002496-c7a1-425f-b40a-bf7b944f7990.png',
  },
  {
    programId: '676e5677418e84037bd6247c',
    batchId: '676e5677418e84037bd6247c',
    title: 'Arjuna NEET Khazana Vault',
    subtitle: 'Class 11 NEET Foundation & NCERT Mastery',
    exam: 'NEET',
    classLevel: '11',
    batchName: 'Arjuna NEET',
    photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/4a6e3933-fc40-4c69-888b-bc5df0d8cd2a.png',
  },
  {
    programId: '65dc6fbabb55350018d555b7',
    batchId: '65dc6fbabb55350018d555b7',
    title: 'Lakshya JEE 2.0 Archive',
    subtitle: 'Fast-Track JEE Class 12 Recorded Faculty Series',
    exam: 'IIT-JEE',
    classLevel: '12',
    batchName: 'Lakshya JEE 2.0',
    photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/1da7fd49-8e2c-44da-a186-5134e41d4d01.png',
  },
  {
    programId: '65d86274903497001869fc0c',
    batchId: '65d86274903497001869fc0c',
    title: 'Yakeen NEET Dropper Vault',
    subtitle: 'Complete Dropper NEET Physics, Chemistry & Biology',
    exam: 'NEET',
    classLevel: 'Dropper',
    batchName: 'Yakeen NEET',
    photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/7b002496-c7a1-425f-b40a-bf7b944f7990.png',
  },
  {
    programId: '65d86258365e8300187255f5',
    batchId: '65d86258365e8300187255f5',
    title: 'Prayas JEE Dropper Vault',
    subtitle: 'Complete JEE Main & Advanced Dropper Archive',
    exam: 'IIT-JEE',
    classLevel: 'Dropper',
    batchName: 'Prayas JEE',
    photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/63f4c892-62e2-406d-a07a-1b42a1b43b6b.png',
  },
  {
    programId: '65de115e0a24b4001870c17f',
    batchId: '65de115e0a24b4001870c17f',
    title: 'Udaan Class 10 Boards Vault',
    subtitle: 'Class 10 Maths, Science, SST & English Board Prep',
    exam: 'Boards',
    classLevel: '10',
    batchName: 'Udaan Class 10',
    photo: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/f32e58bb-4b4e-4b02-9a3c-4f25f3ed0b27.png',
  },
];

const PI_CATEGORIES = [
  {
    id: 'iit-jee',
    name: 'IIT JEE',
    tagline: 'Physics, Chemistry & Mathematics Concept Series',
    icon: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/1da7fd49-8e2c-44da-a186-5134e41d4d01.png',
    programId: '65d862392b1da90018ad8f3b',
    subcategories: [
      { id: 'all', name: 'All Concepts', keyword: '' },
      { id: 'physics', name: 'Physics', keyword: 'physics' },
      { id: 'chemistry', name: 'Chemistry', keyword: 'chem' },
      { id: 'maths', name: 'Mathematics', keyword: 'math' },
    ],
  },
  {
    id: 'neet',
    name: 'NEET UG',
    tagline: 'NCERT Line-by-Line Biology, Chemistry & Medical Physics',
    icon: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/7b002496-c7a1-425f-b40a-bf7b944f7990.png',
    programId: '65d75d320531c20018ade9bb',
    subcategories: [
      { id: 'all', name: 'All Medical', keyword: '' },
      { id: 'botany', name: 'Botany', keyword: 'botany' },
      { id: 'zoology', name: 'Zoology', keyword: 'zoology' },
      { id: 'physics', name: 'Physics', keyword: 'physics' },
      { id: 'chemistry', name: 'Chemistry', keyword: 'chem' },
    ],
  },
  {
    id: 'class-12',
    name: 'Class 12',
    tagline: 'Boards + CUET + Competitive Concept Episodes',
    icon: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/63f4c892-62e2-406d-a07a-1b42a1b43b6b.png',
    programId: '65d862392b1da90018ad8f3b',
    subcategories: [
      { id: 'all', name: 'All Subjects', keyword: '' },
      { id: 'physics', name: 'Physics', keyword: 'physics' },
      { id: 'chemistry', name: 'Chemistry', keyword: 'chem' },
      { id: 'maths', name: 'Maths', keyword: 'math' },
    ],
  },
  {
    id: 'class-11',
    name: 'Class 11',
    tagline: 'Strong Foundation Mechanics, GOC & Algebra',
    icon: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/4a6e3933-fc40-4c69-888b-bc5df0d8cd2a.png',
    programId: '676e4dee1ec923bc192f38c9',
    subcategories: [
      { id: 'all', name: 'All Subjects', keyword: '' },
      { id: 'physics', name: 'Physics', keyword: 'physics' },
      { id: 'chemistry', name: 'Chemistry', keyword: 'chem' },
      { id: 'maths', name: 'Maths', keyword: 'math' },
    ],
  },
  {
    id: 'class-10',
    name: 'Class 10',
    tagline: 'Udaan CBSE & ICSE Board Concept Vault',
    icon: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/f32e58bb-4b4e-4b02-9a3c-4f25f3ed0b27.png',
    programId: '65de115e0a24b4001870c17f',
    subcategories: [
      { id: 'all', name: 'All Subjects', keyword: '' },
      { id: 'science', name: 'Science', keyword: 'science' },
      { id: 'maths', name: 'Maths', keyword: 'math' },
      { id: 'sst', name: 'SST', keyword: 'social' },
    ],
  },
];

function stripHtmlAndDecode(raw: string): string {
  if (!raw) return '';
  let str = raw;
  try {
    if (str.includes('%3C') || str.includes('%20')) {
      str = decodeURIComponent(str);
    }
  } catch {
    // ignore malformed URI sequence
  }
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatDurationLabel(sec: number): string {
  if (!sec || sec <= 0) return 'Recorded';
  const mins = Math.round(sec / 60);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  }
  return `${mins}m`;
}

// Download job store for /api/lecture-download/*
interface ServerDownloadJob {
  id: string;
  fileName: string;
  filePath: string;
  status: 'preparing' | 'downloading' | 'ready' | 'error' | 'cancelled';
  percent: number;
  downloadedBytes: number;
  totalDurationSecs: number;
  processedSecs: number;
  error?: string;
  proc?: ChildProcess;
  createdAt: number;
}

const downloadJobs = new Map<string, ServerDownloadJob>();

// Periodic cleanup of expired /tmp download jobs (> 2 hours old)
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of downloadJobs.entries()) {
    if (job.createdAt < cutoff) {
      try {
        job.proc?.kill('SIGKILL');
      } catch {
        // ignore
      }
      try {
        if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
      } catch {
        // ignore
      }
      downloadJobs.delete(id);
    }
  }
}, 15 * 60 * 1000);

function unwrapLocalProxyUrl(raw: string, req: express.Request): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/api/hls-proxy')) {
    try {
      const parsed = new URL(trimmed, 'http://localhost');
      const target = parsed.searchParams.get('url') || '';
      const sig = parsed.searchParams.get('sig') || '';
      if (target) {
        const u = new URL(target);
        if (sig && !u.searchParams.has('Signature')) {
          new URLSearchParams(sig).forEach((v, k) => {
            if (!u.searchParams.has(k)) u.searchParams.set(k, v);
          });
        }
        return u.toString();
      }
    } catch {
      // fall through
    }
  }
  if (trimmed.startsWith('/')) {
    const proto = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    return `${proto}://${host}${trimmed}`;
  }
  return trimmed;
}

export function registerFeatureRoutes(app: express.Express, deps: FeatureRouteDeps): void {
  const {
    getGeminiClient,
    getCachedBatches,
    getUserToken,
    getBearerToken,
    fetchPublicPenPencilRaw,
    fetchVidcloudApiRaw,
    fetchPenPencilWithToken,
    normalizeAttachment,
    normalizeNoteItems,
    PENPENCIL_API_BASE,
    USER_AGENT,
  } = deps;

  async function generateMcqQuestionsViaGemini(opts: {
    subject: string;
    exam: string;
    topic: string;
    count: number;
  }) {
    const ai = getGeminiClient();
    const safeCount = Math.min(20, Math.max(3, Number(opts.count) || 5));
    const prompt = [
      `Create ${safeCount} authentic, exam-accurate multiple-choice questions for ${opts.exam || 'IIT-JEE / NEET'} in subject ${opts.subject || 'Science'}.`,
      `Topic / Syllabus focus: ${opts.topic || 'Core Concepts'}.`,
      'Each question must have exactly 4 distinct options, exactly 1 correctIndex (0..3), a concise conceptual explanation, and the sub-topic tag.',
      'Ensure accurate physics/chemistry/math/biology formulas and calculations.',
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
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

    const parsed = JSON.parse((response.text || '[]').trim());
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('AI returned an empty question set.');
    }
    return parsed.map((q: any) => ({
      question: String(q.question || '').trim(),
      options: Array.isArray(q.options) && q.options.length >= 2 ? q.options.map(String).slice(0, 4) : ['A', 'B', 'C', 'D'],
      correctIndex: Math.min(3, Math.max(0, Number(q.correctIndex) || 0)),
      explanation: String(q.explanation || 'Review core concepts for this step.'),
      topic: q.topic ? String(q.topic) : opts.topic,
    }));
  }

  // 1. AI Mock Test Generator
  app.post('/api/ai/generate-test', async (req, res) => {
    try {
      const { subject = 'Physics', exam = 'IIT-JEE', topic = 'General Concepts', count = 5 } = req.body || {};
      const questions = await generateMcqQuestionsViaGemini({ subject, exam, topic, count: Number(count) || 5 });
      return res.json({ success: true, questions });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err?.message || 'Could not generate practice test right now.',
      });
    }
  });

  // 2. PW Community Feed (Announcements + Forum/Teacher Channels from StudyParcham & PenPencil)
  app.get('/api/pw/community', async (req, res) => {
    try {
      const rawIds = String(req.query.batchIds || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const batchIds = Array.from(
        new Set(
          rawIds.length > 0
            ? rawIds.slice(0, 5)
            : ['65d862392b1da90018ad8f3b', '65d75d320531c20018ade9bb', '676e4dee1ec923bc192f38c9']
        )
      );

      const userToken = getUserToken(req);
      const channels: any[] = [];
      const posts: any[] = [];
      const seenPostIds = new Set<string>();

      await Promise.all(
        batchIds.map(async (bId) => {
          const [details, notifsRes, chnlRes] = await Promise.all([
            getStudyParchamBatchDetails(bId).then(async (d) => {
              if (d) return d;
              const pub = await fetchPublicPenPencilRaw(`/v3/batches/${encodeURIComponent(bId)}/details?type=EXPLORE_LEAD`);
              return pub.ok ? pub.data?.data : null;
            }),
            callStudyParchamPw('pw_notifs', { batchId: bId, page: 1, limit: 12 }).then(async (r) => {
              if (r.ok && Array.isArray(r.data)) return r.data;
              const raw = await fetchVidcloudApiRaw(`/v1/batches/${encodeURIComponent(bId)}/announcement?page=1`, userToken);
              return raw.ok && Array.isArray(raw.data?.data) ? raw.data.data : [];
            }),
            callStudyParchamPw('pw_com_chnl', { batchId: bId }),
          ]);

          const batchName = details?.name || `Batch ${bId.slice(-6)}`;
          channels.push({ batchId: bId, batchName });

          // Official batch announcements -> posts
          for (const ann of notifsRes || []) {
            const text = stripHtmlAndDecode(String(ann?.announcement || ann?.title || ann?.description || ''));
            if (!text) continue;
            const postId = ann?._id ? `${bId}:ann:${String(ann._id)}` : `ann-${bId}-${posts.length}`;
            if (seenPostIds.has(postId)) continue;
            seenPostIds.add(postId);
            const att = ann?.attachment ? normalizeAttachment(ann.attachment) : null;
            posts.push({
              id: postId,
              batchId: bId,
              batchName,
              type: String(ann?.type || 'Batch Notice'),
              announcement: text,
              createdAt: ann?.createdAt || ann?.date || '',
              attachmentUrl: att?.resolvedUrl || undefined,
              attachmentName: att?.name || (att?.resolvedUrl ? 'Notice Attachment.pdf' : undefined),
            });
          }

          // Teacher feed / community channel posts
          const chList: any[] = chnlRes.ok && Array.isArray(chnlRes.data) ? chnlRes.data : [];
          const feedCh = chList.find((c) => c?.type === 'feed') || chList[0];
          if (feedCh?._id) {
            const pRes = await callStudyParchamPw('pw_com_posts', { channelId: feedCh._id, page: 1 });
            const feedPosts: any[] = Array.isArray(pRes.data?.posts) ? pRes.data.posts : [];
            for (const fp of feedPosts.slice(0, 8)) {
              const cleanText = stripHtmlAndDecode(String(fp?.description || fp?.text || fp?.title || ''));
              if (!cleanText) continue;
              const postId = fp?._id ? `${bId}:fp:${String(fp._id)}` : `fp-${bId}-${posts.length}`;
              if (seenPostIds.has(postId)) continue;
              seenPostIds.add(postId);
              const att = fp?.attachment ? normalizeAttachment(fp.attachment) : null;
              posts.push({
                id: postId,
                batchId: bId,
                batchName,
                type: feedCh?.name?.trim() || 'Community Feed',
                announcement: cleanText,
                createdAt: fp?.createdAt || '',
                attachmentUrl: att?.resolvedUrl || undefined,
                attachmentName: att?.name || undefined,
              });
            }
          }
        })
      );

      posts.sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));
      return res.json({ success: true, channels, posts });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load community feed' });
    }
  });

  // 3. PW Batch Tests & DPP/DHA Quizzes (via StudyParcham + PenPencil)
  app.get('/api/pw/quizzes', async (req, res) => {
    const batchId = String(req.query.batchId || '').trim();
    const requestedSubjectSlug = String(req.query.subjectSlug || '').trim();
    const requestedTopicId = String(req.query.topicId || '').trim();
    if (!batchId) {
      return res.status(400).json({ success: false, message: 'batchId is required' });
    }

    try {
      const [details, testsRes] = await Promise.all([
        getStudyParchamBatchDetails(batchId).then(async (d) => {
          if (d) return d;
          const pub = await fetchPublicPenPencilRaw(`/v3/batches/${encodeURIComponent(batchId)}/details?type=EXPLORE_LEAD`);
          return pub.ok ? pub.data?.data : null;
        }),
        callStudyParchamPw('pw_test_lst', { batchId, limit: 100 }),
      ]);

      const rawSubjects: any[] = Array.isArray(details?.subjects) ? details.subjects : [];
      const seenSubjects = new Set<string>();
      const subjects = rawSubjects
        .filter((s) => {
          if (!s?._id || /notice|guidance|orientation|planner/i.test(String(s.subject || ''))) return false;
          const sid = String(s._id);
          if (seenSubjects.has(sid)) return false;
          seenSubjects.add(sid);
          return true;
        })
        .map((s) => ({
          _id: String(s._id),
          subject: String(s.subject || s.name || 'Subject'),
          slug: String(s.slug || s._id),
        }));

      const activeSubject =
        subjects.find((s) => s.slug === requestedSubjectSlug || s._id === requestedSubjectSlug) ||
        subjects[0] ||
        null;

      // Official Batch Tests from pw_test_lst
      const rawTests: any[] = testsRes.ok && Array.isArray(testsRes.data) ? testsRes.data : [];
      const seenTestIds = new Set<string>();
      const officialTests = rawTests
        .filter((t: any) => {
          if (!t?._id) return false;
          const tid = String(t._id);
          if (seenTestIds.has(tid)) return false;
          seenTestIds.add(tid);
          return true;
        })
        .map((t: any) => {
          const pdfAtt = t?.questionFileId ? normalizeAttachment(t.questionFileId) : null;
          return {
            id: String(t._id),
            exerciseId: String(t.exerciseId || t._id),
            title: String(t.name || t.title || 'Batch Test'),
            category: String(t.currentType || t.type || 'Official Test'),
            batchId,
            batchName: details?.name || 'PW Batch',
            subjectName: t?.subjectId?.name || 'Full Syllabus',
            syllabus: stripHtmlAndDecode(String(t.description || t.syllabus || '')).slice(0, 220),
            totalQuestions: Number(t.totalQuestions || 30),
            totalMarks: Number(t.totalMarks || 120),
            maxDuration: Number(t.maxDuration || 60),
            startTime: t.startTime || '',
            status: String(t.tag1 || t.testActivityStatus || 'Available'),
            pdfUrl: pdfAtt?.resolvedUrl || undefined,
            pdfName: pdfAtt?.name || undefined,
            isOfficial: true,
          };
        });

      let topics: Array<{ _id: string; name: string; exercises: number }> = [];
      const quizzes: any[] = [];
      const seenQuizIds = new Set<string>();

      if (activeSubject) {
        const topicsRes = await callStudyParchamPw('pw_sub_topics', {
          batchId,
          subjectId: activeSubject._id,
          page: 1,
          tagType: 'UNITS',
          limit: 50,
        });
        const rawTopics: any[] = topicsRes.ok && Array.isArray(topicsRes.data) ? topicsRes.data : [];
        const seenTopics = new Set<string>();
        topics = rawTopics
          .filter((t) => {
            if (!t?._id) return false;
            const tid = String(t._id);
            if (seenTopics.has(tid)) return false;
            seenTopics.add(tid);
            return true;
          })
          .map((t) => ({
            _id: String(t._id),
            name: String(t.name || 'Chapter'),
            exercises: Number(t.exercises || 0),
          }));

        const targetTopics = requestedTopicId
          ? topics.filter((t) => t._id === requestedTopicId)
          : topics.filter((t) => t.exercises > 0).slice(0, 4);

        await Promise.all(
          targetTopics.map(async (topic) => {
            const dppRes = await callStudyParchamPw('pw_dpp_lst', {
              page: 1,
              batchId,
              subjectId: activeSubject._id,
              chapterId: topic._id,
              limit: 20,
            });
            const dppList: any[] = dppRes.ok && Array.isArray(dppRes.data) ? dppRes.data : [];
            for (const item of dppList) {
              const testObj = item?.dppQuizDetails?.test || item?.exerciseDetails || item;
              const qId = String(testObj?._id || item?._id || '');
              if (!qId || qId === '0') continue;
              const compositeId = `${topic._id}-${qId}`;
              if (seenQuizIds.has(compositeId)) continue;
              seenQuizIds.add(compositeId);
              quizzes.push({
                id: compositeId,
                exerciseId: qId,
                title: String(testObj?.name || testObj?.title || item?.topic || `${topic.name} DPP Quiz`),
                batchId,
                batchName: details?.name || 'PW Batch',
                subjectName: activeSubject.subject,
                topicId: topic._id,
                topicName: topic.name,
                totalQuestions: Number(testObj?.totalQuestions || 10),
                totalMarks: Number(testObj?.totalMarks || 40),
                isDha: Boolean(item?.type === 'DPP_QUIZ' || /dha|dpp/i.test(String(testObj?.name || ''))),
              });
            }
          })
        );
      }

      return res.json({
        success: true,
        subjects,
        activeSubjectSlug: activeSubject?.slug || '',
        topics,
        quizzes,
        officialTests,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load batch quizzes' });
    }
  });

  app.post('/api/pw/quiz-start', async (req, res) => {
    try {
      const {
        exerciseId,
        batchName = 'PW Batch',
        subjectName = 'Physics',
        topicName = 'Practice Questions',
        title = 'Chapter Test',
        count = 8,
      } = req.body || {};

      const userToken = getUserToken(req);

      // 1. Try real PenPencil exercise questions if userToken is available & exerciseId exists
      if (exerciseId && userToken) {
        const exRes = await fetchPenPencilWithToken(
          PENPENCIL_API_BASE,
          `/v1/exercises/${encodeURIComponent(String(exerciseId))}/start`,
          userToken
        );
        const rawQs: any[] = Array.isArray(exRes.data?.data?.questions)
          ? exRes.data.data.questions
          : Array.isArray(exRes.data?.questions)
          ? exRes.data.questions
          : [];
        if (exRes.ok && rawQs.length > 0) {
          const normalized = rawQs.slice(0, 25).map((q: any) => {
            const qText = stripHtmlAndDecode(String(q?.texts?.en || q?.question || q?.title || 'Question'));
            const opts: string[] = Array.isArray(q?.options)
              ? q.options.map((o: any) => stripHtmlAndDecode(String(o?.texts?.en || o?.text || o || ''))).slice(0, 4)
              : ['Option A', 'Option B', 'Option C', 'Option D'];
            const solIds = new Set(Array.isArray(q?.solutions) ? q.solutions.map(String) : []);
            let correctIdx = Array.isArray(q?.options)
              ? q.options.findIndex((o: any) => o?.isCorrect || solIds.has(String(o?._id)))
              : 0;
            if (correctIdx < 0) correctIdx = 0;
            return {
              question: qText,
              options: opts.length >= 2 ? opts : ['Option A', 'Option B', 'Option C', 'Option D'],
              correctIndex: correctIdx,
              explanation: stripHtmlAndDecode(String(q?.solutionDescription?.en || q?.explanation || 'Official PW exercise question.')),
              topic: topicName,
            };
          });
          return res.json({ success: true, source: 'penpencil', questions: normalized });
        }
      }

      // 2. Generate exam-aligned CBT questions for this exact syllabus/topic using Gemini
      const questions = await generateMcqQuestionsViaGemini({
        subject: subjectName,
        exam: batchName,
        topic: `${title} — ${topicName}`,
        count: Math.min(12, Math.max(5, Number(count) || 8)),
      });
      return res.json({ success: true, source: 'ai-aligned', questions });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err?.message || 'Unable to start test right now.',
      });
    }
  });

  // 4. Khazana Explorer Routes (PenPencil /v1/programs/* + StudyParcham batch fallback)
  async function getKhazanaFallbackDetails(programId: string) {
    const match = CURATED_KHAZANA_PROGRAMS.find((p) => p.programId === programId || p.batchId === programId);
    const batchId = match?.batchId || programId;
    const details = await getStudyParchamBatchDetails(batchId);
    return { match, batchId, details };
  }

  app.get('/api/khazana/programs', (_req, res) => {
    return res.json({ success: true, programs: CURATED_KHAZANA_PROGRAMS });
  });

  app.get('/api/khazana/overview', async (req, res) => {
    const programId = String(req.query.programId || '').trim();
    if (!programId) return res.status(400).json({ success: false, message: 'programId is required' });
    const userToken = getUserToken(req);

    try {
      // Try PenPencil Khazana endpoints first if user token or shared token works
      if (userToken) {
        const [subjRes, teachRes] = await Promise.all([
          fetchPenPencilWithToken(PENPENCIL_API_BASE, `/v1/programs/${encodeURIComponent(programId)}/subjects`, userToken),
          fetchPenPencilWithToken(PENPENCIL_API_BASE, `/v1/programs/${encodeURIComponent(programId)}/teachers?page=1&limit=24`, userToken),
        ]);
        if (subjRes.ok && Array.isArray(subjRes.data?.data) && subjRes.data.data.length > 0) {
          const subjects = subjRes.data.data;
          const teachers = teachRes.ok && Array.isArray(teachRes.data?.data) ? teachRes.data.data : [];
          return res.json({
            success: true,
            name: CURATED_KHAZANA_PROGRAMS.find((p) => p.programId === programId)?.title || 'Khazana Vault',
            subjects,
            subjectPreviews: {},
            teachers,
            paginate: teachRes.data?.paginate || null,
          });
        }
      }

      // StudyParcham batch-backed Khazana Vault fallback (always 200 OK without login)
      const { match, batchId, details } = await getKhazanaFallbackDetails(programId);
      if (!details) {
        return res.status(404).json({ success: false, message: 'Khazana program details not found.' });
      }

      const rawSubjects: any[] = Array.isArray(details.subjects) ? details.subjects : [];
      const subjects = rawSubjects
        .filter((s) => s?._id && !/notice|guidance|orientation/i.test(String(s.subject || '')))
        .map((s, i) => ({
          _id: String(s._id),
          name: String(s.subject || s.name || 'Subject'),
          value: String(s.slug || s._id),
          displayOrder: i + 1,
        }));

      const teacherMap = new Map<string, any>();
      const subjectPreviews: Record<string, any[]> = {};

      for (const s of rawSubjects) {
        if (!s?._id) continue;
        const tList: any[] = Array.isArray(s.teacherIds) ? s.teacherIds : [];
        const chaptersForSubj: any[] = [];
        for (const t of tList) {
          const fullName = [t.firstName, t.lastName].filter(Boolean).join(' ').trim() || 'PW Faculty';
          if (t._id && !teacherMap.has(String(t._id))) {
            teacherMap.set(String(t._id), {
              _id: String(t._id),
              name: fullName,
              firstName: t.firstName,
              lastName: t.lastName,
              subject: s.subject || 'Subject',
              experience: t.experience || 'Senior PW Faculty',
              featuredLine: `${s.subject} · ${details.name}`,
              imageId: t.imageId,
            });
          }
          chaptersForSubj.push({
            _id: `${batchId}:${s._id}:${t._id || 'faculty'}`,
            name: `${s.subject} by ${fullName}`,
            description: `Complete recorded ${s.subject} chapters from ${details.name}`,
            subjectId: { _id: String(s._id), name: String(s.subject) },
            programId,
            teacherName: fullName,
            teacher: { ...t, name: fullName },
            imageId: t.imageId || s.imageId || null,
          });
        }
        if (chaptersForSubj.length === 0) {
          chaptersForSubj.push({
            _id: `${batchId}:${s._id}:all`,
            name: `${s.subject} Full Course`,
            description: `All chapters and lectures for ${s.subject}`,
            subjectId: { _id: String(s._id), name: String(s.subject) },
            programId,
            imageId: s.imageId || null,
          });
        }
        subjectPreviews[String(s._id)] = chaptersForSubj;
      }

      return res.json({
        success: true,
        name: match?.title || details.name || 'Khazana Vault',
        subjects,
        subjectPreviews,
        teachers: Array.from(teacherMap.values()),
        paginate: { totalCount: teacherMap.size },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load Khazana overview' });
    }
  });

  app.get('/api/khazana/teachers', async (req, res) => {
    const programId = String(req.query.programId || '').trim();
    const { details } = await getKhazanaFallbackDetails(programId);
    const teacherMap = new Map<string, any>();
    for (const s of details?.subjects || []) {
      for (const t of s?.teacherIds || []) {
        if (!t?._id || teacherMap.has(String(t._id))) continue;
        const fullName = [t.firstName, t.lastName].filter(Boolean).join(' ').trim() || 'PW Faculty';
        teacherMap.set(String(t._id), {
          _id: String(t._id),
          name: fullName,
          firstName: t.firstName,
          lastName: t.lastName,
          subject: s.subject,
          experience: t.experience || 'Senior Faculty',
          imageId: t.imageId,
        });
      }
    }
    const teachers = Array.from(teacherMap.values());
    return res.json({ success: true, teachers, paginate: { totalCount: teachers.length } });
  });

  app.get('/api/khazana/subject-chapters', async (req, res) => {
    const programId = String(req.query.programId || '').trim();
    const subjectId = String(req.query.subjectId || '').trim();
    const { batchId, details } = await getKhazanaFallbackDetails(programId);
    const subj = (details?.subjects || []).find((s: any) => String(s._id) === subjectId || s.slug === subjectId);
    if (!subj) return res.json({ success: true, chapters: [], paginate: { totalCount: 0 } });

    const tList: any[] = Array.isArray(subj.teacherIds) ? subj.teacherIds : [];
    const chapters =
      tList.length > 0
        ? tList.map((t: any) => {
            const fullName = [t.firstName, t.lastName].filter(Boolean).join(' ').trim() || 'PW Faculty';
            return {
              _id: `${batchId}:${subj._id}:${t._id}`,
              name: `${subj.subject} by ${fullName}`,
              description: `Complete recorded lectures & notes for ${subj.subject}`,
              subjectId: { _id: String(subj._id), name: String(subj.subject) },
              programId,
              teacherName: fullName,
              teacher: { ...t, name: fullName },
              imageId: t.imageId || subj.imageId || null,
            };
          })
        : [
            {
              _id: `${batchId}:${subj._id}:all`,
              name: `${subj.subject} Complete Archive`,
              description: `All chapters & study material for ${subj.subject}`,
              subjectId: { _id: String(subj._id), name: String(subj.subject) },
              programId,
              imageId: subj.imageId || null,
            },
          ];

    return res.json({ success: true, chapters, paginate: { totalCount: chapters.length } });
  });

  app.get('/api/khazana/teacher-chapters', async (req, res) => {
    const programId = String(req.query.programId || '').trim();
    const teacherId = String(req.query.teacherId || '').trim();
    const { batchId, details } = await getKhazanaFallbackDetails(programId);
    const chapters: any[] = [];
    for (const subj of details?.subjects || []) {
      const t = (subj.teacherIds || []).find((x: any) => String(x._id) === teacherId);
      if (!t) continue;
      const fullName = [t.firstName, t.lastName].filter(Boolean).join(' ').trim() || 'PW Faculty';
      chapters.push({
        _id: `${batchId}:${subj._id}:${t._id}`,
        name: `${subj.subject} (${details?.name || 'Archive'})`,
        description: `Taught by ${fullName}`,
        subjectId: { _id: String(subj._id), name: String(subj.subject) },
        programId,
        teacherName: fullName,
        teacher: { ...t, name: fullName },
        imageId: t.imageId || subj.imageId || null,
      });
    }
    return res.json({ success: true, chapters, paginate: { totalCount: chapters.length } });
  });

  app.get('/api/khazana/topics', async (req, res) => {
    const programId = String(req.query.programId || '').trim();
    const subjectId = String(req.query.subjectId || '').trim();
    const chapterId = String(req.query.chapterId || '').trim();
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 25);

    const { batchId } = await getKhazanaFallbackDetails(programId);
    const resolvedSubjId = await resolveStudyParchamSubjectId(batchId, subjectId);
    const tRes = await callStudyParchamPw('pw_sub_topics', {
      batchId,
      subjectId: resolvedSubjId,
      page,
      tagType: 'UNITS',
      limit,
    });
    const list: any[] = tRes.ok && Array.isArray(tRes.data) ? tRes.data : [];
    const seenTopicIds = new Set<string>();
    const topics = list
      .filter((t: any) => {
        if (!t?._id) return false;
        const id = String(t._id);
        if (seenTopicIds.has(id)) return false;
        seenTopicIds.add(id);
        return true;
      })
      .map((t: any, idx: number) => ({
        _id: String(t._id),
        name: String(t.name || 'Chapter'),
        slug: t.slug,
        chapter: `CH - ${String((page - 1) * limit + idx + 1).padStart(2, '0')}`,
        displayOrder: idx + 1,
        programId,
        subjectId: resolvedSubjId,
        chapterId,
      }));
    return res.json({ success: true, topics, paginate: tRes.raw?.paginate || { totalCount: topics.length } });
  });

  app.get('/api/khazana/sub-topics', async (req, res) => {
    const programId = String(req.query.programId || '').trim();
    const subjectId = String(req.query.subjectId || '').trim();
    const chapterId = String(req.query.chapterId || '').trim();
    const topicId = String(req.query.topicId || '').trim();
    return res.json({
      success: true,
      subTopics: [
        { _id: 'videos', name: 'Lectures', displayOrder: 1, programId, subjectId, chapterId, topicId },
        { _id: 'notes', name: 'Class Notes PDF', displayOrder: 2, programId, subjectId, chapterId, topicId },
        { _id: 'DppNotes', name: 'DPP PDF', displayOrder: 3, programId, subjectId, chapterId, topicId },
        { _id: 'DppVideos', name: 'DPP Solutions', displayOrder: 4, programId, subjectId, chapterId, topicId },
      ],
    });
  });

  app.get('/api/khazana/contents', async (req, res) => {
    const programId = String(req.query.programId || '').trim();
    const subjectId = String(req.query.subjectId || '').trim();
    const chapterId = String(req.query.chapterId || '').trim();
    const topicId = String(req.query.topicId || '').trim();
    const subTopicId = String(req.query.subTopicId || 'videos').trim();
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);

    const { batchId } = await getKhazanaFallbackDetails(programId);
    const resolvedSubjId = await resolveStudyParchamSubjectId(batchId, subjectId);
    const contentType = ['videos', 'notes', 'DppNotes', 'DppVideos'].includes(subTopicId) ? subTopicId : 'videos';

    const cRes = await callStudyParchamPw('pw_v2_list', {
      batchId,
      subjectId: resolvedSubjId,
      tagId: topicId,
      contentType,
      page,
      limit,
    });
    const rawItems: any[] = cRes.ok && Array.isArray(cRes.data) ? cRes.data : [];
    const isNotes = contentType === 'notes' || contentType === 'DppNotes';

    const items: any[] = [];
    const seenItemIds = new Set<string>();
    if (isNotes) {
      const normalized = normalizeNoteItems(rawItems);
      for (const note of normalized) {
        const hws: any[] = Array.isArray(note.homeworkIds) ? note.homeworkIds : [];
        for (const hw of hws) {
          for (const att of hw.attachmentIds || []) {
            const uniqueId = `${String(note._id || 'note')}-${String(hw._id || 'hw')}-${String(att._id || items.length)}`;
            if (seenItemIds.has(uniqueId)) continue;
            seenItemIds.add(uniqueId);
            items.push({
              type: 'NOTES',
              data: {
                _id: uniqueId,
                title: hw.topic || note.topic || att.name || 'Notes PDF',
                name: att.name || hw.topic || 'Notes PDF',
                createdAt: note.date || note.startTime,
                programId,
                subjectId: resolvedSubjId,
                chapterId,
                topicId,
                subTopicId,
                fileId: att,
              },
            });
          }
        }
      }
    } else {
      for (const vid of rawItems) {
        const vidId = String(vid._id || `vid-${items.length}`);
        if (seenItemIds.has(vidId)) continue;
        seenItemIds.add(vidId);
        items.push({
          type: 'LECTURE',
          data: {
            _id: vidId,
            title: vid.topic || vid.videoDetails?.name || 'Lecture',
            name: vid.topic || vid.videoDetails?.name || 'Lecture',
            videoType: vid.urlType || 'penpencilvdo',
            videoUrl: vid.url || vid.videoDetails?.videoUrl || vid.videoDetails?.embedCode || '',
            createdAt: vid.startTime || vid.date,
            programId,
            subjectId: resolvedSubjId,
            chapterId,
            topicId,
            subTopicId,
            videoDetails: vid.videoDetails || {
              _id: vid._id,
              id: vid._id,
              name: vid.topic,
              videoUrl: vid.url || '',
            },
          },
        });
      }
    }

    return res.json({ success: true, items, paginate: cRes.raw?.paginate || { totalCount: items.length } });
  });

  // 5. PW Pi Pro OTT Routes (integrating pi.studyparcham.site + pw.studyparcham.in + batch catalog)
  app.get('/api/pi/categories', async (_req, res) => {
    // Attempt optional upstream sync from pi.studyparcham.site/api/data, enrich curated categories
    await callStudyParchamPi('pw_subcategories', {}).catch(() => null);
    return res.json({ success: true, categories: PI_CATEGORIES });
  });

  app.get('/api/pi/home', async (req, res) => {
    const goalId = String(req.query.goalId || 'iit-jee');
    const subId = String(req.query.subId || 'all').toLowerCase();
    const q = String(req.query.q || '').trim().toLowerCase();

    try {
      const cat = PI_CATEGORIES.find((c) => c.id === goalId || c.programId === goalId) || PI_CATEGORIES[0];
      const { batches } = await getCachedBatches();
      const details = await getStudyParchamBatchDetails(cat.programId).catch(() => null);

      const examRe =
        cat.id === 'iit-jee'
          ? /jee/i
          : cat.id === 'neet'
          ? /neet|yakeen|arjuna neet|lakshya neet/i
          : cat.id === 'class-12'
          ? /12|lakshya/i
          : cat.id === 'class-11'
          ? /11|arjuna/i
          : /10|udaan/i;

      let matchingBatches = batches.filter((b: any) => examRe.test(`${b.name || ''} ${b.exam || ''} ${b.class || ''}`));
      if (q) {
        matchingBatches = matchingBatches.filter((b: any) =>
          `${b.name || ''} ${b.exam || ''} ${b.byName || ''}`.toLowerCase().includes(q)
        );
      }
      const seenBatchIds = new Set<string>();
      matchingBatches = matchingBatches.filter((b: any) => {
        const bid = String(b?.batch_id || '');
        if (!bid || seenBatchIds.has(bid)) return false;
        seenBatchIds.add(bid);
        return true;
      });

      const teachers: any[] = [];
      const teacherSeen = new Set<string>();
      const conceptPlaylists: any[] = [];
      const playlistSeen = new Set<string>();

      for (const s of details?.subjects || []) {
        const sName = String(s.subject || 'Subject');
        if (subId !== 'all' && !sName.toLowerCase().includes(subId)) continue;
        if (q && !sName.toLowerCase().includes(q) && !String(details?.name || '').toLowerCase().includes(q)) continue;

        const firstTeacher = (s.teacherIds || [])[0];
        const tName = firstTeacher
          ? [firstTeacher.firstName, firstTeacher.lastName].filter(Boolean).join(' ').trim()
          : 'PW Faculty';
        const poster =
          (s.imageId?.baseUrl && s.imageId?.key ? `${s.imageId.baseUrl}${s.imageId.key}` : '') || cat.icon;

        const plId = `${cat.programId}:${s._id}`;
        if (!playlistSeen.has(plId)) {
          playlistSeen.add(plId);
          conceptPlaylists.push({
            id: plId,
            type: 'batch' as const,
            programId: cat.programId,
            subjectId: String(s._id),
            batchId: cat.programId,
            subjectName: sName,
            title: `${sName} — ${details?.name || cat.name}`,
            subtitle: `Complete Chapterwise Concept Series (${s.lectureCount || s.tagCount || 'HD'} Videos)`,
            teacherName: tName,
            teacherId: firstTeacher?._id ? String(firstTeacher._id) : undefined,
            poster,
            backdrop: poster,
            tag: 'CONCEPT SERIES',
            year: '2025',
          });
        }

        for (const t of s.teacherIds || []) {
          if (!t?._id || teacherSeen.has(String(t._id))) continue;
          teacherSeen.add(String(t._id));
          const fullName = [t.firstName, t.lastName].filter(Boolean).join(' ').trim() || 'PW Faculty';
          const img = t.imageId?.baseUrl && t.imageId?.key ? `${t.imageId.baseUrl}${t.imageId.key}` : cat.icon;
          teachers.push({
            id: String(t._id),
            name: fullName,
            subject: sName,
            experience: t.experience || 'Star Faculty',
            featuredLine: `${sName} · ${details?.name || cat.name}`,
            image: img,
            programId: cat.programId,
          });
        }
      }

      const toSeries = (b: any, tag: string) => ({
        id: String(b.batch_id),
        type: 'batch' as const,
        programId: String(b.batch_id),
        batchId: String(b.batch_id),
        subjectName: b.exam || cat.name,
        title: String(b.name || 'Batch Series'),
        subtitle: String(b.byName || cat.tagline),
        teacherName: b.language || 'Hinglish',
        poster: b.photo || cat.icon,
        backdrop: b.photo || cat.icon,
        tag,
        year: b.start_date ? String(b.start_date).slice(0, 4) : '2025',
      });

      const top10Series = matchingBatches.slice(0, 10).map((b: any, i: number) => toSeries(b, `#${i + 1} TRENDING`));
      const latestSeries = matchingBatches.slice(0, 12).map((b: any) => toSeries(b, 'LATEST'));
      const heroSlides = (conceptPlaylists.length > 0 ? conceptPlaylists : top10Series).slice(0, 5);

      const quizCards = (cat.subcategories || [])
        .filter((sc) => sc.id !== 'all')
        .map((sc, i) => ({
          id: `pi-q-${cat.id}-${sc.id}`,
          title: `${cat.name} ${sc.name} High-Yield Sprint`,
          subject: sc.name,
          questionsCount: 8,
          durationMinutes: 12,
          badge: i === 0 ? 'HOT' : 'CBT',
          batchId: cat.programId,
        }));

      return res.json({
        success: true,
        category: cat,
        subcategories: cat.subcategories,
        activeSubId: subId,
        heroSlides,
        top10Series,
        teachers: teachers.slice(0, 14),
        latestSeries,
        conceptPlaylists,
        quizCards,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load Pi OTT home' });
    }
  });

  app.get('/api/pi/series', async (req, res) => {
    const rawSeriesId = String(req.query.seriesId || '').trim();
    const programId = String(req.query.programId || rawSeriesId.split(':')[0] || '').trim();
    const requestedSubjectId = String(req.query.subjectId || rawSeriesId.split(':')[1] || '').trim();
    const requestedTopicId = String(req.query.topicId || '').trim();

    if (!programId) return res.status(400).json({ success: false, message: 'seriesId is required' });

    try {
      const details = await getStudyParchamBatchDetails(programId);
      const rawSubjects: any[] = Array.isArray(details?.subjects) ? details.subjects : [];
      const seenPiSubjects = new Set<string>();
      const subjects = rawSubjects
        .filter((s) => {
          if (!s?._id || /notice|guidance|orientation/i.test(String(s.subject || ''))) return false;
          const sid = String(s._id);
          if (seenPiSubjects.has(sid)) return false;
          seenPiSubjects.add(sid);
          return true;
        })
        .map((s) => ({ id: String(s._id), name: String(s.subject || 'Subject') }));

      const activeSubj =
        subjects.find((s) => s.id === requestedSubjectId) || subjects[0] || null;

      let topics: Array<{ id: string; name: string; videos?: number }> = [];
      let activeTopicId = requestedTopicId;
      const episodes: any[] = [];
      let notes: any[] = [];

      if (activeSubj) {
        const tRes = await callStudyParchamPw('pw_sub_topics', {
          batchId: programId,
          subjectId: activeSubj.id,
          page: 1,
          tagType: 'UNITS',
          limit: 40,
        });
        const tList: any[] = tRes.ok && Array.isArray(tRes.data) ? tRes.data : [];
        const seenPiTopics = new Set<string>();
        topics = tList
          .filter((t) => {
            if (!t?._id) return false;
            const tid = String(t._id);
            if (seenPiTopics.has(tid)) return false;
            seenPiTopics.add(tid);
            return true;
          })
          .map((t) => ({
            id: String(t._id),
            name: String(t.name || 'Chapter'),
            videos: Number(t.videos || 0),
          }));

        const chosenTopic =
          topics.find((t) => t.id === requestedTopicId) ||
          topics.find((t) => (t.videos || 0) > 0) ||
          topics[0];
        activeTopicId = chosenTopic?.id || '';

        if (activeTopicId) {
          const [vRes, nRes] = await Promise.all([
            callStudyParchamPw('pw_v2_list', {
              batchId: programId,
              subjectId: activeSubj.id,
              tagId: activeTopicId,
              contentType: 'videos',
              page: 1,
              limit: 30,
            }),
            callStudyParchamPw('pw_v2_list', {
              batchId: programId,
              subjectId: activeSubj.id,
              tagId: activeTopicId,
              contentType: 'notes',
              page: 1,
              limit: 20,
            }),
          ]);

          const seenEpisodes = new Set<string>();
          for (const vid of vRes.ok && Array.isArray(vRes.data) ? vRes.data : []) {
            const epId = String(vid._id || `ep-${episodes.length}`);
            if (seenEpisodes.has(epId)) continue;
            seenEpisodes.add(epId);
            episodes.push({
              id: epId,
              title: vid.topic || vid.videoDetails?.name || 'Concept Episode',
              duration: vid.videoDetails?.duration || '',
              thumb: vid.videoDetails?.image || '',
              programId,
              batchId: programId,
              subjectId: activeSubj.id,
              topicId: activeTopicId,
              topicName: chosenTopic?.name || activeSubj.name,
              findKey: vid.videoDetails?.findKey,
              videoDetailsId: vid.videoDetails?._id || vid.videoDetails?.id,
              videoType: vid.urlType || 'new',
              rawVideoUrl: vid.url || vid.videoDetails?.videoUrl || vid.videoDetails?.embedCode || '',
            });
          }

          notes = nRes.ok && Array.isArray(nRes.data) ? normalizeNoteItems(nRes.data) : [];
        }
      }

      return res.json({
        success: true,
        type: 'batch',
        seriesId: rawSeriesId,
        title: details?.name || 'PW Pi Series',
        programId,
        subjectId: activeSubj?.id,
        subjects,
        activeSubjectId: activeSubj?.id,
        topics,
        activeTopicId,
        episodes,
        notes,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load Pi series' });
    }
  });

  app.get('/api/pi/teacher', async (req, res) => {
    const teacherId = String(req.query.teacherId || '').trim();
    const programId = String(req.query.programId || '65d862392b1da90018ad8f3b').trim();

    try {
      const [details, tchRes] = await Promise.all([
        getStudyParchamBatchDetails(programId),
        teacherId ? callStudyParchamPw('pw_tch_prof', { teacherId }) : Promise.resolve(null),
      ]);

      const series: any[] = [];
      const seenSeriesIds = new Set<string>();
      let teacherMeta: any = null;

      for (const s of details?.subjects || []) {
        for (const t of s.teacherIds || []) {
          if (String(t._id) === teacherId || (!teacherMeta && !teacherId)) {
            const fullName = [t.firstName, t.lastName].filter(Boolean).join(' ').trim() || 'PW Faculty';
            const img = t.imageId?.baseUrl && t.imageId?.key ? `${t.imageId.baseUrl}${t.imageId.key}` : '';
            teacherMeta = {
              id: String(t._id || teacherId),
              name: fullName,
              subject: s.subject,
              experience: t.experience || tchRes?.data?.experience || 'Star PW Faculty',
              featuredLine: `${s.subject} · ${details?.name || 'PW Batch'}`,
              image: img,
              programId,
            };
            const poster =
              (s.imageId?.baseUrl && s.imageId?.key ? `${s.imageId.baseUrl}${s.imageId.key}` : '') || img;
            const sId = `${programId}:${s._id}`;
            if (!seenSeriesIds.has(sId)) {
              seenSeriesIds.add(sId);
              series.push({
                id: sId,
                type: 'batch' as const,
                programId,
                subjectId: String(s._id),
                batchId: programId,
                subjectName: s.subject,
                title: `${s.subject} — ${details?.name || 'Series'}`,
                subtitle: `By ${fullName}`,
                teacherName: fullName,
                teacherId: String(t._id),
                poster,
                backdrop: poster,
                tag: 'FACULTY SERIES',
                year: '2025',
              });
            }
          }
        }
      }

      if (!teacherMeta) {
        const d = tchRes?.data;
        teacherMeta = {
          id: teacherId,
          name: d?.teacher_name || 'PW Faculty',
          subject: d?.subject || 'Concept Expert',
          experience: d?.experience || 'Senior Faculty',
          featuredLine: 'PW Pi Pro Mentor',
          image: d?.teacher_profile || '',
          programId,
        };
      }

      // Fetch sample episodes from the teacher's first series
      const playlistVideos: any[] = [];
      const seenPlaylistVideoIds = new Set<string>();
      if (series[0]?.subjectId) {
        const tRes = await callStudyParchamPw('pw_sub_topics', {
          batchId: programId,
          subjectId: series[0].subjectId,
          page: 1,
          tagType: 'UNITS',
          limit: 10,
        });
        const firstTopic = (tRes.data || []).find((t: any) => (t.videos || 0) > 0) || (tRes.data || [])[0];
        if (firstTopic?._id) {
          const vRes = await callStudyParchamPw('pw_v2_list', {
            batchId: programId,
            subjectId: series[0].subjectId,
            tagId: firstTopic._id,
            contentType: 'videos',
            page: 1,
            limit: 8,
          });
          for (const vid of vRes.data || []) {
            const vidId = String(vid._id || `pv-${playlistVideos.length}`);
            if (seenPlaylistVideoIds.has(vidId)) continue;
            seenPlaylistVideoIds.add(vidId);
            playlistVideos.push({
              id: vidId,
              title: vid.topic || vid.videoDetails?.name || 'Lecture',
              duration: vid.videoDetails?.duration || '',
              thumb: vid.videoDetails?.image || '',
              programId,
              batchId: programId,
              subjectId: series[0].subjectId,
              topicId: firstTopic._id,
              topicName: firstTopic.name,
              findKey: vid.videoDetails?.findKey,
              videoDetailsId: vid.videoDetails?._id || vid.videoDetails?.id,
              videoType: vid.urlType || 'new',
              rawVideoUrl: vid.url || vid.videoDetails?.videoUrl || '',
            });
          }
        }
      }

      return res.json({
        success: true,
        teacher: { ...teacherMeta, seriesCount: series.length },
        series,
        playlistVideos,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to load teacher profile' });
    }
  });

  app.post('/api/pi/ask', async (req, res) => {
    try {
      const { query = '', subject = 'Science', mode = 'concept' } = req.body || {};
      if (!String(query).trim()) {
        return res.status(400).json({ success: false, message: 'Please enter a concept or question.' });
      }
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: String(query).trim(),
        config: {
          systemInstruction: `You are PW Pi Concept Solver for ${subject} (mode: ${mode}). Give crisp, accurate explanations, key formulas, units, and a quick exam tip in clean Hinglish/English.`,
        },
      });
      return res.json({ success: true, answer: (response.text || '').trim() });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Pi Concept Solver failed.' });
    }
  });

  // 6. Offline Lecture Downloader & Quality Inspector (uses /usr/bin/ffmpeg + /api/hls-proxy)
  app.get('/api/lecture-download/inspect', async (req, res) => {
    try {
      const rawHls = String(req.query.hls_url || '').trim();
      const isDirectMp4 = String(req.query.is_direct_mp4 || '') === '1';
      if (!rawHls) {
        return res.status(400).json({ success: false, message: 'Video URL missing' });
      }

      let resolvedUrl = applyCachedStudyParchamSig(unwrapLocalProxyUrl(rawHls, req));
      if (isDirectMp4 || /\.mp4(\?|$)/i.test(resolvedUrl)) {
        return res.json({
          success: true,
          durationSecs: 0,
          options: [
            {
              id: 'mp4-hd',
              label: 'HD MP4 Video',
              subLabel: 'Original MP4 Stream',
              qualityTag: 'HD',
              format: 'mp4',
              url: resolvedUrl,
              isDirectMp4: true,
            },
            {
              id: 'm4a-audio',
              label: 'Audio Only (M4A)',
              subLabel: 'Data Saver Revision Audio',
              qualityTag: 'Audio',
              format: 'm4a',
              url: resolvedUrl,
              isDirectMp4: true,
            },
          ],
        });
      }

      let masterRes = await fetch(resolvedUrl, {
        headers: { 'User-Agent': USER_AGENT, Referer: 'https://pw.studyparcham.in/' },
      });
      if (masterRes.status === 403) {
        const refreshed = await refreshStudyParchamSigForUrl(resolvedUrl);
        if (refreshed) {
          resolvedUrl = refreshed;
          masterRes = await fetch(resolvedUrl, {
            headers: { 'User-Agent': USER_AGENT, Referer: 'https://pw.studyparcham.in/' },
          });
        }
      }
      if (!masterRes.ok) {
        return res.status(masterRes.status).json({
          success: false,
          message: `Stream playlist unavailable (${masterRes.status})`,
        });
      }
      const text = await masterRes.text();
      const baseParsed = new URL(resolvedUrl);
      const baseDir = `${baseParsed.origin}${baseParsed.pathname.replace(/[^/]+$/, '')}`;
      const sigParams = baseParsed.search ? baseParsed.search.slice(1) : '';

      const attachSig = (u: string) => {
        const abs = u.startsWith('http') ? u : new URL(u, baseDir).toString();
        if (!sigParams) return abs;
        const parsed = new URL(abs);
        if (!parsed.searchParams.has('Signature')) {
          new URLSearchParams(sigParams).forEach((v, k) => {
            if (!parsed.searchParams.has(k)) parsed.searchParams.set(k, v);
          });
        }
        return parsed.toString();
      };

      const lines = text.split(/\r?\n/);
      const variants: Array<{ height: number; bandwidth: number; url: string }> = [];
      let totalDurationSecs = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
          const sec = parseFloat(line.slice(8).split(',')[0]);
          if (Number.isFinite(sec)) totalDurationSecs += sec;
        }
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
          const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
          const height = resMatch ? Number(resMatch[1]) : 480;
          const bandwidth = bwMatch ? Number(bwMatch[1]) : 800000;
          const nextLine = (lines[i + 1] || '').trim();
          if (nextLine && !nextLine.startsWith('#')) {
            variants.push({ height, bandwidth, url: attachSig(nextLine) });
          }
        }
      }

      // If duration wasn't in master playlist, sample first variant for accurate ETA/progress
      if (totalDurationSecs === 0 && variants.length > 0) {
        try {
          const vRes = await fetch(variants[0].url, { headers: { 'User-Agent': USER_AGENT } });
          if (vRes.ok) {
            const vTxt = await vRes.text();
            for (const vl of vTxt.split(/\r?\n/)) {
              if (vl.startsWith('#EXTINF:')) {
                const sec = parseFloat(vl.slice(8).split(',')[0]);
                if (Number.isFinite(sec)) totalDurationSecs += sec;
              }
            }
          }
        } catch {
          // optional duration estimate
        }
      }

      variants.sort((a, b) => a.height - b.height);
      const seenH = new Set<number>();
      const options: any[] = [];
      for (const v of variants) {
        if (seenH.has(v.height)) continue;
        seenH.add(v.height);
        const estMb =
          totalDurationSecs > 0
            ? Math.max(5, Math.round((v.bandwidth * totalDurationSecs) / (8 * 1024 * 1024)))
            : undefined;
        options.push({
          id: `mp4-${v.height}p`,
          label: `${v.height}p MP4`,
          subLabel: `Video + Audio (${formatDurationLabel(totalDurationSecs)})`,
          qualityTag: `${v.height}p`,
          format: 'mp4',
          url: v.url,
          estimatedMb: estMb,
        });
      }

      if (options.length === 0) {
        options.push({
          id: 'mp4-auto',
          label: 'Standard MP4',
          subLabel: 'Video + Audio',
          qualityTag: 'Auto',
          format: 'mp4',
          url: resolvedUrl,
        });
      }

      // Audio-only option using lowest bandwidth stream for speed
      const audioSrc = variants[0]?.url || resolvedUrl;
      options.push({
        id: 'm4a-audio',
        label: 'Audio Only (M4A)',
        subLabel: 'Lightweight Audio Revision',
        qualityTag: 'Audio',
        format: 'm4a',
        url: audioSrc,
        estimatedMb: totalDurationSecs > 0 ? Math.max(2, Math.round((96000 * totalDurationSecs) / (8 * 1024 * 1024))) : undefined,
      });

      return res.json({
        success: true,
        durationSecs: Math.round(totalDurationSecs),
        options,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Inspect failed' });
    }
  });

  app.post('/api/lecture-download/start', async (req, res) => {
    try {
      const { url = '', title = 'PW Lecture', qualityLabel = '720p', format = 'mp4', durationSecs = 0 } =
        req.body || {};
      const resolvedUrl = applyCachedStudyParchamSig(unwrapLocalProxyUrl(String(url), req));
      if (!resolvedUrl) {
        return res.status(400).json({ success: false, message: 'Download URL is required' });
      }

      const jobId = crypto.randomBytes(8).toString('hex');
      const safeTitle =
        String(title)
          .replace(/[/\\?%*:|"<>]/g, '_')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80) || 'PW_Lecture';
      const ext = format === 'm4a' ? 'm4a' : 'mp4';
      const fileName = `${safeTitle} (${qualityLabel}).${ext}`;
      const filePath = path.join(os.tmpdir(), `sc_dl_${jobId}.${ext}`);

      const job: ServerDownloadJob = {
        id: jobId,
        fileName,
        filePath,
        status: 'downloading',
        percent: 1,
        downloadedBytes: 0,
        totalDurationSecs: Number(durationSecs) || 0,
        processedSecs: 0,
        createdAt: Date.now(),
      };
      downloadJobs.set(jobId, job);

      const ffArgs =
        ext === 'm4a'
          ? ['-y', '-loglevel', 'error', '-progress', 'pipe:1', '-i', resolvedUrl, '-vn', '-c:a', 'copy', '-movflags', '+faststart', filePath]
          : ['-y', '-loglevel', 'error', '-progress', 'pipe:1', '-i', resolvedUrl, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', filePath];

      const proc = spawn('ffmpeg', ffArgs);
      job.proc = proc;

      let errOut = '';
      proc.stderr.on('data', (d) => {
        errOut += d.toString();
      });
      proc.stdout.on('data', (chunk) => {
        const str = chunk.toString();
        const tMatch = str.match(/out_time_us=(\d+)/);
        if (tMatch) {
          const secs = Math.floor(Number(tMatch[1]) / 1_000_000);
          job.processedSecs = secs;
          if (job.totalDurationSecs > 0) {
            job.percent = Math.min(94, Math.max(2, Math.round((secs / job.totalDurationSecs) * 94)));
          } else {
            job.percent = Math.min(90, job.percent + 1);
          }
        }
        try {
          if (fs.existsSync(filePath)) {
            job.downloadedBytes = fs.statSync(filePath).size;
          }
        } catch {
          // ignore
        }
      });

      proc.on('close', (code) => {
        if (job.status === 'cancelled') return;
        try {
          if (fs.existsSync(filePath)) {
            job.downloadedBytes = fs.statSync(filePath).size;
          }
        } catch {
          // ignore
        }
        if (code === 0 && job.downloadedBytes > 0) {
          job.status = 'ready';
          job.percent = 100;
        } else {
          job.status = 'error';
          job.error = errOut.trim().slice(0, 200) || `ffmpeg exited with code ${code}`;
        }
      });

      proc.on('error', (err) => {
        if (job.status === 'cancelled') return;
        job.status = 'error';
        job.error = err.message || 'Failed to launch downloader';
      });

      return res.json({ success: true, jobId, fileName });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to start download' });
    }
  });

  app.get('/api/lecture-download/status/:jobId', (req, res) => {
    const job = downloadJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Download job not found' });
    }
    return res.json({
      status: job.status,
      percent: job.percent,
      downloadedBytes: job.downloadedBytes,
      totalDurationSecs: job.totalDurationSecs,
      processedSecs: job.processedSecs,
      fileName: job.fileName,
      error: job.error || null,
    });
  });

  app.get('/api/lecture-download/chunk/:jobId', (req, res) => {
    const job = downloadJobs.get(req.params.jobId);
    if (!job || !fs.existsSync(job.filePath)) {
      return res.status(404).send('File not found');
    }
    const stat = fs.statSync(job.filePath);
    const total = stat.size;
    const offset = Math.max(0, Number(req.query.offset || 0));
    const reqLen = Math.min(8 * 1024 * 1024, Math.max(1, Number(req.query.length || 6 * 1024 * 1024)));
    const len = Math.max(0, Math.min(reqLen, total - offset));

    res.setHeader('X-Total-Bytes', String(total));
    res.setHeader('Content-Type', 'application/octet-stream');
    if (len === 0) {
      return res.send(Buffer.alloc(0));
    }
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(job.filePath, 'r');
    try {
      fs.readSync(fd, buf, 0, len, offset);
    } finally {
      fs.closeSync(fd);
    }
    return res.send(buf);
  });

  app.delete('/api/lecture-download/:jobId', (req, res) => {
    const job = downloadJobs.get(req.params.jobId);
    if (job) {
      job.status = 'cancelled';
      try {
        job.proc?.kill('SIGKILL');
      } catch {
        // ignore
      }
      try {
        if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
      } catch {
        // ignore
      }
      downloadJobs.delete(req.params.jobId);
    }
    return res.json({ success: true });
  });
}
