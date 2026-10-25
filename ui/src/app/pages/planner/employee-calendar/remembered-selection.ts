/**
 * The employee last chosen on the employee calendar, kept in this browser
 * together with the account (`sub`) that chose it. One entry for whoever is
 * logged in: another account finds an entry that is not theirs, and logging out
 * removes it — both read as "new login", where the page picks the user's own
 * employee instead. Storage that is unavailable or holds junk reads as no entry.
 */
export interface RememberedSelection {
  /** The account's `sub`; null where there is none (dev mode, no gateway). */
  sub: string | null;
  employeeId: string;
}

const STORAGE_KEY = 'employeeCalendar.selection';

export function readSelection(): RememberedSelection | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (value && typeof value.employeeId === 'string' && value.employeeId
      && (value.sub === null || typeof value.sub === 'string')) {
      return { sub: value.sub, employeeId: value.employeeId };
    }
  } catch {
    // Storage unavailable or malformed — no entry.
  }
  return null;
}

export function writeSelection(sub: string | null, employeeId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sub, employeeId }));
  } catch {
    // Storage unavailable — the page simply does not remember.
  }
}

export function clearSelection(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing was stored either.
  }
}
