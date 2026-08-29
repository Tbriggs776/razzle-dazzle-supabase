/**
 * Data-access layer (formerly base44Client — de-branded in roadmap P2).
 *
 * The original app talks to its backend through a small, consistent SDK surface:
 *   db.entities.<Entity>.{list,filter,get,create,update,delete,bulkCreate}
 *   db.auth.{me,logout,isAuthenticated,redirectToLogin}
 *   db.functions.invoke(name, payload)
 *   db.integrations.Core.{UploadFile,SendEmail,SendSMS,InvokeLLM,...}
 *
 * This module re-implements that exact surface on top of supabase-js so the
 * frontend runs unchanged. `import { base44 } from '@/api/base44Client'` still
 * works via a thin alias module; new code should import from '@/api/dataClient'.
 */
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Entity name -> Postgres table name (generated from the 44 base44 entities).
// ---------------------------------------------------------------------------
const ENTITY_TABLE = {
  AlertGroup: 'alert_group',
  AppSettings: 'app_settings',
  Appointment: 'appointment',
  AppointmentLog: 'appointment_log',
  AppointmentSettingChecklist: 'appointment_setting_checklist',
  ChecklistV2: 'checklist_v2',
  Communication: 'communication',
  Customer: 'customer',
  CustomerProjectSettings: 'customer_project_settings',
  InstallerApplication: 'installer_application',
  DesignMod: 'design_mod',
  EmailSettings: 'email_settings',
  FleetDriver: 'fleet_driver',
  FleetMaintenance: 'fleet_maintenance',
  FleetVehicle: 'fleet_vehicle',
  GHLContactCache: 'ghl_contact_cache',
  InspectionReport: 'inspection_report',
  Installer: 'installer',
  JourneyOrder: 'journey_order',
  Lead: 'lead',
  Log: 'log',
  ManualSalesContract: 'manual_sales_contract',
  // The money ledger. Shipped in 0051/0053 but unreachable from the app until
  // now — which is why there has never been a way to record a second payment.
  Payment: 'payment',
  Project: 'project',
  ProjectCheckpoint: 'project_checkpoint',
  ProjectCheckpointTemplate: 'project_checkpoint_template',
  ProjectClaim: 'project_claim',
  ProjectLog: 'project_log',
  Quote: 'quote',
  RFMSItem: 'rfms_item',
  RFMSOrderCache: 'rfms_order_cache',
  RFMSOrderStatus: 'rfms_order_status',
  RFMSRoll: 'rfms_roll',
  RFMSSession: 'rfms_session',
  RegionAssignment: 'region_assignment',
  RolePermissions: 'role_permissions',
  SMSSettings: 'sms_settings',
  Sale: 'sale',
  // READ-ONLY view. Carries balance_due plus the two collection gates
  // (deposit_satisfied, fully_collected), which are never null by construction.
  // Compute neither in JavaScript — the view is the single definition.
  SaleBalance: 'sale_balance',
  StandalonePreInstallChecklist: 'standalone_pre_install_checklist',
  Tag: 'tag',
  Task: 'task',
  TeamMember: 'team_member',
  Ticket: 'ticket',
  TicketLog: 'ticket_log',
  TicketMessage: 'ticket_message',
  TimeBlockSettings: 'time_block_settings',
  // Approvals — the gate between process steps. A decision always requires a
  // SECOND person; decide_approval refuses self-approval server-side.
  Approval: 'approval',
  // Subject-scoped conversation. thread_message.audience decides who may see
  // each message (internal / customer / installer / all) — that is what lets a
  // homeowner and a subcontractor share a thread with staff safely.
  Thread: 'thread',
  ThreadMessage: 'thread_message',
  Department: 'department',
  DepartmentMember: 'department_member',
  TaskLog: 'task_log',
  // In-app inbox. NOTE: no created_date column — pass an explicit sort
  // ('-created_at') or the client's default orderBy will 400.
  Notification: 'notification',
  // Workflow defects the engine raises for a human (E1-E11). NOTE: no
  // created_date column — pass an explicit sort ('-last_seen_at') or the
  // client's '-created_date' default will 400.
  WorkflowException: 'workflow_exception',
};

// base44 sort strings look like "-created_date" (desc) or "created_date" (asc).
function applyOrder(query, orderBy) {
  if (!orderBy) return query;
  const desc = orderBy.startsWith('-');
  const column = desc ? orderBy.slice(1) : orderBy;
  return query.order(column, { ascending: !desc });
}

// base44 filter objects are field->value (AND). A value may be a scalar
// (equality), an array (IN), or a Mongo-style operator object such as
// { $in: [...] }, { $gt: n }, { $lte: n }, { $ne: v }, { $contains: v }.
function applyOperator(q, key, op, val) {
  switch (op) {
    case '$in': return q.in(key, val);
    // Quote each value so the not-in list survives spaces/commas/special chars
    // (e.g. status "Pitch and Miss"). PostgREST accepts a double-quoted list.
    case '$nin': return q.not(key, 'in', `(${val.map((v) => JSON.stringify(String(v))).join(',')})`);
    case '$gt': return q.gt(key, val);
    case '$gte': return q.gte(key, val);
    case '$lt': return q.lt(key, val);
    case '$lte': return q.lte(key, val);
    case '$ne': return q.neq(key, val);
    case '$eq': return q.eq(key, val);
    case '$contains': return q.contains(key, val); // array/jsonb containment (@>)
    case '$ilike': return q.ilike(key, val);
    case '$like': return q.like(key, val);
    // Presence check. IS NOT NULL / IS NULL — note this treats '' as present,
    // which matches how the callers use it (a stored file URL is either there or
    // the column is null).
    case '$exists': return val ? q.not(key, 'is', null) : q.is(key, null);
    default:
      // THROW, never return `q`. Returning the query unfiltered turns "give me
      // the rows matching this" into "give me every row", and the caller cannot
      // tell the difference — it just gets a confident wrong answer. That is
      // exactly what happened with $exists on the pre-install checklist tab:
      // 0 of 36 appointments had a signature and all 36 rendered as signed,
      // which is what staff used to decide who still needed chasing.
      // A filter the backend cannot express must fail loudly.
      throw new Error(
        `[dataClient] Unsupported filter operator "${op}" on "${key}". `
        + `Refusing to run the query unfiltered — add the operator to applyOperator().`,
      );
  }
}

function applyFilter(query, filters) {
  let q = query;
  for (const [key, value] of Object.entries(filters || {})) {
    if (Array.isArray(value)) {
      q = q.in(key, value);
    } else if (value === null) {
      q = q.is(key, null);
    } else if (value && typeof value === 'object' && Object.keys(value).some((k) => k.startsWith('$'))) {
      for (const [op, val] of Object.entries(value)) q = applyOperator(q, key, op, val);
    } else {
      q = q.eq(key, value);
    }
  }
  return q;
}

// PostgREST returns timestamptz with a numeric offset ("2026-06-26T12:00:00+00:00").
// base44 returned naive-UTC ISO strings, and a lot of app code does
// `new Date(v)`, which breaks on the offset form.
// Normalize any offset-timestamp string to canonical "...Z" ISO so every date in
// the app parses correctly. Plain dates ("2026-08-13") are left untouched.
const TS_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:?\d{2}$/;
function normalizeValue(v) {
  if (typeof v === 'string' && TS_OFFSET_RE.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return v;
}
function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, val] of Object.entries(row)) out[k] = normalizeValue(val);
  return out;
}
function normalize(data) {
  if (Array.isArray(data)) return data.map(normalizeRow);
  return normalizeRow(data);
}

function unwrap({ data, error }, context) {
  if (error) {
    const e = new Error(`[dataClient] ${context}: ${error.message}`);
    e.cause = error;
    e.status = error.code;
    throw e;
  }
  return normalize(data);
}

// PostgREST caps a single response at ~1000 rows, so an unbounded list()/filter()
// silently truncates — mis-totaling reports as tables grow. Page through with
// .range() until we have everything, the caller's limit, or a safety ceiling.
// makeQuery() must return a FRESH builder each call (a PostgREST builder is
// single-use once awaited).
const PAGE_SIZE = 1000;
const MAX_ROWS = 50000;
async function fetchAll(makeQuery, limit, context) {
  const cap = limit ?? MAX_ROWS;
  const rows = [];
  let from = 0;
  while (rows.length < cap) {
    const want = Math.min(PAGE_SIZE, cap - rows.length);
    const { data, error } = await makeQuery().range(from, from + want - 1);
    if (error) unwrap({ data, error }, context); // throws
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < want) break; // short page => last page
    from += batch.length;
  }
  return normalize(rows);
}

// Monotonic id so each subscribe() gets a unique realtime channel name.
let realtimeSubSeq = 0;

function makeEntity(entityName) {
  const table = ENTITY_TABLE[entityName];
  if (!table) {
    throw new Error(`[dataClient] Unknown entity "${entityName}".`);
  }
  return {
    _table: table,

    async list(orderBy = '-created_date', limit) {
      const make = () => applyOrder(supabase.from(table).select('*'), orderBy);
      return fetchAll(make, limit, `${entityName}.list`);
    },

    async filter(filters = {}, orderBy = '-created_date', limit) {
      const make = () => applyOrder(applyFilter(supabase.from(table).select('*'), filters), orderBy);
      return fetchAll(make, limit, `${entityName}.filter`);
    },

    async get(id) {
      const res = await supabase.from(table).select('*').eq('id', id).single();
      return unwrap(res, `${entityName}.get`);
    },

    async create(payload) {
      const res = await supabase.from(table).insert(payload).select().single();
      return unwrap(res, `${entityName}.create`);
    },

    async bulkCreate(rows) {
      const res = await supabase.from(table).insert(rows).select();
      return unwrap(res, `${entityName}.bulkCreate`) ?? [];
    },

    async update(id, payload) {
      const res = await supabase.from(table).update(payload).eq('id', id).select().single();
      return unwrap(res, `${entityName}.update`);
    },

    async delete(id) {
      const res = await supabase.from(table).delete().eq('id', id);
      unwrap(res, `${entityName}.delete`);
      return { id };
    },

    // base44 SDK compatibility: real-time row updates. Backed by Supabase Realtime,
    // translating postgres_changes into base44's { type, id, data } event shape.
    // MUST NOT throw synchronously — callers invoke this inside a useEffect and use
    // the return value as the cleanup fn, so any throw here white-screens the page.
    // Wrapped defensively: if realtime is unavailable it degrades to a no-op and the
    // page still works (pages also refetch / invalidate on their own mutations).
    subscribe(callback) {
      try {
        const channel = supabase
          .channel(`rt-${table}-${realtimeSubSeq++}`)
          .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
            try {
              const type = payload.eventType === 'INSERT' ? 'create'
                : payload.eventType === 'DELETE' ? 'delete' : 'update';
              const row = (payload.new && Object.keys(payload.new).length) ? payload.new : payload.old;
              callback?.({ type, id: row?.id, data: row });
            } catch (_) { /* ignore consumer callback errors */ }
          })
          .subscribe();
        return () => { try { supabase.removeChannel(channel); } catch (_) { /* noop */ } };
      } catch (_) {
        return () => {}; // realtime unavailable — no-op unsubscribe, never crash the page
      }
    },
  };
}

// entities proxy: db.entities.Customer -> makeEntity('Customer'), memoized.
// base44's `User` was the PLATFORM user (login/access) — a concept retired by the migration
// (auth is Supabase; the app_user access-model row has no email/name/role to reconcile). Rather
// than throw "Unknown entity" (which broke the Team Members roster), expose a graceful empty
// entity so pages that overlaid platform users simply show none.
const RETIRED_ENTITY = {
  async list() { return []; },
  async filter() { return []; },
  async get() { return null; },
  async create() { throw new Error('The base44 "User" concept is retired; manage access via Team Members instead.'); },
  async update() { throw new Error('The base44 "User" concept is retired; manage access via Team Members instead.'); },
  async delete() { return { id: null }; },
  subscribe() { return () => {}; },
};
const RETIRED_ENTITIES = new Set(['User']);

const entityCache = {};
const entities = new Proxy(
  {},
  {
    get(_t, name) {
      if (name === 'Query') return makeEntity; // rarely used; expose factory
      if (typeof name !== 'string') return undefined;
      if (RETIRED_ENTITIES.has(name)) return RETIRED_ENTITY;
      if (!entityCache[name]) entityCache[name] = makeEntity(name);
      return entityCache[name];
    },
  }
);

// ---------------------------------------------------------------------------
// Auth. Backed by real Supabase Auth; role derived from the access model.
// ---------------------------------------------------------------------------
const auth = {
  // Returns the signed-in user's profile. Throws (401) when unauthenticated so
  // the AuthContext can show the login screen.
  async me() {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      const e = new Error('Not authenticated');
      e.status = 401;
      throw e;
    }
    const u = data.user;
    // Derive the app role from the access model (org admins => 'admin', which the
    // existing pages check via currentUser.role === 'admin').
    let isOrgAdmin = false;
    try {
      const { data: acc } = await supabase.rpc('my_access');
      isOrgAdmin = acc?.user?.is_org_admin ?? false;
    } catch (_) { /* fall through to metadata role */ }
    return {
      id: u.id,
      email: u.email,
      full_name: u.user_metadata?.full_name || u.email,
      role: isOrgAdmin ? 'admin' : (u.user_metadata?.role || 'member'),
    };
  },
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },
  async logout() {
    await supabase.auth.signOut();
  },
  async isAuthenticated() {
    const { data } = await supabase.auth.getSession();
    return !!data?.session;
  },
  // The user's accessible modules + per-module permission + pages (drives nav + guards).
  async getAccess() {
    const { data, error } = await supabase.rpc('my_access');
    if (error) throw error;
    return data;
  },
  redirectToLogin() {
    // Login is rendered in-app by AuthContext; nothing to redirect to.
  },
};

// ---------------------------------------------------------------------------
// Serverless functions. Each base44 Deno function maps to either a deployed
// Supabase Edge Function or a Postgres RPC. Names not yet ported return a
// { stub: true } result AND surface a one-time "not available yet" toast, so a
// button can no longer silently fake success.
// ---------------------------------------------------------------------------
const DEPLOYED_FUNCTIONS = new Set([
  'userAdmin',
  'getAppUrl',
  'getPublicProjectSigned',
  'logAppointmentAction',
  'sendLeadMessage',
  'installerApproved',
  'shortenUrl',
  'emailDispatch',
  'pdfEmail',
  'esign',
  'financeReport',
  'smsDispatch',
  'invokeLLM',
  'analyzeRecording',
  'rfmsQuery',
  'googleMaps',
  'syncCalendarEvent',
  'googleSheets',
  'ghl',
  'submitCheckpoint',
  'notifyInstallerAssigned',
]);

// base44 email-sender names -> the single emailDispatch function with a `type`
// discriminator, so existing call sites (invoke('sendSaleConfirmationEmail', {saleId}))
// work unchanged while all email logic lives in one deployed function. Add a sender
// = one entry here + one case in emailDispatch (no new deploy).
const EDGE_ALIASES = {
  sendSaleConfirmationEmail:      (p) => ['emailDispatch', { ...p, type: 'sale_confirmation' }],
  sendFundsReceivedEmail:         (p) => ['emailDispatch', { ...p, type: 'funds_received' }],
  sendProjectClaimCompletedEmail: (p) => ['emailDispatch', { ...p, type: 'project_claim_completed' }],
  sendDesignModEmail:             (p) => ['emailDispatch', { ...p, type: 'design_mod' }],
  sendPreInstallEmail:            (p) => ['emailDispatch', { ...p, type: 'pre_install' }],
  sendManualSalesContractEmail:   (p) => ['emailDispatch', { ...p, type: 'manual_sales_contract' }],
  // Generic customer-notification dispatcher: base44 called invoke('sendNotificationEmail',
  // {type, entityId, appUrl}) where `type` is the notification kind (appointment_created,
  // sale_confirmed, project_created, not_sold, ...). Route to emailDispatch's `notification`
  // handler, keeping the kind under notify_type (emailDispatch's own `type` is 'notification').
  sendNotificationEmail:          (p) => ['emailDispatch', { type: 'notification', notify_type: p.type, entityId: p.entityId ?? p.appointmentId, appUrl: p.appUrl }],
  sendReceiptEmail:               (p) => ['pdfEmail', { ...p, type: 'receipt' }],
  sendInspectionReportEmail:      (p) => ['pdfEmail', { ...p, type: 'inspection' }],
  sendProjectClaimEmail:          (p) => ['pdfEmail', { ...p, type: 'claim' }],
  // Admin template preview -> emailDispatch test_email (renders a template with dummy
  // data and sends a [TEST] copy to the divert address).
  sendTestEmail:                  (p) => ['emailDispatch', { type: 'test_email', emailType: p.emailType }],
  // Manual "Send Report Now" button on the Finance page -> the (dual-auth) financeReport fn.
  sendFinanceReport:              () => ['financeReport', {}],

  // ── SMS fleet -> the single smsDispatch function (SMS mirror of emailDispatch). Each
  // base44 Twilio sender maps to a `type`; call sites are unchanged. See supabase/functions/
  // smsDispatch. Inbound (incomingSMS) is Twilio-only, so it needs no alias here.
  sendAppointmentSMS:             (p) => ['smsDispatch', { type: p.type, appointmentId: p.appointmentId, customerId: p.customerId }],
  // Generic direct SMS is SYNCHRONOUS: smsDispatch returns the legacy { success, messageSid,
  // twilioStatus, to } shape so the ~13 call sites that read the response keep working.
  sendSMS:                        (p) => ['smsDispatch', { type: 'direct', to: p.to, message: p.message }],
  sendTicketMessageSMS:           (p) => ['smsDispatch', { type: 'ticket_message', ticketId: p.ticketId, senderName: p.senderName, message: p.message, senderRole: p.senderRole }],
  sendCancellationSaveAttempt:    (p) => ['smsDispatch', { type: 'cancellation_save_attempt', project_id: p.project_id }],
  sendCancellationUpdate:         (p) => ['smsDispatch', { type: 'cancellation_update', project_id: p.project_id, message: p.message }],
  // base44's payload.type (cancelled|cleared) is remapped to `subtype` so it doesn't collide
  // with smsDispatch's own `type` discriminator.
  sendCancellationStatusAlert:    (p) => ['smsDispatch', { type: 'cancellation_status', subtype: p.type, customerName: p.customerName, invoiceNumber: p.invoiceNumber, installDate: p.installDate, reason: p.reason, clearedBy: p.clearedBy }],
  sendLowGPAlert:                 (p) => ['smsDispatch', { type: 'low_gp', saleId: p.saleId, customerName: p.customerName, consultantName: p.consultantName, consultantId: p.consultantId, gpPercent: p.gpPercent, orderTotal: p.orderTotal, invoiceNumber: p.invoiceNumber }],
  sendPastDueProjectsAlert:       () => ['smsDispatch', { type: 'past_due' }],
  sendPendingCancellationAlert:   () => ['smsDispatch', { type: 'pending_cancellation' }],
  sendUnassignedDCAlerts:         () => ['smsDispatch', { type: 'unassigned_dc' }],

  // ── LLM (Anthropic Claude) -> the invokeLLM bridge. The raw InvokeLLM contract lives on
  // integrations.Core.InvokeLLM (below); these server functions call the bridge + update a record.
  extractContractData:            (p) => ['invokeLLM', { task: 'extract_contract', contractUrl: p.contractUrl, saleId: p.saleId }],
  analyzeNotSoldReason:           (p) => ['invokeLLM', { task: 'analyze_not_sold', appointmentId: p.appointmentId, event: p.event }],
  extractInvoiceTotal:            (p) => ['invokeLLM', { task: 'extract_invoice_total', pdfUrl: p.pdfUrl }],
  // Value-add compliance check on a call transcript (P7 recording pipeline). Also auto-run by
  // the assemblyAIWebhook -> analyze_value_adds job after transcription lands.
  analyzeValueAdds:               (p) => ['invokeLLM', { task: 'analyze_value_adds', appointmentId: p.appointmentId }],

  // ── AssemblyAI recordings. triggerAnalysis + the admin retry button both collapse to a fresh
  // analyzeRecording submit (base44's fire-and-forget indirection isn't needed — submit is <1s,
  // and the reconcile-stuck-recordings cron is the durable poll). analyzeRecording itself is
  // invoked by name (in DEPLOYED_FUNCTIONS) from the "Analyze Call" button.
  triggerAnalysis:                (p) => ['analyzeRecording', { appointmentId: p.appointmentId }],
  retryStuckRecording:            (p) => ['analyzeRecording', { appointmentId: p.appointmentId }],

  // ── RFMS ERP (Enterprise). All reads + thin write-enqueues route to the rfmsQuery dispatcher
  // (Basic auth + async {status} polling centralized in supabase/functions/_shared/rfms.ts). The
  // GP flow (Sale invoice_number -> fetch order -> low_gp) runs off a Postgres trigger, not here.
  // getOnHoldCache stays a Postgres RPC (P1). Names preserved so call sites are unchanged.
  getRFMSOrders:                  (p) => ['rfmsQuery', { ...p, type: 'order_search' }],
  getRFMSCrews:                   (p) => ['rfmsQuery', { ...p, type: 'crews' }],
  getRFMSJobs:                    (p) => ['rfmsQuery', { ...p, type: 'jobs' }],
  getRFMSOrderNotes:              (p) => ['rfmsQuery', { ...p, type: 'order_notes' }],
  getRFMSJobsFind:                (p) => ['rfmsQuery', { ...p, type: 'jobs_find' }],
  getRFMSCustomers:               (p) => ['rfmsQuery', { ...p, type: 'customers_search' }],
  getRFMSOrder:                   (p) => ['rfmsQuery', { type: 'check_order', documentNumbers: p.documentNumbers }],
  testOrderDirect:                (p) => ['rfmsQuery', { ...p, type: 'order_get' }],
  appendRFMSOrderNotes:           (p) => ['rfmsQuery', { ...p, type: 'append_note' }],
  sendToRFMS:                     (p) => ['rfmsQuery', { appointmentId: p.appointmentId, type: 'send_customer' }],

  // ── Google Maps (API-key: Geocoding + Street View Static) -> the googleMaps dispatcher.
  // Google Calendar/Sheets (OAuth) are a separate, pending decision.
  getStreetView:                  (p) => ['googleMaps', { ...p, type: 'street_view' }],
  journeyGeocode:                 (p) => ['googleMaps', { ...p, type: 'geocode' }],
  getZipsInPolygon:               (p) => ['googleMaps', { ...p, type: 'zips_in_polygon' }],
  // Google Sheets marketing dashboards (service-account read). syncCalendarEvent is invoked by
  // name (in DEPLOYED_FUNCTIONS) from its 9 call sites.
  getAdSpend:                     (p) => ['googleSheets', { ...p, type: 'ad_spend' }],
  getMarketingBudget:             (p) => ['googleSheets', { ...p, type: 'marketing_budget' }],

  // ── GHL (GoHighLevel v2) lead-count dashboard.
  getGHLLeadCount:                () => ['ghl', { type: 'lead_count' }],
  syncGHLContacts:                () => ['ghl', { type: 'sync_contacts' }],
};

// base44 functions reimplemented as Postgres RPCs (pure DB reads / aggregates) —
// invoked via supabase.rpc. Each entry maps the payload to the RPC's args; the
// RPC returns the same response envelope the page already expects.
const RPC_FUNCTIONS = {
  getAppointmentsByDC: (p) => ['get_appointments_by_dc', { p_start_date: p.startDate, p_end_date: p.endDate }],
  getSalesByDC:        (p) => ['get_sales_by_dc', { p_start_date: p.startDate, p_end_date: p.endDate }],
  getOnHoldCache:      () => ['get_on_hold_cache', {}],
  // Public (anon) pages read a curated single-record projection by id — the only
  // anon-reachable surface for these tables (RLS denies direct anon reads).
  getPublicAppointment: (p) => ['get_public_appointment', { p_id: p.id }],
  getPublicProject:     (p) => ['get_public_project', { p_id: p.id }],
  // AT1: one atomic + idempotent txn for the appointment "Sold" and quote "Convert" flows
  // (customer + sale + project + appointment/quote flip). Returns { sale_id, project_id,
  // customer_id, idempotent }. Post-commit notifications/tracker URL stay best-effort in the UI.
  convertToSale: (p) => ['convert_to_sale', {
    p_customer: p.customer ?? {}, p_sale: p.sale ?? {}, p_project: p.project ?? {},
    p_appointment_id: p.appointmentId ?? null,
    p_appointment_update: p.appointmentUpdate ?? {},
    p_quote_id: p.quoteId ?? null,
  }],
  // AT3: atomic sale cancel (delete project(s) + sale, revert appointment) in one txn.
  cancelSale: (p) => ['cancel_sale', { p_sale_id: p.saleId }],
  // AT2: atomic + idempotent appointment create + checklist link (returns { appointment_id }).
  createAppointmentFromChecklist: (p) => ['create_appointment_from_checklist', {
    p_checklist_table: p.checklistTable, p_checklist_id: p.checklistId, p_appointment: p.appointment ?? {},
  }],
  // AT4: atomic manual project create (customer + project + log) in one txn.
  createManualProject: (p) => ['create_manual_project', { p_customer: p.customer ?? {}, p_project: p.project ?? {}, p_log: p.log ?? null }],
  // Money. Sales/Journey may RECORD a payment (deposits are taken at the kitchen
  // table, balances in the driveway); only Accounting may CONFIRM one cleared.
  // Both gates are enforced server-side — never trust a client-side amount check.
  recordPayment: (p) => ['record_payment', {
    p_sale: p.saleId, p_amount: p.amount, p_method: p.method ?? null,
    p_reference: p.reference ?? null, p_kind: p.kind ?? 'final',
    p_note: p.note ?? null, p_idempotency_key: p.idempotencyKey ?? null,
  }],
  // Confirms every unconfirmed payment on the sale, then releases the ordering
  // hold ONLY if the cleared total meets the agreed deposit. Returns
  // { ok:false, reason:'short', shortfall } when it does not.
  confirmSaleDeposit: (p) => ['confirm_sale_deposit', { p_sale_id: p.saleId, p_note: p.note ?? null }],
  confirmPayment:     (p) => ['confirm_payment', { p_payment_id: p.paymentId, p_note: p.note ?? null }],
  // The ONLY way to change a sale's collection terms or grant a collection
  // exemption. Those columns are no longer client-writable (0080) because setting
  // collect_exempt_reason clears BOTH money gates and releases the ordering hold.
  // Requires can_edit('finance'); an exemption needs a written reason; every change
  // lands in sale_financial_log.
  // NOTE: no UI calls this yet — the plumbing is here, the Finance control is not.
  setCollectionTerms: (p) => ['set_collection_terms', {
    p_sale_id: p.saleId, p_collection_terms: p.terms ?? null,
    p_collect_exempt_reason: p.exemptReason ?? null,
    p_deposit_pct_required: p.depositPct ?? null,
    p_clear_exemption: p.clearExemption ?? false,
  }],
  // Driveway-safe: returns the amount due for ONE project and nothing else.
  // The Job Start Checklist is often opened by a subcontract installer whose
  // role cannot read the payment ledger, so this must never become a table read.
  installCollectionStatus: (p) => ['install_collection_status', { p_project_id: p.projectId }],
  // Both gated on the assignable 'cod_exception' permission (or org admin).
  // A waiver is what makes enforcement survivable: a stop with no remedy is a
  // stop people route around.
  waiveCodHold:            (p) => ['waive_cod_hold', { p_project_id: p.projectId, p_reason: p.reason }],
  // Inbox. Producing is service_role-only (users cannot notify each other yet);
  // only these two consumer actions are reachable from the browser, and
  // acknowledge is restricted server-side to the RECIPIENT so the
  // accountability record cannot be forged on someone else's behalf.
  markNotificationsRead:   (p) => ['mark_notifications_read', { p_ids: p.ids }],
  acknowledgeNotification: (p) => ['acknowledge_notification', { p_id: p.id }],
  // Work routing. assign_task resolves an owner through resolve_owners()
  // (on-call -> dept member -> role holder -> org admin) so work is never
  // addressed to nobody, and notifies whoever it landed on.
  assignTask:      (p) => ['assign_task', {
    p_title: p.title, p_dept: p.dept ?? null, p_assigned_user: p.assignedUser ?? null,
    p_subject_type: p.subjectType ?? null, p_subject_id: p.subjectId ?? null,
    p_due_at: p.dueAt ?? null, p_priority: p.priority ?? 3, p_notes: p.notes ?? null,
    p_role: p.role ?? null, p_rule_key: p.ruleKey ?? null, p_route: p.route ?? null,
  }],
  completeTask:    (p) => ['complete_task', { p_task_id: p.id, p_resolution: p.resolution ?? null }],
  // Completion lives in `state`, not `status` — trg_task_legacy_status derives
  // status FROM state on every write. Writing status directly is a silent no-op,
  // which is what MyTasks did until 0076. Always go through these two.
  reopenTask:      (p) => ['reopen_task', { p_task_id: p.id, p_reason: p.reason ?? null }],
  // Customer conversations are archived, never destroyed — DELETE on
  // `communication` is revoked outright (0083), because three months later that
  // thread is the ROC defence. Archiving records who and why, and is reversible.
  archiveConversation: (p) => ['archive_conversation', { p_ids: p.ids, p_reason: p.reason ?? null }],
  restoreConversation: (p) => ['restore_conversation', { p_ids: p.ids }],
  requestApproval: (p) => ['request_approval', {
    p_subject_type: p.subjectType, p_subject_id: p.subjectId, p_kind: p.kind,
    p_reason: p.reason, p_required_dept: p.requiredDept ?? null,
    p_required_role: p.requiredRole ?? null, p_route: p.route ?? null,
  }],
  decideApproval:  (p) => ['decide_approval', { p_id: p.id, p_state: p.state, p_note: p.note ?? null }],
  // Task management. assignableUsers is deliberately NOT userAdmin (which is
  // org-admin gated) — any user creating a task needs a picker, and this
  // returns names only, never emails or roster metadata.
  assignableUsers: () => ['assignable_users', {}],
  reassignTask:    (p) => ['reassign_task', {
    p_task_id: p.id, p_user_id: p.userId ?? null, p_dept: p.dept ?? null, p_note: p.note ?? null,
  }],
  addTaskNote:     (p) => ['add_task_note', { p_task_id: p.id, p_note: p.note }],
  // A task the reconciler created is a STARTING POINT, not a verdict — its
  // owner and due date are guesses made without knowing what is happening on
  // the job. Every change is logged with its old and new value.
  updateTask:      (p) => ['update_task', {
    p_task_id: p.id, p_title: p.title ?? null, p_notes: p.notes ?? null,
    p_due_at: p.dueAt ?? null, p_priority: p.priority ?? null,
    p_clear_due: p.clearDue ?? false,
  }],
  // Threads. Writes go through RPCs so authorship and audience cannot be
  // forged, and thread_message is UPDATE/DELETE-revoked: a conversation that
  // can be rewritten later is worthless in the dispute it exists for.
  openThread:  (p) => ['open_thread', { p_subject_type: p.subjectType, p_subject_id: p.subjectId, p_topic: p.topic }],
  postMessage: (p) => ['post_message', {
    p_thread_id: p.threadId, p_body: p.body, p_audience: p.audience ?? 'internal',
    p_file_urls: p.fileUrls ?? [], p_approval_id: p.approvalId ?? null,
  }],
  closeThread: (p) => ['close_thread', { p_thread_id: p.threadId }],
  // Routing admin. Department membership has a composite key, so it goes
  // through one org-admin-gated function rather than the generic entity client.
  setDepartmentMember: (p) => ['set_department_member', {
    p_dept: p.dept, p_user_id: p.userId, p_is_member: p.isMember ?? true,
    p_is_on_call: p.isOnCall ?? null, p_is_lead: p.isLead ?? null,
  }],
  // One call that reports every routing gap: unstaffed rules, roles named by a
  // rule that do not exist, roster members with no login, alert groups, SMS.
  routingHealth: () => ['routing_health', {}],
  resolveWorkflowException:(p) => ['resolve_workflow_exception', { p_id: p.id, p_note: p.note ?? null }],
  // Admin e-sign config (is_org_admin gated server-side).
  adminGetEsignTypes: () => ['admin_get_esign_types', {}],
  adminSetEsignType: (p) => ['admin_set_esign_type', {
    p_document_type: p.document_type, p_esign_enabled: p.esign_enabled ?? null, p_require_sms_otp: p.require_sms_otp ?? null,
    p_consent_text: p.consent_text ?? null, p_expiry_days: p.expiry_days ?? null, p_notify_emails: p.notify_emails ?? null,
  }],
  // Installer onboarding — AZ ROC license validation (public data) + the pre-login apply page's
  // token-scoped read/write of its Subcontractor Profile (anon; the token is the capability).
  rocLookup:                  (p) => ['roc_lookup', { p_license: p.license }],
  createInstallerApplication: (p) => ['create_installer_application', { p_payload: p.payload ?? {} }],
  saveInstallerApplication:   (p) => ['save_installer_application', { p_token: p.token, p_payload: p.payload ?? {} }],
  getInstallerApplication:    (p) => ['get_installer_application', { p_token: p.token }],
  submitInstallerApplication: (p) => ['submit_installer_application', { p_token: p.token }],
};

// Is a serverless function actually wired (Edge Function or RPC)? UI can use this
// to disable/label controls whose backend isn't live yet.
export function isFunctionLive(name) {
  return DEPLOYED_FUNCTIONS.has(name) || Object.prototype.hasOwnProperty.call(RPC_FUNCTIONS, name);
}

// Warn once per feature per session so a stubbed action is honest without spam.
const warnedStubs = new Set();
function warnUnavailable(name) {
  if (warnedStubs.has(name)) return;
  warnedStubs.add(name);
  try {
    toast('Not available yet', {
      description: 'This feature turns on once its integration is connected.',
    });
  } catch (_) { /* toast host not mounted (e.g. SSR/tests) */ }
}

// Unmapped functions whose whole purpose is to PERSIST data. Returning a fake-success stub for
// these hides data loss — the caller's onSuccess runs and the UI advances (e.g. a "Signed!"
// screen) though nothing was written. Throw instead so the mutation's onError fires. Read /
// degrade-style unmapped calls still return { stub:true } gracefully. (The legacy submit* signing
// handlers are the remaining known unported writes; e-sign is the ported signing path.)
const WRITE_STUBS = new Set([
  'submitDesignMod', 'submitManualSalesContract', 'submitPreInstallChecklist',
]);
const isWriteStub = (name) =>
  WRITE_STUBS.has(name) || /^(submit|create|update|delete|save|approve|reject|assign)/i.test(name);

const functions = {
  async invoke(name, payload = {}) {
    const alias = EDGE_ALIASES[name];
    if (alias) { const [n, pl] = alias(payload || {}); name = n; payload = pl; }
    const rpc = RPC_FUNCTIONS[name];
    if (rpc) {
      const [fn, args] = rpc(payload || {});
      const { data, error } = await supabase.rpc(fn, args);
      if (error) {
        console.warn(`[dataClient] rpc('${fn}') failed`, error?.message || error);
        return { data: null, error };
      }
      return { data, error: null };
    }
    if (!DEPLOYED_FUNCTIONS.has(name)) {
      warnUnavailable(name);
      if (isWriteStub(name)) {
        throw new Error(`Action "${name}" is not available yet — nothing was saved. This workflow hasn't been ported to Supabase.`);
      }
      return { data: null, error: null, stub: true };
    }
    try {
      const { data, error } = await supabase.functions.invoke(name, { body: payload });
      if (error) throw error;
      return { data, error: null };
    } catch (err) {
      // A DEPLOYED function that errors (non-2xx / network) is a REAL failure — surface it so
      // callers that check `error` (and mutation onError) can react. Do NOT mask it as
      // { stub:true }: that resurrected fake-success (e.g. "report sent!" when it wasn't).
      // The genuine "not configured" path is the function returning 200 + { stub:true } in its
      // body, which flows through the success branch above untouched.
      console.warn(`[dataClient] functions.invoke('${name}') failed.`, err?.message || err);
      return { data: null, error: err instanceof Error ? err : new Error(String(err?.message || err)) };
    }
  },
};

// ---------------------------------------------------------------------------
// Integrations. UploadFile is live (Supabase Storage). LLM/email/SMS are stubbed
// until their provider clusters land (roadmap P4-P7); call sites detect { stub }.
// ---------------------------------------------------------------------------
const integrations = {
  Core: {
    async UploadFile({ file } = {}) {
      if (!file) return { file_url: null };
      const ext = (file.name?.split('.').pop() || 'bin').toLowerCase();
      const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('uploads').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || undefined,
      });
      if (error) throw new Error(`[dataClient] UploadFile: ${error.message}`);
      // The 'uploads' bucket is PRIVATE (ST1). Persist the storage PATH, not a permanent public
      // URL — callers store this and render it via <SignedImage>/resolveFileUrl (@/lib/fileUrl),
      // which mints a short-lived signed URL. file_url keeps the same key for call-site parity.
      return { file_url: path, path };
    },
    async SendEmail(args) {
      console.warn('[dataClient] SendEmail stubbed.', args);
      return { success: true, stub: true };
    },
    async SendSMS(args) {
      console.warn('[dataClient] SendSMS stubbed.', args);
      return { success: true, stub: true };
    },
    async InvokeLLM(args) {
      // Backed by the invokeLLM edge function (Anthropic Claude). Returns the LLM result
      // directly: the parsed object when args.response_json_schema is given, else the text
      // string; { stub: true } when the AI integration isn't connected yet (callers already
      // handle result?.stub). Errors bubble up so callers can surface credit/quota messages.
      const { data, error } = await supabase.functions.invoke('invokeLLM', { body: args });
      if (error) throw error;
      return data;
    },
    async GenerateImage(args) {
      console.warn('[dataClient] GenerateImage stubbed.', args);
      return { url: 'stub://image', stub: true };
    },
    async ExtractDataFromUploadedFile(args) {
      console.warn('[dataClient] ExtractDataFromUploadedFile stubbed.', args);
      return { stub: true };
    },
  },
};

// Activity logging (NavigationTracker uses db.appLogs.logUserInApp). No-op for now.
const appLogs = {
  async logUserInApp() {
    return { ok: true };
  },
};

export const base44 = {
  entities,
  auth,
  functions,
  integrations,
  appLogs,
  // expose the raw supabase client for anything that needs to go lower-level
  supabase,
};

// Canonical alias for new code.
export const db = base44;

export default base44;
