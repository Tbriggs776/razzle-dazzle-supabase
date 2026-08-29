import React, { useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Input } from '@/components/ui/input';
import { Search, Loader2, DollarSign, Calendar as CalendarIcon } from 'lucide-react';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { buildCatalogCostMap, computeCatalogGP } from '@/lib/catalogCost';
import PageHeader from '@/components/common/PageHeader';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import WorkRow from '@/components/dashboard/WorkRow';

const money = (n) =>
  '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Sales() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ['sales'],
    queryFn: () => base44.entities.Sale.list('-sale_date')
  });

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list()
  });

  const { data: consultants = [] } = useQuery({
    queryKey: ['consultants'],
    queryFn: () => base44.entities.TeamMember.filter({ role: { $in: ['Design Consultant', 'Sales Manager'] } })
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: currentTeamMember } = useQuery({
    queryKey: ['currentTeamMember', currentUser?.email],
    queryFn: async () => {
      const members = await base44.entities.TeamMember.filter({ email: currentUser.email });
      return members[0] || null;
    },
    enabled: !!currentUser?.email
  });

  // Catalog per-unit costs (cont_labor excluded) for catalog-based GP
  const { data: catalogCostMap = {} } = useQuery({
    queryKey: ['rfmsCatalogCostMap'],
    queryFn: async () => {
      const [items, rolls] = await Promise.all([
        base44.entities.RFMSItem.list(),
        base44.entities.RFMSRoll.list()
      ]);
      return buildCatalogCostMap(items, rolls);
    },
    staleTime: 5 * 60 * 1000
  });

  const isAdmin = currentUser?.role === 'admin' || currentTeamMember?.role === 'Admin';

  // Effective sale amount: fall back to RFMS order line totals when sale_amount is missing
  const getEffectiveSaleAmount = (sale) => {
    if (sale.sale_amount != null && sale.sale_amount > 0) return sale.sale_amount;
    const lines = sale.rfms_order_data?.result?.lines;
    if (lines && lines.length > 0) {
      return lines.reduce((sum, l) => sum + (l.total || 0), 0);
    }
    return 0;
  };

  // Filter sales — exclude cancelled
  const filteredSales = sales.filter(sale => {
    if (sale.is_cancelled) return false;
    const customer = customers.find(c => c.id === sale.customer);
    const consultant = consultants.find(c => c.id === sale.assigned_dc);
    const customerName = customer ? `${customer.first_name} ${customer.last_name}`.toLowerCase() : '';
    const consultantName = consultant ? `${consultant.first_name} ${consultant.last_name}`.toLowerCase() : '';
    const location = (sale.location_address || '').toLowerCase();

    const customerEmail = (customer?.email || '').toLowerCase();
    const customerPhone = (customer?.phone || '').toLowerCase();

    const matchesSearch = !searchQuery ||
      customerName.includes(searchQuery.toLowerCase()) ||
      consultantName.includes(searchQuery.toLowerCase()) ||
      location.includes(searchQuery.toLowerCase()) ||
      customerEmail.includes(searchQuery.toLowerCase()) ||
      customerPhone.includes(searchQuery.toLowerCase());

    let matchesDateRange = true;
    if (startDate && endDate) {
      const saleDate = parseISO(sale.sale_date);
      matchesDateRange = isWithinInterval(saleDate, {
        start: parseISO(startDate),
        end: parseISO(endDate)
      });
    }

    return matchesSearch && matchesDateRange;
  });

  // Calculate date-based stats — all anchored to Arizona time (UTC-7, no DST)
  const AZ_OFFSET_MS = 7 * 60 * 60 * 1000;
  const nowAZ = new Date(Date.now() - AZ_OFFSET_MS);
  const todayAZStr = nowAZ.toISOString().slice(0, 10);

  const yesterdayAZ = new Date(nowAZ);
  yesterdayAZ.setUTCDate(yesterdayAZ.getUTCDate() - 1);
  const yesterdayAZStr = yesterdayAZ.toISOString().slice(0, 10);

  const last7DaysAZ = new Date(nowAZ);
  last7DaysAZ.setUTCDate(last7DaysAZ.getUTCDate() - 6);
  const last7DaysAZStr = last7DaysAZ.toISOString().slice(0, 10);

  const monthStartAZStr = `${nowAZ.toISOString().slice(0, 7)}-01`;
  const monthEndAZStr = todayAZStr; // up to and including today

  // Helper: get the Arizona date string for a sale_date UTC value
  const getSaleDateAZ = (saleDateUtc) => {
    if (!saleDateUtc) return null;
    return new Date(new Date(saleDateUtc).getTime() - AZ_OFFSET_MS).toISOString().slice(0, 10);
  };

  const activeSales = sales.filter(sale => !sale.is_cancelled);
  const salesToday = activeSales.filter(sale => getSaleDateAZ(sale.sale_date) === todayAZStr);
  const salesYesterday = activeSales.filter(sale => getSaleDateAZ(sale.sale_date) === yesterdayAZStr);
  const salesLast7Days = activeSales.filter(sale => {
    const d = getSaleDateAZ(sale.sale_date);
    return d >= last7DaysAZStr && d <= todayAZStr;
  });
  const salesThisMonth = activeSales.filter(sale => {
    const d = getSaleDateAZ(sale.sale_date);
    return d >= monthStartAZStr && d <= monthEndAZStr;
  });

  // Deduplicate sales by ID to prevent counting duplicates
  const uniqueSaleIds = new Set(salesThisMonth.map(s => s.id));
  const deduplicatedSalesThisMonth = Array.from(uniqueSaleIds).map(id => salesThisMonth.find(s => s.id === id));

  const revenueToday = salesToday.reduce((sum, sale) => sum + getEffectiveSaleAmount(sale), 0);
  const revenueYesterday = salesYesterday.reduce((sum, sale) => sum + getEffectiveSaleAmount(sale), 0);
  const revenueLast7Days = salesLast7Days.reduce((sum, sale) => sum + getEffectiveSaleAmount(sale), 0);
  const revenueThisMonth = deduplicatedSalesThisMonth.reduce((sum, sale) => sum + getEffectiveSaleAmount(sale), 0);

  // Calculate stats for filtered sales
  const totalSales = filteredSales.length;
  const totalRevenue = filteredSales.reduce((sum, sale) => sum + getEffectiveSaleAmount(sale), 0);
  const avgSaleAmount = totalSales > 0 ? totalRevenue / totalSales : 0;

  // Group sales by date (using Arizona date)
  const salesByDate = filteredSales.reduce((groups, sale) => {
    const dateKey = getSaleDateAZ(sale.sale_date)
      || (sale.sale_date ? format(parseISO(sale.sale_date), 'yyyy-MM-dd') : 'No Date');
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(sale);
    return groups;
  }, {});

  const sortedDates = Object.keys(salesByDate).sort((a, b) => b.localeCompare(a));

  // Presentational trend sparklines from the filtered set (chronological buckets).
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
      rev.push(chunk.reduce((s, x) => s + getEffectiveSaleAmount(x), 0));
      count.push(chunk.length);
    }
    return { rev, count };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSales]);

  const isFiltered = Boolean(searchQuery || startDate || endDate);

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Sales"
          title="Sales"
          subtitle="Company-wide closed sales and revenue."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-56">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search customer, email, phone…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 border-border bg-card pl-9"
                />
              </div>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 w-auto border-border bg-card"
              />
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 w-auto border-border bg-card"
              />
            </div>
          }
        />

        {/* Headline metrics — filtered set */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile
            label="Total Revenue"
            value={money(totalRevenue)}
            hero
            foot={`${totalSales} ${totalSales === 1 ? 'sale' : 'sales'}${isFiltered ? ' · filtered' : ''}`}
            spark={spark.rev}
          />
          <KpiTile
            label="Total Sales"
            value={totalSales}
            foot="Closed · excludes cancelled"
            spark={spark.count}
          />
          <KpiTile
            label="Avg Sale"
            value={money(avgSaleAmount)}
            foot="Per sale in view"
          />
        </div>

        {/* At-a-glance revenue (Arizona time) */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiTile label="Sales Today" value={money(revenueToday)} foot={`${salesToday.length} ${salesToday.length === 1 ? 'sale' : 'sales'}`} />
          <KpiTile label="Yesterday" value={money(revenueYesterday)} foot={`${salesYesterday.length} ${salesYesterday.length === 1 ? 'sale' : 'sales'}`} />
          <KpiTile label="Last 7 Days" value={money(revenueLast7Days)} foot={`${salesLast7Days.length} ${salesLast7Days.length === 1 ? 'sale' : 'sales'}`} />
          <KpiTile label="Month to Date" value={money(revenueThisMonth)} foot={`${deduplicatedSalesThisMonth.length} ${deduplicatedSalesThisMonth.length === 1 ? 'sale' : 'sales'}`} />
        </div>

        {/* Sales list — grouped by day */}
        {isLoading || loadingCustomers ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-4 py-16 text-center">
            <DollarSign className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
            <h3 className="text-sm font-semibold text-foreground">No sales found</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {isFiltered
                ? 'Try adjusting your filters.'
                : 'Sales will appear here when appointments are marked as sold.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {sortedDates.map((dateKey) => {
              const dateSales = salesByDate[dateKey];
              const dateRevenue = dateSales.reduce((sum, sale) => sum + getEffectiveSaleAmount(sale), 0);
              const dateLabel = dateKey === 'No Date'
                ? 'No Date'
                : format(parseISO(dateKey), 'EEEE, MMMM d, yyyy');

              return (
                <ModuleCard
                  key={dateKey}
                  title={dateLabel}
                  subtitle={`${dateSales.length} ${dateSales.length === 1 ? 'sale' : 'sales'}  ·  ${money(dateRevenue)}`}
                  icon={CalendarIcon}
                >
                  {dateSales.map((sale) => {
                    const customer = customers.find(c => c.id === sale.customer);
                    const consultant = consultants.find(c => c.id === sale.assigned_dc);
                    const customerName = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown Customer';
                    const amount = getEffectiveSaleAmount(sale);

                    let gpMeta = null;
                    let financingMeta = null;
                    if (isAdmin && sale.rfms_order_data?.result?.lines && sale.rfms_order_data.result.lines.length > 0) {
                      const { grossProfit, grossProfitPercent } = computeCatalogGP(sale.rfms_order_data.result.lines, catalogCostMap);
                      gpMeta = `GP ${money(grossProfit)} · ${grossProfitPercent.toFixed(1)}%`;
                      const financingLine = sale.rfms_order_data.result.lines.find(line => line.styleName && (line.styleName.includes('SYNCHRONY') || line.styleName.includes('MOMNT')));
                      if (financingLine) {
                        financingMeta = `Financing ${money(financingLine.total || 0)}`;
                      }
                    }

                    const meta = [
                      sale.sale_date && format(parseISO(sale.sale_date), 'h:mm a'),
                      consultant && `DC ${consultant.first_name} ${consultant.last_name}`,
                      sale.location_address,
                      sale.invoice_number && `Inv #${sale.invoice_number}`,
                      sale.deposit_amount && `Deposit ${money(sale.deposit_amount)}`,
                      gpMeta,
                      financingMeta,
                    ].filter(Boolean).join('  ·  ');

                    return (
                      <WorkRow
                        key={sale.id}
                        lead={amount > 0 ? money(amount) : '—'}
                        primary={customerName}
                        meta={meta}
                        status={sale.deposit_payment_method || 'Sold'}
                        tone={sale.deposit_payment_method ? 'neutral' : 'good'}
                        onClick={() => navigate(createPageUrl('SaleDetail') + `?id=${sale.id}`)}
                      />
                    );
                  })}
                </ModuleCard>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
