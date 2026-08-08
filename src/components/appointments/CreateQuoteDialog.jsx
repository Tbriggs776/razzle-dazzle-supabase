import React, { useState } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from 'lucide-react';

export default function CreateQuoteDialog({ open, onClose, lead, appointment, appointmentId }) {
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [quoteExpirationDate, setQuoteExpirationDate] = useState('');
  const [submittingQuote, setSubmittingQuote] = useState(false);

  const handleClose = () => {
    setQuoteAmount('');
    setQuoteNotes('');
    setQuoteExpirationDate('');
    onClose();
  };

  const handleSubmit = async () => {
    setSubmittingQuote(true);
    try {
      let userEmail = 'consultant';
      let userName = 'Design Consultant';
      try {
        const u = await base44.auth.me();
        userEmail = u?.email || userEmail;
        userName = u?.full_name || userName;
      } catch {}

      await base44.entities.Quote.create({
        appointment: appointmentId,
        lead: appointment.customer,
        assigned_dc: appointment.assigned_dc,
        assigned_csr: appointment.assigned_csr,
        quote_date: new Date().toISOString(),
        expiration_date: quoteExpirationDate || undefined,
        status: 'Draft',
        quote_amount: quoteAmount ? parseFloat(quoteAmount) : undefined,
        location_address: appointment.location_address,
        appointment_date: appointment.appointment_date,
        appointment_block: appointment.appointment_block,
        notes: quoteNotes || undefined
      });

      await base44.entities.AppointmentLog.create({
        appointment: appointmentId,
        action: 'Quote Created',
        details: `Quote created${quoteAmount ? ` for $${parseFloat(quoteAmount).toLocaleString()}` : ''}`,
        user_email: userEmail,
        user_name: userName
      });

      handleClose();
      toast.success('Quote created successfully! You can manage it from My Quotes.');
    } catch (err) {
      toast.error('Failed to create quote: ' + err.message);
    } finally {
      setSubmittingQuote(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-violet-600" />
            Create Quote
          </DialogTitle>
          <DialogDescription>
            This will create a quote record for {lead ? `${lead.first_name} ${lead.last_name}` : 'this customer'} without marking the appointment as sold.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Quoted Amount (optional)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={quoteAmount}
                onChange={e => setQuoteAmount(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm pl-7 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Expiration Date (optional)</label>
            <input
              type="date"
              value={quoteExpirationDate}
              onChange={e => setQuoteExpirationDate(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Notes (optional)</label>
            <textarea
              rows={3}
              placeholder="Any notes about this quote..."
              value={quoteNotes}
              onChange={e => setQuoteNotes(e.target.value)}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button disabled={submittingQuote} onClick={handleSubmit} className="bg-violet-600 hover:bg-violet-700">
            {submittingQuote ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : <><FileText className="w-4 h-4 mr-2" />Create Quote</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}