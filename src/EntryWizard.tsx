import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatRupees, parseAmountExpression } from '../shared/money.ts';
import { addDays, todayInIndia } from '../shared/season.ts';
import { MANAGER_BACKDATE_DAYS, MAX_PHOTOS_PER_ENTRY, type Entry, type Kind, type NewEntry } from '../shared/types.ts';
import { ApiError, NetworkError, createEntry, deleteEntry, deletePhoto, newId, photoUrl, updateEntry } from './api.ts';
import { BigTopBar, CheckIcon, LangToggle, useDigitKeys } from './components.tsx';
import { categoryName, formatDate, formatWeekday, unitName, useT, type StringKey } from './i18n.ts';
import { shrinkImage } from './images.ts';
import { enqueue } from './outbox.ts';
import { flushPhotos, queuePhoto, usePendingPhotoCounts } from './photoQueue.ts';
import { navigate, pushHistoryState, replaceHistoryState, rewind, useHistoryState } from './router.ts';
import { useSession } from './session.tsx';

type Step = 'category' | 'amount' | 'workers' | 'quantity' | 'review' | 'done';

interface Draft {
  id: string;
  categoryId: number | null;
  expr: string;
  workers: number | null;
  quantity: string;
  date: string;
  note: string;
}

interface NewPhoto {
  id: string;
  blob: Blob;
  url: string;
}

const freshDraft = (): Draft => ({
  id: newId(), categoryId: null, expr: '', workers: null, quantity: '', date: todayInIndia(), note: '',
});

function draftFromEntry(e: Entry): Draft {
  return {
    id: e.id,
    categoryId: e.categoryId,
    expr: String(e.amountPaise / 100),
    workers: e.workers,
    quantity: e.quantity ? String(e.quantity) : '',
    date: e.date,
    note: e.note,
  };
}

const errorKey = (code: string): StringKey =>
  code === 'date_too_old' ? 'dateTooOld' : code === 'date_in_future' ? 'dateFuture' : 'error';

export function EntryWizard(props: { kind: Kind } | { entry: Entry }) {
  const t = useT();
  const { me, categories, categoryById, bumpData, setLang } = useSession();
  const editing = 'entry' in props ? props.entry : null;
  const kind: Kind = editing ? editing.kind : (props as { kind: Kind }).kind;
  const isAdmin = me.role === 'admin';
  const pendingPhotos = usePendingPhotoCounts();

  const choices = useMemo(
    () => categories.filter((c) => c.active && c.kind === kind && (isAdmin || (c.showOnEntry && c.kind !== 'capital'))),
    [categories, kind, isAdmin],
  );
  const onlyChoice = choices.length === 1 ? choices[0] : null;

  const [draft, setDraft] = useState<Draft>(() => {
    if (editing) return draftFromEntry(editing);
    return { ...freshDraft(), categoryId: onlyChoice?.id ?? null };
  });
  const [newPhotos, setNewPhotos] = useState<NewPhoto[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Free the in-memory previews when the form closes.
  const previews = useRef<string[]>([]);
  previews.current = newPhotos.map((p) => p.url);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

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
  const quantity = Number(draft.quantity) || null;
  const goTo = (s: Step) => { setError(null); pushHistoryState({ step: s, depth: (historyState?.depth ?? 0) + 1 }); };
  const back = () => history.back();
  const afterAmount = (): Step => (category?.tracksWorkers ? 'workers' : category?.unit ? 'quantity' : 'review');
  const existingPhotos = (editing?.photos ?? []).filter((p) => !removedPhotoIds.includes(p.id));
  const photoCount = existingPhotos.length + newPhotos.length;

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const room = MAX_PHOTOS_PER_ENTRY - photoCount;
    const picked = [...files].slice(0, Math.max(0, room));
    try {
      const shrunk = await Promise.all(picked.map(async (f) => {
        const blob = await shrinkImage(f);
        return { id: newId(), blob, url: URL.createObjectURL(blob) };
      }));
      setNewPhotos((prev) => [...prev, ...shrunk]);
    } catch {
      setError(t('photoFailed'));
    }
  };

  const removeNewPhoto = (id: string) => {
    setNewPhotos((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
  };

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
      quantity: category.unit ? quantity : null,
      note: draft.note.trim(),
    };
    let offline = false;
    try {
      if (editing) await updateEntry(editing.id, payload);
      else await createEntry(payload);
    } catch (err) {
      if (err instanceof NetworkError && !editing) {
        enqueue(payload, me.id);
        offline = true;
      } else {
        setError(err instanceof NetworkError ? t('offline') : t(errorKey(err instanceof ApiError ? err.code : 'error')));
        setSaving(false);
        return;
      }
    }
    try {
      // Photos are queued on the phone first so none is lost if the signal drops mid-upload.
      for (const p of newPhotos) await queuePhoto({ id: p.id, entryId: draft.id, userId: me.id, blob: p.blob });
      for (const id of removedPhotoIds) await deletePhoto(draft.id, id);
      if (!offline) await flushPhotos(me.id);
    } catch {
      // Queued photos are retried by the background sync; nothing to show here.
    }
    setSavedOffline(offline);
    bumpData();
    await finish();
    setSaving(false);
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
    newPhotos.forEach((p) => URL.revokeObjectURL(p.url));
    setNewPhotos([]);
    setRemovedPhotoIds([]);
    setDraft({ ...freshDraft(), categoryId: onlyChoice?.id ?? null });
    setSaved(false);
    setSavedOffline(false);
    replaceHistoryState({ step: firstStep, depth: 0 });
  };

  const stepsInFlow: Step[] = editing ? [] : [
    ...(onlyChoice ? [] : ['category' as Step]),
    'amount',
    ...(category?.tracksWorkers ? ['workers' as Step] : []),
    ...(category?.unit ? ['quantity' as Step] : []),
    'review',
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

  const unitLabel = category?.unit ? unitName(category.unit, t.lang) : '';
  const rate = quantity && amountPaise ? Math.round(amountPaise / quantity / 100) * 100 : null;

  if (step === 'done') {
    const photosWaiting = pendingPhotos.get(draft.id) ?? 0;
    return (
      <div className="big big-shell">
        {top}
        <div className="done-check"><CheckIcon /></div>
        <h1 className="big-title" style={{ textAlign: 'center', marginTop: 0 }}>{t('saved')}</h1>
        {savedOffline && <p className="banner" role="status">{t('savedOffline')}</p>}
        {!savedOffline && photosWaiting > 0 && <p className="banner" role="status">📷 {t('photoPending')} ({photosWaiting})</p>}
        <div className="summary-row" style={{ marginTop: 16 }}>
          <span className="emoji" aria-hidden="true">{category?.icon}</span>
          <div>
            <div className="label">{categoryName(category, t.lang)}</div>
            <div className={`value amt-${kind}`}>{amountPaise ? formatRupees(amountPaise) : ''}</div>
            {quantity && category?.unit && <div className="label">{quantity} {unitLabel}</div>}
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
                setDraft((d) => ({
                  ...d,
                  categoryId: c.id,
                  workers: c.tracksWorkers ? d.workers : null,
                  quantity: c.unit ? d.quantity : '',
                }));
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
        <AmountPad
          expr={draft.expr}
          onChange={(expr) => setDraft((d) => ({ ...d, expr }))}
          onEnter={() => { if (amountPaise) goTo(editing ? 'review' : afterAmount()); }}
        />
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
    const nextStep: Step = editing ? 'review' : category?.unit ? 'quantity' : 'review';
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
        <button type="button" className="big-next" disabled={n === 0} onClick={() => goTo(nextStep)}>{t('next')} →</button>
        <button type="button" className="big-secondary" onClick={() => { setDraft((d) => ({ ...d, workers: null })); goTo(nextStep); }}>
          {t('skip')}
        </button>
      </div>
    );
  }

  if (step === 'quantity') {
    return (
      <div className="big big-shell">
        {top}
        <h1 className="big-title">
          <span aria-hidden="true">{category?.icon} </span>{t('howMuchSold')}
        </h1>
        <div className="amount-display" aria-live="polite">
          <div className={`value tabular ${draft.quantity ? '' : 'placeholder'}`}>{draft.quantity ? Number(draft.quantity).toLocaleString('en-IN') : '0'} {unitLabel}</div>
          {rate && <div className="expr tabular">≈ {formatRupees(rate)} {t('per')} {unitLabel}</div>}
        </div>
        <p className="faint" style={{ margin: '-4px 4px 12px', fontSize: '0.95rem' }}>{t('howMuchSoldHint')}</p>
        <DigitPad
          onDigit={(d) => setDraft((x) => (x.quantity.length >= 7 || (x.quantity === '' && d === '0') ? x : { ...x, quantity: x.quantity + d }))}
          onDelete={() => setDraft((x) => ({ ...x, quantity: x.quantity.slice(0, -1) }))}
          onEnter={() => { if (quantity) goTo('review'); }}
        />
        <button type="button" className="big-next" disabled={!quantity} onClick={() => goTo('review')}>{t('next')} →</button>
        <button type="button" className="big-secondary" onClick={() => { setDraft((d) => ({ ...d, quantity: '' })); goTo('review'); }}>
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
        {category?.unit && (
          <SummaryRow
            emoji="⚖️"
            label={t('howMuchSold')}
            value={quantity ? <>{quantity.toLocaleString('en-IN')} {unitLabel}{rate && <span className="faint"> · {formatRupees(rate)} {t('per')} {unitLabel}</span>}</> : '—'}
            onChange={!locked ? () => goTo('quantity') : undefined}
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

      <h2 className="big-section-title">{t('photos')}</h2>
      <div className="photo-grid">
        {existingPhotos.map((p) => (
          <div key={p.id} className="photo-thumb">
            <a href={photoUrl(p.id)} target="_blank" rel="noreferrer"><img src={photoUrl(p.id)} alt="" loading="lazy" /></a>
            {!locked && (
              <button type="button" className="photo-remove" aria-label={t('removePhoto')}
                onClick={() => setRemovedPhotoIds((ids) => [...ids, p.id])}>✕</button>
            )}
          </div>
        ))}
        {newPhotos.map((p) => (
          <div key={p.id} className="photo-thumb">
            <img src={p.url} alt="" />
            <button type="button" className="photo-remove" aria-label={t('removePhoto')} onClick={() => removeNewPhoto(p.id)}>✕</button>
          </div>
        ))}
        {!locked && photoCount < MAX_PHOTOS_PER_ENTRY && (
          <label className="photo-add">
            <span className="emoji" aria-hidden="true">📷</span>
            {t('addPhoto')}
            <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>
      {photoCount >= MAX_PHOTOS_PER_ENTRY && <p className="faint" style={{ margin: '6px 4px 0' }}>{t('photoLimit')}</p>}

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

/** 1–9, then [extra] 0 ⌫. The extra key is + for amounts and left blank for quantities. */
function DigitPad({ onDigit, onDelete, onPlus, onEnter, extra }: {
  onDigit: (d: string) => void;
  onDelete: () => void;
  onPlus?: () => void;
  onEnter: () => void;
  extra?: ReactNode;
}) {
  useDigitKeys({ onDigit, onDelete, onPlus, onEnter });
  return (
    <div className="keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <button key={d} type="button" className="key" onClick={() => onDigit(d)}>{d}</button>
      ))}
      {extra ?? <span />}
      <button type="button" className="key" onClick={() => onDigit('0')}>0</button>
      <button type="button" className="key key-alt" onClick={onDelete} aria-label="Delete">⌫</button>
    </div>
  );
}

function AmountPad({ expr, onChange, onEnter }: { expr: string; onChange: (s: string) => void; onEnter: () => void }) {
  const t = useT();
  const digit = (k: string) => {
    const lastTerm = expr.split('+').pop() ?? '';
    if (lastTerm.length >= 9) return;
    if (lastTerm === '0') return onChange(expr.slice(0, -1) + k);
    onChange(expr + k);
  };
  const plus = () => {
    if (!expr || expr.endsWith('+')) return;
    onChange(expr + '+');
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
      <DigitPad
        onDigit={digit}
        onDelete={() => onChange(expr.slice(0, -1))}
        onPlus={plus}
        onEnter={onEnter}
        extra={<button type="button" className="key key-alt" onClick={plus} aria-label="plus">+</button>}
      />
    </>
  );
}
