import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { SignedImage, resolveFileUrl } from '@/lib/fileUrl';
import { cn } from '@/lib/utils';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  User,
  Mail,
  Phone,
  Loader2,
  FileText,
  DollarSign,
  Download,
  Edit,
  X,
  ClipboardCheck,
  Eye,
  Plus,
  Send,
  Upload,
  RefreshCw,
  IdCard,
  Image as ImageIcon,
  Boxes
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import SyncBadge from '@/components/common/SyncBadge';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import WorkRow from '@/components/dashboard/WorkRow';
import CostBreakdownModal from '@/components/sales/CostBreakdownModal';
import { buildCatalogCostMap, computeCatalogGP } from '@/lib/catalogCost';

const money = (n) =>
  '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Presentational labeled field used inside the info ModuleCards. Renders as a Link, an
// anchor, or a static div depending on which target is supplied so navigation stays intact.
function DetailField({ icon: Icon, label, children, to, href, className }) {
  const interactive = !!(to || href);
  const cls = cn(
    'flex items-center gap-3 rounded-lg px-3 py-2.5',
    interactive && 'group transition-colors hover:bg-muted/60',
    className
  );
  const inner = (
    <>
      {Icon && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-sm text-foreground">{children}</div>
      </div>
    </>
  );
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  if (href) return <a href={href} className={cls}>{inner}</a>;
  return <div className={cls}>{inner}</div>;
}

export default function SaleDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const saleId = urlParams.get('id');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [editAmount, setEditAmount] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSaleDate, setEditSaleDate] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [fetchingRFMS, setFetchingRFMS] = useState(false);
  const [sendingGPAlert, setSendingGPAlert] = useState(false);
  const [showReplaceContractDialog, setShowReplaceContractDialog] = useState(false);
  const [uploadingNewContract, setUploadingNewContract] = useState(false);
  const [newContractFileUrl, setNewContractFileUrl] = useState('');
  const [extractingNewAmount, setExtractingNewAmount] = useState(false);
  const newContractInputRef = React.useRef(null);
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);
  const [costBreakdownData, setCostBreakdownData] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payReference, setPayReference] = useState('');
  const [payKind, setPayKind] = useState('final');
  const [payNote, setPayNote] = useState('');
  // Minted once per open dialog so a double submit is the same payment, not two.
  const [payIdemKey, setPayIdemKey] = useState('');

  const { data: sale, isLoading } = useQuery({
    queryKey: ['sale', saleId],
    queryFn: async () => {
      const sales = await base44.entities.Sale.filter({ id: saleId });
      return sales[0];
    },
    enabled: !!saleId
  });

  const { data: customer } = useQuery({
    queryKey: ['customer', sale?.customer],
    queryFn: async () => {
      const customers = await base44.entities.Customer.filter({ id: sale.customer });
      return customers[0];
    },
    enabled: !!sale?.customer
  });

  const { data: consultant } = useQuery({
    queryKey: ['consultant', sale?.assigned_dc],
    queryFn: async () => {
      const consultants = await base44.entities.TeamMember.filter({ id: sale.assigned_dc });
      return consultants[0];
    },
    enabled: !!sale?.assigned_dc
  });

  const { data: project } = useQuery({
    queryKey: ['project', sale?.id],
    queryFn: async () => {
      const projects = await base44.entities.Project.filter({ sale: sale.id });
      return projects[0];
    },
    enabled: !!sale?.id
  });

  // The money. `sale_balance` owns balance_due and both collection gates; never
  // recompute either here — sale.deposit_amount is legacy and drifts.
  const { data: balance } = useQuery({
    queryKey: ['saleBalance', saleId],
    queryFn: async () => {
      // Explicit sort: the shim defaults to '-created_date', which this VIEW
      // does not have — the default would 400.
      const rows = await base44.entities.SaleBalance.filter({ sale_id: saleId }, '-sale_date');
      return rows[0] || null;
    },
    enabled: !!saleId,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', saleId],
    queryFn: () => base44.entities.Payment.filter({ sale: saleId }, '-payment_date'),
    enabled: !!saleId,
  });

  const refreshMoney = () => {
    queryClient.invalidateQueries({ queryKey: ['saleBalance', saleId] });
    queryClient.invalidateQueries({ queryKey: ['payments', saleId] });
    queryClient.invalidateQueries({ queryKey: ['sale', saleId] });
  };

  const recordPaymentMutation = useMutation({
    mutationFn: async (p) => {
      const { data, error } = await base44.functions.invoke('recordPayment', {
        saleId, amount: p.amount, method: p.method, reference: p.reference,
        kind: p.kind, note: p.note,
        // Guards the double-tap: a retry returns the original row, not a second charge.
        idempotencyKey: p.idempotencyKey,
      });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.reason || 'Payment was not recorded');
      return data;
    },
    onSuccess: (data) => {
      refreshMoney();
      setPaymentOpen(false);
      toast.success(
        data?.duplicate
          ? 'That payment was already recorded — nothing was charged twice.'
          : `Payment recorded. Balance ${money(data?.balance_due ?? 0)}.`,
      );
    },
    onError: (e) => toast.error(e?.message || 'Could not record the payment.'),
  });

  const updateSaleMutation = useMutation({
    mutationFn: async (updates) => {
      await base44.entities.Sale.update(saleId, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sale', saleId] });
      setShowEditDialog(false);
    }
  });

  // cancel_sale SOFT-cancels atomically: the sale and its project(s) are flagged
  // is_cancelled / 'Cancelled' and the linked appointment reverts to 'Completed'.
  // Nothing is deleted — the deposit history has to survive, because the company
  // is still holding that money. There is deliberately ONE cancellation path here;
  // the old "Delete" button ran this same RPC while promising permanent deletion.
  const cancelSaleMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await base44.functions.invoke('cancelSale', { saleId });
      if (error || data?.error || data?.success !== true) {
        throw new Error(data?.error || error?.message || 'Failed to cancel the sale.');
      }
    },
    onSuccess: () => {
      navigate(createPageUrl('Sales'));
    }
  });

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      // Auto-set status to "Scheduled" if installation_date exists
      const projectStatus = sale.installation_date ? 'Scheduled' : 'Accepted';

      const newProject = await base44.entities.Project.create({
        sale: saleId,
        customer: sale.customer,
        status: projectStatus,
        installation_date: sale.installation_date || undefined
      });

      // Generate tracker URL using APP_URL
      let trackerUrl = '';
      try {
        const appUrl = await base44.functions.invoke('getAppUrl');
        const baseUrl = appUrl.data.url;
        const fullUrl = `${baseUrl}/CustomerProjectView?id=${newProject.id}`;
        trackerUrl = fullUrl;

        // Try to shorten the URL
        try {
          const { data } = await base44.functions.invoke('shortenUrl', { originalURL: fullUrl });
          if (data?.shortURL) {
            trackerUrl = data.shortURL;
          }
        } catch (error) {
          console.error('Failed to shorten URL, using full URL:', error);
        }

        // Save the tracker URL to the project
        await base44.entities.Project.update(newProject.id, { project_tracker_url: trackerUrl });
      } catch (error) {
        console.error('Failed to generate tracker URL:', error);
      }

      // Send SMS and email notifications to customer
      if (trackerUrl && customer?.phone) {
        try {
          await base44.functions.invoke('sendAppointmentSMS', {
            appointmentId: sale.appointment,
            type: 'customer_project_created',
            customerId: sale.customer
          });

          // Log the activity
          const user = await base44.auth.me();
          await base44.entities.ProjectLog.create({
            project: newProject.id,
            action: 'SMS Sent',
            details: `Project tracker SMS sent to ${customer.first_name} ${customer.last_name} (${customer.phone})`,
            user_email: user?.email,
            user_name: user?.full_name
          });
        } catch (error) {
          console.error('Failed to send project notification SMS:', error);
        }

        try {
          await base44.functions.invoke('sendNotificationEmail', {
            type: 'project_created',
            entityId: newProject.id,
            appUrl: window.location.origin
          });
        } catch (error) {
          console.error('Failed to send project email:', error);
        }
      }

      return newProject;
    },
    onSuccess: (newProject) => {
      queryClient.invalidateQueries({ queryKey: ['project', sale.id] });
      navigate(createPageUrl('ProjectDetail') + `?id=${newProject.id}`);
    }
  });

  const handleDownloadContract = async () => {
    if (sale?.contract_file_url) {
      const signedUrl = await resolveFileUrl(sale.contract_file_url);
      if (!signedUrl) return;
      try {
        const response = await fetch(signedUrl, {
          mode: 'cors'
        });
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.style.display = 'none';
        link.href = url;
        link.setAttribute('download', `${customer?.last_name || 'customer'}-contract.pdf`);
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        }, 100);
      } catch (error) {
        console.error('Download failed:', error);
        window.open(signedUrl, '_blank');
      }
    }
  };

  const handleEditClick = () => {
    setEditAmount(sale.sale_amount?.toString() || '');
    setEditNotes(sale.notes || '');
    setEditSaleDate(sale.sale_date ? format(parseISO(sale.sale_date), "yyyy-MM-dd'T'HH:mm") : '');
    setShowEditDialog(true);
  };

  const handleEditSubmit = () => {
    updateSaleMutation.mutate({
      sale_amount: editAmount ? parseFloat(editAmount) : undefined,
      notes: editNotes || undefined,
      sale_date: editSaleDate || undefined
    });
  };

  const handleExtractLineItems = async () => {
    if (!sale?.contract_file_url) return;

    // Update status to processing
    await base44.entities.Sale.update(saleId, {
      contract_extraction_status: 'processing'
    });
    queryClient.invalidateQueries({ queryKey: ['sale', saleId] });

    try {
      const { data } = await base44.functions.invoke('extractContractData', {
        contractUrl: sale.contract_file_url,
        saleId: saleId
      });

      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['sale', saleId] });

        // After successful extraction, fetch RFMS data if invoice number exists
        const updatedSale = await base44.entities.Sale.filter({ id: saleId });
        if (updatedSale?.[0]?.invoice_number) {
          try {
            const { data: rfmsData } = await base44.functions.invoke('testOrderDirect', {
              invoiceNumber: updatedSale[0].invoice_number
            });

            if (rfmsData.success) {
              await base44.entities.Sale.update(saleId, {
                rfms_order_data: rfmsData.order,
                rfms_sync_date: new Date().toISOString()
              });
              queryClient.invalidateQueries({ queryKey: ['sale', saleId] });
            }
          } catch (rfmsError) {
            console.error('Failed to fetch RFMS data after extraction:', rfmsError);
          }
        }
      }
    } catch (error) {
      console.error('Failed to extract contract data:', error);
      await base44.entities.Sale.update(saleId, {
        contract_extraction_status: 'error'
      });
      queryClient.invalidateQueries({ queryKey: ['sale', saleId] });
      toast.error('Failed to extract contract data from contract');
    }
  };

  const handleSendSalesEmail = async () => {
    setSendingEmail(true);
    try {
      const { data } = await base44.functions.invoke('sendSaleConfirmationEmail', {
        saleId,
        appUrl: window.location.origin
      });
      if (data?.error) {
        toast.error(`Failed to send email: ${data.error}`);
      } else if (data?.skipped) {
        toast.info(`Email not sent (${data.skipped}).`);
      } else {
        // emailDispatch returns `recipients`, not `recipientCount`.
        toast.success(`Email sent to ${data?.recipients ?? 0} recipient(s)`);
      }
    } catch (error) {
      toast.error(`Failed to send email: ${error.message}`);
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSendGPAlert = async () => {
    const lines = sale.rfms_order_data?.order?.result?.lines || sale.rfms_order_data?.result?.lines || [];
    if (lines.length === 0) {
      toast.error('No RFMS line item data available. Fetch RFMS data first.');
      return;
    }
    setSendingGPAlert(true);
    try {
      const totalCost = lines.reduce((sum, item) => sum + (item.unitCost * item.quantity), 0);
      const orderTotal = lines.reduce((sum, item) => sum + (item.total || 0), 0);
      const gpPercent = orderTotal > 0 ? ((orderTotal - totalCost) / orderTotal * 100) : 0;
      const { data } = await base44.functions.invoke('sendLowGPAlert', {
        saleId,
        customerName: customerName,
        consultantName: consultantName,
        consultantId: sale.assigned_dc,
        gpPercent,
        orderTotal,
        invoiceNumber: sale.invoice_number
      });
      if (data.sent > 0) {
        toast.success(`GP alert sent to ${data.sent} recipient(s). GP%: ${gpPercent.toFixed(1)}%`);
      } else {
        toast(`No alert sent. ${data.message || `GP ${gpPercent.toFixed(1)}% is above the configured threshold.`}`);
      }
    } catch (error) {
      toast.error(`Failed to send GP alert: ${error.message}`);
    } finally {
      setSendingGPAlert(false);
    }
  };

  const handleFetchRFMSOrder = async () => {
    if (!sale?.invoice_number) {
      toast.error('No invoice number found on this sale');
      return;
    }

    console.log('Fetching RFMS order for invoice:', sale.invoice_number);
    setFetchingRFMS(true);
    try {
      const { data } = await base44.functions.invoke('testOrderDirect', {
        invoiceNumber: sale.invoice_number
      });

      console.log('RFMS function response:', data);

      if (data.success) {
        console.log('Updating sale with RFMS data');
        await base44.entities.Sale.update(saleId, {
          rfms_order_data: data.order,
          rfms_sync_date: new Date().toISOString()
        });
        queryClient.invalidateQueries({ queryKey: ['sale', saleId] });

        // Calculate GP% and send low GP alert if needed
        const lines = data.order?.order?.result?.lines || data.order?.result?.lines || [];
        if (lines.length > 0) {
          const totalCost = lines.reduce((sum, item) => sum + (item.unitCost * item.quantity), 0);
          const orderTotal = lines.reduce((sum, item) => sum + (item.total || 0), 0);
          const gpPercent = orderTotal > 0 ? ((orderTotal - totalCost) / orderTotal * 100) : 0;
          try {
            await base44.functions.invoke('sendLowGPAlert', {
              saleId,
              customerName: customerName,
              consultantName: consultantName,
              consultantId: sale.assigned_dc,
              gpPercent,
              orderTotal,
              invoiceNumber: sale.invoice_number
            });
          } catch (gpErr) {
            console.error('GP alert error:', gpErr);
          }
        }

        toast.success('RFMS order data fetched successfully!');
      } else {
        console.error('RFMS fetch failed:', data);
        toast.error(`Failed to fetch RFMS order: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('RFMS fetch error:', error);
      toast.error(`Failed to fetch RFMS order: ${error.message}`);
    } finally {
      setFetchingRFMS(false);
    }
  };

  const handleNewContractSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingNewContract(true);
    try {

      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      setNewContractFileUrl(fileUrl);

      // Auto-extract invoice total from new PDF
      setExtractingNewAmount(true);
      try {
        const { data } = await base44.functions.invoke('extractInvoiceTotal', {
          pdfUrl: fileUrl
        });

        if (data?.success && data?.total) {
          setEditAmount(data.total.toString());
        }
      } catch (extractError) {
        console.error('Failed to extract amount:', extractError);
      } finally {
        setExtractingNewAmount(false);
      }
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Failed to upload contract');
    } finally {
      setUploadingNewContract(false);
    }
  };

  const handleReplaceContract = async () => {
    if (!newContractFileUrl) return;

    try {
      // Update sale with new contract URL and reset extraction status
      await base44.entities.Sale.update(saleId, {
        contract_file_url: newContractFileUrl,
        sale_amount: editAmount ? parseFloat(editAmount) : undefined,
        contract_extraction_status: 'pending',
        invoice_line_items: [] // Clear old line items
      });

      queryClient.invalidateQueries({ queryKey: ['sale', saleId] });
      setShowReplaceContractDialog(false);
      setNewContractFileUrl('');
      setEditAmount('');
    } catch (error) {
      console.error('Failed to replace contract:', error);
      toast.error('Failed to replace contract');
    }
  };

  const { data: checklist } = useQuery({
    queryKey: ['saleChecklist', sale?.appointment],
    queryFn: async () => {
      const checklists = await base44.entities.AppointmentSettingChecklist.filter({ appointment: sale.appointment });
      return checklists[0] || null;
    },
    enabled: !!sale?.appointment
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const rfmsLines = sale?.rfms_order_data?.order?.result?.lines || sale?.rfms_order_data?.result?.lines || [];
  const { data: catalogCostMap = {} } = useQuery({
    queryKey: ['rfmsCatalogCostMap'],
    queryFn: async () => {
      const [items, rolls] = await Promise.all([
        base44.entities.RFMSItem.list(),
        base44.entities.RFMSRoll.list()
      ]);
      return buildCatalogCostMap(items, rolls);
    },
    enabled: rfmsLines.length > 0,
    staleTime: 5 * 60 * 1000
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!sale) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">Sale not found</h2>
          <Link to={createPageUrl('Sales')} className="text-primary hover:underline">
            Back to sales
          </Link>
        </div>
      </div>
    );
  }

  const customerName = customer ? `${customer.first_name} ${customer.last_name}` : 'Loading...';
  const consultantName = consultant ? `${consultant.first_name} ${consultant.last_name}` : 'Loading...';

  // Presentational rollups for the header + KPI row.
  const isCancelled = !!sale.is_cancelled;
  const rfmsSourced = !!sale.rfms_order_data;
  // From the ledger, not from sale.deposit_amount — that column is legacy, holds
  // only the FIRST deposit, and cannot see a second payment or a refund.
  const balanceDue = balance ? Number(balance.balance_due) : null;
  const amountPaid = balance ? Number(balance.amount_paid) : null;
  const depositSatisfied = balance?.deposit_satisfied === true;
  const fullyCollected = balance?.fully_collected === true;
  const pendingClearance = balance ? Number(balance.amount_pending_clearance) : 0;

  const openPaymentDialog = () => {
    setPayAmount(balanceDue != null && balanceDue > 0 ? String(balanceDue) : '');
    setPayMethod(''); setPayReference(''); setPayNote('');
    setPayKind(depositSatisfied ? 'final' : 'deposit');
    setPayIdemKey(
      (globalThis.crypto?.randomUUID?.() ?? `pay-${saleId}-${Date.now()}-${Math.random()}`),
    );
    setPaymentOpen(true);
  };
  const heroGP = rfmsLines.length > 0 ? computeCatalogGP(rfmsLines, catalogCostMap) : null;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          eyebrow={
            <Link
              to={createPageUrl('Sales')}
              className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Sales
            </Link>
          }
          title={customerName}
          subtitle={`Sold on ${format(parseISO(sale.sale_date), 'MMMM d, yyyy')} at ${format(parseISO(sale.sale_date), 'h:mm a')}`}
          actions={
            project ? (
              <Button
                variant="accent"
                onClick={() => navigate(createPageUrl('ProjectDetail') + `?id=${project.id}`)}
              >
                <Eye className="mr-2 h-4 w-4" />
                View Project
              </Button>
            ) : (
              <Button
                variant="accent"
                onClick={() => createProjectMutation.mutate()}
                disabled={createProjectMutation.isPending}
              >
                {createProjectMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Project
                  </>
                )}
              </Button>
            )
          }
        >
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill tone={isCancelled ? 'crit' : 'good'} dot>
              {isCancelled ? 'Cancelled' : 'Sold'}
            </StatusPill>
            {sale.invoice_number && (
              <StatusPill tone="neutral">Inv #{sale.invoice_number}</StatusPill>
            )}
            {rfmsSourced && (
              <SyncBadge
                status="synced"
                label={sale.rfms_sync_date ? `RFMS · ${format(parseISO(sale.rfms_sync_date), 'MMM d')}` : 'RFMS'}
              />
            )}
          </div>
        </PageHeader>

        {/* Secondary action toolbar */}
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleDownloadContract} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Download Contract
          </Button>
          <Button
            onClick={() => setShowReplaceContractDialog(true)}
            variant="outline"
            className="border-brand-blue/40 text-brand-blue hover:bg-brand-blue/15"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Replace Contract
          </Button>
          <Button onClick={handleEditClick} variant="outline">
            <Edit className="mr-2 h-4 w-4" />
            Edit Sale
          </Button>
          <Button
            onClick={() => setShowCancelDialog(true)}
            variant="outline"
            className="border-warn/40 text-warn hover:bg-warn/10"
          >
            <X className="mr-2 h-4 w-4" />
            Cancel Sale
          </Button>
          {currentUser?.role === 'admin' && (
            <Button
              onClick={handleSendSalesEmail}
              disabled={sendingEmail}
              variant="outline"
              className="border-info/40 text-info hover:bg-info/10"
            >
              {sendingEmail ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send Sales Email
                </>
              )}
            </Button>
          )}
        </div>

        {/* Summary KPIs */}
        <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', heroGP ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
          <KpiTile
            hero
            label="Sale Amount"
            value={money(sale.sale_amount)}
            foot={sale.invoice_number ? `Invoice #${sale.invoice_number}` : 'Closed sale'}
          />
          <KpiTile
            label="Collected"
            value={amountPaid == null ? '—' : money(amountPaid)}
            foot={
              amountPaid == null ? 'Loading'
                : pendingClearance > 0 ? `${money(pendingClearance)} not yet cleared`
                : depositSatisfied ? 'Deposit cleared' : 'Deposit not yet met'
            }
          />
          <KpiTile
            label="Balance Due"
            value={balanceDue == null ? '—' : money(balanceDue)}
            foot={
              balanceDue == null ? 'Loading'
                : fullyCollected ? 'Paid in full — clear to install'
                : 'Due before install starts'
            }
          />
          {heroGP && (
            <KpiTile
              label="Gross Profit"
              value={`${heroGP.grossProfitPercent.toFixed(1)}%`}
              foot={`Catalog GP · ${money(heroGP.grossProfit)}`}
            />
          )}
        </div>

        {/* Info cards */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Customer Information */}
          <ModuleCard title="Customer" icon={User}>
            {customer ? (
              <div className="p-3 space-y-1">
                <DetailField
                  icon={User}
                  label="Name"
                  to={createPageUrl('CustomerDetail') + `?id=${customer.id}`}
                >
                  <span className="group-hover:text-primary">{customerName}</span>
                </DetailField>
                <DetailField icon={Mail} label="Email" href={`mailto:${customer.email}`}>
                  {customer.email}
                </DetailField>
                {customer.phone && (
                  <DetailField icon={Phone} label="Phone" href={`tel:${customer.phone}`}>
                    {customer.phone}
                  </DetailField>
                )}
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading customer information...</p>
            )}
          </ModuleCard>

          {/* Consultant Information */}
          <ModuleCard title="Design Consultant" icon={User}>
            {consultant ? (
              <div className="p-3 space-y-1">
                <DetailField icon={User} label="Name">
                  {consultantName}
                </DetailField>
                <DetailField icon={Mail} label="Email" href={`mailto:${consultant.email}`}>
                  {consultant.email}
                </DetailField>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading consultant information...</p>
            )}
          </ModuleCard>

          {/* Appointment Details */}
          <ModuleCard title="Original Appointment" icon={CalendarIcon}>
            <div className="p-3 space-y-1">
              {sale.appointment_date && (
                <DetailField icon={CalendarIcon} label="Date">
                  {format(new Date(sale.appointment_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
                </DetailField>
              )}
              {sale.appointment_block && (
                <DetailField icon={Clock} label="Time Block">
                  {sale.appointment_block}
                </DetailField>
              )}
              {checklist?.heard_about_us && (
                <DetailField icon={MapPin} label="Lead Source">
                  {checklist.heard_about_us}{checklist.heard_about_us === 'Other' && checklist.heard_about_us_other ? ` — ${checklist.heard_about_us_other}` : ''}
                </DetailField>
              )}
              <DetailField
                icon={FileText}
                label="View Details"
                to={createPageUrl('AppointmentDetail') + `?id=${sale.appointment}`}
              >
                <span className="text-primary group-hover:underline">Full Appointment</span>
              </DetailField>
            </div>
          </ModuleCard>

          {/* Payments — the ledger, not a single deposit field */}
          <ModuleCard
            title="Payments"
            icon={DollarSign}
            action={
              !isCancelled && (
                <Button size="sm" variant="outline" onClick={openPaymentDialog}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Record Payment
                </Button>
              )
            }
          >
            <div className="p-3">
              {/* What the two gates say, in plain language. */}
              {balance && (
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Deposit</p>
                    <p className={cn('text-sm font-semibold',
                      depositSatisfied ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                      {depositSatisfied ? 'Cleared' : 'Not cleared'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {money(balance.amount_cleared)} of {money(balance.deposit_required)} required
                    </p>
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Before install</p>
                    <p className={cn('text-sm font-semibold',
                      fullyCollected ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                      {fullyCollected ? 'Paid in full' : `${money(balance.balance_due)} due`}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {balance.collection_terms === 'financed' ? 'Financed — lender funds after completion'
                        : balance.collect_exempt ? 'Exempt from collection'
                        : 'Collected on day one of install'}
                    </p>
                  </div>
                </div>
              )}

              {payments.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No payments recorded against this sale
                </p>
              ) : (
                <div className="space-y-1">
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/60">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{money(p.amount)}</span>
                          <StatusPill tone={p.confirmed_at ? 'good' : 'warn'}>
                            {p.confirmed_at ? 'Cleared' : 'Not cleared'}
                          </StatusPill>
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{p.kind}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {p.payment_date ? format(new Date(p.payment_date + 'T00:00:00'), 'MMM d, yyyy') : '—'}
                          {p.method ? ` · ${p.method}` : ''}
                          {p.reference ? ` · ${p.reference}` : ''}
                          {p.recorded_by ? ` · ${p.recorded_by}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ModuleCard>

          {/* Location */}
          <ModuleCard title="Location" icon={MapPin}>
            {sale.location_address ? (
              <div className="p-3">
                <DetailField icon={MapPin} label="Address">
                  <span className="whitespace-normal">{sale.location_address}</span>
                </DetailField>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No location specified</p>
            )}
          </ModuleCard>

          {/* Related Project */}
          {project && (
            <ModuleCard title="Related Project" icon={Boxes}>
              <WorkRow
                primary="Installation Project"
                meta={[
                  project.installation_date && `Installs ${format(new Date(project.installation_date + 'T00:00:00'), 'MMM d, yyyy')}`,
                  'Created from this sale',
                ].filter(Boolean).join('  ·  ')}
                status={project.status}
                tone="info"
                onClick={() => navigate(createPageUrl('ProjectDetail') + `?id=${project.id}`)}
              />
            </ModuleCard>
          )}
        </div>

        {/* Driver's License */}
        {sale.driver_license_photo_url && (
          <ModuleCard title="Driver's License" icon={IdCard}>
            <div className="p-4">
              <div className="overflow-hidden rounded-lg border border-border">
                <SignedImage
                  src={sale.driver_license_photo_url}
                  alt="Driver's License"
                  className="w-full h-auto"
                />
              </div>
            </div>
          </ModuleCard>
        )}

        {/* Final Product Selected Photos */}
        {sale.product_photos && sale.product_photos.length > 0 && (
          <ModuleCard title="Final Product Selected Photos" subtitle={`${sale.product_photos.length} photo${sale.product_photos.length === 1 ? '' : 's'}`} icon={ImageIcon}>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {sale.product_photos.map((url, idx) => (
                  <div key={idx}>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Product {idx + 1}</p>
                    <div className="overflow-hidden rounded-lg border border-border">
                      <SignedImage
                        src={url}
                        alt={`Product ${idx + 1}`}
                        className="h-48 w-full object-cover"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ModuleCard>
        )}

        {/* Notes */}
        {sale.notes && (
          <ModuleCard title="Sale Notes" icon={FileText}>
            <div className="p-4">
              <p className="whitespace-pre-wrap text-sm text-foreground">{sale.notes}</p>
            </div>
          </ModuleCard>
        )}

        {/* Invoice Details */}
        <ModuleCard
          title="Invoice Details"
          subtitle={sale.invoice_number ? `Invoice #${sale.invoice_number}` : undefined}
          icon={FileText}
        >
          <div className="p-4">
            <Tabs defaultValue="rfms" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="rfms">RFMS API Data</TabsTrigger>
                <TabsTrigger value="contract">Contract Extraction</TabsTrigger>
              </TabsList>

              <TabsContent value="rfms" className="mt-6">
                {(() => {
                  const PRODUCT_TYPES = {
                    1: '01 CARPET', 2: '02 VINYL', 3: '03 PAD', 4: '04 WOOD',
                    5: '05 TILE', 6: '06 LAMINATE', 7: '07 VINYL TILE - LVT, LVP',
                    8: '08 CARPET TILE', 9: '09 VCT', 10: '10 NATURAL STONE',
                    11: '11 RUBBER TILE', 12: '12 SD/ESD TILE', 13: '13 SUNDRIES',
                    14: '14 ADHESIVES', 15: '15 METAL', 16: '16 WALL BASE',
                    17: '17 TRIMS/TRANSITIONS', 18: '18 UNDERLAYMENT',
                    19: '19 INSTALL MATERIALS', 20: '20 AREA RUGS', 21: '21 REMNANTS'
                  };
                  const result = sale.rfms_order_data?.order?.result || sale.rfms_order_data?.result;
                  const lines = result?.lines;
                  const privateNotes = result?.privateNotes;
                  const publicNotes = result?.publicNotes;
                  const workOrderNotes = result?.workOrderNotes;
                  if (!lines || lines.length === 0) {
                    return (
                      <div className="text-center py-8">
                        <Download className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                        <p className="text-muted-foreground text-sm">No RFMS data available</p>
                        <p className="text-muted-foreground text-xs mt-1">
                          {sale.invoice_number
                            ? 'Click "Fetch from RFMS" in the RFMS Order Data section below'
                            : 'Invoice number required to fetch RFMS data'}
                        </p>
                      </div>
                    );
                  }
                  const totalCost = lines.reduce((sum, item) => sum + (item.unitCost * item.quantity), 0);
                  const orderTotal = lines.reduce((sum, item) => sum + (item.total || 0), 0);
                  const grossProfitPercent = orderTotal > 0 ? ((orderTotal - totalCost) / orderTotal * 100) : 0;
                  // New GP calc using catalog per_unit_cost when available, else falls back to RFMS unitCost
                  const { catalogTotalCost, grossProfit: catalogGrossProfit, grossProfitPercent: catalogGPPercent } = computeCatalogGP(lines, catalogCostMap);
                  return (
                    <div>
                      <div className="border border-border rounded-lg overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted">
                              <TableHead>Supplier</TableHead>
                              <TableHead>Style Name</TableHead>
                              <TableHead>Color</TableHead>
                              <TableHead>Product Code</TableHead>
                              <TableHead>Product Type</TableHead>
                              <TableHead className="text-right">Quantity</TableHead>
                              <TableHead className="text-right">Unit Cost</TableHead>
                              <TableHead className="text-right">Per Unit Cost</TableHead>
                              <TableHead className="text-right">Unit Price</TableHead>
                              <TableHead className="text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {lines.map((item, index) => (
                              <TableRow key={index}>
                                <TableCell className="font-medium">{item.supplierName}</TableCell>
                                <TableCell>{item.styleName}</TableCell>
                                <TableCell>{item.colorName}</TableCell>
                                <TableCell className="text-muted-foreground">{item.productCode ?? '—'}</TableCell>
                                <TableCell className="text-muted-foreground whitespace-nowrap">{PRODUCT_TYPES[parseInt(item.productCode, 10)] || '—'}</TableCell>
                                <TableCell className="text-right">{item.quantity}</TableCell>
                                <TableCell className="text-right">${item.unitCost?.toFixed(2) || '0.00'}</TableCell>
                                <TableCell className="text-right">{(() => { const c = catalogCostMap[String(item.styleName).toLowerCase()]; return c != null ? `$${Number(c).toFixed(2)}` : '—'; })()}</TableCell>
                                <TableCell className="text-right">${item.unitPrice?.toFixed(2) || '0.00'}</TableCell>
                                <TableCell className="text-right font-semibold">${item.total?.toFixed(2) || '0.00'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      {/* New GP calc using catalog per_unit_cost (larger) */}
                      <div className="border-t-2 border-border pt-4 mt-6 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-base font-semibold text-foreground">Total Cost (Catalog):</span>
                          <span className="text-2xl font-bold text-foreground">
                            ${catalogTotalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-base font-semibold text-foreground">Order Total:</span>
                          <span className="text-3xl font-bold text-good">
                            ${orderTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-border">
                          <span className="text-base font-semibold text-foreground">Gross Profit % (Catalog):</span>
                          <span className="text-2xl font-bold text-brand-blue">{catalogGPPercent.toFixed(2)}%</span>
                        </div>
                        <div className="flex justify-between items-center pt-2">
                          <span className="text-base font-semibold text-foreground">Gross Profit $ (Catalog):</span>
                          <span className="text-2xl font-bold text-good">${(orderTotal - catalogTotalCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                      {/* Old GP calc using RFMS unit cost (smaller, for diff) */}
                      <div className="border-t border-border pt-3 mt-4 space-y-1 bg-muted rounded-lg p-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">RFMS Unit Cost GP (legacy)</p>
                        <div
                          className="flex justify-between items-center cursor-pointer group"
                          onClick={() => {
                            setCostBreakdownData({ lines, totalCost, orderTotal, grossProfitPercent });
                            setShowCostBreakdown(true);
                          }}
                        >
                          <span className="text-xs font-medium text-muted-foreground group-hover:underline">Total Cost:</span>
                          <span className="text-sm font-semibold text-muted-foreground group-hover:underline">
                            ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-medium text-muted-foreground">Order Total:</span>
                          <span className="text-sm font-semibold text-muted-foreground">
                            ${orderTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-medium text-muted-foreground">Gross Profit %:</span>
                          <span className="text-sm font-bold text-muted-foreground">{grossProfitPercent.toFixed(2)}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-medium text-muted-foreground">Gross Profit $:</span>
                          <span className="text-sm font-bold text-muted-foreground">${(orderTotal - totalCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                      <div className="mt-6 space-y-2">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">GP% by Line Item</h3>
                        {lines.map((item, index) => {
                          const itemGP = item.total > 0 ? ((item.total - (item.unitCost * item.quantity)) / item.total * 100) : 0;
                          return (
                            <div key={index} className="flex items-center justify-between p-2 bg-muted rounded">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-foreground truncate">{item.styleName}</p>
                              </div>
                              <span className="text-xs font-bold text-brand-blue ml-2">{itemGP.toFixed(1)}%</span>
                            </div>
                          );
                        })}
                      </div>
                      {(publicNotes || privateNotes || workOrderNotes) && (
                        <div className="mt-6 space-y-4 border-t border-border pt-4">
                          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Order Notes</h3>
                          {publicNotes && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Public Notes</p>
                              <div className="bg-muted rounded-lg p-3 text-sm text-foreground prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: publicNotes }} />
                            </div>
                          )}
                          {privateNotes && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Private Notes</p>
                              <div className="bg-warn/10 rounded-lg p-3 text-sm text-foreground prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: privateNotes }} />
                            </div>
                          )}
                          {workOrderNotes && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Work Order Notes</p>
                              <div className="bg-brand-blue/15 rounded-lg p-3 text-sm text-foreground prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: workOrderNotes }} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </TabsContent>

              <TabsContent value="contract" className="mt-6">
                <div className="flex justify-end mb-4">
                  <Button
                    onClick={handleExtractLineItems}
                    disabled={sale?.contract_extraction_status === 'processing'}
                    variant="outline"
                    size="sm"
                    className="border-primary/30 text-primary hover:bg-primary/10"
                  >
                    {sale?.contract_extraction_status === 'processing' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Extracting...
                      </>
                    ) : sale?.contract_extraction_status === 'error' ? (
                      <>
                        <ClipboardCheck className="w-4 h-4 mr-2" />
                        Retry Extraction
                      </>
                    ) : (
                      <>
                        <ClipboardCheck className="w-4 h-4 mr-2" />
                        {sale?.invoice_line_items?.length ? 'Re-extract' : 'Extract from Contract'}
                      </>
                    )}
                  </Button>
                </div>

                {sale.invoice_line_items && sale.invoice_line_items.length > 0 ? (
                  <div>
                    <div className="border-b border-border pb-2 mb-4">
                      <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Item</h3>
                    </div>
                    <div className="space-y-0">
                      {sale.invoice_line_items.map((item, index) => (
                        <div key={index} className="py-2 border-b border-border last:border-0">
                          <div className="text-foreground text-sm">{item.description}</div>
                          {item.area && (
                            <div className="text-muted-foreground text-xs mt-1 ml-4">Area: {item.area}</div>
                          )}
                        </div>
                      ))}
                    </div>
                    {sale.sale_amount && (
                      <div className="border-t-2 border-border pt-4 mt-6 flex justify-between items-center">
                        <span className="text-sm font-semibold text-foreground">Invoice Total:</span>
                        <span className="text-2xl font-bold text-good">
                          ${sale.sale_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <ClipboardCheck className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground text-sm">No invoice details extracted yet</p>
                    <p className="text-muted-foreground text-xs mt-1">Click "Extract from Contract" to analyze the contract PDF</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </ModuleCard>

        {/* RFMS Order Data - Admin Only */}
        {currentUser?.role === 'admin' && (
          <ModuleCard
            title="RFMS Order Data"
            subtitle={sale.rfms_sync_date ? `Last synced: ${format(parseISO(sale.rfms_sync_date), 'MMM d, yyyy h:mm a')}` : undefined}
            icon={RefreshCw}
            action={
              <div className="flex items-center gap-2">
                {sale.rfms_order_data && (
                  <Button
                    onClick={handleSendGPAlert}
                    disabled={sendingGPAlert}
                    variant="outline"
                    size="sm"
                    className="border-good/40 text-good hover:bg-good/10"
                  >
                    {sendingGPAlert ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send GP Alert
                      </>
                    )}
                  </Button>
                )}
                <Button
                  onClick={handleFetchRFMSOrder}
                  disabled={fetchingRFMS || !sale.invoice_number}
                  variant="outline"
                  size="sm"
                  className="border-brand-blue/30 text-brand-blue hover:bg-brand-blue/15"
                >
                  {fetchingRFMS ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Fetching...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      {sale.rfms_order_data ? 'Refresh from RFMS' : 'Fetch from RFMS'}
                    </>
                  )}
                </Button>
              </div>
            }
          >
            <div className="p-4">
              {sale.rfms_order_data ? (
                <div className="bg-muted rounded-lg p-4 max-h-96 overflow-auto">
                  <pre className="text-xs text-foreground whitespace-pre-wrap">
                    {JSON.stringify(sale.rfms_order_data, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Download className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">No RFMS order data fetched yet</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    {sale.invoice_number
                      ? `Click "Fetch from RFMS" to retrieve order data for invoice #${sale.invoice_number}`
                      : 'Invoice number required to fetch RFMS data'}
                  </p>
                </div>
              )}
            </div>
          </ModuleCard>
        )}
      </div>

      <CostBreakdownModal
        open={showCostBreakdown}
        onClose={setShowCostBreakdown}
        data={costBreakdownData}
      />

      {/* Record Payment — the only write path into the ledger. The server
          re-derives every gate; nothing here is trusted as an amount check. */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              {balanceDue != null && balanceDue > 0
                ? `${money(balanceDue)} outstanding on this sale.`
                : 'This sale is paid in full.'}
              {' '}Accounting confirms it cleared separately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="pay-amount">Amount</Label>
              <Input
                id="pay-amount" type="number" step="0.01" inputMode="decimal"
                value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label htmlFor="pay-kind">Type</Label>
              <select
                id="pay-kind" value={payKind} onChange={(e) => setPayKind(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="deposit">Deposit</option>
                <option value="progress">Progress payment</option>
                <option value="final">Final / balance</option>
              </select>
            </div>
            <div>
              <Label htmlFor="pay-method">Method</Label>
              <Input
                id="pay-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}
                placeholder="Card, Check, Money order, ACH…"
              />
            </div>
            <div>
              <Label htmlFor="pay-ref">Reference</Label>
              <Input
                id="pay-ref" value={payReference} onChange={(e) => setPayReference(e.target.value)}
                placeholder="Check number, auth code…"
              />
            </div>
            <div>
              <Label htmlFor="pay-note">Note</Label>
              <Textarea
                id="pay-note" rows={2} value={payNote} onChange={(e) => setPayNote(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button
              onClick={() => recordPaymentMutation.mutate({
                amount: parseFloat(payAmount),
                method: payMethod || null,
                reference: payReference || null,
                kind: payKind,
                note: payNote || null,
                idempotencyKey: payIdemKey,
              })}
              disabled={
                recordPaymentMutation.isPending
                || !payAmount
                || !Number.isFinite(parseFloat(payAmount))
                || parseFloat(payAmount) <= 0
              }
            >
              {recordPaymentMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Sale</DialogTitle>
            <DialogDescription>
              Update the sale amount and notes
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-sale-date">Sale Date & Time</Label>
              <Input
                id="edit-sale-date"
                type="datetime-local"
                value={editSaleDate}
                onChange={(e) => setEditSaleDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-amount">Sale Amount</Label>
              <Input
                id="edit-amount"
                type="number"
                placeholder="Enter sale amount"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                placeholder="Add any notes about this sale..."
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={updateSaleMutation.isPending}
              className="bg-primary text-primary-foreground hover:opacity-90"
            >
              {updateSaleMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Sale Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Sale</DialogTitle>
            <DialogDescription>
              This will revert the appointment status back to "Completed" and remove the sale record. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCancelDialog(false)}
            >
              Keep Sale
            </Button>
            <Button
              onClick={() => cancelSaleMutation.mutate()}
              disabled={cancelSaleMutation.isPending}
              className="bg-warn text-background hover:bg-warn/90"
            >
              {cancelSaleMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cancelling...
                </>
              ) : (
                'Cancel Sale'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Replace Contract Dialog */}
      <Dialog open={showReplaceContractDialog} onOpenChange={setShowReplaceContractDialog}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Replace Contract</DialogTitle>
            <DialogDescription>
              Upload a new contract PDF to replace the existing one. This will also reset invoice extraction data.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>New Contract PDF *</Label>
              <input
                ref={newContractInputRef}
                type="file"
                accept=".pdf"
                onChange={handleNewContractSelect}
                className="hidden"
              />
              <Button
                type="button"
                onClick={() => newContractInputRef.current?.click()}
                variant="outline"
                className="w-full h-20 border-dashed"
                disabled={uploadingNewContract}
              >
                {uploadingNewContract ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5 mr-2" />
                    {newContractFileUrl ? 'New Contract Uploaded ✓' : 'Click to Upload New Contract'}
                  </>
                )}
              </Button>
            </div>

            {newContractFileUrl && (
              <>
                <div className="p-3 bg-good/10 border border-good/25 rounded-lg">
                  <p className="text-sm text-good flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    New contract uploaded successfully
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-amount">Sale Amount (optional)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      id="new-amount"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      disabled={extractingNewAmount}
                      className="pl-7"
                    />
                    {extractingNewAmount && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      </div>
                    )}
                  </div>
                  {extractingNewAmount && (
                    <p className="text-xs text-primary">Extracting amount from PDF...</p>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowReplaceContractDialog(false);
                setNewContractFileUrl('');
                setEditAmount('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleReplaceContract}
              disabled={!newContractFileUrl || updateSaleMutation.isPending}
              className="bg-brand-blue text-white hover:bg-brand-blue/90"
            >
              {updateSaleMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Replacing...
                </>
              ) : (
                'Replace Contract'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
