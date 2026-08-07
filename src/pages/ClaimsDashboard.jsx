import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Loader2, FileText, ClipboardList, Pencil, Trash2, XCircle, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import ProjectClaimForm from '@/components/projects/ProjectClaimForm';
import InspectionReportForm from '@/components/projects/InspectionReportForm';

const claimTypeColors = {
  'Claim': 'bg-red-100 text-red-800 border-red-200',
  'Repair': 'bg-orange-100 text-orange-800 border-orange-200',
  'Short Item': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Product Swap': 'bg-purple-100 text-purple-800 border-purple-200',
};

export default function ClaimsDashboard() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemType, setSelectedItemType] = useState(null);
  const [editingClaim, setEditingClaim] = useState(null);
  const [editingReport, setEditingReport] = useState(null);
  const [saving, setSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [installerSort, setInstallerSort] = useState({ col: 'total', dir: 'desc' });
  const [dcSort, setDcSort] = useState({ col: 'total', dir: 'desc' });

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const { data: inspectionReports = [], isLoading: loadingReports } = useQuery({
    queryKey: ['inspectionReports'],
    queryFn: () => base44.entities.InspectionReport.list('-created_date'),
  });

  const { data: claims = [], isLoading: loadingClaims } = useQuery({
    queryKey: ['projectClaims'],
    queryFn: () => base44.entities.ProjectClaim.list('-created_date'),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list(),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list(),
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['sales'],
    queryFn: () => base44.entities.Sale.list(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list(),
    staleTime: 5 * 60 * 1000,
  });

  const getDCName = (project) => {
    if (!project) return '—';
    const sale = sales.find(s => s.id === project.sale);
    if (!sale?.assigned_dc) return '—';
    const dc = teamMembers.find(tm => tm.id === sale.assigned_dc);
    return dc ? `${dc.first_name} ${dc.last_name}` : '—';
  };

  const normalize = (str) => str.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  const getCustomerName = (project) => {
    if (!project) return '';
    const customer = customers.find(c => c.id === project.customer);
    return customer ? `${customer.first_name} ${customer.last_name}` : '';
  };

  const matchesSearch = (item, project) => {
    if (!searchQuery) return true;
    const query = normalize(searchQuery);
    const tokens = query.split(' ').filter(Boolean);
    const customerName = normalize(getCustomerName(project) || item.customer_name || '');
    const customerNameParts = customerName.split(' ');
    const reversedName = [...customerNameParts].reverse().join(' ');
    const jobNumber = (item.job_number || '').toLowerCase();
    const address = (item.address || '').toLowerCase();
    return tokens.every(t =>
      customerName.includes(t) ||
      reversedName.includes(t) ||
      jobNumber.includes(t) ||
      address.includes(t)
    );
  };

  const filteredReports = inspectionReports.filter(r => {
    const project = projects.find(p => p.id === r.project);
    return matchesSearch(r, project);
  });

  const filteredClaims = claims.filter(c => {
    if (typeFilter !== 'all' && c.claim_type !== typeFilter) return false;
    const project = projects.find(p => p.id === c.project);
    return matchesSearch(c, project);
  });

  const isLoading = loadingReports || loadingClaims;

  const tabs = [
    { id: 'all', label: 'All', count: filteredReports.length + filteredClaims.length },
    { id: 'inspections', label: '🔍 Inspection Reports', count: filteredReports.length },
    { id: 'claims', label: '📋 Claims / Repairs / Short Items', count: filteredClaims.length },
    { id: 'by_installer', label: '👷 By Installer', count: null },
    { id: 'by_dc', label: '🎨 By Design Consultant', count: null },
  ];

  // Build installer breakdown from all claims (not filtered by search, but excluding cancelled)
  const claimTypes = ['Claim', 'Repair', 'Short Item', 'Product Swap'];

  const sortBreakdown = (entries, sort) => {
    return [...entries].sort((a, b) => {
      const aVal = sort.col === 'name' ? a[0] : (a[1][sort.col] || 0);
      const bVal = sort.col === 'name' ? b[0] : (b[1][sort.col] || 0);
      if (typeof aVal === 'string') return sort.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
    });
  };

  const installerBreakdown = React.useMemo(() => {
    const map = {};
    claims.forEach(claim => {
      const installers = claim.installers?.length ? claim.installers : claim.installer_name ? [claim.installer_name] : ['Unknown'];
      installers.forEach(installer => {
        if (!map[installer]) {
          map[installer] = { total: 0, open: 0, completed: 0, cancelled: 0 };
          claimTypes.forEach(t => { map[installer][t] = 0; });
        }
        map[installer][claim.claim_type] = (map[installer][claim.claim_type] || 0) + 1;
        map[installer].total += 1;
        if (claim.is_cancelled) map[installer].cancelled += 1;
        else if (claim.is_completed) map[installer].completed += 1;
        else map[installer].open += 1;
      });
    });
    return sortBreakdown(Object.entries(map), installerSort);
  }, [claims, installerSort]);

  // Build DC breakdown from all claims
  const dcBreakdown = React.useMemo(() => {
    const map = {};
    claims.forEach(claim => {
      const project = projects.find(p => p.id === claim.project);
      const dcName = getDCName(project);
      if (!map[dcName]) {
        map[dcName] = { total: 0, open: 0, completed: 0, cancelled: 0 };
        claimTypes.forEach(t => { map[dcName][t] = 0; });
      }
      map[dcName][claim.claim_type] = (map[dcName][claim.claim_type] || 0) + 1;
      map[dcName].total += 1;
      if (claim.is_cancelled) map[dcName].cancelled += 1;
      else if (claim.is_completed) map[dcName].completed += 1;
      else map[dcName].open += 1;
    });
    return sortBreakdown(Object.entries(map), dcSort);
  }, [claims, projects, sales, teamMembers, dcSort]);

  const handleDeleteClaim = async (claim) => {
    if (!window.confirm('Are you sure you want to delete this claim?')) return;
    await base44.entities.ProjectClaim.delete(claim.id);
    queryClient.invalidateQueries({ queryKey: ['projectClaims'] });
  };

  const handleCancelClaim = async (claim) => {
    if (!window.confirm('Are you sure you want to cancel this claim?')) return;
    await base44.entities.ProjectClaim.update(claim.id, { is_cancelled: true });
    queryClient.invalidateQueries({ queryKey: ['projectClaims'] });
  };

  const handleDeleteReport = async (report) => {
    if (!window.confirm('Are you sure you want to delete this inspection report?')) return;
    await base44.entities.InspectionReport.delete(report.id);
    queryClient.invalidateQueries({ queryKey: ['inspectionReports'] });
  };

  const handleCompleteClaim = async (claim) => {
    const completing = !claim.is_completed;
    await base44.entities.ProjectClaim.update(claim.id, {
      is_completed: completing,
      completed_by: completing ? (currentUser?.full_name || '') : null,
      completed_on: completing ? new Date().toISOString() : null,
    });
    queryClient.invalidateQueries({ queryKey: ['projectClaims'] });
    if (completing) {
      try {
        await base44.functions.invoke('sendProjectClaimCompletedEmail', { claimId: claim.id });
      } catch (e) {}
    }
  };

  const handleSaveClaim = async (formData) => {
    setSaving(true);
    await base44.entities.ProjectClaim.update(editingClaim.id, formData);
    queryClient.invalidateQueries({ queryKey: ['projectClaims'] });
    setSaving(false);
    setEditingClaim(null);
  };

  const handleSaveReport = async (formData) => {
    setSaving(true);
    await base44.entities.InspectionReport.update(editingReport.id, formData);
    queryClient.invalidateQueries({ queryKey: ['inspectionReports'] });
    setSaving(false);
    setEditingReport(null);
  };

  const SortTh = ({ col, label, sort, setSort, center = false }) => {
    const active = sort.col === col;
    const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th
        className={cn("px-4 py-3 text-slate-600 font-medium cursor-pointer select-none hover:bg-slate-100 transition-colors", center ? 'text-center' : 'text-left')}
        onClick={() => setSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' })}
      >
        <span className={cn("inline-flex items-center gap-1", center && "justify-center w-full")}>
          {label}
          <Icon className={cn("w-3 h-3", active ? 'text-indigo-600' : 'text-slate-400')} />
        </span>
      </th>
    );
  };

  const formatValue = (key, val) => {
    if (val === null || val === undefined || val === '') return '—';
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    if (Array.isArray(val)) return val.length === 0 ? '—' : `[${val.length} items]`;
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  return (
    <>
    {/* Edit Claim Form */}
    <ProjectClaimForm
      open={!!editingClaim}
      onClose={() => setEditingClaim(null)}
      onSave={handleSaveClaim}
      saving={saving}
      initialData={editingClaim}
    />

    {/* Edit Inspection Report Form */}
    <InspectionReportForm
      open={!!editingReport}
      onClose={() => setEditingReport(null)}
      onSave={handleSaveReport}
      saving={saving}
      initialData={editingReport}
    />

    {/* Detail Modal */}
    <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {selectedItemType === 'inspection' ? 'Inspection Report' : `${selectedItem?.claim_type || 'Claim'}`} Details
          </DialogTitle>
        </DialogHeader>
        {selectedItem && (
          <div className="space-y-1 text-sm">
            {Object.entries(selectedItem)
              .filter(([k]) => !['images', 'files', 'customer_signature'].includes(k))
              .map(([key, val]) => (
                <div key={key} className="flex gap-3 py-2 border-b border-slate-50">
                  <span className="text-slate-500 font-medium w-48 shrink-0 capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className="text-slate-800 break-all">{formatValue(key, val)}</span>
                </div>
              ))}
            {selectedItem.images?.length > 0 && (
              <div className="py-2">
                <p className="text-slate-500 font-medium mb-2">Images ({selectedItem.images.length})</p>
                <div className="flex flex-wrap gap-2">
                  {selectedItem.images.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                      <img src={url} alt={`Image ${i+1}`} className="w-20 h-20 object-cover rounded border border-slate-200" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {selectedItem?.project && (
          <div className="pt-4 border-t border-slate-100">
            <Link
              to={createPageUrl('ProjectDetail') + `?id=${selectedItem.project}`}
              className="text-indigo-600 hover:underline text-sm font-medium"
              onClick={() => setSelectedItem(null)}
            >
              View Full Project →
            </Link>
          </div>
        )}
      </DialogContent>
    </Dialog>

    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold text-slate-800">Claims & Inspections Dashboard</h1>
          <p className="text-slate-500 mt-1">View all inspection reports and claims / repairs / short items</p>

          <div className="relative mt-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search by customer name, job #, or address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 h-12 bg-white border-slate-200"
            />
          </div>

          <div className="flex gap-2 mt-6 overflow-x-auto pb-2">
            {tabs.map(tab => (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? 'default' : 'outline'}
                onClick={() => setActiveTab(tab.id)}
                className={cn("h-10 whitespace-nowrap", activeTab === tab.id ? 'bg-indigo-600 hover:bg-indigo-700' : '')}
              >
                {tab.label} ({tab.count})
              </Button>
            ))}
            {(activeTab === 'claims' || activeTab === 'all') && (
              <>
                {['all', 'Claim', 'Repair', 'Short Item', 'Product Swap'].map(t => (
                  <Button
                    key={t}
                    variant={typeFilter === t ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTypeFilter(t)}
                    className={cn("h-10 whitespace-nowrap", typeFilter === t ? 'bg-slate-700 hover:bg-slate-800' : '')}
                  >
                    {t === 'all' ? 'All Types' : t}
                  </Button>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          </div>
        ) : (
          <>
            {/* Inspection Reports */}
            {(activeTab === 'all' || activeTab === 'inspections') && (
              <section>
                {activeTab === 'all' && (
                  <h2 className="text-lg font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-500" /> Inspection Reports ({filteredReports.length})
                  </h2>
                )}
                {filteredReports.length === 0 ? (
                  <div className="text-center py-8 bg-white rounded-xl border border-slate-100 text-slate-500">No inspection reports found.</div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Customer</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Job #</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Address</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Installer</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Inspected By</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Inspected On</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Created</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredReports.map(report => {
                          const project = projects.find(p => p.id === report.project);
                          const customerName = report.customer_name || getCustomerName(project) || '—';
                          return (
                            <tr key={report.id} className="hover:bg-indigo-50 transition-colors cursor-pointer" onClick={() => { setSelectedItem(report); setSelectedItemType('inspection'); }}>
                              <td className="px-4 py-3 font-medium text-slate-800">{customerName}</td>
                              <td className="px-4 py-3 text-slate-600">{report.job_number || '—'}</td>
                              <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{report.address || '—'}</td>
                              <td className="px-4 py-3 text-slate-600">{(report.installers?.length ? report.installers : report.installer_name ? [report.installer_name] : []).join(', ') || '—'}</td>
                              <td className="px-4 py-3 text-slate-600">{report.inspected_by || '—'}</td>
                              <td className="px-4 py-3 text-slate-600">
                                {report.inspected_on ? format(new Date(report.inspected_on + 'T00:00:00'), 'MMM d, yyyy') : '—'}
                              </td>
                              <td className="px-4 py-3 text-slate-500 text-xs">
                                {format(new Date(report.created_date), 'MMM d, yyyy')}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <button
                                   onClick={(e) => { e.stopPropagation(); setEditingReport(report); }}
                                   className="text-slate-400 hover:text-indigo-600 transition-colors"
                                   title="Edit"
                                  >
                                   <Pencil className="w-4 h-4" />
                                  </button>
                                  {currentUser?.role === 'admin' && (
                                   <button
                                     onClick={(e) => { e.stopPropagation(); handleDeleteReport(report); }}
                                     className="text-slate-400 hover:text-red-600 transition-colors"
                                     title="Delete"
                                   >
                                     <Trash2 className="w-4 h-4" />
                                   </button>
                                  )}
                                  {project && (
                                   <Link
                                     to={createPageUrl('ProjectDetail') + `?id=${project.id}`}
                                     className="text-indigo-600 hover:underline text-xs font-medium"
                                     onClick={(e) => e.stopPropagation()}
                                   >
                                     View Project →
                                   </Link>
                                  )}
                                </div>
                               </td>
                              </tr>
                              );
                              })}
                              </tbody>
                              </table>
                              </div>
                              )}
                              </section>
                              )}

                              {/* Claims */}
            {(activeTab === 'all' || activeTab === 'claims') && (
              <section>
                {activeTab === 'all' && (
                  <h2 className="text-lg font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-orange-500" /> Claims / Repairs / Short Items ({filteredClaims.length})
                  </h2>
                )}
                {filteredClaims.length === 0 ? (
                  <div className="text-center py-8 bg-white rounded-xl border border-slate-100 text-slate-500">No claims found.</div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Type</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Installer</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Customer</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">DC</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Job #</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Address</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Submitted By</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Submitted On</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Status</th>
                          <th className="text-left px-4 py-3 text-slate-600 font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredClaims.map(claim => {
                          const project = projects.find(p => p.id === claim.project);
                          const customerName = claim.customer_name || getCustomerName(project) || '—';
                          return (
                            <tr key={claim.id} className="hover:bg-indigo-50 transition-colors cursor-pointer" onClick={() => { setSelectedItem(claim); setSelectedItemType('claim'); }}>
                              <td className="px-4 py-3">
                                <Badge className={cn('border text-xs', claimTypeColors[claim.claim_type] || 'bg-slate-100 text-slate-700')}>
                                  {claim.claim_type || '—'}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-slate-600">{(claim.installers?.length ? claim.installers : claim.installer_name ? [claim.installer_name] : []).join(', ') || '—'}</td>
                              <td className="px-4 py-3 font-medium text-slate-800">{customerName}</td>
                              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{getDCName(project)}</td>
                              <td className="px-4 py-3 text-slate-600">{claim.job_number || '—'}</td>
                              <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{claim.address || '—'}</td>
                              <td className="px-4 py-3 text-slate-600">{claim.submitted_by || '—'}</td>
                              <td className="px-4 py-3 text-slate-600">
                                {claim.submitted_on ? format(new Date(claim.submitted_on + 'T00:00:00'), 'MMM d, yyyy') : '—'}
                              </td>
                              <td className="px-4 py-3">
                                 {claim.is_cancelled ? (
                                   <Badge className="bg-slate-100 text-slate-600 border-slate-200 border text-xs">Cancelled</Badge>
                                 ) : claim.is_completed ? (
                                   <Badge className="bg-green-100 text-green-800 border-green-200 border text-xs">Completed</Badge>
                                 ) : (
                                   <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 border text-xs">Open</Badge>
                                 )}
                               </td>
                              <td className="px-4 py-3">
                               <div className="flex items-center gap-2">
                                 <button
                                   onClick={(e) => { e.stopPropagation(); setEditingClaim(claim); }}
                                   className="text-slate-400 hover:text-indigo-600 transition-colors"
                                   title="Edit"
                                 >
                                   <Pencil className="w-4 h-4" />
                                 </button>
                                 {!claim.is_cancelled && (
                                   <button
                                     onClick={(e) => { e.stopPropagation(); handleCompleteClaim(claim); }}
                                     className={claim.is_completed ? 'text-green-500 hover:text-slate-400 transition-colors' : 'text-slate-400 hover:text-green-600 transition-colors'}
                                     title={claim.is_completed ? 'Mark Incomplete' : 'Mark Completed'}
                                   >
                                     <CheckCircle2 className="w-4 h-4" />
                                   </button>
                                 )}
                                 {!claim.is_cancelled && (
                                   <button
                                     onClick={(e) => { e.stopPropagation(); handleCancelClaim(claim); }}
                                     className="text-slate-400 hover:text-orange-600 transition-colors"
                                     title="Cancel"
                                   >
                                     <XCircle className="w-4 h-4" />
                                   </button>
                                 )}
                                 {currentUser?.role === 'admin' && (
                                   <button
                                     onClick={(e) => { e.stopPropagation(); handleDeleteClaim(claim); }}
                                     className="text-slate-400 hover:text-red-600 transition-colors"
                                     title="Delete"
                                   >
                                     <Trash2 className="w-4 h-4" />
                                   </button>
                                 )}
                                 {project && (
                                   <Link
                                     to={createPageUrl('ProjectDetail') + `?id=${project.id}`}
                                     className="text-indigo-600 hover:underline text-xs font-medium"
                                     onClick={(e) => e.stopPropagation()}
                                   >
                                     View Project →
                                   </Link>
                                 )}
                               </div>
                              </td>
                              </tr>
                              );
                              })}
                              </tbody>
                              </table>
                  </div>
                )}
              </section>
            )}
            {/* By DC */}
            {activeTab === 'by_dc' && (
              <section>
                {dcBreakdown.length === 0 ? (
                  <div className="text-center py-8 bg-white rounded-xl border border-slate-100 text-slate-500">No claims data found.</div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <SortTh col="name" label="Design Consultant" sort={dcSort} setSort={setDcSort} />
                          <SortTh col="total" label="Total" sort={dcSort} setSort={setDcSort} center />
                          {claimTypes.map(t => (
                            <SortTh key={t} col={t} label={t} sort={dcSort} setSort={setDcSort} center />
                          ))}
                          <SortTh col="open" label="Open" sort={dcSort} setSort={setDcSort} center />
                          <SortTh col="completed" label="Completed" sort={dcSort} setSort={setDcSort} center />
                          <SortTh col="cancelled" label="Cancelled" sort={dcSort} setSort={setDcSort} center />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {dcBreakdown.map(([dc, data]) => (
                          <tr key={dc} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-800">{dc}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-2 py-1 rounded-full">{data.total}</span>
                            </td>
                            {claimTypes.map(t => (
                              <td key={t} className="px-4 py-3 text-center">
                                {data[t] > 0 ? (
                                  <span className={cn('text-xs font-semibold px-2 py-1 rounded-full border', claimTypeColors[t] || 'bg-slate-100 text-slate-700')}>{data[t]}</span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            ))}
                            <td className="px-4 py-3 text-center">
                              {data.open > 0 ? <span className="bg-yellow-100 text-yellow-800 text-xs font-semibold px-2 py-1 rounded-full">{data.open}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {data.completed > 0 ? <span className="bg-green-100 text-green-800 text-xs font-semibold px-2 py-1 rounded-full">{data.completed}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {data.cancelled > 0 ? <span className="bg-slate-100 text-slate-600 text-xs font-semibold px-2 py-1 rounded-full">{data.cancelled}</span> : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* By Installer */}
            {activeTab === 'by_installer' && (
              <section>
                {installerBreakdown.length === 0 ? (
                  <div className="text-center py-8 bg-white rounded-xl border border-slate-100 text-slate-500">No claims data found.</div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <SortTh col="name" label="Installer" sort={installerSort} setSort={setInstallerSort} />
                          <SortTh col="total" label="Total" sort={installerSort} setSort={setInstallerSort} center />
                          {claimTypes.map(t => (
                            <SortTh key={t} col={t} label={t} sort={installerSort} setSort={setInstallerSort} center />
                          ))}
                          <SortTh col="open" label="Open" sort={installerSort} setSort={setInstallerSort} center />
                          <SortTh col="completed" label="Completed" sort={installerSort} setSort={setInstallerSort} center />
                          <SortTh col="cancelled" label="Cancelled" sort={installerSort} setSort={setInstallerSort} center />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {installerBreakdown.map(([installer, data]) => (
                          <tr key={installer} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-800">{installer}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-2 py-1 rounded-full">{data.total}</span>
                            </td>
                            {claimTypes.map(t => (
                              <td key={t} className="px-4 py-3 text-center">
                                {data[t] > 0 ? (
                                  <span className={cn('text-xs font-semibold px-2 py-1 rounded-full border', claimTypeColors[t] || 'bg-slate-100 text-slate-700')}>{data[t]}</span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            ))}
                            <td className="px-4 py-3 text-center">
                              {data.open > 0 ? <span className="bg-yellow-100 text-yellow-800 text-xs font-semibold px-2 py-1 rounded-full">{data.open}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {data.completed > 0 ? <span className="bg-green-100 text-green-800 text-xs font-semibold px-2 py-1 rounded-full">{data.completed}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {data.cancelled > 0 ? <span className="bg-slate-100 text-slate-600 text-xs font-semibold px-2 py-1 rounded-full">{data.cancelled}</span> : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
    </>
  )
}