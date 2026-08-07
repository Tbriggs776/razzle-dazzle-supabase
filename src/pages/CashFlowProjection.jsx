import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RefreshCw, DollarSign, TrendingUp, AlertCircle, Code } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, startOfYear, subMonths } from 'date-fns';

const STATUS_COLORS = {
  'Job Costed': 'bg-green-100 text-green-700 border-green-200',
  'Cancelled': 'bg-red-100 text-red-700 border-red-200',
  'On Order': 'bg-amber-100 text-amber-700 border-amber-200',
  'Scheduled': 'bg-blue-100 text-blue-700 border-blue-200',
  'In Progress': 'bg-purple-100 text-purple-700 border-purple-200',
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

      setOrders(res.data.orders || []);
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
      className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-800 select-none whitespace-nowrap"
      onClick={() => handleSort(field)}
    >
      {label}
      {sortField === field && (
        <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
      )}
    </th>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Cash Flow Projection</h1>
          <p className="text-slate-500 mt-1">Showing orders with install dates in the selected range</p>

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
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-4 mt-4 flex-wrap">
            <div className="space-y-1">
              <Label className="text-slate-700">Install Date From</Label>
              <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setActivePreset(null); }} className="w-44" />
            </div>
            <div className="space-y-1">
              <Label className="text-slate-700">Install Date To</Label>
              <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setActivePreset(null); }} className="w-44" />
            </div>
            <Button onClick={fetchOrders} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 h-9">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading...</> : <><RefreshCw className="w-4 h-4 mr-2" />Fetch Orders</>}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-3 text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {fetched && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Total Revenue</p>
                  <p className="text-2xl font-bold text-slate-800">{formatCurrency(totalRevenue)}</p>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Total Collected</p>
                  <p className="text-2xl font-bold text-green-700">{formatCurrency(totalPaid)}</p>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Total Balance Due</p>
                  <p className="text-2xl font-bold text-amber-700">{formatCurrency(totalBalanceDue)}</p>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="font-semibold text-slate-800">
                    {filteredOrders.length} Orders
                    {alertFilter !== 'all' && orders.length !== filteredOrders.length && (
                      <span className="ml-2 text-xs font-normal text-slate-400">({orders.length} total)</span>
                    )}
                  </h2>
                  <div className="flex gap-1.5">
                    <button onClick={() => setAlertFilter('all')} className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${alertFilter === 'all' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>All</button>
                    <button onClick={() => setAlertFilter('red')} className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${alertFilter === 'red' ? 'bg-red-600 text-white border-red-600' : 'bg-red-50 text-red-700 border-red-200 hover:border-red-400'}`}>🔴 Past Due</button>
                    <button onClick={() => setAlertFilter('yellow')} className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${alertFilter === 'yellow' ? 'bg-yellow-500 text-white border-yellow-500' : 'bg-yellow-50 text-yellow-700 border-yellow-200 hover:border-yellow-400'}`}>🟡 Due Soon</button>
                  </div>
                </div>

              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <SortHeader field="documentNumber" label="Invoice #" />
                      <SortHeader field="customerLast" label="Customer" />
                      <SortHeader field="orderDate" label="Date Sold" />
                      <SortHeader field="deliveryDate" label="Install Date" />
                      <SortHeader field="status" label="Status" />
                      <SortHeader field="salesperson1" label="Salesperson" />
                      <SortHeader field="grandTotal" label="Order Total" />
                      <SortHeader field="balanceDue" label="Balance Due" />
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Collected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sorted.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-slate-400">No orders found for this date range</td>
                      </tr>
                    ) : sorted.map((order) => {
                      const collected = order.paid != null ? order.paid : ((order.grandTotal || order.orderTotal || 0) - (order.balanceDue || 0));
                      const installDateStr = order.deliveryDate || order.estimatedDeliveryDate;
                      const isPastDueBalance = order.balanceDue > 0 && installDateStr && installDateStr < todayStr;
                      const isUpcomingBalance = !isPastDueBalance && order.balanceDue > 0 && installDateStr && installDateStr >= todayStr && installDateStr <= in3DaysStr;
                      return (
                        <tr key={order.documentNumber + (order.id || order.databaseId)} className={isPastDueBalance ? 'bg-red-50 hover:bg-red-100 transition-colors' : isUpcomingBalance ? 'bg-yellow-50 hover:bg-yellow-100 transition-colors' : 'hover:bg-slate-50 transition-colors'}>
                         <td className="px-4 py-3 text-sm font-mono font-medium text-indigo-700">
                           <div className="flex items-center gap-1.5">
                             {order.documentNumber}
                             <button onClick={() => setJsonOrder(order)} className="text-slate-400 hover:text-indigo-600 transition-colors" title="View raw JSON">
                               <Code className="w-3.5 h-3.5" />
                             </button>
                           </div>
                         </td>
                          <td className="px-4 py-3 text-sm text-slate-800 font-medium">
                            {order.customer
                              ? order.customer.lastName
                              : `${order.customerFirst || ''} ${order.customerLast || ''}`.trim()}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{formatDate(order.orderDate || order.dateEntered)}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{formatDate(order.deliveryDate || order.estimatedDeliveryDate)}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={`text-xs ${STATUS_COLORS[order.invoiceType] || STATUS_COLORS[order.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                              {order.invoiceType || order.status || '—'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{order.salesperson1 || '—'}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-slate-800">{formatCurrency(order.grandTotal || order.orderTotal)}</td>
                          <td className="px-4 py-3 text-sm font-semibold">
                            <span className={order.balanceDue > 0 ? 'text-amber-700' : 'text-slate-500'}>
                              {formatCurrency(order.balanceDue)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-green-700">{formatCurrency(order.paid || collected)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {sorted.length > 0 && (
                    <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                      <tr>
                        <td colSpan={6} className="px-4 py-3 text-sm font-bold text-slate-700">Totals ({filteredOrders.length} orders)</td>
                        <td className="px-4 py-3 text-sm font-bold text-slate-800">{formatCurrency(totalRevenue)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-amber-700">{formatCurrency(totalBalanceDue)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-green-700">{formatCurrency(totalPaid)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        )}

        {!fetched && !loading && (
          <div className="text-center py-24 text-slate-400">
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
            <pre className="bg-slate-900 text-green-300 text-xs rounded-lg p-4 whitespace-pre-wrap break-all">
              {JSON.stringify(jsonOrder, null, 2)}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}