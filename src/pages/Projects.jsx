import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Smile,
  Copy,
  Plus,
  List,
  LayoutGrid,
  Tag
} from 'lucide-react';
import NoteReactions from '@/components/projects/NoteReactions';
import TagBadge from '@/components/tags/TagBadge';
import ProjectsCalendarView from '@/components/projects/ProjectsCalendarView';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

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

const statusColors = {
  'Accepted': 'bg-blue-100 text-blue-800 border-blue-200',
  'Materials Ordered': 'bg-purple-100 text-purple-800 border-purple-200',
  'Scheduled': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'In Progress': 'bg-orange-100 text-orange-800 border-orange-200',
  'Quality Checks': 'bg-indigo-100 text-indigo-800 border-indigo-200',
  'Completed': 'bg-green-100 text-green-800 border-green-200'
};

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
      const customer = await base44.entities.Customer.create({
        first_name: newProjectForm.first_name,
        last_name: newProjectForm.last_name,
        email: newProjectForm.email || 'temp@example.com',
        phone: newProjectForm.phone || '0000000000',
        address_line1: newProjectForm.address || ''
      });
      const projectData = {
        customer: customer.id,
        status: newProjectForm.status,
        installation_date: newProjectForm.installation_date || undefined
      };
      if (newProjectForm.notes) {
        projectData.notes = [{
          content: newProjectForm.notes,
          user_name: 'Manual Entry',
          user_email: 'system',
          timestamp: new Date().toISOString()
        }];
      }
      const newProject = await base44.entities.Project.create(projectData);
      // Log who created the project manually
      await base44.entities.ProjectLog.create({
        project: newProject.id,
        action: 'Project Created',
        details: `Manually created via New Project button`,
        user_email: currentUser?.email || 'Unknown',
        user_name: currentUser?.full_name || currentUser?.email || 'Unknown'
      });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowNewProject(false);
      setNewProjectForm({ first_name: '', last_name: '', email: '', phone: '', address: '', installation_date: '', status: 'Scheduled', notes: '' });
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

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-800">Projects</h1>
              <p className="text-slate-500 mt-1">Track installation projects from start to completion</p>
            </div>
            <div className="flex items-center gap-2 self-start md:self-auto">
              <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('list')}
                  className={cn('px-3 py-2 text-sm flex items-center gap-1.5 transition-colors', viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
                >
                  <List className="w-4 h-4" /> List
                </button>
                <button
                  onClick={() => setViewMode('calendar')}
                  className={cn('px-3 py-2 text-sm flex items-center gap-1.5 transition-colors', viewMode === 'calendar' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
                >
                  <CalendarIcon className="w-4 h-4" /> Calendar
                </button>
              </div>
            <Button onClick={() => setShowNewProject(true)} className="bg-indigo-600 hover:bg-indigo-700">
              <Plus className="w-4 h-4 mr-2" />New Project
            </Button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mt-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search by customer name or invoice number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 h-12 bg-white border-slate-200"
            />
          </div>

          {/* Tag Filters */}
          {allTags.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                <Tag className="w-3.5 h-3.5" /> Filter by Tag
              </span>
              {allTags.map(tag => (
                <label key={tag.id} className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={selectedTagIds.includes(tag.id)}
                    onCheckedChange={(checked) => {
                      setSelectedTagIds(prev =>
                        checked ? [...prev, tag.id] : prev.filter(id => id !== tag.id)
                      );
                    }}
                  />
                  <span className="text-sm text-slate-700">
                    {tag.color && <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: tag.color }} />}
                    {tag.emoji && <span className="mr-0.5">{tag.emoji}</span>}
                    {tag.name}
                  </span>
                </label>
              ))}
              {selectedTagIds.length > 0 && (
                <button
                  onClick={() => setSelectedTagIds([])}
                  className="text-xs text-slate-400 hover:text-slate-600 underline"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Status Tabs */}
          <div className="space-y-2 mt-6">
            <div className="flex gap-2 overflow-x-auto pb-2">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('all')}
                className={cn("h-10 whitespace-nowrap", statusFilter === 'all' ? 'bg-indigo-600 hover:bg-indigo-700' : '')}
              >
                All ({statusCounts.all})
              </Button>
              <Button
                variant={statusFilter === 'materials_to_order' || statusFilter === 'materials_to_order_3plus' || statusFilter === 'materials_to_order_under3' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('materials_to_order')}
                className={cn("h-10 whitespace-nowrap", (statusFilter === 'materials_to_order' || statusFilter === 'materials_to_order_3plus' || statusFilter === 'materials_to_order_under3') ? 'bg-indigo-600 hover:bg-indigo-700' : '')}
              >
                📦 All Materials to Order ({statusCounts.materials_to_order})
              </Button>
              <Button
                variant={statusFilter === 'needs_attention' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('needs_attention')}
                className={cn("h-10 whitespace-nowrap", statusFilter === 'needs_attention' ? 'bg-indigo-600 hover:bg-indigo-700' : '')}
              >
                ⚠️ Needs Attention ({needsAttentionProjects.length})
              </Button>
              <Button
                variant={statusFilter === 'needs_welcome_call' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('needs_welcome_call')}
                className={cn("h-10 whitespace-nowrap", statusFilter === 'needs_welcome_call' ? 'bg-indigo-600 hover:bg-indigo-700' : '')}
              >
                📞 Needs Welcome Call ({statusCounts.needs_welcome_call})
              </Button>
              <Button
                variant={statusFilter === 'needs_check_in' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('needs_check_in')}
                className={cn("h-10 whitespace-nowrap", statusFilter === 'needs_check_in' ? 'bg-indigo-600 hover:bg-indigo-700' : '')}
              >
                ✅ Needs Check-In ({statusCounts.needs_check_in})
              </Button>
              <Button
                variant={statusFilter === 'glue_down' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('glue_down')}
                className={cn("h-10 whitespace-nowrap", statusFilter === 'glue_down' ? 'bg-amber-600 hover:bg-amber-700' : 'border-amber-300 text-amber-700 hover:bg-amber-50')}
              >
                🔧 Glue Down ({statusCounts.glue_down})
              </Button>
              {Object.keys(statusColors).map(status => (
                <Button
                  key={status}
                  variant={statusFilter === status ? 'default' : 'outline'}
                  onClick={() => setStatusFilter(status)}
                  className={cn("h-10 whitespace-nowrap", statusFilter === status ? 'bg-indigo-600 hover:bg-indigo-700' : '')}
                >
                  {status} ({statusCounts[status]})
                </Button>
              ))}
            </div>
            
            {(statusFilter === 'materials_to_order' || statusFilter === 'materials_to_order_3plus' || statusFilter === 'materials_to_order_under3') && (
              <div className="flex gap-2 ml-4 overflow-x-auto pb-2">
                <Button
                  variant={statusFilter === 'materials_to_order_3plus' ? 'default' : 'outline'}
                  onClick={() => setStatusFilter('materials_to_order_3plus')}
                  size="sm"
                  className={cn("h-8 whitespace-nowrap", statusFilter === 'materials_to_order_3plus' ? 'bg-indigo-600 hover:bg-indigo-700' : '')}
                >
                  3+ Business Days ({statusCounts.materials_to_order_3plus})
                </Button>
                <Button
                  variant={statusFilter === 'materials_to_order_under3' ? 'default' : 'outline'}
                  onClick={() => setStatusFilter('materials_to_order_under3')}
                  size="sm"
                  className={cn("h-8 whitespace-nowrap", statusFilter === 'materials_to_order_under3' ? 'bg-indigo-600 hover:bg-indigo-700' : '')}
                >
                  Under 3 Business Days ({statusCounts.materials_to_order_under3})
                </Button>
              </div>
            )}
          </div>
        </div>
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
          const logTime = new Date(log.created_date?.includes('Z') ? log.created_date : (log.created_date + 'Z'));
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
              ? format(new Date(p.created_date.includes('Z') ? p.created_date : p.created_date + 'Z'), 'MM/dd/yyyy')
              : 'N/A';
            const status = p.installation_date_status || p.status;
            const installDate = p.installation_date ? format(new Date(p.installation_date + 'T00:00:00'), 'MM/dd/yyyy') : 'No Install Date';
            return `Job: ${jobName} | CG#: ${cgNumber} | Created: ${createdDate} | Install: ${installDate} | Status: ${status} | Days: ${bd}`;
          });

        if (pastDueLines.length === 0 && materialsOrderedYesterday === 0) return null;

        return (
          <div className="max-w-7xl mx-auto px-6 pt-6">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-semibold text-amber-800">⚠️ {pastDueLines.length} Jobs — 3+ Business Days Past Due</p>
                  <button
                    onClick={() => setOrderedView(v => v === 'today' ? null : 'today')}
                    className="text-xs text-amber-700 hover:text-amber-900 text-left transition-colors"
                  >
                    📦 Jobs Ordered Material Today: <strong>{materialsOrderedToday}</strong>
                    <span className="ml-1 text-amber-500">{orderedView === 'today' ? '▲' : '▼'}</span>
                  </button>
                  <button
                    onClick={() => setOrderedView(v => v === 'yesterday' ? null : 'yesterday')}
                    className="text-xs text-amber-700 hover:text-amber-900 text-left transition-colors"
                  >
                    📦 Jobs Ordered Material Yesterday: <strong>{materialsOrderedYesterday}</strong>
                    <span className="ml-1 text-amber-500">{orderedView === 'yesterday' ? '▲' : '▼'}</span>
                  </button>
                </div>
                <button
                  onClick={() => {
                    const header = `📦 Jobs Ordered Material Today: ${materialsOrderedToday}\n📦 Jobs Ordered Material Yesterday: ${materialsOrderedYesterday}\n\n`;
                    navigator.clipboard.writeText(header + pastDueLines.join('\n'));
                    setPastDueCopied(true);
                    setTimeout(() => setPastDueCopied(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-amber-100 border border-amber-300 text-amber-800 hover:bg-amber-200 transition-colors font-medium"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {pastDueCopied ? 'Copied!' : 'Copy All'}
                </button>
              </div>
              {orderedView && (
                <div className="mb-3 space-y-1">
                  <p className="text-xs font-semibold text-amber-800 mb-1">
                    {orderedView === 'today' ? '📦 Ordered Material Today' : '📦 Ordered Material Yesterday'}
                  </p>
                  {(orderedView === 'today' ? materialsOrderedTodayProjects : materialsOrderedYesterdayProjects).length === 0 ? (
                    <p className="text-xs text-amber-600 italic">No jobs found.</p>
                  ) : (
                    (orderedView === 'today' ? materialsOrderedTodayProjects : materialsOrderedYesterdayProjects).map((p, i) => {
                      const c = customers.find(cu => cu.id === p.customer);
                      const s = sales.find(sa => sa.id === p.sale);
                      const jobName = c ? `${c.first_name} ${c.last_name}` : 'Unknown';
                      const cgNumber = s?.invoice_number || 'N/A';
                      const installDate = p.installation_date ? format(new Date(p.installation_date + 'T00:00:00'), 'MM/dd/yyyy') : 'No Install Date';
                      const createdDate = p.created_date ? format(new Date(p.created_date.includes('Z') ? p.created_date : p.created_date + 'Z'), 'MM/dd/yyyy') : 'N/A';
                      return (
                        <p key={i} className="text-xs font-mono text-slate-700 bg-white border border-amber-200 rounded px-3 py-1.5">
                          Job: {jobName} | CG#: {cgNumber} | Created: {createdDate} | Install: {installDate}
                        </p>
                      );
                    })
                  )}
                </div>
              )}
              <div className="space-y-1">
                {pastDueLines.map((line, i) => (
                  <p key={i} className="text-xs font-mono text-slate-700 bg-white border border-amber-100 rounded px-3 py-1.5">{line}</p>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Projects List / Calendar */}
      <div className="max-w-7xl mx-auto px-6 py-8">
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
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-100">
            <ClipboardCheck className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-800">No projects found</h3>
            <p className="text-slate-500 mt-1">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Projects will appear here when sales are converted to projects'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {statusFilter === 'materials_to_order' && materialsNext3Days.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 bg-red-100 border border-red-300 text-red-800 text-xs font-bold px-3 py-1 rounded-full">
                  🔥 Next 3 Days ({materialsNext3Days.length})
                </div>
                <div className="flex-1 h-px bg-red-200" />
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
                  { date: project.welcome_call_attempted_date, label: 'Welcome Call Attempted', color: 'bg-blue-100 text-blue-800 border-blue-200' },
                  { date: project.welcome_call_completed_date, label: 'Welcome Call Completed', color: 'bg-green-100 text-green-800 border-green-200' },
                  { date: project.check_in_attempted_date, label: 'Check-In Attempted', color: 'bg-blue-100 text-blue-800 border-blue-200' },
                  { date: project.check_in_completed_date, label: 'Check-In Completed', color: 'bg-green-100 text-green-800 border-green-200' },
                  { date: project.final_call_attempted_date, label: 'Final Call Attempted', color: 'bg-blue-100 text-blue-800 border-blue-200' },
                  { date: project.final_call_completed_date, label: 'Final Call Completed', color: 'bg-green-100 text-green-800 border-green-200' }
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
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex-shrink-0 bg-slate-100 border border-slate-300 text-slate-600 text-xs font-bold px-3 py-1 rounded-full">
                      📅 Later ({materialsAfter3Days.length})
                    </div>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>
                )}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-white rounded-xl border border-slate-100 hover:shadow-lg hover:border-indigo-200 transition-all"
                >
                  <Link to={createPageUrl('ProjectDetail') + `?id=${project.id}`} className="block p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-slate-800">{customerName}</h3>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Badge variant="secondary" className={cn('border', statusColors[project.status])}>
                            {project.status}
                          </Badge>
                          {isGlueDown && (
                            <Badge className="border bg-amber-100 text-amber-800 border-amber-300 font-semibold">
                              🔧 Glue Down
                            </Badge>
                          )}
                          {isPreConstruction1978 && (
                            <Badge className="border bg-red-100 text-red-800 border-red-300 font-semibold">
                              ⚠️ Pre-1978 Home
                            </Badge>
                          )}
                          {isPastDue && (
                            <Badge className="border bg-red-100 text-red-800 border-red-200 font-semibold">
                              Past Due
                            </Badge>
                          )}
                          {welcomeCallPastDue && (
                            <Badge className="border bg-orange-100 text-orange-800 border-orange-200 font-semibold">
                              ⚠️ Welcome Call Past Due
                            </Badge>
                          )}
                          {project.welcome_call_attempted_date && !project.welcome_call_completed_date && (
                            <Badge className="border bg-blue-100 text-blue-800 border-blue-200">
                              📞 Welcome Call Attempted - Needs Completion
                            </Badge>
                          )}
                          {project.installation_date_status && (
                            <Badge className="border bg-red-100 text-red-800 border-red-200">
                              {project.installation_date_status}
                            </Badge>
                          )}
                          {latestCustomerExperience && (
                            <Badge variant="secondary" className={cn('border text-xs', latestCustomerExperience.color)}>
                              {latestCustomerExperience.label}
                            </Badge>
                          )}
                        </div>
                        {project.tags && project.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {project.tags.map(tagId => {
                              const tag = allTags.find(t => t.id === tagId);
                              return tag ? <TagBadge key={tagId} tag={tag} /> : null;
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <span>Created: {format(new Date(project.created_date + (project.created_date.includes('Z') ? '' : 'Z')), 'MMM d, yyyy h:mm a')}</span>
                        <Badge className="ml-2 bg-slate-100 text-slate-700 border-slate-200">
                          {businessDays} business {businessDays === 1 ? 'day' : 'days'} since cleared
                        </Badge>
                      </div>
                      {project.installation_date && (
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <CalendarIcon className="w-4 h-4 text-slate-400" />
                          <span>Install: {format(new Date(project.installation_date + 'T00:00:00'), 'MMM d, yyyy')}</span>
                        </div>
                      )}
                      {(project.scheduled_start_date || project.scheduled_end_date) && (
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <CalendarIcon className="w-4 h-4 text-slate-400" />
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
                        <div className="flex items-start gap-2 text-sm text-slate-600">
                          <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                          <span className="line-clamp-1">{sale.location_address}</span>
                        </div>
                      )}
                      {sale?.invoice_number && (
                        <div className="text-sm text-slate-600">
                          <span className="text-slate-500">Invoice: </span>
                          <span className="font-medium">#{sale.invoice_number}</span>
                        </div>
                      )}
                      
                    </div>

                    {project.notes && project.notes.length > 0 && (
                      <div className="border-t border-slate-200 pt-3 mt-3">
                        <p className="text-xs font-semibold text-slate-600 mb-2">Project Notes</p>
                        <div className="max-h-48 overflow-y-auto space-y-2 pr-2 overscroll-contain overflow-x-hidden" style={{ WebkitOverflowScrolling: 'touch' }}>
                          {[...project.notes].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map((note, idx) => {
                            const originalIndex = project.notes.findIndex(n => n === note || (n.timestamp === note.timestamp && n.user_email === note.user_email));
                            return (
                              <div key={idx} className="bg-slate-50 rounded-lg p-2.5 border border-slate-200 break-words" onClick={e => e.preventDefault()}>
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <p className="text-xs font-semibold text-slate-700">{note.user_name}</p>
                                  {note.timestamp && (
                                    <p className="text-[10px] text-slate-400 flex-shrink-0">
                                      {format(new Date(note.timestamp), 'MMM d, yyyy h:mm a')}
                                    </p>
                                  )}
                                </div>
                                <p className="text-xs text-slate-600 leading-relaxed">{note.content}</p>
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
                </motion.div>
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
                    {Object.keys(statusColors).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
            <Button onClick={handleCreateProject} disabled={creatingProject || !newProjectForm.first_name || !newProjectForm.last_name} className="bg-indigo-600 hover:bg-indigo-700">
              {creatingProject ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}