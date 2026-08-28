import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft, Loader2, FileText, Calendar, MapPin, User,
  Upload, CheckCircle2, Send, ExternalLink, Trophy, RefreshCw, Receipt
} from 'lucide-react';
import { generateReceiptPDF } from '@/utils/generateReceiptPDF';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useSignedUrl } from '@/lib/fileUrl';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import WorkRow from '@/components/dashboard/WorkRow';

// Domain quote status → StatusPill tone.
const STATUS_TONE = {
  Draft: 'neutral',
  Sent: 'info',
  Accepted: 'good',
  Converted: 'good',
  Rejected: 'crit',
  Expired: 'crit',
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

  const { data: quote, isLoading } = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: async () => {
      const list = await base44.entities.Quote.filter({ id: quoteId });
      return list[0] || null;
    },
    enabled: !!quoteId
  });

  // Pre-populate deposit fields when quote loads (must come AFTER `quote` is declared —
  // referencing it in the deps above would be a temporal-dead-zone ReferenceError).
  useEffect(() => {
    if (quote) {
      if (quote.deposit_amount) setQuoteDepositAmount(quote.deposit_amount.toString());
      if (quote.deposit_payment_method) setQuoteDepositMethod(quote.deposit_payment_method);
      if (quote.check_number) setQuoteCheckNumber(quote.check_number);
      if (quote.check_date) setQuoteCheckDate(quote.check_date);
    }
  }, [quote?.id]);

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

  // Signed URLs for uploaded PDFs (uploads bucket is private)
  const signedQuoteFileUrl = useSignedUrl(quote?.quote_file_url);
  const signedReceiptFileUrl = useSignedUrl(quote?.receipt_file_url);

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
      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      await updateMutation.mutateAsync({ quote_file_url: fileUrl });
    } catch (err) {
      toast.error('Failed to upload quote PDF');
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
      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      setContractFileUrl(fileUrl);
      // Try to extract amount from contract
      try {
        const { data } = await base44.functions.invoke('extractInvoiceTotal', { pdfUrl: fileUrl });
        if (data?.success && data?.total) setConvertAmount(data.total.toString());
      } catch {}
    } catch (err) {
      toast.error('Failed to upload contract');
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

      // Atomic + idempotent conversion: customer + sale + project created, the linked
      // appointment flipped to 'Sold', and the quote marked Converted in ONE transaction
      // (convert_to_sale RPC). A retry returns the existing sale instead of double-creating.
      const { data: conv, error: convErr } = await base44.functions.invoke('convertToSale', {
        quoteId,
        appointmentId: quote.appointment || null,
        customer: {
          first_name: lead.first_name, last_name: lead.last_name, email: lead.email, phone: lead.phone,
          address_line1: lead.address_line1, address_line2: lead.address_line2, city: lead.city,
          state: lead.state, zip: lead.zip, notes: lead.notes, converted_from_lead: quote.lead,
        },
        sale: {
          appointment: quote.appointment,
          lead: quote.lead,
          assigned_dc: quote.assigned_dc,
          sale_date: new Date().toISOString(),
          contract_file_url: contractFileUrl,
          appointment_date: quote.appointment_date,
          appointment_block: quote.appointment_block,
          location_address: quote.location_address,
          sale_amount: convertAmount ? parseFloat(convertAmount) : null,
          deposit_amount: depositAmount ? parseFloat(depositAmount) : null,
          notes: convertNotes || null,
          deposit_payment_method: depositPaymentMethod || null,
          check_number: (depositPaymentMethod === 'Check' || depositPaymentMethod === 'Post-Dated Check') ? checkNumber : null,
          check_date: depositPaymentMethod === 'Post-Dated Check' ? checkDate : null,
          folder_photo_url: quote.folder_photo_url || null,
          yard_sign_photo_url: quote.yard_sign_photo_url || null,
          driver_license_photo_url: quote.driver_license_photo_url || null,
        },
        project: {
          status: installationDate ? 'Scheduled' : 'Accepted',
          installation_date: installationDate || null,
        },
      });
      if (convErr || !conv?.sale_id) {
        throw new Error(convErr?.message || 'Failed to convert the quote. Nothing was saved — please try again.');
      }
      // Light id-holders so the best-effort steps below read unchanged.
      const sale = { id: conv.sale_id };
      const newProject = { id: conv.project_id };
      const customer = { id: conv.customer_id };

      // Generate tracker URL (best-effort, after the sale is committed)
      try {
        const appUrl = await base44.functions.invoke('getAppUrl');
        const baseUrl = appUrl.data.url;
        // CustomerProjectView is anon → link by the unguessable public_token (NO4).
        const proj = await base44.entities.Project.get(newProject.id);
        const fullUrl = `${baseUrl}/CustomerProjectView?id=${proj?.public_token || newProject.id}`;
        let trackerUrl = fullUrl;
        try {
          const { data } = await base44.functions.invoke('shortenUrl', { originalURL: fullUrl });
          if (data?.shortURL) trackerUrl = data.shortURL;
        } catch {}
        await base44.entities.Project.update(newProject.id, { project_tracker_url: trackerUrl });
      } catch {}

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
    onError: (err) => toast.error('Failed to convert quote: ' + err.message)
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
      toast.error('Please enter a deposit amount and payment method first.');
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
      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });

      // Save receipt URL to quote
      await updateMutation.mutateAsync({ receipt_file_url: fileUrl });

      // Also trigger browser download
      doc.save(`receipt-${lead?.last_name || 'customer'}-${new Date().toLocaleDateString('en-US').replace(/\//g, '-')}.pdf`);
    } catch (err) {
      toast.error('Failed to generate receipt: ' + err.message);
    } finally {
      setGeneratingReceipt(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center">
          <h2 className="mb-2 text-xl font-semibold text-foreground">Quote not found</h2>
          <Link to={createPageUrl('MyQuotes')} className="text-primary hover:underline">Back to Quotes</Link>
        </div>
      </div>
    );
  }

  const leadName = lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown Customer';
  const isConverted = quote.status === 'Converted';
  const statusTone = STATUS_TONE[quote.status] || 'neutral';

  const detailRows = [
    {
      label: 'Quote Date',
      value: quote.quote_date ? format(new Date(quote.quote_date), 'MMM d, yyyy') : '—',
      Icon: Calendar,
    },
    quote.expiration_date && {
      label: 'Expiration Date',
      value: format(new Date(quote.expiration_date + 'T00:00:00'), 'MMM d, yyyy'),
      Icon: Calendar,
    },
    quote.location_address && {
      label: 'Location',
      value: quote.location_address,
      Icon: MapPin,
    },
    dc && {
      label: 'Design Consultant',
      value: `${dc.first_name} ${dc.last_name}`,
      Icon: User,
    },
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          eyebrow={
            <Link
              to={createPageUrl('MyQuotes')}
              className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Quotes
            </Link>
          }
          title={leadName}
          actions={
            !isConverted && (
              <>
                {quote.quote_file_url && quote.status === 'Draft' && (
                  <Button variant="outline" onClick={() => setShowSendDialog(true)}>
                    <Send className="mr-2 h-4 w-4" />
                    Mark as Sent
                  </Button>
                )}
                {['Draft', 'Sent'].includes(quote.status) && (
                  <>
                    <Button variant="outline" onClick={() => updateMutation.mutate({ status: 'Accepted' })} className="text-good">
                      Mark Accepted
                    </Button>
                    <Button variant="outline" onClick={() => updateMutation.mutate({ status: 'Rejected' })} className="text-crit">
                      Mark Rejected
                    </Button>
                  </>
                )}
                {['Draft', 'Sent', 'Accepted'].includes(quote.status) && (
                  <Button
                    variant="accent"
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
                  >
                    <Trophy className="mr-2 h-4 w-4" />
                    Convert to Sale
                  </Button>
                )}
              </>
            )
          }
        >
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill tone={statusTone} dot>{quote.status}</StatusPill>
          </div>
        </PageHeader>

        {/* Headline metrics */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile
            label="Quote Amount"
            value={formatCurrency(quote.quote_amount)}
            hero
            foot={quote.quote_date ? `Quoted ${format(new Date(quote.quote_date), 'MMM d, yyyy')}` : 'Headline quote value'}
          />
          <KpiTile
            label="Deposit"
            value={formatCurrency(quote.deposit_amount)}
            foot={quote.deposit_payment_method || 'No deposit recorded'}
          />
          <KpiTile
            label="Expiration"
            value={quote.expiration_date ? format(new Date(quote.expiration_date + 'T00:00:00'), 'MMM d, yyyy') : '—'}
            foot={quote.status === 'Expired' ? 'Quote expired' : 'Valid until'}
          />
        </div>

        {/* Details + Customer */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ModuleCard title="Quote Details" icon={FileText}>
            {detailRows.map((row) => (
              <div key={row.label} className="flex items-center gap-3 px-4 py-3">
                <row.Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className="ml-auto text-right text-sm font-medium text-foreground">{row.value}</span>
              </div>
            ))}
          </ModuleCard>

          <ModuleCard title="Customer" icon={User}>
            {lead ? (
              <div className="space-y-1.5 px-4 py-4">
                <p className="text-sm font-semibold text-foreground">{leadName}</p>
                {lead.email && <p className="text-sm text-muted-foreground">{lead.email}</p>}
                {lead.phone && <p className="text-sm text-muted-foreground">{lead.phone}</p>}
                {lead.address_line1 && (
                  <p className="text-sm text-muted-foreground">
                    {lead.address_line1}{lead.city ? `, ${lead.city}` : ''}{lead.state ? `, ${lead.state}` : ''}
                  </p>
                )}
              </div>
            ) : (
              <div className="px-4 py-4 text-sm text-muted-foreground">Loading...</div>
            )}
          </ModuleCard>
        </div>

        {/* Quote Document */}
        <ModuleCard title="Quote Document" icon={FileText}>
          <div className="p-4">
            {quote.quote_file_url ? (
              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-good/25 bg-good/10 p-4">
                <CheckCircle2 className="h-6 w-6 text-good" />
                <div className="flex-1">
                  <p className="font-medium text-good">Quote PDF Uploaded</p>
                  {quote.sent_at && (
                    <p className="mt-0.5 text-xs text-good/80">Sent on {format(new Date(quote.sent_at), 'MMM d, yyyy h:mm a')}</p>
                  )}
                </div>
                <a href={signedQuoteFileUrl || undefined} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">
                    <ExternalLink className="mr-1 h-4 w-4" /> View PDF
                  </Button>
                </a>
                {!isConverted && (
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <RefreshCw className="mr-1 h-4 w-4" /> Replace
                  </Button>
                )}
              </div>
            ) : (
              !isConverted && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  {uploadingQuotePdf ? (
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  ) : (
                    <>
                      <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Upload Quote PDF</p>
                    </>
                  )}
                </div>
              )
            )}
            <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleUploadQuotePdf} className="hidden" />
          </div>
        </ModuleCard>

        {/* Deposit & Receipt */}
        <ModuleCard
          title="Deposit & Receipt"
          icon={Receipt}
          action={
            quote.receipt_file_url && (
              <a href={signedReceiptFileUrl || undefined} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="text-primary">
                  <ExternalLink className="mr-1 h-4 w-4" /> View Receipt PDF
                </Button>
              </a>
            )
          }
        >
          <div className="p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Deposit Amount */}
              <div className="space-y-2">
                <Label>Deposit Amount</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
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
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={handleSaveDeposit}
                  disabled={savingDeposit}
                >
                  {savingDeposit ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Save Deposit Info'}
                </Button>
                <Button
                  onClick={handleGenerateReceipt}
                  disabled={generatingReceipt || !quoteDepositAmount || !quoteDepositMethod}
                >
                  {generatingReceipt ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</>
                  ) : (
                    <><Receipt className="mr-2 h-4 w-4" />{quote.receipt_file_url ? 'Regenerate Receipt PDF' : 'Generate Receipt PDF'}</>
                  )}
                </Button>
              </div>
            )}

            {quote.receipt_file_url && (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/10 p-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-primary">Receipt PDF Generated</p>
                  <p className="text-xs text-muted-foreground">Send this along with the quote PDF to the customer.</p>
                </div>
                <a href={signedReceiptFileUrl || undefined} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="text-primary">
                    <ExternalLink className="mr-1 h-4 w-4" /> Open
                  </Button>
                </a>
              </div>
            )}
          </div>
        </ModuleCard>

        {/* Notes */}
        {quote.notes && (
          <ModuleCard title="Notes" icon={FileText}>
            <div className="p-4">
              <p className="whitespace-pre-wrap text-sm text-foreground">{quote.notes}</p>
            </div>
          </ModuleCard>
        )}

        {/* Related records */}
        {(quote.appointment || (isConverted && quote.converted_sale_id)) && (
          <ModuleCard title="Related" icon={FileText}>
            {isConverted && quote.converted_sale_id && (
              <WorkRow
                lead={convertedSale?.sale_amount ? formatCurrency(convertedSale.sale_amount) : undefined}
                primary="Sale Record"
                meta="Converted from this quote"
                status="Converted"
                tone="good"
                onClick={() => navigate(createPageUrl('SaleDetail') + `?id=${quote.converted_sale_id}`)}
              />
            )}
            {quote.appointment && (
              <WorkRow
                primary="Source Appointment"
                meta="Created from appointment"
                trailing={<span className="text-sm text-muted-foreground">View →</span>}
                onClick={() => navigate(createPageUrl('AppointmentDetail') + `?id=${quote.appointment}`)}
              />
            )}
          </ModuleCard>
        )}
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
            <Button onClick={handleMarkSent} disabled={sendingSending}>
              {sendingSending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Confirm Sent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to Sale Dialog */}
      <Dialog open={showConvertDialog} onOpenChange={setShowConvertDialog}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-brand-pink" />
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
                <div className="flex items-center gap-3 rounded-lg border border-good/25 bg-good/10 p-3">
                  <CheckCircle2 className="h-5 w-5 text-good" />
                  <span className="flex-1 text-sm text-good">Contract uploaded</span>
                  <Button variant="outline" size="sm" onClick={() => contractFileInputRef.current?.click()}>Replace</Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => contractFileInputRef.current?.click()}
                  disabled={uploadingContract}
                  className="h-16 w-full border-dashed"
                >
                  {uploadingContract ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading...</> : <><Upload className="mr-2 h-4 w-4" />Upload Final Contract</>}
                </Button>
              )}
            </div>

            {/* Sale Amount */}
            <div className="space-y-2">
              <Label>Sale Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
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
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
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
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-primary/20 bg-primary/10 p-3">
                <input
                  type="checkbox"
                  checked={emailReceiptOnConvert}
                  onChange={e => setEmailReceiptOnConvert(e.target.checked)}
                  className="rounded"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">Email deposit receipt to customer</p>
                  <p className="text-xs text-muted-foreground">PDF receipt will be sent to {lead.email}</p>
                </div>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConvertDialog(false)}>Cancel</Button>
            <Button
              variant="accent"
              onClick={() => convertMutation.mutate()}
              disabled={convertMutation.isPending || !contractFileUrl}
            >
              {convertMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Converting...</>
              ) : (
                <><Trophy className="mr-2 h-4 w-4" />Convert to Sale</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
