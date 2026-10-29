// Turns a backup file (downloaded from Settings → Backups) into SQL that replaces the database contents.
//
//   node scripts/restore-backup.ts backup.jsonl.gz > data/restore.sql
//   npx wrangler d1 execute farmhouse --remote --file data/restore.sql
//
// Everyone is signed out afterwards (sessions are not backed up). Photos are not touched: they stay in R2,
// and the restored photo rows point at them again.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const FORMAT = 'farmhouse-backup';
const INSERT_ORDER = ['users', 'categories', 'entries', 'photos', 'audit_log'];

const [, , file] = process.argv;
if (!file) {
  console.error('usage: node scripts/restore-backup.ts <backup.jsonl.gz>');
  process.exit(1);
}

const sqlValue = (v: unknown) =>
  v === null || v === undefined ? 'NULL'
    : typeof v === 'number' ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;

const out = (s: string) => process.stdout.write(s + '\n');

let header: { format: string; version: number; createdAt: string; migrations: string[] } | null = null;
const counts: Record<string, number> = {};

for (const line of gunzipSync(readFileSync(file)).toString('utf8').split('\n')) {
  if (!line.trim()) continue;
  const obj = JSON.parse(line);
  if (!header) {
    if (obj.format !== FORMAT || obj.version !== 1) throw new Error('Not a farmhouse backup file (or an unknown version).');
    header = obj;
    out(`-- Restore of backup taken ${obj.createdAt}. Schema at backup time: ${obj.migrations.join(', ') || 'unknown'}`);
    out('PRAGMA defer_foreign_keys = true;');
    // Children first, so foreign keys never point at a missing row.
    for (const t of ['sessions', ...[...INSERT_ORDER].reverse()]) out(`DELETE FROM ${t};`);
    continue;
  }
  const { t, r } = obj as { t: string; r: Record<string, unknown> };
  if (!INSERT_ORDER.includes(t)) throw new Error(`Unexpected table in backup: ${t}`);
  const cols = Object.keys(r);
  out(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((c) => sqlValue(r[c])).join(', ')});`);
  counts[t] = (counts[t] ?? 0) + 1;
}

if (!header) throw new Error('Empty backup file.');
console.error(`Backup from ${header.createdAt}: ${Object.entries(counts).map(([t, n]) => `${n} ${t}`).join(', ')}`);
console.error('Check that the schema listed above matches `npx wrangler d1 migrations list farmhouse --remote` before running it.');
