// Entries saved without a connection wait here and are sent when the phone is back online.
// Each entry carries its own id, so sending the same one twice is harmless on the server.

import { useSyncExternalStore } from 'react';
import type { NewEntry } from '../shared/types.ts';
import { ApiError, NetworkError, createEntry } from './api.ts';

export interface Pending extends NewEntry {
  userId: number; // only the person who saved it may send it
  queuedAt: number;
  error?: string;
}

const KEY = 'fh_outbox_v1';
const listeners = new Set<() => void>();
let cache: Pending[] = read();
let flushing: Promise<void> | null = null;

function read(): Pending[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(next: Pending[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: entries stay in memory for this visit.
  }
  listeners.forEach((fn) => fn());
}

export function enqueue(entry: NewEntry, userId: number) {
  write([...cache.filter((p) => p.id !== entry.id), { ...entry, userId, queuedAt: Date.now() }]);
}

export function discard(id: string) {
  write(cache.filter((p) => p.id !== id));
}

export function usePending(userId: number): Pending[] {
  const all = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => cache,
  );
  return all.filter((p) => p.userId === userId);
}

/** Sends queued entries in order. Stops at the first network failure; keeps rejected ones visible. */
export function flush(userId: number, onSent?: () => void): Promise<void> {
  // The guard is cleared in .finally, which always runs after this assignment, even when there is nothing to send.
  flushing ??= sendAll(userId, onSent).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function sendAll(userId: number, onSent?: () => void) {
  for (const p of cache.filter((x) => x.userId === userId)) {
    try {
      const { queuedAt: _q, error: _e, userId: _u, ...entry } = p;
      await createEntry(entry);
      discard(p.id);
      onSent?.();
    } catch (err) {
      if (err instanceof NetworkError) break;
      if (err instanceof ApiError && err.status === 401) break;
      write(cache.map((x) => (x.id === p.id ? { ...x, error: err instanceof ApiError ? err.code : 'error' } : x)));
    }
  }
}
