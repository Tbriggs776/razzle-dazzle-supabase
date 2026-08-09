import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Plus, UserCog, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import TeamMemberCard from '@/components/team/TeamMemberCard';
import TeamMemberForm from '@/components/team/TeamMemberForm';

export default function TeamMembers() {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const queryClient = useQueryClient();

  const { data: teamMembers = [], isLoading: isLoadingTeamMembers } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list('-created_date')
  });

  const { data: base44Users = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ['base44Users'],
    queryFn: () => base44.entities.User.list('-created_date')
  });

  const isLoading = isLoadingTeamMembers || isLoadingUsers;

  // Merge users with team members
  const mergedData = [
    // Base44 Users (with or without team member records)
    ...base44Users.map(user => {
      const teamMember = teamMembers.find(tm => tm.email === user.email);
      return {
        ...user,
        teamMember,
        hasTeamMember: !!teamMember,
        hasBase44Access: true,
        type: 'user'
      };
    }),
    // Team Members without Base44 User accounts
    ...teamMembers
      .filter(tm => !base44Users.find(u => u.email === tm.email))
      .map(tm => ({
        id: tm.id,
        email: tm.email,
        full_name: `${tm.first_name} ${tm.last_name}`,
        teamMember: tm,
        hasTeamMember: true,
        hasBase44Access: false,
        type: 'team_member_only'
      }))
  ];

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TeamMember.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      setShowCreateDialog(false);
      setSelectedUser(null);
    }
  });

  // Filter merged data
  const filteredData = mergedData.filter(item => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const fullName = item.full_name?.toLowerCase() || '';
      const teamMemberName = item.teamMember ? `${item.teamMember.first_name} ${item.teamMember.last_name}`.toLowerCase() : '';
      const matchesSearch = 
        fullName.includes(query) ||
        teamMemberName.includes(query) ||
        item.email?.toLowerCase().includes(query) ||
        item.teamMember?.phone?.includes(query);
      if (!matchesSearch) return false;
    }

    // Role filter
    if (roleFilter === 'all') return true;
    if (roleFilter === 'no_team_member') return !item.hasTeamMember;
    if (roleFilter === 'no_base44_access') return !item.hasBase44Access;
    return item.teamMember?.role === roleFilter;
  });

  return (
    <div className="bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Team Members</h1>
              <p className="text-muted-foreground mt-1">Manage your team and their roles</p>
            </div>
            <Button
              onClick={() => {
                setSelectedUser(null);
                setShowCreateDialog(true);
              }}
              className="bg-primary text-primary-foreground hover:opacity-90 h-12 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Team Member
            </Button>
          </div>

          {/* Filters */}
          <div className="mt-8 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-14 bg-secondary border-border rounded-xl text-base focus:bg-card focus:border-ring focus:ring-ring transition-all"
              />
            </div>

            {/* Role tabs */}
            <Tabs value={roleFilter} onValueChange={setRoleFilter}>
              <TabsList className="bg-secondary p-1 flex-nowrap overflow-x-auto max-w-full justify-start">
                <TabsTrigger value="all" className="rounded-lg">All Users</TabsTrigger>
                <TabsTrigger value="no_team_member" className="rounded-lg">
                  Needs Team Member
                  {mergedData.filter(d => !d.hasTeamMember && d.hasBase44Access).length > 0 && (
                    <span className="ml-2 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                      {mergedData.filter(d => !d.hasTeamMember && d.hasBase44Access).length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="no_base44_access" className="rounded-lg">
                  Needs Base44 Access
                  {mergedData.filter(d => !d.hasBase44Access).length > 0 && (
                    <span className="ml-2 px-2 py-0.5 bg-amber-500 text-white text-xs rounded-full">
                      {mergedData.filter(d => !d.hasBase44Access).length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="Design Consultant" className="rounded-lg">Design Consultants</TabsTrigger>
                <TabsTrigger value="Customer Service Rep" className="rounded-lg">Customer Service</TabsTrigger>
                <TabsTrigger value="Admin" className="rounded-lg">Admins</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : filteredData.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <div className="w-20 h-20 mx-auto rounded-2xl bg-secondary flex items-center justify-center mb-6">
              <UserCog className="w-10 h-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">
              {searchQuery || roleFilter !== 'all' ? 'No users found' : 'No users yet'}
            </h3>
            <p className="text-muted-foreground mb-6">
              {searchQuery || roleFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Invite users from the Base44 dashboard'}
            </p>
            {!searchQuery && roleFilter === 'all' && (
              <Button
                onClick={() => {
                  setSelectedUser(null);
                  setShowCreateDialog(true);
                }}
                className="bg-primary text-primary-foreground hover:opacity-90"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Team Member
              </Button>
            )}
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <AnimatePresence>
              {filteredData.map((item, index) => (
                item.hasTeamMember ? (
                  <div key={item.id} className="relative">
                    <TeamMemberCard teamMember={item.teamMember} index={index} />
                    {!item.hasBase44Access && (
                      <div className="absolute top-3 right-3">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25">
                          No Base44 Access
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-card rounded-xl border-2 border-dashed border-red-200 dark:border-red-500/30 p-6 hover:shadow-lg transition-all cursor-pointer"
                    onClick={() => {
                      setSelectedUser(item);
                      setShowCreateDialog(true);
                    }}
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-red-50 dark:bg-red-500/15 flex items-center justify-center flex-shrink-0">
                        <UserCog className="w-6 h-6 text-red-500 dark:text-red-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-foreground truncate">
                          {item.full_name}
                        </h3>
                        <p className="text-sm text-muted-foreground truncate">{item.email}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300">
                            No Team Member Record
                          </span>
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-secondary text-secondary-foreground">
                            Base44 {item.role}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-3">
                          Click to create Team Member record
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Results count */}
        {!isLoading && filteredData.length > 0 && (
          <p className="text-center text-sm text-muted-foreground mt-8">
            Showing {filteredData.length} of {mergedData.length} users
            {mergedData.filter(d => !d.hasTeamMember && d.hasBase44Access).length > 0 && (
              <span className="text-destructive ml-2">
                ({mergedData.filter(d => !d.hasTeamMember && d.hasBase44Access).length} need Team Member records)
              </span>
            )}
            {mergedData.filter(d => !d.hasBase44Access).length > 0 && (
              <span className="text-amber-600 dark:text-amber-400 ml-2">
                ({mergedData.filter(d => !d.hasBase44Access).length} need Base44 access)
              </span>
            )}
          </p>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => {
        setShowCreateDialog(open);
        if (!open) setSelectedUser(null);
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-foreground">
              {selectedUser ? `Create Team Member for ${selectedUser.full_name}` : 'New Team Member'}
            </DialogTitle>
          </DialogHeader>
          <TeamMemberForm
            teamMember={selectedUser ? {
              first_name: selectedUser.full_name?.split(' ')[0] || '',
              last_name: selectedUser.full_name?.split(' ').slice(1).join(' ') || '',
              email: selectedUser.email
            } : null}
            onSubmit={(data) => createMutation.mutate(data)}
            onCancel={() => {
              setShowCreateDialog(false);
              setSelectedUser(null);
            }}
            isLoading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}