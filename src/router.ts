import { useSyncExternalStore } from 'react';

// A small path router on top of the History API. Every screen change is a real history entry,
// so the phone's own Back button walks back through the app the way people expect.

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
window.addEventListener('popstate', notify);

export function navigate(to: string, opts: { replace?: boolean; state?: unknown } = {}) {
  if (opts.replace) history.replaceState(opts.state ?? null, '', to);
  else history.pushState(opts.state ?? null, '', to);
  notify();
  window.scrollTo(0, 0);
}

export function useLocation() {
  const href = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => location.pathname + location.search,
  );
  const url = new URL(href, location.origin);
  return { path: url.pathname, query: url.searchParams };
}

/** Step state stored in history, so Back moves one wizard step instead of leaving the screen. */
export function useHistoryState<T>(): T | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => history.state,
  );
  return history.state as T | null;
}

export function replaceHistoryState(state: unknown) {
  history.replaceState(state, '', location.pathname + location.search);
  notify();
}

/** Goes back `steps` history entries and resolves once the browser has landed there. */
export function rewind(steps: number): Promise<void> {
  if (steps <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    history.go(-steps);
  });
}

export function pushHistoryState(state: unknown) {
  history.pushState(state, '', location.pathname + location.search);
  notify();
  window.scrollTo(0, 0);
}
