import { Hono } from 'hono';
import { requireUser, sameOrigin } from './auth.ts';
import { categories } from './categories.ts';
import { entries } from './entries.ts';
import type { AppEnv } from './env.ts';
import { reports } from './reports.ts';
import { session, users } from './users.ts';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', sameOrigin);
app.use('*', async (c, next) => {
  await next();
  c.header('cache-control', 'no-store');
});

app.route('/', session);
app.use('/categories/*', requireUser);
app.use('/entries/*', requireUser);
app.use('/reports/*', requireUser);
app.route('/categories', categories);
app.route('/entries', entries);
app.route('/reports', reports);
app.route('/users', users);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

export default app;
