import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, MapPin, Calendar, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import { cn } from '@/lib/utils';

const STATUS_COLORS = {
  Pending: 'bg-muted text-muted-foreground',
  SubmittedForApproval: 'bg-warn/15 text-warn',
  Completed: 'bg-good/15 text-good',
  Rejected: 'bg-crit/15 text-crit',
  PrepApproved: 'bg-info/15 text-info',
  'N/A': 'bg-muted text-muted-foreground/70',
};

// Checkpoint step dot fills. Same five branches the inline hex styles used to express,
// moved onto the semantic status tokens so the dots survive dark mode.
const STEP_DOT_CLASSES = {
  Completed: 'bg-good/20 text-good',
  PrepApproved: 'bg-info/20 text-info',
  SubmittedForApproval: 'bg-warn/20 text-warn',
  Rejected: 'bg-crit/20 text-crit',
};
const STEP_DOT_DEFAULT = 'bg-muted text-muted-foreground';

const STEP_LABELS = ['PIC', 'JSC', 'FPC', 'FWC'];
const STEP_KEYS = ['pre_install_checklist', 'job_start_checklist', 'floor_prep_checklist', 'final_walkthrough_checklist'];

export default function JourneyProjectsList() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['journeyProjects'],
    queryFn: () => base44.entities.Project.filter({ status: { $nin: ['Cancelled', 'Completed'] } }, '-installation_date', 100),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['journeyCustomers'],
    queryFn: () => base44.entities.Customer.list('-updated_date', 200),
    staleTime: 5 * 60 * 1000,
  });

  const { data: allCheckpoints = [] } = useQuery({
    queryKey: ['allProjectCheckpoints'],
    queryFn: () => base44.entities.ProjectCheckpoint.list('-updated_date', 500),
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['journeyProjectSales'],
    queryFn: () => base44.entities.Sale.list('-updated_date', 200),
    staleTime: 5 * 60 * 1000,
  });

  const getCustomer = (id) => customers.find(c => c.id === id);
  const getSale = (id) => sales.find(s => s.id === id);
  const getCheckpoints = (projectId) => allCheckpoints.filter(c => c.project_id === projectId);

  const getStepDots = (projectId, project, sale) => {
    const cps = getCheckpoints(projectId);
    return STEP_KEYS.map(key => {
      const cp = cps.find(c => c.step_key === key);
      if (key === 'pre_install_checklist' && !cp) {
        const hasPreInstall = (project?.pre_install_checklist_signature_url && project?.pre_install_product_info) ||
          (sale?.pre_install_checklist_signature_url && sale?.pre_install_product_info);
        if (hasPreInstall) return 'Completed';
      }
      return cp?.status || 'Pending';
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title={t('jplTitle')} subtitle={t('jplSubtitle')} className="mb-4" />

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-muted-foreground/30" /> {t('jplLegendPending')}</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-warn" /> {t('jplLegendAwaiting')}</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-info" /> {t('jplLegendInProgress')}</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-good" /> {t('jplLegendCompleted')}</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-crit" /> {t('jplLegendRejected')}</div>
      </div>

      <div className="bg-card border border-border rounded-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 grid grid-cols-12 gap-3 px-4 py-2.5 bg-muted border-b border-border rounded-t-xl text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <div className="col-span-4">{t('jplColCustomer')}</div>
          <div className="col-span-2">{t('jplColCG')}</div>
          <div className="col-span-2">{t('jplColInstallDate')}</div>
          <div className="col-span-2">{t('jplColCheckpoints')}</div>
          <div className="col-span-2 text-right">{t('jplColStatus')}</div>
        </div>

        {/* Rows */}
        {[...projects].sort((a, b) => {
          const aPending = getStepDots(a.id, a, getSale(a.sale)).some(s => s === 'SubmittedForApproval' || s === 'Rejected');
          const bPending = getStepDots(b.id, b, getSale(b.sale)).some(s => s === 'SubmittedForApproval' || s === 'Rejected');
          return (bPending ? 1 : 0) - (aPending ? 1 : 0);
        }).map(project => {
          const customer = getCustomer(project.customer);
          const sale = getSale(project.sale);
          const address = customer?.address_line1 || sale?.location_address || '';
          const city = customer?.city;
          const fullAddress = address ? (city ? `${address}, ${city}` : address) : '';
          const stepStatuses = getStepDots(project.id, project, sale);
          const hasApprovalPending = stepStatuses.some(s => s === 'SubmittedForApproval' || s === 'Rejected');

          return (
            <button
              key={project.id}
              onClick={() => navigate(`/JourneyProjectDetail?project_id=${project.id}`)}
              className="w-full grid grid-cols-12 gap-3 px-4 py-3 border-b border-border/60 hover:bg-muted/60 transition-colors text-left items-center"
            >
              <div className="col-span-4">
                <p className="text-sm font-medium text-foreground">
                  {customer?.first_name} {customer?.last_name || t('jplUnknown')}
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3 shrink-0" />
                  {fullAddress || t('jplNoAddress')}
                </p>
              </div>
              <div className="col-span-2">
                {sale?.invoice_number ? (
                  <span className="text-sm text-muted-foreground font-mono">{sale.invoice_number}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              <div className="col-span-2">
                {project.installation_date ? (
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                    {new Date(project.installation_date).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('jplNotScheduled')}</span>
                  )}
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5">
                  {stepStatuses.map((status, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold',
                        STEP_DOT_CLASSES[status] || STEP_DOT_DEFAULT
                      )}
                      title={`${STEP_LABELS[i]}: ${status}`}
                    >
                      {STEP_LABELS[i].charAt(0)}
                    </span>
                    {i < 3 && <span className="text-muted-foreground/40 text-xs">→</span>}
                  </div>
                ))}
              </div>
              <div className="col-span-2 flex items-center justify-end gap-2">
                {hasApprovalPending && (
                  <StatusPill tone="warn">{t('jplActionRequired')}</StatusPill>
                )}
                <StatusPill tone="neutral">{project.status}</StatusPill>
                <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
              </div>
            </button>
          );
        })}

        {projects.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            <p>{t('jplNoProjects')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
