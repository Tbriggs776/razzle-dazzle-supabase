import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calculator, Package, ArrowRight, Ticket as TicketIcon, Plus, Loader2, CheckCircle2, AlertCircle, Pencil, Trash2, Bell, Sparkles, ExternalLink, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Paperclip, X, Image as ImageIcon, ChevronLeft, ChevronRight, XCircle, Send } from 'lucide-react';

const TICKET_CATEGORIES = [
  "Missing Moldings – Transitions",
  "Missing Moldings – Quarter Round",
  "Missing RFMS Product",
  "No Photos in Measure Mobile",
  "Photos Unlabeled in CompanyCam",
  "Contradicting Info (RFMS vs Notes)",
  "Install Method Mismatch (Click vs Glue)",
  "Finish Mismatch (Polished vs Matte)",
  "Incorrect Diagram Selected",
  "Multiple Diagrams – Not Identified",
  "Furniture Move Missing / Incorrect",
  "Demolition Missing / Incorrect",
  "No Diagram Provided",
  "Design Mod – Incomplete",
  "Order Shorts",
  "Material Delay",
  "Material Back-ordered",
  "Other"
];

export default function OrderProcessing() {
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingTicket, setEditingTicket] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [newTicket, setNewTicket] = useState({
    order_number: '',
    customer_last_name: '',
    categories: [],
    description: '',
    requester: '',
    assigned_dc: '',
    cc_members: []
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    retry: false
  });

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => base44.entities.Ticket.list('-created_date'),
    refetchInterval: 5000 // Poll every 5 seconds
  });

  const { data: ticketLogs = [] } = useQuery({
    queryKey: ['ticketLogs'],
    queryFn: () => base44.entities.TicketLog.list('-created_date'),
    refetchInterval: 5000
  });

  const { data: ticketMessages = [] } = useQuery({
    queryKey: ['ticketMessages'],
    queryFn: () => base44.entities.TicketMessage.list('created_date'),
    refetchInterval: 3000 // Poll messages more frequently
  });

  const [messageText, setMessageText] = useState({});
  const [uploadingFiles, setUploadingFiles] = useState({});
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerImages, setViewerImages] = useState([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const messagesEndRef = React.useRef({});

  const { data: designConsultants = [] } = useQuery({
    queryKey: ['designConsultants'],
    queryFn: async () => {
      const dcMembers = await base44.entities.TeamMember.filter({ role: 'Design Consultant' });
      const smMembers = await base44.entities.TeamMember.filter({ role: 'Sales Manager' });
      const adminMembers = await base44.entities.TeamMember.filter({ role: 'Admin' });
      const allMembers = [...dcMembers, ...smMembers, ...adminMembers];
      return allMembers.filter(m => m.is_active);
    }
  });

  const { data: orderProcessors = [] } = useQuery({
    queryKey: ['orderProcessors'],
    queryFn: async () => {
      const members = await base44.entities.TeamMember.filter({ role: 'Order Processor' });
      return members.filter(m => m.is_active);
    }
  });

  const { data: operationsMembers = [] } = useQuery({
    queryKey: ['operationsMembers'],
    queryFn: async () => {
      const members = await base44.entities.TeamMember.filter({ role: 'Operations' });
      return members.filter(m => m.is_active);
    }
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const user = await base44.auth.me();
      const ticket = await base44.entities.Ticket.create(data);
      
      // Log ticket creation
      await base44.entities.TicketLog.create({
        ticket: ticket.id,
        action: 'Ticket Created',
        details: `Order #${ticket.order_number}`,
        user_email: user.email,
        user_name: user.full_name
      });
      
      // Generate short URLs for DC and Requester ticket views
      if (ticket.id) {
        try {
          const updates = {};

          // Generate DC URL if assigned
          if (ticket.assigned_dc) {
            const dcTicketViewUrl = `${window.location.origin}/DesignConsultantTicketView?id=${ticket.id}`;
            const { data: dcShortUrlData } = await base44.functions.invoke('shortenUrl', {
              originalURL: dcTicketViewUrl
            });
            if (dcShortUrlData.shortURL) {
              updates.dc_short_url = dcShortUrlData.shortURL;
            }
          }

          // Generate Requester URL if requester exists
          if (data.requester) {
            const requesterTicketViewUrl = `${window.location.origin}/RequesterTicketView?id=${ticket.id}`;
            const { data: requesterShortUrlData } = await base44.functions.invoke('shortenUrl', {
              originalURL: requesterTicketViewUrl
            });
            if (requesterShortUrlData.shortURL) {
              updates.requester_short_url = requesterShortUrlData.shortURL;
            }
          }

          if (Object.keys(updates).length > 0) {
            await base44.entities.Ticket.update(ticket.id, updates);

            // Send SMS to DC if assigned
            if (updates.dc_short_url) {
              try {
                const settings = await base44.entities.SMSSettings.list();
                const smsSettings = settings[0] || {};

                if (smsSettings.send_dc_ticket_sms !== false) {
                  const dc = designConsultants.find(d => d.id === ticket.assigned_dc);
                  const requester = data.requester ? orderProcessors.find(op => op.id === data.requester) : null;

                  if (dc && dc.phone) {
                    const template = smsSettings.dc_ticket_assigned_template || 
                      'Hi {dc_first_name}! You have a new order processing ticket for Order #{order_number}. Please review and resolve: {ticket_url}';

                    const message = template
                      .replace(/{dc_first_name}/g, dc.first_name)
                      .replace(/{order_number}/g, ticket.order_number)
                      .replace(/{ticket_url}/g, updates.dc_short_url)
                      .replace(/{requester_first_name}/g, requester?.first_name || '');

                    const { data: smsResult } = await base44.functions.invoke('sendSMS', {
                      to: dc.phone,
                      message
                    });

                    // Log SMS result
                    await base44.entities.TicketLog.create({
                      ticket: ticket.id,
                      action: smsResult.success ? 'SMS Sent to DC' : 'SMS Failed to DC',
                      details: smsResult.success 
                        ? `Sent to ${dc.first_name} ${dc.last_name} at ${dc.phone} (Status: ${smsResult.twilioStatus})`
                        : `Failed to send to ${dc.first_name} ${dc.last_name} at ${dc.phone} (Error: ${smsResult.error || 'Unknown'})`,
                      user_email: user.email,
                      user_name: user.full_name
                    });
                  }
                }
              } catch (error) {
                console.error('Failed to send SMS:', error);
                await base44.entities.TicketLog.create({
                  ticket: ticket.id,
                  action: 'SMS Failed to DC',
                  details: `Error: ${error.message}`,
                  user_email: user.email,
                  user_name: user.full_name
                });
              }
            }

            // Send SMS to CC members
            if (data.cc_members && data.cc_members.length > 0) {
              const allMembers = await base44.entities.TeamMember.list();
              for (const memberId of data.cc_members) {
                const member = allMembers.find(m => m.id === memberId);
                if (member && member.phone) {
                  try {
                    const ccMessage = `Hi ${member.first_name}! A new order processing ticket has been created for Order #${ticket.order_number}. View ticket: ${updates.dc_short_url || ''}`;
                    const { data: smsResult } = await base44.functions.invoke('sendSMS', {
                      to: member.phone,
                      message: ccMessage
                    });
                    await base44.entities.TicketLog.create({
                      ticket: ticket.id,
                      action: smsResult.success ? 'SMS Sent to CC' : 'SMS Failed to CC',
                      details: smsResult.success
                        ? `CC notification sent to ${member.first_name} ${member.last_name} at ${member.phone}`
                        : `Failed to CC ${member.first_name} ${member.last_name} (Error: ${smsResult.error || 'Unknown'})`,
                      user_email: user.email,
                      user_name: user.full_name
                    });
                  } catch (error) {
                    console.error('Failed to send CC SMS:', error);
                  }
                }
              }
            }
            }
            } catch (error) {
            console.error('Failed to generate short URLs:', error);
            }
            }
      
      return ticket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticketLogs'] });
      setShowCreateDialog(false);
      setNewTicket({ order_number: '', customer_last_name: '', categories: [], description: '', requester: '', assigned_dc: '', cc_members: [] });
      toast.success('Ticket created successfully');
    }
  });

  const approveCategoryMutation = useMutation({
    mutationFn: async ({ ticketId, categoryIndex }) => {
      const ticket = tickets.find(t => t.id === ticketId);
      const updatedCategories = [...ticket.categories];
      const categoryName = updatedCategories[categoryIndex].name;
      updatedCategories[categoryIndex] = { ...updatedCategories[categoryIndex], status: 'Resolved' };

      await base44.entities.Ticket.update(ticketId, { categories: updatedCategories });

      const user = await base44.auth.me();
      await base44.entities.TicketLog.create({
        ticket: ticketId,
        action: 'Resolution Approved',
        details: categoryName,
        user_email: user.email,
        user_name: user.full_name
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticketLogs'] });
      toast.success('Resolution approved');
    }
  });

  const requestResolveMutation = useMutation({
    mutationFn: async ({ ticketId, categoryIndex }) => {
      const ticket = tickets.find(t => t.id === ticketId);
      const updatedCategories = [...ticket.categories];
      const categoryName = updatedCategories[categoryIndex].name;
      updatedCategories[categoryIndex] = { ...updatedCategories[categoryIndex], status: 'Requested Resolve', needs_additional_info: false };

      await base44.entities.Ticket.update(ticketId, { categories: updatedCategories });

      const user = await base44.auth.me();
      await base44.entities.TicketLog.create({
        ticket: ticketId,
        action: 'Resolution Requested',
        details: categoryName,
        user_email: user.email,
        user_name: user.full_name
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticketLogs'] });
      toast.success('Resolution requested');
    }
  });

  const denyCategoryMutation = useMutation({
    mutationFn: async ({ ticketId, categoryIndex }) => {
      const ticket = tickets.find(t => t.id === ticketId);
      const updatedCategories = [...ticket.categories];
      const categoryName = updatedCategories[categoryIndex].name;
      updatedCategories[categoryIndex] = { ...updatedCategories[categoryIndex], status: 'Open', needs_additional_info: true };

      await base44.entities.Ticket.update(ticketId, { categories: updatedCategories });

      const user = await base44.auth.me();
      await base44.entities.TicketLog.create({
        ticket: ticketId,
        action: 'Resolution Denied',
        details: categoryName,
        user_email: user.email,
        user_name: user.full_name
      });

      // Send SMS to DC
      if (ticket.assigned_dc) {
        try {
          const settings = await base44.entities.SMSSettings.list();
          const smsSettings = settings[0] || {};

          if (smsSettings.send_dc_resolution_denied_sms !== false) {
            const dcData = await base44.entities.TeamMember.filter({ id: ticket.assigned_dc });
            const dc = dcData[0];
            if (dc && dc.phone) {
              const template = smsSettings.dc_resolution_denied_template || 
                'Hi {dc_first_name}! Your resolution request for \'{category_name}\' on Order #{order_number} was denied by {denier_name}. Please review the ticket: {ticket_url}';

              const message = template
                .replace(/{dc_first_name}/g, dc.first_name)
                .replace(/{category_name}/g, categoryName)
                .replace(/{order_number}/g, ticket.order_number)
                .replace(/{denier_name}/g, user.full_name)
                .replace(/{ticket_url}/g, ticket.dc_short_url || '');

              const { data: smsResult } = await base44.functions.invoke('sendSMS', {
                to: dc.phone,
                message
              });

              await base44.entities.TicketLog.create({
                ticket: ticketId,
                action: smsResult.success ? 'SMS Sent to DC' : 'SMS Failed to DC',
                details: smsResult.success
                  ? `Notified about denied resolution: ${categoryName} (Status: ${smsResult.twilioStatus})`
                  : `Failed to notify about denied resolution: ${categoryName} (Error: ${smsResult.error || 'Unknown'})`,
                user_email: user.email,
                user_name: user.full_name
              });
            }
          }
        } catch (error) {
          console.error('Failed to send SMS to DC:', error);
          await base44.entities.TicketLog.create({
            ticket: ticketId,
            action: 'SMS Failed to DC',
            details: `Failed to notify about denied resolution: ${categoryName} (Error: ${error.message})`,
            user_email: user.email,
            user_name: user.full_name
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticketLogs'] });
      toast.success('Resolution denied');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Ticket.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      setShowEditDialog(false);
      setEditingTicket(null);
      toast.success('Ticket updated successfully');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Ticket.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast.success('Ticket deleted successfully');
    }
  });

  const sendReminderMutation = useMutation({
    mutationFn: async (ticketId) => {
      const ticket = tickets.find(t => t.id === ticketId);
      if (!ticket || !ticket.assigned_dc) {
        throw new Error('No DC assigned to this ticket');
      }

      const settings = await base44.entities.SMSSettings.list();
      const smsSettings = settings[0] || {};

      if (smsSettings.send_dc_ticket_reminder_sms === false) {
        throw new Error('DC ticket reminders are disabled');
      }

      const dcData = await base44.entities.TeamMember.filter({ id: ticket.assigned_dc });
      const dc = dcData[0];

      if (!dc || !dc.phone) {
        throw new Error('DC phone number not found');
      }

      const template = smsSettings.dc_ticket_reminder_template || 
        'Hi {dc_first_name}! Reminder: You have an open ticket for Order #{order_number}. Please review and resolve: {ticket_url}';

      const message = template
        .replace(/{dc_first_name}/g, dc.first_name)
        .replace(/{order_number}/g, ticket.order_number)
        .replace(/{ticket_url}/g, ticket.dc_short_url || '');

      const { data: smsResult } = await base44.functions.invoke('sendSMS', {
        to: dc.phone,
        message
      });

      const user = await base44.auth.me();
      await base44.entities.TicketLog.create({
        ticket: ticketId,
        action: smsResult.success ? 'Reminder SMS Sent to DC' : 'Reminder SMS Failed to DC',
        details: smsResult.success
          ? `Sent by ${user.full_name} to ${dc.phone} (Status: ${smsResult.twilioStatus})`
          : `Failed to send to ${dc.phone} (Error: ${smsResult.error || 'Unknown'})`,
        user_email: user.email,
        user_name: user.full_name
      });

      if (!smsResult.success) {
        throw new Error(smsResult.error || 'Failed to send SMS');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticketLogs'] });
      toast.success('Reminder sent to DC');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to send reminder');
    }
  });

  React.useEffect(() => {
    // Scroll to bottom of each ticket's messages when messages update
    Object.keys(messagesEndRef.current).forEach(ticketId => {
      messagesEndRef.current[ticketId]?.scrollIntoView({ behavior: 'smooth' });
    });
  }, [ticketMessages]);

  const scrollToBottom = (ticketId) => {
    setTimeout(() => {
      messagesEndRef.current[ticketId]?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const sendMessageMutation = useMutation({
    mutationFn: async ({ ticketId, message, fileUrls = [] }) => {
      const user = await base44.auth.me();
      const ticketMessage = await base44.entities.TicketMessage.create({
        ticket: ticketId,
        message,
        sender_email: user.email,
        sender_name: user.full_name,
        sender_role: 'Requester',
        file_urls: fileUrls
      });

      // Send SMS to DC (fire and forget, don't block message creation)
      const ticket = tickets.find(t => t.id === ticketId);
      if (ticket?.assigned_dc) {
        setTimeout(async () => {
          try {
            const settings = await base44.entities.SMSSettings.list();
            const smsSettings = settings[0] || {};

            if (smsSettings.send_ticket_message_sms !== false) {
              const dcData = await base44.entities.TeamMember.filter({ id: ticket.assigned_dc });
              const dc = dcData[0];
              if (dc && dc.phone) {
                const template = smsSettings.dc_new_message_template || 
                  'Hi {dc_first_name}! You have a new message on ticket for Order #{order_number} from {sender_name}: "{message}" View ticket: {ticket_url}';

                const smsText = template
                  .replace(/{dc_first_name}/g, dc.first_name)
                  .replace(/{order_number}/g, ticket.order_number)
                  .replace(/{sender_name}/g, user.full_name)
                  .replace(/{message}/g, message)
                  .replace(/{ticket_url}/g, ticket.dc_short_url || '');

                await base44.functions.invoke('sendSMS', {
                  to: dc.phone,
                  message: smsText
                });
              }
            }
          } catch (error) {
            console.error('Failed to send SMS to DC:', error);
          }
        }, 0);
      }

      return ticketMessage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticketMessages'] });
      setMessageText({});
    }
  });

  const getTicketStatus = (ticket) => {
    if (!ticket.categories || ticket.categories.length === 0) return 'Open';
    const resolved = ticket.categories.filter(c => c.status === 'Resolved').length;
    return resolved === ticket.categories.length ? 'Resolved' : 'Open';
  };

  const filteredTickets = filterStatus === 'all' 
    ? tickets 
    : tickets.filter(t => getTicketStatus(t) === filterStatus);

  const sortedTickets = [...filteredTickets].sort((a, b) => {
    const dateA = new Date(a.created_date);
    const dateB = new Date(b.created_date);
    return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
  });
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
              <Package className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Order Processing</h1>
              <p className="text-muted-foreground mt-1">Manage orders and calculate materials</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Quick Access Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Manage Orders Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="h-full relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full -mr-16 -mt-16 opacity-50" />
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-primary" />
                    Manage Orders
                  </CardTitle>
                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/25">
                    Coming Soon
                  </Badge>
                </div>
                <CardDescription className="mt-2">
                  Track and manage material orders for all projects
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    <span>Create and track orders</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    <span>Manage inventory</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    <span>Track delivery status</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Calculators Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Link to={createPageUrl('Calculators')}>
              <Card className="h-full hover:shadow-lg hover:border-primary/30 transition-all cursor-pointer group relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full -mr-16 -mt-16 opacity-50" />
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calculator className="w-5 h-5 text-primary" />
                      Calculators
                    </div>
                    <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                  </CardTitle>
                  <CardDescription className="mt-2">
                    Tools for material and cost calculations
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      <span>Glue usage calculator</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      <span>Optimal container mix</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      <span>Cost optimization</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        </div>

        {/* Ticket System */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <TicketIcon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Order Tickets</CardTitle>
                    <CardDescription className="mt-1">
                      Track issues and corrections for orders
                    </CardDescription>
                  </div>
                </div>
                <Button onClick={() => setShowCreateDialog(true)} className="bg-primary text-primary-foreground hover:opacity-90">
                  <Plus className="w-4 h-4 mr-2" />
                  New Ticket
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Filter Tabs and Sort */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={filterStatus === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterStatus('all')}
                    className={filterStatus === 'all' ? 'bg-primary text-primary-foreground hover:opacity-90' : ''}
                  >
                    All ({tickets.length})
                  </Button>
                  <Button
                    variant={filterStatus === 'Open' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterStatus('Open')}
                    className={filterStatus === 'Open' ? 'bg-red-600 hover:bg-red-700' : ''}
                  >
                    Open ({tickets.filter(t => getTicketStatus(t) === 'Open').length})
                  </Button>
                  <Button
                    variant={filterStatus === 'Resolved' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterStatus('Resolved')}
                    className={filterStatus === 'Resolved' ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    Resolved ({tickets.filter(t => getTicketStatus(t) === 'Resolved').length})
                  </Button>
                </div>
                <Select value={sortOrder} onValueChange={setSortOrder}>
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest First</SelectItem>
                    <SelectItem value="oldest">Oldest First</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Tickets List */}
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="text-center py-12">
                  <TicketIcon className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">
                    {filterStatus === 'all' ? 'No tickets yet' : `No ${filterStatus.toLowerCase()} tickets`}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedTickets.map((ticket) => {
                    const assignedDC = ticket.assigned_dc 
                      ? designConsultants.find(dc => dc.id === ticket.assigned_dc)
                      : null;
                    const requesterOP = ticket.requester
                      ? orderProcessors.find(op => op.id === ticket.requester)
                      : null;
                    const ticketStatus = getTicketStatus(ticket);
                    const resolvedCount = ticket.categories?.filter(c => c.status === 'Resolved').length || 0;
                    const totalCount = ticket.categories?.length || 0;
                    const logs = ticketLogs.filter(log => log.ticket === ticket.id);
                    const messages = ticketMessages.filter(msg => msg.ticket === ticket.id);

                    // Check for new messages (messages from DC in last 5 minutes)
                    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
                    const newMessages = messages.filter(msg => 
                      msg.sender_role === 'DC' && 
                      new Date(msg.created_date) > fiveMinutesAgo
                    );

                    // Check if ticket was recently updated (resolved in last 5 minutes)
                    const recentlyResolved = logs.some(log => 
                      log.action === 'Category Resolved' &&
                      new Date(log.created_date) > fiveMinutesAgo
                    );

                    return (
                      <div
                        key={ticket.id}
                        className={cn(
                          "p-4 rounded-lg border transition-all",
                          ticketStatus === 'Open'
                            ? "bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/25"
                            : "bg-green-50 border-green-200 dark:bg-green-500/10 dark:border-green-500/25"
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2 flex-wrap">
                              <Badge variant="secondary" className="bg-card border-border">
                                Order #{ticket.order_number}
                              </Badge>
                              {ticket.customer_last_name && (
                                <Badge variant="secondary" className="bg-secondary text-foreground border-border">
                                  {ticket.customer_last_name}
                                </Badge>
                              )}
                              <Badge 
                                variant="secondary" 
                                className={cn(
                                  "border",
                                  ticketStatus === 'Open' 
                                    ? "bg-red-100 text-red-800 border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25"
                                    : "bg-green-100 text-green-800 border-green-300 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25"
                                )}
                              >
                                {ticketStatus === 'Open' ? (
                                  <AlertCircle className="w-3 h-3 mr-1" />
                                ) : (
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                )}
                                {resolvedCount} of {totalCount} Resolved
                              </Badge>
                              {requesterOP && (
                                <Badge variant="secondary" className="bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/25">
                                  Req: {requesterOP.first_name} {requesterOP.last_name}
                                </Badge>
                              )}
                              {assignedDC && (
                                <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25">
                                  {assignedDC.first_name} {assignedDC.last_name}
                                </Badge>
                              )}
                              {assignedDC && ticketStatus === 'Open' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => sendReminderMutation.mutate(ticket.id)}
                                  disabled={sendReminderMutation.isPending}
                                  className="h-6 px-2 text-xs border-primary/30 text-primary hover:bg-primary/10"
                                >
                                  <Send className="w-3 h-3 mr-1" />
                                  Remind DC
                                </Button>
                              )}
                              {recentlyResolved && (
                                <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-300 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25 animate-pulse">
                                  <Sparkles className="w-3 h-3 mr-1" />
                                  Updated
                                </Badge>
                              )}
                            </div>
                            <div className="space-y-2 mb-3">
                              {ticket.categories && ticket.categories.length > 0 ? (
                                ticket.categories.map((cat, idx) => (
                                  <div key={idx} className={cn(
                                    "flex items-center justify-between gap-2 p-2 rounded border",
                                    cat.status === 'Resolved' 
                                      ? "bg-green-50 border-green-200 dark:bg-green-500/10 dark:border-green-500/25"
                                      : cat.status === 'Requested Resolve'
                                      ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-500/10 dark:border-yellow-500/25"
                                      : "bg-card border-border"
                                  )}>
                                    <div className="flex items-center gap-2 flex-1">
                                      {cat.status === 'Resolved' ? (
                                        <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400" />
                                      ) : cat.status === 'Requested Resolve' ? (
                                        <Clock className="w-3 h-3 text-yellow-600 dark:text-yellow-400" />
                                      ) : (
                                        <AlertCircle className="w-3 h-3 text-red-600 dark:text-red-400" />
                                      )}
                                      <span className={cn(
                                        "text-sm",
                                        cat.status === 'Resolved' ? "text-green-900 dark:text-green-300 line-through" : "text-foreground"
                                      )}>
                                        {cat.name}
                                      </span>
                                    </div>
                                    {cat.status === 'Requested Resolve' && (
                                      <div className="flex gap-1">
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => approveCategoryMutation.mutate({
                                            ticketId: ticket.id,
                                            categoryIndex: idx
                                          })}
                                          disabled={approveCategoryMutation.isPending || denyCategoryMutation.isPending}
                                          className="h-7 px-2 text-xs bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-500/15 dark:text-green-300 dark:hover:bg-green-500/25"
                                        >
                                          Approve
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => denyCategoryMutation.mutate({
                                            ticketId: ticket.id,
                                            categoryIndex: idx
                                          })}
                                          disabled={approveCategoryMutation.isPending || denyCategoryMutation.isPending}
                                          className="h-7 px-2 text-xs bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25"
                                        >
                                          Deny
                                        </Button>
                                      </div>
                                    )}
                                    {cat.status === 'Open' && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => requestResolveMutation.mutate({
                                          ticketId: ticket.id,
                                          categoryIndex: idx
                                        })}
                                        disabled={requestResolveMutation.isPending}
                                        className="h-7 px-2 text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25"
                                      >
                                        Request Resolved
                                      </Button>
                                    )}
                                    {cat.status === 'Resolved' && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => denyCategoryMutation.mutate({
                                          ticketId: ticket.id,
                                          categoryIndex: idx
                                        })}
                                        disabled={approveCategoryMutation.isPending || denyCategoryMutation.isPending}
                                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary"
                                      >
                                        Reopen
                                      </Button>
                                    )}
                                  </div>
                                ))
                              ) : (
                                <span className="text-sm text-muted-foreground">No categories</span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">{ticket.description}</p>
                            <p className="text-xs text-muted-foreground">
                              Created {new Date(ticket.created_date).toLocaleDateString()} at{' '}
                              {new Date(ticket.created_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>

                            {/* Chat Messages */}
                            <Accordion type="single" collapsible className="mt-3" onValueChange={(value) => value === 'chat' && scrollToBottom(ticket.id)}>
                              <AccordionItem value="chat" className="border-none">
                                <AccordionTrigger className="text-xs text-primary hover:no-underline py-2">
                                  <div className="flex items-center gap-2">
                                    💬 Chat ({messages.length})
                                    {newMessages.length > 0 && (
                                      <Badge className="bg-red-500 text-white h-5 min-w-5 flex items-center justify-center px-1.5 animate-pulse">
                                        {newMessages.length}
                                      </Badge>
                                    )}
                                  </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                  <div className="space-y-2 mt-2 max-h-64 overflow-y-auto">
                                    {messages.map((msg) => {
                                      const isImage = (url) => {
                                        // Check for image extensions in URL (including query params)
                                        return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url) || 
                                               url.includes('image');
                                      };
                                      const getFileName = (url) => {
                                        const parts = url.split('/');
                                        const filename = parts[parts.length - 1] || 'file';
                                        return filename.split('?')[0]; // Remove query params
                                      };

                                      // Get all images from this ticket's messages
                                      const allImages = messages
                                        .filter(m => m.file_urls && m.file_urls.length > 0)
                                        .flatMap(m => m.file_urls.filter(isImage));

                                      return (
                                        <div key={msg.id} className={cn(
                                          "text-xs p-2 rounded border",
                                          msg.sender_role === 'Requester' 
                                            ? "bg-primary/10 border-primary/30 ml-8" 
                                            : "bg-secondary border-border mr-8"
                                        )}>
                                          <p className="font-medium text-foreground">{msg.sender_name}</p>
                                          {msg.message && msg.message !== '(attached files)' && (
                                            <p className="text-muted-foreground mt-1">{msg.message}</p>
                                          )}
                                          {msg.file_urls && msg.file_urls.length > 0 && (
                                            <div className="flex flex-wrap gap-2 mt-2">
                                              {msg.file_urls.map((url, idx) => (
                                                isImage(url) ? (
                                                  <button
                                                    key={idx}
                                                    onClick={() => {
                                                      const imageIndex = allImages.indexOf(url);
                                                      setViewerImages(allImages);
                                                      setCurrentImageIndex(imageIndex);
                                                      setViewerOpen(true);
                                                    }}
                                                    className="block"
                                                  >
                                                    <img 
                                                      src={url} 
                                                      alt={`Attachment ${idx + 1}`}
                                                      className="max-w-[200px] max-h-[200px] rounded border border-border hover:opacity-90 cursor-pointer"
                                                    />
                                                  </button>
                                                ) : (
                                                  <a
                                                    key={idx}
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-1 px-2 py-1 bg-card border border-border rounded hover:bg-secondary"
                                                  >
                                                    <Paperclip className="w-3 h-3" />
                                                    <span className="text-xs">{getFileName(url)}</span>
                                                  </a>
                                                )
                                              ))}
                                            </div>
                                          )}
                                          <p className="text-muted-foreground mt-1">
                                            {new Date(msg.created_date).toLocaleDateString()} at{' '}
                                            {new Date(msg.created_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                          </p>
                                        </div>
                                      );
                                    })}
                                    <div ref={(el) => messagesEndRef.current[ticket.id] = el} />
                                  </div>
                                  <div className="mt-3 space-y-2">
                                    {uploadingFiles[ticket.id] && uploadingFiles[ticket.id].length > 0 && (
                                      <div className="flex flex-wrap gap-2">
                                        {uploadingFiles[ticket.id].map((file, idx) => (
                                          <div key={idx} className="flex items-center gap-1 px-2 py-1 bg-secondary border border-border rounded text-xs">
                                            <ImageIcon className="w-3 h-3" />
                                            <span className="truncate max-w-[100px]">{file.name}</span>
                                            <button
                                              onClick={() => {
                                                setUploadingFiles(prev => ({
                                                  ...prev,
                                                  [ticket.id]: prev[ticket.id].filter((_, i) => i !== idx)
                                                }));
                                              }}
                                              className="ml-1 hover:text-destructive"
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <div className="flex gap-2">
                                      <Input
                                        placeholder="Type a message..."
                                        value={messageText[ticket.id] || ''}
                                        onChange={(e) => setMessageText({ ...messageText, [ticket.id]: e.target.value })}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' && messageText[ticket.id]?.trim()) {
                                            sendMessageMutation.mutate({ 
                                              ticketId: ticket.id, 
                                              message: messageText[ticket.id].trim() 
                                            });
                                          }
                                        }}
                                        onPaste={async (e) => {
                                          const items = e.clipboardData?.items;
                                          if (!items) return;

                                          for (let i = 0; i < items.length; i++) {
                                            if (items[i].type.indexOf('image') !== -1) {
                                              e.preventDefault();
                                              const file = items[i].getAsFile();
                                              if (file) {
                                                setUploadingFiles(prev => ({
                                                  ...prev,
                                                  [ticket.id]: [...(prev[ticket.id] || []), file]
                                                }));
                                              }
                                            }
                                          }
                                        }}
                                        className="text-xs"
                                      />
                                      <input
                                        type="file"
                                        multiple
                                        accept="image/*"
                                        onChange={(e) => {
                                          const files = Array.from(e.target.files || []);
                                          if (files.length > 0) {
                                            setUploadingFiles(prev => ({
                                              ...prev,
                                              [ticket.id]: [...(prev[ticket.id] || []), ...files]
                                            }));
                                          }
                                          e.target.value = '';
                                        }}
                                        className="hidden"
                                        id={`file-upload-${ticket.id}`}
                                      />
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => document.getElementById(`file-upload-${ticket.id}`).click()}
                                        className="flex-shrink-0"
                                      >
                                        <Paperclip className="w-4 h-4" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        onClick={async () => {
                                          if (messageText[ticket.id]?.trim() || uploadingFiles[ticket.id]?.length > 0) {
                                            const fileUrls = [];
                                            if (uploadingFiles[ticket.id]?.length > 0) {
                                              for (const file of uploadingFiles[ticket.id]) {
                                                try {
                                                  const response = await base44.integrations.Core.UploadFile({ file });
                                                  fileUrls.push(response.file_url);
                                                } catch (error) {
                                                  console.error('File upload failed:', error);
                                                  toast.error('Failed to upload file');
                                                }
                                              }
                                            }
                                            sendMessageMutation.mutate({ 
                                              ticketId: ticket.id, 
                                              message: messageText[ticket.id]?.trim() || '(attached files)',
                                              fileUrls
                                            });
                                            setUploadingFiles(prev => ({ ...prev, [ticket.id]: [] }));
                                          }
                                        }}
                                        disabled={(!messageText[ticket.id]?.trim() && !uploadingFiles[ticket.id]?.length) || sendMessageMutation.isPending}
                                        className="bg-primary text-primary-foreground hover:opacity-90"
                                      >
                                        {sendMessageMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Send'}
                                      </Button>
                                    </div>
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            </Accordion>

                            {/* Activity Log */}
                            {logs.length > 0 && (
                              <Accordion type="single" collapsible className="mt-2">
                                <AccordionItem value="log" className="border-none">
                                  <AccordionTrigger className="text-xs text-muted-foreground hover:no-underline py-2">
                                    Activity Log ({logs.length})
                                  </AccordionTrigger>
                                  <AccordionContent>
                                    <div className="space-y-2 mt-2">
                                      {logs.map((log) => (
                                        <div key={log.id} className="text-xs p-2 bg-card rounded border border-border">
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1">
                                              <p className="font-medium text-foreground">{log.action}</p>
                                              {log.details && <p className="text-muted-foreground mt-0.5">{log.details}</p>}
                                              <p className="text-muted-foreground mt-1">
                                                {log.user_name} • {new Date(log.created_date).toLocaleDateString()} at{' '}
                                                {new Date(log.created_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                              </p>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            )}
                            </div>

                            <div className="flex gap-2 flex-shrink-0">
                            {currentUser?.role?.toLowerCase() === 'admin' && (
                              <>
                                {ticket.requester_short_url && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => window.open(ticket.requester_short_url, '_blank')}
                                    className="h-8 text-xs text-purple-600 hover:bg-purple-50 border-purple-200 dark:text-purple-300 dark:hover:bg-purple-500/10 dark:border-purple-500/30"
                                  >
                                    <ExternalLink className="w-3 h-3 mr-1" />
                                    Requester View
                                  </Button>
                                )}
                                {ticket.dc_short_url && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => window.open(ticket.dc_short_url, '_blank')}
                                    className="h-8 text-xs text-primary hover:bg-primary/10 border-primary/30"
                                  >
                                    <ExternalLink className="w-3 h-3 mr-1" />
                                    DC View
                                  </Button>
                                )}
                              </>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setEditingTicket(ticket);
                                setShowEditDialog(true);
                              }}
                              className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                if (confirm('Are you sure you want to delete this ticket?')) {
                                  deleteMutation.mutate(ticket.id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                            </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Create Ticket Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="order_number">Order Number *</Label>
                <Input
                  id="order_number"
                  placeholder="Enter order number"
                  value={newTicket.order_number}
                  onChange={(e) => setNewTicket({ ...newTicket, order_number: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer_last_name">Customer Last Name</Label>
                <Input
                  id="customer_last_name"
                  placeholder="Enter last name"
                  value={newTicket.customer_last_name}
                  onChange={(e) => setNewTicket({ ...newTicket, customer_last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Categories * (select all that apply)</Label>
              <div className="border border-border rounded-lg p-4 max-h-64 overflow-y-auto space-y-2">
                {TICKET_CATEGORIES.map((cat) => (
                  <div key={cat} className="flex items-center gap-2">
                  <Checkbox
                    id={`cat-${cat}`}
                    checked={newTicket.categories.some(c => c.name === cat)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setNewTicket({ ...newTicket, categories: [...newTicket.categories, { name: cat, status: 'Open' }] });
                      } else {
                        setNewTicket({ ...newTicket, categories: newTicket.categories.filter(c => c.name !== cat) });
                      }
                    }}
                  />
                  <Label htmlFor={`cat-${cat}`} className="cursor-pointer font-normal">
                    {cat}
                  </Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="requester">Requester (Order Processor)</Label>
              <Select value={newTicket.requester} onValueChange={(value) => setNewTicket({ ...newTicket, requester: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select requester (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  {orderProcessors.map((op) => (
                    <SelectItem key={op.id} value={op.id}>
                      {op.first_name} {op.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assigned_dc">Assign to Team Member</Label>
              <Select value={newTicket.assigned_dc} onValueChange={(value) => setNewTicket({ ...newTicket, assigned_dc: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select team member (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  {designConsultants.map((dc) => (
                    <SelectItem key={dc.id} value={dc.id}>
                      {dc.first_name} {dc.last_name} ({dc.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>CC (Text Notifications)</Label>
              <div className="border border-border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                {[...designConsultants, ...orderProcessors, ...operationsMembers]
                  .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
                  .map((member) => (
                  <div key={member.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`cc-${member.id}`}
                      checked={newTicket.cc_members.includes(member.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setNewTicket({ ...newTicket, cc_members: [...newTicket.cc_members, member.id] });
                        } else {
                          setNewTicket({ ...newTicket, cc_members: newTicket.cc_members.filter(id => id !== member.id) });
                        }
                      }}
                    />
                    <Label htmlFor={`cc-${member.id}`} className="cursor-pointer font-normal text-sm">
                      {member.first_name} {member.last_name} <span className="text-muted-foreground">({member.role})</span>
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                placeholder="Describe the issue..."
                value={newTicket.description}
                onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                className="min-h-24"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(newTicket)}
              disabled={!newTicket.order_number || newTicket.categories.length === 0 || !newTicket.description || createMutation.isPending}
              className="bg-primary text-primary-foreground hover:opacity-90"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Ticket
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Ticket Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_order_number">Order Number *</Label>
                <Input
                  id="edit_order_number"
                  placeholder="Enter order number"
                  value={editingTicket?.order_number || ''}
                  onChange={(e) => setEditingTicket({ ...editingTicket, order_number: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_customer_last_name">Customer Last Name</Label>
                <Input
                  id="edit_customer_last_name"
                  placeholder="Enter last name"
                  value={editingTicket?.customer_last_name || ''}
                  onChange={(e) => setEditingTicket({ ...editingTicket, customer_last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Categories * (select all that apply)</Label>
              <div className="border border-border rounded-lg p-4 max-h-64 overflow-y-auto space-y-2">
                {TICKET_CATEGORIES.map((cat) => (
                  <div key={cat} className="flex items-center gap-2">
                  <Checkbox
                    id={`edit-cat-${cat}`}
                    checked={editingTicket?.categories?.some(c => c.name === cat) || false}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setEditingTicket({ ...editingTicket, categories: [...(editingTicket.categories || []), { name: cat, status: 'Open' }] });
                      } else {
                        setEditingTicket({ ...editingTicket, categories: editingTicket.categories.filter(c => c.name !== cat) });
                      }
                    }}
                  />
                  <Label htmlFor={`edit-cat-${cat}`} className="cursor-pointer font-normal">
                    {cat}
                  </Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_requester">Requester (Order Processor)</Label>
              <Select value={editingTicket?.requester || ''} onValueChange={(value) => setEditingTicket({ ...editingTicket, requester: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select requester (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  {orderProcessors.map((op) => (
                    <SelectItem key={op.id} value={op.id}>
                      {op.first_name} {op.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_assigned_dc">Assign to Team Member</Label>
              <Select value={editingTicket?.assigned_dc || ''} onValueChange={(value) => setEditingTicket({ ...editingTicket, assigned_dc: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select team member (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  {designConsultants.map((dc) => (
                    <SelectItem key={dc.id} value={dc.id}>
                      {dc.first_name} {dc.last_name} ({dc.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_description">Description *</Label>
              <Textarea
                id="edit_description"
                placeholder="Describe the issue..."
                value={editingTicket?.description || ''}
                onChange={(e) => setEditingTicket({ ...editingTicket, description: e.target.value })}
                className="min-h-24"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowEditDialog(false);
                setEditingTicket(null);
              }}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => updateMutation.mutate({ 
                id: editingTicket.id, 
                data: {
                  order_number: editingTicket.order_number,
                  customer_last_name: editingTicket.customer_last_name,
                  categories: editingTicket.categories,
                  description: editingTicket.description,
                  requester: editingTicket.requester || null,
                  assigned_dc: editingTicket.assigned_dc || null
                }
              })}
              disabled={!editingTicket?.order_number || !editingTicket?.categories?.length || !editingTicket?.description || updateMutation.isPending}
              className="bg-primary text-primary-foreground hover:opacity-90"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Ticket'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Viewer Dialog */}
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-w-5xl p-0">
          <div className="relative bg-black">
            <button
              onClick={() => setViewerOpen(false)}
              className="absolute top-4 right-4 z-50 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
            >
              <XCircle className="w-6 h-6" />
            </button>

            {viewerImages.length > 1 && (
              <>
                <button
                  onClick={() => setCurrentImageIndex((currentImageIndex - 1 + viewerImages.length) % viewerImages.length)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 z-50 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
                >
                  <ChevronLeft className="w-8 h-8" />
                </button>
                <button
                  onClick={() => setCurrentImageIndex((currentImageIndex + 1) % viewerImages.length)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 z-50 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
                >
                  <ChevronRight className="w-8 h-8" />
                </button>
              </>
            )}

            <img
              src={viewerImages[currentImageIndex]}
              alt="Full size"
              className="w-full h-auto max-h-[90vh] object-contain"
            />

            {viewerImages.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/70 text-white text-sm rounded-full">
                {currentImageIndex + 1} / {viewerImages.length}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      </div>
      );
      }