import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Search, Plus, Loader2, MapPin, Calendar, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';

export default function OrderPool({ regions, onTagOrder, taggingOrderId }) {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [search, setSearch] = useState('');
  const [selectedRegionFilter, setSelectedRegionFilter] = useState('');
  const [dateField, setDateField] = useState('order');

  const { data: rfmsResult, isLoading, refetch } = useQuery({
    queryKey: ['rfmsOrdersPool', dateFrom, dateTo, dateField],
    queryFn: async () => {
      const res = await base44.functions.invoke('getRFMSOrders', {
        orderDateFrom: dateFrom,
        orderDateTo: dateTo,
        dateField,
      });
      return res.data?.orders || [];
    },
    enabled: false,
  });

  const { data: journeyOrders = [] } = useQuery({
    queryKey: ['journeyOrders'],
    queryFn: () => base44.entities.JourneyOrder.list('-created_date', 200),
  });

  const taggedOrderIds = new Set(journeyOrders.map(o => o.rfms_order_id));

  const getOrderName = (order) =>
    order.customer?.businessName ||
    order.customer?.lastName ||
    order.shipTo?.businessName ||
    order.shipTo?.lastName ||
    'Unknown Customer';

  const getOrderAddress = (order) => {
    const c = order.customer || order.shipTo || {};
    return [c.address1, c.city, c.state, c.postalCode].filter(Boolean).join(', ');
  };

  const getOrderZip = (order) =>
    order.customer?.postalCode || order.shipTo?.postalCode || '';

  const filtered = (rfmsResult || []).filter(order => {
    const tagged = taggedOrderIds.has(String(order.id));
    if (tagged) return false;
    const q = search.toLowerCase();
    if (q) {
      const name = getOrderName(order).toLowerCase();
      const addr = getOrderAddress(order).toLowerCase();
      const inv = (order.documentNumber || order.id || '').toString().toLowerCase();
      if (!name.includes(q) && !addr.includes(q) && !inv.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      <div className="space-y-2 mb-3">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
          {[
            { id: 'order', label: 'Order Date' },
            { id: 'install', label: 'Install Date' },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setDateField(opt.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                dateField === opt.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="h-8 text-xs"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="h-8 text-xs"
          />
          <Button size="sm" className="h-8 text-xs shrink-0" onClick={() => refetch()}>
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Fetch'}
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search orders..."
            className="h-8 text-xs pl-7"
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
        </div>
      )}

      {!isLoading && rfmsResult && (
        <div className="text-xs text-slate-400 mb-2">
          {filtered.length} untagged orders ({taggedOrderIds.size} already in Journey)
        </div>
      )}

      <div className="space-y-2 overflow-y-auto flex-1">
        {filtered.map((order) => {
          const orderId = String(order.id);
          const address = getOrderAddress(order);
          const zip = getOrderZip(order);
          const isTagging = taggingOrderId === orderId;

          return (
            <div
              key={orderId}
              className="border border-slate-200 rounded-xl p-3 bg-white hover:border-indigo-200 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-slate-700 truncate">
                    {getOrderName(order)}
                  </div>
                  <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-2.5 h-2.5" />
                    <span className="truncate">{address || '—'}</span>
                  </div>
                  {zip && (
                    <div className="text-xs text-slate-400 mt-0.5">ZIP: {zip}</div>
                  )}
                  {order.orderDate && (
                    <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                      <Calendar className="w-2.5 h-2.5" />
                      Ordered: {order.orderDate?.split('T')[0]}
                    </div>
                  )}
                  {order.estimatedDeliveryDate && (
                    <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                      <Calendar className="w-2.5 h-2.5" />
                      Install: {order.estimatedDeliveryDate?.split('T')[0]}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs shrink-0 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                  disabled={isTagging}
                  onClick={() => onTagOrder(order)}
                >
                  {isTagging ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <>
                      <Plus className="w-3 h-3 mr-1" /> Tag
                    </>
                  )}
                </Button>
              </div>
            </div>
          );
        })}

        {!isLoading && rfmsResult && filtered.length === 0 && (
          <div className="text-center py-8 text-slate-400 text-xs">
            All orders are already in Journey or none match your search.
          </div>
        )}

        {!rfmsResult && !isLoading && (
          <div className="text-center py-8 text-slate-400 text-xs">
            Set date range and click Fetch to load RFMS orders.
          </div>
        )}
      </div>
    </div>
  );
}