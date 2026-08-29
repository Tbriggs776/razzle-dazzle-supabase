import React from 'react';
import { base44 } from '@/api/base44Client';
import { announceDelivery } from '@/lib/deliveryToast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, AlertCircle, Package, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Paperclip, X, Image as ImageIcon, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';
import { SignedImage, SignedFileLink } from '@/lib/fileUrl';
import StatusPill from '@/components/common/StatusPill';

export default function DesignConsultantTicketView() {
  const urlParams = new URLSearchParams(window.location.search);
  const ticketId = urlParams.get('id');
  const queryClient = useQueryClient();

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: async () => {
      const tickets = await base44.entities.Ticket.filter({ id: ticketId });
      return tickets[0];
    },
    enabled: !!ticketId,
    refetchInterval: 5000 // Poll ticket status every 5 seconds
  });

  const { data: assignedDC } = useQuery({
    queryKey: ['assignedDC', ticket?.assigned_dc],
    queryFn: async () => {
      if (!ticket?.assigned_dc) return null;
      const members = await base44.entities.TeamMember.filter({ id: ticket.assigned_dc });
      return members[0];
    },
    enabled: !!ticket?.assigned_dc
  });

  const { data: requester } = useQuery({
    queryKey: ['requester', ticket?.requester],
    queryFn: async () => {
      if (!ticket?.requester) return null;
      const members = await base44.entities.TeamMember.filter({ id: ticket.requester });
      return members[0];
    },
    enabled: !!ticket?.requester
  });

  const { data: ticketLogs = [] } = useQuery({
    queryKey: ['ticketLogs', ticketId],
    queryFn: async () => {
      const logs = await base44.entities.TicketLog.filter({ ticket: ticketId });
      return logs.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    },
    enabled: !!ticketId
  });

  const { data: ticketMessages = [] } = useQuery({
    queryKey: ['ticketMessages', ticketId],
    queryFn: async () => {
      const messages = await base44.entities.TicketMessage.filter({ ticket: ticketId });
      return messages.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    },
    enabled: !!ticketId,
    refetchInterval: 3000 // Poll messages every 3 seconds
  });

  const [messageText, setMessageText] = React.useState('');
  const [uploadingFiles, setUploadingFiles] = React.useState([]);
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerImages, setViewerImages] = React.useState([]);
  const [currentImageIndex, setCurrentImageIndex] = React.useState(0);
  const messagesEndRef = React.useRef(null);

  React.useEffect(() => {
    // Scroll to bottom when messages update
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ticketMessages]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const sendMessageMutation = useMutation({
    mutationFn: async ({ message, fileUrls = [] }) => {
      let senderName = 'Design Consultant';
      let senderEmail = 'DC';
      try {
        const user = await base44.auth.me();
        senderName = user.full_name;
        senderEmail = user.email;
      } catch (error) {
        // Not logged in, use default DC name
      }

      const ticketMessage = await base44.entities.TicketMessage.create({
        ticket: ticketId,
        message,
        sender_email: senderEmail,
        sender_name: senderName,
        sender_role: 'DC',
        file_urls: fileUrls
      });

      // The message IS saved. The SMS is the part that tells the other person it
      // exists, and with SMS switched off it went nowhere and said nothing.
      // Non-blocking so the reply posts immediately either way.
      announceDelivery(
        base44.functions.invoke('sendTicketMessageSMS', {
          ticketId,
          senderName,
          message,
          senderRole: 'DC'
        }),
        { saved: 'Message posted', sent: 'the requester was not texted' },
      );

      return ticketMessage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticketMessages', ticketId] });
      setMessageText('');
    }
  });

  const updateCategoryStatusMutation = useMutation({
    mutationFn: async ({ categoryIndex, status }) => {
      const updatedCategories = [...ticket.categories];
      const categoryName = updatedCategories[categoryIndex].name;
      updatedCategories[categoryIndex] = { ...updatedCategories[categoryIndex], status, needs_additional_info: false };
      await base44.entities.Ticket.update(ticketId, { categories: updatedCategories });

      // Log the status change
      let dcName = 'Design Consultant';
      let userEmail = 'DC';
      try {
        const user = await base44.auth.me();
        dcName = user.full_name;
        userEmail = user.email;
        await base44.entities.TicketLog.create({
          ticket: ticketId,
          action: status === 'Requested Resolve' ? 'Resolution Requested' : (status === 'Resolved' ? 'Category Resolved' : 'Category Reopened'),
          details: categoryName,
          user_email: user.email,
          user_name: user.full_name
        });
      } catch (error) {
        // User not logged in, log as DC
        await base44.entities.TicketLog.create({
          ticket: ticketId,
          action: status === 'Requested Resolve' ? 'Resolution Requested' : (status === 'Resolved' ? 'Category Resolved' : 'Category Reopened'),
          details: categoryName,
          user_email: 'DC',
          user_name: 'Design Consultant'
        });
      }

      // Send SMS to requester when resolution is requested
      if (status === 'Requested Resolve' && ticket.requester) {
        try {
          const settings = await base44.entities.SMSSettings.list();
          const smsSettings = settings[0] || {};

          if (smsSettings.send_requester_resolved_sms !== false) {
            const requesterData = await base44.entities.TeamMember.filter({ id: ticket.requester });
            const requester = requesterData[0];
            if (requester && requester.phone) {
              const template = smsSettings.requester_category_resolved_template ||
                'Hi {requester_first_name}! The issue \'{category_name}\' for Order #{order_number} has been resolved by {resolver_name}. View ticket: {requester_ticket_url}';

              const message = template
                .replace(/{requester_first_name}/g, requester.first_name)
                .replace(/{category_name}/g, categoryName)
                .replace(/{order_number}/g, ticket.order_number)
                .replace(/{resolver_name}/g, dcName)
                .replace(/{requester_ticket_url}/g, ticket.requester_short_url || '');

              const { data: smsResult } = await base44.functions.invoke('sendSMS', {
                to: requester.phone,
                message
              });

              await base44.entities.TicketLog.create({
                ticket: ticketId,
                action: smsResult.success ? 'SMS Sent to Requester' : 'SMS Failed to Requester',
                details: smsResult.success
                  ? `Notified about resolution request: ${categoryName} (Status: ${smsResult.twilioStatus})`
                  : `Failed to notify about resolution request: ${categoryName} (Error: ${smsResult.error || 'Unknown'})`,
                user_email: userEmail,
                user_name: dcName
              });
            }
          }
        } catch (error) {
          console.error('Failed to send SMS to requester:', error);
          await base44.entities.TicketLog.create({
            ticket: ticketId,
            action: 'SMS Failed to Requester',
            details: `Failed to notify about resolution request: ${categoryName} (Error: ${error.message})`,
            user_email: userEmail,
            user_name: dcName
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['ticketLogs', ticketId] });
      toast.success('Category status updated');
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-12 h-12 text-crit mx-auto mb-3" />
            <h2 className="font-display text-xl font-semibold text-foreground mb-2">Ticket not found</h2>
            <p className="text-muted-foreground">This ticket may have been deleted or the link is invalid.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const resolvedCount = ticket.categories?.filter(c => c.status === 'Resolved').length || 0;
  const totalCount = ticket.categories?.length || 0;
  const allResolved = resolvedCount === totalCount;

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-pink mb-4 shadow-xl">
            <Package className="w-8 h-8 text-white" />
          </div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground mb-2">Order Processing Ticket</h1>
          <p className="text-muted-foreground">Review and resolve ticket issues</p>
        </div>

        {/* Main Card */}
        <Card className="shadow-xl">
          <CardHeader className="border-b border-border">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle className="font-display text-2xl mb-3">Order #{ticket.order_number}</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {ticket.customer_last_name && (
                    <StatusPill tone="neutral">{ticket.customer_last_name}</StatusPill>
                  )}
                  <StatusPill tone={allResolved ? 'good' : 'crit'}>
                    {allResolved ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <AlertCircle className="w-3 h-3" />
                    )}
                    {resolvedCount} of {totalCount} Resolved
                  </StatusPill>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-6 space-y-6">
            {/* Ticket Info */}
            <div className="space-y-2">
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Description</h3>
              <p className="text-foreground">{ticket.description}</p>
            </div>

            {/* Team Members */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
              {assignedDC && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Assigned To</p>
                  <p className="font-medium text-foreground">{assignedDC.first_name} {assignedDC.last_name}</p>
                </div>
              )}
              {requester && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Requested By</p>
                  <p className="font-medium text-foreground">{requester.first_name} {requester.last_name}</p>
                </div>
              )}
            </div>

            {/* Categories */}
            <div className="space-y-2">
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Issues to Resolve</h3>
              <div className="space-y-3">
                {ticket.categories && ticket.categories.length > 0 ? (
                  ticket.categories.map((cat, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-4 p-4 rounded-lg border transition-all",
                        cat.status === 'Resolved'
                          ? "bg-good/10 border-good/20"
                          : cat.status === 'Requested Resolve'
                          ? "bg-warn/10 border-warn/20"
                          : "bg-card border-border"
                      )}
                    >
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {cat.status === 'Resolved' ? (
                          <CheckCircle2 className="w-5 h-5 text-good flex-shrink-0 mt-0.5" />
                        ) : cat.status === 'Requested Resolve' ? (
                          <Clock className="w-5 h-5 text-warn flex-shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-crit flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <span className={cn(
                            "font-medium",
                            cat.status === 'Resolved' ? "text-good line-through" : "text-foreground"
                          )}>
                            {cat.name}
                          </span>
                          {cat.status === 'Requested Resolve' && (
                            <div className="text-xs text-warn mt-1">Awaiting approval</div>
                          )}
                          {cat.status === 'Open' && cat.needs_additional_info && (
                            <div className="text-xs text-warn mt-1 font-medium">⚠️ Needs additional information</div>
                          )}
                        </div>
                      </div>
                      {cat.status === 'Open' && (
                        <Button
                          size="sm"
                          onClick={() => updateCategoryStatusMutation.mutate({
                            categoryIndex: idx,
                            status: 'Requested Resolve'
                          })}
                          disabled={updateCategoryStatusMutation.isPending}
                        >
                          Request Resolved
                        </Button>
                      )}
                      {cat.status === 'Requested Resolve' && (
                        <StatusPill tone="warn">Pending Approval</StatusPill>
                      )}
                      {cat.status === 'Resolved' && (
                        <StatusPill tone="good">Resolved</StatusPill>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-center py-4">No categories</p>
                )}
              </div>
            </div>

            {/* Created Date */}
            <div className="pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Created {new Date(ticket.created_date).toLocaleDateString()} at{' '}
                {new Date(ticket.created_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            {/* Chat Messages */}
            <div className="pt-4 border-t border-border">
              <Accordion type="single" collapsible defaultValue="chat" onValueChange={(value) => value === 'chat' && scrollToBottom()}>
                <AccordionItem value="chat" className="border-none">
                  <AccordionTrigger className="text-sm font-medium text-primary hover:no-underline py-2">
                    💬 Chat ({ticketMessages.length})
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 mt-2 max-h-96 overflow-y-auto">
                      {ticketMessages.map((msg) => {
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

                        // Get all images from all messages
                        const allImages = ticketMessages
                          .filter(m => m.file_urls && m.file_urls.length > 0)
                          .flatMap(m => m.file_urls.filter(isImage));

                        return (
                          <div key={msg.id} className={cn(
                            "p-3 rounded-lg border text-sm",
                            msg.sender_role === 'DC'
                              ? "bg-primary/10 border-primary/20 ml-8"
                              : "bg-muted border-border mr-8"
                          )}>
                            <p className="font-medium text-foreground">{msg.sender_name}</p>
                            {msg.message && msg.message !== '(attached files)' && (
                              <p className="text-foreground mt-1">{msg.message}</p>
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
                                      className="flex items-center gap-1 px-2 py-1 bg-card border border-border rounded hover:bg-muted"
                                    >
                                      <Paperclip className="w-3 h-3" />
                                      <span className="text-xs">{getFileName(url)}</span>
                                    </SignedFileLink>
                                  )
                                ))}
                              </div>
                            )}
                            <p className="text-muted-foreground text-xs mt-2">
                              {new Date(msg.created_date).toLocaleDateString()} at{' '}
                              {new Date(msg.created_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {uploadingFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {uploadingFiles.map((file, idx) => (
                            <div key={idx} className="flex items-center gap-1 px-2 py-1 bg-muted border border-border rounded text-xs">
                              <ImageIcon className="w-3 h-3" />
                              <span className="truncate max-w-[150px]">{file.name}</span>
                              <button
                                onClick={() => setUploadingFiles(prev => prev.filter((_, i) => i !== idx))}
                                className="ml-1 hover:text-crit"
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
                          value={messageText}
                          onChange={(e) => setMessageText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && messageText.trim()) {
                              sendMessageMutation.mutate({ message: messageText.trim() });
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
                                  setUploadingFiles(prev => [...prev, file]);
                                }
                              }
                            }
                          }}
                          className="text-sm"
                        />
                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            if (files.length > 0) {
                              setUploadingFiles(prev => [...prev, ...files]);
                            }
                            e.target.value = '';
                          }}
                          className="hidden"
                          id="file-upload-dc"
                        />
                        <Button
                          variant="outline"
                          onClick={() => document.getElementById('file-upload-dc').click()}
                          className="flex-shrink-0"
                        >
                          <Paperclip className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={async () => {
                            if (messageText.trim() || uploadingFiles.length > 0) {
                              const fileUrls = [];
                              if (uploadingFiles.length > 0) {
                                for (const file of uploadingFiles) {
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
                                message: messageText.trim() || '(attached files)',
                                fileUrls
                              });
                              setUploadingFiles([]);
                            }
                          }}
                          disabled={(!messageText.trim() && !uploadingFiles.length) || sendMessageMutation.isPending}
                        >
                          {sendMessageMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send'}
                        </Button>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>

            {/* Activity Log */}
            {ticketLogs.length > 0 && (
              <div className="pt-4 border-t border-border">
                <Accordion type="single" collapsible>
                  <AccordionItem value="log" className="border-none">
                    <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline py-2">
                      Activity Log ({ticketLogs.length})
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 mt-2">
                        {ticketLogs.map((log) => (
                          <div key={log.id} className="p-3 bg-muted rounded-lg border border-border">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <p className="font-medium text-foreground text-sm">{log.action}</p>
                                {log.details && <p className="text-muted-foreground text-sm mt-1">{log.details}</p>}
                                <p className="text-muted-foreground text-xs mt-2">
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
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-xs text-muted-foreground">Powered by Floor Daddy RAZZLE DAZZLE</p>
        </div>
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
