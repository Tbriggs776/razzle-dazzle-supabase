import React, { useState, useEffect, useRef, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Send, MessageSquare, Loader2, Phone, RefreshCw, Calendar, DollarSign, ClipboardCheck, ExternalLink, ArrowLeft, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

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
    if (!window.confirm(`Delete all ${conv.messages.length} messages in this thread?`)) return;
    setDeletingKey(conv.key);
    try {
      await Promise.all(conv.messages.map(m => base44.entities.Communication.delete(m.id)));
      if (selectedKey === conv.key) { setSelectedKey(null); setShowMobileThread(false); }
      queryClient.invalidateQueries({ queryKey: ['communications'] });
    } finally {
      setDeletingKey(null);
    }
  };

  const handleSend = async () => {
    if (!replyText.trim() || !selectedConversation?.contact_phone) return;
    setSending(true);
    try {
      await base44.functions.invoke('sendSMS', {
        to: selectedConversation.contact_phone,
        message: replyText.trim()
      });
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['communications'] });
    } catch (err) {
      console.error('Send failed:', err);
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
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Related Records</p>

      {relatedData?.appointments?.length > 0 ? relatedData.appointments.slice(0, 3).map(apt => {
        const dc = relatedData.teamMembers?.find(tm => tm.id === apt.assigned_dc);
        return (
          <a key={apt.id} href={`/AppointmentDetail?id=${apt.id}`} className="block p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">Appointment</span>
              <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto" />
            </div>
            <div className="space-y-1">
              <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0',
                apt.status === 'Sold' ? 'border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-500/25 dark:text-emerald-300 dark:bg-emerald-500/15' :
                apt.status === 'Scheduled' || apt.status === 'Rescheduled' ? 'border-blue-200 text-blue-700 bg-blue-50 dark:border-blue-500/25 dark:text-blue-300 dark:bg-blue-500/15' :
                apt.status === 'Cancelled' ? 'border-red-200 text-red-700 bg-red-50 dark:border-red-500/25 dark:text-red-300 dark:bg-red-500/15' :
                'border-border text-muted-foreground'
              )}>{apt.status}</Badge>
              {apt.appointment_date && (
                <p className="text-xs text-muted-foreground">{new Date(apt.appointment_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              )}
              {apt.appointment_block && <p className="text-xs text-muted-foreground">{apt.appointment_block}</p>}
              {dc && <p className="text-xs text-muted-foreground">DC: {dc.first_name} {dc.last_name}</p>}
            </div>
          </a>
        );
      }) : (
        <div className="p-3 rounded-lg border border-dashed border-border text-center">
          <Calendar className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">No appointments</p>
        </div>
      )}

      {relatedData?.sales?.length > 0 ? relatedData.sales.slice(0, 2).map(sale => (
        <a key={sale.id} href={`/SaleDetail?id=${sale.id}`} className="block p-3 rounded-lg border border-border hover:border-emerald-300 dark:hover:border-emerald-500/40 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-xs font-semibold text-foreground">Sale</span>
            <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto" />
          </div>
          <div className="space-y-1">
            {sale.sale_amount && <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">${sale.sale_amount.toLocaleString()}</p>}
            {sale.sale_date && <p className="text-xs text-muted-foreground">{new Date(sale.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
            {sale.deposit_amount && <p className="text-xs text-muted-foreground">Deposit: ${sale.deposit_amount.toLocaleString()}</p>}
            {sale.deposit_payment_method && <p className="text-xs text-muted-foreground">{sale.deposit_payment_method}</p>}
          </div>
        </a>
      )) : (
        <div className="p-3 rounded-lg border border-dashed border-border text-center">
          <DollarSign className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">No sales</p>
        </div>
      )}

      {relatedData?.projects?.length > 0 ? relatedData.projects.slice(0, 2).map(proj => (
        <a key={proj.id} href={`/ProjectDetail?id=${proj.id}`} className="block p-3 rounded-lg border border-border hover:border-purple-300 dark:hover:border-purple-500/40 hover:bg-purple-50 dark:hover:bg-purple-500/10 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <ClipboardCheck className="w-3.5 h-3.5 text-purple-500" />
            <span className="text-xs font-semibold text-foreground">Project</span>
            <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto" />
          </div>
          <div className="space-y-1">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-200 text-purple-700 bg-purple-50 dark:border-purple-500/25 dark:text-purple-300 dark:bg-purple-500/15">{proj.status}</Badge>
            {proj.installation_date && <p className="text-xs text-muted-foreground">Install: {new Date(proj.installation_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
            {proj.scheduled_start_date && <p className="text-xs text-muted-foreground">Start: {new Date(proj.scheduled_start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>}
          </div>
        </a>
      )) : (
        <div className="p-3 rounded-lg border border-dashed border-border text-center">
          <ClipboardCheck className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">No projects</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="bg-card border-b border-border px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-5 h-5 text-primary flex-shrink-0" />
            <h1 className="text-lg font-bold text-foreground truncate">Communication Hub</h1>
            {unreadCount > 0 && (
              <Badge className="bg-destructive text-destructive-foreground flex-shrink-0 text-xs">{unreadCount}</Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['communications'] })}
            className="flex-shrink-0"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => setHideAutomated(v => !v)}
            className={cn(
              'text-xs px-2 py-1 rounded-lg border font-medium transition-colors whitespace-nowrap flex-shrink-0',
              hideAutomated
                ? 'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-300'
                : 'bg-card border-border text-muted-foreground'
            )}
          >
            {hideAutomated ? '🚫 Auto' : '👁 Auto'}
          </button>

          <div className="flex items-center gap-0.5 border border-border rounded-lg p-0.5 bg-card flex-shrink-0">
            {[['all', 'All'], ['external', 'Customers'], ['internal', 'Team']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setInternalFilter(val)}
                className={cn(
                  'text-xs px-2 py-1 rounded font-medium transition-colors whitespace-nowrap',
                  internalFilter === val
                    ? val === 'internal' ? 'bg-violet-600 text-white' : 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-0.5 border border-border rounded-lg p-0.5 bg-card flex-shrink-0">
            {['all', 'SMS', 'Email'].map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  'text-xs px-2 py-1 rounded font-medium transition-colors',
                  typeFilter === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Conversation List — always visible on desktop, hidden on mobile when thread is open */}
        <div className={cn(
          "flex flex-col bg-card border-r border-border",
          "w-full md:w-80 md:flex-shrink-0",
          showMobileThread ? "hidden md:flex" : "flex"
        )}>
          <div className="p-3 border-b border-border flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : sortedFilteredConversations.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No conversations yet</div>
            ) : (
              sortedFilteredConversations.map(conv => {
                const lastMsg = conv.messages[conv.messages.length - 1];
                const isSelected = (selectedKey || sortedFilteredConversations[0]?.key) === conv.key;
                return (
                  <div key={conv.key} className="relative group">
                    <button
                      onClick={() => handleSelectConversation(conv)}
                      className={cn(
                        "w-full text-left px-4 py-3 border-b border-border hover:bg-secondary transition-colors",
                        isSelected && "bg-primary/10 border-l-2 border-l-primary",
                        isUnread(conv) && !isSelected && "bg-blue-50 dark:bg-blue-500/10"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn("text-sm truncate", isUnread(conv) ? "font-bold text-foreground" : "font-semibold text-foreground")}>
                              {conv.contact_name}
                            </span>
                            {conv.is_internal && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 font-semibold flex-shrink-0">TEAM</span>
                            )}
                            {isUnread(conv) && (
                              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0" />
                            )}
                          </div>
                          <p className={cn("text-xs mt-1 truncate", isUnread(conv) ? "text-foreground font-medium" : "text-muted-foreground")}>
                            {lastMsg?.direction === 'inbound' ? '← ' : '→ '}
                            {lastMsg?.body?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', lastMsg?.type === 'SMS' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300' : 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300')}>
                            {lastMsg?.type}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {lastMsg?.created_date && format(new Date(lastMsg.created_date), 'MMM d')}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{conv.messages.length} msg{conv.messages.length !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </button>
                    {currentUser?.role === 'admin' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteThread(conv); }}
                        disabled={deletingKey === conv.key}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-destructive/10 hover:bg-destructive/20 text-destructive rounded p-1 text-xs leading-none"
                        title="Delete thread"
                      >
                        {deletingKey === conv.key ? '…' : '🗑'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Thread View — full-screen on mobile when active */}
        <div className={cn(
          "flex-1 flex flex-col min-w-0 overflow-hidden",
          !showMobileThread && "hidden md:flex"
        )}>
          {selectedConversation ? (
            <>
              {/* Thread Header */}
              <div className="bg-card border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
                {/* Back button — mobile only */}
                <button
                  className="md:hidden flex-shrink-0 p-1 rounded-lg hover:bg-secondary"
                  onClick={() => setShowMobileThread(false)}
                >
                  <ArrowLeft className="w-5 h-5 text-muted-foreground" />
                </button>

                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary font-bold text-sm">
                    {selectedConversation.contact_name?.charAt(0)?.toUpperCase() || '?'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground truncate">{selectedConversation.contact_name}</p>
                    {selectedConversation.is_internal && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 font-semibold flex-shrink-0">TEAM</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    {selectedConversation.contact_phone && (
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{selectedConversation.contact_phone}</span>
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
                  className="md:hidden flex-shrink-0 p-2 rounded-lg hover:bg-secondary"
                  onClick={() => setShowRelatedPanel(v => !v)}
                >
                  <Info className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>

              {/* Mobile Related Records overlay */}
              {showRelatedPanel && (
                <div className="md:hidden absolute inset-0 z-50 bg-card overflow-y-auto p-4" style={{top: 0}}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold text-foreground">Related Records</h2>
                    <button onClick={() => setShowRelatedPanel(false)} className="p-1 rounded-lg hover:bg-secondary">
                      <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>
                  <RelatedRecordsPanel />
                </div>
              )}

              <div className="flex flex-1 overflow-hidden">
                {/* Messages */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {threadMessages.map(msg => (
                      <div key={msg.id} className={cn('flex', msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                        <div className={cn(
                          'max-w-[80%] md:max-w-sm rounded-2xl px-4 py-2.5 space-y-1',
                          msg.direction === 'outbound'
                            ? 'bg-primary text-primary-foreground rounded-br-sm'
                            : 'bg-card border border-border text-foreground rounded-bl-sm'
                        )}>
                          {msg.body && msg.body.trim().startsWith('<') ? (
                            <div className="text-sm leading-relaxed prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: msg.body }} />
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
                              <span className={cn('px-1.5 py-0.5 rounded', msg.direction === 'outbound' ? 'bg-primary-foreground/20' : 'bg-secondary text-muted-foreground')}>{msg.type}</span>
                              {msg.status && (
                                <span className={cn('px-1.5 py-0.5 rounded', msg.direction === 'outbound' ? 'bg-primary-foreground/20' : 'bg-secondary text-muted-foreground')}>{msg.status}</span>
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
                    <div className="bg-card border-t border-border p-3 flex-shrink-0">
                      <div className="flex items-end gap-2">
                        <textarea
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          placeholder="Type a reply SMS..."
                          rows={2}
                          className="flex-1 border border-border bg-background text-foreground rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
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
                          className="bg-primary text-primary-foreground hover:opacity-90 h-11 px-4 flex-shrink-0"
                        >
                          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5 hidden md:block">Press Enter to send · Shift+Enter for new line</p>
                    </div>
                  )}
                </div>

                {/* Right Panel — desktop only */}
                <div className="hidden md:block w-72 flex-shrink-0 bg-card border-l border-border overflow-y-auto p-4">
                  <RelatedRecordsPanel />
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Select a conversation to view messages</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}