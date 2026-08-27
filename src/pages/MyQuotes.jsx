import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Input } from '@/components/ui/input';
import { Loader2, Search, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/common/PageHeader';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import WorkRow from '@/components/dashboard/WorkRow';

// Domain quote status → StatusPill tone.
const STATUS_TONE = {
  Draft: 'neutral',
  Sent: 'info',
  Accepted: 'good',
  Converted: 'good',
  Rejected: 'crit',
  Expired: 'crit',
};

function formatCurrency(val) {
  if (!val) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

const money = (n) => '$' + Math.round(n || 0).toLocaleString();

export default function MyQuotes() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const navigate = useNavigate();

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

  // Presentational KPI rollups over the DC's full book (not the filtered view).
  const openQuotes = quotes.filter(q => q.status === 'Draft' || q.status === 'Sent');
  const openPipeline = openQuotes.reduce((sum, q) => sum + (q.quote_amount || 0), 0);
  const openCount = openQuotes.length;
  const wonCount = quotes.filter(q => q.status === 'Accepted' || q.status === 'Converted').length;
  const lostCount = quotes.filter(q => q.status === 'Rejected' || q.status === 'Expired').length;
  const decidedCount = wonCount + lostCount;
  const winRate = decidedCount > 0 ? Math.round((wonCount / decidedCount) * 100) : 0;

  // Chronological sparkline of quoted value for the hero tile.
  const spark = useMemo(() => {
    const asc = quotes
      .filter(q => q.quote_date)
      .slice()
      .sort((a, b) => new Date(a.quote_date) - new Date(b.quote_date));
    if (asc.length < 2) return [];
    const n = Math.min(8, asc.length);
    const size = Math.ceil(asc.length / n);
    const out = [];
    for (let i = 0; i < asc.length; i += size) {
      const chunk = asc.slice(i, i + size);
      out.push(chunk.reduce((s, x) => s + (x.quote_amount || 0), 0));
    }
    return out;
  }, [quotes]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Sales"
          title="My Quotes"
          subtitle="Manage and convert your pending quotes."
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile
            label="Open Pipeline"
            value={money(openPipeline)}
            hero
            foot={`${openCount} open ${openCount === 1 ? 'quote' : 'quotes'} · Draft + Sent`}
            spark={spark}
          />
          <KpiTile
            label="Open Quotes"
            value={openCount}
            foot="Awaiting a decision"
          />
          <KpiTile
            label="Win Rate"
            value={`${winRate}%`}
            foot={`${wonCount} won · ${lostCount} lost`}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {Object.entries(statusCounts).map(([status, count]) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                'whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                statusFilter === status
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40'
              )}
            >
              {status === 'all' ? 'All' : status} ({count})
            </button>
          ))}
        </div>

        <ModuleCard
          title="Quotes"
          subtitle={`${filtered.length} ${filtered.length === 1 ? 'quote' : 'quotes'}${statusFilter !== 'all' ? ` · ${statusFilter}` : ''}`}
          icon={FileText}
          action={
            <div className="relative w-52">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by customer name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-9 border-border bg-card pl-9"
              />
            </div>
          }
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <h3 className="text-sm font-semibold text-foreground">
                {search || statusFilter !== 'all' ? 'No matching quotes' : 'No quotes found'}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {search || statusFilter !== 'all'
                  ? 'Try adjusting your search or status filter.'
                  : 'Quotes are created from appointment results.'}
              </p>
            </div>
          ) : (
            filtered.map((quote) => {
              const lead = getLead(quote.lead);
              const dc = getDC(quote.assigned_dc);
              const leadName = lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown Customer';
              const meta = [
                quote.quote_date && format(new Date(quote.quote_date), 'MMM d, yyyy'),
                quote.location_address,
                dc && `DC ${dc.first_name} ${dc.last_name}`,
              ].filter(Boolean).join('  ·  ');
              return (
                <WorkRow
                  key={quote.id}
                  lead={formatCurrency(quote.quote_amount)}
                  primary={leadName}
                  meta={meta}
                  status={quote.status}
                  tone={STATUS_TONE[quote.status] || 'neutral'}
                  onClick={() => navigate(createPageUrl('QuoteDetail') + `?id=${quote.id}`)}
                />
              );
            })
          )}
        </ModuleCard>
      </div>
    </div>
  );
}
