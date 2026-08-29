/**
 * The invoke contract, in ONE place.
 *
 * `base44.functions.invoke()` returns `{ data, error }` and NEVER THROWS, so every
 * try/catch wrapped around it is dead code and every call site that ignores the
 * result reports success when the call failed.
 *
 * There are FOUR "it didn't work" signals in this codebase, and they need opposite
 * handling, which is the whole reason this file exists:
 *
 *   res.error                transport / non-2xx.            A real failure.
 *   res.data.ok === false    explicit failure from an RPC.   A real failure.
 *   res.data.success === false  smsDispatch's `direct` branch. A real failure.
 *   res.data.skipped         HTTP 200, nothing was sent.     NOT a failure.
 *   res.data.stub            integration not configured.     NOT a failure.
 *
 * ── TWO THINGS LEARNED THE HARD WAY, both from real regressions ─────────────
 *
 * 1. `success` is a THIRD failure signal and it is not interchangeable with `ok`.
 *    smsDispatch's `direct` branch returns HTTP 200 with
 *      { success: d.ok === true, twilioStatus, error: d.error ?? d.skipped }
 *    so a failed text arrives as 200 { success:false } with no `ok` and no
 *    top-level `skipped`. A guard that checked only error/ok reported that as a
 *    SUCCESS and wrote "SMS Sent" into the ticket log.
 *
 * 2. THAT SAME BRANCH FLATTENS `skipped` INTO `error`
 *    (`error: d.error ?? d.skipped`). So "SMS is switched off" — a not-sent —
 *    arrives as `data.error = 'disabled'` and naive code throws a hard
 *    `toast.error('disabled')` at the user for a routine configuration state.
 *    Hence NOT_SENT_REASONS below: an `error` whose value is a known skip token is
 *    a not-sent, not a failure, and is checked FIRST.
 *
 * The split matters because the two categories need opposite handling:
 *   - a failure should throw / block / offer a retry.
 *   - a not-sent must NEVER be thrown (an unconfigured integration would become a
 *     hard error the user cannot act on) but must still be said out loud, because
 *     a false "sent!" is worse than either.
 */

// Values that mean "nothing went out", wherever they surface — `skipped`, or
// flattened into `error` by smsDispatch. An explicit list, not a regex: guessing
// wrong in this direction silently swallows a real failure.
const NOT_SENT_REASONS = new Set([
  'disabled',
  'sms_disarmed',
  'quiet_hours',
  'suppressed',
  'invalid_phone',
  'above threshold',
  'no recipients',
  'no recipient phone',
  'no recipient',
  'reminders disabled',
  'not configured',
  'no appointment date set, skipping',
]);

function skipToken(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  return NOT_SENT_REASONS.has(t) ? t : null;
}

/**
 * The call succeeded, but nothing actually went out. Returns a short human reason,
 * or null when something really was sent.
 *
 * NOT a failure. Do not throw on it — say it out loud instead.
 * Checked BEFORE invokeFailure by every caller below, because a flattened skip
 * arrives in the same field a real error would.
 */
export function invokeNotSent(res) {
  if (!res) return null;
  if (res.stub || (res.data && res.data.stub)) return 'that integration is not set up yet';
  const d = res.data;
  if (!d) return null;
  if (d.skipped) return typeof d.skipped === 'string' ? d.skipped : 'nothing to send';
  // The flattened case: smsDispatch put the skip reason in `error`.
  const flattened = skipToken(d.error) || skipToken(d.twilioStatus);
  if (flattened) return flattened;
  return null;
}

/**
 * Why this call failed, or null if it didn't.
 * Returns null for a not-sent, so a caller that checks failure first still cannot
 * turn an unconfigured integration into a hard error.
 */
export function invokeFailure(res) {
  if (!res) return 'No response from the server';
  // A not-sent is never a failure, whichever field it arrived in.
  if (invokeNotSent(res)) return null;
  if (res.error) return res.error.message || 'The request failed';
  const d = res.data;
  if (!d) return null;
  if (d.ok === false) return d.reason || d.error || 'The request failed';
  // smsDispatch's `direct` branch. Only a failure once the skip check above has
  // ruled out "switched off".
  if (d.success === false) return d.error || 'The request failed';
  if (typeof d.error === 'string' && d.error) return d.error;
  return null;
}

/**
 * For a queryFn. Throws on failure so TanStack Query sets isError and the UI can
 * show a real failure instead of an empty state that looks like real data.
 */
export function unwrapInvoke(res, fallbackMessage) {
  const failed = invokeFailure(res);
  if (failed) throw new Error(fallbackMessage || failed);
  return res.data;
}

/**
 * For a write that ALSO notifies. Returns the sentence to show, or null.
 *
 * The hard rule this exists to enforce: when the record was saved and only the
 * notification failed, THE SUCCESS PATH MUST STILL RUN. Throwing there leaves the
 * dialog open with the form populated while the row is already committed, and the
 * user's natural retry creates a duplicate record and a second customer email —
 * worse than the silent failure it replaced.
 */
export function deliveryNote(res, { saved, sent }) {
  const failed = invokeFailure(res);
  if (failed) return `${saved}, but ${sent} — ${failed}`;
  const notSent = invokeNotSent(res);
  if (notSent) return `${saved}, but ${sent} — ${notSent}`;
  return null;
}
