import React, { useState, useEffect, useRef, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invokeFailure, invokeNotSent } from '@/lib/invokeResult';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Send, MessageSquare, Loader2, Phone, RefreshCw, Calendar, DollarSign, ClipboardCheck, ExternalLink, ArrowLeft, Info, X, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import CommsRow from '@/components/dashboard/CommsRow';

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function groupByContact(messages) {
  const groups = {};
  messages.forEach(msg => {
    const key = normalizePhone(msg.contact_phone) || msg.contact_email || 'unknown';
    if (!groups[key]) {
      groups[key] = {
        key,
        contact_phone: msg.contact_phone,
        contact_email: msg.contact_email,
        contact_name: msg.contact_name || msg.contact_phone || msg.contact_email || 'Unknown',
        messages: [],
        lead_id: msg.lead_id,
        customer_id: msg.customer_id
      };
    }
    if (msg.contact_name && msg.contact_name !== msg.contact_phone) {
      groups[key].contact_name = msg.contact_name;
    }
    groups[key].messages.push(msg);
  });
  return Object.values(groups).sort((a, b) => {
    const aLatest = Math.max(...a.messages.map(m => new Date(m.created_date).getTime()));
    const bLatest = Math.max(...b.messages.map(m => new Date(m.created_date).getTime()));
    return bLatest - aLatest;
  });
}

export default function CommunicationHub() {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [hideAutomated, setHideAutomated] = useState(true);
  const [internalFilter, setInternalFilter] = useState('external');
  const [deletingKey, setDeletingKey] = useState(null);
  const [showMobileThread, setShowMobileThread] = useState(false);
  const [showRelatedPanel, setShowRelatedPanel] = useState(false);
  const [readKeys, setReadKeys] = useState(() => {
    try {
      const stored = localStorage.getItem('commHub_readKeys');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const markRead = (key) => {
    setReadKeys(prev => {
      const next = new Set([...prev, key]);
      try { localStorage.setItem('commHub_readKeys', JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const bottomRef = useRef(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: communications = [], isLoading } = useQuery({
    queryKey: ['communications'],
    queryFn: () => base44.entities.Communication.list('-created_date', 500),
    refetchInterval: 15000
  });

  const { data: allTeamMembers = [] } = useQuery({
    queryKey: ['teamMembersAll'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  const teamMemberPhoneMap = useMemo(() => {
    const map = {};
    allTeamMembers.forEach(tm => {
      if (tm.phone) {
        const normalized = normalizePhone(tm.phone);
        if (normalized) map[normalized] = tm;
      }
    });
    return map;
  }, [allTeamMembers]);

  const selectedComm = communications.find(m => {
    const key = normalizePhone(m.contact_phone) || m.contact_email || 'unknown';
    return key === selectedKey;
  });
  const selectedLeadId = selectedComm?.lead_id || null;
  const selectedCustomerId = selectedComm?.customer_id || null;

  const { data: relatedData } = useQuery({
    queryKey: ['commHubRelated', selectedLeadId, selectedCustomerId],
    queryFn: async () => {
      const [appointments, sales, projects] = await Promise.all([
        selectedLeadId ? base44.entities.Appointment.filter({ customer: selectedLeadId }) : Promise.resolve([]),
        selectedCustomerId ? base44.entities.Sale.filter({ customer: selectedCustomerId }) : Promise.resolve([]),
        selectedCustomerId ? base44.entities.Project.filter({ customer: selectedCustomerId }) : Promise.resolve([])
      ]);
      const dcIds = [...new Set(appointments.map(a => a.assigned_dc).filter(Boolean))];
      const teamMembers = dcIds.length > 0
        ? await Promise.all(dcIds.map(id => base44.entities.TeamMember.filter({ id }))).then(r => r.flat())
        : [];
      return { appointments, sales, projects, teamMembers };
    },
    enabled: !!(selectedLeadId || selectedCustomerId)
  });

  useEffect(() => {
    const unsub = base44.entities.Communication.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ['communications'] });
    });
    return unsub;
  }, [queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedKey, communications.length]);

  const filtered = communications.filter(m => {
    if (typeFilter !== 'all' && m.type !== typeFilter) return false;
    if (hideAutomated && m.direction === 'outbound' && m.sent_by === 'System') return false;
    return true;
  });

  const rawConversations = groupByContact(filtered);
  const conversations = rawConversations.map(conv => {
    const normalizedPhone = normalizePhone(conv.contact_phone);
    const teamMember = normalizedPhone ? teamMemberPhoneMap[normalizedPhone] : null;
    return {
      ...conv,
      is_internal: !!teamMember,
      contact_name: teamMember ? `${teamMember.first_name} ${teamMember.last_name}` : conv.contact_name,
      team_member_role: teamMember?.role || null
    };
  });

  const filteredConversations = conversations
    .filter(c => {
      if (internalFilter === 'internal' && !c.is_internal) return false;
      if (internalFilter === 'external' && c.is_internal) return false;
      return true;
    })
    .filter(c =>
      !searchQuery ||
      c.contact_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.contact_phone?.includes(searchQuery)
    );

  const isUnread = (conv) => {
    const hasInbound = conv.messages.some(m => m.direction === 'inbound');
    return hasInbound && !readKeys.has(conv.key);
  };

  const sortedFilteredConversations = [...filteredConversations].sort((a, b) => {
    const aUnread = isUnread(a) ? 1 : 0;
    const bUnread = isUnread(b) ? 1 : 0;
    if (bUnread !== aUnread) return bUnread - aUnread;
    const aLatest = Math.max(...a.messages.map(m => new Date(m.created_date).getTime()));
    const bLatest = Math.max(...b.messages.map(m => new Date(m.created_date).getTime()));
    return bLatest - aLatest;
  });

  const selectedConversation = sortedFilteredConversations.find(c => c.key === selectedKey)
    || (sortedFilteredConversations.length > 0 ? sortedFilteredConversations[0] : null);

  React.useEffect(() => {
    if (selectedConversation?.key) {
      markRead(selectedConversation.key);
    }
  }, [selectedConversation?.key]);

  const threadMessages = selectedConversation
    ? [...selectedConversation.messages].sort((a, b) => new Date(a.created_date) - new Date(b.created_date))
    : [];

  const unreadCount = conversations.reduce((acc, c) => {
    const inbound = c.messages.filter(m => m.direction === 'inbound').length;
    return acc + inbound;
  }, 0);

  const handleDeleteThread = async (conv) => {
    // Named, so a misclick on the adjacent conversation is survivable — this used
    // to be a generic "Delete all N messages?" on a row you might not have meant.
    const who = conv.contact_name || conv.contact_phone || conv.contact_email || 'this contact';
    if (!window.confirm(
      `Archive the ${conv.messages.length} message(s) with ${who}?\n\n`
      + 'They are hidden from the Hub but kept on record, and an administrator can '
      + 'restore them. Nothing is permanently deleted.'
    )) return;

    setDeletingKey(conv.key);
    try {
      // One call for the whole thread, so the audit entry reads like the action a
      // person actually took rather than N separate deletions.
      const res = await base44.functions.invoke('archiveConversation', {
        ids: conv.messages.map(m => m.id),
      });
      const failed = invokeFailure(res);
      if (failed) {
        toast.error(`Could not archive that conversation — ${failed}`);
        return;
      }
      if (selectedKey === conv.key) { setSelectedKey(null); setShowMobileThread(false); }
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      toast.success(`Archived ${res.data?.archived ?? conv.messages.length} message(s) with ${who}.`);
    } finally {
      setDeletingKey(null);
    }
  };

  const handleSend = async () => {
    if (!replyText.trim() || !selectedConversation?.contact_phone) return;
    setSending(true);
    try {
      // invoke() never throws, so the old catch here was dead code: every send
      // cleared the textarea and refreshed the thread whether or not the message
      // went anywhere. With SMS currently disarmed this returned 200
      // { skipped: 'disabled' } and looked exactly like success.
      const res = await base44.functions.invoke('sendSMS', {
        to: selectedConversation.contact_phone,
        message: replyText.trim()
      });

      const failed = invokeFailure(res);
      if (failed) {
        // Keep what they typed. Clearing it loses the message they still need to send.
        toast.error(`Message not sent — ${failed}`);
        return;
      }
      const notSent = invokeNotSent(res);
      if (notSent) {
        toast.warning(`Nothing was sent — ${notSent}. The customer has not heard from you.`);
        return;
      }

      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['communications'] });
    } finally {
      setSending(false);
    }
  };

  const handleSelectConversation = (conv) => {
    setSelectedKey(conv.key);
    setShowMobileThread(true);
    setShowRelatedPanel(false);
  };

  const RelatedRecordsPanel = () => (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Related Records</p>

      {relatedData?.appointments?.length > 0 ? relatedData.appointments.slice(0, 3).map(apt => {
        const dc = relatedData.teamMembers?.find(tm => tm.id === apt.assigned_dc);
        const aptTone = apt.status === 'Sold' ? 'good'
          : (apt.status === 'Scheduled' || apt.status === 'Rescheduled') ? 'info'
          : apt.status === 'Cancelled' ? 'crit' : 'neutral';
        return (
          <a key={apt.id} href={`/AppointmentDetail?id=${apt.id}`} className="block rounded-lg border border-border p-3 transition-colors hover:border-primary/40 hover:bg-muted/50">
            <div className="mb-2 flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-info" />
              <span className="text-xs font-semibold text-foreground">Appointment</span>
              <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <StatusPill tone={aptTone}>{apt.status}</StatusPill>
              {apt.appointment_date && (
                <p className="text-xs text-muted-foreground">{new Date(apt.appointment_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              )}
              {apt.appointment_block && <p className="text-xs text-muted-foreground">{apt.appointment_block}</p>}
              {dc && <p className="text-xs text-muted-foreground">DC: {dc.first_name} {dc.last_name}</p>}
            </div>
          </a>
        );
      }) : (
        <div className="rounded-lg border border-dashed border-border p-3 text-center">
          <Calendar className="mx-auto mb-1 h-4 w-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">No appointments</p>
        </div>
      )}

      {relatedData?.sales?.length > 0 ? relatedData.sales.slice(0, 2).map(sale => (
        <a key={sale.id} href={`/SaleDetail?id=${sale.id}`} className="block rounded-lg border border-border p-3 transition-colors hover:border-good/40 hover:bg-good/5">
          <div className="mb-2 flex items-center gap-2">
            <DollarSign className="h-3.5 w-3.5 text-good" />
            <span className="text-xs font-semibold text-foreground">Sale</span>
            <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            {sale.sale_amount && <p className="text-sm font-bold text-good">${sale.sale_amount.toLocaleString()}</p>}
            {sale.sale_date && <p className="text-xs text-muted-foreground">{new Date(sale.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
            {sale.deposit_amount && <p className="text-xs text-muted-foreground">Deposit: ${sale.deposit_amount.toLocaleString()}</p>}
            {sale.deposit_payment_method && <p className="text-xs text-muted-foreground">{sale.deposit_payment_method}</p>}
          </div>
        </a>
      )) : (
        <div className="rounded-lg border border-dashed border-border p-3 text-center">
          <DollarSign className="mx-auto mb-1 h-4 w-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">No sales</p>
        </div>
      )}

      {relatedData?.projects?.length > 0 ? relatedData.projects.slice(0, 2).map(proj => (
        <a key={proj.id} href={`/ProjectDetail?id=${proj.id}`} className="block rounded-lg border border-border p-3 transition-colors hover:border-primary/40 hover:bg-muted/50">
          <div className="mb-2 flex items-center gap-2">
            <ClipboardCheck className="h-3.5 w-3.5 text-info" />
            <span className="text-xs font-semibold text-foreground">Project</span>
            <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <StatusPill tone="neutral">{proj.status}</StatusPill>
            {proj.installation_date && <p className="text-xs text-muted-foreground">Install: {new Date(proj.installation_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
            {proj.scheduled_start_date && <p className="text-xs text-muted-foreground">Start: {new Date(proj.scheduled_start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>}
          </div>
        </a>
      )) : (
        <div className="rounded-lg border border-dashed border-border p-3 text-center">
          <ClipboardCheck className="mx-auto mb-1 h-4 w-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">No projects</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-hidden px-4 pt-4 sm:px-6 lg:px-8">
        <PageHeader
          eyebrow="Communications"
          title="Communication Hub"
          subtitle="Two-way SMS and email with customers and your team."
          actions={
            <>
              {unreadCount > 0 && (
                <StatusPill tone="info" dot>{unreadCount} inbound</StatusPill>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['communications'] })}
                aria-label="Refresh conversations"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </>
          }
        />

        {/* Filters */}
        <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto py-3 scrollbar-hide">
          <button
            onClick={() => setHideAutomated(v => !v)}
            className={cn(
              'flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              hideAutomated
                ? 'border-warn/30 bg-warn/15 text-warn'
                : 'border-border bg-card text-muted-foreground hover:border-primary/40'
            )}
          >
            {hideAutomated ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {hideAutomated ? 'Hiding automated' : 'Showing automated'}
          </button>

          <div className="flex flex-shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
            {[['all', 'All'], ['external', 'Customers'], ['internal', 'Team']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setInternalFilter(val)}
                className={cn(
                  'whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  internalFilter === val
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
            {['all', 'SMS', 'Email'].map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  'whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  typeFilter === t
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {t === 'all' ? 'All' : t}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">

          {/* Conversation List — always visible on desktop, hidden on mobile when thread is open */}
          <div className={cn(
            "flex flex-col bg-card",
            "w-full border-r border-border md:w-80 md:flex-shrink-0",
            showMobileThread ? "hidden md:flex" : "flex"
          )}>
            <div className="flex-shrink-0 border-b border-border p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="h-9 pl-9 text-sm"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : sortedFilteredConversations.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No conversations yet</div>
              ) : (
                <div className="divide-y divide-border">
                  {sortedFilteredConversations.map((conv, idx) => {
                    const lastMsg = conv.messages[conv.messages.length - 1];
                    const isSelected = (selectedKey || sortedFilteredConversations[0]?.key) === conv.key;
                    const unread = isUnread(conv);
                    const preview = (lastMsg?.body?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '').slice(0, 60);
                    const dateStr = lastMsg?.created_date ? format(new Date(lastMsg.created_date), 'MMM d') : '';
                    return (
                      <div key={conv.key} className="group relative">
                        <button
                          onClick={() => handleSelectConversation(conv)}
                          className={cn(
                            "block w-full border-l-2 border-transparent text-left transition-colors hover:bg-muted/50",
                            isSelected && "border-l-primary bg-primary/10",
                            unread && !isSelected && "bg-info/10"
                          )}
                        >
                          <CommsRow
                            who={conv.contact_name}
                            channel={lastMsg?.type === 'SMS' ? 'sms' : 'email'}
                            text={`${lastMsg?.direction === 'inbound' ? '← ' : '→ '}${preview}`}
                            when={dateStr ? `${dateStr} · ${conv.messages.length}` : `${conv.messages.length} msg`}
                            inbound={unread}
                            index={idx}
                          />
                        </button>
                        {conv.is_internal && (
                          <StatusPill
                            tone="info"
                            className="pointer-events-none absolute bottom-2 right-3 !px-1.5 !text-[9px]"
                          >
                            Team
                          </StatusPill>
                        )}
                        {currentUser?.role === 'admin' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteThread(conv); }}
                            disabled={deletingKey === conv.key}
                            className="absolute right-2 top-2 rounded p-1 text-xs leading-none text-crit opacity-0 transition-opacity hover:bg-crit/15 group-hover:opacity-100"
                            title="Delete thread"
                          >
                            {deletingKey === conv.key ? '…' : '🗑'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Thread View — full-screen on mobile when active */}
          <div className={cn(
            "relative flex min-w-0 flex-1 flex-col overflow-hidden",
            !showMobileThread && "hidden md:flex"
          )}>
            {selectedConversation ? (
              <>
                {/* Thread Header */}
                <div className="flex flex-shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3">
                  {/* Back button — mobile only */}
                  <button
                    className="flex-shrink-0 rounded-lg p-1 hover:bg-muted md:hidden"
                    onClick={() => setShowMobileThread(false)}
                  >
                    <ArrowLeft className="h-5 w-5 text-muted-foreground" />
                  </button>

                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <span className="text-sm font-bold text-primary">
                      {selectedConversation.contact_name?.charAt(0)?.toUpperCase() || '?'}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-foreground">{selectedConversation.contact_name}</p>
                      {selectedConversation.is_internal && (
                        <StatusPill tone="info">Team</StatusPill>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {selectedConversation.contact_phone && (
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{selectedConversation.contact_phone}</span>
                      )}
                      {selectedConversation.lead_id && (
                        <a href={`/LeadDetail?id=${selectedConversation.lead_id}`} className="text-primary hover:underline">Lead →</a>
                      )}
                      {selectedConversation.customer_id && (
                        <a href={`/CustomerDetail?id=${selectedConversation.customer_id}`} className="text-primary hover:underline">Customer →</a>
                      )}
                    </div>
                  </div>

                  {/* Info button — mobile only, shows related records panel */}
                  <button
                    className="flex-shrink-0 rounded-lg p-2 hover:bg-muted md:hidden"
                    onClick={() => setShowRelatedPanel(v => !v)}
                  >
                    <Info className="h-5 w-5 text-muted-foreground" />
                  </button>
                </div>

                {/* Mobile Related Records overlay */}
                {showRelatedPanel && (
                  <div className="absolute inset-0 z-50 overflow-y-auto bg-card p-4 md:hidden">
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className="font-display font-semibold text-foreground">Related Records</h2>
                      <button onClick={() => setShowRelatedPanel(false)} className="rounded-lg p-1 hover:bg-muted">
                        <X className="h-5 w-5 text-muted-foreground" />
                      </button>
                    </div>
                    <RelatedRecordsPanel />
                  </div>
                )}

                <div className="flex flex-1 overflow-hidden">
                  {/* Messages */}
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="flex-1 space-y-3 overflow-y-auto p-4">
                      {threadMessages.map(msg => (
                        <div key={msg.id} className={cn('flex', msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                          <div className={cn(
                            'max-w-[80%] space-y-1 rounded-2xl px-4 py-2.5 md:max-w-sm',
                            msg.direction === 'outbound'
                              ? 'rounded-br-sm bg-primary text-primary-foreground'
                              : 'rounded-bl-sm border border-border bg-card text-foreground'
                          )}>
                            {msg.body && msg.body.trim().startsWith('<') ? (
                              <div className="prose prose-sm max-w-none text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: msg.body }} />
                            ) : (
                              <p className="text-sm leading-relaxed">{msg.body}</p>
                            )}
                            <div className={cn('flex items-center justify-between gap-4 text-[10px]', msg.direction === 'outbound' ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                              <span>
                                {msg.created_date && format(
                                  new Date(msg.created_date),
                                  'MMM d, h:mm a'
                                )}
                              </span>
                              <div className="flex items-center gap-1">
                                {msg.sent_by && <span>{msg.sent_by}</span>}
                                <span className={cn('rounded px-1.5 py-0.5', msg.direction === 'outbound' ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground')}>{msg.type}</span>
                                {msg.status && (
                                  <span className={cn('rounded px-1.5 py-0.5', msg.direction === 'outbound' ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground')}>{msg.status}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                      <div ref={bottomRef} />
                    </div>

                    {/* Reply Box */}
                    {selectedConversation.contact_phone && (
                      <div className="flex-shrink-0 border-t border-border bg-card p-3">
                        <div className="flex items-end gap-2">
                          <textarea
                            value={replyText}
                            onChange={e => setReplyText(e.target.value)}
                            placeholder="Type a reply SMS..."
                            rows={2}
                            className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                              }
                            }}
                          />
                          <Button
                            onClick={handleSend}
                            disabled={sending || !replyText.trim()}
                            className="h-11 flex-shrink-0 px-4"
                          >
                            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          </Button>
                        </div>
                        <p className="mt-1.5 hidden text-xs text-muted-foreground md:block">Press Enter to send · Shift+Enter for new line</p>
                      </div>
                    )}
                  </div>

                  {/* Right Panel — desktop only */}
                  <div className="hidden w-72 flex-shrink-0 overflow-y-auto border-l border-border bg-card p-4 md:block">
                    <RelatedRecordsPanel />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageSquare className="mx-auto mb-3 h-12 w-12 opacity-30" />
                  <p>Select a conversation to view messages</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
