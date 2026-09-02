import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Users, Loader2, Pencil, Trash2, Phone, Mail, UserPlus } from 'lucide-react';

const statusColors = {
  active: 'bg-good/12 text-good border-good/25',
  inactive: 'bg-secondary text-secondary-foreground border-border',
  on_leave: 'bg-warn/12 text-warn border-warn/25'
};

const EMPTY = { first_name: '', last_name: '', phone: '', email: '', license_number: '', status: 'active', notes: '' };

const IMPORT_EMPTY = { team_member_id: '', license_number: '', status: 'active', notes: '' };

export default function FleetDrivers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importForm, setImportForm] = useState(IMPORT_EMPTY);
  const [importing, setImporting] = useState(false);

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true })
  });

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ['fleetDrivers'],
    queryFn: () => base44.entities.FleetDriver.list('-created_date')
  });

  const filtered = drivers.filter(d =>
    `${d.first_name} ${d.last_name} ${d.phone} ${d.email}`.toLowerCase().includes(search.toLowerCase())
  );

  const existingEmails = new Set(drivers.map(d => d.email).filter(Boolean));
  const availableTeamMembers = teamMembers.filter(tm => !existingEmails.has(tm.email));

  const openNew = () => { setForm(EMPTY); setEditId(null); setShowDialog(true); };
  const openEdit = (d) => { setForm({ first_name: d.first_name||'', last_name: d.last_name||'', phone: d.phone||'', email: d.email||'', license_number: d.license_number||'', status: d.status||'active', notes: d.notes||'' }); setEditId(d.id); setShowDialog(true); };

  const handleSave = async () => {
    setSaving(true);
    if (editId) {
      await base44.entities.FleetDriver.update(editId, form);
    } else {
      await base44.entities.FleetDriver.create(form);
    }
    queryClient.invalidateQueries({ queryKey: ['fleetDrivers'] });
    setSaving(false);
    setShowDialog(false);
  };

  const handleImport = async () => {
    if (!importForm.team_member_id) return;
    setImporting(true);
    const tm = teamMembers.find(t => t.id === importForm.team_member_id);
    if (tm) {
      await base44.entities.FleetDriver.create({
        first_name: tm.first_name,
        last_name: tm.last_name,
        phone: tm.phone || '',
        email: tm.email || '',
        license_number: importForm.license_number,
        status: importForm.status,
        notes: importForm.notes
      });
      queryClient.invalidateQueries({ queryKey: ['fleetDrivers'] });
    }
    setImporting(false);
    setShowImportDialog(false);
    setImportForm(IMPORT_EMPTY);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this driver?')) return;
    await base44.entities.FleetDriver.delete(id);
    queryClient.invalidateQueries({ queryKey: ['fleetDrivers'] });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Drivers</h1>
            <p className="text-muted-foreground mt-1">Master list of all fleet drivers</p>
          </div>
          <div className="flex flex-wrap gap-2 self-start md:self-auto">
          <Button variant="outline" onClick={() => { setImportForm(IMPORT_EMPTY); setShowImportDialog(true); }} className="border-primary/30 text-primary hover:bg-primary/10">
            <UserPlus className="w-4 h-4 mr-2" /> Import from Team
          </Button>
          <Button onClick={openNew} className="bg-primary text-primary-foreground hover:opacity-90">
            <Plus className="w-4 h-4 mr-2" /> Add Manually
          </Button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search drivers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 text-primary animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-2xl border border-border">
            <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No drivers found</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map(d => (
              <div key={d.id} className="bg-card rounded-xl border border-border p-4 flex items-center gap-4 hover:shadow-md transition-all">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground">{d.first_name} {d.last_name}</p>
                  <div className="flex gap-3 text-sm text-muted-foreground flex-wrap">
                    {d.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{d.phone}</span>}
                    {d.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{d.email}</span>}
                    {d.license_number && <span>License: {d.license_number}</span>}
                  </div>
                </div>
                <Badge className={`border ${statusColors[d.status] || statusColors.active}`}>{(d.status || 'active').replace('_', ' ')}</Badge>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(d)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(d.id)} className="text-destructive hover:opacity-80"><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? 'Edit Driver' : 'Add Driver'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>First Name</Label><Input value={form.first_name} onChange={e => setForm(f => ({...f, first_name: e.target.value}))} placeholder="First" /></div>
              <div><Label>Last Name</Label><Input value={form.last_name} onChange={e => setForm(f => ({...f, last_name: e.target.value}))} placeholder="Last" /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} placeholder="(555) 000-0000" /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="driver@email.com" /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>License #</Label><Input value={form.license_number} onChange={e => setForm(f => ({...f, license_number: e.target.value}))} placeholder="License number" /></div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({...f, status: v}))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="on_leave">On Leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="Optional notes" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:opacity-90">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}{editId ? 'Save' : 'Add Driver'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Import from Team</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Select Team Member</Label>
              <Select value={importForm.team_member_id} onValueChange={v => setImportForm(f => ({...f, team_member_id: v}))}>
                <SelectTrigger><SelectValue placeholder="Choose a team member..." /></SelectTrigger>
                <SelectContent>
                  {availableTeamMembers.map(tm => (
                    <SelectItem key={tm.id} value={tm.id}>{tm.first_name} {tm.last_name} {tm.role ? `— ${tm.role}` : ''}</SelectItem>
                  ))}
                  {availableTeamMembers.length === 0 && <SelectItem value="_none" disabled>All team members already added</SelectItem>}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Name, phone, and email will be pulled from their team profile.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>License # (optional)</Label><Input value={importForm.license_number} onChange={e => setImportForm(f => ({...f, license_number: e.target.value}))} placeholder="License number" /></div>
              <div><Label>Status</Label>
                <Select value={importForm.status} onValueChange={v => setImportForm(f => ({...f, status: v}))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="on_leave">On Leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Notes</Label><Input value={importForm.notes} onChange={e => setImportForm(f => ({...f, notes: e.target.value}))} placeholder="Optional notes" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={importing || !importForm.team_member_id} className="bg-primary text-primary-foreground hover:opacity-90">
              {importing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Import Driver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}