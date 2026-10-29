// Shapes shared by the API and the web app.

export type Kind = 'expense' | 'income' | 'capital';
export type Role = 'admin' | 'manager';
export type Lang = 'hi' | 'en';

export interface Me {
  id: number;
  name: string;
  role: Role;
  lang: Lang;
}

export interface Category {
  id: number;
  kind: Kind;
  nameEn: string;
  nameHi: string;
  icon: string;
  sort: number;
  showOnEntry: boolean;
  tracksWorkers: boolean;
  active: boolean;
}

export interface Entry {
  id: string;
  kind: Kind;
  categoryId: number;
  date: string;
  dateIsMonthOnly: boolean;
  amountPaise: number;
  workers: number | null;
  note: string;
  ref: string | null;
  reviewNote: string | null;
  source: 'app' | 'import';
  createdBy: number | null;
  createdByName: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** Whether the current user may still edit or delete this entry. */
  editable: boolean;
}

export interface EntryPage {
  entries: Entry[];
  nextCursor: string | null;
}

export interface NewEntry {
  id: string;
  categoryId: number;
  date: string;
  amountPaise: number;
  workers: number | null;
  note: string;
}

export interface KindTotals {
  expense: number;
  income: number;
  capital: number;
}

export interface SeasonReport {
  year: number;
  from: string;
  to: string;
  months: string[];
  totals: KindTotals;
  monthly: Record<string, KindTotals>;
  previous: { year: number; totals: KindTotals; monthly: Record<string, KindTotals> };
  categories: { categoryId: number; paise: number; count: number; previousPaise: number }[];
  labor: { paise: number; workerDays: number; paiseWithCount: number; previousWorkerDays: number };
  reviewCount: number;
  entryCount: number;
}

export interface ActivityItem {
  id: number;
  entryId: string;
  action: 'create' | 'update' | 'delete' | 'restore';
  userName: string | null;
  at: number;
  before: Partial<Entry> | null;
  after: Partial<Entry> | null;
}

export interface UserRow {
  id: number;
  name: string;
  role: Role;
  lang: Lang;
  active: boolean;
  lockedUntil: number | null;
  createdAt: number;
}

/** Managers can fix their own mistakes for this long; after that the admin edits. */
export const MANAGER_EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** How far back a manager may date a new entry. */
export const MANAGER_BACKDATE_DAYS = 60;
