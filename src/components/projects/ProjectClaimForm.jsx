import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, X, Plus, Upload } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import InstallersList from './InstallersList';
import { SignedImage, openSignedFile } from '@/lib/fileUrl';

const DEFAULT_EMAILS = [
  'user1@example.com',
  'user2@example.com',
  'user3@example.com',
  'user4@example.com',
  'user5@example.com',
  'user6@example.com',
  'user7@example.com',
  'user8@example.com',
  'orders@example.com'
];

export default function ProjectClaimForm({ open, onClose, onSave, project, customer, sale, saving, initialData }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [installers, setInstallers] = useState([{ mode: 'dropdown', value: '' }]);
  const [emailRecipients, setEmailRecipients] = useState([...DEFAULT_EMAILS]);
  const [newEmail, setNewEmail] = useState('');
  const [images, setImages] = useState([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [form, setForm] = useState({
    claim_type: '',
    installer_name: '',
    customer_name: '',
    job_number: '',
    address: '',
    notes: '',
    billable_repair: false,
    is_back_charge: false,
    back_charge_party: '',
    payment_status: '',
    need_to_order_material: false,
    material_details: '',
    submitted_by: '',
    submitted_on: new Date().toISOString().split('T')[0],
  });

  const { data: crewsData } = useQuery({
    queryKey: ['rfmsCrews'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getRFMSCrews', {});
      return res?.data?.crews?.detail || [];
    },
    staleTime: 10 * 60 * 1000,
  });

  const crews = Array.isArray(crewsData) ? crewsData : [];

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  useEffect(() => {
    if (open) {
      setNewEmail('');
      if (initialData) {
        // Editing existing record
        const existingInstallers = initialData.installers?.length
          ? initialData.installers.map(v => ({ mode: 'dropdown', value: v }))
          : initialData.installer_name
            ? [{ mode: 'dropdown', value: initialData.installer_name }]
            : [{ mode: 'dropdown', value: '' }];
        setInstallers(existingInstallers);
        setForm({
          claim_type: initialData.claim_type || '',
          installer_name: initialData.installer_name || '',
          customer_name: initialData.customer_name || '',
          job_number: initialData.job_number || '',
          address: initialData.address || '',
          notes: initialData.notes || '',
          billable_repair: initialData.billable_repair || false,
          is_back_charge: initialData.is_back_charge || false,
          back_charge_party: initialData.back_charge_party || '',
          payment_status: initialData.payment_status || '',
          need_to_order_material: initialData.need_to_order_material || false,
          material_details: initialData.material_details || '',
          submitted_by: initialData.submitted_by || '',
          submitted_on: initialData.submitted_on || new Date().toISOString().split('T')[0],
        });
        setImages(initialData.images || []);
        setEmailRecipients(initialData.email_recipients?.length ? initialData.email_recipients : [...DEFAULT_EMAILS]);
      } else {
        setInstallers([{ mode: 'dropdown', value: '' }]);
        setEmailRecipients([...DEFAULT_EMAILS]);
        setImages([]);
      }
    }
  }, [open, initialData]);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
    setImages(prev => [...prev, fileUrl]);
    setUploadingImage(false);
    e.target.value = '';
  };

  const removeImage = (index) => setImages(prev => prev.filter((_, i) => i !== index));

  useEffect(() => {
    if (open) {
      setForm(f => ({
        ...f,
        customer_name: customer ? `${customer.first_name} ${customer.last_name}` : '',
        address: sale?.location_address || (customer ? [customer.address_line1, customer.city, customer.state].filter(Boolean).join(', ') : ''),
        job_number: sale?.invoice_number || '',
        submitted_by: currentUser?.full_name || ''
      }));
    }
  }, [open, customer, sale, currentUser]);

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const addEmail = () => {
    const trimmed = newEmail.trim();
    if (trimmed && !emailRecipients.includes(trimmed)) {
      setEmailRecipients(prev => [...prev, trimmed]);
    }
    setNewEmail('');
  };

  const handleSave = (sendEmail = true) => {
    const installerNames = installers.map(i => i.value).filter(Boolean);
    onSave({ ...form, installers: installerNames, installer_name: installerNames[0] || '', email_recipients: emailRecipients, images }, sendEmail);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? 'Edit Claim / Repair / Short Item' : 'New Claim / Repair / Short Item'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Type</Label>
            <Select value={form.claim_type} onValueChange={v => set('claim_type', v)}>
              <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Claim">Claim</SelectItem>
                <SelectItem value="Repair">Repair</SelectItem>
                <SelectItem value="Short Item">Short Item</SelectItem>
                <SelectItem value="Product Swap">Product Swap</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <InstallersList
            installers={installers}
            onChange={setInstallers}
            crews={crews}
            crewsLoading={false}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Customer Name</Label>
              <Input value={form.customer_name} onChange={e => set('customer_name', e.target.value)} />
            </div>
            <div>
              <Label>Job #</Label>
              <Input value={form.job_number} onChange={e => set('job_number', e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Address</Label>
            <Input value={form.address} onChange={e => set('address', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Submitted By</Label>
              <Input value={form.submitted_by} onChange={e => set('submitted_by', e.target.value)} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.submitted_on} onChange={e => set('submitted_on', e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea rows={4} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Describe the issue..." />
          </div>

          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <Checkbox
              id="need_to_order_material"
              checked={!!form.need_to_order_material}
              onCheckedChange={v => set('need_to_order_material', v)}
            />
            <Label htmlFor="need_to_order_material" className="cursor-pointer font-medium text-slate-700">
              Need to Order Material
            </Label>
          </div>

          {/* Billing fields */}
          <div className="grid grid-cols-1 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Billing Info</p>
            <div className="flex flex-wrap gap-4">
              {form.claim_type !== 'Short Item' && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="billable_repair"
                    checked={!!form.billable_repair}
                    onCheckedChange={v => set('billable_repair', v)}
                  />
                  <Label htmlFor="billable_repair" className="cursor-pointer text-slate-700">Billable Repair</Label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="is_back_charge"
                  checked={!!form.is_back_charge}
                  onCheckedChange={v => { set('is_back_charge', v); if (!v) set('back_charge_party', ''); }}
                />
                <Label htmlFor="is_back_charge" className="cursor-pointer text-slate-700">Back Charge</Label>
              </div>
            </div>
            {form.is_back_charge && (
              <div>
                <Label>Back Charge To</Label>
                <Select value={form.back_charge_party || ''} onValueChange={v => set('back_charge_party', v)}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DC">DC</SelectItem>
                    <SelectItem value="Installer">Installer</SelectItem>
                    <SelectItem value="General">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.claim_type !== 'Short Item' && (
              <div>
                <Label>Payable / Not Payable</Label>
                <Select value={form.payment_status} onValueChange={v => set('payment_status', v)}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Payable">Payable</SelectItem>
                    <SelectItem value="Not Payable">Not Payable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {form.need_to_order_material && (
            <div>
              <Label>Material Details</Label>
              <Textarea rows={2} value={form.material_details} onChange={e => set('material_details', e.target.value)} placeholder="What material needs to be ordered?" />
            </div>
          )}

          {/* Photos */}
          <div>
            <Label>Photos / Images</Label>
            <div className="mt-2 space-y-2">
              {images.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {images.map((url, i) => (
                    <div key={i} className="relative group rounded-lg overflow-hidden border border-slate-200">
                      <SignedImage src={url} alt={`Photo ${i + 1}`} className="w-full h-24 object-cover cursor-pointer hover:opacity-90" onClick={() => openSignedFile(url)} />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className="flex items-center justify-center gap-2 w-full p-3 border-2 border-dashed border-slate-300 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors cursor-pointer">
                <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploadingImage} className="hidden" />
                {uploadingImage ? (
                  <><Loader2 className="w-4 h-4 text-indigo-600 animate-spin" /><span className="text-sm text-slate-600">Uploading...</span></>
                ) : (
                  <><Upload className="w-4 h-4 text-slate-400" /><span className="text-sm text-slate-600">Click to upload a photo</span></>
                )}
              </label>
            </div>
          </div>

          {/* Email Recipients */}
          <div>
            <Label>Send Report To</Label>
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                {emailRecipients.map(email => (
                  <span key={email} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded-full">
                    {email}
                    <button type="button" onClick={() => setEmailRecipients(prev => prev.filter(e => e !== email))} className="hover:text-red-500 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="Add email..."
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addEmail())}
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="sm" onClick={addEmail}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="outline" onClick={() => handleSave(false)} disabled={saving} className="border-slate-300 text-slate-700">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save (No Email)'}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save & Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}