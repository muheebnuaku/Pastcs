import { create } from 'zustand';
import { useAuthStore } from '@/lib/store';

// Level Reps' codes travel with everything they share (migration 047): a
// classroom invite, a battle or Exam Boss result, a grade. Whoever opens
// one and signs up is credited to that rep. The code is remembered from
// whatever page the link opens, not only the sign-up page, because an
// invite goes /join/… → sign-up.

const SAVED_KEY = 'pastcs_ref';
const SAVED_DAYS = 30;
const REP_KEY = 'pastcs_is_rep';
const CODE = /^[A-Z0-9]{6,12}$/;

// Whether the signed-in student is a Level Rep. Set by StudentSidebar from
// am_i_level_rep; kept for the session so links are right straight away.
interface RepState { isRep: boolean; setIsRep: (v: boolean) => void }
export const useRepStore = create<RepState>((set) => ({
  isRep: (() => { try { return sessionStorage.getItem(REP_KEY) === '1'; } catch { return false; } })(),
  setIsRep: (isRep) => {
    try { if (isRep) sessionStorage.setItem(REP_KEY, '1'); else sessionStorage.removeItem(REP_KEY); } catch { /* storage unavailable */ }
    set({ isRep });
  },
}));

/** The signed-in rep's code, or null for everyone else. */
export function myRepCode(): string | null {
  if (!useRepStore.getState().isRep) return null;
  const code = useAuthStore.getState().user?.referral_code?.toUpperCase();
  return code && CODE.test(code) ? code : null;
}

/** A link on this site, carrying the rep's code when a rep shares it. */
export function shareLink(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.pastcs.com';
  const code = myRepCode();
  if (!code) return `${origin}${path}`;
  return `${origin}${path}${path.includes('?') ? '&' : '?'}ref=${code}`;
}

/** On any page: keep a ?ref= code for sign-up. The first one in 30 days wins. */
export function captureRefFromUrl() {
  try {
    const code = new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase();
    if (!code || !CODE.test(code)) return;
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null') as { code: string; at: number } | null;
    if (saved && Date.now() - saved.at < SAVED_DAYS * 86400e3) return;
    localStorage.setItem(SAVED_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch { /* storage unavailable */ }
}

/** The code to pre-fill at sign-up, if a shared link brought them here. */
export function savedRefCode(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null') as { code: string; at: number } | null;
    return saved && Date.now() - saved.at < SAVED_DAYS * 86400e3 ? saved.code : null;
  } catch { return null; }
}

export function clearSavedRefCode() {
  try { localStorage.removeItem(SAVED_KEY); } catch { /* storage unavailable */ }
}
