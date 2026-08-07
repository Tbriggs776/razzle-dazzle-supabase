// Ported from base44 logAppointmentAction.
// The ONLY change from the original: the import line (base44 SDK -> shared helper)
// + CORS handling. The body is untouched — proof the shared helper is a drop-in.
import { createClientFromRequest, corsHeaders } from '../_shared/b44.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { appointmentId, action, details } = await req.json();

    const logEntry = await base44.asServiceRole.entities.Log.create({
      type: 'appointment',
      level: 'info',
      function_name: 'logAppointmentAction',
      appointment_id: appointmentId,
      message: `Appointment ${action}${details ? ': ' + details : ''}`,
      details: { action, appointmentId, user: user.email, timestamp: new Date().toISOString() },
    });

    return Response.json({ success: true, logId: logEntry.id }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500, headers: corsHeaders });
  }
});
