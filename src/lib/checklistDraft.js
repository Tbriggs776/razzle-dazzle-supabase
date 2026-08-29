import { useEffect, useRef } from 'react';

/**
 * Keeps a half-finished checklist alive on the device.
 *
 * Until now a checklist in progress lived only in component state. The row that
 * says "material missing or wrong -> tell your Field Manager" is exactly why a
 * crew member opens the Job Brief tab — and that tab is always unlocked, so
 * switching to it unmounted the component and destroyed 23 answers and five photo
 * sets. Same on a backgrounded iOS tab or a back-swipe. The crew either redoes it
 * all standing in someone's hallway, or proceeds undocumented — and undocumented
 * is what a ROC claim turns on.
 *
 * Deliberately localStorage and not the server: this has to work with no signal,
 * which is the situation it exists for. There is no offline mode anywhere else in
 * this app, so nothing here may assume a request can be made.
 *
 * Every access is wrapped: Safari private mode throws on setItem, and a storage
 * failure must never take the checklist down with it. Losing the draft is bad;
 * losing the screen is worse.
 */

const PREFIX = 'rd:checklist-draft:';

export function draftKeyFor(projectId, stepKey) {
  return projectId && stepKey ? `${projectId}:${stepKey}` : null;
}

export function loadDraft(key) {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearDraft(key) {
  if (!key) return;
  try { window.localStorage.removeItem(PREFIX + key); } catch { /* nothing to do */ }
}

export function hasDraft(key) {
  if (!key) return false;
  try { return window.localStorage.getItem(PREFIX + key) != null; } catch { return false; }
}

/**
 * Debounced save. `enabled` is false once the checklist is read-only, so a
 * submitted checklist never keeps writing over itself.
 */
export function useChecklistDraft(key, data, enabled = true) {
  const timer = useRef(null);

  useEffect(() => {
    if (!key || !enabled) return undefined;
    clearTimeout(timer.current);
    // 600ms: long enough that ticking through boxes is not a write per tap,
    // short enough that a tab switch a second later still has the answers.
    timer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(data));
      } catch { /* quota or private mode — the checklist still works */ }
    }, 600);
    return () => clearTimeout(timer.current);
  }, [key, data, enabled]);

  // A tab switch or a backgrounded phone can beat the debounce, so flush on the
  // way out. visibilitychange is the one that fires when iOS backgrounds Safari;
  // pagehide covers the back-swipe.
  useEffect(() => {
    if (!key || !enabled) return undefined;
    const flush = () => {
      try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(data));
      } catch { /* nothing to do */ }
    };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [key, data, enabled]);
}
