import React from 'react';
import { Bell, HardHat, FlaskConical, Compass } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import AlertGroupManager from '@/components/journey/AlertGroupManager';
import InstallerManager from '@/components/journey/InstallerManager';
import TestDivertSettings from '@/components/journey/TestDivertSettings';
import JourneyNavToggle from '@/components/journey/JourneyNavToggle';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function JourneySettings() {
  const { t } = useLanguage();
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Header */}
        <PageHeader title={t('jsTitle')} subtitle={t('jsSubtitle')} />

        {/* Alert Groups section.
            Section shells stay a quiet muted fill so the bg-card panels the managers render
            inside them still read as the raised surface — same figure/ground as before. */}
        <div className="rounded-2xl border border-border bg-muted/40 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t('jsAlertGroups')}</h2>
          </div>
          <AlertGroupManager />
        </div>

        {/* Installer Contact Info section */}
        <div className="rounded-2xl border border-border bg-muted/40 p-5">
          <div className="flex items-center gap-2 mb-4">
            <HardHat className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t('jsInstallerContacts')}</h2>
          </div>
          <InstallerManager />
        </div>

        {/* Test Divert section — amber here means "caution, non-production routing", a status
            meaning, so it takes the semantic warn token rather than a decorative colour. */}
        <div className="rounded-2xl border border-border bg-muted/40 p-5">
          <div className="flex items-center gap-2 mb-4">
            <FlaskConical className="w-4 h-4 text-warn" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t('jsTestDivert')}</h2>
          </div>
          <TestDivertSettings />
        </div>

        {/* Journey Nav Item toggle */}
        <div className="rounded-2xl border border-border bg-muted/40 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Compass className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t('jsNavigation')}</h2>
          </div>
          <JourneyNavToggle />
        </div>
      </div>
    </div>
  );
}
