import { Hono } from 'hono';
import { z } from 'zod';
import { UNITS, type Category } from '../shared/types.ts';
import { requireAdmin } from './auth.ts';
import type { AppEnv } from './env.ts';

interface CategoryRow {
  id: number;
  kind: Category['kind'];
  name_en: string;
  name_hi: string;
  icon: string;
  sort: number;
  show_on_entry: number;
  tracks_workers: number;
  unit: Category['unit'];
  active: number;
}

const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  kind: r.kind,
  nameEn: r.name_en,
  nameHi: r.name_hi,
  icon: r.icon,
  sort: r.sort,
  showOnEntry: r.show_on_entry === 1,
  tracksWorkers: r.tracks_workers === 1,
  unit: r.unit,
  active: r.active === 1,
});

export async function getCategory(db: D1Database, id: number): Promise<Category | null> {
  const row = await db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first<CategoryRow>();
  return row ? toCategory(row) : null;
}

const fields = z.object({
  nameEn: z.string().trim().min(1).max(60),
  nameHi: z.string().trim().min(1).max(60),
  icon: z.string().trim().max(16),
  sort: z.number().int().min(0).max(10_000),
  showOnEntry: z.boolean(),
  tracksWorkers: z.boolean(),
  unit: z.enum(UNITS).nullable(),
  active: z.boolean(),
});
// Kind is fixed at creation: every entry stores its kind, and moving a category between kinds would orphan that.
const createSchema = fields.partial({ icon: true, sort: true, showOnEntry: true, tracksWorkers: true, unit: true, active: true })
  .extend({ kind: z.enum(['expense', 'income', 'capital']) });
const updateSchema = fields.partial();

export const categories = new Hono<AppEnv>();

categories.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY kind, sort, name_en').all<CategoryRow>();
  const all = results.map(toCategory);
  return c.json(c.get('user').role === 'admin' ? all : all.filter((x) => x.active));
});

categories.post('/', requireAdmin, async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
  const p = parsed.data;
  try {
    const row = await c.env.DB.prepare(
      `INSERT INTO categories (kind, name_en, name_hi, icon, sort, show_on_entry, tracks_workers, unit, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
      .bind(p.kind, p.nameEn, p.nameHi, p.icon ?? '', p.sort ?? 100, p.showOnEntry === false ? 0 : 1,
        p.tracksWorkers ? 1 : 0, p.unit ?? null, p.active === false ? 0 : 1)
      .first<CategoryRow>();
    return c.json(toCategory(row!), 201);
  } catch (err) {
    if (String(err).includes('UNIQUE')) return c.json({ error: 'duplicate_name' }, 409);
    throw err;
  }
});

categories.patch('/:id', requireAdmin, async (c) => {
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
  const existing = await getCategory(c.env.DB, Number(c.req.param('id')));
  if (!existing) return c.json({ error: 'not_found' }, 404);
  const n = { ...existing, ...parsed.data };
  try {
    await c.env.DB.prepare(
      `UPDATE categories SET name_en = ?, name_hi = ?, icon = ?, sort = ?, show_on_entry = ?, tracks_workers = ?, unit = ?, active = ?
        WHERE id = ?`,
    )
      .bind(n.nameEn, n.nameHi, n.icon, n.sort, n.showOnEntry ? 1 : 0, n.tracksWorkers ? 1 : 0, n.unit, n.active ? 1 : 0, n.id)
      .run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) return c.json({ error: 'duplicate_name' }, 409);
    throw err;
  }
  return c.json(n);
});
