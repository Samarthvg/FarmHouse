import type { Category, Entry, EntryPage, Me, NewEntry } from '../shared/types.ts';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: unknown = null) {
    super(code);
  }
}

/** Thrown when the request never reached the server (no signal, server unreachable). */
export class NetworkError extends Error {}

type Listener = () => void;
const signedOutListeners = new Set<Listener>();
export const onSignedOut = (fn: Listener) => {
  signedOutListeners.add(fn);
  return () => {
    signedOutListeners.delete(fn);
  };
};

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      ...rest,
      headers: json !== undefined ? { 'content-type': 'application/json', ...rest.headers } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: 'same-origin',
    });
  } catch {
    throw new NetworkError('network');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && body?.error === 'signed_out') signedOutListeners.forEach((fn) => fn());
    throw new ApiError(res.status, body?.error ?? 'error', body);
  }
  return body as T;
}

export const getMe = () => api<Me>('/me');
export const getCategories = () => api<Category[]>('/categories');
export const createEntry = (e: NewEntry) => api<Entry>('/entries', { method: 'POST', json: e });
export const updateEntry = (id: string, patch: Partial<NewEntry> & { reviewNote?: string | null }) =>
  api<Entry>(`/entries/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch });
export const deleteEntry = (id: string) => api<{ ok: true }>(`/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });

export function listEntries(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  return api<EntryPage>(`/entries?${q}`);
}

export function newId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
