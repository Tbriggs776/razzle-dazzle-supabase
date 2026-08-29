-- ─────────────────────────────────────────────────────────────────────────────
-- 0067c — RECOVERED 2026-08-29 from the live database.
--
-- Applied to production via MCP in an earlier session; the file was never saved,
-- so the repo could not rebuild production. Recovered by dumping
-- pg_get_functiondef(). See the process note at the bottom.
--
-- WHAT IT FIXES: an approval request could be created and reach NOBODY — the
-- department was unstaffed, or the only resolvable approver was the requester
-- themselves, who is excluded because self-approval is refused. The row sat
-- pending forever with no one able to decide it, and nothing said so.
--
-- Three properties this establishes, in order of importance:
--
--   1. NEVER ASK SOMEONE TO APPROVE THEIR OWN REQUEST. The first pass skips the
--      requester outright.
--   2. FALL BACK TO ORG ADMINS WHO ARE NOT THE REQUESTER, and say in the body WHY
--      they are receiving it — "[No eligible approver was found for finance.]" A
--      silent fallback teaches people the routing works when it does not.
--   3. RETURN `unreachable` WHEN NOBODY WAS REACHED. The caller must surface it.
--      A pending approval nobody can decide is a stall, and the requester is the
--      only person in a position to unblock it — so they have to be told at the
--      moment they ask, not discover it days later.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.request_approval(
  p_subject_type text,
  p_subject_id text,
  p_kind text,
  p_reason text,
  p_required_dept text DEFAULT NULL::text,
  p_required_role text DEFAULT NULL::text,
  p_route text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid; v_actor text; v_id text; v_owners uuid[]; v_o uuid; v_n int := 0;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'An approval request needs a reason'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  insert into public.approval (subject_type, subject_id, kind, requested_by, reason,
                               required_dept, required_role, state)
  values (p_subject_type, p_subject_id, p_kind, v_actor, p_reason,
          p_required_dept, p_required_role, 'pending')
  returning id into v_id;

  v_owners := public.resolve_owners(p_required_dept, p_required_role);
  foreach v_o in array v_owners loop
    if v_o is distinct from v_uid then   -- never ask someone to approve their own
      if public.notify(v_o, 'Approval needed: ' || p_kind, p_reason, 'approval', 'warn',
                       p_subject_type, p_subject_id, coalesce(p_route, '/Work'),
                       'approval_request', 'approval:' || v_id, true) is not null then
        v_n := v_n + 1;
      end if;
    end if;
  end loop;

  -- Second pass: org admins who are not the requester.
  if v_n = 0 then
    for v_o in select id from public.app_user
                where is_org_admin and coalesce(is_active, true) and id <> v_uid loop
      if public.notify(v_o, 'Approval needed: ' || p_kind,
                       p_reason || ' [No eligible approver was found for '
                         || coalesce(p_required_dept, p_required_role, 'this request') || '.]',
                       'approval', 'warn', p_subject_type, p_subject_id, coalesce(p_route, '/Work'),
                       'approval_request', 'approval:' || v_id, true) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true, 'approval_id', v_id, 'notified', v_n,
    -- The caller MUST surface this: a pending approval nobody can decide is a
    -- stall, and the requester is the only person able to unblock it.
    'unreachable', v_n = 0);
end $function$;

-- ── PROCESS NOTE ─────────────────────────────────────────────────────────────
-- Root cause of this file's absence: apply_migration was called without saving
-- the file in the same turn. Every apply MUST be followed by writing the file
-- before moving on.
-- ─────────────────────────────────────────────────────────────────────────────
