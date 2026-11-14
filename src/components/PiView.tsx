import React, { useEffect, useMemo, useState } from 'react';
import {
  Sigma,
  Timer,
  Play,
  Pause,
  RotateCcw,
  Calculator,
  Atom,
  Sparkles,
  ArrowRightLeft,
  Delete,
  CheckCircle2,
  Send,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { recordStudyActivity } from '../services/adventureService';
import { askPwPi } from '../services/batchService';

interface PiViewProps {
  onAskAi: (prompt?: string) => void;
  onActivityUpdate?: () => void;
}

const CONSTANTS = [
  { symbol: 'π', name: 'Pi', value: '3.14159265', insert: 'pi' },
  { symbol: 'e', name: "Euler's e", value: '2.7182818', insert: 'e' },
  { symbol: 'g', name: 'Gravity (m/s²)', value: '9.81', insert: '9.81' },
  { symbol: 'c', name: 'Speed of Light', value: '3e8 m/s', insert: '3e8' },
  { symbol: 'h', name: "Planck's h", value: '6.626e-34 J·s', insert: '6.626e-34' },
  { symbol: 'R', name: 'Gas Constant', value: '8.314 J/mol·K', insert: '8.314' },
  { symbol: 'Nₐ', name: 'Avogadro', value: '6.022e23', insert: '6.022e23' },
  { symbol: 'k', name: 'Coulomb k', value: '8.988e9', insert: '8.988e9' },
];

function evaluateMathExpression(expr: string, useDegrees: boolean): string {
  const cleaned = expr.trim();
  if (!cleaned) return '';
  if (/[^0-9a-zA-Z+\-*/%^().,\s]/.test(cleaned)) {
    return 'Invalid syntax';
  }

  try {
    const toRad = (x: number) => (useDegrees ? (x * Math.PI) / 180 : x);
    const scope = {
      pi: Math.PI,
      PI: Math.PI,
      e: Math.E,
      E: Math.E,
      sqrt: Math.sqrt,
      abs: Math.abs,
      log: Math.log10,
      ln: Math.log,
      pow: Math.pow,
      sin: (x: number) => Math.sin(toRad(x)),
      cos: (x: number) => Math.cos(toRad(x)),
      tan: (x: number) => Math.tan(toRad(x)),
    };

    const normalized = cleaned.replace(/\^/g, '**');
    const fn = new Function(...Object.keys(scope), `"use strict"; return (${normalized});`);
    const result = fn(...Object.values(scope));
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return 'Undefined';
    }
    if (Math.abs(result) !== 0 && (Math.abs(result) < 1e-4 || Math.abs(result) >= 1e9)) {
      return result.toExponential(5);
    }
    return Number(result.toPrecision(10)).toString();
  } catch {
    return 'Error';
  }
}

export const PiView: React.FC<PiViewProps> = ({ onAskAi, onActivityUpdate }) => {
  // 0. PW Pi Proxy Interactive Solver
  const [piSubject, setPiSubject] = useState('Physics');
  const [piMode, setPiMode] = useState<'solve' | 'concept' | 'trick' | 'formula'>('solve');
  const [piQuery, setPiQuery] = useState('');
  const [piAnswer, setPiAnswer] = useState('');
  const [piLoading, setPiLoading] = useState(false);
  const [piError, setPiError] = useState<string | null>(null);

  const handleAskPwPi = async (e?: React.FormEvent, overridePrompt?: string) => {
    e?.preventDefault();
    const targetQuery = (overridePrompt ?? piQuery).trim();
    if (!targetQuery || piLoading) return;
    if (overridePrompt) setPiQuery(overridePrompt);
    setPiLoading(true);
    setPiError(null);
    try {
      const res = await askPwPi({
        query: targetQuery,
        subject: piSubject,
        mode: piMode,
      });
      setPiAnswer(res.answer);
      recordStudyActivity();
      onActivityUpdate?.();
    } catch (err: any) {
      setPiError(err?.message || 'PW Pi proxy could not process your query.');
    } finally {
      setPiLoading(false);
    }
  };

  // 1. Scientific Calculator
  const [expr, setExpr] = useState('sqrt(2 * 9.81 * 20)');
  const [useDegrees, setUseDegrees] = useState(true);
  const [calcHistory, setCalcHistory] = useState<Array<{ expr: string; result: string }>>([]);

  const liveResult = useMemo(() => evaluateMathExpression(expr, useDegrees), [expr, useDegrees]);

  const handleSaveCalculation = () => {
    if (!expr.trim() || liveResult === 'Error' || liveResult === 'Invalid syntax') return;
    setCalcHistory((prev) => [{ expr: expr.trim(), result: liveResult }, ...prev.slice(0, 7)]);
  };

  // 2. Focus Pomodoro Timer
  const [presetMinutes, setPresetMinutes] = useState(25);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionsCompleted, setSessionsCompleted] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('studycloud_pi_focus_sessions') || '0') || 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          setSessionsCompleted((s) => {
            const next = s + 1;
            try {
              localStorage.setItem('studycloud_pi_focus_sessions', String(next));
            } catch {
              // ignore
            }
            return next;
          });
          recordStudyActivity();
          onActivityUpdate?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRunning, onActivityUpdate]);

  const selectPreset = (mins: number) => {
    setIsRunning(false);
    setPresetMinutes(mins);
    setSecondsLeft(mins * 60);
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const timerProgress = Math.max(
    0,
    Math.min(100, Math.round(((presetMinutes * 60 - secondsLeft) / (presetMinutes * 60)) * 100))
  );

  // 3. Unit Converter
  const [unitCategory, setUnitCategory] = useState<'energy' | 'length' | 'temp' | 'pressure'>('energy');
  const [unitInput, setUnitInput] = useState('1');

  const unitConversions = useMemo(() => {
    const val = parseFloat(unitInput);
    if (!Number.isFinite(val)) return [];
    if (unitCategory === 'energy') {
      return [
        { label: 'Electron-volts (eV)', value: (val * 6.2415e18).toExponential(4) },
        { label: 'Joules (J) from eV', value: (val * 1.60218e-19).toExponential(4) },
        { label: 'Calories (cal) from J', value: (val / 4.184).toFixed(4) },
        { label: 'kJ/mol from eV', value: (val * 96.485).toFixed(3) },
      ];
    }
    if (unitCategory === 'length') {
      return [
        { label: 'Meters (m) from Ångström', value: (val * 1e-10).toExponential(3) },
        { label: 'Nanometers (nm) from Å', value: (val * 0.1).toFixed(4) },
        { label: 'Fermi (fm) from m', value: (val * 1e15).toExponential(3) },
        { label: 'Centimeters (cm) from m', value: (val * 100).toFixed(3) },
      ];
    }
    if (unitCategory === 'temp') {
      return [
        { label: 'Kelvin (from °C)', value: `${(val + 273.15).toFixed(2)} K` },
        { label: 'Celsius (from K)', value: `${(val - 273.15).toFixed(2)} °C` },
        { label: 'Fahrenheit (from °C)', value: `${((val * 9) / 5 + 32).toFixed(2)} °F` },
      ];
    }
    return [
      { label: 'Pascals (from atm)', value: `${(val * 101325).toLocaleString()} Pa` },
      { label: 'mmHg / Torr (from atm)', value: `${(val * 760).toFixed(2)} mmHg` },
      { label: 'Bar (from atm)', value: `${(val * 1.01325).toFixed(4)} bar` },
    ];
  }, [unitCategory, unitInput]);

  const appendToken = (token: string) => {
    setExpr((prev) => `${prev}${token}`);
  };

  return (
    <div className="space-y-8">
      {/* Large Pi Header */}
      <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 sm:p-9">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-[var(--primary-color)]">
              <Sigma className="h-5 w-5" />
              <span>Study Cloud · PW Pi Proxy & Scientific Lab</span>
            </div>
            <h1 className="font-['Sora'] text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)]">
              PW Pi STEM Solver & Study Sandbox
            </h1>
            <p className="text-sm sm:text-base text-[var(--text-secondary)] max-w-3xl leading-relaxed">
              Solve JEE/NEET numericals via PW Pi Proxy, run scientific expressions with physical
              constants, convert units, and lock in deep Pomodoro focus blocks.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onAskAi(`Explain how to calculate: ${expr}`)}
            className="flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-[var(--primary-color)] px-6 py-3.5 text-sm sm:text-base font-bold text-white shadow-sm hover:opacity-90 transition whitespace-nowrap"
          >
            <Sparkles className="h-5 w-5" />
            <span>Open Full Study AI</span>
          </button>
        </div>
      </div>

      {/* Prominent PW Pi Proxy Solver Card */}
      <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 sm:p-8 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-['Sora'] text-xl sm:text-2xl font-extrabold text-[var(--text-primary)] flex items-center gap-2.5">
              <Sparkles className="h-6 w-6 text-[var(--primary-color)]" />
              <span>PW Pi Concept & Numerical Proxy</span>
            </h2>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
              Pick a mode and enter any question, formula derivation, or numerical to solve instantly.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={piSubject}
              onChange={(e) => setPiSubject(e.target.value)}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none"
            >
              <option value="Physics">Physics</option>
              <option value="Chemistry">Chemistry</option>
              <option value="Mathematics">Mathematics</option>
              <option value="Biology">Biology</option>
            </select>

            {(
              [
                { id: 'solve', label: 'Step Solve' },
                { id: 'concept', label: 'Concept' },
                { id: 'trick', label: 'PYQ Trick' },
                { id: 'formula', label: 'Formulas' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setPiMode(m.id)}
                className={`rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition ${
                  piMode === m.id
                    ? 'bg-[var(--primary-color)] text-white'
                    : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={(e) => handleAskPwPi(e)} className="space-y-3">
          <textarea
            value={piQuery}
            onChange={(e) => setPiQuery(e.target.value)}
            rows={3}
            placeholder="e.g. A ball is thrown at 20 m/s at 45° — find max height, range & time of flight (g = 9.8 m/s²)"
            className="w-full resize-none rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-5 py-4 text-sm sm:text-base text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {[
                'Derive Gauss Law for spherical shell',
                'Electrostatics key formulas & units',
                'Nernst equation numerical trick',
              ].map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => handleAskPwPi(undefined, sample)}
                  className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3.5 py-2 text-xs sm:text-sm font-semibold text-[var(--text-secondary)] hover:border-[var(--primary-color)] hover:text-[var(--text-primary)] transition"
                >
                  {sample}
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={!piQuery.trim() || piLoading}
              className="flex items-center gap-2 rounded-2xl bg-[var(--primary-color)] px-6 py-3 text-sm sm:text-base font-bold text-white shadow-sm disabled:opacity-50 hover:opacity-90 transition whitespace-nowrap"
            >
              {piLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              <span>{piLoading ? 'Solving via PW Pi...' : 'Solve with PW Pi'}</span>
            </button>
          </div>
        </form>

        {piError && (
          <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{piError}</span>
          </div>
        )}

        {piAnswer && (
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--card-border)] pb-3">
              <span className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--primary-color)]">
                PW Pi Solution · {piSubject}
              </span>
              <button
                type="button"
                onClick={() => onAskAi(`${piQuery}\n\nPrevious PW Pi note:\n${piAnswer}`)}
                className="text-xs sm:text-sm font-bold text-[var(--primary-color)] hover:underline"
              >
                Continue in Study AI
              </button>
            </div>
            <div className="text-sm sm:text-base text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
              {piAnswer}
            </div>
          </div>
        )}
      </div>

      {/* Main 2-Zone Scientific Sandbox: Left Calculator & Constants, Right Focus Timer & Converter */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* Left Zone (7 cols): Scientific Evaluator + Constants */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 sm:p-7 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-['Sora'] text-lg sm:text-xl font-extrabold text-[var(--text-primary)] flex items-center gap-2.5">
                <Calculator className="h-6 w-6 text-[var(--primary-color)]" />
                <span>Scientific Expression Solver</span>
              </h2>
              <div className="flex items-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-1 text-xs sm:text-sm font-bold">
                <button
                  type="button"
                  onClick={() => setUseDegrees(true)}
                  className={`rounded-lg px-3 py-1.5 transition ${
                    useDegrees ? 'bg-[var(--primary-color)] text-white' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  DEG
                </button>
                <button
                  type="button"
                  onClick={() => setUseDegrees(false)}
                  className={`rounded-lg px-3 py-1.5 transition ${
                    !useDegrees ? 'bg-[var(--primary-color)] text-white' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  RAD
                </button>
              </div>
            </div>

            {/* Input + Result Display */}
            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-5 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={expr}
                  onChange={(e) => setExpr(e.target.value)}
                  placeholder="Enter expression e.g. 0.5 * 9.81 * 4^2 or sin(30)"
                  className="w-full bg-transparent font-mono text-base sm:text-lg text-[var(--text-primary)] focus:outline-none"
                />
                {expr && (
                  <button
                    type="button"
                    onClick={() => setExpr('')}
                    className="rounded-lg p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    title="Clear expression"
                  >
                    <Delete className="h-5 w-5" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-[var(--card-border)] pt-3">
                <span className="text-sm font-semibold text-[var(--text-secondary)]">Result</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono tabular-nums text-2xl sm:text-3xl font-extrabold text-[var(--primary-color)]">
                    {liveResult || '0'}
                  </span>
                  <button
                    type="button"
                    onClick={handleSaveCalculation}
                    className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] px-4 py-2 text-xs sm:text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>

            {/* Function Keypad */}
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2.5">
              {[
                { label: 'sin(', token: 'sin(' },
                { label: 'cos(', token: 'cos(' },
                { label: 'tan(', token: 'tan(' },
                { label: 'log(', token: 'log(' },
                { label: 'ln(', token: 'ln(' },
                { label: '√(', token: 'sqrt(' },
                { label: '^', token: '^' },
                { label: '(', token: '(' },
                { label: ')', token: ')' },
                { label: 'π', token: 'pi' },
                { label: 'e', token: 'e' },
                { label: '10^', token: '1e' },
              ].map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={() => appendToken(btn.token)}
                  className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] py-3 px-2.5 font-mono text-sm font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Recent Saved Calculations */}
            {calcHistory.length > 0 && (
              <div className="space-y-2 border-t border-[var(--card-border)] pt-3">
                <div className="text-xs sm:text-sm font-bold text-[var(--text-secondary)]">Saved Steps</div>
                <div className="space-y-1.5">
                  {calcHistory.map((item, idx) => (
                    <button
                      key={`${item.expr}-${idx}`}
                      type="button"
                      onClick={() => setExpr(item.expr)}
                      className="flex w-full items-center justify-between rounded-xl px-3.5 py-2 text-left font-mono text-xs sm:text-sm hover:bg-[var(--bg-secondary)] transition"
                    >
                      <span className="text-[var(--text-secondary)] truncate pr-3">{item.expr}</span>
                      <span className="font-bold text-[var(--primary-color)] tabular-nums shrink-0">
                        = {item.result}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Physical Constants Quick Insert */}
          <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 sm:p-7 space-y-4">
            <h3 className="font-['Sora'] text-lg font-extrabold text-[var(--text-primary)] flex items-center gap-2.5">
              <Atom className="h-6 w-6 text-amber-400" />
              <span>Exam Constants (Click to Insert)</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {CONSTANTS.map((c) => (
                <button
                  key={c.symbol}
                  type="button"
                  onClick={() => appendToken(c.insert)}
                  className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 text-left hover:border-[var(--primary-color)] transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-['Sora'] text-lg font-extrabold text-[var(--primary-color)]">
                      {c.symbol}
                    </span>
                    <span className="font-mono tabular-nums text-xs font-bold text-[var(--text-primary)]">
                      {c.value.split(' ')[0]}
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs text-[var(--text-secondary)] truncate">
                    {c.name}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Zone (5 cols): Pomodoro Focus Timer + Unit Converter */}
        <div className="lg:col-span-5 space-y-6">
          {/* Focus Pomodoro Timer */}
          <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 sm:p-7 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-['Sora'] text-lg sm:text-xl font-extrabold text-[var(--text-primary)] flex items-center gap-2.5">
                <Timer className="h-6 w-6 text-emerald-400" />
                <span>Pi Focus Timer</span>
              </h2>
              <span className="flex items-center gap-1.5 font-mono tabular-nums text-xs sm:text-sm font-bold text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                {sessionsCompleted} sessions
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-xl bg-[var(--bg-secondary)] p-1.5 border border-[var(--card-border)]">
              {[
                { label: '25m Focus', mins: 25 },
                { label: '50m Deep', mins: 50 },
                { label: '10m Break', mins: 10 },
              ].map((preset) => (
                <button
                  key={preset.mins}
                  type="button"
                  onClick={() => selectPreset(preset.mins)}
                  className={`flex-1 rounded-lg py-2 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
                    presetMinutes === preset.mins
                      ? 'bg-[var(--primary-color)] text-white shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-7 text-center space-y-4">
              <div className="font-mono tabular-nums text-5xl sm:text-6xl font-extrabold text-[var(--text-primary)] tracking-tight">
                {formatTimer(secondsLeft)}
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                <div
                  className="h-full rounded-full bg-[var(--primary-color)] transition-all duration-300"
                  style={{ width: `${timerProgress}%` }}
                />
              </div>
              <div className="flex items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (secondsLeft === 0) setSecondsLeft(presetMinutes * 60);
                    setIsRunning((r) => !r);
                  }}
                  className="flex items-center gap-2 rounded-2xl bg-[var(--primary-color)] px-6 py-3 text-sm sm:text-base font-bold text-white shadow-sm hover:opacity-90 transition"
                >
                  {isRunning ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  <span>{isRunning ? 'Pause' : secondsLeft === 0 ? 'Restart' : 'Start Focus'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsRunning(false);
                    setSecondsLeft(presetMinutes * 60);
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
                  title="Reset timer"
                >
                  <RotateCcw className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Unit Converter */}
          <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 sm:p-7 space-y-4">
            <h3 className="font-['Sora'] text-lg font-extrabold text-[var(--text-primary)] flex items-center gap-2.5">
              <ArrowRightLeft className="h-6 w-6 text-sky-400" />
              <span>Science Unit Converter</span>
            </h3>

            <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-[var(--bg-secondary)] p-1 border border-[var(--card-border)]">
              {(
                [
                  { id: 'energy', label: 'Energy' },
                  { id: 'length', label: 'Length' },
                  { id: 'temp', label: 'Temp' },
                  { id: 'pressure', label: 'Pressure' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setUnitCategory(tab.id)}
                  className={`rounded-lg py-2 text-xs sm:text-sm font-bold transition ${
                    unitCategory === tab.id
                      ? 'bg-[var(--primary-color)] text-white'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <input
              type="number"
              value={unitInput}
              onChange={(e) => setUnitInput(e.target.value)}
              placeholder="Enter numeric value"
              className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-3 font-mono text-base text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
            />

            <div className="space-y-2.5">
              {unitConversions.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-3 text-xs sm:text-sm"
                >
                  <span className="text-[var(--text-secondary)]">{row.label}</span>
                  <span className="font-mono tabular-nums font-bold text-[var(--text-primary)]">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
