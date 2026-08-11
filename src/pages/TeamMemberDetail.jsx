import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SignedImage } from '@/lib/fileUrl';
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
  'Admin': 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/25',
  'Design Consultant': 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25',
  'Customer Service Rep': 'bg-green-100 text-green-800 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25'
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!teamMember) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">Team member not found</h2>
          <Link to={createPageUrl('TeamMembers')} className="text-primary hover:underline">
            Back to team members
          </Link>
        </div>
      </div>
    );
  }

  const initials = `${teamMember.first_name?.[0] || ''}${teamMember.last_name?.[0] || ''}`.toUpperCase();
  const fullName = `${teamMember.first_name} ${teamMember.last_name}`;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link
            to={createPageUrl('TeamMembers')}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
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
            <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-lg flex-shrink-0">
              {teamMember.profile_photo ? (
                <SignedImage
                  src={teamMember.profile_photo}
                  alt={fullName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-2xl">
                  {initials}
                </div>
              )}
            </div>

            {/* Name & Info */}
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-foreground tracking-tight">{fullName}</h1>
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
                      ? 'bg-green-100 text-green-800 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25'
                      : 'bg-secondary text-secondary-foreground border-border'
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
                  <Badge variant="secondary" className="bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25 border">
                    <CalendarIcon className="w-3 h-3 mr-1" />
                    Calendar Integrated
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() => setShowEditDialog(true)}
                className="h-11 px-5 border-border hover:bg-secondary"
              >
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(true)}
                className="h-11 px-5 border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Contact Information */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Contact Information
            </h2>
            <div className="space-y-4">
              <a
                href={`mailto:${teamMember.email}`}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-brand-blue/12 flex items-center justify-center">
                  <Mail className="w-5 h-5 text-brand-blue" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                  <p className="text-foreground group-hover:text-brand-blue transition-colors">
                    {teamMember.email}
                  </p>
                </div>
              </a>

              {teamMember.phone && (
                <a
                  href={`tel:${teamMember.phone}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-brand-pink/12 flex items-center justify-center">
                    <Phone className="w-5 h-5 text-brand-pink" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Phone</p>
                    <p className="text-foreground group-hover:text-brand-pink transition-colors">
                      {teamMember.phone}
                    </p>
                  </div>
                </a>
              )}

              {!teamMember.phone && (
                <p className="text-muted-foreground text-center py-4 text-sm">No phone number on file</p>
              )}
            </div>
          </motion.div>

          {/* Calendar Integration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Calendar Integration
            </h2>
            {teamMember.calendar_integration_enabled ? (
              <div className="space-y-4">
                <div className="flex items-start gap-4 p-3 rounded-xl bg-brand-gold/10">
                  <div className="w-10 h-10 rounded-lg bg-brand-gold/15 flex items-center justify-center flex-shrink-0">
                    <CalendarIcon className="w-5 h-5 text-brand-gold" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground mb-1">Integration Active</p>
                    {teamMember.google_calendar_id ? (
                      <p className="text-xs text-muted-foreground break-all">{teamMember.google_calendar_id}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Syncing to {teamMember.email}</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto rounded-xl bg-secondary flex items-center justify-center mb-3">
                  <CalendarIcon className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">Calendar integration disabled</p>
              </div>
            )}
          </motion.div>

          {/* Metadata */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-card rounded-2xl border border-border p-6 md:col-span-2"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Record Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-4 p-3 rounded-xl bg-secondary">
                <CalendarIcon className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Created</p>
                  <p className="text-sm text-foreground">
                    {new Date(teamMember.created_date).toLocaleString('en-US', { 
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
              <div className="flex items-center gap-4 p-3 rounded-xl bg-secondary">
                <CalendarIcon className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Last Updated</p>
                  <p className="text-sm text-foreground">
                    {new Date(teamMember.updated_date).toLocaleString('en-US', { 
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
              <div className="flex items-center gap-4 p-3 rounded-xl bg-secondary">
                <Mail className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Created By</p>
                  <p className="text-sm text-foreground truncate">{teamMember.created_by}</p>
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
            <DialogTitle className="text-2xl font-bold text-foreground">Edit Team Member</DialogTitle>
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
            <DialogTitle className="text-xl font-bold text-foreground">Delete Team Member</DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2">
              Are you sure you want to delete <span className="font-semibold">{fullName}</span>? 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              className="border-border"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:opacity-90"
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