import express from 'express';
import crypto from 'crypto';
import http from 'http';
import fs from 'fs';
import path from 'path';
import Stripe from 'stripe';
import { WebSocketServer, WebSocket } from 'ws';
import { readVaultJson, writeVaultJson } from './serverVault.ts';

const BOOTSTRAP_ADMIN_EMAIL = 'mantoshumar425@gmail.com';

function loadFirebaseProjectId(): string {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return String(parsed?.projectId || 'metal-cycling-v0z9n');
  } catch {
    return 'metal-cycling-v0z9n';
  }
}

const FIREBASE_PROJECT_ID = loadFirebaseProjectId();

// Cached Google public X.509 certificates for verifying Firebase Auth ID tokens without Admin IAM
let cachedCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  if (cachedCerts && Date.now() < cachedCerts.expiresAt) {
    return cachedCerts.certs;
  }
  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!res.ok) {
    throw new Error('Failed to fetch Firebase token signing certificates');
  }
  const certs = (await res.json()) as Record<string, string>;
  const cc = res.headers.get('cache-control') || '';
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600 * 1000;
  cachedCerts = { certs, expiresAt: Date.now() + Math.min(ttlMs, 6 * 3600 * 1000) };
  return certs;
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

function decodeBase64Url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseUser | null> {
  try {
    const parts = String(token || '').trim().split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const header = JSON.parse(decodeBase64Url(headerB64).toString('utf8'));
    const payload = JSON.parse(decodeBase64Url(payloadB64).toString('utf8'));
    if (header?.alg !== 'RS256' || !header?.kid) return null;

    const certs = await getGooglePublicCerts();
    const certPem = certs[String(header.kid)];
    if (!certPem) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    const validSig = verifier.verify(certPem, decodeBase64Url(sigB64));
    if (!validSig) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
    if (payload.aud !== FIREBASE_PROJECT_ID) return null;
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;

    return {
      uid: payload.sub,
      email: String(payload.email || ''),
      emailVerified: payload.email_verified === true,
      name: String(payload.name || payload.email?.split('@')[0] || 'Student'),
    };
  } catch {
    return null;
  }
}

function extractBearerToken(req: express.Request): string {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

function isVerifiedAdmin(user: VerifiedFirebaseUser | null): boolean {
  if (!user || !user.emailVerified) return false;
  if (user.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) return true;
  const adminUids = readVaultJson<string[]>('platform_admin_uids_v1')?.data || [];
  return adminUids.includes(user.uid);
}

// Vault storage keys
const COURSES_KEY = 'platform_courses_v1';
const ENROLLMENTS_KEY = 'platform_enrollments_v1';
const LIVE_CLASSES_KEY = 'platform_live_classes_v1';
const LIVE_MESSAGES_KEY = 'platform_live_messages_v1';
const LIVE_ATTENDANCE_KEY = 'platform_live_attendance_v1';
const DPPS_KEY = 'platform_dpps_v1';
const DPP_SUBMISSIONS_KEY = 'platform_dpp_submissions_v1';
const TESTS_KEY = 'platform_test_series_v1';
const TEST_ATTEMPTS_KEY = 'platform_test_attempts_v1';
const DOUBTS_KEY = 'platform_doubts_v1';
const BOOKMARKS_KEY = 'platform_bookmarks_v1';
const ORDERS_KEY = 'platform_orders_v1';
const COUPONS_KEY = 'platform_coupons_v1';
const NOTIFICATIONS_KEY = 'platform_notifications_v1';

function getSeedCourses() {
  const now = Date.now();
  return [
    {
      courseId: 'sc-class9-neev-cbse',
      title: 'Neev Class 9 CBSE Foundation',
      category: 'CBSE Boards',
      classLevel: 'Class 9',
      price: 0,
      currency: 'INR',
      isFree: true,
      published: true,
      syllabus: 'Complete NCERT Science (Motion, Gravitation, Atoms, Tissues), Mathematics (Number Systems, Polynomials, Geometry), SST & English.',
      timetable: 'Mon–Sat · 4:30 PM Physics/Science · 6:00 PM Mathematics',
      facultyName: 'Alakh Sir Faculty Team · Study Cloud Educators',
      thumbnail: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/0d87949f-d1f8-4483-bcf2-80730b8f5369.png',
      createdAt: now,
      updatedAt: now,
    },
    {
      courseId: 'sc-class10-udaan-cbse',
      title: 'Udaan Class 10 CBSE Board Mastery',
      category: 'CBSE Boards',
      classLevel: 'Class 10',
      price: 999,
      currency: 'INR',
      isFree: false,
      published: true,
      syllabus: 'Board + NTSE coverage: Chemical Reactions, Electricity, Light, Life Processes, Trigonometry, Quadratic Equations & PYQ Series.',
      timetable: 'Mon–Sat · 5:00 PM Science · 6:45 PM Maths · Sunday Weekly Board Test',
      facultyName: 'Rakshak Sir · Sanya Ma’am · Ritik Sir',
      thumbnail: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/414feae9-dd97-409e-b3eb-d4f87c358a74.png',
      createdAt: now,
      updatedAt: now,
    },
    {
      courseId: 'sc-class11-arjuna-jee',
      title: 'Arjuna Class 11 IIT-JEE + CBSE',
      category: 'IIT-JEE',
      classLevel: 'Class 11',
      price: 2499,
      currency: 'INR',
      isFree: false,
      published: true,
      syllabus: 'Full Class 11 JEE Main & Advanced: Mechanics, Thermodynamics, GOC, Atomic Structure, Conic Sections & Sequences.',
      timetable: 'Mon–Sat · 4:00 PM Physics · 5:45 PM Chemistry · 7:30 PM Maths',
      facultyName: 'Rajwant Sir · Pankaj Sir · Sachin Sir',
      thumbnail: 'https://d2bps9p1kiy4ka.cloudfront.net/5eb393ee95fab7468a79d189/61e8fafe-0891-4741-a76d-b3f7dedae5b7.png',
      createdAt: now,
      updatedAt: now,
    },
    {
      courseId: 'sc-class12-lakshya-neet',
      title: 'Lakshya Class 12 NEET + Boards',
      category: 'NEET',
      classLevel: 'Class 12',
      price: 2999,
      currency: 'INR',
      isFree: false,
      published: true,
      syllabus: 'NCERT Line-by-Line Class 12 Electrostatics, Current Electricity, Organic Chemistry, Genetics, Biotechnology & Ecology.',
      timetable: 'Mon–Sat · 4:00 PM Physics · 5:45 PM Chemistry · 7:30 PM Biology',
      facultyName: 'MR Sir · Amit Mahajan Sir · Samapti Ma’am',
      thumbnail: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/aedad935-8809-413b-9bd7-365bea3352cc.png',
      createdAt: now,
      updatedAt: now,
    },
    {
      courseId: 'sc-class12-lakshya-jee-free',
      title: 'Lakshya Class 12 Board Revision (Free)',
      category: 'CBSE Boards',
      classLevel: 'Class 12',
      price: 0,
      currency: 'INR',
      isFree: true,
      published: true,
      syllabus: 'Free One-Shot Board & CUET Sprint covering Electrostatics, Optics, Calculus, Matrices & Solutions.',
      timetable: 'Tue / Thu / Sat · 6:00 PM Live Revision',
      facultyName: 'Study Cloud Core Faculty',
      thumbnail: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/de06beef-a1fb-4056-9323-edd3cf10c518.png',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function getCourses() {
  const existing = readVaultJson<any[]>(COURSES_KEY)?.data;
  if (Array.isArray(existing) && existing.length > 0) return existing;
  const seed = getSeedCourses();
  writeVaultJson(COURSES_KEY, seed);
  return seed;
}

function getCoupons() {
  const existing = readVaultJson<any[]>(COUPONS_KEY)?.data;
  if (Array.isArray(existing) && existing.length > 0) return existing;
  const seed = [
    { code: 'STUDY10', discountPercent: 10, maxDiscount: 500, active: true },
    { code: 'SCHOLAR20', discountPercent: 20, maxDiscount: 1000, active: true },
  ];
  writeVaultJson(COUPONS_KEY, seed);
  return seed;
}

function getSeedLiveClasses() {
  const now = Date.now();
  return [
    {
      classId: 'live-phy-electrostatics',
      title: 'Electrostatics & Gauss Law — Live Problem Solving',
      subject: 'Physics',
      teacherName: 'Rajwant Sir',
      streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      scheduledAt: new Date(now).toISOString(),
      status: 'live',
      published: true,
      createdAt: now,
    },
    {
      classId: 'live-chem-goc',
      title: 'General Organic Chemistry — Stability & Resonance',
      subject: 'Chemistry',
      teacherName: 'Pankaj Sir',
      streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      scheduledAt: new Date(now + 2 * 3600 * 1000).toISOString(),
      status: 'scheduled',
      published: true,
      createdAt: now,
    },
    {
      classId: 'live-math-calculus',
      title: 'Calculus — Limits, Continuity & Differentiability',
      subject: 'Mathematics',
      teacherName: 'Sachin Sir',
      streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      scheduledAt: new Date(now + 20 * 3600 * 1000).toISOString(),
      status: 'scheduled',
      published: true,
      createdAt: now,
    },
  ];
}

function getLiveClasses() {
  const existing = readVaultJson<any[]>(LIVE_CLASSES_KEY)?.data;
  if (Array.isArray(existing) && existing.length > 0) return existing;
  const seed = getSeedLiveClasses();
  writeVaultJson(LIVE_CLASSES_KEY, seed);
  return seed;
}

function getSeedDpps() {
  const now = Date.now();
  return [
    {
      dppId: 'dpp-phy-kinematics-01',
      title: 'DPP 01 · Kinematics & Projectile Motion',
      subject: 'Physics',
      chapter: 'Motion in a Plane',
      classLevel: 'Class 11',
      published: true,
      createdAt: now,
      questions: [
        {
          id: 'q1',
          kind: 'mcq',
          prompt: 'A ball is projected with speed 20 m/s at 45° above horizontal (g = 10 m/s²). What is its horizontal range?',
          options: ['40 m', '20 m', '80 m', '10 m'],
          correctIndex: 0,
          explanation: 'R = u² sin(2θ) / g = (400 × sin 90°) / 10 = 40 m.',
        },
        {
          id: 'q2',
          kind: 'mcq',
          prompt: 'At the highest point of a projectile path, what is the angle between velocity and acceleration?',
          options: ['0°', '45°', '90°', '180°'],
          correctIndex: 2,
          explanation: 'Velocity is purely horizontal while acceleration (gravity) is vertically downward, making 90°.',
        },
        {
          id: 'q3',
          kind: 'mcq',
          prompt: 'If time of flight of a projectile is 4 s (g = 10 m/s²), find maximum height reached.',
          options: ['10 m', '20 m', '40 m', '80 m'],
          correctIndex: 1,
          explanation: 'H = gT² / 8 = 10 × 16 / 8 = 20 m.',
        },
        {
          id: 'q4',
          kind: 'subjective',
          prompt: 'Derive the equation of trajectory y = x tanθ - gx²/(2u² cos²θ) and state the condition for maximum range on horizontal ground.',
          explanation: 'Eliminate t = x/(u cosθ) in y = (u sinθ)t - ½gt². Maximum range occurs when sin(2θ) = 1 => θ = 45°.',
        },
      ],
    },
    {
      dppId: 'dpp-chem-solutions-01',
      title: 'DPP 02 · Solutions & Colligative Properties',
      subject: 'Chemistry',
      chapter: 'Solutions (Class 12)',
      classLevel: 'Class 12',
      published: true,
      createdAt: now,
      questions: [
        {
          id: 'q1',
          kind: 'mcq',
          prompt: 'Which colligative property is most suitable for determining molar mass of polymers and proteins?',
          options: ['Elevation in boiling point', 'Depression in freezing point', 'Osmotic pressure', 'Relative lowering of vapour pressure'],
          correctIndex: 2,
          explanation: 'Osmotic pressure has measurable magnitude even at very dilute concentrations near room temperature.',
        },
        {
          id: 'q2',
          kind: 'mcq',
          prompt: 'For 0.1 M K2SO4 (100% dissociated), what is the van’t Hoff factor i?',
          options: ['1', '2', '3', '4'],
          correctIndex: 2,
          explanation: 'K2SO4 dissociates into 2 K+ and 1 SO4²⁻ ions, giving 3 ions per formula unit (i = 3).',
        },
        {
          id: 'q3',
          kind: 'subjective',
          prompt: 'Explain positive and negative deviations from Raoult’s law with one liquid pair example each.',
          explanation: 'Positive deviation: A-B interactions < A-A/B-B (e.g. Ethanol + Acetone). Negative deviation: A-B > A-A/B-B (e.g. Chloroform + Acetone).',
        },
      ],
    },
    {
      dppId: 'dpp-bio-genetics-01',
      title: 'DPP 03 · Molecular Basis of Inheritance',
      subject: 'Biology',
      chapter: 'Genetics (NEET / Class 12)',
      classLevel: 'Class 12',
      published: true,
      createdAt: now,
      questions: [
        {
          id: 'q1',
          kind: 'mcq',
          prompt: 'In the lac operon, which molecule acts as the inducer by binding to the repressor protein?',
          options: ['Glucose', 'Allolactose / Lactose', 'Galactose', 'Tryptophan'],
          correctIndex: 1,
          explanation: 'Lactose (specifically allolactose) binds to the lac repressor and inactivates it, allowing transcription.',
        },
        {
          id: 'q2',
          kind: 'mcq',
          prompt: 'Which enzyme synthesizes the lagging strand Okazaki fragments during DNA replication?',
          options: ['DNA Polymerase III', 'RNA Primase only', 'Topoisomerase', 'Telomerase'],
          correctIndex: 0,
          explanation: 'DNA Polymerase III extends RNA primers in the 5′→3′ direction on both leading and lagging strands.',
        },
        {
          id: 'q3',
          kind: 'subjective',
          prompt: 'Describe Meselson and Stahl’s experiment proving semiconservative DNA replication.',
          explanation: 'Used heavy 15N and light 14N isotopes in E. coli with CsCl density gradient centrifugation showing hybrid intermediate band after generation I.',
        },
      ],
    },
  ];
}

function getDpps() {
  const existing = readVaultJson<any[]>(DPPS_KEY)?.data;
  if (Array.isArray(existing) && existing.length > 0) return existing;
  const seed = getSeedDpps();
  writeVaultJson(DPPS_KEY, seed);
  return seed;
}

function getSeedTestSeries() {
  const now = Date.now();
  return [
    {
      testId: 'test-chapter-electrostatics',
      title: 'Chapter Test · Electrostatics & Capacitance',
      seriesType: 'chapter',
      subject: 'Physics',
      durationMinutes: 15,
      totalMarks: 20,
      published: true,
      createdAt: now,
      questions: [
        {
          question: 'Capacitance of a parallel plate capacitor increases when:',
          options: ['Plate area decreases', 'Plate separation increases', 'Dielectric slab is inserted between plates', 'Charge is doubled'],
          correctIndex: 2,
          explanation: 'C = k ε₀ A / d. Inserting a dielectric with k > 1 increases capacitance k times.',
        },
        {
          question: 'Electric field inside a uniformly charged spherical shell is:',
          options: ['Zero everywhere inside', 'Proportional to 1/r²', 'Proportional to r', 'Infinite at center'],
          correctIndex: 0,
          explanation: 'By Gauss’s Law, enclosed charge inside the hollow shell is zero, so E = 0.',
        },
        {
          question: 'Energy stored in a 10 µF capacitor charged to 100 V is:',
          options: ['0.05 J', '0.5 J', '5 J', '50 mJ (wait: 0.05 J = 50 mJ -> select 0.05 J)'],
          correctIndex: 0,
          explanation: 'U = ½ C V² = 0.5 × 10×10⁻⁶ × 10000 = 0.05 J.',
        },
        {
          question: 'Equipotential surfaces and electric field lines are always:',
          options: ['Parallel', 'Perpendicular', 'At 45°', 'Coplanar'],
          correctIndex: 1,
          explanation: 'Work done moving along an equipotential is zero, so E · dl = 0 => E ⟂ surface.',
        },
        {
          question: 'SI unit of electric dipole moment is:',
          options: ['C / m', 'C · m', 'N / C', 'V · m'],
          correctIndex: 1,
          explanation: 'p = q × 2a has SI unit Coulomb-meter (C·m).',
        },
      ],
    },
    {
      testId: 'test-weekly-pcm-01',
      title: 'Weekly Test · Class 11/12 JEE Sprint',
      seriesType: 'weekly',
      subject: 'PCM Combined',
      durationMinutes: 20,
      totalMarks: 20,
      published: true,
      createdAt: now,
      questions: [
        {
          question: 'The value of lim(x→0) (sin 3x) / x is:',
          options: ['1', '3', '1/3', '0'],
          correctIndex: 1,
          explanation: 'lim(x→0) 3 × (sin 3x)/(3x) = 3 × 1 = 3.',
        },
        {
          question: 'Which hybridization does SF6 exhibit?',
          options: ['sp3d', 'sp3d2', 'dsp2', 'sp3'],
          correctIndex: 1,
          explanation: 'SF6 has 6 bond pairs and 0 lone pairs => steric number 6 => sp3d2 octahedral geometry.',
        },
        {
          question: 'Escape velocity from Earth’s surface is approximately:',
          options: ['7.9 km/s', '11.2 km/s', '9.8 km/s', '15.0 km/s'],
          correctIndex: 1,
          explanation: 'v_e = √(2gR) ≈ 11.2 km/s.',
        },
        {
          question: 'Derivative of ln(sin x) with respect to x is:',
          options: ['tan x', 'cot x', 'sec x', 'cosec x'],
          correctIndex: 1,
          explanation: 'd/dx[ln(sin x)] = cos x / sin x = cot x.',
        },
        {
          question: 'First law of thermodynamics is a statement of conservation of:',
          options: ['Momentum', 'Energy', 'Entropy', 'Mass'],
          correctIndex: 1,
          explanation: 'ΔQ = ΔU + ΔW expresses conservation of energy.',
        },
      ],
    },
    {
      testId: 'test-monthly-neet-01',
      title: 'Monthly Mega Test · NEET NCERT Mock',
      seriesType: 'monthly',
      subject: 'PCB Combined',
      durationMinutes: 25,
      totalMarks: 20,
      published: true,
      createdAt: now,
      questions: [
        {
          question: 'Powerhouse of the eukaryotic cell responsible for ATP synthesis is:',
          options: ['Golgi apparatus', 'Mitochondria', 'Lysosome', 'Peroxisome'],
          correctIndex: 1,
          explanation: 'Mitochondria generate ATP via oxidative phosphorylation.',
        },
        {
          question: 'pH of a neutral aqueous solution at 25°C is:',
          options: ['0', '7', '14', '1'],
          correctIndex: 1,
          explanation: 'At 25°C, Kw = 10⁻¹⁴, so [H+] = 10⁻⁷ M and pH = 7.',
        },
        {
          question: 'Normal resting heart rate of a healthy adult human is roughly:',
          options: ['72 beats/min', '40 beats/min', '120 beats/min', '150 beats/min'],
          correctIndex: 0,
          explanation: 'Standard cardiac cycle lasts 0.8 s giving ~72 beats per minute.',
        },
        {
          question: 'SI unit of magnetic flux is:',
          options: ['Tesla', 'Weber', 'Henry', 'Gauss'],
          correctIndex: 1,
          explanation: 'Magnetic flux Φ = B·A has SI unit Weber (Wb).',
        },
        {
          question: 'Vitamin C deficiency causes:',
          options: ['Rickets', 'Scurvy', 'Beriberi', 'Goitre'],
          correctIndex: 1,
          explanation: 'Ascorbic acid (Vitamin C) deficiency leads to Scurvy.',
        },
      ],
    },
    {
      testId: 'test-full-syllabus-boards',
      title: 'Full Syllabus Mock · Class 10/12 Boards',
      seriesType: 'full',
      subject: 'Full Syllabus',
      durationMinutes: 30,
      totalMarks: 20,
      published: true,
      createdAt: now,
      questions: [
        {
          question: 'Focal length of a plane mirror is:',
          options: ['Zero', 'Infinity', '25 cm', '-1'],
          correctIndex: 1,
          explanation: 'A plane mirror has infinite radius of curvature, so f = R/2 = ∞.',
        },
        {
          question: 'Ohm’s law states V = I × R provided:',
          options: ['Temperature remains constant', 'Current is zero', 'Resistance increases', 'AC is applied'],
          correctIndex: 0,
          explanation: 'V ∝ I holds when physical conditions like temperature remain constant.',
        },
        {
          question: 'Which gas turns lime water milky?',
          options: ['O2', 'CO2', 'N2', 'H2'],
          correctIndex: 1,
          explanation: 'CO2 reacts with Ca(OH)2 forming insoluble white CaCO3 precipitate.',
        },
        {
          question: 'Sum of first n natural numbers is:',
          options: ['n(n+1)/2', 'n²', 'n(n-1)/2', '2n+1'],
          correctIndex: 0,
          explanation: 'Arithmetic series 1 + 2 + ... + n = n(n+1)/2.',
        },
        {
          question: 'Universal donor human blood group (RBCs without A/B antigens) is:',
          options: ['AB+', 'O−', 'A+', 'B−'],
          correctIndex: 1,
          explanation: 'O negative red blood cells lack A, B, and Rh antigens.',
        },
      ],
    },
  ];
}

function getTestSeries() {
  const existing = readVaultJson<any[]>(TESTS_KEY)?.data;
  if (Array.isArray(existing) && existing.length > 0) return existing;
  const seed = getSeedTestSeries();
  writeVaultJson(TESTS_KEY, seed);
  return seed;
}

function getSeedNotifications() {
  const now = Date.now();
  return [
    {
      notificationId: 'notif-welcome-live',
      title: 'Live Classroom Active — Electrostatics Sprint',
      body: 'Join the live interactive classroom with real-time chat, Q&A, and attendance tracking.',
      type: 'live',
      active: true,
      createdAt: now,
    },
    {
      notificationId: 'notif-weekly-test',
      title: 'Weekly & Full-Syllabus Test Series Open',
      body: 'Attempt Chapter, Weekly, Monthly, or Full-Syllabus tests to generate your real All-India Rank & Percentile.',
      type: 'test',
      active: true,
      createdAt: now - 3600 * 1000,
    },
    {
      notificationId: 'notif-dpp-daily',
      title: 'New Daily Practice Problems (DPPs) Added',
      body: 'Solve Physics, Chemistry & Biology DPPs with step-by-step solutions and earn daily streak XP.',
      type: 'notes',
      active: true,
      createdAt: now - 7200 * 1000,
    },
  ];
}

function getNotifications() {
  const existing = readVaultJson<any[]>(NOTIFICATIONS_KEY)?.data;
  if (Array.isArray(existing) && existing.length > 0) return existing;
  const seed = getSeedNotifications();
  writeVaultJson(NOTIFICATIONS_KEY, seed);
  return seed;
}

export interface PlatformWsHub {
  broadcastNotification: (notif: any) => void;
}

export function attachPlatformWebSocketServer(httpServer: http.Server): PlatformWsHub {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<string, Set<WebSocket>>();
  const roomRoster = new Map<string, Map<string, { uid: string; name: string; joinedAt: number }>>();
  const clientMeta = new WeakMap<WebSocket, { classId?: string; uid?: string; name?: string }>();

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const reqUrl = new URL(request.url || '/', 'http://localhost');
      if (reqUrl.pathname === '/ws/classroom') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      // ignore invalid URL
    }
  });

  const broadcastToRoom = (classId: string, payload: any) => {
    const set = rooms.get(classId);
    if (!set) return;
    const raw = JSON.stringify(payload);
    for (const client of set) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  };

  const broadcastPresence = (classId: string) => {
    const rosterMap = roomRoster.get(classId);
    const attendees = rosterMap ? Array.from(rosterMap.values()) : [];
    broadcastToRoom(classId, { type: 'presence', classId, attendees, count: attendees.length });
  };

  wss.on('connection', (ws) => {
    ws.on('message', async (rawBuf) => {
      try {
        const msg = JSON.parse(rawBuf.toString('utf8'));
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'join') {
          const classId = String(msg.classId || 'global').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
          let uid = String(msg.uid || '').slice(0, 128);
          let name = String(msg.name || 'Student').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Student';
          if (msg.token) {
            const verified = await verifyFirebaseIdToken(String(msg.token));
            if (verified) {
              uid = verified.uid;
              if (!msg.name && verified.name) name = verified.name.slice(0, 60);
            }
          }
          if (!uid) uid = `guest_${crypto.randomBytes(4).toString('hex')}`;

          const prev = clientMeta.get(ws);
          if (prev?.classId && rooms.has(prev.classId)) {
            rooms.get(prev.classId)?.delete(ws);
            if (prev.uid) roomRoster.get(prev.classId)?.delete(prev.uid);
            broadcastPresence(prev.classId);
          }

          clientMeta.set(ws, { classId, uid, name });
          if (!rooms.has(classId)) rooms.set(classId, new Set());
          rooms.get(classId)!.add(ws);

          if (classId !== 'global') {
            if (!roomRoster.has(classId)) roomRoster.set(classId, new Map());
            roomRoster.get(classId)!.set(uid, { uid, name, joinedAt: Date.now() });

            // Record attendance server-side
            const allAtt = readVaultJson<Record<string, any[]>>(LIVE_ATTENDANCE_KEY)?.data || {};
            const classAtt = Array.isArray(allAtt[classId]) ? allAtt[classId] : [];
            if (!classAtt.some((a) => a.userId === uid)) {
              classAtt.push({ userId: uid, classId, studentName: name, joinedAt: Date.now() });
              allAtt[classId] = classAtt.slice(-500);
              writeVaultJson(LIVE_ATTENDANCE_KEY, allAtt);
            }
            broadcastPresence(classId);
          }
          ws.send(JSON.stringify({ type: 'joined', classId, uid, name }));
        } else if (msg.type === 'chat' || msg.type === 'qa') {
          const meta = clientMeta.get(ws);
          if (!meta?.classId || meta.classId === 'global') return;
          const text = String(msg.text || '').trim().slice(0, 1000);
          if (!text) return;

          const entry = {
            messageId: `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            classId: meta.classId,
            userId: meta.uid || 'student',
            senderName: meta.name || 'Student',
            kind: msg.type === 'qa' ? 'qa' : 'chat',
            text,
            createdAt: Date.now(),
          };
          const allMsgs = readVaultJson<Record<string, any[]>>(LIVE_MESSAGES_KEY)?.data || {};
          const list = Array.isArray(allMsgs[meta.classId]) ? allMsgs[meta.classId] : [];
          list.push(entry);
          allMsgs[meta.classId] = list.slice(-250);
          writeVaultJson(LIVE_MESSAGES_KEY, allMsgs);

          broadcastToRoom(meta.classId, { type: 'message', data: entry });
        } else if (msg.type === 'qa_reply') {
          const meta = clientMeta.get(ws);
          if (!meta?.classId || !msg.token) return;
          const verified = await verifyFirebaseIdToken(String(msg.token));
          if (!isVerifiedAdmin(verified)) return;
          const messageId = String(msg.messageId || '');
          const reply = String(msg.reply || '').trim().slice(0, 1000);
          if (!messageId || !reply) return;

          const allMsgs = readVaultJson<Record<string, any[]>>(LIVE_MESSAGES_KEY)?.data || {};
          const list = Array.isArray(allMsgs[meta.classId]) ? allMsgs[meta.classId] : [];
          const target = list.find((m) => m.messageId === messageId);
          if (target) {
            target.reply = reply;
            writeVaultJson(LIVE_MESSAGES_KEY, allMsgs);
            broadcastToRoom(meta.classId, { type: 'message_updated', data: target });
          }
        }
      } catch {
        // ignore malformed WS frames
      }
    });

    ws.on('close', () => {
      const meta = clientMeta.get(ws);
      if (meta?.classId) {
        rooms.get(meta.classId)?.delete(ws);
        if (meta.uid && meta.classId !== 'global') {
          roomRoster.get(meta.classId)?.delete(meta.uid);
          broadcastPresence(meta.classId);
        }
      }
    });
  });

  return {
    broadcastNotification: (notif: any) => {
      const payload = JSON.stringify({ type: 'notification', data: notif });
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    },
  };
}

export function registerPlatformRoutes(app: express.Application, wsHub: PlatformWsHub) {
  const requireFirebaseUser = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const token = extractBearerToken(req);
    const user = await verifyFirebaseIdToken(token);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Sign in required. Please log in first.' });
    }
    (req as any).firebaseUser = user;
    return next();
  };

  const requireAdminUser = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const token = extractBearerToken(req);
    const user = await verifyFirebaseIdToken(token);
    if (!isVerifiedAdmin(user)) {
      return res.status(403).json({
        success: false,
        message: 'Verified Admin authorization required.',
      });
    }
    (req as any).firebaseUser = user;
    return next();
  };

  // Setup & Integration Health (No secret leakage)
  app.get('/api/platform/setup-status', (_req, res) => {
    return res.json({
      success: true,
      integrations: {
        firebaseProjectId: FIREBASE_PROJECT_ID,
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
        stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
        pwTokenConfigured: Boolean(process.env.PW_ACCESS_TOKEN),
        websocketEnabled: true,
        bootstrapAdminEmail: BOOTSTRAP_ADMIN_EMAIL,
      },
    });
  });

  // 1. Courses & Store Catalog
  app.get('/api/platform/courses', (_req, res) => {
    const courses = getCourses().filter((c) => c.published);
    return res.json({ success: true, courses });
  });

  app.get('/api/platform/enrollments', requireFirebaseUser, (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const all = readVaultJson<Record<string, any[]>>(ENROLLMENTS_KEY)?.data || {};
    return res.json({ success: true, enrollments: all[user.uid] || [] });
  });

  // 2. Coupons, Free Enrollment & Real Stripe Checkout
  app.post('/api/payments/validate-coupon', (req, res) => {
    const code = String(req.body?.code || '').trim().toUpperCase().slice(0, 40);
    const price = Math.max(0, Number(req.body?.price || 0));
    const coupon = getCoupons().find((c) => c.code === code && c.active);
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Invalid or expired coupon code.' });
    }
    const rawDiscount = Math.round((price * coupon.discountPercent) / 100);
    const discountAmount = coupon.maxDiscount > 0 ? Math.min(rawDiscount, coupon.maxDiscount) : rawDiscount;
    return res.json({
      success: true,
      coupon,
      discountAmount,
      finalAmount: Math.max(0, price - discountAmount),
    });
  });

  app.post('/api/payments/enroll-free', requireFirebaseUser, (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const courseId = String(req.body?.courseId || '').trim();
    const course = getCourses().find((c) => c.courseId === courseId && c.published);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }
    if (!course.isFree && Number(course.price) > 0) {
      return res.status(400).json({ success: false, message: 'This course requires paid checkout.' });
    }
    const allEnroll = readVaultJson<Record<string, any[]>>(ENROLLMENTS_KEY)?.data || {};
    const list = Array.isArray(allEnroll[user.uid]) ? allEnroll[user.uid] : [];
    if (!list.some((e) => e.courseId === courseId)) {
      list.push({
        courseId,
        courseTitle: course.title,
        paymentStatus: 'free',
        enrolledAt: Date.now(),
      });
      allEnroll[user.uid] = list;
      writeVaultJson(ENROLLMENTS_KEY, allEnroll);
    }
    return res.json({ success: true, enrolled: true, enrollments: list });
  });

  app.post('/api/payments/create-checkout-session', requireFirebaseUser, async (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const courseId = String(req.body?.courseId || '').trim();
    const couponCode = String(req.body?.couponCode || '').trim().toUpperCase().slice(0, 40);
    const course = getCourses().find((c) => c.courseId === courseId && c.published);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }

    let discountAmount = 0;
    if (couponCode) {
      const coupon = getCoupons().find((c) => c.code === couponCode && c.active);
      if (coupon) {
        const raw = Math.round((Number(course.price) * coupon.discountPercent) / 100);
        discountAmount = coupon.maxDiscount > 0 ? Math.min(raw, coupon.maxDiscount) : raw;
      }
    }
    const finalAmount = Math.max(0, Number(course.price) - discountAmount);
    if (finalAmount === 0) {
      return res.status(400).json({
        success: false,
        message: 'Total payable is ₹0 — use Free Enrollment instead.',
      });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return res.status(503).json({
        success: false,
        needsStripeConfig: true,
        message:
          'Stripe checkout is not configured yet. Add STRIPE_SECRET_KEY in your environment variables (.env / Secrets) to enable real card/UPI payments.',
      });
    }

    try {
      const stripe = new Stripe(stripeKey);
      const origin =
        String(req.headers.origin || '').startsWith('http')
          ? String(req.headers.origin)
          : process.env.APP_URL || 'http://localhost:3000';

      const orderId = `ord_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'inr',
              product_data: { name: course.title },
              unit_amount: Math.round(finalAmount * 100),
            },
            quantity: 1,
          },
        ],
        metadata: {
          orderId,
          userId: user.uid,
          courseId: course.courseId,
          couponCode: couponCode || '',
        },
        success_url: `${origin}/?tab=cart&stripe_session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?tab=cart&payment_cancelled=1`,
      });

      const allOrders = readVaultJson<any[]>(ORDERS_KEY)?.data || [];
      allOrders.unshift({
        orderId,
        userId: user.uid,
        courseId: course.courseId,
        courseTitle: course.title,
        amount: finalAmount,
        discountAmount,
        couponCode: couponCode || undefined,
        currency: 'INR',
        status: 'pending',
        stripeSessionId: session.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      writeVaultJson(ORDERS_KEY, allOrders.slice(0, 1000));

      return res.json({ success: true, checkoutUrl: session.url, sessionId: session.id, orderId });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err?.message || 'Failed to initiate Stripe checkout session.',
      });
    }
  });

  app.post('/api/payments/verify-session', requireFirebaseUser, async (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const sessionId = String(req.body?.sessionId || '').trim();
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey || !sessionId) {
      return res.status(400).json({ success: false, message: 'Stripe key or sessionId missing.' });
    }
    try {
      const stripe = new Stripe(stripeKey);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.metadata?.userId !== user.uid) {
        return res.status(403).json({ success: false, message: 'Session does not belong to signed-in user.' });
      }
      const isPaid = session.payment_status === 'paid';
      const allOrders = readVaultJson<any[]>(ORDERS_KEY)?.data || [];
      const order = allOrders.find((o) => o.stripeSessionId === sessionId);
      if (order) {
        order.status = isPaid ? 'paid' : 'failed';
        order.updatedAt = Date.now();
        writeVaultJson(ORDERS_KEY, allOrders);
      }
      if (isPaid && session.metadata?.courseId) {
        const allEnroll = readVaultJson<Record<string, any[]>>(ENROLLMENTS_KEY)?.data || {};
        const list = Array.isArray(allEnroll[user.uid]) ? allEnroll[user.uid] : [];
        if (!list.some((e) => e.courseId === session.metadata!.courseId)) {
          list.push({
            courseId: session.metadata.courseId,
            courseTitle: order?.courseTitle || session.metadata.courseId,
            paymentStatus: 'paid',
            orderId: order?.orderId,
            enrolledAt: Date.now(),
          });
          allEnroll[user.uid] = list;
          writeVaultJson(ENROLLMENTS_KEY, allEnroll);
        }
      }
      return res.json({ success: true, paid: isPaid, order });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Payment verification failed.' });
    }
  });

  app.get('/api/orders', requireFirebaseUser, (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const allOrders = readVaultJson<any[]>(ORDERS_KEY)?.data || [];
    const mine = isVerifiedAdmin(user)
      ? allOrders
      : allOrders.filter((o) => o.userId === user.uid);
    return res.json({ success: true, orders: mine });
  });

  // 3. Live Classes, Chat/Q&A History & Attendance
  app.get('/api/live-classes', (_req, res) => {
    const classes = getLiveClasses().filter((c) => c.published);
    const allAtt = readVaultJson<Record<string, any[]>>(LIVE_ATTENDANCE_KEY)?.data || {};
    const enriched = classes.map((c) => ({
      ...c,
      attendeeCount: Array.isArray(allAtt[c.classId]) ? allAtt[c.classId].length : 0,
    }));
    return res.json({ success: true, classes: enriched });
  });

  app.get('/api/live-classes/:classId/state', (req, res) => {
    const classId = String(req.params.classId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const allMsgs = readVaultJson<Record<string, any[]>>(LIVE_MESSAGES_KEY)?.data || {};
    const allAtt = readVaultJson<Record<string, any[]>>(LIVE_ATTENDANCE_KEY)?.data || {};
    return res.json({
      success: true,
      messages: allMsgs[classId] || [],
      attendance: allAtt[classId] || [],
    });
  });

  // 4. DPP (Daily Practice Problems)
  app.get('/api/dpp', (req, res) => {
    const subject = String(req.query.subject || 'all').toLowerCase();
    const list = getDpps().filter((d) => d.published);
    const filtered =
      subject !== 'all' ? list.filter((d) => d.subject.toLowerCase() === subject) : list;
    return res.json({ success: true, dpps: filtered });
  });

  app.get('/api/dpp/submissions', requireFirebaseUser, (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const all = readVaultJson<Record<string, any[]>>(DPP_SUBMISSIONS_KEY)?.data || {};
    return res.json({ success: true, submissions: all[user.uid] || [] });
  });

  app.post('/api/dpp/:dppId/submit', requireFirebaseUser, (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const dppId = String(req.params.dppId || '');
    const dpp = getDpps().find((d) => d.dppId === dppId);
    if (!dpp) {
      return res.status(404).json({ success: false, message: 'DPP sheet not found.' });
    }
    const answers = (req.body?.answers || {}) as Record<string, number>;
    const subjectiveAnswer = String(req.body?.subjectiveAnswer || '').trim().slice(0, 2000);
    const mcqs = dpp.questions.filter((q: any) => q.kind === 'mcq');
    let score = 0;
    for (const q of mcqs) {
      if (Number(answers[q.id]) === Number(q.correctIndex)) {
        score++;
      }
    }
    const total = Math.max(1, mcqs.length);
    const record = {
      dppId,
      userId: user.uid,
      score,
      total,
      subjectiveAnswer,
      submittedAt: Date.now(),
    };
    const all = readVaultJson<Record<string, any[]>>(DPP_SUBMISSIONS_KEY)?.data || {};
    const list = Array.isArray(all[user.uid]) ? all[user.uid].filter((s) => s.dppId !== dppId) : [];
    list.unshift(record);
    all[user.uid] = list;
    writeVaultJson(DPP_SUBMISSIONS_KEY, all);
    return res.json({ success: true, submission: record, questions: dpp.questions });
  });

  // 5. Online Test Series & Real Test Attempts (Percentile + All-India Rank)
  app.get('/api/platform/tests', (req, res) => {
    const seriesType = String(req.query.type || 'all').toLowerCase();
    const list = getTestSeries().filter((t) => t.published);
    const filtered =
      seriesType !== 'all' ? list.filter((t) => t.seriesType === seriesType) : list;
    return res.json({ success: true, tests: filtered });
  });

  app.post('/api/platform/tests/:testId/submit', requireFirebaseUser, (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const testId = String(req.params.testId || '');
    const test = getTestSeries().find((t) => t.testId === testId);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Test not found.' });
    }
    const selectedAnswers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    let correct = 0;
    let wrong = 0;
    test.questions.forEach((q: any, idx: number) => {
      const sel = selectedAnswers[idx];
      if (sel === null || sel === undefined) return;
      if (Number(sel) === Number(q.correctIndex)) correct++;
      else wrong++;
    });
    const score = correct * 4 - wrong;
    const maxScore = test.questions.length * 4;
    const attemptedCount = correct + wrong;
    const accuracyPercent = attemptedCount > 0 ? Math.round((correct / attemptedCount) * 100) : 0;

    const attempt = {
      attemptId: `att_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      testId,
      testTitle: test.title,
      seriesType: test.seriesType,
      subject: test.subject,
      userId: user.uid,
      studentName: user.name,
      score,
      maxScore,
      correct,
      wrong,
      accuracyPercent,
      createdAt: Date.now(),
    };

    const attempts = readVaultJson<any[]>(TEST_ATTEMPTS_KEY)?.data || [];
    attempts.unshift(attempt);
    writeVaultJson(TEST_ATTEMPTS_KEY, attempts.slice(0, 2000));

    // Calculate real percentile from actual recorded attempts for this test or overall
    const peerAttempts = attempts.filter((a) => a.testId === testId);
    const belowOrEqual = peerAttempts.filter((a) => a.score <= score).length;
    const percentile =
      peerAttempts.length > 0 ? Math.round((belowOrEqual / peerAttempts.length) * 1000) / 10 : 100;

    return res.json({ success: true, attempt, percentile, totalAttempts: peerAttempts.length });
  });

  app.get('/api/platform/tests/attempts', requireFirebaseUser, (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const attempts = readVaultJson<any[]>(TEST_ATTEMPTS_KEY)?.data || [];
    return res.json({
      success: true,
      attempts: attempts.filter((a) => a.userId === user.uid).slice(0, 50),
    });
  });

  app.get('/api/platform/air-rankings', (_req, res) => {
    const attempts = readVaultJson<any[]>(TEST_ATTEMPTS_KEY)?.data || [];
    // Aggregate real test scores per student across all recorded attempts
    const byUser = new Map<string, any>();
    for (const a of attempts) {
      const prev = byUser.get(a.userId) || {
        userId: a.userId,
        studentName: a.studentName,
        totalScore: 0,
        totalMaxScore: 0,
        testsTaken: 0,
        accuracySum: 0,
        lastAttemptAt: 0,
      };
      prev.totalScore += Number(a.score || 0);
      prev.totalMaxScore += Number(a.maxScore || 0);
      prev.testsTaken += 1;
      prev.accuracySum += Number(a.accuracyPercent || 0);
      prev.lastAttemptAt = Math.max(prev.lastAttemptAt, Number(a.createdAt || 0));
      byUser.set(a.userId, prev);
    }
    const list = Array.from(byUser.values())
      .map((u) => ({
        userId: u.userId,
        studentName: u.studentName,
        totalScore: u.totalScore,
        totalMaxScore: u.totalMaxScore,
        testsTaken: u.testsTaken,
        avgAccuracy: Math.round(u.accuracySum / Math.max(1, u.testsTaken)),
        lastAttemptAt: u.lastAttemptAt,
      }))
      .sort((a, b) => b.totalScore - a.totalScore || b.avgAccuracy - a.avgAccuracy);

    const total = list.length;
    const ranked = list.map((item, idx) => ({
      ...item,
      airRank: idx + 1,
      percentile: total > 0 ? Math.round(((total - idx) / total) * 1000) / 10 : 100,
    }));

    return res.json({ success: true, rankings: ranked, totalTestTakers: total });
  });

  // 6. Doubt Solving (Text + Image Upload + Teacher Replies)
  app.get('/api/doubts', requireFirebaseUser, (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const all = readVaultJson<any[]>(DOUBTS_KEY)?.data || [];
    const visible = isVerifiedAdmin(user) ? all : all.filter((d) => d.userId === user.uid);
    return res.json({ success: true, doubts: visible });
  });

  app.post('/api/doubts', requireFirebaseUser, (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const subject = String(req.body?.subject || 'General').trim().slice(0, 60);
    const questionText = String(req.body?.questionText || '').trim().slice(0, 2000);
    const imageUrl = String(req.body?.imageUrl || '').trim().slice(0, 120000); // allow compact uploaded image data URL or storage URL
    if (questionText.length < 3) {
      return res.status(400).json({ success: false, message: 'Please describe your doubt (at least 3 characters).' });
    }
    const ticket = {
      doubtId: `dbt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      userId: user.uid,
      studentName: user.name,
      subject,
      questionText,
      imageUrl: imageUrl || undefined,
      status: 'open',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const all = readVaultJson<any[]>(DOUBTS_KEY)?.data || [];
    all.unshift(ticket);
    writeVaultJson(DOUBTS_KEY, all.slice(0, 500));
    return res.json({ success: true, doubt: ticket });
  });

  app.post('/api/doubts/:doubtId/reply', requireAdminUser, (req, res) => {
    const admin = (req as any).firebaseUser as VerifiedFirebaseUser;
    const doubtId = String(req.params.doubtId || '');
    const replyText = String(req.body?.teacherReply || '').trim().slice(0, 4000);
    if (!replyText) {
      return res.status(400).json({ success: false, message: 'Teacher reply cannot be empty.' });
    }
    const all = readVaultJson<any[]>(DOUBTS_KEY)?.data || [];
    const target = all.find((d) => d.doubtId === doubtId);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Doubt ticket not found.' });
    }
    target.teacherReply = replyText;
    target.repliedBy = admin.name || 'Study Cloud Faculty';
    target.status = 'resolved';
    target.updatedAt = Date.now();
    writeVaultJson(DOUBTS_KEY, all);
    return res.json({ success: true, doubt: target });
  });

  // 7. PDF Bookmarks
  app.get('/api/bookmarks', requireFirebaseUser, (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const all = readVaultJson<Record<string, any[]>>(BOOKMARKS_KEY)?.data || {};
    return res.json({ success: true, bookmarks: all[user.uid] || [] });
  });

  app.post('/api/bookmarks', requireFirebaseUser, (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const pdfUrl = String(req.body?.pdfUrl || '').trim().slice(0, 1000);
    const pdfTitle = String(req.body?.pdfTitle || 'Study Notes').trim().slice(0, 200);
    const pageNumber = Math.max(1, Math.min(5000, Math.floor(Number(req.body?.pageNumber) || 1)));
    const note = String(req.body?.note || '').trim().slice(0, 300);
    if (!pdfUrl) {
      return res.status(400).json({ success: false, message: 'pdfUrl is required.' });
    }
    const item = {
      bookmarkId: `bm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      userId: user.uid,
      pdfUrl,
      pdfTitle,
      pageNumber,
      note,
      createdAt: Date.now(),
    };
    const all = readVaultJson<Record<string, any[]>>(BOOKMARKS_KEY)?.data || {};
    const list = Array.isArray(all[user.uid]) ? all[user.uid] : [];
    const dedup = list.filter((b) => !(b.pdfUrl === pdfUrl && b.pageNumber === pageNumber));
    dedup.unshift(item);
    all[user.uid] = dedup.slice(0, 200);
    writeVaultJson(BOOKMARKS_KEY, all);
    return res.json({ success: true, bookmark: item, bookmarks: all[user.uid] });
  });

  app.delete('/api/bookmarks/:bookmarkId', requireFirebaseUser, (req, res) => {
    const user = (req as any).firebaseUser as VerifiedFirebaseUser;
    const bookmarkId = String(req.params.bookmarkId || '');
    const all = readVaultJson<Record<string, any[]>>(BOOKMARKS_KEY)?.data || {};
    const list = Array.isArray(all[user.uid]) ? all[user.uid] : [];
    all[user.uid] = list.filter((b) => b.bookmarkId !== bookmarkId);
    writeVaultJson(BOOKMARKS_KEY, all);
    return res.json({ success: true, bookmarks: all[user.uid] });
  });

  // 8. Notifications Feed
  app.get('/api/notifications', (_req, res) => {
    return res.json({
      success: true,
      notifications: getNotifications().filter((n) => n.active),
    });
  });

  // 9. Admin CRUD Routes
  app.post('/api/platform/admin/courses', requireAdminUser, (req, res) => {
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 160);
    if (title.length < 2) {
      return res.status(400).json({ success: false, message: 'Course title is required.' });
    }
    const courseId = String(b.courseId || `sc_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`)
      .replace(/[^a-zA-Z0-9_-]/g, '');
    const price = Math.max(0, Number(b.price || 0));
    const courses = getCourses().filter((c) => c.courseId !== courseId);
    const created = {
      courseId,
      title,
      category: String(b.category || 'CBSE Boards').slice(0, 40),
      classLevel: String(b.classLevel || 'Class 10').slice(0, 24),
      price,
      currency: 'INR',
      isFree: price === 0,
      published: b.published !== false,
      syllabus: String(b.syllabus || '').slice(0, 4000),
      timetable: String(b.timetable || '').slice(0, 2000),
      facultyName: String(b.facultyName || 'Study Cloud Faculty').slice(0, 120),
      thumbnail: String(
        b.thumbnail ||
          'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/de06beef-a1fb-4056-9323-edd3cf10c518.png'
      ).slice(0, 512),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    courses.unshift(created);
    writeVaultJson(COURSES_KEY, courses);
    return res.json({ success: true, course: created });
  });

  app.delete('/api/platform/admin/courses/:courseId', requireAdminUser, (req, res) => {
    const courseId = String(req.params.courseId || '');
    const courses = getCourses().filter((c) => c.courseId !== courseId);
    writeVaultJson(COURSES_KEY, courses);
    return res.json({ success: true });
  });

  app.post('/api/platform/admin/live-classes', requireAdminUser, (req, res) => {
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 180);
    if (title.length < 2) {
      return res.status(400).json({ success: false, message: 'Live class title is required.' });
    }
    const classId = `live_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    const item = {
      classId,
      title,
      subject: String(b.subject || 'Physics').slice(0, 60),
      teacherName: String(b.teacherName || 'Study Cloud Faculty').slice(0, 100),
      streamUrl: String(b.streamUrl || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8').slice(0, 512),
      scheduledAt: String(b.scheduledAt || new Date().toISOString()).slice(0, 64),
      status: ['scheduled', 'live', 'ended'].includes(b.status) ? b.status : 'live',
      published: true,
      createdAt: Date.now(),
    };
    const list = getLiveClasses();
    list.unshift(item);
    writeVaultJson(LIVE_CLASSES_KEY, list);
    return res.json({ success: true, liveClass: item });
  });

  app.patch('/api/platform/admin/live-classes/:classId', requireAdminUser, (req, res) => {
    const classId = String(req.params.classId || '');
    const list = getLiveClasses();
    const target = list.find((c) => c.classId === classId);
    if (!target) return res.status(404).json({ success: false, message: 'Class not found.' });
    if (['scheduled', 'live', 'ended'].includes(req.body?.status)) {
      target.status = req.body.status;
      writeVaultJson(LIVE_CLASSES_KEY, list);
    }
    return res.json({ success: true, liveClass: target });
  });

  app.post('/api/platform/admin/notifications', requireAdminUser, (req, res) => {
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 160);
    const body = String(b.body || '').trim().slice(0, 800);
    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Title and message are required.' });
    }
    const notif = {
      notificationId: `notif_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      title,
      body,
      type: ['live', 'lecture', 'notes', 'test', 'course'].includes(b.type) ? b.type : 'course',
      active: true,
      createdAt: Date.now(),
    };
    const list = getNotifications();
    list.unshift(notif);
    writeVaultJson(NOTIFICATIONS_KEY, list.slice(0, 100));
    wsHub.broadcastNotification(notif);
    return res.json({ success: true, notification: notif });
  });

  app.post('/api/platform/admin/coupons', requireAdminUser, (req, res) => {
    const b = req.body || {};
    const code = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
    const discountPercent = Math.min(100, Math.max(1, Number(b.discountPercent || 10)));
    const maxDiscount = Math.max(0, Number(b.maxDiscount || 0));
    if (code.length < 2) {
      return res.status(400).json({ success: false, message: 'Coupon code must be at least 2 characters.' });
    }
    const list = getCoupons().filter((c) => c.code !== code);
    const coupon = { code, discountPercent, maxDiscount, active: true };
    list.unshift(coupon);
    writeVaultJson(COUPONS_KEY, list);
    return res.json({ success: true, coupon });
  });
}
