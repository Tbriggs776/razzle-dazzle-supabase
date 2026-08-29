import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import ReactQuill from 'react-quill';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { invokeFailure, invokeNotSent } from '@/lib/invokeResult';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings as SettingsIcon, Save, Loader2, MessageSquare, Shield, Palette, Users, Phone, Send, FileText, DollarSign } from 'lucide-react';
import { motion } from 'framer-motion';
import EmailInput from '@/components/ui/email-input';
import NotificationTemplates from '@/components/settings/NotificationTemplates';
import TagManager from '@/components/tags/TagManager';

const AVAILABLE_VARIABLES = {
  lead: [
    { variable: '{lead_first_name}', description: 'Lead\'s first name' },
    { variable: '{lead_last_name}', description: 'Lead\'s last name' },
    { variable: '{lead_name}', description: 'Lead\'s full name' },
    { variable: '{lead_phone}', description: 'Lead\'s phone number' },
    { variable: '{lead_email}', description: 'Lead\'s email address' },
  ],
  customer: [
    { variable: '{customer_first_name}', description: 'Customer\'s first name' },
    { variable: '{customer_last_name}', description: 'Customer\'s last name' },
    { variable: '{customer_name}', description: 'Customer\'s full name' },
  ],
  appointment: [
    { variable: '{appointment_date}', description: 'Appointment date (e.g., Monday, January 15, 2024)' },
    { variable: '{appointment_time}', description: 'Appointment time block' },
    { variable: '{appointment_address}', description: 'Appointment location address' },
    { variable: '{lead_tracking_url}', description: 'Short URL for lead to track appointment' },
  ],
  project: [
    { variable: '{project_tracker_url}', description: 'Short URL for customer to track project progress' },
    { variable: '{project_tracker_with_video_url}', description: 'Project tracker URL that auto-opens CEO welcome video' },
  ],
  consultant: [
    { variable: '{consultant_first_name}', description: 'Consultant\'s first name' },
    { variable: '{consultant_last_name}', description: 'Consultant\'s last name' },
    { variable: '{consultant_name}', description: 'Consultant\'s full name' },
    { variable: '{consultant_tracking_url}', description: 'Short URL for consultant to view appointment' },
  ],
  ticket: [
    { variable: '{dc_first_name}', description: 'Design Consultant\'s first name' },
    { variable: '{requester_first_name}', description: 'Order Processor\'s first name (requester)' },
    { variable: '{order_number}', description: 'Order number for the ticket' },
    { variable: '{ticket_url}', description: 'Short URL for DC to view and manage ticket' },
    { variable: '{requester_ticket_url}', description: 'Short URL for requester to view and manage ticket' },
    { variable: '{category_name}', description: 'Name of the resolved category/line item' },
    { variable: '{resolver_name}', description: 'Name of person who resolved the issue' },
    { variable: '{denier_name}', description: 'Name of person who denied the resolution' },
    { variable: '{sender_name}', description: 'Name of the person who sent the message' },
    { variable: '{message}', description: 'The message content' },
  ]
};



export default function Settings() {
  const queryClient = useQueryClient();
  const [copiedVariable, setCopiedVariable] = useState('');
  const [cronStatus, setCronStatus] = useState(null);
  const [testingReminders, setTestingReminders] = useState(false);
  const [cronExists, setCronExists] = useState(false);
  const [cronJobId, setCronJobId] = useState(null);
  const [checkingCron, setCheckingCron] = useState(true);
  const [testingFollowUpReminders, setTestingFollowUpReminders] = useState(false);
  const [selectedTestDC, setSelectedTestDC] = useState('all');
  const [selectedTestAppointment, setSelectedTestAppointment] = useState('all');
  const [testingEmail, setTestingEmail] = useState(null);
  const [pastDueMemberIds, setPastDueMemberIds] = useState([]);
  const [sendingPastDueAlert, setSendingPastDueAlert] = useState(false);
  const [pendingCancellationMemberIds, setPendingCancellationMemberIds] = useState([]);
  const [sendingPendingCancellationAlert, setSendingPendingCancellationAlert] = useState(false);
  const [gpAlertMemberIds, setGpAlertMemberIds] = useState([]);
  const [gpAlertThreshold, setGpAlertThreshold] = useState(30);
  const [gpAlertIncludeDC, setGpAlertIncludeDC] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.filter({ role: 'Design Consultant', is_active: true })
  });

  const { data: allTeamMembersForAlert = [] } = useQuery({
    queryKey: ['allTeamMembersForAlert'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }),
    enabled: currentUser?.role === 'admin'
  });

  const { data: upcomingAppointments = [] } = useQuery({
    queryKey: ['upcomingAppointments'],
    queryFn: async () => {
      const appts = await base44.entities.Appointment.filter({
        status: { $in: ['Scheduled', 'Rescheduled'] }
      }, 'appointment_date', 50);
      
      // Batch fetch all leads at once
      const allLeads = await base44.entities.Lead.list();
      const leadsMap = new Map(allLeads.map(lead => [lead.id, lead]));
      
      // Map appointments with lead names
      const apptsWithLeads = appts.map(appt => {
        const lead = leadsMap.get(appt.customer);
        const leadName = lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown Lead';
        return { ...appt, leadName };
      });
      
      return apptsWithLeads;
    }
  });

  const { data: lastFollowUpRun } = useQuery({
    queryKey: ['lastFollowUpRun'],
    queryFn: async () => {
      const logs = await base44.entities.Log.filter(
        { function_name: 'sendFollowUpReminders', type: 'system' },
        '-created_date',
        1
      );
      return logs[0] || null;
    }
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['smsSettings'],
    queryFn: async () => {
      const allSettings = await base44.entities.SMSSettings.list();
      return allSettings[0] || null;
    }
  });


  const { data: timeBlockSettings, isLoading: loadingTimeBlocks } = useQuery({
    queryKey: ['timeBlockSettings'],
    queryFn: async () => {
      const allSettings = await base44.entities.TimeBlockSettings.list();
      return allSettings[0] || null;
    }
  });

  const { data: customerProjectSettings, isLoading: loadingCustomerProjectSettings } = useQuery({
    queryKey: ['customerProjectSettings'],
    queryFn: async () => {
      const allSettings = await base44.entities.CustomerProjectSettings.list();
      return allSettings[0] || null;
    }
  });

  const { data: emailSettings, isLoading: loadingEmailSettings } = useQuery({
    queryKey: ['emailSettings'],
    queryFn: async () => {
      const allSettings = await base44.entities.EmailSettings.list();
      return allSettings[0] || null;
    }
  });

  const { data: appSettings, isLoading: loadingAppSettings } = useQuery({
    queryKey: ['appSettings'],
    queryFn: async () => {
      const allSettings = await base44.entities.AppSettings.list();
      return allSettings[0] || null;
    }
  });

  const [timeBlockFormData, setTimeBlockFormData] = useState({
    time_block_9am_11am_color: '#DBEAFE',
    time_block_12pm_2pm_color: '#F1F5F9',
    time_block_3pm_5pm_color: '#FED7AA',
    time_block_6pm_8pm_color: '#DCFCE7'
  });

  const [customerProjectFormData, setCustomerProjectFormData] = useState({
    show_progress_tracker: true
  });

  const [emailFormData, setEmailFormData] = useState({
    sale_confirmation_template: '',
    cc_emails: [],
    send_sale_confirmation_email: true
  });

  const [appFormData, setAppFormData] = useState({
    show_role_assignment_splash: true,
    quotes_enabled: false,
    quotes_admin_only: true,
    ad_spend_spreadsheet_id: ''
  });

  const [formData, setFormData] = useState({
    lead_appointment_created_template: '',
    lead_appointment_created_email_subject: '',
    lead_appointment_created_email_template: '',
    send_lead_appointment_created_email: true,
    divert_lead_appointment_created_email: false,
    lead_day1_followup_email_subject: '',
    lead_day1_followup_email_template: '',
    send_lead_day1_followup_email: true,
    divert_lead_day1_followup_email: false,
    lead_day2_followup_email_subject: '',
    lead_day2_followup_email_template: '',
    send_lead_day2_followup_email: true,
    divert_lead_day2_followup_email: false,
    lead_day3_followup_email_subject: '',
    lead_day3_followup_email_template: '',
    send_lead_day3_followup_email: true,
    divert_lead_day3_followup_email: false,
    consultant_assigned_template: '',
    lead_consultant_assigned_template: '',
    lead_rescheduled_template: '',
    lead_rescheduled_email_subject: '',
    lead_rescheduled_email_template: '',
    send_lead_rescheduled_email: true,
    divert_lead_rescheduled_email: false,
    consultant_rescheduled_template: '',
    lead_cancelled_template: '',
    lead_cancelled_email_subject: '',
    lead_cancelled_email_template: '',
    send_lead_cancelled_email: true,
    divert_lead_cancelled_email: false,
    consultant_cancelled_template: '',
    lead_reminder_template: '',
    lead_reminder_email_subject: '',
    lead_reminder_email_template: '',
    send_lead_reminder_email: true,
    divert_lead_reminder_email: false,
    lead_not_sold_template: '',
    lead_not_sold_email_subject: '',
    lead_not_sold_email_template: '',
    send_lead_not_sold_sms: true,
    send_lead_not_sold_email: true,
    divert_lead_not_sold_email: false,
    consultant_on_my_way_template: '',
    consultant_arrived_template: '',
    customer_sale_confirmation_template: '',
    customer_sale_confirmation_email_subject: '',
    customer_sale_confirmation_email_template: '',
    send_customer_sale_confirmation_email: true,
    divert_customer_sale_confirmation_email: false,
    customer_project_created_template: '',
    customer_project_created_email_subject: '',
    customer_project_created_email_template: '',
    send_customer_project_created_email: true,
    divert_customer_project_created_email: false,
    divert_emails_to: '',
    dc_ticket_assigned_template: '',
    requester_category_resolved_template: '',
    dc_new_message_template: '',
    requester_new_message_template: '',
    dc_resolution_denied_template: '',
    dc_ticket_reminder_template: '',
    dc_followup_reminder_template: '',
    send_lead_sms: true,
    send_consultant_sms: true,
    send_reminders: true,
    send_customer_sale_sms: true,
    send_customer_project_sms: true,
    send_dc_ticket_sms: true,
    send_requester_resolved_sms: true,
    send_ticket_message_sms: true,
    send_dc_resolution_denied_sms: true,
    send_dc_followup_reminder_sms: true,
    require_folder_photo: true,
    require_yard_sign_photo: true,
    cc_group_calendar_id: '',
    cc_emails: [],
    value_add_keywords: [],
    reply_to_email: '',
    inbound_sms_alert_emails: [],
    finance_report_emails: [],
    unassigned_dc_alert_phones: []
  });

  const [keywordInput, setKeywordInput] = useState('');

  // Memoized onChange handlers for ReactQuill to prevent infinite loops
  const handleQuillChange = useCallback((field) => (value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleEmailQuillChange = useCallback((field) => (value) => {
    setEmailFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  useEffect(() => {
    if (timeBlockSettings) {
      setTimeBlockFormData({
        time_block_9am_11am_color: timeBlockSettings.time_block_9am_11am_color || '#DBEAFE',
        time_block_12pm_2pm_color: timeBlockSettings.time_block_12pm_2pm_color || '#F1F5F9',
        time_block_3pm_5pm_color: timeBlockSettings.time_block_3pm_5pm_color || '#FED7AA',
        time_block_6pm_8pm_color: timeBlockSettings.time_block_6pm_8pm_color || '#DCFCE7'
      });
    }
  }, [timeBlockSettings]);

  useEffect(() => {
    if (customerProjectSettings) {
      setCustomerProjectFormData({
        show_progress_tracker: customerProjectSettings.show_progress_tracker !== false
      });
    }
  }, [customerProjectSettings]);

  useEffect(() => {
    if (emailSettings) {
      setEmailFormData({
        sale_confirmation_template: emailSettings.sale_confirmation_template || '',
        cc_emails: emailSettings.cc_emails || [],
        send_sale_confirmation_email: emailSettings.send_sale_confirmation_email !== false
      });
    }
  }, [emailSettings]);

  useEffect(() => {
    if (appSettings) {
      setAppFormData({
        show_role_assignment_splash: appSettings.show_role_assignment_splash !== false,
        quotes_enabled: appSettings.quotes_enabled === true,
        quotes_admin_only: appSettings.quotes_admin_only !== false,
        ad_spend_spreadsheet_id: appSettings.ad_spend_spreadsheet_id || ''
      });
    }
  }, [appSettings]);

  useEffect(() => {
    if (settings) {
      const defaultKeywords = [
        "Includes Basic Floor Prep",
        "Dustless Tile Demo",
        "Up to 60 Months 0% Interest",
        "We can provide painted base",
        "Include 1/2\" carpet pad on all carpet jobs",
        "Clean Air Ducts For Free on Qualified Purchases",
        "Field Manager Check in and Do Final Walkthrough",
        "Lifetime Labor Guarantee",
        "One Time Transfer of Warranties To New Homeowner"
      ];

      setFormData({
        lead_appointment_created_template: settings.lead_appointment_created_template || '',
        lead_appointment_created_email_subject: settings.lead_appointment_created_email_subject || '',
        lead_appointment_created_email_template: settings.lead_appointment_created_email_template || '',
        send_lead_appointment_created_email: settings.send_lead_appointment_created_email !== false,
        divert_lead_appointment_created_email: settings.divert_lead_appointment_created_email || false,
        lead_day1_followup_email_subject: settings.lead_day1_followup_email_subject || '',
        lead_day1_followup_email_template: settings.lead_day1_followup_email_template || '',
        send_lead_day1_followup_email: settings.send_lead_day1_followup_email !== false,
        divert_lead_day1_followup_email: settings.divert_lead_day1_followup_email || false,
        lead_day2_followup_email_subject: settings.lead_day2_followup_email_subject || '',
        lead_day2_followup_email_template: settings.lead_day2_followup_email_template || '',
        send_lead_day2_followup_email: settings.send_lead_day2_followup_email !== false,
        divert_lead_day2_followup_email: settings.divert_lead_day2_followup_email || false,
        lead_day3_followup_email_subject: settings.lead_day3_followup_email_subject || '',
        lead_day3_followup_email_template: settings.lead_day3_followup_email_template || '',
        send_lead_day3_followup_email: settings.send_lead_day3_followup_email !== false,
        divert_lead_day3_followup_email: settings.divert_lead_day3_followup_email || false,
        consultant_assigned_template: settings.consultant_assigned_template || '',
        lead_consultant_assigned_template: settings.lead_consultant_assigned_template || '',
        lead_rescheduled_template: settings.lead_rescheduled_template || '',
        lead_rescheduled_email_subject: settings.lead_rescheduled_email_subject || '',
        lead_rescheduled_email_template: settings.lead_rescheduled_email_template || '',
        send_lead_rescheduled_email: settings.send_lead_rescheduled_email !== false,
        divert_lead_rescheduled_email: settings.divert_lead_rescheduled_email || false,
        consultant_rescheduled_template: settings.consultant_rescheduled_template || '',
        lead_cancelled_template: settings.lead_cancelled_template || '',
        lead_cancelled_email_subject: settings.lead_cancelled_email_subject || '',
        lead_cancelled_email_template: settings.lead_cancelled_email_template || '',
        send_lead_cancelled_email: settings.send_lead_cancelled_email !== false,
        divert_lead_cancelled_email: settings.divert_lead_cancelled_email || false,
        consultant_cancelled_template: settings.consultant_cancelled_template || '',
        lead_reminder_template: settings.lead_reminder_template || '',
        lead_reminder_email_subject: settings.lead_reminder_email_subject || '',
        lead_reminder_email_template: settings.lead_reminder_email_template || '',
        send_lead_reminder_email: settings.send_lead_reminder_email !== false,
        divert_lead_reminder_email: settings.divert_lead_reminder_email || false,
        lead_not_sold_template: settings.lead_not_sold_template || '',
        lead_not_sold_email_subject: settings.lead_not_sold_email_subject || '',
        lead_not_sold_email_template: settings.lead_not_sold_email_template || '',
        send_lead_not_sold_sms: settings.send_lead_not_sold_sms !== false,
        send_lead_not_sold_email: settings.send_lead_not_sold_email !== false,
        divert_lead_not_sold_email: settings.divert_lead_not_sold_email || false,
        consultant_on_my_way_template: settings.consultant_on_my_way_template || '',
        consultant_arrived_template: settings.consultant_arrived_template || '',
        customer_sale_confirmation_template: settings.customer_sale_confirmation_template || '',
        customer_sale_confirmation_email_subject: settings.customer_sale_confirmation_email_subject || '',
        customer_sale_confirmation_email_template: settings.customer_sale_confirmation_email_template || '',
        send_customer_sale_confirmation_email: settings.send_customer_sale_confirmation_email !== false,
        divert_customer_sale_confirmation_email: settings.divert_customer_sale_confirmation_email || false,
        customer_project_created_template: settings.customer_project_created_template || '',
        customer_project_created_email_subject: settings.customer_project_created_email_subject || '',
        customer_project_created_email_template: settings.customer_project_created_email_template || '',
        send_customer_project_created_email: settings.send_customer_project_created_email !== false,
        divert_customer_project_created_email: settings.divert_customer_project_created_email || false,
        divert_emails_to: settings.divert_emails_to || '',
        dc_ticket_assigned_template: settings.dc_ticket_assigned_template || '',
        requester_category_resolved_template: settings.requester_category_resolved_template || '',
        dc_new_message_template: settings.dc_new_message_template || '',
        requester_new_message_template: settings.requester_new_message_template || '',
        dc_resolution_denied_template: settings.dc_resolution_denied_template || '',
        dc_ticket_reminder_template: settings.dc_ticket_reminder_template || '',
        dc_followup_reminder_template: settings.dc_followup_reminder_template || '',
        send_lead_sms: settings.send_lead_sms !== false,
        send_consultant_sms: settings.send_consultant_sms !== false,
        send_reminders: settings.send_reminders !== false,
        send_customer_sale_sms: settings.send_customer_sale_sms !== false,
        send_customer_project_sms: settings.send_customer_project_sms !== false,
        send_dc_ticket_sms: settings.send_dc_ticket_sms !== false,
        send_requester_resolved_sms: settings.send_requester_resolved_sms !== false,
        send_ticket_message_sms: settings.send_ticket_message_sms !== false,
        send_dc_resolution_denied_sms: settings.send_dc_resolution_denied_sms !== false,
        send_dc_ticket_reminder_sms: settings.send_dc_ticket_reminder_sms !== false,
        send_dc_followup_reminder_sms: settings.send_dc_followup_reminder_sms !== false,
        require_folder_photo: settings.require_folder_photo !== false,
        require_yard_sign_photo: settings.require_yard_sign_photo !== false,
        cc_group_calendar_id: settings.cc_group_calendar_id || '',
        cc_emails: settings.cc_emails || [],
        value_add_keywords: settings.value_add_keywords && settings.value_add_keywords.length > 0 
          ? settings.value_add_keywords 
          : defaultKeywords,
        reply_to_email: settings.reply_to_email || '',
        inbound_sms_alert_emails: settings.inbound_sms_alert_emails || [],
        finance_report_emails: settings.finance_report_emails || [],
        unassigned_dc_alert_phones: settings.unassigned_dc_alert_phones || []
      });
      setPastDueMemberIds(settings.past_due_alert_member_ids || []);
      setPendingCancellationMemberIds(settings.pending_cancellation_alert_member_ids || []);
      setGpAlertMemberIds(settings.gp_alert_member_ids || []);
      setGpAlertThreshold(settings.gp_alert_threshold ?? 30);
      setGpAlertIncludeDC(settings.gp_alert_include_dc === true);
    }
  }, [settings]);

  const addKeyword = () => {
    const trimmed = keywordInput.trim();
    if (trimmed && !formData.value_add_keywords.includes(trimmed)) {
      setFormData({
        ...formData,
        value_add_keywords: [...formData.value_add_keywords, trimmed]
      });
      setKeywordInput('');
    }
  };

  const removeKeyword = (keyword) => {
    setFormData({
      ...formData,
      value_add_keywords: formData.value_add_keywords.filter(k => k !== keyword)
    });
  };

  const handleKeywordKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  };

  // There is no `setupReminderCron` function — not in RPC_FUNCTIONS, not in
  // EDGE_ALIASES, not in DEPLOYED_FUNCTIONS. Calling it sent dataClient into
  // warnUnavailable(), which popped a sonner toast reading "Not available yet"
  // at every admin who opened Settings, about a feature that is not missing:
  // reminders run on a pg_cron schedule inside the database, exactly as the old
  // comment here said. The call could only ever return a stub, so it is gone
  // rather than mapped.
  useEffect(() => {
    setCronExists(false);
    setCronJobId(null);
    setCheckingCron(false);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (settings) {
        return await base44.entities.SMSSettings.update(settings.id, data);
      } else {
        return await base44.entities.SMSSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smsSettings'] });
    }
  });


  const saveTimeBlockMutation = useMutation({
    mutationFn: async (data) => {
      if (timeBlockSettings) {
        return await base44.entities.TimeBlockSettings.update(timeBlockSettings.id, data);
      } else {
        return await base44.entities.TimeBlockSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeBlockSettings'] });
    }
  });

  const saveCustomerProjectMutation = useMutation({
    mutationFn: async (data) => {
      if (customerProjectSettings) {
        return await base44.entities.CustomerProjectSettings.update(customerProjectSettings.id, data);
      } else {
        return await base44.entities.CustomerProjectSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customerProjectSettings'] });
    }
  });

  const saveEmailMutation = useMutation({
    mutationFn: async (data) => {
      if (emailSettings) {
        return await base44.entities.EmailSettings.update(emailSettings.id, data);
      } else {
        return await base44.entities.EmailSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailSettings'] });
    }
  });

  const saveAppSettingsMutation = useMutation({
    mutationFn: async (data) => {
      if (appSettings) {
        return await base44.entities.AppSettings.update(appSettings.id, data);
      } else {
        return await base44.entities.AppSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appSettings'] });
    }
  });

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const handleSaveTimeBlocks = () => {
    saveTimeBlockMutation.mutate(timeBlockFormData);
  };

  const handleSaveCustomerProject = () => {
    saveCustomerProjectMutation.mutate(customerProjectFormData);
  };

  const handleSaveEmail = () => {
    saveEmailMutation.mutate(emailFormData);
  };

  const handleSaveAppSettings = () => {
    saveAppSettingsMutation.mutate(appFormData);
  };



  const copyVariable = (variable) => {
    navigator.clipboard.writeText(variable);
    setCopiedVariable(variable);
    setTimeout(() => setCopiedVariable(''), 2000);
  };

  // Was an invoke of `setupReminderCron`, which does not exist in any function
  // map — so it fell into dataClient's warnUnavailable() and toasted "Not
  // available yet" before reaching the branch below, which was already the only
  // reachable outcome. Reminders are scheduled by pg_cron inside the database;
  // there is no per-tenant cron for this page to create or delete. The whole
  // create/delete/error tree it used to switch on has gone with it.
  const setupCronJob = () => {
    toast.info('Appointment reminders already run automatically on a daily schedule (managed by the database). No manual cron setup is needed.');
    setCronStatus(null);
  };

  const testReminders = async () => {
    setTestingReminders(true);
    try {
      const payload = selectedTestAppointment !== 'all' ? { appointmentId: selectedTestAppointment } : {};
      const res = await base44.functions.invoke('sendAppointmentReminders', payload);
      if (res?.stub || !res?.data) {
        toast.info('Appointment reminders send automatically on a daily schedule — there is no manual trigger.');
      } else {
        const data = res.data;
        toast.success(`Test complete!\n\nSent: ${data.sent || 0}\nFailed: ${data.failed || 0}\nSkipped: ${data.skipped || 0}`);
      }
    } catch (error) {
      toast.error('Test failed: ' + error.message);
    } finally {
      setTestingReminders(false);
    }
  };

  const testFollowUpReminders = async () => {
    setTestingFollowUpReminders(true);
    try {
      const payload = selectedTestDC !== 'all' ? { dcId: selectedTestDC } : {};
      const res = await base44.functions.invoke('sendFollowUpReminders', payload);
      if (res?.stub || !res?.data) {
        toast.info('DC follow-up reminders send automatically on a daily schedule — there is no manual trigger.');
      } else {
        const data = res.data;
        toast.success(`Test complete!\n\nSent: ${data.sentCount || 0} reminders to ${data.totalDCs || 0} DCs`);
      }
    } catch (error) {
      toast.error('Test failed: ' + error.message);
    } finally {
      setTestingFollowUpReminders(false);
    }
  };

  const testEmail = async (emailType) => {
    if (!formData.divert_emails_to) {
      toast.error('Please set a divert email address first');
      return;
    }
    
    setTestingEmail(emailType);
    try {
      const res = await base44.functions.invoke('sendTestEmail', { emailType });
      // The check above reads the divert address out of the UNSAVED form, while the
      // server reads it out of the database — so the commonest way this fails is an
      // admin typing an address and testing before pressing Save. That came back as
      // a 400 and still toasted "Test email sent!", and they went looking in an
      // inbox nothing had been sent to.
      const failed = invokeFailure(res);
      if (failed) {
        // Report what actually went wrong. Asserting "save first" for every
        // failure sends an admin to press Save at an Unauthorized or a dropped
        // connection, which will not help. Keep the hint as a secondary clause,
        // because an unsaved address IS the commonest cause.
        toast.error(`Could not send the test email — ${failed}`, {
          description: 'If you have just changed the address, save your settings first.',
        });
        return;
      }
      const notSent = invokeNotSent(res);
      if (notSent) {
        toast.warning(`No test email went out — ${notSent}.`);
        return;
      }
      toast.success(`Test email sent to ${formData.divert_emails_to}!`);
    } catch (error) {
      toast.error('Test failed: ' + error.message);
    } finally {
      setTestingEmail(null);
    }
  };


  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
              <SettingsIcon className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Settings</h1>
              <p className="text-muted-foreground mt-1">Configure SMS templates and role permissions</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* App Settings */}
        {currentUser?.role === 'admin' && !loadingAppSettings && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" />
                  App Access Settings
                </CardTitle>
                <CardDescription>
                  Configure app-wide access settings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                <div>
                  <p className="font-medium text-foreground">Show Role Assignment Splash Screen</p>
                  <p className="text-sm text-muted-foreground mt-1">Display splash screen for users without assigned roles</p>
                </div>
                <Switch
                  checked={appFormData.show_role_assignment_splash}
                  onCheckedChange={(checked) => setAppFormData({ ...appFormData, show_role_assignment_splash: checked })}
                />
                </div>

                <div className="mt-4 p-4 rounded-lg border border-primary/20 bg-primary/5 space-y-3">
                <p className="font-semibold text-foreground flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Quote System
                </p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Enable Quotes</p>
                    <p className="text-sm text-muted-foreground">Allow Design Consultants to create quotes from appointment results</p>
                  </div>
                  <Switch
                    checked={appFormData.quotes_enabled}
                    onCheckedChange={(checked) => setAppFormData({ ...appFormData, quotes_enabled: checked })}
                  />
                </div>
                {appFormData.quotes_enabled && (
                  <div className="flex items-center justify-between pt-2 border-t border-primary/20">
                    <div>
                      <p className="font-medium text-foreground">Admin Only (Testing Mode)</p>
                      <p className="text-sm text-muted-foreground">Only show Quote option to admin users — to test before rolling out to the team</p>
                    </div>
                    <Switch
                      checked={appFormData.quotes_admin_only}
                      onCheckedChange={(checked) => setAppFormData({ ...appFormData, quotes_admin_only: checked })}
                    />
                  </div>
                )}
                </div>

                <div className="mt-4 p-4 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/25 space-y-3">
                  <p className="font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Ad Spend Spreadsheet
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Paste the Google Sheets URL or ID used for the Marketing Performance dashboard. This is shared across all users.
                  </p>
                  <input
                    type="text"
                    value={appFormData.ad_spend_spreadsheet_id}
                    onChange={(e) => setAppFormData({ ...appFormData, ad_spend_spreadsheet_id: e.target.value })}
                    placeholder="https://docs.google.com/spreadsheets/d/... or spreadsheet ID"
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </CardContent>
              <div className="px-6 py-4 border-t border-border flex justify-end">
                <Button
                  onClick={handleSaveAppSettings}
                  disabled={saveAppSettingsMutation.isPending}
                  className="bg-primary text-primary-foreground hover:opacity-90"
                >
                  {saveAppSettingsMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Settings
                    </>
                  )}
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Past Due Projects Alert */}
        {currentUser?.role === 'admin' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5 text-amber-600" />
                  Past Due Projects — Daily SMS Alert
                </CardTitle>
                <CardDescription>
                  At 8am Arizona time, a text will be sent to the selected team members listing all projects 3+ business days past due.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">Select team members to receive the alert (their phone number from their profile will be used):</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {allTeamMembersForAlert.sort((a,b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)).map(member => (
                    <label key={member.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      pastDueMemberIds.includes(member.id)
                        ? 'bg-amber-50 border-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30'
                        : 'bg-card border-border hover:bg-secondary'
                    }`}>
                      <input
                        type="checkbox"
                        checked={pastDueMemberIds.includes(member.id)}
                        onChange={e => {
                          if (e.target.checked) setPastDueMemberIds(p => [...p, member.id]);
                          else setPastDueMemberIds(p => p.filter(id => id !== member.id));
                        }}
                        className="rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{member.first_name} {member.last_name}</p>
                        <p className="text-xs text-muted-foreground">{member.role}</p>
                      </div>
                      {member.phone ? (
                        <span className="text-xs font-mono text-muted-foreground">{member.phone}</span>
                      ) : (
                        <span className="text-xs text-destructive">No phone</span>
                      )}
                    </label>
                  ))}
                  {allTeamMembersForAlert.length === 0 && <p className="text-xs text-muted-foreground">No active team members found.</p>}
                </div>
              </CardContent>
              <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  onClick={async () => {
                    setSendingPastDueAlert(true);
                    try {
                      const res = await base44.functions.invoke('sendPastDueProjectsAlert', {});
                      // This one is a text-message dispatcher: it answers 200 with
                      // { skipped: 'no recipients' } / { skipped: 'nothing past due' }
                      // when it sends nothing at all. "Alert sent!" was printed for
                      // those too — including the case where nobody above is ticked,
                      // which is exactly the mistake this button exists to catch.
                      const failed = invokeFailure(res);
                      if (failed) {
                        toast.error('Could not send the alert. Please try again.');
                        return;
                      }
                      const notSent = invokeNotSent(res);
                      if (notSent) {
                        toast.warning(`No alert went out — ${notSent}.`);
                        return;
                      }
                      toast.success('Alert sent!');
                    } catch (e) {
                      toast.error('Failed: ' + e.message);
                    } finally {
                      setSendingPastDueAlert(false);
                    }
                  }}
                  disabled={sendingPastDueAlert}
                  className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10"
                >
                  {sendingPastDueAlert ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  Send Now
                </Button>
                <Button
                  onClick={() => saveMutation.mutate({ ...formData, past_due_alert_member_ids: pastDueMemberIds })}
                  disabled={saveMutation.isPending}
                  className="bg-primary text-primary-foreground hover:opacity-90"
                >
                  {saveMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save</>}
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Pending Cancellation Alert */}
        {currentUser?.role === 'admin' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5 text-orange-600" />
                  Pending Cancellation — Daily SMS Alert
                </CardTitle>
                <CardDescription>
                  At 8am Arizona time, a text will be sent to the selected team members listing all projects in "pending cancellation" status.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">Select team members to receive the alert (their phone number from their profile will be used):</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {allTeamMembersForAlert.sort((a,b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)).map(member => (
                    <label key={member.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      pendingCancellationMemberIds.includes(member.id)
                        ? 'bg-orange-50 border-orange-300 dark:bg-orange-500/15 dark:border-orange-500/30'
                        : 'bg-card border-border hover:bg-secondary'
                    }`}>
                      <input
                        type="checkbox"
                        checked={pendingCancellationMemberIds.includes(member.id)}
                        onChange={e => {
                          if (e.target.checked) setPendingCancellationMemberIds(p => [...p, member.id]);
                          else setPendingCancellationMemberIds(p => p.filter(id => id !== member.id));
                        }}
                        className="rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{member.first_name} {member.last_name}</p>
                        <p className="text-xs text-muted-foreground">{member.role}</p>
                      </div>
                      {member.phone ? (
                        <span className="text-xs font-mono text-muted-foreground">{member.phone}</span>
                      ) : (
                        <span className="text-xs text-destructive">No phone</span>
                      )}
                    </label>
                  ))}
                  {allTeamMembersForAlert.length === 0 && <p className="text-xs text-muted-foreground">No active team members found.</p>}
                </div>
              </CardContent>
              <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  onClick={async () => {
                    setSendingPendingCancellationAlert(true);
                    try {
                      const res = await base44.functions.invoke('sendPendingCancellationAlert', {});
                      // Same dispatcher, same 200-with-{ skipped } answer for
                      // 'no recipients' and 'none pending'. It also used to read
                      // data.jobCount off a null data on a real failure, so the
                      // admin was shown a type error instead of what went wrong.
                      const failed = invokeFailure(res);
                      if (failed) {
                        toast.error('Could not send the alert. Please try again.');
                        return;
                      }
                      const notSent = invokeNotSent(res);
                      if (notSent) {
                        toast.warning(`No alert went out — ${notSent}.`);
                        return;
                      }
                      toast.success(`Alert sent! ${res.data.jobCount} job(s) included.`);
                    } catch (e) {
                      toast.error('Failed: ' + e.message);
                    } finally {
                      setSendingPendingCancellationAlert(false);
                    }
                  }}
                  disabled={sendingPendingCancellationAlert}
                  className="border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-500/40 dark:text-orange-300 dark:hover:bg-orange-500/10"
                >
                  {sendingPendingCancellationAlert ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  Send Now
                </Button>
                <Button
                  onClick={() => saveMutation.mutate({ ...formData, past_due_alert_member_ids: pastDueMemberIds, pending_cancellation_alert_member_ids: pendingCancellationMemberIds })}
                  disabled={saveMutation.isPending}
                  className="bg-primary text-primary-foreground hover:opacity-90"
                >
                  {saveMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save</>}
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Low GP% Alert */}
        {currentUser?.role === 'admin' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                  Low Gross Profit — SMS Alert
                </CardTitle>
                <CardDescription>
                  When RFMS order data is fetched for a sale, if the calculated GP% is below the threshold, a text is sent to the selected team members.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium text-foreground whitespace-nowrap">GP% Threshold:</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={gpAlertThreshold}
                      onChange={e => setGpAlertThreshold(Number(e.target.value))}
                      className="w-24 border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <span className="text-sm text-muted-foreground">% — alert fires when GP is <strong>below</strong> this</span>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium text-foreground">Also alert the Design Consultant</p>
                    <p className="text-sm text-muted-foreground mt-0.5">Send the GP alert to the DC assigned to the sale</p>
                  </div>
                  <Switch
                    checked={gpAlertIncludeDC}
                    onCheckedChange={setGpAlertIncludeDC}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Select additional team members to always receive the alert:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {allTeamMembersForAlert.sort((a,b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)).map(member => (
                    <label key={member.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      gpAlertMemberIds.includes(member.id) ? 'bg-emerald-50 border-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30' : 'bg-card border-border hover:bg-secondary'
                    }`}>
                      <input
                        type="checkbox"
                        checked={gpAlertMemberIds.includes(member.id)}
                        onChange={e => {
                          if (e.target.checked) setGpAlertMemberIds(p => [...p, member.id]);
                          else setGpAlertMemberIds(p => p.filter(id => id !== member.id));
                        }}
                        className="rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{member.first_name} {member.last_name}</p>
                        <p className="text-xs text-muted-foreground">{member.role}</p>
                      </div>
                      {member.phone ? (
                        <span className="text-xs font-mono text-muted-foreground">{member.phone}</span>
                      ) : (
                        <span className="text-xs text-destructive">No phone</span>
                      )}
                    </label>
                  ))}
                  {allTeamMembersForAlert.length === 0 && <p className="text-xs text-muted-foreground">No active team members found.</p>}
                </div>
              </CardContent>
              <div className="px-6 py-4 border-t border-border flex justify-end">
                <Button
                  onClick={() => saveMutation.mutate({ ...formData, past_due_alert_member_ids: pastDueMemberIds, pending_cancellation_alert_member_ids: pendingCancellationMemberIds, gp_alert_member_ids: gpAlertMemberIds, gp_alert_threshold: gpAlertThreshold, gp_alert_include_dc: gpAlertIncludeDC })}

                  disabled={saveMutation.isPending}
                  className="bg-primary text-primary-foreground hover:opacity-90"
                >
                  {saveMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save</>}
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Unassigned DC Alert */}
        {currentUser?.role === 'admin' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5 text-red-600" />
                  Unassigned DC — SMS Alert
                </CardTitle>
                <CardDescription>
                  Get a text alert when appointments don't have an assigned Design Consultant. Runs daily at 8am AZ time — also checks the weekend if it's Friday.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li><strong>Every day:</strong> Next-day appointments with no DC assigned</li>
                  <li><strong>Fridays only:</strong> Weekend appointments (Sat &amp; Sun) with no DC assigned</li>
                </ul>
                <p className="text-xs text-muted-foreground">Select team members to receive the alert (their phone number from their profile will be used):</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {allTeamMembersForAlert.sort((a,b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)).map(member => {
                    const selected = (formData.unassigned_dc_alert_phones || []).includes(member.id);
                    return (
                      <label key={member.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selected ? 'bg-red-50 border-red-300 dark:bg-red-500/15 dark:border-red-500/30' : 'bg-card border-border hover:bg-secondary'}`}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={e => {
                            const ids = formData.unassigned_dc_alert_phones || [];
                            setFormData({ ...formData, unassigned_dc_alert_phones: e.target.checked ? [...ids, member.id] : ids.filter(id => id !== member.id) });
                          }}
                          className="rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{member.first_name} {member.last_name}</p>
                          <p className="text-xs text-muted-foreground">{member.role}</p>
                        </div>
                        {member.phone ? (
                          <span className="text-xs font-mono text-muted-foreground">{member.phone}</span>
                        ) : (
                          <span className="text-xs text-destructive">No phone</span>
                        )}
                      </label>
                    );
                  })}
                  {allTeamMembersForAlert.length === 0 && <p className="text-xs text-muted-foreground">No active team members found.</p>}
                </div>
              </CardContent>
              <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const res = await base44.functions.invoke('sendUnassignedDCAlerts', {});
                      // { skipped: 'no recipients' } / { skipped: 'none unassigned' }
                      // both arrive as a 200. The old line read data.sent through it
                      // and reported "Done! Sent to 0 number(s)." — which reads as a
                      // success, and on a real failure threw on a null data instead.
                      const failed = invokeFailure(res);
                      if (failed) {
                        toast.error('Could not send the alert. Please try again.');
                        return;
                      }
                      const notSent = invokeNotSent(res);
                      if (notSent) {
                        toast.warning(`No alert went out — ${notSent}.`);
                        return;
                      }
                      toast.success(`Done! Sent to ${res.data.sent} number(s).`);
                    } catch (e) {
                      toast.error('Failed: ' + e.message);
                    }
                  }}
                  className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Test Send Now
                </Button>
                <Button
                  onClick={() => saveMutation.mutate({ ...formData, past_due_alert_member_ids: pastDueMemberIds })}
                  disabled={saveMutation.isPending}
                  className="bg-primary text-primary-foreground hover:opacity-90"
                >
                  {saveMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save</>}
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Inbound SMS Alert Emails */}
        {currentUser?.role === 'admin' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-green-600" />
                  Inbound SMS Alert Emails
                </CardTitle>
                <CardDescription>
                  Get an email notification whenever a customer or lead sends an inbound text message
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  These email addresses will receive an instant notification when a customer or lead replies via SMS.
                </p>
                <EmailInput
                  value={formData.inbound_sms_alert_emails || []}
                  onChange={(emails) => setFormData({ ...formData, inbound_sms_alert_emails: emails })}
                  placeholder="Type email and press Enter..."
                />
              </CardContent>
              <div className="px-6 py-4 border-t border-border flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="bg-primary text-primary-foreground hover:opacity-90"
                >
                  {saveMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                  ) : (
                    <><Save className="w-4 h-4 mr-2" />Save Settings</>
                  )}
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Email Settings for Sales Notifications */}
        {currentUser?.role === 'admin' && !loadingEmailSettings && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-primary" />
                  Sales Email Notification
                </CardTitle>
                <CardDescription>
                  Configure email settings when deals are closed in Razzle Dazzle
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                  <div>
                    <p className="font-medium text-foreground">Enable Sales Email</p>
                    <p className="text-sm text-muted-foreground mt-1">Send email notifications when appointments are marked as sold</p>
                  </div>
                  <Switch
                    checked={emailFormData.send_sale_confirmation_email}
                    onCheckedChange={(checked) => setEmailFormData({ ...emailFormData, send_sale_confirmation_email: checked })}
                  />
                </div>

                <div className="border-t border-border pt-6">
                  <Label className="text-foreground font-medium mb-3 block">Email Template</Label>
                  <div className="bg-card border border-border rounded-lg overflow-hidden">
                    <ReactQuill
                      key="sale_confirmation_template"
                      value={emailFormData.sale_confirmation_template}
                      onChange={handleEmailQuillChange('sale_confirmation_template')}
                      theme="snow"
                      modules={{
                        toolbar: [
                          [{ header: [1, 2, false] }],
                          ['bold', 'italic', 'underline', 'strike'],
                          ['blockquote', 'code-block'],
                          [{ list: 'ordered' }, { list: 'bullet' }],
                          ['link', 'image'],
                          ['clean']
                        ]
                      }}
                      readOnly={!emailFormData.send_sale_confirmation_email}
                      style={{ minHeight: '300px' }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    Use variables like {'{customer_name}'}, {'{consultant_name}'}, {'{sale_amount}'}, {'{appointment_date}'}, {'{location_address}'}, and {'{sale_detail_url}'} to personalize your email
                  </p>
                </div>

                <div className="border-t border-border pt-6">
                  <Label className="text-foreground font-medium mb-3 block">Email Recipients</Label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Add email addresses that should receive sales notifications
                  </p>
                  <EmailInput
                    value={emailFormData.cc_emails || []}
                    onChange={(emails) => setEmailFormData({ ...emailFormData, cc_emails: emails })}
                    placeholder="Type email and press Enter..."
                    disabled={!emailFormData.send_sale_confirmation_email}
                  />
                </div>

                <div className="bg-blue-50 border border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/25 rounded-lg p-3">
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    <strong>Available Variables:</strong> {'{customer_name}'}, {'{sale_amount}'}, {'{consultant_name}'}, {'{appointment_date}'}, {'{location_address}'}, {'{sale_detail_url}'}
                  </p>
                </div>
              </CardContent>
              <div className="px-6 py-4 border-t border-border flex justify-end">
                <Button
                  onClick={handleSaveEmail}
                  disabled={saveEmailMutation.isPending}
                  className="bg-primary text-primary-foreground hover:opacity-90"
                >
                  {saveEmailMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Settings
                    </>
                  )}
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Customer Project Settings */}
        {currentUser?.role === 'admin' && !loadingCustomerProjectSettings && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SettingsIcon className="w-5 h-5 text-primary" />
                  Customer Project View Settings
                </CardTitle>
                <CardDescription>
                  Configure what customers see on their project tracker page
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                  <div>
                    <p className="font-medium text-foreground">Show Progress Tracker</p>
                    <p className="text-sm text-muted-foreground mt-1">Display project status progress on customer project view</p>
                  </div>
                  <Switch
                    checked={customerProjectFormData.show_progress_tracker}
                    onCheckedChange={(checked) => setCustomerProjectFormData({ ...customerProjectFormData, show_progress_tracker: checked })}
                  />
                </div>
              </CardContent>
              <div className="px-6 py-4 border-t border-border flex justify-end">
                <Button
                  onClick={handleSaveCustomerProject}
                  disabled={saveCustomerProjectMutation.isPending}
                  className="bg-primary text-primary-foreground hover:opacity-90"
                >
                  {saveCustomerProjectMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Settings
                    </>
                  )}
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Time Block Colors */}
        {currentUser?.role === 'admin' && !loadingTimeBlocks && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-5 h-5 text-primary" />
                  Schedule Time Block Colors
                </CardTitle>
                <CardDescription>
                  Customize colors for each time block in the Schedule Assistant
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {[
                    { key: 'time_block_9am_11am_color', label: '9am - 11am', defaultColor: '#DBEAFE' },
                    { key: 'time_block_12pm_2pm_color', label: '12pm - 2pm', defaultColor: '#F1F5F9' },
                    { key: 'time_block_3pm_5pm_color', label: '3pm - 5pm', defaultColor: '#FED7AA' },
                    { key: 'time_block_6pm_8pm_color', label: '6pm - 8pm', defaultColor: '#DCFCE7' }
                  ].map(({ key, label, defaultColor }) => (
                    <div key={key} className="space-y-3">
                      <Label className="text-foreground font-medium">{label}</Label>
                      <div className="flex items-center gap-4">
                        <div className="flex gap-3 items-center flex-wrap">
                          <input
                            type="color"
                            value={timeBlockFormData[key]}
                            onChange={(e) => setTimeBlockFormData({ ...timeBlockFormData, [key]: e.target.value })}
                            className="w-16 h-16 rounded-lg cursor-pointer border border-border"
                          />
                          <div>
                            <p className="text-sm font-mono text-muted-foreground">{timeBlockFormData[key]}</p>
                            <button
                              type="button"
                              onClick={() => setTimeBlockFormData({ ...timeBlockFormData, [key]: defaultColor })}
                              className="text-xs text-primary hover:opacity-80 mt-1"
                            >
                              Reset to default
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
              <div className="px-6 py-4 border-t border-border flex justify-end">
                <Button
                  onClick={handleSaveTimeBlocks}
                  disabled={saveTimeBlockMutation.isPending}
                  className="bg-primary text-primary-foreground hover:opacity-90"
                >
                  {saveTimeBlockMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Colors
                    </>
                  )}
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Tag Management */}
        {currentUser?.role === 'admin' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SettingsIcon className="w-5 h-5 text-primary" />
                  Appointment & Project Tags
                </CardTitle>
                <CardDescription>
                  Manage tags that can be applied to checklists, appointments, and projects (e.g. VIP, Referral, High Priority)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TagManager />
              </CardContent>
            </Card>
          </motion.div>
        )}

        {currentUser?.role === 'admin' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-primary" />
                  Role-Based Access Control
                </CardTitle>
                <CardDescription>
                  Page access is managed in User Access
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* The editor that used to live here wrote to `role_permissions`,
                    which NOTHING READS. Its only consumer is
                    _legacyGetFilteredNavigation in Layout.jsx, explicitly marked
                    dead and superseded by the module-based filter. So an admin
                    could uncheck Finance for Design Consultants, watch it save,
                    reload and see it persisted — and nothing whatsoever changed.
                    A control that persists but does nothing is worse than no
                    control: it produces confident wrong beliefs about who can see
                    what. Removed rather than rewired, because roles -> modules ->
                    pages already has one home and a second editor would be a
                    second source of truth. */}
                <p className="text-sm text-muted-foreground">
                  Access is granted by module, per role, and enforced by the
                  database. Manage it in{' '}
                  <Link to={createPageUrl('UserAccess')} className="font-medium text-primary underline">
                    User Access
                  </Link>
                  .
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        <NotificationTemplates
          formData={formData}
          setFormData={setFormData}
          handleQuillChange={handleQuillChange}
          testEmail={testEmail}
          testingEmail={testingEmail}
          teamMembers={teamMembers}
          upcomingAppointments={upcomingAppointments}
          lastFollowUpRun={lastFollowUpRun}
          selectedTestDC={selectedTestDC}
          setSelectedTestDC={setSelectedTestDC}
          selectedTestAppointment={selectedTestAppointment}
          setSelectedTestAppointment={setSelectedTestAppointment}
          testFollowUpReminders={testFollowUpReminders}
          testingFollowUpReminders={testingFollowUpReminders}
          testReminders={testReminders}
          testingReminders={testingReminders}
          setupCronJob={setupCronJob}
          checkingCron={checkingCron}
          cronExists={cronExists}
          cronStatus={cronStatus}
          keywordInput={keywordInput}
          setKeywordInput={setKeywordInput}
          addKeyword={addKeyword}
          removeKeyword={removeKeyword}
          handleKeywordKeyPress={handleKeywordKeyPress}
          handleSave={handleSave}
          saveMutation={saveMutation}
        />
      </div>
    </div>
  );
}