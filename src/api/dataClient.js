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
  StandalonePreInstallChecklist: 'standalone_pre_install_checklist',
  Tag: 'tag',
  Task: 'task',
  TeamMember: 'team_member',
  Ticket: 'ticket',
  TicketLog: 'ticket_log',
  TicketMessage: 'ticket_message',
  TimeBlockSettings: 'time_block_settings',
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
    default:
      console.warn(`[dataClient] Unsupported filter operator "${op}" on "${key}".`);
      return q;
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
// `new Date(v + (v.includes('Z') ? '' : 'Z'))`, which breaks on the offset form.
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
  };
}

// entities proxy: db.entities.Customer -> makeEntity('Customer'), memoized.
const entityCache = {};
const entities = new Proxy(
  {},
  {
    get(_t, name) {
      if (name === 'Query') return makeEntity; // rarely used; expose factory
      if (typeof name !== 'string') return undefined;
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
  'getAppUrl',
  'logAppointmentAction',
  'shortenUrl',
  'emailDispatch',
  'pdfEmail',
  'esign',
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
  sendReceiptEmail:               (p) => ['pdfEmail', { ...p, type: 'receipt' }],
  sendInspectionReportEmail:      (p) => ['pdfEmail', { ...p, type: 'inspection' }],
  sendProjectClaimEmail:          (p) => ['pdfEmail', { ...p, type: 'claim' }],
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
  // Admin e-sign config (is_org_admin gated server-side).
  adminGetEsignTypes: () => ['admin_get_esign_types', {}],
  adminSetEsignType: (p) => ['admin_set_esign_type', {
    p_document_type: p.document_type, p_esign_enabled: p.esign_enabled ?? null, p_require_sms_otp: p.require_sms_otp ?? null,
    p_consent_text: p.consent_text ?? null, p_expiry_days: p.expiry_days ?? null, p_notify_emails: p.notify_emails ?? null,
  }],
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
      return { data: null, error: null, stub: true };
    }
    try {
      const { data, error } = await supabase.functions.invoke(name, { body: payload });
      if (error) throw error;
      return { data, error: null };
    } catch (err) {
      console.warn(`[dataClient] functions.invoke('${name}') failed — returning stub.`, err?.message || err);
      return { data: null, error: null, stub: true };
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
      const { data } = supabase.storage.from('uploads').getPublicUrl(path);
      return { file_url: data.publicUrl };
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
      console.warn('[dataClient] InvokeLLM stubbed.', args);
      return { stub: true };
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
