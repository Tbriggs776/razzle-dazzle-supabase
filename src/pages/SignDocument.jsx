import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/dataClient';
import { Loader2, ShieldCheck, Check, FileText, PenLine } from 'lucide-react';

// Public (anonymous) e-signature page. The `token` in the URL is the capability —
// all reads/writes go through the token-scoped `esign` Edge Function; the browser
// never touches the tables directly. Flow: load -> (optional SMS code) -> review +
// consent -> draw signature + type name -> submit -> sealed PDF emailed.
async function esign(action, payload) {
  const { data, error } = await base44.functions.invoke('esign', { action, ...payload });
  if (error) throw new Error(error.message || 'Request failed');
  if (data?.error) throw new Error(data.error);
  return data;
}

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  const point = (e) => {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (c.width / rect.width), y: (e.clientY - rect.top) * (c.height / rect.height) };
  };
  const start = (e) => { e.preventDefault(); drawing.current = true; const ctx = canvasRef.current.getContext('2d'); const { x, y } = point(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e) => {
    if (!drawing.current) return; e.preventDefault();
    const ctx = canvasRef.current.getContext('2d'); const { x, y } = point(e);
    ctx.lineTo(x, y); ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke();
    onChange(canvasRef.current.toDataURL('image/png'));
  };
  const end = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); onChange(null); };

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden">
        <canvas
          ref={canvasRef} width={640} height={200}
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
          className="w-full touch-none block" style={{ height: 200 }}
        />
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-3 text-slate-300 text-xs uppercase tracking-widest">
          <PenLine className="w-4 h-4 mr-1.5" /> sign here
        </div>
      </div>
      <button type="button" onClick={clear} className="mt-2 text-sm text-slate-500 hover:text-slate-700 underline">Clear signature</button>
    </div>
  );
}

export default function SignDocument() {
  const token = new URLSearchParams(window.location.search).get('token');
  const [state, setState] = useState({ loading: true });
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [consent, setConsent] = useState(false);
  const [printedName, setPrintedName] = useState('');
  const [signature, setSignature] = useState(null);

  const load = useCallback(async () => {
    try { setState({ loading: false, data: await esign('get', { token }) }); }
    catch (e) { setState({ loading: false, error: e.message }); }
  }, [token]);

  useEffect(() => { if (token) load(); else setState({ loading: false, error: 'Missing signing token.' }); }, [token, load]);

  const d = state.data;
  const otpVerified = d?.otp_verified;
  const needsOtp = d?.require_sms_otp && !otpVerified;

  const sendCode = async () => { setErr(''); setBusy(true); try { await esign('send_otp', { token }); setOtpSent(true); } catch (e) { setErr(e.message); } setBusy(false); };
  const verifyCode = async () => { setErr(''); setBusy(true); try { await esign('verify_otp', { token, code }); await load(); } catch (e) { setErr(e.message); } setBusy(false); };
  const submit = async () => {
    setErr(''); setBusy(true);
    try { const res = await esign('submit', { token, consent, printed_name: printedName.trim(), signature }); setState({ loading: false, data: { ...d, status: 'signed', sealed_pdf_url: res.sealed_pdf_url } }); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const shell = (inner) => (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-2xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">RAZZLE DAZZLE</h1>
          <p className="text-[9px] font-sans tracking-wider text-slate-400 uppercase mt-0.5">BY FLOOR DADDY</p>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-6 py-8">{inner}</div>
    </div>
  );
  const card = "bg-white rounded-2xl border border-slate-100 p-6";

  if (state.loading) return shell(<div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-indigo-600 animate-spin" /></div>);
  if (state.error) return shell(<div className={card + " text-center"}><h2 className="text-lg font-semibold text-slate-800">Unable to load</h2><p className="text-slate-500 mt-1">{state.error}</p></div>);

  if (d.status === 'signed') return shell(
    <div className={card + " text-center"}>
      <div className="w-14 h-14 mx-auto rounded-2xl bg-green-100 flex items-center justify-center mb-4"><Check className="w-7 h-7 text-green-600" /></div>
      <h2 className="text-xl font-bold text-slate-800">Signed — thank you!</h2>
      <p className="text-slate-500 mt-2">A signed copy has been emailed to you for your records.</p>
      {d.sealed_pdf_url && <a href={d.sealed_pdf_url} target="_blank" rel="noreferrer" className="inline-block mt-5 bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-semibold text-sm">Download signed PDF</a>}
    </div>
  );
  if (d.status === 'expired') return shell(<div className={card + " text-center"}><h2 className="text-lg font-semibold text-slate-800">This link has expired</h2><p className="text-slate-500 mt-1">Please contact us for a new signing link.</p></div>);

  return shell(
    <div className="space-y-5">
      {/* Document */}
      <div className={card}>
        <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2"><FileText className="w-4 h-4" /> {d.label}</h2>
        <dl className="divide-y divide-slate-100">
          {Object.entries(d.document || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => (
            <div key={k} className="py-2.5 flex justify-between gap-6 text-sm">
              <dt className="text-slate-500">{k}</dt><dd className="text-slate-800 font-medium text-right">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* SMS identity verification */}
      {needsOtp && (
        <div className={card}>
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Verify your identity</h2>
          {!otpSent ? (
            <>
              <p className="text-sm text-slate-600 mb-3">For your security, we'll text a 6-digit code to {d.phone_mask || 'your phone'} before you sign.</p>
              <button onClick={sendCode} disabled={busy} className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50">{busy ? 'Sending…' : 'Text me a code'}</button>
            </>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="block text-xs text-slate-500 mb-1">Enter code</label><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} className="w-32 border border-slate-300 rounded-lg px-3 py-2 tracking-widest text-lg" placeholder="000000" /></div>
              <button onClick={verifyCode} disabled={busy || code.length < 6} className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50">{busy ? 'Verifying…' : 'Verify'}</button>
              <button onClick={sendCode} disabled={busy} className="text-sm text-slate-500 underline">Resend</button>
            </div>
          )}
        </div>
      )}

      {/* Consent + signature (locked until identity verified when required) */}
      <div className={card + (needsOtp ? " opacity-50 pointer-events-none" : "")}>
        <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">Consent &amp; Signature</h2>
        <label className="flex items-start gap-3 mb-5 cursor-pointer">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 w-4 h-4" />
          <span className="text-sm text-slate-600 leading-relaxed">{d.consent_text}</span>
        </label>
        <div className="mb-4">
          <label className="block text-xs text-slate-500 mb-1">Type your full legal name</label>
          <input value={printedName} onChange={(e) => setPrintedName(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="Full name" />
        </div>
        <SignaturePad onChange={setSignature} />
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <button
        onClick={submit}
        disabled={busy || needsOtp || !consent || !signature || printedName.trim().length < 2}
        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3.5 rounded-xl font-bold disabled:opacity-40"
      >
        {busy ? 'Submitting…' : 'Sign & Submit'}
      </button>
      <p className="text-center text-xs text-slate-400">Your IP address and the time of signing are recorded for verification.</p>
    </div>
  );
}
