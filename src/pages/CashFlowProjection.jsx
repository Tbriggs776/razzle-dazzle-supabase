import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFailure, invokeNotSent } from '@/lib/invokeResult';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RefreshCw, DollarSign, TrendingUp, AlertCircle, Code } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, startOfYear, subMonths } from 'date-fns';

const STATUS_COLORS = {
  'Job Costed': 'bg-good/12 text-good border-good/25',
  'Cancelled': 'bg-crit/12 text-crit border-crit/25',
  'On Order': 'bg-warn/12 text-warn border-warn/25',
  'Scheduled': 'bg-info/12 text-info border-info/25',
  'In Progress': 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/25',
};

const today = new Date();

const DATE_PRESETS = [
  {
    label: 'Current Month',
    from: () => format(startOfMonth(today), 'yyyy-MM-dd'),
    to: () => format(endOfMonth(today), 'yyyy-MM-dd'),
  },
  {
    label: 'Month to Date',
    from: () => format(startOfMonth(today), 'yyyy-MM-dd'),
    to: () => format(today, 'yyyy-MM-dd'),
  },
  {
    label: 'Previous Month',
    from: () => format(startOfMonth(subMonths(today, 1)), 'yyyy-MM-dd'),
    to: () => format(endOfMonth(subMonths(today, 1)), 'yyyy-MM-dd'),
  },
  {
    label: 'Year to Date',
    from: () => format(startOfYear(today), 'yyyy-MM-dd'),
    to: () => format(today, 'yyyy-MM-dd'),
  },
  {
    label: 'Last 3 Months',
    from: () => format(startOfMonth(subMonths(today, 2)), 'yyyy-MM-dd'),
    to: () => format(endOfMonth(today), 'yyyy-MM-dd'),
  },
  {
    label: 'Last 6 Months',
    from: () => format(startOfMonth(subMonths(today, 5)), 'yyyy-MM-dd'),
    to: () => format(endOfMonth(today), 'yyyy-MM-dd'),
  },
];

function formatCurrency(val) {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try { return format(parseISO(dateStr), 'MM/dd/yyyy'); } catch { return dateStr; }
}

export default function CashFlowProjection() {
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(today), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(today), 'yyyy-MM-dd'));
  const [activePreset, setActivePreset] = useState('Current Month');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('deliveryDate');
  const [sortDir, setSortDir] = useState('asc');
  const [fetched, setFetched] = useState(false);
  const [alertFilter, setAlertFilter] = useState('all'); // 'all' | 'red' | 'yellow'
  const [jsonOrder, setJsonOrder] = useState(null);

  const fetchOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      // Query RFMS with a broad order date range (past 2 years to catch all relevant orders)
      // Then filter client-side by install/delivery date
      const broadFrom = format(subMonths(today, 24), 'yyyy-MM-dd');
      const [bfy, bfm, bfd] = broadFrom.split('-');
      const [ty, tm, td] = dateTo.split('-');
      const rfmsFrom = `${bfm}-${bfd}-${bfy}`;
      const rfmsTo = `${tm}-${td}-${ty}`;

      const res = await base44.functions.invoke('getRFMSOrders', {
        orderDateFrom: rfmsFrom,
        orderDateTo: rfmsTo
      });

      // This was `res.data.orders` with no guard — the only RFMS consumer in the
      // app without one. Two separate wrong outcomes:
      //  * RFMS not configured -> rfmsQuery returns 200 { stub: true }, so
      //    `orders` became [] and the page showed "0 Orders" and a Total Balance
      //    Due of $0.00 — a cash-flow projection of zero, indistinguishable from
      //    a real one, for an ERP that was never queried.
      //  * RFMS errors -> data is null and `res.data.orders` threw, putting a raw
      //    "Cannot read properties of null" into the page's error banner.
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      const notSent = invokeNotSent(res);
      if (notSent) {
        setError(`RFMS was not queried — ${notSent}. These figures would not be real, so nothing is shown.`);
        setOrders([]);
        setFetched(false);
        return;
      }

      setOrders(res.data?.orders || []);
      setFetched(true);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        setError('Too many requests — please wait a moment and try again.');
      } else {
        setError(msg || 'Failed to fetch orders');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const todayStr = format(today, 'yyyy-MM-dd');
  const in3DaysStr = format(new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');

  // Deduplicate: remove rows with same customer name AND same invoice total
  const deduplicatedOrders = orders.filter((order, index, arr) => {
    const name = order.customer
      ? order.customer.lastName
      : `${order.customerFirst || ''} ${order.customerLast || ''}`.trim();
    const total = order.grandTotal || order.orderTotal || 0;
    return arr.findIndex(o => {
      const oName = o.customer
        ? o.customer.lastName
        : `${o.customerFirst || ''} ${o.customerLast || ''}`.trim();
      const oTotal = o.grandTotal || o.orderTotal || 0;
      return oName === name && oTotal === total;
    }) === index;
  });

  const filteredOrders = deduplicatedOrders.filter(o => {
    const installDate = o.deliveryDate || o.estimatedDeliveryDate;
    if (!installDate || installDate < dateFrom || installDate > dateTo) return false;
    if (o.customer?.customerType === 'CANCELED ORDER') return false;
    if (alertFilter === 'red') {
      const installDateStr = o.deliveryDate || o.estimatedDeliveryDate;
      return o.balanceDue > 0 && installDateStr && installDateStr < todayStr;
    }
    if (alertFilter === 'yellow') {
      const installDateStr = o.deliveryDate || o.estimatedDeliveryDate;
      return o.balanceDue > 0 && installDateStr && installDateStr >= todayStr && installDateStr <= in3DaysStr;
    }
    return true;
  });

  const sorted = [...filteredOrders].sort((a, b) => {
    let aVal = sortField === 'deliveryDate'
      ? (a.deliveryDate || a.estimatedDeliveryDate)
      : a[sortField];
    let bVal = sortField === 'deliveryDate'
      ? (b.deliveryDate || b.estimatedDeliveryDate)
      : b[sortField];
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    if (typeof aVal === 'number') return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    return sortDir === 'asc'
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  });

  const totalRevenue = filteredOrders.reduce((sum, o) => sum + (o.grandTotal || o.orderTotal || 0), 0);
  const totalBalanceDue = filteredOrders.reduce((sum, o) => sum + (o.balanceDue || 0), 0);
  const totalPaid = filteredOrders.reduce((sum, o) => sum + (o.paid || 0), 0);

  const SortHeader = ({ field, label }) => (
    <th
      className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none whitespace-nowrap"
      onClick={() => handleSort(field)}
    >
      {label}
      {sortField === field && (
        <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
      )}
    </th>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Cash Flow Projection</h1>
          <p className="text-muted-foreground mt-1">Showing orders with install dates in the selected range</p>

          {/* Preset buttons */}
          <div className="flex flex-wrap gap-2 mt-5">
            {DATE_PRESETS.map(preset => (
              <button
                key={preset.label}
                onClick={() => {
                  setDateFrom(preset.from());
                  setDateTo(preset.to());
                  setActivePreset(preset.label);
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  activePreset === preset.label
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-primary'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-4 mt-4 flex-wrap">
            <div className="space-y-1">
              <Label className="text-foreground">Install Date From</Label>
              <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setActivePreset(null); }} className="w-full sm:w-44" />
            </div>
            <div className="space-y-1">
              <Label className="text-foreground">Install Date To</Label>
              <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setActivePreset(null); }} className="w-full sm:w-44" />
            </div>
            <Button onClick={fetchOrders} disabled={loading} className="bg-primary text-primary-foreground hover:opacity-90 h-9">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading...</> : <><RefreshCw className="w-4 h-4 mr-2" />Fetch Orders</>}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-crit/12 border border-crit/25 flex items-center gap-3 text-crit">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {fetched && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <div className="bg-card rounded-xl border border-border p-5 flex items-center gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Revenue</p>
                  <p className="text-2xl font-bold text-foreground">{formatCurrency(totalRevenue)}</p>
                </div>
              </div>
              <div className="bg-card rounded-xl border border-border p-5 flex items-center gap-4">
                <div className="w-12 h-12 bg-good/12 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-good" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Collected</p>
                  <p className="text-2xl font-bold text-good">{formatCurrency(totalPaid)}</p>
                </div>
              </div>
              <div className="bg-card rounded-xl border border-border p-5 flex items-center gap-4">
                <div className="w-12 h-12 bg-warn/12 rounded-xl flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-warn" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Balance Due</p>
                  <p className="text-2xl font-bold text-warn">{formatCurrency(totalBalanceDue)}</p>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="font-semibold text-foreground">
                    {filteredOrders.length} Orders
                    {alertFilter !== 'all' && orders.length !== filteredOrders.length && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">({orders.length} total)</span>
                    )}
                  </h2>
                  <div className="flex gap-1.5">
                    <button onClick={() => setAlertFilter('all')} className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${alertFilter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:border-muted-foreground'}`}>All</button>
                    <button onClick={() => setAlertFilter('red')} className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${alertFilter === 'red' ? 'bg-destructive text-destructive-foreground border-destructive' : 'bg-crit/12 text-crit border-crit/25 hover:border-crit'}`}>🔴 Past Due</button>
                    <button onClick={() => setAlertFilter('yellow')} className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${alertFilter === 'yellow' ? 'bg-warn text-white border-warn' : 'bg-warn/12 text-warn border-warn/25 hover:border-warn'}`}>🟡 Due Soon</button>
                  </div>
                </div>

              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted border-b border-border">
                    <tr>
                      <SortHeader field="documentNumber" label="Invoice #" />
                      <SortHeader field="customerLast" label="Customer" />
                      <SortHeader field="orderDate" label="Date Sold" />
                      <SortHeader field="deliveryDate" label="Install Date" />
                      <SortHeader field="status" label="Status" />
                      <SortHeader field="salesperson1" label="Salesperson" />
                      <SortHeader field="grandTotal" label="Order Total" />
                      <SortHeader field="balanceDue" label="Balance Due" />
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Collected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sorted.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No orders found for this date range</td>
                      </tr>
                    ) : sorted.map((order) => {
                      const collected = order.paid != null ? order.paid : ((order.grandTotal || order.orderTotal || 0) - (order.balanceDue || 0));
                      const installDateStr = order.deliveryDate || order.estimatedDeliveryDate;
                      const isPastDueBalance = order.balanceDue > 0 && installDateStr && installDateStr < todayStr;
                      const isUpcomingBalance = !isPastDueBalance && order.balanceDue > 0 && installDateStr && installDateStr >= todayStr && installDateStr <= in3DaysStr;
                      return (
                        <tr key={order.documentNumber + (order.id || order.databaseId)} className={isPastDueBalance ? 'bg-crit/12 hover:bg-crit/12 dark:hover:bg-crit/20 transition-colors' : isUpcomingBalance ? 'bg-warn/12 hover:bg-warn/12 dark:hover:bg-warn/20 transition-colors' : 'hover:bg-secondary transition-colors'}>
                         <td className="px-4 py-3 text-sm font-mono font-medium text-primary">
                           <div className="flex items-center gap-1.5">
                             {order.documentNumber}
                             <button onClick={() => setJsonOrder(order)} className="text-muted-foreground hover:text-primary transition-colors" title="View raw JSON">
                               <Code className="w-3.5 h-3.5" />
                             </button>
                           </div>
                         </td>
                          <td className="px-4 py-3 text-sm text-foreground font-medium">
                            {order.customer
                              ? order.customer.lastName
                              : `${order.customerFirst || ''} ${order.customerLast || ''}`.trim()}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{formatDate(order.orderDate || order.dateEntered)}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{formatDate(order.deliveryDate || order.estimatedDeliveryDate)}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={`text-xs ${STATUS_COLORS[order.invoiceType] || STATUS_COLORS[order.status] || 'bg-secondary text-secondary-foreground border-border'}`}>
                              {order.invoiceType || order.status || '—'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{order.salesperson1 || '—'}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-foreground">{formatCurrency(order.grandTotal || order.orderTotal)}</td>
                          <td className="px-4 py-3 text-sm font-semibold">
                            <span className={order.balanceDue > 0 ? 'text-warn' : 'text-muted-foreground'}>
                              {formatCurrency(order.balanceDue)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-good">{formatCurrency(order.paid || collected)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {sorted.length > 0 && (
                    <tfoot className="bg-muted border-t-2 border-border">
                      <tr>
                        <td colSpan={6} className="px-4 py-3 text-sm font-bold text-foreground">Totals ({filteredOrders.length} orders)</td>
                        <td className="px-4 py-3 text-sm font-bold text-foreground">{formatCurrency(totalRevenue)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-warn">{formatCurrency(totalBalanceDue)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-good">{formatCurrency(totalPaid)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        )}

        {!fetched && !loading && (
          <div className="text-center py-24 text-muted-foreground">
            <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>Select a date range and click "Fetch Orders" to load cash flow data</p>
          </div>
        )}
      </div>

      {/* JSON Viewer Modal */}
      <Dialog open={!!jsonOrder} onOpenChange={() => setJsonOrder(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Raw RFMS Data — {jsonOrder?.documentNumber}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <pre className="bg-slate-900 text-good text-xs rounded-lg p-4 whitespace-pre-wrap break-all">
              {JSON.stringify(jsonOrder, null, 2)}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}