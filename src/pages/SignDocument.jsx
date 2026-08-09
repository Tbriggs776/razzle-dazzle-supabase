import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/dataClient';
import { Loader2, ShieldCheck, Check, FileText, PenLine, Lock } from 'lucide-react';

// Public (anonymous) e-signature page. The `token` in the URL is the capability —
// all reads/writes go through the token-scoped `esign` Edge Function; the browser
// never touches the tables directly. Flow: load -> (optional SMS code) -> review +
// consent -> draw signature + type name -> submit -> sealed PDF emailed.
// Customer-facing: Floor Daddy brand, mobile-first, themed via the app tokens.
async function esign(action, payload) {
  const { data, error } = await base44.functions.invoke('esign', { action, ...payload });
  if (error) throw new Error(error.message || 'Request failed');
  if (data?.error) throw new Error(data.error);
  return data;
}

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const point = (e) => {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (c.width / rect.width), y: (e.clientY - rect.top) * (c.height / rect.height) };
  };
  const start = (e) => { e.preventDefault(); drawing.current = true; const ctx = canvasRef.current.getContext('2d'); const { x, y } = point(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e) => {
    if (!drawing.current) return; e.preventDefault();
    const ctx = canvasRef.current.getContext('2d'); const { x, y } = point(e);
    ctx.lineTo(x, y); ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    if (!hasInk) setHasInk(true);
    onChange(canvasRef.current.toDataURL('image/png'));
  };
  const end = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setHasInk(false); onChange(null); };

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-border bg-muted/60 overflow-hidden">
        <canvas
          ref={canvasRef} width={640} height={200}
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
          className="w-full touch-none block cursor-crosshair" style={{ height: 200 }}
        />
        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-4 text-muted-foreground/60 text-[11px] uppercase tracking-[0.2em]">
            <PenLine className="w-4 h-4 mr-1.5" /> sign here
          </div>
        )}
      </div>
      <button type="button" onClick={clear} className="mt-2 text-sm text-muted-foreground hover:text-foreground underline underline-offset-2">Clear signature</button>
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
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-extrabold tracking-tight text-primary">Floor Daddy</div>
            <div className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase mt-0.5">Secure document signing</div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="w-3.5 h-3.5" /> Encrypted
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{inner}</main>
    </div>
  );
  const card = "bg-card rounded-2xl border border-border shadow-sm p-5 sm:p-6";

  if (state.loading) return shell(<div className="flex justify-center py-20"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>);
  if (state.error) return shell(<div className={card + " text-center"}><h2 className="text-lg font-semibold">Unable to load</h2><p className="text-muted-foreground mt-1">{state.error}</p></div>);

  if (d.status === 'signed') return shell(
    <div className={card + " text-center py-10"}>
      <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center mb-5"><Check className="w-8 h-8 text-emerald-600 dark:text-emerald-400" /></div>
      <h2 className="text-2xl font-bold tracking-tight">Signed — thank you!</h2>
      <p className="text-muted-foreground mt-2 max-w-sm mx-auto">A signed copy has been emailed to you for your records.</p>
      {d.sealed_pdf_url && <a href={d.sealed_pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-6 bg-primary text-primary-foreground px-6 py-3 rounded-xl font-semibold text-sm hover:opacity-90 transition"><FileText className="w-4 h-4" /> Download signed PDF</a>}
    </div>
  );
  if (d.status === 'expired') return shell(<div className={card + " text-center"}><h2 className="text-lg font-semibold">This link has expired</h2><p className="text-muted-foreground mt-1">Please contact us for a new signing link.</p></div>);

  const ready = !needsOtp && consent && signature && printedName.trim().length >= 2;

  return shell(
    <div className="space-y-4 sm:space-y-5 pb-24 sm:pb-0">
      {/* Document */}
      <section className={card}>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-4 flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> {d.label}</h2>
        <dl className="divide-y divide-border">
          {Object.entries(d.document || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => (
            <div key={k} className="py-2.5 flex flex-col sm:flex-row sm:justify-between sm:gap-6 gap-0.5 text-sm">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium sm:text-right break-words">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* SMS identity verification */}
      {needsOtp && (
        <section className={card}>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> Verify your identity</h2>
          {!otpSent ? (
            <>
              <p className="text-sm text-muted-foreground mb-4">For your security, we'll text a 6-digit code to {d.phone_mask || 'your phone'} before you sign.</p>
              <button onClick={sendCode} disabled={busy} className="bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50 hover:opacity-90 transition">{busy ? 'Sending…' : 'Text me a code'}</button>
            </>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="block text-xs text-muted-foreground mb-1.5">Enter code</label><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} className="w-36 bg-background border border-input rounded-lg px-3 py-2.5 tracking-[0.3em] text-lg text-center focus:outline-none focus:ring-2 focus:ring-ring" placeholder="000000" /></div>
              <button onClick={verifyCode} disabled={busy || code.length < 6} className="bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50 hover:opacity-90 transition">{busy ? 'Verifying…' : 'Verify'}</button>
              <button onClick={sendCode} disabled={busy} className="text-sm text-muted-foreground underline underline-offset-2">Resend</button>
            </div>
          )}
        </section>
      )}

      {/* Consent + signature (locked until identity verified when required) */}
      <section className={card + (needsOtp ? " opacity-50 pointer-events-none select-none" : "")}>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-4">Consent &amp; Signature</h2>
        <label className="flex items-start gap-3 mb-5 cursor-pointer">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-5 h-5 rounded accent-[hsl(var(--primary))] shrink-0" />
          <span className="text-sm text-muted-foreground leading-relaxed">{d.consent_text}</span>
        </label>
        <div className="mb-4">
          <label className="block text-xs text-muted-foreground mb-1.5">Type your full legal name</label>
          <input value={printedName} onChange={(e) => setPrintedName(e.target.value)} className="w-full bg-background border border-input rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-ring" placeholder="Full name" />
        </div>
        <SignaturePad onChange={setSignature} />
      </section>

      {err && <p className="text-sm text-destructive px-1">{err}</p>}

      {/* Submit — sticky on mobile so it's always in thumb reach */}
      <div className="fixed sm:static bottom-0 inset-x-0 sm:inset-auto bg-background/95 sm:bg-transparent backdrop-blur sm:backdrop-blur-0 border-t sm:border-0 border-border px-4 sm:px-0 py-3 sm:py-0">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={submit}
            disabled={busy || !ready}
            className="w-full bg-primary text-primary-foreground py-3.5 rounded-xl font-bold text-base disabled:opacity-40 hover:opacity-90 transition"
          >
            {busy ? 'Submitting…' : 'Sign & Submit'}
          </button>
          <p className="text-center text-xs text-muted-foreground mt-2 flex items-center justify-center gap-1.5"><Lock className="w-3 h-3" /> Your IP address and signing time are recorded for verification.</p>
        </div>
      </div>
    </div>
  );
}
