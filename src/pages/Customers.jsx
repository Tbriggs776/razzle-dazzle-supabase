import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Users, Plus, Search, Loader2 } from 'lucide-react';
import { format, startOfMonth, subDays } from 'date-fns';
import PageHeader from '@/components/common/PageHeader';
import KpiTile from '@/components/dashboard/KpiTile';
import StatusPill from '@/components/common/StatusPill';
import DataTable from '@/components/common/DataTable';
import CustomerForm from '@/components/customers/CustomerForm';

export default function Customers() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list('-created_date'),
    initialData: []
  });

  const createMutation = useMutation({
    mutationFn: (customerData) => base44.entities.Customer.create(customerData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowCreateDialog(false);
    }
  });

  const filteredCustomers = customers.filter(customer => {
    const search = searchQuery.toLowerCase();
    return (
      `${customer.first_name} ${customer.last_name}`.toLowerCase().includes(search) ||
      customer.email?.toLowerCase().includes(search) ||
      customer.phone?.toLowerCase().includes(search)
    );
  });

  // Presentational KPI rollups over the full book (display-only; no effect on fetch/filter).
  const now = new Date();
  const monthStart = startOfMonth(now);
  const weekAgo = subDays(now, 7);
  const totalCustomers = customers.length;
  const newThisMonth = customers.filter(
    (c) => c.created_date && new Date(c.created_date) >= monthStart
  ).length;
  const newThisWeek = customers.filter(
    (c) => c.created_date && new Date(c.created_date) >= weekAgo
  ).length;

  const columns = [
    {
      key: 'name',
      header: 'Customer',
      render: (customer) => {
        const initials = `${customer.first_name?.[0] || ''}${customer.last_name?.[0] || ''}`.toUpperCase();
        const isNew = customer.created_date && new Date(customer.created_date) >= weekAgo;
        return (
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-blue/10 text-[12px] font-bold text-brand-blue">
              {initials || <Users className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold text-foreground">
                  {`${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Unnamed Customer'}
                </span>
                {isNew && <StatusPill tone="info">New</StatusPill>}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {customer.email || 'No email on file'}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (customer) =>
        customer.phone ? (
          <span className="tabular-nums">{customer.phone}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'location',
      header: 'Location',
      render: (customer) => {
        const location = [customer.city, customer.state].filter(Boolean).join(', ');
        return location ? location : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      key: 'created_date',
      header: 'Added',
      align: 'right',
      render: (customer) =>
        customer.created_date ? (
          format(new Date(customer.created_date), 'MMM d, yyyy')
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const emptyState = (
    <div className="py-6">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-muted">
        <Users className="h-7 w-7 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">
        {searchQuery ? 'No customers found' : 'No customers yet'}
      </h3>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        {searchQuery
          ? 'Try adjusting your search terms.'
          : 'Customers will appear here when appointments are marked as sold.'}
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Directory"
          title="Customers"
          subtitle="Your full customer directory."
          actions={
            <Button variant="accent" onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4" />
              Add Customer
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile
            label="Total Customers"
            value={totalCustomers}
            hero
            foot="All customers on record"
          />
          <KpiTile
            label="New This Month"
            value={newThisMonth}
            foot={`Added since ${format(monthStart, 'MMMM 1')}`}
          />
          <KpiTile
            label="New This Week"
            value={newThisWeek}
            foot="Added in the last 7 days"
          />
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Showing {filteredCustomers.length} customer{filteredCustomers.length !== 1 ? 's' : ''}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or phone…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 border-border bg-card pl-9"
              />
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filteredCustomers}
            rowKey={(customer) => customer.id}
            onRowClick={(customer) =>
              navigate(createPageUrl('CustomerDetail') + `?id=${customer.id}`)
            }
            empty={emptyState}
          />
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-extrabold text-foreground">
              Add New Customer
            </DialogTitle>
          </DialogHeader>
          <CustomerForm
            onSubmit={(data) => createMutation.mutate(data)}
            onCancel={() => setShowCreateDialog(false)}
            isLoading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
