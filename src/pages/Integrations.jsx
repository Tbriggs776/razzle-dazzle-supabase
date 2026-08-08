import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/dataClient';
import { getIntegrations, setSecret, clearSecret, setIntegration, testIntegration } from '@/lib/integrationsApi';
import { Plug, Loader2, Check, X, AlertTriangle, Save, Zap, ShieldCheck, FileSignature } from 'lucide-react';

function Toggle({ on, onClick, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <span className="text-sm text-slate-600">{label}</span>
      <button type="button" onClick={onClick} className={`relative w-11 h-6 rounded-full transition-colors ${on ? 'bg-indigo-600' : 'bg-slate-300'}`} aria-pressed={on}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${on ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

const STATUS = {
  not_configured: { label: 'Not configured', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  configured: { label: 'Configured, untested', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  verified: { label: 'Verified', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  error: { label: 'Error', cls: 'bg-red-50 text-red-700 border-red-200' },
  disabled: { label: 'Disabled', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
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
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-lg font-bold text-slate-800">{integ.name}</h3>
            <StatusBadge status={enabled ? integ.status : 'disabled'} />
          </div>
          <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mt-1">{integ.category}</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
          <span className="text-sm text-slate-500">Enabled</span>
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-indigo-600' : 'bg-slate-300'}`}
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
              <label className="text-sm font-medium text-slate-700">{f.label}</label>
              {f.is_set && (
                <button onClick={() => removeSecret(f.name)} className="text-xs text-slate-400 hover:text-red-600">Clear</button>
              )}
            </div>
            <input
              type="password"
              autoComplete="new-password"
              value={secrets[f.name] || ''}
              onChange={(e) => setSecrets((s) => ({ ...s, [f.name]: e.target.value }))}
              placeholder={f.is_set ? '•••••••••••• (set — type to replace)' : 'Not set'}
              className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        ))}
        {integ.config_fields.map((f) => (
          <div key={f.name} className="space-y-1">
            <label className="text-sm font-medium text-slate-700">{f.label}</label>
            <input
              type="text"
              value={config[f.name] || ''}
              onChange={(e) => setConfig((c) => ({ ...c, [f.name]: e.target.value }))}
              placeholder={f.placeholder || ''}
              className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        ))}
      </div>

      {msg && (
        <div className={`mt-4 text-sm flex items-start gap-2 rounded-lg px-3 py-2 border ${msg.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {msg.ok ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}
      {!msg && integ.status === 'error' && integ.last_error && (
        <div className="mt-4 text-sm flex items-start gap-2 rounded-lg px-3 py-2 border bg-red-50 text-red-700 border-red-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{integ.last_error}</span>
        </div>
      )}

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 h-9 px-4 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
        </button>
        <button onClick={test} disabled={testing} className="inline-flex items-center gap-2 h-9 px-4 text-sm font-semibold bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 rounded-lg">
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Test connection
        </button>
        {integ.last_tested_at && (
          <span className="text-xs text-slate-400 ml-auto">Last tested {new Date(integ.last_tested_at).toLocaleString()}</span>
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
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          <h3 className="text-lg font-bold text-slate-800">{t.label}</h3>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>{enabled ? 'E-sign on' : 'E-sign off'}</span>
        </div>
        <Toggle on={enabled} onClick={() => setEnabled((v) => !v)} label="Require e-signature" />
      </div>
      <div className="space-y-4">
        <Toggle on={otp} onClick={() => setOtp((v) => !v)} label="Require SMS code to sign" />
        <div>
          <label className="text-sm font-medium text-slate-700">Consent statement shown to the signer</label>
          <textarea value={consent} onChange={(e) => setConsent(e.target.value)} rows={4} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-700">Link expires after (days)</label>
            <input type="number" min="1" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="mt-1 w-full h-10 px-3 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Notify on completion (comma-separated)</label>
            <input value={notify} onChange={(e) => setNotify(e.target.value)} placeholder="ops@floordaddy.com" className="mt-1 w-full h-10 px-3 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>
      </div>
      {msg && (
        <div className={`mt-4 text-sm flex items-center gap-2 rounded-lg px-3 py-2 border ${msg.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {msg.ok ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}<span>{msg.text}</span>
        </div>
      )}
      <div className="flex items-center mt-5 pt-4 border-t border-slate-100">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 h-9 px-4 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg">
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
        <div className="w-11 h-11 rounded-xl bg-indigo-100 flex items-center justify-center"><FileSignature className="w-6 h-6 text-indigo-600" /></div>
        <div>
          <h2 className="text-2xl font-bold text-slate-800">E-Signature</h2>
          <p className="text-slate-500 mt-0.5">Choose which documents require a signature, and how signers verify their identity.</p>
        </div>
      </div>
      {error ? <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
        : !types ? <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
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
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Plug className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-800">Integrations</h1>
              <p className="text-slate-500 mt-0.5">Enter and test the API credentials for each connected service.</p>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 text-sm text-slate-500 bg-white border border-slate-200 rounded-lg px-4 py-3">
            <ShieldCheck className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
            <span>Secrets are encrypted in Supabase Vault and are never shown back in the browser. Enter a key, click <b>Save</b>, then <b>Test connection</b> to verify it works.</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
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
