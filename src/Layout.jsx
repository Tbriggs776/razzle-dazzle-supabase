import React, { useState, createContext, useContext } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Users, UserCog, CalendarDays, ClipboardCheck, Menu, X, Settings as SettingsIcon, DollarSign, LogOut, User, ShieldCheck, Activity, ChevronDown, ChevronRight, MessageSquare, FileText, Truck, Plug, BarChart3, HardHat, Briefcase, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AudioRecorder from '@/components/AudioRecorder';
import BrandLogo from '@/components/BrandLogo';

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
          <Link to={createPageUrl(home)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-primary text-primary-foreground hover:opacity-90 rounded-lg transition-colors">
            Go to my workspace
          </Link>
        </div>
      </div>
    );
  }

  // Show login splash if user is not logged in and trying to access protected pages
  if (!userLoading && !currentUser) {
    return (
      <div className="min-h-screen bg-secondary flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <User className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-3">
              Login Required
            </h1>
            <p className="text-slate-600 mb-6">
              You need to be logged in to access this page.
            </p>
            <button
              onClick={() => base44.auth.redirectToLogin(window.location.pathname)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm bg-primary text-primary-foreground hover:opacity-90 rounded-lg transition-colors"
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
      <div className="min-h-screen bg-secondary flex items-center justify-center p-6">
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
                <ShieldCheck className="w-5 h-5 text-primary" />
                <div className="space-y-1">
                  <div className="text-xs text-slate-500 font-medium">Viewing as</div>
                  <Select value={viewingAsRole || currentUser.role} onValueChange={setViewingAsRole}>
                    <SelectTrigger className="h-8 text-sm border-input">
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



  // Modular nav: a small set of top-level MODULES, each tucking its pages into
  // an expandable sub-navigation. Order = daily-use first, back-office last.
  const navigation = [
    {
      name: 'My Work', icon: Briefcase,
      subItems: [
        { name: 'My Appointments', href: 'MyAppointments', pages: ['MyAppointments', 'AppointmentDetail', 'ChecklistDetail'] },
        { name: 'My Results', href: 'MyAppointmentResults', pages: ['MyAppointmentResults'] },
        { name: 'My Tasks', href: 'MyTasks', pages: ['MyTasks'] },
        { name: 'My Sales', href: 'MySales', pages: ['MySales'] },
        { name: 'My Quotes', href: 'MyQuotes', pages: ['MyQuotes', 'QuoteDetail'],
          hiddenWhen: () => !(appSettings?.quotes_enabled && (!appSettings?.quotes_admin_only || currentUser?.role === 'admin')) },
        { name: 'My Tickets', href: 'MyTickets', pages: ['MyTickets'] },
      ],
    },
    {
      name: 'CRM', icon: Users,
      subItems: [
        { name: 'Leads', href: 'Leads', pages: ['Leads', 'LeadDetail'] },
        { name: 'Customers', href: 'Customers', pages: ['Customers', 'CustomerDetail'] },
        { name: 'Appointments', href: 'Appointments', pages: ['Appointments'] },
        { name: 'Recordings', href: 'Recordings', pages: ['Recordings', 'RecordingDetail'] },
        { name: 'Schedule Assistant', href: 'ScheduleAssistant', pages: ['ScheduleAssistant'] },
        { name: 'Setting Checklists', href: 'AppointmentSettingChecklists', pages: ['AppointmentSettingChecklists', 'ChecklistDetail'] },
        { name: 'Communication Hub', href: 'CommunicationHub', pages: ['CommunicationHub'] },
      ],
    },
    {
      name: 'Sales', icon: DollarSign,
      subItems: [
        { name: 'Sales', href: 'Sales', pages: ['Sales', 'SaleDetail'] },
        { name: 'Invoice Calculations', href: 'InvoiceCalculator', pages: ['InvoiceCalculator'] },
        { name: 'Document Center', href: 'ManualDesignMods', pages: ['ManualDesignMods'] },
      ],
    },
    {
      name: 'Order Processing', icon: Package,
      subItems: [
        { name: 'Order Processing', href: 'OrderProcessing', pages: ['OrderProcessing', 'Calculators'] },
        { name: 'Finance', href: 'Finance', pages: ['Finance'] },
      ],
    },
    {
      name: 'Installations', icon: HardHat,
      subItems: [
        { name: 'Install Journey', href: 'Journey', pages: ['Journey', 'JourneyProjectDetail'] },
        { name: 'Projects', href: 'Projects', pages: ['Projects', 'ProjectDetail'] },
        { name: 'Cancellations', href: 'CancelledProjects', pages: ['CancelledProjects'] },
        { name: 'Installer Applications', href: 'InstallerApplications', pages: ['InstallerApplications'] },
      ],
    },
    {
      name: 'Claims', icon: ShieldCheck,
      subItems: [
        { name: 'Claims & Inspections', href: 'ClaimsDashboard', pages: ['ClaimsDashboard'] },
      ],
    },
    {
      name: 'Tickets', icon: MessageSquare,
      subItems: [
        { name: 'Submit Ticket', href: 'SubmitTicket', pages: ['SubmitTicket'] },
        { name: 'My Tickets', href: 'MyTickets', pages: ['MyTickets'] },
      ],
    },
    {
      name: 'Fleet', icon: Truck,
      subItems: [
        { name: 'Fleet Dashboard', href: 'Fleet', pages: ['Fleet'] },
        { name: 'Vehicles', href: 'FleetVehicles', pages: ['FleetVehicles'] },
        { name: 'Drivers', href: 'FleetDrivers', pages: ['FleetDrivers'] },
        { name: 'Maintenance', href: 'FleetMaintenance', pages: ['FleetMaintenance'] },
      ],
    },
    {
      name: 'Reports', icon: BarChart3,
      subItems: [
        { name: 'Scoreboard', href: 'Dashboard', pages: ['Dashboard'] },
        { name: 'Appointments', href: 'AppointmentReports', pages: ['AppointmentReports'] },
        { name: 'Sales', href: 'SalesReports', pages: ['SalesReports'] },
        { name: 'Order Processing', href: 'OrderProcessingReports', pages: ['OrderProcessingReports'] },
        { name: 'Cash Flow', href: 'CashFlowProjection', pages: ['CashFlowProjection'] },
        { name: 'Contract vs RFMS', href: 'ContractDiscrepancy', pages: ['ContractDiscrepancy'] },
        { name: 'Gross Profit', href: 'GrossProfitReport', pages: ['GrossProfitReport'] },
        { name: 'Sales Manager Dashboard', href: 'AppointmentRehashReport', pages: ['AppointmentRehashReport'] },
        { name: 'Marketing Performance', href: 'MarketingPerformance', pages: ['MarketingPerformance'] },
        { name: 'DC Performance Matrix', href: 'DCPerformanceMatrix', pages: ['DCPerformanceMatrix'] },
      ],
    },
    {
      name: 'Team', icon: UserCog,
      subItems: [
        { name: 'Team Members', href: 'TeamMembers', pages: ['TeamMembers', 'TeamMemberDetail', 'DesignConsultants', 'CustomerServiceReps'] },
        { name: 'Company Directory', href: 'CompanyDirectory', pages: ['CompanyDirectory'] },
      ],
    },
    {
      name: 'System', icon: SettingsIcon,
      subItems: [
        { name: 'Settings', href: 'Settings', pages: ['Settings'] },
        { name: 'Integrations', href: 'Integrations', pages: ['Integrations'] },
        { name: 'System Logs', href: 'Logs', pages: ['Logs'] },
        { name: 'RFMS Customers', href: 'RFMSCustomers', pages: ['RFMSCustomers'] },
      ],
    },
  ];

  const pageInItem = (it) => it.href === currentPageName || (it.pages || []).includes(currentPageName);
  const moduleHasActive = (mod) => (mod.subItems || []).some(pageInItem);

  // Data-driven modular nav: keep modules that have at least one sub-item the
  // user can reach, and filter the visible sub-items per-user. RLS + the route
  // guard are the real enforcement; this just shapes the menu.
  const getFilteredNavigation = () => {
    if (!access) return [];
    const isAdmin = currentUser?.role === 'admin';
    const canReach = (sub) => {
      if (sub.hiddenWhen?.()) return false;
      if (isAdmin) return true; // org admins see the full menu
      const keys = [sub.href, ...(sub.pages || [])].filter(Boolean);
      return keys.some((k) => allowedPageKeys.has(k));
    };
    return navigation
      .filter((mod) => !mod.hiddenWhen?.())
      .map((mod) => ({ ...mod, subItems: (mod.subItems || []).filter(canReach) }))
      .filter((mod) => mod.subItems.length > 0);
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
    <div className="min-h-screen bg-background">
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
          "fixed top-0 left-0 bottom-0 w-64 bg-sidebar border-r border-sidebar-border z-50 transition-transform duration-300 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="h-16 flex items-center justify-between px-6 border-b border-sidebar-border">
            <BrandLogo imgClassName="h-8" onDark />
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-2 hover:bg-sidebar-accent rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-sidebar-foreground" />
            </button>
          </div>

          {/* Navigation — modules with tucked-in sub-nav */}
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
            {filteredNavigation.map((item) => {
              const Icon = item.icon;
              const active = moduleHasActive(item);
              const isExpanded = expandedMenuItems[item.name] ?? active;
              const moduleUnread = item.subItems.some(s => s.href === 'MyTasks') && pendingTasksCount > 0;

              return (
                <div key={item.name}>
                  <button
                    onClick={() => setExpandedMenuItems(prev => ({ ...prev, [item.name]: !(prev[item.name] ?? active) }))}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors",
                      active
                        ? "text-sidebar-primary font-semibold"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="w-[18px] h-[18px] shrink-0" />
                    <span className="flex-1 text-left text-[13.5px] font-medium">{item.name}</span>
                    {!isExpanded && moduleUnread && (
                      <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-crit text-white text-[10px] font-bold">
                        {pendingTasksCount}
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 opacity-70" />
                    ) : (
                      <ChevronRight className="w-4 h-4 opacity-60" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="mb-1 ml-[26px] mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
                      {item.subItems.map((subItem) => {
                        const subActive = pageInItem(subItem);
                        const showBadge = subItem.href === 'MyTasks' && pendingTasksCount > 0;
                        return (
                          <Link
                            key={subItem.name}
                            to={createPageUrl(subItem.href)}
                            onClick={() => setSidebarOpen(false)}
                            className={cn(
                              "relative flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors",
                              subActive
                                ? "bg-sidebar-accent text-sidebar-primary font-medium before:absolute before:-left-[13px] before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-r-full before:bg-sidebar-primary"
                                : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            )}
                          >
                            <span className="flex-1 truncate">{subItem.name}</span>
                            {showBadge && (
                              <span className="ml-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-crit text-white text-[10px] font-bold">
                                {pendingTasksCount}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-6 border-t border-sidebar-border space-y-4">
            {currentUser ? (
              <>
                <div className="flex items-center gap-3 px-3 py-2 bg-sidebar-accent rounded-lg">
                  <div className="w-8 h-8 rounded-lg bg-sidebar-primary/20 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-sidebar-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-sidebar-foreground truncate">
                      {currentUser.full_name}
                    </p>
                    <p className="text-xs text-sidebar-foreground/70 truncate">
                      {currentUser.email}
                    </p>
                    <p className="text-xs text-sidebar-foreground/50 truncate">
                      Role: {currentUser.role}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => base44.auth.logout()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-white rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={() => base44.auth.redirectToLogin()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground hover:opacity-90 rounded-lg transition-colors"
              >
                <User className="w-4 h-4" />
                Login
              </button>
            )}
            <p className="text-xs text-sidebar-foreground/40 text-center">
              v1.7.7
            </p>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64 h-screen flex flex-col overflow-hidden">
        {/* Mobile header */}
        <div className="lg:hidden h-16 bg-sidebar border-b border-sidebar-border flex items-center px-6 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-sidebar-accent rounded-lg transition-colors"
          >
            <Menu className="w-6 h-6 text-sidebar-foreground" />
          </button>
          <div className="ml-4">
            <BrandLogo imgClassName="h-7 sm:h-8" onDark />
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
                <ShieldCheck className="w-5 h-5 text-primary" />
                <div className="space-y-1">
                  <div className="text-xs text-slate-500 font-medium">Viewing as</div>
                  <Select value={viewingAsRole || currentUser.role} onValueChange={setViewingAsRole}>
                    <SelectTrigger className="h-8 text-sm border-input">
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