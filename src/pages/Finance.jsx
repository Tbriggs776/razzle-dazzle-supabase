import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { ArrowLeft, DollarSign, Loader2, CheckCircle2, Send, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { toast } from 'sonner';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import ModuleCard from '@/components/dashboard/ModuleCard';
import KpiTile from '@/components/dashboard/KpiTile';

const money = (n) =>
  '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Finance() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState({});
  const [sendingReport, setSendingReport] = useState(false);

  const handleSendReport = async () => {
    setSendingReport(true);
    try {
      const { data, error } = await base44.functions.invoke('sendFinanceReport', {});
      if (error) throw error;
      if (data?.stub) toast.info('Email isn’t connected yet — report not sent.');
      else if (data?.skipped) toast.info(`Report not sent: ${data.skipped}`);
      else toast.success('Finance report sent!');
    } catch (e) {
      toast.error(e?.message || 'Failed to send the finance report.');
    } finally {
      setSendingReport(false);
    }
  };

  /**
   * Accounting's "the money landed" action.
   *
   * This used to write `project.installation_date_status = null` and nothing
   * else — no ledger row, no amount check, no record of who confirmed what. It
   * cleared the hold for any amount, or for no payment at all.
   *
   * Now it confirms the sale's payments and releases the ordering hold ONLY if
   * the cleared total meets the agreed deposit. The amount check is server-side;
   * a short deposit comes back with the exact shortfall and the hold stays on.
   */
  const handleConfirmDeposit = async (e, saleId) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirming((prev) => ({ ...prev, [saleId]: true }));
    try {
      const { data, error } = await base44.functions.invoke('confirmSaleDeposit', { saleId });
      if (error) throw error;

      if (data?.ok === false && data?.reason === 'short') {
        toast.error(
          `Still ${money(data.shortfall)} short of the ${money(data.deposit_required)} deposit — hold stays on.`,
          { description: `${money(data.amount_cleared)} has cleared so far.` },
        );
      } else if (data?.ok) {
        toast.success(`Deposit confirmed — ${money(data.amount_cleared)} cleared. Ordering released.`);
        base44.functions.invoke('sendFundsReceivedEmail', { saleId }).catch(() => {});
      } else {
        toast.info('Nothing to confirm on this sale.');
      }
      queryClient.invalidateQueries({ queryKey: ['depositQueue'] });
    } catch (err) {
      toast.error(err?.message || 'Could not confirm the deposit.');
    } finally {
      setConfirming((prev) => ({ ...prev, [saleId]: false }));
    }
  };

  // Derived from the ledger, not from a flag somebody remembered to set. A sale
  // whose deposit never cleared can no longer be invisible here.
  const { data: balances = [], isLoading } = useQuery({
    queryKey: ['depositQueue'],
    queryFn: () => base44.entities.SaleBalance.list('-sale_date'),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list(),
  });

  const getCustomer = (id) => customers.find((c) => c.id === id);
  const nameOf = (b) => {
    const c = getCustomer(b.customer);
    return c ? `${c.first_name} ${c.last_name}` : 'Unknown customer';
  };

  const live = balances.filter((b) => !b.is_cancelled);
  const awaiting = live.filter((b) => !b.deposit_satisfied);
  const uncleared = live.reduce((sum, b) => sum + Number(b.amount_pending_clearance || 0), 0);
  const outstanding = live.reduce((sum, b) => sum + Number(b.balance_due || 0), 0);
  // Owner decision: the legacy book is deemed satisfied at its actual deposit,
  // and the gap to the current policy is REPORTED here rather than enforced.
  const gapRows = live.filter((b) => Number(b.deposit_policy_gap || 0) > 0);
  const totalGap = gapRows.reduce((sum, b) => sum + Number(b.deposit_policy_gap || 0), 0);

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          eyebrow={
            <Link
              to={createPageUrl('OrderProcessing')}
              className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Order Processing
            </Link>
          }
          title="Finance"
          subtitle="Deposits awaiting confirmation, and what is still owed"
          actions={
            <Button onClick={handleSendReport} disabled={sendingReport} variant="outline">
              {sendingReport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send Report Email
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            hero
            label="Awaiting deposit"
            value={String(awaiting.length)}
            foot="Ordering is held on these"
          />
          <KpiTile label="Recorded, not cleared" value={money(uncleared)} foot="Banked but unconfirmed" />
          <KpiTile label="Outstanding" value={money(outstanding)} foot="Due before install starts" />
          <KpiTile
            label="Gap to 50% policy"
            value={money(totalGap)}
            foot={gapRows.length ? `${gapRows.length} sale(s) below policy` : 'Whole book at policy'}
          />
        </div>

        <ModuleCard title="Deposits awaiting confirmation" icon={DollarSign}>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : awaiting.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">Every live sale has a cleared deposit</p>
            </div>
          ) : (
            awaiting.map((b) => {
              const short = Number(b.deposit_required || 0) - Number(b.amount_cleared || 0);
              const nothingRecorded = Number(b.amount_paid || 0) === 0;
              return (
                <Link
                  key={b.sale_id}
                  to={createPageUrl('SaleDetail') + `?id=${b.sale_id}`}
                  className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">{nameOf(b)}</span>
                      <StatusPill tone={nothingRecorded ? 'crit' : 'warn'}>
                        {nothingRecorded ? 'Nothing recorded' : 'Not cleared'}
                      </StatusPill>
                      {b.collection_terms && b.collection_terms !== 'cod' && (
                        <Badge variant="secondary">{b.collection_terms}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Sold {b.sale_date ? format(new Date(b.sale_date), 'MMM d, yyyy') : '—'}
                      {' · '}{money(b.amount_cleared)} cleared of {money(b.deposit_required)} required
                      {Number(b.amount_pending_clearance) > 0 &&
                        ` · ${money(b.amount_pending_clearance)} recorded but not cleared`}
                      {' · '}{b.days_since_sale}d since sale
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="whitespace-nowrap text-sm font-semibold text-amber-600 dark:text-amber-400">
                      {money(short)} short
                    </span>
                    <Button
                      size="sm"
                      onClick={(e) => handleConfirmDeposit(e, b.sale_id)}
                      disabled={confirming[b.sale_id] || nothingRecorded}
                      title={nothingRecorded ? 'No payment has been recorded to confirm' : undefined}
                    >
                      {confirming[b.sale_id]
                        ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                        : <CheckCircle2 className="mr-1.5 h-3 w-3" />}
                      Deposit Cleared
                    </Button>
                  </div>
                </Link>
              );
            })
          )}
        </ModuleCard>

        {gapRows.length > 0 && (
          <ModuleCard
            title="Below the 50% deposit policy"
            icon={AlertTriangle}
            subtitle="Deemed satisfied at the deposit actually agreed — reported, not enforced"
          >
            {gapRows.map((b) => (
              <Link
                key={b.sale_id}
                to={createPageUrl('SaleDetail') + `?id=${b.sale_id}`}
                className="flex items-center justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-muted/60"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground">{nameOf(b)}</span>
                  <p className="text-xs text-muted-foreground">
                    Agreed {(Number(b.deposit_pct_required) * 100).toFixed(0)}%
                    {' · '}{money(b.deposit_required)} of a {money(b.deposit_target_amount)} target
                  </p>
                </div>
                <span className="whitespace-nowrap text-sm text-muted-foreground">
                  {money(b.deposit_policy_gap)} below
                </span>
              </Link>
            ))}
          </ModuleCard>
        )}
      </div>
    </div>
  );
}
