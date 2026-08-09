import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/dataClient';
import { getIntegrations, setSecret, clearSecret, setIntegration, testIntegration } from '@/lib/integrationsApi';
import { Plug, Loader2, Check, X, AlertTriangle, Save, Zap, ShieldCheck, FileSignature } from 'lucide-react';

function Toggle({ on, onClick, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <span className="text-sm text-muted-foreground">{label}</span>
      <button type="button" onClick={onClick} className={`relative w-11 h-6 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-muted'}`} aria-pressed={on}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${on ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

const STATUS = {
  not_configured: { label: 'Not configured', cls: 'bg-secondary text-muted-foreground border-border' },
  configured: { label: 'Configured, untested', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25' },
  verified: { label: 'Verified', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25' },
  error: { label: 'Error', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25' },
  disabled: { label: 'Disabled', cls: 'bg-secondary text-muted-foreground border-border' },
};

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.not_configured;
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${s.cls}`}>{s.label}</span>;
}

function IntegrationCard({ integ, onChanged }) {
  const [secrets, setSecrets] = useState({});          // NAME -> newly typed value
  const [config, setConfig] = useState(integ.config || {});
  const [enabled, setEnabled] = useState(integ.is_enabled);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState(null);                // { ok, text }

  useEffect(() => { setConfig(integ.config || {}); setEnabled(integ.is_enabled); }, [integ]);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      for (const f of integ.secret_fields) {
        const v = secrets[f.name];
        if (v && v.trim()) await setSecret(f.name, v.trim());
      }
      await setIntegration(integ.key, enabled, config);
      setSecrets({});
      setMsg({ ok: true, text: 'Saved.' });
      await onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Save failed' });
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setMsg(null);
    try {
      const res = await testIntegration(integ.key);
      setMsg({ ok: !!res?.ok, text: res?.message || (res?.ok ? 'OK' : 'Failed') });
      await onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Test failed' });
    } finally { setTesting(false); }
  };

  const removeSecret = async (name) => {
    setSaving(true);
    try { await clearSecret(name); await onChanged(); } finally { setSaving(false); }
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-lg font-bold text-foreground">{integ.name}</h3>
            <StatusBadge status={enabled ? integ.status : 'disabled'} />
          </div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mt-1">{integ.category}</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
          <span className="text-sm text-muted-foreground">Enabled</span>
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}
            aria-pressed={enabled}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${enabled ? 'translate-x-5' : ''}`} />
          </button>
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
        {integ.secret_fields.map((f) => (
          <div key={f.name} className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">{f.label}</label>
              {f.is_set && (
                <button onClick={() => removeSecret(f.name)} className="text-xs text-muted-foreground hover:text-destructive">Clear</button>
              )}
            </div>
            <input
              type="password"
              autoComplete="new-password"
              value={secrets[f.name] || ''}
              onChange={(e) => setSecrets((s) => ({ ...s, [f.name]: e.target.value }))}
              placeholder={f.is_set ? '•••••••••••• (set — type to replace)' : 'Not set'}
              className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        ))}
        {integ.config_fields.map((f) => (
          <div key={f.name} className="space-y-1">
            <label className="text-sm font-medium text-foreground">{f.label}</label>
            <input
              type="text"
              value={config[f.name] || ''}
              onChange={(e) => setConfig((c) => ({ ...c, [f.name]: e.target.value }))}
              placeholder={f.placeholder || ''}
              className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        ))}
      </div>

      {msg && (
        <div className={`mt-4 text-sm flex items-start gap-2 rounded-lg px-3 py-2 border ${msg.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25' : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25'}`}>
          {msg.ok ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}
      {!msg && integ.status === 'error' && integ.last_error && (
        <div className="mt-4 text-sm flex items-start gap-2 rounded-lg px-3 py-2 border bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{integ.last_error}</span>
        </div>
      )}

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 h-9 px-4 text-sm font-semibold bg-primary hover:opacity-90 disabled:opacity-60 text-primary-foreground rounded-lg">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
        </button>
        <button onClick={test} disabled={testing} className="inline-flex items-center gap-2 h-9 px-4 text-sm font-semibold bg-card border border-border hover:bg-secondary disabled:opacity-60 text-foreground rounded-lg">
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Test connection
        </button>
        {integ.last_tested_at && (
          <span className="text-xs text-muted-foreground ml-auto">Last tested {new Date(integ.last_tested_at).toLocaleString()}</span>
        )}
      </div>
    </div>
  );
}

function EsignTypeCard({ t }) {
  const [enabled, setEnabled] = useState(t.esign_enabled);
  const [otp, setOtp] = useState(t.require_sms_otp);
  const [consent, setConsent] = useState(t.consent_text || '');
  const [expiry, setExpiry] = useState(t.expiry_days || 14);
  const [notify, setNotify] = useState((t.notify_emails || []).join(', '));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const { error } = await base44.functions.invoke('adminSetEsignType', {
        document_type: t.document_type, esign_enabled: enabled, require_sms_otp: otp,
        consent_text: consent, expiry_days: Number(expiry) || 14,
        notify_emails: notify.split(',').map((s) => s.trim()).filter(Boolean),
      });
      if (error) throw error;
      setMsg({ ok: true, text: 'Saved.' });
    } catch (e) { setMsg({ ok: false, text: e.message || 'Save failed' }); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          <h3 className="text-lg font-bold text-foreground">{t.label}</h3>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25' : 'bg-secondary text-muted-foreground border-border'}`}>{enabled ? 'E-sign on' : 'E-sign off'}</span>
        </div>
        <Toggle on={enabled} onClick={() => setEnabled((v) => !v)} label="Require e-signature" />
      </div>
      <div className="space-y-4">
        <Toggle on={otp} onClick={() => setOtp((v) => !v)} label="Require SMS code to sign" />
        <div>
          <label className="text-sm font-medium text-foreground">Consent statement shown to the signer</label>
          <textarea value={consent} onChange={(e) => setConsent(e.target.value)} rows={4} className="mt-1 w-full px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground">Link expires after (days)</label>
            <input type="number" min="1" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Notify on completion (comma-separated)</label>
            <input value={notify} onChange={(e) => setNotify(e.target.value)} placeholder="ops@floordaddy.com" className="mt-1 w-full h-10 px-3 border border-border rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>
      </div>
      {msg && (
        <div className={`mt-4 text-sm flex items-center gap-2 rounded-lg px-3 py-2 border ${msg.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25' : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25'}`}>
          {msg.ok ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}<span>{msg.text}</span>
        </div>
      )}
      <div className="flex items-center mt-5 pt-4 border-t border-border">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 h-9 px-4 text-sm font-semibold bg-primary hover:opacity-90 disabled:opacity-60 text-primary-foreground rounded-lg">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
        </button>
      </div>
    </div>
  );
}

function EsignSettings() {
  const [types, setTypes] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    base44.functions.invoke('adminGetEsignTypes')
      .then(({ data, error }) => { if (error) throw error; setTypes(data || []); })
      .catch((e) => setError(e.message || 'Failed to load'));
  }, []);
  return (
    <div className="mt-12">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><FileSignature className="w-6 h-6 text-primary" /></div>
        <div>
          <h2 className="text-2xl font-bold text-foreground">E-Signature</h2>
          <p className="text-muted-foreground mt-0.5">Choose which documents require a signature, and how signers verify their identity.</p>
        </div>
      </div>
      {error ? <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25">{error}</div>
        : !types ? <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        : <div className="space-y-5">{types.map((t) => <EsignTypeCard key={t.document_type} t={t} />)}</div>}
    </div>
  );
}

export default function Integrations() {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setError(null);
      setIntegrations(await getIntegrations());
    } catch (e) {
      setError(e.message || 'Failed to load integrations');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
              <Plug className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Integrations</h1>
              <p className="text-muted-foreground mt-0.5">Enter and test the API credentials for each connected service.</p>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 text-sm text-muted-foreground bg-card border border-border rounded-lg px-4 py-3">
            <ShieldCheck className="w-4 h-4 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Secrets are encrypted in Supabase Vault and are never shown back in the browser. Enter a key, click <b>Save</b>, then <b>Test connection</b> to verify it works.</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25">{error}</div>
        ) : (
          <div className="space-y-5">
            {integrations.map((integ) => (
              <IntegrationCard key={integ.key} integ={integ} onChanged={load} />
            ))}
          </div>
        )}

        <EsignSettings />
      </div>
    </div>
  );
}
