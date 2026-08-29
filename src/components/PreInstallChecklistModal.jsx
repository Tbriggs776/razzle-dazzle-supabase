import React, { useRef, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';

const CHECKLIST_ITEMS = [
  {
    id: 'est_dates', title: 'Estimated Installation & Completion Dates',
    text: "Customer acknowledges that flooring installation is a construction project and that all installation dates, start dates, and completion dates, whether stated in this Agreement or communicated verbally or in writing by Floor Daddy, LLC, are estimates only and are not guaranteed. Customer further acknowledges and agrees that unforeseen circumstances, including but not limited to product availability, manufacturer delays, weather, site conditions, change orders, labor availability, or other events beyond Floor Daddy, LLC's reasonable control, may affect the project schedule. Accordingly, Floor Daddy, LLC's inability to meet any estimated installation or completion date shall not constitute a breach of this Agreement and shall not entitle Customer to cancel this Agreement, withhold payment, demand a price reduction, assess penalties, or seek monetary damages. Customer agrees that all payments required under this Agreement remain due in accordance with the payment terms, regardless of any scheduling delays. Floor Daddy, LLC does not guarantee completion of the Work within any estimated timeframe."
  },
  {
    id: 'floor_height', title: 'Floor Height & Wall Exposure Acknowledgment',
    text: "Customer acknowledges that replacing one flooring product with another (including, but not limited to, removing tile, hardwood, or engineered wood and installing luxury vinyl plank (LVP), laminate, or other flooring products) may result in a change in finished floor height. Such height differences are an inherent characteristic of installing products of different thicknesses. Customer further acknowledges that any exposed, unpainted, damaged, or previously concealed wall surfaces, paint lines, drywall, texture, caulking, or other cosmetic conditions revealed due to the change in floor height or the removal/reinstallation of existing baseboards are pre-existing conditions and are not the responsibility of Floor Daddy. Floor Daddy shall have no obligation to repair, patch, texture, caulk, repaint, or otherwise restore exposed wall areas or other cosmetic conditions resulting from the difference in flooring thickness."
  },
  {
    id: 'cod', title: 'COD',
    text: 'Must be available upon arrival for your installation to begin. Installation will not begin without full payment. Floordaddy accepts ONLY, Visa, Mastercard, American Express, Discover, money orders or certified checks. Personal checks are NOT ACCEPTED. In the event we cannot get a hold of you to collect the COD prior to installation. You are consenting for us to run any cards on file, automatically to collect any and all COD\'s and balances, prior to starting the installation.'
  },
  {
    id: 'product', title: 'Product Confirmation',
    textBefore: '', textAfter: 'I am confirming the product style and color is correct. If I am not home the day of the installation, you agree to allow us to install this style and color. If at any time, you decide you do not like this product. The costs to replace this product will be the sole responsibility of the customer.',
    hasProductInput: true
  },
  {
    id: 'install_date', title: 'Installation Date',
    text: 'will be confirmed by our installation center prior to your scheduled installation. If we are unable to reach you, and for your installation to occur as scheduled, it is vital that you notify our Customer Service team at 555-555-0100 and reference your contract number. They can be reached from 8 a.m. to 9 p.m. (MST) Monday through Friday and Saturday from 8 a.m. to 5pm (MST).'
  },
  {
    id: 'delivery', title: 'Delivery Times',
    text: 'Installations occur between 8 a.m. and 6 p.m. Your installer will call you on the morning of your installation to provide an estimated window of arrival. Unfortunately, a specific time of arrival cannot be provided.'
  },
  {
    id: 'pets', title: 'Pets',
    text: 'Please provide a safe location away from the installation area(s) during the installation process.'
  },
  {
    id: 'requirements', title: 'Installation Requirements & Length',
    text: 'Area(s) in which installation will occur must have electricity and a temperature maintained between 65-85 degrees for 48 hours prior to ensure proper installation. Each Job is unique, and some require more time than others. Floordaddy\'s goal is to provide you with a professional installation. Every effort will be made to complete your job in a timely manner.'
  },
  {
    id: 'breaks', title: 'Breaks/Lunches',
    text: 'The installer will leave every day for 1-hour min but do not worry, they will be back. They are just going to lunch and/or picking up supplies. If they do not show up past an hour, please call the office for us to check, but they will return!'
  },
  {
    id: 'extra_material', title: 'Extra Material',
    text: 'Additional material is often sent to the job sites to ensure adequate material is available to complete our project. Customers are not charged for the additional materials. Your installer will leave the remains of any opened cartons.'
  },
  {
    id: 'completion', title: 'Certificate of Completion',
    text: 'It is required that one of the homeowners be at the job when it is completed. After the installation is complete, the installers will walk through the installed area(s) with you to ensure the installation meets your expectations. You will be asked to sign our Certificate of Completion at that time. NOTE: For financed purchases, the individual who signed the contract must also sign our Certificate of Completion.'
  },
  {
    id: 'appliances', title: 'Appliances & Electronics',
    text: 'We do not disconnect / reconnect any appliances including gas lines for stoves or plumbing attachments on refrigerators, washers, dryers, stovetops, dishwashers, and waterlines for fridges or ice machines. Installers do not disconnect / reconnect electronics. We are not responsible for Wifi/Cable connections or problems.'
  },
  {
    id: 'water', title: 'Water',
    text: 'We are not responsible for bad or broken water shut off valves. You need to call a plumber.'
  },
  {
    id: 'grandfather', title: 'Grandfather Clocks, Slate Pool Tables, Filled Aquariums and Grand or Baby Grand Pianos',
    text: 'items installers will not move.'
  },
  {
    id: 'knick', title: 'Knick-Knacks, Breakables, Small items, Pictures, Clothes, Shoes and Wall Hangings',
    text: 'should be moved prior to the installers arriving. This includes items located in hallways or other areas that the installers must use to access the installation area(s). Clothes, Shoes should be removed from the lower half of the closet.'
  },
  {
    id: 'large', title: 'Large/complex items',
    text: 'like Waterbeds, Giant Entertainment Centers, Solid Oak beds, dressers, and or furniture need to be taken apart or moved prior. Installers can help with these items but may be tough and we are not responsible for them if something breaks. You release Floordaddy from all liability for these complex items. Otherwise, installers will move everything else.'
  },
  {
    id: 'packing', title: 'Packing / Unpacking Boxes',
    text: 'Unfortunately, our installers will not be responsible for any packing or unpacking of boxes containing small items. Please pack items on bookshelves or in cabinets prior to the installation date.'
  },
  {
    id: 'cleaning', title: 'Cleaning of Home',
    text: 'This is the customer\'s responsibility as this is a construction site that creates dust and debris. Blinds, cabinets, counters, etc. will be covered to the best of our ability, but particles, dust, and debris will get through no matter what. We will clean as well as we can prior to leaving, but we will not be responsible for thorough or deep cleanings due to the nature of a construction site.'
  },
  {
    id: 'change_orders', title: 'Change Orders',
    text: 'Must be signed and paid in full, prior to any work being done or being completed.'
  },
  {
    id: 'asbestos', title: 'Asbestos',
    text: 'If, at or before the time of installation, it is suspected or determined that asbestos is present, Buyer will be required to test for the presence of asbestos, and Floordaddy will STOP installation until the buyer has the asbestos removed by a licensed abatement company. The abatement company must follow all applicable federal and state asbestos regulations and must provide a clean air or clearance sampling certificate.'
  },
  {
    id: 'adhesive', title: 'Acknowledgment of Adhesive Use in Carpet Installation',
    text: 'As part of our standard carpet installation process, adhesives and related bonding materials may be used. All products utilized are considered safe for residential and commercial application and meet or exceed applicable safety standards and regulatory requirements. We recognize that individuals may have specific sensitivities, allergies, or health concerns related to such materials. If you, or anyone occupying the premises, have known sensitivities or require additional information regarding the products used, it is your responsibility to notify Floor Daddy prior to the start of installation. Product Safety Data Sheets (SDS) and technical specifications are available upon request. By initialing below, you acknowledge that you have read and understand this notice, and that you accept responsibility for disclosing any relevant health concerns in advance of installation.'
  },
  {
    id: 'nicks', title: 'Nicks / Scratches / Scoring',
    text: 'Installers will try their best to avoid nicks, scratches and scoring of your baseboards and walls, but since the carpet has to be cut and tucked under the baseboards there are some damages that may not be prevented. Floordaddy will not touch or paint baseboards or walls. Baseboards with vinyl plank flooring may have gaps between the bottom of the base and the floor. This is not a defect, but a natural characteristic of the base on uneven concrete or thicker flooring that was there prior.'
  },
  {
    id: 'seams', title: 'Seams',
    text: 'are required in areas in which the room is wider and longer than widths in which the product is manufactured. Placing of seams shall be at the discretion of the lead installer unless otherwise specified in writing. Visibility will vary by product and how it reacts to room lighting. NOTE: Seams are not always invisible due to the quality of carpet and Berbers.'
  },
  {
    id: 'doors', title: 'Door Casings/Doors',
    text: 'When installing vinyl plank, laminate, or tile, and removing existing thicker flooring, you will notice door casings are now short, due to the new product being thinner. Floordaddy is not responsible for short door casings and we will not caulk them. Floordaddy does not cut, replace, or adjust door sizes. The gap from the bottom of the door to the floor is not the responsibility of Floordaddy. If doors now jam, slow to open, or scrape the flooring, Floordaddy cannot be responsible for this, and the cost to remedy the situation is the sole responsibility of the customer.'
  },
  {
    id: 'tile', title: 'Tile',
    text: 'must remain free from foot traffic for 12 hours after initial tile installation and 12 hours after grouting. Manufacture spec to be followed on all materials, including grout joint size, tile spacing and installation.'
  },
  {
    id: 'chairs', title: 'Chairs',
    text: 'damages caused to vinyl or laminate from roller chairs. This will void the warranty/guarantee. Office chairs must have floor mats underneath them and FD is not responsible for the damage that is caused by them.'
  },
  {
    id: 'moisture', title: 'Moisture',
    text: 'While some products may be listed as water-resistant or waterproof, we cannot be held liable for damage to any water exposure. Including but not limited to; dog/cat pee, any and all leaks, floods, or water damage to one board or the whole house. All steam mops, Steam Sharks, or shampooing the carpet on your own or by a professional, etc., will void warranties.'
  },
  {
    id: 'laminate', title: 'Laminate Flooring Installations Over 1,000 sq.ft.',
    text: 'For installations of laminate flooring exceeding 1,000 square feet, it is required and in your best interest that we install T-molding transitions between certain rooms or areas. Laminate flooring naturally expands and contracts with changes in temperature and humidity. Without these transition breaks, the flooring may buckle, gap, or sustain damage over time.'
  },
  {
    id: 'glue', title: 'Glue',
    text: 'Glue is a strong adhesive used to bond materials like wood, paper, metal, or fabric. Type depends on strength, dry time, and surface.'
  },
  {
    id: 'care', title: 'How To Care For Your floors',
    text: 'Laminate, luxury vinyl plank (LVP), or wood floors should not be cleaned by a wet mop, with water, soap, harsh chemicals, Fabuloso, Pledge, Pine Sol, Vinegar (even diluted in water), or products that may contain wax, or oils, as it may permanently damage the flooring. All of Floordaddy\'s floors should be cleaned by manufactured and Floordaddy-approved products with dry static mops. In the event you are noticing the floor is buckling, peaking or cupping, you will notify Floor Daddy within 72 hours of discovering these problems. Failure to notify us within 72 hours may void your warranty.'
  },
];

export default function PreInstallChecklistModal({ open, onClose, onComplete, lead }) {
  const [productInfo, setProductInfo] = useState('');
  const [uploading, setUploading] = useState(false);
  const [hasSigned, setHasSigned] = useState(false);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef(null);

  const initials = lead
    ? `${lead.first_name?.[0] || ''}${lead.last_name?.[0] || ''}`.toUpperCase()
    : '??';
  const customerName = lead ? `${lead.first_name} ${lead.last_name}` : '';
  const today = format(new Date(), 'MMM dd, yyyy');

  useEffect(() => {
    if (!open) {
      setProductInfo('');
      setHasSigned(false);
    }
  }, [open]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const startDraw = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    isDrawing.current = true;
    lastPos.current = getPos(e, canvas);
  };

  const draw = (e) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
    setHasSigned(true);
  };

  const endDraw = () => {
    isDrawing.current = false;
    lastPos.current = null;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSigned(false);
  };

  const handleSubmit = async () => {
    if (!hasSigned || !productInfo.trim()) return;
    setUploading(true);
    try {
      const canvas = canvasRef.current;
      const dataUrl = canvas.toDataURL('image/png');
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'pre-install-signature.png', { type: 'image/png' });
      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      onComplete({ productInfo: productInfo.trim(), signatureUrl: fileUrl });
    } catch (err) {
      console.error('Signature upload failed:', err);
      toast.error('Failed to save signature. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl w-full max-h-[92vh] flex flex-col p-0 gap-0">
        {/* Fixed header */}
        <DialogHeader className="px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <DialogTitle className="text-center text-xl font-bold text-blue-700 tracking-wide">
            PRE-INSTALLATION CHECKLIST
          </DialogTitle>
          <div className="flex gap-4 mt-2 text-sm">
            <div className="flex-1 border border-slate-300 rounded px-3 py-1.5">
              <span className="text-slate-500 mr-1">Name:</span>
              <span className="font-medium">{customerName}</span>
            </div>
            <div className="flex-1 border border-slate-300 rounded px-3 py-1.5">
              <span className="text-slate-500 mr-1">Date:</span>
              <span className="font-medium">{today}</span>
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {CHECKLIST_ITEMS.map((item) => (
            <div key={item.id} className="flex gap-3">
              {/* Initials badge */}
              <span className="flex-shrink-0 text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 h-fit mt-0.5 min-w-[32px] text-center">
                {initials}
              </span>
              <div className="flex-1 text-sm leading-relaxed text-slate-700">
                {item.hasProductInput ? (
                  <>
                    <span className="font-bold">Product Confirmation</span>{' '}
                    <input
                      type="text"
                      value={productInfo}
                      onChange={e => setProductInfo(e.target.value)}
                      placeholder="Enter product name, style and color..."
                      className="inline-block border-b-2 border-blue-400 bg-transparent text-blue-700 font-medium placeholder:text-slate-400 placeholder:text-xs focus:outline-none focus:border-blue-600 mx-1 px-1 min-w-[200px] text-sm"
                    /><span className="text-red-500 font-bold ml-1">*</span>
                    {', '}{item.textAfter}
                  </>
                ) : (
                  <>
                    <span className="font-bold">{item.title}</span>
                    {item.text.startsWith('like ') || item.text.startsWith('items ') || item.text.startsWith('should ') || item.text.startsWith('are ') || item.text.startsWith('must ') || item.text.startsWith('damages ')
                      ? ' ' : ' - '}
                    {item.text}
                  </>
                )}
              </div>
            </div>
          ))}

          {/* Signature section */}
          <div className="border-t-2 border-slate-300 pt-6 space-y-4">
            <p className="text-sm text-slate-600 font-medium">
              By signing below, the customer acknowledges they have read and agree to all items above.
            </p>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-slate-700">Customer Signature *</label>
                <button
                  onClick={clearSignature}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Clear
                </button>
              </div>
              <div className="border-2 border-slate-300 rounded-xl bg-white overflow-hidden touch-none">
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={150}
                  className="w-full cursor-crosshair block"
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={endDraw}
                />
              </div>
              <p className="text-xs text-slate-400 mt-1 text-center">Sign above using mouse or touch</p>
            </div>

            <div className="flex items-center gap-3 pt-2 pb-4">
              <div className="flex-1 border border-slate-300 rounded px-3 py-1.5 text-sm">
                <span className="text-slate-500 mr-1">Buyer's Signature</span>
              </div>
              <div className="border border-slate-300 rounded px-3 py-1.5 text-sm">
                <span className="text-slate-500 mr-1">Date:</span>
                <span>{today}</span>
              </div>
            </div>

            <div className="text-sm text-slate-600 flex gap-6">
              <span><span className="text-slate-500">Buyer:</span> <span className="font-medium">{customerName}</span></span>
              {lead?.email && <span><span className="text-slate-500">Email:</span> <span className="font-medium">{lead.email}</span></span>}
            </div>
          </div>
        </div>

        {/* Fixed footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex-shrink-0 flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1" disabled={uploading}>
            Cancel
          </Button>
          <div className="flex-1 space-y-1">
            <Button
              onClick={handleSubmit}
              disabled={!hasSigned || !productInfo.trim() || uploading}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {uploading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
              ) : (
                <><CheckCircle2 className="w-4 h-4 mr-2" />Submit Checklist</>
              )}
            </Button>
            {(!hasSigned || !productInfo.trim()) && (
              <p className="text-xs text-amber-600 text-center">
                {!productInfo.trim() && !hasSigned
                  ? 'Product confirmation and signature required'
                  : !productInfo.trim()
                    ? 'Product confirmation required'
                    : 'Signature required'}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}