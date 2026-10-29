// Light / dark / follow-the-phone, remembered on this device. index.html applies the saved choice
// before the first paint, so the page never flashes the wrong colours.

import { useEffect, useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'fh_theme';
const listeners = new Set<() => void>();
const media = window.matchMedia('(prefers-color-scheme: dark)');

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref = readPref();

function resolved(): 'light' | 'dark' {
  return pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;
}

function apply() {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved() === 'dark' ? '#161b22' : '#166534');
}

media.addEventListener('change', () => {
  apply();
  listeners.forEach((fn) => fn());
});

export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // ignore: the choice just will not be remembered
  }
  apply();
  listeners.forEach((fn) => fn());
}

export function useTheme() {
  const snapshot = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => `${pref}:${resolved()}`,
  );
  useEffect(apply, []);
  const [p, r] = snapshot.split(':') as [ThemePref, 'light' | 'dark'];
  return { pref: p, resolved: r, setPref: setThemePref };
}
