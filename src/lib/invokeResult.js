/**
 * The invoke contract, in ONE place.
 *
 * `base44.functions.invoke()` returns `{ data, error }` and NEVER THROWS, so every
 * try/catch wrapped around it is dead code and every call site that ignores the
 * result reports success when the call failed. That much was already known.
 *
 * What a first sweep got wrong — and it is the reason these helpers exist rather
 * than a rule applied 136 times by hand — is that this codebase has THREE distinct
 * "it didn't work" signals, not one:
 *
 *   res.error            transport / non-2xx. A real failure.
 *   res.data.ok === false  explicit failure from an RPC.   (46 uses)
 *   res.data.skipped     HTTP 200, but nothing was sent.   (48 uses)
 *   res.data.stub        the integration isn't configured. (28 uses)
 *
 * `skipped` is the MOST common one and is exactly the case we care about most:
 * smsDispatch and emailDispatch return 200 with `{ skipped: 'disabled' }` or
 * `{ skipped: 'no recipient phone' }`. A guard that only checks `error` and `ok`
 * passes straight through it, so SMS switched off in Settings still reports a
 * cheerful success — the original bug, untouched.
 *
 * The split matters because the two categories need OPPOSITE handling:
 *   - a failure should throw / block / offer a retry.
 *   - a not-sent is not an error and must NEVER be thrown, or an unconfigured
 *     integration becomes a hard error the user cannot act on. It still has to be
 *     said out loud, because a false "sent!" is worse than either.
 */

/**
 * Why this call failed, or null if it didn't.
 * Use in a queryFn (`if (msg) throw new Error(msg)`) or a handler (toast + return).
 */
export function invokeFailure(res) {
  if (!res) return 'No response from the server';
  if (res.error) return res.error.message || 'The request failed';
  const d = res.data;
  if (d && d.ok === false) return d.reason || d.error || 'The request failed';
  if (d && typeof d.error === 'string' && d.error) return d.error;
  return null;
}

/**
 * The call succeeded, but nothing actually went out. Returns a short human reason,
 * or null when something really was sent.
 *
 * NOT a failure. Do not throw on it — tell the user plainly instead.
 */
export function invokeNotSent(res) {
  if (!res) return null;
  if (res.stub || (res.data && res.data.stub)) return 'that integration is not set up yet';
  const skipped = res.data && res.data.skipped;
  if (skipped) return typeof skipped === 'string' ? skipped : 'nothing to send';
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
 * notification failed, the SUCCESS PATH MUST STILL RUN. Throwing there leaves the
 * dialog open with the form populated while the row is already committed, and the
 * user's natural retry creates a duplicate record and a second customer email —
 * which is worse than the silent failure it replaced.
 */
export function deliveryNote(res, { saved, sent }) {
  const failed = invokeFailure(res);
  if (failed) return `${saved}, but ${sent} — ${failed}`;
  const notSent = invokeNotSent(res);
  if (notSent) return `${saved}, but ${sent} — ${notSent}`;
  return null;
}
