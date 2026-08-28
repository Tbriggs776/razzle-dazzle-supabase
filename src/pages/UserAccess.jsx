import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Search, Users, ShieldCheck, ShieldAlert, Copy, Check,
  KeyRound, UserPlus, Lock, Unlock, AlertTriangle, Link2,
} from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import DataTable from '@/components/common/DataTable';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// Sentinel for "no role" — the Select treats '' as "nothing chosen" and shows the placeholder,
// so clearing a role needs a real value to select.
const NO_ROLE = '__none__';

/**
 * The userAdmin function returns its guard errors as non-2xx JSON ({ error: "…" }), and
 * supabase-js collapses those into a generic "non-2xx status code" Error. Those guards
 * ("last active org admin", "cannot disable your own account") are the whole point of this
 * screen, so dig the real message out of the attached Response before giving up on it.
 */
async function readEdgeFailure(res) {
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

async function callUserAdmin(payload) {
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

function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-crit">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 font-medium">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-[11px] font-semibold uppercase tracking-wide opacity-70 hover:opacity-100"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

export default function UserAccess() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [banner, setBanner] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [linkModal, setLinkModal] = useState(null); // { name, email, link, existing, note, kind }
  const [confirmDisable, setConfirmDisable] = useState(null); // person
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    retry: false,
  });

  const {
    data,
    isLoading,
    error: listError,
  } = useQuery({
    queryKey: ['userAdmin', 'list'],
    queryFn: () => callUserAdmin({ action: 'list' }),
    retry: false,
  });

  const action = useMutation({
    mutationFn: (payload) => callUserAdmin(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['userAdmin', 'list'] }),
    onError: (e) => setBanner(e?.message || 'Something went wrong.'),
  });

  const run = async (key, payload) => {
    setBanner(null);
    setBusyKey(key);
    try {
      return await action.mutateAsync(payload);
    } catch {
      return null; // onError already surfaced the message in the banner
    } finally {
      setBusyKey(null);
    }
  };

  const people = data?.people || [];
  const roles = data?.roles || [];
  const orphanAccounts = data?.orphanAccounts || [];

  const stats = useMemo(() => {
    const withLogin = people.filter((p) => p.hasLogin);
    return {
      total: people.length,
      withLogin: withLogin.length,
      noLogin: people.length - withLogin.length,
      disabled: withLogin.filter((p) => p.accountActive === false).length,
      admins: withLogin.filter((p) => p.isOrgAdmin).length,
    };
  }, [people]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      [p.name, p.email, p.rosterRole].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [people, search]);

  // ---- actions -------------------------------------------------------------
  const openLink = (person, res, kind) => {
    if (!res?.link) {
      setBanner(
        `${person.name || person.email} was processed, but no link came back. Try "Reset link" to generate one.`
      );
      return;
    }
    setCopied(false);
    setCopyFailed(false);
    setLinkModal({
      name: person.name || person.email,
      email: person.email,
      link: res.link,
      existing: !!res.existing,
      note: res.note || null,
      kind,
    });
  };

  const invite = async (person) => {
    if (!person.email) {
      setBanner(`${person.name || 'That person'} has no email on the roster — add one before inviting them.`);
      return;
    }
    const res = await run(person.teamMemberId, { action: 'invite', email: person.email });
    if (res) openLink(person, res, 'invite');
  };

  const resetLink = async (person) => {
    if (!person.email) {
      setBanner(`${person.name || 'That person'} has no email on the roster.`);
      return;
    }
    const res = await run(person.teamMemberId, { action: 'reset_link', email: person.email });
    if (res) openLink(person, res, 'reset');
  };

  const changeRole = (person, value) => {
    if (!person.userId) return;
    run(person.teamMemberId, {
      action: 'set_roles',
      userId: person.userId,
      roleIds: value === NO_ROLE ? [] : [value],
    });
  };

  const setActive = (person, active) => {
    if (!person.userId) return;
    run(person.teamMemberId, { action: 'set_active', userId: person.userId, active });
  };

  const setOrgAdmin = (person, isOrgAdmin) => {
    if (!person.userId) return;
    run(person.teamMemberId, { action: 'set_org_admin', userId: person.userId, isOrgAdmin });
  };

  const copyLink = async () => {
    if (!linkModal?.link) return;
    try {
      await navigator.clipboard.writeText(linkModal.link);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  // ---- gates ---------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const denied =
    listError && (listError.status === 403 || /organization admin required/i.test(listError.message || ''));

  if (denied) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <h1 className="font-display text-xl font-extrabold tracking-tight">Restricted</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              You need organization admin rights to manage user access. Ask an owner to grant them.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (listError) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-3xl space-y-4">
          <PageHeader eyebrow="Administration" title="User Access" subtitle="Could not load staff accounts." />
          <ErrorBanner message={listError.message || 'Could not load staff accounts.'} />
          <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ['userAdmin', 'list'] })}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // ---- table ---------------------------------------------------------------
  const columns = [
    {
      key: 'person',
      header: 'Person',
      render: (p) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-foreground">{p.name || 'Unnamed'}</span>
            {currentUser?.id && p.userId === currentUser.id && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                You
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">{p.email || 'No email on the roster'}</div>
        </div>
      ),
    },
    {
      key: 'rosterRole',
      header: 'Roster role',
      render: (p) => <span className="text-sm text-muted-foreground">{p.rosterRole || '—'}</span>,
    },
    {
      key: 'access',
      header: 'Access',
      render: (p) => {
        if (!p.hasLogin) return <StatusPill tone="warn" dot>No login</StatusPill>;
        if (p.accountActive === false) return <StatusPill tone="crit" dot>Disabled</StatusPill>;
        if (p.isOrgAdmin) return <StatusPill tone="info" dot>Org admin</StatusPill>;
        return <StatusPill tone="good" dot>Active</StatusPill>;
      },
    },
    {
      key: 'role',
      header: 'Role',
      render: (p) => (
        <div className="w-40">
          <Select
            value={p.roleIds?.[0] || NO_ROLE}
            onValueChange={(v) => changeRole(p, v)}
            disabled={!p.hasLogin || busyKey === p.teamMemberId}
          >
            <SelectTrigger className="h-8 bg-card text-xs">
              <SelectValue placeholder={p.hasLogin ? 'No role' : '—'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ROLE}>No role</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (p) => {
        const busy = busyKey === p.teamMemberId;
        if (!p.hasLogin) {
          return (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !p.email}
                onClick={() => invite(p)}
                title={p.email ? `Create an account for ${p.email}` : 'No email on the roster'}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                Invite
              </Button>
            </div>
          );
        }
        return (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label
              className={cn(
                'flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide',
                p.isOrgAdmin ? 'text-info' : 'text-muted-foreground',
                busy && 'pointer-events-none opacity-50'
              )}
              title="Organization admin — full access, including this page"
            >
              <Switch
                checked={!!p.isOrgAdmin}
                disabled={busy}
                onCheckedChange={(v) => setOrgAdmin(p, v)}
                aria-label={`Org admin for ${p.name || p.email}`}
              />
              Admin
            </label>
            <Button size="sm" variant="ghost" disabled={busy || !p.email} onClick={() => resetLink(p)}>
              <KeyRound className="h-3.5 w-3.5" />
              Reset link
            </Button>
            {p.accountActive === false ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setActive(p, true)}>
                <Unlock className="h-3.5 w-3.5" />
                Enable
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmDisable(p)}>
                <Lock className="h-3.5 w-3.5" />
                Disable
              </Button>
            )}
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
        );
      },
    },
  ];

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Administration"
          title="User Access"
          subtitle={`${stats.withLogin} of ${stats.total} staff can sign in. Invite, disable, and set roles here.`}
        />

        <ErrorBanner message={banner} onDismiss={() => setBanner(null)} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Staff with a login"
            value={`${stats.withLogin} of ${stats.total}`}
            hero
            foot="Can sign in to the app today"
          />
          <KpiTile
            label="No login yet"
            value={stats.noLogin}
            delta={stats.noLogin > 0 ? 'Needs an invite' : 'All set'}
            deltaTone={stats.noLogin > 0 ? 'bad' : 'good'}
            foot="On the roster, no account"
          />
          <KpiTile
            label="Disabled"
            value={stats.disabled}
            foot="Locked out — cannot sign in"
          />
          <KpiTile
            label="Org admins"
            value={stats.admins}
            foot={
              stats.admins === 1
                ? 'Only one admin — a single point of failure. Promote a second.'
                : stats.admins === 0
                  ? 'No admins on the roster.'
                  : 'Can manage users and settings'
            }
          />
        </div>

        <ModuleCard
          title="Staff accounts"
          subtitle={`${visible.length} of ${people.length} ${people.length === 1 ? 'person' : 'people'}`}
          icon={Users}
          bodyClassName="divide-y-0"
          action={
            <div className="relative w-44 sm:w-60">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, email, role…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 border-border bg-card pl-9"
              />
            </div>
          }
          footer={
            <span className="text-muted-foreground">
              Invites and resets return a one-time link you send to the person yourself — email delivery is not
              configured yet.
            </span>
          }
        >
          <DataTable
            className="rounded-none border-0"
            columns={columns}
            data={visible}
            rowKey={(p) => p.teamMemberId}
            empty={
              <div className="px-4 text-center">
                <Users className="mx-auto mb-3 h-9 w-9 text-muted-foreground/60" />
                <h3 className="text-sm font-semibold text-foreground">
                  {search ? 'No matching staff' : 'No staff on the roster'}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {search ? 'Try a different name or email.' : 'Add team members before granting access.'}
                </p>
              </div>
            }
          />
        </ModuleCard>

        {orphanAccounts.length > 0 && (
          <ModuleCard
            title="Unlinked accounts"
            subtitle={`${orphanAccounts.length} account${orphanAccounts.length === 1 ? '' : 's'} not matched to anyone on the roster`}
            icon={ShieldAlert}
            bodyClassName="divide-y-0"
          >
            <div className="px-4 py-3 text-xs text-muted-foreground">
              These sign-in accounts exist but their email does not match a team member. Add the matching person to
              the roster with the same email, or have an owner remove the account.
              <div className="mt-2 flex flex-wrap gap-2">
                {orphanAccounts.map((o) => (
                  <span
                    key={o.userId}
                    className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-[10.5px]"
                  >
                    {o.userId.slice(0, 8)}…
                    {o.isOrgAdmin ? ' · admin' : ''}
                    {o.isActive ? '' : ' · disabled'}
                  </span>
                ))}
              </div>
            </div>
          </ModuleCard>
        )}
      </div>

      {/* One-time link — the actual deliverable, since nothing is emailed. */}
      <Dialog open={!!linkModal} onOpenChange={(v) => !v && setLinkModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-extrabold">
              {linkModal?.kind === 'reset' ? 'Password reset link' : 'Invite link'}
            </DialogTitle>
            <DialogDescription>
              For <span className="font-medium text-foreground">{linkModal?.name}</span>
              {linkModal?.email ? ` (${linkModal.email})` : ''}.
            </DialogDescription>
          </DialogHeader>

          {linkModal?.existing && (
            <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{linkModal.note || 'That email already had an account — this is a password-reset link.'}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              One-time link
            </Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={linkModal?.link || ''}
                onFocus={(e) => e.target.select()}
                className="flex-1 bg-muted font-mono text-xs"
              />
              <Button variant={copied ? 'outline' : 'accent'} onClick={copyLink} className="shrink-0">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            {copyFailed && (
              <p className="text-xs text-crit">Copy failed — select the link above and copy it manually.</p>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
            <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Email delivery is not configured yet, so nothing was sent. <strong className="text-foreground">Send
              this link to them yourself</strong> — it works once, and it is the only copy. Generate a fresh one with
              &ldquo;Reset link&rdquo; if it is lost.
            </span>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkModal(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disabling is the destructive one — say exactly what it does. */}
      <Dialog open={!!confirmDisable} onOpenChange={(v) => !v && setConfirmDisable(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-extrabold">
              Disable {confirmDisable?.name || 'this account'}?
            </DialogTitle>
            <DialogDescription>
              This revokes all access immediately and blocks sign-in — their session stops working and they cannot
              log back in. Their roster record and history stay intact, and you can re-enable them at any time.
            </DialogDescription>
          </DialogHeader>
          {confirmDisable?.isOrgAdmin && (
            <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>This person is an organization admin.</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDisable(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busyKey === confirmDisable?.teamMemberId}
              onClick={() => {
                const p = confirmDisable;
                setConfirmDisable(null);
                if (p) setActive(p, false);
              }}
            >
              <Lock className="h-4 w-4" />
              Disable access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
