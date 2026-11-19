import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Sparkles,
  Play,
  Flag,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Loader2,
  AlertCircle,
  Trophy,
  BookOpen,
  Award,
  Eye,
  Download,
} from 'lucide-react';
import { BatchItem, OfficialBatchTest } from '../types';
import {
  buildPdfProxyUrl,
  downloadPdfFile,
  fetchPwBatchQuizzes,
  PwBatchQuizItem,
  startPwQuiz,
} from '../services/batchService';
import { recordStudyActivity } from '../services/adventureService';

interface TestQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  topic?: string;
}

interface PracticePack {
  id: string;
  title: string;
  subject: string;
  exam: string;
  durationMinutes: number;
  questions: TestQuestion[];
}

interface TestViewProps {
  myBatches?: BatchItem[];
  allBatches?: BatchItem[];
  onAskAi: (prompt: string) => void;
  onActivityUpdate?: () => void;
}

const BUILTIN_PACKS: PracticePack[] = [
  {
    id: 'phy-jee-1',
    title: 'Electrostatics & Mechanics Sprint',
    subject: 'Physics',
    exam: 'IIT-JEE',
    durationMinutes: 10,
    questions: [
      {
        topic: 'Electrostatics',
        question:
          'Two point charges +4q and +q are placed at a distance d apart. Where should a third charge be placed on the line joining them so that it experiences zero net electrostatic force?',
        options: [
          'At distance 2d/3 from +4q',
          'At distance d/3 from +4q',
          'At distance d/2 from +4q',
          'Outside the segment, closer to +4q',
        ],
        correctIndex: 0,
        explanation:
          'For zero net force, magnitudes must balance: k(4q)Q/x² = k(q)Q/(d - x)². Taking square roots: 2/x = 1/(d - x) => 2d - 2x = x => x = 2d/3 from +4q.',
      },
      {
        topic: 'Kinematics',
        question:
          'A projectile is thrown with speed u at angle θ to the horizontal. What is the radius of curvature of its trajectory at the highest point?',
        options: ['u² cos²θ / g', 'u² sin²θ / g', 'u² / g', 'u² cosθ / g'],
        correctIndex: 0,
        explanation:
          'At the highest point, velocity is horizontal: v = u cosθ, and normal acceleration is g. Thus radius of curvature R = v² / a_n = (u² cos²θ) / g.',
      },
      {
        topic: 'Work, Energy & Power',
        question:
          'A body of mass 2 kg moves under a force so that its position x = t³/3 (SI units). Find the work done by the force in the first 2 seconds.',
        options: ['16 J', '8 J', '32 J', '4 J'],
        correctIndex: 0,
        explanation:
          'v = dx/dt = t². At t = 0, v = 0; at t = 2 s, v = 4 m/s. By work-energy theorem, W = ΔK = ½ m v² = ½ (2)(16) = 16 J.',
      },
      {
        topic: 'Gauss Law',
        question:
          'A charge q is placed at the center of one face of a cube of side a. What is the electric flux passing through the entire cube?',
        options: ['q / (2ε₀)', 'q / (6ε₀)', 'q / ε₀', 'q / (4ε₀)'],
        correctIndex: 0,
        explanation:
          'By symmetry, placing an identical cube adjacent encloses charge q inside two cubes, giving total flux q/ε₀. Therefore flux through one cube is q/(2ε₀).',
      },
      {
        topic: 'Rotational Motion',
        question:
          'A solid sphere rolls without slipping down an inclined plane of angle 30°. What is its translational acceleration along the incline?',
        options: ['(5/14) g', '(1/2) g', '(2/7) g', '(5/7) g'],
        correctIndex: 0,
        explanation:
          'a = g sinθ / (1 + I/(mR²)). For a solid sphere, I/(mR²) = 2/5 and sin30° = 1/2. Hence a = (g/2) / (7/5) = (5/14) g.',
      },
    ],
  },
  {
    id: 'chem-neet-1',
    title: 'General Organic & Chemical Bonding',
    subject: 'Chemistry',
    exam: 'NEET / JEE',
    durationMinutes: 10,
    questions: [
      {
        topic: 'Chemical Bonding',
        question: 'Which of the following species has a linear shape and zero dipole moment?',
        options: ['XeF₂', 'SO₂', 'H₂O', 'ClF₃'],
        correctIndex: 0,
        explanation:
          'XeF₂ has sp³d hybridization with 3 equatorial lone pairs and 2 axial bond pairs, making it symmetric and linear with μ = 0.',
      },
      {
        topic: 'GOC',
        question: 'Among the following carbocations, which one is the most stable?',
        options: ['(C₆H₅)₃C⁺', '(CH₃)₃C⁺', 'CH₂=CH-CH₂⁺', 'CH₃CH₂⁺'],
        correctIndex: 0,
        explanation:
          'Triphenylmethyl carbocation (C₆H₅)₃C⁺ is stabilized by extensive resonance delocalization across all three phenyl rings.',
      },
      {
        topic: 'Thermodynamics',
        question: 'For an isothermal reversible expansion of an ideal gas, which statement holds true?',
        options: ['ΔU = 0 and q = -w', 'ΔU > 0 and w = 0', 'ΔH = q_v', 'ΔS_total < 0'],
        correctIndex: 0,
        explanation:
          'Internal energy U of an ideal gas depends only on temperature. For isothermal process ΔT = 0, so ΔU = 0 and by First Law q + w = 0 => q = -w.',
      },
      {
        topic: 'Electrochemistry',
        question:
          'The molar conductivity of a weak electrolyte increases sharply upon dilution primarily because:',
        options: [
          'Its degree of dissociation α increases significantly',
          'Ionic mobility decreases with dilution',
          'Interionic attractions become infinite',
          'Concentration of H⁺ ions remains constant',
        ],
        correctIndex: 0,
        explanation:
          'By Ostwald dilution law, decreasing concentration sharply increases degree of ionization α, producing more charge carriers per mole.',
      },
      {
        topic: 'Atomic Structure',
        question: 'How many radial nodes are present in a 4p orbital?',
        options: ['2', '3', '1', '0'],
        correctIndex: 0,
        explanation: 'Number of radial nodes = n - l - 1. For 4p: n = 4, l = 1 => 4 - 1 - 1 = 2.',
      },
    ],
  },
  {
    id: 'math-jee-1',
    title: 'Calculus & Quadratic Mastery',
    subject: 'Mathematics',
    exam: 'IIT-JEE',
    durationMinutes: 12,
    questions: [
      {
        topic: 'Limits',
        question: 'Evaluate lim (x -> 0) [ (1 - cos 2x) / x² ].',
        options: ['2', '1', '4', '0'],
        correctIndex: 0,
        explanation: '1 - cos 2x = 2 sin²x. So lim (2 sin²x / x²) = 2 · (1)² = 2.',
      },
      {
        topic: 'Definite Integration',
        question: 'What is the value of ∫ from -π/2 to π/2 of (x³ + sin x) dx?',
        options: ['0', '2', 'π', '-2'],
        correctIndex: 0,
        explanation:
          'Both x³ and sin x are odd functions: f(-x) = -f(x). Integrating an odd function over symmetric limits [-a, a] yields 0.',
      },
      {
        topic: 'Quadratic Equations',
        question:
          'If α and β are roots of x² - 5x + 6 = 0, what is the value of α² + β²?',
        options: ['13', '25', '19', '11'],
        correctIndex: 0,
        explanation: 'α + β = 5 and αβ = 6. Then α² + β² = (α + β)² - 2αβ = 25 - 12 = 13.',
      },
      {
        topic: 'Matrices & Determinants',
        question: 'If A is a 3×3 matrix with |A| = 4, what is the value of |2A|?',
        options: ['32', '8', '16', '64'],
        correctIndex: 0,
        explanation: 'For an n×n matrix, |kA| = kⁿ |A|. Here n = 3, k = 2: |2A| = 2³ × 4 = 32.',
      },
    ],
  },
  {
    id: 'bio-neet-1',
    title: 'NCERT Cell Biology & Genetics',
    subject: 'Biology',
    exam: 'NEET',
    durationMinutes: 8,
    questions: [
      {
        topic: 'Cell Cycle',
        question: 'During which phase of the cell cycle does DNA replication take place in eukaryotes?',
        options: ['S phase', 'G₁ phase', 'G₂ phase', 'M phase'],
        correctIndex: 0,
        explanation:
          'DNA synthesis (replication) occurs exclusively during the Synthesis (S) phase of interphase, doubling DNA content from 2C to 4C.',
      },
      {
        topic: 'Molecular Basis of Inheritance',
        question: 'Which enzyme catalyzes the synthesis of RNA primer during DNA replication?',
        options: ['RNA primase', 'DNA polymerase III', 'DNA ligase', 'Topoisomerase'],
        correctIndex: 0,
        explanation:
          'DNA polymerases cannot initiate strand synthesis de novo; RNA primase synthesizes a short complementary RNA primer with a free 3\'-OH.',
      },
      {
        topic: 'Human Physiology',
        question: 'Which chamber of the human heart pumps oxygenated blood into the systemic aorta?',
        options: ['Left ventricle', 'Right ventricle', 'Left atrium', 'Right atrium'],
        correctIndex: 0,
        explanation:
          'Oxygenated blood enters the left atrium from pulmonary veins, flows into the thick-walled left ventricle, and is pumped into the aorta.',
      },
      {
        topic: 'Plant Physiology',
        question: 'Which plant hormone is primarily responsible for apical dominance?',
        options: ['Auxin', 'Gibberellin', 'Cytokinin', 'Ethylene'],
        correctIndex: 0,
        explanation:
          'Auxin produced at the shoot apex inhibits lateral bud outgrowth, maintaining apical dominance; cytokinins act antagonistically.',
      },
    ],
  },
];

const DEFAULT_PW_TEST_BATCHES: Array<{ batch_id: string; name: string }> = [
  { batch_id: '65dc6fbabb55350018d555b7', name: 'Lakshya JEE (Class 12)' },
  { batch_id: '676e4dee1ec923bc192f38c9', name: 'Arjuna JEE (Class 11)' },
  { batch_id: '65d75d320531c20018ade9bb', name: 'Lakshya NEET (Class 12)' },
  { batch_id: '676e5677418e84037bd6247c', name: 'Arjuna NEET (Class 11)' },
];

export const TestView: React.FC<TestViewProps> = ({
  myBatches = [],
  allBatches = [],
  onAskAi,
  onActivityUpdate,
}) => {
  // Custom AI test generator state
  const [aiSubject, setAiSubject] = useState('Physics');
  const [aiExam, setAiExam] = useState('IIT-JEE');
  const [aiTopic, setAiTopic] = useState('Current Electricity & Kirchhoff Laws');
  const [aiCount, setAiCount] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // PW Test Proxy Browser State
  const pwBatchOptions = useMemo(() => {
    const merged = [
      ...myBatches.map((b) => ({ batch_id: b.batch_id, name: b.name })),
      ...DEFAULT_PW_TEST_BATCHES,
      ...allBatches.slice(0, 10).map((b) => ({ batch_id: b.batch_id, name: b.name })),
    ];
    const seen = new Set<string>();
    return merged.filter((b) => {
      if (!b.batch_id || seen.has(b.batch_id)) return false;
      seen.add(b.batch_id);
      return true;
    });
  }, [myBatches, allBatches]);

  const [selectedPwBatchId, setSelectedPwBatchId] = useState<string>(
    () => myBatches[0]?.batch_id || DEFAULT_PW_TEST_BATCHES[0].batch_id
  );
  const [pwSubjects, setPwSubjects] = useState<Array<{ _id: string; subject: string; slug: string }>>([]);
  const [selectedPwSubjectSlug, setSelectedPwSubjectSlug] = useState<string>('');
  const [pwTopics, setPwTopics] = useState<Array<{ _id: string; name: string; exercises: number }>>([]);
  const [selectedPwTopicId, setSelectedPwTopicId] = useState<string>('');
  const [pwQuizzes, setPwQuizzes] = useState<PwBatchQuizItem[]>([]);
  const [officialTests, setOfficialTests] = useState<OfficialBatchTest[]>([]);
  const [pwTestSubTab, setPwTestSubTab] = useState<'official' | 'quizzes'>('official');
  const [loadingPwQuizzes, setLoadingPwQuizzes] = useState(false);
  const [pwQuizError, setPwQuizError] = useState<string | null>(null);
  const [launchingQuizId, setLaunchingQuizId] = useState<string | null>(null);

  // Active Test State
  const [activePack, setActivePack] = useState<PracticePack | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [marked, setMarked] = useState<Record<number, boolean>>({});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  // Saved Score History
  const [pastAttempts, setPastAttempts] = useState<
    Array<{ title: string; score: number; maxScore: number; accuracy: number; date: number }>
  >(() => {
    try {
      const raw = localStorage.getItem('studycloud_test_attempts_v1');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (!activePack || submitted) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activePack, submitted]);

  useEffect(() => {
    if (activePack && !submitted && secondsLeft === 0) {
      handleSubmitTest();
    }
  }, [activePack, submitted, secondsLeft]);

  const startPack = (pack: PracticePack) => {
    setActivePack(pack);
    setCurrentIdx(0);
    setAnswers({});
    setMarked({});
    setSecondsLeft(Math.max(1, pack.durationMinutes * 60));
    setSubmitted(false);
  };

  useEffect(() => {
    if (!selectedPwBatchId) return;
    let cancelled = false;
    setLoadingPwQuizzes(true);
    setPwQuizError(null);
    fetchPwBatchQuizzes(selectedPwBatchId, selectedPwSubjectSlug || undefined, selectedPwTopicId || undefined)
      .then((res) => {
        if (cancelled) return;
        setPwSubjects(res.subjects || []);
        if (!selectedPwSubjectSlug && res.activeSubjectSlug) {
          setSelectedPwSubjectSlug(res.activeSubjectSlug);
        }
        setPwTopics(res.topics || []);
        setPwQuizzes(res.quizzes || []);
        setOfficialTests(res.officialTests || []);
      })
      .catch((err: any) => {
        if (!cancelled) setPwQuizError(err?.message || 'Unable to load PW Batch tests');
      })
      .finally(() => {
        if (!cancelled) setLoadingPwQuizzes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPwBatchId, selectedPwSubjectSlug, selectedPwTopicId]);

  const handleLaunchPwQuiz = async (quiz: PwBatchQuizItem) => {
    if (launchingQuizId) return;
    setLaunchingQuizId(quiz.id);
    setPwQuizError(null);
    try {
      const res = await startPwQuiz({
        exerciseId: quiz.exerciseId,
        batchName: quiz.batchName,
        subjectName: quiz.subjectName,
        topicName: quiz.topicName,
        title: quiz.title,
        count: Math.min(10, Math.max(5, quiz.totalQuestions || 8)),
      });
      startPack({
        id: `pw-${quiz.id}-${Date.now()}`,
        title: quiz.title,
        subject: quiz.subjectName,
        exam: quiz.batchName,
        durationMinutes: Math.max(8, (res.questions.length || 8) * 2),
        questions: res.questions,
      });
    } catch (err: any) {
      setPwQuizError(err?.message || 'Failed to launch PW Quiz.');
    } finally {
      setLaunchingQuizId(null);
    }
  };

  const handleLaunchOfficialTest = async (test: OfficialBatchTest) => {
    if (launchingQuizId) return;
    setLaunchingQuizId(test.id);
    setPwQuizError(null);
    try {
      const res = await startPwQuiz({
        exerciseId: test.exerciseId || undefined,
        batchName: test.batchName,
        subjectName: test.subjectName,
        topicName: test.syllabus || test.title,
        title: test.title,
        count: Math.min(12, Math.max(8, test.totalQuestions || 10)),
      });
      startPack({
        id: `official-${test.id}-${Date.now()}`,
        title: test.title,
        subject: test.subjectName,
        exam: test.batchName,
        durationMinutes: Math.max(15, test.maxDuration || res.questions.length * 2),
        questions: res.questions,
      });
    } catch (err: any) {
      setPwQuizError(err?.message || 'Failed to start Official Test.');
    } finally {
      setLaunchingQuizId(null);
    }
  };

  const handleGenerateAiTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiTopic.trim() || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch('/api/ai/generate-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: aiSubject,
          exam: aiExam,
          topic: aiTopic.trim(),
          count: aiCount,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success || !Array.isArray(json.questions)) {
        throw new Error(json.message || 'Could not generate practice test.');
      }
      startPack({
        id: `ai-${Date.now()}`,
        title: `${aiSubject}: ${aiTopic.trim()}`,
        subject: aiSubject,
        exam: aiExam,
        durationMinutes: Math.max(5, aiCount * 2),
        questions: json.questions,
      });
    } catch (err: any) {
      setGenerateError(err?.message || 'Unable to generate custom test right now.');
    } finally {
      setGenerating(false);
    }
  };

  const summary = useMemo(() => {
    if (!activePack) return null;
    let correct = 0;
    let incorrect = 0;
    let skipped = 0;
    activePack.questions.forEach((q, idx) => {
      const chosen = answers[idx];
      if (chosen === undefined) skipped++;
      else if (chosen === q.correctIndex) correct++;
      else incorrect++;
    });
    const score = correct * 4 - incorrect;
    const maxScore = activePack.questions.length * 4;
    const attempted = correct + incorrect;
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    return { correct, incorrect, skipped, score, maxScore, accuracy };
  }, [activePack, answers]);

  const handleSubmitTest = () => {
    if (!activePack || submitted) return;
    setSubmitted(true);
    recordStudyActivity();
    onActivityUpdate?.();

    let correct = 0;
    let incorrect = 0;
    activePack.questions.forEach((q, idx) => {
      const chosen = answers[idx];
      if (chosen === undefined) return;
      if (chosen === q.correctIndex) correct++;
      else incorrect++;
    });
    const score = correct * 4 - incorrect;
    const maxScore = activePack.questions.length * 4;
    const attempted = correct + incorrect;
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;

    setPastAttempts((prev) => {
      const next = [
        { title: activePack.title, score, maxScore, accuracy, date: Date.now() },
        ...prev.slice(0, 9),
      ];
      try {
        localStorage.setItem('studycloud_test_attempts_v1', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const formatClock = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // RENDER: Results Review Screen
  if (activePack && submitted && summary) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
          <div>
            <div className="text-[11px] font-bold text-[var(--primary-color)]">
              {activePack.exam} · {activePack.subject} · NTA Marking (+4 / -1)
            </div>
            <h2 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)] mt-0.5">
              {activePack.title} — Result Analysis
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => startPack(activePack)}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3.5 py-1.5 text-xs font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Retake</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePack(null)}
              className="rounded-xl bg-[var(--primary-color)] px-3.5 py-1.5 text-xs font-bold text-white hover:opacity-90 transition"
            >
              All Tests
            </button>
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Score', value: `${summary.score} / ${summary.maxScore}`, accent: 'text-[var(--primary-color)]' },
            { label: 'Accuracy', value: `${summary.accuracy}%`, accent: 'text-emerald-400' },
            { label: 'Correct', value: `${summary.correct}`, accent: 'text-emerald-400' },
            { label: 'Incorrect / Skipped', value: `${summary.incorrect} / ${summary.skipped}`, accent: 'text-amber-400' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3.5"
            >
              <div className="text-[11px] text-[var(--text-secondary)]">{stat.label}</div>
              <div className={`mt-0.5 font-mono tabular-nums text-lg sm:text-xl font-extrabold ${stat.accent}`}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Detailed Question Review */}
        <div className="space-y-3">
          {activePack.questions.map((q, idx) => {
            const chosen = answers[idx];
            const isCorrect = chosen === q.correctIndex;
            const isSkipped = chosen === undefined;
            return (
              <div
                key={idx}
                className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-bold text-[var(--text-secondary)]">
                    Q{idx + 1} {q.topic ? `· ${q.topic}` : ''}
                  </span>
                  <span
                    className={`flex items-center gap-1 font-bold ${
                      isSkipped ? 'text-slate-400' : isCorrect ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {isSkipped ? (
                      'Skipped (0)'
                    ) : isCorrect ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Correct (+4)</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Incorrect (-1)</span>
                      </>
                    )}
                  </span>
                </div>

                <p className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] leading-relaxed">
                  {q.question}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {q.options.map((opt, oIdx) => {
                    const isAnswerKey = oIdx === q.correctIndex;
                    const isUserPick = chosen === oIdx;
                    return (
                      <div
                        key={oIdx}
                        className={`rounded-xl border px-3 py-2 text-xs ${
                          isAnswerKey
                            ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300 font-semibold'
                            : isUserPick
                            ? 'border-red-500/60 bg-red-500/10 text-red-300'
                            : 'border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                        }`}
                      >
                        <span className="font-mono font-bold mr-1.5">
                          {String.fromCharCode(65 + oIdx)}.
                        </span>
                        {opt}
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-xl bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)] leading-relaxed">
                  <strong className="text-[var(--text-primary)]">Solution: </strong>
                  {q.explanation}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      onAskAi(
                        `Explain this ${activePack.subject} question step-by-step:\n${q.question}\nOptions: ${q.options.join(' | ')}`
                      )
                    }
                    className="flex items-center gap-1 text-xs font-bold text-[var(--primary-color)] hover:underline"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Ask Study AI for Deeper Explanation</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // RENDER: Active CBT Exam Screen
  if (activePack && !submitted) {
    const q = activePack.questions[currentIdx];
    const selectedOpt = answers[currentIdx];

    return (
      <div className="space-y-4">
        {/* Compact Test Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs text-[var(--text-secondary)]">
              {activePack.exam} · {activePack.subject} · +4 / -1 Marking
            </div>
            <h2 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)] truncate">
              {activePack.title}
            </h2>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-1.5 font-mono tabular-nums text-sm sm:text-base font-extrabold text-amber-400">
              <Clock className="h-4 w-4" />
              <span>{formatClock(secondsLeft)}</span>
            </div>
            <button
              type="button"
              onClick={handleSubmitTest}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-emerald-500 transition"
            >
              Submit Test
            </button>
          </div>
        </div>

        {/* 2-Column CBT Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Question Stage */}
          <div className="lg:col-span-8 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--card-border)] pb-2.5 text-xs sm:text-sm">
              <span className="font-mono font-bold text-[var(--primary-color)]">
                Question {currentIdx + 1} of {activePack.questions.length}
              </span>
              {q.topic && (
                <span className="text-[var(--text-secondary)]">{q.topic}</span>
              )}
            </div>

            <p className="text-sm sm:text-base font-semibold text-[var(--text-primary)] leading-relaxed">
              {q.question}
            </p>

            <div className="space-y-2">
              {q.options.map((opt, idx) => {
                const active = selectedOpt === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setAnswers((prev) => ({ ...prev, [currentIdx]: idx }))}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 sm:p-3.5 text-left text-xs sm:text-sm transition ${
                      active
                        ? 'border-[var(--primary-color)] bg-[var(--primary-color)]/15 text-[var(--text-primary)] font-semibold'
                        : 'border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:border-[var(--primary-color)]/50'
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold ${
                        active
                          ? 'bg-[var(--primary-color)] text-white'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className="flex-1">{opt}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[var(--card-border)] pt-3.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setAnswers((prev) => {
                      const next = { ...prev };
                      delete next[currentIdx];
                      return next;
                    })
                  }
                  className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Clear Response
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setMarked((prev) => ({ ...prev, [currentIdx]: !prev[currentIdx] }))
                  }
                  className={`flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                    marked[currentIdx]
                      ? 'border-amber-500 bg-amber-500/15 text-amber-400'
                      : 'border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                  }`}
                >
                  <Flag className="h-3.5 w-3.5" />
                  <span>{marked[currentIdx] ? 'Marked' : 'Mark Review'}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentIdx === 0}
                  onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                  className="flex items-center gap-1 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs sm:text-sm font-bold text-[var(--text-primary)] disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span>Prev</span>
                </button>
                <button
                  type="button"
                  disabled={currentIdx === activePack.questions.length - 1}
                  onClick={() =>
                    setCurrentIdx((i) => Math.min(activePack.questions.length - 1, i + 1))
                  }
                  className="flex items-center gap-1 rounded-xl bg-[var(--primary-color)] px-3.5 py-1.5 text-xs sm:text-sm font-bold text-white disabled:opacity-40"
                >
                  <span>Next</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Compact Question Palette */}
          <div className="lg:col-span-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5 space-y-3.5">
            <h3 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)]">
              Question Palette
            </h3>
            <div className="grid grid-cols-5 gap-2">
              {activePack.questions.map((_, idx) => {
                const isAns = answers[idx] !== undefined;
                const isMarked = Boolean(marked[idx]);
                const isCurrent = idx === currentIdx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setCurrentIdx(idx)}
                    className={`h-9 rounded-lg font-mono tabular-nums text-xs font-bold transition border ${
                      isCurrent
                        ? 'ring-2 ring-[var(--primary-color)] border-[var(--primary-color)]'
                        : 'border-[var(--card-border)]'
                    } ${
                      isMarked
                        ? 'bg-amber-500/20 text-amber-300'
                        : isAns
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2.5 text-xs text-[var(--text-secondary)] border-t border-[var(--card-border)] pt-3">
              <span>Answered: {Object.keys(answers).length}</span>
              <span aria-hidden="true">·</span>
              <span>Marked: {Object.values(marked).filter(Boolean).length}</span>
              <span aria-hidden="true">·</span>
              <span>Left: {activePack.questions.length - Object.keys(answers).length}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // RENDER: Test Series Catalog + PW Test Proxy + Custom AI Test Builder
  return (
    <div className="space-y-5">
      {/* Compact Header Banner */}
      <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[var(--primary-color)]">
              <ClipboardCheck className="h-4 w-4" />
              <span>Study Cloud · PW Test Proxy & CBT Simulator</span>
            </div>
            <h1 className="font-['Sora'] text-xl sm:text-2xl font-extrabold text-[var(--text-primary)]">
              PW Batch Quizzes, Tests & Mock Exams
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-2xl leading-relaxed">
              Browse live PW batch DPP quizzes via proxy, attempt timed JEE/NEET/Board CBT tests
              with +4/-1 NTA scoring, or generate a custom chapter mock test.
            </p>
          </div>
        </div>
      </div>

      {/* PW Live Batch Quizzes & Test Proxy Browser */}
      <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)] flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-amber-400" />
              <span>PW Batch DPP Quizzes & Live Tests (Proxy)</span>
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Select any batch, subject, and chapter to fetch live PW quiz sets and launch in CBT mode.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPwTestSubTab('official')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
              pwTestSubTab === 'official'
                ? 'bg-[var(--primary-color)] text-white shadow-sm'
                : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
            }`}
          >
            <Award className="h-3.5 w-3.5" />
            <span>Official Batch Tests ({officialTests.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setPwTestSubTab('quizzes')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
              pwTestSubTab === 'quizzes'
                ? 'bg-[var(--primary-color)] text-white shadow-sm'
                : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
            }`}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            <span>DPP &amp; DHA Quizzes ({pwQuizzes.length})</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <select
            value={selectedPwBatchId}
            onChange={(e) => {
              setSelectedPwBatchId(e.target.value);
              setSelectedPwSubjectSlug('');
              setSelectedPwTopicId('');
            }}
            className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs sm:text-sm font-semibold text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
          >
            {pwBatchOptions.map((b) => (
              <option key={b.batch_id} value={b.batch_id}>
                Batch: {b.name}
              </option>
            ))}
          </select>

          <select
            value={selectedPwSubjectSlug}
            onChange={(e) => {
              setSelectedPwSubjectSlug(e.target.value);
              setSelectedPwTopicId('');
            }}
            className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs sm:text-sm font-semibold text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
          >
            {pwSubjects.length === 0 ? (
              <option value="">Loading subjects...</option>
            ) : (
              pwSubjects.map((s) => (
                <option key={s._id} value={s.slug}>
                  Subject: {s.subject}
                </option>
              ))
            )}
          </select>

          <select
            value={selectedPwTopicId}
            onChange={(e) => setSelectedPwTopicId(e.target.value)}
            className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs sm:text-sm font-semibold text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
          >
            <option value="">All Chapters with Quizzes</option>
            {pwTopics
              .filter((t) => t.exercises > 0)
              .map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name} ({t.exercises} quizzes)
                </option>
              ))}
          </select>
        </div>

        {pwQuizError && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs sm:text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{pwQuizError}</span>
          </div>
        )}

        {loadingPwQuizzes ? (
          <div className="flex items-center justify-center py-8 gap-2.5 text-xs sm:text-sm text-[var(--text-secondary)]">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--primary-color)]" />
            <span>Loading official PW batch tests &amp; quizzes...</span>
          </div>
        ) : pwTestSubTab === 'official' ? (
          officialTests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--card-border)] p-6 text-center text-xs sm:text-sm text-[var(--text-secondary)]">
              No official tests found for this batch yet. Switch to DPP &amp; DHA Quizzes or another batch above.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {officialTests.map((t) => {
                const isLaunching = launchingQuizId === t.id;
                return (
                  <div
                    key={t.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3.5 sm:p-4 hover:border-[var(--primary-color)]/60 transition"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-bold">
                        <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-400">
                          {t.category}
                        </span>
                        <span className="font-mono text-[var(--text-secondary)]">
                          {t.totalQuestions} Qs · {t.totalMarks}M
                        </span>
                      </div>
                      <h3 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)] leading-snug line-clamp-2">
                        {t.title}
                      </h3>
                      <p className="text-xs font-semibold text-[var(--primary-color)] truncate">
                        {t.subjectName}
                      </p>
                      {t.syllabus && (
                        <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
                          {t.syllabus}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--card-border)] pt-2.5">
                      {t.pdfUrl ? (
                        <div className="flex items-center gap-1.5">
                          <a
                            href={buildPdfProxyUrl(t.pdfUrl, t.pdfName || 'Test Syllabus.pdf', false)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-primary)]"
                          >
                            <Eye className="h-3.5 w-3.5 text-indigo-400" />
                            <span>Syllabus</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => downloadPdfFile(t.pdfUrl!, t.pdfName || 'Test Syllabus.pdf')}
                            className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-1 text-[var(--text-primary)]"
                            title="Download Syllabus"
                          >
                            <Download className="h-3.5 w-3.5 text-pink-400" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-[var(--text-secondary)] truncate">
                          {t.maxDuration} min · +4/-1
                        </span>
                      )}

                      <button
                        type="button"
                        disabled={Boolean(launchingQuizId)}
                        onClick={() => handleLaunchOfficialTest(t)}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary-color)] px-3.5 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60 transition whitespace-nowrap"
                      >
                        {isLaunching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-white" />}
                        <span>{isLaunching ? 'Starting...' : 'Attempt Official'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : pwQuizzes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--card-border)] p-6 text-center text-xs sm:text-sm text-[var(--text-secondary)]">
            No DPP / DHA quiz sets found in this subject yet. Try selecting another subject or Official Batch Tests above.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {pwQuizzes.slice(0, 12).map((quiz) => {
              const isLaunching = launchingQuizId === quiz.id;
              return (
                <div
                  key={quiz.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-3.5 sm:p-4 hover:border-[var(--primary-color)]/60 transition"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <span className="font-bold text-[var(--primary-color)]">{quiz.subjectName}</span>
                      {quiz.isDha && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                          DHA
                        </span>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{quiz.totalQuestions} Qs</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{quiz.totalMarks} Marks</span>
                    </div>
                    <h3 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)] leading-snug">
                      {quiz.title}
                    </h3>
                    {quiz.topicName && (
                      <p className="text-xs text-[var(--text-secondary)] truncate">
                        Chapter: {quiz.topicName}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-[var(--card-border)] pt-2.5">
                    <span className="text-[11px] text-[var(--text-secondary)] truncate pr-2">
                      {quiz.batchName}
                    </span>
                    <button
                      type="button"
                      disabled={Boolean(launchingQuizId)}
                      onClick={() => handleLaunchPwQuiz(quiz)}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary-color)] px-3.5 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60 transition whitespace-nowrap"
                    >
                      {isLaunching ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5 fill-white" />
                      )}
                      <span>{isLaunching ? 'Loading CBT...' : 'Attempt Quiz'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Custom AI Mock Test Generator */}
      <form
        onSubmit={handleGenerateAiTest}
        className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5 space-y-4"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[var(--primary-color)]" />
          <h2 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)]">
            Generate Custom Chapter Mock Test
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <select
            value={aiExam}
            onChange={(e) => setAiExam(e.target.value)}
            className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs sm:text-sm font-semibold text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
          >
            <option value="IIT-JEE">Exam: IIT-JEE</option>
            <option value="NEET">Exam: NEET</option>
            <option value="Class 12 Boards">Exam: Class 12 Boards</option>
            <option value="Class 10 Foundation">Exam: Class 10 Foundation</option>
          </select>

          <select
            value={aiSubject}
            onChange={(e) => setAiSubject(e.target.value)}
            className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs sm:text-sm font-semibold text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
          >
            <option value="Physics">Physics</option>
            <option value="Chemistry">Chemistry</option>
            <option value="Mathematics">Mathematics</option>
            <option value="Biology">Biology</option>
          </select>

          <input
            type="text"
            value={aiTopic}
            onChange={(e) => setAiTopic(e.target.value)}
            placeholder="Chapter / Topic (e.g. Ray Optics)"
            className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs sm:text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:outline-none"
          />

          <div className="flex gap-2">
            <select
              value={aiCount}
              onChange={(e) => setAiCount(Number(e.target.value))}
              className="w-24 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2.5 py-2 font-mono text-xs sm:text-sm font-semibold text-[var(--text-primary)] focus:outline-none"
            >
              <option value={5}>5 Qs</option>
              <option value={8}>8 Qs</option>
              <option value={10}>10 Qs</option>
            </select>

            <button
              type="submit"
              disabled={generating || !aiTopic.trim()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs sm:text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition whitespace-nowrap"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              <span>{generating ? 'Building...' : 'Start AI Test'}</span>
            </button>
          </div>
        </div>

        {generateError && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs sm:text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{generateError}</span>
          </div>
        )}
      </form>

      {/* Instant Ready Practice Series */}
      <div className="space-y-3">
        <h2 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)]">
          Ready-to-Attempt Practice Sets
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {BUILTIN_PACKS.map((pack) => (
            <div
              key={pack.id}
              className="flex flex-col justify-between gap-3.5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 transition hover:border-[var(--primary-color)]/60"
            >
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                  <span className="font-bold text-[var(--primary-color)]">{pack.exam}</span>
                  <span aria-hidden="true">·</span>
                  <span>{pack.subject}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{pack.questions.length} Qs</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{pack.durationMinutes}m</span>
                </div>
                <h3 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)] leading-snug">
                  {pack.title}
                </h3>
              </div>

              <div className="flex items-center justify-between border-t border-[var(--card-border)] pt-3">
                <span className="text-[11px] text-[var(--text-secondary)]">+4 / -1 NTA</span>
                <button
                  type="button"
                  onClick={() => startPack(pack)}
                  className="flex items-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-3.5 py-1.5 text-xs font-bold text-white hover:opacity-90 transition"
                >
                  <Play className="h-3.5 w-3.5 fill-white" />
                  <span>Start Test</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Test Attempts */}
      {pastAttempts.length > 0 && (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5 space-y-3">
          <h3 className="font-['Sora'] text-base font-extrabold text-[var(--text-primary)] flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" />
            <span>Recent Test Scorecards</span>
          </h3>
          <div className="space-y-2">
            {pastAttempts.map((att, idx) => (
              <div
                key={`${att.date}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-2.5 text-xs sm:text-sm"
              >
                <div>
                  <div className="font-bold text-[var(--text-primary)]">{att.title}</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {new Date(att.date).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-3 font-mono tabular-nums font-bold">
                  <span className="text-emerald-400">{att.accuracy}% acc</span>
                  <span className="text-[var(--primary-color)]">
                    {att.score}/{att.maxScore}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
