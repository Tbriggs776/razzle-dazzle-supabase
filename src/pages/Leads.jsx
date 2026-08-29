import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, Plus, Users, Loader2, ArrowUpDown } from 'lucide-react';
import { format } from 'date-fns';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import WorkRow from '@/components/dashboard/WorkRow';
import LeadForm from '@/components/leads/LeadForm';

const DAY = 24 * 60 * 60 * 1000;

export default function Leads() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [sortOrder, setSortOrder] = useState('desc');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['leads', sortOrder],
    queryFn: () => base44.entities.Lead.list(sortOrder === 'desc' ? '-created_date' : 'created_date')
  });

  const createMutation = useMutation({
    // upsert_lead, not Lead.create: since 0098 a phone number we already hold
    // raises a unique violation on insert. Resolving instead means typing an
    // existing customer's number lands on their record rather than erroring —
    // and says which it did.
    mutationFn: async (data) => {
      const res = await base44.functions.invoke('upsertLead', { lead: data });
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data;
    },
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setShowCreateDialog(false);
      if (d?.created) {
        toast.success('Lead created');
        return;
      }
      // The toast used to say "opened their existing lead" while nothing opened
      // and the dialog just closed — so the CSR believed the details they had
      // typed were saved onto that record. upsert_lead fills BLANKS only; it
      // never overwrites a name or address someone already corrected. Say that,
      // and actually open the record.
      toast.info(`We already had that ${d?.matched_on === 'email' ? 'email address' : 'number'} — opening their record. `
        + 'Anything you typed that they already had was left as it was.', { duration: 9000 });
      if (d?.lead_id) navigate(`${createPageUrl('LeadDetail')}?id=${d.lead_id}`);
    },
    onError: (e) => toast.error(e?.message || 'Could not save that lead'),
  });

  // Filter leads based on search query
  const filteredLeads = leads.filter(lead => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const fullName = `${lead.first_name} ${lead.last_name}`.toLowerCase();
    return (
      fullName.includes(query) ||
      lead.email?.toLowerCase().includes(query) ||
      lead.phone?.includes(query)
    );
  });

  // Presentational KPI rollups over the full lead book (not the filtered view).
  const now = Date.now();
  const newThisWeek = leads.filter(l => l.created_date && now - new Date(l.created_date).getTime() <= 7 * DAY).length;
  const newThisMonth = leads.filter(l => l.created_date && now - new Date(l.created_date).getTime() <= 30 * DAY).length;

  // Chronological sparkline of lead-count buckets for the hero tile.
  const spark = useMemo(() => {
    const asc = leads
      .filter(l => l.created_date)
      .slice()
      .sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    if (asc.length < 2) return [];
    const n = Math.min(8, asc.length);
    const size = Math.ceil(asc.length / n);
    const out = [];
    for (let i = 0; i < asc.length; i += size) {
      out.push(asc.slice(i, i + size).length);
    }
    return out;
  }, [leads]);

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
          eyebrow="Pipeline"
          title="Leads"
          subtitle="Manage your lead database."
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                className="h-9"
              >
                <ArrowUpDown className="mr-2 h-4 w-4" />
                {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
              </Button>
              <Button variant="accent" onClick={() => setShowCreateDialog(true)} className="h-9">
                <Plus className="mr-2 h-4 w-4" />
                Add Lead
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile
            label="Total Leads"
            value={leads.length}
            hero
            foot="In your database"
            spark={spark}
          />
          <KpiTile
            label="New This Week"
            value={newThisWeek}
            foot="Added in the last 7 days"
          />
          <KpiTile
            label="New This Month"
            value={newThisMonth}
            foot="Added in the last 30 days"
          />
        </div>

        <ModuleCard
          title="Lead Directory"
          subtitle={`${filteredLeads.length} ${filteredLeads.length === 1 ? 'lead' : 'leads'}${searchQuery ? ` · filtered from ${leads.length}` : ''}`}
          icon={Users}
          action={
            <div className="relative w-52">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, email, phone…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 border-border bg-card pl-9"
              />
            </div>
          }
          footer={
            filteredLeads.length > 0 ? (
              <span className="text-muted-foreground">
                Showing {filteredLeads.length} of {leads.length} leads
              </span>
            ) : undefined
          }
        >
          {filteredLeads.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <h3 className="text-sm font-semibold text-foreground">
                {searchQuery ? 'No leads found' : 'No leads yet'}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {searchQuery ? 'Try adjusting your search query.' : 'Get started by adding your first lead.'}
              </p>
              {!searchQuery && (
                <Button className="mt-4" onClick={() => setShowCreateDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Lead
                </Button>
              )}
            </div>
          ) : (
            filteredLeads.map((lead) => {
              const initials = `${lead.first_name?.[0] || ''}${lead.last_name?.[0] || ''}`.toUpperCase();
              const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unnamed Lead';
              const location = [lead.city, lead.state].filter(Boolean).join(', ');
              const isNew = lead.created_date && now - new Date(lead.created_date).getTime() <= 7 * DAY;
              const meta = [
                lead.email,
                lead.phone,
                location,
                lead.created_date && format(new Date(lead.created_date), 'MMM d, yyyy'),
              ].filter(Boolean).join('  ·  ');
              return (
                <WorkRow
                  key={lead.id}
                  lead={
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-blue/10 text-[12px] font-bold text-brand-blue">
                      {initials}
                    </span>
                  }
                  primary={fullName}
                  meta={meta}
                  trailing={isNew ? <StatusPill tone="info" dot>New</StatusPill> : null}
                  onClick={() => navigate(createPageUrl('LeadDetail') + `?id=${lead.id}`)}
                />
              );
            })
          )}
        </ModuleCard>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-extrabold">New Lead</DialogTitle>
          </DialogHeader>
          <LeadForm
            onSubmit={(data) => createMutation.mutate(data)}
            onCancel={() => setShowCreateDialog(false)}
            isLoading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
