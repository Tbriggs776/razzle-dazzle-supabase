import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { User, Phone, Mail, HardHat, Info, Package, Download, Loader2 } from 'lucide-react';
import { generatePreInstallPDF } from '@/utils/generatePreInstallPDF';

export default function PreInstallChecklistView({ project, sale, customer, installerMode }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const customerName = customer ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() : 'Customer';
      const productInfo = sale?.pre_install_product_info || project?.pre_install_product_info || '';
      const signatureUrl = sale?.pre_install_checklist_signature_url || project?.pre_install_checklist_signature_url || '';
      await generatePreInstallPDF({
        customerName,
        productInfo,
        signatureUrl,
        saleDate: sale?.sale_date,
      });
    } finally {
      setDownloading(false);
    }
  };

  const { data: fieldManager } = useQuery({
    queryKey: ['jobBriefFieldManager', project?.field_manager_id],
    queryFn: () => base44.entities.TeamMember.get(project.field_manager_id),
    enabled: !!project?.field_manager_id,
  });

  const { data: installCoordinator } = useQuery({
    queryKey: ['jobBriefInstallCoordinator', project?.install_coordinator_id],
    queryFn: () => base44.entities.TeamMember.get(project.install_coordinator_id),
    enabled: !!project?.install_coordinator_id,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Job Brief</h2>
          <p className="text-sm text-muted-foreground">
            Everything you need to begin this job — your assigned team and who to contact.
          </p>
        </div>
      </div>

      {/* Who to contact / assignments */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <Info className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Your Floor Daddy Support Team</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Field Manager */}
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <HardHat className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Field Manager</span>
            </div>
            {fieldManager ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">{fieldManager.first_name} {fieldManager.last_name}</p>
                {fieldManager.phone && (
                  <a href={`tel:${fieldManager.phone}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                    <Phone className="w-3 h-3" />{fieldManager.phone}
                  </a>
                )}
                {fieldManager.email && (
                  <a href={`mailto:${fieldManager.email}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                    <Mail className="w-3 h-3" />{fieldManager.email}
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not assigned</p>
            )}
          </div>

          {/* Install Coordinator */}
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              {/* Green here is role differentiation from the Field Manager icon, not status. */}
              <User className="w-4 h-4 text-good" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Install Coordinator</span>
            </div>
            {installCoordinator ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">{installCoordinator.first_name} {installCoordinator.last_name}</p>
                {installCoordinator.phone && (
                  <a href={`tel:${installCoordinator.phone}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                    <Phone className="w-3 h-3" />{installCoordinator.phone}
                  </a>
                )}
                {installCoordinator.email && (
                  <a href={`mailto:${installCoordinator.email}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                    <Mail className="w-3 h-3" />{installCoordinator.email}
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not assigned</p>
            )}
          </div>
        </div>

      </div>

      {/* Pre-Install welcome */}
      <div className="bg-card rounded-xl border border-border p-6 space-y-5">
        <div>
          <h3 className="text-xl font-bold text-foreground">You've Got a New Job. Let's Razzle Dazzle It.</h3>
        </div>

        <div className="space-y-3 text-sm text-foreground leading-relaxed">
          <p>Welcome to your next Floor Daddy install. This isn't just another floor — it's another customer we get to wow.</p>
          <p>At Floor Daddy, we don't just install floors... we Razzle Dazzle. That means every customer gets communication, care, speed, and a finished job they brag about to their neighbors. You're the one who makes that happen on-site, and we're in this together.</p>
          <p>Everything you need to start this job is right here in the Pre-Install tab. Your Design Consultant already locked in the details and the customer signed off acknowledging every pre-installation requirement. This is your source of truth. Review it before you touch a single plank.</p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">The system has 5 sections. You'll move through them in order:</h4>
          <ol className="space-y-2 text-sm text-foreground">
            <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">1.</span><span><span className="font-semibold">Job Brief</span> — know the job before you get there (you're here now)</span></li>
            <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">2.</span><span><span className="font-semibold">Job Start</span> — confirm conditions on-site and document before you begin</span></li>
            <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">3.</span><span><span className="font-semibold">Floor Prep</span> — get the surface right so the install holds up</span></li>
            <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">4.</span><span><span className="font-semibold">Installation</span> — lay the floor to Floor Daddy standard</span></li>
            <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">5.</span><span><span className="font-semibold">Final Walk Through</span> — prove the job is perfect and the customer is wowed</span></li>
          </ol>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">Why the system matters — and why it protects YOU</h4>
          <p className="text-sm text-foreground mb-3">This isn't red tape. It's built to make your job easier and cover your back.</p>
          <p className="text-sm text-foreground mb-3">Follow it in full and here's what it does for you:</p>
          <ul className="space-y-2 text-sm text-foreground">
            <li className="flex gap-2"><span className="text-good shrink-0">✓</span><span>Catches problems before they become callbacks, so you're not driving back out on your own time</span></li>
            <li className="flex gap-2"><span className="text-good shrink-0">✓</span><span>Documents the job at every step, so if something comes up later, the record protects you — not exposes you</span></li>
            <li className="flex gap-2"><span className="text-good shrink-0">✓</span><span>Cuts down on repairs, redos, and the surprise charges that eat into your pay</span></li>
            <li className="flex gap-2"><span className="text-good shrink-0">✓</span><span>Makes sure nothing gets missed, because a missed step on-site becomes a much bigger problem down the road</span></li>
          </ul>
          <p className="text-sm text-foreground mt-3">The installers who follow this system to the letter have fewer issues, fewer repairs, and fewer dollars pulled back out of their pocket. That's not an accident. It's the system working.</p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">How you're graded — every job, every time</h4>
          <p className="text-sm text-foreground mb-3">Every Floor Daddy install is scored on six standards. This is how we hold the line on quality and how you build your reputation with us:</p>
          <ul className="space-y-2 text-sm text-foreground">
            <li className="flex gap-2"><span className="font-semibold text-muted-foreground shrink-0">•</span><span><span className="font-semibold">Cleanliness</span> — you leave it better than you found it</span></li>
            <li className="flex gap-2"><span className="font-semibold text-muted-foreground shrink-0">•</span><span><span className="font-semibold">Thoroughness</span> — every step done, nothing skipped</span></li>
            <li className="flex gap-2"><span className="font-semibold text-muted-foreground shrink-0">•</span><span><span className="font-semibold">Attention to Detail</span> — the small stuff is the whole job</span></li>
            <li className="flex gap-2"><span className="font-semibold text-muted-foreground shrink-0">•</span><span><span className="font-semibold">Customer Service</span> — the customer feels taken care of, start to finish</span></li>
            <li className="flex gap-2"><span className="font-semibold text-muted-foreground shrink-0">•</span><span><span className="font-semibold">Communication</span> — no surprises, always in the loop</span></li>
            <li className="flex gap-2"><span className="font-semibold text-muted-foreground shrink-0">•</span><span><span className="font-semibold">Installation Quality</span> — it's done right, built to last</span></li>
          </ul>
          <p className="text-sm text-foreground mt-3">Score high across the board and you're the kind of installer we want on every job.</p>
        </div>

        <div className="rounded-lg bg-info/10 border border-info/20 p-4 space-y-2">
          <p className="text-sm font-semibold text-foreground">Our standard is simple: obsess over the process, get it perfect.</p>
          <p className="text-sm text-foreground">We don't cut corners and we don't guess. We follow the system, every section, every job. That's how we protect the customer, protect you, and protect the Floor Daddy name.</p>
        </div>

        <p className="text-base font-semibold text-foreground">Let's go Razzle Dazzle this one. 🔥</p>
      </div>

      {/* Product / Style / Color from RFMS */}
      {(() => {
        const PRODUCT_TYPES = {
          1: 'Carpet', 2: 'Vinyl', 3: 'Pad', 4: 'Wood', 5: 'Tile', 6: 'Laminate',
          7: 'LVT/LVP', 8: 'Carpet Tile', 9: 'VCT', 10: 'Natural Stone', 11: 'Rubber Tile',
          12: 'SD/ESD Tile', 13: 'Sundries', 14: 'Adhesives', 15: 'Metal', 16: 'Wall Base',
          17: 'Trims/Transitions', 18: 'Underlayment', 19: 'Install Materials', 20: 'Area Rugs', 21: 'Remnants'
        };
        const result = sale?.rfms_order_data?.order?.result || sale?.rfms_order_data?.result;
        const EXCLUDED_CODES = ['90', '96'];
        const lines = [...(result?.lines || [])]
          .filter(item => !EXCLUDED_CODES.includes(String(item.productCode ?? '').trim()))
          .sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0));
        if (!lines.length) return null;
        return (
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <Package className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Product / Style / Color</h3>
              <span className="ml-auto text-xs text-muted-foreground">From RFMS</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2 pr-3 font-medium">Style</th>
                    <th className="py-2 pr-3 font-medium">Color</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((item, idx) => (
                    <tr key={idx} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-3 font-medium text-foreground">{item.styleName || '—'}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{item.colorName || '—'}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{PRODUCT_TYPES[parseInt(item.productCode, 10)] || '—'}</td>
                      <td className="py-2.5 pr-3 text-right text-foreground">{item.quantity} {item.unit || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      <div className="flex justify-end">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm"
        >
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {downloading ? 'Generating...' : 'Download Pre-Install Checklist'}
        </button>
      </div>
    </div>
  );
}