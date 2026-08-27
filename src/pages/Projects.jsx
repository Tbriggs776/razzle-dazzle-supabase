import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search,
  Loader2,
  ClipboardCheck,
  Calendar as CalendarIcon,
  MapPin,
  Clock,
  Copy,
  Plus,
  List,
  Tag,
  Layers,
} from 'lucide-react';
import NoteReactions from '@/components/projects/NoteReactions';
import TagBadge from '@/components/tags/TagBadge';
import ProjectsCalendarView from '@/components/projects/ProjectsCalendarView';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/common/PageHeader';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import PipelineBar from '@/components/dashboard/PipelineBar';
import StatusPill from '@/components/common/StatusPill';

const HOLD_STATUSES = ['pending payment', 'pending contract', 'on hold', 'pending cancellation'];

const calculateBusinessDays = (startDate, installationDateStatus, holdClearedDate) => {
  if (installationDateStatus && HOLD_STATUSES.includes(installationDateStatus)) {
    return 0;
  }
  const effectiveStartDate = holdClearedDate || startDate;
  const toAZDate = (ms) => {
    const azMs = ms - (7 * 60 * 60 * 1000);
    const d = new Date(azMs);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
  };
  const startAZ = toAZDate(new Date(effectiveStartDate).getTime());
  const nowAZ = toAZDate(Date.now());
  const startDay = new Date(Date.UTC(startAZ.y, startAZ.m, startAZ.day));
  const nowDay = new Date(Date.UTC(nowAZ.y, nowAZ.m, nowAZ.day));
  let count = 0;
  const current = new Date(startDay);
  current.setUTCDate(current.getUTCDate() + 1);
  while (current <= nowDay) {
    const dow = current.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
};

// Domain project status → StatusPill tone. Same six stages, semantic colors instead of
// the old bg-*-100 lookups: progress reads info, review reads warn, done reads good.
const STATUS_TONE = {
  'Accepted': 'info',
  'Materials Ordered': 'info',
  'Scheduled': 'info',
  'In Progress': 'info',
  'Quality Checks': 'warn',
  'Completed': 'good',
};
const PROJECT_STATUSES = Object.keys(STATUS_TONE);

const money = (n) => '$' + Math.round(n || 0).toLocaleString();

const pillCls = (active) =>
  cn(
    'whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
    active
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-border bg-card text-muted-foreground hover:border-primary/40'
  );

const subPillCls = (active) =>
  cn(
    'whitespace-nowrap rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
    active
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-border bg-card text-muted-foreground hover:border-primary/40'
  );

export default function Projects() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [viewMode, setViewMode] = useState('list');
  const [pastDueCopied, setPastDueCopied] = useState(false);
  const [orderedView, setOrderedView] = useState(null); // null | 'today' | 'yesterday'
  const [showNewProject, setShowNewProject] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectForm, setNewProjectForm] = useState({
    first_name: '', last_name: '', email: '', phone: '', address: '', installation_date: '', status: 'Scheduled', notes: ''
  });
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const handleCreateProject = async () => {
    if (!newProjectForm.first_name || !newProjectForm.last_name) return;
    setCreatingProject(true);
    try {
      const projectPayload = {
        status: newProjectForm.status,
        installation_date: newProjectForm.installation_date || null,
      };
      if (newProjectForm.notes) {
        projectPayload.notes = [{
          content: newProjectForm.notes,
          user_name: 'Manual Entry',
          user_email: 'system',
          timestamp: new Date().toISOString(),
        }];
      }
      // Atomic: customer + project + log in one transaction (a project failure no longer orphans
      // the just-created customer).
      const { data, error } = await base44.functions.invoke('createManualProject', {
        customer: {
          first_name: newProjectForm.first_name,
          last_name: newProjectForm.last_name,
          email: newProjectForm.email || 'temp@example.com',
          phone: newProjectForm.phone || '0000000000',
          address_line1: newProjectForm.address || '',
        },
        project: projectPayload,
        log: {
          action: 'Project Created',
          details: 'Manually created via New Project button',
          user_email: currentUser?.email || 'Unknown',
          user_name: currentUser?.full_name || currentUser?.email || 'Unknown',
        },
      });
      if (error || !data?.project_id) {
        throw new Error(data?.error || error?.message || 'Failed to create the project.');
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowNewProject(false);
      setNewProjectForm({ first_name: '', last_name: '', email: '', phone: '', address: '', installation_date: '', status: 'Scheduled', notes: '' });
    } catch (e) {
      toast.error(e?.message || 'Failed to create the project. Please try again.');
    } finally {
      setCreatingProject(false);
    }
  };

  const handleAddReaction = async (project, noteIndex, emoji) => {
    const updatedNotes = [...project.notes];
    const note = updatedNotes[noteIndex];
    if (!note.reactions) note.reactions = [];
    const reactionIndex = note.reactions.findIndex(r => r.emoji === emoji);
    if (reactionIndex > -1) {
      const userIndex = note.reactions[reactionIndex].users.indexOf(currentUser?.email);
      if (userIndex > -1) {
        note.reactions[reactionIndex].users.splice(userIndex, 1);
        if (note.reactions[reactionIndex].users.length === 0) note.reactions.splice(reactionIndex, 1);
      } else {
        note.reactions[reactionIndex].users.push(currentUser?.email);
      }
    } else {
      note.reactions.push({ emoji, users: [currentUser?.email] });
    }
    await base44.entities.Project.update(project.id, { notes: updatedNotes });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
  };

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date')
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list('-created_date', 500)
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['sales'],
    queryFn: () => base44.entities.Sale.list('-created_date', 500)
  });

  const { data: checklists = [] } = useQuery({
    queryKey: ['allChecklists'],
    queryFn: () => base44.entities.AppointmentSettingChecklist.list('-created_date', 500),
    staleTime: 5 * 60 * 1000
  });

  const { data: materialsOrderedLogs = [] } = useQuery({
    queryKey: ['materialsOrderedLogs'],
    queryFn: () => base44.entities.ProjectLog.filter({ action: 'Status Changed to Materials Ordered' })
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => base44.entities.Tag.list(),
    staleTime: 60000
  });

  const glueDownProjects = projects.filter(p => {
    const sale = sales.find(s => s.id === p.sale);
    const lines = sale?.rfms_order_data?.result?.lines || sale?.rfms_order_data?.order?.result?.lines;
    if (!lines) return false;
    return lines.some(l => [l.styleName, l.supplierName, l.colorName, l.description].some(v => v?.toLowerCase().includes('glue')));
  });

  const materialsToOrderProjects = projects
    .filter(p => {
      const isCorrectStatus = p.status === 'Accepted' || p.status === 'Scheduled';
      const isNotOnHold = !p.installation_date_status ||
        (p.installation_date_status !== 'pending payment' &&
         p.installation_date_status !== 'pending contract' &&
         p.installation_date_status !== 'on hold' &&
         p.installation_date_status !== 'pending cancellation');
      return isCorrectStatus && isNotOnHold;
    })
    .sort((a, b) => {
      // Sort by install date ascending; no install date goes to end
      if (a.installation_date && b.installation_date) return new Date(a.installation_date) - new Date(b.installation_date);
      if (a.installation_date) return -1;
      if (b.installation_date) return 1;
      return new Date(a.created_date) - new Date(b.created_date);
    });

  // Today in AZ time (UTC-7)
  const todayAZ = (() => {
    const now = new Date(Date.now() - 7 * 60 * 60 * 1000);
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  })();
  const in3DaysAZ = new Date(todayAZ.getTime() + 3 * 24 * 60 * 60 * 1000);

  const materialsNext3Days = materialsToOrderProjects.filter(p => {
    if (!p.installation_date) return false;
    const d = new Date(p.installation_date + 'T00:00:00Z');
    return d >= todayAZ && d <= in3DaysAZ;
  });
  const materialsAfter3Days = materialsToOrderProjects.filter(p => {
    if (!p.installation_date) return true; // no date goes to "later"
    const d = new Date(p.installation_date + 'T00:00:00Z');
    return d > in3DaysAZ || d < todayAZ;
  });

  const materialsToOrder3Plus = materialsToOrderProjects.filter(p => calculateBusinessDays(p.created_date, p.installation_date_status, p.hold_cleared_date) >= 3);
  const materialsToOrderUnder3 = materialsToOrderProjects.filter(p => calculateBusinessDays(p.created_date, p.installation_date_status, p.hold_cleared_date) < 3);

  const needsAttentionProjects = projects.filter(p => p.installation_date_status && HOLD_STATUSES.includes(p.installation_date_status));
  const needsWelcomeCall = projects.filter(p => !p.welcome_call_completed_date);
  const needsCheckIn = projects.filter(p => p.welcome_call_completed_date && !p.check_in_completed_date);

  const filteredProjects = (() => {
    let filtered = projects;
    if (statusFilter === 'materials_to_order_3plus') {
      filtered = materialsToOrder3Plus;
    } else if (statusFilter === 'materials_to_order_under3') {
      filtered = materialsToOrderUnder3;
    } else if (statusFilter === 'materials_to_order') {
      // next 3 days first, then the rest — both already sorted by install date
      filtered = [...materialsNext3Days, ...materialsAfter3Days];
    } else if (statusFilter === 'needs_attention') {
      filtered = needsAttentionProjects;
    } else if (statusFilter === 'needs_welcome_call') {
      filtered = needsWelcomeCall;
    } else if (statusFilter === 'needs_check_in') {
      filtered = needsCheckIn;
    } else if (statusFilter === 'glue_down') {
      filtered = glueDownProjects;
    } else {
      filtered = projects.filter(project => {
        const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
        return matchesStatus;
      });
    }

    if (selectedTagIds.length > 0) {
      filtered = filtered.filter(project =>
        selectedTagIds.some(tagId => project.tags?.includes(tagId))
      );
    }

    if (!searchQuery) return filtered;

    const normalize = (str) => str.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const query = normalize(searchQuery);
    const queryTokens = query.split(' ').filter(Boolean);

    return filtered.filter(project => {
      const customer = customers.find(c => c.id === project.customer);
      const firstName = customer?.first_name?.toLowerCase() || '';
      const lastName = customer?.last_name?.toLowerCase() || '';
      const customerName = `${firstName} ${lastName}`.trim();
      const customerNameReversed = `${lastName} ${firstName}`.trim();
      const sale = sales.find(s => s.id === project.sale);
      const invoiceNumber = sale?.invoice_number?.toLowerCase() || '';
      const allTokensMatch = queryTokens.every(token =>
        customerName.includes(token) ||
        customerNameReversed.includes(token) ||
        invoiceNumber.includes(token)
      );
      return allTokensMatch;
    });
  })();

  const statusCounts = {
    all: projects.length,
    'glue_down': glueDownProjects.length,
    'materials_to_order': materialsToOrderProjects.length,
    'materials_next_3_days': materialsNext3Days.length,
    'materials_to_order_3plus': materialsToOrder3Plus.length,
    'materials_to_order_under3': materialsToOrderUnder3.length,
    'needs_welcome_call': needsWelcomeCall.length,
    'needs_check_in': needsCheckIn.length,
    'Accepted': projects.filter(p => p.status === 'Accepted').length,
    'Materials Ordered': projects.filter(p => p.status === 'Materials Ordered').length,
    'Scheduled': projects.filter(p => p.status === 'Scheduled').length,
    'In Progress': projects.filter(p => p.status === 'In Progress').length,
    'Quality Checks': projects.filter(p => p.status === 'Quality Checks').length,
    'Completed': projects.filter(p => p.status === 'Completed').length
  };

  // Presentational rollups over the already-fetched sets (no new fetch logic).
  const activeCount = projects.filter(p => p.status !== 'Completed').length;
  const projectValue = projects.reduce((sum, p) => {
    const s = sales.find(sa => sa.id === p.sale);
    return sum + (s?.sale_amount || 0);
  }, 0);
  const materialsActive =
    statusFilter === 'materials_to_order' ||
    statusFilter === 'materials_to_order_3plus' ||
    statusFilter === 'materials_to_order_under3';

  const pipelineStages = PROJECT_STATUSES.map((name) => ({ name, count: statusCounts[name] }));

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Install Ops"
          title="Projects"
          subtitle="Track installation projects from start to completion."
          actions={
            <>
              <div className="flex overflow-hidden rounded-lg border border-border">
                <button
                  onClick={() => setViewMode('list')}
                  className={cn('flex items-center gap-1.5 px-3 py-2 text-sm transition-colors', viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted')}
                >
                  <List className="h-4 w-4" /> List
                </button>
                <button
                  onClick={() => setViewMode('calendar')}
                  className={cn('flex items-center gap-1.5 px-3 py-2 text-sm transition-colors', viewMode === 'calendar' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted')}
                >
                  <CalendarIcon className="h-4 w-4" /> Calendar
                </button>
              </div>
              <Button variant="accent" onClick={() => setShowNewProject(true)}>
                <Plus className="mr-2 h-4 w-4" />New Project
              </Button>
            </>
          }
        />

        {/* Headline metrics */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Active Projects"
            value={activeCount}
            hero
            foot="Open across every install stage"
          />
          <KpiTile
            label="Materials to Order"
            value={materialsToOrderProjects.length}
            foot={`${materialsToOrder3Plus.length} at 3+ business days`}
            onClick={() => setStatusFilter('materials_to_order')}
          />
          <KpiTile
            label="Needs Attention"
            value={needsAttentionProjects.length}
            foot="On hold or pending"
            onClick={() => setStatusFilter('needs_attention')}
          />
          <KpiTile
            label="Total Value"
            value={money(projectValue)}
            foot="Across all projects"
          />
        </div>

        {/* Lifecycle funnel */}
        <ModuleCard
          title="Pipeline by Stage"
          subtitle="Projects across the install lifecycle"
          icon={Layers}
        >
          <div className="p-4">
            <PipelineBar stages={pipelineStages} />
          </div>
        </ModuleCard>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by customer name or invoice number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-11 border-border bg-card pl-10"
          />
        </div>

        {/* Tag Filters */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Tag className="h-3.5 w-3.5" /> Filter by Tag
            </span>
            {allTags.map(tag => (
              <label key={tag.id} className="flex cursor-pointer items-center gap-1.5">
                <Checkbox
                  checked={selectedTagIds.includes(tag.id)}
                  onCheckedChange={(checked) => {
                    setSelectedTagIds(prev =>
                      checked ? [...prev, tag.id] : prev.filter(id => id !== tag.id)
                    );
                  }}
                />
                <span className="text-sm text-foreground">
                  {tag.color && <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />}
                  {tag.emoji && <span className="mr-0.5">{tag.emoji}</span>}
                  {tag.name}
                </span>
              </label>
            ))}
            {selectedTagIds.length > 0 && (
              <button
                onClick={() => setSelectedTagIds([])}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Status Tabs */}
        <div className="space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setStatusFilter('all')} className={pillCls(statusFilter === 'all')}>
              All ({statusCounts.all})
            </button>
            <button onClick={() => setStatusFilter('materials_to_order')} className={pillCls(materialsActive)}>
              📦 All Materials to Order ({statusCounts.materials_to_order})
            </button>
            <button onClick={() => setStatusFilter('needs_attention')} className={pillCls(statusFilter === 'needs_attention')}>
              ⚠️ Needs Attention ({needsAttentionProjects.length})
            </button>
            <button onClick={() => setStatusFilter('needs_welcome_call')} className={pillCls(statusFilter === 'needs_welcome_call')}>
              📞 Needs Welcome Call ({statusCounts.needs_welcome_call})
            </button>
            <button onClick={() => setStatusFilter('needs_check_in')} className={pillCls(statusFilter === 'needs_check_in')}>
              ✅ Needs Check-In ({statusCounts.needs_check_in})
            </button>
            <button onClick={() => setStatusFilter('glue_down')} className={pillCls(statusFilter === 'glue_down')}>
              🔧 Glue Down ({statusCounts.glue_down})
            </button>
            {PROJECT_STATUSES.map(status => (
              <button key={status} onClick={() => setStatusFilter(status)} className={pillCls(statusFilter === status)}>
                {status} ({statusCounts[status]})
              </button>
            ))}
          </div>

          {materialsActive && (
            <div className="ml-4 flex gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setStatusFilter('materials_to_order_3plus')}
                className={subPillCls(statusFilter === 'materials_to_order_3plus')}
              >
                3+ Business Days ({statusCounts.materials_to_order_3plus})
              </button>
              <button
                onClick={() => setStatusFilter('materials_to_order_under3')}
                className={subPillCls(statusFilter === 'materials_to_order_under3')}
              >
                Under 3 Business Days ({statusCounts.materials_to_order_under3})
              </button>
            </div>
          )}
        </div>

        {/* Admin Past Due Copy Panel */}
        {currentUser?.role === 'admin' && (() => {
          const AZ_OFFSET_MS = 7 * 60 * 60 * 1000;
          const nowAZ = new Date(Date.now() - AZ_OFFSET_MS);
          // Midnight AZ time = midnight UTC + 7 hours (since AZ is UTC-7)
          const todayAZStart = new Date(Date.UTC(nowAZ.getUTCFullYear(), nowAZ.getUTCMonth(), nowAZ.getUTCDate()) + AZ_OFFSET_MS);
          const yesterdayAZStart = new Date(todayAZStart.getTime() - 24 * 60 * 60 * 1000);
          const yesterdayAZEnd = todayAZStart;

          // Build a map of project_id -> when it was logged as "Status Changed to Materials Ordered"
          const statusChangedMap = new Map();
          materialsOrderedLogs.forEach(log => {
            const logTime = new Date(log.created_date);
            const existing = statusChangedMap.get(log.project);
            // Keep the most recent log for each project
            if (!existing || logTime > existing) {
              statusChangedMap.set(log.project, logTime);
            }
          });

          const materialsOrderedYesterdayProjects = projects.filter(p => {
            if (p.status !== 'Materials Ordered') return false;
            const logTime = statusChangedMap.get(p.id);
            if (!logTime) return false;
            const logAZ = new Date(logTime.getTime() - AZ_OFFSET_MS);
            return logAZ >= yesterdayAZStart && logAZ < yesterdayAZEnd;
          });

          const materialsOrderedTodayProjects = projects.filter(p => {
            if (p.status !== 'Materials Ordered') return false;
            const logTime = statusChangedMap.get(p.id);
            if (!logTime) return false;
            const logAZ = new Date(logTime.getTime() - AZ_OFFSET_MS);
            return logAZ >= todayAZStart;
          });

          const materialsOrderedYesterday = materialsOrderedYesterdayProjects.length;
          const materialsOrderedToday = materialsOrderedTodayProjects.length;

          const pastDueLines = projects
            .filter(p => {
              const bd = calculateBusinessDays(p.created_date, p.installation_date_status, p.hold_cleared_date);
              const onHold = p.installation_date_status && HOLD_STATUSES.includes(p.installation_date_status);
              return !onHold && bd >= 3 && (p.status === 'Accepted' || p.status === 'Scheduled');
            })
            .sort((a, b) => new Date(a.created_date) - new Date(b.created_date))
            .map(p => {
              const c = customers.find(cu => cu.id === p.customer);
              const s = sales.find(sa => sa.id === p.sale);
              const bd = calculateBusinessDays(p.created_date, p.installation_date_status, p.hold_cleared_date);
              const jobName = c ? `${c.first_name} ${c.last_name}` : 'Unknown';
              const cgNumber = s?.invoice_number || 'N/A';
              const createdDate = p.created_date
                ? format(new Date(p.created_date), 'MM/dd/yyyy')
                : 'N/A';
              const status = p.installation_date_status || p.status;
              const installDate = p.installation_date ? format(new Date(p.installation_date + 'T00:00:00'), 'MM/dd/yyyy') : 'No Install Date';
              return `Job: ${jobName} | CG#: ${cgNumber} | Created: ${createdDate} | Install: ${installDate} | Status: ${status} | Days: ${bd}`;
            });

          if (pastDueLines.length === 0 && materialsOrderedYesterday === 0) return null;

          return (
            <div className="rounded-xl border border-warn/30 bg-warn/[0.07] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-semibold text-warn">⚠️ {pastDueLines.length} Jobs — 3+ Business Days Past Due</p>
                  <button
                    onClick={() => setOrderedView(v => v === 'today' ? null : 'today')}
                    className="text-left text-xs text-warn/90 transition-colors hover:text-warn"
                  >
                    📦 Jobs Ordered Material Today: <strong>{materialsOrderedToday}</strong>
                    <span className="ml-1 text-warn/60">{orderedView === 'today' ? '▲' : '▼'}</span>
                  </button>
                  <button
                    onClick={() => setOrderedView(v => v === 'yesterday' ? null : 'yesterday')}
                    className="text-left text-xs text-warn/90 transition-colors hover:text-warn"
                  >
                    📦 Jobs Ordered Material Yesterday: <strong>{materialsOrderedYesterday}</strong>
                    <span className="ml-1 text-warn/60">{orderedView === 'yesterday' ? '▲' : '▼'}</span>
                  </button>
                </div>
                <button
                  onClick={() => {
                    const header = `📦 Jobs Ordered Material Today: ${materialsOrderedToday}\n📦 Jobs Ordered Material Yesterday: ${materialsOrderedYesterday}\n\n`;
                    navigator.clipboard.writeText(header + pastDueLines.join('\n'));
                    setPastDueCopied(true);
                    setTimeout(() => setPastDueCopied(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-warn/30 bg-warn/15 px-3 py-1.5 text-xs font-medium text-warn transition-colors hover:bg-warn/25"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {pastDueCopied ? 'Copied!' : 'Copy All'}
                </button>
              </div>
              {orderedView && (
                <div className="mb-3 space-y-1">
                  <p className="mb-1 text-xs font-semibold text-warn">
                    {orderedView === 'today' ? '📦 Ordered Material Today' : '📦 Ordered Material Yesterday'}
                  </p>
                  {(orderedView === 'today' ? materialsOrderedTodayProjects : materialsOrderedYesterdayProjects).length === 0 ? (
                    <p className="text-xs italic text-muted-foreground">No jobs found.</p>
                  ) : (
                    (orderedView === 'today' ? materialsOrderedTodayProjects : materialsOrderedYesterdayProjects).map((p, i) => {
                      const c = customers.find(cu => cu.id === p.customer);
                      const s = sales.find(sa => sa.id === p.sale);
                      const jobName = c ? `${c.first_name} ${c.last_name}` : 'Unknown';
                      const cgNumber = s?.invoice_number || 'N/A';
                      const installDate = p.installation_date ? format(new Date(p.installation_date + 'T00:00:00'), 'MM/dd/yyyy') : 'No Install Date';
                      const createdDate = p.created_date ? format(new Date(p.created_date), 'MM/dd/yyyy') : 'N/A';
                      return (
                        <p key={i} className="rounded border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground">
                          Job: {jobName} | CG#: {cgNumber} | Created: {createdDate} | Install: {installDate}
                        </p>
                      );
                    })
                  )}
                </div>
              )}
              <div className="space-y-1">
                {pastDueLines.map((line, i) => (
                  <p key={i} className="rounded border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground">{line}</p>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Projects List / Calendar */}
        <div className={viewMode === 'calendar' ? '' : 'hidden'}>
          <ProjectsCalendarView
            projects={filteredProjects}
            customers={customers}
            sales={sales}
            enabled={viewMode === 'calendar'}
          />
        </div>
        {viewMode === 'list' && (
          isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-14 text-center">
            <ClipboardCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
            <h3 className="text-sm font-semibold text-foreground">No projects found</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your filters.'
                : 'Projects will appear here when sales are converted to projects.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {statusFilter === 'materials_to_order' && materialsNext3Days.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 rounded-full border border-crit/30 bg-crit/15 px-3 py-1 text-xs font-bold text-crit">
                  🔥 Next 3 Days ({materialsNext3Days.length})
                </div>
                <div className="h-px flex-1 bg-crit/25" />
              </div>
            )}
            {filteredProjects.map((project, index) => {
              // Insert divider between next-3-days and later sections
              const isMatAll = statusFilter === 'materials_to_order';
              const isFirst3DaysItem = isMatAll && materialsNext3Days.length > 0 && index === materialsNext3Days.length;
              const customer = customers.find(c => c.id === project.customer);
              const customerName = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown';
              const sale = sales.find(s => s.id === project.sale);

              const getLatestCustomerExperience = () => {
                const actions = [
                  { date: project.welcome_call_attempted_date, label: 'Welcome Call Attempted', tone: 'info' },
                  { date: project.welcome_call_completed_date, label: 'Welcome Call Completed', tone: 'good' },
                  { date: project.check_in_attempted_date, label: 'Check-In Attempted', tone: 'info' },
                  { date: project.check_in_completed_date, label: 'Check-In Completed', tone: 'good' },
                  { date: project.final_call_attempted_date, label: 'Final Call Attempted', tone: 'info' },
                  { date: project.final_call_completed_date, label: 'Final Call Completed', tone: 'good' }
                ].filter(a => a.date);
                if (actions.length === 0) return null;
                return actions.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
              };

              const latestCustomerExperience = getLatestCustomerExperience();
              const businessDays = calculateBusinessDays(project.created_date, project.installation_date_status, project.hold_cleared_date);
              const isOnHold = project.installation_date_status && HOLD_STATUSES.includes(project.installation_date_status);
              const isPastDue = (project.status === 'Accepted' || project.status === 'Scheduled') && !isOnHold && businessDays >= 3;
              const welcomeCallPastDue = !isOnHold && businessDays >= 3 && !project.welcome_call_completed_date;
              const isGlueDown = (() => {
                const lines = sale?.rfms_order_data?.result?.lines || sale?.rfms_order_data?.order?.result?.lines;
                if (!lines) return false;
                return lines.some(l => [l.styleName, l.supplierName, l.colorName, l.description].some(v => v?.toLowerCase().includes('glue')));
              })();

              const isPreConstruction1978 = (() => {
                if (!sale?.appointment) return false;
                const checklist = checklists.find(c => c.appointment === sale.appointment);
                return checklist?.home_built_era === 'On or before 1978';
              })();

              return (
                <React.Fragment key={project.id}>
                {isFirst3DaysItem && (
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex-shrink-0 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-bold text-muted-foreground">
                      📅 Later ({materialsAfter3Days.length})
                    </div>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className="rounded-xl border border-border bg-card transition-all hover:border-brand-pink/30 hover:shadow-md">
                  <Link to={createPageUrl('ProjectDetail') + `?id=${project.id}`} className="block p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-display text-base font-bold tracking-tight text-foreground">{customerName}</h3>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <StatusPill tone={STATUS_TONE[project.status] || 'neutral'}>{project.status}</StatusPill>
                          {isGlueDown && <StatusPill tone="warn">🔧 Glue Down</StatusPill>}
                          {isPreConstruction1978 && <StatusPill tone="crit">⚠️ Pre-1978 Home</StatusPill>}
                          {isPastDue && <StatusPill tone="crit">Past Due</StatusPill>}
                          {welcomeCallPastDue && <StatusPill tone="warn">⚠️ Welcome Call Past Due</StatusPill>}
                          {project.welcome_call_attempted_date && !project.welcome_call_completed_date && (
                            <StatusPill tone="info">📞 Welcome Call Attempted - Needs Completion</StatusPill>
                          )}
                          {project.installation_date_status && (
                            <StatusPill tone="warn">{project.installation_date_status}</StatusPill>
                          )}
                          {latestCustomerExperience && (
                            <StatusPill tone={latestCustomerExperience.tone}>{latestCustomerExperience.label}</StatusPill>
                          )}
                        </div>
                        {project.tags && project.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {project.tags.map(tagId => {
                              const tag = allTags.find(t => t.id === tagId);
                              return tag ? <TagBadge key={tagId} tag={tag} /> : null;
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 space-y-1.5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>Created: {format(new Date(project.created_date), 'MMM d, yyyy h:mm a')}</span>
                        <span className="ml-1 inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                          {businessDays} business {businessDays === 1 ? 'day' : 'days'} since cleared
                        </span>
                      </div>
                      {project.installation_date && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CalendarIcon className="h-4 w-4" />
                          <span>Install: {format(new Date(project.installation_date + 'T00:00:00'), 'MMM d, yyyy')}</span>
                        </div>
                      )}
                      {(project.scheduled_start_date || project.scheduled_end_date) && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CalendarIcon className="h-4 w-4" />
                          {project.scheduled_start_date && (
                            <span>{format(new Date(project.scheduled_start_date + 'T00:00:00'), 'MMM d, yyyy')}</span>
                          )}
                          {project.scheduled_start_date && project.scheduled_end_date && <span>-</span>}
                          {project.scheduled_end_date && (
                            <span>{format(new Date(project.scheduled_end_date + 'T00:00:00'), 'MMM d, yyyy')}</span>
                          )}
                        </div>
                      )}
                      {sale?.location_address && (
                        <div className="flex items-start gap-2 text-sm text-muted-foreground">
                          <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span className="line-clamp-1">{sale.location_address}</span>
                        </div>
                      )}
                      {sale?.invoice_number && (
                        <div className="text-sm text-muted-foreground">
                          <span>Invoice: </span>
                          <span className="font-medium text-foreground">#{sale.invoice_number}</span>
                        </div>
                      )}

                    </div>

                    {project.notes && project.notes.length > 0 && (
                      <div className="mt-3 border-t border-border pt-3">
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">Project Notes</p>
                        <div className="max-h-48 space-y-2 overflow-y-auto overflow-x-hidden overscroll-contain pr-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                          {[...project.notes].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map((note, idx) => {
                            const originalIndex = project.notes.findIndex(n => n === note || (n.timestamp === note.timestamp && n.user_email === note.user_email));
                            return (
                              <div key={idx} className="break-words rounded-lg border border-border bg-secondary p-2.5" onClick={e => e.preventDefault()}>
                                <div className="mb-1 flex items-start justify-between gap-2">
                                  <p className="text-xs font-semibold text-foreground">{note.user_name}</p>
                                  {note.timestamp && (
                                    <p className="flex-shrink-0 text-[10px] text-muted-foreground">
                                      {format(new Date(note.timestamp), 'MMM d, yyyy h:mm a')}
                                    </p>
                                  )}
                                </div>
                                <p className="text-xs leading-relaxed text-muted-foreground">{note.content}</p>
                                <div onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
                                  <NoteReactions
                                    note={note}
                                    onReactionAdd={(emoji) => handleAddReaction(project, originalIndex, emoji)}
                                    currentUserEmail={currentUser?.email}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </Link>
                </div>
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </div>

      {/* New Project Dialog */}
      <Dialog open={showNewProject} onOpenChange={setShowNewProject}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Temporary Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First Name *</Label>
                <Input value={newProjectForm.first_name} onChange={e => setNewProjectForm(f => ({ ...f, first_name: e.target.value }))} placeholder="First name" />
              </div>
              <div>
                <Label>Last Name *</Label>
                <Input value={newProjectForm.last_name} onChange={e => setNewProjectForm(f => ({ ...f, last_name: e.target.value }))} placeholder="Last name" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email</Label>
                <Input type="email" value={newProjectForm.email} onChange={e => setNewProjectForm(f => ({ ...f, email: e.target.value }))} placeholder="customer@email.com" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input type="tel" value={newProjectForm.phone} onChange={e => setNewProjectForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" />
              </div>
            </div>
            <div>
              <Label>Address</Label>
              <Input value={newProjectForm.address} onChange={e => setNewProjectForm(f => ({ ...f, address: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select value={newProjectForm.status} onValueChange={v => setNewProjectForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Installation Date</Label>
                <Input type="date" value={newProjectForm.installation_date} onChange={e => setNewProjectForm(f => ({ ...f, installation_date: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={3} value={newProjectForm.notes} onChange={e => setNewProjectForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewProject(false)}>Cancel</Button>
            <Button onClick={handleCreateProject} disabled={creatingProject || !newProjectForm.first_name || !newProjectForm.last_name} className="bg-primary text-primary-foreground hover:opacity-90">
              {creatingProject ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</> : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
