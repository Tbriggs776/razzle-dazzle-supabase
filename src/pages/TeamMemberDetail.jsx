import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { 
  ArrowLeft, 
  Mail, 
  Phone, 
  Pencil, 
  Trash2, 
  Loader2,
  Calendar as CalendarIcon,
  Shield,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import TeamMemberForm from '@/components/team/TeamMemberForm';

const roleColors = {
  'Admin': 'bg-purple-100 text-purple-800 border-purple-200',
  'Design Consultant': 'bg-blue-100 text-blue-800 border-blue-200',
  'Customer Service Rep': 'bg-green-100 text-green-800 border-green-200'
};

export default function TeamMemberDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const memberId = urlParams.get('id');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: teamMember, isLoading } = useQuery({
    queryKey: ['teamMember', memberId],
    queryFn: async () => {
      const members = await base44.entities.TeamMember.filter({ id: memberId });
      return members[0];
    },
    enabled: !!memberId
  });

  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.TeamMember.update(memberId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamMember', memberId] });
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      setShowEditDialog(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => base44.entities.TeamMember.delete(memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      navigate(createPageUrl('TeamMembers'));
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!teamMember) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Team member not found</h2>
          <Link to={createPageUrl('TeamMembers')} className="text-indigo-600 hover:underline">
            Back to team members
          </Link>
        </div>
      </div>
    );
  }

  const initials = `${teamMember.first_name?.[0] || ''}${teamMember.last_name?.[0] || ''}`.toUpperCase();
  const fullName = `${teamMember.first_name} ${teamMember.last_name}`;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <Link
            to={createPageUrl('TeamMembers')}
            className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Team Members
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row md:items-center gap-6"
          >
            {/* Avatar */}
            <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-xl shadow-indigo-200 flex-shrink-0">
              {teamMember.profile_photo ? (
                <img 
                  src={teamMember.profile_photo} 
                  alt={fullName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-2xl">
                  {initials}
                </div>
              )}
            </div>

            {/* Name & Info */}
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-slate-800 tracking-tight">{fullName}</h1>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <Badge variant="secondary" className={cn('border', roleColors[teamMember.role])}>
                  <Shield className="w-3 h-3 mr-1" />
                  {teamMember.role}
                </Badge>
                <Badge 
                  variant="secondary" 
                  className={cn(
                    'border',
                    teamMember.is_active 
                      ? 'bg-green-50 text-green-700 border-green-200' 
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  )}
                >
                  {teamMember.is_active ? (
                    <>
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Active
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 mr-1" />
                      Inactive
                    </>
                  )}
                </Badge>
                {teamMember.calendar_integration_enabled && (
                  <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 border">
                    <CalendarIcon className="w-3 h-3 mr-1" />
                    Calendar Integrated
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => setShowEditDialog(true)}
                className="h-11 px-5 border-slate-200 hover:bg-slate-50"
              >
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(true)}
                className="h-11 px-5 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Contact Information */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Contact Information
            </h2>
            <div className="space-y-4">
              <a
                href={`mailto:${teamMember.email}`}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <Mail className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Email</p>
                  <p className="text-slate-800 group-hover:text-indigo-600 transition-colors">
                    {teamMember.email}
                  </p>
                </div>
              </a>

              {teamMember.phone && (
                <a
                  href={`tel:${teamMember.phone}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                    <Phone className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Phone</p>
                    <p className="text-slate-800 group-hover:text-green-600 transition-colors">
                      {teamMember.phone}
                    </p>
                  </div>
                </a>
              )}

              {!teamMember.phone && (
                <p className="text-slate-400 text-center py-4 text-sm">No phone number on file</p>
              )}
            </div>
          </motion.div>

          {/* Calendar Integration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Calendar Integration
            </h2>
            {teamMember.calendar_integration_enabled ? (
              <div className="space-y-4">
                <div className="flex items-start gap-4 p-3 rounded-xl bg-orange-50">
                  <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
                    <CalendarIcon className="w-5 h-5 text-orange-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-orange-900 mb-1">Integration Active</p>
                    {teamMember.google_calendar_id ? (
                      <p className="text-xs text-orange-700 break-all">{teamMember.google_calendar_id}</p>
                    ) : (
                      <p className="text-xs text-orange-700">Syncing to {teamMember.email}</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 flex items-center justify-center mb-3">
                  <CalendarIcon className="w-6 h-6 text-slate-400" />
                </div>
                <p className="text-sm text-slate-400">Calendar integration disabled</p>
              </div>
            )}
          </motion.div>

          {/* Metadata */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Record Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50">
                <CalendarIcon className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Created</p>
                  <p className="text-sm text-slate-700">
                    {new Date(teamMember.created_date + (teamMember.created_date.includes('Z') ? '' : 'Z')).toLocaleString('en-US', { 
                      month: 'short', 
                      day: 'numeric', 
                      year: 'numeric', 
                      hour: 'numeric', 
                      minute: '2-digit', 
                      hour12: true 
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50">
                <CalendarIcon className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Last Updated</p>
                  <p className="text-sm text-slate-700">
                    {new Date(teamMember.updated_date + (teamMember.updated_date.includes('Z') ? '' : 'Z')).toLocaleString('en-US', { 
                      month: 'short', 
                      day: 'numeric', 
                      year: 'numeric', 
                      hour: 'numeric', 
                      minute: '2-digit', 
                      hour12: true 
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50">
                <Mail className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Created By</p>
                  <p className="text-sm text-slate-700 truncate">{teamMember.created_by}</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-slate-800">Edit Team Member</DialogTitle>
          </DialogHeader>
          <TeamMemberForm
            teamMember={teamMember}
            onSubmit={(data) => updateMutation.mutate(data)}
            onCancel={() => setShowEditDialog(false)}
            isLoading={updateMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-800">Delete Team Member</DialogTitle>
            <DialogDescription className="text-slate-500 mt-2">
              Are you sure you want to delete <span className="font-semibold">{fullName}</span>? 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              className="border-slate-200"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Team Member'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}