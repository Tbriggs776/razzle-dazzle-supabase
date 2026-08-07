import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Search, Loader2, Calendar, MapPin, User } from 'lucide-react';
import { motion } from 'framer-motion';
import { format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, subMonths, subQuarters, startOfYear } from 'date-fns';

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

export default function MySales() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDcId, setSelectedDcId] = useState('');
  const [datePreset, setDatePreset] = useState('mtd');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    retry: false
  });

  const isAdmin = currentUser?.role === 'admin';

  const { data: allTeamMembers = [] } = useQuery({
    queryKey: ['teamMembersAll'],
    queryFn: () => base44.entities.TeamMember.list(),
    enabled: !!currentUser
  });

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['mySalesWithData', currentUser?.email, isAdmin],
    queryFn: async () => {
      if (!currentUser?.email) return { sales: [], customers: [] };

      if (isAdmin) {
        const [sales, customers] = await Promise.all([
          base44.entities.Sale.list('-sale_date', 500),
          base44.entities.Customer.list()
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
    staleTime: 30000
  });

  const sales = salesData?.sales || [];
  const customers = salesData?.customers || [];

  const designConsultants = allTeamMembers
    .filter(tm => tm.role === 'Design Consultant' || tm.role === 'Sales Manager')
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));

  const getCustomer = (customerId) => customers.find(c => c.id === customerId);
  const getDC = (dcId) => allTeamMembers.find(tm => tm.id === dcId);

  const activeDateRange = datePreset === 'custom'
    ? (customStart && customEnd ? { start: new Date(customStart), end: new Date(customEnd + 'T23:59:59') } : null)
    : getDateRange(datePreset);

  const filteredSales = sales
    .filter(sale => {
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
  const salesWithAmount = filteredSales.filter(s => s.sale_amount);
  const avgSale = salesWithAmount.length > 0 ? totalRevenue / salesWithAmount.length : 0;

  if (userLoading || salesLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-800">My Sales</h1>
              <p className="text-slate-500 mt-1">{isAdmin ? 'All closed sales' : 'Your closed sales and revenue'}</p>
            </div>
          </div>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Total Sales</p>
            <p className="text-2xl font-bold text-slate-800">{filteredSales.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Total Revenue</p>
            <p className="text-2xl font-bold text-emerald-600">${totalRevenue.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Avg Sale</p>
            <p className="text-2xl font-bold text-slate-800">${Math.round(avgSale).toLocaleString()}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'mtd', label: 'Month to Date' },
              { value: 'last_month', label: 'Last Month' },
              { value: 'qtd', label: 'This Quarter' },
              { value: 'last_quarter', label: 'Last Quarter' },
              { value: 'last_3_months', label: 'Last 3 Months' },
              { value: 'ytd', label: 'Year to Date' },
              { value: 'all', label: 'All Time' },
              { value: 'custom', label: 'Custom Range' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setDatePreset(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  datePreset === opt.value
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {datePreset === 'custom' && (
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
              />
              <span className="text-slate-400 text-sm">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
              />
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            {isAdmin && (
              <Select value={selectedDcId || 'all'} onValueChange={v => setSelectedDcId(v === 'all' ? '' : v)}>
                <SelectTrigger className="w-64 bg-white h-10">
                  <SelectValue placeholder="All Consultants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Consultants</SelectItem>
                  {designConsultants.map(dc => (
                    <SelectItem key={dc.id} value={dc.id}>
                      {dc.first_name} {dc.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <Input
                placeholder="Search by customer, location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 bg-white border-slate-200"
              />
            </div>
          </div>
        </div>

        {/* Sales List */}
        {filteredSales.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
            <DollarSign className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">
              {searchQuery || selectedDcId ? 'No matching sales' : 'No sales yet'}
            </h3>
            <p className="text-slate-500">
              {searchQuery || selectedDcId ? 'Try adjusting your filters' : 'Your closed sales will appear here'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSales.map((sale, i) => {
              const customer = getCustomer(sale.customer);
              const dc = isAdmin ? getDC(sale.assigned_dc) : null;
              return (
                <motion.div
                  key={sale.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-slate-800 text-lg">
                        {customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown Customer'}
                      </span>
                      {dc && (
                        <Badge variant="outline" className="text-indigo-600 border-indigo-200 bg-indigo-50 text-xs">
                          <User className="w-3 h-3 mr-1" />{dc.first_name} {dc.last_name}
                        </Badge>
                      )}
                      {sale.sale_amount && (
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 font-bold">
                          ${sale.sale_amount.toLocaleString()}
                        </Badge>
                      )}
                      {sale.deposit_payment_method && (
                        <Badge variant="outline" className="text-slate-500 text-xs">
                          {sale.deposit_payment_method}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                      {sale.sale_date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(sale.sale_date), 'MMM d, yyyy')}
                        </span>
                      )}
                      {sale.location_address && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {sale.location_address}
                        </span>
                      )}
                      {sale.deposit_amount && (
                        <span>Deposit: ${sale.deposit_amount.toLocaleString()}</span>
                      )}
                      {sale.invoice_number && (
                        <span>Invoice #{sale.invoice_number}</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}