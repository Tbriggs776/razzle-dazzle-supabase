import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { SignedImage, resolveFileUrl } from '@/lib/fileUrl';
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
  Trash2,
  X,
  ClipboardCheck,
  Eye,
  Plus,
  Send,
  Upload,
  RefreshCw,
  RotateCcw
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import CostBreakdownModal from '@/components/sales/CostBreakdownModal';
import { buildCatalogCostMap, computeCatalogGP } from '@/lib/catalogCost';

export default function SaleDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const saleId = urlParams.get('id');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
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

  const updateSaleMutation = useMutation({
    mutationFn: async (updates) => {
      await base44.entities.Sale.update(saleId, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sale', saleId] });
      setShowEditDialog(false);
    }
  });

  const deleteSaleMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.Sale.delete(saleId);
    },
    onSuccess: () => {
      navigate(createPageUrl('Sales'));
    }
  });

  const cancelSaleMutation = useMutation({
    mutationFn: async () => {
      // Revert appointment status back to Completed
      await base44.entities.Appointment.update(sale.appointment, { status: 'Completed' });
      // Delete the sale record
      await base44.entities.Sale.delete(saleId);
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link
            to={createPageUrl('Sales')}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sales
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex flex-col md:flex-row md:items-start gap-6">
              <div className="w-20 h-20 flex-shrink-0 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-white shadow-xl shadow-emerald-200">
                <DollarSign className="w-10 h-10" />
              </div>

              <div className="flex-1 min-w-0">
                <h1 className="text-3xl font-bold text-foreground tracking-tight">{customerName}</h1>
                <p className="text-muted-foreground mt-1">
                  Sold on {format(parseISO(sale.sale_date), 'MMMM d, yyyy')} at {format(parseISO(sale.sale_date), 'h:mm a')}
                </p>
              </div>

              {sale.sale_amount && (
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Sale Amount</p>
                  <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                    ${sale.sale_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {project ? (
                <Button
                  onClick={() => navigate(createPageUrl('ProjectDetail') + `?id=${project.id}`)}
                  className="bg-primary text-primary-foreground hover:opacity-90 h-11 px-5"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  View Project
                </Button>
              ) : (
                <Button
                  onClick={() => createProjectMutation.mutate()}
                  disabled={createProjectMutation.isPending}
                  className="bg-primary text-primary-foreground hover:opacity-90 h-11 px-5"
                >
                  {createProjectMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Create Project
                    </>
                  )}
                </Button>
              )}
              <Button
                onClick={handleDownloadContract}
                variant="outline"
                className="h-11 px-5 border-border"
              >
                <Download className="w-4 h-4 mr-2" />
                Download Contract
              </Button>
              <Button
                onClick={() => setShowReplaceContractDialog(true)}
                variant="outline"
                className="h-11 px-5 border-brand-blue/40 text-brand-blue hover:bg-brand-blue/12"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Replace Contract
              </Button>
              <Button
                onClick={handleEditClick}
                variant="outline"
                className="h-11 px-5 border-border"
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit Sale
              </Button>
              <Button
                onClick={() => setShowCancelDialog(true)}
                variant="outline"
                className="h-11 px-5 border-orange-300 text-orange-600 hover:bg-orange-50 dark:border-orange-500/30 dark:text-orange-300 dark:hover:bg-orange-500/10"
              >
                <X className="w-4 h-4 mr-2" />
                Cancel Sale
              </Button>
              <Button
                onClick={() => setShowDeleteDialog(true)}
                variant="outline"
                className="h-11 px-5 border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
              {currentUser?.role === 'admin' && (
                <Button
                  onClick={handleSendSalesEmail}
                  disabled={sendingEmail}
                  variant="outline"
                  className="h-11 px-5 border-purple-300 text-purple-600 hover:bg-purple-50 dark:border-purple-500/30 dark:text-purple-300 dark:hover:bg-purple-500/10"
                >
                  {sendingEmail ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send Sales Email
                    </>
                  )}
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {/* Customer Information */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Customer Information
            </h2>
            {customer ? (
              <div className="space-y-4">
                <Link
                  to={createPageUrl('CustomerDetail') + `?id=${customer.id}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-0.5">Name</p>
                    <p className="text-foreground group-hover:text-primary transition-colors">
                      {customerName}
                    </p>
                  </div>
                </Link>
                <a
                  href={`mailto:${customer.email}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-green-50 dark:bg-green-500/15 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-green-600 dark:text-green-300" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                    <p className="text-foreground group-hover:text-green-600 transition-colors">
                      {customer.email}
                    </p>
                  </div>
                </a>
                {customer.phone && (
                  <a
                    href={`tel:${customer.phone}`}
                    className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-brand-blue/12 flex items-center justify-center">
                      <Phone className="w-5 h-5 text-brand-blue" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Phone</p>
                      <p className="text-foreground group-hover:text-brand-blue transition-colors">
                        {customer.phone}
                      </p>
                    </div>
                  </a>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-4">Loading customer information...</p>
            )}
          </motion.div>

          {/* Consultant Information */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Design Consultant
            </h2>
            {consultant ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-3 rounded-xl bg-brand-blue/12">
                  <div className="w-10 h-10 rounded-lg bg-brand-blue/15 flex items-center justify-center">
                    <User className="w-5 h-5 text-brand-blue" />
                  </div>
                  <div>
                    <p className="text-xs text-brand-blue mb-0.5">Name</p>
                    <p className="text-foreground">{consultantName}</p>
                  </div>
                </div>
                <a
                  href={`mailto:${consultant.email}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-green-50 dark:bg-green-500/15 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-green-600 dark:text-green-300" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                    <p className="text-foreground group-hover:text-green-600 transition-colors">
                      {consultant.email}
                    </p>
                  </div>
                </a>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-4">Loading consultant information...</p>
            )}
          </motion.div>

          {/* Appointment Details */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Original Appointment
            </h2>
            <div className="space-y-4">
              {sale.appointment_date && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-brand-blue/12 flex items-center justify-center">
                    <CalendarIcon className="w-5 h-5 text-brand-blue" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Date</p>
                    <p className="text-foreground">
                      {format(new Date(sale.appointment_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
                    </p>
                  </div>
                </div>
              )}
              {sale.appointment_block && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-500/15 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-purple-600 dark:text-purple-300" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Time Block</p>
                    <p className="text-foreground">{sale.appointment_block}</p>
                  </div>
                </div>
              )}
              {checklist?.heard_about_us && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-500/15 flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-amber-600 dark:text-amber-300" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Lead Source</p>
                    <p className="text-foreground">
                      {checklist.heard_about_us}{checklist.heard_about_us === 'Other' && checklist.heard_about_us_other ? ` — ${checklist.heard_about_us_other}` : ''}
                    </p>
                  </div>
                </div>
              )}
              <Link
                to={createPageUrl('AppointmentDetail') + `?id=${sale.appointment}`}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">View Details</p>
                  <p className="text-primary group-hover:underline">Full Appointment</p>
                </div>
              </Link>
            </div>
          </motion.div>

          {/* Payment Details */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Payment Details
            </h2>
            <div className="space-y-4">
              {sale.deposit_payment_method && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-300" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Payment Method</p>
                    <p className="text-foreground">{sale.deposit_payment_method}</p>
                  </div>
                </div>
              )}
              {sale.deposit_amount && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-green-50 dark:bg-green-500/15 flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-green-600 dark:text-green-300" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Deposit Amount</p>
                    <p className="text-foreground">
                      ${sale.deposit_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              )}
              {sale.check_number && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-brand-blue/12 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-brand-blue" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Check Number</p>
                    <p className="text-foreground">{sale.check_number}</p>
                  </div>
                </div>
              )}
              {sale.check_date && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-500/15 flex items-center justify-center">
                    <CalendarIcon className="w-5 h-5 text-purple-600 dark:text-purple-300" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Check Date</p>
                    <p className="text-foreground">
                      {format(new Date(sale.check_date + 'T00:00:00'), 'MMMM d, yyyy')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* Location */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Location
            </h2>
            {sale.location_address ? (
              <div className="flex items-start gap-4 p-3">
                <div className="w-10 h-10 rounded-lg bg-orange-50 dark:bg-orange-500/15 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-orange-600 dark:text-orange-300" />
                </div>
                <div>
                  <p className="text-foreground">{sale.location_address}</p>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-6">No location specified</p>
            )}
          </motion.div>

          {/* Final Product Selected Photos */}
          {sale.product_photos && sale.product_photos.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-card rounded-2xl border border-border p-6 md:col-span-2 xl:col-span-3"
            >
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
                Final Product Selected Photos
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {sale.product_photos.map((url, idx) => (
                  <div key={idx}>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Product {idx + 1}</p>
                    <div className="rounded-lg overflow-hidden border border-border">
                      <SignedImage
                        src={url}
                        alt={`Product ${idx + 1}`}
                        className="w-full h-48 object-cover"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Driver's License Photo */}
          {sale.driver_license_photo_url && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-card rounded-2xl border border-border p-6"
            >
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
                Driver's License
              </h2>
              <div className="rounded-lg overflow-hidden border border-border">
                <SignedImage
                  src={sale.driver_license_photo_url}
                  alt="Driver's License"
                  className="w-full h-auto"
                />
              </div>
            </motion.div>
          )}

          {/* Notes */}
          {sale.notes && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              className="bg-card rounded-2xl border border-border p-6 md:col-span-2 xl:col-span-3"
            >
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
                Sale Notes
              </h2>
              <div className="flex items-start gap-4 p-3">
                <div className="w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-purple-600 dark:text-purple-300" />
                </div>
                <p className="text-foreground whitespace-pre-wrap">{sale.notes}</p>
              </div>
            </motion.div>
          )}

          {/* Invoice Details */}
          <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.6 }}
           className="bg-card rounded-2xl border border-border p-6 md:col-span-2 xl:col-span-3"
          >
           <div className="flex items-center justify-between mb-4">
             <div>
               <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                 Invoice Details
               </h2>
               {sale.invoice_number && (
                 <p className="text-xs text-muted-foreground mt-1">Invoice #{sale.invoice_number}</p>
               )}
             </div>
           </div>

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
                         <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                           ${orderTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                         </span>
                       </div>
                       <div className="flex justify-between items-center pt-2 border-t border-border">
                         <span className="text-base font-semibold text-foreground">Gross Profit % (Catalog):</span>
                         <span className="text-2xl font-bold text-brand-blue">{catalogGPPercent.toFixed(2)}%</span>
                       </div>
                       <div className="flex justify-between items-center pt-2">
                         <span className="text-base font-semibold text-foreground">Gross Profit $ (Catalog):</span>
                         <span className="text-2xl font-bold text-green-600 dark:text-green-400">${(orderTotal - catalogTotalCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
                             <div className="bg-amber-50 dark:bg-amber-500/10 rounded-lg p-3 text-sm text-foreground prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: privateNotes }} />
                           </div>
                         )}
                         {workOrderNotes && (
                           <div>
                             <p className="text-xs font-medium text-muted-foreground mb-1">Work Order Notes</p>
                             <div className="bg-brand-blue/12 rounded-lg p-3 text-sm text-foreground prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: workOrderNotes }} />
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
                        <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
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
          </motion.div>

          {/* RFMS Order Data - Admin Only */}
          {currentUser?.role === 'admin' && (
           <motion.div
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ delay: 0.65 }}
             className="bg-card rounded-2xl border border-border p-6 md:col-span-2 xl:col-span-3"
           >
             <div className="flex items-center justify-between mb-4">
               <div>
                 <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                   RFMS Order Data
                 </h2>
                 {sale.rfms_sync_date && (
                   <p className="text-xs text-muted-foreground mt-1">
                     Last synced: {format(parseISO(sale.rfms_sync_date), 'MMM d, yyyy h:mm a')}
                   </p>
                 )}
               </div>
               <div className="flex items-center gap-2">
                  {sale.rfms_order_data && (
                    <Button
                      onClick={handleSendGPAlert}
                      disabled={sendingGPAlert}
                      variant="outline"
                      size="sm"
                      className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
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
                    className="border-brand-blue/30 text-brand-blue hover:bg-brand-blue/12"
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
             </div>

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
           </motion.div>
          )}
          </div>
          </div>

          <CostBreakdownModal
        open={showCostBreakdown}
        onClose={setShowCostBreakdown}
        data={costBreakdownData}
      />

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
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
              className="bg-orange-600 hover:bg-orange-700"
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

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Sale</DialogTitle>
            <DialogDescription>
              This will permanently delete this sale record. The appointment will remain in "Sold" status. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => deleteSaleMutation.mutate()}
              disabled={deleteSaleMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:opacity-90"
            >
              {deleteSaleMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Sale'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replace Contract Dialog */}
      <Dialog open={showReplaceContractDialog} onOpenChange={setShowReplaceContractDialog}>
        <DialogContent className="max-w-md">
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
                <div className="p-3 bg-green-50 border border-green-200 dark:bg-green-500/10 dark:border-green-500/25 rounded-lg">
                  <p className="text-sm text-green-800 dark:text-green-300 flex items-center gap-2">
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