import { useState } from 'react';
import { formatRupees, formatRupeesCompact } from '../../shared/money.ts';
import type { KindTotals } from '../../shared/types.ts';
import { formatMonth, useT } from '../i18n.ts';

/** Rounds an axis maximum up to a clean number with 4 even steps. */
function niceMax(v: number): number {
  if (v <= 0) return 4;
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return step * 4;
}

interface Series { key: keyof KindTotals | 'prev'; label: string; color: string; values: number[] }

/** Paired monthly columns with a per-month hover tooltip. One shared y-axis. */
export function MonthlyColumns({ months, series, selected, onSelect }: {
  months: string[];
  series: Series[];
  selected?: string | null;
  onSelect?: (ym: string) => void;
}) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const W = 960, H = 250, padL = 52, padR = 8, padT = 12, padB = 28;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const band = (W - padL - padR) / months.length;
  const barW = Math.min(18, (band - 10) / series.length - 2);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);

  return (
    <div className="chart-wrap">
      <div className="legend">
        {series.map((s) => (
          <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={series.map((s) => s.label).join(', ')}
          onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="grid" />
              <text x={padL - 8} y={y(v)} className="axis" textAnchor="end" dominantBaseline="middle">
                {v === 0 ? '0' : formatRupeesCompact(v)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const x0 = padL + band * i;
            const groupW = series.length * barW + (series.length - 1) * 2;
            const isSel = selected === m;
            return (
              <g key={m}>
                {(hover === i || isSel) && <rect x={x0 + 2} y={padT} width={band - 4} height={H - padT - padB} className="band-hl" rx="6" />}
                {series.map((s, si) => {
                  const v = s.values[i];
                  if (!v) return null;
                  const x = x0 + (band - groupW) / 2 + si * (barW + 2);
                  const top = y(v);
                  const h = y(0) - top;
                  const r = Math.min(4, h);
                  return (
                    <path key={s.key} fill={s.color}
                      d={`M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${y(0)} Z`} />
                  );
                })}
                <text x={x0 + band / 2} y={H - 8} className={`axis ${isSel ? 'axis-strong' : ''}`} textAnchor="middle">{formatMonth(m, t.lang)}</text>
                <rect x={x0} y={0} width={band} height={H} fill="transparent"
                  style={{ cursor: onSelect ? 'pointer' : 'default' }}
                  onMouseEnter={() => setHover(i)} onClick={() => onSelect?.(m)} />
              </g>
            );
          })}
          <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="baseline" />
        </svg>
        {hover !== null && (
          <div className="tooltip" style={{ left: `${((padL + band * (hover + 0.5)) / W) * 100}%` }}>
            <strong>{formatMonth(months[hover], t.lang, 'long')} {months[hover].slice(0, 4)}</strong>
            {series.map((s) => (
              <div key={s.key} className="tt-row"><i style={{ background: s.color }} />{s.label}<b className="tabular">{formatRupees(s.values[hover])}</b></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Ranked horizontal bars for one measure, with the value at each bar's tip. */
export function RankedBars({ rows, color, onSelect }: {
  rows: { id: number; label: string; icon: string; value: number; previous: number }[];
  color: string;
  onSelect?: (id: number) => void;
}) {
  const t = useT();
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.previous)));
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  return (
    <div className="ranked">
      {rows.map((r) => {
        const delta = r.previous ? (r.value - r.previous) / r.previous : null;
        return (
          <button key={r.id} type="button" className="ranked-row" onClick={() => onSelect?.(r.id)}
            title={`${r.label}: ${formatRupees(r.value)} (${t.lang === 'hi' ? 'पिछला सीज़न' : 'last season'} ${formatRupees(r.previous)})`}>
            <span className="ranked-label"><span aria-hidden="true">{r.icon}</span> {r.label}</span>
            <span className="ranked-track">
              <span className="ranked-bar" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
              {r.previous > 0 && <span className="ranked-prev" style={{ left: `${(r.previous / max) * 100}%` }} />}
            </span>
            <span className="ranked-value tabular">
              {formatRupees(r.value)}
              <small>{r.value > 0 && r.value / total < 0.005 ? '<1' : Math.round((r.value / total) * 100)}%{delta !== null && Math.abs(delta) >= 0.005 && ` · ${delta > 0 ? '▲' : '▼'}${Math.abs(Math.round(delta * 100))}%`}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
