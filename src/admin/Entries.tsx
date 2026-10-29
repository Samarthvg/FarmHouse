import { useEffect, useMemo, useRef, useState } from 'react';
import { formatRupees } from '../../shared/money.ts';
import { nextMonth, season, seasonOf, todayInIndia } from '../../shared/season.ts';
import type { Entry, EntryPage } from '../../shared/types.ts';
import { api, listEntries, updateEntry } from '../api.ts';
import { Spinner } from '../components.tsx';
import { categoryName, formatDate, formatMonth, unitName, useT } from '../i18n.ts';
import { navigate, useLocation } from '../router.ts';
import { useSession } from '../session.tsx';

const FILTER_KEYS = ['from', 'to', 'kind', 'categoryId', 'q', 'review', 'deleted'] as const;
type Filters = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

function setQuery(next: Filters) {
  const q = new URLSearchParams();
  for (const k of FILTER_KEYS) if (next[k]) q.set(k, next[k]!);
  navigate(`/admin/entries${q.size ? '?' + q : ''}`, { replace: true });
}

export function Entries() {
  const t = useT();
  const { query } = useLocation();
  const { categories, categoryById, dataVersion, bumpData } = useSession();
  const filters: Filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, query.get(k) ?? undefined]));
  const filterKey = JSON.stringify(filters);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState(filters.q ?? '');
  const reqId = useRef(0);

  const load = async (append: boolean, from: string | null) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(false);
    try {
      const page: EntryPage = await listEntries({ ...filters, limit: 50, cursor: from ?? undefined });
      if (id !== reqId.current) return;
      setEntries((prev) => (append ? [...prev, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
    } catch {
      if (id === reqId.current) setError(true);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  useEffect(() => { load(false, null); }, [filterKey, dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search box.
  useEffect(() => {
    if ((filters.q ?? '') === search) return;
    const h = setTimeout(() => setQuery({ ...filters, q: search.trim() || undefined }), 300);
    return () => clearTimeout(h);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Period controls: a season, optionally narrowed to one month.
  const thisSeason = seasonOf(todayInIndia());
  const seasons = Array.from({ length: Math.max(2, thisSeason - 2024) }, (_, i) => thisSeason - i);
  const selectedSeason = filters.from ? seasonOf(filters.from) : null;
  const s = selectedSeason ? season(selectedSeason) : null;
  const isWholeSeason = !!s && filters.from === s.from && filters.to === s.to;
  const selectedMonth = filters.from && filters.to === `${nextMonth(filters.from.slice(0, 7))}-01` && filters.from.endsWith('-01')
    ? filters.from.slice(0, 7) : null;
  const isCustom = !!filters.from && !isWholeSeason && !selectedMonth;

  const shownCategories = useMemo(
    () => categories.filter((c) => !filters.kind || c.kind === filters.kind),
    [categories, filters.kind],
  );

  const pageTotals = entries.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + e.amountPaise }), {} as Record<string, number>);

  const markReviewed = async (e: Entry) => {
    await updateEntry(e.id, { reviewNote: null });
    bumpData();
  };
  const restore = async (e: Entry) => {
    await api(`/entries/${encodeURIComponent(e.id)}/restore`, { method: 'POST' });
    bumpData();
  };

  return (
    <div className="admin-stack">
      <div className="filters card">
        <label className="field">
          <span>Season</span>
          <select className="select" value={selectedSeason ?? ''} onChange={(e) => {
            const y = Number(e.target.value);
            if (!y) return setQuery({ ...filters, from: undefined, to: undefined });
            const ns = season(y);
            setQuery({ ...filters, from: ns.from, to: ns.to });
          }}>
            <option value="">All time</option>
            {seasons.map((y) => <option key={y} value={y}>Season {y} (Dec {y - 1} – Nov {y})</option>)}
          </select>
        </label>
        <label className="field">
          <span>Month</span>
          <select className="select" disabled={!s} value={selectedMonth ?? ''} onChange={(e) => {
            if (!s) return;
            const m = e.target.value;
            setQuery({ ...filters, from: m ? `${m}-01` : s.from, to: m ? `${nextMonth(m)}-01` : s.to });
          }}>
            <option value="">{isCustom ? 'Custom range' : 'Whole season'}</option>
            {s?.months.map((m) => <option key={m} value={m}>{formatMonth(m, 'en', 'long')} {m.slice(0, 4)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select className="select" value={filters.kind ?? ''} onChange={(e) => setQuery({ ...filters, kind: e.target.value || undefined, categoryId: undefined })}>
            <option value="">All types</option>
            <option value="expense">Expenses</option>
            <option value="income">Income</option>
            <option value="capital">Owner capital</option>
          </select>
        </label>
        <label className="field">
          <span>Category</span>
          <select className="select" value={filters.categoryId ?? ''} onChange={(e) => setQuery({ ...filters, categoryId: e.target.value || undefined })}>
            <option value="">All categories</option>
            {shownCategories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.nameEn}{c.active ? '' : ' (archived)'}</option>)}
          </select>
        </label>
        <label className="field filters-search">
          <span>Search notes</span>
          <input className="input" type="search" value={search} placeholder="e.g. Kamal car, wood slipper" onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="filters-toggles">
          <label className="check"><input type="checkbox" checked={!!filters.review} onChange={(e) => setQuery({ ...filters, review: e.target.checked ? '1' : undefined })} /> Needs review</label>
          <label className="check"><input type="checkbox" checked={!!filters.deleted} onChange={(e) => setQuery({ ...filters, deleted: e.target.checked ? '1' : undefined })} /> Deleted</label>
          {Object.values(filters).some(Boolean) && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setSearch(''); setQuery({}); }}>Clear filters</button>}
        </div>
      </div>

      <div className="list-head">
        <span className="muted">
          {entries.length}{cursor ? '+' : ''} entries
          {pageTotals.expense ? <> · spent <b className="tabular">{formatRupees(pageTotals.expense)}</b></> : null}
          {pageTotals.income ? <> · earned <b className="tabular">{formatRupees(pageTotals.income)}</b></> : null}
          {pageTotals.capital ? <> · owner in <b className="tabular">{formatRupees(pageTotals.capital)}</b></> : null}
          {cursor && <span className="faint"> (totals cover loaded rows)</span>}
        </span>
        <a className="btn btn-sm" href={`/api/reports/export.csv?${new URLSearchParams({ ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) })}`}>Download CSV</a>
      </div>

      {error && <p className="banner">Could not load entries. <button type="button" className="btn btn-sm" onClick={() => load(false, null)}>Retry</button></p>}

      <div className="card entry-table">
        {entries.length === 0 && !loading ? <p className="muted pad">No entries match these filters.</p> : entries.map((e) => {
          const cat = categoryById.get(e.categoryId);
          return (
            <div key={e.id} className={`entry-row ${e.deletedAt ? 'is-deleted' : ''}`}>
              <button type="button" className="entry-row-main" onClick={() => navigate(`/entry/${e.id}`)}>
                <span className="entry-icon" aria-hidden="true">{cat?.icon}</span>
                <span className="entry-text">
                  <span className="entry-title">
                    {categoryName(cat, t.lang)}
                    {e.workers ? <span className="faint"> · {e.workers} workers</span> : null}
                    {e.quantity && cat?.unit ? (
                      <span className="faint"> · {e.quantity.toLocaleString('en-IN')} {unitName(cat.unit, 'en')} · {formatRupees(Math.round(e.amountPaise / e.quantity / 100) * 100)}/{unitName(cat.unit, 'en')}</span>
                    ) : null}
                    {e.photos.length ? <span className="faint"> · 📷 {e.photos.length}</span> : null}
                  </span>
                  {e.note && <span className="entry-note">{e.note}</span>}
                  <span className="entry-meta">
                    {formatDate(e.date, 'en', e.dateIsMonthOnly)}
                    {' · '}{e.createdByName ?? 'Spreadsheet'}{e.ref ? ` #${e.ref}` : ''}
                  </span>
                  {e.reviewNote && <span className="pill pill-warn entry-review">⚠ {e.reviewNote}</span>}
                </span>
                <span className={`entry-amt tabular amt-${e.kind}`}>{e.kind === 'expense' ? '−' : '+'}{formatRupees(e.amountPaise)}</span>
              </button>
              {(e.reviewNote || e.deletedAt) && (
                <div className="entry-actions">
                  {e.reviewNote && !e.deletedAt && <button type="button" className="btn btn-sm" onClick={() => markReviewed(e)}>Looks fine</button>}
                  {e.deletedAt && <button type="button" className="btn btn-sm" onClick={() => restore(e)}>Restore</button>}
                </div>
              )}
            </div>
          );
        })}
        {loading && <div className="pad-center"><Spinner /></div>}
      </div>
      {cursor && !loading && <button type="button" className="btn" onClick={() => load(true, cursor)}>Load more</button>}
    </div>
  );
}
