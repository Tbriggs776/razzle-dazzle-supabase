import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { deliveryNote, invokeFailure, invokeNotSent } from '@/lib/invokeResult';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ClipboardCheck, Plus, ChevronDown, ChevronUp, Trash2, Send, Loader2, X } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import InspectionReportForm from './InspectionReportForm';
import PhotoLightbox from '@/components/PhotoLightbox';
import { SignedImage } from '@/lib/fileUrl';

export default function InspectionReportsSection({ project, customer, sale, currentUser }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [resendModal, setResendModal] = useState(null); // { report }
  const [resendEmails, setResendEmails] = useState([]);
  const [resendNewEmail, setResendNewEmail] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [lightboxPhotos, setLightboxPhotos] = useState([]);

  const DEFAULT_EMAILS = [
    'orders@example.com',
    'user1@example.com',
    'user2@example.com',
    'user3@example.com',
    'user4@example.com'
  ];

  const { data: reports = [] } = useQuery({
    queryKey: ['inspectionReports', project?.id],
    queryFn: () => base44.entities.InspectionReport.filter({ project: project.id }),
    enabled: !!project?.id
  });

  const sorted = [...reports].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  const handleDelete = async (id) => {
    if (!confirm('Delete this inspection report?')) return;
    await base44.entities.InspectionReport.delete(id);
    queryClient.invalidateQueries({ queryKey: ['inspectionReports', project.id] });
  };

  const handleSave = async (formData, submit = true) => {
    setSaving(true);
    const created = await base44.entities.InspectionReport.create({ ...formData, project: project.id });
    queryClient.invalidateQueries({ queryKey: ['inspectionReports', project.id] });
    // Only send PDF email if submit=true
    if (submit && formData.email_recipients?.length > 0) {
      // The report IS saved by this point. Never throw here — but an inspection
      // report that reached nobody is the same as one that was never written.
      const res = await base44.functions.invoke('sendInspectionReportEmail', { reportId: created.id });
      const note = deliveryNote(res, { saved: 'Report saved', sent: 'the email did not go out' });
      if (note) toast.warning(note, { duration: 8000 });
    }
    setSaving(false);
    setShowForm(false);
  };

  const openResendModal = (report) => {
    const emails = (report.email_recipients && report.email_recipients.length > 0) ? [...report.email_recipients] : [...DEFAULT_EMAILS];
    setResendEmails(emails);
    setResendNewEmail('');
    // Use setTimeout to ensure state is set before modal opens
    setTimeout(() => setResendModal({ report }), 0);
  };

  const addResendEmail = () => {
    const trimmed = resendNewEmail.trim();
    if (trimmed && !resendEmails.includes(trimmed)) {
      setResendEmails(prev => [...prev, trimmed]);
    }
    setResendNewEmail('');
  };

  const handleResendConfirm = async () => {
    if (!resendEmails.length) return;
    const { report } = resendModal;
    setSendingId(report.id);
    setResendModal(null);
    try {
      // Update recipients on the record first, then send
      await base44.entities.InspectionReport.update(report.id, { email_recipients: resendEmails });
      const res = await base44.functions.invoke('sendInspectionReportEmail', { reportId: report.id });
      queryClient.invalidateQueries({ queryKey: ['inspectionReports', project.id] });
      // invoke() does not throw, so the catch below only ever covered the entity
      // update: pressing Resend reported neither success nor failure.
      const failed = invokeFailure(res);
      const notSent = invokeNotSent(res);
      if (failed) toast.error(`Not sent — ${failed}`);
      else if (notSent) toast.warning(`Nothing went out — ${notSent}`, { duration: 8000 });
      else toast.success(`Sent to ${resendEmails.length} recipient${resendEmails.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error('Failed to send: ' + e.message);
    }
    setSendingId(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.56 }}
      className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-indigo-600" />
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">
            Inspection Reports
          </h2>
        </div>
        <Button
          size="sm"
          onClick={() => setShowForm(true)}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4 mr-1" /> New Report
        </Button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">No inspection reports yet</p>
      ) : (
        <div className="space-y-3">
          {sorted.map(report => (
            <div key={report.id} className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex items-center">
                <button
                  className="flex-1 flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
                  onClick={() => setExpandedId(expandedId === report.id ? null : report.id)}
                >
                  <div className="flex items-center gap-3 text-left">
                    <ClipboardCheck className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        Inspection — {report.inspected_on ? format(new Date(report.inspected_on + 'T00:00:00'), 'MMM d, yyyy') : 'No date'}
                      </p>
                      <p className="text-xs text-slate-400">
                        By {report.inspected_by || 'Unknown'} · Created {format(new Date(report.created_date.endsWith('Z') ? report.created_date : report.created_date + 'Z'), 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                  </div>
                  {expandedId === report.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                <button
                  onClick={() => openResendModal(report)}
                  disabled={sendingId === report.id}
                  className="px-3 py-3 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                  title="Resend PDF Email"
                >
                  {sendingId === report.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => handleDelete(report.id)}
                  className="px-3 py-3 text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {expandedId === report.id && (
                <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    {report.customer_name && <Row label="Customer" value={report.customer_name} />}
                    {report.job_number && <Row label="Job #" value={report.job_number} />}
                    {report.address && <Row label="Address" value={report.address} className="col-span-2" />}
                    {report.phone_primary && <Row label="Phone Primary" value={report.phone_primary} />}
                    {report.phone_secondary && <Row label="Phone Secondary" value={report.phone_secondary} />}
                    {report.inspected_by && <Row label="Inspected By" value={report.inspected_by} />}
                    {report.inspected_on && <Row label="On" value={format(new Date(report.inspected_on + 'T00:00:00'), 'MMM d, yyyy')} />}
                    {report.installer_name && <Row label="Installer" value={report.installer_name} />}
                    {report.installation_date && <Row label="Install Date" value={format(new Date(report.installation_date + 'T00:00:00'), 'MMM d, yyyy')} />}
                  </div>
                  {report.issue_to_inspect && <Row label="Issue to Inspect" value={report.issue_to_inspect} block />}
                  {report.material_installed && <Row label="Material Installed" value={report.material_installed} block />}
                  {report.action_materials_labor_cost && <Row label="Action / Materials / Labor Cost" value={report.action_materials_labor_cost} block />}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    {report.send_original_installer_back && <Row label="Send Original Installer Back" value={report.send_original_installer_back} />}
                    {report.back_charge_installer && <Row label="Back Charge Installer" value={report.back_charge_installer} />}
                    {report.back_charge_date && <Row label="Back Charge Date" value={format(new Date(report.back_charge_date + 'T00:00:00'), 'MMM d, yyyy')} />}
                    {report.payment_to_different_installer && <Row label="Payment to Different Installer" value={report.payment_to_different_installer} className="col-span-2" />}
                    {report.time_to_resolve && <Row label="Time to Resolve" value={report.time_to_resolve} />}
                  </div>
                  {report.resolution && <Row label="Resolution" value={report.resolution} block />}
                  {report.images && report.images.length > 0 && (
                    <div>
                      <p className="text-xs text-slate-400 font-medium uppercase mb-2">Photos</p>
                      <div className="grid grid-cols-3 gap-2">
                        {report.images.map((img, i) => {
                          const url = typeof img === 'string' ? img : img.url;
                          const desc = typeof img === 'object' ? img.description : null;
                          return (
                            <div key={i} className="rounded-lg border border-slate-200 overflow-hidden">
                              <button onClick={() => {
                                const urls = report.images.map(image => typeof image === 'string' ? image : image.url);
                                setLightboxPhotos(urls);
                                setLightboxIndex(i);
                              }} className="w-full">
                                <SignedImage src={url} alt={`Photo ${i + 1}`} className="w-full h-24 object-cover cursor-pointer hover:opacity-90" />
                              </button>
                              {desc && <p className="text-xs text-slate-500 px-2 py-1 bg-white truncate">{desc}</p>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {report.customer_signature && (
                    <div>
                      <p className="text-xs text-slate-400 font-medium uppercase mb-1">Customer Signature</p>
                      <SignedImage src={report.customer_signature} alt="Customer Signature" className="h-20 border border-slate-200 rounded-lg bg-white" />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Resend Modal */}
      <Dialog open={!!resendModal} onOpenChange={() => setResendModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Report PDF</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-500">Select recipients for this inspection report:</p>
            <div className="flex flex-wrap gap-2">
              {resendEmails.map(email => (
                <span key={email} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded-full">
                  {email}
                  <button type="button" onClick={() => setResendEmails(prev => prev.filter(e => e !== email))} className="hover:text-red-500 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="Add email..."
                value={resendNewEmail}
                onChange={e => setResendNewEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addResendEmail())}
                className="flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={addResendEmail}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResendModal(null)}>Cancel</Button>
            <Button onClick={handleResendConfirm} disabled={!resendEmails.length} className="bg-indigo-600 hover:bg-indigo-700">
              <Send className="w-4 h-4 mr-1" /> Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InspectionReportForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSave={handleSave}
        project={project}
        customer={customer}
        sale={sale}
        saving={saving}
      />

      <PhotoLightbox photos={lightboxPhotos} lightboxIndex={lightboxIndex} onClose={setLightboxIndex} />
    </motion.div>
  );
}

function Row({ label, value, block, className }) {
  if (block) {
    return (
      <div className={className}>
        <p className="text-xs text-slate-400 font-medium uppercase mb-0.5">{label}</p>
        <p className="text-slate-700 whitespace-pre-wrap">{value}</p>
      </div>
    );
  }
  return (
    <div className={className}>
      <p className="text-xs text-slate-400 font-medium uppercase mb-0.5">{label}</p>
      <p className="text-slate-700">{value}</p>
    </div>
  );
}