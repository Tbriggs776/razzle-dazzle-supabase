import React, { useState, createContext, useContext } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Users, UserCog, CalendarDays, ClipboardCheck, Menu, X, Settings as SettingsIcon, DollarSign, LogOut, User, ShieldCheck, Activity, ChevronDown, ChevronRight, MessageSquare, FileText, Truck, Plug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AudioRecorder from '@/components/AudioRecorder';

const RecordingContext = createContext();

export const useRecording = () => {
  const context = useContext(RecordingContext);
  if (!context) {
    throw new Error('useRecording must be used within RecordingProvider');
  }
  return context;
};

export default function Layout({ children, currentPageName }) {
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewingAsRole, setViewingAsRole] = useState(null);
  const [expandedMenuItems, setExpandedMenuItems] = useState({});
  const [widgetPosition, setWidgetPosition] = useState({ x: null, y: null });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [recordingAppointmentId, setRecordingAppointmentId] = useState(null);

  // Modular access model: the set of pages the signed-in user may open, derived
  // from their role -> module -> permission grants (server-enforced by RLS).
  const { access } = useAuth();
  const allowedPageKeys = React.useMemo(() => {
    const s = new Set();
    (access?.modules || []).forEach((m) => (m.pages || []).forEach((p) => s.add(p.key)));
    return s;
  }, [access]);

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    retry: false,
    onSuccess: (user) => {
      if (!viewingAsRole && user?.role) {
        setViewingAsRole(user.role);
      }
    }
  });

  const { data: teamMember, isLoading: teamMemberLoading } = useQuery({
    queryKey: ['currentTeamMember', currentUser?.email],
    queryFn: async () => {
      console.debug('[Layout] Fetching team member for email:', currentUser.email);
      const result = await base44.entities.TeamMember.filter({ email: currentUser.email });
      console.debug('[Layout] Team member query result:', result, 'length:', result?.length, 'first item:', result?.[0]);
      return result?.[0] || null;
    },
    enabled: !!currentUser?.email,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    cacheTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false
  });

  const { data: rolePermissions = [], isLoading: permissionsLoading } = useQuery({
    queryKey: ['rolePermissions'],
    queryFn: () => base44.entities.RolePermissions.list(),
    enabled: !!currentUser
  });

  const { data: appSettings } = useQuery({
    queryKey: ['appSettings'],
    queryFn: async () => {
      const settings = await base44.entities.AppSettings.list();
      return settings[0] || { show_role_assignment_splash: true };
    },
    enabled: !!currentUser,
    staleTime: 0,
    refetchOnMount: 'always'
  });

  const { data: pendingTasksCount = 0 } = useQuery({
    queryKey: ['pendingTasksCount', teamMember?.id],
    queryFn: async () => {
      if (!teamMember?.id) return 0;
      const tasks = await base44.entities.Task.filter({ 
        assigned_to: teamMember.id,
        status: 'pending'
      });
      return tasks.length;
    },
    enabled: !!teamMember?.id
  });

  // Initialize viewingAsRole when user/team member data loads
  React.useEffect(() => {
    if (!viewingAsRole) {
      if (currentUser?.role === 'admin') {
        setViewingAsRole('admin');
      } else if (teamMember?.role) {
        setViewingAsRole(teamMember.role);
      }
    }
  }, [currentUser, teamMember, viewingAsRole]);

  // Handle dragging
  React.useEffect(() => {
    const handleMouseMove = (e) => {
      if (isDragging) {
        setWidgetPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Public (external-facing) pages render without the app shell or access guard.
  const publicPages = [
    'LeadAppointmentView', 'ConsultantAppointmentView', 'RequesterTicketView',
    'DesignConsultantTicketView', 'CustomerProjectView', 'ManualSalesContractView',
    'DesignModView', 'PreInstallChecklistView', 'SubmitTicket',
  ];
  if (publicPages.includes(currentPageName)) {
    return <>{children}</>;
  }

  // Module-based route guard. RLS is the real enforcement; this shows a clean
  // "no access" screen instead of an empty page for routes outside the user's modules.
  if (access && currentPageName && !allowedPageKeys.has(currentPageName)) {
    const home = access?.modules?.[0]?.pages?.[0]?.key || 'Dashboard';
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <ShieldCheck className="w-8 h-8 text-slate-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">No access to this page</h1>
          <p className="text-slate-500 mb-6">Your role doesn't include this area. Contact an administrator if you think this is a mistake.</p>
          <Link to={createPageUrl(home)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-colors">
            Go to my workspace
          </Link>
        </div>
      </div>
    );
  }

  // Show login splash if user is not logged in and trying to access protected pages
  if (!userLoading && !currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <User className="w-10 h-10 text-indigo-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-3">
              Login Required
            </h1>
            <p className="text-slate-600 mb-6">
              You need to be logged in to access this page.
            </p>
            <button
              onClick={() => base44.auth.redirectToLogin(window.location.pathname)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-colors"
            >
              <User className="w-4 h-4" />
              Login to Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show splash page if user doesn't have team member role (or admin viewing as no role) AND setting is enabled
  const shouldShowSplash = appSettings?.show_role_assignment_splash && currentUser && (viewingAsRole === 'no_role' || (!teamMember?.role && currentUser.role !== 'admin'));
  if (shouldShowSplash) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <UserCog className="w-10 h-10 text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-3">
              Waiting on Role Assignment
            </h1>
            <p className="text-slate-600 mb-6">
              Your account is being set up by an administrator. You'll be able to access the system once your role has been assigned.
            </p>
            <div className="bg-slate-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-slate-500 mb-1">Logged in as:</p>
              <p className="text-sm font-medium text-slate-800">{currentUser.full_name}</p>
              <p className="text-sm text-slate-500">{currentUser.email}</p>
            </div>
            <p className="text-sm text-slate-500 mb-6">
              If you have any questions, please reach out to your administrator.
            </p>
            <button
              onClick={() => base44.auth.logout()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>

        {/* Role Toggle - Bottom Right (Admin Only) */}
        {currentUser?.role === 'admin' && (
          <div 
            className="fixed z-40 cursor-move"
            style={{
              left: widgetPosition.x !== null ? `${widgetPosition.x}px` : 'auto',
              right: widgetPosition.x !== null ? 'auto' : '1.5rem',
              top: widgetPosition.y !== null ? `${widgetPosition.y}px` : 'auto',
              bottom: widgetPosition.y !== null ? 'auto' : '1.5rem'
            }}
            onMouseDown={(e) => {
              setIsDragging(true);
              const rect = e.currentTarget.getBoundingClientRect();
              setDragOffset({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
              });
            }}
          >
            <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                <div className="space-y-1">
                  <div className="text-xs text-slate-500 font-medium">Viewing as</div>
                  <Select value={viewingAsRole || currentUser.role} onValueChange={setViewingAsRole}>
                    <SelectTrigger className="h-8 text-sm border-indigo-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="Design Consultant">Design Consultant</SelectItem>
                      <SelectItem value="Customer Service Rep">Customer Service Rep</SelectItem>
                      <SelectItem value="Order Processor">Order Processor</SelectItem>
                      <SelectItem value="Sales Manager">Sales Manager</SelectItem>
                      <SelectItem value="Finance Manager">Finance Manager</SelectItem>
                      <SelectItem value="Operations">Operations</SelectItem>
                      <SelectItem value="Customer Experience Coordinator">Customer Experience Coordinator</SelectItem>
                      <SelectItem value="no_role">No Role Assigned</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }



  const navigation = [
    { name: 'Dashboard', icon: Activity, href: 'Dashboard', pages: ['Dashboard'], adminOnly: true, allowedEmails: ['user7@example.com'] },
    { name: 'My Appointments', icon: CalendarDays, href: 'MyAppointments', pages: ['MyAppointments', 'AppointmentDetail', 'ChecklistDetail'] },
    { name: 'My Tasks', icon: ClipboardCheck, href: 'MyTasks', pages: ['MyTasks'] },
    { name: 'My Sales', icon: DollarSign, href: 'MySales', pages: ['MySales'] },
    ...(appSettings?.quotes_enabled && (!appSettings?.quotes_admin_only || currentUser?.role === 'admin')
      ? [{ name: 'My Quotes', icon: FileText, href: 'MyQuotes', pages: ['MyQuotes', 'QuoteDetail'] }]
      : []),
    { name: 'My Tickets', icon: ClipboardCheck, href: 'MyTickets', pages: ['MyTickets'] },
    { name: 'Leads', icon: Users, href: 'Leads', pages: ['Leads', 'LeadDetail'] },
    { name: 'Customers', icon: Users, href: 'Customers', pages: ['Customers', 'CustomerDetail'] },
    { name: 'Checklists', icon: ClipboardCheck, href: 'AppointmentSettingChecklists', pages: ['AppointmentSettingChecklists', 'ChecklistDetail'] },
    { 
      name: 'Appointments', 
      icon: CalendarDays, 
      pages: ['Appointments', 'Recordings', 'RecordingDetail'],
      subItems: [
        { name: 'All Appointments', href: 'Appointments', pages: ['Appointments'] },
        { name: 'Recordings', href: 'Recordings', pages: ['Recordings', 'RecordingDetail'] }
      ]
    },
    { name: 'Communication Hub', icon: MessageSquare, href: 'CommunicationHub', pages: ['CommunicationHub'] },
    { name: 'Schedule Assistant', icon: CalendarDays, href: 'ScheduleAssistant', pages: ['ScheduleAssistant'] },
    { name: 'Sales', icon: DollarSign, href: 'Sales', pages: ['Sales', 'SaleDetail'] },
    { 
      name: 'Projects', 
      icon: ClipboardCheck, 
      pages: ['Projects', 'ProjectDetail', 'CancelledProjects'],
      subItems: [
        { name: 'All Projects', href: 'Projects', pages: ['Projects', 'ProjectDetail'] },
        { name: 'Cancellations', href: 'CancelledProjects', pages: ['CancelledProjects'] }
      ]
    },
    { name: 'Claims & Inspections', icon: ClipboardCheck, href: 'ClaimsDashboard', pages: ['ClaimsDashboard'] },
    { 
      name: 'Order Processing', 
      icon: ClipboardCheck,
      pages: ['OrderProcessing', 'Calculators', 'Finance'],
      subItems: [
        { name: 'Order Processing', href: 'OrderProcessing', pages: ['OrderProcessing', 'Calculators'] },
        { name: 'Finance', href: 'Finance', pages: ['Finance'] }
      ]
    },
    { 
      name: 'Tickets', 
      icon: ClipboardCheck, 
      pages: ['SubmitTicket', 'MyTickets'],
      subItems: [
        { name: 'Submit Ticket', href: 'SubmitTicket', pages: ['SubmitTicket'] },
        { name: 'My Tickets', href: 'MyTickets', pages: ['MyTickets'] }
      ]
    },
    { name: 'Invoice Calculations', icon: DollarSign, href: 'InvoiceCalculator', pages: ['InvoiceCalculator'] },
    { name: 'Document Center', icon: FileText, href: 'ManualDesignMods', pages: ['ManualDesignMods'] },
    { 
      name: 'Reports', 
      icon: Activity, 
      pages: ['AppointmentReports', 'SalesReports', 'Reports', 'OrderProcessingReports', 'CashFlowProjection', 'ContractDiscrepancy', 'GrossProfitReport', 'AppointmentRehashReport'],
      subItems: [
        { name: 'Appointments', href: 'AppointmentReports', pages: ['AppointmentReports'] },
        { name: 'Sales', href: 'SalesReports', pages: ['SalesReports'] },
        { name: 'Order Processing', href: 'OrderProcessingReports', pages: ['OrderProcessingReports'] },
        { name: 'Cash Flow', href: 'CashFlowProjection', pages: ['CashFlowProjection'] },
        { name: 'Contract vs RFMS', href: 'ContractDiscrepancy', pages: ['ContractDiscrepancy'] },
        { name: 'Gross Profit', href: 'GrossProfitReport', pages: ['GrossProfitReport'] },
        { name: 'Sales Manager Dashboard', href: 'AppointmentRehashReport', pages: ['AppointmentRehashReport'] },
        { name: 'Marketing Performance', href: 'MarketingPerformance', pages: ['MarketingPerformance'] },
        { name: 'DC Performance Matrix', href: 'DCPerformanceMatrix', pages: ['DCPerformanceMatrix'] }
      ]
    },
    { name: 'Team Members', icon: UserCog, href: 'TeamMembers', pages: ['TeamMembers', 'TeamMemberDetail', 'DesignConsultants', 'CustomerServiceReps'] },
    { name: 'System Logs', icon: Activity, href: 'Logs', pages: ['Logs'] },
    { name: 'Company Directory', icon: Users, href: 'CompanyDirectory', pages: ['CompanyDirectory'] },
    {
      name: 'Fleet',
      icon: Truck,
      pages: ['Fleet', 'FleetVehicles', 'FleetDrivers', 'FleetMaintenance'],
      subItems: [
        { name: 'Fleet Dashboard', href: 'Fleet', pages: ['Fleet'] },
        { name: 'Vehicles', href: 'FleetVehicles', pages: ['FleetVehicles'] },
        { name: 'Drivers', href: 'FleetDrivers', pages: ['FleetDrivers'] },
        { name: 'Maintenance', href: 'FleetMaintenance', pages: ['FleetMaintenance'] }
      ]
    },
    { name: 'Settings', icon: SettingsIcon, href: 'Settings', pages: ['Settings'] },
    { name: 'Integrations', icon: Plug, href: 'Integrations', pages: ['Integrations'], adminOnly: true },
    {
      name: 'Development',
      icon: Activity,
      pages: ['RFMSCustomers'],
      adminOnly: true,
      subItems: [
        { name: 'RFMS Customers', href: 'RFMSCustomers', pages: ['RFMSCustomers'] }
      ]
    },
    { name: 'Journey', icon: Activity, href: 'Journey', pages: ['Journey'], adminOnly: true }
  ];

  const isActive = (navItem) => {
    return navItem.pages.includes(currentPageName);
  };

  // Data-driven nav: show items whose target/pages are in the user's allowed
  // module pages (from the access model). RLS + the route guard are the real
  // enforcement; this just shapes the menu to what the user can reach.
  const getFilteredNavigation = () => {
    if (!access) return [];
    const isAdmin = currentUser?.role === 'admin';
    return navigation.filter((item) => {
      if (item.hiddenWhen?.()) return false;
      if (isAdmin) return true; // org admins see the full menu
      const keys = [
        item.href,
        ...(item.pages || []),
        ...((item.subItems || []).flatMap((s) => [s.href, ...(s.pages || [])])),
      ].filter(Boolean);
      return keys.some((k) => allowedPageKeys.has(k));
    });
  };

  // eslint-disable-next-line no-unused-vars
  const _legacyGetFilteredNavigation = () => {
    // (superseded by the module-based filter above; kept for reference)
    if (!currentUser || permissionsLoading) {
      return [];
    }

    // Determine the role to check permissions for
    let roleToCheck;
    if (currentUser?.role === 'admin') {
      // Admin can view as other roles
      roleToCheck = viewingAsRole || 'admin';
    } else {
      // Regular users use their Team Member role - if still loading, show nothing
      if (teamMemberLoading) {
        console.debug('[Layout] Team member still loading');
        return [];
      }
      if (!teamMember) {
        console.debug('[Layout] No team member found after loading', { 
          currentUserEmail: currentUser?.email,
          teamMemberData: teamMember 
        });
        return [];
      }
      roleToCheck = teamMember?.role || null;
    }

    console.debug('[Layout] Role to check:', roleToCheck, { currentUser: currentUser?.email, teamMember: teamMember?.email });

    // Admin always sees everything when viewing as admin (except email-restricted items)
    // Treat TeamMember-role "Admin" the same as platform-admin (User.role === 'admin')
    if (roleToCheck === 'admin' || roleToCheck === 'Admin') {
      console.debug('[Layout] Admin viewing as admin - showing all navigation');
      return navigation.filter(item => (!item.allowedEmails || item.allowedEmails.includes(currentUser?.email)) && !item.hiddenWhen?.());
    }

    // Filter out adminOnly items for non-admins
    const nonAdminNav = navigation.filter(item => !item.adminOnly && !item.hiddenWhen?.());

    // If no role found after data is loaded, show nothing (user needs team member record)
    if (!roleToCheck) {
      console.debug('[Layout] No role found');
      return [];
    }

    // Get the role permissions
    const permission = rolePermissions.find(rp => rp.role === roleToCheck);
    const accessiblePages = permission?.accessible_pages || [];

    console.debug('[Layout] Role permissions:', { role: roleToCheck, accessiblePages, currentPageName });

    // If no permissions record exists or empty, restrict access (don't show everything)
    if (!permission || accessiblePages.length === 0) {
      console.debug('[Layout] No permissions found for role');
      return [];
    }

    // Filter navigation based on accessible pages
    const filtered = nonAdminNav.filter(navItem => {
      // Check email-restricted items
      if (navItem.allowedEmails) {
        return navItem.allowedEmails.includes(currentUser?.email);
      }
      // Check if any of the navItem's pages are in the accessible list
      const hasAccess = navItem.pages.some(page => accessiblePages.includes(page));
      console.debug('[Layout] Nav item:', navItem.name, { pages: navItem.pages, hasAccess });
      return hasAccess;
    });

    console.debug('[Layout] Filtered navigation items:', filtered.map(n => n.name));
    return filtered;
  };

  const filteredNavigation = getFilteredNavigation();

  const recordingContextValue = {
    recordingAppointmentId,
    startRecording: (appointmentId) => setRecordingAppointmentId(appointmentId),
    stopRecording: () => setRecordingAppointmentId(null)
  };

  return (
    <RecordingContext.Provider value={recordingContextValue}>
    <div className="min-h-screen bg-slate-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 bottom-0 w-64 bg-white border-r border-slate-200 z-50 transition-transform duration-300 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200">
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                RAZZLE DAZZLE
              </h1>
              <p className="text-[9px] font-sans tracking-wider text-slate-400 uppercase mt-0.5">
                BY FLOOR DADDY
              </p>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-600" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
            {filteredNavigation.map((item) => {
              const Icon = item.icon;
              const active = isActive(item);
              const hasSubItems = item.subItems && item.subItems.length > 0;
              const isExpanded = expandedMenuItems[item.name];

              if (hasSubItems) {
                return (
                  <div key={item.name}>
                    <button
                      onClick={() => setExpandedMenuItems(prev => ({ ...prev, [item.name]: !prev[item.name] }))}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
                        active
                          ? "bg-indigo-50 text-indigo-600 shadow-sm"
                          : "text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="font-medium flex-1 text-left">{item.name}</span>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="ml-8 mt-1 space-y-1">
                        {item.subItems.map((subItem) => {
                          const subActive = subItem.pages.includes(currentPageName);
                          return (
                            <Link
                              key={subItem.name}
                              to={createPageUrl(subItem.href)}
                              onClick={() => setSidebarOpen(false)}
                              className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-sm",
                                subActive
                                  ? "bg-indigo-50 text-indigo-600"
                                  : "text-slate-600 hover:bg-slate-50"
                              )}
                            >
                              {subItem.name}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <Link
                  key={item.name}
                  to={createPageUrl(item.href)}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
                    active
                      ? "bg-indigo-50 text-indigo-600 shadow-sm"
                      : "text-slate-600 hover:bg-slate-50"
                  )}
                  >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.name}</span>
                  {item.name === 'My Tasks' && pendingTasksCount > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                      {pendingTasksCount}
                    </span>
                  )}
                  </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-6 border-t border-slate-200 space-y-4">
            {currentUser ? (
              <>
                <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-lg">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {currentUser.full_name}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {currentUser.email}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      Role: {currentUser.role}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => base44.auth.logout()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={() => base44.auth.redirectToLogin()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-colors"
              >
                <User className="w-4 h-4" />
                Login
              </button>
            )}
            <p className="text-xs text-slate-400 text-center">
              v1.7.7
            </p>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64 h-screen flex flex-col overflow-hidden">
        {/* Mobile header */}
        <div className="lg:hidden h-16 bg-white border-b border-slate-200 flex items-center px-6 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Menu className="w-6 h-6 text-slate-600" />
          </button>
          <div className="ml-4">
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              RAZZLE DAZZLE
            </h1>
            <p className="text-[9px] font-sans tracking-wider text-slate-400 uppercase mt-0.5">
              BY FLOOR DADDY
            </p>
          </div>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-auto">{children}</main>

        {/* Role Toggle - Bottom Right */}
        {currentUser?.role === 'admin' && (
          <div 
            className="fixed z-40 cursor-move"
            style={{
              left: widgetPosition.x !== null ? `${widgetPosition.x}px` : 'auto',
              right: widgetPosition.x !== null ? 'auto' : '1.5rem',
              top: widgetPosition.y !== null ? `${widgetPosition.y}px` : 'auto',
              bottom: widgetPosition.y !== null ? 'auto' : '1.5rem'
            }}
            onMouseDown={(e) => {
              setIsDragging(true);
              const rect = e.currentTarget.getBoundingClientRect();
              setDragOffset({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
              });
            }}
          >
            <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                <div className="space-y-1">
                  <div className="text-xs text-slate-500 font-medium">Viewing as</div>
                  <Select value={viewingAsRole || currentUser.role} onValueChange={setViewingAsRole}>
                    <SelectTrigger className="h-8 text-sm border-indigo-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="Design Consultant">Design Consultant</SelectItem>
                      <SelectItem value="Customer Service Rep">Customer Service Rep</SelectItem>
                      <SelectItem value="Order Processor">Order Processor</SelectItem>
                      <SelectItem value="Sales Manager">Sales Manager</SelectItem>
                      <SelectItem value="Finance Manager">Finance Manager</SelectItem>
                      <SelectItem value="Operations">Operations</SelectItem>
                      <SelectItem value="Customer Experience Coordinator">Customer Experience Coordinator</SelectItem>
                      <SelectItem value="no_role">No Role Assigned</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Persistent Audio Recorder */}
      {recordingAppointmentId && currentUser?.role === 'admin' && (
        <AudioRecorder
          appointmentId={recordingAppointmentId}
          onUploadComplete={async (fileUrl) => {
            await base44.entities.Appointment.update(recordingAppointmentId, {
              recording_url: fileUrl
            });
            queryClient.invalidateQueries({ queryKey: ['appointment', recordingAppointmentId] });
            setRecordingAppointmentId(null);
          }}
        />
      )}
    </div>
    </RecordingContext.Provider>
  );
}