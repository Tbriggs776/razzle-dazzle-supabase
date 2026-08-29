import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { announceDelivery } from '@/lib/deliveryToast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Loader2, CheckCircle2, AlertCircle, Clock, ExternalLink, Plus, Paperclip, X, Image as ImageIcon, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';
import { SignedImage, SignedFileLink } from '@/lib/fileUrl';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import WorkRow from '@/components/dashboard/WorkRow';

export default function MyTickets() {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [messageText, setMessageText] = useState({});
  const [uploadingFiles, setUploadingFiles] = useState({});
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerImages, setViewerImages] = useState([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const messagesEndRef = React.useRef({});

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: currentTeamMember } = useQuery({
    queryKey: ['currentTeamMember', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return null;
      const members = await base44.entities.TeamMember.filter({ email: currentUser.email });
      return members[0];
    },
    enabled: !!currentUser?.email
  });

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['myTickets', currentTeamMember?.id],
    queryFn: async () => {
      if (!currentTeamMember?.id) return [];
      return await base44.entities.Ticket.filter({ requester: currentTeamMember.id }, '-created_date');
    },
    enabled: !!currentTeamMember?.id,
    refetchInterval: 5000
  });

  const { data: ticketLogs = [] } = useQuery({
    queryKey: ['ticketLogs'],
    queryFn: () => base44.entities.TicketLog.list('-created_date'),
    refetchInterval: 5000
  });

  const { data: ticketMessages = [] } = useQuery({
    queryKey: ['ticketMessages'],
    queryFn: () => base44.entities.TicketMessage.list('created_date'),
    refetchInterval: 3000
  });

  const { data: designConsultants = [] } = useQuery({
    queryKey: ['designConsultants'],
    queryFn: async () => {
      const dcMembers = await base44.entities.TeamMember.filter({ role: 'Design Consultant' });
      const smMembers = await base44.entities.TeamMember.filter({ role: 'Sales Manager' });
      return [...dcMembers, ...smMembers].filter(m => m.is_active);
    }
  });

  React.useEffect(() => {
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

      // Send SMS to DC
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
                const template = smsSettings.requester_new_message_template ||
                  'Hi {dc_first_name}! You have a new message on ticket for Order #{order_number} from {sender_name}: "{message}" View ticket: {ticket_url}';

                const smsText = template
                  .replace(/{dc_first_name}/g, dc.first_name)
                  .replace(/{order_number}/g, ticket.order_number)
                  .replace(/{sender_name}/g, user.full_name)
                  .replace(/{message}/g, message)
                  .replace(/{ticket_url}/g, ticket.dc_short_url || '');

                // The message is already posted to the ticket; this only tells
                // the consultant about it, and it failed silently.
                await announceDelivery(
                  base44.functions.invoke('sendSMS', { to: dc.phone, message: smsText }),
                  { saved: 'Message posted', sent: 'the consultant was not texted' },
                );
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

  if (!currentUser || !currentTeamMember) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const openCount = tickets.filter(t => getTicketStatus(t) === 'Open').length;
  const resolvedCount = tickets.filter(t => getTicketStatus(t) === 'Resolved').length;

  const statusTabs = [
    { key: 'all', label: 'All', count: tickets.length },
    { key: 'Open', label: 'Open', count: openCount },
    { key: 'Resolved', label: 'Resolved', count: resolvedCount },
  ];

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Support"
          title="My Tickets"
          subtitle="Track your submitted order tickets."
          actions={
            <Link to={createPageUrl('SubmitTicket')}>
              <Button variant="accent">
                <Plus className="mr-2 h-4 w-4" />
                Submit New Ticket
              </Button>
            </Link>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile label="Total Tickets" value={tickets.length} foot="All tickets you've submitted" />
          <KpiTile label="Open" value={openCount} hero foot="Awaiting resolution" />
          <KpiTile label="Resolved" value={resolvedCount} foot="All categories closed" />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-center gap-0.5 self-start rounded-lg border border-border bg-muted/50 p-0.5">
            {statusTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilterStatus(tab.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                  filterStatus === tab.key
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
                <span className="ml-1.5 tabular-nums opacity-60">{tab.count}</span>
              </button>
            ))}
          </div>
          <Select value={sortOrder} onValueChange={setSortOrder}>
            <SelectTrigger className="h-9 w-full bg-card sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <ModuleCard
          title="Your Tickets"
          subtitle={`${filteredTickets.length} ${filteredTickets.length === 1 ? 'ticket' : 'tickets'}${filterStatus !== 'all' ? ` · ${filterStatus}` : ''}`}
          icon={ClipboardCheck}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <ClipboardCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <h3 className="text-sm font-semibold text-foreground">
                {filterStatus === 'all' ? 'No tickets yet' : `No ${filterStatus.toLowerCase()} tickets`}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Your submitted order tickets will appear here.
              </p>
              <Link to={createPageUrl('SubmitTicket')} className="mt-4 inline-block">
                <Button variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Submit Your First Ticket
                </Button>
              </Link>
            </div>
          ) : (
            sortedTickets.map((ticket) => {
              const assignedDC = ticket.assigned_dc
                ? designConsultants.find(dc => dc.id === ticket.assigned_dc)
                : null;
              const ticketStatus = getTicketStatus(ticket);
              const resolvedCatCount = ticket.categories?.filter(c => c.status === 'Resolved').length || 0;
              const totalCount = ticket.categories?.length || 0;
              const meta = [
                `${new Date(ticket.created_date).toLocaleDateString()} · ${new Date(ticket.created_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                assignedDC && `Assigned ${assignedDC.first_name} ${assignedDC.last_name}`,
              ].filter(Boolean).join('  ·  ');

              return (
                <div key={ticket.id}>
                  <WorkRow
                    lead={totalCount ? `${resolvedCatCount}/${totalCount}` : '—'}
                    primary={`Order #${ticket.order_number}${ticket.customer_last_name ? ` · ${ticket.customer_last_name}` : ''}`}
                    meta={meta}
                    trailing={
                      <div className="flex items-center gap-2">
                        <StatusPill tone={ticketStatus === 'Open' ? 'warn' : 'good'} dot>
                          {ticketStatus}
                        </StatusPill>
                        {ticket.requester_short_url && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(ticket.requester_short_url, '_blank')}
                            className="h-8 text-xs"
                          >
                            <ExternalLink className="mr-1 h-3 w-3" />
                            View Details
                          </Button>
                        )}
                      </div>
                    }
                  />

                  <div className="space-y-3 px-4 pb-4">
                    {/* Category checklist */}
                    {ticket.categories && ticket.categories.length > 0 ? (
                      <div className="space-y-1.5">
                        {ticket.categories.map((cat, idx) => {
                          const resolved = cat.status === 'Resolved';
                          const requested = cat.status === 'Requested Resolve';
                          const CatIcon = resolved ? CheckCircle2 : requested ? Clock : AlertCircle;
                          return (
                            <div key={idx} className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
                              <CatIcon className={cn('h-3.5 w-3.5 shrink-0', resolved ? 'text-good' : requested ? 'text-warn' : 'text-muted-foreground')} />
                              <span className={cn('text-sm', resolved ? 'text-muted-foreground line-through' : 'text-foreground')}>
                                {cat.name}
                              </span>
                              {requested && (
                                <StatusPill tone="warn" className="ml-auto">Pending Approval</StatusPill>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No categories</p>
                    )}

                    {ticket.description && (
                      <p className="text-sm text-muted-foreground">{ticket.description}</p>
                    )}

                    {/* Chat Messages */}
                    <Accordion type="single" collapsible onValueChange={(value) => value === 'chat' && scrollToBottom(ticket.id)}>
                      <AccordionItem value="chat" className="border-none">
                        <AccordionTrigger className="py-2 text-xs font-semibold text-primary hover:no-underline">
                          <div className="flex items-center gap-2">
                            💬 Chat ({ticketMessages.filter(m => m.ticket === ticket.id).length})
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                            {ticketMessages.filter(m => m.ticket === ticket.id).map((msg) => {
                              const isImage = (url) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url) || url.includes('image');
                              const getFileName = (url) => {
                                const parts = url.split('/');
                                const filename = parts[parts.length - 1] || 'file';
                                return filename.split('?')[0];
                              };

                              const allImages = ticketMessages
                                .filter(m => m.ticket === ticket.id && m.file_urls && m.file_urls.length > 0)
                                .flatMap(m => m.file_urls.filter(isImage));

                              return (
                                <div key={msg.id} className={cn(
                                  "rounded border p-2 text-xs",
                                  msg.sender_role === 'Requester'
                                    ? "ml-8 border-primary/20 bg-primary/10"
                                    : "mr-8 border-border bg-secondary"
                                )}>
                                  <p className="font-medium text-foreground">{msg.sender_name}</p>
                                  {msg.message && msg.message !== '(attached files)' && (
                                    <p className="mt-1 text-muted-foreground">{msg.message}</p>
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
                                            <Paperclip className="h-3 w-3" />
                                            <span className="text-xs">{getFileName(url)}</span>
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
                                className="bg-primary text-primary-foreground hover:opacity-90"
                              >
                                {sendMessageMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Send'}
                              </Button>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

                    {/* Activity Log */}
                    {ticketLogs.filter(log => log.ticket === ticket.id).length > 0 && (
                      <Accordion type="single" collapsible>
                        <AccordionItem value="log" className="border-none">
                          <AccordionTrigger className="py-2 text-xs text-muted-foreground hover:no-underline">
                            Activity Log ({ticketLogs.filter(log => log.ticket === ticket.id).length})
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="mt-2 space-y-2">
                              {ticketLogs.filter(log => log.ticket === ticket.id).map((log) => (
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
                </div>
              );
            })
          )}
        </ModuleCard>
      </div>

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
