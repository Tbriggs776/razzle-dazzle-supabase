import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Mail, Phone, Loader2, Save, HardHat, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export default function InstallerManager() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [editMap, setEditMap] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCrew, setNewCrew] = useState({ crew_name: '', email: '', phone: '' });
  const [adding, setAdding] = useState(false);

  const { data: installers = [], isLoading } = useQuery({
    queryKey: ['installers'],
    queryFn: () => base44.entities.Installer.list(),
  });

  const { data: crews = [] } = useQuery({
    queryKey: ['rfmsCrewsInstallerMgr'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getRFMSCrews', {});
      return res.data?.crews?.detail || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      const existing = await base44.entities.Installer.list();
      const existingIds = new Set(existing.map(i => String(i.crew_id)));
      const toCreate = [];
      for (const crew of crews) {
        const crewId = String(crew.crewId || crew.id);
        const crewName = crew.crewName || crew.name || crewId;
        if (!existingIds.has(crewId)) {
          toCreate.push({ crew_id: crewId, crew_name: crewName, is_active: true });
        }
      }
      if (toCreate.length > 0) {
        await base44.entities.Installer.bulkCreate(toCreate);
      }
      queryClient.invalidateQueries({ queryKey: ['installers'] });
    } catch (e) {
      console.error('Sync failed', e);
      toast.error('Failed to sync crews: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async (installer) => {
    const edits = editMap[installer.id] || {};
    setSavingId(installer.id);
    try {
      await base44.entities.Installer.update(installer.id, {
        email: edits.email !== undefined ? edits.email : installer.email,
        phone: edits.phone !== undefined ? edits.phone : installer.phone,
      });
      setEditMap(m => {
        const next = { ...m };
        delete next[installer.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['installers'] });
    } catch (e) {
      console.error('Save failed', e);
      toast.error('Failed to save: ' + e.message);
    } finally {
      setSavingId(null);
    }
  };

  const getEditValue = (installer, field) => {
    const edits = editMap[installer.id];
    if (edits && edits[field] !== undefined) return edits[field];
    return installer[field] || '';
  };

  const setEditValue = (id, field, value) => {
    setEditMap(m => ({
      ...m,
      [id]: { ...(m[id] || {}), [field]: value }
    }));
  };

  const hasEdits = (installer) => !!editMap[installer.id];

  const handleAddManual = async () => {
    if (!newCrew.crew_name.trim()) {
      toast.error('Crew name is required.');
      return;
    }
    setAdding(true);
    try {
      const crewId = `MANUAL-${Date.now()}`;
      await base44.entities.Installer.create({
        crew_id: crewId,
        crew_name: newCrew.crew_name.trim(),
        email: newCrew.email.trim() || undefined,
        phone: newCrew.phone.trim() || undefined,
        is_active: true,
      });
      setNewCrew({ crew_name: '', email: '', phone: '' });
      setShowAddForm(false);
      queryClient.invalidateQueries({ queryKey: ['installers'] });
    } catch (e) {
      console.error('Add manual crew failed', e);
      toast.error('Failed to add crew: ' + e.message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Installer Contact Info</h2>
          <p className="text-sm text-slate-500">Manage email & phone for each RFMS crew. Installers receive notifications when their checkpoint is approved or rejected.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowAddForm(s => !s)} size="sm" variant="outline" className="gap-2">
            {showAddForm ? <X className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            {showAddForm ? 'Cancel' : 'Add Manual Crew'}
          </Button>
          <Button onClick={handleSync} disabled={syncing || !crews.length} size="sm" variant="outline" className="gap-2">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Sync Crews
          </Button>
        </div>
      </div>

      {showAddForm && (
        <div className="bg-white border border-indigo-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-800">Add Manual Crew</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Crew Name <span className="text-red-500">*</span></label>
              <Input
                value={newCrew.crew_name}
                onChange={e => setNewCrew(c => ({ ...c, crew_name: e.target.value }))}
                placeholder="e.g., Joe's Crew"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Email</label>
              <Input
                type="email"
                value={newCrew.email}
                onChange={e => setNewCrew(c => ({ ...c, email: e.target.value }))}
                placeholder="Email"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Phone</label>
              <Input
                type="tel"
                value={newCrew.phone}
                onChange={e => setNewCrew(c => ({ ...c, phone: e.target.value }))}
                placeholder="Phone"
                className="h-9 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleAddManual} disabled={adding || !newCrew.crew_name.trim()} size="sm" className="gap-2">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Add Crew
            </Button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-indigo-600 animate-spin" /></div>
      )}

      <div className="grid gap-2">
        {installers.map(installer => {
          const hasContact = installer.email || installer.phone;
          return (
            <div key={installer.id} className={`bg-white border rounded-xl p-3 ${hasEdits(installer) ? 'border-indigo-300' : hasContact ? 'border-slate-200' : 'border-amber-200 bg-amber-50/30'}`}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                  <HardHat className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-slate-800 truncate">{installer.crew_name}</p>
                    {installer.crew_id?.startsWith('MANUAL-') && (
                      <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">Manual</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 font-mono">{installer.crew_id}</p>
                </div>
                {!hasContact && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">No contact info</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    type="email"
                    value={getEditValue(installer, 'email')}
                    onChange={e => setEditValue(installer.id, 'email', e.target.value)}
                    placeholder="Email"
                    className="h-8 pl-8 text-sm"
                  />
                </div>
                <div className="relative">
                  <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    type="tel"
                    value={getEditValue(installer, 'phone')}
                    onChange={e => setEditValue(installer.id, 'phone', e.target.value)}
                    placeholder="Phone"
                    className="h-8 pl-8 text-sm"
                  />
                </div>
              </div>

              {hasEdits(installer) && (
                <div className="flex justify-end mt-2">
                  <Button
                    size="sm"
                    onClick={() => handleSave(installer)}
                    disabled={savingId === installer.id}
                    className="h-7 text-xs gap-1.5"
                  >
                    {savingId === installer.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    Save
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {installers.length === 0 && !isLoading && (
          <div className="text-center py-8 text-slate-400">
            <HardHat className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No installers yet. Click "Sync Crews" to pull from RFMS, or "Add Manual Crew" to create one.</p>
          </div>
        )}
      </div>
    </div>
  );
}