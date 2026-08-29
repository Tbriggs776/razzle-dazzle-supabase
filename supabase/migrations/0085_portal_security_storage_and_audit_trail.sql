-- ─────────────────────────────────────────────────────────────────────────────
-- 0085 — Audit items B1, B2 (write side) and B4. None of this matters with two
--        admin accounts; all of it matters on day one of the subcontractor portal.
--
-- ── B1: the onboarding bucket ────────────────────────────────────────────────
-- installer_onboarding_auth_read was `bucket_id = 'installer-onboarding'` AND
-- NOTHING ELSE, so any authenticated user could .list() the bucket and sign a URL
-- for any file in it. The live contents are exactly what you would fear:
--   <application-id>/w9-*.pdf          full SSN or EIN
--   <application-id>/coi-*.pdf
--   <application-id>/bond-*.pdf
--   <application-id>/roc_license-*.pdf
-- installer_application deliberately stores only the last four of the SSN. The
-- file store defeated that completely.
--
-- Note the contrast that made this obviously an oversight rather than a decision:
-- esign_auth_read_signatures, written by the same hand, IS correctly scoped to a
-- path pattern. The codebase knows how.
--
-- ── B2 (write side): the uploads bucket could be overwritten in place ────────
-- uploads_auth_update granted UPDATE across the whole bucket. An installer whose
-- subfloor damage is in dispute could replace the BYTES of a signed inspection
-- report while the path stayed identical and `owner` stayed null, and the claim
-- packet would later attach the substitute. The application never overwrites a
-- file — every upload writes a fresh path — so this policy bought nothing and is
-- dropped outright.
--
-- B2's READ side is deliberately NOT changed here; see the note at the bottom.
--
-- ── B4: the append-only logs accepted forged, backdated entries ──────────────
-- log, appointment_log, project_log and ticket_log all have INSERT CHECK(true),
-- and the client held the column grant on user_email, user_name and created_date.
-- A crew member could insert "Repair Scheduled — customer notified per SOP",
-- attributed to Alyssa, timestamped inside the four-day window, byte-identical to
-- what the real trigger writes. And nobody could remove it afterwards.
--
-- This is the same audit trail the ROC position rests on — "not financially
-- responsible as long as we follow the process" is only worth anything if the
-- record of the process cannot be authored by the person it would incriminate.
--
-- Identity and time are now stamped from the JWT by a BEFORE INSERT trigger and
-- the client cannot supply them. INSERT stays open to any authenticated user,
-- which is correct: everyone needs to be able to log what they did. What changes
-- is that they can only ever log it AS THEMSELVES, NOW.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── B1 ───────────────────────────────────────────────────────────────────────
drop policy if exists installer_onboarding_auth_read on storage.objects;
create policy installer_onboarding_auth_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'installer-onboarding'
    and (public.is_org_admin() or public.can_view('team'))
  );

-- ── B2, write side ───────────────────────────────────────────────────────────
drop policy if exists uploads_auth_update on storage.objects;

-- ── B4 ───────────────────────────────────────────────────────────────────────
create or replace function public.trg_stamp_log_identity()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_email text;
begin
  v_email := public.jwt_email();

  -- service_role and the cron worker legitimately write as 'System'. Everyone
  -- else is stamped as themselves, whatever they put in the payload.
  if v_email is not null then
    new.user_email := v_email;
    new.user_name  := coalesce(
      (select nullif(btrim(coalesce(tm.first_name,'') || ' ' || coalesce(tm.last_name,'')), '')
         from public.team_member tm where lower(tm.email) = lower(v_email) limit 1),
      v_email);
  else
    new.user_email := coalesce(new.user_email, 'system');
    new.user_name  := coalesce(new.user_name, 'System');
  end if;

  -- Backdating is the whole attack: an entry timestamped inside the escalation
  -- window is what makes a forged trail useful.
  new.created_date := now();

  return new;
end $$;

drop trigger if exists stamp_log_identity on public.appointment_log;
create trigger stamp_log_identity before insert on public.appointment_log
  for each row execute function public.trg_stamp_log_identity();

drop trigger if exists stamp_log_identity on public.project_log;
create trigger stamp_log_identity before insert on public.project_log
  for each row execute function public.trg_stamp_log_identity();

drop trigger if exists stamp_log_identity on public.ticket_log;
create trigger stamp_log_identity before insert on public.ticket_log
  for each row execute function public.trg_stamp_log_identity();

-- `log` has a different shape (no user_email/user_name) — created_date is the
-- only forgeable field on it.
create or replace function public.trg_stamp_log_created()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  new.created_date := now();
  return new;
end $$;

drop trigger if exists stamp_log_created on public.log;
create trigger stamp_log_created before insert on public.log
  for each row execute function public.trg_stamp_log_created();

-- Belt as well as braces: revoke the column grants so the values cannot even be
-- offered. Table-level INSERT is revoked first and granted back per column,
-- because a column-level revoke against a table-level grant is a silent no-op —
-- the lesson from 0079/0083, applied up front this time instead of after a test
-- caught it.
do $$
declare t text; v_cols text;
begin
  foreach t in array array['appointment_log', 'project_log', 'ticket_log'] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into v_cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t
       and column_name not in ('user_email', 'user_name', 'created_date');
    if v_cols is null then
      raise exception 'refusing to proceed: no grantable columns resolved for %', t;
    end if;
    execute format('revoke insert on public.%I from authenticated', t);
    execute format('grant insert (%s) on public.%I to authenticated', v_cols, t);
  end loop;
end $$;

-- ── B2, READ side — deliberately deferred, with the reason ───────────────────
-- uploads_auth_read still grants SELECT across the whole bucket, so every login
-- can read every recorded sales appointment and every receipt. That is real, and
-- it is NOT fixed here.
--
-- Scoping it correctly means mapping each path prefix to a module and gating on
-- can_view(). The live bucket holds only six files across two prefixes
-- (receipts/, signatures/), which is nowhere near enough to derive that mapping,
-- and the subcontractor portal — the thing that determines what a crew member
-- must be able to see — is designed but not built. Guessing now would either
-- break staff reads today or invent a rule the portal then contradicts.
--
-- The write side, which is the tampering vector, IS closed above. The read side
-- must be scoped as part of building the portal, before the first crew login is
-- issued, and while the portal's own file requirements are actually known.
-- ─────────────────────────────────────────────────────────────────────────────
