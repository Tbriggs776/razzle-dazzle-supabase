import './App.css'
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import SignDocumentPage from './pages/SignDocument';
import LeadAppointmentViewPage from './pages/LeadAppointmentView';
import CustomerProjectViewPage from './pages/CustomerProjectView';
import InstallerApplyPage from './pages/InstallerApply';
import Login from '@/components/Login';
import IntegrationsPage from './pages/Integrations';
import ClaimsDashboardPage from './pages/ClaimsDashboard';
import CommunicationHubPage from './pages/CommunicationHub';
import DesignModViewPage from './pages/DesignModView';
import ManualDesignModsPage from './pages/ManualDesignMods';
import PreInstallChecklistViewPage from './pages/PreInstallChecklistView';
import FinancePage from './pages/Finance';
import CompanyDirectoryPage from './pages/CompanyDirectory';
import FleetPage from './pages/Fleet';
import FleetVehiclesPage from './pages/FleetVehicles';
import FleetDriversPage from './pages/FleetDrivers';
import FleetMaintenancePage from './pages/FleetMaintenance';
import OrderProcessingReportsPage from './pages/OrderProcessingReports';
import CashFlowProjectionPage from './pages/CashFlowProjection';
import MySalesPage from './pages/MySales';
import MyQuotesPage from './pages/MyQuotes';
import QuoteDetailPage from './pages/QuoteDetail';
import ManualSalesContractViewPage from './pages/ManualSalesContractView';
import CancelledProjectsPage from './pages/CancelledProjects';
import ChecklistV2DetailPage from './pages/ChecklistV2Detail';
import RFMSCustomersPage from './pages/RFMSCustomers';
import ContractDiscrepancyPage from './pages/ContractDiscrepancy';
import GrossProfitReportPage from './pages/GrossProfitReport';
import AppointmentRehashReportPage from './pages/AppointmentRehashReport';
import DashboardPage from './pages/Dashboard';
import JourneyPage from './pages/Journey';
import JourneyProjectDetailPage from './pages/JourneyProjectDetail';
import MarketingPerformancePage from './pages/MarketingPerformance';
import DCPerformanceMatrixPage from './pages/DCPerformanceMatrix';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

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
      <Routes>
        <Route path="/SignDocument" element={<SignDocumentPage />} />
        <Route path="/LeadAppointmentView" element={<LeadAppointmentViewPage />} />
        <Route path="/CustomerProjectView" element={<CustomerProjectViewPage />} />
        <Route path="/InstallerApply" element={<InstallerApplyPage />} />
      </Routes>
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
    <Routes>
      <Route path="/" element={<Navigate to="/Dashboard" replace />} />
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
      <Route path="/Journey" element={<JourneyPage />} />
      <Route path="/JourneyProjectDetail" element={<JourneyProjectDetailPage />} />
      <Route path="/MarketingPerformance" element={<LayoutWrapper currentPageName="MarketingPerformance"><MarketingPerformancePage /></LayoutWrapper>} />
      <Route path="/DCPerformanceMatrix" element={<LayoutWrapper currentPageName="DCPerformanceMatrix"><DCPerformanceMatrixPage /></LayoutWrapper>} />
      <Route path="/Integrations" element={<LayoutWrapper currentPageName="Integrations"><IntegrationsPage /></LayoutWrapper>} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
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