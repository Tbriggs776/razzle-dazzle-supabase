import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Search, Mic, Calendar, User, MapPin, Loader2, Trash2, Clock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import moment from 'moment';

export default function Recordings() {
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [appointmentToDelete, setAppointmentToDelete] = useState(null);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const isAdmin = currentUser?.role === 'admin';

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['appointmentsWithRecordings'],
    queryFn: async () => {
      const allAppointments = await base44.entities.Appointment.list();
      return allAppointments.filter(app => app.recording_url);
    }
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: () => base44.entities.Lead.list()
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  const getLeadName = (customerId) => {
    const lead = leads.find(l => l.id === customerId);
    return lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown';
  };

  const getDCName = (dcId) => {
    const dc = teamMembers.find(tm => tm.id === dcId);
    return dc ? `${dc.first_name} ${dc.last_name}` : 'Unassigned';
  };

  const formatDuration = (seconds) => {
    if (!seconds) return 'Unknown';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const deleteRecordingMutation = useMutation({
    mutationFn: async (appointmentId) => {
      await base44.entities.Appointment.update(appointmentId, {
        recording_url: null,
        recording_status: null,
        recording_analysis: null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointmentsWithRecordings'] });
      setDeleteDialogOpen(false);
      setAppointmentToDelete(null);
    }
  });

  const retryAnalysisMutation = useMutation({
    mutationFn: async (appointmentId) => {
      const response = await base44.functions.invoke('retryStuckRecording', { appointmentId });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointmentsWithRecordings'] });
    }
  });

  const filteredAppointments = appointments.filter(app => {
    const leadName = getLeadName(app.customer).toLowerCase();
    const dcName = getDCName(app.assigned_dc).toLowerCase();
    const location = (app.location_address || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    
    return leadName.includes(query) || dcName.includes(query) || location.includes(query);
  }).sort((a, b) => new Date(b.appointment_date) - new Date(a.appointment_date));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">Appointment Recordings</h1>
          <p className="text-slate-600">View and manage conversation recordings</p>
        </div>

        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search by customer, consultant, or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {filteredAppointments.length === 0 ? (
          <Card className="bg-white border border-slate-200">
            <CardContent className="p-12 text-center">
              <Mic className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600">
                {searchQuery ? 'No recordings found matching your search' : 'No recordings available yet'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredAppointments.map((appointment) => (
              <Card key={appointment.id} className="bg-white border border-slate-200 hover:shadow-lg transition-all">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Link
                      to={createPageUrl(`RecordingDetail?id=${appointment.id}`)}
                      className="flex items-start gap-4 flex-1 min-w-0"
                    >
                      <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                        <Mic className="w-6 h-6 text-indigo-600" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-slate-800 mb-2">
                          {getLeadName(appointment.customer)}
                        </h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                          <div className="flex items-center gap-2 text-slate-600">
                            <Calendar className="w-4 h-4 flex-shrink-0" />
                            <span>{moment(appointment.appointment_date).format('MMM D, YYYY')}</span>
                          </div>
                          
                          {appointment.assigned_dc && (
                            <div className="flex items-center gap-2 text-slate-600">
                              <User className="w-4 h-4 flex-shrink-0" />
                              <span className="truncate">{getDCName(appointment.assigned_dc)}</span>
                            </div>
                          )}
                          
                          <div className="flex items-center gap-2 text-slate-600">
                            <Clock className="w-4 h-4 flex-shrink-0" />
                            <span className="font-medium">{formatDuration(appointment.recording_duration)}</span>
                          </div>
                        </div>
                        
                        {appointment.location_address && (
                          <div className="flex items-center gap-2 text-slate-600 text-sm mt-2">
                            <MapPin className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate">{appointment.location_address}</span>
                          </div>
                        )}
                        
                        {isAdmin && appointment.recording_url && (
                          <div className="mt-2">
                            <a 
                              href={appointment.recording_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:text-blue-700 hover:underline block truncate max-w-md"
                              title={appointment.recording_url}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {appointment.recording_url}
                            </a>
                          </div>
                        )}
                      </div>
                    </Link>

                    <div className="flex flex-col gap-2 items-end">
                      <div className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium flex-shrink-0",
                        appointment.status === 'Sold' && "bg-green-100 text-green-700",
                        appointment.status === 'Completed' && "bg-blue-100 text-blue-700",
                        !['Sold', 'Completed'].includes(appointment.status) && "bg-slate-100 text-slate-700"
                      )}>
                        {appointment.status}
                      </div>
                      
                      {appointment.recording_status && (
                        <div className={cn(
                          "px-3 py-1 rounded-full text-xs font-medium flex-shrink-0 flex items-center gap-1",
                          appointment.recording_status === 'uploading' && "bg-amber-100 text-amber-700",
                          appointment.recording_status === 'analyzing' && "bg-purple-100 text-purple-700",
                          appointment.recording_status === 'completed' && "bg-green-100 text-green-700"
                        )}>
                          {appointment.recording_status === 'uploading' && (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Uploading
                            </>
                          )}
                          {appointment.recording_status === 'analyzing' && (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Analyzing
                            </>
                          )}
                          {appointment.recording_status === 'completed' && 'Completed'}
                        </div>
                      )}

                      {isAdmin && appointment.recording_status === 'analyzing' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            retryAnalysisMutation.mutate(appointment.id);
                          }}
                          disabled={retryAnalysisMutation.isPending}
                          className="h-8 text-xs"
                        >
                          {retryAnalysisMutation.isPending ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              Retrying...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-3 h-3 mr-1" />
                              Retry
                            </>
                          )}
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          setAppointmentToDelete(appointment);
                          setDeleteDialogOpen(true);
                        }}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Recording</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this recording? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteDialogOpen(false);
                  setAppointmentToDelete(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteRecordingMutation.mutate(appointmentToDelete.id)}
                disabled={deleteRecordingMutation.isPending}
              >
                {deleteRecordingMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete Recording'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}