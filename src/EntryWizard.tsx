import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatRupees, parseAmountExpression } from '../shared/money.ts';
import { addDays, todayInIndia } from '../shared/season.ts';
import { MANAGER_BACKDATE_DAYS, type Entry, type Kind, type NewEntry } from '../shared/types.ts';
import { ApiError, NetworkError, createEntry, deleteEntry, newId, updateEntry } from './api.ts';
import { BigTopBar, CheckIcon, LangToggle } from './components.tsx';
import { categoryName, formatDate, formatWeekday, useT, type StringKey } from './i18n.ts';
import { enqueue } from './outbox.ts';
import { navigate, pushHistoryState, replaceHistoryState, rewind, useHistoryState } from './router.ts';
import { useSession } from './session.tsx';

type Step = 'category' | 'amount' | 'workers' | 'review' | 'done';

interface Draft {
  id: string;
  categoryId: number | null;
  expr: string;
  workers: number | null;
  date: string;
  note: string;
}

const freshDraft = (): Draft => ({ id: newId(), categoryId: null, expr: '', workers: null, date: todayInIndia(), note: '' });

function draftFromEntry(e: Entry): Draft {
  const rupees = e.amountPaise / 100;
  return { id: e.id, categoryId: e.categoryId, expr: String(rupees), workers: e.workers, date: e.date, note: e.note };
}

const errorKey = (code: string): StringKey =>
  code === 'date_too_old' ? 'dateTooOld' : code === 'date_in_future' ? 'dateFuture' : 'error';

export function EntryWizard(props: { kind: Kind } | { entry: Entry }) {
  const t = useT();
  const { me, categories, categoryById, bumpData, setLang } = useSession();
  const editing = 'entry' in props ? props.entry : null;
  const kind: Kind = editing ? editing.kind : (props as { kind: Kind }).kind;
  const isAdmin = me.role === 'admin';

  const choices = useMemo(
    () => categories.filter((c) => c.active && c.kind === kind && (isAdmin || (c.showOnEntry && c.kind !== 'capital'))),
    [categories, kind, isAdmin],
  );
  const onlyChoice = choices.length === 1 ? choices[0] : null;

  const [draft, setDraft] = useState<Draft>(() => {
    if (editing) return draftFromEntry(editing);
    return { ...freshDraft(), categoryId: onlyChoice?.id ?? null };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const firstStep: Step = editing ? 'review' : onlyChoice ? 'amount' : 'category';
  const historyState = useHistoryState<{ step?: Step; depth?: number }>();
  const step: Step = historyState?.step ?? firstStep;

  useEffect(() => {
    if (!historyState?.step) history.replaceState({ step: firstStep, depth: 0 }, '');
  }, [historyState, firstStep]);

  // Once saved, walking back into the form would only invite a second save; go home instead.
  useEffect(() => {
    if (saved && step !== 'done') navigate('/', { replace: true });
  }, [saved, step]);

  const category = draft.categoryId ? categoryById.get(draft.categoryId) : undefined;
  const amountPaise = parseAmountExpression(draft.expr);
  const goTo = (s: Step) => { setError(null); pushHistoryState({ step: s, depth: (historyState?.depth ?? 0) + 1 }); };
  const back = () => history.back();
  const afterAmount = (): Step => (category?.tracksWorkers ? 'workers' : 'review');

  const save = async () => {
    if (!category || !amountPaise) return;
    setSaving(true);
    setError(null);
    const payload: NewEntry = {
      id: draft.id,
      categoryId: category.id,
      date: draft.date,
      amountPaise,
      workers: category.tracksWorkers ? draft.workers : null,
      note: draft.note.trim(),
    };
    try {
      if (editing) await updateEntry(editing.id, payload);
      else await createEntry(payload);
      setSavedOffline(false);
      bumpData();
      await finish();
    } catch (err) {
      if (err instanceof NetworkError && !editing) {
        enqueue(payload, me.id);
        setSavedOffline(true);
        await finish();
      } else if (err instanceof NetworkError) {
        setError(t('offline'));
      } else {
        setError(t(errorKey(err instanceof ApiError ? err.code : 'error')));
      }
    } finally {
      setSaving(false);
    }
  };

  // Drop the form's steps from history so Back from the confirmation leaves the form entirely.
  const finish = async () => {
    await rewind(historyState?.depth ?? 0);
    replaceHistoryState({ step: 'done', depth: 0 });
    setSaved(true);
  };

  const remove = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await deleteEntry(editing.id);
      bumpData();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof NetworkError ? t('offline') : t('error'));
      setSaving(false);
    }
  };

  const startAnother = () => {
    setDraft({ ...freshDraft(), categoryId: onlyChoice?.id ?? null });
    setSaved(false);
    setSavedOffline(false);
    replaceHistoryState({ step: firstStep, depth: 0 });
  };

  const stepsInFlow: Step[] = editing ? [] : [
    ...(onlyChoice ? [] : ['category' as Step]), 'amount', ...(category?.tracksWorkers ? ['workers' as Step] : []), 'review',
  ];
  const dots = stepsInFlow.length > 1 && step !== 'done' ? (
    <div className="step-dots" aria-hidden="true">
      {stepsInFlow.map((s) => <span key={s} className={s === step ? 'on' : ''} />)}
    </div>
  ) : null;

  const top = (
    <BigTopBar
      onBack={step === 'done' ? undefined : back}
      right={<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{dots}<LangToggle onToggle={() => setLang(t.lang === 'hi' ? 'en' : 'hi')} /></div>}
    />
  );

  if (step === 'done') {
    return (
      <div className="big big-shell">
        {top}
        <div className="done-check"><CheckIcon /></div>
        <h1 className="big-title" style={{ textAlign: 'center', marginTop: 0 }}>{t('saved')}</h1>
        {savedOffline && <p className="banner" role="status">{t('savedOffline')}</p>}
        <div className="summary-row" style={{ marginTop: 16 }}>
          <span className="emoji" aria-hidden="true">{category?.icon}</span>
          <div>
            <div className="label">{categoryName(category, t.lang)}</div>
            <div className={`value amt-${kind}`}>{amountPaise ? formatRupees(amountPaise) : ''}</div>
          </div>
        </div>
        {!editing && <button type="button" className="big-next" onClick={startAnother}>＋ {t('addAnother')}</button>}
        <button type="button" className={editing ? 'big-next' : 'big-secondary'} onClick={() => navigate('/', { replace: true })}>{t('goHome')}</button>
      </div>
    );
  }

  if (step === 'category') {
    return (
      <div className="big big-shell">
        {top}
        <h1 className="big-title">{t(kind === 'expense' ? 'whatExpense' : kind === 'income' ? 'whatIncome' : 'whatCapital')}</h1>
        <div className="tile-grid">
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`tile ${draft.categoryId === c.id ? 'selected' : ''}`}
              onClick={() => {
                setDraft((d) => ({ ...d, categoryId: c.id, workers: c.tracksWorkers ? d.workers : null }));
                goTo('amount');
              }}
            >
              <span className="emoji" aria-hidden="true">{c.icon}</span>
              {categoryName(c, t.lang)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (step === 'amount') {
    return (
      <div className="big big-shell">
        {top}
        <h1 className="big-title">
          <span aria-hidden="true">{category?.icon} </span>{categoryName(category, t.lang)} — {t('howMuch')}
        </h1>
        <AmountPad expr={draft.expr} onChange={(expr) => setDraft((d) => ({ ...d, expr }))} />
        <button
          type="button"
          className="big-next"
          disabled={!amountPaise}
          onClick={() => goTo(editing ? 'review' : afterAmount())}
        >
          {amountPaise ? t('next') + ' →' : t('amountMissing')}
        </button>
      </div>
    );
  }

  if (step === 'workers') {
    const n = draft.workers ?? 0;
    const set = (v: number) => setDraft((d) => ({ ...d, workers: Math.max(0, Math.min(200, v)) }));
    return (
      <div className="big big-shell">
        {top}
        <h1 className="big-title">{t('howManyWorkers')}</h1>
        <div className="stepper">
          <button type="button" onClick={() => set(n - 1)} aria-label="−1">−</button>
          <div className="count tabular" aria-live="polite">{n}<small>{t('workers')}</small></div>
          <button type="button" onClick={() => set(n + 1)} aria-label="+1">+</button>
        </div>
        <div className="quick-row">
          {[1, 2, 3, 4, 5, 6, 8, 10].map((q) => (
            <button key={q} type="button" className={n === q ? 'on' : ''} onClick={() => set(q)}>{q}</button>
          ))}
        </div>
        <button type="button" className="big-next" disabled={n === 0} onClick={() => goTo('review')}>{t('next')} →</button>
        <button type="button" className="big-secondary" onClick={() => { setDraft((d) => ({ ...d, workers: null })); goTo('review'); }}>
          {t('skip')}
        </button>
      </div>
    );
  }

  // review
  const today = todayInIndia();
  const minDate = isAdmin ? undefined : addDays(today, -MANAGER_BACKDATE_DAYS);
  const quickDates: [StringKey, string][] = [['today', today], ['yesterday', addDays(today, -1)], ['dayBefore', addDays(today, -2)]];
  const locked = editing && !editing.editable;

  return (
    <div className="big big-shell">
      {top}
      <h1 className="big-title">{editing ? t('editEntry') : t('checkAndSave')}</h1>
      {locked && <p className="banner">{t('cannotEdit')}</p>}

      <div className="summary">
        <SummaryRow
          emoji={category?.icon ?? ''}
          label={t(kind)}
          value={categoryName(category, t.lang)}
          onChange={!locked && choices.length > 1 ? () => goTo('category') : undefined}
        />
        <SummaryRow
          emoji="₹"
          label={t('howMuch')}
          value={<span className={`amt-${kind}`}>{amountPaise ? formatRupees(amountPaise) : '—'}</span>}
          onChange={!locked ? () => goTo('amount') : undefined}
        />
        {category?.tracksWorkers && (
          <SummaryRow
            emoji="👥"
            label={t('howManyWorkers')}
            value={draft.workers ? `${draft.workers} ${t('workers')}` : '—'}
            onChange={!locked ? () => goTo('workers') : undefined}
          />
        )}
      </div>

      <h2 className="big-section-title">{t('when')}</h2>
      <p className="date-chosen" aria-live="polite">📅 {formatWeekday(draft.date, t.lang)}, {formatDate(draft.date, t.lang)}</p>
      <div className="date-chips">
        {quickDates.map(([key, d]) => (
          <button key={key} type="button" disabled={!!locked} className={draft.date === d ? 'on' : ''}
            onClick={() => setDraft((x) => ({ ...x, date: d }))}>
            {t(key)}
          </button>
        ))}
      </div>
      <label className="date-other field">
        <span>{t('otherDate')}</span>
        <input
          className="input"
          type="date"
          value={draft.date}
          min={minDate}
          max={today}
          disabled={!!locked}
          onChange={(e) => e.target.value && setDraft((x) => ({ ...x, date: e.target.value }))}
        />
      </label>

      <h2 className="big-section-title">{t('note')}</h2>
      <textarea
        className="textarea big-textarea"
        value={draft.note}
        maxLength={2000}
        disabled={!!locked}
        placeholder={t('notePlaceholder')}
        onChange={(e) => setDraft((x) => ({ ...x, note: e.target.value }))}
      />
      <p className="faint" style={{ margin: '6px 4px 0', fontSize: '0.95rem' }}>{t('noteMicHint')}</p>

      {error && <p className="banner" role="alert" style={{ marginTop: 16 }}>{error}</p>}

      {!locked && (
        <button type="button" className="big-next" disabled={saving || !amountPaise || !category} onClick={save}>
          {saving ? t('saving') : <>✓ {t('save')}</>}
        </button>
      )}

      {editing && !locked && (
        confirmingDelete ? (
          <div className="card" style={{ padding: 16, marginTop: 24 }}>
            <p style={{ fontWeight: 700, margin: '0 0 12px' }}>{t('confirmDelete')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button type="button" className="big-secondary" style={{ marginTop: 0, color: 'var(--expense)', borderColor: 'var(--expense)' }} disabled={saving} onClick={remove}>{t('yesDelete')}</button>
              <button type="button" className="big-secondary" style={{ marginTop: 0 }} onClick={() => setConfirmingDelete(false)}>{t('no')}</button>
            </div>
          </div>
        ) : (
          <button type="button" className="big-secondary" style={{ marginTop: 28, color: 'var(--expense)' }} onClick={() => setConfirmingDelete(true)}>
            🗑 {t('deleteEntry')}
          </button>
        )
      )}
    </div>
  );
}

function SummaryRow({ emoji, label, value, onChange }: { emoji: string; label: string; value: ReactNode; onChange?: () => void }) {
  const t = useT();
  const body = (
    <>
      <span className="emoji" aria-hidden="true">{emoji}</span>
      <div style={{ minWidth: 0 }}>
        <div className="label">{label}</div>
        <div className="value">{value}</div>
      </div>
      {onChange && <span className="change">{t('change')}</span>}
    </>
  );
  return onChange
    ? <button type="button" className="summary-row" onClick={onChange}>{body}</button>
    : <div className="summary-row">{body}</div>;
}

function AmountPad({ expr, onChange }: { expr: string; onChange: (s: string) => void }) {
  const t = useT();
  const press = (k: string) => {
    if (k === '⌫') return onChange(expr.slice(0, -1));
    if (k === '+') {
      if (!expr || expr.endsWith('+')) return;
      return onChange(expr + '+');
    }
    const lastTerm = expr.split('+').pop() ?? '';
    if (lastTerm.length >= 9) return;
    if (lastTerm === '0') return onChange(expr.slice(0, -1) + k);
    onChange(expr + k);
  };
  const terms = expr.split('+').filter(Boolean);
  const total = parseAmountExpression(expr.replace(/\+$/, ''));
  const showSum = terms.length > 1;

  return (
    <>
      <div className="amount-display" aria-live="polite">
        {!expr ? (
          <div className="value placeholder">₹ 0</div>
        ) : showSum ? (
          <>
            <div className="expr tabular">{terms.map((x) => Number(x).toLocaleString('en-IN')).join(' + ')}{expr.endsWith('+') ? ' +' : ''}</div>
            <div className="value tabular">= {total ? formatRupees(total) : '₹0'}</div>
          </>
        ) : (
          <div className="value tabular">{formatRupees(Number(terms[0] ?? 0) * 100)}{expr.endsWith('+') ? ' +' : ''}</div>
        )}
      </div>
      <p className="faint" style={{ margin: '-4px 4px 12px', fontSize: '0.95rem' }}>{t('howMuchHint')}</p>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="key" onClick={() => press(d)}>{d}</button>
        ))}
        <button type="button" className="key key-alt" onClick={() => press('+')} aria-label="plus">+</button>
        <button type="button" className="key" onClick={() => press('0')}>0</button>
        <button type="button" className="key key-alt" onClick={() => press('⌫')} aria-label="Delete">⌫</button>
      </div>
    </>
  );
}

