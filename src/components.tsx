import { useEffect, useRef, type ReactNode } from 'react';
import { formatRupees } from '../shared/money.ts';
import type { Kind } from '../shared/types.ts';
import { useT } from './i18n.ts';
import { useTheme, type ThemePref } from './theme.ts';

export function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function BigTopBar({ onBack, right }: { onBack?: () => void; right?: ReactNode }) {
  const t = useT();
  return (
    <div className="big-top">
      {onBack ? (
        <button type="button" className="big-back" onClick={onBack}>
          <BackIcon /> {t('back')}
        </button>
      ) : <span />}
      {right}
    </div>
  );
}

/** Language and light/dark buttons for the big, simple screens. */
export function LangToggle({ onToggle }: { onToggle: () => void }) {
  const t = useT();
  const { resolved, setPref } = useTheme();
  const toDark = resolved === 'light';
  return (
    <div className="top-controls">
      <button type="button" className="lang-btn theme-btn" onClick={() => setPref(toDark ? 'dark' : 'light')}
        aria-label={t(toDark ? 'darkMode' : 'lightMode')} title={t(toDark ? 'darkMode' : 'lightMode')}>
        {toDark ? <MoonIcon /> : <SunIcon />}
      </button>
      <button type="button" className="lang-btn" onClick={onToggle} lang={t.lang === 'hi' ? 'en' : 'hi'}>
        {t('language')}
      </button>
    </div>
  );
}

const THEME_ORDER: ThemePref[] = ['system', 'light', 'dark'];
const THEME_LABEL: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** Admin header control: cycles System → Light → Dark. */
export function ThemeCycle() {
  const { pref, setPref } = useTheme();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(pref) + 1) % THEME_ORDER.length];
  return (
    <button type="button" className="btn btn-sm btn-ghost theme-cycle" onClick={() => setPref(next)}
      title={`Theme: ${THEME_LABEL[pref]}. Click for ${THEME_LABEL[next]}.`}>
      {pref === 'system' ? <MonitorIcon /> : pref === 'light' ? <SunIcon /> : <MoonIcon />}
      <span>{THEME_LABEL[pref]}</span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

export function Amount({ paise, kind, sign = false, className = '' }: { paise: number; kind?: Kind; sign?: boolean; className?: string }) {
  const signed = sign && kind ? (kind === 'expense' ? -paise : paise) : paise;
  return <span className={`tabular ${kind ? 'amt-' + kind : ''} ${className}`}>{formatRupees(signed, { sign: sign && kind !== 'expense' })}</span>;
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

export function FullScreenSpinner() {
  return <div className="center-screen"><Spinner /></div>;
}

export interface DigitKeys {
  onDigit: (d: string) => void;
  onDelete: () => void;
  onPlus?: () => void;
  onEnter?: () => void;
}

/**
 * Lets a laptop or a phone with a keyboard type into an on-screen number pad: digits (top row or
 * numpad), Backspace, + and Enter. Keys typed into a real text box are left alone.
 */
export function useDigitKeys(keys: DigitKeys) {
  const latest = useRef(keys);
  latest.current = keys;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const k = latest.current;
      if (/^[0-9]$/.test(e.key)) k.onDigit(e.key);
      else if (e.key === 'Backspace') k.onDelete();
      else if (e.key === '+' && k.onPlus) k.onPlus();
      // Enter would otherwise also press whichever pad key still has focus from the last tap.
      else if (e.key === 'Enter' && k.onEnter) k.onEnter();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
