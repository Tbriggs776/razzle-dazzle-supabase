import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { runPostConversion } from '@/lib/postConversion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, ClipboardList, CheckCircle2, Calendar, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import GreetingSection from '@/components/checklistv2/GreetingSection';
import ContactInfoSection from '@/components/checklistv2/ContactInfoSection';
import FrameExperienceSection from '@/components/checklistv2/FrameExperienceSection';
import DiscoverySection from '@/components/checklistv2/DiscoverySection';
import ScopeSection from '@/components/checklistv2/ScopeSection';
import SuperSaleSection from '@/components/checklistv2/SuperSaleSection';
import ValueStackSection from '@/components/checklistv2/ValueStackSection';
import AllPartiesSection from '@/components/checklistv2/AllPartiesSection';
import WorkFromHomeSection from '@/components/checklistv2/WorkFromHomeSection';
import FinancingSection from '@/components/checklistv2/FinancingSection';
import TimeframeSection from '@/components/checklistv2/TimeframeSection';
import OtherEstimatesSection from '@/components/checklistv2/OtherEstimatesSection';
import AppointmentSchedulingSection from '@/components/checklistv2/AppointmentSchedulingSection';
import RecapSection from '@/components/checklistv2/RecapSection';
import OutroSection from '@/components/checklistv2/OutroSection';
import AISummarySection from '@/components/checklistv2/AISummarySection';
import { toast } from 'sonner';

// Convert en-dash time block to "to" format for Appointment entity
const convertTimeBlock = (block) => block ? block.replace(/–/g, ' to ') : undefined;

export default function ChecklistV2Detail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const checklistId = urlParams.get('id');

  const autoSaveTimeoutRef = useRef(null);
  const [formData, setFormData] = useState({});
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [selectedCSR, setSelectedCSR] = useState('');
  const [selectedDC, setSelectedDC] = useState('');

  const { data: checklist, isLoading } = useQuery({
    queryKey: ['checklistv2', checklistId],
    queryFn: async () => {
      if (!checklistId) return null;
      const results = await base44.entities.ChecklistV2.filter({ id: checklistId });
      return results[0] || null;
    },
    enabled: !!checklistId
  });

  useEffect(() => {
    if (checklist) {
      setFormData(checklist);
    }
  }, [checklist]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ChecklistV2.create(data),
    onSuccess: (newChecklist) => {
      queryClient.invalidateQueries({ queryKey: ['checklistv2'] });
      // Update URL without reload
      window.history.replaceState({}, '', `/ChecklistV2Detail?id=${newChecklist.id}`);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  });

  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.ChecklistV2.update(checklist.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklistv2', checklistId] });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  });

  // Fetch linked appointment (if any)
  const { data: linkedAppointment } = useQuery({
    queryKey: ['appointment', checklist?.appointment],
    queryFn: async () => {
      const results = await base44.entities.Appointment.filter({ id: checklist.appointment });
      return results[0] || null;
    },
    enabled: !!checklist?.appointment
  });

  // Fetch team members for the convert dialog
  const { data: csrMembers = [] } = useQuery({
    queryKey: ['csrMembers'],
    queryFn: async () => {
      const all = await base44.entities.TeamMember.list();
      return all.filter(m => m.is_active && (m.role === 'Customer Service Rep' || m.role === 'Sales Manager' || m.role === 'Admin'));
    },
    enabled: showConvertDialog
  });

  const { data: designConsultants = [] } = useQuery({
    queryKey: ['designConsultants'],
    queryFn: async () => {
      const all = await base44.entities.TeamMember.list();
      return all.filter(m => m.is_active && (m.role === 'Design Consultant' || m.role === 'Sales Manager'));
    },
    enabled: showConvertDialog
  });

  // Auto-populate CSR from current user
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  useEffect(() => {
    if (showConvertDialog && currentUser && csrMembers.length > 0 && !selectedCSR) {
      const match = csrMembers.find(m => m.email === currentUser.email);
      if (match) setSelectedCSR(match.id);
    }
  }, [showConvertDialog, currentUser, csrMembers, selectedCSR]);

  const convertToAppointmentMutation = useMutation({
    mutationFn: async () => {
      const current = await base44.auth.me();

      // Find or create Lead
      let leadId;
      const existingLeads = formData.customer_email
        ? await base44.entities.Lead.filter({ email: formData.customer_email })
        : [];
      if (existingLeads.length > 0) {
        leadId = existingLeads[0].id;
      } else {
        const newLead = await base44.entities.Lead.create({
          first_name: formData.customer_first_name || 'Unknown',
          last_name: formData.customer_last_name || 'Customer',
          email: formData.customer_email || '',
          phone: formData.customer_phone || '',
          address_line1: formData.customer_street || '',
          city: formData.city || '',
          state: formData.state || '',
          zip: formData.postal_code || ''
        });
        leadId = newLead.id;
      }

      // Build notes from AI summary or project notes
      const notes = [];
      const noteContent = formData.ai_summary || formData.other_project_notes;
      if (noteContent) {
        notes.push({
          content: noteContent,
          user_name: current.full_name,
          user_email: current.email,
          timestamp: new Date().toISOString(),
          context: 'Checklist 2.0'
        });
      }

      const newAppointment = await base44.entities.Appointment.create({
        status: selectedDC && selectedDC !== 'unassigned' ? 'Scheduled' : 'Awaiting Assignment',
        customer: leadId,
        location_address: [formData.customer_street, formData.city, formData.state, formData.postal_code].filter(Boolean).join(', '),
        appointment_date: formData.preferred_appointment_date,
        appointment_block: convertTimeBlock(formData.preferred_appointment_block),
        notes,
        assigned_dc: (selectedDC && selectedDC !== 'unassigned') ? selectedDC : undefined,
        assigned_csr: selectedCSR || undefined,
        appointment_created_date: new Date().toISOString()
      });

      // Link checklist to appointment
      await base44.entities.ChecklistV2.update(checklistId, { appointment: newAppointment.id });

      // Sync calendar (non-blocking)
      const csrMember = csrMembers.find(m => m.id === selectedCSR);
      base44.functions.invoke('syncCalendarEvent', {
        appointmentId: newAppointment.id,
        action: 'create',
        appUrl: window.location.origin,
        csrEmail: csrMember?.email
      }).catch(e => console.error('Calendar sync failed:', e));

      // Post-conversion notifications (non-blocking). Reimplements the unported
      // handlePostConversion — tracking short URLs + lead/consultant SMS + internal email.
      runPostConversion({
        appointmentId: newAppointment.id,
        hasDC: !!(selectedDC && selectedDC !== 'unassigned'),
      }).catch(e => console.error('Post-conversion failed:', e));

      return newAppointment.id;
    },
    onSuccess: (appointmentId) => {
      setShowConvertDialog(false);
      navigate(createPageUrl('AppointmentDetail') + `?id=${appointmentId}`);
    },
    onError: (error) => {
      toast.error(`Failed to convert: ${error.message}`);
    }
  });

  const canConvert = !!(
    formData.customer_first_name &&
    formData.customer_last_name &&
    formData.customer_phone &&
    formData.preferred_appointment_date &&
    formData.preferred_appointment_block &&
    formData.heard_about_us
  );

  const handleChange = (field, value) => {
    const newData = { ...formData, [field]: value };
    setFormData(newData);
    setSaveStatus('saving');

    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(() => {
      if (checklist?.id) {
        updateMutation.mutate(newData);
      } else {
        createMutation.mutate(newData);
      }
    }, 800);
  };

  // Overall progress
  const sections = [
    { key: 'greeting', label: 'Greeting', complete: formData.greeting_completed && !!formData.caller_type },
    { key: 'frame', label: 'Frame the Experience', complete: !!(formData.frame_greeted_properly && formData.frame_experience_delivered) },
    { key: 'contact', label: 'Contact Info', complete: !!(formData.customer_first_name && formData.customer_last_name && formData.customer_phone && formData.customer_email && formData.customer_street && formData.city && formData.state && formData.postal_code && formData.lives_at_address && formData.home_built_era) },
    { key: 'discovery', label: 'Discovery', complete: !!(formData.discovery_q1 && formData.discovery_q2 && formData.discovery_q3 && formData.discovery_q4 && formData.discovery_q5) },
    { key: 'scope', label: 'Scope', complete: !!(formData.scope_gap_fill_notes) },
    { key: 'super_sale', label: 'Super Sale', complete: !!formData.super_sale_delivered },
    { key: 'value_stack', label: 'Value Stack', complete: !!formData.value_stack_delivered },
    { key: 'all_parties', label: 'All Parties', complete: !!(formData.prequal_dm_track && !formData.prequal_below_minimum) },
    { key: 'work_from_home', label: 'Work From Home', complete: !!formData.work_from_home },
    { key: 'financing', label: 'Financing', complete: !!(formData.financing_notes || formData.credit_score_range) },
    { key: 'timeframe', label: 'Time Frame', complete: !!formData.project_timeframe },
    { key: 'other_estimates', label: 'Other Estimates', complete: !!formData.collected_other_estimates },
    { key: 'scheduling', label: 'Scheduling', complete: !!(formData.preferred_appointment_date && formData.preferred_appointment_block && formData.two_hour_window_confirmation) },
    { key: 'recap', label: 'Recap', complete: !!(formData.recap_completed && formData.heard_about_us) },
    { key: 'outro', label: 'Outro', complete: !!formData.outro_completed },
    { key: 'ai_summary', label: 'AI Summary', complete: !!formData.ai_summary }
  ];
  const completedCount = sections.filter(s => s.complete).length;
  const percentage = Math.round((completedCount / sections.length) * 100);

  if (!checklistId && !isLoading) {
    // New checklist — start with blank form
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <ClipboardList className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-bold text-foreground">Checklist 2.0</p>
              <p className="text-xs text-muted-foreground">Appointment Setting</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {linkedAppointment ? (
              <Link to={createPageUrl('AppointmentDetail') + `?id=${linkedAppointment.id}`}>
                <Button className="h-8 px-3 bg-primary text-primary-foreground hover:opacity-90 text-xs">
                  <Calendar className="w-3.5 h-3.5 mr-1.5" />
                  View Appointment
                </Button>
              </Link>
            ) : canConvert && (
              <Button
                onClick={() => setShowConvertDialog(true)}
                className="h-8 px-3 bg-green-600 hover:bg-green-700 text-white text-xs"
              >
                <Calendar className="w-3.5 h-3.5 mr-1.5" />
                Convert
              </Button>
            )}
            {saveStatus === 'saving' && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Saving...
              </div>
            )}
            {saveStatus === 'saved' && (
              <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-3 h-3" />
                Saved
              </div>
            )}
            {/* Progress pill */}
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-3 py-1">
              <div className="w-20 h-1.5 bg-primary/20 rounded-full overflow-hidden">
                <div
                  className={cn("h-full transition-all duration-500", percentage === 100 ? "bg-green-500" : "bg-primary")}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-primary">{percentage}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Convert to Appointment Dialog */}
      <Dialog open={showConvertDialog} onOpenChange={(open) => {
        setShowConvertDialog(open);
        if (!open) { setSelectedCSR(''); setSelectedDC(''); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to Appointment</DialogTitle>
            <DialogDescription>Assign team members to schedule this appointment.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Customer Service Rep <span className="text-destructive">*</span></Label>
              <Select value={selectedCSR} onValueChange={setSelectedCSR}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Select CSR" />
                </SelectTrigger>
                <SelectContent>
                  {csrMembers.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.first_name} {m.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Design Consultant (optional)</Label>
              <Select value={selectedDC} onValueChange={setSelectedDC}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Select DC" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Leave Unassigned</SelectItem>
                  {designConsultants.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.first_name} {m.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setShowConvertDialog(false)}>Cancel</Button>
            <Button
              onClick={() => convertToAppointmentMutation.mutate()}
              disabled={convertToAppointmentMutation.isPending || !selectedCSR}
              className="bg-green-600 hover:bg-green-700"
            >
              {convertToAppointmentMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Converting...</>
              ) : (
                <><Calendar className="w-4 h-4 mr-2" />Convert to Appointment</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <GreetingSection formData={formData} onChange={handleChange} />

        {formData.caller_type === 'New Estimate / Flooring' && (
          <>
            <FrameExperienceSection formData={formData} onChange={handleChange} />
            <ContactInfoSection formData={formData} onChange={handleChange} />
            <DiscoverySection formData={formData} onChange={handleChange} />
            <ScopeSection formData={formData} onChange={handleChange} />
            <SuperSaleSection formData={formData} onChange={handleChange} />
            <ValueStackSection formData={formData} onChange={handleChange} />
            <AllPartiesSection formData={formData} onChange={handleChange} />
            <WorkFromHomeSection formData={formData} onChange={handleChange} />
            <FinancingSection formData={formData} onChange={handleChange} />
            <TimeframeSection formData={formData} onChange={handleChange} />
            <OtherEstimatesSection formData={formData} onChange={handleChange} />
            <AppointmentSchedulingSection formData={formData} onChange={handleChange} />
            <RecapSection formData={formData} onChange={handleChange} />
            <OutroSection formData={formData} onChange={handleChange} />
            <AISummarySection formData={formData} onChange={handleChange} />
          </>
        )}
      </div>
    </div>
  );
}