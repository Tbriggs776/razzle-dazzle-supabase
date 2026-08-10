import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Search, 
  Loader2,
  DollarSign,
  TrendingUp,
  Calendar as CalendarIcon
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { buildCatalogCostMap, computeCatalogGP } from '@/lib/catalogCost';

export default function Sales() {
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Sales</h1>
              <p className="text-muted-foreground mt-1">Track and manage successful sales</p>
            </div>
          </div>

          {/* Date-Based Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-500/10 dark:to-indigo-500/15 rounded-xl p-4 border border-indigo-200 dark:border-indigo-500/25">
              <div className="text-sm text-indigo-600 dark:text-indigo-300 font-medium mb-1">Sales Today</div>
              <div className="text-2xl font-bold text-indigo-900 dark:text-indigo-200 truncate">
                ${revenueToday.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-indigo-600 dark:text-indigo-300 mt-1">{salesToday.length} sales</div>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-500/10 dark:to-purple-500/15 rounded-xl p-4 border border-purple-200 dark:border-purple-500/25">
              <div className="text-sm text-purple-600 dark:text-purple-300 font-medium mb-1">Yesterday</div>
              <div className="text-2xl font-bold text-purple-900 dark:text-purple-200 truncate">
                ${revenueYesterday.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-purple-600 dark:text-purple-300 mt-1">{salesYesterday.length} sales</div>
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-500/10 dark:to-blue-500/15 rounded-xl p-4 border border-blue-200 dark:border-blue-500/25">
              <div className="text-sm text-blue-600 dark:text-blue-300 font-medium mb-1">Last 7 Days</div>
              <div className="text-2xl font-bold text-blue-900 dark:text-blue-200 truncate">
                ${revenueLast7Days.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-blue-600 dark:text-blue-300 mt-1">{salesLast7Days.length} sales</div>
            </div>
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-500/10 dark:to-emerald-500/15 rounded-xl p-4 border border-emerald-200 dark:border-emerald-500/25">
              <div className="text-sm text-emerald-600 dark:text-emerald-300 font-medium mb-1">MTD</div>
              <div className="text-2xl font-bold text-emerald-900 dark:text-emerald-200 truncate">
                ${revenueThisMonth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-emerald-600 dark:text-emerald-300 mt-1">{deduplicatedSalesThisMonth.length} sales</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-4 mt-6">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Search by customer, email, phone, consultant, or location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-11 h-12 bg-card border-border"
              />
            </div>
            <div className="flex gap-4">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-12 w-full sm:w-auto bg-card border-border"
                placeholder="Start date"
              />
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-12 w-full sm:w-auto bg-card border-border"
                placeholder="End date"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Sales List */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading || loadingCustomers ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-2xl border border-border">
            <DollarSign className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground">No sales found</h3>
            <p className="text-muted-foreground mt-1">
              {searchQuery || startDate || endDate
                ? 'Try adjusting your filters'
                : 'Sales will appear here when appointments are marked as sold'}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {sortedDates.map((dateKey) => {
              const dateSales = salesByDate[dateKey];
              const dateRevenue = dateSales.reduce((sum, sale) => sum + getEffectiveSaleAmount(sale), 0);
              
              return (
                <div key={dateKey}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-foreground">
                      {format(parseISO(dateKey), 'EEEE, MMMM d, yyyy')}
                    </h2>
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium">{dateSales.length} sales</span>
                      <span className="mx-2">•</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        ${dateRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-4">
                    {dateSales.map((sale, index) => {
                      const customer = customers.find(c => c.id === sale.customer);
                      const consultant = consultants.find(c => c.id === sale.assigned_dc);
                      const customerName = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown';
                      const consultantName = consultant ? `${consultant.first_name} ${consultant.last_name}` : 'Unknown';

                      return (
                        <motion.div
                          key={sale.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                        >
                          <Link
                            to={createPageUrl('SaleDetail') + `?id=${sale.id}`}
                            className="block bg-card rounded-xl border border-border p-6 hover:shadow-lg hover:border-primary/30 transition-all"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h3 className="text-lg font-semibold text-foreground">{customerName}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                  Consultant: {consultantName}
                                </p>
                                {sale.location_address && (
                                  <p className="text-sm text-muted-foreground mt-1">{sale.location_address}</p>
                                )}
                                {(sale.deposit_amount || sale.deposit_payment_method) && (
                                  <p className="text-sm mt-2">
                                    {sale.deposit_amount && (
                                      <>
                                        <span className="text-muted-foreground">Deposit: </span>
                                        <span className="text-foreground font-medium">
                                          ${sale.deposit_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                      </>
                                    )}
                                    {sale.deposit_amount && sale.deposit_payment_method && (
                                      <span className="text-muted-foreground mx-2">•</span>
                                    )}
                                    {sale.deposit_payment_method && (
                                      <span className="text-primary font-medium">
                                        {sale.deposit_payment_method}
                                      </span>
                                    )}
                                  </p>
                                )}
                                {sale.invoice_number && (
                                  <p className="text-sm text-muted-foreground mt-1">
                                    Invoice #{sale.invoice_number}
                                  </p>
                                )}
                              </div>
                              <div className="text-right">
                                {getEffectiveSaleAmount(sale) > 0 && (
                                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                                    ${getEffectiveSaleAmount(sale).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                )}
                                {isAdmin && sale.rfms_order_data?.result?.lines && sale.rfms_order_data.result.lines.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {(() => {
                                      const { grossProfit, grossProfitPercent } = computeCatalogGP(sale.rfms_order_data.result.lines, catalogCostMap);
                                      const financingLine = sale.rfms_order_data.result.lines.find(line => line.styleName && (line.styleName.includes('SYNCHRONY') || line.styleName.includes('MOMNT')));
                                      return (
                                        <>
                                          <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                                            GP: ${grossProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </p>
                                          <p className="text-xs text-blue-500 dark:text-blue-400">
                                            {grossProfitPercent.toFixed(1)}%
                                          </p>
                                          {financingLine && (
                                            <p className="text-xs text-purple-600 dark:text-purple-400 font-medium">
                                              Financing charges: ${financingLine.total?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                                            </p>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                )}
                                <p className="text-sm text-muted-foreground mt-1">
                                  {format(parseISO(sale.sale_date), 'h:mm a')}
                                </p>
                              </div>
                            </div>
                          </Link>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}