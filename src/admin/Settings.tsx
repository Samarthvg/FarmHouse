import { useEffect, useState, type FormEvent } from 'react';
import type { Category, Kind, UserRow } from '../../shared/types.ts';
import { ApiError, api } from '../api.ts';
import { Spinner } from '../components.tsx';
import { useSession } from '../session.tsx';

export function Settings() {
  return (
    <div className="admin-stack">
      <People />
      <Categories />
    </div>
  );
}

function People() {
  const { me } = useSession();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pinFor, setPinFor] = useState<number | null>(null);

  const load = () => api<UserRow[]>('/users').then(setUsers).catch(() => setMsg('Could not load people.'));
  useEffect(() => { load(); }, []);

  const patch = async (id: number, body: object, done: string) => {
    setMsg(null);
    try {
      await api(`/users/${id}`, { method: 'PATCH', json: body });
      setMsg(done);
      setPinFor(null);
      load();
    } catch (err) {
      setMsg(err instanceof ApiError ? `Could not save (${err.code}).` : 'Could not save.');
    }
  };

  return (
    <section className="card panel">
      <div className="panel-head">
        <div>
          <h2>People</h2>
          <p className="muted">Everyone signs in by tapping their name and entering a 4-digit PIN. A new PIN signs that person out on every phone.</p>
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>Add person</button>
      </div>
      {msg && <p className="banner" role="status">{msg}</p>}
      {!users ? <Spinner /> : (
        <div className="settings-list">
          {users.map((u) => (
            <div key={u.id} className={`settings-row ${u.active ? '' : 'is-deleted'}`}>
              <div className="settings-main">
                <strong>{u.name}</strong>
                <span className="pill">{u.role === 'admin' ? 'Admin' : 'User'}</span>
                <span className="faint">{u.lang === 'hi' ? 'Hindi' : 'English'}</span>
                {!u.active && <span className="pill pill-expense">Turned off</span>}
                {u.lockedUntil && <span className="pill pill-warn">Locked after wrong PINs</span>}
              </div>
              <div className="settings-actions">
                {u.lockedUntil && <button type="button" className="btn btn-sm" onClick={() => patch(u.id, { unlock: true }, `${u.name} can sign in again.`)}>Unlock</button>}
                <button type="button" className="btn btn-sm" onClick={() => setPinFor(pinFor === u.id ? null : u.id)}>New PIN</button>
                <button type="button" className="btn btn-sm" onClick={() => patch(u.id, { lang: u.lang === 'hi' ? 'en' : 'hi' }, 'Language changed.')}>
                  Use {u.lang === 'hi' ? 'English' : 'Hindi'}
                </button>
                {u.id !== me.id && (
                  <button type="button" className="btn btn-sm" onClick={() => patch(u.id, { active: !u.active }, u.active ? `${u.name} is turned off and signed out.` : `${u.name} is turned on.`)}>
                    {u.active ? 'Turn off' : 'Turn on'}
                  </button>
                )}
              </div>
              {pinFor === u.id && <PinForm onSubmit={(pin) => patch(u.id, { pin }, `New PIN set for ${u.name}.`)} />}
            </div>
          ))}
        </div>
      )}
      {adding && <AddPerson onDone={(m) => { setAdding(false); if (m) { setMsg(m); load(); } }} />}
    </section>
  );
}

function PinForm({ onSubmit }: { onSubmit: (pin: string) => void }) {
  const [pin, setPin] = useState('');
  return (
    <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (/^\d{4}$/.test(pin)) onSubmit(pin); }}>
      <input className="input" inputMode="numeric" pattern="\d{4}" maxLength={4} placeholder="4 digits" value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-label="New PIN" autoFocus />
      <button type="submit" className="btn btn-sm btn-primary" disabled={pin.length !== 4}>Set PIN</button>
    </form>
  );
}

function AddPerson({ onDone }: { onDone: (msg: string | null) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'manager' | 'admin'>('manager');
  const [lang, setLang] = useState<'hi' | 'en'>('hi');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/users', { method: 'POST', json: { name: name.trim(), role, lang, pin } });
      onDone(`${name.trim()} added. Tell them their PIN.`);
    } catch {
      setErr('Could not add this person.');
    }
  };
  return (
    <form className="sub-form" onSubmit={submit}>
      <h3>Add person</h3>
      <div className="form-grid">
        <label className="field"><span>Name (shown on the sign-in screen)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus /></label>
        <label className="field"><span>Role</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as 'manager' | 'admin')}>
            <option value="manager">User (adds entries, sees only their own)</option>
            <option value="admin">Admin (sees and edits everything)</option>
          </select>
        </label>
        <label className="field"><span>Language</span>
          <select className="select" value={lang} onChange={(e) => setLang(e.target.value as 'hi' | 'en')}>
            <option value="hi">Hindi</option><option value="en">English</option>
          </select>
        </label>
        <label className="field"><span>PIN (4 digits)</span>
          <input className="input" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
        </label>
      </div>
      {err && <p className="banner">{err}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-sm" onClick={() => onDone(null)}>Cancel</button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!name.trim() || pin.length !== 4}>Add</button>
      </div>
    </form>
  );
}

const KIND_LABEL: Record<Kind, string> = { expense: 'Expense categories', income: 'Income categories', capital: 'Owner capital' };

function Categories() {
  const { categories, reloadCategories } = useSession();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  return (
    <section className="card panel">
      <div className="panel-head">
        <div>
          <h2>Categories</h2>
          <p className="muted">These are the tiles users tap when adding an entry. Keep the list short; hide the rare ones instead of deleting them.</p>
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>Add category</button>
      </div>
      {editing === 'new' && <CategoryForm onDone={async (changed) => { setEditing(null); if (changed) await reloadCategories(); }} />}
      {(['expense', 'income', 'capital'] as Kind[]).map((kind) => (
        <div key={kind}>
          <h3 className="settings-group">{KIND_LABEL[kind]}</h3>
          <div className="settings-list">
            {categories.filter((c) => c.kind === kind).map((c) => (
              <div key={c.id} className={`settings-row ${c.active ? '' : 'is-deleted'}`}>
                <div className="settings-main">
                  <span style={{ fontSize: '1.4rem' }} aria-hidden="true">{c.icon}</span>
                  <strong>{c.nameEn}</strong>
                  <span lang="hi">{c.nameHi}</span>
                  {!c.showOnEntry && c.kind !== 'capital' && <span className="pill">Hidden from users</span>}
                  {c.tracksWorkers && <span className="pill">Asks worker count</span>}
                  {!c.active && <span className="pill pill-expense">Archived</span>}
                </div>
                <div className="settings-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(editing === c ? null : c)}>Edit</button>
                </div>
                {editing === c && <CategoryForm category={c} onDone={async (changed) => { setEditing(null); if (changed) await reloadCategories(); }} />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function CategoryForm({ category, onDone }: { category?: Category; onDone: (changed: boolean) => void }) {
  const [v, setV] = useState({
    kind: category?.kind ?? ('expense' as Kind),
    nameEn: category?.nameEn ?? '',
    nameHi: category?.nameHi ?? '',
    icon: category?.icon ?? '',
    sort: category?.sort ?? 100,
    showOnEntry: category?.showOnEntry ?? true,
    tracksWorkers: category?.tracksWorkers ?? false,
    active: category?.active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (category) {
        const { kind: _k, ...rest } = v;
        await api(`/categories/${category.id}`, { method: 'PATCH', json: rest });
      } else {
        await api('/categories', { method: 'POST', json: v });
      }
      onDone(true);
    } catch (error) {
      setErr(error instanceof ApiError && error.code === 'duplicate_name' ? 'A category with that name already exists.' : 'Could not save.');
    }
  };
  return (
    <form className="sub-form" onSubmit={submit}>
      <div className="form-grid">
        {!category && (
          <label className="field"><span>Type</span>
            <select className="select" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as Kind })}>
              <option value="expense">Expense</option><option value="income">Income</option><option value="capital">Owner capital</option>
            </select>
          </label>
        )}
        <label className="field"><span>English name</span><input className="input" value={v.nameEn} onChange={(e) => setV({ ...v, nameEn: e.target.value })} required maxLength={60} /></label>
        <label className="field"><span>Hindi name</span><input className="input" lang="hi" value={v.nameHi} onChange={(e) => setV({ ...v, nameHi: e.target.value })} required maxLength={60} /></label>
        <label className="field"><span>Icon (one emoji)</span><input className="input" value={v.icon} onChange={(e) => setV({ ...v, icon: e.target.value })} maxLength={16} /></label>
        <label className="field"><span>Order (lower comes first)</span><input className="input" type="number" min={0} max={10000} value={v.sort} onChange={(e) => setV({ ...v, sort: Number(e.target.value) })} /></label>
      </div>
      <div className="filters-toggles">
        <label className="check"><input type="checkbox" checked={v.showOnEntry} onChange={(e) => setV({ ...v, showOnEntry: e.target.checked })} /> Show to users</label>
        <label className="check"><input type="checkbox" checked={v.tracksWorkers} onChange={(e) => setV({ ...v, tracksWorkers: e.target.checked })} /> Ask how many workers</label>
        <label className="check"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Active</label>
      </div>
      {err && <p className="banner">{err}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-sm" onClick={() => onDone(false)}>Cancel</button>
        <button type="submit" className="btn btn-sm btn-primary">Save</button>
      </div>
    </form>
  );
}
