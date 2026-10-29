import { Hono } from 'hono';
import { z } from 'zod';
import { addDays, isValidIsoDate, todayInIndia } from '../shared/season.ts';
import {
  MANAGER_BACKDATE_DAYS,
  MANAGER_EDIT_WINDOW_MS,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_ENTRY,
  type Entry,
  type EntryPage,
  type Me,
  type PhotoRef,
} from '../shared/types.ts';
import { getCategory } from './categories.ts';
import type { AppEnv } from './env.ts';

const PAGE_MAX = 100;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface EntryRow {
  id: string;
  kind: Entry['kind'];
  category_id: number;
  entry_date: string;
  date_is_month_only: number;
  amount_paise: number;
  workers: number | null;
  quantity: number | null;
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

/** Managers may only see their own entries; admins see everything. */
function canView(row: EntryRow, user: Me): boolean {
  return user.role === 'admin' || (row.created_by === user.id && row.deleted_at === null);
}

function toEntry(row: EntryRow, user: Me, photos: PhotoRef[] = []): Entry {
  return {
    id: row.id,
    kind: row.kind,
    categoryId: row.category_id,
    date: row.entry_date,
    dateIsMonthOnly: row.date_is_month_only === 1,
    amountPaise: row.amount_paise,
    workers: row.workers,
    quantity: row.quantity,
    note: row.note,
    ref: row.ref,
    reviewNote: row.review_note,
    source: row.source,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    photos,
    editable: canEdit(row, user),
  };
}

/** Live photos for a set of entries, in one query. Callers pass at most PAGE_MAX ids. */
async function photosFor(db: D1Database, entryIds: string[]): Promise<Map<string, PhotoRef[]>> {
  const out = new Map<string, PhotoRef[]>();
  if (entryIds.length === 0) return out;
  const { results } = await db.prepare(
    `SELECT id, entry_id, bytes FROM photos
      WHERE deleted_at IS NULL AND entry_id IN (${entryIds.map(() => '?').join(',')})
      ORDER BY created_at`,
  ).bind(...entryIds).all<{ id: string; entry_id: string; bytes: number }>();
  for (const r of results) {
    const list = out.get(r.entry_id) ?? [];
    list.push({ id: r.id, bytes: r.bytes });
    out.set(r.entry_id, list);
  }
  return out;
}

const loadEntry = (db: D1Database, id: string) => db.prepare(`${SELECT_ENTRY} WHERE e.id = ?`).bind(id).first<EntryRow>();

/** The fields worth keeping in the audit trail. */
function snapshot(row: EntryRow) {
  return {
    categoryId: row.category_id,
    date: row.entry_date,
    amountPaise: row.amount_paise,
    workers: row.workers,
    quantity: row.quantity,
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
const quantity = z.number().int().positive().max(10_000_000).nullable();
const note = z.string().trim().max(2000);
const date = z.string().refine(isValidIsoDate, 'invalid date');

const createSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.number().int().positive(),
  date,
  amountPaise: amount,
  workers: workers.default(null),
  quantity: quantity.default(null),
  note: note.default(''),
});

const updateSchema = z
  .object({
    categoryId: z.number().int().positive(),
    date,
    amountPaise: amount,
    workers,
    quantity,
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
  const photos = await photosFor(c.env.DB, page.map((r) => r.id));
  const body: EntryPage = {
    entries: page.map((r) => toEntry(r, user, photos.get(r.id))),
    nextCursor: results.length > p.limit ? encodeCursor(page[page.length - 1]) : null,
  };
  return c.json(body);
});

entries.get('/:id', async (c) => {
  const user = c.get('user');
  const row = await loadEntry(c.env.DB, c.req.param('id'));
  if (!row || !canView(row, user)) return c.json({ error: 'not_found' }, 404);
  const photos = await photosFor(c.env.DB, [row.id]);
  return c.json(toEntry(row, user, photos.get(row.id)));
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
    quantity: category.unit ? input.quantity : null,
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
        `INSERT INTO entries (id, kind, category_id, entry_date, amount_paise, workers, quantity, note, source,
                              created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'app', ?, ?, ?, ?)`,
      ).bind(row.id, row.kind, row.category_id, row.entry_date, row.amount_paise, row.workers, row.quantity, row.note,
        user.id, now, user.id, now),
      auditStmt(c.env.DB, row.id, user.id, 'create', null, snapshot(row)),
    ]);
  } catch (err) {
    // A retry of an entry that already reached the server (e.g. sent again from the offline queue).
    if (!String(err).includes('UNIQUE')) throw err;
    const existing = await loadEntry(c.env.DB, input.id);
    if (!existing || existing.created_by !== user.id) return c.json({ error: 'conflict' }, 409);
    const photos = await photosFor(c.env.DB, [existing.id]);
    return c.json(toEntry(existing, user, photos.get(existing.id)), 200);
  }
  return c.json(toEntry(row, user), 201);
});

entries.patch('/:id', async (c) => {
  const user = c.get('user');
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
  const input = parsed.data;

  const existing = await loadEntry(c.env.DB, c.req.param('id'));
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
  if (input.workers !== undefined) next.workers = input.workers;
  if (input.quantity !== undefined) next.quantity = input.quantity;
  // Drop details the (possibly new) category does not use.
  const category = await getCategory(c.env.DB, next.category_id);
  if (!category?.tracksWorkers) next.workers = null;
  if (!category?.unit) next.quantity = null;

  const now = Date.now();
  next.updated_at = now;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE entries SET kind = ?, category_id = ?, entry_date = ?, date_is_month_only = ?, amount_paise = ?,
              workers = ?, quantity = ?, note = ?, review_note = ?, updated_by = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(next.kind, next.category_id, next.entry_date, next.date_is_month_only, next.amount_paise,
      next.workers, next.quantity, next.note, next.review_note, user.id, now, existing.id),
    auditStmt(c.env.DB, existing.id, user.id, 'update', snapshot(existing), snapshot(next)),
  ]);
  const photos = await photosFor(c.env.DB, [existing.id]);
  return c.json(toEntry(next, user, photos.get(existing.id)));
});

entries.delete('/:id', async (c) => {
  const user = c.get('user');
  const existing = await loadEntry(c.env.DB, c.req.param('id'));
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
  const existing = await loadEntry(c.env.DB, c.req.param('id'));
  if (!existing || existing.deleted_at === null) return c.json({ error: 'not_found' }, 404);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE entries SET deleted_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?')
      .bind(user.id, now, existing.id),
    auditStmt(c.env.DB, existing.id, user.id, 'restore', null, snapshot(existing)),
  ]);
  const photos = await photosFor(c.env.DB, [existing.id]);
  return c.json(toEntry({ ...existing, deleted_at: null, updated_at: now }, user, photos.get(existing.id)));
});

/**
 * Attaches a photo (bill, mandi slip). The client picks the photo id, so a retry after a dropped
 * connection stores nothing twice. The image body is sent as-is, already shrunk on the phone.
 */
entries.put('/:id/photos/:photoId', async (c) => {
  const user = c.get('user');
  const photoId = c.req.param('photoId');
  if (!z.string().uuid().safeParse(photoId).success) return c.json({ error: 'bad_photo_id' }, 400);
  const contentType = (c.req.header('content-type') ?? '').split(';')[0].trim();
  if (!PHOTO_TYPES.has(contentType)) return c.json({ error: 'bad_type' }, 415);
  const declared = Number(c.req.header('content-length'));
  if (declared > MAX_PHOTO_BYTES) return c.json({ error: 'too_large' }, 413);

  const db = c.env.DB;
  const entry = await loadEntry(db, c.req.param('id'));
  if (!entry || entry.deleted_at !== null || !canView(entry, user)) return c.json({ error: 'not_found' }, 404);
  if (!canEdit(entry, user)) return c.json({ error: 'forbidden' }, 403);

  const existing = await db.prepare('SELECT entry_id FROM photos WHERE id = ?').bind(photoId).first<{ entry_id: string }>();
  if (existing) {
    return existing.entry_id === entry.id ? c.json({ id: photoId }, 200) : c.json({ error: 'conflict' }, 409);
  }
  const count = await db.prepare('SELECT COUNT(*) AS n FROM photos WHERE entry_id = ? AND deleted_at IS NULL')
    .bind(entry.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_PHOTOS_PER_ENTRY) return c.json({ error: 'too_many' }, 409);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: 'empty' }, 400);
  if (body.byteLength > MAX_PHOTO_BYTES) return c.json({ error: 'too_large' }, 413);

  const key = `photos/${entry.id}/${photoId}`;
  await c.env.FILES.put(key, body, { httpMetadata: { contentType } });
  await db.prepare(
    `INSERT OR IGNORE INTO photos (id, entry_id, r2_key, content_type, bytes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(photoId, entry.id, key, contentType, body.byteLength, user.id, Date.now()).run();
  return c.json({ id: photoId }, 201);
});

/** Hides a photo from the entry. The file itself is kept, like deleted entries. */
entries.delete('/:id/photos/:photoId', async (c) => {
  const user = c.get('user');
  const entry = await loadEntry(c.env.DB, c.req.param('id'));
  if (!entry || entry.deleted_at !== null || !canView(entry, user)) return c.json({ error: 'not_found' }, 404);
  if (!canEdit(entry, user)) return c.json({ error: 'forbidden' }, 403);
  await c.env.DB.prepare('UPDATE photos SET deleted_at = ? WHERE id = ? AND entry_id = ? AND deleted_at IS NULL')
    .bind(Date.now(), c.req.param('photoId'), entry.id).run();
  return c.json({ ok: true });
});

export const photos = new Hono<AppEnv>();

photos.get('/:id', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    `SELECT p.r2_key, p.content_type, e.created_by, e.deleted_at
       FROM photos p JOIN entries e ON e.id = p.entry_id
      WHERE p.id = ? AND p.deleted_at IS NULL`,
  ).bind(c.req.param('id')).first<{ r2_key: string; content_type: string; created_by: number | null; deleted_at: number | null }>();
  if (!row || (user.role !== 'admin' && (row.created_by !== user.id || row.deleted_at !== null))) {
    return c.json({ error: 'not_found' }, 404);
  }
  const obj = await c.env.FILES.get(row.r2_key);
  if (!obj) return c.json({ error: 'not_found' }, 404);
  return new Response(obj.body, {
    headers: {
      'content-type': row.content_type,
      // Photo ids never point at different bytes, so the phone may keep them for a long time.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
});
