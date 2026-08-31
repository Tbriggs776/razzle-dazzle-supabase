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

async function actSetRoles(s: any, p: any, callerId: string) {
  if (!p.userId) return json({ error: 'userId required' }, 400);
  const roleIds = Array.isArray(p.roleIds) ? p.roleIds : [p.roleId].filter(Boolean);
  const { data: before } = await s.from('user_role').select('role_id').eq('user_id', p.userId);
  await setRoles(s, p.userId, roleIds);
  await audit(s, callerId, 'set_roles', {
    userId: p.userId, before: (before || []).map((r: any) => r.role_id), after: roleIds,
  });
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
  await audit(s, callerId, 'set_active', { userId: p.userId, active });
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
  await audit(s, callerId, 'set_org_admin', { userId: p.userId, isOrgAdmin: makeAdmin });
  return json({ ok: true, isOrgAdmin: makeAdmin });
}


// ── The role matrix (razzle-role-matrix spec) ────────────────────────────────
// Rights are a role × module cell. These five actions are the ONLY write path
// the UI uses — never PostgREST — so the guards below (system-role lock,
// core-module floor, org fencing) cannot be skipped, and every change lands in
// access_change_log. The audit is best-effort by design: blocking an access
// change on an audit insert would trade a record for a lockout.

const PERMS = ['none', 'view', 'edit', 'admin'];
const ROLE_KEY_RE = /^[a-z][a-z0-9_]+$/;

async function callerOrg(s: any, userId: string): Promise<string | null> {
  const { data } = await s.from('app_user').select('org_id').eq('id', userId).maybeSingle();
  return data?.org_id ?? null;
}

async function audit(s: any, actorId: string, action: string, target: Record<string, unknown>) {
  try {
    const org_id = await callerOrg(s, actorId);
    if (!org_id) return;
    await s.from('access_change_log').insert({ org_id, actor_user_id: actorId, action, target });
  } catch (e) {
    console.error('access audit insert failed', e);
  }
}

async function actListMatrix(s: any, callerId: string) {
  const org = await callerOrg(s, callerId);
  const [{ data: modules }, { data: ents }, { data: roles }, { data: cells }, { data: urs }] = await Promise.all([
    s.from('module').select('key, name, sort_order, is_core').eq('is_active', true).order('sort_order'),
    s.from('org_module_entitlement').select('module_key, is_enabled').eq('org_id', org),
    s.from('role').select('id, key, name, sort_order, is_system').eq('org_id', org).order('sort_order'),
    s.from('role_module_permission').select('role_id, module_key, permission'),
    s.from('user_role').select('role_id'),
  ]);
  // A MISSING entitlement row means NOT entitled — that is how the 0002
  // resolver reads it, so the matrix must say the same.
  const entitled: Record<string, boolean> = {};
  for (const e of ents || []) entitled[e.module_key] = e.is_enabled === true;
  const counts: Record<string, number> = {};
  for (const ur of urs || []) counts[ur.role_id] = (counts[ur.role_id] || 0) + 1;
  const roleIds = new Set((roles || []).map((r: any) => r.id));
  return {
    modules: (modules || []).map((m: any) => ({ ...m, entitled: entitled[m.key] === true })),
    roles: (roles || []).map((r: any) => ({ ...r, assignedCount: counts[r.id] || 0 })),
    cells: (cells || []).filter((c: any) => roleIds.has(c.role_id)),
  };
}

async function actSetCell(s: any, p: any, callerId: string) {
  const { roleId, moduleKey, permission } = p || {};
  if (!roleId || !moduleKey) return json({ error: 'roleId and moduleKey required' }, 400);
  if (!PERMS.includes(permission)) return json({ error: `permission must be one of ${PERMS.join(', ')}` }, 400);

  const org = await callerOrg(s, callerId);
  const { data: role } = await s.from('role').select('id, key, name, is_system, org_id')
    .eq('id', roleId).maybeSingle();
  if (!role || role.org_id !== org) return json({ error: 'No such role in this organization' }, 400);
  if (role.is_system) return json({ error: 'The Administrator role is locked — clone it to make a weaker owner role' }, 400);

  const { data: mod } = await s.from('module').select('key, is_core, is_active').eq('key', moduleKey).maybeSingle();
  if (!mod || !mod.is_active) return json({ error: 'Unknown module' }, 400);
  if (mod.is_core && permission === 'none') {
    return json({ error: `${moduleKey} is a core module — every staff role keeps at least view, so nobody can be locked out of their own landing pages` }, 400);
  }

  const { data: before } = await s.from('role_module_permission').select('permission')
    .eq('role_id', roleId).eq('module_key', moduleKey).maybeSingle();
  const { error } = await s.from('role_module_permission')
    .upsert({ role_id: roleId, module_key: moduleKey, permission }, { onConflict: 'role_id,module_key' });
  if (error) return json({ error: error.message }, 400);

  await audit(s, callerId, 'set_cell', {
    roleId, roleKey: role.key, moduleKey, before: before?.permission ?? 'none', after: permission,
  });
  return json({ ok: true });
}

async function actSetEntitlement(s: any, p: any, callerId: string) {
  const { moduleKey } = p || {};
  const enabled = p?.enabled === true;
  if (!moduleKey) return json({ error: 'moduleKey required' }, 400);
  const { data: mod } = await s.from('module').select('key, is_core').eq('key', moduleKey).maybeSingle();
  if (!mod) return json({ error: 'Unknown module' }, 400);
  if (mod.is_core && !enabled) {
    return json({ error: `${moduleKey} is a core module and cannot be switched off for the company` }, 400);
  }
  const org = await callerOrg(s, callerId);
  const { data: before } = await s.from('org_module_entitlement').select('is_enabled')
    .eq('org_id', org).eq('module_key', moduleKey).maybeSingle();
  const { error } = await s.from('org_module_entitlement')
    .upsert({ org_id: org, module_key: moduleKey, is_enabled: enabled }, { onConflict: 'org_id,module_key' });
  if (error) return json({ error: error.message }, 400);

  await audit(s, callerId, 'set_entitlement', { moduleKey, before: before?.is_enabled ?? false, after: enabled });
  return json({ ok: true });
}

async function actCloneRole(s: any, p: any, callerId: string) {
  const { sourceRoleId } = p || {};
  const name = String(p?.name || '').trim();
  const key = String(p?.key || '').trim();
  if (!sourceRoleId || !name || !key) return json({ error: 'sourceRoleId, name and key required' }, 400);
  if (!ROLE_KEY_RE.test(key)) {
    return json({ error: 'key must be lowercase letters, digits and underscores, starting with a letter (e.g. csr_west)' }, 400);
  }
  const org = await callerOrg(s, callerId);
  const { data: src } = await s.from('role').select('id, key, name, sort_order, org_id')
    .eq('id', sourceRoleId).maybeSingle();
  if (!src || src.org_id !== org) return json({ error: 'No such role in this organization' }, 400);
  const { data: dupe } = await s.from('role').select('id').eq('org_id', org).eq('key', key).maybeSingle();
  if (dupe) return json({ error: `A role with key "${key}" already exists` }, 400);

  const { data: maxRow } = await s.from('role').select('sort_order').eq('org_id', org)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const { data: created, error } = await s.from('role')
    .insert({ org_id: org, key, name, is_system: false, sort_order: (maxRow?.sort_order ?? 0) + 10 })
    .select('id, key, name, sort_order, is_system').single();
  if (error) return json({ error: error.message }, 400);

  // Copy every cell, so the clone starts as an exact twin the admin then edits.
  const { data: cells } = await s.from('role_module_permission')
    .select('module_key, permission').eq('role_id', sourceRoleId);
  if (cells?.length) {
    const { error: copyErr } = await s.from('role_module_permission')
      .insert(cells.map((c: any) => ({ role_id: created.id, module_key: c.module_key, permission: c.permission })));
    if (copyErr) return json({ error: `Role created but cells failed to copy: ${copyErr.message}` }, 500);
  }

  await audit(s, callerId, 'clone_role', {
    sourceRoleId, sourceKey: src.key, newRoleId: created.id, newKey: key, name, cellsCopied: cells?.length ?? 0,
  });
  return json({ ok: true, role: { ...created, assignedCount: 0 } });
}

async function actRenameRole(s: any, p: any, callerId: string) {
  const { roleId } = p || {};
  const name = String(p?.name || '').trim();
  if (!roleId || !name) return json({ error: 'roleId and name required' }, 400);
  const org = await callerOrg(s, callerId);
  const { data: role } = await s.from('role').select('id, key, name, is_system, org_id')
    .eq('id', roleId).maybeSingle();
  if (!role || role.org_id !== org) return json({ error: 'No such role in this organization' }, 400);
  if (role.is_system) return json({ error: 'The Administrator role cannot be renamed' }, 400);

  // Display name only. `key` is the stable identity that user_role rows,
  // playbook targeting and SOP assignments hang off — it never changes.
  const { error } = await s.from('role').update({ name }).eq('id', roleId);
  if (error) return json({ error: error.message }, 400);

  await audit(s, callerId, 'rename_role', { roleId, key: role.key, before: role.name, after: name });
  return json({ ok: true });
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
      case 'set_roles':     return await actSetRoles(s, p, user.id);
      case 'set_active':    return await actSetActive(s, p, user.id);
      case 'set_org_admin': return await actSetOrgAdmin(s, p, user.id);
      case 'list_matrix':   return json({ ok: true, ...(await actListMatrix(s, user.id)) });
      case 'set_cell':      return await actSetCell(s, p, user.id);
      case 'set_entitlement': return await actSetEntitlement(s, p, user.id);
      case 'clone_role':    return await actCloneRole(s, p, user.id);
      case 'rename_role':   return await actRenameRole(s, p, user.id);
      default:              return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
