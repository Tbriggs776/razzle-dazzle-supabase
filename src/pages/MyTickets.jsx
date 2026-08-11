import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardCheck, Loader2, CheckCircle2, AlertCircle, Clock, ExternalLink, Plus, Paperclip, X, Image as ImageIcon, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';
import { SignedImage, SignedFileLink } from '@/lib/fileUrl';
import { motion } from 'framer-motion';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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

  if (!currentUser || !currentTeamMember) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
                <ClipboardCheck className="w-7 h-7 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground tracking-tight">My Tickets</h1>
                <p className="text-muted-foreground mt-1">Track your submitted order tickets</p>
              </div>
            </div>
            <Link to={createPageUrl('SubmitTicket')}>
              <Button className="bg-primary text-primary-foreground hover:opacity-90">
                <Plus className="w-4 h-4 mr-2" />
                Submit New Ticket
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-primary" />
                Your Tickets
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Filter Tabs and Sort */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-2 flex-nowrap overflow-x-auto pb-1">
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
                    className={filterStatus === 'Open' ? 'bg-red-600 hover:bg-red-700 text-white' : ''}
                  >
                    Open ({tickets.filter(t => getTicketStatus(t) === 'Open').length})
                  </Button>
                  <Button
                    variant={filterStatus === 'Resolved' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterStatus('Resolved')}
                    className={filterStatus === 'Resolved' ? 'bg-green-600 hover:bg-green-700 text-white' : ''}
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
                  <ClipboardCheck className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-muted-foreground mb-4">
                    {filterStatus === 'all' ? 'No tickets yet' : `No ${filterStatus.toLowerCase()} tickets`}
                  </p>
                  <Link to={createPageUrl('SubmitTicket')}>
                    <Button variant="outline">
                      <Plus className="w-4 h-4 mr-2" />
                      Submit Your First Ticket
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedTickets.map((ticket) => {
                    const assignedDC = ticket.assigned_dc 
                      ? designConsultants.find(dc => dc.id === ticket.assigned_dc)
                      : null;
                    const ticketStatus = getTicketStatus(ticket);
                    const resolvedCount = ticket.categories?.filter(c => c.status === 'Resolved').length || 0;
                    const totalCount = ticket.categories?.length || 0;

                    return (
                      <div
                        key={ticket.id}
                        className={cn(
                          "p-4 rounded-lg border transition-all",
                          ticketStatus === 'Open'
                            ? "bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/20"
                            : "bg-green-50 border-green-200 dark:bg-green-500/10 dark:border-green-500/20"
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2 flex-wrap">
                              <Badge variant="secondary" className="bg-card border-border">
                                Order #{ticket.order_number}
                              </Badge>
                              {ticket.customer_last_name && (
                                <Badge variant="secondary" className="bg-secondary text-secondary-foreground border-border">
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
                              {assignedDC && (
                                <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25">
                                  Assigned: {assignedDC.first_name} {assignedDC.last_name}
                                </Badge>
                              )}
                            </div>

                            <div className="space-y-2 mb-3">
                              {ticket.categories && ticket.categories.length > 0 ? (
                                ticket.categories.map((cat, idx) => (
                                  <div key={idx} className={cn(
                                    "flex items-center gap-2 p-2 rounded border",
                                    cat.status === 'Resolved'
                                      ? "bg-green-50 border-green-200 dark:bg-green-500/10 dark:border-green-500/20"
                                      : cat.status === 'Requested Resolve'
                                      ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-500/10 dark:border-yellow-500/20"
                                      : "bg-card border-border"
                                  )}>
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
                                    {cat.status === 'Requested Resolve' && (
                                      <Badge variant="secondary" className="ml-auto bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/25 text-xs">
                                        Pending Approval
                                      </Badge>
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
                                    💬 Chat ({ticketMessages.filter(m => m.ticket === ticket.id).length})
                                  </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                  <div className="space-y-2 mt-2 max-h-64 overflow-y-auto">
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
                                          "text-xs p-2 rounded border",
                                          msg.sender_role === 'Requester'
                                            ? "bg-primary/10 border-primary/20 ml-8"
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
                                                    <SignedImage
                                                      src={url}
                                                      alt={`Attachment ${idx + 1}`}
                                                      className="max-w-[200px] max-h-[200px] rounded border border-border hover:opacity-90 cursor-pointer"
                                                    />
                                                  </button>
                                                ) : (
                                                  <SignedFileLink
                                                    key={idx}
                                                    src={url}
                                                    className="flex items-center gap-1 px-2 py-1 bg-card border border-border rounded hover:bg-secondary"
                                                  >
                                                    <Paperclip className="w-3 h-3" />
                                                    <span className="text-xs">{getFileName(url)}</span>
                                                  </SignedFileLink>
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
                            {ticketLogs.filter(log => log.ticket === ticket.id).length > 0 && (
                              <Accordion type="single" collapsible className="mt-2">
                                <AccordionItem value="log" className="border-none">
                                  <AccordionTrigger className="text-xs text-muted-foreground hover:no-underline py-2">
                                    Activity Log ({ticketLogs.filter(log => log.ticket === ticket.id).length})
                                  </AccordionTrigger>
                                  <AccordionContent>
                                    <div className="space-y-2 mt-2">
                                      {ticketLogs.filter(log => log.ticket === ticket.id).map((log) => (
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
                            {ticket.requester_short_url && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.open(ticket.requester_short_url, '_blank')}
                                className="h-8 text-xs"
                              >
                                <ExternalLink className="w-3 h-3 mr-1" />
                                View Details
                              </Button>
                            )}
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

            <SignedImage
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