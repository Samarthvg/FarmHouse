import { Hono } from 'hono';
import { requireUser, sameOrigin } from './auth.ts';
import { categories } from './categories.ts';
import { entries, photos } from './entries.ts';
import type { AppEnv } from './env.ts';
import { backups, runBackup } from './backup.ts';
import { reports } from './reports.ts';
import { session, users } from './users.ts';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', sameOrigin);
app.use('*', async (c, next) => {
  await next();
  // Data is private and changes constantly; routes that are safe to cache say so themselves.
  if (!c.res.headers.has('cache-control')) c.header('cache-control', 'no-store');
});

app.route('/', session);
app.use('/categories/*', requireUser);
app.use('/entries/*', requireUser);
app.use('/reports/*', requireUser);
app.use('/photos/*', requireUser);
app.use('/backups/*', requireUser);
app.route('/categories', categories);
app.route('/entries', entries);
app.route('/reports', reports);
app.route('/photos', photos);
app.route('/backups', backups);
app.route('/users', users);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

export default {
  fetch: app.fetch,
  /** Weekly cron: back up the database, and clear out expired sign-ins. */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([
      runBackup(env),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run(),
    ]));
  },
} satisfies ExportedHandler<AppEnv['Bindings']>;
