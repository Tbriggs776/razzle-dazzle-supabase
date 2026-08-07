import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Plus, Palette, Loader2, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import TeamMemberCard from '@/components/team/TeamMemberCard';
import TeamMemberForm from '@/components/team/TeamMemberForm';

export default function DesignConsultants() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const queryClient = useQueryClient();

  const { data: teamMembers = [], isLoading } = useQuery({
    queryKey: ['designConsultants'],
    queryFn: async () => {
      const members = await base44.entities.TeamMember.filter({ role: 'Design Consultant' }, '-created_date');
      return members;
    }
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TeamMember.create({ ...data, role: 'Design Consultant' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['designConsultants'] });
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      setShowCreateDialog(false);
    }
  });

  // Filter by search
  const filteredMembers = teamMembers.filter(member => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const fullName = `${member.first_name} ${member.last_name}`.toLowerCase();
    return (
      fullName.includes(query) ||
      member.email?.toLowerCase().includes(query) ||
      member.phone?.includes(query)
    );
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <Link
            to={createPageUrl('TeamMembers')}
            className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            All Team Members
          </Link>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Design Consultants</h1>
              <p className="text-slate-500 mt-1">Creative team members who work with clients on design projects</p>
            </div>
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white h-12 px-6 rounded-xl shadow-lg shadow-blue-200 hover:shadow-xl hover:shadow-blue-200 transition-all"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Design Consultant
            </Button>
          </div>

          {/* Search */}
          <div className="mt-8 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search design consultants..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 h-14 bg-slate-50 border-slate-200 rounded-xl text-base focus:bg-white focus:border-blue-500 focus:ring-blue-500 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
        ) : filteredMembers.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <div className="w-20 h-20 mx-auto rounded-2xl bg-blue-50 flex items-center justify-center mb-6">
              <Palette className="w-10 h-10 text-blue-400" />
            </div>
            <h3 className="text-xl font-semibold text-slate-800 mb-2">
              {searchQuery ? 'No design consultants found' : 'No design consultants yet'}
            </h3>
            <p className="text-slate-500 mb-6">
              {searchQuery
                ? 'Try adjusting your search query'
                : 'Get started by adding your first design consultant'}
            </p>
            {!searchQuery && (
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Design Consultant
              </Button>
            )}
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {filteredMembers.map((member, index) => (
                <TeamMemberCard key={member.id} teamMember={member} index={index} />
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Results count */}
        {!isLoading && filteredMembers.length > 0 && (
          <p className="text-center text-sm text-slate-400 mt-8">
            Showing {filteredMembers.length} design consultant{filteredMembers.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-slate-800">New Design Consultant</DialogTitle>
          </DialogHeader>
          <TeamMemberForm
            teamMember={{ role: 'Design Consultant' }}
            onSubmit={(data) => createMutation.mutate(data)}
            onCancel={() => setShowCreateDialog(false)}
            isLoading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}