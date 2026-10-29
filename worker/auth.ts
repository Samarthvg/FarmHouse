import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Me } from '../shared/types.ts';
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

export async function startSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const token = randomToken();
  const now = Date.now();
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now + SESSION_DAYS * DAY_MS)
    .run();
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: '/' });
}

/** Resolves the signed-in user, sliding the session forward so a phone in daily use never logs out. */
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
  if (row.expires_at - now < (SESSION_DAYS / 2) * DAY_MS) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
        .bind(now + SESSION_DAYS * DAY_MS, hash)
        .run(),
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
