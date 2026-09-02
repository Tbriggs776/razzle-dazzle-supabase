import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, Eraser } from 'lucide-react';
import { SignedImage } from '@/lib/fileUrl';
import { invokeFailure } from '@/lib/invokeResult';
import { toast } from 'sonner';

function formatCurrency(val) {
  if (val == null) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

export default function ManualSalesContractView() {
  const urlParams = new URLSearchParams(window.location.search);
  const contractId = urlParams.get('id');

  const [customerPrintedName, setCustomerPrintedName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef(null);

  const { data: contract, isLoading } = useQuery({
    queryKey: ['manualSalesContract', contractId],
    queryFn: async () => {
      const contracts = await base44.entities.ManualSalesContract.filter({ id: contractId });
      return contracts[0] || null;
    },
    enabled: !!contractId
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
  }, [contract?.id]);

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function startDraw(e) { e.preventDefault(); isDrawing.current = true; lastPos.current = getPos(e, canvasRef.current); }
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
  function endDraw() { isDrawing.current = false; }
  function clearSignature() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const signature = canvasRef.current ? canvasRef.current.toDataURL('image/png') : '';
      const res = await base44.functions.invoke('submitManualSalesContract', {
        contractId,
        customerPrintedName,
        customerSignature: signature
      });
      // A customer signing a sales contract. The result was discarded and the
      // thank-you screen rendered either way, so a failed signing looked
      // identical to a completed one — to the customer AND to us.
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data;
    },
    onSuccess: () => setSubmitted(true),
    onError: (e) => toast.error(
      `That did not go through — ${e?.message || 'the request failed'}. Your signature is still here, please try again.`
    ),
  });

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!contract) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Contract not found.</p></div>;
  }

  if (submitted || contract.status === 'signed') {
    const signedDate = contract.signed_at
      ? new Date(contract.signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    if (submitted) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-6">
          <div className="bg-card rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
            <CheckCircle2 className="w-16 h-16 text-good mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-foreground mb-2">Contract Signed!</h1>
            <p className="text-muted-foreground">Thank you! Your sales contract commitment has been signed. Our team will be in touch shortly.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background py-10 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto bg-card rounded-2xl shadow-lg p-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <CheckCircle2 className="w-5 h-5 text-good" />
            <span className="text-good font-semibold text-sm">Signed on {signedDate}</span>
          </div>
          <ContractBody contract={contract} />
          <div className="space-y-4 mt-6">
            {contract.customer_printed_name && (
              <div className="flex items-center gap-4 border-b border-border pb-3">
                <span className="text-sm text-muted-foreground w-52 flex-shrink-0">Customer Printed Name</span>
                <span className="font-semibold text-foreground">{contract.customer_printed_name}</span>
              </div>
            )}
            {contract.customer_signature && (
              <div className="border-b border-border pb-4">
                <p className="text-sm text-muted-foreground mb-2">Customer Signature</p>
                <div className="border border-border rounded-lg bg-card p-2">
                  <SignedImage src={contract.customer_signature} alt="Customer Signature" className="max-h-32 w-auto" />
                </div>
              </div>
            )}
            <div className="flex items-center gap-4 border-b border-border pb-3">
              <span className="text-sm text-muted-foreground w-40 flex-shrink-0">Date Signed</span>
              <span className="font-semibold text-foreground">{signedDate}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="min-h-screen bg-background py-10 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto bg-card rounded-2xl shadow-lg p-8">
        <ContractBody contract={contract} />

        <div className="bg-secondary border border-border rounded-lg p-4 text-sm text-foreground mb-6 mt-6">
          I, the undersigned, hereby commit to the purchase of the products and services described above from Floor Daddy, LLC. I understand this is a commitment to purchase and that a formal contract will be provided upon system availability. The deposit collected is non-refundable per our standard terms and conditions.
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Customer Printed Name *</Label>
            <Input value={customerPrintedName} onChange={e => setCustomerPrintedName(e.target.value)} placeholder="Type your full name" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Customer Signature *</Label>
              <Button type="button" variant="ghost" size="sm" onClick={clearSignature} className="text-muted-foreground h-7">
                <Eraser className="w-3 h-3 mr-1" /> Clear
              </Button>
            </div>
            <canvas
              ref={canvasRef}
              width={580}
              height={140}
              className="w-full border-2 border-dashed border-border rounded-lg bg-white touch-none cursor-crosshair"
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
            />
            <p className="text-xs text-muted-foreground">Sign above using your mouse, trackpad, or finger</p>
          </div>
          <div className="flex items-center gap-4 pb-3">
            <span className="text-sm text-muted-foreground w-40 flex-shrink-0">Date:</span>
            <span className="font-semibold text-foreground">{today}</span>
          </div>
        </div>

        <Button
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending || !customerPrintedName.trim()}
          className="w-full mt-6 h-12 bg-primary text-primary-foreground hover:opacity-90 text-base font-bold tracking-wide"
        >
          {submitMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
          SIGN CONTRACT
        </Button>
      </div>
    </div>
  );
}

function ContractBody({ contract }) {
  return (
    <div>
      <div className="text-center mb-8">
        <p className="font-semibold text-foreground">ROC352055</p>
        <h1 className="text-2xl font-bold text-primary mt-2 tracking-wide">SALES CONTRACT COMMITMENT</h1>
        <p className="text-xs text-muted-foreground mt-1">FLOOR DADDY, LLC</p>
      </div>
      <div className="space-y-3">
        <Row label="Customer First Name" value={contract.customer_first_name} />
        <Row label="Customer Last Name" value={contract.customer_last_name} />
        {contract.customer_phone && <Row label="Phone" value={contract.customer_phone} />}
        {contract.customer_address && <Row label="Installation Address" value={contract.customer_address} />}
        {contract.consultant_name && <Row label="Design Consultant" value={contract.consultant_name} />}
        {contract.sale_date && <Row label="Sale Date" value={contract.sale_date} />}
        <div className="border-b border-border pb-3">
          <p className="text-sm text-muted-foreground mb-2">Products / Services:</p>
          <div className="border border-border rounded-lg p-3 bg-secondary text-foreground text-sm whitespace-pre-wrap min-h-20">
            {contract.products_description}
          </div>
        </div>
        <Row label="Total Sale Amount" value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(contract.sale_amount || 0)} />
        {contract.deposit_amount > 0 && <Row label="Deposit Collected" value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(contract.deposit_amount)} />}
        {contract.deposit_payment_method && <Row label="Payment Method" value={contract.deposit_payment_method} />}
        {contract.check_number && <Row label="Check Number" value={contract.check_number} />}
        {contract.notes && <Row label="Notes" value={contract.notes} />}
        {contract.customer_email && <Row label="Customer Email" value={contract.customer_email} />}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start gap-4 border-b border-border pb-3">
      <span className="text-sm text-muted-foreground w-52 flex-shrink-0">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}