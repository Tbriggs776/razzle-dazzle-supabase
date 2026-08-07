import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Loader2, Trash2, Send, CheckCircle2, Clock, ExternalLink, Pen, FileText, Wrench, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

const STATUS_STYLES = {
  draft: 'bg-slate-100 text-slate-600 border-slate-200',
  sent: 'bg-amber-100 text-amber-700 border-amber-200',
  signed: 'bg-green-100 text-green-700 border-green-200'
};

export default function ManualDesignMods() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('design_mod');
  const [modFilter, setModFilter] = useState('manual');
  const [sendingId, setSendingId] = useState(null);
  const [scFormData, setScFormData] = useState({
    customer_first_name: '',
    customer_last_name: '',
    customer_email: '',
    customer_phone: '',
    customer_address: '',
    consultant_name: '',
    sale_date: new Date().toISOString().split('T')[0],
    install_date: '',
    products_description: '',
    sale_amount: '',
    deposit_amount: '',
    deposit_payment_method: 'Credit Card',
    check_number: '',
    notes: ''
  });
  const [formData, setFormData] = useState({
    customer_first_name: '',
    customer_last_name: '',
    customer_email: '',
    job_number: '',
    products_or_changes: '',
    value_added_costs: '',
    funds_collected_terms: 'Credit Card'
  });
  const [piFormData, setPiFormData] = useState({
    customer_first_name: '',
    customer_last_name: '',
    customer_email: '',
    job_number: '',
    product_info: ''
  });

  const { data: allDesignMods = [], isLoading } = useQuery({
    queryKey: ['designMods'],
    queryFn: async () => {
      const mods = await base44.entities.DesignMod.list();
      return mods.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    }
  });

  const designMods = allDesignMods.filter(mod => !mod.project);
  const projectDesignMods = allDesignMods.filter(mod => !!mod.project);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const currentUser = await base44.auth.me();
      const mod = await base44.entities.DesignMod.create({
        customer_first_name: data.customer_first_name,
        customer_last_name: data.customer_last_name,
        customer_email: data.customer_email,
        job_number: data.job_number,
        products_or_changes: data.products_or_changes,
        value_added_costs: data.value_added_costs ? parseFloat(data.value_added_costs) : 0,
        funds_collected_terms: data.funds_collected_terms,
        status: 'draft',
        created_by_name: currentUser?.full_name || currentUser?.email || ''
      });
      
      // Auto-send for signature
      await base44.functions.invoke('sendDesignModEmail', {
        designModId: mod.id,
        appUrl: window.location.origin
      });
      
      return mod;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['designMods'] });
      setFormData({
        customer_first_name: '',
        customer_last_name: '',
        customer_email: '',
        job_number: '',
        products_or_changes: '',
        value_added_costs: '',
        funds_collected_terms: 'Credit Card'
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.DesignMod.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['designMods'] });
    }
  });

  const handleResend = async (mod) => {
    setSendingId(mod.id);
    try {
      await base44.functions.invoke('sendDesignModEmail', {
        designModId: mod.id,
        appUrl: window.location.origin
      });
      queryClient.invalidateQueries({ queryKey: ['designMods'] });
    } finally {
      setSendingId(null);
    }
  };



  // Pre-Install Checklist queries and mutations
  const { data: preInstallChecklists = [], isLoading: piLoading } = useQuery({
    queryKey: ['standalonePreInstallChecklists'],
    queryFn: () => base44.entities.StandalonePreInstallChecklist.list('-created_date')
  });

  // Appointments with in-person pre-install checklists
  const { data: appointmentsWithChecklist = [], isLoading: apptChecklistLoading } = useQuery({
    queryKey: ['appointmentsWithPreInstall'],
    queryFn: async () => {
      // Filter server-side for appointments that have a signature URL
      const appts = await base44.entities.Appointment.filter(
        { pre_install_checklist_signature_url: { $exists: true } },
        '-updated_date',
        200
      );
      // Fetch lead names in parallel
      const leadIds = [...new Set(appts.map(a => a.customer).filter(Boolean))];
      const leads = leadIds.length > 0
        ? await Promise.all(leadIds.map(id => base44.entities.Lead.filter({ id }).then(r => r[0])))
        : [];
      const leadMap = Object.fromEntries(leads.filter(Boolean).map(l => [l.id, l]));
      return appts.map(a => ({ ...a, _lead: leadMap[a.customer] || null }));
    }
  });

  const piCreateMutation = useMutation({
    mutationFn: async (data) => {
      const record = await base44.entities.StandalonePreInstallChecklist.create({
        customer_first_name: data.customer_first_name,
        customer_last_name: data.customer_last_name,
        customer_email: data.customer_email,
        job_number: data.job_number,
        product_info: data.product_info,
        status: 'draft'
      });
      await base44.functions.invoke('sendPreInstallEmail', { checklistId: record.id });
      return record;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standalonePreInstallChecklists'] });
      setPiFormData({ customer_first_name: '', customer_last_name: '', customer_email: '', job_number: '', product_info: '' });
    }
  });

  const piDeleteMutation = useMutation({
    mutationFn: (id) => base44.entities.StandalonePreInstallChecklist.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['standalonePreInstallChecklists'] })
  });

  const piResend = async (record) => {
    setSendingId(record.id);
    try {
      await base44.functions.invoke('sendPreInstallEmail', { checklistId: record.id });
      queryClient.invalidateQueries({ queryKey: ['standalonePreInstallChecklists'] });
    } finally {
      setSendingId(null);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  const handlePiSubmit = (e) => {
    e.preventDefault();
    piCreateMutation.mutate(piFormData);
  };

  // Sales Contracts
  const { data: salesContracts = [], isLoading: scLoading } = useQuery({
    queryKey: ['manualSalesContracts'],
    queryFn: () => base44.entities.ManualSalesContract.list('-created_date')
  });

  const scCreateMutation = useMutation({
    mutationFn: async (data) => {
      const contract = await base44.entities.ManualSalesContract.create({
        ...data,
        sale_amount: data.sale_amount ? parseFloat(data.sale_amount) : 0,
        deposit_amount: data.deposit_amount ? parseFloat(data.deposit_amount) : 0,
        status: 'draft'
      });
      await base44.functions.invoke('sendManualSalesContractEmail', {
        contractId: contract.id,
        appUrl: window.location.origin
      });
      return contract;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manualSalesContracts'] });
      setScFormData({
        customer_first_name: '', customer_last_name: '', customer_email: '', customer_phone: '',
        customer_address: '', consultant_name: '', sale_date: new Date().toISOString().split('T')[0],
        install_date: '', products_description: '', sale_amount: '', deposit_amount: '',
        deposit_payment_method: 'Credit Card', check_number: '', notes: ''
      });
    }
  });

  const scDeleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ManualSalesContract.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['manualSalesContracts'] })
  });

  const scResend = async (contract) => {
    setSendingId(contract.id);
    try {
      await base44.functions.invoke('sendManualSalesContractEmail', {
        contractId: contract.id,
        appUrl: window.location.origin
      });
      queryClient.invalidateQueries({ queryKey: ['manualSalesContracts'] });
    } finally {
      setSendingId(null);
    }
  };

  const handleScSubmit = (e) => {
    e.preventDefault();
    scCreateMutation.mutate(scFormData);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <Link
            to={createPageUrl('Dashboard')}
            className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Document Center</h1>
          <p className="text-slate-500 mt-1">Send design modification requests and pre-installation checklists for customer signature</p>
          {/* Tabs */}
          <div className="flex gap-2 mt-6">
            <button
              onClick={() => setActiveTab('design_mod')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${
                activeTab === 'design_mod' ? 'bg-indigo-600 text-white shadow' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Wrench className="w-4 h-4" /> Design Mods
            </button>
            <button
              onClick={() => setActiveTab('pre_install')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${
                activeTab === 'pre_install' ? 'bg-indigo-600 text-white shadow' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <FileText className="w-4 h-4" /> Pre-Install Checklists
            </button>
            <button
              onClick={() => setActiveTab('sales_contract')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${
                activeTab === 'sales_contract' ? 'bg-indigo-600 text-white shadow' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <DollarSign className="w-4 h-4" /> Sales Contracts
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Design Mods Tab */}
        {activeTab === 'design_mod' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-6">New Design Mod</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="first_name" className="text-slate-700">First Name *</Label>
                  <Input id="first_name" value={formData.customer_first_name} onChange={(e) => setFormData({ ...formData, customer_first_name: e.target.value })} required className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name" className="text-slate-700">Last Name *</Label>
                  <Input id="last_name" value={formData.customer_last_name} onChange={(e) => setFormData({ ...formData, customer_last_name: e.target.value })} required className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-700">Email</Label>
                  <Input id="email" type="email" value={formData.customer_email} onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })} className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="job_number" className="text-slate-700">Job Number</Label>
                  <Input id="job_number" value={formData.job_number} onChange={(e) => setFormData({ ...formData, job_number: e.target.value })} className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="products" className="text-slate-700">Products or Changes *</Label>
                  <Textarea id="products" value={formData.products_or_changes} onChange={(e) => setFormData({ ...formData, products_or_changes: e.target.value })} required rows={4} className="border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cost" className="text-slate-700">Value Added Costs ($)</Label>
                  <Input id="cost" type="number" step="0.01" value={formData.value_added_costs} onChange={(e) => setFormData({ ...formData, value_added_costs: e.target.value })} className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="terms" className="text-slate-700">Funds Collected Terms</Label>
                  <Select value={formData.funds_collected_terms} onValueChange={(value) => setFormData({ ...formData, funds_collected_terms: value })}>
                    <SelectTrigger className="h-10 border-slate-200"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Credit Card">Credit Card</SelectItem>
                      <SelectItem value="Existing Synchrony Financing Account">Existing Synchrony Financing Account</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={createMutation.isPending} className="w-full h-10 bg-indigo-600 hover:bg-indigo-700">
                  {createMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : <><Plus className="w-4 h-4 mr-2" />Create & Send</>}
                </Button>
              </form>
            </div>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-slate-800">Design Mods</h2>
                <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                  <button
                    onClick={() => setModFilter('manual')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${modFilter === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Manual ({designMods.length})
                  </button>
                  <button
                    onClick={() => setModFilter('project')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${modFilter === 'project' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    From Projects ({projectDesignMods.length})
                  </button>
                </div>
              </div>
              {isLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-indigo-600 animate-spin" /></div>
              ) : modFilter === 'manual' && designMods.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No manual design mods yet</p>
              ) : modFilter === 'project' && projectDesignMods.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No project design mods yet</p>
              ) : modFilter === 'manual' ? (
                <div className="space-y-3">
                  {designMods.map((mod) => (
                    <div key={mod.id} className="border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-medium text-slate-800">{mod.customer_first_name} {mod.customer_last_name}</span>
                          <Badge variant="outline" className={STATUS_STYLES[mod.status || 'draft']}>
                            {mod.status === 'signed' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                            {mod.status || 'draft'}
                          </Badge>
                          {mod.job_number && <span className="text-xs text-slate-500">Job #{mod.job_number}</span>}
                        </div>
                        <p className="text-sm text-slate-600 line-clamp-2">{mod.products_or_changes}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                          {mod.value_added_costs > 0 && <span>${Number(mod.value_added_costs).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                          {mod.funds_collected_terms && <span>• {mod.funds_collected_terms}</span>}
                          {mod.created_by_name && <span>• By {mod.created_by_name}</span>}
                          {mod.signed_at && <span>• Signed {format(new Date(mod.signed_at), 'MMM d, yyyy')}</span>}
                          {mod.email_sent_at && mod.status !== 'signed' && <span>• Sent {format(new Date(mod.email_sent_at), 'MMM d, yyyy h:mm a')}</span>}
                          {!mod.email_sent_at && <span>• Created {format(new Date(mod.created_date), 'MMM d, yyyy h:mm a')}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {mod.status === 'signed' ? (
                          <a href={`/DesignModView?id=${mod.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-green-300 rounded-lg hover:bg-green-50 transition-colors text-green-700">
                            <CheckCircle2 className="w-3 h-3" />View Signed
                          </a>
                        ) : (
                          <>
                            <a href={`/DesignModView?id=${mod.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-indigo-300 rounded-lg hover:bg-indigo-50 transition-colors text-indigo-700">
                              <Pen className="w-3 h-3" />Sign in Person
                            </a>
                            {mod.short_url && (
                              <button onClick={() => window.open(mod.short_url, '_blank')} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-white transition-colors text-slate-600">
                                <ExternalLink className="w-3 h-3" />Customer Link
                              </button>
                            )}
                            <button onClick={() => handleResend(mod)} disabled={sendingId === mod.id} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-amber-300 rounded-lg hover:bg-amber-50 transition-colors text-amber-700 disabled:opacity-50">
                              {sendingId === mod.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                              {sendingId === mod.id ? 'Sending...' : mod.email_sent_at ? 'Resend' : 'Send'}
                            </button>
                          </>
                        )}
                        <button onClick={() => deleteMutation.mutate(mod.id)} disabled={deleteMutation.isPending} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {projectDesignMods.map((mod) => (
                    <div key={mod.id} className="border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-medium text-slate-800">{mod.customer_first_name} {mod.customer_last_name}</span>
                          <Badge variant="outline" className={STATUS_STYLES[mod.status || 'draft']}>
                            {mod.status === 'signed' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                            {mod.status || 'draft'}
                          </Badge>
                          {mod.job_number && <span className="text-xs text-slate-500">Job #{mod.job_number}</span>}
                        </div>
                        <p className="text-sm text-slate-600 line-clamp-2">{mod.products_or_changes}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                          {mod.value_added_costs > 0 && <span>${Number(mod.value_added_costs).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                          {mod.funds_collected_terms && <span>• {mod.funds_collected_terms}</span>}
                          {mod.created_by_name && <span>• By {mod.created_by_name}</span>}
                          {mod.signed_at && <span>• Signed {format(new Date(mod.signed_at), 'MMM d, yyyy')}</span>}
                          {mod.email_sent_at && mod.status !== 'signed' && <span>• Sent {format(new Date(mod.email_sent_at), 'MMM d, yyyy h:mm a')}</span>}
                          {!mod.email_sent_at && <span>• Created {format(new Date(mod.created_date), 'MMM d, yyyy h:mm a')}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {mod.status === 'signed' ? (
                          <a href={`/DesignModView?id=${mod.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-green-300 rounded-lg hover:bg-green-50 transition-colors text-green-700">
                            <CheckCircle2 className="w-3 h-3" />View Signed
                          </a>
                        ) : (
                          <>
                            <a href={`/DesignModView?id=${mod.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-indigo-300 rounded-lg hover:bg-indigo-50 transition-colors text-indigo-700">
                              <Pen className="w-3 h-3" />Sign in Person
                            </a>
                            {mod.short_url && (
                              <button onClick={() => window.open(mod.short_url, '_blank')} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-white transition-colors text-slate-600">
                                <ExternalLink className="w-3 h-3" />Customer Link
                              </button>
                            )}
                            <button onClick={() => handleResend(mod)} disabled={sendingId === mod.id} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-amber-300 rounded-lg hover:bg-amber-50 transition-colors text-amber-700 disabled:opacity-50">
                              {sendingId === mod.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                              {sendingId === mod.id ? 'Sending...' : mod.email_sent_at ? 'Resend' : 'Send'}
                            </button>
                          </>
                        )}
                        <a href={`/ProjectDetail?id=${mod.project}`} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-white transition-colors text-slate-600">
                          <ExternalLink className="w-3 h-3" />View Project
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        {/* Pre-Install Checklist Tab */}
        {activeTab === 'pre_install' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-6">New Pre-Install Checklist</h2>
              <form onSubmit={handlePiSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-slate-700">First Name *</Label>
                  <Input value={piFormData.customer_first_name} onChange={(e) => setPiFormData({ ...piFormData, customer_first_name: e.target.value })} required className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Last Name *</Label>
                  <Input value={piFormData.customer_last_name} onChange={(e) => setPiFormData({ ...piFormData, customer_last_name: e.target.value })} required className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Email *</Label>
                  <Input type="email" value={piFormData.customer_email} onChange={(e) => setPiFormData({ ...piFormData, customer_email: e.target.value })} required className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Job Number</Label>
                  <Input value={piFormData.job_number} onChange={(e) => setPiFormData({ ...piFormData, job_number: e.target.value })} className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Product Name / Style / Color *</Label>
                  <Textarea value={piFormData.product_info} onChange={(e) => setPiFormData({ ...piFormData, product_info: e.target.value })} required rows={3} placeholder="e.g. Shaw Floorté Pro 5 Series - Mineral Oak" className="border-slate-200" />
                </div>
                <Button type="submit" disabled={piCreateMutation.isPending} className="w-full h-10 bg-indigo-600 hover:bg-indigo-700">
                  {piCreateMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : <><Send className="w-4 h-4 mr-2" />Create & Send</>}
                </Button>
              </form>
            </div>
          </div>
          <div className="lg:col-span-2 space-y-6">
            {/* In-Person Checklists (from Appointment flow) */}
            {(appointmentsWithChecklist.length > 0 || apptChecklistLoading) && (
              <div className="bg-white rounded-2xl border border-slate-100 p-6">
                <h2 className="text-lg font-semibold text-slate-800 mb-2">In-Person Signed (During Sale)</h2>
                <p className="text-sm text-slate-500 mb-5">Checklists signed by customers at time of sale</p>
                {apptChecklistLoading ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 text-indigo-600 animate-spin" /></div>
                ) : (
                  <div className="space-y-3">
                    {appointmentsWithChecklist.map((appt) => (
                      <div key={appt.id} className="border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-slate-50">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-medium text-slate-800">
                              {appt._lead ? `${appt._lead.first_name} ${appt._lead.last_name}` : 'Unknown Customer'}
                            </span>
                            <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200">
                              <CheckCircle2 className="w-3 h-3 mr-1" />signed
                            </Badge>
                          </div>
                          {appt.pre_install_product_info && (
                            <p className="text-sm text-slate-600 line-clamp-1">{appt.pre_install_product_info}</p>
                          )}
                          <div className="text-xs text-slate-400 mt-1">
                            {appt.appointment_date && <span>Appt: {appt.appointment_date}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <a
                            href={appt.pre_install_checklist_signature_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-green-300 rounded-lg hover:bg-green-50 transition-colors text-green-700"
                          >
                            <CheckCircle2 className="w-3 h-3" />View Signature
                          </a>
                          <a
                            href={`/ConsultantAppointmentView?id=${appt.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-indigo-300 rounded-lg hover:bg-indigo-50 transition-colors text-indigo-700"
                          >
                            <ExternalLink className="w-3 h-3" />View Appointment
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-6">All Pre-Install Checklists</h2>
              {piLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-indigo-600 animate-spin" /></div>
              ) : preInstallChecklists.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No pre-install checklists yet</p>
              ) : (
                <div className="space-y-3">
                  {preInstallChecklists.map((record) => (
                    <div key={record.id} className="border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-medium text-slate-800">{record.customer_first_name} {record.customer_last_name}</span>
                          <Badge variant="outline" className={STATUS_STYLES[record.status || 'draft']}>
                            {record.status === 'signed' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                            {record.status || 'draft'}
                          </Badge>
                          {record.job_number && <span className="text-xs text-slate-500">Job #{record.job_number}</span>}
                        </div>
                        {record.product_info && <p className="text-sm text-slate-600 line-clamp-1">{record.product_info}</p>}
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                          {record.created_by && <span>By {record.created_by}</span>}
                          {record.signed_at && <span>• Signed {format(new Date(record.signed_at), 'MMM d, yyyy')}</span>}
                          {record.email_sent_at && record.status !== 'signed' && <span>• Sent {format(new Date(record.email_sent_at), 'MMM d, yyyy h:mm a')}</span>}
                          {!record.email_sent_at && <span>• Created {format(new Date(record.created_date), 'MMM d, yyyy h:mm a')}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {record.status === 'signed' ? (
                          <a href={`/PreInstallChecklistView?id=${record.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-green-300 rounded-lg hover:bg-green-50 transition-colors text-green-700">
                            <CheckCircle2 className="w-3 h-3" />View Signed
                          </a>
                        ) : (
                          <>
                            <a href={`/PreInstallChecklistView?id=${record.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-indigo-300 rounded-lg hover:bg-indigo-50 transition-colors text-indigo-700">
                              <Pen className="w-3 h-3" />Sign in Person
                            </a>
                            {record.short_url && (
                              <button onClick={() => window.open(record.short_url, '_blank')} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-white transition-colors text-slate-600">
                                <ExternalLink className="w-3 h-3" />Customer Link
                              </button>
                            )}
                            <button onClick={() => piResend(record)} disabled={sendingId === record.id} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-amber-300 rounded-lg hover:bg-amber-50 transition-colors text-amber-700 disabled:opacity-50">
                              {sendingId === record.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                              {sendingId === record.id ? 'Sending...' : record.email_sent_at ? 'Resend' : 'Send'}
                            </button>
                          </>
                        )}
                        <button onClick={() => piDeleteMutation.mutate(record.id)} disabled={piDeleteMutation.isPending} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        {/* Sales Contracts Tab */}
        {activeTab === 'sales_contract' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-6">New Sales Contract</h2>
              <form onSubmit={handleScSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-slate-700">First Name *</Label>
                    <Input value={scFormData.customer_first_name} onChange={e => setScFormData({...scFormData, customer_first_name: e.target.value})} required className="h-10 border-slate-200" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-700">Last Name *</Label>
                    <Input value={scFormData.customer_last_name} onChange={e => setScFormData({...scFormData, customer_last_name: e.target.value})} required className="h-10 border-slate-200" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Email</Label>
                  <Input type="email" value={scFormData.customer_email} onChange={e => setScFormData({...scFormData, customer_email: e.target.value})} className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Phone</Label>
                  <Input value={scFormData.customer_phone} onChange={e => setScFormData({...scFormData, customer_phone: e.target.value})} className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Installation Address</Label>
                  <Input value={scFormData.customer_address} onChange={e => setScFormData({...scFormData, customer_address: e.target.value})} className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Design Consultant</Label>
                  <Input value={scFormData.consultant_name} onChange={e => setScFormData({...scFormData, consultant_name: e.target.value})} className="h-10 border-slate-200" />
                </div>
                <div className="space-y-2">
                   <Label className="text-slate-700">Sale Date *</Label>
                   <Input type="date" value={scFormData.sale_date} onChange={e => setScFormData({...scFormData, sale_date: e.target.value})} required className="h-10 border-slate-200" />
                 </div>
                 <div className="space-y-2">
                   <Label className="text-slate-700">Install Date</Label>
                   <Input type="date" value={scFormData.install_date} onChange={e => setScFormData({...scFormData, install_date: e.target.value})} className="h-10 border-slate-200" />
                 </div>
                 <div className="space-y-2">
                   <Label className="text-slate-700">Products / Services *</Label>
                  <Textarea value={scFormData.products_description} onChange={e => setScFormData({...scFormData, products_description: e.target.value})} required rows={4} className="border-slate-200" placeholder="Describe products and services..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-slate-700">Sale Amount ($) *</Label>
                    <Input type="number" step="0.01" value={scFormData.sale_amount} onChange={e => setScFormData({...scFormData, sale_amount: e.target.value})} required className="h-10 border-slate-200" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-700">Deposit ($)</Label>
                    <Input type="number" step="0.01" value={scFormData.deposit_amount} onChange={e => setScFormData({...scFormData, deposit_amount: e.target.value})} className="h-10 border-slate-200" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Payment Method</Label>
                  <Select value={scFormData.deposit_payment_method} onValueChange={val => setScFormData({...scFormData, deposit_payment_method: val})}>
                    <SelectTrigger className="h-10 border-slate-200"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Credit Card">Credit Card</SelectItem>
                      <SelectItem value="Check">Check</SelectItem>
                      <SelectItem value="Post-Dated Check">Post-Dated Check</SelectItem>
                      <SelectItem value="Financing - Synchrony">Financing - Synchrony</SelectItem>
                      <SelectItem value="Financing - MOMNT">Financing - MOMNT</SelectItem>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="Wire">Wire</SelectItem>
                      <SelectItem value="Zelle">Zelle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(scFormData.deposit_payment_method === 'Check' || scFormData.deposit_payment_method === 'Post-Dated Check') && (
                  <div className="space-y-2">
                    <Label className="text-slate-700">Check Number</Label>
                    <Input value={scFormData.check_number} onChange={e => setScFormData({...scFormData, check_number: e.target.value})} className="h-10 border-slate-200" />
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-slate-700">Notes</Label>
                  <Textarea value={scFormData.notes} onChange={e => setScFormData({...scFormData, notes: e.target.value})} rows={2} className="border-slate-200" />
                </div>
                <Button type="submit" disabled={scCreateMutation.isPending} className="w-full h-10 bg-indigo-600 hover:bg-indigo-700">
                  {scCreateMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : <><Plus className="w-4 h-4 mr-2" />Create & Send</>}
                </Button>
              </form>
            </div>
          </div>
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-6">All Sales Contracts</h2>
              {scLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-indigo-600 animate-spin" /></div>
              ) : salesContracts.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No manual sales contracts yet</p>
              ) : (
                <div className="space-y-3">
                  {salesContracts.map((contract) => (
                    <div key={contract.id} className="border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-medium text-slate-800">{contract.customer_first_name} {contract.customer_last_name}</span>
                          <Badge variant="outline" className={STATUS_STYLES[contract.status || 'draft']}>
                            {contract.status === 'signed' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                            {contract.status || 'draft'}
                          </Badge>
                          {contract.sale_date && <span className="text-xs text-slate-500">{contract.sale_date}</span>}
                        </div>
                        <p className="text-sm text-slate-600 line-clamp-1">{contract.products_description}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                          {contract.sale_amount > 0 && <span className="font-medium text-slate-600">${Number(contract.sale_amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>}
                          {contract.deposit_amount > 0 && <span>• Deposit: ${Number(contract.deposit_amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>}
                          {contract.consultant_name && <span>• {contract.consultant_name}</span>}
                          {contract.signed_at && <span>• Signed {format(new Date(contract.signed_at), 'MMM d, yyyy')}</span>}
                          {contract.email_sent_at && contract.status !== 'signed' && <span>• Sent {format(new Date(contract.email_sent_at), 'MMM d, yyyy h:mm a')}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {contract.status === 'signed' ? (
                          <a href={`/ManualSalesContractView?id=${contract.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-green-300 rounded-lg hover:bg-green-50 transition-colors text-green-700">
                            <CheckCircle2 className="w-3 h-3" />View Signed
                          </a>
                        ) : (
                          <>
                            <a href={`/ManualSalesContractView?id=${contract.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-indigo-300 rounded-lg hover:bg-indigo-50 transition-colors text-indigo-700">
                              <Pen className="w-3 h-3" />Sign in Person
                            </a>
                            {contract.short_url && (
                              <button onClick={() => window.open(contract.short_url, '_blank')} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-white transition-colors text-slate-600">
                                <ExternalLink className="w-3 h-3" />Customer Link
                              </button>
                            )}
                            <button onClick={() => scResend(contract)} disabled={sendingId === contract.id} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-amber-300 rounded-lg hover:bg-amber-50 transition-colors text-amber-700 disabled:opacity-50">
                              {sendingId === contract.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                              {sendingId === contract.id ? 'Sending...' : contract.email_sent_at ? 'Resend' : 'Send'}
                            </button>
                          </>
                        )}
                        <button onClick={() => scDeleteMutation.mutate(contract.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}