import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, Search, Loader2 } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, subMonths, subQuarters, startOfYear } from 'date-fns';
import PageHeader from '@/components/common/PageHeader';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import WorkRow from '@/components/dashboard/WorkRow';

const DATE_PRESETS = [
  { value: 'mtd', label: 'Month to Date' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'qtd', label: 'This Quarter' },
  { value: 'last_quarter', label: 'Last Quarter' },
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'all', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

function getDateRange(preset) {
  const now = new Date();
  switch (preset) {
    case 'mtd': return { start: startOfMonth(now), end: now };
    case 'last_month': return { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) };
    case 'last_3_months': return { start: startOfMonth(subMonths(now, 3)), end: now };
    case 'qtd': return { start: startOfQuarter(now), end: now };
    case 'last_quarter': return { start: startOfQuarter(subQuarters(now, 1)), end: endOfQuarter(subQuarters(now, 1)) };
    case 'ytd': return { start: startOfYear(now), end: now };
    case 'all': return null;
    default: return null;
  }
}

const money = (n) => '$' + Math.round(n || 0).toLocaleString();

export default function MySales() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDcId, setSelectedDcId] = useState('');
  const [datePreset, setDatePreset] = useState('mtd');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    retry: false,
  });

  const isAdmin = currentUser?.role === 'admin';

  const { data: allTeamMembers = [] } = useQuery({
    queryKey: ['teamMembersAll'],
    queryFn: () => base44.entities.TeamMember.list(),
    enabled: !!currentUser,
  });

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['mySalesWithData', currentUser?.email, isAdmin],
    queryFn: async () => {
      if (!currentUser?.email) return { sales: [], customers: [] };

      if (isAdmin) {
        const [sales, customers] = await Promise.all([
          base44.entities.Sale.list('-sale_date', 500),
          base44.entities.Customer.list(),
        ]);
        return { sales, customers };
      }

      const teamMembers = await base44.entities.TeamMember.filter({ email: currentUser.email });
      if (!teamMembers.length) return { sales: [], customers: [] };

      const teamMemberId = teamMembers[0].id;
      const sales = await base44.entities.Sale.filter({ assigned_dc: teamMemberId });
      const customers = sales.length > 0 ? await base44.entities.Customer.list() : [];

      return { sales, customers };
    },
    enabled: !!currentUser?.email,
    staleTime: 30000,
  });

  const sales = salesData?.sales || [];
  const customers = salesData?.customers || [];

  const designConsultants = allTeamMembers
    .filter((tm) => tm.role === 'Design Consultant' || tm.role === 'Sales Manager')
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));

  const getCustomer = (customerId) => customers.find((c) => c.id === customerId);
  const getDC = (dcId) => allTeamMembers.find((tm) => tm.id === dcId);

  const activeDateRange = datePreset === 'custom'
    ? (customStart && customEnd ? { start: new Date(customStart), end: new Date(customEnd + 'T23:59:59') } : null)
    : getDateRange(datePreset);

  const filteredSales = sales
    .filter((sale) => {
      if (sale.is_cancelled) return false;
      if (isAdmin && selectedDcId && sale.assigned_dc !== selectedDcId) return false;
      if (activeDateRange && sale.sale_date) {
        const saleDate = new Date(sale.sale_date);
        if (saleDate < activeDateRange.start || saleDate > activeDateRange.end) return false;
      }
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      const customer = getCustomer(sale.customer);
      return (
        customer?.first_name?.toLowerCase().includes(query) ||
        customer?.last_name?.toLowerCase().includes(query) ||
        `${customer?.first_name} ${customer?.last_name}`.toLowerCase().includes(query) ||
        sale.location_address?.toLowerCase().includes(query) ||
        sale.invoice_number?.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date));

  const totalRevenue = filteredSales.reduce((sum, s) => sum + (s.sale_amount || 0), 0);
  const salesWithAmount = filteredSales.filter((s) => s.sale_amount);
  const avgSale = salesWithAmount.length > 0 ? totalRevenue / salesWithAmount.length : 0;

  // Trend sparklines from the filtered set (chronological buckets).
  const spark = useMemo(() => {
    const asc = filteredSales
      .filter((s) => s.sale_date)
      .slice()
      .sort((a, b) => new Date(a.sale_date) - new Date(b.sale_date));
    if (asc.length < 2) return { rev: [], count: [] };
    const n = Math.min(8, asc.length);
    const size = Math.ceil(asc.length / n);
    const rev = [];
    const count = [];
    for (let i = 0; i < asc.length; i += size) {
      const chunk = asc.slice(i, i + size);
      rev.push(chunk.reduce((s, x) => s + (x.sale_amount || 0), 0));
      count.push(chunk.length);
    }
    return { rev, count };
  }, [filteredSales]);

  if (userLoading || salesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const rangeLabel = DATE_PRESETS.find((p) => p.value === datePreset)?.label || 'All Time';

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Sales"
          title="My Sales"
          subtitle={isAdmin ? 'All closed sales across the team.' : 'Your closed sales and revenue.'}
          actions={
            <>
              {isAdmin && (
                <Select value={selectedDcId || 'all'} onValueChange={(v) => setSelectedDcId(v === 'all' ? '' : v)}>
                  <SelectTrigger className="h-9 w-48 bg-card">
                    <SelectValue placeholder="All Consultants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Consultants</SelectItem>
                    {designConsultants.map((dc) => (
                      <SelectItem key={dc.id} value={dc.id}>
                        {dc.first_name} {dc.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={datePreset} onValueChange={setDatePreset}>
                <SelectTrigger className="h-9 w-44 bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          }
        />

        {datePreset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile label="Total Sales" value={filteredSales.length} foot={`Closed · ${rangeLabel}`} spark={spark.count} />
          <KpiTile label="Total Revenue" value={money(totalRevenue)} hero foot={`${salesWithAmount.length} with an amount`} spark={spark.rev} />
          <KpiTile label="Avg Sale" value={money(avgSale)} foot="Per closed job with an amount" />
        </div>

        <ModuleCard
          title="Closed Sales"
          subtitle={`${filteredSales.length} ${filteredSales.length === 1 ? 'sale' : 'sales'} · ${rangeLabel}`}
          icon={DollarSign}
          action={
            <div className="relative w-52">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search customer, address…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 border-border bg-card pl-9"
              />
            </div>
          }
        >
          {filteredSales.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <DollarSign className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <h3 className="text-sm font-semibold text-foreground">
                {searchQuery || selectedDcId ? 'No matching sales' : 'No sales yet'}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {searchQuery || selectedDcId ? 'Try adjusting your filters.' : 'Your closed sales will appear here.'}
              </p>
            </div>
          ) : (
            filteredSales.map((sale) => {
              const customer = getCustomer(sale.customer);
              const dc = isAdmin ? getDC(sale.assigned_dc) : null;
              const meta = [
                sale.sale_date && format(new Date(sale.sale_date), 'MMM d, yyyy'),
                sale.location_address,
                sale.invoice_number && `Inv #${sale.invoice_number}`,
                dc && `${dc.first_name} ${dc.last_name}`,
                sale.deposit_amount && `Deposit ${money(sale.deposit_amount)}`,
              ].filter(Boolean).join('  ·  ');
              return (
                <WorkRow
                  key={sale.id}
                  lead={sale.sale_amount ? money(sale.sale_amount) : '—'}
                  primary={customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown Customer'}
                  meta={meta}
                  status={sale.deposit_payment_method || 'Sold'}
                  tone={sale.deposit_payment_method ? 'neutral' : 'good'}
                />
              );
            })
          )}
        </ModuleCard>
      </div>
    </div>
  );
}
