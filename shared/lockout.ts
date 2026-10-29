// Wrong-PIN lockouts. A 4-digit PIN is only safe if guesses are slow, so each block of
// five failures locks the account for twice as long as the last, up to a day.

const LOCK_EVERY = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;

/** Lock length after `failures` consecutive wrong PINs; 0 when this failure does not trigger a lock. */
export function lockDurationMs(failures: number): number {
  if (failures < LOCK_EVERY || failures % LOCK_EVERY !== 0) return 0;
  return Math.min(BASE_LOCK_MS * 2 ** (failures / LOCK_EVERY - 1), MAX_LOCK_MS);
}
