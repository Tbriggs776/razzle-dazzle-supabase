-- ─────────────────────────────────────────────────────────────────────────────
-- 0091 — B10's remainder: an applicant who lost their link can get it back.
--
-- Applied as 0091 + 0091b; this file carries the final function and the reason the
-- correction was needed, because the correction is the interesting part.
--
-- ── THE DESIGN QUESTION, and why it is answered this way ────────────────────
-- The obvious resume key is the ROC licence number: it is what the form is built
-- around and it uniquely identifies a contractor. It is also the WRONG key.
-- Arizona ROC licence numbers are PUBLIC RECORD and searchable, so resuming on one
-- would let anyone who looked up a competitor's licence open their in-progress
-- application and read the W-9 details, bank name and account type on it.
--
-- So the link is sent to the CONTACT EMAIL ALREADY ON THE APPLICATION, and the
-- requester only gets to say which address to try. Knowing the email is the proof.
--
-- ── NO ENUMERATION ──────────────────────────────────────────────────────────
-- The function returns an identical value whether or not an application exists.
-- An applicant who mistypes their address and a stranger probing for competitors
-- get the same answer, so this cannot be used to discover who has applied.
--
-- ⚠️ THE CORRECTION, found by testing and worth remembering: the first version
-- referenced a view that did not exist. That did not merely break the send — it
-- turned the FUNCTION ITSELF into an enumeration oracle, because an unknown email
-- returned cleanly while a known one THREW. The identical-response property was
-- defeated by an unrelated bug.
--
-- Hence the exception handler wrapping the whole lookup-and-send: the guarantee
-- now holds against bugs, not just against the happy path. Anything that fails in
-- there is swallowed deliberately.
--
-- Only DRAFT applications are resumable; once submitted there is nothing to resume
-- and the request quietly does nothing.
--
-- Verified: unknown, known and empty inputs all return {"ok": true, "sent": true};
-- exactly one send_email job is queued (for the known one); and the queued body
-- carries the real token link.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.request_installer_application_link(p_email text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare a record; v_app_url text; v_link text;
begin
  if coalesce(btrim(p_email), '') = '' then
    return jsonb_build_object('ok', true, 'sent', true);
  end if;

  -- Everything that could possibly fail lives in here. Whatever happens, the
  -- caller sees the same thing.
  begin
    select id, public_token, contact_email, contact_name
      into a
      from public.installer_application
     where lower(contact_email) = lower(btrim(p_email))
       and coalesce(status, 'draft') = 'draft'
       and public_token is not null
     order by updated_date desc nulls last
     limit 1;

    if found then
      begin
        v_app_url := public.get_secret('APP_URL');
      exception when others then
        v_app_url := null;
      end;
      v_app_url := coalesce(nullif(btrim(coalesce(v_app_url, '')), ''),
                            'https://razzle-dazzle-supabase.vercel.app');
      v_link := v_app_url || '/InstallerApply?token=' || a.public_token;

      perform public.enqueue_job('send_email', jsonb_build_object(
        'to', a.contact_email,
        'subject', 'Your Floor Daddy installer application',
        'body',
          '<p>Hi ' || coalesce(a.contact_name, 'there') || ',</p>'
          || '<p>Here is the link to pick up your installer application where you '
          || 'left off:</p>'
          || '<p><a href="' || v_link || '">Continue my application</a></p>'
          || '<p>Or copy this link: ' || v_link || '</p>'
          || '<p>- Floor Daddy Team</p>',
        'sent_by', 'System'
      ));
    end if;
  exception when others then
    -- Swallowed on purpose. A failure here must not distinguish a real applicant
    -- from a stranger probing for competitors.
    null;
  end;

  return jsonb_build_object('ok', true, 'sent', true);
end $$;

revoke all on function public.request_installer_application_link(text) from public;
-- anon: the applicant is not logged in. That is the entire scenario.
grant execute on function public.request_installer_application_link(text) to anon, authenticated, service_role;
