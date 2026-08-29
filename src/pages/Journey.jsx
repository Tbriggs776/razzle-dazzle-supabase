import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Loader2, X, Menu, Map, LayoutGrid, Layers, LogOut, User, ChevronDown, ChevronRight, Navigation, Bell, HardHat, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import StatusPill from '@/components/common/StatusPill';
import RegionMapEditor from '@/components/journey/RegionMapEditor';
import RegionSidebar from '@/components/journey/RegionSidebar';
import JourneyCalendar from '@/components/journey/JourneyCalendar';
import FieldInspector from '@/components/journey/FieldInspector';
import JourneySettings from '@/components/journey/JourneySettings';
import JourneyProjectsList from '@/components/journey/JourneyProjectsList';
import ManagerView from '@/components/journey/ManagerView';
import MyQueue from '@/components/journey/MyQueue';
import InstallerView from '@/components/journey/InstallerView';
import { Settings as SettingsIcon, ClipboardList, Users, Globe } from 'lucide-react';
import { LanguageProvider, useLanguage } from '@/lib/i18n/LanguageContext';

const VIEWS = [
  { id: 'map', labelKey: 'map', icon: Map },
  { id: 'board', labelKey: 'calendar', icon: LayoutGrid },
  { id: 'regions', labelKey: 'regions', icon: Layers },
  { id: 'field', labelKey: 'fieldInspector', icon: Navigation },
];

const MANAGE_VIEWS = [
  { id: 'projects', labelKey: 'projects', icon: ClipboardList },
  { id: 'manager', labelKey: 'managerView', icon: Users },
];

function JourneyInner() {
  const { t, language, changeLanguage } = useLanguage();
  const queryClient = useQueryClient();
  const initialView = new URLSearchParams(window.location.search).get('view') || 'map';
  // Normalize 'installer' view param — falls through to 'map' if not recognized
  const validViews = ['map', 'board', 'regions', 'field', 'projects', 'manager', 'queue', 'settings', 'installer'];
  const [activeView, setActiveView] = useState(validViews.includes(initialView) ? initialView : 'map');
  const [navigateExpanded, setNavigateExpanded] = useState(true);
  const [manageExpanded, setManageExpanded] = useState(false);
  const [drawingRegion, setDrawingRegion] = useState(null);
  const [regionsOverlayOpen, setRegionsOverlayOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: appSettings } = useQuery({
    queryKey: ['appSettings'],
    queryFn: async () => {
      const settings = await base44.entities.AppSettings.list();
      return settings[0] || {};
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: 'always'
  });
  const navigateNavEnabled = appSettings?.journey_nav_item_enabled !== false;

  const { data: regions = [], refetch: refetchRegions } = useQuery({
    queryKey: ['journeyRegions'],
    queryFn: () => base44.entities.RegionAssignment.list(),
    enabled: !!user,
  });

  const { data: journeyOrders = [] } = useQuery({
    queryKey: ['journeyOrders'],
    queryFn: () => base44.entities.JourneyOrder.list('-created_date', 500),
    enabled: !!user,
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembersJourney'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }),
    enabled: !!user,
  });

  const { data: crewsData } = useQuery({
    queryKey: ['rfmsCrewsJourney'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getRFMSCrews', {});
      // An empty crew list and "RFMS did not answer" look identical in a
      // dropdown, and one of them means the assignment you are about to make is
      // wrong. Throw so the caller can tell them apart.
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data?.crews?.detail || [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const crews = crewsData || [];

  if (userLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // --- Region CRUD ---
  const handleAddRegion = async (form) => {
    const created = await base44.entities.RegionAssignment.create({
      ...form,
      polygon_coordinates: [],
      zip_codes: [],
      is_active: true,
    });
    refetchRegions();
    return created;
  };

  const handleStartDrawing = async (formOrRegion) => {
    if (!formOrRegion.id) {
      const created = await base44.entities.RegionAssignment.create({
        ...formOrRegion,
        polygon_coordinates: [],
        zip_codes: [],
        is_active: true,
      });
      await refetchRegions();
      setDrawingRegion({ ...formOrRegion, id: created.id });
    } else {
      setDrawingRegion(formOrRegion);
    }
    setActiveView('map');
  };

  const handlePolygonDrawn = async (coords) => {
    if (!drawingRegion?.id) return;
    const regionId = drawingRegion.id;
    setDrawingRegion(null);

    await base44.entities.RegionAssignment.update(regionId, {
      polygon_coordinates: coords,
      zip_codes: [],
    });
    refetchRegions();

    try {
      const zipRes = await base44.functions.invoke('getZipsInPolygon', { polygon_coordinates: coords });
      const zip_codes = zipRes.data?.zip_codes || [];
      if (zip_codes.length > 0) {
        await base44.entities.RegionAssignment.update(regionId, { zip_codes });
        refetchRegions();
      }
    } catch (e) {
      console.error('ZIP lookup failed', e);
    }
  };

  const handleEditRegion = async (id, form) => {
    await base44.entities.RegionAssignment.update(id, form);
    refetchRegions();
  };

  const handleDeleteRegion = async (id) => {
    await base44.entities.RegionAssignment.delete(id);
    refetchRegions();
  };

  const regionSidebarProps = {
    regions, teamMembers, crews,
    onAddRegion: handleAddRegion,
    onEditRegion: handleEditRegion,
    onDeleteRegion: handleDeleteRegion,
    onStartDrawing: handleStartDrawing,
    drawingRegion,
    journeyOrders,
  };

  return (
    <div className="flex h-full min-h-0 bg-background">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="md:hidden fixed inset-0 bg-black/40 z-[1080]"
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={cn(
          "w-56 bg-card border-r border-border flex-col shrink-0",
          sidebarOpen
            ? "flex fixed inset-y-0 left-0 z-[1090] shadow-xl md:static md:shadow-none"
            : "hidden md:flex"
        )}
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-5 border-b border-border shrink-0">
          <div>
            <h1 className="font-display text-base font-extrabold tracking-tight text-primary leading-none">
              Journey
            </h1>
            <p className="text-[9px] font-sans tracking-wider text-muted-foreground uppercase mt-0.5">
              BY FLOOR DADDY
            </p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden ml-auto w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Journey replaces the app's own chrome with this sidebar, so without
            this there is no route back — you are stranded in the module. */}
        <Link
          to={createPageUrl('Dashboard')}
          className="flex items-center gap-2 border-b border-border px-5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground shrink-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Razzle Dazzle
        </Link>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {/* My Queue */}
          <button
            onClick={() => setActiveView('queue')}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
              activeView === 'queue'
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary"
            )}
          >
            <Bell className="w-4 h-4" />
            <span className="flex-1 text-left">{t('fieldManagerView')}</span>
          </button>

          {/* Installer View */}
          <button
            onClick={() => setActiveView('installer')}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
              activeView === 'installer'
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary"
            )}
          >
            <HardHat className="w-4 h-4" />
            <span className="flex-1 text-left">{t('installerView')}</span>
          </button>

          {/* Navigate parent */}
          {navigateNavEnabled && (
          <>
          <button
            onClick={() => setNavigateExpanded(e => !e)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary transition-all"
          >
            <Navigation className="w-4 h-4" />
            <span className="flex-1 text-left">{t('navigate')}</span>
            {navigateExpanded
              ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
              : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </button>

          {navigateExpanded && (
            <div className="ml-6 space-y-0.5">
              {VIEWS.map(v => {
                const Icon = v.icon;
                return (
                  <button
                    key={v.id}
                    onClick={() => setActiveView(v.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                      activeView === v.id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t(v.labelKey)}
                  </button>
                );
              })}
            </div>
          )}
          </>
          )}

          {/* Manage parent */}
          <button
            onClick={() => setManageExpanded(e => !e)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary transition-all mt-1"
          >
            <SettingsIcon className="w-4 h-4" />
            <span className="flex-1 text-left">{t('manage')}</span>
            {manageExpanded
              ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
              : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </button>

          {manageExpanded && (
            <div className="ml-6 space-y-0.5">
              {MANAGE_VIEWS.map(v => {
                const Icon = v.icon;
                return (
                  <button
                    key={v.id}
                    onClick={() => setActiveView(v.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                      activeView === v.id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t(v.labelKey)}
                  </button>
                );
              })}
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-border shrink-0 space-y-2">
          <button
            onClick={() => setActiveView('settings')}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all",
              activeView === 'settings'
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            {t('settings')}
          </button>
          <div className="flex items-center gap-2 px-2 py-1.5 bg-secondary rounded-lg">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <User className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{user?.full_name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={() => base44.auth.logout()}
            className="w-full flex items-center justify-center gap-2 text-xs text-destructive hover:bg-destructive/10 py-1.5 rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            {t('logout')}
          </button>
          {/* Language toggle */}
          <div className="flex items-center gap-1.5 px-1 py-1">
            <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <button
              onClick={() => changeLanguage('en')}
              className={cn(
                "flex-1 px-2 py-1 rounded text-[11px] font-medium transition-all",
                language === 'en'
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary"
              )}
            >
              EN
            </button>
            <button
              onClick={() => changeLanguage('es')}
              className={cn(
                "flex-1 px-2 py-1 rounded text-[11px] font-medium transition-all",
                language === 'es'
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary"
              )}
            >
              ES
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">v1.7.7</p>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden h-12 flex items-center gap-3 px-3 border-b border-border bg-card shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground hover:bg-secondary transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-display text-sm font-extrabold tracking-tight text-primary">Journey</span>
        </div>
        {/* Drawing banner */}
        {drawingRegion && (
          <div className="h-10 bg-primary/10 border-b border-primary/20 flex items-center px-4 gap-2 shrink-0">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: drawingRegion.color || 'hsl(var(--primary))' }} />
            <span className="text-xs font-medium text-primary">{t('drawing')}: {drawingRegion.region_name}</span>
            <button onClick={() => setDrawingRegion(null)} className="text-primary/70 hover:text-primary ml-1">
              <X className="w-3.5 h-3.5" />
            </button>
            <span className="ml-auto text-xs text-primary">{t('regionsOrders', { regions: regions.length, orders: journeyOrders.length })}</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden relative">

          {/* Map View */}
          {activeView === 'map' && (
            <div className="absolute inset-0 p-4">
              <RegionMapEditor
                regions={regions}
                journeyOrders={journeyOrders}
                onPolygonDrawn={handlePolygonDrawn}
                drawingRegion={drawingRegion}
              />

              {/* Regions overlay — top right of map */}
              <div className="absolute top-6 right-6 w-[min(18rem,90vw)] z-[1000] flex flex-col" style={{ maxHeight: 'calc(100% - 3rem)' }}>
                <button
                  onClick={() => setRegionsOverlayOpen(o => !o)}
                  className="self-end flex items-center gap-1.5 bg-card border border-border shadow-md rounded-lg px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors mb-1"
                >
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  {t('regionsButton')}
                  {!regionsOverlayOpen && (
                    <StatusPill tone="info" className="ml-0.5">{regions.length}</StatusPill>
                  )}
                </button>

                {regionsOverlayOpen && (
                  <div className="bg-card border border-border shadow-xl rounded-xl p-3 overflow-y-auto" style={{ maxHeight: 'calc(100% - 2.5rem)' }}>
                    <RegionSidebar {...regionSidebarProps} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Regions View */}
          {activeView === 'regions' && (
            <div className="absolute inset-0 p-6 overflow-y-auto">
              <div className="max-w-sm">
                <RegionSidebar {...regionSidebarProps} />
              </div>
            </div>
          )}

          {/* Calendar View */}
          {activeView === 'board' && (
            <div className="absolute inset-0 overflow-hidden">
              <JourneyCalendar
                journeyOrders={journeyOrders}
                regions={regions}
              />
            </div>
          )}

          {/* Field Inspector View */}
          {activeView === 'field' && (
            <div className="absolute inset-0 overflow-hidden">
              <FieldInspector
                journeyOrders={journeyOrders}
                regions={regions}
                teamMembers={teamMembers}
                currentUser={user}
                onOrdersUpdated={() => queryClient.invalidateQueries({ queryKey: ['journeyOrders'] })}
              />
            </div>
          )}

          {/* Settings View */}
          {activeView === 'settings' && (
            <div className="absolute inset-0 overflow-y-auto">
              <JourneySettings />
            </div>
          )}

          {/* Projects View */}
          {activeView === 'projects' && (
            <div className="absolute inset-0 overflow-y-auto p-6">
              <JourneyProjectsList />
            </div>
          )}

          {/* Manager View */}
          {activeView === 'manager' && (
            <div className="absolute inset-0 overflow-y-auto p-6">
              <ManagerView />
            </div>
          )}

          {/* My Queue View */}
          {activeView === 'queue' && (
            <div className="absolute inset-0 overflow-y-auto p-6">
              <MyQueue />
            </div>
          )}

          {/* Installer View */}
          {activeView === 'installer' && (
            <div className="absolute inset-0 overflow-y-auto p-6">
              <InstallerView />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default function Journey() {
  return (
    <LanguageProvider>
      <JourneyInner />
    </LanguageProvider>
  );
}
