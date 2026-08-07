import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Search, Loader2, Calendar, MapPin, User } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

export default function SalesByConsultant() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDcId, setSelectedDcId] = useState('all');

  const { data: teamMembers = [], isLoading: tmLoading } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  const { data: sales = [], isLoading: salesLoading } = useQuery({
    queryKey: ['allSales'],
    queryFn: () => base44.entities.Sale.list('-sale_date', 500)
  });

  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ['allCustomers'],
    queryFn: () => base44.entities.Customer.list()
  });

  const designConsultants = teamMembers.filter(tm =>
    tm.role === 'Design Consultant' || tm.role === 'Sales Manager'
  ).sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));

  const getCustomer = (customerId) => customers.find(c => c.id === customerId);
  const getDC = (dcId) => teamMembers.find(tm => tm.id === dcId);

  const filteredSales = sales
    .filter(sale => {
      if (selectedDcId !== 'all' && sale.assigned_dc !== selectedDcId) return false;
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

  const isLoading = tmLoading || salesLoading || customersLoading;

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
              <h1 className="text-3xl font-bold text-slate-800">Sales by Consultant</h1>
              <p className="text-slate-500 mt-1">View sales broken down by Design Consultant</p>
            </div>
          </div>
        </motion.div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <Select value={selectedDcId} onValueChange={setSelectedDcId}>
            <SelectTrigger className="w-64 bg-white h-12">
              <User className="w-4 h-4 mr-2 text-slate-400" />
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

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search by customer, location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-12 bg-white border-slate-200"
            />
          </div>
        </div>

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

        {/* Sales List */}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
            <DollarSign className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">
              {searchQuery || selectedDcId !== 'all' ? 'No matching sales' : 'No sales yet'}
            </h3>
            <p className="text-slate-500">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSales.map((sale, i) => {
              const customer = getCustomer(sale.customer);
              const dc = getDC(sale.assigned_dc);
              return (
                <motion.div
                  key={sale.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-slate-800 text-lg">
                        {customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown Customer'}
                      </span>
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
                      {dc && (
                        <span className="flex items-center gap-1 font-medium text-indigo-600">
                          <User className="w-3 h-3" />
                          {dc.first_name} {dc.last_name}
                        </span>
                      )}
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