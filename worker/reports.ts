import { Hono } from 'hono';
import { season, seasonOf, todayInIndia } from '../shared/season.ts';
import type { ActivityItem, KindTotals, SeasonReport } from '../shared/types.ts';
import { requireAdmin } from './auth.ts';
import type { AppEnv } from './env.ts';

const emptyTotals = (): KindTotals => ({ expense: 0, income: 0, capital: 0 });

interface MonthRow { ym: string; kind: keyof KindTotals; paise: number }

function fold(rows: MonthRow[], months: string[]) {
  const monthly: Record<string, KindTotals> = Object.fromEntries(months.map((m) => [m, emptyTotals()]));
  const totals = emptyTotals();
  for (const r of rows) {
    monthly[r.ym] ??= emptyTotals();
    monthly[r.ym][r.kind] += r.paise;
    totals[r.kind] += r.paise;
  }
  return { totals, monthly };
}

export const reports = new Hono<AppEnv>();
reports.use('*', requireAdmin);

/** Seasons that have data, newest first, always including the current one. */
reports.get('/seasons', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT MIN(entry_date) AS first, MAX(entry_date) AS last FROM entries WHERE deleted_at IS NULL',
  ).first<{ first: string | null; last: string | null }>();
  const current = seasonOf(todayInIndia());
  const first = row?.first ? seasonOf(row.first) : current;
  const last = Math.max(row?.last ? seasonOf(row.last) : current, current);
  const years: number[] = [];
  for (let y = last; y >= first; y--) years.push(y);
  return c.json({ current, years });
});

reports.get('/season/:year', async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return c.json({ error: 'bad_year' }, 400);
  const cur = season(year);
  const prev = season(year - 1);
  const db = c.env.DB;

  const byMonth = (from: string, to: string) =>
    db.prepare(
      `SELECT substr(entry_date, 1, 7) AS ym, kind, SUM(amount_paise) AS paise
         FROM entries WHERE deleted_at IS NULL AND entry_date >= ? AND entry_date < ?
        GROUP BY ym, kind`,
    ).bind(from, to);
  const byCategory = (from: string, to: string) =>
    db.prepare(
      `SELECT category_id, SUM(amount_paise) AS paise, COUNT(*) AS count
         FROM entries WHERE deleted_at IS NULL AND entry_date >= ? AND entry_date < ?
        GROUP BY category_id`,
    ).bind(from, to);
  const labor = (from: string, to: string) =>
    db.prepare(
      `SELECT COALESCE(SUM(e.amount_paise), 0) AS paise,
              COALESCE(SUM(e.workers), 0) AS worker_days,
              COALESCE(SUM(CASE WHEN e.workers > 0 THEN e.amount_paise END), 0) AS paise_with_count
         FROM entries e JOIN categories k ON k.id = e.category_id
        WHERE e.deleted_at IS NULL AND k.tracks_workers = 1 AND e.entry_date >= ? AND e.entry_date < ?`,
    ).bind(from, to);

  const [curMonths, prevMonths, curCats, prevCats, curLabor, prevLabor, review, count] = await db.batch([
    byMonth(cur.from, cur.to),
    byMonth(prev.from, prev.to),
    byCategory(cur.from, cur.to),
    byCategory(prev.from, prev.to),
    labor(cur.from, cur.to),
    labor(prev.from, prev.to),
    db.prepare('SELECT COUNT(*) AS n FROM entries WHERE deleted_at IS NULL AND review_note IS NOT NULL'),
    db.prepare('SELECT COUNT(*) AS n FROM entries WHERE deleted_at IS NULL AND entry_date >= ? AND entry_date < ?')
      .bind(cur.from, cur.to),
  ]);

  const current = fold(curMonths.results as unknown as MonthRow[], cur.months);
  const previous = fold(prevMonths.results as unknown as MonthRow[], prev.months);
  const prevByCat = new Map(
    (prevCats.results as { category_id: number; paise: number }[]).map((r) => [r.category_id, r.paise]),
  );
  const catRows = curCats.results as { category_id: number; paise: number; count: number }[];
  const categoryIds = new Set([...catRows.map((r) => r.category_id), ...prevByCat.keys()]);
  const cl = curLabor.results[0] as { paise: number; worker_days: number; paise_with_count: number };
  const pl = prevLabor.results[0] as { worker_days: number };

  const body: SeasonReport = {
    year,
    from: cur.from,
    to: cur.to,
    months: cur.months,
    totals: current.totals,
    monthly: current.monthly,
    previous: { year: year - 1, ...previous },
    categories: [...categoryIds].map((id) => {
      const r = catRows.find((x) => x.category_id === id);
      return { categoryId: id, paise: r?.paise ?? 0, count: r?.count ?? 0, previousPaise: prevByCat.get(id) ?? 0 };
    }),
    labor: {
      paise: cl.paise,
      workerDays: cl.worker_days,
      paiseWithCount: cl.paise_with_count,
      previousWorkerDays: pl.worker_days,
    },
    reviewCount: (review.results[0] as { n: number }).n,
    entryCount: (count.results[0] as { n: number }).n,
  };
  return c.json(body);
});

reports.get('/activity', async (c) => {
  const before = Number(c.req.query('before')) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.entry_id, a.action, a.at, a.before_json, a.after_json, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.id < ? ORDER BY a.id DESC LIMIT ?`,
  )
    .bind(before, limit + 1)
    .all<{ id: number; entry_id: string; action: ActivityItem['action']; at: number; before_json: string | null;
      after_json: string | null; user_name: string | null }>();
  const page = results.slice(0, limit);
  return c.json({
    items: page.map((r): ActivityItem => ({
      id: r.id,
      entryId: r.entry_id,
      action: r.action,
      userName: r.user_name,
      at: r.at,
      before: r.before_json ? JSON.parse(r.before_json) : null,
      after: r.after_json ? JSON.parse(r.after_json) : null,
    })),
    nextBefore: results.length > limit ? page[page.length - 1].id : null,
  });
});

const csvCell = (v: string | number | null) => {
  if (v === null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Streams every live entry in the range as CSV, reading in keyset pages so memory stays flat. */
reports.get('/export.csv', async (c) => {
  const from = c.req.query('from') ?? '0000-01-01';
  const to = c.req.query('to') ?? '9999-12-31';
  const db = c.env.DB;
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  c.executionCtx.waitUntil((async () => {
    try {
      await writer.write(enc.encode('﻿Date,Type,Category,Amount (Rs),Workers,Note,Entered by,Voucher,Needs review\n'));
      let cursor: [string, string] | null = null;
      for (;;) {
        const res: D1Result<Record<string, string | number | null>> = await db.prepare(
          `SELECT e.id, e.entry_date, e.date_is_month_only, e.kind, k.name_en, e.amount_paise, e.workers, e.note,
                  u.name AS by_name, e.ref, e.review_note
             FROM entries e JOIN categories k ON k.id = e.category_id LEFT JOIN users u ON u.id = e.created_by
            WHERE e.deleted_at IS NULL AND e.entry_date >= ? AND e.entry_date < ?
              ${cursor ? 'AND (e.entry_date, e.id) > (?, ?)' : ''}
            ORDER BY e.entry_date, e.id LIMIT 500`,
        ).bind(from, to, ...(cursor ?? [])).all();
        const results = res.results;
        if (results.length === 0) break;
        const lines = results.map((r) => [
          r.date_is_month_only ? String(r.entry_date).slice(0, 7) : r.entry_date,
          r.kind, r.name_en, Number(r.amount_paise) / 100, r.workers, r.note, r.by_name ?? 'Spreadsheet import',
          r.ref, r.review_note,
        ].map(csvCell).join(','));
        await writer.write(enc.encode(lines.join('\n') + '\n'));
        const last = results[results.length - 1];
        cursor = [String(last.entry_date), String(last.id)];
      }
    } finally {
      await writer.close();
    }
  })());

  return new Response(readable, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="farmhouse-${from.slice(0, 7)}-to-${to.slice(0, 7)}.csv"`,
    },
  });
});
