import React from 'react';
import { Settings as SettingsIcon, Bell, HardHat, FlaskConical, Compass } from 'lucide-react';
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
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <SettingsIcon className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">{t('jsTitle')}</h1>
            <p className="text-sm text-slate-500">{t('jsSubtitle')}</p>
          </div>
        </div>

        {/* Alert Groups section */}
        <div className="bg-slate-50 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{t('jsAlertGroups')}</h2>
          </div>
          <AlertGroupManager />
        </div>

        {/* Installer Contact Info section */}
        <div className="bg-slate-50 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <HardHat className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{t('jsInstallerContacts')}</h2>
          </div>
          <InstallerManager />
        </div>

        {/* Test Divert section */}
        <div className="bg-slate-50 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <FlaskConical className="w-4 h-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{t('jsTestDivert')}</h2>
          </div>
          <TestDivertSettings />
        </div>

        {/* Journey Nav Item toggle */}
        <div className="bg-slate-50 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Compass className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{t('jsNavigation')}</h2>
          </div>
          <JourneyNavToggle />
        </div>
      </div>
    </div>
  );
}