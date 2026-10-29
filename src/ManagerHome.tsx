import { useEffect, useState } from 'react';
import { formatRupees } from '../shared/money.ts';
import { addDays, todayInIndia } from '../shared/season.ts';
import type { Entry } from '../shared/types.ts';
import { listEntries } from './api.ts';
import { BigTopBar, LangToggle, Spinner } from './components.tsx';
import { categoryName, formatDate, formatWeekday, useT } from './i18n.ts';
import { discard, usePending, type Pending } from './outbox.ts';
import { navigate } from './router.ts';
import { useSession } from './session.tsx';

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** The last list the server sent, so the home screen stays truthful with no signal. */
const recentKey = (userId: number) => `fh_recent_v1_${userId}`;
function readRecent(userId: number): Entry[] | null {
  try {
    return JSON.parse(localStorage.getItem(recentKey(userId)) ?? 'null');
  } catch {
    return null;
  }
}
function writeRecent(userId: number, entries: Entry[]) {
  try {
    localStorage.setItem(recentKey(userId), JSON.stringify(entries));
  } catch {
    // ignore: the list simply will not be available offline
  }
}

export function ManagerHome() {
  const t = useT();
  const { me, categoryById, dataVersion, setLang, signOut } = useSession();
  const online = useOnline();
  const pending = usePending(me.id);
  const [entries, setEntries] = useState<Entry[] | null>(() => readRecent(me.id));
  const [failed, setFailed] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    let live = true;
    listEntries({ mine: 1, from: addDays(todayInIndia(), -14), limit: 100 })
      .then((page) => {
        if (!live) return;
        setEntries(page.entries);
        setFailed(false);
        writeRecent(me.id, page.entries);
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [dataVersion, online, me.id]);

  const today = todayInIndia();
  const todays = [...(entries ?? []).filter((e) => e.date === today), ...pending.filter((p) => p.date === today)];
  const sum = (kind: string) => todays.reduce((s, e) => {
    const k = 'kind' in e ? e.kind : categoryById.get(e.categoryId)?.kind;
    return k === kind ? s + e.amountPaise : s;
  }, 0);

  // Group by day, newest first, with unsent entries on top of their day.
  const items: (Entry | Pending)[] = [...pending, ...(entries ?? [])];
  const days = [...new Set(items.map((e) => e.date))].sort().reverse();

  return (
    <div className="big big-shell">
      <BigTopBar right={<LangToggle onToggle={() => setLang(t.lang === 'hi' ? 'en' : 'hi')} />} />
      <h1 className="big-title" style={{ marginTop: 4 }}>{t('hello')}, {me.name} 🙏</h1>

      {!online && <p className="banner" role="status">📶 {t('offline')}</p>}

      <div className="action-stack" style={{ marginTop: 8 }}>
        <button type="button" className="action-big action-expense" onClick={() => navigate('/add/expense')}>
          <span className="icon" aria-hidden="true">−</span>
          <span>{t('addExpense')}<small>{t('moneyPaid')}</small></span>
        </button>
        <button type="button" className="action-big action-income" onClick={() => navigate('/add/income')}>
          <span className="icon" aria-hidden="true">+</span>
          <span>{t('addIncome')}<small>{t('moneyReceived')}</small></span>
        </button>
      </div>

      <div className="today-strip">
        <div className="card">
          <div className="label">{t('todaySpent')}</div>
          <div className="value amt-expense tabular">{formatRupees(sum('expense'))}</div>
        </div>
        <div className="card">
          <div className="label">{t('todayEarned')}</div>
          <div className="value amt-income tabular">{formatRupees(sum('income'))}</div>
        </div>
      </div>

      <h2 className="big-section-title">{t('recent')}</h2>
      {entries === null && !failed && pending.length === 0 ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 24 }}><Spinner /></div>
      ) : items.length === 0 ? (
        <p className="muted">{failed && entries === null ? t('offline') : t('nothingYet')}</p>
      ) : (
        days.map((day) => (
          <section key={day}>
            <h3 className="day-head">
              {day === today ? t('today') : day === addDays(today, -1) ? t('yesterday') : formatWeekday(day, t.lang)} · {formatDate(day, t.lang)}
            </h3>
            <div className="list-big">
              {items.filter((e) => e.date === day).map((e) => {
                const cat = categoryById.get(e.categoryId);
                const isPending = !('kind' in e);
                const kind = cat?.kind ?? 'expense';
                const sub = [e.workers ? `${e.workers} ${t('workers')}` : '', e.note].filter(Boolean).join(' · ');
                const content = (
                  <>
                    <span className="emoji" aria-hidden="true">{cat?.icon}</span>
                    <div className="main">
                      <div className="title">{categoryName(cat, t.lang)}</div>
                      {sub && <div className="sub">{sub}</div>}
                      {isPending && (
                        <span className={`pill ${(e as Pending).error ? 'pill-expense' : 'pill-warn'}`} style={{ marginTop: 4 }}>
                          ⏳ {(e as Pending).error ? t('pendingFailed') : t('pending')}
                        </span>
                      )}
                    </div>
                    <span className={`amt amt-${kind} tabular`}>{kind === 'expense' ? '−' : '+'}{formatRupees(e.amountPaise)}</span>
                  </>
                );
                if (isPending) {
                  const p = e as Pending;
                  return (
                    <div key={p.id} className="entry-big">
                      {content}
                      {p.error && (
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => discard(p.id)} aria-label={t('deleteEntry')}>🗑</button>
                      )}
                    </div>
                  );
                }
                const entry = e as Entry;
                return (
                  <button key={entry.id} type="button" className="entry-big" onClick={() => navigate(`/entry/${entry.id}`, { state: null })}>
                    {content}
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}

      <div style={{ marginTop: 40, textAlign: 'center' }}>
        {confirmLogout ? (
          <div className="card" style={{ padding: 16 }}>
            <p style={{ fontWeight: 700, margin: '0 0 12px' }}>{t('confirmLogout')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button type="button" className="big-secondary" style={{ marginTop: 0 }} onClick={signOut}>{t('logout')}</button>
              <button type="button" className="big-secondary" style={{ marginTop: 0 }} onClick={() => setConfirmLogout(false)}>{t('no')}</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost faint" onClick={() => setConfirmLogout(true)}>{t('logout')}</button>
        )}
      </div>
    </div>
  );
}
