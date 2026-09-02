import React from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import * as ReactQuillModule from 'react-quill';
const ReactQuill = ReactQuillModule.default || ReactQuillModule;
import 'react-quill/dist/quill.snow.css';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, MessageSquare, Copy, Check, Clock, PlayCircle, Camera, Calendar, Tag, X } from 'lucide-react';
import { motion } from 'framer-motion';
import EmailInput from '@/components/ui/email-input';

const AVAILABLE_VARIABLES = {
  lead: [
    { variable: '{lead_first_name}', description: "Lead's first name" },
    { variable: '{lead_last_name}', description: "Lead's last name" },
    { variable: '{lead_name}', description: "Lead's full name" },
    { variable: '{lead_phone}', description: "Lead's phone number" },
    { variable: '{lead_email}', description: "Lead's email address" },
  ],
  customer: [
    { variable: '{customer_first_name}', description: "Customer's first name" },
    { variable: '{customer_last_name}', description: "Customer's last name" },
    { variable: '{customer_name}', description: "Customer's full name" },
  ],
  appointment: [
    { variable: '{appointment_date}', description: 'Appointment date' },
    { variable: '{appointment_time}', description: 'Appointment time block' },
    { variable: '{appointment_address}', description: 'Appointment location address' },
    { variable: '{lead_tracking_url}', description: 'Short URL for lead to track appointment' },
  ],
  project: [
    { variable: '{project_tracker_url}', description: 'Short URL for customer to track project progress' },
    { variable: '{project_tracker_with_video_url}', description: 'Project tracker URL that auto-opens CEO welcome video' },
  ],
  consultant: [
    { variable: '{consultant_first_name}', description: "Consultant's first name" },
    { variable: '{consultant_last_name}', description: "Consultant's last name" },
    { variable: '{consultant_name}', description: "Consultant's full name" },
    { variable: '{consultant_tracking_url}', description: 'Short URL for consultant to view appointment' },
  ],
  ticket: [
    { variable: '{dc_first_name}', description: "Design Consultant's first name" },
    { variable: '{requester_first_name}', description: "Order Processor's first name" },
    { variable: '{order_number}', description: 'Order number for the ticket' },
    { variable: '{ticket_url}', description: 'Short URL for DC to view ticket' },
    { variable: '{requester_ticket_url}', description: 'Short URL for requester to view ticket' },
    { variable: '{category_name}', description: 'Name of the resolved category' },
    { variable: '{resolver_name}', description: 'Name of person who resolved' },
    { variable: '{denier_name}', description: 'Name of person who denied' },
    { variable: '{sender_name}', description: 'Name of the message sender' },
    { variable: '{message}', description: 'The message content' },
  ]
};

const quillModules = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    ['blockquote'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link'],
    ['clean']
  ]
};

export default function NotificationTemplates({
  formData, setFormData, handleQuillChange, testEmail, testingEmail,
  teamMembers, upcomingAppointments, lastFollowUpRun,
  selectedTestDC, setSelectedTestDC, selectedTestAppointment, setSelectedTestAppointment,
  testFollowUpReminders, testingFollowUpReminders, testReminders, testingReminders,
  setupCronJob, checkingCron, cronExists, cronStatus,
  keywordInput, setKeywordInput, addKeyword, removeKeyword, handleKeywordKeyPress,
  handleSave, saveMutation
}) {
  const [copiedVariable, setCopiedVariable] = React.useState('');

  const copyVariable = (variable) => {
    navigator.clipboard.writeText(variable);
    setCopiedVariable(variable);
    setTimeout(() => setCopiedVariable(''), 2000);
  };

  const TestEmailButton = ({ emailType }) => (
    <Button
      type="button"
      onClick={() => testEmail(emailType)}
      disabled={testingEmail === emailType || !formData.divert_emails_to}
      variant="outline"
      size="sm"
      className="w-full mt-3"
    >
      {testingEmail === emailType ? (
        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending Test...</>
      ) : (
        <><PlayCircle className="w-4 h-4 mr-2" />Send Test Email</>
      )}
    </Button>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Templates Section */}
      <div className="lg:col-span-2 space-y-6">

        {/* Lead Notification */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-good" />
                    Lead Notification
                  </CardTitle>
                  <CardDescription className="mt-1">Sent to lead when appointment is created</CardDescription>
                </div>
                <Switch checked={formData.send_lead_sms} onCheckedChange={(c) => setFormData({ ...formData, send_lead_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Label className="text-foreground font-medium mb-3 block">SMS Notification</Label>
                <Textarea value={formData.lead_appointment_created_template} onChange={(e) => setFormData({ ...formData, lead_appointment_created_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_lead_sms} />
              </div>
              <div className="border-t border-border pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-foreground font-medium">Email Notification to Team</Label>
                  <Switch checked={formData.send_lead_appointment_created_email} onCheckedChange={(c) => setFormData({ ...formData, send_lead_appointment_created_email: c })} />
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Subject Line</Label>
                    <input type="text" value={formData.lead_appointment_created_email_subject} onChange={(e) => setFormData({ ...formData, lead_appointment_created_email_subject: e.target.value })} placeholder="e.g., New Appointment Scheduled - {lead_name}" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info font-mono text-sm" disabled={!formData.send_lead_appointment_created_email} />
                  </div>
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Email Body</Label>
                    <div className="bg-white border border-border rounded-lg overflow-hidden">
                      <ReactQuill key="lead_appointment_created_email_template" value={formData.lead_appointment_created_email_template} onChange={handleQuillChange('lead_appointment_created_email_template')} theme="snow" modules={quillModules} readOnly={!formData.send_lead_appointment_created_email} style={{ minHeight: '200px' }} />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Sent to CC recipients when appointment is created</p>
                <TestEmailButton emailType="appointment_created" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Day 1 Follow-Up Email */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-teal-600" />
                    Day 1 Follow-Up Email to Lead
                  </CardTitle>
                  <CardDescription className="mt-1">Sent to lead 1 day after appointment is created (via daily cron)</CardDescription>
                </div>
                <Switch checked={formData.send_lead_day1_followup_email} onCheckedChange={(c) => setFormData({ ...formData, send_lead_day1_followup_email: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <Label className="text-foreground text-sm mb-2 block">Subject Line</Label>
                  <input type="text" value={formData.lead_day1_followup_email_subject} onChange={(e) => setFormData({ ...formData, lead_day1_followup_email_subject: e.target.value })} placeholder="e.g., We're excited to meet you, {lead_first_name}!" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info font-mono text-sm" disabled={!formData.send_lead_day1_followup_email} />
                </div>
                <div>
                  <Label className="text-foreground text-sm mb-2 block">Email Body</Label>
                  <div className="bg-white border border-border rounded-lg overflow-hidden">
                    <ReactQuill key="lead_day1_followup_email_template" value={formData.lead_day1_followup_email_template} onChange={handleQuillChange('lead_day1_followup_email_template')} theme="snow" modules={quillModules} readOnly={!formData.send_lead_day1_followup_email} style={{ minHeight: '200px' }} />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Sent directly to the lead's email address 1 day after appointment creation</p>
              <div className="bg-info/12 border border-info/25 rounded-lg p-3 mt-3">
                <p className="text-xs text-info">
                  <strong>Available Variables:</strong> {'{lead_first_name}'}, {'{lead_last_name}'}, {'{lead_name}'}, {'{appointment_date}'}, {'{appointment_time}'}, {'{location_address}'}, {'{lead_tracking_url}'}
                </p>
              </div>
              <TestEmailButton emailType="day1_followup" />
            </CardContent>
          </Card>
        </motion.div>

        {/* Day 2 Follow-Up Email */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-info" />
                    Day 2 Follow-Up Email to Lead
                  </CardTitle>
                  <CardDescription className="mt-1">Sent to lead 2 days after appointment is created (via daily cron)</CardDescription>
                </div>
                <Switch checked={formData.send_lead_day2_followup_email} onCheckedChange={(c) => setFormData({ ...formData, send_lead_day2_followup_email: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <Label className="text-foreground text-sm mb-2 block">Subject Line</Label>
                  <input type="text" value={formData.lead_day2_followup_email_subject} onChange={(e) => setFormData({ ...formData, lead_day2_followup_email_subject: e.target.value })} placeholder="e.g., A quick note from Floor Daddy, {lead_first_name}!" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info font-mono text-sm" disabled={!formData.send_lead_day2_followup_email} />
                </div>
                <div>
                  <Label className="text-foreground text-sm mb-2 block">Email Body</Label>
                  <div className="bg-white border border-border rounded-lg overflow-hidden">
                    <ReactQuill key="lead_day2_followup_email_template" value={formData.lead_day2_followup_email_template} onChange={handleQuillChange('lead_day2_followup_email_template')} theme="snow" modules={quillModules} readOnly={!formData.send_lead_day2_followup_email} style={{ minHeight: '200px' }} />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Sent directly to the lead's email address 2 days after appointment creation</p>
              <div className="bg-info/12 border border-info/25 rounded-lg p-3 mt-3">
                <p className="text-xs text-info">
                  <strong>Available Variables:</strong> {'{lead_first_name}'}, {'{lead_last_name}'}, {'{lead_name}'}, {'{appointment_date}'}, {'{appointment_time}'}, {'{location_address}'}, {'{lead_tracking_url}'}
                </p>
              </div>
              <TestEmailButton emailType="day2_followup" />
            </CardContent>
          </Card>
        </motion.div>

        {/* Day 3 Follow-Up Email */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-cyan-600" />
                    Day 3 Follow-Up Email to Lead
                  </CardTitle>
                  <CardDescription className="mt-1">Sent to lead 3 days after appointment is created (via daily cron)</CardDescription>
                </div>
                <Switch checked={formData.send_lead_day3_followup_email} onCheckedChange={(c) => setFormData({ ...formData, send_lead_day3_followup_email: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <Label className="text-foreground text-sm mb-2 block">Subject Line</Label>
                  <input type="text" value={formData.lead_day3_followup_email_subject} onChange={(e) => setFormData({ ...formData, lead_day3_followup_email_subject: e.target.value })} placeholder="e.g., We're looking forward to seeing you, {lead_first_name}!" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info font-mono text-sm" disabled={!formData.send_lead_day3_followup_email} />
                </div>
                <div>
                  <Label className="text-foreground text-sm mb-2 block">Email Body</Label>
                  <div className="bg-white border border-border rounded-lg overflow-hidden">
                    <ReactQuill key="lead_day3_followup_email_template" value={formData.lead_day3_followup_email_template} onChange={handleQuillChange('lead_day3_followup_email_template')} theme="snow" modules={quillModules} readOnly={!formData.send_lead_day3_followup_email} style={{ minHeight: '200px' }} />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Sent directly to the lead's email address 3 days after appointment creation</p>
              <div className="bg-info/12 border border-info/25 rounded-lg p-3 mt-3">
                <p className="text-xs text-info">
                  <strong>Available Variables:</strong> {'{lead_first_name}'}, {'{lead_last_name}'}, {'{lead_name}'}, {'{appointment_date}'}, {'{appointment_time}'}, {'{location_address}'}, {'{lead_tracking_url}'}
                </p>
              </div>
              <TestEmailButton emailType="day3_followup" />
            </CardContent>
          </Card>
        </motion.div>

        {/* Consultant Notification */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-info" />Consultant Notification</CardTitle>
                  <CardDescription className="mt-1">Sent to consultant when assigned to appointment</CardDescription>
                </div>
                <Switch checked={formData.send_consultant_sms} onCheckedChange={(c) => setFormData({ ...formData, send_consultant_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.consultant_assigned_template} onChange={(e) => setFormData({ ...formData, consultant_assigned_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_consultant_sms} />
            </CardContent>
          </Card>
        </motion.div>

        {/* Lead Consultant Assignment */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-purple-600" />Lead Consultant Assignment</CardTitle>
                  <CardDescription className="mt-1">Sent to lead when consultant is assigned</CardDescription>
                </div>
                <Switch checked={formData.send_lead_sms} onCheckedChange={(c) => setFormData({ ...formData, send_lead_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.lead_consultant_assigned_template} onChange={(e) => setFormData({ ...formData, lead_consultant_assigned_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_lead_sms} />
            </CardContent>
          </Card>
        </motion.div>

        {/* Lead Reschedule */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-warn" />Lead Reschedule Notification</CardTitle>
                  <CardDescription className="mt-1">Sent to lead when appointment is rescheduled</CardDescription>
                </div>
                <Switch checked={formData.send_lead_sms} onCheckedChange={(c) => setFormData({ ...formData, send_lead_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Label className="text-foreground font-medium mb-3 block">SMS Notification</Label>
                <Textarea value={formData.lead_rescheduled_template} onChange={(e) => setFormData({ ...formData, lead_rescheduled_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_lead_sms} />
              </div>
              <div className="border-t border-border pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-foreground font-medium">Email Notification to Team</Label>
                  <Switch checked={formData.send_lead_rescheduled_email} onCheckedChange={(c) => setFormData({ ...formData, send_lead_rescheduled_email: c })} />
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Subject Line</Label>
                    <input type="text" value={formData.lead_rescheduled_email_subject} onChange={(e) => setFormData({ ...formData, lead_rescheduled_email_subject: e.target.value })} placeholder="e.g., Appointment Rescheduled - {lead_name}" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info font-mono text-sm" disabled={!formData.send_lead_rescheduled_email} />
                  </div>
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Email Body</Label>
                    <div className="bg-white border border-border rounded-lg overflow-hidden">
                      <ReactQuill key="lead_rescheduled_email_template" value={formData.lead_rescheduled_email_template} onChange={handleQuillChange('lead_rescheduled_email_template')} theme="snow" modules={quillModules} readOnly={!formData.send_lead_rescheduled_email} style={{ minHeight: '200px' }} />
                    </div>
                  </div>
                </div>
                <TestEmailButton emailType="appointment_rescheduled" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Consultant Rescheduled */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-warn" />Consultant Reschedule Notification</CardTitle>
                  <CardDescription className="mt-1">Sent to consultant when appointment is rescheduled</CardDescription>
                </div>
                <Switch checked={formData.send_consultant_sms} onCheckedChange={(c) => setFormData({ ...formData, send_consultant_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.consultant_rescheduled_template} onChange={(e) => setFormData({ ...formData, consultant_rescheduled_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_consultant_sms} />
            </CardContent>
          </Card>
        </motion.div>

        {/* Lead Cancellation */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-crit" />Lead Cancellation Notification</CardTitle>
                  <CardDescription className="mt-1">Sent to lead when appointment is cancelled</CardDescription>
                </div>
                <Switch checked={formData.send_lead_sms} onCheckedChange={(c) => setFormData({ ...formData, send_lead_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.lead_cancelled_template} onChange={(e) => setFormData({ ...formData, lead_cancelled_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_lead_sms} />
              <div className="border-t border-border pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-foreground font-medium">Email Notification to Team</Label>
                  <Switch checked={formData.send_lead_cancelled_email} onCheckedChange={(c) => setFormData({ ...formData, send_lead_cancelled_email: c })} />
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Subject Line</Label>
                    <input type="text" value={formData.lead_cancelled_email_subject} onChange={(e) => setFormData({ ...formData, lead_cancelled_email_subject: e.target.value })} placeholder="e.g., Appointment Cancelled - {lead_name}" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info font-mono text-sm" disabled={!formData.send_lead_cancelled_email} />
                  </div>
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Email Body</Label>
                    <div className="bg-white border border-border rounded-lg overflow-hidden">
                      <ReactQuill key="lead_cancelled_email_template" value={formData.lead_cancelled_email_template} onChange={handleQuillChange('lead_cancelled_email_template')} theme="snow" modules={quillModules} readOnly={!formData.send_lead_cancelled_email} style={{ minHeight: '200px' }} />
                    </div>
                  </div>
                </div>
                <TestEmailButton emailType="appointment_cancelled" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Consultant Cancellation */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-crit" />Consultant Cancellation Notification</CardTitle>
                  <CardDescription className="mt-1">Sent to consultant when appointment is cancelled</CardDescription>
                </div>
                <Switch checked={formData.send_consultant_sms} onCheckedChange={(c) => setFormData({ ...formData, send_consultant_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.consultant_cancelled_template} onChange={(e) => setFormData({ ...formData, consultant_cancelled_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_consultant_sms} />
            </CardContent>
          </Card>
        </motion.div>

        {/* Consultant On My Way */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-info" />Consultant "On My Way" Notification</CardTitle>
                  <CardDescription className="mt-1">Sent to lead when consultant clicks "On My Way"</CardDescription>
                </div>
                <Switch checked={formData.send_lead_sms} onCheckedChange={(c) => setFormData({ ...formData, send_lead_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.consultant_on_my_way_template} onChange={(e) => setFormData({ ...formData, consultant_on_my_way_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_lead_sms} />
            </CardContent>
          </Card>
        </motion.div>

        {/* Consultant Arrived */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.405 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-good" />Consultant "I've Arrived" Notification</CardTitle>
                  <CardDescription className="mt-1">Sent to lead when consultant clicks "I've Arrived"</CardDescription>
                </div>
                <Switch checked={formData.send_lead_sms} onCheckedChange={(c) => setFormData({ ...formData, send_lead_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.consultant_arrived_template} onChange={(e) => setFormData({ ...formData, consultant_arrived_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_lead_sms} />
            </CardContent>
          </Card>
        </motion.div>

        {/* Lead Not Sold */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.41 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-muted-foreground" />Lead Not Sold Notification</CardTitle>
                  <CardDescription className="mt-1">Sent to lead when appointment is marked as Lost, Pitch and Miss, One-Leg, or Credit Decline</CardDescription>
                </div>
                <Switch checked={formData.send_lead_not_sold_sms} onCheckedChange={(c) => setFormData({ ...formData, send_lead_not_sold_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Label className="text-foreground font-medium mb-3 block">SMS Notification</Label>
                <Textarea value={formData.lead_not_sold_template} onChange={(e) => setFormData({ ...formData, lead_not_sold_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_lead_not_sold_sms} />
              </div>
              <div className="border-t border-border pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-foreground font-medium">Email Notification to Lead</Label>
                  <Switch checked={formData.send_lead_not_sold_email} onCheckedChange={(c) => setFormData({ ...formData, send_lead_not_sold_email: c })} />
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Subject Line</Label>
                    <input type="text" value={formData.lead_not_sold_email_subject} onChange={(e) => setFormData({ ...formData, lead_not_sold_email_subject: e.target.value })} placeholder="e.g., Thank You For Your Time - {lead_name}" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info font-mono text-sm" disabled={!formData.send_lead_not_sold_email} />
                  </div>
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Email Body</Label>
                    <div className="bg-white border border-border rounded-lg overflow-hidden">
                      <ReactQuill key="lead_not_sold_email_template" value={formData.lead_not_sold_email_template} onChange={handleQuillChange('lead_not_sold_email_template')} theme="snow" modules={quillModules} readOnly={!formData.send_lead_not_sold_email} style={{ minHeight: '200px' }} />
                    </div>
                  </div>
                </div>
                <TestEmailButton emailType="not_sold" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Customer Sale Confirmation */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.415 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-good" />Customer Sale Confirmation</CardTitle>
                  <CardDescription className="mt-1">Sent to customer when appointment is marked as sold</CardDescription>
                </div>
                <Switch checked={formData.send_customer_sale_sms} onCheckedChange={(c) => setFormData({ ...formData, send_customer_sale_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.customer_sale_confirmation_template} onChange={(e) => setFormData({ ...formData, customer_sale_confirmation_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_customer_sale_sms} />
              <div className="border-t border-border pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-foreground font-medium">Email Notification to Team</Label>
                  <Switch checked={formData.send_customer_sale_confirmation_email} onCheckedChange={(c) => setFormData({ ...formData, send_customer_sale_confirmation_email: c })} />
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Subject Line</Label>
                    <input type="text" value={formData.customer_sale_confirmation_email_subject} onChange={(e) => setFormData({ ...formData, customer_sale_confirmation_email_subject: e.target.value })} placeholder="e.g., New Sale Closed - {customer_name}" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info font-mono text-sm" disabled={!formData.send_customer_sale_confirmation_email} />
                  </div>
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Email Body</Label>
                    <div className="bg-white border border-border rounded-lg overflow-hidden">
                      <ReactQuill key="customer_sale_confirmation_email_template" value={formData.customer_sale_confirmation_email_template} onChange={handleQuillChange('customer_sale_confirmation_email_template')} theme="snow" modules={quillModules} readOnly={!formData.send_customer_sale_confirmation_email} style={{ minHeight: '200px' }} />
                    </div>
                  </div>
                </div>
                <TestEmailButton emailType="sale_confirmed" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Customer Project Created */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.42 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-warn" />Customer Project Created</CardTitle>
                  <CardDescription className="mt-1">Sent to customer when project is created</CardDescription>
                </div>
                <Switch checked={formData.send_customer_project_sms} onCheckedChange={(c) => setFormData({ ...formData, send_customer_project_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.customer_project_created_template} onChange={(e) => setFormData({ ...formData, customer_project_created_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_customer_project_sms} />
              <div className="border-t border-border pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-foreground font-medium">Email Notification to Customer</Label>
                  <Switch checked={formData.send_customer_project_created_email} onCheckedChange={(c) => setFormData({ ...formData, send_customer_project_created_email: c })} />
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Subject Line</Label>
                    <input type="text" value={formData.customer_project_created_email_subject} onChange={(e) => setFormData({ ...formData, customer_project_created_email_subject: e.target.value })} placeholder="e.g., Your Floor Daddy Project - {customer_name}" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info font-mono text-sm" disabled={!formData.send_customer_project_created_email} />
                  </div>
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Email Body</Label>
                    <div className="bg-white border border-border rounded-lg overflow-hidden">
                      <ReactQuill key="customer_project_created_email_template" value={formData.customer_project_created_email_template} onChange={handleQuillChange('customer_project_created_email_template')} theme="snow" modules={quillModules} readOnly={!formData.send_customer_project_created_email} style={{ minHeight: '200px' }} />
                    </div>
                  </div>
                </div>
                <TestEmailButton emailType="project_created" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* DC Ticket Assigned */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.425 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-crit" />DC Ticket Assigned</CardTitle>
                  <CardDescription className="mt-1">Sent to Design Consultant when ticket is assigned</CardDescription>
                </div>
                <Switch checked={formData.send_dc_ticket_sms} onCheckedChange={(c) => setFormData({ ...formData, send_dc_ticket_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.dc_ticket_assigned_template} onChange={(e) => setFormData({ ...formData, dc_ticket_assigned_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_dc_ticket_sms} />
            </CardContent>
          </Card>
        </motion.div>

        {/* Requester Category Resolved */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.43 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-good" />Requester Category Resolved</CardTitle>
                  <CardDescription className="mt-1">Sent to Order Processor when a ticket category is resolved</CardDescription>
                </div>
                <Switch checked={formData.send_requester_resolved_sms} onCheckedChange={(c) => setFormData({ ...formData, send_requester_resolved_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.requester_category_resolved_template} onChange={(e) => setFormData({ ...formData, requester_category_resolved_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_requester_resolved_sms} />
            </CardContent>
          </Card>
        </motion.div>

        {/* DC New Message */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.435 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-info" />DC New Message Notification</CardTitle>
                  <CardDescription className="mt-1">Sent to DC when they receive a new message on a ticket</CardDescription>
                </div>
                <Switch checked={formData.send_ticket_message_sms} onCheckedChange={(c) => setFormData({ ...formData, send_ticket_message_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.dc_new_message_template} onChange={(e) => setFormData({ ...formData, dc_new_message_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_ticket_message_sms} />
            </CardContent>
          </Card>
        </motion.div>

        {/* Requester New Message */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.44 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-purple-600" />Requester New Message Notification</CardTitle>
                  <CardDescription className="mt-1">Sent to Order Processor when they receive a new message</CardDescription>
                </div>
                <Switch checked={formData.send_ticket_message_sms} onCheckedChange={(c) => setFormData({ ...formData, send_ticket_message_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.requester_new_message_template} onChange={(e) => setFormData({ ...formData, requester_new_message_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_ticket_message_sms} />
            </CardContent>
          </Card>
        </motion.div>

        {/* DC Resolution Denied */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.445 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-warn" />DC Resolution Denied</CardTitle>
                  <CardDescription className="mt-1">Sent to DC when resolution request is denied</CardDescription>
                </div>
                <Switch checked={formData.send_dc_resolution_denied_sms} onCheckedChange={(c) => setFormData({ ...formData, send_dc_resolution_denied_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.dc_resolution_denied_template} onChange={(e) => setFormData({ ...formData, dc_resolution_denied_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_dc_resolution_denied_sms} />
            </CardContent>
          </Card>
        </motion.div>

        {/* DC Ticket Reminder */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-info" />DC Ticket Reminder</CardTitle>
                  <CardDescription className="mt-1">Manual reminder sent to DC about open tickets</CardDescription>
                </div>
                <Switch checked={formData.send_dc_ticket_reminder_sms} onCheckedChange={(c) => setFormData({ ...formData, send_dc_ticket_reminder_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.dc_ticket_reminder_template} onChange={(e) => setFormData({ ...formData, dc_ticket_reminder_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_dc_ticket_reminder_sms} />
            </CardContent>
          </Card>
        </motion.div>

        {/* DC Follow-Up Reminder */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.455 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-purple-600" />DC Follow-Up Reminder</CardTitle>
                  <CardDescription className="mt-1">Daily reminder sent to DC about follow-up appointments</CardDescription>
                </div>
                <Switch checked={formData.send_dc_followup_reminder_sms} onCheckedChange={(c) => setFormData({ ...formData, send_dc_followup_reminder_sms: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={formData.dc_followup_reminder_template} onChange={(e) => setFormData({ ...formData, dc_followup_reminder_template: e.target.value })} placeholder="Enter your SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_dc_followup_reminder_sms} />
              <p className="text-xs text-muted-foreground mt-2">Available variables: {'{dc_first_name}'}, {'{count}'}, {'{customer_last_names}'}, {'{tasks_url}'}</p>
              <div className="space-y-3 mt-4">
                <div>
                  <Label className="text-sm text-foreground mb-2 block">Test Against Specific DC</Label>
                  <Select value={selectedTestDC} onValueChange={setSelectedTestDC}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select DC to test..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All DCs with Follow-Ups</SelectItem>
                      {teamMembers.map(dc => (
                        <SelectItem key={dc.id} value={dc.id}>{dc.first_name} {dc.last_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" onClick={testFollowUpReminders} disabled={testingFollowUpReminders} variant="outline" size="sm" className="w-full">
                  {testingFollowUpReminders ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : <><PlayCircle className="w-4 h-4 mr-2" />Send Test Now</>}
                </Button>
              </div>
              <p className="text-xs text-info mt-2">ℹ Automated daily at 9 AM to all DCs with follow-up appointments</p>
              {lastFollowUpRun && (
                <div className="bg-muted border border-border rounded-lg p-3 mt-3">
                  <p className="text-xs text-muted-foreground"><strong>Last Run:</strong> {new Date(lastFollowUpRun.created_date).toLocaleString()}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Email Diversion */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.46 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-info" />Email Diversion for Testing</CardTitle>
              <CardDescription className="mt-1">Divert notification emails to a test address</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-foreground font-medium">Test Email Address</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-3">When diversion is enabled, all emails will be sent here instead</p>
                <input type="email" value={formData.divert_emails_to} onChange={(e) => setFormData({ ...formData, divert_emails_to: e.target.value })} placeholder="test@example.com" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info text-sm" />
              </div>
              <div className="border-t border-border pt-4 space-y-3">
                <Label className="text-foreground font-medium">Enable Diversion For:</Label>
                {[
                  { label: 'Lead Appointment Created', field: 'divert_lead_appointment_created_email' },
                  { label: 'Day 1 Follow-Up Email', field: 'divert_lead_day1_followup_email' },
                  { label: 'Day 2 Follow-Up Email', field: 'divert_lead_day2_followup_email' },
                  { label: 'Day 3 Follow-Up Email', field: 'divert_lead_day3_followup_email' },
                  { label: 'Lead Reschedule', field: 'divert_lead_rescheduled_email' },
                  { label: 'Lead Cancellation', field: 'divert_lead_cancelled_email' },
                  { label: 'Sale Confirmation', field: 'divert_customer_sale_confirmation_email' },
                  { label: 'Project Created', field: 'divert_customer_project_created_email' },
                  { label: '24-Hour Reminder', field: 'divert_lead_reminder_email' },
                  { label: 'Lead Not Sold', field: 'divert_lead_not_sold_email' },
                ].map(({ label, field }) => (
                  <div key={field} className="flex items-center justify-between p-3 rounded-lg border border-border">
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <Switch checked={formData[field] || false} onCheckedChange={(c) => setFormData({ ...formData, [field]: c })} />
                  </div>
                ))}
              </div>
              <div className="bg-warn/12 border border-warn/25 rounded-lg p-3">
                <p className="text-xs text-warn"><strong>Testing Mode:</strong> When enabled, emails go to the test address. Remember to disable after testing!</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* CC Group Calendar & Emails */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.465 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Calendar className="w-5 h-5 text-info" />Calendar CC Settings</CardTitle>
              <CardDescription className="mt-1">Configure recipients for all appointment calendar invites</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-foreground font-medium">Group Calendar ID</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-3">Enter your Google Calendar group ID</p>
                <input type="text" value={formData.cc_group_calendar_id} onChange={(e) => setFormData({ ...formData, cc_group_calendar_id: e.target.value })} placeholder="c_xxxxx@group.calendar.google.com" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info font-mono text-sm" />
              </div>
              <div className="border-t border-border pt-4">
                <Label className="text-foreground font-medium">Additional CC Emails</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-3">Add email addresses to be CC'd on all calendar invites and notification emails</p>
                <EmailInput value={formData.cc_emails || []} onChange={(emails) => setFormData({ ...formData, cc_emails: emails })} placeholder="Type email and press Enter..." />
              </div>
              <div className="border-t border-border pt-4">
                <Label className="text-foreground font-medium">Reply-To Email Address</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-3">Set a reply-to address for all notification emails (optional)</p>
                <input type="email" value={formData.reply_to_email || ''} onChange={(e) => setFormData({ ...formData, reply_to_email: e.target.value })} placeholder="support@example.com" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info text-sm" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Value Add Keywords */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.47 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Tag className="w-5 h-5 text-info" />Value Add Keywords for Transcript Analysis</CardTitle>
              <CardDescription className="mt-1">Keywords to identify in transcripts for tracking value adds</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label className="text-foreground font-medium mb-3 block">Add Keywords</Label>
                  <div className="flex gap-2">
                    <input type="text" value={keywordInput} onChange={(e) => setKeywordInput(e.target.value)} onKeyPress={handleKeywordKeyPress} placeholder="Type keyword and press Enter..." className="flex-1 px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info text-sm" />
                    <Button type="button" onClick={addKeyword} variant="outline" size="sm">Add</Button>
                  </div>
                </div>
                {formData.value_add_keywords?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {formData.value_add_keywords.map((keyword, idx) => (
                      <Badge key={idx} variant="outline" className="px-3 py-1.5 text-sm bg-info/12 text-info border-info/25">
                        {keyword}
                        <button onClick={() => removeKeyword(keyword)} className="ml-2 hover:text-info"><X className="w-3 h-3" /></button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Photo Requirements */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.475 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Camera className="w-5 h-5 text-info" />Sale Photo Requirements</CardTitle>
              <CardDescription className="mt-1">Configure which photos are required when marking appointments as sold</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                <div>
                  <p className="font-medium text-foreground">RAZZLE DAZZLE Folder Photo</p>
                  <p className="text-sm text-muted-foreground mt-1">Require photo of folder left at property</p>
                </div>
                <Switch checked={formData.require_folder_photo} onCheckedChange={(c) => setFormData({ ...formData, require_folder_photo: c })} />
              </div>
              <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                <div>
                  <p className="font-medium text-foreground">Yard Sign Photo</p>
                  <p className="text-sm text-muted-foreground mt-1">Require photo of yard sign (unless customer opts out)</p>
                </div>
                <Switch checked={formData.require_yard_sign_photo} onCheckedChange={(c) => setFormData({ ...formData, require_yard_sign_photo: c })} />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* 24-Hour Reminder */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.48 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-info" />24-Hour Appointment Reminder</CardTitle>
                  <CardDescription className="mt-1">Sent to lead 24 hours before appointment (via cron job)</CardDescription>
                </div>
                <Switch checked={formData.send_reminders} onCheckedChange={(c) => setFormData({ ...formData, send_reminders: c })} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Label className="text-foreground font-medium mb-3 block">SMS Notification</Label>
                <Textarea value={formData.lead_reminder_template} onChange={(e) => setFormData({ ...formData, lead_reminder_template: e.target.value })} placeholder="Enter your reminder SMS template..." className="min-h-32 font-mono text-sm" disabled={!formData.send_reminders} />
              </div>
              <div className="border-t border-border pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-foreground font-medium">Email Notification to Lead</Label>
                  <Switch checked={formData.send_lead_reminder_email} onCheckedChange={(c) => setFormData({ ...formData, send_lead_reminder_email: c })} />
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Subject Line</Label>
                    <input type="text" value={formData.lead_reminder_email_subject} onChange={(e) => setFormData({ ...formData, lead_reminder_email_subject: e.target.value })} placeholder="e.g., Reminder: Your Floor Daddy Appointment Tomorrow - {lead_name}" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-info font-mono text-sm" disabled={!formData.send_lead_reminder_email} />
                  </div>
                  <div>
                    <Label className="text-foreground text-sm mb-2 block">Email Body</Label>
                    <div className="bg-white border border-border rounded-lg overflow-hidden">
                      <ReactQuill key="lead_reminder_email_template" value={formData.lead_reminder_email_template} onChange={handleQuillChange('lead_reminder_email_template')} theme="snow" modules={quillModules} readOnly={!formData.send_lead_reminder_email} style={{ minHeight: '200px' }} />
                    </div>
                  </div>
                </div>
                <TestEmailButton emailType="reminder" />
              </div>
              <div className="space-y-3 mt-4">
                <div>
                  <Label className="text-sm text-foreground mb-2 block">Test Against Specific Appointment</Label>
                  <Select value={selectedTestAppointment} onValueChange={setSelectedTestAppointment}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select appointment to test..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Appointments (Tomorrow)</SelectItem>
                      {upcomingAppointments.map(appt => (
                        <SelectItem key={appt.id} value={appt.id}>{appt.leadName} - {new Date(appt.appointment_date).toLocaleDateString()} {appt.appointment_block}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={setupCronJob} disabled={checkingCron} variant="outline" size="sm" className="flex-1">
                    {checkingCron ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Checking...</> : cronExists ? <><Clock className="w-4 h-4 mr-2" />Delete Daily Cron Job</> : <><Clock className="w-4 h-4 mr-2" />Setup Daily Cron Job</>}
                  </Button>
                  <Button type="button" onClick={testReminders} disabled={testingReminders} variant="outline" size="sm" className="flex-1">
                    {testingReminders ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Testing...</> : <><PlayCircle className="w-4 h-4 mr-2" />Test Now</>}
                  </Button>
                </div>
              </div>
              {cronStatus === 'success' && <p className="text-xs text-good mt-2">✓ Cron job created successfully! Reminders will run daily at 9 AM.</p>}
              {cronStatus === 'deleted' && <p className="text-xs text-good mt-2">✓ Cron job deleted successfully.</p>}
              {cronStatus === 'error' && <p className="text-xs text-crit mt-2">✗ Failed. Check your CRONJOB_ORG_API_KEY secret.</p>}
              {!checkingCron && cronExists && !cronStatus && <p className="text-xs text-info mt-2">ℹ Daily cron job is active (runs at 9 AM).</p>}
            </CardContent>
          </Card>
        </motion.div>

        {/* Finance Report Emails */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.485 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-good" />Daily Finance Report Recipients</CardTitle>
              <CardDescription className="mt-1">These addresses receive a daily email listing all pending payment projects with a link to the Finance page</CardDescription>
            </CardHeader>
            <CardContent>
              <EmailInput
                value={formData.finance_report_emails || []}
                onChange={(emails) => setFormData({ ...formData, finance_report_emails: emails })}
                placeholder="Type email and press Enter..."
              />
              <p className="text-xs text-info mt-3">ℹ Sent automatically every morning at 8 AM (Arizona time). Only sent when pending payment projects exist.</p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Save Button */}
        <Button onClick={handleSave} disabled={saveMutation.isPending} className="w-full bg-info hover:bg-info h-12">
          {saveMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save Settings</>}
        </Button>
      </div>

      {/* Variables Library */}
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="text-lg">Available Variables</CardTitle>
              <p className="text-sm text-muted-foreground">Click to copy to clipboard</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {Object.entries(AVAILABLE_VARIABLES).map(([group, vars]) => (
                <div key={group}>
                  <h3 className="text-sm font-semibold text-foreground mb-2 capitalize">{group} Information</h3>
                  <div className="space-y-1">
                    {vars.map(({ variable, description }) => (
                      <button key={variable} onClick={() => copyVariable(variable)} className="w-full text-left p-2 rounded-lg hover:bg-muted transition-colors group">
                        <div className="flex items-center justify-between">
                          <code className="text-xs font-mono text-good bg-good/12 px-2 py-1 rounded">{variable}</code>
                          {copiedVariable === variable ? <Check className="w-3 h-3 text-good" /> : <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}