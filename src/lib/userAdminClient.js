import { base44 } from '@/api/base44Client';

/**
 * The one way to talk to the userAdmin function.
 *
 * Extracted from UserAccess so the Users list and the User detail screen cannot
 * drift apart on error handling — which matters more here than anywhere else in
 * the app, because userAdmin's REFUSALS are the feature. "You cannot remove the
 * last org admin" and "you cannot disable your own account" arrive as non-2xx
 * JSON, and supabase-js flattens those into a useless "non-2xx status code"
 * Error. Digging the real sentence out of the attached Response is the whole
 * reason this helper exists.
 */
export async function readEdgeFailure(res) {
  if (res?.data?.error) return { message: String(res.data.error), status: null };
  const err = res?.error;
  if (!err) return null;
  let message = err.message || 'The request failed.';
  let status = typeof err.status === 'number' ? err.status : null;
  const ctx = err.context;
  if (ctx && typeof ctx === 'object') {
    if (typeof ctx.status === 'number') status = ctx.status;
    try {
      const body = await (typeof ctx.clone === 'function' ? ctx.clone() : ctx).json();
      if (body?.error) message = String(body.error);
    } catch {
      /* body already consumed or not JSON — fall back to the generic message */
    }
  }
  if (/non-2xx/i.test(message)) {
    message = status ? `The request failed (HTTP ${status}).` : 'The request failed.';
  }
  return { message, status };
}

export async function callUserAdmin(payload) {
  const res = await base44.functions.invoke('userAdmin', payload);
  const failure = await readEdgeFailure(res);
  if (failure) {
    const e = new Error(failure.message);
    e.status = failure.status;
    throw e;
  }
  if (!res?.data) throw new Error('User administration is not available in this environment.');
  return res.data;
}

/** True when the failure is userAdmin refusing a non-admin, not a broken call. */
export const isAccessDenied = (err) =>
  !!err && (err.status === 403 || /organization admin required/i.test(err.message || ''));
