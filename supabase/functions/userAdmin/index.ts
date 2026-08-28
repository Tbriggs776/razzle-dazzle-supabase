// User administration — the account lifecycle for staff.
//
// Before this existed, provisioning a hire meant hand-writing SQL against the
// Supabase dashboard, and there was no way at all to lock out a leaver. Eleven
// of thirteen staff had no account.
//
// Every action is gated on the CALLER being an org admin, checked with their own
// JWT (never the service role) so the check cannot be spoofed by calling the
// function directly. The service role is used only to perform the action after
// that check passes.
//
// Deliberately NOT here: setting a user's password. Invites and resets issue a
// one-time link that the admin hands to the person, so nobody — not the admin,
// not this function, not the logs — ever handles someone else's password.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

/** The caller, and whether they are an org admin — evaluated with THEIR token. */
async function caller(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return { user: null, isAdmin: false };
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: got } = await asUser.auth.getUser();
  if (!got?.user) return { user: null, isAdmin: false };
  const { data: isAdmin } = await asUser.rpc('is_org_admin');
  return { user: got.user, isAdmin: !!isAdmin };
}

/** Roster + account state in one shape the UI can render directly. */
async function actList(s: any) {
  const [{ data: team }, { data: users }, { data: roles }, { data: userRoles }] = await Promise.all([
    s.from('team_member').select('id, first_name, last_name, email, phone, role, is_active').order('last_name'),
    s.from('app_user').select('id, team_member_id, is_org_admin, is_active, created_date'),
    s.from('role').select('id, key, name, sort_order').order('sort_order'),
    s.from('user_role').select('user_id, role_id'),
  ]);

  const byTm: Record<string, any> = {};
  for (const u of users || []) if (u.team_member_id) byTm[u.team_member_id] = u;

  const rolesByUser: Record<string, string[]> = {};
  for (const ur of userRoles || []) {
    (rolesByUser[ur.user_id] = rolesByUser[ur.user_id] || []).push(ur.role_id);
  }

  // An auth account whose email matches no team_member still needs to be visible,
  // otherwise it becomes an account nobody can see or disable.
  const linked = new Set((users || []).map((u: any) => u.team_member_id).filter(Boolean));
  const orphans = (users || []).filter((u: any) => !u.team_member_id || !linked.has(u.team_member_id));

  return {
    roles: roles || [],
    people: (team || []).map((tm: any) => {
      const acct = byTm[tm.id] || null;
      return {
        teamMemberId: tm.id,
        name: `${tm.first_name || ''} ${tm.last_name || ''}`.trim(),
        email: tm.email || null,
        phone: tm.phone || null,
        rosterRole: tm.role || null,
        rosterActive: tm.is_active !== false,
        userId: acct?.id || null,
        hasLogin: !!acct,
        accountActive: acct ? acct.is_active !== false : null,
        isOrgAdmin: acct ? !!acct.is_org_admin : false,
        roleIds: acct ? rolesByUser[acct.id] || [] : [],
        createdDate: acct?.created_date || null,
      };
    }),
    orphanAccounts: orphans.map((u: any) => ({
      userId: u.id, isOrgAdmin: !!u.is_org_admin, isActive: u.is_active !== false,
    })),
  };
}

/**
 * Invite: create the auth user and return a one-time link.
 *
 * The auth trigger (handle_new_auth_user) creates the app_user row and links it
 * to the matching team_member by email, so we only assign the role afterwards.
 * We return the link rather than relying on email delivery — no provider is
 * configured yet, and an invite that silently fails to send is worse than one
 * the admin copies deliberately.
 */
async function actInvite(s: any, p: any) {
  const email = String(p.email || '').trim().toLowerCase();
  if (!email) return json({ error: 'email required' }, 400);

  const { data, error } = await s.auth.admin.generateLink({ type: 'invite', email });
  if (error) {
    // Already registered — offer a recovery link instead of failing outright.
    if (/already|registered|exists/i.test(error.message || '')) {
      const { data: rec, error: recErr } = await s.auth.admin.generateLink({ type: 'recovery', email });
      if (recErr) return json({ error: recErr.message }, 400);
      return json({
        ok: true, existing: true,
        userId: rec?.user?.id ?? null,
        link: rec?.properties?.action_link ?? null,
        note: 'That email already has an account — this is a password-reset link.',
      });
    }
    return json({ error: error.message }, 400);
  }

  const userId = data?.user?.id ?? null;
  if (userId && p.roleId) await setRoles(s, userId, [p.roleId]);
  if (userId && p.isOrgAdmin === true) {
    await s.from('app_user').update({ is_org_admin: true }).eq('id', userId);
  }

  return json({ ok: true, userId, link: data?.properties?.action_link ?? null });
}

/** A fresh password-reset link for an existing account. */
async function actResetLink(s: any, p: any) {
  const email = String(p.email || '').trim().toLowerCase();
  if (!email) return json({ error: 'email required' }, 400);
  const { data, error } = await s.auth.admin.generateLink({ type: 'recovery', email });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, link: data?.properties?.action_link ?? null });
}

async function setRoles(s: any, userId: string, roleIds: string[]) {
  await s.from('user_role').delete().eq('user_id', userId);
  const rows = (roleIds || []).filter(Boolean).map((role_id) => ({ user_id: userId, role_id }));
  if (rows.length) await s.from('user_role').insert(rows);
}

async function actSetRoles(s: any, p: any) {
  if (!p.userId) return json({ error: 'userId required' }, 400);
  await setRoles(s, p.userId, Array.isArray(p.roleIds) ? p.roleIds : [p.roleId].filter(Boolean));
  return json({ ok: true });
}

/**
 * Enable/disable. Two locks, deliberately:
 *   app_user.is_active  -> every permission check reads it, so access dies at once
 *   auth ban            -> they cannot obtain a session at all
 * Doing only the first would leave a disabled leaver still able to sign in.
 */
async function actSetActive(s: any, p: any, callerId: string) {
  if (!p.userId) return json({ error: 'userId required' }, 400);
  const active = p.active === true;

  if (!active && p.userId === callerId) {
    return json({ error: 'You cannot disable your own account' }, 400);
  }
  if (!active) {
    const { count } = await s.from('app_user').select('id', { count: 'exact', head: true })
      .eq('is_org_admin', true).eq('is_active', true);
    const { data: target } = await s.from('app_user').select('is_org_admin').eq('id', p.userId).maybeSingle();
    if (target?.is_org_admin && (count ?? 0) <= 1) {
      return json({ error: 'That is the last active org admin — promote someone else first' }, 400);
    }
  }

  await s.from('app_user').update({ is_active: active }).eq('id', p.userId);
  await s.auth.admin.updateUserById(p.userId, { ban_duration: active ? 'none' : '876000h' });
  return json({ ok: true, active });
}

async function actSetOrgAdmin(s: any, p: any, callerId: string) {
  if (!p.userId) return json({ error: 'userId required' }, 400);
  const makeAdmin = p.isOrgAdmin === true;

  if (!makeAdmin) {
    if (p.userId === callerId) return json({ error: 'You cannot remove your own admin rights' }, 400);
    const { count } = await s.from('app_user').select('id', { count: 'exact', head: true })
      .eq('is_org_admin', true).eq('is_active', true);
    if ((count ?? 0) <= 1) {
      return json({ error: 'That is the last org admin — promote someone else first' }, 400);
    }
  }

  await s.from('app_user').update({ is_org_admin: makeAdmin }).eq('id', p.userId);
  return json({ ok: true, isOrgAdmin: makeAdmin });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const { user, isAdmin } = await caller(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (!isAdmin) return json({ error: 'Organization admin required' }, 403);

  const s = svc();
  try {
    const p = await req.json().catch(() => ({}));
    switch (p?.action) {
      case 'list':          return json({ ok: true, ...(await actList(s)) });
      case 'invite':        return await actInvite(s, p);
      case 'reset_link':    return await actResetLink(s, p);
      case 'set_roles':     return await actSetRoles(s, p);
      case 'set_active':    return await actSetActive(s, p, user.id);
      case 'set_org_admin': return await actSetOrgAdmin(s, p, user.id);
      default:              return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
