import { useEffect, useState } from 'react';
import { formatRupees } from '../../shared/money.ts';
import { nextMonth } from '../../shared/season.ts';
import type { Kind, SeasonReport } from '../../shared/types.ts';
import { api } from '../api.ts';
import { Spinner } from '../components.tsx';
import { categoryName, formatMonth, useT } from '../i18n.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';
import { MonthlyColumns, RankedBars } from './Charts.tsx';

const CHART = { expense: 'var(--chart-expense)', income: 'var(--chart-income)', prev: 'var(--chart-prev)' };

function seasonLabel(year: number) {
  return `Dec ${year - 1} – Nov ${year}`;
}

function Delta({ now, before, upIsGood }: { now: number; before: number; upIsGood: boolean }) {
  if (!before) return null;
  const d = (now - before) / Math.abs(before);
  const good = d === 0 ? null : (d > 0) === upIsGood;
  return (
    <span className={good === null ? 'faint' : good ? 'delta-good' : 'delta-bad'}>
      {d > 0 ? '▲' : d < 0 ? '▼' : ''} {Math.abs(Math.round(d * 100))}% vs last season ({formatRupees(before)})
    </span>
  );
}

export function Dashboard() {
  const t = useT();
  const { categoryById, dataVersion } = useSession();
  const [years, setYears] = useState<number[] | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [report, setReport] = useState<SeasonReport | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api<{ current: number; years: number[] }>('/reports/seasons')
      .then((r) => { setYears(r.years); setYear((y) => y ?? r.current); })
      .catch(() => setError(true));
  }, [dataVersion]);

  useEffect(() => {
    if (year === null) return;
    let live = true;
    setReport(null);
    api<SeasonReport>(`/reports/season/${year}`)
      .then((r) => live && setReport(r))
      .catch(() => live && setError(true));
    return () => { live = false; };
  }, [year, dataVersion]);

  if (error) return <p className="banner">Could not load the dashboard. Check the connection and reload.</p>;
  if (!years || year === null) return <div className="pad-center"><Spinner /></div>;

  const idx = years.indexOf(year);
  const r = report;
  const net = r ? r.totals.income - r.totals.expense : 0;
  const prevNet = r ? r.previous.totals.income - r.previous.totals.expense : 0;
  const cash = r ? r.totals.capital + r.totals.income - r.totals.expense : 0;

  const goEntries = (params: Record<string, string | number>) =>
    navigate('/admin/entries?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])));

  const catRows = (kind: Kind) =>
    (r?.categories ?? [])
      .filter((c) => categoryById.get(c.categoryId)?.kind === kind && (c.paise > 0 || c.previousPaise > 0))
      .map((c) => {
        const cat = categoryById.get(c.categoryId);
        return { id: c.categoryId, label: categoryName(cat, t.lang), icon: cat?.icon ?? '', value: c.paise, previous: c.previousPaise };
      })
      .sort((a, b) => b.value - a.value);

  const hasPrev = r ? r.previous.totals.expense + r.previous.totals.income > 0 : false;

  return (
    <div className="admin-stack">
      <div className="toolbar">
        <div className="season-picker" role="group" aria-label="Season">
          <button type="button" className="btn btn-sm" disabled={idx >= years.length - 1} onClick={() => setYear(years[idx + 1])} aria-label="Previous season">‹</button>
          <div>
            <div className="season-name">Season {year}</div>
            <div className="faint season-range">{seasonLabel(year)}</div>
          </div>
          <button type="button" className="btn btn-sm" disabled={idx <= 0} onClick={() => setYear(years[idx - 1])} aria-label="Next season">›</button>
        </div>
        <a className="btn btn-sm" href={r ? `/api/reports/export.csv?from=${r.from}&to=${r.to}` : undefined}>Download CSV</a>
      </div>

      {r && r.reviewCount > 0 && (
        <button type="button" className="banner banner-btn" onClick={() => goEntries({ review: 1 })}>
          ⚠ {r.reviewCount} {r.reviewCount === 1 ? 'entry needs' : 'entries need'} a look (possible duplicates or mismatched amounts) →
        </button>
      )}

      {!r ? <div className="pad-center"><Spinner /></div> : (
        <>
          <section className="hero card">
            <div>
              <div className="stat-label">Cash position this season</div>
              <div className={`hero-value tabular ${cash < 0 ? 'amt-expense' : ''}`}>{formatRupees(cash)}</div>
              <div className="muted">Owner money in + income − expenses</div>
            </div>
            <div className="hero-side">
              <div className="stat-label">Farm profit / loss</div>
              <div className={`stat-value tabular ${net < 0 ? 'amt-expense' : 'amt-income'}`}>{formatRupees(net)}</div>
              <div className="stat-delta"><Delta now={net} before={prevNet} upIsGood /></div>
              <div className="faint" style={{ fontSize: '0.85rem' }}>Income − expenses, before owner money</div>
            </div>
          </section>

          <div className="stat-grid">
            <button type="button" className="stat card" onClick={() => goEntries({ from: r.from, to: r.to, kind: 'expense' })}>
              <div className="stat-label">Spent</div>
              <div className="stat-value tabular">{formatRupees(r.totals.expense)}</div>
              <div className="stat-delta"><Delta now={r.totals.expense} before={r.previous.totals.expense} upIsGood={false} /></div>
            </button>
            <button type="button" className="stat card" onClick={() => goEntries({ from: r.from, to: r.to, kind: 'income' })}>
              <div className="stat-label">Earned</div>
              <div className="stat-value tabular">{formatRupees(r.totals.income)}</div>
              <div className="stat-delta"><Delta now={r.totals.income} before={r.previous.totals.income} upIsGood /></div>
            </button>
            <button type="button" className="stat card" onClick={() => goEntries({ from: r.from, to: r.to, kind: 'capital' })}>
              <div className="stat-label">Owner money put in</div>
              <div className="stat-value tabular">{formatRupees(r.totals.capital)}</div>
              <div className="stat-delta faint">{r.entryCount} entries this season</div>
            </button>
            <div className="stat card">
              <div className="stat-label">Labor</div>
              <div className="stat-value tabular">{formatRupees(r.labor.paise)}</div>
              <div className="stat-delta muted">
                {r.labor.workerDays} worker-days
                {r.labor.workerDays > 0 && ` · avg ${formatRupees(Math.round(r.labor.paiseWithCount / r.labor.workerDays / 100) * 100)} per worker-day`}
              </div>
            </div>
          </div>

          <section className="card panel">
            <div className="panel-head">
              <div>
                <h2>Month by month</h2>
                <p className="muted">Click a month to see its entries.</p>
              </div>
            </div>
            <MonthlyColumns
              months={r.months}
              series={[
                { key: 'expense', label: 'Spent', color: CHART.expense, values: r.months.map((m) => r.monthly[m]?.expense ?? 0) },
                { key: 'income', label: 'Earned', color: CHART.income, values: r.months.map((m) => r.monthly[m]?.income ?? 0) },
              ]}
              onSelect={(m) => goEntries({ from: `${m}-01`, to: nextMonthStart(m) })}
            />
          </section>

          <section className="card panel">
            <div className="panel-head">
              <div>
                <h2>Season {year} vs season {year - 1}</h2>
                <p className="muted">{hasPrev ? 'Same calendar month, one season apart.' : `No entries in season ${year - 1} yet. This fills in as data arrives.`}</p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Spent</th>
                    <th className="num">Last season</th>
                    <th className="num">Change</th>
                    <th className="num">Earned</th>
                    <th className="num">Last season</th>
                    <th className="num">Owner in</th>
                    <th className="num">Profit / loss</th>
                  </tr>
                </thead>
                <tbody>
                  {r.months.map((m) => {
                    const cur = r.monthly[m];
                    const prev = r.previous.monthly[`${Number(m.slice(0, 4)) - 1}${m.slice(4)}`];
                    const change = prev?.expense ? (cur.expense - prev.expense) / prev.expense : null;
                    const monthNet = cur.income - cur.expense;
                    const empty = !cur.expense && !cur.income && !cur.capital;
                    return (
                      <tr key={m} className={empty ? 'row-empty' : ''} onClick={() => goEntries({ from: `${m}-01`, to: nextMonthStart(m) })}>
                        <td>{formatMonth(m, 'en', 'long')} {m.slice(0, 4)}</td>
                        <td className="num">{cur.expense ? formatRupees(cur.expense) : '—'}</td>
                        <td className="num faint">{prev?.expense ? formatRupees(prev.expense) : '—'}</td>
                        <td className={`num ${change === null ? 'faint' : change > 0 ? 'delta-bad' : 'delta-good'}`}>
                          {change === null ? '—' : `${change > 0 ? '+' : ''}${Math.round(change * 100)}%`}
                        </td>
                        <td className="num">{cur.income ? formatRupees(cur.income) : '—'}</td>
                        <td className="num faint">{prev?.income ? formatRupees(prev.income) : '—'}</td>
                        <td className="num">{cur.capital ? formatRupees(cur.capital) : '—'}</td>
                        <td className={`num ${empty ? '' : monthNet < 0 ? 'amt-expense' : 'amt-income'}`}>{empty ? '—' : formatRupees(monthNet)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num">{formatRupees(r.totals.expense)}</td>
                    <td className="num faint">{r.previous.totals.expense ? formatRupees(r.previous.totals.expense) : '—'}</td>
                    <td className="num" />
                    <td className="num">{formatRupees(r.totals.income)}</td>
                    <td className="num faint">{r.previous.totals.income ? formatRupees(r.previous.totals.income) : '—'}</td>
                    <td className="num">{formatRupees(r.totals.capital)}</td>
                    <td className={`num ${net < 0 ? 'amt-expense' : 'amt-income'}`}>{formatRupees(net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <div className="two-col">
            <section className="card panel">
              <div className="panel-head">
                <div>
                  <h2>Where the money went</h2>
                  <p className="muted">Share of spending · tick = last season</p>
                </div>
              </div>
              <RankedBars rows={catRows('expense')} color={CHART.expense}
                onSelect={(id) => goEntries({ from: r.from, to: r.to, categoryId: id })} />
            </section>
            <section className="card panel">
              <div className="panel-head">
                <div>
                  <h2>Where the money came from</h2>
                  <p className="muted">Share of income · tick = last season</p>
                </div>
              </div>
              <RankedBars rows={catRows('income')} color={CHART.income}
                onSelect={(id) => goEntries({ from: r.from, to: r.to, categoryId: id })} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

const nextMonthStart = (ym: string) => `${nextMonth(ym)}-01`;
