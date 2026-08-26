/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AppointmentDetail from './pages/AppointmentDetail';
import AppointmentReports from './pages/AppointmentReports';
import AppointmentSettingChecklists from './pages/AppointmentSettingChecklists';
import Appointments from './pages/Appointments';
import Calculators from './pages/Calculators';
import CancelledAppointments from './pages/CancelledAppointments';
import ChecklistDetail from './pages/ChecklistDetail';
import ClaimsDashboard from './pages/ClaimsDashboard';
import ConsultantAppointmentView from './pages/ConsultantAppointmentView';
import CustomerDetail from './pages/CustomerDetail';
import CustomerProjectView from './pages/CustomerProjectView';
import CustomerServiceReps from './pages/CustomerServiceReps';
import Customers from './pages/Customers';
import DesignConsultantTicketView from './pages/DesignConsultantTicketView';
import DesignConsultants from './pages/DesignConsultants';
import InvoiceCalculator from './pages/InvoiceCalculator';
import LeadAppointmentView from './pages/LeadAppointmentView';
import LeadDetail from './pages/LeadDetail';
import Leads from './pages/Leads';
import InstallerApplications from './pages/InstallerApplications';
import Logs from './pages/Logs';
import MyAppointments from './pages/MyAppointments';
import MyAppointmentResults from './pages/MyAppointmentResults';
import MyTasks from './pages/MyTasks';
import MyTickets from './pages/MyTickets';
import OrderProcessing from './pages/OrderProcessing';
import ProjectDetail from './pages/ProjectDetail';
import Projects from './pages/Projects';
import RecordingDetail from './pages/RecordingDetail';
import Recordings from './pages/Recordings';
import Reports from './pages/Reports';
import RequesterTicketView from './pages/RequesterTicketView';
import RescheduledAppointments from './pages/RescheduledAppointments';
import SaleDetail from './pages/SaleDetail';
import Sales from './pages/Sales';
import SalesReports from './pages/SalesReports';
import ScheduleAssistant from './pages/ScheduleAssistant';
import ScheduledThisWeek from './pages/ScheduledThisWeek';
import Settings from './pages/Settings';
import SubmitTicket from './pages/SubmitTicket';
import TeamMemberDetail from './pages/TeamMemberDetail';
import TeamMembers from './pages/TeamMembers';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AppointmentDetail": AppointmentDetail,
    "AppointmentReports": AppointmentReports,
    "AppointmentSettingChecklists": AppointmentSettingChecklists,
    "Appointments": Appointments,
    "Calculators": Calculators,
    "CancelledAppointments": CancelledAppointments,
    "ChecklistDetail": ChecklistDetail,
    "ClaimsDashboard": ClaimsDashboard,
    "ConsultantAppointmentView": ConsultantAppointmentView,
    "CustomerDetail": CustomerDetail,
    "CustomerProjectView": CustomerProjectView,
    "CustomerServiceReps": CustomerServiceReps,
    "Customers": Customers,
    "DesignConsultantTicketView": DesignConsultantTicketView,
    "DesignConsultants": DesignConsultants,
    "InvoiceCalculator": InvoiceCalculator,
    "LeadAppointmentView": LeadAppointmentView,
    "LeadDetail": LeadDetail,
    "InstallerApplications": InstallerApplications,
    "Leads": Leads,
    "Logs": Logs,
    "MyAppointments": MyAppointments,
    "MyAppointmentResults": MyAppointmentResults,
    "MyTasks": MyTasks,
    "MyTickets": MyTickets,
    "OrderProcessing": OrderProcessing,
    "ProjectDetail": ProjectDetail,
    "Projects": Projects,
    "RecordingDetail": RecordingDetail,
    "Recordings": Recordings,
    "Reports": Reports,
    "RequesterTicketView": RequesterTicketView,
    "RescheduledAppointments": RescheduledAppointments,
    "SaleDetail": SaleDetail,
    "Sales": Sales,
    "SalesReports": SalesReports,
    "ScheduleAssistant": ScheduleAssistant,
    "ScheduledThisWeek": ScheduledThisWeek,
    "Settings": Settings,
    "SubmitTicket": SubmitTicket,
    "TeamMemberDetail": TeamMemberDetail,
    "TeamMembers": TeamMembers,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};