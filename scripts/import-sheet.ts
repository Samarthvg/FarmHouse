// Converts the FarmHouse spreadsheet export (Sheet3 CSV) into SQL for D1.
//
//   node scripts/import-sheet.ts data/sheet3.csv > data/import.sql
//   node scripts/import-sheet.ts data/sheet3.csv --quantities-only > data/quantities.sql
//
// Rows that already exist are left alone, so edits made in the app are never overwritten.
// --quantities-only fills in harvest weights on imported rows that do not have one yet.
//
// The report (what was changed, skipped or flagged) goes to stderr so it is never mixed into the SQL.

import { readFileSync } from 'node:fs';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Spreadsheet category -> app category id. Income ids are used when the Income column is filled.
const EXPENSE_CATEGORY: Record<string, number> = {
  'Labor': 1,
  'Transport': 2,
  'Supplies': 3,
  'Feed': 4,
  'Caretaker Pay': 5,
  'Supplies / Utility': 6,
  'Misc. Expenses': 7,
  'Feed / Supplies': 8,
  'CA': 9,
};
const INCOME_CATEGORY: Record<string, number> = {
  'Apple': 20, 'Pear': 21, 'Plum': 22, 'Garlic': 23, 'Gobi': 24,
  'Cow Milk': 26, 'Rent': 27, 'Other Income': 28,
};
const CAPITAL_CATEGORY = 'Owner\'s Capital Contribution';
const CAPITAL_ID = 40;
const LABOR_ID = 1;
const KG_CATEGORIES = new Set([20, 21, 22, 23, 24, 25]);

/**
 * Harvest weight written in a note: a "Total ... N kg" line wins (graded box lists), otherwise every
 * "N kg" is added up (mandi slips list one line per grade). Notes without kg give null.
 */
function parseKg(note: string): number | null {
  const total = note.match(/total[^\n]*?(\d[\d,]*)\s*kg/i);
  if (total) return Number(total[1].replace(/,/g, '')) || null;
  let sum = 0;
  for (const m of note.matchAll(/(\d[\d,]*)\s*kg\b/gi)) sum += Number(m[1].replace(/,/g, ''));
  return sum || null;
}

// Rows whose note disagrees with the amount, found by reading the sheet. Keyed by "YYYY-MM#voucher".
const MANUAL_REVIEW: Record<string, string> = {
  '2026-08#23': 'Note says net received ₹1,03,029 but the amount entered is ₹1,03,000.',
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseMonth(s: string): string | null {
  const m = s.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  return month ? `${m[2]}-${String(month).padStart(2, '0')}` : null;
}

function parseRupees(s: string): number {
  const cleaned = s.replace(/[₹,\s]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error(`Bad amount: ${s}`);
  return Math.round(n * 100);
}

const sql = (v: string | number | null) =>
  v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`;

const fmt = (paise: number) => '₹' + new Intl.NumberFormat('en-IN').format(paise / 100);

interface Entry {
  id: string; kind: 'expense' | 'income' | 'capital'; categoryId: number; month: string;
  paise: number; workers: number | null; quantity: number | null; note: string; ref: string; review: string | null;
}

const [, , file, flag] = process.argv;
if (!file) { console.error('usage: node scripts/import-sheet.ts <sheet.csv> [--quantities-only]'); process.exit(1); }
const quantitiesOnly = flag === '--quantities-only';

const rows = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const header = rows.shift()!;
if (header[0] !== 'Month' || header.length < 7) throw new Error(`Unexpected header: ${header.join(',')}`);

const entries: Entry[] = [];
const report: string[] = [];
let blank = 0;

rows.forEach((cols, i) => {
  const line = i + 2;
  const [monthRaw = '', voucher = '', descRaw = '', cat = '', workersRaw = '', expRaw = '', incRaw = ''] = cols;
  const note = descRaw.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  const expense = parseRupees(expRaw);
  const income = parseRupees(incRaw);
  if (!note && !cat && !expense && !income) { blank++; return; }

  const month = parseMonth(monthRaw);
  if (!month) throw new Error(`Line ${line}: cannot read month "${monthRaw}"`);
  if (!expense && !income) { report.push(`SKIPPED  line ${line}: "${note}" has no amount`); return; }
  if (expense && income) throw new Error(`Line ${line}: both expense and income filled`);

  const ref = voucher.trim();
  let review = MANUAL_REVIEW[`${month}#${ref}`] ?? null;
  let kind: Entry['kind'];
  let categoryId: number;

  if (cat.trim() === CAPITAL_CATEGORY) {
    kind = 'capital';
    categoryId = CAPITAL_ID;
  } else if (income) {
    kind = 'income';
    categoryId = INCOME_CATEGORY[cat.trim()];
    if (!categoryId) throw new Error(`Line ${line}: unknown income category "${cat}"`);
  } else {
    kind = 'expense';
    categoryId = EXPENSE_CATEGORY[cat.trim()];
    if (!categoryId && INCOME_CATEGORY[cat.trim()]) {
      categoryId = LABOR_ID;
      review = `Was filed under "${cat.trim()}" as an expense; moved to Labor.`;
      report.push(`MOVED    line ${line}: "${note}" ${fmt(expense)} from ${cat} expense to Labor`);
    }
    if (!categoryId) throw new Error(`Line ${line}: unknown expense category "${cat}"`);
  }

  const w = workersRaw.trim() === '' ? null : Number(workersRaw);
  // A worker count only means something on labor; 0 there means "not recorded".
  const workers = categoryId === LABOR_ID && w ? w : null;

  entries.push({
    id: `import-${String(line).padStart(4, '0')}`,
    kind, categoryId, month, paise: expense || income, workers,
    quantity: kind === 'income' && KG_CATEGORIES.has(categoryId) ? parseKg(note) : null,
    note, ref, review,
  });
});

// Flag likely double entries: same month, category, amount and note.
const seen = new Map<string, Entry>();
for (const e of entries) {
  const key = [e.month, e.categoryId, e.paise, e.note.toLowerCase()].join('|');
  const first = seen.get(key);
  if (first) {
    e.review = `Looks like a duplicate of voucher ${first.ref} (same month, amount and note).`;
    report.push(`DUP?     ${e.month} voucher ${e.ref}: "${e.note}" ${fmt(e.paise)} matches voucher ${first.ref}`);
  } else seen.set(key, e);
}

const now = Date.now();
const out: string[] = ['-- Generated by scripts/import-sheet.ts. Safe to re-run: existing rows are never changed.'];
for (const e of entries) {
  if (quantitiesOnly) {
    if (e.quantity) {
      out.push(`UPDATE entries SET quantity = ${e.quantity} WHERE id = ${sql(e.id)} AND quantity IS NULL;`);
      report.push(`KG       ${e.month} voucher ${e.ref}: ${e.quantity} kg for ${fmt(e.paise)} (${fmt(Math.round(e.paise / e.quantity))}/kg)`);
    }
    continue;
  }
  out.push(
    'INSERT OR IGNORE INTO entries (id, kind, category_id, entry_date, date_is_month_only, amount_paise, workers, quantity, note, ref, review_note, source, created_at, updated_at) VALUES (' +
      [sql(e.id), sql(e.kind), e.categoryId, sql(`${e.month}-01`), 1, e.paise, sql(e.workers), sql(e.quantity), sql(e.note), sql(e.ref || null), sql(e.review), sql('import'), now, now].join(', ') +
      ');',
  );
}
process.stdout.write(out.join('\n') + '\n');

const totals = { expense: 0, income: 0, capital: 0 };
const byMonth = new Map<string, typeof totals>();
for (const e of entries) {
  totals[e.kind] += e.paise;
  const m = byMonth.get(e.month) ?? { expense: 0, income: 0, capital: 0 };
  m[e.kind] += e.paise;
  byMonth.set(e.month, m);
}
console.error(report.join('\n'));
console.error(`\n${entries.length} entries, ${blank} blank rows ignored`);
console.error(`Expenses ${fmt(totals.expense)} | Income ${fmt(totals.income)} | Owner capital ${fmt(totals.capital)}`);
for (const [m, t] of [...byMonth].sort()) {
  console.error(`  ${m}  exp ${fmt(t.expense).padStart(11)}  inc ${fmt(t.income).padStart(10)}  cap ${fmt(t.capital).padStart(10)}`);
}
