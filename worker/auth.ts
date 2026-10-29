import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ADMIN_IDLE_MS, type Me } from '../shared/types.ts';
import type { AppEnv } from './env.ts';

const COOKIE = 'fh_session';
const SESSION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const lifetime = (role: Me['role']) => (role === 'admin' ? ADMIN_IDLE_MS : SESSION_DAYS * DAY_MS);

export async function startSession(c: Context<AppEnv>, userId: number, role: Me['role']): Promise<void> {
  const token = randomToken();
  const now = Date.now();
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now + lifetime(role))
    .run();
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    // An admin cookie also ends when the browser closes; the server-side idle limit is what enforces it.
    ...(role === 'admin' ? {} : { maxAge: SESSION_DAYS * 24 * 60 * 60 }),
  });
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: '/' });
}

/**
 * Resolves the signed-in user and slides the session forward: an entry phone in daily use never logs
 * out, and an admin session lasts ADMIN_IDLE_MS past its last request.
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ error: 'signed_out' }, 401);
  const hash = await sha256(token);
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.role, u.lang, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
  )
    .bind(hash, now)
    .first<{ id: number; name: string; role: Me['role']; lang: Me['lang']; expires_at: number }>();
  if (!row) {
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ error: 'signed_out' }, 401);
  }
  const target = now + lifetime(row.role);
  // Renew at most about once a minute for admins and once every few months for phones. A session
  // longer than its role allows (one made before the limit existed) is cut back to the limit.
  const slack = row.role === 'admin' ? 60_000 : (SESSION_DAYS / 2) * DAY_MS;
  if (row.expires_at < target - slack || row.expires_at > target) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(target, hash).run(),
    );
  }
  c.set('user', { id: row.id, name: row.name, role: row.role, lang: row.lang });
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
};

/**
 * Rejects cross-site writes. SameSite=Lax already blocks most; this also covers older browsers.
 * Requests without an Origin header (same-origin GETs, curl) are left to the cookie check.
 */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'bad_origin' }, 403);
  }
  await next();
};
