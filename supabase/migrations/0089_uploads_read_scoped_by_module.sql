-- ─────────────────────────────────────────────────────────────────────────────
-- 0089 — B2's read side. Closed now rather than "with the portal", because the
--        Pillars 1&2 spec puts CSR logins ahead of the crew portal and names
--        uploads_auth_read as a slice-0 blocker for inviting setters.
--
-- Applied in three passes (0089 / 0089b / 0089c in the ledger); this file carries
-- the final policy plus what the two corrections were, because a rebuild only
-- needs the end state and the reasoning is worth keeping.
--
-- ── WHY THIS COULD NOT BE FIXED EARLIER ──────────────────────────────────────
-- The generic uploader wrote every file to
--     uploads/<YYYY-MM-DD>/<uuid>.<ext>
-- A date and nothing else. A crew photo, a recorded sales appointment and a signed
-- inspection report were indistinguishable at the path level, so the bucket could
-- only ever be all-readable or all-closed — there was no information in the key to
-- write a rule against. THAT was the blocker, not the portal.
--
-- UploadFile now takes a module prefix and writes uploads/<module>/<date>/<uuid>;
-- the crew checklists pass 'journey' and the project forms pass 'projects'.
--
-- ── THE TWO CORRECTIONS, both found by testing rather than reasoning ─────────
-- 1. The first version let anyone with can_view('communication') read legacy and
--    receipts paths, so a Design Consultant saw every receipt. The Communication
--    Hub has no file attachments at all — that module never needed the bucket.
-- 2. Removing it nearly broke Recordings: app_page shows Recordings and
--    RecordingDetail are gated on appointments/view, and recordings live under the
--    legacy date prefix. So `appointments` had to stay — but only for legacy, not
--    for receipts. Found by reading app_page rather than guessing which module
--    "sounds right".
--
-- ── ACCEPTED CONSEQUENCE, stated rather than discovered later ────────────────
-- Legacy date-prefixed checklist photos are unreadable to a journey-only account.
-- There are six files in the bucket and no crew logins exist yet, so nothing real
-- is lost — but if a crew login is created before those are re-uploaded, their old
-- photos will not render.
--
-- INSERT is unchanged: anyone authenticated may still upload. The hole was reading
-- everyone else's files, not writing your own.
--
-- Verified with representative objects for each path class:
--   org admin                     -> all four
--   Design Consultant (appts)     -> the legacy recording only
--   a login with no roles at all  -> NOTHING
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists uploads_auth_read on storage.objects;
create policy uploads_auth_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'uploads'
    and (
      public.is_org_admin()

      -- Module-prefixed paths: you may read what you may view.
      or (name like 'journey/%'        and public.can_view('journey'))
      or (name like 'projects/%'       and public.can_view('projects'))
      or (name like 'sales/%'          and public.can_view('sales'))
      or (name like 'appointments/%'   and public.can_view('appointments'))
      or (name like 'leads/%'          and public.can_view('leads'))
      or (name like 'communication/%'  and public.can_view('communication'))
      or (name like 'team/%'           and public.can_view('team'))
      or (name like 'tickets/%'        and public.can_view('tickets'))
      or (name like 'fleet/%'          and public.can_view('fleet'))

      -- Documents: inspection reports, repair PDFs, signed contracts.
      or ((name like 'receipts/%' or name like 'signatures/%')
          and (public.can_view('projects') or public.can_view('sales')
               or public.can_view('finance')))

      -- Legacy, written before prefixes existed. Includes appointment recordings,
      -- so `appointments` belongs here and ONLY here.
      or (name !~ '^[a-z_]+/'
          and (public.can_view('appointments') or public.can_view('projects')
               or public.can_view('sales') or public.can_view('finance')))
    )
  );
