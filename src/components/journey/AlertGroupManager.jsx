import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Users, Mail, MessageSquare, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import StatusPill from '@/components/common/StatusPill';

export default function AlertGroupManager() {
  const queryClient = useQueryClient();
  const [editingGroup, setEditingGroup] = useState(null);
  const [saving, setSaving] = useState(false);

  const { data: alertGroups = [], isLoading } = useQuery({
    queryKey: ['alertGroups'],
    queryFn: () => base44.entities.AlertGroup.list(),
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembersAlert'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }),
  });

  const handleNew = () => {
    setEditingGroup({
      name: '',
      label: '',
      description: '',
      member_ids: [],
      channels: ['sms'],
      enabled: true,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingGroup.id) {
        await base44.entities.AlertGroup.update(editingGroup.id, {
          name: editingGroup.name,
          label: editingGroup.label,
          description: editingGroup.description,
          member_ids: editingGroup.member_ids,
          channels: editingGroup.channels,
          enabled: editingGroup.enabled,
        });
      } else {
        await base44.entities.AlertGroup.create({
          name: editingGroup.name,
          label: editingGroup.label,
          description: editingGroup.description,
          member_ids: editingGroup.member_ids,
          channels: editingGroup.channels,
          enabled: true,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['alertGroups'] });
      setEditingGroup(null);
    } catch (e) {
      console.error('Failed to save alert group', e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this alert group?')) return;
    await base44.entities.AlertGroup.delete(id);
    queryClient.invalidateQueries({ queryKey: ['alertGroups'] });
  };

  const toggleMember = (memberId) => {
    setEditingGroup(g => ({
      ...g,
      member_ids: g.member_ids.includes(memberId)
        ? g.member_ids.filter(id => id !== memberId)
        : [...g.member_ids, memberId]
    }));
  };

  const toggleChannel = (channel) => {
    setEditingGroup(g => ({
      ...g,
      channels: g.channels.includes(channel)
        ? g.channels.filter(c => c !== channel)
        : [...g.channels, channel]
    }));
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Alert Groups</h2>
          <p className="text-sm text-muted-foreground">Manage who receives alerts for each checkpoint event</p>
        </div>
        <Button onClick={handleNew} size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          New Group
        </Button>
      </div>

      {/* Alert group cards */}
      <div className="grid gap-3">
        {alertGroups.map(group => (
          <div key={group.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-foreground">{group.label}</h3>
                <code className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{group.name}</code>
                {/* A disabled group means alerts are silently not going out — a status, so it
                    takes the shared StatusPill (crit, matching the red it carried before). */}
                {!group.enabled && <StatusPill tone="crit">Disabled</StatusPill>}
              </div>
              {group.description && <p className="text-sm text-muted-foreground mt-1">{group.description}</p>}
              <div className="flex items-center gap-3 mt-2">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="w-3 h-3" />
                  {group.member_ids?.length || 0} members
                </span>
                {group.channels?.includes('sms') && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MessageSquare className="w-3 h-3" /> SMS</span>}
                {group.channels?.includes('email') && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="w-3 h-3" /> Email</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditingGroup(group)}>Edit</Button>
              {/* hover:text-destructive is not redundant — the ghost variant would otherwise
                  flip this to the pink accent-foreground on hover. */}
              <Button variant="ghost" size="sm" onClick={() => handleDelete(group.id)} className="text-destructive hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}

        {alertGroups.length === 0 && !editingGroup && (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No alert groups yet. Create one to manage who gets notified.</p>
          </div>
        )}
      </div>

      {/* Editor panel — keeps its tinted border so the active edit surface stays distinct
          from the plain group cards above it. */}
      {editingGroup && (
        <div className="bg-card border border-primary/40 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-foreground">{editingGroup.id ? 'Edit Group' : 'New Alert Group'}</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Label (display name)</Label>
              <Input value={editingGroup.label} onChange={e => setEditingGroup({ ...editingGroup, label: e.target.value })} placeholder="e.g., Asbestos Hard Stop" />
            </div>
            <div className="space-y-1.5">
              <Label>Key (unique identifier)</Label>
              <Input value={editingGroup.name} onChange={e => setEditingGroup({ ...editingGroup, name: e.target.value })} placeholder="e.g., asbestos_hard_stop" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={editingGroup.description} onChange={e => setEditingGroup({ ...editingGroup, description: e.target.value })} placeholder="What this alert group is for" />
          </div>

          {/* Channels */}
          <div className="space-y-2">
            <Label>Notification Channels</Label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={editingGroup.channels.includes('sms')} onCheckedChange={() => toggleChannel('sms')} />
                <span className="text-sm text-foreground">SMS</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={editingGroup.channels.includes('email')} onCheckedChange={() => toggleChannel('email')} />
                <span className="text-sm text-foreground">Email</span>
              </label>
            </div>
          </div>

          {/* Members */}
          <div className="space-y-2">
            <Label>Members ({editingGroup.member_ids.length} selected)</Label>
            <div className="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border">
              {teamMembers.map(member => (
                <label key={member.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/60 cursor-pointer">
                  <Checkbox
                    checked={editingGroup.member_ids.includes(member.id)}
                    onCheckedChange={() => toggleMember(member.id)}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{member.first_name} {member.last_name}</p>
                    <p className="text-xs text-muted-foreground">{member.role}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditingGroup(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !editingGroup.name || !editingGroup.label} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}