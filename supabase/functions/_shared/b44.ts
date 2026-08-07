// Shared helper for ported base44 Deno functions running as Supabase Edge Functions.
//
// It re-creates the exact base44 SDK surface the original functions used:
//   const base44 = createClientFromRequest(req);
//   const user   = await base44.auth.me();
//   await base44.asServiceRole.entities.<Entity>.{list,filter,get,create,update,delete,bulkCreate}(...)
//
// So porting a function is a ONE-LINE change: swap the base44 SDK import for this
// module. The rest of the function body runs unchanged.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Entity name -> Postgres table (matches src/api/base44Client.js).
const ENTITY_TABLE: Record<string, string> = {
  AlertGroup: 'alert_group', AppSettings: 'app_settings', Appointment: 'appointment',
  AppointmentLog: 'appointment_log', AppointmentSettingChecklist: 'appointment_setting_checklist',
  ChecklistV2: 'checklist_v2', Communication: 'communication', Customer: 'customer',
  CustomerProjectSettings: 'customer_project_settings', DesignMod: 'design_mod',
  EmailSettings: 'email_settings', FleetDriver: 'fleet_driver', FleetMaintenance: 'fleet_maintenance',
  FleetVehicle: 'fleet_vehicle', GHLContactCache: 'ghl_contact_cache', InspectionReport: 'inspection_report',
  Installer: 'installer', JourneyOrder: 'journey_order', Lead: 'lead', Log: 'log',
  ManualSalesContract: 'manual_sales_contract', Project: 'project', ProjectCheckpoint: 'project_checkpoint',
  ProjectCheckpointTemplate: 'project_checkpoint_template', ProjectClaim: 'project_claim',
  ProjectLog: 'project_log', Quote: 'quote', RFMSItem: 'rfms_item', RFMSOrderCache: 'rfms_order_cache',
  RFMSOrderStatus: 'rfms_order_status', RFMSRoll: 'rfms_roll', RFMSSession: 'rfms_session',
  RegionAssignment: 'region_assignment', RolePermissions: 'role_permissions', SMSSettings: 'sms_settings',
  Sale: 'sale', StandalonePreInstallChecklist: 'standalone_pre_install_checklist', Tag: 'tag',
  Task: 'task', TeamMember: 'team_member', Ticket: 'ticket', TicketLog: 'ticket_log',
  TicketMessage: 'ticket_message', TimeBlockSettings: 'time_block_settings',
};

const TS_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:?\d{2}$/;
function normalizeValue(v: unknown) {
  if (typeof v === 'string' && TS_OFFSET_RE.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return v;
}
function normalizeRow(row: any) {
  if (!row || typeof row !== 'object') return row;
  const out: any = {};
  for (const [k, val] of Object.entries(row)) out[k] = normalizeValue(val);
  return out;
}
const normalize = (data: any) => Array.isArray(data) ? data.map(normalizeRow) : normalizeRow(data);

function applyOrder(q: any, orderBy?: string) {
  if (!orderBy) return q;
  const desc = orderBy.startsWith('-');
  return q.order(desc ? orderBy.slice(1) : orderBy, { ascending: !desc });
}
function applyFilter(q: any, filters: Record<string, any>) {
  for (const [key, value] of Object.entries(filters || {})) {
    if (Array.isArray(value)) q = q.in(key, value);
    else if (value === null) q = q.is(key, null);
    else if (value && typeof value === 'object' && Object.keys(value).some((k) => k.startsWith('$'))) {
      for (const [op, val] of Object.entries(value as Record<string, any>)) {
        if (op === '$in') q = q.in(key, val);
        else if (op === '$gt') q = q.gt(key, val);
        else if (op === '$gte') q = q.gte(key, val);
        else if (op === '$lt') q = q.lt(key, val);
        else if (op === '$lte') q = q.lte(key, val);
        else if (op === '$ne') q = q.neq(key, val);
        else if (op === '$contains') q = q.contains(key, val);
        else if (op === '$ilike') q = q.ilike(key, val);
      }
    } else q = q.eq(key, value);
  }
  return q;
}
function unwrap({ data, error }: any, ctx: string) {
  if (error) throw new Error(`[b44 edge] ${ctx}: ${error.message}`);
  return normalize(data);
}

function makeEntity(service: SupabaseClient, entityName: string) {
  const table = ENTITY_TABLE[entityName];
  if (!table) throw new Error(`[b44 edge] Unknown entity "${entityName}"`);
  return {
    async list(orderBy = '-created_date', limit?: number) {
      let q = service.from(table).select('*');
      q = applyOrder(q, orderBy);
      if (limit) q = q.limit(limit);
      return unwrap(await q, `${entityName}.list`) ?? [];
    },
    async filter(filters: Record<string, any> = {}, orderBy = '-created_date', limit?: number) {
      let q = service.from(table).select('*');
      q = applyFilter(q, filters);
      q = applyOrder(q, orderBy);
      if (limit) q = q.limit(limit);
      return unwrap(await q, `${entityName}.filter`) ?? [];
    },
    async get(id: string) {
      return unwrap(await service.from(table).select('*').eq('id', id).single(), `${entityName}.get`);
    },
    async create(payload: any) {
      return unwrap(await service.from(table).insert(payload).select().single(), `${entityName}.create`);
    },
    async bulkCreate(rows: any[]) {
      return unwrap(await service.from(table).insert(rows).select(), `${entityName}.bulkCreate`) ?? [];
    },
    async update(id: string, payload: any) {
      return unwrap(await service.from(table).update(payload).eq('id', id).select().single(), `${entityName}.update`);
    },
    async delete(id: string) {
      unwrap(await service.from(table).delete().eq('id', id), `${entityName}.delete`);
      return { id };
    },
  };
}

export function createClientFromRequest(req: Request) {
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const entities = new Proxy({}, { get: (_t, name: string) => makeEntity(service, name) });

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');

  return {
    supabase: service,
    entities,                         // service-role (POC simplification)
    asServiceRole: { entities },
    auth: {
      async me() {
        if (!jwt) return null;
        const asUser = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${jwt}` } },
          auth: { persistSession: false },
        });
        const { data } = await asUser.auth.getUser();
        if (!data?.user) return null;
        const u = data.user;
        const { data: au } = await service
          .from('app_user').select('is_org_admin, team_member_id, org_id')
          .eq('id', u.id).maybeSingle();
        return {
          id: u.id,
          email: u.email,
          full_name: (u.user_metadata as any)?.full_name || u.email,
          role: au?.is_org_admin ? 'admin' : ((u.user_metadata as any)?.role || 'member'),
          team_member_id: au?.team_member_id ?? null,
          org_id: au?.org_id ?? null,
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Secret access. Integration secrets are stored in Supabase Vault and entered
// via the admin Integrations UI. Edge Functions read them here (service-role
// only, cached per invocation), falling back to Deno.env during transition.
// ---------------------------------------------------------------------------
const _secretCache = new Map<string, string | null>();
export async function getSecret(name: string): Promise<string | null> {
  if (_secretCache.has(name)) return _secretCache.get(name) ?? null;
  let value: string | null = null;
  try {
    const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data, error } = await service.rpc('get_secret', { p_name: name });
    if (!error && data) value = data as string;
  } catch (_) { /* fall through to env */ }
  if (value == null) value = Deno.env.get(name) ?? null;
  _secretCache.set(name, value);
  return value;
}

// CORS helper for browser-invoked functions.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
