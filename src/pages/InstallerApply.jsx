import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/lib/supabaseClient';
import BrandLogo from '@/components/BrandLogo';
import {
  Loader2, Check, ShieldCheck, HardHat, BadgeCheck, AlertTriangle,
  Upload, FileText, Building2, User, ShieldAlert, Banknote, Send,
} from 'lucide-react';

const ENTITY_TYPES = ['LLC', 'Corporation', 'S-Corporation', 'Partnership', 'Sole Proprietorship', 'Other'];
const ACCOUNT_TYPES = ['Checking', 'Savings', 'Business', 'Personal'];
const FLOORING_CLASSES = ['C-8', 'CR-8', 'R-8'];

// The uploads we collect, and whether each is required to submit.
const DOCS = [
  { kind: 'roc_license', label: 'ROC license (copy)', required: true },
  { kind: 'bond', label: 'Contractor bond', required: true },
  { kind: 'coi', label: 'Certificate of insurance (+ endorsements)', required: true },
  { kind: 'w9', label: 'Form W-9', required: true },
];

const card = 'bg-card rounded-2xl border border-border shadow-sm p-5 sm:p-6';
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1.5';
const inputCls = 'w-full bg-background border border-input rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';
const sectionTitle = 'text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-4 flex items-center gap-2';

export default function InstallerApply() {
  const [params, setParams] = useSearchParams();
  const [token, setToken] = useState(params.get('token') || '');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ state_of_org: 'AZ', entity_type: '', account_type: '', elect_direct_deposit: false });
  const [files, setFiles] = useState({});          // kind -> path (already uploaded)
  const [uploading, setUploading] = useState({});  // kind -> bool
  const [roc, setRoc] = useState(null);            // last roc_lookup result
  const [rocBusy, setRocBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resumeEmail, setResumeEmail] = useState('');
  const [resumeSent, setResumeSent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const hydrate = useCallback((a) => {
    if (!a) return;
    setForm({
      legal_business_name: a.legal_business_name || '', dba: a.dba || '', entity_type: a.entity_type || '',
      state_of_org: a.state_of_org || 'AZ', tax_id_last4: a.tax_id_last4 || '', roc_license_no: a.roc_license_no || '',
      contact_name: a.contact_name || '', contact_phone: a.contact_phone || '', contact_email: a.contact_email || '',
      signatory_name: a.signatory_name || '', signatory_title: a.signatory_title || '', payee_name: a.payee_name || '',
      gl_carrier: a.gl_carrier || '', gl_expiration: a.gl_expiration || '', auto_carrier: a.auto_carrier || '',
      auto_expiration: a.auto_expiration || '', wc_carrier: a.wc_carrier || '', wc_expiration: a.wc_expiration || '',
      wc_waiver: !!a.wc_waiver, elect_direct_deposit: !!a.elect_direct_deposit, bank_name: a.bank_name || '',
      account_type: a.account_type || '', account_name: a.account_name || '', account_last4: a.account_last4 || '',
    });
    setFiles({
      roc_license: a.roc_license_file, bond: a.bond_file, coi: a.coi_file, w9: a.w9_file, voided_check: a.voided_check_file,
    });
    if (a.roc_business_name) setRoc({ business_name: a.roc_business_name, is_active: a.roc_is_active, classes: a.roc_classes, expiration_date: a.roc_expiration });
    if (a.status && a.status !== 'draft') setSubmitted(true);
  }, []);

  // On mount: resume from token, else start a new application and stamp the token into the URL.
  useEffect(() => {
    (async () => {
      try {
        if (token) {
          const a = await base44.functions.invoke('getInstallerApplication', { token });
          hydrate(a?.data ?? a);
        }
        // NOTHING is created here any more. Mounting used to insert a blank
        // application unconditionally, so every visit — a bounce, a bot, a
        // recruiter checking the link still worked — left a row behind. 7 of the 8
        // live rows were these orphans, which makes the applicant list useless for
        // knowing who actually applied. The row is now created on the first real
        // keystroke instead, in ensureToken() below.
      } catch (e) { setError(e.message || 'Could not start the application.'); }
      setLoading(false);
    })();
    // Mount only. The disable directive that used to sit here is gone with the
    // code it was suppressing — this effect no longer creates anything.
  }, []);

  // Creates the application the first time there is anything worth saving, and
  // stamps the token into the URL so a refresh or a returned-to link resumes.
  const ensureToken = useCallback(async () => {
    if (token) return token;
    const res = await base44.functions.invoke('createInstallerApplication', { payload: {} });
    const t = (res?.data ?? res)?.public_token;
    if (!t) throw new Error('Could not start the application.');
    setToken(t);
    const p = new URLSearchParams(params);
    p.set('token', t);
    setParams(p, { replace: true });
    return t;
  }, [token, params, setParams]);

  const persist = useCallback(async () => {
    setSaving(true);
    try {
      const t = await ensureToken();
      await base44.functions.invoke('saveInstallerApplication', { token: t, payload: form });
    }
    catch (e) { setError(e.message); }
    setSaving(false);
  }, [ensureToken, form]);

  const verifyRoc = async () => {
    const lic = (form.roc_license_no || '').trim();
    if (!lic) return;
    setRocBusy(true); setError('');
    try {
      const r = await base44.functions.invoke('rocLookup', { license: lic });
      const rec = Array.isArray(r?.data) ? r.data[0] : Array.isArray(r) ? r[0] : (r?.data ?? r);
      setRoc(rec || { notFound: true });
      if (rec?.business_name && !form.legal_business_name) set('legal_business_name', rec.business_name);
      await base44.functions.invoke('saveInstallerApplication', { token, payload: { ...form, roc_license_no: lic } });
    } catch (e) { setError(e.message); }
    setRocBusy(false);
  };

  const upload = async (kind, file) => {
    if (!file || !token) return;
    setUploading((u) => ({ ...u, [kind]: true })); setError('');
    try {
      const fd = new FormData();
      fd.append('token', token); fd.append('kind', kind); fd.append('file', file);
      const { data, error: e } = await supabase.functions.invoke('installerUpload', { body: fd });
      if (e || data?.error) throw new Error(data?.error || e.message);
      setFiles((f) => ({ ...f, [kind]: data.path }));
    } catch (e) { setError(`Upload failed: ${e.message}`); }
    setUploading((u) => ({ ...u, [kind]: false }));
  };

  const hasFlooringClass = Array.isArray(roc?.classes) && roc.classes.some((c) => FLOORING_CLASSES.includes(c.class));
  const missingDocs = DOCS.filter((d) => d.required && !files[d.kind]).map((d) => d.label);
  // A named list, not a boolean. The button was disabled with no stated reason,
  // and the commonest cause was roc.is_active — which is only set by a small
  // Verify button nobody is told to press. So a fully completed application sat
  // behind a greyed-out Submit, while the copy above it said an inactive licence
  // was fine. That is how an applicant gives up.
  const blockers = [
    !form.legal_business_name && 'your legal business name',
    !form.entity_type && 'your entity type',
    !roc?.is_active && 'your ROC licence — press Verify next to the licence number',
    !form.contact_name && 'a contact name',
    !form.contact_email && 'a contact email',
    !form.signatory_name && 'the name of whoever signs',
    missingDocs.length > 0 && `these documents: ${missingDocs.join(', ')}`,
    (form.elect_direct_deposit && !(form.bank_name && form.account_type))
      && 'your bank name and account type for direct deposit',
  ].filter(Boolean);
  const canSubmit = blockers.length === 0;

  const submit = async () => {
    setSubmitting(true); setError('');
    try {
      await base44.functions.invoke('saveInstallerApplication', { token, payload: form });
      const r = await base44.functions.invoke('submitInstallerApplication', { token });
      if ((r?.data ?? r) === false) throw new Error('Could not submit — the application may already be submitted.');
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setError(e.message); }
    setSubmitting(false);
  };

  const shell = (inner) => (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <BrandLogo imgClassName="h-7 sm:h-8" />
            <div className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase mt-1.5">Installer onboarding</div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="w-3.5 h-3.5" /> Secure</div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{inner}</main>
    </div>
  );

  if (loading) return shell(<div className="flex justify-center py-20"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>);

  if (submitted) return shell(
    <div className={card + ' text-center py-10'}>
      <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center mb-5"><Check className="w-8 h-8 text-emerald-600 dark:text-emerald-400" /></div>
      <h2 className="text-2xl font-bold tracking-tight">Application submitted</h2>
      <p className="text-muted-foreground mt-2 max-w-md mx-auto">Thanks! Our team will review your license, insurance, and documents. Once approved, we'll email you a link to e-sign your Subcontractor Agreement, Claims &amp; Warranty Agreement{form.elect_direct_deposit ? ', and Direct Deposit authorization' : ''}.</p>
    </div>
  );

  const Doc = ({ kind, label, required }) => (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{label}{required && <span className="text-red-500"> *</span>}</p>
        {files[kind] && <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5"><Check className="w-3 h-3" /> Uploaded</p>}
      </div>
      <label className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input text-xs font-medium cursor-pointer hover:bg-muted transition">
        {uploading[kind] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {files[kind] ? 'Replace' : 'Upload'}
        <input type="file" accept="application/pdf,image/*" className="hidden" disabled={uploading[kind]}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(kind, f); e.target.value = ''; }} />
      </label>
    </div>
  );

  return shell(
    <div className="space-y-4 sm:space-y-5 pb-28">
      {/* Hero */}
      <section className={card}>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><HardHat className="w-6 h-6 text-primary" /></div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Become a Floor Daddy installer</h1>
            <p className="text-sm text-muted-foreground mt-1">Tell us about your business and upload your license and insurance. It takes about 10 minutes, and your progress saves automatically to this link.</p>
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 px-4 py-3 text-sm flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span></div>}

      {/* Only shown to someone who arrived WITHOUT a token — i.e. they lost the
          link. The link goes to the email already on the application; the ROC
          number would be the obvious key and is the wrong one, because Arizona ROC
          licences are public record. */}
      {!token && (
        <section className={card}>
          <h2 className={sectionTitle}><Send className="w-4 h-4 text-primary" /> Already started?</h2>
          <p className="text-sm text-muted-foreground">
            If you began an application before, enter the email you used and we will
            send your link back to you.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              aria-label="The email you used before"
              value={resumeEmail}
              onChange={(e) => setResumeEmail(e.target.value)}
              placeholder="you@yourcompany.com"
              className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={!resumeEmail.trim() || resumeSent}
              onClick={async () => {
                await base44.functions.invoke('requestInstallerApplicationLink', { email: resumeEmail.trim() });
                // Deliberately unconditional: the server returns the same thing
                // either way, so saying anything else here would leak what it
                // carefully does not.
                setResumeSent(true);
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input bg-background px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              Send my link
            </button>
          </div>
          {resumeSent && (
            <p className="mt-2 text-sm text-muted-foreground">
              If we have an application for that email, the link is on its way. Check
              your inbox and your spam folder.
            </p>
          )}
        </section>
      )}

      {/* ROC license */}
      <section className={card}>
        <h2 className={sectionTitle}><BadgeCheck className="w-4 h-4 text-primary" /> Arizona ROC license</h2>
        <label className={labelCls}>ROC license number</label>
        <div className="flex gap-2">
          <input className={inputCls} value={form.roc_license_no || ''} inputMode="numeric" placeholder="e.g. 352055"
            onChange={(e) => set('roc_license_no', e.target.value)} onBlur={persist} />
          <button onClick={verifyRoc} disabled={rocBusy || !form.roc_license_no} className="shrink-0 bg-primary text-primary-foreground px-4 rounded-lg font-semibold text-sm disabled:opacity-50 hover:opacity-90 transition">{rocBusy ? '…' : 'Verify'}</button>
        </div>
        {roc && (roc.notFound || roc.business_name === undefined ? (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> No active AZ license found for that number. Double-check the number.</p>
        ) : (
          <div className="mt-3 rounded-xl border border-border bg-muted/50 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              {roc.is_active ? <BadgeCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}
              {roc.business_name} — {roc.is_active ? 'Active' : (roc.status || 'Not active')}
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              Classifications: {(roc.classes || []).map((c) => c.class).join(', ') || '—'} · Expires {roc.expiration_date || '—'}
            </div>
            {!hasFlooringClass && <p className="text-amber-600 dark:text-amber-400 text-xs mt-1.5">Note: no floor-covering class (C-8 / CR-8 / R-8) found. Flooring installs require one — you can still apply.</p>}
          </div>
        ))}
      </section>

      {/* Business identity */}
      <section className={card}>
        <h2 className={sectionTitle}><Building2 className="w-4 h-4 text-primary" /> Business identity</h2>
        <p className="text-xs text-muted-foreground mb-4 -mt-2">Your legal name must match your ROC license, your W-9, and the name on payments.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><label className={labelCls}>Legal business name *</label><input className={inputCls} value={form.legal_business_name || ''} onChange={(e) => set('legal_business_name', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>Doing business as (if any)</label><input className={inputCls} value={form.dba || ''} onChange={(e) => set('dba', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>Entity type *</label>
            <select className={inputCls} value={form.entity_type || ''} onChange={(e) => set('entity_type', e.target.value)} onBlur={persist}>
              <option value="">Select…</option>{ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>State of organization</label><input className={inputCls} value={form.state_of_org || ''} onChange={(e) => set('state_of_org', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>Last 4 of Tax ID (EIN/SSN)</label><input className={inputCls} value={form.tax_id_last4 || ''} maxLength={4} inputMode="numeric" placeholder="1234" onChange={(e) => set('tax_id_last4', e.target.value)} onBlur={persist} /></div>
        </div>
      </section>

      {/* Contact & signatory */}
      <section className={card}>
        <h2 className={sectionTitle}><User className="w-4 h-4 text-primary" /> Contact &amp; signer</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>Contact name *</label><input className={inputCls} value={form.contact_name || ''} onChange={(e) => set('contact_name', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>Payee name (matches W-9)</label><input className={inputCls} value={form.payee_name || ''} onChange={(e) => set('payee_name', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>Phone</label><input className={inputCls} value={form.contact_phone || ''} inputMode="tel" onChange={(e) => set('contact_phone', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>Email *</label><input className={inputCls} value={form.contact_email || ''} inputMode="email" onChange={(e) => set('contact_email', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>Signer name *</label><input className={inputCls} value={form.signatory_name || ''} onChange={(e) => set('signatory_name', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>Signer title</label><input className={inputCls} value={form.signatory_title || ''} placeholder="Owner, Member, President…" onChange={(e) => set('signatory_title', e.target.value)} onBlur={persist} /></div>
        </div>
      </section>

      {/* Insurance */}
      <section className={card}>
        <h2 className={sectionTitle}><ShieldAlert className="w-4 h-4 text-primary" /> Insurance</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>General liability carrier</label><input className={inputCls} value={form.gl_carrier || ''} onChange={(e) => set('gl_carrier', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>GL expiration</label><input type="date" className={inputCls} value={form.gl_expiration || ''} onChange={(e) => set('gl_expiration', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>Auto liability carrier</label><input className={inputCls} value={form.auto_carrier || ''} onChange={(e) => set('auto_carrier', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>Auto expiration</label><input type="date" className={inputCls} value={form.auto_expiration || ''} onChange={(e) => set('auto_expiration', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>Workers' comp carrier</label><input className={inputCls} value={form.wc_carrier || ''} disabled={form.wc_waiver} onChange={(e) => set('wc_carrier', e.target.value)} onBlur={persist} /></div>
          <div><label className={labelCls}>WC expiration</label><input type="date" className={inputCls} value={form.wc_expiration || ''} disabled={form.wc_waiver} onChange={(e) => set('wc_expiration', e.target.value)} onBlur={persist} /></div>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm">
          <input type="checkbox" checked={!!form.wc_waiver} onChange={(e) => { set('wc_waiver', e.target.checked); }} onBlur={persist} />
          Sole proprietor with no employees — WC waived (A.R.S. § 23-961(N))
        </label>
      </section>

      {/* Documents */}
      <section className={card}>
        <h2 className={sectionTitle}><FileText className="w-4 h-4 text-primary" /> Documents</h2>
        <p className="text-xs text-muted-foreground mb-2 -mt-2">PDF or photo. Stored securely; only Floor Daddy staff can view them.</p>
        {DOCS.map((d) => <Doc key={d.kind} {...d} />)}
      </section>

      {/* Direct deposit (optional) */}
      <section className={card}>
        <h2 className={sectionTitle}><Banknote className="w-4 h-4 text-primary" /> Direct deposit <span className="normal-case tracking-normal font-normal text-muted-foreground">(optional)</span></h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.elect_direct_deposit} onChange={(e) => { set('elect_direct_deposit', e.target.checked); }} onBlur={persist} />
          I want to be paid by direct deposit (ACH)
        </label>
        {form.elect_direct_deposit && (
          <div className="mt-4 grid sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Bank / credit union</label><input className={inputCls} value={form.bank_name || ''} onChange={(e) => set('bank_name', e.target.value)} onBlur={persist} /></div>
            <div><label className={labelCls}>Account type</label>
              <select className={inputCls} value={form.account_type || ''} onChange={(e) => set('account_type', e.target.value)} onBlur={persist}>
                <option value="">Select…</option>{ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Name on account</label><input className={inputCls} value={form.account_name || ''} onChange={(e) => set('account_name', e.target.value)} onBlur={persist} /></div>
            <div><label className={labelCls}>Last 4 of account #</label><input className={inputCls} value={form.account_last4 || ''} maxLength={4} inputMode="numeric" onChange={(e) => set('account_last4', e.target.value)} onBlur={persist} /></div>
            <div className="sm:col-span-2"><Doc kind="voided_check" label="Voided check or bank letter" /></div>
            <p className="sm:col-span-2 text-xs text-muted-foreground flex items-start gap-1.5"><ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" /> For your security, your full account and routing numbers are collected only when you e-sign the ACH authorization — not stored here.</p>
          </div>
        )}
      </section>

      {/* Submit */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="text-xs text-muted-foreground">
          {saving ? 'Saving…' : 'Progress saved to this link.'}
          {missingDocs.length > 0 && <span className="block text-amber-600 dark:text-amber-400 mt-0.5">Still needed: {missingDocs.join(', ')}</span>}
        </div>
        {blockers.length > 0 && (
          <div className="mb-3 rounded-lg border border-warn/40 bg-warn/10 p-3">
            <p className="text-sm font-medium text-foreground">
              Before you can submit, we still need:
            </p>
            <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
              {blockers.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
        )}
        <button onClick={submit} disabled={!canSubmit || submitting}
          className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl font-semibold text-sm disabled:opacity-50 hover:opacity-90 transition">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Submit application
        </button>
      </div>
    </div>
  );
}
