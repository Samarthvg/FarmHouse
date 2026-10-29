import type { ReactNode } from 'react';
import { formatRupees } from '../shared/money.ts';
import type { Kind } from '../shared/types.ts';
import { useT } from './i18n.ts';

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

export function LangToggle({ onToggle }: { onToggle: () => void }) {
  const t = useT();
  return (
    <button type="button" className="lang-btn" onClick={onToggle} lang={t.lang === 'hi' ? 'en' : 'hi'}>
      {t('language')}
    </button>
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
