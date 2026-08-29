import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { deliveryNote, invokeFailure, invokeNotSent } from '@/lib/invokeResult';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calculator, Package, ArrowRight, Ticket as TicketIcon, Plus, Loader2, CheckCircle2, AlertCircle, Pencil, Trash2, Sparkles, ExternalLink, Clock } from 'lucide-react';
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
import { SignedImage, SignedFileLink } from '@/lib/fileUrl';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import SyncBadge from '@/components/common/SyncBadge';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';

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
            const dcShortUrlRes = await base44.functions.invoke('shortenUrl', {
              originalURL: dcTicketViewUrl
            });
            if (dcShortUrlRes.data?.shortURL) {
              updates.dc_short_url = dcShortUrlRes.data.shortURL;
            } else {
              // The ticket is already saved and the DC text below only fires when
              // there is a link, so a failure here means nobody gets notified.
              const why = invokeFailure(dcShortUrlRes) || invokeNotSent(dcShortUrlRes) || 'the link could not be created';
              toast.warning(`Ticket created, but the design consultant was not texted — ${why}`);
            }
          }

          // Generate Requester URL if requester exists
          if (data.requester) {
            const requesterTicketViewUrl = `${window.location.origin}/RequesterTicketView?id=${ticket.id}`;
            const requesterShortUrlRes = await base44.functions.invoke('shortenUrl', {
              originalURL: requesterTicketViewUrl
            });
            if (requesterShortUrlRes.data?.shortURL) {
              updates.requester_short_url = requesterShortUrlRes.data.shortURL;
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

                    const smsRes = await base44.functions.invoke('sendSMS', {
                      to: dc.phone,
                      message
                    });
                    const smsResult = smsRes.data || {};
                    // The ticket is already committed — say the text did not go
                    // out, but let the success path finish.
                    const smsNote = deliveryNote(smsRes, {
                      saved: 'Ticket created',
                      sent: 'the text to the design consultant did not go out'
                    });
                    if (smsNote) toast.warning(smsNote);

                    // Log SMS result
                    await base44.entities.TicketLog.create({
                      ticket: ticket.id,
                      action: smsNote ? 'SMS Failed to DC' : 'SMS Sent to DC',
                      details: smsNote
                        ? `Failed to send to ${dc.first_name} ${dc.last_name} at ${dc.phone} (Error: ${smsResult.error || invokeFailure(smsRes) || invokeNotSent(smsRes) || 'Unknown'})`
                        : `Sent to ${dc.first_name} ${dc.last_name} at ${dc.phone} (Status: ${smsResult.twilioStatus})`,
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
              let ccNote = null;
              for (const memberId of data.cc_members) {
                const member = allMembers.find(m => m.id === memberId);
                if (member && member.phone) {
                  try {
                    const ccMessage = `Hi ${member.first_name}! A new order processing ticket has been created for Order #${ticket.order_number}. View ticket: ${updates.dc_short_url || ''}`;
                    const ccRes = await base44.functions.invoke('sendSMS', {
                      to: member.phone,
                      message: ccMessage
                    });
                    const smsResult = ccRes.data || {};
                    const thisNote = deliveryNote(ccRes, {
                      saved: 'Ticket created',
                      sent: 'at least one CC notification did not go out'
                    });
                    if (thisNote && !ccNote) ccNote = thisNote;
                    await base44.entities.TicketLog.create({
                      ticket: ticket.id,
                      action: thisNote ? 'SMS Failed to CC' : 'SMS Sent to CC',
                      details: thisNote
                        ? `Failed to CC ${member.first_name} ${member.last_name} (Error: ${smsResult.error || invokeFailure(ccRes) || invokeNotSent(ccRes) || 'Unknown'})`
                        : `CC notification sent to ${member.first_name} ${member.last_name} at ${member.phone}`,
                      user_email: user.email,
                      user_name: user.full_name
                    });
                  } catch (error) {
                    console.error('Failed to send CC SMS:', error);
                  }
                }
              }
              // One line for the whole CC list — the ticket itself is saved either way.
              if (ccNote) toast.warning(ccNote);
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

              const smsRes = await base44.functions.invoke('sendSMS', {
                to: dc.phone,
                message
              });
              const smsResult = smsRes.data || {};
              // The denial is already saved; only the notification can fail here.
              const smsNote = deliveryNote(smsRes, {
                saved: 'Resolution denied',
                sent: 'the text to the design consultant did not go out'
              });
              if (smsNote) toast.warning(smsNote);

              await base44.entities.TicketLog.create({
                ticket: ticketId,
                action: smsNote ? 'SMS Failed to DC' : 'SMS Sent to DC',
                details: smsNote
                  ? `Failed to notify about denied resolution: ${categoryName} (Error: ${smsResult.error || invokeFailure(smsRes) || invokeNotSent(smsRes) || 'Unknown'})`
                  : `Notified about denied resolution: ${categoryName} (Status: ${smsResult.twilioStatus})`,
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

      const smsRes = await base44.functions.invoke('sendSMS', {
        to: dc.phone,
        message
      });
      const smsResult = smsRes.data || {};
      const failed = invokeFailure(smsRes);
      const notSent = failed ? null : invokeNotSent(smsRes);

      const user = await base44.auth.me();
      await base44.entities.TicketLog.create({
        ticket: ticketId,
        action: (failed || notSent) ? 'Reminder SMS Failed to DC' : 'Reminder SMS Sent to DC',
        details: (failed || notSent)
          ? `Failed to send to ${dc.phone} (Error: ${smsResult.error || failed || notSent})`
          : `Sent by ${user.full_name} to ${dc.phone} (Status: ${smsResult.twilioStatus})`,
        user_email: user.email,
        user_name: user.full_name
      });

      // Sending the reminder IS the action here, so a real failure should throw
      // and offer a retry. "Nothing was sent" is not a failure — it comes back
      // below so onSuccess can say so plainly instead of claiming a send.
      if (failed) {
        throw new Error(failed);
      }
      return { notSent };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['ticketLogs'] });
      if (result?.notSent) {
        toast.warning(`No reminder was sent — ${result.notSent}`);
      } else {
        toast.success('Reminder sent to DC');
      }
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

  // Presentational rollups for the KPI grid (derived from the same status helper —
  // no change to fetch/filter/sort behavior).
  const openTicketsCount = tickets.filter(t => getTicketStatus(t) === 'Open').length;
  const resolvedTicketsCount = tickets.filter(t => getTicketStatus(t) === 'Resolved').length;
  const openLineItems = tickets.reduce(
    (sum, t) => sum + (t.categories?.filter(c => c.status !== 'Resolved').length || 0),
    0
  );

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Operations"
          title="Order Processing"
          subtitle="Track RFMS orders, resolve processing tickets, and calculate materials."
          actions={
            <Button variant="accent" onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Ticket
            </Button>
          }
        />

        {/* Ticket-state KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile
            label="Open Tickets"
            value={openTicketsCount}
            hero
            foot="Awaiting resolution"
          />
          <KpiTile
            label="Resolved"
            value={resolvedTicketsCount}
            foot="Fully closed out"
          />
          <KpiTile
            label="Total Tickets"
            value={tickets.length}
            foot="All order tickets"
          />
          <KpiTile
            label="Open Line Items"
            value={openLineItems}
            foot="Unresolved categories"
          />
        </div>

        {/* Quick access */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Manage Orders */}
          <Card className="relative h-full overflow-hidden">
            <div className="absolute right-0 top-0 -mr-16 -mt-16 h-32 w-32 rounded-full bg-primary/10 opacity-50" />
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-primary" />
                  Manage Orders
                </CardTitle>
                <StatusPill tone="neutral">Coming Soon</StatusPill>
              </div>
              <CardDescription className="mt-2">
                Track and manage material orders for all projects
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>Create and track orders</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>Manage inventory</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>Track delivery status</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Calculators */}
          <Link to={createPageUrl('Calculators')}>
            <Card className="group relative h-full cursor-pointer overflow-hidden transition-all hover:border-primary/30 hover:shadow-lg">
              <div className="absolute right-0 top-0 -mr-16 -mt-16 h-32 w-32 rounded-full bg-primary/10 opacity-50" />
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-5 w-5 text-primary" />
                    Calculators
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground transition-all group-hover:translate-x-1 group-hover:text-primary" />
                </CardTitle>
                <CardDescription className="mt-2">
                  Tools for material and cost calculations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    <span>Glue usage calculator</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    <span>Optimal container mix</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    <span>Cost optimization</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setFilterStatus('all')}
            className={cn(
              'whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              filterStatus === 'all'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-primary/40'
            )}
          >
            All ({tickets.length})
          </button>
          <button
            onClick={() => setFilterStatus('Open')}
            className={cn(
              'whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              filterStatus === 'Open'
                ? 'border-crit bg-crit text-background'
                : 'border-border bg-card text-muted-foreground hover:border-primary/40'
            )}
          >
            Open ({tickets.filter(t => getTicketStatus(t) === 'Open').length})
          </button>
          <button
            onClick={() => setFilterStatus('Resolved')}
            className={cn(
              'whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              filterStatus === 'Resolved'
                ? 'border-good bg-good text-background'
                : 'border-border bg-card text-muted-foreground hover:border-primary/40'
            )}
          >
            Resolved ({tickets.filter(t => getTicketStatus(t) === 'Resolved').length})
          </button>
        </div>

        {/* Ticket list */}
        <ModuleCard
          title="Order Tickets"
          subtitle={`${filteredTickets.length} ${filteredTickets.length === 1 ? 'ticket' : 'tickets'}${filterStatus !== 'all' ? ` · ${filterStatus}` : ''}`}
          icon={TicketIcon}
          bodyClassName="p-4"
          action={
            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectTrigger className="h-9 w-40 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
              </SelectContent>
            </Select>
          }
        >
          <div>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : filteredTickets.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <TicketIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                <h3 className="text-sm font-semibold text-foreground">
                  {filterStatus === 'all' ? 'No tickets yet' : `No ${filterStatus.toLowerCase()} tickets`}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Order processing tickets will appear here.
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
                        "rounded-xl border p-4 transition-colors",
                        ticketStatus === 'Open'
                          ? "border-crit/25 bg-crit/5"
                          : "border-good/25 bg-good/5"
                      )}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="font-display text-sm font-bold tracking-tight text-foreground">
                              Order #{ticket.order_number}
                            </span>
                            <SyncBadge status="synced" />
                            {ticket.customer_last_name && (
                              <StatusPill tone="neutral">{ticket.customer_last_name}</StatusPill>
                            )}
                            <StatusPill tone={ticketStatus === 'Open' ? 'crit' : 'good'} dot>
                              {resolvedCount} of {totalCount} Resolved
                            </StatusPill>
                            {requesterOP && (
                              <StatusPill tone="info">
                                Req · {requesterOP.first_name} {requesterOP.last_name}
                              </StatusPill>
                            )}
                            {assignedDC && (
                              <StatusPill tone="neutral">
                                {assignedDC.first_name} {assignedDC.last_name}
                              </StatusPill>
                            )}
                            {assignedDC && ticketStatus === 'Open' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => sendReminderMutation.mutate(ticket.id)}
                                disabled={sendReminderMutation.isPending}
                                className="h-6 border-primary/30 px-2 text-xs text-primary hover:bg-primary/10"
                              >
                                <Send className="mr-1 h-3 w-3" />
                                Remind DC
                              </Button>
                            )}
                            {recentlyResolved && (
                              <StatusPill tone="good" className="animate-pulse">
                                <Sparkles className="h-3 w-3" />
                                Updated
                              </StatusPill>
                            )}
                          </div>
                          <div className="mb-3 space-y-2">
                            {ticket.categories && ticket.categories.length > 0 ? (
                              ticket.categories.map((cat, idx) => (
                                <div key={idx} className={cn(
                                  "flex items-center justify-between gap-2 rounded-lg border p-2",
                                  cat.status === 'Resolved'
                                    ? "border-good/25 bg-good/10"
                                    : cat.status === 'Requested Resolve'
                                    ? "border-warn/25 bg-warn/10"
                                    : "border-border bg-card"
                                )}>
                                  <div className="flex flex-1 items-center gap-2">
                                    {cat.status === 'Resolved' ? (
                                      <CheckCircle2 className="h-3 w-3 text-good" />
                                    ) : cat.status === 'Requested Resolve' ? (
                                      <Clock className="h-3 w-3 text-warn" />
                                    ) : (
                                      <AlertCircle className="h-3 w-3 text-crit" />
                                    )}
                                    <span className={cn(
                                      "text-sm",
                                      cat.status === 'Resolved' ? "text-muted-foreground line-through" : "text-foreground"
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
                                        className="h-7 bg-good/15 px-2 text-xs text-good hover:bg-good/25"
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
                                        className="h-7 bg-crit/15 px-2 text-xs text-crit hover:bg-crit/25"
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
                                      className="h-7 bg-info/15 px-2 text-xs text-info hover:bg-info/25"
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
                                      className="h-7 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
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
                          <p className="mb-2 text-sm text-muted-foreground">{ticket.description}</p>
                          <p className="text-xs text-muted-foreground">
                            Created {new Date(ticket.created_date).toLocaleDateString()} at{' '}
                            {new Date(ticket.created_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>

                          {/* Chat Messages */}
                          <Accordion type="single" collapsible className="mt-3" onValueChange={(value) => value === 'chat' && scrollToBottom(ticket.id)}>
                            <AccordionItem value="chat" className="border-none">
                              <AccordionTrigger className="py-2 text-xs text-primary hover:no-underline">
                                <div className="flex items-center gap-2">
                                  💬 Chat ({messages.length})
                                  {newMessages.length > 0 && (
                                    <span className="inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-crit px-1.5 text-[11px] font-bold text-background">
                                      {newMessages.length}
                                    </span>
                                  )}
                                </div>
                              </AccordionTrigger>
                              <AccordionContent>
                                <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
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
                                        "rounded-lg border p-2 text-xs",
                                        msg.sender_role === 'Requester'
                                          ? "ml-8 border-primary/30 bg-primary/10"
                                          : "mr-8 border-border bg-secondary"
                                      )}>
                                        <p className="font-medium text-foreground">{msg.sender_name}</p>
                                        {msg.message && msg.message !== '(attached files)' && (
                                          <p className="mt-1 break-words text-muted-foreground">{msg.message}</p>
                                        )}
                                        {msg.file_urls && msg.file_urls.length > 0 && (
                                          <div className="mt-2 flex flex-wrap gap-2">
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
                                                  <SignedImage
                                                    src={url}
                                                    alt={`Attachment ${idx + 1}`}
                                                    className="max-h-[200px] max-w-[200px] cursor-pointer rounded border border-border hover:opacity-90"
                                                  />
                                                </button>
                                              ) : (
                                                <SignedFileLink
                                                  key={idx}
                                                  src={url}
                                                  className="flex items-center gap-1 rounded border border-border bg-card px-2 py-1 hover:bg-secondary"
                                                >
                                                  <Paperclip className="h-3 w-3 shrink-0" />
                                                  <span className="max-w-[160px] truncate text-xs">{getFileName(url)}</span>
                                                </SignedFileLink>
                                              )
                                            ))}
                                          </div>
                                        )}
                                        <p className="mt-1 text-muted-foreground">
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
                                        <div key={idx} className="flex items-center gap-1 rounded border border-border bg-secondary px-2 py-1 text-xs">
                                          <ImageIcon className="h-3 w-3" />
                                          <span className="max-w-[100px] truncate">{file.name}</span>
                                          <button
                                            onClick={() => {
                                              setUploadingFiles(prev => ({
                                                ...prev,
                                                [ticket.id]: prev[ticket.id].filter((_, i) => i !== idx)
                                              }));
                                            }}
                                            className="ml-1 hover:text-destructive"
                                          >
                                            <X className="h-3 w-3" />
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
                                      <Paperclip className="h-4 w-4" />
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
                                    >
                                      {sendMessageMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Send'}
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
                                <AccordionTrigger className="py-2 text-xs text-muted-foreground hover:no-underline">
                                  Activity Log ({logs.length})
                                </AccordionTrigger>
                                <AccordionContent>
                                  <div className="mt-2 space-y-2">
                                    {logs.map((log) => (
                                      <div key={log.id} className="rounded border border-border bg-card p-2 text-xs">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="flex-1">
                                            <p className="font-medium text-foreground">{log.action}</p>
                                            {log.details && <p className="mt-0.5 text-muted-foreground">{log.details}</p>}
                                            <p className="mt-1 text-muted-foreground">
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

                          <div className="flex flex-wrap justify-end gap-2 sm:flex-shrink-0">
                          {currentUser?.role?.toLowerCase() === 'admin' && (
                            <>
                              {ticket.requester_short_url && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => window.open(ticket.requester_short_url, '_blank')}
                                  className="h-8 border-info/30 text-xs text-info hover:bg-info/10"
                                >
                                  <ExternalLink className="mr-1 h-3 w-3" />
                                  Requester View
                                </Button>
                              )}
                              {ticket.dc_short_url && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => window.open(ticket.dc_short_url, '_blank')}
                                  className="h-8 border-primary/30 text-xs text-primary hover:bg-primary/10"
                                >
                                  <ExternalLink className="mr-1 h-3 w-3" />
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
                            className="h-8 w-8 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          >
                            <Pencil className="h-4 w-4" />
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
                            className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ModuleCard>
      </div>

      {/* Create Ticket Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-4">
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
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
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
                    <Label htmlFor={`cc-${member.id}`} className="cursor-pointer text-sm font-normal">
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
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Ticket
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Ticket Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-4">
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
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
              className="absolute right-4 top-4 z-50 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
            >
              <XCircle className="h-6 w-6" />
            </button>

            {viewerImages.length > 1 && (
              <>
                <button
                  onClick={() => setCurrentImageIndex((currentImageIndex - 1 + viewerImages.length) % viewerImages.length)}
                  className="absolute left-4 top-1/2 z-50 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
                >
                  <ChevronLeft className="h-8 w-8" />
                </button>
                <button
                  onClick={() => setCurrentImageIndex((currentImageIndex + 1) % viewerImages.length)}
                  className="absolute right-4 top-1/2 z-50 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
                >
                  <ChevronRight className="h-8 w-8" />
                </button>
              </>
            )}

            <SignedImage
              src={viewerImages[currentImageIndex]}
              alt="Full size"
              className="h-auto max-h-[90vh] w-full object-contain"
            />

            {viewerImages.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-sm text-white">
                {currentImageIndex + 1} / {viewerImages.length}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      </div>
      );
      }
