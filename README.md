# Farm Ledger

A phone-first app for recording farm expenses and income, with a dashboard for the owner.

- **User** (whoever enters the day-to-day records): taps their name, enters a 4-digit PIN, and adds entries one simple step at a time
  (category tile → amount on a big keypad → workers → date and note). Hindi by default, one tap for English.
  Entries saved with no signal are kept on the phone and sent when the connection returns.
- **Admin**: season dashboard (Dec–Nov), month-by-month and year-over-year comparison, category breakdown,
  labor stats, a searchable list of every entry with edit, delete and restore, an activity log of every change,
  CSV export, and settings for people and categories.

Runs on Cloudflare: one Worker serves the app and the API, and the data lives in D1 (SQLite).

## How it is built

| Path | What it holds |
|---|---|
| `worker/` | API (Hono): sign-in and sessions, entries, reports, users, categories |
| `src/` | Web app (React). `EntryWizard.tsx` is the add/edit flow; `admin/` is the owner's side |
| `shared/` | Code used by both: money parsing, season dates, PIN hashing, types |
| `migrations/` | D1 schema and starting categories |
| `scripts/` | Spreadsheet import, adding a user from the command line, icon generation |

Notes on the design:

- Money is stored as integer paise, so totals are exact.
- Entries are never hard-deleted. Deleting sets `deleted_at`, and every create, change, delete and restore is
  written to `audit_log`.
- Every entry id is generated on the phone, so resending an entry from the offline queue cannot create a duplicate.
- Lists use keyset pagination, and reports are grouped SQL over indexed date ranges, so pages stay fast as data grows.
- Sign-in: PINs are hashed with PBKDF2-SHA256. Each block of 5 wrong PINs locks the account for twice as long
  as the last (15 min, 30 min, … up to 24 h). Sessions last 180 days, extend with use, and live in an HttpOnly cookie.
- Managers see only their own entries, can date entries up to 60 days back, and can change their own entries for
  7 days. After that, only the admin can change them.

## Local development

```bash
npm install
npm run db:migrate:local
npm run db:import:local
npm run user:add -- --name "Admin" --role admin --pin 1111
npm run user:add -- --name "Manager" --role manager --pin 2222
npm run dev
```

Open http://localhost:5173. To try it on a phone on the same Wi-Fi, use the Network URL that Vite prints.
`npm test` runs the unit tests and `npm run typecheck` runs the type checker.

## Deploying to Cloudflare (first time)

1. Create a free account at https://dash.cloudflare.com/sign-up.
2. Sign in from this folder: `npx wrangler login`.
3. Create the database: `npx wrangler d1 create farmhouse`. Copy the `database_id` it prints into
   `wrangler.jsonc`, replacing the zeros.
4. Create the tables, then import the spreadsheet (put the CSV at `data/sheet3.csv` first):
   ```bash
   npm run db:migrate:remote
   npm run db:import:remote
   ```
5. Create your admin login:
   `npm run user:add -- --name "Your name" --role admin --pin <4 digits> --remote`
6. Deploy: `npm run deploy`. Wrangler prints the address, e.g. `https://farmhouse.<your-subdomain>.workers.dev`.
7. Sign in as the admin, open **Settings → Add person**, and add the user who will enter records, with their own PIN.
8. On the manager's phone, open the address in Chrome and choose **Add to Home screen**. It then opens like an app.

After that, every update is just `npm run deploy`. If a change adds a migration, run `npm run db:migrate:remote` first.

## Backups

- D1 Time Travel can restore the database to any minute in the last 7 days on the free plan (30 on paid):
  `npx wrangler d1 time-travel restore farmhouse --timestamp <ISO time>`.
- **Download CSV** on the dashboard exports a full copy you can keep anywhere.

## The spreadsheet import

`scripts/import-sheet.ts` reads the Sheet3 export and prints SQL. Running it again replaces the imported rows
rather than duplicating them. It:

- Reads `Owner's Capital Contribution` rows as owner capital, not expenses.
- Gives imported rows month-only dates, since the sheet does not record the day.
- Moves expenses that were filed under a crop category (e.g. "Apple") to Labor, and flags them for review.
- Flags likely duplicate rows, plus a row whose note disagrees with its amount. These show on the dashboard as
  "entries need a look" until marked as fine or deleted.
