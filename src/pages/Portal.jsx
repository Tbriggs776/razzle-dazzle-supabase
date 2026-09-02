import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { usePortalContext } from '@/lib/usePortal';
import { invokeFailure, unwrapInvoke } from '@/lib/invokeResult';
import { cn } from '@/lib/utils';
import BrandLogo from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  HardHat, Users, ChevronRight, MapPin, Calendar, Loader2, LogOut,
  UserPlus, ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

/**
 * The subcontractor portal.
 *
 * Renders OUTSIDE the staff Layout on purpose. A crew login holds no staff
 * modules, so the app chrome would give them an empty sidebar, an empty
 * dashboard, and a role-assignment splash aimed at employees — every one of
 * which is the wrong thing to show a subcontractor. They get their own surface:
 * their company's jobs, and (for an owner) their own roster.
 *
 * Every read and write here goes through an RPC that derives the caller's
 * installer server-side. Nothing on this page passes an installer_id.
 *
 * Built phone-first because that is where it will be used — on a driveway, in
 * the sun, one-handed. Rows are large tap targets, not table cells.
 */

const money = (n) =>
  '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDate(d) {
  if (!d) return null;
  // Date-only column: parse the parts rather than letting the Date constructor
  // treat it as UTC midnight, which renders as the previous day in Phoenix.
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

const STAGE_LABELS = {
  sold: 'Sold', ordering: 'Ordering', material_ready: 'Material ready',
  scheduled: 'Scheduled', installing: 'Installing', punch_list: 'Punch list',
  cx_followup: 'Customer follow-up', closed: 'Closed',
};
const prettyStage = (s) => STAGE_LABELS[s] || (s ? String(s).replace(/_/g, ' ') : null);

function StatusPill({ status, stage }) {
  const label = prettyStage(stage) || status || 'No status';
  const s = String(status || '').toLowerCase();
  const tone =
    s.includes('hold') ? 'bg-crit/15 text-crit ring-crit/30'
    : s.includes('complete') || stage === 'closed' ? 'bg-good/15 text-good ring-good/30'
    : 'bg-muted text-muted-foreground ring-border';
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1', tone)}>
      {label}
    </span>
  );
}

// ── Jobs ────────────────────────────────────────────────────────────────────

function JobsTab({ crewName }) {
  // `data: jobs = []`, not bare `data: jobs`. TanStack's default networkMode
  // 'online' leaves a never-run query at status 'pending', fetchStatus 'paused'
  // when the device is offline — isLoading is false there, isError is false, and
  // data is undefined. A crew coming back to this page out of signal would hit
  // `!jobs.length` on undefined, and with no error boundary that unmounts the
  // whole app: a white screen, on a driveway, on a phone.
  const { data: jobs = [], isLoading, isError, error } = useQuery({
    queryKey: ['myInstallerJobs'],
    queryFn: async () => unwrapInvoke(await base44.functions.invoke('myInstallerJobs')) || [],
    retry: false,
  });

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError) {
    return (
      <div className="rounded-xl border border-crit/30 bg-crit/5 p-4 text-sm text-foreground">
        Your jobs could not be loaded — {error?.message || 'the request failed'}. Try again in a moment.
      </div>
    );
  }
  if (!jobs.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <HardHat className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="font-medium text-foreground">No jobs assigned to {crewName || 'your crew'} yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The office assigns jobs. They will appear here as soon as one is yours.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {jobs.map((j) => (
        <li key={j.project_id}>
          <Link
            to={`/JourneyProjectDetail?project_id=${encodeURIComponent(j.project_id)}&mode=installer`}
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 active:bg-muted"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <p className="truncate font-semibold text-foreground">{j.customer_name || 'Customer not named'}</p>
                <StatusPill status={j.status} stage={j.stage} />
              </div>
              {j.address && (
                <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0">{j.address}</span>
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  {fmtDate(j.install_date) || 'Not scheduled'}
                </span>
                {/* cost_labor is set on almost no sales today. A null rendered as
                    $0 would tell a crew this job pays nothing, which is worse
                    than saying we do not know yet. */}
                <span className={cn('font-medium tabular-nums',
                  j.estimated_labor == null ? 'text-muted-foreground' : 'text-foreground')}>
                  {j.estimated_labor == null ? 'Labor not set' : `${money(j.estimated_labor)} est. labor`}
                </span>
              </div>
            </div>
            <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ── Crew ────────────────────────────────────────────────────────────────────

function AddMemberForm({ onAdded }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', role: 'crew' });
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.fullName.trim()) { toast.error('A crew member needs a name'); return; }
    setSaving(true);
    try {
      const res = await base44.functions.invoke('inviteInstallerMember', form);
      const failed = invokeFailure(res);
      if (failed) { toast.error(failed); return; }
      toast.success(res.data?.note || 'Added');
      setForm({ fullName: '', email: '', phone: '', role: 'crew' });
      setOpen(false);
      onAdded();
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="min-h-11 w-full gap-2 sm:w-auto">
        <UserPlus className="h-4 w-4" /> Add a crew member
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pm-name">Name</Label>
        <Input id="pm-name" value={form.fullName} onChange={set('fullName')} placeholder="Miguel Soto" autoFocus />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pm-email">Email</Label>
          <Input id="pm-email" type="email" value={form.email} onChange={set('email')} placeholder="Optional" />
          <p className="text-xs text-muted-foreground">
            They get a login by signing up with this exact address. Leave it blank to just
            put them on the roster.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pm-phone">Phone</Label>
          <Input id="pm-phone" value={form.phone} onChange={set('phone')} placeholder="Optional" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Role</Label>
        <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
          <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="crew">Crew — sees and completes their jobs</SelectItem>
            <SelectItem value="owner">Owner — also manages this roster</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={saving} className="min-h-11 gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add to crew
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

function CrewTab({ ctx }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState(null);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['installerRoster', ctx.installer_id],
    queryFn: () => base44.entities.InstallerMember.filter({ installer_id: ctx.installer_id }, 'full_name'),
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['installerRoster', ctx.installer_id] });

  const toggle = async (m) => {
    setBusyId(m.id);
    try {
      const res = await base44.functions.invoke('setInstallerMemberActive', {
        memberId: m.id, active: !m.is_active,
      });
      const failed = invokeFailure(res);
      if (failed) { toast.error(failed); return; }
      toast.success(m.is_active ? `${m.full_name} removed from the crew` : `${m.full_name} is back on the crew`);
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {ctx.is_owner && <AddMemberForm onAdded={refresh} />}
      <ul className="space-y-2">
        {members.map((m) => (
          <li
            key={m.id}
            className={cn('flex items-center gap-3 rounded-xl border border-border bg-card p-4',
              !m.is_active && 'opacity-60')}
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                {m.full_name}
                {m.role === 'owner' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
                    <ShieldCheck className="h-3 w-3" /> Owner
                  </span>
                )}
                {!m.is_active && <span className="text-xs text-muted-foreground">· removed</span>}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {[m.email, m.phone].filter(Boolean).join(' · ') || 'No contact details'}
              </p>
              {/* The difference between "on the roster" and "can actually log in"
                  is invisible otherwise, and it is the first thing an owner asks
                  when someone says they cannot get in. */}
              <p className="mt-1 text-xs text-muted-foreground">
                {m.user_id
                  ? 'Has a login'
                  : m.email
                    ? 'No login yet — they sign up with that email'
                    : 'No login — add an email address first'}
              </p>
            </div>
            {ctx.is_owner && (
              <Button
                variant={m.is_active ? 'outline' : 'default'}
                size="sm"
                className="min-h-11 shrink-0"
                disabled={busyId === m.id}
                onClick={() => toggle(m)}
              >
                {busyId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : m.is_active ? 'Remove' : 'Restore'}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!ctx.is_owner && (
        <p className="text-sm text-muted-foreground">
          Only your company&apos;s owner can change this list.
        </p>
      )}
    </div>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────────

export default function Portal() {
  const { logout, user } = useAuth();
  const { data: ctx, isLoading, isError, error } = usePortalContext();
  const [tab, setTab] = useState('jobs');

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Staff who wander onto this URL, and anyone whose roster row was deactivated.
  // Both get a plain explanation rather than an empty portal that looks broken.
  if (isError || !ctx?.is_installer) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card text-center">
          {/* Branded even here. This is the screen someone hits when their access is
              wrong -- the moment they are most likely to think the link is broken or
              fake, and the moment a recognisable mark is worth the most. */}
          <div className="flex items-center justify-center bg-sidebar px-6 py-3">
            <BrandLogo imgClassName="h-6" onDark />
          </div>
          <div className="p-8">
            <h1 className="mb-2 font-display text-xl font-bold text-foreground">This is the subcontractor portal</h1>
            <p className="mb-6 text-muted-foreground">
              {isError
                ? error?.message || 'We could not check your access.'
                : 'Your login is not on a subcontractor crew. If you are staff, use the main app.'}
            </p>
            <Link to="/Dashboard" className="text-sm font-medium text-primary hover:underline">
              Go to the main app
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const TABS = [
    { key: 'jobs', label: 'Jobs', icon: HardHat },
    { key: 'crew', label: 'Crew', icon: Users },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        {/* The brand bar. A subcontractor arrives here from a text message, not from
            the staff app, so this is the only thing telling them whose tool this is.
            Navy because navy is what dominates floordaddy.com; BrandLogo needs
            `onDark` or the navy "FLOOR" wordmark disappears into it. Kept to 40px --
            this is a one-handed jobsite tool and vertical space is the scarce thing. */}
        <div className="bg-sidebar">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2">
            <BrandLogo imgClassName="h-6" onDark />
            <span className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground">
              Installer portal
            </span>
          </div>
        </div>
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold leading-tight text-foreground">{ctx.crew_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {ctx.member_name || user?.email}{ctx.is_owner ? ' · Owner' : ''}
            </p>
          </div>
          <Button variant="ghost" size="sm" className="min-h-11 shrink-0 gap-2" onClick={logout}>
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
        <div className="mx-auto flex max-w-3xl gap-1 px-4">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors',
                // The active tab is this page's ONE accent -- there is no hero CTA
                // here to spend it on, and it is the only thing on screen that
                // needs to be findable at a glance in sunlight.
                tab === key
                  ? 'border-brand-pink text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        {tab === 'jobs' ? <JobsTab crewName={ctx.crew_name} /> : <CrewTab ctx={ctx} />}
      </main>
    </div>
  );
}
