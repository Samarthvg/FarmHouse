// Weekly database backups to R2, plus the admin API to list, run and download them.
//
// Format: gzip-compressed JSON lines. The first line describes the backup; every other line is
// {"t": table, "r": row}. scripts/restore-backup.ts turns a file back into SQL for D1.
//
// Rows are read in keyset pages and streamed through gzip into an R2 multipart upload,
// so memory stays flat however large the history grows.

import { Hono } from 'hono';
import type { BackupInfo } from '../shared/types.ts';
import { requireAdmin } from './auth.ts';
import type { AppEnv } from './env.ts';

type Env = AppEnv['Bindings'];

export const BACKUP_FORMAT = 'farmhouse-backup';
export const BACKUP_VERSION = 1;
const PREFIX = 'backups/';
const PAGE = 500;
const PART_BYTES = 8 * 1024 * 1024; // R2 needs at least 5 MiB for every part but the last

// Parent tables first, so a restore can insert in this order. Sessions are left out on purpose:
// after a restore everyone simply signs in again.
const TABLES: { name: string; key: string; integerKey: boolean }[] = [
  { name: 'users', key: 'id', integerKey: true },
  { name: 'categories', key: 'id', integerKey: true },
  { name: 'entries', key: 'id', integerKey: false },
  { name: 'photos', key: 'id', integerKey: false },
  { name: 'audit_log', key: 'id', integerKey: true },
];

async function* lines(db: D1Database, counts: Record<string, number>) {
  const migrations = await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>()
    .then((r) => r.results.map((m) => m.name))
    .catch(() => [] as string[]);
  yield JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), migrations }) + '\n';

  for (const t of TABLES) {
    counts[t.name] = 0;
    let after: number | string = t.integerKey ? Number.MIN_SAFE_INTEGER : '';
    for (;;) {
      const { results } = await db.prepare(`SELECT * FROM ${t.name} WHERE ${t.key} > ? ORDER BY ${t.key} LIMIT ?`)
        .bind(after, PAGE).all<Record<string, unknown>>();
      if (results.length === 0) break;
      yield results.map((r) => JSON.stringify({ t: t.name, r })).join('\n') + '\n';
      counts[t.name] += results.length;
      after = results[results.length - 1][t.key] as number | string;
      if (results.length < PAGE) break;
    }
  }
}

export async function runBackup(env: Env): Promise<BackupInfo> {
  const key = `${PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl.gz`;
  const counts: Record<string, number> = {};
  const gzip = new CompressionStream('gzip');
  const upload = await env.FILES.createMultipartUpload(key, {
    httpMetadata: { contentType: 'application/gzip' },
  });

  // Producer: database rows -> gzip.
  const produce = (async () => {
    const writer = gzip.writable.getWriter();
    const enc = new TextEncoder();
    try {
      for await (const chunk of lines(env.DB, counts)) await writer.write(enc.encode(chunk));
      await writer.close();
    } catch (err) {
      await writer.abort(err).catch(() => {});
      throw err;
    }
  })();

  // Consumer: gzip -> R2 parts.
  const consume = (async () => {
    const reader = gzip.readable.getReader();
    const parts: R2UploadedPart[] = [];
    let buffered: Uint8Array[] = [];
    let size = 0;
    let total = 0;
    const flushPart = async () => {
      const part = new Uint8Array(size);
      let offset = 0;
      for (const b of buffered) { part.set(b, offset); offset += b.length; }
      parts.push(await upload.uploadPart(parts.length + 1, part));
      total += size;
      buffered = [];
      size = 0;
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered.push(value);
      size += value.length;
      if (size >= PART_BYTES) await flushPart();
    }
    if (size > 0 || parts.length === 0) await flushPart();
    return { parts, total };
  })();

  try {
    const [, { parts, total }] = await Promise.all([produce, consume]);
    await upload.complete(parts);
    return { key, size: total, uploaded: new Date().toISOString(), rows: counts };
  } catch (err) {
    await upload.abort().catch(() => {});
    throw err;
  }
}

export const backups = new Hono<AppEnv>();
backups.use('*', requireAdmin);

/** Most recent backups first. A weekly schedule keeps this list small for decades. */
backups.get('/', async (c) => {
  const items: BackupInfo[] = [];
  let cursor: string | undefined;
  do {
    const page = await c.env.FILES.list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const o of page.objects) items.push({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString() });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  items.sort((a, b) => b.key.localeCompare(a.key));
  return c.json(items.slice(0, 20));
});

backups.post('/', async (c) => c.json(await runBackup(c.env), 201));

backups.get('/download', async (c) => {
  const key = c.req.query('key') ?? '';
  if (!key.startsWith(PREFIX) || key.includes('..')) return c.json({ error: 'bad_key' }, 400);
  const obj = await c.env.FILES.get(key);
  if (!obj) return c.json({ error: 'not_found' }, 404);
  return new Response(obj.body, {
    headers: {
      'content-type': 'application/gzip',
      'content-disposition': `attachment; filename="${key.slice(PREFIX.length)}"`,
    },
  });
});
