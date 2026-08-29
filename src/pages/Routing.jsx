import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import {
  Loader2, Users, UserPlus, X, Radio, Crown, TriangleAlert, CheckCircle2, UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import ModuleCard from '@/components/dashboard/ModuleCard';
import KpiTile from '@/components/dashboard/KpiTile';

/**
 * Routing — who actually receives the work.
 *
 * Departments are the routing unit. resolve_owners() walks
 *   on-call -> any member -> role holder -> org admin
 * so work is never addressed to nobody. That last fallback is a safety net, not
 * a destination: while a department is empty, ONE person receives the entire
 * company's work. This page exists to get out of that state and to make the
 * remaining gaps visible rather than merely unknown.
 */
export default function Routing() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(null);   // dept key with its picker open

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['routingHealth'],
    queryFn: async () => {
      const { data, error } = await base44.functions.invoke('routingHealth', {});
      if (error) throw error;
      return data;
    },
  });

  const { data: roster } = useQuery({
    queryKey: ['userAdmin', 'list'],
    queryFn: async () => {
      const { data, error } = await base44.functions.invoke('userAdmin', { action: 'list' });
      if (error) throw error;
      return data;
    },
  });

  const { data: members = [] } = useQuery({
    queryKey: ['departmentMembers'],
    queryFn: () => base44.entities.DepartmentMember.list('dept'),
  });

  // Only people with a login can be routed to — a notification addresses an
  // account, not a name on the roster.
  const eligible = useMemo(
    () => (roster?.people || []).filter((p) => p.hasLogin && p.accountActive !== false),
    [roster],
  );
  const nameFor = (userId) =>
    eligible.find((p) => p.userId === userId)?.name || 'Unknown user';

  const setMember = useMutation({
    mutationFn: async (args) => {
      const { data, error } = await base44.functions.invoke('setDepartmentMember', args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      ['departmentMembers', 'routingHealth'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }));
      setAdding(null);
    },
    onError: (e) => toast.error(e?.message || 'Could not update the department'),
  });

  const depts = health?.departments || [];
  const unstaffed = health?.unstaffed_rules || [];
  const phantom = health?.phantom_roles || [];
  const noLogin = health?.people_without_login || [];

  const byDept = useMemo(() => {
    const m = {};
    for (const r of members) (m[r.dept] ||= []).push(r);
    return m;
  }, [members]);

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          title="Routing"
          subtitle="Who receives the work each rule creates — and where that currently falls through"
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            hero
            label="Rules with nobody"
            value={healthLoading ? '—' : String(unstaffed.length)}
            foot={unstaffed.length ? 'Falling back to org admins' : 'Every rule has an owner'}
          />
          <KpiTile label="People without a login" value={String(noLogin.length)}
            foot={noLogin.length ? 'Cannot receive anything' : 'Everyone reachable'} />
          <KpiTile label="Alert groups" value={String(health?.alert_groups ?? 0)}
            foot={health?.alert_groups ? 'Configured' : 'None — alerts route by role'} />
          <KpiTile label="SMS" value={health?.sms_ready ? 'Ready' : 'Off'}
            foot={health?.sms_ready ? 'Outbound enabled' : 'No from-number / disabled'} />
        </div>

        {/* The honest banner: while this is true, one person gets everything. */}
        {unstaffed.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {unstaffed.length} of the workflow rules have no staffed department
                </p>
                <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300/90">
                  Work still gets assigned — it falls back to org admins so nothing is lost. But until
                  a department has members, one person receives the whole company's work. Adding people
                  below is the fix, and it is not a code change.
                </p>
              </div>
            </div>
          </div>
        )}

        {depts.map((d) => {
          const rows = byDept[d.key] || [];
          const picker = adding === d.key;
          const canAdd = eligible.filter((p) => !rows.some((r) => r.user_id === p.userId));
          return (
            <ModuleCard
              key={d.key}
              title={d.name}
              icon={Users}
              subtitle={`${d.open_rules} rule${d.open_rules === 1 ? '' : 's'} route here`}
              action={
                <Button size="sm" variant="outline"
                  onClick={() => setAdding(picker ? null : d.key)}>
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                  {picker ? 'Cancel' : 'Add'}
                </Button>
              }
            >
              {picker && (
                <div className="border-b border-border bg-muted/40 p-3">
                  {canAdd.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Everyone with a login is already in this department.{' '}
                      <Link to={createPageUrl('UserAccess')} className="underline">Invite more people</Link>.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {canAdd.map((p) => (
                        <Button key={p.userId} size="sm" variant="secondary"
                          disabled={setMember.isPending}
                          onClick={() => setMember.mutate({ dept: d.key, userId: p.userId, isMember: true })}>
                          {p.name}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {rows.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Nobody here — work routes to org admins
                  </p>
                </div>
              ) : (
                rows.map((r) => (
                  <div key={r.user_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{nameFor(r.user_id)}</span>
                      {r.is_on_call && <StatusPill tone="good"><Radio className="mr-1 h-3 w-3" />On call</StatusPill>}
                      {r.is_lead && <StatusPill tone="info"><Crown className="mr-1 h-3 w-3" />Lead</StatusPill>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="ghost" disabled={setMember.isPending}
                        title="On call takes the work first"
                        onClick={() => setMember.mutate({
                          dept: d.key, userId: r.user_id, isMember: true, isOnCall: !r.is_on_call,
                        })}>
                        <Radio className={cn('h-3.5 w-3.5', r.is_on_call && 'text-emerald-600')} />
                      </Button>
                      <Button size="sm" variant="ghost" disabled={setMember.isPending}
                        title="Lead receives escalations"
                        onClick={() => setMember.mutate({
                          dept: d.key, userId: r.user_id, isMember: true, isLead: !r.is_lead,
                        })}>
                        <Crown className={cn('h-3.5 w-3.5', r.is_lead && 'text-primary')} />
                      </Button>
                      <Button size="sm" variant="ghost" disabled={setMember.isPending}
                        onClick={() => setMember.mutate({ dept: d.key, userId: r.user_id, isMember: false })}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </ModuleCard>
          );
        })}

        {phantom.length > 0 && (
          <ModuleCard title="Rules naming a role that does not exist" icon={TriangleAlert}
            subtitle="Harmless now that departments do the routing, but the rule text is misleading">
            <div className="p-4">
              <div className="flex flex-wrap gap-1.5">
                {phantom.map((r) => <StatusPill key={r} tone="warn">{r}</StatusPill>)}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                These names appear on task rules as the intended owner, but no such role exists.
                Either create them under Settings, or treat them as descriptive and rely on the
                department above — which is what routing already does.
              </p>
            </div>
          </ModuleCard>
        )}

        {noLogin.length > 0 && (
          <ModuleCard title="On the roster, but unreachable" icon={UserX}
            subtitle="A notification addresses an account — these people have none">
            {noLogin.map((p) => (
              <div key={p.team_member_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-4 py-2">
                <span className="break-words text-sm text-foreground">{p.name || p.email || p.team_member_id}</span>
                <span className="break-words text-xs text-muted-foreground">{p.email}</span>
              </div>
            ))}
            <div className="px-4 py-3">
              <Link to={createPageUrl('UserAccess')}>
                <Button size="sm" variant="outline">Invite them</Button>
              </Link>
            </div>
          </ModuleCard>
        )}

        {!healthLoading && unstaffed.length === 0 && noLogin.length === 0 && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm text-emerald-900 dark:text-emerald-200">
                Every rule has a staffed department and everyone on the roster can be reached.
              </p>
            </div>
          </div>
        )}

        {healthLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
      </div>
    </div>
  );
}
