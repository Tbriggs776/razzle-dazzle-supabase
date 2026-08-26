import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/lib/supabaseClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, HardHat, BadgeCheck, AlertTriangle, FileText, Building2, User,
  ShieldAlert, Banknote, Check, X, ExternalLink, Clock, FileSignature, UserPlus, Send, Copy, Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO, isValid } from 'date-fns';

const STATUS_BADGE = {
  draft: 'bg-secondary text-secondary-foreground border-border',
  submitted: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25',
  under_review: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25',
  approved: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25',
  rejected: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25',
};
const FILTERS = ['submitted', 'under_review', 'approved', 'rejected', 'all'];
const DOC_LABELS = { roc_license_file: 'ROC license', bond_file: 'Bond', coi_file: 'COI + endorsements', w9_file: 'W-9', voided_check_file: 'Voided check' };
const fmtDate = (d) => (d && isValid(parseISO(d)) ? format(parseISO(d), 'MMM d, yyyy') : '—');

async function openDoc(path) {
  if (!path) return;
  const { data, error } = await supabase.storage.from('installer-onboarding').createSignedUrl(path, 600);
  if (error || !data?.signedUrl) { toast.error('Could not open document'); return; }
  window.open(data.signedUrl, '_blank', 'noopener');
}

function Row({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="py-2 flex flex-col sm:flex-row sm:justify-between sm:gap-6 gap-0.5 text-sm border-b border-border last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium sm:text-right break-words">{String(value)}</dd>
    </div>
  );
}

export default function InstallerApplications() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('submitted');
  const [selectedId, setSelectedId] = useState(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState({}); // document_type -> signing URL (to copy/paste)

  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me(), retry: false });
  const { data: apps = [], isLoading } = useQuery({
    queryKey: ['installerApplications'],
    queryFn: () => base44.entities.InstallerApplication.list('-created_date', 500),
  });

  const visible = apps.filter((a) => (filter === 'all' ? a.status !== 'draft' : a.status === filter));
  const selected = apps.find((a) => a.id === selectedId) || null;

  const act = async (status) => {
    if (!selected) return;
    setBusy(true);
    try {
      await base44.entities.InstallerApplication.update(selected.id, {
        status,
        reviewed_by: currentUser?.full_name || currentUser?.email || 'Staff',
        reviewed_at: new Date().toISOString(),
        review_notes: notes || selected.review_notes || null,
      });
      if (status === 'approved') {
        toast.success('Application approved');
        // Fire the approval notifications: create the e-sign requests + email the applicant one
        // "you're approved, sign here" message + ping the team.
        try {
          const res = await base44.functions.invoke('installerApproved', { application_id: selected.id });
          const d = res?.data ?? res;
          if (d?.error) throw new Error(d.error);
          if (Array.isArray(d?.links)) setLinks((prev) => ({ ...prev, ...Object.fromEntries(d.links.map((l) => [l.type, l.url])) }));
          if ((d?.agreements_sent ?? 0) > 0) {
            toast.success(`${d.agreements_sent} agreement${d.agreements_sent === 1 ? '' : 's'} emailed to ${selected.contact_email || 'the applicant'} to sign`);
          }
        } catch (e) {
          toast.error(`Approved, but couldn't send agreements: ${e.message}`);
        }
      } else {
        toast.success(status === 'rejected' ? 'Application rejected' : 'Updated');
      }
      setNotes('');
      qc.invalidateQueries({ queryKey: ['installerApplications'] });
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); toast.success('Signing link copied — paste it into your email'); }
    catch { toast.error('Copy failed — select the link and copy it manually'); }
  };

  // e-sign: email the applicant a signing link for one agreement (create a signature request).
  const sendSig = async (document_type, label) => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await base44.functions.invoke('esign', { action: 'create', document_type, document_id: selected.id });
      const d = res?.data ?? res;
      if (d?.error) throw new Error(d.error);
      if (d?.sign_url) setLinks((prev) => ({ ...prev, [document_type]: d.sign_url }));
      toast.success(`${label} sent to ${selected.contact_email || 'the applicant'}`);
    } catch (e) { toast.error(`Could not send: ${e.message}`); }
    setBusy(false);
  };

  // Generate (without emailing) a signing link for one agreement and copy it — for pasting into
  // your own email while Resend is off. Reuses a link already fetched this session.
  const copyLink = async (document_type) => {
    if (links[document_type]) { copyText(links[document_type]); return; }
    if (!selected) return;
    setBusy(true);
    try {
      const res = await base44.functions.invoke('esign', { action: 'create', document_type, document_id: selected.id, suppress_email: true });
      const d = res?.data ?? res;
      if (d?.error) throw new Error(d.error);
      if (d?.sign_url) { setLinks((prev) => ({ ...prev, [document_type]: d.sign_url })); copyText(d.sign_url); }
    } catch (e) { toast.error(`Could not get link: ${e.message}`); }
    setBusy(false);
  };

  const sendAll = async () => {
    await sendSig('installer_master', 'Master Agreement');
    await sendSig('installer_claims', 'Claims & Warranty');
    if (selected?.elect_direct_deposit) await sendSig('installer_ach', 'ACH Authorization');
  };

  // Phase 4: turn an approved, fully-signed applicant into an active installer crew.
  const promote = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const crew = await base44.entities.Installer.create({
        crew_name: selected.legal_business_name || selected.roc_business_name,
        email: selected.contact_email, phone: selected.contact_phone, is_active: true,
      });
      await base44.entities.InstallerApplication.update(selected.id, {
        installer_id: crew.id, status: 'approved',
        reviewed_by: currentUser?.full_name || currentUser?.email || 'Staff', reviewed_at: new Date().toISOString(),
      });
      toast.success('Promoted to an active installer crew');
      qc.invalidateQueries({ queryKey: ['installerApplications'] });
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><HardHat className="w-6 h-6 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Installer Applications</h1>
            <p className="text-sm text-muted-foreground">Review subcontractor onboarding — license, insurance, and documents.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-5">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors capitalize',
                filter === f ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-muted')}>
              {f.replace('_', ' ')} {f !== 'all' && <span className="opacity-70">({apps.filter((a) => a.status === f).length})</span>}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
        ) : (
          <div className="grid lg:grid-cols-[minmax(0,360px)_1fr] gap-5">
            {/* List */}
            <div className="space-y-2">
              {visible.length === 0 && <div className="text-center py-12 bg-card rounded-xl border border-border text-muted-foreground">No applications</div>}
              {visible.map((a) => (
                <button key={a.id} onClick={() => { setSelectedId(a.id); setNotes(''); setLinks({}); }}
                  className={cn('w-full text-left bg-card rounded-xl border p-4 transition-colors',
                    selectedId === a.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-muted/50')}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-foreground truncate">{a.legal_business_name || a.roc_business_name || 'Unnamed applicant'}</p>
                    <span className={cn('shrink-0 text-[11px] px-2 py-0.5 rounded-full border capitalize', STATUS_BADGE[a.status])}>{a.status.replace('_', ' ')}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">ROC {a.roc_license_no || '—'} · {a.contact_name || a.contact_email || 'no contact'}</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1 flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtDate(a.submitted_at || a.created_date)}</p>
                </button>
              ))}
            </div>

            {/* Detail */}
            <div>
              {!selected ? (
                <div className="text-center py-20 bg-card rounded-xl border border-border text-muted-foreground">Select an application to review</div>
              ) : (
                <div className="space-y-4">
                  {/* ROC validation */}
                  <section className="bg-card rounded-xl border border-border p-5">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h2 className="text-lg font-bold text-foreground">{selected.legal_business_name || '—'}</h2>
                      <span className={cn('text-xs px-2.5 py-1 rounded-full border capitalize', STATUS_BADGE[selected.status])}>{selected.status.replace('_', ' ')}</span>
                    </div>
                    <div className={cn('rounded-lg border p-3 text-sm flex items-start gap-2',
                      selected.roc_is_active ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/10' : 'border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10')}>
                      {selected.roc_is_active ? <BadgeCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5" />}
                      <div>
                        <p className="font-medium">ROC {selected.roc_license_no || '—'} — {selected.roc_is_active ? 'Active' : (selected.roc_status || 'Not verified active')}</p>
                        <p className="text-muted-foreground text-xs mt-0.5">
                          {selected.roc_business_name || '—'} · {(selected.roc_classes || []).map((c) => c.class).join(', ') || 'no classes'} · expires {fmtDate(selected.roc_expiration)}
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Business + contact */}
                  <section className="bg-card rounded-xl border border-border p-5">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-3 flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> Business &amp; contact</h3>
                    <dl>
                      <Row label="Legal name" value={selected.legal_business_name} />
                      <Row label="DBA" value={selected.dba} />
                      <Row label="Entity type" value={selected.entity_type} />
                      <Row label="State of org" value={selected.state_of_org} />
                      <Row label="Tax ID (last 4)" value={selected.tax_id_last4 ? `••••${selected.tax_id_last4}` : null} />
                      <Row label="Payee name" value={selected.payee_name} />
                      <Row label="Contact" value={selected.contact_name} />
                      <Row label="Phone" value={selected.contact_phone} />
                      <Row label="Email" value={selected.contact_email} />
                      <Row label="Signer" value={selected.signatory_name && `${selected.signatory_name}${selected.signatory_title ? ` (${selected.signatory_title})` : ''}`} />
                    </dl>
                  </section>

                  {/* Insurance */}
                  <section className="bg-card rounded-xl border border-border p-5">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-3 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-primary" /> Insurance</h3>
                    <dl>
                      <Row label="General liability" value={selected.gl_carrier && `${selected.gl_carrier} — exp ${fmtDate(selected.gl_expiration)}`} />
                      <Row label="Auto liability" value={selected.auto_carrier && `${selected.auto_carrier} — exp ${fmtDate(selected.auto_expiration)}`} />
                      <Row label="Workers' comp" value={selected.wc_waiver ? 'Waived (sole prop, no employees)' : (selected.wc_carrier && `${selected.wc_carrier} — exp ${fmtDate(selected.wc_expiration)}`)} />
                    </dl>
                  </section>

                  {/* Documents */}
                  <section className="bg-card rounded-xl border border-border p-5">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> Documents</h3>
                    <div className="space-y-1">
                      {Object.entries(DOC_LABELS).map(([col, label]) => (
                        <div key={col} className="flex items-center justify-between py-1.5 text-sm border-b border-border last:border-0">
                          <span className="text-muted-foreground">{label}</span>
                          {selected[col] ? (
                            <button onClick={() => openDoc(selected[col])} className="inline-flex items-center gap-1 text-primary font-medium hover:underline"><ExternalLink className="w-3.5 h-3.5" /> View</button>
                          ) : <span className="text-xs text-muted-foreground/60">Not provided</span>}
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Direct deposit (masked) */}
                  {selected.elect_direct_deposit && (
                    <section className="bg-card rounded-xl border border-border p-5">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-3 flex items-center gap-2"><Banknote className="w-4 h-4 text-primary" /> Direct deposit (elected)</h3>
                      <dl>
                        <Row label="Bank" value={selected.bank_name} />
                        <Row label="Account type" value={selected.account_type} />
                        <Row label="Name on account" value={selected.account_name} />
                        <Row label="Account (last 4)" value={selected.account_last4 ? `••••${selected.account_last4}` : null} />
                      </dl>
                      <p className="text-[11px] text-muted-foreground mt-2">Full account and routing numbers are captured only on the signed ACH authorization, not stored here.</p>
                    </section>
                  )}

                  {/* Agreements & e-sign */}
                  <section className="bg-card rounded-xl border border-border p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em] flex items-center gap-2"><FileSignature className="w-4 h-4 text-primary" /> Agreements</h3>
                      <button onClick={sendAll} disabled={busy} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-50"><Send className="w-3.5 h-3.5" /> Send all</button>
                    </div>
                    {[
                      ['installer_master', 'Master Agreement', selected.master_packet_signed_at],
                      ['installer_claims', 'Claims & Warranty', selected.claims_signed_at],
                      ...(selected.elect_direct_deposit ? [['installer_ach', 'Direct Deposit / ACH', selected.ach_signed_at]] : []),
                    ].map(([dt, label, signedAt]) => (
                      <div key={dt} className="py-2.5 text-sm border-b border-border last:border-0">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-medium">{label}</p>
                            {signedAt
                              ? <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" /> Signed {fmtDate(signedAt)}</p>
                              : <p className="text-[11px] text-muted-foreground">Not signed yet</p>}
                          </div>
                          {!signedAt && (
                            <div className="flex items-center gap-2 shrink-0">
                              <button onClick={() => copyLink(dt)} disabled={busy}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input text-xs font-medium hover:bg-muted disabled:opacity-50" title="Generate a signing link and copy it (no email sent)">
                                <Link2 className="w-3.5 h-3.5" /> Copy link
                              </button>
                              <button onClick={() => sendSig(dt, label)} disabled={busy || !selected.contact_email}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input text-xs font-medium hover:bg-muted disabled:opacity-50" title="Email the applicant this signing link">
                                <Send className="w-3.5 h-3.5" /> Send
                              </button>
                            </div>
                          )}
                        </div>
                        {!signedAt && links[dt] && (
                          <div className="mt-2 flex items-center gap-2 bg-muted rounded-lg border border-border pl-2.5 pr-1.5 py-1">
                            <input readOnly value={links[dt]} onFocus={(e) => e.target.select()}
                              className="flex-1 bg-transparent text-[11px] text-muted-foreground font-mono outline-none truncate" />
                            <button onClick={() => copyText(links[dt])} className="shrink-0 p-1 rounded text-primary hover:bg-background" title="Copy link">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    <p className="text-[11px] text-muted-foreground mt-2"><strong>Send</strong> emails the applicant the signing link; <strong>Copy link</strong> gives you the link to paste into your own email (handy while email delivery is off). A signer verifies by SMS code; the signed PDF is sealed and stored.</p>
                  </section>

                  {/* Promote to crew */}
                  {selected.master_packet_signed_at && selected.claims_signed_at && !selected.installer_id && (
                    <section className="bg-card rounded-xl border border-border p-5">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-2 flex items-center gap-2"><UserPlus className="w-4 h-4 text-primary" /> Onboard</h3>
                      <p className="text-sm text-muted-foreground mb-3">Master and Claims agreements are signed. Add this subcontractor as an active installer crew.</p>
                      <button onClick={promote} disabled={busy}
                        className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 hover:opacity-90">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Promote to installer crew
                      </button>
                    </section>
                  )}
                  {selected.installer_id && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                      <BadgeCheck className="w-4 h-4" /> Onboarded as an active installer crew.
                    </div>
                  )}

                  {/* Review actions */}
                  <section className="bg-card rounded-xl border border-border p-5">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-3 flex items-center gap-2"><User className="w-4 h-4 text-primary" /> Review</h3>
                    {selected.reviewed_by && <p className="text-xs text-muted-foreground mb-3">Last reviewed by {selected.reviewed_by} on {fmtDate(selected.reviewed_at)}{selected.review_notes ? ` — "${selected.review_notes}"` : ''}</p>}
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Review notes (optional)"
                      className="w-full bg-background border border-input rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-ring" />
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => act('approved')} disabled={busy}
                        className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve
                      </button>
                      <button onClick={() => act('rejected')} disabled={busy}
                        className="inline-flex items-center gap-1.5 border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
                        <X className="w-4 h-4" /> Reject
                      </button>
                      {selected.status !== 'under_review' && (
                        <button onClick={() => act('under_review')} disabled={busy}
                          className="inline-flex items-center gap-1.5 border border-border text-muted-foreground hover:bg-muted px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
                          Mark under review
                        </button>
                      )}
                    </div>
                  </section>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
