// The module gate for edge functions — the JWT punch list's fix (0114).
//
// Every function that used this file's callers previously stopped at "the JWT
// resolves to a user". That admitted two callers it must not: subcontractor
// crew logins (ACTIVE app_user rows, zero roles — the portal work deliberately
// activates them) and inactive roster-less signups (whose Supabase session
// keeps working after we decline to provision them).
//
// Both are excluded by asking the access model instead of the auth server:
//   requireModules(...)   any of the listed modules at >= level
//   requireActiveStaff()  active + (org admin or holds >= 1 role)
// Both run AS THE CALLER (user-JWT client), so current_user_module_permission's
// is_active and entitlement checks apply. Both RPCs are granted to
// `authenticated` only (0114) and are SECURITY DEFINER on auth.uid().
//
// Return null when allowed, or a ready-to-return 403 Response when not — so a
// call site is two lines and cannot forget to return.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

function userClient(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

const deny = (cors: Record<string, string>) =>
  Response.json({ error: 'Not authorized' }, { status: 403, headers: cors });

/** Allow when the caller holds ANY of `modules` at >= `level`. */
export async function requireModules(
  req: Request, cors: Record<string, string>,
  modules: string[], level: 'view' | 'edit' | 'admin' = 'view',
): Promise<Response | null> {
  const u = userClient(req);
  if (!u) return deny(cors);
  const { data, error } = await u.rpc('has_module_access', { p_modules: modules, p_level: level });
  if (error || data !== true) return deny(cors);
  return null;
}

/** Allow ONLY an org admin. For the functions whose whole job is privileged
 *  (userAdmin-pattern; opsFlowAdvise). Runs as the caller, so is_org_admin's
 *  is_active check applies too. */
export async function requireOrgAdmin(
  req: Request, cors: Record<string, string>,
): Promise<Response | null> {
  const u = userClient(req);
  if (!u) return deny(cors);
  const { data, error } = await u.rpc('is_org_admin');
  if (error || data !== true) return deny(cors);
  return null;
}

/** Allow any active staff member (org admin or >= 1 role). For the generic
 *  dispatchers whose legitimate callers span too many modules for an honest
 *  narrow list — the point is excluding crew and inactive logins. */
export async function requireActiveStaff(
  req: Request, cors: Record<string, string>,
): Promise<Response | null> {
  const u = userClient(req);
  if (!u) return deny(cors);
  const { data, error } = await u.rpc('is_active_staff');
  if (error || data !== true) return deny(cors);
  return null;
}
