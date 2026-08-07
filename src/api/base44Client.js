/**
 * base44 -> Supabase compatibility shim.
 *
 * The original app talks to base44 through a small, consistent SDK surface:
 *   base44.entities.<Entity>.{list,filter,get,create,update,delete,bulkCreate}
 *   base44.auth.{me,logout,isAuthenticated,redirectToLogin}
 *   base44.functions.invoke(name, payload)
 *   base44.integrations.Core.{UploadFile,SendEmail,SendSMS,InvokeLLM,...}
 *
 * This module re-implements that exact surface on top of supabase-js so the
 * ~66k lines of frontend code run unchanged. Only this file (plus AuthContext)
 * had to be rewritten to swap the backend.
 */
import { supabase } from '@/lib/supabaseClient';

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
    case '$nin': return q.not(key, 'in', `(${val.join(',')})`);
    case '$gt': return q.gt(key, val);
    case '$gte': return q.gte(key, val);
    case '$lt': return q.lt(key, val);
    case '$lte': return q.lte(key, val);
    case '$ne': return q.neq(key, val);
    case '$eq': return q.eq(key, val);
    case '$contains': return q.contains(key, val);
    case '$ilike': return q.ilike(key, val);
    case '$like': return q.like(key, val);
    default:
      console.warn(`[base44 shim] Unsupported filter operator "${op}" on "${key}".`);
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
    const e = new Error(`[base44 shim] ${context}: ${error.message}`);
    e.cause = error;
    e.status = error.code;
    throw e;
  }
  return normalize(data);
}

function makeEntity(entityName) {
  const table = ENTITY_TABLE[entityName];
  if (!table) {
    throw new Error(`[base44 shim] Unknown entity "${entityName}".`);
  }
  return {
    _table: table,

    async list(orderBy = '-created_date', limit) {
      let q = supabase.from(table).select('*');
      q = applyOrder(q, orderBy);
      if (limit) q = q.limit(limit);
      return unwrap(await q, `${entityName}.list`) ?? [];
    },

    async filter(filters = {}, orderBy = '-created_date', limit) {
      let q = supabase.from(table).select('*');
      q = applyFilter(q, filters);
      q = applyOrder(q, orderBy);
      if (limit) q = q.limit(limit);
      return unwrap(await q, `${entityName}.filter`) ?? [];
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

// entities proxy: base44.entities.Customer -> makeEntity('Customer'), memoized.
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
// Auth. The POC signs in a seeded demo user so the shell + role logic runs.
// Swapping to full Supabase Auth (email magic-link / password) is a drop-in
// here: return the real supabase.auth.getUser() profile instead.
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
// Serverless functions. In the POC these are stubbed safely so pages that
// call them don't crash. Real port: each base44 Deno function -> a Supabase
// Edge Function (also Deno), invoked here via supabase.functions.invoke.
// ---------------------------------------------------------------------------
// base44 Deno functions ported to Supabase Edge Functions. Calls to a name in
// this set hit the real deployed function; every other call safely stubs until
// that function is ported — so no failing cross-origin requests in the meantime.
// Add a name here the moment its Edge Function is deployed.
const DEPLOYED_FUNCTIONS = new Set([
  'getAppUrl',
  'logAppointmentAction',
]);

const functions = {
  async invoke(name, payload = {}) {
    if (!DEPLOYED_FUNCTIONS.has(name)) {
      return { data: null, error: null, stub: true };
    }
    try {
      const { data, error } = await supabase.functions.invoke(name, { body: payload });
      if (error) throw error;
      return { data, error: null };
    } catch (err) {
      console.warn(`[base44 shim] functions.invoke('${name}') failed — returning stub.`, err?.message || err);
      return { data: null, error: null, stub: true };
    }
  },
};

// ---------------------------------------------------------------------------
// Integrations. Stubbed for the POC. UploadFile can be wired to Supabase
// Storage in one function; LLM/email/SMS map to provider SDKs.
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
      if (error) throw new Error(`[base44 shim] UploadFile: ${error.message}`);
      const { data } = supabase.storage.from('uploads').getPublicUrl(path);
      return { file_url: data.publicUrl };
    },
    async SendEmail(args) {
      console.warn('[base44 shim] SendEmail stubbed.', args);
      return { success: true, stub: true };
    },
    async SendSMS(args) {
      console.warn('[base44 shim] SendSMS stubbed.', args);
      return { success: true, stub: true };
    },
    async InvokeLLM(args) {
      console.warn('[base44 shim] InvokeLLM stubbed.', args);
      return { stub: true };
    },
    async GenerateImage(args) {
      console.warn('[base44 shim] GenerateImage stubbed.', args);
      return { url: 'stub://image', stub: true };
    },
    async ExtractDataFromUploadedFile(args) {
      console.warn('[base44 shim] ExtractDataFromUploadedFile stubbed.', args);
      return { stub: true };
    },
  },
};

// Activity logging in base44 (NavigationTracker uses base44.appLogs.logUserInApp).
// No-op in the POC; could write to a `log` table if desired.
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

export default base44;
