import { toast } from 'sonner';
import { deliveryNote } from '@/lib/invokeResult';

/**
 * For the fire-and-forget notification that follows a write.
 *
 * These calls are deliberately not awaited — the record is already saved and the
 * button should not sit spinning on an SMS gateway. But "not awaited" had come to
 * mean "nobody is ever told", and the two are not the same thing: with no Twilio
 * from-number and no Resend key, every one of them currently sends nothing at all
 * and says nothing about it.
 *
 * This keeps the call non-blocking and still surfaces a not-sent when the promise
 * settles. It never throws and never rejects, so a caller can drop it in front of
 * an existing statement without changing that function's control flow.
 *
 *   announceDelivery(
 *     base44.functions.invoke('sendX', { id }),
 *     { saved: 'Update posted', sent: 'the alert did not go out' },
 *   );
 */
export function announceDelivery(promise, { saved, sent, duration = 8000 } = {}) {
  return Promise.resolve(promise)
    .then((res) => {
      const note = deliveryNote(res, { saved, sent });
      if (note) toast.warning(note, { duration });
      return res;
    })
    .catch((e) => {
      // invoke() does not throw, so this only catches something genuinely
      // unexpected — but a rejected floating promise is an unhandled rejection,
      // and swallowing it silently is what got us here.
      console.error('Notification failed', e);
      toast.warning(`${saved}, but ${sent} — ${e?.message || 'the request failed'}`, { duration });
      return null;
    });
}
