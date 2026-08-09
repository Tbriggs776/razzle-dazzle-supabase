import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Loader2, Users, RefreshCw, Download, ShoppingCart, GitMerge } from 'lucide-react';
import { motion } from 'framer-motion';
import { format, startOfMonth, startOfYear, subDays } from 'date-fns';
import ContractDiscrepancyReport from '@/components/rfms/ContractDiscrepancyReport';

function parseCustomerName(lastName, firstName) {
  // RFMS stores names as "LAST, FIRST" in the lastName field
  if (firstName) return { first: firstName, last: lastName };
  if (lastName && lastName.includes(',')) {
    const [last, first] = lastName.split(',').map(s => s.trim());
    return { first: first || '', last };
  }
  return { first: '', last: lastName || '' };
}

function formatPhone(phone) {
  if (!phone || phone === '0000000000') return '';
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return phone;
}

function exportCSV(orders) {
  const headers = ['Doc #', 'Order Date', 'First Name', 'Last Name', 'Phone', 'Email', 'Address', 'City', 'State', 'Zip', 'Salesperson', 'Total', 'Paid', 'Balance Due'];
  const rows = orders.map(order => {
    const c = order.customer || {};
    const { first, last } = parseCustomerName(c.lastName, c.firstName);
    return [
      order.documentNumber || '',
      order.orderDate || '',
      first,
      last,
      formatPhone(c.phone1),
      c.email || '',
      c.address1 || '',
      c.city || '',
      c.state || '',
      c.postalCode || '',
      order.salesperson1 || '',
      order.grandTotal || 0,
      order.paid || 0,
      order.balanceDue || 0,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`);
  });
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rfms-orders-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const DATE_PRESETS = [
  { label: 'MTD', getRange: () => ({ from: format(startOfMonth(new Date()), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
  { label: 'YTD', getRange: () => ({ from: format(startOfYear(new Date()), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
  { label: 'Last 30d', getRange: () => ({ from: format(subDays(new Date(), 30), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
  { label: 'Last 90d', getRange: () => ({ from: format(subDays(new Date(), 90), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
  { label: 'Last 12mo', getRange: () => ({ from: format(subDays(new Date(), 365), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
];

// Format date from yyyy-MM-dd to MM-DD-YYYY for RFMS API
function toRFMSDate(isoDate) {
  if (!isoDate) return undefined;
  const [y, m, d] = isoDate.split('-');
  return `${m}-${d}-${y}`;
}

export default function RFMSCustomers() {
  const [activeTab, setActiveTab] = useState('customers');

  // Customers tab state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchText, setSearchText] = useState('');
  const [salespersonName, setSalespersonName] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  // Orders tab state
  const [ordersDateFrom, setOrdersDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [ordersDateTo, setOrdersDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [ordersPreset, setOrdersPreset] = useState('MTD');
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersResults, setOrdersResults] = useState(null);
  const [ordersError, setOrdersError] = useState(null);
  const [onHoldMap, setOnHoldMap] = useState({});
  const [checkingOnHold, setCheckingOnHold] = useState(false);
  const [onHoldProgress, setOnHoldProgress] = useState({ checked: 0, total: 0 });
  const [loadingCached, setLoadingCached] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const { data: res } = await base44.functions.invoke('getRFMSCustomers', {
        dateCreatedFrom: dateFrom || undefined,
        dateCreatedTo: dateTo || undefined,
        searchText: searchText || undefined,
        salespersonName: salespersonName || undefined,
      });
      if (res.error) {
        setError(res.error + (res.details ? `: ${res.details}` : ''));
      } else {
        setResults(res.data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOrdersPreset = (preset) => {
    setOrdersPreset(preset);
    const p = DATE_PRESETS.find(p => p.label === preset);
    if (p) {
      const { from, to } = p.getRange();
      setOrdersDateFrom(from);
      setOrdersDateTo(to);
    }
  };

  const handleOrdersSearch = async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    setOrdersResults(null);
    try {
      const { data: res } = await base44.functions.invoke('getRFMSCustomers', {
        orderDateFrom: toRFMSDate(ordersDateFrom),
        orderDateTo: toRFMSDate(ordersDateTo),
      });
      if (res.error) {
        setOrdersError(res.error + (res.details ? `: ${res.details}` : ''));
      } else {
        setOrdersResults(res.data);
      }
    } catch (err) {
      setOrdersError(err.message);
    } finally {
      setOrdersLoading(false);
    }
  };

  const orders = Array.isArray(results?.result) ? results.result : [];
  const rfmsOrders = Array.isArray(ordersResults?.result) ? ordersResults.result : [];

  // Load cached results from DB for the current order list
  const loadCachedResults = async (orders) => {
    if (!orders.length) return;
    setLoadingCached(true);
    try {
      const { data: res } = await base44.functions.invoke('getOnHoldCache', {});
      if (res.results) {
        const map = {};
        res.results.forEach(r => {
          map[r.document_number] = { docNum: r.document_number, hasOnHold: r.has_on_order, lineStatuses: r.line_statuses || [] };
        });
        setOnHoldMap(map);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingCached(false);
    }
  };

  const handleCheckOnHold = async () => {
    if (!rfmsOrders.length) return;
    setCheckingOnHold(true);
    const docNums = rfmsOrders.map(o => o.documentNumber).filter(Boolean);
    // Only process ones not yet checked
    const remaining = docNums.filter(d => !onHoldMap[d]);
    setOnHoldProgress({ checked: docNums.length - remaining.length, total: docNums.length });
    const accumulated = { ...onHoldMap };
    try {
      for (let i = 0; i < remaining.length; i++) {
        const { data: res } = await base44.functions.invoke('getRFMSOrder', { documentNumbers: [remaining[i]] });
        if (res.results) Object.assign(accumulated, res.results);
        setOnHoldMap({ ...accumulated });
        setOnHoldProgress({ checked: (docNums.length - remaining.length) + i + 1, total: docNums.length });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCheckingOnHold(false);
    }
  };

  const totalRevenue = rfmsOrders.reduce((sum, o) => sum + (o.grandTotal || 0), 0);
  const totalPaid = rfmsOrders.reduce((sum, o) => sum + (o.paid || 0), 0);
  const totalBalance = rfmsOrders.reduce((sum, o) => sum + (o.balanceDue || 0), 0);

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className="flex items-center gap-4 mb-2 flex-wrap">
            <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">RFMS Development</h1>
              <p className="text-muted-foreground mt-1">Query RFMS API data</p>
            </div>
            <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25 ml-2">Admin Only</Badge>
          </div>
        </motion.div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList className="flex-nowrap overflow-x-auto max-w-full justify-start">
            <TabsTrigger value="customers"><Users className="w-4 h-4 mr-2" />RFMS Customers</TabsTrigger>
            <TabsTrigger value="orders"><ShoppingCart className="w-4 h-4 mr-2" />RFMS Orders</TabsTrigger>
            <TabsTrigger value="discrepancy"><GitMerge className="w-4 h-4 mr-2" />Contract vs RFMS</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* ── CUSTOMERS TAB ── */}
        {activeTab === 'customers' && (
          <>
            <div className="bg-card rounded-2xl border border-border p-6 mb-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Search Parameters</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Order Date From</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Order Date To</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Search Text</label>
                  <Input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="e.g. Smith" className="text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Salesperson Name</label>
                  <Input value={salespersonName} onChange={e => setSalespersonName(e.target.value)} placeholder="e.g. Daniel Porter" className="text-sm" />
                </div>
              </div>
              <div className="mt-5 flex justify-end">
                <Button onClick={handleSearch} disabled={loading} className="bg-primary text-primary-foreground hover:opacity-90 gap-2">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Search RFMS
                </Button>
              </div>
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-700 dark:bg-red-500/15 dark:border-red-500/25 dark:text-red-300 rounded-xl p-4 mb-6 text-sm">{error}</div>}
            {results !== null && (
              <>
                <div className="bg-card rounded-2xl border border-border">
                  <div className="px-6 py-4 border-b border-border flex items-center gap-3 flex-wrap">
                    <p className="font-semibold text-foreground flex-1">Results <span className="text-muted-foreground font-normal text-sm">({orders.length} orders)</span></p>
                    <Button variant="outline" size="sm" onClick={() => exportCSV(orders)} className="gap-1"><Download className="w-3.5 h-3.5" /> Export CSV</Button>
                    <Button variant="outline" size="sm" onClick={handleSearch} disabled={loading}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh</Button>
                  </div>
                  {orders.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground"><Users className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>No orders found</p></div>
                  ) : (
                    <OrdersTable orders={orders} />
                  )}
                </div>
                <details className="mt-4">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">View raw JSON response</summary>
                  <pre className="mt-2 bg-slate-900 text-slate-100 rounded-xl p-4 text-xs overflow-auto max-h-96">{JSON.stringify(results, null, 2)}</pre>
                </details>
              </>
            )}
          </>
        )}

        {/* ── DISCREPANCY TAB ── */}
        {activeTab === 'discrepancy' && <ContractDiscrepancyReport />}

        {/* ── ORDERS TAB ── */}
        {activeTab === 'orders' && (
          <>
            <div className="bg-card rounded-2xl border border-border p-6 mb-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Date Range</h2>

              {/* Presets */}
              <div className="flex gap-2 flex-wrap mb-4">
                {DATE_PRESETS.map(p => (
                  <Button
                    key={p.label}
                    size="sm"
                    variant={ordersPreset === p.label ? 'default' : 'outline'}
                    onClick={() => handleOrdersPreset(p.label)}
                    className={ordersPreset === p.label ? 'bg-primary text-primary-foreground hover:opacity-90' : ''}
                  >
                    {p.label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant={ordersPreset === 'custom' ? 'default' : 'outline'}
                  onClick={() => setOrdersPreset('custom')}
                  className={ordersPreset === 'custom' ? 'bg-primary text-primary-foreground hover:opacity-90' : ''}
                >
                  Custom
                </Button>
              </div>

              {/* Date inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">From</label>
                  <input type="date" value={ordersDateFrom} onChange={e => { setOrdersDateFrom(e.target.value); setOrdersPreset('custom'); }} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">To</label>
                  <input type="date" value={ordersDateTo} onChange={e => { setOrdersDateTo(e.target.value); setOrdersPreset('custom'); }} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground" />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleOrdersSearch} disabled={ordersLoading} className="bg-primary text-primary-foreground hover:opacity-90 gap-2">
                  {ordersLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Fetch Orders
                </Button>
              </div>
            </div>

            {ordersError && <div className="bg-red-50 border border-red-200 text-red-700 dark:bg-red-500/15 dark:border-red-500/25 dark:text-red-300 rounded-xl p-4 mb-6 text-sm">{ordersError}</div>}

            {ordersResults !== null && (
              <>
                {/* Summary stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  {[
                    { label: 'Total Orders', value: rfmsOrders.length, color: 'text-foreground' },
                    { label: 'Total Revenue', value: `$${totalRevenue.toLocaleString()}`, color: 'text-primary' },
                    { label: 'Total Paid', value: `$${totalPaid.toLocaleString()}`, color: 'text-emerald-700 dark:text-emerald-400' },
                    { label: 'Balance Due', value: `$${totalBalance.toLocaleString()}`, color: totalBalance > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground' },
                  ].map(s => (
                    <div key={s.label} className="bg-card rounded-xl border border-border p-4">
                      <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
                      <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-card rounded-2xl border border-border">
                  <div className="px-6 py-4 border-b border-border flex items-center gap-3 flex-wrap">
                    <p className="font-semibold text-foreground flex-1">Orders <span className="text-muted-foreground font-normal text-sm">({rfmsOrders.length})</span></p>
                    <Button variant="outline" size="sm" onClick={() => loadCachedResults(rfmsOrders)} disabled={loadingCached} className="gap-1 border-border text-muted-foreground hover:bg-secondary">
                      {loadingCached ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '💾'}
                      {loadingCached ? 'Loading...' : 'Load Saved'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleCheckOnHold} disabled={checkingOnHold} className="gap-1 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10">
                      {checkingOnHold ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '📦'}
                      {checkingOnHold
                        ? `Checking... ${onHoldProgress.checked}/${onHoldProgress.total}`
                        : onHoldProgress.checked > 0 && !checkingOnHold
                          ? `Resume (${onHoldProgress.checked}/${onHoldProgress.total})`
                          : 'Check On Order'}
                    </Button>
                    {Object.keys(onHoldMap).length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => exportCSV(rfmsOrders.filter(o => onHoldMap[o.documentNumber]?.hasOnHold === true))} className="gap-1 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10">
                        <Download className="w-3.5 h-3.5" /> Export On Order
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => exportCSV(rfmsOrders)} className="gap-1"><Download className="w-3.5 h-3.5" /> Export All CSV</Button>
                    <Button variant="outline" size="sm" onClick={handleOrdersSearch} disabled={ordersLoading}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh</Button>
                  </div>
                  {rfmsOrders.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground"><ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>No orders found for this date range</p></div>
                  ) : (
                    <OrdersTable orders={rfmsOrders} onHoldMap={onHoldMap} />
                  )}
                </div>

                <details className="mt-4">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">View raw JSON response</summary>
                  <pre className="mt-2 bg-slate-900 text-slate-100 rounded-xl p-4 text-xs overflow-auto max-h-96">{JSON.stringify(ordersResults, null, 2)}</pre>
                </details>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OrdersTable({ orders, onHoldMap = {} }) {
  const hasOnHoldData = Object.keys(onHoldMap).length > 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-secondary border-b border-border">
            {['Doc #', 'Order Date', 'First Name', 'Last Name', 'Phone', 'Email', 'Address', 'City', 'State', 'Zip', 'Salesperson', 'Total', 'Paid', 'Balance', ...(hasOnHoldData ? ['On Order'] : [])].map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {orders.map((order, i) => {
            const c = order.customer || {};
            const { first, last } = parseCustomerName(c.lastName, c.firstName);
            const onHoldInfo = onHoldMap[order.documentNumber];
            const isOnHold = onHoldInfo?.hasOnHold === true;
            return (
              <tr key={i} className={`hover:bg-secondary transition-colors ${isOnHold ? 'bg-amber-50 dark:bg-amber-500/10' : ''}`}>
                <td className="px-4 py-3 text-foreground whitespace-nowrap font-mono text-xs">{order.documentNumber || '—'}</td>
                <td className="px-4 py-3 text-foreground whitespace-nowrap">{order.orderDate || '—'}</td>
                <td className="px-4 py-3 text-foreground whitespace-nowrap">{first || '—'}</td>
                <td className="px-4 py-3 text-foreground whitespace-nowrap">{last || '—'}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatPhone(c.phone1) || '—'}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap max-w-[180px] truncate">{c.email || '—'}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap max-w-[200px] truncate">{c.address1 || '—'}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{c.city || '—'}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{c.state || '—'}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{c.postalCode || '—'}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{order.salesperson1 || '—'}</td>
                <td className="px-4 py-3 text-foreground whitespace-nowrap font-medium">${(order.grandTotal || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400 whitespace-nowrap">${(order.paid || 0).toLocaleString()}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={order.balanceDue > 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground'}>
                    ${(order.balanceDue || 0).toLocaleString()}
                  </span>
                </td>
                {hasOnHoldData && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    {isOnHold ? (
                      <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-0.5 rounded-full border border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25">
                        📦 On Order
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
