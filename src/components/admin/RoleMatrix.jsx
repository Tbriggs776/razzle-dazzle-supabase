import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeFailure } from '@/lib/invokeResult';
import { Loader2, Lock, CopyPlus, Pencil, TriangleAlert, Users } from 'lucide-react';
import ModuleCard from '@/components/dashboard/ModuleCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * The role × module matrix — the missing screen over the access model that has
 * existed since 0002/0003. Rights are a cell: none | view | edit | admin.
 *
 * Every write goes through the userAdmin edge function, NEVER PostgREST, so the
 * server-side guards (system-role lock, core-module floor, last-admin rules)
 * cannot be skipped by this page having a bug. The grid is a view; userAdmin is
 * the law.
 *
 * Deliberately absent, per the spec: per-user overrides ("this CSR can also see
 * Finance" is a second role, not an exception), delete role, and
 * create-from-blank (clone is enough — new jobs start as a copy of the nearest
 * existing one).
 */

async function callUserAdmin(payload) {
  const res = await base44.functions.invoke('userAdmin', payload);
  const failed = invokeFailure(res);
  if (failed) throw new Error(failed);
  return res.data;
}

const PERMS = ['none', 'view', 'edit', 'admin'];
const PERM_TONES = {
  none: 'text-muted-foreground',
  view: 'text-foreground',
  edit: 'text-info font-medium',
  admin: 'text-accent-foreground font-semibold',
};

export default function RoleMatrix() {
  const qc = useQueryClient();
  const [busyCell, setBusyCell] = useState(null);       // `${roleId}:${moduleKey}`
  const [busyModule, setBusyModule] = useState(null);
  const [cloneFrom, setCloneFrom] = useState(null);     // role row
  const [renameRole, setRenameRole] = useState(null);   // role row
  const [cloneName, setCloneName] = useState('');
  const [cloneKey, setCloneKey] = useState('');
  const [newName, setNewName] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['roleMatrix'],
    queryFn: () => callUserAdmin({ action: 'list_matrix' }),
    retry: false,
  });

  const modules = data?.modules || [];
  const roles = data?.roles || [];
  const cellMap = useMemo(() => {
    const m = {};
    for (const c of data?.cells || []) m[`${c.role_id}:${c.module_key}`] = c.permission;
    return m;
  }, [data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['roleMatrix'] });

  const setCell = useMutation({
    mutationFn: ({ roleId, moduleKey, permission }) =>
      callUserAdmin({ action: 'set_cell', roleId, moduleKey, permission }),
    onMutate: (v) => setBusyCell(`${v.roleId}:${v.moduleKey}`),
    onSuccess: (_d, v) => {
      refresh();
      // Nav is fetched at load, so the change is real now but VISIBLE on their
      // next page load. Saying so heads off "I changed it and nothing happened".
      toast.success(`Saved — people in that role pick up ${v.moduleKey} on their next page load`);
    },
    onError: (e) => { toast.error(e?.message || 'Could not save that cell'); refresh(); },
    onSettled: () => setBusyCell(null),
  });

  const setEntitlement = useMutation({
    mutationFn: ({ moduleKey, enabled }) =>
      callUserAdmin({ action: 'set_entitlement', moduleKey, enabled }),
    onMutate: (v) => setBusyModule(v.moduleKey),
    onSuccess: (_d, v) => {
      refresh();
      toast.success(v.enabled
        ? `${v.moduleKey} is on for the company`
        : `${v.moduleKey} is off for the company — hidden from everyone, permissions kept`);
    },
    onError: (e) => { toast.error(e?.message || 'Could not change that'); refresh(); },
    onSettled: () => setBusyModule(null),
  });

  const doClone = useMutation({
    mutationFn: () => callUserAdmin({
      action: 'clone_role', sourceRoleId: cloneFrom.id, name: cloneName.trim(), key: cloneKey.trim(),
    }),
    onSuccess: () => {
      refresh();
      toast.success(`Cloned ${cloneFrom.name} — now edit the copy`);
      setCloneFrom(null); setCloneName(''); setCloneKey('');
    },
    onError: (e) => toast.error(e?.message || 'Clone failed'),
  });

  const doRename = useMutation({
    mutationFn: () => callUserAdmin({ action: 'rename_role', roleId: renameRole.id, name: newName.trim() }),
    onSuccess: () => {
      refresh();
      toast.success('Renamed. The key — what assignments hang off — is unchanged.');
      setRenameRole(null); setNewName('');
    },
    onError: (e) => toast.error(e?.message || 'Rename failed'),
  });

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError) {
    return (
      <div className="rounded-xl border border-crit/30 bg-crit/5 p-4 text-sm text-foreground">
        The matrix could not be loaded — {error?.message || 'the request failed'}.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Entitlement switches: company-wide on/off. Off hides the module from
          EVERYONE (even non-admin views) without deleting any permissions. */}
      <ModuleCard
        title="Modules on for the company"
        subtitle="Off hides a module from everyone without touching the grid below — turn it back on and permissions are exactly as they were"
        bodyClassName="divide-y-0"
      >
        <div className="flex flex-wrap gap-x-6 gap-y-3 px-4 py-3">
          {modules.map((m) => (
            <label
              key={m.key}
              className={cn('flex items-center gap-2 text-sm', m.is_core ? 'text-muted-foreground' : 'text-foreground')}
              title={m.is_core ? 'Core module — always on, so nobody can be locked out of login landing and settings' : undefined}
            >
              <Switch
                checked={m.entitled}
                disabled={m.is_core || busyModule === m.key}
                onCheckedChange={(v) => setEntitlement.mutate({ moduleKey: m.key, enabled: v })}
              />
              {m.name}
              {m.is_core && <Lock className="h-3 w-3" />}
            </label>
          ))}
        </div>
      </ModuleCard>

      <ModuleCard
        title="Role × module grid"
        subtitle="none — cannot see it · view — read · edit — read and write · admin — edit plus that module's admin surfaces. User Access itself always needs org admin, whatever this grid says."
        bodyClassName="divide-y-0"
      >
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Role
                </th>
                {modules.map((m) => (
                  <th
                    key={m.key}
                    className={cn(
                      'px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide',
                      m.entitled ? 'text-muted-foreground' : 'text-muted-foreground/40',
                    )}
                    title={m.entitled ? m.key : `${m.key} — off for the company`}
                  >
                    {m.name}
                    {!m.entitled && <span className="block text-[9px] font-medium normal-case tracking-normal">off for company</span>}
                  </th>
                ))}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      {r.name}
                      {r.is_system && <Lock className="h-3 w-3 text-muted-foreground" title="System role — locked" />}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <span className="font-mono">{r.key}</span>
                      <span>·</span>
                      <Users className="h-3 w-3" /> {r.assignedCount}
                    </div>
                  </td>
                  {modules.map((m) => {
                    const key = `${r.id}:${m.key}`;
                    const value = r.is_system ? 'admin' : (cellMap[key] || 'none');
                    const locked = r.is_system;
                    return (
                      <td key={m.key} className={cn('px-2 py-1.5', !m.entitled && 'opacity-40')}>
                        {locked ? (
                          <span className="text-xs font-semibold text-muted-foreground" title="The Administrator role is admin on every entitled module — clone it to make a weaker owner role">
                            admin
                          </span>
                        ) : (
                          <select
                            value={value}
                            disabled={busyCell === key}
                            onChange={(e) => setCell.mutate({ roleId: r.id, moduleKey: m.key, permission: e.target.value })}
                            className={cn(
                              'h-8 rounded-md border border-border bg-background px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring',
                              PERM_TONES[value],
                              busyCell === key && 'opacity-50',
                            )}
                          >
                            {PERMS.map((perm) => (
                              <option
                                key={perm}
                                value={perm}
                                // The floor: a core module cannot go to none on an
                                // active staff role, or people lose their landing pages.
                                disabled={perm === 'none' && m.is_core}
                              >
                                {perm}{perm === 'none' && m.is_core ? ' (core)' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs"
                      onClick={() => { setCloneFrom(r); setCloneName(`${r.name} copy`); setCloneKey(''); }}>
                      <CopyPlus className="h-3.5 w-3.5" /> Clone
                    </Button>
                    {!r.is_system && (
                      <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs"
                        onClick={() => { setRenameRole(r); setNewName(r.name); }}>
                        <Pencil className="h-3.5 w-3.5" /> Rename
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-start gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Changes apply on each person&apos;s next page load — nobody has to sign out. If one person needs
            two jobs, give them two roles on the People tab; there are no per-person exceptions here on purpose.
          </span>
        </div>
      </ModuleCard>

      {/* Clone */}
      <Dialog open={!!cloneFrom} onOpenChange={(v) => !v && setCloneFrom(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-extrabold">Clone {cloneFrom?.name}</DialogTitle>
            <DialogDescription>
              An exact copy of every cell, which you then edit. The stock roles stay stock — a
              &ldquo;CSR Team Lead&rdquo; is a clone with reports added, not an edited CSR.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rm-name">Display name</Label>
              <Input id="rm-name" value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="CSR Team Lead" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rm-key">Key</Label>
              <Input id="rm-key" value={cloneKey} onChange={(e) => setCloneKey(e.target.value.toLowerCase())}
                placeholder="csr_team_lead" className="font-mono" />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits, underscores. Permanent — assignments and training target this key.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneFrom(null)}>Cancel</Button>
            <Button disabled={doClone.isPending || !cloneName.trim() || !cloneKey.trim()} onClick={() => doClone.mutate()}>
              {doClone.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Clone role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renameRole} onOpenChange={(v) => !v && setRenameRole(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-extrabold">Rename {renameRole?.name}</DialogTitle>
            <DialogDescription>
              Display name only — the key <span className="font-mono">{renameRole?.key}</span> never changes.
            </DialogDescription>
          </DialogHeader>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameRole(null)}>Cancel</Button>
            <Button disabled={doRename.isPending || !newName.trim()} onClick={() => doRename.mutate()}>
              {doRename.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
