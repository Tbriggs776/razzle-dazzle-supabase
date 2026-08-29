import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { deliveryNote } from '@/lib/invokeResult';

// Post-conversion notifications for a lead -> appointment conversion (ChecklistDetail /
// ChecklistV2Detail). Reimplements the notification subset of base44's unported
// handlePostConversion (a WRITE_STUB that threw and was swallowed by a fire-and-forget .catch,
// so conversions silently sent NONE of these). Mirrors the canonical appointment-creation flow
// in Appointments.jsx: generate lead + consultant tracking short URLs, SMS the lead (and the
// consultant when one is assigned), then email the internal team.
//
// Best-effort by design — callers invoke it fire-and-forget after the appointment is created and
// linked. Full base44 fidelity (RFMS customer/task steps) still needs the original source; these
// are the customer- and staff-facing notifications.
export async function runPostConversion({ appointmentId, hasDC }) {
  if (!appointmentId) return;

  // 1) Tracking short URLs so the SMS templates carry a short link (smsDispatch falls back to the
  //    full LeadAppointmentView/ConsultantAppointmentView URL if these aren't set).
  try {
    const appUrl = await base44.functions.invoke('getAppUrl');
    const baseUrl = appUrl?.data?.url;
    if (baseUrl) {
      // LeadAppointmentView is anon → link by the unguessable public_token (NO4).
      const appt = await base44.entities.Appointment.get(appointmentId);
      const leadKey = appt?.public_token || appointmentId;
      const [leadShort, consultantShort] = await Promise.all([
        base44.functions.invoke('shortenUrl', { originalURL: `${baseUrl}/LeadAppointmentView?id=${leadKey}` }),
        base44.functions.invoke('shortenUrl', { originalURL: `${baseUrl}/ConsultantAppointmentView?id=${appointmentId}` }),
      ]);
      const update = {};
      if (leadShort?.data?.shortURL) update.lead_short_url = leadShort.data.shortURL;
      if (consultantShort?.data?.shortURL) update.consultant_short_url = consultantShort.data.shortURL;
      if (Object.keys(update).length) await base44.entities.Appointment.update(appointmentId, update);
    }
  } catch (e) {
    console.error('Post-conversion short URLs failed:', e);
  }

  // 2) SMS the lead, and the consultant if one is assigned.
  //    The appointment is already committed by the caller and this runs non-blocking, so nothing
  //    here may throw. But SMS switched off in Settings comes back as a cheerful HTTP 200 with
  //    { skipped: 'disabled' } — say plainly that the text never went, so someone can call instead.
  try {
    const leadRes = await base44.functions.invoke('sendAppointmentSMS', { appointmentId, type: 'lead' });
    const leadNote = deliveryNote(leadRes, { saved: 'Appointment created', sent: 'the text to the customer did not go out' });
    if (leadNote) toast.warning(leadNote);

    if (hasDC) {
      const dcRes = await base44.functions.invoke('sendAppointmentSMS', { appointmentId, type: 'consultant' });
      const dcNote = deliveryNote(dcRes, { saved: 'Appointment created', sent: 'the text to the consultant did not go out' });
      if (dcNote) toast.warning(dcNote);
    }
  } catch (e) {
    console.error('Post-conversion SMS failed:', e);
  }

  // 3) Internal "appointment created" email.
  try {
    const res = await base44.functions.invoke('sendNotificationEmail', { type: 'appointment_created', entityId: appointmentId, appUrl: window.location.origin });
    const note = deliveryNote(res, { saved: 'Appointment created', sent: 'the team was not notified by email' });
    if (note) toast.warning(note);
  } catch (e) {
    console.error('Post-conversion email failed:', e);
  }
}
