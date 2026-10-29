import { Hono } from 'hono';
import { z } from 'zod';
import { hashPin, isValidPin, verifyPin } from '../shared/pin.ts';
import type { UserRow } from '../shared/types.ts';
import { lockDurationMs } from '../shared/lockout.ts';
import { endSession, requireAdmin, requireUser, startSession } from './auth.ts';
import type { AppEnv } from './env.ts';

interface DbUser {
  id: number;
  name: string;
  role: UserRow['role'];
  lang: UserRow['lang'];
  pin_hash: string;
  active: number;
  failed_attempts: number;
  locked_until: number | null;
  created_at: number;
}

const toUserRow = (u: DbUser): UserRow => ({
  id: u.id,
  name: u.name,
  role: u.role,
  lang: u.lang,
  active: u.active === 1,
  lockedUntil: u.locked_until && u.locked_until > Date.now() ? u.locked_until : null,
  createdAt: u.created_at,
});

const pin = z.string().refine(isValidPin, 'PIN must be 4 digits');

export const session = new Hono<AppEnv>();

/** Names shown on the sign-in screen, so nobody has to type a username. */
session.get('/login-users', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, role FROM users WHERE active = 1 ORDER BY role = 'admin', name",
  ).all<{ id: number; name: string; role: string }>();
  return c.json(results);
});

session.post('/login', async (c) => {
  const parsed = z.object({ userId: z.number().int(), pin: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid' }, 400);
  const { userId, pin: attempt } = parsed.data;
  const db = c.env.DB;
  const user = await db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').bind(userId).first<DbUser>();
  if (!user) return c.json({ error: 'wrong_pin' }, 401);

  const now = Date.now();
  if (user.locked_until && user.locked_until > now) {
    return c.json({ error: 'locked', until: user.locked_until }, 429);
  }
  if (!isValidPin(attempt) || !(await verifyPin(attempt, user.pin_hash))) {
    const failures = user.failed_attempts + 1;
    const lockMs = lockDurationMs(failures);
    await db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
      .bind(failures, lockMs ? now + lockMs : null, user.id).run();
    if (lockMs) return c.json({ error: 'locked', until: now + lockMs }, 429);
    return c.json({ error: 'wrong_pin' }, 401);
  }

  await db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(user.id).run();
  await startSession(c, user.id, user.role);
  return c.json({ id: user.id, name: user.name, role: user.role, lang: user.lang });
});

session.post('/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

session.get('/me', requireUser, (c) => c.json(c.get('user')));

session.patch('/me', requireUser, async (c) => {
  const parsed = z.object({ lang: z.enum(['hi', 'en']) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid' }, 400);
  const user = c.get('user');
  await c.env.DB.prepare('UPDATE users SET lang = ? WHERE id = ?').bind(parsed.data.lang, user.id).run();
  return c.json({ ...user, lang: parsed.data.lang });
});

export const users = new Hono<AppEnv>();
users.use('*', requireUser, requireAdmin);

users.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM users ORDER BY id').all<DbUser>();
  return c.json(results.map(toUserRow));
});

users.post('/', async (c) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(40),
    role: z.enum(['admin', 'manager']),
    lang: z.enum(['hi', 'en']).default('hi'),
    pin,
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
  const p = parsed.data;
  const row = await c.env.DB.prepare(
    'INSERT INTO users (name, role, lang, pin_hash, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
  ).bind(p.name, p.role, p.lang, await hashPin(p.pin), Date.now()).first<DbUser>();
  return c.json(toUserRow(row!), 201);
});

users.patch('/:id', async (c) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(40),
    lang: z.enum(['hi', 'en']),
    active: z.boolean(),
    pin,
    unlock: z.literal(true),
  }).partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
  const p = parsed.data;
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<DbUser>();
  if (!user) return c.json({ error: 'not_found' }, 404);
  if (id === c.get('user').id && p.active === false) return c.json({ error: 'cannot_deactivate_self' }, 400);

  const stmts: D1PreparedStatement[] = [];
  if (p.name !== undefined) stmts.push(db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(p.name, id));
  if (p.lang !== undefined) stmts.push(db.prepare('UPDATE users SET lang = ? WHERE id = ?').bind(p.lang, id));
  if (p.active !== undefined) stmts.push(db.prepare('UPDATE users SET active = ? WHERE id = ?').bind(p.active ? 1 : 0, id));
  if (p.unlock || p.pin) {
    stmts.push(db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(id));
  }
  if (p.pin) stmts.push(db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').bind(await hashPin(p.pin), id));
  // A new PIN or deactivation signs the person out everywhere.
  if (p.pin || p.active === false) stmts.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  if (stmts.length) await db.batch(stmts);

  const updated = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<DbUser>();
  return c.json(toUserRow(updated!));
});
