import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Car, Loader2, Pencil, Trash2 } from 'lucide-react';

const statusColors = {
  active: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25',
  inactive: 'bg-secondary text-secondary-foreground border-border',
  maintenance: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25'
};

const EMPTY = { make: '', model: '', year: '', vin: '', license_plate: '', status: 'active', notes: '' };

export default function FleetVehicles() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['fleetVehicles'],
    queryFn: () => base44.entities.FleetVehicle.list('-created_date')
  });

  const filtered = vehicles.filter(v =>
    `${v.make} ${v.model} ${v.year} ${v.license_plate} ${v.vin}`.toLowerCase().includes(search.toLowerCase())
  );

  const openNew = () => { setForm(EMPTY); setEditId(null); setShowDialog(true); };
  const openEdit = (v) => { setForm({ make: v.make||'', model: v.model||'', year: v.year||'', vin: v.vin||'', license_plate: v.license_plate||'', status: v.status||'active', notes: v.notes||'' }); setEditId(v.id); setShowDialog(true); };

  const handleSave = async () => {
    setSaving(true);
    if (editId) {
      await base44.entities.FleetVehicle.update(editId, form);
    } else {
      await base44.entities.FleetVehicle.create(form);
    }
    queryClient.invalidateQueries({ queryKey: ['fleetVehicles'] });
    setSaving(false);
    setShowDialog(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this vehicle?')) return;
    await base44.entities.FleetVehicle.delete(id);
    queryClient.invalidateQueries({ queryKey: ['fleetVehicles'] });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Vehicles</h1>
            <p className="text-muted-foreground mt-1">Master list of all fleet vehicles</p>
          </div>
          <Button onClick={openNew} className="bg-primary text-primary-foreground hover:opacity-90 self-start md:self-auto">
            <Plus className="w-4 h-4 mr-2" /> Add Vehicle
          </Button>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search vehicles..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 text-primary animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-2xl border border-border">
            <Car className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No vehicles found</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map(v => (
              <div key={v.id} className="bg-card rounded-xl border border-border p-4 flex items-center gap-4 hover:shadow-md transition-all">
                <div className="w-10 h-10 rounded-lg bg-brand-blue/15 flex items-center justify-center flex-shrink-0">
                  <Car className="w-5 h-5 text-brand-blue" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground">{v.year} {v.make} {v.model}</p>
                  <p className="text-sm text-muted-foreground">{v.license_plate && `Plate: ${v.license_plate}`}{v.vin && ` · VIN: ${v.vin}`}</p>
                </div>
                <Badge className={`border ${statusColors[v.status] || statusColors.active}`}>{v.status || 'active'}</Badge>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(v)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(v.id)} className="text-destructive hover:opacity-80"><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? 'Edit Vehicle' : 'Add Vehicle'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Year</Label><Input value={form.year} onChange={e => setForm(f => ({...f, year: e.target.value}))} placeholder="2024" /></div>
              <div><Label>Make</Label><Input value={form.make} onChange={e => setForm(f => ({...f, make: e.target.value}))} placeholder="Ford" /></div>
              <div><Label>Model</Label><Input value={form.model} onChange={e => setForm(f => ({...f, model: e.target.value}))} placeholder="Transit" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>License Plate</Label><Input value={form.license_plate} onChange={e => setForm(f => ({...f, license_plate: e.target.value}))} placeholder="ABC1234" /></div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({...f, status: v}))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="maintenance">In Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>VIN</Label><Input value={form.vin} onChange={e => setForm(f => ({...f, vin: e.target.value}))} placeholder="VIN number" /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="Optional notes" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:opacity-90">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}{editId ? 'Save' : 'Add Vehicle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}