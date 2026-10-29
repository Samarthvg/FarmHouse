import { useEffect, useState, type ReactNode } from 'react';
import type { Entry } from '../shared/types.ts';
import { ApiError, api } from './api.ts';
import { Activity } from './admin/Activity.tsx';
import { Dashboard } from './admin/Dashboard.tsx';
import { Entries } from './admin/Entries.tsx';
import { Settings } from './admin/Settings.tsx';
import { BigTopBar, FullScreenSpinner } from './components.tsx';
import { EntryWizard } from './EntryWizard.tsx';
import { useT } from './i18n.ts';
import { Login } from './Login.tsx';
import { ManagerHome } from './ManagerHome.tsx';
import { navigate, useLocation } from './router.ts';
import { SessionProvider, useSession } from './session.tsx';

export function App() {
  return (
    <SessionProvider loading={<FullScreenSpinner />} signedOut={(onSignedIn) => <Login onSignedIn={onSignedIn} />}>
      <Routes />
    </SessionProvider>
  );
}

function Routes() {
  const { path } = useLocation();
  const { me } = useSession();
  const isAdmin = me.role === 'admin';

  const add = path.match(/^\/add\/(expense|income|capital)$/);
  if (add) {
    if (add[1] === 'capital' && !isAdmin) return <Redirect to="/" />;
    return <EntryWizard key={path} kind={add[1] as 'expense' | 'income' | 'capital'} />;
  }
  const edit = path.match(/^\/entry\/([^/]+)$/);
  if (edit) return <EditEntry key={edit[1]} id={decodeURIComponent(edit[1])} />;

  if (!isAdmin) return path === '/' ? <ManagerHome /> : <Redirect to="/" />;

  if (path === '/' || path === '/admin') return <AdminShell tab="dashboard"><Dashboard /></AdminShell>;
  if (path === '/admin/entries') return <AdminShell tab="entries"><Entries /></AdminShell>;
  if (path === '/admin/activity') return <AdminShell tab="activity"><Activity /></AdminShell>;
  if (path === '/admin/settings') return <AdminShell tab="settings"><Settings /></AdminShell>;
  return <Redirect to="/" />;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function EditEntry({ id }: { id: string }) {
  const t = useT();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Entry>(`/entries/${encodeURIComponent(id)}`)
      .then(setEntry)
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? 'not_found' : 'error'));
  }, [id]);
  if (error) {
    return (
      <div className="big big-shell">
        <BigTopBar onBack={() => history.back()} />
        <p className="banner">{error === 'not_found' ? '—' : t('error')}</p>
      </div>
    );
  }
  if (!entry) return <FullScreenSpinner />;
  return <EntryWizard entry={entry} />;
}

const TABS = [
  ['dashboard', '/', 'Dashboard'],
  ['entries', '/admin/entries', 'Entries'],
  ['activity', '/admin/activity', 'Activity'],
  ['settings', '/admin/settings', 'Settings'],
] as const;

function AdminShell({ tab, children }: { tab: (typeof TABS)[number][0]; children: ReactNode }) {
  const { me, signOut } = useSession();
  return (
    <div className="admin">
      <header className="admin-header">
        <div className="admin-brand">
          <span aria-hidden="true">🌱</span> Farm Ledger
        </div>
        <nav className="admin-tabs" aria-label="Sections">
          {TABS.map(([key, href, label]) => (
            <a key={key} href={href} className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined}
              onClick={(e) => { e.preventDefault(); navigate(href); }}>
              {label}
            </a>
          ))}
        </nav>
        <div className="admin-user">
          <span className="muted">{me.name}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <div className="admin-add">
        <button type="button" className="btn btn-sm add-expense" onClick={() => navigate('/add/expense')}>− Add expense</button>
        <button type="button" className="btn btn-sm add-income" onClick={() => navigate('/add/income')}>+ Add income</button>
        <button type="button" className="btn btn-sm add-capital" onClick={() => navigate('/add/capital')}>+ Owner money</button>
      </div>
      <main className="admin-main">{children}</main>
    </div>
  );
}
