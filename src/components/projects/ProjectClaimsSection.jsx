import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { deliveryNote, invokeFailure, invokeNotSent } from '@/lib/invokeResult';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { AlertTriangle, Plus, ChevronDown, ChevronUp, Trash2, Send, Loader2, X, Package, CheckCircle2, CalendarIcon } from 'lucide-react';
import { format as formatDate } from 'date-fns';
import { Label } from "@/components/ui/label";
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { Badge } from "@/components/ui/badge";
import ProjectClaimForm from './ProjectClaimForm';

const claimTypeColors = {
  'Claim': 'bg-crit/12 text-crit border-crit/25',
  'Repair': 'bg-warn/12 text-warn border-warn/25',
  'Short Item': 'bg-info/12 text-info border-info/25',
};

const DEFAULT_EMAILS = [
  'orders@example.com',
  'user1@example.com',
  'user2@example.com',
  'user3@example.com',
  'user4@example.com'
];

export default function ProjectClaimsSection({ project, customer, sale, currentUser }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [resendModal, setResendModal] = useState(null);
  const [resendEmails, setResendEmails] = useState([]);
  const [resendNewEmail, setResendNewEmail] = useState('');
  const [completingId, setCompletingId] = useState(null);
  const [completeModal, setCompleteModal] = useState(null); // { claim }
  const [completeRef, setCompleteRef] = useState('');
  const [completeEta, setCompleteEta] = useState(null); // Date object
  const [refEditId, setRefEditId] = useState(null);
  const [refValue, setRefValue] = useState('');

  const { data: claims = [] } = useQuery({
    queryKey: ['projectClaims', project?.id],
    queryFn: () => base44.entities.ProjectClaim.filter({ project: project.id }),
    enabled: !!project?.id
  });

  const sorted = [...claims].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  const handleDelete = async (id) => {
    if (!confirm('Delete this claim?')) return;
    await base44.entities.ProjectClaim.delete(id);
    queryClient.invalidateQueries({ queryKey: ['projectClaims', project.id] });
  };

  const handleSave = async (formData, sendEmail = true) => {
    setSaving(true);
    const created = await base44.entities.ProjectClaim.create({ ...formData, project: project.id });
    queryClient.invalidateQueries({ queryKey: ['projectClaims', project.id] });
    if (sendEmail && formData.email_recipients?.length > 0) {
      // The claim IS saved by this point, so this never throws — but a claim
      // nobody was told about is a claim nobody works. Say it out loud.
      const res = await base44.functions.invoke('sendProjectClaimEmail', { claimId: created.id });
      const note = deliveryNote(res, { saved: 'Claim saved', sent: 'the email did not go out' });
      if (note) toast.warning(note, { duration: 8000 });
    }
    setSaving(false);
    setShowForm(false);
  };

  const openResendModal = (claim) => {
    const emails = (claim.email_recipients && claim.email_recipients.length > 0)
      ? [...claim.email_recipients]
      : [...DEFAULT_EMAILS];
    setResendEmails(emails);
    setResendNewEmail('');
    setTimeout(() => setResendModal({ claim }), 0);
  };

  const addResendEmail = () => {
    const trimmed = resendNewEmail.trim();
    if (trimmed && !resendEmails.includes(trimmed)) {
      setResendEmails(prev => [...prev, trimmed]);
    }
    setResendNewEmail('');
  };

  const openCompleteModal = (claim) => {
    if (claim.is_completed) {
      // Uncomplete immediately
      handleDoComplete(claim, null, null, false);
      return;
    }
    setCompleteRef(claim.reference_number || '');
    setCompleteEta(null);
    setCompleteModal({ claim });
  };

  const handleDoComplete = async (claim, refNum, eta, completing) => {
    setCompletingId(claim.id);
    setCompleteModal(null);
    const updates = {
      is_completed: completing,
      completed_by: completing ? (currentUser?.full_name || '') : null,
      completed_on: completing ? new Date().toISOString() : null,
      reference_number: completing && refNum ? refNum : (claim.reference_number || null),
      eta: completing && eta ? eta : (claim.eta || null),
    };
    await base44.entities.ProjectClaim.update(claim.id, updates);
    if (completing) {
      const res = await base44.functions.invoke('sendProjectClaimCompletedEmail', {
        claimId: claim.id,
        referenceNumber: refNum,
        eta,
      });
      const note = deliveryNote(res, {
        saved: 'Claim marked complete', sent: 'the completion email did not go out',
      });
      if (note) toast.warning(note, { duration: 8000 });
    }
    queryClient.invalidateQueries({ queryKey: ['projectClaims', project.id] });
    setCompletingId(null);
  };

  const handleSaveRef = async (claim) => {
    await base44.entities.ProjectClaim.update(claim.id, { reference_number: refValue });
    queryClient.invalidateQueries({ queryKey: ['projectClaims', project.id] });
    setRefEditId(null);
  };

  const handleResendConfirm = async () => {
    if (!resendEmails.length) return;
    const { claim } = resendModal;
    setSendingId(claim.id);
    setResendModal(null);
    try {
      await base44.entities.ProjectClaim.update(claim.id, { email_recipients: resendEmails });
      const res = await base44.functions.invoke('sendProjectClaimEmail', { claimId: claim.id });
      queryClient.invalidateQueries({ queryKey: ['projectClaims', project.id] });
      // Resend is a send-only action a person deliberately pressed: it needs a
      // yes or a no. invoke() does not throw, so the catch below only ever saw
      // the entity update — pressing Resend gave no feedback of any kind.
      const failed = invokeFailure(res);
      const notSent = invokeNotSent(res);
      if (failed) toast.error(`Not sent — ${failed}`);
      else if (notSent) toast.warning(`Nothing went out — ${notSent}`, { duration: 8000 });
      else toast.success(`Sent to ${resendEmails.length} recipient${resendEmails.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error('Failed to send: ' + e.message);
    }
    setSendingId(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.57 }}
      className="bg-white rounded-2xl border border-border p-6 md:col-span-2"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-warn" />
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Claims / Repairs / Short Items
          </h2>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)} className="bg-info hover:bg-info">
          <Plus className="w-4 h-4 mr-1" /> New
        </Button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No claims, repairs, or short items yet</p>
      ) : (
        <div className="space-y-3">
          {sorted.map(claim => (
            <div key={claim.id} className="border border-border rounded-xl overflow-hidden">
              <div className="flex items-center">
                <button
                  className={`flex-1 flex items-center justify-between px-4 py-3 hover:bg-muted transition-colors ${claim.is_completed ? 'bg-good/12' : ''}`}
                  onClick={() => setExpandedId(expandedId === claim.id ? null : claim.id)}
                >
                  <div className="flex items-center gap-3 text-left">
                    {claim.is_completed
                      ? <CheckCircle2 className="w-4 h-4 text-good flex-shrink-0" />
                      : <AlertTriangle className="w-4 h-4 text-warn flex-shrink-0" />
                    }
                    <div>
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium ${claim.is_completed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                          {claim.claim_type || 'Claim'} — {claim.customer_name || 'Unknown'}
                        </p>
                        {claim.is_completed && (
                          <Badge className="bg-good/12 text-good border-good/25 text-xs px-1.5 py-0">Completed</Badge>
                        )}
                        {claim.need_to_order_material && !claim.is_completed && (
                          <Badge className="bg-crit/12 text-crit border-crit/25 text-xs px-1.5 py-0">
                            <Package className="w-3 h-3 mr-1" />Order Material
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        By {claim.submitted_by || 'Unknown'} · {format(new Date(claim.created_date.endsWith('Z') ? claim.created_date : claim.created_date + 'Z'), 'MMM d, yyyy h:mm a')}
                        {claim.reference_number && <span className="ml-2 text-info font-medium">Ref: {claim.reference_number}</span>}
                        {claim.eta && <span className="ml-2 text-warn font-medium">ETA: {claim.eta}</span>}
                      </p>
                    </div>
                  </div>
                  {expandedId === claim.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>
                <button
                  onClick={() => openCompleteModal(claim)}
                  disabled={completingId === claim.id}
                  className={`px-3 py-3 transition-colors disabled:opacity-50 ${claim.is_completed ? 'text-good hover:text-good hover:bg-good/12' : 'text-muted-foreground hover:text-good hover:bg-good/12'}`}
                  title={claim.is_completed ? 'Mark Incomplete' : 'Mark Completed'}
                >
                  {completingId === claim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => openResendModal(claim)}
                  disabled={sendingId === claim.id}
                  className="px-3 py-3 text-info hover:text-info hover:bg-info/12 transition-colors disabled:opacity-50"
                  title="Resend Email"
                >
                  {sendingId === claim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => handleDelete(claim.id)}
                  className="px-3 py-3 text-crit hover:text-crit hover:bg-crit/12 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {expandedId === claim.id && (
                <div className="px-4 pb-4 border-t border-border pt-3 space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    {claim.claim_type && <Row label="Type" value={<Badge className={claimTypeColors[claim.claim_type]}>{claim.claim_type}</Badge>} />}
                    {claim.job_number && <Row label="Job #" value={claim.job_number} />}
                    {claim.address && <Row label="Address" value={claim.address} className="col-span-2" />}
                    {claim.submitted_by && <Row label="Submitted By" value={claim.submitted_by} />}
                    {claim.submitted_on && <Row label="Date" value={format(new Date(claim.submitted_on + 'T00:00:00'), 'MMM d, yyyy')} />}
                  </div>
                  {claim.notes && <Row label="Notes" value={claim.notes} block />}
                  <div className="flex flex-wrap gap-4">
                    {claim.billable_repair && <span className="text-xs bg-warn/12 text-warn border border-warn/25 px-2 py-1 rounded-full font-medium">Billable Repair</span>}
                    {claim.is_back_charge && <span className="text-xs bg-purple-100 text-purple-700 border border-purple-200 px-2 py-1 rounded-full font-medium">Back Charge</span>}
                    {claim.payment_status && <span className={`text-xs px-2 py-1 rounded-full font-medium border ${claim.payment_status === 'Payable' ? 'bg-good/12 text-good border-good/25' : 'bg-crit/12 text-crit border-crit/25'}`}>{claim.payment_status}</span>}
                  </div>
                  <Row label="Need to Order Material" value={claim.need_to_order_material ? '✅ Yes' : 'No'} />
                  {claim.need_to_order_material && claim.material_details && (
                    <Row label="Material Details" value={claim.material_details} block />
                  )}
                  {/* Reference # */}
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase mb-1">Reference #</p>
                    {refEditId === claim.id ? (
                      <div className="flex gap-2">
                        <Input
                          value={refValue}
                          onChange={e => setRefValue(e.target.value)}
                          placeholder="Enter reference #..."
                          className="h-8 text-sm flex-1"
                          onKeyDown={e => e.key === 'Enter' && handleSaveRef(claim)}
                          autoFocus
                        />
                        <Button size="sm" onClick={() => handleSaveRef(claim)} className="h-8 bg-info hover:bg-info">Save</Button>
                        <Button size="sm" variant="outline" onClick={() => setRefEditId(null)} className="h-8">Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-foreground text-sm">{claim.reference_number || <span className="text-muted-foreground italic">Not set</span>}</span>
                        <button
                          onClick={() => { setRefEditId(claim.id); setRefValue(claim.reference_number || ''); }}
                          className="text-xs text-info hover:text-info underline"
                        >
                          {claim.reference_number ? 'Edit' : 'Add'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Complete button in expanded view */}
                  <div className="pt-2 border-t border-border">
                    <Button
                      size="sm"
                      onClick={() => openCompleteModal(claim)}
                      disabled={completingId === claim.id}
                      className={claim.is_completed
                        ? 'bg-muted text-muted-foreground hover:bg-muted border border-border'
                        : 'bg-good hover:bg-good text-white'
                      }
                    >
                      {completingId === claim.id
                        ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Processing...</>
                        : claim.is_completed
                          ? <><CheckCircle2 className="w-4 h-4 mr-1" />Mark as Incomplete</>
                          : <><CheckCircle2 className="w-4 h-4 mr-1" />Mark as Completed</>
                      }
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Complete Modal */}
      <Dialog open={!!completeModal} onOpenChange={() => setCompleteModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as Completed</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground uppercase font-medium mb-1 block">Reference # <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                placeholder="Enter reference number..."
                value={completeRef}
                onChange={e => setCompleteRef(e.target.value)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground uppercase font-medium mb-1 block">ETA <span className="text-muted-foreground">(optional)</span></Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-2 w-full border border-input rounded-md px-3 h-9 text-sm text-left bg-white hover:bg-muted transition-colors">
                    <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                    {completeEta ? formatDate(completeEta, 'MMM d, yyyy') : <span className="text-muted-foreground">Pick a date...</span>}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={completeEta}
                    onSelect={setCompleteEta}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteModal(null)}>Cancel</Button>
            <Button
              onClick={() => handleDoComplete(completeModal.claim, completeRef, completeEta ? formatDate(completeEta, 'MMM d, yyyy') : '', true)}
              className="bg-good hover:bg-good"
            >
              <CheckCircle2 className="w-4 h-4 mr-1" /> Complete & Send Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resend Modal */}
      <Dialog open={!!resendModal} onOpenChange={() => setResendModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Select recipients:</p>
            <div className="flex flex-wrap gap-2">
              {resendEmails.map(email => (
                <span key={email} className="flex items-center gap-1 bg-info/12 text-info text-xs px-2 py-1 rounded-full">
                  {email}
                  <button type="button" onClick={() => setResendEmails(prev => prev.filter(e => e !== email))} className="hover:text-crit transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="Add email..."
                value={resendNewEmail}
                onChange={e => setResendNewEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addResendEmail())}
                className="flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={addResendEmail}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResendModal(null)}>Cancel</Button>
            <Button onClick={handleResendConfirm} disabled={!resendEmails.length} className="bg-info hover:bg-info">
              <Send className="w-4 h-4 mr-1" /> Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProjectClaimForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSave={handleSave}
        project={project}
        customer={customer}
        sale={sale}
        saving={saving}
      />
    </motion.div>
  );
}

function Row({ label, value, block, className }) {
  if (block) {
    return (
      <div className={className}>
        <p className="text-xs text-muted-foreground font-medium uppercase mb-0.5">{label}</p>
        <p className="text-foreground whitespace-pre-wrap">{value}</p>
      </div>
    );
  }
  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground font-medium uppercase mb-0.5">{label}</p>
      <div className="text-foreground">{value}</div>
    </div>
  );
}