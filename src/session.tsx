import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ADMIN_IDLE_MS, type Category, type Lang, type Me } from '../shared/types.ts';
import { api, getCategories, getMe, onSignedOut } from './api.ts';
import { LangContext } from './i18n.ts';
import { flush } from './outbox.ts';
import { flushPhotos } from './photoQueue.ts';

interface SessionValue {
  me: Me;
  categories: Category[];
  categoryById: Map<number, Category>;
  setLang: (lang: Lang) => void;
  reloadCategories: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Bumped whenever entries change, so lists can refetch. */
  dataVersion: number;
  bumpData: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

const CACHE_KEY = 'fh_session_cache_v1';

/** Remembers who was signed in and the category list, so the app opens even with no signal. */
function readCache(): { me: Me; categories: Category[] } | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
  } catch {
    return null;
  }
}
function writeCache(v: { me: Me; categories: Category[] } | null) {
  try {
    if (v) localStorage.setItem(CACHE_KEY, JSON.stringify(v));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

type State =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'ready'; me: Me; categories: Category[] };

export function SessionProvider({ signedOut, loading, children }: {
  signedOut: (onSignedIn: (me: Me) => void) => ReactNode;
  loading: ReactNode;
  children: ReactNode;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [dataVersion, setDataVersion] = useState(0);
  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);

  const load = useCallback(async () => {
    try {
      const [me, categories] = await Promise.all([getMe(), getCategories()]);
      writeCache({ me, categories });
      setState({ status: 'ready', me, categories });
    } catch (err) {
      const cached = readCache();
      // Only the entry phone opens from the cache with no signal; an admin always signs in fresh.
      if ((err as { status?: number }).status === 401 || !cached || cached.me.role === 'admin') {
        writeCache(null);
        setState({ status: 'signed_out' });
      } else {
        setState({ status: 'ready', ...cached });
      }
    }
  }, []);

  useEffect(() => {
    load();
    return onSignedOut(() => {
      writeCache(null);
      setState({ status: 'signed_out' });
    });
  }, [load]);

  // Send anything saved offline as soon as we are signed in and whenever the connection returns.
  const meId = state.status === 'ready' ? state.me.id : null;
  useEffect(() => {
    if (meId === null) return;
    const run = () => flush(meId, bumpData).then(() => flushPhotos(meId, bumpData));
    run();
    window.addEventListener('online', run);
    const timer = setInterval(run, 60_000);
    return () => {
      window.removeEventListener('online', run);
      clearInterval(timer);
    };
  }, [meId, bumpData]);

  const isAdmin = state.status === 'ready' && state.me.role === 'admin';
  useEffect(() => {
    if (!isAdmin) return;
    return watchAdminIdle(() => {
      api('/logout', { method: 'POST' }).catch(() => {});
      writeCache(null);
      setState({ status: 'signed_out' });
    });
  }, [isAdmin]);

  const value = useMemo<SessionValue | null>(() => {
    if (state.status !== 'ready') return null;
    return {
      me: state.me,
      categories: state.categories,
      categoryById: new Map(state.categories.map((c) => [c.id, c])),
      dataVersion,
      bumpData,
      setLang: (lang) => {
        const me = { ...state.me, lang };
        setState({ ...state, me });
        writeCache({ me, categories: state.categories });
        api('/me', { method: 'PATCH', json: { lang } }).catch(() => {});
      },
      reloadCategories: async () => {
        const categories = await getCategories();
        writeCache({ me: state.me, categories });
        setState({ ...state, categories });
      },
      signOut: async () => {
        await api('/logout', { method: 'POST' }).catch(() => {});
        writeCache(null);
        try {
          localStorage.removeItem(`fh_recent_v1_${state.me.id}`);
        } catch {
          // ignore
        }
        setState({ status: 'signed_out' });
      },
    };
  }, [state, dataVersion, bumpData]);

  if (state.status === 'loading') return <>{loading}</>;
  if (state.status === 'signed_out' || !value) {
    return <>{signedOut(() => { setState({ status: 'loading' }); load(); })}</>;
  }
  return (
    <SessionContext.Provider value={value}>
      <LangContext.Provider value={value.me.lang}>{children}</LangContext.Provider>
    </SessionContext.Provider>
  );
}

const KEEPALIVE_MS = 2 * 60 * 1000;

/**
 * Signs an admin out after ADMIN_IDLE_MS with no taps or keys, so figures never sit open on an
 * unattended screen. While someone is reading without making requests, a light /me call every few
 * minutes keeps the server's matching idle limit from ending the session under them.
 */
function watchAdminIdle(onIdle: () => void): () => void {
  let lastActive = Date.now();
  let lastPing = Date.now();
  const activity = () => {
    // The first tap after a long sleep must not count as activity and revive the session.
    if (Date.now() - lastActive >= ADMIN_IDLE_MS) return onIdle();
    lastActive = Date.now();
    if (lastActive - lastPing > KEEPALIVE_MS) {
      lastPing = lastActive;
      api('/me').catch(() => {});
    }
  };
  // Timers pause in background tabs and on sleeping laptops, so compare wall-clock time on every check.
  const check = () => {
    if (Date.now() - lastActive >= ADMIN_IDLE_MS) onIdle();
  };
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
  events.forEach((e) => window.addEventListener(e, activity, { passive: true }));
  document.addEventListener('visibilitychange', check);
  const timer = setInterval(check, 15_000);
  return () => {
    events.forEach((e) => window.removeEventListener(e, activity));
    document.removeEventListener('visibilitychange', check);
    clearInterval(timer);
  };
}
