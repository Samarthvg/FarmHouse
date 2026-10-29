// The farm year runs December to November, named after the year it ends in:
// season 2026 is 1 Dec 2025 – 30 Nov 2026.

export const SEASON_START_MONTH = 12;

export interface Season {
  year: number;
  from: string; // inclusive, YYYY-MM-DD
  to: string; // exclusive, YYYY-MM-DD
  months: string[]; // YYYY-MM, in order
}

export function seasonOf(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month >= SEASON_START_MONTH ? year + 1 : year;
}

export function season(year: number): Season {
  const months: string[] = [];
  let y = year - 1;
  let m = SEASON_START_MONTH;
  for (let i = 0; i < 12; i++) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  const from = `${months[0]}-01`;
  const end = nextMonth(months[11]);
  return { year, from, to: `${end}-01`, months };
}

export function nextMonth(ym: string): string {
  let y = Number(ym.slice(0, 4));
  let m = Number(ym.slice(5, 7)) + 1;
  if (m > 12) {
    m = 1;
    y++;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's date on the farm (India), independent of the server's or phone's timezone. */
export function todayInIndia(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
