import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { invokeFailure, unwrapInvoke } from '@/lib/invokeResult';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  PhoneCall, MessageSquare, Mail, Loader2, UserPlus, CalendarClock, MapPin,
  Timer, Inbox, ArrowRight, Voicemail, PhoneOff, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';

/**
 * The CSR lead queue — OPERATING_MODEL stage 2, `lead_working`.
 *
 * A lead leaves this screen exactly once: BOOKED (a Checklist 2.0 that converts
 * to an appointment) or DISPOSITIONED. There is no third door, which is the
 * whole point — today a lead that nobody rings simply sits in the Leads list
 * looking identical to one that was worked and lost.
 *
 * The clock is the feature. Speed-to-lead is 5 minutes to first dial and the
 * board has to make lateness impossible to miss, so overdue rows are counted up
 * in red rather than quietly sorted to the top.
 *
 * Every rule lives in the database (0102): the 0/1/3/7/14 cadence, what a
 * disposition requires, and the attempt count — which is derived from
 * `communication` rather than kept as a number here, so a hand-logged dial and
 * a CallRail-captured one count alike.
 */

const SCOPES = [
  { key: 'mine', label: 'My queue' },
  { key: 'unassigned', label: 'Unclaimed' },
  { key: 'all', label: 'Everyone' },
];

const OUTCOMES = {
  call: [
    { key: 'connected', label: 'Spoke to them', icon: CheckCircle2 },
    { key: 'no_answer', label: 'No answer', icon: PhoneOff },
    { key: 'voicemail', label: 'Left voicemail', icon: Voicemail },
    { key: 'bad_number', label: 'Bad number', icon: PhoneOff },
  ],
  sms: [{ key: 'sent', label: 'Text sent', icon: MessageSquare }],
  email: [{ key: 'sent', label: 'Email sent', icon: Mail }],
};

// "3 min late" / "in 4 min" / "in 2 days". Relative, short, and never a raw date:
// on this screen the only question is how close to the clock you are.
function relative(iso) {
  if (!iso) return { text: 'no clock', late: false, mins: 0 };
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  const late = mins < 0;
  const a = Math.abs(mins);
  let text;
  if (a < 1) text = late ? 'due now' : 'due now';
  else if (a < 60) text = `${a} min`;
  else if (a < 60 * 24) text = `${Math.round(a / 60)} hr`;
  else text = `${Math.round(a / 1440)} day${Math.round(a / 1440) === 1 ? '' : 's'}`;
  return { text: a < 1 ? text : late ? `${text} late` : `in ${text}`, late, mins };
}

function ClockChip({ dueAt, firstDial }) {
  const r = relative(dueAt);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 tabular-nums',
        r.late ? 'bg-crit/15 text-crit ring-crit/30'
          : r.mins <= 5 ? 'bg-warn/15 text-warn ring-warn/30'
          : 'bg-muted text-muted-foreground ring-border',
      )}
    >
      <Timer className="h-3.5 w-3.5" />
      {r.text}
      {firstDial && <span className="hidden sm:inline font-normal opacity-80">· first dial</span>}
    </span>
  );
}

function SourceChip({ label, campaign }) {
  if (!label) return null;
  return (
    <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
      {label}{campaign ? ` · ${campaign}` : ''}
    </span>
  );
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

function LogAttemptDialog({ lead, onClose, onDone }) {
  const [channel, setChannel] = useState('call');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);

  const log = async (outcome) => {
    setBusy(outcome);
    try {
      const res = await base44.functions.invoke('logLeadAttempt', {
        leadId: lead.lead_id, channel, outcome, note: note.trim() || null,
      });
      const failed = invokeFailure(res);
      if (failed) { toast.error(failed); return; }
      toast.success(
        outcome === 'bad_number'
          ? 'Logged, and the lead is closed as a wrong number'
          : `Logged — attempt ${res.data.attempt_count}`,
      );
      onDone();
      onClose();
    } finally { setBusy(null); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log an attempt</DialogTitle>
          <DialogDescription>
            {lead.first_name} {lead.last_name} · attempt {lead.attempt_count + 1}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            {[
              { k: 'call', label: 'Call', icon: PhoneCall },
              { k: 'sms', label: 'Text', icon: MessageSquare },
              { k: 'email', label: 'Email', icon: Mail },
            ].map(({ k, label, icon: Icon }) => (
              <button
                key={k}
                type="button"
                onClick={() => setChannel(k)}
                className={cn(
                  'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors',
                  channel === k ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lq-note">Note (optional)</Label>
            <Textarea id="lq-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="What happened?" />
          </div>
          <div className="space-y-2">
            {OUTCOMES[channel].map(({ key, label, icon: Icon }) => (
              <Button
                key={key}
                variant={key === 'bad_number' ? 'outline' : 'default'}
                className="min-h-11 w-full justify-start gap-2"
                disabled={!!busy}
                onClick={() => log(key)}
              >
                {busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                {label}
              </Button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DispositionDialog({ lead, onClose, onDone }) {
  const [key, setKey] = useState('');
  const [recall, setRecall] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: options = [] } = useQuery({
    queryKey: ['leadDispositions'],
    queryFn: () => base44.entities.LeadDisposition.filter({ is_active: true }, 'sort_order'),
    staleTime: 10 * 60 * 1000,
  });
  const chosen = options.find((o) => o.key === key);

  const save = async () => {
    if (!key) { toast.error('Pick a reason'); return; }
    setSaving(true);
    try {
      const res = await base44.functions.invoke('dispositionLead', {
        leadId: lead.lead_id, disposition: key,
        recallDate: recall || null, note: note.trim() || null,
      });
      const failed = invokeFailure(res);
      if (failed) { toast.error(failed); return; }
      // ok:false here is a RULE refusal, not a failure — the database is telling
      // the CSR why this lead cannot be closed that way yet.
      if (res.data?.ok === false) { toast.warning(res.data.reason); return; }
      toast.success('Closed out');
      onDone();
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close out this lead</DialogTitle>
          <DialogDescription>
            {lead.first_name} {lead.last_name} · {lead.attempt_count} attempt{lead.attempt_count === 1 ? '' : 's'} logged
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select value={key} onValueChange={setKey}>
              <SelectTrigger className="min-h-11"><SelectValue placeholder="Pick one" /></SelectTrigger>
              <SelectContent>
                {options.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {chosen?.requires_recall_date && (
            <div className="space-y-1.5">
              <Label htmlFor="lq-recall">Call them back on</Label>
              <Input id="lq-recall" type="date" value={recall}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setRecall(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                They come back to the top of your queue that morning.
              </p>
            </div>
          )}
          {chosen?.min_attempts && (
            <p className="text-xs text-muted-foreground">
              Needs {chosen.min_attempts} attempts
              {chosen.min_days_working ? ` over ${chosen.min_days_working} days` : ''} —
              {' '}{lead.attempt_count} logged so far.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="lq-dnote">Note (optional)</Label>
            <Textarea id="lq-dnote" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="min-h-11" onClick={onClose}>Cancel</Button>
          <Button className="min-h-11 gap-2" disabled={saving} onClick={save}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Close out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────

function LeadRow({ lead, onLog, onDisposition, onBook, booking }) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'No name given';
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-foreground">{name}</p>
            <ClockChip dueAt={lead.next_due_at} firstDial={lead.is_first_dial} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {lead.phone_e164 && (
              // tel: works from a desk phone app or a mobile, and costs nothing
              // while the RingCentral click-to-dial of slice 6 does not exist.
              <a href={`tel:${lead.phone_e164}`} className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline">
                <PhoneCall className="h-3.5 w-3.5" />{lead.phone}
              </a>
            )}
            {lead.city && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{lead.city}</span>}
            <span className="tabular-nums">{lead.attempt_count} attempt{lead.attempt_count === 1 ? '' : 's'}</span>
            {lead.recall_date && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />call back {lead.recall_date}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <SourceChip label={lead.source_label} campaign={lead.source_campaign} />
            {lead.csr_name && <span className="text-xs text-muted-foreground">{lead.csr_name}</span>}
            {!lead.assigned_csr && <span className="text-xs text-warn">unclaimed</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" className="min-h-11 gap-1.5" onClick={() => onLog(lead)}>
            <PhoneCall className="h-4 w-4" /> Log attempt
          </Button>
          <Button size="sm" variant="outline" className="min-h-11 gap-1.5" disabled={booking === lead.lead_id} onClick={() => onBook(lead)}>
            {booking === lead.lead_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Book
          </Button>
          <Button size="sm" variant="ghost" className="min-h-11" onClick={() => onDisposition(lead)}>
            Close out
          </Button>
        </div>
      </div>
    </li>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function LeadQueue() {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState('mine');
  const [logging, setLogging] = useState(null);
  const [closing, setClosing] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [booking, setBooking] = useState(null);

  // The clock has to move on its own — a 5-minute SLA on a board that only
  // updates when you reload is not an SLA.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const { data: leads = [], isLoading, isError, error } = useQuery({
    queryKey: ['leadQueue', scope],
    queryFn: async () => unwrapInvoke(await base44.functions.invoke('leadQueue', { scope })) || [],
    refetchInterval: 60000,
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['leadQueue'] });

  const lateCount = useMemo(
    () => leads.filter((l) => new Date(l.next_due_at).getTime() < Date.now()).length,
    [leads],
  );

  const claim = async () => {
    setClaiming(true);
    try {
      const res = await base44.functions.invoke('claimNextLead');
      const failed = invokeFailure(res);
      if (failed) { toast.error(failed); return; }
      if (res.data?.ok === false) { toast.info(res.data.reason); return; }
      toast.success('Next lead is yours — ring them now');
      setScope('mine');
      refresh();
    } finally { setClaiming(false); }
  };

  // "Book" is the existing path, not a new one: a Checklist 2.0 pre-filled from
  // the lead, which is what create_appointment_from_checklist converts.
  const book = async (lead) => {
    setBooking(lead.lead_id);
    try {
      const checklist = await base44.entities.ChecklistV2.create({
        customer_first_name: lead.first_name || '',
        customer_last_name: lead.last_name || '',
        customer_email: lead.email || '',
        customer_phone: lead.phone || '',
        city: lead.city || '',
      });
      window.location.href = `${createPageUrl('ChecklistV2Detail')}?id=${checklist.id}`;
    } catch (e) {
      toast.error(e?.message || 'Could not start a checklist for them');
      setBooking(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Lead Queue</h1>
            <p className="mt-1 text-muted-foreground">
              Five minutes to the first dial. Every lead leaves here booked or closed out.
            </p>
          </div>
          <Button className="min-h-11 gap-2" disabled={claiming} onClick={claim}>
            {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Take the next lead
          </Button>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              className={cn(
                'min-h-11 rounded-lg px-4 text-sm font-medium transition-colors',
                scope === s.key ? 'bg-primary text-primary-foreground'
                                : 'bg-card text-muted-foreground ring-1 ring-border hover:bg-muted',
              )}
            >
              {s.label}
            </button>
          ))}
          {lateCount > 0 && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-crit/15 px-3 py-1 text-sm font-semibold text-crit ring-1 ring-crit/30">
              <Timer className="h-4 w-4" /> {lateCount} past due
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : isError ? (
          <div className="rounded-xl border border-crit/30 bg-crit/5 p-4 text-sm text-foreground">
            The queue could not be loaded — {error?.message || 'the request failed'}.
          </div>
        ) : !leads.length ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
            <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium text-foreground">
              {scope === 'mine' ? 'Nothing in your queue' : scope === 'unassigned' ? 'Nothing unclaimed' : 'No open leads'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {scope === 'mine'
                ? 'Press “Take the next lead” to pick up whoever has been waiting longest.'
                : 'Leads appear here the moment one is queued.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {leads.map((l) => (
              <LeadRow
                key={l.lead_id}
                lead={l}
                booking={booking}
                onLog={setLogging}
                onDisposition={setClosing}
                onBook={book}
              />
            ))}
          </ul>
        )}
      </div>

      {logging && <LogAttemptDialog lead={logging} onClose={() => setLogging(null)} onDone={refresh} />}
      {closing && <DispositionDialog lead={closing} onClose={() => setClosing(null)} onDone={refresh} />}
    </div>
  );
}
