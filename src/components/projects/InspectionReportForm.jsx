import React, { useRef, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Eraser, X, Plus, Upload, Paperclip, Download } from 'lucide-react';
import { Checkbox } from "@/components/ui/checkbox";
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import InstallersList from './InstallersList';

const DEFAULT_EMAILS = [
  'user1@example.com',
  'user2@example.com',
  'user3@example.com',
  'user4@example.com',
  'user5@example.com',
  'user6@example.com',
  'user7@example.com'
];

export default function InspectionReportForm({ open, onClose, onSave, project, customer, sale, saving, initialData }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [installers, setInstallers] = useState([{ mode: 'dropdown', value: '' }]);

  const { data: crews = [], isLoading: crewsLoading } = useQuery({
    queryKey: ['rfmsCrews'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getRFMSCrews', {});
      return res?.data?.crews?.detail || [];
    },
    staleTime: 5 * 60 * 1000
  });
  const [emailRecipients, setEmailRecipients] = useState([...DEFAULT_EMAILS]);
  const [newEmail, setNewEmail] = useState('');
  const [images, setImages] = useState([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  // Reset emails + images + files when form opens
  useEffect(() => {
    if (open) {
      if (initialData) {
        setEmailRecipients(initialData.email_recipients?.length ? initialData.email_recipients : [...DEFAULT_EMAILS]);
        // Normalize images: support both old string format and new object format
        setImages((initialData.images || []).map(img => typeof img === 'string' ? { url: img, description: '' } : img));
        setFiles(initialData.files || []);
        const existingInstallers = initialData.installers?.length
          ? initialData.installers.map(v => ({ mode: 'dropdown', value: v }))
          : initialData.installer_name
            ? [{ mode: 'dropdown', value: initialData.installer_name }]
            : [{ mode: 'dropdown', value: '' }];
        setInstallers(existingInstallers);
      } else {
        setEmailRecipients([...DEFAULT_EMAILS]);
        setImages([]);
        setFiles([]);
        setInstallers([{ mode: 'dropdown', value: '' }]);
      }
    }
  }, [open, initialData]);

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadingImage(true);
    const newImages = await Promise.all(files.map(async (file) => {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      return { url: file_url, description: '' };
    }));
    setImages(prev => [...prev, ...newImages]);
    setUploadingImage(false);
    e.target.value = '';
  };

  const removeImage = (index) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const updateImageDescription = (index, description) => {
    setImages(prev => prev.map((img, i) => i === index ? { ...img, description } : img));
  };

  const handleFileUpload = async (e) => {
    const selected = Array.from(e.target.files || []);
    if (!selected.length) return;
    setUploadingFile(true);
    const uploaded = await Promise.all(selected.map(async (file) => {
      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      return { url: fileUrl, name: file.name };
    }));
    setFiles(prev => [...prev, ...uploaded]);
    setUploadingFile(false);
    e.target.value = '';
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const addEmail = () => {
    const trimmed = newEmail.trim();
    if (trimmed && !emailRecipients.includes(trimmed)) {
      setEmailRecipients(prev => [...prev, trimmed]);
    }
    setNewEmail('');
  };

  const removeEmail = (email) => {
    setEmailRecipients(prev => prev.filter(e => e !== email));
  };
  const [form, setForm] = useState({
    customer_name: '',
    job_number: '',
    address: '',
    phone_primary: '',
    phone_secondary: '',
    inspected_by: '',
    inspected_on: new Date().toISOString().split('T')[0],
    installer_name: '',
    installation_date: '',
    issue_to_inspect: '',
    material_installed: '',
    action_materials_labor_cost: '',
    send_original_installer_back: '',
    back_charge_installer: '',
    back_charge_date: '',
    payment_to_different_installer: '',
    time_to_resolve: '',
    resolution: '',
    materials_order_needs: '',
    customer_signature: '',
    worry_free_guarantee: false
  });

  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef(null);

  // Pre-fill from project/customer/sale data or initialData
  useEffect(() => {
    if (open) {
      if (initialData) {
        setForm({
          customer_name: initialData.customer_name || '',
          job_number: initialData.job_number || '',
          address: initialData.address || '',
          phone_primary: initialData.phone_primary || '',
          phone_secondary: initialData.phone_secondary || '',
          inspected_by: initialData.inspected_by || '',
          inspected_on: initialData.inspected_on || new Date().toISOString().split('T')[0],
          installer_name: initialData.installer_name || '',
          installation_date: initialData.installation_date || '',
          issue_to_inspect: initialData.issue_to_inspect || '',
          material_installed: initialData.material_installed || '',
          action_materials_labor_cost: initialData.action_materials_labor_cost || '',
          send_original_installer_back: initialData.send_original_installer_back || '',
          back_charge_installer: initialData.back_charge_installer || '',
          back_charge_date: initialData.back_charge_date || '',
          payment_to_different_installer: initialData.payment_to_different_installer || '',
          time_to_resolve: initialData.time_to_resolve || '',
          resolution: initialData.resolution || '',
          materials_order_needs: initialData.materials_order_needs || '',
          customer_signature: initialData.customer_signature || '',
          worry_free_guarantee: initialData.worry_free_guarantee || false
        });
      } else {
        setForm(f => ({
          ...f,
          customer_name: customer ? `${customer.first_name} ${customer.last_name}` : '',
          address: sale?.location_address || (customer ? [customer.address_line1, customer.city, customer.state].filter(Boolean).join(', ') : ''),
          phone_primary: customer?.phone || '',
          installation_date: project?.installation_date || '',
          job_number: sale?.invoice_number || '',
          inspected_by: currentUser?.full_name || ''
        }));
      }
    }
  }, [open, customer, project, sale, currentUser, initialData]);

  // Canvas setup
  useEffect(() => {
    if (!open) return;
    setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
    }, 100);
  }, [open]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const startDraw = (e) => {
    e.preventDefault();
    isDrawing.current = true;
    lastPos.current = getPos(e, canvasRef.current);
  };

  const draw = (e) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
  };

  const endDraw = () => { isDrawing.current = false; };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const buildPayload = () => {
    const canvas = canvasRef.current;
    const signature = canvas ? canvas.toDataURL('image/png') : '';
    const installerNames = installers.map(i => i.value).filter(Boolean);
    return { ...form, installers: installerNames, installer_name: installerNames[0] || '', customer_signature: signature, email_recipients: emailRecipients, images, files };
  };

  const handleSave = () => onSave(buildPayload(), true);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? 'Edit Inspection Report' : 'New Inspection Report'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Basic Info */}
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
              <Label>Phone Primary</Label>
              <Input value={form.phone_primary} onChange={e => set('phone_primary', e.target.value)} />
            </div>
            <div>
              <Label>Phone Secondary</Label>
              <Input value={form.phone_secondary} onChange={e => set('phone_secondary', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Inspected By</Label>
              <Input value={form.inspected_by} onChange={e => set('inspected_by', e.target.value)} />
            </div>
            <div>
              <Label>On (Date)</Label>
              <Input type="date" value={form.inspected_on} onChange={e => set('inspected_on', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InstallersList
              installers={installers}
              onChange={setInstallers}
              crews={crews}
              crewsLoading={crewsLoading}
            />
            <div>
              <Label>Installation Date</Label>
              <Input type="date" value={form.installation_date} onChange={e => set('installation_date', e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Issue to Inspect</Label>
            <Textarea rows={2} value={form.issue_to_inspect} onChange={e => set('issue_to_inspect', e.target.value)} />
          </div>
          <div>
            <Label>Material Installed</Label>
            <Textarea rows={2} value={form.material_installed} onChange={e => set('material_installed', e.target.value)} />
          </div>
          <div>
            <Label>Action / Materials / Labor Cost</Label>
            <Textarea rows={4} value={form.action_materials_labor_cost} onChange={e => set('action_materials_labor_cost', e.target.value)} />
          </div>

          {/* Send original installer back */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Send Original Installer Back?</Label>
              <Select value={form.send_original_installer_back} onValueChange={v => set('send_original_installer_back', v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Back Charge Date</Label>
              <Input type="date" value={form.back_charge_date} onChange={e => set('back_charge_date', e.target.value)} />
            </div>
          </div>
          <div>
            <Label>If not, back charge original installer to fix?</Label>
            <Input value={form.back_charge_installer} onChange={e => set('back_charge_installer', e.target.value)} />
          </div>
          <div>
            <Label>Suggested payment to send a different installer to fix</Label>
            <Input value={form.payment_to_different_installer} onChange={e => set('payment_to_different_installer', e.target.value)} />
          </div>
          <div>
            <Label>Suggested time required to resolve (days/hours)</Label>
            <Input value={form.time_to_resolve} onChange={e => set('time_to_resolve', e.target.value)} />
          </div>
          <div>
            <Label>Resolution</Label>
            <Textarea rows={3} value={form.resolution} onChange={e => set('resolution', e.target.value)} />
          </div>
          <div>
            <Label>Materials Order Needs</Label>
            <Textarea rows={3} placeholder="List any materials that need to be ordered..." value={form.materials_order_needs} onChange={e => set('materials_order_needs', e.target.value)} />
          </div>

          {/* Worry Free Guarantee */}
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <Checkbox
              id="worry_free_guarantee"
              checked={!!form.worry_free_guarantee}
              onCheckedChange={v => set('worry_free_guarantee', v)}
            />
            <Label htmlFor="worry_free_guarantee" className="cursor-pointer font-medium text-slate-700">
              Worry Free Guarantee Applicable
            </Label>
          </div>

          {/* Email Recipients */}
          <div>
            <Label>Send Report PDF To</Label>
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                {emailRecipients.map(email => (
                  <span key={email} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded-full">
                    {email}
                    <button type="button" onClick={() => removeEmail(email)} className="hover:text-red-500 transition-colors">
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

          {/* Images */}
          <div>
            <Label>Photos / Images</Label>
            <div className="mt-2 space-y-2">
              {images.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {images.map((url, i) => (
                    <div key={i} className="relative group rounded-lg overflow-hidden border border-slate-200">
                      <img src={url} alt={`Photo ${i + 1}`} className="w-full h-24 object-cover cursor-pointer hover:opacity-90" onClick={() => window.open(url, '_blank')} />
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
                <input type="file" accept="image/*" multiple onChange={handleImageUpload} disabled={uploadingImage} className="hidden" />
                {uploadingImage ? (
                  <><Loader2 className="w-4 h-4 text-indigo-600 animate-spin" /><span className="text-sm text-slate-600">Uploading...</span></>
                ) : (
                  <><Upload className="w-4 h-4 text-slate-400" /><span className="text-sm text-slate-600">Click to upload photos (select multiple)</span></>
                )}
              </label>
            </div>
          </div>

          {/* File Attachments */}
          <div>
            <Label>File Attachments</Label>
            <div className="mt-2 space-y-2">
              {files.length > 0 && (
                <div className="space-y-1">
                  {files.map((file, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200 group">
                      <Paperclip className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <span className="flex-1 text-sm text-slate-700 truncate">{file.name}</span>
                      <Button type="button" size="sm" variant="ghost" onClick={() => window.open(file.url, '_blank')} className="h-7 px-2">
                        <Download className="w-3 h-3" />
                      </Button>
                      <button type="button" onClick={() => removeFile(i)} className="text-red-400 hover:text-red-600 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className="flex items-center justify-center gap-2 w-full p-3 border-2 border-dashed border-slate-300 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors cursor-pointer">
                <input type="file" multiple onChange={handleFileUpload} disabled={uploadingFile} className="hidden" />
                {uploadingFile ? (
                  <><Loader2 className="w-4 h-4 text-indigo-600 animate-spin" /><span className="text-sm text-slate-600">Uploading...</span></>
                ) : (
                  <><Paperclip className="w-4 h-4 text-slate-400" /><span className="text-sm text-slate-600">Click to attach files (select multiple)</span></>
                )}
              </label>
            </div>
          </div>

          {/* Customer Signature */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Customer Signature</Label>
              <Button type="button" variant="ghost" size="sm" onClick={clearSignature} className="text-slate-500">
                <Eraser className="w-4 h-4 mr-1" /> Clear
              </Button>
            </div>
            <canvas
              ref={canvasRef}
              width={580}
              height={140}
              className="w-full border-2 border-dashed border-slate-300 rounded-lg bg-white touch-none cursor-crosshair"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
            <p className="text-xs text-slate-400 mt-1">Sign above using your mouse or finger</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(buildPayload(), false)} disabled={saving} variant="outline">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Draft'}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save & Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}