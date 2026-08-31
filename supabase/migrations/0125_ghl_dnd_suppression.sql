-- Make a GoHighLevel opt-out actually stop outbound contact.
--
-- ghlWebhook was recording ContactDndUpdate to the event log and nothing more,
-- so someone who hit "do not disturb" in GHL kept receiving texts and email
-- from Razzle Dazzle. The enforcement point already exists and needs no
-- inventing: sendMessage calls is_suppressed(channel, value) before every send
-- and writes a 'suppressed' communication row instead of dispatching. All that
-- was missing was the wire from GHL into public.suppression.
--
-- WHY A SECOND REMOVAL FUNCTION RATHER THAN REUSING remove_suppression.
-- Opt-outs do not all carry the same weight. A Twilio STOP is a carrier-level
-- opt-out recorded as reason 'sms_stop'; GHL's own docs distinguish temporary
-- DND from permanent DND, where clearing the permanent kind requires proof of
-- opt-in. remove_suppression(channel, value) deletes whatever it finds, so
-- pointing it at a "DND switched off in GHL" event would silently resurrect a
-- STOP that the customer sent to the carrier -- turning a compliance control
-- off via a third-party UI toggle.
--
-- So GHL may only ever retract its OWN suppression. remove_suppression stays
-- exactly as it is, because the caller that uses it -- an inbound START/UNSTOP
-- text from the very phone that sent STOP -- genuinely should clear that STOP.
--
-- Deliberately NOT a new overload of remove_suppression: two functions of the
-- same name reachable over PostgREST is an ambiguity trap this project has been
-- bitten by before. Distinct name, distinct arity, no resolution guessing.
create or replace function public.remove_suppression_reason(
  p_channel text, p_value text, p_reason text
) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.suppression
   where channel = p_channel
     and value = public.normalize_contact(p_channel, p_value)
     and reason = p_reason;
  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.remove_suppression_reason(text, text, text) is
  'Retract a suppression THIS source created, leaving suppressions from other sources standing. Used so a GHL "DND off" cannot delete an sms_stop row recorded from a carrier-level STOP.';

revoke execute on function public.remove_suppression_reason(text, text, text) from public, anon, authenticated;
grant execute on function public.remove_suppression_reason(text, text, text) to service_role;
