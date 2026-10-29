import { Hono } from 'hono';
import { z } from 'zod';
import { addDays, isValidIsoDate, todayInIndia } from '../shared/season.ts';
import {
  MANAGER_BACKDATE_DAYS,
  MANAGER_EDIT_WINDOW_MS,
  type Entry,
  type EntryPage,
  type Me,
} from '../shared/types.ts';
import { getCategory } from './categories.ts';
import type { AppEnv } from './env.ts';

const PAGE_MAX = 100;

interface EntryRow {
  id: string;
  kind: Entry['kind'];
  category_id: number;
  entry_date: string;
  date_is_month_only: number;
  amount_paise: number;
  workers: number | null;
  note: string;
  ref: string | null;
  review_note: string | null;
  source: Entry['source'];
  created_by: number | null;
  created_by_name: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const SELECT_ENTRY = `
  SELECT e.*, u.name AS created_by_name
    FROM entries e LEFT JOIN users u ON u.id = e.created_by`;

function canEdit(row: EntryRow, user: Me, now = Date.now()): boolean {
  if (user.role === 'admin') return true;
  return row.deleted_at === null && row.created_by === user.id && now - row.created_at < MANAGER_EDIT_WINDOW_MS;
}

function toEntry(row: EntryRow, user: Me): Entry {
  return {
    id: row.id,
    kind: row.kind,
    categoryId: row.category_id,
    date: row.entry_date,
    dateIsMonthOnly: row.date_is_month_only === 1,
    amountPaise: row.amount_paise,
    workers: row.workers,
    note: row.note,
    ref: row.ref,
    reviewNote: row.review_note,
    source: row.source,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    editable: canEdit(row, user),
  };
}

/** The fields worth keeping in the audit trail. */
function snapshot(row: EntryRow) {
  return {
    categoryId: row.category_id,
    date: row.entry_date,
    amountPaise: row.amount_paise,
    workers: row.workers,
    note: row.note,
    reviewNote: row.review_note,
  };
}

const auditStmt = (db: D1Database, entryId: string, userId: number, action: string, before: unknown, after: unknown) =>
  db
    .prepare('INSERT INTO audit_log (entry_id, user_id, action, before_json, after_json, at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(entryId, userId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, Date.now());

const amount = z.number().int().positive().max(100_000_000_00);
const workers = z.number().int().min(0).max(1000).nullable();
const note = z.string().trim().max(2000);
const date = z.string().refine(isValidIsoDate, 'invalid date');

const createSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.number().int().positive(),
  date,
  amountPaise: amount,
  workers: workers.default(null),
  note: note.default(''),
});

const updateSchema = z
  .object({
    categoryId: z.number().int().positive(),
    date,
    amountPaise: amount,
    workers,
    note,
    reviewNote: z.string().trim().max(500).nullable(),
  })
  .partial();

const listSchema = z.object({
  from: date.optional(),
  to: date.optional(), // exclusive
  kind: z.enum(['expense', 'income', 'capital']).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(100).optional(),
  review: z.literal('1').optional(),
  deleted: z.literal('1').optional(),
  mine: z.literal('1').optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(50),
  cursor: z.string().optional(),
});

function encodeCursor(row: EntryRow): string {
  return btoa(JSON.stringify([row.entry_date, row.created_at, row.id]));
}

function decodeCursor(cursor: string): [string, number, string] | null {
  try {
    const v = JSON.parse(atob(cursor));
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'number' && typeof v[2] === 'string') {
      return v as [string, number, string];
    }
  } catch {
    // fall through
  }
  return null;
}

/** Date rules for managers: nothing in the future, nothing older than the backdate window. */
function managerDateError(d: string): string | null {
  const today = todayInIndia();
  if (d > today) return 'date_in_future';
  if (d < addDays(today, -MANAGER_BACKDATE_DAYS)) return 'date_too_old';
  return null;
}

export const entries = new Hono<AppEnv>();

entries.get('/', async (c) => {
  const user = c.get('user');
  const parsed = listSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'bad_query' }, 400);
  const p = parsed.data;

  const where: string[] = [];
  const args: unknown[] = [];
  // Managers only ever see their own entries.
  if (user.role !== 'admin' || p.mine) {
    where.push('e.created_by = ?');
    args.push(user.id);
  }
  where.push(p.deleted && user.role === 'admin' ? 'e.deleted_at IS NOT NULL' : 'e.deleted_at IS NULL');
  if (p.from) { where.push('e.entry_date >= ?'); args.push(p.from); }
  if (p.to) { where.push('e.entry_date < ?'); args.push(p.to); }
  if (p.kind) { where.push('e.kind = ?'); args.push(p.kind); }
  if (p.categoryId) { where.push('e.category_id = ?'); args.push(p.categoryId); }
  if (p.review) where.push('e.review_note IS NOT NULL');
  if (p.q) {
    where.push("e.note LIKE ? ESCAPE '\\'");
    args.push(`%${p.q.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
  }
  if (p.cursor) {
    const cur = decodeCursor(p.cursor);
    if (!cur) return c.json({ error: 'bad_cursor' }, 400);
    where.push('(e.entry_date, e.created_at, e.id) < (?, ?, ?)');
    args.push(...cur);
  }

  const { results } = await c.env.DB.prepare(
    `${SELECT_ENTRY} WHERE ${where.join(' AND ')}
      ORDER BY e.entry_date DESC, e.created_at DESC, e.id DESC LIMIT ?`,
  )
    .bind(...args, p.limit + 1)
    .all<EntryRow>();

  const page = results.slice(0, p.limit);
  const body: EntryPage = {
    entries: page.map((r) => toEntry(r, user)),
    nextCursor: results.length > p.limit ? encodeCursor(page[page.length - 1]) : null,
  };
  return c.json(body);
});

entries.get('/:id', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(`${SELECT_ENTRY} WHERE e.id = ?`).bind(c.req.param('id')).first<EntryRow>();
  if (!row || (user.role !== 'admin' && (row.created_by !== user.id || row.deleted_at !== null))) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json(toEntry(row, user));
});

entries.post('/', async (c) => {
  const user = c.get('user');
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
  const input = parsed.data;

  const category = await getCategory(c.env.DB, input.categoryId);
  if (!category || !category.active) return c.json({ error: 'bad_category' }, 400);
  if (user.role !== 'admin') {
    if (!category.showOnEntry || category.kind === 'capital') return c.json({ error: 'bad_category' }, 403);
    const dateError = managerDateError(input.date);
    if (dateError) return c.json({ error: dateError }, 400);
  }

  const now = Date.now();
  const row: EntryRow = {
    id: input.id,
    kind: category.kind,
    category_id: category.id,
    entry_date: input.date,
    date_is_month_only: 0,
    amount_paise: input.amountPaise,
    workers: category.tracksWorkers ? input.workers : null,
    note: input.note,
    ref: null,
    review_note: null,
    source: 'app',
    created_by: user.id,
    created_by_name: user.name,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO entries (id, kind, category_id, entry_date, amount_paise, workers, note, source,
                              created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'app', ?, ?, ?, ?)`,
      ).bind(row.id, row.kind, row.category_id, row.entry_date, row.amount_paise, row.workers, row.note,
        user.id, now, user.id, now),
      auditStmt(c.env.DB, row.id, user.id, 'create', null, snapshot(row)),
    ]);
  } catch (err) {
    // A retry of an entry that already reached the server (e.g. sent again from the offline queue).
    if (!String(err).includes('UNIQUE')) throw err;
    const existing = await c.env.DB.prepare(`${SELECT_ENTRY} WHERE e.id = ?`).bind(input.id).first<EntryRow>();
    if (!existing || existing.created_by !== user.id) return c.json({ error: 'conflict' }, 409);
    return c.json(toEntry(existing, user), 200);
  }
  return c.json(toEntry(row, user), 201);
});

entries.patch('/:id', async (c) => {
  const user = c.get('user');
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
  const input = parsed.data;

  const existing = await c.env.DB.prepare(`${SELECT_ENTRY} WHERE e.id = ?`).bind(c.req.param('id')).first<EntryRow>();
  if (!existing || existing.deleted_at !== null) return c.json({ error: 'not_found' }, 404);
  if (!canEdit(existing, user)) return c.json({ error: 'forbidden' }, 403);
  if (input.reviewNote !== undefined && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

  const next: EntryRow = { ...existing };
  if (input.categoryId !== undefined && input.categoryId !== existing.category_id) {
    const category = await getCategory(c.env.DB, input.categoryId);
    if (!category || !category.active) return c.json({ error: 'bad_category' }, 400);
    if (user.role !== 'admin' && (!category.showOnEntry || category.kind === 'capital')) {
      return c.json({ error: 'bad_category' }, 403);
    }
    next.category_id = category.id;
    next.kind = category.kind;
    if (!category.tracksWorkers) next.workers = null;
  }
  if (input.date !== undefined && input.date !== existing.entry_date) {
    if (user.role !== 'admin') {
      const dateError = managerDateError(input.date);
      if (dateError) return c.json({ error: dateError }, 400);
    }
    next.entry_date = input.date;
    next.date_is_month_only = 0;
  }
  if (input.amountPaise !== undefined) next.amount_paise = input.amountPaise;
  if (input.note !== undefined) next.note = input.note;
  if (input.reviewNote !== undefined) next.review_note = input.reviewNote || null;
  if (input.workers !== undefined) {
    const category = await getCategory(c.env.DB, next.category_id);
    next.workers = category?.tracksWorkers ? input.workers : null;
  }

  const now = Date.now();
  next.updated_at = now;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE entries SET kind = ?, category_id = ?, entry_date = ?, date_is_month_only = ?, amount_paise = ?,
              workers = ?, note = ?, review_note = ?, updated_by = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(next.kind, next.category_id, next.entry_date, next.date_is_month_only, next.amount_paise,
      next.workers, next.note, next.review_note, user.id, now, existing.id),
    auditStmt(c.env.DB, existing.id, user.id, 'update', snapshot(existing), snapshot(next)),
  ]);
  return c.json(toEntry(next, user));
});

entries.delete('/:id', async (c) => {
  const user = c.get('user');
  const existing = await c.env.DB.prepare(`${SELECT_ENTRY} WHERE e.id = ?`).bind(c.req.param('id')).first<EntryRow>();
  if (!existing || existing.deleted_at !== null) return c.json({ error: 'not_found' }, 404);
  if (!canEdit(existing, user)) return c.json({ error: 'forbidden' }, 403);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE entries SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .bind(now, user.id, now, existing.id),
    auditStmt(c.env.DB, existing.id, user.id, 'delete', snapshot(existing), null),
  ]);
  return c.json({ ok: true });
});

entries.post('/:id/restore', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const existing = await c.env.DB.prepare(`${SELECT_ENTRY} WHERE e.id = ?`).bind(c.req.param('id')).first<EntryRow>();
  if (!existing || existing.deleted_at === null) return c.json({ error: 'not_found' }, 404);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE entries SET deleted_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?')
      .bind(user.id, now, existing.id),
    auditStmt(c.env.DB, existing.id, user.id, 'restore', null, snapshot(existing)),
  ]);
  return c.json(toEntry({ ...existing, deleted_at: null, updated_at: now }, user));
});
