// Photos waiting to be sent. They live in IndexedDB rather than localStorage because images are
// far too large for it. Each photo is sent after its entry has reached the server; until then the
// upload answers "not found" and the photo simply waits for the next try.

import { useSyncExternalStore } from 'react';
import { ApiError, NetworkError, uploadPhoto } from './api.ts';
import { pendingEntryIds } from './outbox.ts';

export interface QueuedPhoto {
  id: string;
  entryId: string;
  userId: number;
  blob: Blob;
  queuedAt: number;
}

const DB_NAME = 'farm-photos';
const STORE = 'queue';
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

// A count of waiting photos per entry, kept in memory so screens can show "photo not sent yet".
let counts = new Map<string, number>();
const listeners = new Set<() => void>();

async function refreshCounts() {
  const all = await tx<QueuedPhoto[]>('readonly', (s) => s.getAll()).catch(() => []);
  const next = new Map<string, number>();
  for (const p of all) next.set(p.entryId, (next.get(p.entryId) ?? 0) + 1);
  counts = next;
  listeners.forEach((fn) => fn());
}
refreshCounts();

export function usePendingPhotoCounts(): Map<string, number> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => counts,
  );
}

export async function queuePhoto(photo: Omit<QueuedPhoto, 'queuedAt'>): Promise<void> {
  await tx('readwrite', (s) => s.put({ ...photo, queuedAt: Date.now() }));
  await refreshCounts();
}

let flushing: Promise<void> | null = null;

/** Sends this person's waiting photos. Stops at the first network failure. */
export function flushPhotos(userId: number, onSent?: () => void): Promise<void> {
  flushing ??= sendAll(userId, onSent).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function sendAll(userId: number, onSent?: () => void) {
  const all = await tx<QueuedPhoto[]>('readonly', (s) => s.getAll()).catch(() => [] as QueuedPhoto[]);
  const waitingEntries = pendingEntryIds();
  for (const p of all.filter((x) => x.userId === userId).sort((a, b) => a.queuedAt - b.queuedAt)) {
    if (waitingEntries.has(p.entryId)) continue; // its entry has not been sent yet
    try {
      await uploadPhoto(p.entryId, p.id, p.blob);
      await tx('readwrite', (s) => s.delete(p.id));
      onSent?.();
    } catch (err) {
      if (err instanceof NetworkError) break;
      if (err instanceof ApiError && err.status === 401) break;
      // The entry is gone, or the photo can never be accepted (too many, too large): drop it.
      if (err instanceof ApiError && [403, 404, 409, 413, 415].includes(err.status)) {
        await tx('readwrite', (s) => s.delete(p.id));
      }
    }
  }
  await refreshCounts();
}
