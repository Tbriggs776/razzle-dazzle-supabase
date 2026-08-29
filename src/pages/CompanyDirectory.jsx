import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Search, Phone, Mail, User, Users } from 'lucide-react';
import { SignedImage } from '@/lib/fileUrl';

const ROLES = [
  "Admin",
  "Design Consultant",
  "Customer Service Rep",
  "Order Processor",
  "Sales Manager",
  "Finance Manager",
  "Operations",
  "Customer Experience Coordinator"
];

const roleColors = {
  "Admin": "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  "Design Consultant": "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  "Customer Service Rep": "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  "Order Processor": "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  "Sales Manager": "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  "Finance Manager": "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  "Operations": "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  "Customer Experience Coordinator": "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300",
};

// Company Directory page
export default function CompanyDirectory() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', role: '', bio: '' });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: teamMembers = [], isLoading } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TeamMember.create({ ...data, is_active: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      setShowAddDialog(false);
      setForm({ first_name: '', last_name: '', email: '', phone: '', role: '', bio: '' });
    }
  });

  const isAdmin = currentUser?.role === 'admin';

  const filtered = teamMembers.filter(m => {
    if (!m.is_active && m.is_active !== undefined) return false;
    const q = search.toLowerCase();
    return (
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
      m.email?.toLowerCase().includes(q) ||
      m.role?.toLowerCase().includes(q)
    );
  });

  // Group by role
  const grouped = ROLES.reduce((acc, role) => {
    const members = filtered.filter(m => m.role === role);
    if (members.length > 0) acc[role] = members;
    return acc;
  }, {});
  const unassigned = filtered.filter(m => !m.role || !ROLES.includes(m.role));

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
                <Users className="w-7 h-7 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground tracking-tight">Company Directory</h1>
                <p className="text-muted-foreground mt-1">{teamMembers.filter(m => m.is_active !== false).length} team members</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative w-full sm:w-auto">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, role..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 w-full sm:w-64"
                />
              </div>
              {isAdmin && (
                <Button onClick={() => setShowAddDialog(true)} className="bg-primary text-primary-foreground hover:opacity-90">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Employee
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <div className="space-y-10">
            {Object.entries(grouped).map(([role, members]) => (
              <div key={role}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{role}</h2>
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">{members.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {members.map(member => (
                    <MemberCard key={member.id} member={member} roleColors={roleColors} />
                  ))}
                </div>
              </div>
            ))}
            {unassigned.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Unassigned</h2>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {unassigned.map(member => (
                    <MemberCard key={member.id} member={member} roleColors={roleColors} />
                  ))}
                </div>
              </div>
            )}
            {filtered.length === 0 && (
              <div className="text-center py-20">
                <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No team members found</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Employee Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>First Name *</Label>
                <Input value={form.first_name} onChange={e => set('first_name', e.target.value)} placeholder="Jane" />
              </div>
              <div>
                <Label>Last Name *</Label>
                <Input value={form.last_name} onChange={e => set('last_name', e.target.value)} placeholder="Doe" />
              </div>
            </div>
            <div>
              <Label>Email *</Label>
              <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="user9@example.com" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(602) 555-0000" />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role} onValueChange={v => set('role', v)}>
                <SelectTrigger><SelectValue placeholder="Select role..." /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Bio</Label>
              <Input value={form.bio} onChange={e => set('bio', e.target.value)} placeholder="Short bio..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={createMutation.isPending || !form.first_name || !form.last_name || !form.email}
              className="bg-primary text-primary-foreground hover:opacity-90"
            >
              {createMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Adding...</> : 'Add Employee'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MemberCard({ member, roleColors }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {member.profile_photo ? (
            <SignedImage src={member.profile_photo} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg font-bold text-primary">
              {member.first_name?.[0]}{member.last_name?.[0]}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate">{member.first_name} {member.last_name}</p>
          {member.role && (
            <Badge className={`mt-1 text-xs ${roleColors[member.role] || 'bg-secondary text-secondary-foreground'}`}>
              {member.role}
            </Badge>
          )}
        </div>
      </div>
      {member.bio && (
        <p className="mt-3 text-xs text-muted-foreground line-clamp-2">{member.bio}</p>
      )}
      <div className="mt-4 space-y-2">
        {member.email && (
          <a href={`mailto:${member.email}`} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors truncate">
            <Mail className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{member.email}</span>
          </a>
        )}
        {member.phone && (
          <a href={`tel:${member.phone}`} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors">
            <Phone className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{member.phone}</span>
          </a>
        )}
      </div>
    </div>
  );
}
