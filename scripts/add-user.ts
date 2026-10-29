// Creates a user directly in D1. Used once to create the first admin; after that, add people from the app.
//
//   npm run user:add -- --name "Samarth" --role admin --pin 1234 [--lang en] [--remote]
//   npm run user:add -- --name "Their name" --role user --pin 1234 --remote

import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { hashPin, isValidPin } from '../shared/pin.ts';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    role: { type: 'string', default: 'manager' },
    pin: { type: 'string' },
    lang: { type: 'string' },
    remote: { type: 'boolean', default: false },
  },
});

const { name, pin, remote } = values;
// "user" is the label shown in the app for the entry-only role, stored as 'manager'.
const role = values.role === 'user' ? 'manager' : values.role;
const lang = values.lang ?? (role === 'admin' ? 'en' : 'hi');
if (!name || !pin || !['admin', 'manager'].includes(role!) || !['hi', 'en'].includes(lang)) {
  console.error('usage: npm run user:add -- --name <name> --role admin|user --pin <4 digits> [--lang hi|en] [--remote]');
  process.exit(1);
}
if (!isValidPin(pin)) {
  console.error('PIN must be exactly 4 digits');
  process.exit(1);
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sql = `INSERT INTO users (name, role, lang, pin_hash, created_at) VALUES (${q(name)}, ${q(role!)}, ${q(lang)}, ${q(await hashPin(pin))}, ${Date.now()});`;

const wrangler = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url);
const result = spawnSync(
  process.execPath,
  [wrangler.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'd1', 'execute', 'farmhouse', remote ? '--remote' : '--local', '--command', sql],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
