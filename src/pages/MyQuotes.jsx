import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, FileText, DollarSign, Calendar, MapPin, ArrowRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

const STATUS_COLORS = {
  'Draft':             'bg-secondary text-secondary-foreground border-border',
  'Sent':              'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25',
  'Accepted':          'bg-green-100 text-green-800 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25',
  'Rejected':          'bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25',
  'Converted':         'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25',
  'Expired':           'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25',
};

function formatCurrency(val) {
  if (!val) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

export default function MyQuotes() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: teamMember } = useQuery({
    queryKey: ['currentTeamMember', currentUser?.email],
    queryFn: async () => {
      const result = await base44.entities.TeamMember.filter({ email: currentUser.email });
      return result?.[0] || null;
    },
    enabled: !!currentUser?.email
  });

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ['quotes', teamMember?.id, currentUser?.role],
    queryFn: async () => {
      // Admins see all; DCs see their own
      if (currentUser?.role === 'admin') {
        return base44.entities.Quote.list('-quote_date');
      }
      if (!teamMember?.id) return [];
      return base44.entities.Quote.filter({ assigned_dc: teamMember.id }, '-quote_date');
    },
    enabled: !!currentUser
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: () => base44.entities.Lead.list()
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  const getLead = (id) => leads.find(l => l.id === id);
  const getDC = (id) => teamMembers.find(m => m.id === id);

  const filtered = quotes.filter(q => {
    const lead = getLead(q.lead);
    const name = lead ? `${lead.first_name} ${lead.last_name}`.toLowerCase() : '';
    const matchesSearch = !search || name.includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || q.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    all: quotes.length,
    Draft: quotes.filter(q => q.status === 'Draft').length,
    Sent: quotes.filter(q => q.status === 'Sent').length,
    Accepted: quotes.filter(q => q.status === 'Accepted').length,
    Rejected: quotes.filter(q => q.status === 'Rejected').length,
    Converted: quotes.filter(q => q.status === 'Converted').length,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">My Quotes</h1>
              <p className="text-muted-foreground mt-1">Manage and convert your pending quotes</p>
            </div>
          </div>

          <div className="relative mb-5">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search by customer name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-11 h-11 bg-card border-border"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {Object.entries(statusCounts).map(([status, count]) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap',
                  statusFilter === status
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground border-border hover:border-primary/40'
                )}
              >
                {status === 'all' ? 'All' : status} ({count})
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-card rounded-2xl border border-border">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground">No quotes found</h3>
            <p className="text-muted-foreground mt-1">Quotes are created from appointment results</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((quote, i) => {
              const lead = getLead(quote.lead);
              const dc = getDC(quote.assigned_dc);
              const leadName = lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown Customer';

              return (
                <motion.div
                  key={quote.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <Link
                    to={createPageUrl('QuoteDetail') + `?id=${quote.id}`}
                    className="block bg-card rounded-xl border border-border hover:shadow-lg hover:border-primary/30 transition-all p-6"
                  >
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">{leadName}</h3>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Badge variant="secondary" className={cn('border', STATUS_COLORS[quote.status])}>
                            {quote.status}
                          </Badge>
                          {quote.status !== 'Converted' && (
                            <Badge variant="secondary" className="border bg-primary/10 text-primary border-primary/20">
                              Quote
                            </Badge>
                          )}
                          {quote.status === 'Converted' && (
                            <Badge variant="secondary" className="border bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25">
                              ✓ Converted to Sale
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-1" />
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <DollarSign className="w-4 h-4 text-muted-foreground" />
                        <span className="font-semibold">{formatCurrency(quote.quote_amount)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span>
                          {quote.quote_date
                            ? format(new Date(quote.quote_date), 'MMM d, yyyy')
                            : '—'}
                        </span>
                      </div>
                      {quote.location_address && (
                        <div className="flex items-center gap-2 text-muted-foreground md:col-span-2">
                          <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{quote.location_address}</span>
                        </div>
                      )}
                    </div>

                    {dc && (
                      <div className="mt-3 text-xs text-muted-foreground">
                        DC: {dc.first_name} {dc.last_name}
                      </div>
                    )}
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}