import { useEffect, useState } from 'react';
import { formatRupees } from '../../shared/money.ts';
import type { ActivityItem, Entry } from '../../shared/types.ts';
import { api } from '../api.ts';
import { Spinner } from '../components.tsx';
import { categoryName, formatDate, useT } from '../i18n.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';

const VERB = { create: 'added', update: 'changed', delete: 'deleted', restore: 'restored' } as const;

function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function Activity() {
  const t = useT();
  const { categoryById, dataVersion } = useSession();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = (before?: number) => {
    setLoading(true);
    api<{ items: ActivityItem[]; nextBefore: number | null }>(`/reports/activity${before ? `?before=${before}` : ''}`)
      .then((r) => {
        setItems((prev) => (before ? [...prev, ...r.items] : r.items));
        setNext(r.nextBefore);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), [dataVersion]);

  const describe = (e: Partial<Entry> | null) => {
    if (!e) return '';
    const cat = e.categoryId ? categoryById.get(e.categoryId) : undefined;
    return `${cat?.icon ?? ''} ${categoryName(cat, t.lang)} ${e.amountPaise ? formatRupees(e.amountPaise) : ''}`;
  };

  const changes = (a: ActivityItem) => {
    if (a.action !== 'update' || !a.before || !a.after) return null;
    const out: string[] = [];
    const b = a.before, n = a.after;
    if (b.amountPaise !== n.amountPaise) out.push(`amount ${formatRupees(b.amountPaise ?? 0)} → ${formatRupees(n.amountPaise ?? 0)}`);
    if (b.categoryId !== n.categoryId) out.push(`category ${categoryName(categoryById.get(b.categoryId!), 'en')} → ${categoryName(categoryById.get(n.categoryId!), 'en')}`);
    if (b.date !== n.date) out.push(`date ${formatDate(b.date!, 'en')} → ${formatDate(n.date!, 'en')}`);
    if (b.workers !== n.workers) out.push(`workers ${b.workers ?? '—'} → ${n.workers ?? '—'}`);
    if (b.note !== n.note) out.push('note edited');
    if (b.reviewNote !== n.reviewNote) out.push(n.reviewNote ? 'flagged for review' : 'marked as reviewed');
    return out.join(' · ');
  };

  if (error) return <p className="banner">Could not load activity.</p>;
  return (
    <div className="admin-stack">
      <p className="muted" style={{ margin: 0 }}>Every add, change and delete, newest first. Spreadsheet imports are not listed.</p>
      <div className="card entry-table">
        {items.length === 0 && !loading && <p className="muted pad">Nothing yet. Changes show up here as soon as they are made.</p>}
        {items.map((a) => (
          <button key={a.id} type="button" className="activity-row" onClick={() => navigate(`/entry/${a.entryId}`)}>
            <span className={`pill ${a.action === 'delete' ? 'pill-expense' : a.action === 'create' ? 'pill-income' : ''}`}>{VERB[a.action]}</span>
            <span className="entry-text">
              <span className="entry-title">{a.userName ?? 'Someone'} {VERB[a.action]} {describe(a.after ?? a.before)}</span>
              <span className="entry-meta">
                {(a.after ?? a.before)?.date && `for ${formatDate((a.after ?? a.before)!.date!, 'en')} · `}{timeAgo(a.at)}
              </span>
              {changes(a) && <span className="entry-note">{changes(a)}</span>}
            </span>
          </button>
        ))}
        {loading && <div className="pad-center"><Spinner /></div>}
      </div>
      {next && !loading && <button type="button" className="btn" onClick={() => load(next)}>Load more</button>}
    </div>
  );
}
