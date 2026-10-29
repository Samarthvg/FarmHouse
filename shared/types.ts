// Shapes shared by the API and the web app.

export type Kind = 'expense' | 'income' | 'capital';
export type Role = 'admin' | 'manager';
export type Lang = 'hi' | 'en';
export const UNITS = ['kg', 'litre', 'box', 'crate'] as const;
export type Unit = (typeof UNITS)[number];

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
  /** When set, entries also ask how much was sold, in whole units. */
  unit: Unit | null;
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
  quantity: number | null;
  note: string;
  ref: string | null;
  reviewNote: string | null;
  source: 'app' | 'import';
  createdBy: number | null;
  createdByName: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  photos: PhotoRef[];
  /** Whether the current user may still edit or delete this entry. */
  editable: boolean;
}

export interface PhotoRef {
  id: string;
  bytes: number;
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
  quantity: number | null;
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
  categories: {
    categoryId: number;
    paise: number;
    count: number;
    previousPaise: number;
    /** Units sold, and the money from only the entries that recorded a quantity, so the rate is fair. */
    quantity: number;
    quantityPaise: number;
    previousQuantity: number;
    previousQuantityPaise: number;
  }[];
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
/**
 * The admin sees every rupee and every setting, so an unattended admin sign-in ends after this much
 * inactivity. The entry-only role keeps the long session: it lives on her own phone and only records.
 */
export const ADMIN_IDLE_MS = 30 * 60 * 1000;
export const MAX_PHOTOS_PER_ENTRY = 4;
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export interface BackupInfo {
  key: string;
  size: number;
  uploaded: string;
  /** Row counts per table; only returned right after a backup runs. */
  rows?: Record<string, number>;
}
