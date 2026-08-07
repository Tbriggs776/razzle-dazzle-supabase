import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, Eraser } from 'lucide-react';

export default function DesignModView() {
  const urlParams = new URLSearchParams(window.location.search);
  const modId = urlParams.get('id');

  const [customerPrintedName, setCustomerPrintedName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef(null);

  const { data: mod, isLoading } = useQuery({
    queryKey: ['designMod', modId],
    queryFn: async () => {
      const mods = await base44.entities.DesignMod.filter({ id: modId });
      return mods[0] || null;
    },
    enabled: !!modId
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  }, [mod?.id]);

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function startDraw(e) {
    e.preventDefault();
    isDrawing.current = true;
    lastPos.current = getPos(e, canvasRef.current);
  }

  function draw(e) {
    if (!isDrawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
  }

  function endDraw() {
    isDrawing.current = false;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const signature = canvasRef.current ? canvasRef.current.toDataURL('image/png') : '';
      await base44.functions.invoke('submitDesignMod', {
        designModId: modId,
        customerPrintedName,
        customerSignature: signature
      });
    },
    onSuccess: () => setSubmitted(true)
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!mod) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500">Design modification not found.</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Design Modification Signed</h1>
          <p className="text-slate-500">Thank you! Your design modification has been signed and submitted. Our team will be in touch shortly.</p>
        </div>
      </div>
    );
  }

  if (mod.status === 'signed') {
    const signedDate = mod.signed_at ? new Date(mod.signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A';
    return (
      <div className="min-h-screen bg-slate-50 py-10 px-4">
        <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-lg p-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <span className="text-green-600 font-semibold text-sm">Signed on {signedDate}</span>
          </div>
          <div className="text-center mb-8">
            <p className="font-semibold text-slate-700">ROC352055</p>
            <h1 className="text-2xl font-bold text-blue-600 mt-2 tracking-wide">DESIGN MODIFICATION</h1>
          </div>
          <div className="space-y-4 mb-6">
            <div className="flex items-center gap-4 border-b border-slate-200 pb-3">
              <span className="text-sm text-slate-600 w-52 flex-shrink-0">Customer First Name</span>
              <span className="font-semibold text-slate-800">{mod.customer_first_name}</span>
            </div>
            <div className="flex items-center gap-4 border-b border-slate-200 pb-3">
              <span className="text-sm text-slate-600 w-52 flex-shrink-0">Customer Last Name</span>
              <span className="font-semibold text-slate-800">{mod.customer_last_name}</span>
            </div>
            {mod.job_number && (
              <div className="flex items-center gap-4 border-b border-slate-200 pb-3">
                <span className="text-sm text-slate-600 w-52 flex-shrink-0">Job Number CG</span>
                <span className="font-semibold text-slate-800">{mod.job_number}</span>
              </div>
            )}
            <div className="border-b border-slate-200 pb-3">
              <p className="text-sm text-slate-600 mb-2">Products or installation changes:</p>
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 text-slate-800 text-sm whitespace-pre-wrap min-h-24">
                {mod.products_or_changes}
              </div>
            </div>
            <div className="flex items-center gap-4 border-b border-slate-200 pb-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">Value Added Costs $</span>
                <span className="font-semibold text-slate-800">{Number(mod.value_added_costs || 0).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-sm text-slate-600">Funds Collected Terms</span>
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-1">
                    <input type="radio" readOnly checked={mod.funds_collected_terms === 'Credit Card'} onChange={() => {}} /> Credit Card
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" readOnly checked={mod.funds_collected_terms === 'Existing Synchrony Financing Account'} onChange={() => {}} /> Existing Synchrony Financing Account
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700 mb-6">
            I agree to the design modifications and associated costs above. I agree to have them charged on my credit card or Synchrony Financing and for those charges to be collected prior to the new modifications commencing. No newly modifications will start prior to funds being collected. I agree to the terms and conditions for the above work and cost and agree to be bound by them.
          </div>
          <div className="space-y-4">
            {mod.customer_printed_name && (
              <div className="flex items-center gap-4 border-b border-slate-200 pb-3">
                <span className="text-sm text-slate-600 w-52 flex-shrink-0">Customer Printed Name</span>
                <span className="font-semibold text-slate-800">{mod.customer_printed_name}</span>
              </div>
            )}
            {mod.customer_signature && (
              <div className="border-b border-slate-200 pb-4">
                <p className="text-sm text-slate-600 mb-2">Customer Signature</p>
                <div className="border border-slate-200 rounded-lg bg-white p-2">
                  <img src={mod.customer_signature} alt="Customer Signature" className="max-h-32 w-auto" />
                </div>
              </div>
            )}
            <div className="flex items-center gap-4 border-b border-slate-200 pb-3">
              <span className="text-sm text-slate-600 w-40 flex-shrink-0">Customer Email</span>
              <span className="font-semibold text-slate-800">{mod.customer_email}</span>
            </div>
            <div className="flex items-center gap-4 pb-3">
              <span className="text-sm text-slate-600 w-40 flex-shrink-0">Date Signed:</span>
              <span className="font-semibold text-slate-800">{signedDate}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-8">
          <p className="font-semibold text-slate-700">ROC352055</p>
          <h1 className="text-2xl font-bold text-blue-600 mt-2 tracking-wide">DESIGN MODIFICATION</h1>
        </div>

        <div className="space-y-4 mb-6">
          <div className="flex items-center gap-4 border-b border-slate-200 pb-3">
            <span className="text-sm text-slate-600 w-52 flex-shrink-0">Customer First Name</span>
            <span className="font-semibold text-slate-800">{mod.customer_first_name}</span>
          </div>
          <div className="flex items-center gap-4 border-b border-slate-200 pb-3">
            <span className="text-sm text-slate-600 w-52 flex-shrink-0">Customer Last Name</span>
            <span className="font-semibold text-slate-800">{mod.customer_last_name}</span>
          </div>
          {mod.job_number && (
            <div className="flex items-center gap-4 border-b border-slate-200 pb-3">
              <span className="text-sm text-slate-600 w-52 flex-shrink-0">Job Number CG</span>
              <span className="font-semibold text-slate-800">{mod.job_number}</span>
            </div>
          )}
          <div className="border-b border-slate-200 pb-3">
            <p className="text-sm text-slate-600 mb-2">Products or installation changes:</p>
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 text-slate-800 text-sm whitespace-pre-wrap min-h-24">
              {mod.products_or_changes}
            </div>
          </div>
          <div className="flex items-center gap-4 border-b border-slate-200 pb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600">Value Added Costs $</span>
              <span className="font-semibold text-slate-800">{Number(mod.value_added_costs || 0).toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm text-slate-600">Funds Collected Terms (check one)</span>
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-1">
                  <input type="radio" readOnly checked={mod.funds_collected_terms === 'Credit Card'} onChange={() => {}} /> Credit Card
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" readOnly checked={mod.funds_collected_terms === 'Existing Synchrony Financing Account'} onChange={() => {}} /> Existing Synchrony Financing Account
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700 mb-6">
          I agree to the design modifications and associated costs above. I agree to have them charged on my credit card or Synchrony Financing and for those charges to be collected prior to the new modifications commencing. No newly modifications will start prior to funds being collected. I agree to the terms and conditions for the above work and cost and agree to be bound by them.
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Customer Printed Name *</Label>
            <Input
              value={customerPrintedName}
              onChange={e => setCustomerPrintedName(e.target.value)}
              placeholder="Type your full name"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Customer Signature *</Label>
              <Button type="button" variant="ghost" size="sm" onClick={clearSignature} className="text-slate-500 h-7">
                <Eraser className="w-3 h-3 mr-1" /> Clear
              </Button>
            </div>
            <canvas
              ref={canvasRef}
              width={580}
              height={140}
              className="w-full border-2 border-dashed border-slate-300 rounded-lg bg-white touch-none cursor-crosshair"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
            <p className="text-xs text-slate-400">Sign above using your mouse, trackpad, or finger</p>
          </div>

          <div className="flex items-center gap-4 border-b border-slate-200 pb-3">
            <span className="text-sm text-slate-600 w-40 flex-shrink-0">Customer Email</span>
            <span className="font-semibold text-slate-800">{mod.customer_email}</span>
          </div>
          <div className="flex items-center gap-4 pb-3">
            <span className="text-sm text-slate-600 w-40 flex-shrink-0">Date:</span>
            <span className="font-semibold text-slate-800">{today}</span>
          </div>
        </div>

        <Button
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending || !customerPrintedName.trim()}
          className="w-full mt-6 h-12 bg-blue-600 hover:bg-blue-700 text-base font-bold tracking-wide"
        >
          {submitMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
          SUBMIT
        </Button>
      </div>
    </div>
  );
}