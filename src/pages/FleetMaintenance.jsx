import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Wrench, Loader2, Pencil, Trash2, Car, Paperclip, X } from 'lucide-react';
import { SignedFileLink } from '@/lib/fileUrl';
import { base44 as base44Client } from '@/api/base44Client';

const SERVICE_TYPES = [
  'Oil & Filter Change',
  'Tire Service',
  'Brake System Service',
  'Fluid Flush & Top-off',
  'Annual/DOT Inspection',
  'Battery & Electrical',
  'Filter Replacement',
  'HVAC Service',
  'Suspension & Steering',
  'Unscheduled Repair (Breakdown/General Repair)',
];
import { format } from 'date-fns';

const statusColors = {
  scheduled: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25',
  in_progress: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25',
  completed: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25',
  overdue: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25',
  cancelled: 'bg-secondary text-secondary-foreground border-border'
};

const EMPTY = { vehicle_id: '', service_type: '', scheduled_date: '', status: 'scheduled', description: '', cost: '', vendor: '', receipt_urls: [] };

export default function FleetMaintenance() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  const { data: maintenance = [], isLoading } = useQuery({
    queryKey: ['fleetMaintenance'],
    queryFn: () => base44.entities.FleetMaintenance.list('-scheduled_date')
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ['fleetVehicles'],
    queryFn: () => base44.entities.FleetVehicle.list()
  });

  const getVehicleName = (id) => {
    const v = vehicles.find(v => v.id === id);
    return v ? `${v.year} ${v.make} ${v.model}` : id || 'Unknown Vehicle';
  };

  const filtered = maintenance.filter(m => {
    const matchesSearch = `${getVehicleName(m.vehicle_id)} ${m.service_type} ${m.vendor}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || m.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openNew = () => { setForm(EMPTY); setEditId(null); setShowDialog(true); };
  const handleReceiptUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadingReceipt(true);
    try {
      const urls = await Promise.all(files.map(async (file) => {
        const { file_url } = await base44Client.integrations.Core.UploadFile({ file });
        return { url: file_url, name: file.name };
      }));
      setForm(f => ({ ...f, receipt_urls: [...(f.receipt_urls || []), ...urls] }));
    } finally {
      setUploadingReceipt(false);
      e.target.value = '';
    }
  };

  const removeReceipt = (idx) => {
    setForm(f => ({ ...f, receipt_urls: f.receipt_urls.filter((_, i) => i !== idx) }));
  };

  const openEdit = (m) => {
    setForm({ vehicle_id: m.vehicle_id||'', service_type: m.service_type||'', scheduled_date: m.scheduled_date||'', status: m.status||'scheduled', description: m.description||'', cost: m.cost||'', vendor: m.vendor||'', receipt_urls: m.receipt_urls||[] });
    setEditId(m.id);
    setShowDialog(true);
  };

  const handleSave = async () => {
    setSaving(true);
    if (editId) {
      await base44.entities.FleetMaintenance.update(editId, form);
    } else {
      await base44.entities.FleetMaintenance.create(form);
    }
    queryClient.invalidateQueries({ queryKey: ['fleetMaintenance'] });
    setSaving(false);
    setShowDialog(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this maintenance record?')) return;
    await base44.entities.FleetMaintenance.delete(id);
    queryClient.invalidateQueries({ queryKey: ['fleetMaintenance'] });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Maintenance Schedule</h1>
            <p className="text-muted-foreground mt-1">Track vehicle maintenance and service records</p>
          </div>
          <Button onClick={openNew} className="bg-primary text-primary-foreground hover:opacity-90 self-start md:self-auto">
            <Plus className="w-4 h-4 mr-2" /> Add Record
          </Button>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4 flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search maintenance..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-2 flex-nowrap overflow-x-auto pb-1">
            {['all', 'scheduled', 'overdue', 'in_progress', 'completed'].map(s => (
              <Button key={s} size="sm" variant={statusFilter === s ? 'default' : 'outline'} onClick={() => setStatusFilter(s)}
                className={statusFilter === s ? 'bg-primary text-primary-foreground hover:opacity-90 whitespace-nowrap' : 'whitespace-nowrap'}>
                {s === 'all' ? 'All' : s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                {s !== 'all' && ` (${maintenance.filter(m => m.status === s).length})`}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 text-primary animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-2xl border border-border">
            <Wrench className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No maintenance records found</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map(m => (
              <div key={m.id} className="bg-card rounded-xl border border-border p-4 flex items-center gap-4 hover:shadow-md transition-all">
                <div className="w-10 h-10 rounded-lg bg-brand-gold/15 flex items-center justify-center flex-shrink-0">
                  <Wrench className="w-5 h-5 text-brand-gold" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground">{m.service_type}</p>
                  <div className="flex gap-3 text-sm text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><Car className="w-3 h-3" />{getVehicleName(m.vehicle_id)}</span>
                    {m.scheduled_date && <span>{format(new Date(m.scheduled_date + 'T00:00:00'), 'MMM d, yyyy')}</span>}
                    {m.vendor && <span>Vendor: {m.vendor}</span>}
                    {m.cost && <span>${parseFloat(m.cost).toLocaleString()}</span>}
                  </div>
                  {m.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{m.description}</p>}
                  {m.receipt_urls && m.receipt_urls.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {m.receipt_urls.map((r, i) => (
                        <SignedFileLink key={i} src={r.url} className="text-[10px] text-primary hover:underline flex items-center gap-0.5 bg-primary/10 px-1.5 py-0.5 rounded">
                          <Paperclip className="w-2.5 h-2.5" />{r.name || `Receipt ${i+1}`}
                        </SignedFileLink>
                      ))}
                    </div>
                  )}
                </div>
                <Badge className={`border ${statusColors[m.status] || statusColors.scheduled}`}>{(m.status||'scheduled').replace('_', ' ')}</Badge>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(m)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(m.id)} className="text-destructive hover:opacity-80"><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? 'Edit Record' : 'Add Maintenance Record'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Vehicle</Label>
              <Select value={form.vehicle_id} onValueChange={v => setForm(f => ({...f, vehicle_id: v}))}>
                <SelectTrigger><SelectValue placeholder="Select vehicle..." /></SelectTrigger>
                <SelectContent>
                  {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.year} {v.make} {v.model}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Service Type</Label>
                <Select value={form.service_type} onValueChange={v => setForm(f => ({...f, service_type: v}))}>
                  <SelectTrigger><SelectValue placeholder="Select service type..." /></SelectTrigger>
                  <SelectContent>
                    {SERVICE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Scheduled Date</Label><Input type="date" value={form.scheduled_date} onChange={e => setForm(f => ({...f, scheduled_date: e.target.value}))} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({...f, status: v}))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Cost ($)</Label><Input type="number" value={form.cost} onChange={e => setForm(f => ({...f, cost: e.target.value}))} placeholder="0.00" /></div>
            </div>
            <div><Label>Vendor / Shop</Label><Input value={form.vendor} onChange={e => setForm(f => ({...f, vendor: e.target.value}))} placeholder="Service center name" /></div>
            <div><Label>Description</Label><Textarea rows={2} value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="Details about the service..." /></div>
            
            {/* Receipts */}
            <div>
              <Label>Receipts / Attachments</Label>
              <label className="mt-1 flex items-center justify-center w-full p-3 border-2 border-dashed border-border rounded-lg hover:border-primary/40 hover:bg-primary/10 transition-colors cursor-pointer">
                <input type="file" multiple accept="image/*,.pdf" onChange={handleReceiptUpload} disabled={uploadingReceipt} className="hidden" />
                {uploadingReceipt ? (
                  <><Loader2 className="w-4 h-4 text-primary animate-spin mr-2" /><span className="text-sm text-muted-foreground">Uploading...</span></>
                ) : (
                  <><Paperclip className="w-4 h-4 text-muted-foreground mr-2" /><span className="text-sm text-muted-foreground">Attach receipts or photos</span></>
                )}
              </label>
              {form.receipt_urls && form.receipt_urls.length > 0 && (
                <div className="mt-2 space-y-1">
                  {form.receipt_urls.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-secondary rounded-lg border border-border">
                      <Paperclip className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <SignedFileLink src={r.url} className="text-xs text-primary hover:underline flex-1 truncate text-left">{r.name || 'Receipt'}</SignedFileLink>
                      <button type="button" onClick={() => removeReceipt(i)} className="text-destructive hover:opacity-80"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:opacity-90">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}{editId ? 'Save' : 'Add Record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}