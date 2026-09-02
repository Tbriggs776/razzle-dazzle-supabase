import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Loader2, Search, AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { format, startOfMonth, startOfYear, subDays, subMonths, endOfMonth } from 'date-fns';

const DATE_PRESETS = [
  { label: 'MTD', from: () => format(startOfMonth(new Date()), 'yyyy-MM-dd'), to: () => format(new Date(), 'yyyy-MM-dd') },
  { label: 'Last Month', from: () => format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'), to: () => format(endOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd') },
  { label: 'YTD', from: () => format(startOfYear(new Date()), 'yyyy-MM-dd'), to: () => format(new Date(), 'yyyy-MM-dd') },
  { label: 'Last 90d', from: () => format(subDays(new Date(), 90), 'yyyy-MM-dd'), to: () => format(new Date(), 'yyyy-MM-dd') },
];

function toRFMSDate(isoDate) {
  if (!isoDate) return undefined;
  const [y, m, d] = isoDate.split('-');
  return `${m}-${d}-${y}`;
}

function formatCurrency(val) {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

function exportCSV(rows) {
  const headers = ['Invoice #', 'Customer (DB)', 'Sale Date', 'DB Contract Amount', 'RFMS Grand Total', 'Difference', 'Status'];
  const data = rows.map(r => [
    r.invoice_number,
    r.customerName,
    r.sale_date ? r.sale_date.slice(0, 10) : '',
    r.dbAmount ?? '',
    r.rfmsTotal ?? '',
    r.diff != null ? r.diff.toFixed(2) : '',
    r.status,
  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`));
  const csv = [headers.join(','), ...data.map(d => d.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `contract-discrepancy-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ContractDiscrepancyReport() {
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [activePreset, setActivePreset] = useState('MTD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'discrepancy' | 'match' | 'missing'

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      // 1. Fetch RFMS orders for the date range (retry on 429)
      let rfmsRes;
      let attempts = 0;
      while (attempts < 4) {
        try {
          rfmsRes = await base44.functions.invoke('getRFMSOrders', {
            orderDateFrom: toRFMSDate(dateFrom),
            orderDateTo: toRFMSDate(dateTo),
          });
          break;
        } catch (err) {
          if (err?.response?.status === 429 || err?.message?.includes('429') || err?.message?.includes('Rate limit')) {
            attempts++;
            if (attempts >= 4) throw new Error('Rate limit hit — too many requests in flight. Please wait a few seconds and try again.');
            await new Promise(r => setTimeout(r, 1500 * attempts));
          } else {
            throw err;
          }
        }
      }
      const rfmsOrders = rfmsRes.data?.orders || [];

      // Build a map: invoice# → rfms order
      const rfmsMap = {};
      rfmsOrders.forEach(o => {
        if (o.documentNumber) rfmsMap[String(o.documentNumber)] = o;
      });

      // 2. Fetch all Sales from our DB that have invoice_number set, within date range
      const allSales = await base44.entities.Sale.list('-sale_date', 500);
      const salesInRange = allSales.filter(s => {
        if (!s.invoice_number) return false;
        const saleDate = s.sale_date ? s.sale_date.slice(0, 10) : '';
        return saleDate >= dateFrom && saleDate <= dateTo;
      });

      // Fetch customers for name display
      const customerIds = [...new Set(salesInRange.map(s => s.customer).filter(Boolean))];
      let customerMap = {};
      if (customerIds.length) {
        const customers = await base44.entities.Customer.list();
        customers.forEach(c => { customerMap[c.id] = c; });
      }

      // 3. Build comparison rows
      const result = salesInRange.map(sale => {
        const rfmsOrder = rfmsMap[String(sale.invoice_number)];
        const customer = customerMap[sale.customer];
        const customerName = customer ? `${customer.last_name}, ${customer.first_name}` : '—';
        const dbAmount = sale.sale_amount ?? null;
        const rfmsTotal = rfmsOrder ? (rfmsOrder.grandTotal ?? rfmsOrder.orderTotal ?? null) : null;

        let status, diff;
        if (!rfmsOrder) {
          status = 'not_in_rfms';
          diff = null;
        } else if (dbAmount == null) {
          status = 'no_db_amount';
          diff = null;
        } else {
          diff = parseFloat((dbAmount - rfmsTotal).toFixed(2));
          status = Math.abs(diff) < 0.5 ? 'match' : 'discrepancy';
        }

        return {
          id: sale.id,
          invoice_number: sale.invoice_number,
          customerName,
          sale_date: sale.sale_date,
          dbAmount,
          rfmsTotal,
          diff,
          status,
          rfmsOrder,
        };
      });

      // Also find RFMS orders that have no matching sale in our DB (within range)
      const dbInvoiceNums = new Set(salesInRange.map(s => String(s.invoice_number)));
      rfmsOrders.forEach(o => {
        if (o.documentNumber && !dbInvoiceNums.has(String(o.documentNumber))) {
          result.push({
            id: null,
            invoice_number: o.documentNumber,
            customerName: o.customer ? `${o.customer.lastName || ''}`.trim() || '—' : `${o.customerLast || ''}`.trim() || '—',
            sale_date: o.orderDate || null,
            dbAmount: null,
            rfmsTotal: o.grandTotal ?? o.orderTotal ?? null,
            diff: null,
            status: 'not_in_db',
            rfmsOrder: o,
          });
        }
      });

      setRows(result);
    } catch (e) {
      setError(e.message || 'Failed to run report');
    } finally {
      setLoading(false);
    }
  };

  const filtered = rows
    ? rows.filter(r => {
        if (filter === 'discrepancy') return r.status === 'discrepancy';
        if (filter === 'match') return r.status === 'match';
        if (filter === 'missing') return r.status === 'not_in_rfms' || r.status === 'not_in_db' || r.status === 'no_db_amount';
        return true;
      })
    : [];

  const counts = rows ? {
    discrepancy: rows.filter(r => r.status === 'discrepancy').length,
    match: rows.filter(r => r.status === 'match').length,
    missing: rows.filter(r => ['not_in_rfms', 'not_in_db', 'no_db_amount'].includes(r.status)).length,
  } : null;

  const totalDiff = rows ? rows.filter(r => r.diff != null).reduce((s, r) => s + r.diff, 0) : 0;

  return (
    <div>
      {/* Controls */}
      <div className="bg-white rounded-2xl border border-border p-6 mb-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Date Range (Sale Date)</h2>
        <div className="flex gap-2 flex-wrap mb-4">
          {DATE_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => { setActivePreset(p.label); setDateFrom(p.from()); setDateTo(p.to()); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                activePreset === p.label
                  ? 'bg-info text-white border-info'
                  : 'bg-white text-muted-foreground border-border hover:border-info/25'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setActivePreset('custom'); }} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setActivePreset('custom'); }} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleRun} disabled={loading} className="bg-info hover:bg-info gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Run Report
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-crit/12 border border-crit/25 rounded-xl p-4 mb-6 text-crit text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {rows && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Compared</p>
              <p className="text-2xl font-bold text-foreground">{rows.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-crit/25 p-4">
              <p className="text-xs text-crit mb-1">Discrepancies</p>
              <p className="text-2xl font-bold text-crit">{counts.discrepancy}</p>
            </div>
            <div className="bg-white rounded-xl border border-good/25 p-4">
              <p className="text-xs text-good mb-1">Matching</p>
              <p className="text-2xl font-bold text-good">{counts.match}</p>
            </div>
            <div className="bg-white rounded-xl border border-warn/25 p-4">
              <p className="text-xs text-warn mb-1">Net Variance</p>
              <p className={`text-2xl font-bold ${Math.abs(totalDiff) > 0.5 ? 'text-crit' : 'text-muted-foreground'}`}>
                {formatCurrency(totalDiff)}
              </p>
            </div>
          </div>

          {/* Filters + Table */}
          <div className="bg-white rounded-2xl border border-border">
            <div className="px-6 py-4 border-b border-border flex items-center gap-3 flex-wrap">
              <div className="flex gap-1.5 flex-1">
                {[
                  { key: 'all', label: `All (${rows.length})` },
                  { key: 'discrepancy', label: `🔴 Discrepancies (${counts.discrepancy})` },
                  { key: 'match', label: `✅ Matching (${counts.match})` },
                  { key: 'missing', label: `⚠️ Missing/Unknown (${counts.missing})` },
                ].map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      filter === f.key
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-white text-muted-foreground border-border hover:border-border'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleRun} disabled={loading} className="gap-1">
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportCSV(filtered)} className="gap-1">
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    {['Invoice #', 'Customer', 'Sale Date', 'DB Contract $', 'RFMS Total $', 'Difference', 'Status'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-muted-foreground">No records match this filter</td>
                    </tr>
                  ) : filtered.map((row, i) => (
                    <tr
                      key={i}
                      className={
                        row.status === 'discrepancy' ? 'bg-crit/12 hover:bg-crit/12 transition-colors' :
                        row.status === 'match' ? 'hover:bg-muted transition-colors' :
                        'bg-warn/12 hover:bg-warn/12 transition-colors'
                      }
                    >
                      <td className="px-4 py-3 font-mono text-xs text-info whitespace-nowrap">{row.invoice_number || '—'}</td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">{row.customerName}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{row.sale_date ? row.sale_date.slice(0, 10) : '—'}</td>
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{formatCurrency(row.dbAmount)}</td>
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{formatCurrency(row.rfmsTotal)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.diff != null ? (
                          <span className={`font-semibold ${Math.abs(row.diff) < 0.5 ? 'text-muted-foreground' : row.diff > 0 ? 'text-crit' : 'text-warn'}`}>
                            {row.diff > 0 ? '+' : ''}{formatCurrency(row.diff)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!rows && !loading && (
        <div className="text-center py-16 text-muted-foreground">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p>Select a date range and run the report to compare contract amounts against RFMS</p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    match:        { label: 'Match', cls: 'bg-good/12 text-good border-good/25' },
    discrepancy:  { label: 'Discrepancy', cls: 'bg-crit/12 text-crit border-crit/25' },
    not_in_rfms:  { label: 'Not in RFMS', cls: 'bg-warn/12 text-warn border-warn/25' },
    not_in_db:    { label: 'Not in Razzle', cls: 'bg-purple-100 text-purple-700 border-purple-200' },
    no_db_amount: { label: 'No Contract $', cls: 'bg-muted text-muted-foreground border-border' },
  };
  const { label, cls } = map[status] || { label: status, cls: 'bg-muted text-muted-foreground border-border' };
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
}