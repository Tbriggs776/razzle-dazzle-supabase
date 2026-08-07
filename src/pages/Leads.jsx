import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Plus, Users, Loader2, ArrowUpDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import LeadCard from '@/components/leads/LeadCard';
import LeadForm from '@/components/leads/LeadForm';

export default function Leads() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [sortOrder, setSortOrder] = useState('desc');
  const queryClient = useQueryClient();

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['leads', sortOrder],
    queryFn: () => base44.entities.Lead.list(sortOrder === 'desc' ? '-created_date' : 'created_date')
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Lead.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setShowCreateDialog(false);
    }
  });

  // Filter leads based on search query
  const filteredLeads = leads.filter(lead => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const fullName = `${lead.first_name} ${lead.last_name}`.toLowerCase();
    return (
      fullName.includes(query) ||
      lead.email?.toLowerCase().includes(query) ||
      lead.phone?.includes(query)
    );
  });

  return (
    <div className="bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Leads</h1>
              <p className="text-slate-500 mt-1">Manage your lead database</p>
            </div>
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white h-12 px-6 rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-200 transition-all"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Lead
            </Button>
          </div>

          {/* Search and Sort */}
          <div className="mt-8 flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <Input
                placeholder="Search by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-14 bg-slate-50 border-slate-200 rounded-xl text-base focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all"
              />
            </div>
            <Button
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              variant="outline"
              className="h-14 px-4 border-slate-200 rounded-xl"
            >
              <ArrowUpDown className="w-5 h-5 mr-2" />
              {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          </div>
        ) : filteredLeads.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <div className="w-20 h-20 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center mb-6">
              <Users className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="text-xl font-semibold text-slate-800 mb-2">
              {searchQuery ? 'No leads found' : 'No leads yet'}
            </h3>
            <p className="text-slate-500 mb-6">
              {searchQuery
                ? 'Try adjusting your search query'
                : 'Get started by adding your first lead'}
            </p>
            {!searchQuery && (
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Lead
              </Button>
            )}
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {filteredLeads.map((lead, index) => (
                <LeadCard key={lead.id} lead={lead} index={index} />
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Results count */}
        {!isLoading && filteredLeads.length > 0 && (
          <p className="text-center text-sm text-slate-400 mt-8">
            Showing {filteredLeads.length} of {leads.length} leads
          </p>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-slate-800">New Lead</DialogTitle>
          </DialogHeader>
          <LeadForm
            onSubmit={(data) => createMutation.mutate(data)}
            onCancel={() => setShowCreateDialog(false)}
            isLoading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}