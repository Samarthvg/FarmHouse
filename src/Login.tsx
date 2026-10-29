import { useEffect, useState } from 'react';
import type { Lang, Me } from '../shared/types.ts';
import { ApiError, NetworkError, api } from './api.ts';
import { BigTopBar, LangToggle, Spinner } from './components.tsx';
import { LangContext, initial, personName, useT } from './i18n.ts';

const LANG_KEY = 'fh_login_lang';
const LAST_USER_KEY = 'fh_last_user';

function storedLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'hi';
  } catch {
    return 'hi';
  }
}

interface LoginUser { id: number; name: string; nameHi: string | null; role: string }

export function Login({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [lang, setLang] = useState<Lang>(storedLang);
  const toggle = () => {
    const next = lang === 'hi' ? 'en' : 'hi';
    setLang(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* ignore */ }
  };
  return (
    <LangContext.Provider value={lang}>
      <LoginInner onSignedIn={onSignedIn} onToggleLang={toggle} />
    </LangContext.Provider>
  );
}

function LoginInner({ onSignedIn, onToggleLang }: { onSignedIn: (me: Me) => void; onToggleLang: () => void }) {
  const t = useT();
  const [people, setPeople] = useState<LoginUser[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [person, setPerson] = useState<LoginUser | null>(null);

  const load = () => {
    setLoadError(false);
    api<LoginUser[]>('/login-users')
      .then((list) => {
        setPeople(list);
        const last = Number(localStorage.getItem(LAST_USER_KEY));
        const remembered = list.find((p) => p.id === last);
        if (remembered) setPerson(remembered);
        else if (list.length === 1) setPerson(list[0]);
      })
      .catch(() => setLoadError(true));
  };
  useEffect(load, []);

  return (
    <div className="big big-shell">
      <BigTopBar onBack={person && people && people.length > 1 ? () => setPerson(null) : undefined} right={<LangToggle onToggle={onToggleLang} />} />
      <img className="brand-mark" src="/icon.svg" width="64" height="64" alt="" />
      <h1 className="big-title" style={{ textAlign: 'center', marginTop: 0 }}>{t('appName')}</h1>
      {loadError ? (
        <div style={{ textAlign: 'center' }}>
          <p className="big-sub" style={{ margin: '0 0 16px' }}>{t('error')}</p>
          <button type="button" className="big-next" onClick={load}>↻</button>
        </div>
      ) : !people ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}><Spinner /></div>
      ) : person ? (
        <PinPad person={person} onSignedIn={onSignedIn} />
      ) : (
        <>
          <p className="big-sub" style={{ textAlign: 'center' }}>{t('whoAreYou')}</p>
          <div className="action-stack">
            {people.map((p) => (
              <button key={p.id} type="button" className="person-btn" onClick={() => setPerson(p)}>
                <span className="avatar" aria-hidden="true">{initial(personName(p, t.lang))}</span>
                {personName(p, t.lang)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PinPad({ person, onSignedIn }: { person: LoginUser; onSignedIn: (me: Me) => void }) {
  const t = useT();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const me = await api<Me>('/login', { method: 'POST', json: { userId: person.id, pin: value } });
      try { localStorage.setItem(LAST_USER_KEY, String(me.id)); } catch { /* ignore */ }
      onSignedIn(me);
    } catch (err) {
      setPin('');
      setShake(true);
      setTimeout(() => setShake(false), 600);
      if (err instanceof ApiError && err.code === 'locked') {
        const until = new Date((err.body as { until: number }).until);
        setError(`${t('locked')} ${until.toLocaleTimeString(t.lang === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' })}`);
      } else if (err instanceof NetworkError) setError(t('offline'));
      else if (err instanceof ApiError && err.code === 'wrong_pin') setError(t('wrongPin'));
      else setError(t('error'));
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy) return;
    if (d === '⌫') return setPin((p) => p.slice(0, -1));
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) submit(next);
  };

  return (
    <div>
      <div className="person-btn" style={{ boxShadow: 'none', marginBottom: 18 }} aria-live="polite">
        <span className="avatar" aria-hidden="true">{initial(personName(person, t.lang))}</span>
        {personName(person, t.lang)}
      </div>
      <p className="big-sub" style={{ textAlign: 'center', margin: '0 0 6px' }}>{t('enterPin')}</p>
      <div className={`pin-dots ${shake ? 'shake' : ''}`} aria-label={`${pin.length} / 4`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      <div className="pin-error" role="alert">{busy ? <Spinner /> : error}</div>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="key" onClick={() => press(d)}>{d}</button>
        ))}
        <span />
        <button type="button" className="key" onClick={() => press('0')}>0</button>
        <button type="button" className="key key-alt" onClick={() => press('⌫')} aria-label="Delete">⌫</button>
      </div>
    </div>
  );
}
