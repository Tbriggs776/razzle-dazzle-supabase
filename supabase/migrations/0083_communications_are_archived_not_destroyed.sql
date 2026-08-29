-- ─────────────────────────────────────────────────────────────────────────────
-- 0083 — Audit item A7. A customer conversation stops being destroyable.
--
-- CommunicationHub's delete button ran
--   Promise.all(conv.messages.map(m => Communication.delete(m.id)))
-- behind a single window.confirm. A misclick on the adjacent conversation
-- permanently destroyed every message in a real customer thread, RLS allowed it
-- for anyone with can_edit('communication'), and nothing recorded that the thread
-- had ever existed or who removed it.
--
-- That matters here beyond ordinary data loss: three months later that customer
-- files an ROC complaint, and the SMS record proving Floor Daddy followed the
-- process is the defence. It cannot be produced from a hard delete.
--
-- The fix is to make destruction impossible rather than merely discouraged:
-- DELETE is revoked outright, so no future screen can reintroduce this by
-- accident. Archiving is a soft flag applied through a gated RPC that records who
-- did it and why.
--
-- Reads exclude archived rows by default via a partial-friendly policy, so the
-- Hub behaves exactly as before for everyone; org admins can still see archived
-- threads, because "we cannot find it" and "someone archived it in March" are
-- different answers to an ROC investigator.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.communication
  add column if not exists deleted_at    timestamptz,
  add column if not exists deleted_by    text,
  add column if not exists delete_reason text;

create index if not exists communication_live_idx
  on public.communication (created_date desc)
  where deleted_at is null;

-- No route to a hard delete from the application, ever.
revoke delete on public.communication from authenticated;
drop policy if exists mod_delete on public.communication;

-- Archived rows drop out of normal reads; admins keep sight of them.
drop policy if exists mod_select on public.communication;
create policy mod_select on public.communication
  for select to authenticated
  using (
    (deleted_at is null and public.can_view('communication'))
    or public.is_org_admin()
  );

-- The archive flag is not client-writable either: it goes through the RPC below,
-- which is the only thing that records a reason.
revoke update (deleted_at, deleted_by, delete_reason) on public.communication from authenticated;

create or replace function public.archive_conversation(
  p_ids    text[],
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_actor text; v_count int;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  if not (public.is_org_admin() or public.can_edit('communication')) then
    raise exception 'Not authorized to archive a conversation';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing selected');
  end if;

  update public.communication
     set deleted_at = now(), deleted_by = v_actor, delete_reason = nullif(btrim(coalesce(p_reason,'')), ''),
         updated_date = now()
   where id = any (p_ids) and deleted_at is null;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    return jsonb_build_object('ok', true, 'archived', 0);
  end if;

  -- The archive itself is evidence. Recorded once for the whole action rather
  -- than per message, so the log reads like the thing the person actually did.
  insert into public.log (type, level, function_name, message, details)
  values ('audit', 'warn', 'archive_conversation',
          v_count || ' message(s) archived by ' || v_actor,
          jsonb_build_object('archived', v_count, 'by', v_actor,
                             'reason', nullif(btrim(coalesce(p_reason,'')), ''),
                             'communication_ids', to_jsonb(p_ids)));

  return jsonb_build_object('ok', true, 'archived', v_count);
end $$;

revoke all on function public.archive_conversation(text[], text) from public, anon;
grant execute on function public.archive_conversation(text[], text) to authenticated, service_role;

-- Undo, for the misclick this whole migration exists because of.
create or replace function public.restore_conversation(p_ids text[])
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_actor text; v_count int;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');
  if not (public.is_org_admin() or public.can_edit('communication')) then
    raise exception 'Not authorized to restore a conversation';
  end if;

  update public.communication
     set deleted_at = null, deleted_by = null, delete_reason = null, updated_date = now()
   where id = any (p_ids) and deleted_at is not null;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into public.log (type, level, function_name, message, details)
    values ('audit', 'info', 'restore_conversation',
            v_count || ' message(s) restored by ' || v_actor,
            jsonb_build_object('restored', v_count, 'by', v_actor));
  end if;

  return jsonb_build_object('ok', true, 'restored', v_count);
end $$;

revoke all on function public.restore_conversation(text[]) from public, anon;
grant execute on function public.restore_conversation(text[]) to authenticated, service_role;
