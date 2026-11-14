import React, { useState } from 'react';

interface SubjectIconBadgeProps {
  subjectName: string;
  imageUrl?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

type SubjectThemeKey =
  | 'notices'
  | 'physics'
  | 'chemistry'
  | 'math'
  | 'biology'
  | 'botany'
  | 'zoology'
  | 'science'
  | 'sst'
  | 'history'
  | 'geography'
  | 'polity'
  | 'economics'
  | 'accountancy'
  | 'business'
  | 'english'
  | 'hindi'
  | 'sanskrit'
  | 'computer'
  | 'reasoning'
  | 'gk'
  | 'guidance'
  | 'test'
  | 'doubt'
  | 'arts'
  | 'default';

function detectSubjectTheme(name: string): SubjectThemeKey {
  const s = (name || '').toLowerCase();
  if (/notice|announc|update/.test(s)) return 'notices';
  if (/physic|bhotik|mechanics|optics|electrodyn/.test(s)) return 'physics';
  if (/chemi|rasayan|organic|inorganic/.test(s)) return 'chemistry';
  if (/math|ganit|calcul|algebra|geometr|trigono|quant/.test(s)) return 'math';
  if (/botany|vanaspati|plant/.test(s)) return 'botany';
  if (/zoology|jantu|anatomy/.test(s)) return 'zoology';
  if (/biolog|\bbio\b|jeev/.test(s)) return 'biology';
  if (/science|vigyan|evs|environ/.test(s)) return 'science';
  if (/social|\bsst\b|samajik/.test(s)) return 'sst';
  if (/history|itihas|ancient|medieval|modern/.test(s)) return 'history';
  if (/geograph|bhugol/.test(s)) return 'geography';
  if (/polity|civic|polit|constitut|govern/.test(s)) return 'polity';
  if (/account|lekha/.test(s)) return 'accountancy';
  if (/business|management|entrepre/.test(s)) return 'business';
  if (/econom|arthashastra|commerce|finance/.test(s)) return 'economics';
  if (/hindi|vyakaran/.test(s)) return 'hindi';
  if (/english|angrezi|grammar|vocab/.test(s)) return 'english';
  if (/sanskrit|urdu|marathi|bengali|tamil|telugu|punjabi|language/.test(s)) return 'sanskrit';
  if (/computer|\bit\b|coding|program|python|informatics|cyber/.test(s)) return 'computer';
  if (/reason|aptitude|\bmat\b|mental|logic|csat/.test(s)) return 'reasoning';
  if (/current|gk|general\s*knowledge|general\s*studies|\bgs\b|ethics|essay/.test(s)) return 'gk';
  if (/guidance|orient|planner|mentor|strateg|schedule|syllabus|study\s*mat/.test(s)) return 'guidance';
  if (/test|quiz|dpp|practice|revision|marathon|pyq|mock/.test(s)) return 'test';
  if (/doubt|solut|ask/.test(s)) return 'doubt';
  if (/art|music|drawing|paint|sport|physical\s*ed/.test(s)) return 'arts';
  return 'default';
}

const THEME_STYLES: Record<SubjectThemeKey, { box: string; stroke: string; fill: string }> = {
  notices: { box: 'bg-blue-500/10 border-blue-500/25', stroke: '#2563EB', fill: '#BFDBFE' },
  physics: { box: 'bg-indigo-500/10 border-indigo-500/25', stroke: '#4F46E5', fill: '#C7D2FE' },
  chemistry: { box: 'bg-emerald-500/10 border-emerald-500/25', stroke: '#059669', fill: '#A7F3D0' },
  math: { box: 'bg-amber-500/10 border-amber-500/25', stroke: '#D97706', fill: '#FDE68A' },
  biology: { box: 'bg-pink-500/10 border-pink-500/25', stroke: '#DB2777', fill: '#FBCFE8' },
  botany: { box: 'bg-green-500/10 border-green-500/25', stroke: '#16A34A', fill: '#BBF7D0' },
  zoology: { box: 'bg-fuchsia-500/10 border-fuchsia-500/25', stroke: '#C026D3', fill: '#F5D0FE' },
  science: { box: 'bg-cyan-500/10 border-cyan-500/25', stroke: '#0891B2', fill: '#A5F3FC' },
  sst: { box: 'bg-orange-500/10 border-orange-500/25', stroke: '#EA580C', fill: '#FED7AA' },
  history: { box: 'bg-amber-600/10 border-amber-600/25', stroke: '#B45309', fill: '#FDE68A' },
  geography: { box: 'bg-teal-500/10 border-teal-500/25', stroke: '#0D9488', fill: '#99F6E4' },
  polity: { box: 'bg-indigo-500/10 border-indigo-500/25', stroke: '#4338CA', fill: '#C7D2FE' },
  economics: { box: 'bg-yellow-500/10 border-yellow-500/25', stroke: '#CA8A04', fill: '#FEF08A' },
  accountancy: { box: 'bg-emerald-600/10 border-emerald-600/25', stroke: '#047857', fill: '#A7F3D0' },
  business: { box: 'bg-sky-600/10 border-sky-600/25', stroke: '#0284C7', fill: '#BAE6FD' },
  english: { box: 'bg-violet-500/10 border-violet-500/25', stroke: '#7C3AED', fill: '#DDD6FE' },
  hindi: { box: 'bg-orange-500/10 border-orange-500/25', stroke: '#EA580C', fill: '#FED7AA' },
  sanskrit: { box: 'bg-purple-500/10 border-purple-500/25', stroke: '#9333EA', fill: '#E9D5FF' },
  computer: { box: 'bg-sky-500/10 border-sky-500/25', stroke: '#0284C7', fill: '#BAE6FD' },
  reasoning: { box: 'bg-purple-600/10 border-purple-600/25', stroke: '#7E22CE', fill: '#E9D5FF' },
  gk: { box: 'bg-blue-600/10 border-blue-600/25', stroke: '#1D4ED8', fill: '#BFDBFE' },
  guidance: { box: 'bg-cyan-500/10 border-cyan-500/25', stroke: '#0891B2', fill: '#A5F3FC' },
  test: { box: 'bg-rose-500/10 border-rose-500/25', stroke: '#E11D48', fill: '#FECDD3' },
  doubt: { box: 'bg-amber-500/10 border-amber-500/25', stroke: '#D97706', fill: '#FDE68A' },
  arts: { box: 'bg-pink-500/10 border-pink-500/25', stroke: '#DB2777', fill: '#FBCFE8' },
  default: { box: 'bg-indigo-500/10 border-indigo-500/25', stroke: '#6366F1', fill: '#C7D2FE' },
};

function renderSubjectSvg(theme: SubjectThemeKey, stroke: string, fill: string, iconSizeClass: string) {
  switch (theme) {
    case 'notices':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M23 7L11 12H6a2 2 0 00-2 2v3a2 2 0 002 2h5l12 5V7z" fill={fill} stroke={stroke} strokeWidth="1.9" strokeLinejoin="round" />
          <path d="M9 19l1.8 5.5a1.2 1.2 0 001.1.8h1.5a1 1 0 001-1.3L13 19" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M26 11.5a5 5 0 010 8" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      );

    case 'physics':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <ellipse cx="16" cy="16" rx="11" ry="4.5" transform="rotate(35 16 16)" fill={fill} fillOpacity="0.45" stroke={stroke} strokeWidth="1.7" />
          <ellipse cx="16" cy="16" rx="11" ry="4.5" transform="rotate(-35 16 16)" stroke={stroke} strokeWidth="1.7" />
          <ellipse cx="16" cy="16" rx="11" ry="4.5" transform="rotate(90 16 16)" stroke={stroke} strokeWidth="1.7" />
          <circle cx="16" cy="16" r="2.6" fill={stroke} />
        </svg>
      );

    case 'chemistry':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M12 5h8M13.5 5v6.5L7.8 22.8A2.2 2.2 0 009.8 26h12.4a2.2 2.2 0 002-3.2L18.5 11.5V5" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.6 19.5h12.8l1.8 3.3a2.2 2.2 0 01-2 3.2H9.8a2.2 2.2 0 01-2-3.2l1.8-3.3z" fill={fill} stroke={stroke} strokeWidth="1.6" />
          <circle cx="14" cy="22.5" r="1.2" fill={stroke} />
          <circle cx="18.2" cy="23.5" r="1" fill={stroke} />
        </svg>
      );

    case 'math':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <rect x="5" y="5" width="22" height="22" rx="5" fill={fill} fillOpacity="0.55" stroke={stroke} strokeWidth="1.8" />
          <path d="M9.5 12.5h5M12 10v5M17.5 12.5h5M9.5 21.5l4.5-4.5M14 21.5l-4.5-4.5M18 19.5h4.5M18 22.2h4.5" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      );

    case 'biology':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M10 5c0 6 12 6 12 11s-12 5-12 11" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
          <path d="M22 5c0 6-12 6-12 11s12 5 12 11" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
          <path d="M11.5 8.5h9M12.5 16h7M11.5 23.5h9" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="16" cy="16" r="3" fill={fill} stroke={stroke} strokeWidth="1.4" />
        </svg>
      );

    case 'botany':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M7 25C7 13 15 7 25 7c0 10-6 18-18 18z" fill={fill} stroke={stroke} strokeWidth="1.9" strokeLinejoin="round" />
          <path d="M7 25L20 12" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
          <path d="M13 19h5M16 16v-4" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );

    case 'zoology':
    case 'science':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M14 6l4 2-3.5 9-4-2L14 6z" fill={fill} stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M17.5 12.5A6.5 6.5 0 0121 24.5H8" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
          <path d="M9 21h7M6 26.5h20" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    case 'sst':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <circle cx="16" cy="14.5" r="8.5" fill={fill} stroke={stroke} strokeWidth="1.9" />
          <ellipse cx="16" cy="14.5" rx="4" ry="8.5" stroke={stroke} strokeWidth="1.6" />
          <path d="M8 14.5h16M16 23v4M11.5 27h9" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      );

    case 'history':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M8 7h15a2 2 0 012 2v13a3 3 0 01-3 3H9a3 3 0 01-3-3V9a2 2 0 012-2z" fill={fill} stroke={stroke} strokeWidth="1.8" />
          <path d="M11 12h9M11 16h9M11 20h6" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'geography':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <circle cx="16" cy="16" r="10.5" fill={fill} fillOpacity="0.55" stroke={stroke} strokeWidth="1.9" />
          <path d="M19.5 12.5l-2.2 5.3-5.3 2.2 2.2-5.3 5.3-2.2z" fill={stroke} />
        </svg>
      );

    case 'polity':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M16 6v19M10 25h12M7 10h18" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
          <path d="M9 10l-3 7h6l-3-7zM23 10l-3 7h6l-3-7z" fill={fill} stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );

    case 'economics':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M6 24h20" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
          <rect x="8" y="16" width="4" height="8" rx="1" fill={fill} stroke={stroke} strokeWidth="1.6" />
          <rect x="14" y="12" width="4" height="12" rx="1" fill={fill} stroke={stroke} strokeWidth="1.6" />
          <rect x="20" y="8" width="4" height="16" rx="1" fill={fill} stroke={stroke} strokeWidth="1.6" />
          <path d="M8 11l6-4 5 2 5-4" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'accountancy':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <rect x="7" y="5" width="18" height="22" rx="3" fill={fill} stroke={stroke} strokeWidth="1.8" />
          <path d="M11 10h10M11 15h4M17 15h4M11 19h4M17 19h4M11 23h10" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );

    case 'business':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <rect x="5" y="10" width="22" height="15" rx="3" fill={fill} stroke={stroke} strokeWidth="1.8" />
          <path d="M12 10V7.5A1.5 1.5 0 0113.5 6h5A1.5 1.5 0 0120 7.5V10M5 16h22" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'hindi':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <rect x="5" y="6" width="22" height="20" rx="4" fill={fill} fillOpacity="0.65" stroke={stroke} strokeWidth="1.8" />
          <text x="16" y="21" textAnchor="middle" fill={stroke} fontSize="14" fontWeight="800" fontFamily="sans-serif">
            अ
          </text>
        </svg>
      );

    case 'english':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <rect x="5" y="6" width="22" height="20" rx="4" fill={fill} fillOpacity="0.65" stroke={stroke} strokeWidth="1.8" />
          <text x="16" y="21" textAnchor="middle" fill={stroke} fontSize="14" fontWeight="800" fontFamily="sans-serif">
            Aa
          </text>
        </svg>
      );

    case 'sanskrit':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M6 8c4-2 8-1 10 2 2-3 6-4 10-2v15c-4-2-8-1-10 2-2-3-6-4-10-2V8z" fill={fill} stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M16 10v15" stroke={stroke} strokeWidth="1.7" />
        </svg>
      );

    case 'computer':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <rect x="6" y="7" width="20" height="14" rx="2.5" fill={fill} stroke={stroke} strokeWidth="1.8" />
          <path d="M13 12l-2.5 2 2.5 2M19 12l2.5 2-2.5 2M17 11.5l-2 5M4.5 25h23" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'reasoning':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M12 6a5 5 0 00-5 5c0 1.4.5 2.6 1.4 3.5A4.5 4.5 0 0010 23h2v3h8v-3h2a4.5 4.5 0 001.6-8.5A5 5 0 0020 6a4 4 0 00-4 2 4 4 0 00-4-2z" fill={fill} stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M16 8v15" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );

    case 'gk':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <rect x="6" y="6" width="20" height="20" rx="3" fill={fill} stroke={stroke} strokeWidth="1.8" />
          <rect x="9.5" y="10" width="6" height="5" rx="1" fill={stroke} />
          <path d="M18 11h4.5M18 14.5h4.5M9.5 19h13M9.5 22.5h9" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );

    case 'guidance':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <rect x="6" y="7" width="20" height="19" rx="3" fill={fill} stroke={stroke} strokeWidth="1.8" />
          <path d="M11 5v4M21 5v4M6 12.5h20M12.5 18.5l2.5 2.5 4.5-4.5" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'test':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <rect x="7" y="6" width="18" height="21" rx="3" fill={fill} stroke={stroke} strokeWidth="1.8" />
          <path d="M12 5h8v3h-8V5zM11 14l2 2 4-4M11 20l2 2 4-4" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'doubt':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M7 8h18a2 2 0 012 2v10a2 2 0 01-2 2H13l-5 4v-4H7a2 2 0 01-2-2V10a2 2 0 012-2z" fill={fill} stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M14 13a2 2 0 113.5 1.3c-.6.6-1.5 1-1.5 2M16 19h.01" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    case 'arts':
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M16 6a10 10 0 100 20c1.8 0 2.5-1.2 2.5-2.3 0-1.2.8-2.2 2.2-2.2H22a4 4 0 004-4A11.5 11.5 0 0016 6z" fill={fill} stroke={stroke} strokeWidth="1.8" />
          <circle cx="11.5" cy="14" r="1.4" fill={stroke} />
          <circle cx="15.5" cy="11" r="1.4" fill={stroke} />
          <circle cx="20" cy="13.5" r="1.4" fill={stroke} />
        </svg>
      );

    default:
      return (
        <svg viewBox="0 0 32 32" className={iconSizeClass} fill="none">
          <path d="M6 8c3.5-1.8 7.5-1.2 10 1.5C18.5 6.8 22.5 6.2 26 8v15c-3.5-1.8-7.5-1.2-10 1.5-2.5-2.7-6.5-3.3-10-1.5V8z" fill={fill} stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M16 9.5v15" stroke={stroke} strokeWidth="1.8" />
        </svg>
      );
  }
}

export const SubjectIconBadge: React.FC<SubjectIconBadgeProps> = ({
  subjectName,
  imageUrl,
  size = 'md',
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const themeKey = detectSubjectTheme(subjectName);
  const palette = THEME_STYLES[themeKey];

  const boxSizeClass = size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-12 w-12 rounded-xl';
  const svgSizeClass = size === 'sm' ? 'h-5 w-5' : 'h-7 w-7';

  if (imageUrl && !imgFailed) {
    return (
      <div
        className={`flex ${boxSizeClass} shrink-0 items-center justify-center overflow-hidden border border-[var(--card-border)] bg-[var(--card-bg)] ${className}`}
      >
        <img
          src={imageUrl}
          alt={subjectName}
          onError={() => setImgFailed(true)}
          className="h-full w-full object-contain p-1"
        />
      </div>
    );
  }

  return (
    <div
      className={`flex ${boxSizeClass} shrink-0 items-center justify-center overflow-hidden border ${palette.box} ${className}`}
    >
      {renderSubjectSvg(themeKey, palette.stroke, palette.fill, svgSizeClass)}
    </div>
  );
};
