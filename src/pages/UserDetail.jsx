import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Loader2, Mail, Phone, Pencil, Trash2, ShieldCheck, KeyRound,
  UserPlus, AlertTriangle, X, Copy, Check, Lock, Calendar as CalendarIcon,
} from 'lucide-react';
import StatusPill from '@/components/common/StatusPill';
import ModuleCard from '@/components/dashboard/ModuleCard';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { SignedImage } from '@/lib/fileUrl';
import { createPageUrl } from '@/utils';
import TeamMemberForm from '@/components/team/TeamMemberForm';
import { callUserAdmin, isAccessDenied } from '@/lib/userAdminClient';
import { toast } from 'sonner';

/**
 * One person, everything about them: who they are and what they may do.
 *
 * The distinction this page has to teach, because getting it wrong is how
 * people end up locked out or over-permissioned:
 *
 *   ROSTER ROLE ("Design Consultant") is a LABEL. It drives assignment,
 *   calendars and reports. It grants nothing.
 *   APP ROLE is ACCESS. It decides which modules they can open, through the
 *   role → module permission matrix.
 *
 * They are usually the same word, which is exactly why the difference is easy
 * to miss — so the page says it out loud rather than showing two similar
 * dropdowns and hoping.
 */

const NO_ROLE = '__none__';
const PERM_LABEL = { admin: 'Full control', edit: 'Can edit', view: 'Can view', none: 'No access' };
const PERM_TONE = { admin: 'info', edit: 'good', view: 'neutral', none: 'neutral' };

export default function UserDetail() {
  const memberId = new URLSearchParams(window.location.search).get('id');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [banner, setBanner] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [linkModal, setLinkModal] = useState(null);
  const [copied, setCopied] = useState(false);

  const { data: roster, isLoading: rosterLoading } = useQuery({
    queryKey: ['teamMember', memberId],
    queryFn: async () => (await base44.entities.TeamMember.filter({ id: memberId }))[0] || null,
    enabled: !!memberId,
  });

  const { data: adminList, isLoading: adminLoading, error: adminError } = useQuery({
    queryKey: ['userAdmin', 'list'],
    queryFn: () => callUserAdmin({ action: 'list' }),
    retry: false,
  });

  // The matrix is what turns "Design Consultant" into a list of screens. Only
  // fetched here so the page can answer "what does this role actually unlock?"
  const { data: matrix } = useQuery({
    queryKey: ['userAdmin', 'matrix'],
    queryFn: () => callUserAdmin({ action: 'list_matrix' }),
    retry: false,
    enabled: !isAccessDenied(adminError),
  });

  const person = useMemo(
    () => (adminList?.people || []).find((p) => p.teamMemberId === memberId) || null,
    [adminList, memberId]
  );
  const roles = adminList?.roles || [];
  const currentRoleId = person?.roleIds?.[0] || null;

  const roleAccess = useMemo(() => {
    if (!matrix || !currentRoleId) return null;
    const byModule = {};
    for (const c of matrix.cells || []) {
      if (c.role_id === currentRoleId) byModule[c.module_key] = c.permission;
    }
    return (matrix.modules || [])
      .filter((m) => m.entitled)
      .map((m) => ({ key: m.key, name: m.name, permission: byModule[m.key] || 'none' }))
      .filter((m) => m.permission !== 'none');
  }, [matrix, currentRoleId]);

  const action = useMutation({
    mutationFn: (payload) => callUserAdmin(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['userAdmin'] }),
    onError: (e) => setBanner(e?.message || 'Something went wrong.'),
  });

  const run = async (payload) => {
    setBanner(null);
    try { return await action.mutateAsync(payload); } catch { return null; }
  };

  const updateProfile = useMutation({
    mutationFn: (form) => base44.entities.TeamMember.update(memberId, form),
    onSuccess: () => {
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ['teamMember', memberId] });
      qc.invalidateQueries({ queryKey: ['userAdmin', 'list'] });
      toast.success('Profile updated');
    },
    onError: (e) => setBanner(e?.message || 'Could not save the profile.'),
  });

  const removePerson = useMutation({
    mutationFn: () => base44.entities.TeamMember.delete(memberId),
    onSuccess: () => {
      toast.success('Removed from the roster');
      navigate(createPageUrl('Users'));
    },
    onError: (e) => setBanner(e?.message || 'Could not remove that person.'),
  });

  const showLink = (res, kind) => {
    if (!res?.link) {
      setBanner('That went through, but no link came back. Try "New sign-in link".');
      return;
    }
    setCopied(false);
    setLinkModal({ link: res.link, kind, note: res.note || null, existing: !!res.existing });
  };

  const invite = async () => {
    if (!roster?.email) {
      setBanner('Add an email to this person first — the invite is sent to it.');
      return;
    }
    const res = await run({ action: 'invite', email: roster.email });
    if (res) showLink(res, 'invite');
  };

  const resetLink = async () => {
    const res = await run({ action: 'reset_link', email: roster?.email });
    if (res) showLink(res, 'reset');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(linkModal.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setBanner('Could not copy automatically — select the link and copy it.');
    }
  };

  if (rosterLoading || adminLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAccessDenied(adminError)) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="font-display text-xl font-extrabold tracking-tight">Restricted</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Managing people and their access is limited to organization admins.
          </p>
        </div>
      </div>
    );
  }

  // Any OTHER failure of the list call must stop the page, not soften it.
  // Without this branch a 500 or a dropped connection leaves `person` null,
  // which reads downstream as "this person has no login" — so the page would
  // hide their real access controls, offer to invite someone who already has
  // an account, and re-enable the Remove button that hasLogin exists to block.
  // Absence of an answer is not an answer.
  if (adminError) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-2xl space-y-3">
          <Link to={createPageUrl('Users')}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Users
          </Link>
          <div className="rounded-xl border border-crit/30 bg-crit/10 p-6 text-sm">
            <p className="font-semibold text-crit">Could not load this person&rsquo;s access</p>
            <p className="mt-1 text-muted-foreground">{adminError.message}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              Their profile is not shown either, because until the account state loads there is no
              way to tell whether they can sign in — and acting on a guess here is how someone ends
              up locked out or left with an account nobody can find.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!roster) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <p className="text-sm font-semibold text-foreground">That person is not on the roster.</p>
        <Link to={createPageUrl('Users')} className="text-sm text-primary underline">Back to Users</Link>
      </div>
    );
  }

  const fullName = `${roster.first_name || ''} ${roster.last_name || ''}`.trim();
  const initials = `${roster.first_name?.[0] || ''}${roster.last_name?.[0] || ''}`.toUpperCase();
  const hasLogin = !!person?.hasLogin;
  const accountActive = person?.accountActive !== false;
  const busy = action.isPending;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <Link to={createPageUrl('Users')}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Users
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl shadow">
            {roster.profile_photo ? (
              <SignedImage src={roster.profile_photo} alt={fullName} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-primary text-xl font-bold text-primary-foreground">
                {initials || '?'}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground">
              {fullName || 'Unnamed'}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {roster.role && <StatusPill tone="neutral">{roster.role}</StatusPill>}
              <StatusPill tone={hasLogin ? (accountActive ? 'good' : 'crit') : 'neutral'}>
                {hasLogin ? (accountActive ? 'Can sign in' : 'Login disabled') : 'No login'}
              </StatusPill>
              {person?.isOrgAdmin && (
                <StatusPill tone="info"><ShieldCheck className="mr-1 h-3 w-3" />Org admin</StatusPill>
              )}
            </div>
          </div>
          <Button variant="outline" className="gap-1.5" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" /> Edit profile
          </Button>
        </div>

        {banner && (
          <div className="flex items-start gap-2.5 rounded-xl border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-crit">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1 font-medium">{banner}</p>
            <button type="button" onClick={() => setBanner(null)} aria-label="Dismiss"
              className="shrink-0 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* ── Access ─────────────────────────────────────────────────────── */}
        <ModuleCard
          title="Access"
          subtitle="Whether they can sign in, and what they can reach once they do"
          icon={KeyRound}
        >
          <div className="space-y-4 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {hasLogin ? 'Has a login' : 'No login yet'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {hasLogin
                    ? `Signs in as ${roster.email || '—'}`
                    : roster.email
                      ? `Invite goes to ${roster.email}`
                      : 'Add an email on their profile before inviting them'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasLogin ? (
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={resetLink}>
                    <KeyRound className="h-3.5 w-3.5" /> New sign-in link
                  </Button>
                ) : (
                  <Button size="sm" className="gap-1.5" disabled={busy || !roster.email} onClick={invite}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                    Invite
                  </Button>
                )}
              </div>
            </div>

            {hasLogin && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>App role — this is what grants access</Label>
                    <Select
                      value={currentRoleId || NO_ROLE}
                      onValueChange={(v) =>
                        run({ action: 'set_roles', userId: person.userId,
                              roleIds: v === NO_ROLE ? [] : [v] })}
                    >
                      <SelectTrigger><SelectValue placeholder="Choose a role" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_ROLE}>No role — sees nothing</SelectItem>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.name || r.key}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Separate from the roster role above, which is only a label.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">Account active</span>
                        <span className="block text-xs text-muted-foreground">
                          Off means they keep the record but cannot sign in.
                        </span>
                      </span>
                      <Switch
                        checked={accountActive}
                        disabled={busy}
                        onCheckedChange={(v) =>
                          run({ action: 'set_active', userId: person.userId, active: !!v })}
                      />
                    </label>
                    <label className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">Organization admin</span>
                        <span className="block text-xs text-muted-foreground">
                          Full control, including this screen and every module.
                        </span>
                      </span>
                      <Switch
                        checked={!!person.isOrgAdmin}
                        disabled={busy}
                        onCheckedChange={(v) =>
                          run({ action: 'set_org_admin', userId: person.userId, isOrgAdmin: !!v })}
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-border">
                  <p className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    What this opens for them
                  </p>
                  <div className="flex flex-wrap gap-1.5 px-3 py-3">
                    {person.isOrgAdmin ? (
                      <p className="text-sm text-muted-foreground">
                        Organization admin — every entitled module, regardless of role.
                      </p>
                    ) : !currentRoleId ? (
                      <p className="text-sm text-warn">
                        No role assigned, so they can sign in but every screen is closed to them.
                      </p>
                    ) : roleAccess === null ? (
                      <span className="text-xs text-muted-foreground">Loading…</span>
                    ) : roleAccess.length === 0 ? (
                      <p className="text-sm text-warn">This role grants no modules yet.</p>
                    ) : (
                      roleAccess.map((m) => (
                        <StatusPill key={m.key} tone={PERM_TONE[m.permission]}>
                          {m.name} · {PERM_LABEL[m.permission]}
                        </StatusPill>
                      ))
                    )}
                  </div>
                  <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                    Change what a role unlocks under{' '}
                    <Link to={createPageUrl('Users')} className="text-primary underline">
                      Users → Roles &amp; permissions
                    </Link>.
                  </p>
                </div>
              </>
            )}
          </div>
        </ModuleCard>

        {/* ── Profile ────────────────────────────────────────────────────── */}
        <ModuleCard title="Profile" subtitle="Roster details — assignment, contact and calendar" icon={Mail}>
          <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-blue/15">
                <Mail className="h-4 w-4 text-brand-blue" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="truncate text-sm text-foreground">{roster.email || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-pink/15">
                <Phone className="h-4 w-4 text-brand-pink" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Phone</p>
                <p className="truncate text-sm text-foreground">{roster.phone || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Roster role (label only)</p>
                <p className="truncate text-sm text-foreground">{roster.role || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-gold/15">
                <CalendarIcon className="h-4 w-4 text-brand-gold" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Calendar</p>
                <p className="truncate text-sm text-foreground">
                  {roster.calendar_integration_enabled
                    ? (roster.google_calendar_id || `Syncing to ${roster.email}`)
                    : 'Not connected'}
                </p>
              </div>
            </div>
          </div>
        </ModuleCard>

        <div className="flex justify-end">
          <Button variant="outline" className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" /> Remove from roster
          </Button>
        </div>
      </div>

      {/* ── Edit profile ─────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Edit profile</DialogTitle></DialogHeader>
          <TeamMemberForm
            teamMember={roster}
            onSubmit={(form) => updateProfile.mutate(form)}
            onCancel={() => setEditOpen(false)}
            isLoading={updateProfile.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* ── Remove ───────────────────────────────────────────────────────── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {fullName || 'this person'}?</DialogTitle>
            <DialogDescription className="mt-2">
              {hasLogin
                ? 'They still have a login. Disable the account first — removing only the roster record would leave an account nobody can find.'
                : 'This deletes the roster record. Their past work stays attached to it by id, so prefer marking them inactive on the profile unless the record was created by mistake.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={hasLogin || removePerson.isPending}
              onClick={() => removePerson.mutate()}
            >
              {removePerson.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Sign-in link ─────────────────────────────────────────────────── */}
      <Dialog open={!!linkModal} onOpenChange={(v) => !v && setLinkModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {linkModal?.kind === 'invite' ? 'Invite link' : 'Sign-in link'}
            </DialogTitle>
            <DialogDescription>
              {linkModal?.note
                || 'Send this to them yourself — it is not emailed automatically. It signs them in once and lets them set a password.'}
            </DialogDescription>
          </DialogHeader>
          <div className="break-all rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
            {linkModal?.link}
          </div>
          <DialogFooter>
            <Button variant="outline" className="gap-1.5" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button onClick={() => setLinkModal(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
