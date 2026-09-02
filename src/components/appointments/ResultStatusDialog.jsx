import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const NON_SOLD_STATUSES = ['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline', 'Follow-Up'];

const RESULT_OPTIONS = [
  { status: 'Lost', label: 'Lost', className: 'border-crit/25 text-crit hover:bg-crit/12' },
  { status: 'Pitch and Miss', label: 'Pitch and Miss', className: 'border-warn/25 text-warn hover:bg-warn/12' },
  { status: 'One-Leg', label: 'One-Leg', className: 'border-warn/25 text-warn hover:bg-warn/12' },
  { status: 'Credit Decline', label: 'Credit Decline', className: 'border-crit/25 text-crit hover:bg-crit/12' },
  { status: 'Follow-Up', label: 'Follow-Up', className: 'border-crit/25 text-crit hover:bg-crit/12' },
  { status: 'Completed', label: 'Completed', className: 'border-border text-muted-foreground hover:bg-muted' }
];

export default function ResultStatusDialog({ open, onOpenChange, appointment, currentUser, onConfirm, isLoading }) {
  const [selectedStatus, setSelectedStatus] = useState('');
  const [dealSize, setDealSize] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setSelectedStatus('');
      setDealSize('');
      setNotes('');
    }
  }, [open]);

  const requiresDealSize = NON_SOLD_STATUSES.includes(selectedStatus);

  const handleSubmit = () => {
    const data = { status: selectedStatus };

    if (requiresDealSize && dealSize) {
      data.not_sold_deal_size = parseFloat(dealSize);
    }

    if (notes.trim()) {
      const existingNotes = appointment?.notes || [];
      data.notes = [
        ...existingNotes,
        {
          content: notes,
          user_name: currentUser?.full_name || 'Admin',
          user_email: currentUser?.email || '',
          timestamp: new Date().toISOString(),
          context: `${selectedStatus} Result`
        }
      ];
    }

    onConfirm(data);
  };

  const canSubmit = selectedStatus && (!requiresDealSize || dealSize);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">Mark Appointment Result</DialogTitle>
          <DialogDescription className="text-muted-foreground mt-2">
            Set the outcome for this appointment. The customer will be notified automatically for non-sold results.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-foreground">Result Status *</Label>
            <div className="grid grid-cols-2 gap-2">
              {RESULT_OPTIONS.map((opt) => (
                <Button
                  key={opt.status}
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedStatus(opt.status)}
                  className={cn(
                    "h-11",
                    opt.className,
                    selectedStatus === opt.status && "ring-2 ring-offset-1 ring-info"
                  )}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {requiresDealSize && (
            <div className="space-y-2">
              <Label htmlFor="result-deal-size" className="text-foreground">Deal Size *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="result-deal-size"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={dealSize}
                  onChange={(e) => setDealSize(e.target.value)}
                  className="pl-7"
                />
              </div>
              <p className="text-xs text-muted-foreground">Enter the estimated deal size for this appointment</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="result-notes" className="text-foreground">Notes (optional)</Label>
            <Textarea
              id="result-notes"
              placeholder={`Add notes about this ${selectedStatus ? selectedStatus.toLowerCase() : 'result'} outcome...`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || isLoading}
            className={cn(
              "bg-info hover:bg-info",
              selectedStatus === 'Lost' && "bg-crit hover:bg-crit",
              selectedStatus === 'Pitch and Miss' && "bg-warn hover:bg-warn",
              selectedStatus === 'Completed' && "bg-slate-600 hover:bg-slate-700"
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              `Confirm ${selectedStatus || 'Result'}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}