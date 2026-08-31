import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Search, UserPlus, Lock, AlertTriangle, ShieldCheck,
  Link2, ChevronRight, X,
} from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import DataTable from '@/components/common/DataTable';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { createPageUrl } from '@/utils';
import RoleMatrix from '@/components/admin/RoleMatrix';
import TeamMemberForm from '@/components/team/TeamMemberForm';
import { callUserAdmin, isAccessDenied } from '@/lib/userAdminClient';
import { toast } from 'sonner';

/**
 * Users — one screen for every person in the company.
 *
 * This replaces the old split between "Team Members" (who someone IS: name,
 * phone, roster role, calendar) and "User Access" (what someone may DO: login,
 * app role, org admin). That split was an artifact of the migration — the
 * roster came from base44, the access model was built here — and it forced an
 * admin to know which of two screens in two different menus held the control
 * they wanted. Nobody should have to know that. One list, one detail page.
 *
 * The two records still exist underneath and are still different things:
 *   team_member  — the person. Exists for all 52 staff, login or not.
 *   app_user     — the login. Created by an invite, linked to the roster row
 *                  by matching email (handle_new_auth_user).
 * A person with no login is normal, not broken: they are on the roster and
 * simply cannot sign in yet.
 */

const LOGIN_TONE = { active: 'good', disabled: 'crit', none: 'neutral' };

function loginState(p) {
  if (!p.hasLogin) return { key: 'none', label: 'No login' };
  return p.accountActive === false
    ? { key: 'disabled', label: 'Disabled' }
    : { key: 'active', label: 'Active' };
}

export default function Users() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState('users');
  const [search, setSearch] = useState('');
  const [banner, setBanner] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading, error: listError } = useQuery({
    queryKey: ['userAdmin', 'list'],
    queryFn: () => callUserAdmin({ action: 'list' }),
    retry: false,
  });

  const people = data?.people || [];
  const roles = data?.roles || [];
  const orphanAccounts = data?.orphanAccounts || [];
  const roleName = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.id, r.name || r.key])),
    [roles]
  );

  // Adding a person creates the ROSTER record only. The login is a separate,
  // deliberate act on their detail page — you should be able to put someone on
  // the roster (for assignment, calendars, payroll) without handing them a key.
  const addPerson = useMutation({
    mutationFn: (form) => base44.entities.TeamMember.create(form),
    onSuccess: (created) => {
      setAddOpen(false);
      qc.invalidateQueries({ queryKey: ['userAdmin', 'list'] });
      qc.invalidateQueries({ queryKey: ['teamMembers'] });
      toast.success('Added to the roster — open them to grant a login');
      if (created?.id) navigate(createPageUrl('UserDetail') + `?id=${created.id}`);
    },
    onError: (e) => setBanner(e?.message || 'Could not add that person.'),
  });

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
    const rows = q
      ? people.filter((p) =>
          [p.name, p.email, p.rosterRole].filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)))
      : people;
    // People who cannot sign in yet float up: that is the actionable list.
    return [...rows].sort((a, b) =>
      Number(a.hasLogin) - Number(b.hasLogin) ||
      String(a.name || '').localeCompare(String(b.name || ''))
    );
  }, [people, search]);

  const columns = useMemo(() => [
    {
      key: 'person',
      header: 'Person',
      render: (p) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{p.name || '—'}</div>
          <div className="truncate text-xs text-muted-foreground">{p.email || 'No email on file'}</div>
        </div>
      ),
    },
    {
      key: 'roster',
      header: 'Roster role',
      render: (p) => (
        <span className="text-sm text-muted-foreground">{p.rosterRole || '—'}</span>
      ),
    },
    {
      key: 'login',
      header: 'Login',
      render: (p) => {
        const s = loginState(p);
        return <StatusPill tone={LOGIN_TONE[s.key]}>{s.label}</StatusPill>;
      },
    },
    {
      key: 'access',
      header: 'Access',
      render: (p) => {
        if (!p.hasLogin) return <span className="text-xs text-muted-foreground">—</span>;
        const names = (p.roleIds || []).map((id) => roleName[id]).filter(Boolean);
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {p.isOrgAdmin && (
              <StatusPill tone="info">
                <ShieldCheck className="mr-1 h-3 w-3" />Org admin
              </StatusPill>
            )}
            {names.length > 0
              ? names.map((n) => (
                  <span key={n} className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium">
                    {n}
                  </span>
                ))
              : !p.isOrgAdmin && <span className="text-xs text-warn">No role — sees nothing</span>}
          </div>
        );
      },
    },
    {
      key: 'go',
      header: '',
      render: () => <ChevronRight className="h-4 w-4 text-muted-foreground" />,
    },
  ], [roleName]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAccessDenied(listError)) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="font-display text-xl font-extrabold tracking-tight">Restricted</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Managing people and their access is limited to organization admins.
          </p>
        </div>
      </div>
    );
  }

  if (listError) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-2xl rounded-xl border border-crit/30 bg-crit/10 p-6 text-sm text-foreground">
          <p className="font-semibold text-crit">Could not load users</p>
          <p className="mt-1 text-muted-foreground">{listError.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="System"
          title="Users"
          subtitle="Everyone in the company — who they are, whether they can sign in, and what they can reach. Open a person to change any of it."
          actions={
            <Button className="gap-1.5" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4" /> Add person
            </Button>
          }
        />

        {banner && (
          <div className="flex items-start gap-2.5 rounded-xl border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-crit">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1 font-medium">{banner}</p>
            <button type="button" onClick={() => setBanner(null)} aria-label="Dismiss"
              className="shrink-0 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiTile label="People" value={stats.total} hero foot="On the roster" />
          <KpiTile label="Can sign in" value={stats.withLogin} foot="Have a login" />
          <KpiTile label="No login yet" value={stats.noLogin}
            delta={stats.noLogin ? 'invite to grant access' : null}
            foot="On the roster, cannot sign in" />
          <KpiTile label="Disabled" value={stats.disabled} deltaTone="bad"
            foot="Login switched off" />
          <KpiTile label="Org admins" value={stats.admins} foot="Full control of this screen" />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-border">
          {[['users', 'Users'], ['roles', 'Roles & permissions']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
                tab === key
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'roles' ? (
          <RoleMatrix />
        ) : (
          <>
            <ModuleCard
              title="Everyone"
              subtitle={`${visible.length} of ${people.length} — people without a login are listed first`}
              icon={UserPlus}
              action={
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name, email, role"
                    aria-label="Search people"
                    className="h-8 w-[180px] pl-8 text-xs sm:w-[260px]"
                  />
                </div>
              }
            >
              {visible.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nobody matches “{search}”.
                </p>
              ) : (
                <DataTable
                  className="rounded-none border-0"
                  columns={columns}
                  data={visible}
                  rowKey={(p) => p.teamMemberId}
                  onRowClick={(p) => navigate(createPageUrl('UserDetail') + `?id=${p.teamMemberId}`)}
                />
              )}
            </ModuleCard>

            {orphanAccounts.length > 0 && (
              <ModuleCard
                title="Logins with no roster record"
                subtitle="Signed-up accounts that match nobody on the roster. Add a person with the same email to link them, or disable the account."
                icon={Link2}
              >
                {orphanAccounts.map((a) => (
                  <div key={a.userId}
                    className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 last:border-0">
                    <span className="font-mono text-xs text-muted-foreground">{a.userId}</span>
                    <div className="flex items-center gap-1.5">
                      {a.isOrgAdmin && <StatusPill tone="info">Org admin</StatusPill>}
                      <StatusPill tone={a.isActive ? 'good' : 'neutral'}>
                        {a.isActive ? 'Active' : 'Disabled'}
                      </StatusPill>
                    </div>
                  </div>
                ))}
              </ModuleCard>
            )}
          </>
        )}

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add a person</DialogTitle>
              <DialogDescription>
                This puts them on the roster so they can be assigned work. Granting a login is a
                separate step on their page — use the same email here that they will sign in with.
              </DialogDescription>
            </DialogHeader>
            <TeamMemberForm
              onSubmit={(form) => addPerson.mutate(form)}
              onCancel={() => setAddOpen(false)}
              isLoading={addPerson.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
