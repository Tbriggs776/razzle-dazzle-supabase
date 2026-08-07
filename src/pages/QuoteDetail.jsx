import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { 
  ArrowLeft, Loader2, FileText, DollarSign, Calendar, MapPin, User,
  Upload, CheckCircle2, Send, ExternalLink, Trophy, RefreshCw, Receipt
} from 'lucide-react';
import { generateReceiptPDF } from '@/utils/generateReceiptPDF';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import * as Bytescale from "@bytescale/sdk";

const STATUS_COLORS = {
  'Draft':     'bg-slate-100 text-slate-700 border-slate-200',
  'Sent':      'bg-blue-100 text-blue-800 border-blue-200',
  'Accepted':  'bg-green-100 text-green-800 border-green-200',
  'Rejected':  'bg-red-100 text-red-800 border-red-200',
  'Converted': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Expired':   'bg-orange-100 text-orange-800 border-orange-200',
};

function formatCurrency(val) {
  if (!val) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

export default function QuoteDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const quoteId = urlParams.get('id');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const contractFileInputRef = useRef(null);

  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [showSendDialog, setShowSendDialog] = useState(false);

  // Quote PDF upload
  const [uploadingQuotePdf, setUploadingQuotePdf] = useState(false);
  // Convert to sale state
  const [convertAmount, setConvertAmount] = useState('');
  const [contractFileUrl, setContractFileUrl] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositPaymentMethod, setDepositPaymentMethod] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [checkDate, setCheckDate] = useState('');
  const [installationDate, setInstallationDate] = useState('');
  const [convertNotes, setConvertNotes] = useState('');
  const [uploadingContract, setUploadingContract] = useState(false);
  const [sendingSending, setSendingSending] = useState(false);
  const [emailReceiptOnConvert, setEmailReceiptOnConvert] = useState(true);

  // Deposit / Receipt state (stored on quote itself)
  const [quoteDepositAmount, setQuoteDepositAmount] = useState('');
  const [quoteDepositMethod, setQuoteDepositMethod] = useState('');
  const [quoteCheckNumber, setQuoteCheckNumber] = useState('');
  const [quoteCheckDate, setQuoteCheckDate] = useState('');
  const [generatingReceipt, setGeneratingReceipt] = useState(false);
  const [savingDeposit, setSavingDeposit] = useState(false);

  // Pre-populate deposit fields when quote loads
  useEffect(() => {
    if (quote) {
      if (quote.deposit_amount) setQuoteDepositAmount(quote.deposit_amount.toString());
      if (quote.deposit_payment_method) setQuoteDepositMethod(quote.deposit_payment_method);
      if (quote.check_number) setQuoteCheckNumber(quote.check_number);
      if (quote.check_date) setQuoteCheckDate(quote.check_date);
    }
  }, [quote?.id]);

  const { data: quote, isLoading } = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: async () => {
      const list = await base44.entities.Quote.filter({ id: quoteId });
      return list[0] || null;
    },
    enabled: !!quoteId
  });

  const { data: lead } = useQuery({
    queryKey: ['lead', quote?.lead],
    queryFn: async () => {
      const list = await base44.entities.Lead.filter({ id: quote.lead });
      return list[0] || null;
    },
    enabled: !!quote?.lead
  });

  const { data: dc } = useQuery({
    queryKey: ['teamMember', quote?.assigned_dc],
    queryFn: async () => {
      const list = await base44.entities.TeamMember.filter({ id: quote.assigned_dc });
      return list[0] || null;
    },
    enabled: !!quote?.assigned_dc
  });

  const { data: appointment } = useQuery({
    queryKey: ['appointment', quote?.appointment],
    queryFn: async () => {
      const list = await base44.entities.Appointment.filter({ id: quote.appointment });
      return list[0] || null;
    },
    enabled: !!quote?.appointment
  });

  const { data: convertedSale } = useQuery({
    queryKey: ['sale', quote?.converted_sale_id],
    queryFn: async () => {
      const list = await base44.entities.Sale.filter({ id: quote.converted_sale_id });
      return list[0] || null;
    },
    enabled: !!quote?.converted_sale_id
  });

  // Update quote status / fields
  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.Quote.update(quoteId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quote', quoteId] })
  });

  // Upload quote PDF
  const handleUploadQuotePdf = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingQuotePdf(true);
    try {
      const uploadManager = new Bytescale.UploadManager({ apiKey: "public_223k2X95KYxtnQTr5pfZZakKp58x" });
      const { fileUrl } = await uploadManager.upload({ data: file });
      await updateMutation.mutateAsync({ quote_file_url: fileUrl });
    } catch (err) {
      alert('Failed to upload quote PDF');
    } finally {
      setUploadingQuotePdf(false);
    }
  };

  // Upload final contract PDF for conversion
  const handleUploadContract = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingContract(true);
    try {
      const uploadManager = new Bytescale.UploadManager({ apiKey: "public_223k2X95KYxtnQTr5pfZZakKp58x" });
      const { fileUrl } = await uploadManager.upload({ data: file });
      setContractFileUrl(fileUrl);
      // Try to extract amount from contract
      try {
        const { data } = await base44.functions.invoke('extractInvoiceTotal', { pdfUrl: fileUrl });
        if (data?.success && data?.total) setConvertAmount(data.total.toString());
      } catch {}
    } catch (err) {
      alert('Failed to upload contract');
    } finally {
      setUploadingContract(false);
    }
  };

  // Mark as Sent
  const handleMarkSent = async () => {
    setSendingSending(true);
    try {
      await updateMutation.mutateAsync({ status: 'Sent', sent_at: new Date().toISOString() });
      // Optionally send email notification here
      setShowSendDialog(false);
    } finally {
      setSendingSending(false);
    }
  };

  // Convert to Sale
  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!lead) throw new Error('Lead data not loaded');

      // Convert Lead → Customer
      const customer = await base44.entities.Customer.create({
        first_name: lead.first_name,
        last_name: lead.last_name,
        email: lead.email,
        phone: lead.phone,
        address_line1: lead.address_line1,
        address_line2: lead.address_line2,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
        notes: lead.notes,
        converted_from_lead: quote.lead
      });

      // Create Sale
      const sale = await base44.entities.Sale.create({
        appointment: quote.appointment,
        customer: customer.id,
        lead: quote.lead,
        assigned_dc: quote.assigned_dc,
        sale_date: new Date().toISOString(),
        contract_file_url: contractFileUrl,
        appointment_date: quote.appointment_date,
        appointment_block: quote.appointment_block,
        location_address: quote.location_address,
        sale_amount: convertAmount ? parseFloat(convertAmount) : undefined,
        deposit_amount: depositAmount ? parseFloat(depositAmount) : undefined,
        notes: convertNotes || undefined,
        deposit_payment_method: depositPaymentMethod || undefined,
        check_number: (depositPaymentMethod === 'Check' || depositPaymentMethod === 'Post-Dated Check') ? checkNumber : undefined,
        check_date: depositPaymentMethod === 'Post-Dated Check' ? checkDate : undefined,
        folder_photo_url: quote.folder_photo_url || undefined,
        yard_sign_photo_url: quote.yard_sign_photo_url || undefined,
        driver_license_photo_url: quote.driver_license_photo_url || undefined
      });

      // Create Project
      const projectStatus = installationDate ? 'Scheduled' : 'Accepted';
      const newProject = await base44.entities.Project.create({
        sale: sale.id,
        customer: customer.id,
        status: projectStatus,
        installation_date: installationDate || undefined
      });

      // Generate tracker URL
      try {
        const appUrl = await base44.functions.invoke('getAppUrl');
        const baseUrl = appUrl.data.url;
        const fullUrl = `${baseUrl}/CustomerProjectView?id=${newProject.id}`;
        let trackerUrl = fullUrl;
        try {
          const { data } = await base44.functions.invoke('shortenUrl', { originalURL: fullUrl });
          if (data?.shortURL) trackerUrl = data.shortURL;
        } catch {}
        await base44.entities.Project.update(newProject.id, { project_tracker_url: trackerUrl });
      } catch {}

      // Update appointment to Sold if linked
      if (quote.appointment) {
        await base44.entities.Appointment.update(quote.appointment, { status: 'Sold' });
      }

      // Mark quote as converted
      await base44.entities.Quote.update(quoteId, {
        status: 'Converted',
        converted_sale_id: sale.id
      });

      // Send confirmation notifications (non-blocking)
      try {
        const notifCalls = [
          base44.functions.invoke('sendNotificationEmail', { type: 'sale_confirmed', entityId: sale.id, appUrl: window.location.origin }).catch(() => {}),
          base44.functions.invoke('sendNotificationEmail', { type: 'project_created', entityId: newProject.id, appUrl: window.location.origin }).catch(() => {})
        ];
        if (quote.appointment) {
          notifCalls.push(base44.functions.invoke('sendAppointmentSMS', { appointmentId: quote.appointment, customerId: customer.id, type: 'customer_sale_confirmation' }).catch(() => {}));
        }
        await Promise.all(notifCalls);
      } catch {}

      // Email receipt to customer if requested and deposit info present
      if (emailReceiptOnConvert && depositAmount && depositPaymentMethod && lead?.email) {
        base44.functions.invoke('sendReceiptEmail', {
          quoteId,
          leadEmail: lead.email,
          leadName: `${lead.first_name} ${lead.last_name}`,
          leadPhone: lead.phone || '',
          leadAddress: [lead.address_line1, lead.city, lead.state, lead.zip].filter(Boolean).join(', '),
          dcName: dc ? `${dc.first_name} ${dc.last_name}` : '',
          depositAmount: parseFloat(depositAmount),
          depositPaymentMethod,
          checkNumber: (depositPaymentMethod === 'Check' || depositPaymentMethod === 'Post-Dated Check') ? checkNumber : '',
          checkDate: depositPaymentMethod === 'Post-Dated Check' ? checkDate : '',
          quoteAmount: convertAmount ? parseFloat(convertAmount) : null,
          locationAddress: quote.location_address || '',
          receiptNumber: `R-${quoteId.slice(-6).toUpperCase()}`
        }).catch(() => {});
      }

      return sale.id;
    },
    onSuccess: (saleId) => {
      queryClient.invalidateQueries({ queryKey: ['quote', quoteId] });
      setShowConvertDialog(false);
      navigate(createPageUrl('SaleDetail') + `?id=${saleId}`);
    },
    onError: (err) => alert('Failed to convert quote: ' + err.message)
  });

  // Save deposit info to quote
  const handleSaveDeposit = async () => {
    setSavingDeposit(true);
    try {
      await updateMutation.mutateAsync({
        deposit_amount: quoteDepositAmount ? parseFloat(quoteDepositAmount) : undefined,
        deposit_payment_method: quoteDepositMethod || undefined,
        check_number: (quoteDepositMethod === 'Check' || quoteDepositMethod === 'Post-Dated Check') ? quoteCheckNumber : undefined,
        check_date: quoteDepositMethod === 'Post-Dated Check' ? quoteCheckDate : undefined,
      });
    } finally {
      setSavingDeposit(false);
    }
  };

  // Generate receipt PDF and upload it, then save URL
  const handleGenerateReceipt = async () => {
    if (!quoteDepositAmount || !quoteDepositMethod) {
      alert('Please enter a deposit amount and payment method first.');
      return;
    }
    setGeneratingReceipt(true);
    try {
      // Save deposit fields first
      await handleSaveDeposit();

      // Generate PDF
      const doc = generateReceiptPDF({
        quote,
        lead,
        dc,
        depositAmount: quoteDepositAmount,
        depositPaymentMethod: quoteDepositMethod,
        checkNumber: quoteCheckNumber,
        checkDate: quoteCheckDate,
        receiptNumber: `R-${quoteId.slice(-6).toUpperCase()}`
      });

      // Convert to Blob and upload
      const pdfBlob = doc.output('blob');
      const file = new File([pdfBlob], `receipt-${quoteId.slice(-6)}.pdf`, { type: 'application/pdf' });
      const uploadManager = new Bytescale.UploadManager({ apiKey: "public_223k2X95KYxtnQTr5pfZZakKp58x" });
      const { fileUrl } = await uploadManager.upload({ data: file });

      // Save receipt URL to quote
      await updateMutation.mutateAsync({ receipt_file_url: fileUrl });

      // Also trigger browser download
      doc.save(`receipt-${lead?.last_name || 'customer'}-${new Date().toLocaleDateString('en-US').replace(/\//g, '-')}.pdf`);
    } catch (err) {
      alert('Failed to generate receipt: ' + err.message);
    } finally {
      setGeneratingReceipt(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Quote not found</h2>
          <Link to={createPageUrl('MyQuotes')} className="text-indigo-600 hover:underline">Back to Quotes</Link>
        </div>
      </div>
    );
  }

  const leadName = lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown Customer';
  const isConverted = quote.status === 'Converted';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <Link to={createPageUrl('MyQuotes')} className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors mb-6">
            <ArrowLeft className="w-4 h-4" />
            Back to Quotes
          </Link>
          <div className="flex flex-col md:flex-row md:items-start gap-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
              <FileText className="w-8 h-8" />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-slate-800">{leadName}</h1>
              <div className="flex flex-wrap gap-2 mt-3">
                <Badge variant="secondary" className={cn('border', STATUS_COLORS[quote.status])}>
                  {quote.status}
                </Badge>
                {isConverted && (
                  <Link to={createPageUrl('SaleDetail') + `?id=${quote.converted_sale_id}`}>
                    <Badge variant="secondary" className="border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 cursor-pointer">
                      View Sale Record →
                    </Badge>
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          {!isConverted && (
            <div className="flex flex-wrap gap-3 mt-6">
              {quote.quote_file_url && quote.status === 'Draft' && (
                <Button
                  onClick={() => setShowSendDialog(true)}
                  className="bg-blue-600 hover:bg-blue-700 h-10"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Mark as Sent to Customer
                </Button>
              )}
              {['Draft', 'Sent', 'Accepted'].includes(quote.status) && (
                <Button
                  onClick={() => {
                    setConvertAmount(quote.quote_amount?.toString() || '');
                    setInstallationDate('');
                    // Pre-fill deposit from saved quote deposit info
                    if (quote.deposit_amount) setDepositAmount(quote.deposit_amount.toString());
                    if (quote.deposit_payment_method) setDepositPaymentMethod(quote.deposit_payment_method);
                    if (quote.check_number) setCheckNumber(quote.check_number);
                    if (quote.check_date) setCheckDate(quote.check_date);
                    setShowConvertDialog(true);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 h-10"
                >
                  <Trophy className="w-4 h-4 mr-2" />
                  Convert to Sale
                </Button>
              )}
              {['Draft', 'Sent'].includes(quote.status) && (
                <>
                  <Button variant="outline" onClick={() => updateMutation.mutate({ status: 'Accepted' })} className="border-green-200 text-green-700 h-10">
                    Mark Accepted
                  </Button>
                  <Button variant="outline" onClick={() => updateMutation.mutate({ status: 'Rejected' })} className="border-red-200 text-red-600 h-10">
                    Mark Rejected
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Quote Details */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">Quote Details</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Quoted Amount</p>
                  <p className="font-semibold text-slate-800 text-lg">{formatCurrency(quote.quote_amount)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Quote Date</p>
                  <p className="text-slate-700">{quote.quote_date ? format(new Date(quote.quote_date), 'MMM d, yyyy') : '—'}</p>
                </div>
              </div>
              {quote.expiration_date && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Expiration Date</p>
                    <p className="text-slate-700">{format(new Date(quote.expiration_date + 'T00:00:00'), 'MMM d, yyyy')}</p>
                  </div>
                </div>
              )}
              {quote.location_address && (
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Location</p>
                    <p className="text-slate-700">{quote.location_address}</p>
                  </div>
                </div>
              )}
              {dc && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                    <User className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Design Consultant</p>
                    <p className="text-slate-700">{dc.first_name} {dc.last_name}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Customer Info */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">Customer</h2>
            {lead ? (
              <div className="space-y-3">
                <p className="font-semibold text-slate-800 text-lg">{leadName}</p>
                {lead.email && <p className="text-sm text-slate-600">{lead.email}</p>}
                {lead.phone && <p className="text-sm text-slate-600">{lead.phone}</p>}
                {lead.address_line1 && (
                  <p className="text-sm text-slate-500">{lead.address_line1}{lead.city ? `, ${lead.city}` : ''}{lead.state ? `, ${lead.state}` : ''}</p>
                )}
              </div>
            ) : (
              <p className="text-slate-400">Loading...</p>
            )}
          </div>

          {/* Quote PDF */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">Quote Document</h2>
            {quote.quote_file_url ? (
              <div className="flex items-center gap-4 p-4 rounded-xl bg-green-50 border border-green-200">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
                <div className="flex-1">
                  <p className="font-medium text-green-800">Quote PDF Uploaded</p>
                  {quote.sent_at && (
                    <p className="text-xs text-green-600 mt-0.5">Sent on {format(new Date(quote.sent_at), 'MMM d, yyyy h:mm a')}</p>
                  )}
                </div>
                <a href={quote.quote_file_url} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="border-green-300 text-green-700">
                    <ExternalLink className="w-4 h-4 mr-1" /> View PDF
                  </Button>
                </a>
                {!isConverted && (
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="border-slate-200">
                    <RefreshCw className="w-4 h-4 mr-1" /> Replace
                  </Button>
                )}
              </div>
            ) : (
              !isConverted && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                >
                  {uploadingQuotePdf ? (
                    <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-slate-400 mb-2" />
                      <p className="text-sm text-slate-500">Upload Quote PDF</p>
                    </>
                  )}
                </div>
              )
            )}
            <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleUploadQuotePdf} className="hidden" />
          </div>

          {/* Deposit & Receipt */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Deposit & Receipt</h2>
              {quote.receipt_file_url && (
                <a href={quote.receipt_file_url} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="border-violet-200 text-violet-700">
                    <ExternalLink className="w-4 h-4 mr-1" /> View Receipt PDF
                  </Button>
                </a>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Deposit Amount */}
              <div className="space-y-2">
                <Label>Deposit Amount</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={quoteDepositAmount}
                    onChange={e => setQuoteDepositAmount(e.target.value)}
                    className="pl-7"
                    disabled={isConverted}
                  />
                </div>
              </div>

              {/* Payment Method */}
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={quoteDepositMethod} onValueChange={v => { setQuoteDepositMethod(v); setQuoteCheckNumber(''); setQuoteCheckDate(''); }} disabled={isConverted}>
                  <SelectTrigger><SelectValue placeholder="Select method..." /></SelectTrigger>
                  <SelectContent>
                    {['Check','Post-Dated Check','Credit Card','Financing - Synchrony','Financing - MOMNT','Cash','Wire','Zelle','Customer Payment Drop Off'].map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(quoteDepositMethod === 'Check' || quoteDepositMethod === 'Post-Dated Check') && (
                <div className="space-y-2">
                  <Label>Check Number</Label>
                  <Input value={quoteCheckNumber} onChange={e => setQuoteCheckNumber(e.target.value)} placeholder="Check #" disabled={isConverted} />
                </div>
              )}

              {quoteDepositMethod === 'Post-Dated Check' && (
                <div className="space-y-2">
                  <Label>Check Date</Label>
                  <Input type="date" value={quoteCheckDate} onChange={e => setQuoteCheckDate(e.target.value)} disabled={isConverted} />
                </div>
              )}
            </div>

            {!isConverted && (
              <div className="flex gap-3 mt-5">
                <Button
                  variant="outline"
                  onClick={handleSaveDeposit}
                  disabled={savingDeposit}
                  className="border-slate-200"
                >
                  {savingDeposit ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Deposit Info'}
                </Button>
                <Button
                  onClick={handleGenerateReceipt}
                  disabled={generatingReceipt || !quoteDepositAmount || !quoteDepositMethod}
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  {generatingReceipt ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
                  ) : (
                    <><Receipt className="w-4 h-4 mr-2" />{quote.receipt_file_url ? 'Regenerate Receipt PDF' : 'Generate Receipt PDF'}</>
                  )}
                </Button>
              </div>
            )}

            {quote.receipt_file_url && (
              <div className="mt-4 flex items-center gap-3 p-3 rounded-xl bg-violet-50 border border-violet-200">
                <CheckCircle2 className="w-5 h-5 text-violet-600 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-violet-800">Receipt PDF Generated</p>
                  <p className="text-xs text-violet-600">Send this along with the quote PDF to the customer.</p>
                </div>
                <a href={quote.receipt_file_url} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="border-violet-300 text-violet-700">
                    <ExternalLink className="w-4 h-4 mr-1" /> Open
                  </Button>
                </a>
              </div>
            )}
          </div>

          {/* Notes */}
          {quote.notes && (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2">
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">Notes</h2>
              <p className="text-slate-700 whitespace-pre-wrap">{quote.notes}</p>
            </div>
          )}

          {/* Appointment Link */}
          {quote.appointment && (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2 flex items-center justify-between">
              <p className="text-sm text-slate-600">Created from appointment</p>
              <Link to={createPageUrl('AppointmentDetail') + `?id=${quote.appointment}`}>
                <Button variant="outline" size="sm" className="border-indigo-200 text-indigo-600">
                  View Appointment →
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Mark Sent Dialog */}
      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Quote as Sent</DialogTitle>
            <DialogDescription>This will update the quote status to "Sent" to the customer.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendDialog(false)}>Cancel</Button>
            <Button onClick={handleMarkSent} disabled={sendingSending} className="bg-blue-600 hover:bg-blue-700">
              {sendingSending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Confirm Sent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to Sale Dialog */}
      <Dialog open={showConvertDialog} onOpenChange={setShowConvertDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-emerald-600" />
              Convert Quote to Sale
            </DialogTitle>
            <DialogDescription>
              Review and finalize the deal details before converting this quote into a sale and project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Final Contract Upload */}
            <div className="space-y-2">
              <Label>Final Signed Contract PDF *</Label>
              <input ref={contractFileInputRef} type="file" accept=".pdf" onChange={handleUploadContract} className="hidden" />
              {contractFileUrl ? (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <span className="text-sm text-green-800 flex-1">Contract uploaded</span>
                  <Button variant="outline" size="sm" onClick={() => contractFileInputRef.current?.click()}>Replace</Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => contractFileInputRef.current?.click()}
                  disabled={uploadingContract}
                  className="w-full h-16 border-dashed"
                >
                  {uploadingContract ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading...</> : <><Upload className="w-4 h-4 mr-2" />Upload Final Contract</>}
                </Button>
              )}
            </div>

            {/* Sale Amount */}
            <div className="space-y-2">
              <Label>Sale Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={convertAmount}
                  onChange={e => setConvertAmount(e.target.value)}
                  className="pl-7"
                />
              </div>
            </div>

            {/* Deposit Method */}
            <div className="space-y-2">
              <Label>Deposit Payment Method</Label>
              <Select value={depositPaymentMethod} onValueChange={v => { setDepositPaymentMethod(v); setCheckNumber(''); setCheckDate(''); }}>
                <SelectTrigger><SelectValue placeholder="Select method..." /></SelectTrigger>
                <SelectContent>
                  {['Check','Post-Dated Check','Credit Card','Financing - Synchrony','Financing - MOMNT','Cash','Wire','Zelle','Customer Payment Drop Off'].map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(depositPaymentMethod === 'Check' || depositPaymentMethod === 'Post-Dated Check') && (
              <div className="space-y-2">
                <Label>Check Number</Label>
                <Input value={checkNumber} onChange={e => setCheckNumber(e.target.value)} placeholder="Check #" />
              </div>
            )}

            {depositPaymentMethod === 'Post-Dated Check' && (
              <div className="space-y-2">
                <Label>Check Date</Label>
                <Input type="date" value={checkDate} onChange={e => setCheckDate(e.target.value)} />
              </div>
            )}

            {depositPaymentMethod && (
              <div className="space-y-2">
                <Label>Deposit Amount</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={depositAmount}
                    onChange={e => setDepositAmount(e.target.value)}
                    className="pl-7"
                  />
                </div>
              </div>
            )}

            {/* Installation Date */}
            <div className="space-y-2">
              <Label>Installation Date (optional)</Label>
              <Input type="date" value={installationDate} onChange={e => setInstallationDate(e.target.value)} />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea rows={3} value={convertNotes} onChange={e => setConvertNotes(e.target.value)} placeholder="Any additional notes..." />
            </div>

            {/* Email Receipt */}
            {depositAmount && depositPaymentMethod && lead?.email && (
              <label className="flex items-center gap-3 p-3 rounded-lg border border-violet-200 bg-violet-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={emailReceiptOnConvert}
                  onChange={e => setEmailReceiptOnConvert(e.target.checked)}
                  className="rounded"
                />
                <div>
                  <p className="text-sm font-medium text-violet-900">Email deposit receipt to customer</p>
                  <p className="text-xs text-violet-600">PDF receipt will be sent to {lead.email}</p>
                </div>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConvertDialog(false)}>Cancel</Button>
            <Button
              onClick={() => convertMutation.mutate()}
              disabled={convertMutation.isPending || !contractFileUrl}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {convertMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Converting...</>
              ) : (
                <><Trophy className="w-4 h-4 mr-2" />Convert to Sale</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}