import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send, MessageSquare, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

export default function ContactCustomerDialog({ open, onClose, lead, appointmentId }) {
  const [channel, setChannel] = useState('sms');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const queryClient = useQueryClient();

  const phone = lead?.phone;
  const email = lead?.email;
  const available = channel === 'sms' ? phone : email;

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    enabled: open,
  });

  const senderFirstName = currentUser?.full_name?.split(' ')[0] || '';

  // Prefill greeting + sign-off when the dialog opens for a lead.
  useEffect(() => {
    if (open && lead?.first_name && senderFirstName && body === '') {
      setBody(`Hi ${lead.first_name}, \n\n\n- ${senderFirstName}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead?.first_name, senderFirstName]);

  // Live-update the thread when a new message arrives (inbound reply or outbound).
  useEffect(() => {
    if (!open) return;
    const unsubscribe = base44.entities.Communication.subscribe((event) => {
      if (event?.type === 'create') {
        queryClient.invalidateQueries({ queryKey: ['leadThread'] });
      }
    });
    return unsubscribe;
  }, [open, queryClient]);

  const { data: thread = [], isLoading: threadLoading } = useQuery({
    queryKey: ['leadThread', lead?.id, phone, email],
    queryFn: async () => {
      if (!lead?.id && !phone && !email) return [];
      const all = await base44.entities.Communication.list('-created_date', 200);
      const normPhone = normalizePhone(phone);
      return all.filter(m =>
        m.lead_id === lead?.id ||
        (normPhone && normalizePhone(m.contact_phone) === normPhone) ||
        (email && m.contact_email?.toLowerCase() === email.toLowerCase())
      ).sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    },
    enabled: open && !!(lead?.id || phone || email),
  });

  const handleSend = async () => {
    if (!available) return;
    if (!body.trim()) return;
    if (channel === 'email' && !subject.trim()) return;
    setSending(true);
    try {
      const res = await base44.functions.invoke('sendLeadMessage', {
        channel,
        to: available,
        subject: channel === 'email' ? subject : undefined,
        body: body.trim(),
        leadId: lead?.id,
        appointmentId,
        contactName: lead ? `${lead.first_name} ${lead.last_name}`.trim() : undefined,
      });
      const data = res?.data ?? res;
      if (res?.error || data?.success === false) {
        toast.error(data?.error || res?.error?.message || 'Failed to send. Please try again.');
      } else {
        toast.success(`${channel === 'sms' ? 'Text' : 'Email'} sent to ${available}`);
        // Optimistically insert the sent message so it shows up instantly.
        const tempMsg = {
          id: `temp-${Date.now()}`,
          type: channel === 'email' ? 'Email' : 'SMS',
          direction: 'outbound',
          contact_phone: channel === 'sms' ? available : null,
          contact_email: channel === 'email' ? available : null,
          subject: channel === 'email' ? subject : '',
          body: body.trim(),
          created_date: new Date().toISOString(),
          sent_by: currentUser?.full_name || '',
          lead_id: lead?.id || null,
        };
        queryClient.setQueriesData({ queryKey: ['leadThread'] }, (old) => (old ? [...old, tempMsg] : [tempMsg]));
        setBody('');
        setSubject('');
        queryClient.invalidateQueries({ queryKey: ['leadThread'] });
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            Contact {lead ? `${lead.first_name} ${lead.last_name}`.trim() : 'Customer'}
          </DialogTitle>
        </DialogHeader>

        {/* Conversation history */}
        <div className="flex-1 overflow-y-auto border border-border rounded-lg bg-muted/40 p-3 min-h-[160px] max-h-[300px]">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Conversation</p>
          {threadLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : thread.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">No messages yet</p>
          ) : (
            <div className="space-y-2">
              {thread.map(msg => {
                const outbound = msg.direction === 'outbound';
                return (
                  <div key={msg.id} className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                      outbound
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'bg-card border border-border text-foreground rounded-bl-sm'
                    )}>
                      {msg.subject && outbound && (
                        <p className="text-[11px] font-semibold opacity-80 mb-0.5">{msg.subject}</p>
                      )}
                      {msg.body && msg.body.trim().startsWith('<') ? (
                        <div className="leading-relaxed prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: msg.body }} />
                      ) : (
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                      )}
                      <div className={cn('flex items-center gap-2 text-[10px] mt-1', outbound ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                        <span>{format(new Date(msg.created_date), 'MMM d, h:mm a')}</span>
                        <span className={cn('px-1.5 py-0.5 rounded', outbound ? 'bg-white/15' : 'bg-muted text-muted-foreground')}>{msg.type}</span>
                        {msg.sent_by && outbound && <span>{msg.sent_by}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChannel('sms')}
              disabled={!phone}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                channel === 'sms' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-muted',
                !phone && 'opacity-40 cursor-not-allowed'
              )}
            >
              <MessageSquare className="w-4 h-4" />
              Text {phone ? `(${phone})` : '(none)'}
            </button>
            <button
              onClick={() => setChannel('email')}
              disabled={!email}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                channel === 'email' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-muted',
                !email && 'opacity-40 cursor-not-allowed'
              )}
            >
              <Mail className="w-4 h-4" />
              Email {email ? '' : '(none)'}
            </button>
          </div>

          {channel === 'email' && (
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" />
          )}

          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={channel === 'sms' ? 'Type your text message...' : 'Type your email message...'}
            rows={4}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button
            onClick={handleSend}
            disabled={sending || !available || !body.trim() || (channel === 'email' && !subject.trim())}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send {channel === 'sms' ? 'Text' : 'Email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
