// Google Calendar sync (ports base44 syncCalendarEvent off its managed OAuth connector to a
// service account). Creates/updates/deletes a calendar event for an appointment. Two modes via
// integration config: shared (default) writes to config.google_calendar_id with the team as
// attendees; impersonate (Workspace DWD, calendar_mode='impersonate') writes to the CSR's own
// calendar. A service account can't add attendees without DWD, so we retry without attendees on
// that specific rejection — the event still lands on the shared calendar.
//
// Graceful degrade: { stub: true } when google is disabled / no service-account JSON.
// Auth: internal secret OR an authenticated user.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireModules } from '../_shared/authz.ts';
import { googleContext, googleToken, svcClient, getSecret, CALENDAR_SCOPE } from '../_shared/google.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const APP_URL = Deno.env.get('APP_URL') || 'https://razzle-dazzle-supabase.vercel.app';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const START = { '9am to 11am': '09:00', '12pm to 2pm': '12:00', '3pm to 5pm': '15:00', '6pm to 8pm': '18:00' } as Record<string, string>;
const END = { '9am to 11am': '11:00', '12pm to 2pm': '14:00', '3pm to 5pm': '17:00', '6pm to 8pm': '20:00' } as Record<string, string>;

async function currentUser(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const u = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data } = await u.auth.getUser();
  return data?.user ?? null;
}

async function one(s: any, table: string, id: string | null | undefined) {
  if (!id) return null;
  const { data } = await s.from(table).select('*').eq('id', id).maybeSingle();
  return data;
}

// Create/update/delete against the Calendar API; drops attendees + retries on the SA-without-DWD
// "cannot invite attendees" rejection so shared-calendar mode still works.
async function calFetch(token: string, calendarId: string, method: string, path: string, event: any): Promise<Response> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${path}`;
  const doReq = (body: any) => fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let r = await doReq(event);
  if (!r.ok && event?.attendees) {
    const txt = await r.clone().text();
    if (/attendee|delegation|forbiddenForServiceAccounts/i.test(txt)) r = await doReq({ ...event, attendees: undefined });
  }
  return r;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const s = svcClient();
  const internal = await getSecret(s, 'CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  let user: any = null;
  if (!isInternal) {
    user = await currentUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
    // 0114 punch list: only someone who can edit appointments may touch the calendar.
    const denied = await requireModules(req, cors, ['appointments'], 'edit');
    if (denied) return denied;
  }

  try {
    const { appointmentId, action, appUrl } = await req.json();
    const ctx = await googleContext(s);
    if (!ctx) return Response.json({ stub: true, success: false }, { headers: cors });

    const appt = await one(s, 'appointment', appointmentId);
    if (!appt) return Response.json({ error: 'Appointment not found' }, { status: 404, headers: cors });

    const lead = await one(s, 'lead', appt.customer);
    const csr = appt.assigned_csr ? await one(s, 'team_member', appt.assigned_csr) : null;
    const dc = appt.assigned_dc ? await one(s, 'team_member', appt.assigned_dc) : null;

    const impersonate = ctx.config.calendar_mode === 'impersonate';
    const subject = impersonate ? (csr?.email || ctx.config.calendar_impersonate_subject || undefined) : undefined;
    let calendarId = impersonate ? (csr?.google_calendar_id || csr?.email || 'primary') : (ctx.config.google_calendar_id || 'primary');

    const dateOnly = (appt.appointment_date || '').split('T')[0];
    if (!dateOnly && action !== 'delete') return Response.json({ success: true, message: 'No appointment date set, skipping' }, { headers: cors });

    const token = await googleToken(ctx.saJson, [CALENDAR_SCOPE], subject);

    // ── Delete ────────────────────────────────────────────────────────────────────────
    if (action === 'delete') {
      if (appt.google_calendar_event_id) {
        const r = await calFetch(token, calendarId, 'DELETE', `/${appt.google_calendar_event_id}`, null);
        if (!r.ok && r.status !== 404 && r.status !== 410) return Response.json({ error: `Failed to delete: ${await r.text()}` }, { status: 500, headers: cors });
        await s.from('appointment').update({ google_calendar_event_id: null }).eq('id', appt.id);
      }
      return Response.json({ success: true, message: 'Calendar event deleted' }, { headers: cors });
    }

    // ── Build event ───────────────────────────────────────────────────────────────────
    const name = lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown';
    const parts = [`Name: ${name}`, `Phone: ${lead?.phone || 'N/A'}`, `Email: ${lead?.email || 'N/A'}`, `Address: ${appt.location_address || 'N/A'}`];
    if (appUrl || APP_URL) parts.push(`View: ${appUrl || APP_URL}/ConsultantAppointmentView?id=${appt.id}`);
    const event: any = {
      summary: `ESTIMATE - ${appt.location_address ? String(appt.location_address).split(',')[1]?.trim() || '' : ''} - ${name}`.replace(/ -  - /, ' - '),
      description: parts.join('\n'),
      location: appt.location_address || '',
      start: { dateTime: `${dateOnly}T${START[appt.appointment_block] || '09:00'}:00`, timeZone: dc?.timezone || 'America/Phoenix' },
      end: { dateTime: `${dateOnly}T${END[appt.appointment_block] || '11:00'}:00`, timeZone: dc?.timezone || 'America/Phoenix' },
    };
    const attendees = [dc?.email, csr?.email, user?.email].filter(Boolean).map((email) => ({ email }));
    if (attendees.length) event.attendees = attendees;

    // ── Create or update ────────────────────────────────────────────────────────────────
    let result: any;
    if (appt.google_calendar_event_id) {
      let r = await calFetch(token, calendarId, 'PUT', `/${appt.google_calendar_event_id}`, event);
      if (!r.ok && (r.status === 404 || r.status === 410)) {
        await s.from('appointment').update({ google_calendar_event_id: null }).eq('id', appt.id);
        r = await calFetch(token, calendarId, 'POST', '', event);
      }
      if (!r.ok) return Response.json({ error: `Failed to sync event: ${await r.text()}` }, { status: 500, headers: cors });
      result = await r.json();
    } else {
      const r = await calFetch(token, calendarId, 'POST', '', event);
      if (!r.ok) return Response.json({ error: `Failed to create event: ${await r.text()}` }, { status: 500, headers: cors });
      result = await r.json();
    }
    if (result?.id) await s.from('appointment').update({ google_calendar_event_id: result.id }).eq('id', appt.id);
    return Response.json({ success: true, eventId: result?.id, message: `Calendar event ${action}d` }, { headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message, success: false }, { status: 500, headers: cors });
  }
});
