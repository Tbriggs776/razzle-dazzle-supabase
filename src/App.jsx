import { lazy, Suspense } from 'react';
import './App.css'
import RequirePage from '@/components/common/RequirePage';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
const SignDocumentPage = lazy(() => import('./pages/SignDocument'));
const LeadAppointmentViewPage = lazy(() => import('./pages/LeadAppointmentView'));
const CustomerProjectViewPage = lazy(() => import('./pages/CustomerProjectView'));
const InstallerApplyPage = lazy(() => import('./pages/InstallerApply'));
import Login from '@/components/Login';
const IntegrationsPage = lazy(() => import('./pages/Integrations'));
const ClaimsDashboardPage = lazy(() => import('./pages/ClaimsDashboard'));
const CommunicationHubPage = lazy(() => import('./pages/CommunicationHub'));
const DesignModViewPage = lazy(() => import('./pages/DesignModView'));
const ManualDesignModsPage = lazy(() => import('./pages/ManualDesignMods'));
const PreInstallChecklistViewPage = lazy(() => import('./pages/PreInstallChecklistView'));
const FinancePage = lazy(() => import('./pages/Finance'));
const CompanyDirectoryPage = lazy(() => import('./pages/CompanyDirectory'));
const FleetPage = lazy(() => import('./pages/Fleet'));
const FleetVehiclesPage = lazy(() => import('./pages/FleetVehicles'));
const FleetDriversPage = lazy(() => import('./pages/FleetDrivers'));
const FleetMaintenancePage = lazy(() => import('./pages/FleetMaintenance'));
const OrderProcessingReportsPage = lazy(() => import('./pages/OrderProcessingReports'));
const CashFlowProjectionPage = lazy(() => import('./pages/CashFlowProjection'));
const MySalesPage = lazy(() => import('./pages/MySales'));
const MyQuotesPage = lazy(() => import('./pages/MyQuotes'));
const QuoteDetailPage = lazy(() => import('./pages/QuoteDetail'));
const ManualSalesContractViewPage = lazy(() => import('./pages/ManualSalesContractView'));
const CancelledProjectsPage = lazy(() => import('./pages/CancelledProjects'));
const ChecklistV2DetailPage = lazy(() => import('./pages/ChecklistV2Detail'));
const RFMSCustomersPage = lazy(() => import('./pages/RFMSCustomers'));
const ContractDiscrepancyPage = lazy(() => import('./pages/ContractDiscrepancy'));
const GrossProfitReportPage = lazy(() => import('./pages/GrossProfitReport'));
const AppointmentRehashReportPage = lazy(() => import('./pages/AppointmentRehashReport'));
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const JourneyPage = lazy(() => import('./pages/Journey'));
const JourneyProjectDetailPage = lazy(() => import('./pages/JourneyProjectDetail'));
const MarketingPerformancePage = lazy(() => import('./pages/MarketingPerformance'));
const DCPerformanceMatrixPage = lazy(() => import('./pages/DCPerformanceMatrix'));
const PortalPage = lazy(() => import('./pages/Portal'));
const LeadQueuePage = lazy(() => import('./pages/LeadQueue'));
const PlaybooksPage = lazy(() => import('./pages/Playbooks'));
const PlaybookDetailPage = lazy(() => import('./pages/PlaybookDetail'));
const MyTrainingPage = lazy(() => import('./pages/MyTraining'));
const TrainingAdminPage = lazy(() => import('./pages/TrainingAdmin'));
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { usePortalContext } from '@/lib/usePortal';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

/**
 * Where "/" goes, which is not the same answer for everyone.
 *
 * A subcontractor login holds zero staff modules — indistinguishable, from the
 * client's side, from an employee nobody has granted anything to yet. Sending
 * both to /Dashboard gave crews an empty page behind an empty sidebar. Only the
 * database can tell them apart, so ask it (my_portal_context) before choosing.
 *
 * Staff who are ALSO on a crew roster keep going to the app: if they hold any
 * staff page at all, that is the surface they signed in for.
 */
const HomeRedirect = () => {
  const { access } = useAuth();
  const { data: portal, isLoading } = usePortalContext();
  const hasStaffPages = (access?.modules || []).some((m) => (m.pages || []).length > 0);

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }
  return <Navigate to={portal?.is_installer && !hasStaffPages ? '/Portal' : '/Dashboard'} replace />;
};

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

/**
 * Shown while a page's chunk is in flight. Pages are lazy now (see
 * pages.config.js), so there is a real, if usually brief, gap on first
 * navigation to each one.
 */
const PageLoading = () => (
  <div className="flex items-center justify-center py-24">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

/**
 * Suspense sits INSIDE the layout on purpose. Wrapping the whole <Routes> would
 * blank the sidebar and header on every navigation -- the app would appear to
 * reload itself each time. Here the chrome stays put and only the content area
 * spins, which is what a page transition should look like.
 */
const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}><Suspense fallback={<PageLoading />}>{children}</Suspense></Layout>
  : <Suspense fallback={<PageLoading />}>{children}</Suspense>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated, authError } = useAuth();
  const location = useLocation();

  // Truly-public routes: customers are NOT logged in, so these render BEFORE the auth
  // gate. Access is authorized by the token/id in the URL, and each reads only a curated,
  // anon-safe projection — SignDocument via its e-sign token; the appointment/project
  // trackers via the get_public_appointment / get_public_project RPCs (RLS denies direct
  // anon table reads). Rendered without the admin Layout so customers see a clean page.
  const PUBLIC_PREFIXES = ['/SignDocument', '/LeadAppointmentView', '/CustomerProjectView', '/InstallerApply'];
  if (PUBLIC_PREFIXES.some((p) => location.pathname.startsWith(p))) {
    return (
      <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/SignDocument" element={<SignDocumentPage />} />
        <Route path="/LeadAppointmentView" element={<LeadAppointmentViewPage />} />
        <Route path="/CustomerProjectView" element={<CustomerProjectViewPage />} />
        <Route path="/InstallerApply" element={<InstallerApplyPage />} />
      </Routes>
      </Suspense>
    );
  }

  // Show loading spinner while checking the session
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // No session -> show the login screen
  if (!isAuthenticated) {
    return <Login />;
  }

  // Signed in but not provisioned in the access model
  if (authError && authError.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  // Render the main app
  return (
    <Suspense fallback={<PageLoading />}>
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      {/* The subcontractor portal renders without the staff chrome — see Portal.jsx. */}
      <Route path="/Portal" element={<PortalPage />} />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="/ClaimsDashboard" element={<LayoutWrapper currentPageName="ClaimsDashboard"><ClaimsDashboardPage /></LayoutWrapper>} />
      <Route path="/CommunicationHub" element={<LayoutWrapper currentPageName="CommunicationHub"><CommunicationHubPage /></LayoutWrapper>} />
      <Route path="/DesignModView" element={<DesignModViewPage />} />
      <Route path="/MySales" element={<LayoutWrapper currentPageName="MySales"><MySalesPage /></LayoutWrapper>} />
      <Route path="/RFMSCustomers" element={<LayoutWrapper currentPageName="RFMSCustomers"><RFMSCustomersPage /></LayoutWrapper>} />
      <Route path="/ManualDesignMods" element={<LayoutWrapper currentPageName="ManualDesignMods"><ManualDesignModsPage /></LayoutWrapper>} />
      <Route path="/PreInstallChecklistView" element={<PreInstallChecklistViewPage />} />
      <Route path="/Finance" element={<LayoutWrapper currentPageName="Finance"><FinancePage /></LayoutWrapper>} />
      <Route path="/CompanyDirectory" element={<LayoutWrapper currentPageName="CompanyDirectory"><CompanyDirectoryPage /></LayoutWrapper>} />
      <Route path="/Fleet" element={<LayoutWrapper currentPageName="Fleet"><FleetPage /></LayoutWrapper>} />
      <Route path="/FleetVehicles" element={<LayoutWrapper currentPageName="FleetVehicles"><FleetVehiclesPage /></LayoutWrapper>} />
      <Route path="/FleetDrivers" element={<LayoutWrapper currentPageName="FleetDrivers"><FleetDriversPage /></LayoutWrapper>} />
      <Route path="/FleetMaintenance" element={<LayoutWrapper currentPageName="FleetMaintenance"><FleetMaintenancePage /></LayoutWrapper>} />
      <Route path="/OrderProcessingReports" element={<LayoutWrapper currentPageName="OrderProcessingReports"><OrderProcessingReportsPage /></LayoutWrapper>} />
      <Route path="/CashFlowProjection" element={<LayoutWrapper currentPageName="CashFlowProjection"><CashFlowProjectionPage /></LayoutWrapper>} />
      <Route path="/ContractDiscrepancy" element={<LayoutWrapper currentPageName="ContractDiscrepancy"><ContractDiscrepancyPage /></LayoutWrapper>} />
      <Route path="/GrossProfitReport" element={<LayoutWrapper currentPageName="GrossProfitReport"><GrossProfitReportPage /></LayoutWrapper>} />
      <Route path="/AppointmentRehashReport" element={<LayoutWrapper currentPageName="AppointmentRehashReport"><AppointmentRehashReportPage /></LayoutWrapper>} />
      <Route path="/MyQuotes" element={<LayoutWrapper currentPageName="MyQuotes"><MyQuotesPage /></LayoutWrapper>} />
      <Route path="/QuoteDetail" element={<LayoutWrapper currentPageName="QuoteDetail"><QuoteDetailPage /></LayoutWrapper>} />
      <Route path="/ManualSalesContractView" element={<ManualSalesContractViewPage />} />
      <Route path="/CancelledProjects" element={<LayoutWrapper currentPageName="CancelledProjects"><CancelledProjectsPage /></LayoutWrapper>} />
      <Route path="/ChecklistV2Detail" element={<LayoutWrapper currentPageName="ChecklistV2Detail"><ChecklistV2DetailPage /></LayoutWrapper>} />
      <Route path="/Dashboard" element={<LayoutWrapper currentPageName="Dashboard"><DashboardPage /></LayoutWrapper>} />
      {/* Journey replaces the app chrome, so it renders outside LayoutWrapper —
          which is where the module guard used to live. Without RequirePage a user
          holding only the appointments module could type the URL and get the whole
          Journey surface: map, calendar and Manager View. */}
      <Route path="/Journey" element={<RequirePage pageKey="Journey"><JourneyPage /></RequirePage>} />
      {/* allowInstaller: this is the page the portal's job list links into, and
          the crew's assignment SMS deep-links straight to it. RLS still limits
          them to their own jobs. */}
      <Route path="/JourneyProjectDetail" element={<RequirePage pageKey="JourneyProjectDetail" allowInstaller><JourneyProjectDetailPage /></RequirePage>} />
      <Route path="/MarketingPerformance" element={<LayoutWrapper currentPageName="MarketingPerformance"><MarketingPerformancePage /></LayoutWrapper>} />
      <Route path="/DCPerformanceMatrix" element={<LayoutWrapper currentPageName="DCPerformanceMatrix"><DCPerformanceMatrixPage /></LayoutWrapper>} />
      <Route path="/Integrations" element={<LayoutWrapper currentPageName="Integrations"><IntegrationsPage /></LayoutWrapper>} />
      <Route path="/LeadQueue" element={<LayoutWrapper currentPageName="LeadQueue"><LeadQueuePage /></LayoutWrapper>} />
      <Route path="/Playbooks" element={<LayoutWrapper currentPageName="Playbooks"><PlaybooksPage /></LayoutWrapper>} />
      <Route path="/PlaybookDetail" element={<LayoutWrapper currentPageName="PlaybookDetail"><PlaybookDetailPage /></LayoutWrapper>} />
      <Route path="/MyTraining" element={<LayoutWrapper currentPageName="MyTraining"><MyTrainingPage /></LayoutWrapper>} />
      <Route path="/TrainingAdmin" element={<LayoutWrapper currentPageName="TrainingAdmin"><TrainingAdminPage /></LayoutWrapper>} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </Suspense>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <SonnerToaster richColors closeButton position="top-right" />
        <VisualEditAgent />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App