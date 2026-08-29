import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { signInPerson } from '@/lib/signInPerson';
import { deliveryNote, invokeFailure, invokeNotSent } from '@/lib/invokeResult';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { motion } from 'framer-motion';
import { Plus, Send, Loader2, PenLine, CheckCircle2, Clock, ExternalLink, Pen } from 'lucide-react';
import { format } from 'date-fns';

const STATUS_STYLES = {
  draft: 'bg-slate-100 text-slate-600 border-slate-200',
  sent: 'bg-amber-100 text-amber-700 border-amber-200',
  signed: 'bg-green-100 text-green-700 border-green-200'
};

export default function DesignModsSection({ project, customer, sale }) {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [form, setForm] = useState({
    customer_first_name: customer?.first_name || '',
    customer_last_name: customer?.last_name || '',
    customer_email: customer?.email || '',
    job_number: sale?.rfms_order_data?.orderNumber || sale?.invoice_number || '',
    products_or_changes: '',
    value_added_costs: '',
    funds_collected_terms: 'Credit Card'
  });

  const { data: designMods = [], isLoading } = useQuery({
    queryKey: ['designMods', project.id, customer?.last_name, sale?.invoice_number],
    queryFn: async () => {
      // Fetch design mods linked by project ID
      const byProject = await base44.entities.DesignMod.filter({ project: project.id });

      // Also fetch manual ones (no project set) that match by last name or job number
      const allMods = await base44.entities.DesignMod.list();
      const manual = allMods.filter(m => {
        if (m.project) return false; // already has a project link, skip
        const lastNameMatch = customer?.last_name &&
          m.customer_last_name?.toLowerCase() === customer.last_name.toLowerCase();
        const invoiceMatch = sale?.invoice_number &&
          m.job_number && m.job_number.trim() === sale.invoice_number.trim();
        return lastNameMatch || invoiceMatch;
      });

      // Merge and deduplicate by ID
      const merged = [...byProject];
      for (const m of manual) {
        if (!merged.find(x => x.id === m.id)) merged.push(m);
      }
      return merged;
    }
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const mod = await base44.entities.DesignMod.create({ ...data, project: project.id, customer_id: customer?.id, status: 'draft' });
      const res = await base44.functions.invoke('sendDesignModEmail', { designModId: mod.id });
      // Deliberately NOT thrown. The DesignMod row is already committed, so
      // failing here would leave the dialog open over a saved record and the
      // natural retry would create a second one — and a second customer email.
      return { mod, note: deliveryNote(res, { saved: 'Modification saved', sent: 'the email to the customer did not go out' }) };
    },
    onSuccess: ({ note }) => {
      queryClient.invalidateQueries({ queryKey: ['designMods', project.id] });
      setShowDialog(false);
      resetForm();
      if (note) toast.warning(note, { duration: 8000 });
    }
  });

  const resetForm = () => {
    setForm({
      customer_first_name: customer?.first_name || '',
      customer_last_name: customer?.last_name || '',
      customer_email: customer?.email || '',
      job_number: sale?.rfms_order_data?.orderNumber || sale?.invoice_number || '',
      products_or_changes: '',
      value_added_costs: '',
      funds_collected_terms: 'Credit Card'
    });
  };

  const handleSend = async (mod) => {
    setSendingId(mod.id);
    try {
      const res = await base44.functions.invoke('sendDesignModEmail', { designModId: mod.id });
      queryClient.invalidateQueries({ queryKey: ['designMods', project.id] });
      // A Send button that reports nothing either way is indistinguishable from
      // one that does nothing at all.
      const failed = invokeFailure(res);
      const notSent = invokeNotSent(res);
      if (failed) toast.error(`Not sent — ${failed}`);
      else if (notSent) toast.warning(`Nothing went out — ${notSent}`, { duration: 8000 });
      else toast.success('Sent to the customer');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <PenLine className="w-5 h-5 text-blue-600" />
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Design Modifications</h2>
        </div>
        <Button
          size="sm"
          onClick={() => { resetForm(); setShowDialog(true); }}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-1" />
          New Design Mod
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : designMods.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">No design modifications yet</p>
      ) : (
        <div className="space-y-3">
          {designMods.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)).map(mod => (
            <div key={mod.id} className="border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-medium text-slate-800">{mod.customer_first_name} {mod.customer_last_name}</span>
                  <Badge variant="outline" className={STATUS_STYLES[mod.status]}>
                    {mod.status === 'signed' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                    {mod.status}
                  </Badge>
                  {mod.job_number && <span className="text-xs text-slate-500">Job #{mod.job_number}</span>}
                </div>
                <p className="text-sm text-slate-600 line-clamp-2">{mod.products_or_changes}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                  {mod.value_added_costs != null && <span>${Number(mod.value_added_costs).toLocaleString()}</span>}
                  {mod.funds_collected_terms && <span>• {mod.funds_collected_terms}</span>}
                  {mod.signed_at && <span>• Signed {format(new Date(mod.signed_at), 'MMM d, yyyy')}</span>}
                  {mod.email_sent_at && mod.status !== 'signed' && <span>• Sent {format(new Date(mod.email_sent_at), 'MMM d')}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {mod.status === 'signed' ? (
                  <a
                    href={`/DesignModView?id=${mod.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-green-300 rounded-lg hover:bg-green-50 transition-colors text-green-700"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    View Signed
                  </a>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => signInPerson('design_mod', mod.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-primary/40 rounded-lg hover:bg-primary/10 transition-colors text-primary"
                    >
                      <Pen className="w-3 h-3" />
                      Sign in Person
                    </button>
                    {mod.short_url && (
                      <Button size="sm" variant="outline" onClick={() => window.open(mod.short_url, '_blank')}>
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Customer Link
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleSend(mod)}
                      disabled={sendingId === mod.id}
                      variant="outline"
                    >
                      {sendingId === mod.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
                      {mod.email_sent_at ? 'Resend' : 'Send'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Design Modification</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Customer First Name</Label>
                <Input value={form.customer_first_name} onChange={e => setForm(f => ({ ...f, customer_first_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Customer Last Name</Label>
                <Input value={form.customer_last_name} onChange={e => setForm(f => ({ ...f, customer_last_name: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Customer Email</Label>
              <Input type="email" value={form.customer_email} onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Job Number CG</Label>
              <Input value={form.job_number} onChange={e => setForm(f => ({ ...f, job_number: e.target.value }))} placeholder="Job number" />
            </div>
            <div className="space-y-1">
              <Label>Products or Installation Changes *</Label>
              <Textarea
                value={form.products_or_changes}
                onChange={e => setForm(f => ({ ...f, products_or_changes: e.target.value }))}
                placeholder="Describe the changes..."
                className="min-h-28"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Value Added Costs ($)</Label>
                <Input type="number" value={form.value_added_costs} onChange={e => setForm(f => ({ ...f, value_added_costs: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label>Funds Collected Terms</Label>
                <Select value={form.funds_collected_terms} onValueChange={v => setForm(f => ({ ...f, funds_collected_terms: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Credit Card">Credit Card</SelectItem>
                    <SelectItem value="Existing Synchrony Financing Account">Existing Synchrony Financing Account</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={createMutation.isPending || !form.products_or_changes}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create & Send to Customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}