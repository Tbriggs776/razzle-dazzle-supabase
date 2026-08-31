-- ─────────────────────────────────────────────────────────────────────────────
-- 0116 — Playbooks (spec: razzle-playbooks). The capture loop: someone does the
-- work, drops a Loom + steps into a draft, a manager publishes a VERSION and
-- pins it to a job stage and/or a page, publishing assigns it to everyone with
-- the target role, the person reads it next to the screen and taps "I follow
-- this" — that timestamped ack against a specific version IS the training
-- record. A new version invalidates prior acks and opens a recertify task.
--
-- Not Trainual: no quizzes, no SCORM, no certificates, no video hosting, no
-- in-app recorder. Loom/Scribe URLs only.
--
-- ── HANGS OFF WHAT EXISTS ───────────────────────────────────────────────────
-- role.key targets SOPs · user_role insert fires enrollment · the existing
-- `task` table carries training_due / training_recertify (no second task
-- system) · app_page pins the Help drawer · org_id fences every row.
--
-- ⚠️ ONE DELIBERATE DEVIATION from the spec: task rows use
-- subject_type='training_assignment' with subject_id = the assignment id, not
-- subject_type='sop'. The task table's partial unique indexes (uq_task_rule,
-- task_rule_subject_open_uq) are (rule_key, subject_type, subject_id) over
-- open tasks — with subject_type='sop' and subject_id = the sop id, TWO PEOPLE
-- owing the same SOP would collide on the index and the second enrollment
-- would fail. The assignment id is unique per (person, sop, version), which is
-- exactly the grain a personal training task has.
--
-- ── WRITE PATH ──────────────────────────────────────────────────────────────
-- Tables carry SELECT policies only. Every write goes through the SECURITY
-- DEFINER RPCs below, each of which starts with a real module check — so a
-- client cannot PostgREST-insert an ack for a version they never read, and the
-- crew/inactive classes excluded by 0114 stay excluded here.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.sop (
  id              text primary key default (gen_random_uuid())::text,
  org_id          text not null references public.organization(id),
  key             text not null,
  title           text not null,
  body_md         text not null default '',
  current_version int  not null default 0,          -- 0 = never published
  job_stage       text,                             -- 0069 stage keys; checker flags orphans later
  app_page_key    text references public.app_page(key),
  module_key      text references public.module(key),
  target_role_keys text[] not null default '{}',
  is_required     boolean not null default true,
  is_published    boolean not null default false,
  owner_user_id   uuid references public.app_user(id),
  location_id     text,                             -- stays null until a location table exists
  created_date    timestamptz not null default now(),
  updated_date    timestamptz not null default now(),
  unique (org_id, key)
);

create table if not exists public.sop_version (
  id           text primary key default (gen_random_uuid())::text,
  sop_id       text not null references public.sop(id) on delete cascade,
  version      int  not null,
  body_md      text not null,
  loom_url     text,
  published_by uuid references public.app_user(id),
  published_at timestamptz not null default now(),
  unique (sop_id, version)
);

create table if not exists public.sop_capture (
  id              text primary key default (gen_random_uuid())::text,
  org_id          text not null references public.organization(id),
  sop_id          text references public.sop(id) on delete set null,
  captured_by     uuid not null references public.app_user(id),
  loom_url        text,
  notes_md        text,
  source_page_key text,
  source_job_id   text,
  status          text not null default 'submitted'
                  check (status in ('submitted','accepted','rejected','published')),
  reviewed_by     uuid references public.app_user(id),
  reviewed_at     timestamptz,
  created_date    timestamptz not null default now()
);

create table if not exists public.course (
  id            text primary key default (gen_random_uuid())::text,
  org_id        text not null references public.organization(id),
  key           text not null,
  title         text not null,
  role_key      text not null,
  kind          text not null default 'onboarding' check (kind in ('onboarding','recert','ad_hoc')),
  is_active     boolean not null default true,
  manager_signoff_required boolean not null default true,
  created_date  timestamptz not null default now(),
  unique (org_id, key)
);

create table if not exists public.course_lesson (
  id         text primary key default (gen_random_uuid())::text,
  course_id  text not null references public.course(id) on delete cascade,
  sop_id     text not null references public.sop(id) on delete cascade,
  sort_order int not null,
  unique (course_id, sop_id),
  unique (course_id, sort_order)
);

create table if not exists public.training_assignment (
  id               text primary key default (gen_random_uuid())::text,
  org_id           text not null references public.organization(id),
  app_user_id      uuid not null references public.app_user(id) on delete cascade,
  sop_id           text not null references public.sop(id) on delete cascade,
  course_id        text references public.course(id) on delete set null,
  due_at           timestamptz,
  status           text not null default 'open' check (status in ('open','acked','overdue','waived')),
  required_version int not null,
  waived_by        uuid references public.app_user(id),
  waived_reason    text,
  created_date     timestamptz not null default now(),
  updated_date     timestamptz not null default now(),
  unique (app_user_id, sop_id, required_version)
);

create table if not exists public.training_ack (
  id            text primary key default (gen_random_uuid())::text,
  assignment_id text not null references public.training_assignment(id) on delete cascade,
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  sop_id        text not null references public.sop(id) on delete cascade,
  sop_version   int not null,
  acked_at      timestamptz not null default now(),
  ack_text      text not null,
  unique (app_user_id, sop_id, sop_version)
);

create table if not exists public.course_enrollment (
  id                text primary key default (gen_random_uuid())::text,
  org_id            text not null references public.organization(id),
  app_user_id       uuid not null references public.app_user(id) on delete cascade,
  course_id         text not null references public.course(id) on delete cascade,
  status            text not null default 'in_progress' check (status in ('in_progress','complete','waived')),
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  manager_user_id   uuid references public.app_user(id),
  manager_signed_at timestamptz,
  unique (app_user_id, course_id)
);

create index if not exists sop_page_idx on public.sop (app_page_key) where is_published;
create index if not exists sop_stage_idx on public.sop (job_stage) where is_published;
create index if not exists ta_user_open_idx on public.training_assignment (app_user_id) where status in ('open','overdue');
create index if not exists ta_sop_idx on public.training_assignment (sop_id);
create index if not exists capture_status_idx on public.sop_capture (status);

-- ── RLS: SELECT only; writes are RPC-only ───────────────────────────────────

alter table public.sop enable row level security;
alter table public.sop_version enable row level security;
alter table public.sop_capture enable row level security;
alter table public.course enable row level security;
alter table public.course_lesson enable row level security;
alter table public.training_assignment enable row level security;
alter table public.training_ack enable row level security;
alter table public.course_enrollment enable row level security;

-- Published SOPs and versions: anyone who can see the module (they must ack).
-- Drafts: editors only.
drop policy if exists sop_read on public.sop;
create policy sop_read on public.sop for select to authenticated
  using (public.can_view('playbooks') and (is_published or public.can_edit('playbooks')));
drop policy if exists sop_version_read on public.sop_version;
create policy sop_version_read on public.sop_version for select to authenticated
  using (public.can_view('playbooks'));
drop policy if exists course_read on public.course;
create policy course_read on public.course for select to authenticated
  using (public.can_view('playbooks'));
drop policy if exists course_lesson_read on public.course_lesson;
create policy course_lesson_read on public.course_lesson for select to authenticated
  using (public.can_view('playbooks'));

-- Captures: yours, or an editor's review queue.
drop policy if exists sop_capture_read on public.sop_capture;
create policy sop_capture_read on public.sop_capture for select to authenticated
  using (public.can_edit('playbooks')
         or captured_by = (select auth.uid()));

-- Assignments / acks / enrollments: your own, or an editor overseeing training.
drop policy if exists ta_read on public.training_assignment;
create policy ta_read on public.training_assignment for select to authenticated
  using (app_user_id = (select auth.uid()) or public.can_edit('playbooks'));
drop policy if exists ack_read on public.training_ack;
create policy ack_read on public.training_ack for select to authenticated
  using (app_user_id = (select auth.uid()) or public.can_edit('playbooks'));
drop policy if exists enroll_read on public.course_enrollment;
create policy enroll_read on public.course_enrollment for select to authenticated
  using (app_user_id = (select auth.uid()) or public.can_edit('playbooks'));

-- ── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public.playbooks_org()
returns text language sql stable security definer set search_path to 'public'
as $$ select org_id from public.app_user where id = (select auth.uid()) and is_active; $$;

-- One open personal training task per assignment. subject_type deviates from
-- the spec on purpose — see the header.
create or replace function public.open_training_task(
  p_assignment public.training_assignment, p_rule text, p_title text
) returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  -- Existence check, NOT ON CONFLICT: the task table has TWO overlapping
  -- partial unique indexes over open rows (uq_task_rule and
  -- task_rule_subject_open_uq) with different predicates. An ON CONFLICT can
  -- only arbitrate one of them — a duplicate would still raise on the other —
  -- and 0111 already documented how a weaker inference predicate 42P10s.
  if exists (select 1 from public.task
              where rule_key = p_rule and subject_type = 'training_assignment'
                and subject_id = p_assignment.id and completed_at is null) then
    return;
  end if;
  insert into public.task (subject_type, subject_id, rule_key, state, status, type,
                           assigned_user, due_at, due_date, source, created_reason, notes)
  values ('training_assignment', p_assignment.id, p_rule, 'open', 'pending', 'training',
          p_assignment.app_user_id, p_assignment.due_at, p_assignment.due_at::date,
          'playbooks', jsonb_build_object('title', p_title), p_title);
end $$;

create or replace function public.close_training_tasks(p_assignment_id text)
returns void language sql security definer set search_path to 'public'
as $$
  update public.task set completed_at = now(), state = 'done', status = 'completed', updated_date = now()
   where subject_type = 'training_assignment' and subject_id = p_assignment_id and completed_at is null;
$$;

-- ── RPCs ────────────────────────────────────────────────────────────────────

-- Any staff member who can SEE playbooks can capture. That is the whole product:
-- the person doing the work records it in the moment.
create or replace function public.submit_sop_capture(
  p_loom_url text, p_notes_md text, p_source_page_key text default null,
  p_source_job_id text default null, p_sop_id text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_org text; v_id text;
begin
  if not public.can_view('playbooks') then raise exception 'Not authorized'; end if;
  if nullif(btrim(coalesce(p_loom_url,'')),'') is null and nullif(btrim(coalesce(p_notes_md,'')),'') is null then
    raise exception 'A capture needs a recording link or notes';
  end if;
  if p_loom_url is not null and p_loom_url !~* '^https://' then
    raise exception 'Recording links must be https URLs';
  end if;
  v_org := public.playbooks_org();
  insert into public.sop_capture (org_id, sop_id, captured_by, loom_url, notes_md, source_page_key, source_job_id)
  values (v_org, p_sop_id, (select auth.uid()), p_loom_url, p_notes_md, p_source_page_key, p_source_job_id)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'capture_id', v_id);
end $$;

-- Manager reviews a capture. Accepting with no sop_id creates a DRAFT shell so
-- the content lands somewhere editable; publishing still goes through
-- publish_sop and its version machinery.
create or replace function public.review_sop_capture(
  p_capture_id text, p_status text, p_sop_id text default null,
  p_new_sop_key text default null, p_new_sop_title text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_cap public.sop_capture; v_sop text; v_org text;
begin
  if not public.can_edit('playbooks') then raise exception 'Not authorized'; end if;
  if p_status not in ('accepted','rejected') then raise exception 'Status must be accepted or rejected'; end if;
  select * into v_cap from public.sop_capture where id = p_capture_id;
  if not found then raise exception 'No such capture'; end if;
  v_org := public.playbooks_org();

  v_sop := coalesce(p_sop_id, v_cap.sop_id);
  if p_status = 'accepted' and v_sop is null then
    if p_new_sop_key is null or p_new_sop_title is null then
      raise exception 'Accepting into a new SOP needs a key and a title';
    end if;
    insert into public.sop (org_id, key, title, body_md)
    values (v_org, p_new_sop_key, p_new_sop_title, coalesce(v_cap.notes_md, ''))
    returning id into v_sop;
  end if;

  update public.sop_capture
     set status = p_status, sop_id = coalesce(v_sop, sop_id),
         reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_capture_id;
  return jsonb_build_object('ok', true, 'sop_id', v_sop);
end $$;

create or replace function public.create_sop(
  p_key text, p_title text, p_body_md text default '',
  p_job_stage text default null, p_app_page_key text default null,
  p_target_role_keys text[] default '{}'
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_id text;
begin
  if not public.can_edit('playbooks') then raise exception 'Not authorized'; end if;
  if p_key !~ '^[a-z][a-z0-9_.]+$' then raise exception 'Keys look like csr.book_from_checklist'; end if;
  insert into public.sop (org_id, key, title, body_md, job_stage, app_page_key, target_role_keys)
  values (public.playbooks_org(), p_key, p_title, coalesce(p_body_md,''), p_job_stage, p_app_page_key,
          coalesce(p_target_role_keys, '{}'))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'sop_id', v_id);
end $$;

-- Publish: insert an immutable version, bump the SOP, (re)open assignments for
-- everyone holding a target role, recertify people who had signed the previous
-- version, and mark contributing captures published. Version rows are never
-- updated — a signature stays attached to exactly what was signed.
create or replace function public.publish_sop(
  p_sop_id text, p_body_md text, p_loom_url text default null,
  p_target_role_keys text[] default null, p_job_stage text default null,
  p_app_page_key text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_sop public.sop; v_new int; v_targets text[]; v_u record; v_a public.training_assignment;
  v_had_prior boolean; v_title text;
begin
  if not public.can_edit('playbooks') then raise exception 'Not authorized'; end if;
  select * into v_sop from public.sop where id = p_sop_id;
  if not found then raise exception 'No such SOP'; end if;
  if nullif(btrim(coalesce(p_body_md,'')),'') is null then
    raise exception 'Publishing an empty SOP would assign people a blank page to sign';
  end if;
  if p_loom_url is not null and p_loom_url !~* '^https://' then
    raise exception 'Recording links must be https URLs';
  end if;

  v_targets := coalesce(p_target_role_keys, v_sop.target_role_keys, '{}');
  -- Target keys must be real roles: a typo here would silently train nobody.
  if exists (select 1 from unnest(v_targets) t
             where not exists (select 1 from public.role r where r.key = t and r.org_id = v_sop.org_id)) then
    raise exception 'target_role_keys contains a key that is not a role';
  end if;

  v_new := v_sop.current_version + 1;
  insert into public.sop_version (sop_id, version, body_md, loom_url, published_by)
  values (p_sop_id, v_new, p_body_md, p_loom_url, (select auth.uid()));

  update public.sop
     set body_md = p_body_md, current_version = v_new, is_published = true,
         target_role_keys = v_targets,
         job_stage = coalesce(p_job_stage, job_stage),
         app_page_key = coalesce(p_app_page_key, app_page_key),
         updated_date = now()
   where id = p_sop_id
   returning * into v_sop;

  v_title := 'Read & sign: ' || v_sop.title || ' (v' || v_new || ')';

  -- Everyone holding any target role.
  for v_u in
    select distinct au.id as app_user_id
      from public.app_user au
      join public.user_role ur on ur.user_id = au.id
      join public.role r on r.id = ur.role_id
     where au.is_active and r.key = any (v_targets)
  loop
    v_had_prior := exists (select 1 from public.training_ack a
                            where a.app_user_id = v_u.app_user_id and a.sop_id = p_sop_id);

    -- An open assignment at an older version is re-pointed at the new one; an
    -- acked person gets a fresh row (their old signature stays on the old
    -- version) with the shorter recertify clock.
    update public.training_assignment
       set required_version = v_new, status = 'open',
           due_at = now() + interval '7 days', updated_date = now()
     where app_user_id = v_u.app_user_id and sop_id = p_sop_id
       and status in ('open','overdue') and required_version < v_new;

    insert into public.training_assignment (org_id, app_user_id, sop_id, due_at, required_version)
    values (v_sop.org_id, v_u.app_user_id, p_sop_id,
            now() + (case when v_had_prior then interval '3 days' else interval '7 days' end), v_new)
    on conflict (app_user_id, sop_id, required_version) do nothing;

    select * into v_a from public.training_assignment
     where app_user_id = v_u.app_user_id and sop_id = p_sop_id and required_version = v_new;
    if v_a.status in ('open','overdue') then
      perform public.open_training_task(
        v_a,
        case when v_had_prior then 'training_recertify' else 'training_due' end,
        case when v_had_prior then 'Recertify: ' || v_sop.title || ' changed (v' || v_new || ')' else v_title end);
    end if;
  end loop;

  update public.sop_capture set status = 'published', reviewed_at = coalesce(reviewed_at, now())
   where sop_id = p_sop_id and status = 'accepted';

  return jsonb_build_object('ok', true, 'version', v_new);
end $$;

-- The signature. Self only, current version only, through an open assignment.
create or replace function public.ack_sop(p_sop_id text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_me uuid; v_sop public.sop; v_a public.training_assignment; v_text text; v_enr record;
begin
  if not public.can_view('playbooks') then raise exception 'Not authorized'; end if;
  v_me := (select auth.uid());
  select * into v_sop from public.sop where id = p_sop_id and is_published;
  if not found then raise exception 'No such published SOP'; end if;

  select * into v_a from public.training_assignment
   where app_user_id = v_me and sop_id = p_sop_id
     and required_version = v_sop.current_version and status in ('open','overdue');
  if not found then
    raise exception 'No open assignment for the current version — it may have been re-published since you opened it';
  end if;

  v_text := 'I have read SOP ' || v_sop.key || ' v' || v_sop.current_version || ' and I will follow it.';
  insert into public.training_ack (assignment_id, app_user_id, sop_id, sop_version, ack_text)
  values (v_a.id, v_me, p_sop_id, v_sop.current_version, v_text);

  update public.training_assignment set status = 'acked', updated_date = now() where id = v_a.id;
  perform public.close_training_tasks(v_a.id);

  -- A course whose every lesson is now acked at current version completes —
  -- unless it still needs the manager's signature.
  for v_enr in
    select ce.* from public.course_enrollment ce
     join public.course c on c.id = ce.course_id
     join public.course_lesson cl on cl.course_id = c.id and cl.sop_id = p_sop_id
    where ce.app_user_id = v_me and ce.status = 'in_progress'
  loop
    if not exists (
      select 1 from public.course_lesson cl
      join public.sop s on s.id = cl.sop_id
      where cl.course_id = v_enr.course_id and s.is_published
        and not exists (select 1 from public.training_ack a
                         where a.app_user_id = v_me and a.sop_id = s.id
                           and a.sop_version = s.current_version)
    ) then
      update public.course_enrollment
         set status = case when (select manager_signoff_required from public.course where id = v_enr.course_id)
                            and manager_signed_at is null then 'in_progress' else 'complete' end,
             completed_at = case when (select manager_signoff_required from public.course where id = v_enr.course_id)
                                  and manager_signed_at is null then null else now() end
       where id = v_enr.id;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'ack_text', v_text, 'version', v_sop.current_version);
end $$;

-- Fired by the user_role trigger and callable by editors for backfill.
create or replace function public.enroll_user_in_role_courses(p_app_user_id uuid, p_role_key text)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_org text; v_c record; v_s record; v_a public.training_assignment;
begin
  select org_id into v_org from public.app_user where id = p_app_user_id;
  if v_org is null then return; end if;

  for v_c in select * from public.course
              where org_id = v_org and role_key = p_role_key and kind = 'onboarding' and is_active
  loop
    insert into public.course_enrollment (org_id, app_user_id, course_id)
    values (v_org, p_app_user_id, v_c.id)
    on conflict (app_user_id, course_id) do nothing;
  end loop;

  -- Every published required SOP targeting this role opens an assignment.
  for v_s in select * from public.sop
              where org_id = v_org and is_published and is_required
                and p_role_key = any (target_role_keys)
  loop
    insert into public.training_assignment (org_id, app_user_id, sop_id, due_at, required_version)
    values (v_org, p_app_user_id, v_s.id, now() + interval '7 days', v_s.current_version)
    on conflict (app_user_id, sop_id, required_version) do nothing;

    select * into v_a from public.training_assignment
     where app_user_id = p_app_user_id and sop_id = v_s.id and required_version = v_s.current_version;
    if v_a.status in ('open','overdue') then
      perform public.open_training_task(v_a, 'training_due',
        'Read & sign: ' || v_s.title || ' (v' || v_s.current_version || ')');
    end if;
  end loop;
end $$;

create or replace function public.trg_user_role_enroll()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_key text;
begin
  select key into v_key from public.role where id = new.role_id;
  if v_key is not null then
    perform public.enroll_user_in_role_courses(new.user_id, v_key);
  end if;
  return new;
end $$;

drop trigger if exists user_role_enroll on public.user_role;
create trigger user_role_enroll after insert on public.user_role
  for each row execute function public.trg_user_role_enroll();

-- Manager sign-off: an editor who is NOT the trainee.
create or replace function public.signoff_course(p_enrollment_id text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_me uuid; v_e public.course_enrollment; v_missing int;
begin
  if not public.can_edit('playbooks') then raise exception 'Not authorized'; end if;
  v_me := (select auth.uid());
  select * into v_e from public.course_enrollment where id = p_enrollment_id;
  if not found then raise exception 'No such enrollment'; end if;
  if v_e.app_user_id = v_me then raise exception 'You cannot sign off your own onboarding'; end if;

  select count(*) into v_missing
    from public.course_lesson cl join public.sop s on s.id = cl.sop_id
   where cl.course_id = v_e.course_id and s.is_published
     and not exists (select 1 from public.training_ack a
                      where a.app_user_id = v_e.app_user_id and a.sop_id = s.id
                        and a.sop_version = s.current_version);
  if v_missing > 0 then
    return jsonb_build_object('ok', false,
      'reason', v_missing || ' lesson(s) are not signed at the current version yet');
  end if;

  update public.course_enrollment
     set manager_user_id = v_me, manager_signed_at = now(),
         status = 'complete', completed_at = now()
   where id = p_enrollment_id;
  return jsonb_build_object('ok', true);
end $$;

-- Waive: an editor, with a reason on the record. Not a self-serve skip.
create or replace function public.waive_assignment(p_assignment_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_a public.training_assignment;
begin
  if not public.can_edit('playbooks') then raise exception 'Not authorized'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'A waiver needs a reason';
  end if;
  select * into v_a from public.training_assignment where id = p_assignment_id;
  if not found then raise exception 'No such assignment'; end if;
  update public.training_assignment
     set status = 'waived', waived_by = (select auth.uid()),
         waived_reason = btrim(p_reason), updated_date = now()
   where id = p_assignment_id;
  perform public.close_training_tasks(p_assignment_id);
  return jsonb_build_object('ok', true);
end $$;

-- One call for the My Training page: open items + course progress.
create or replace function public.my_training()
returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object(
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', ta.id, 'sop_id', s.id, 'sop_key', s.key, 'title', s.title,
        'version', ta.required_version, 'status', ta.status, 'due_at', ta.due_at,
        'app_page_key', s.app_page_key, 'job_stage', s.job_stage, 'course_id', ta.course_id
      ) order by ta.due_at nulls last)
      from public.training_assignment ta join public.sop s on s.id = ta.sop_id
      where ta.app_user_id = (select auth.uid()) and ta.status in ('open','overdue')
    ), '[]'::jsonb),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'enrollment_id', ce.id, 'course_id', c.id, 'title', c.title, 'status', ce.status,
        'manager_signed_at', ce.manager_signed_at,
        'manager_signoff_required', c.manager_signoff_required,
        'total', (select count(*) from public.course_lesson cl
                   join public.sop s on s.id = cl.sop_id
                  where cl.course_id = c.id and s.is_published),
        'done', (select count(*) from public.course_lesson cl
                  join public.sop s on s.id = cl.sop_id
                 where cl.course_id = c.id and s.is_published
                   and exists (select 1 from public.training_ack a
                                where a.app_user_id = ce.app_user_id
                                  and a.sop_id = s.id and a.sop_version = s.current_version))
      ))
      from public.course_enrollment ce join public.course c on c.id = ce.course_id
      where ce.app_user_id = (select auth.uid())
    ), '[]'::jsonb)
  );
$$;

-- ── Grants: authenticated only, and each RPC re-checks its module ───────────
revoke all on function public.playbooks_org() from public, anon;
revoke all on function public.open_training_task(public.training_assignment, text, text) from public, anon, authenticated;
revoke all on function public.close_training_tasks(text) from public, anon, authenticated;
revoke all on function public.submit_sop_capture(text, text, text, text, text) from public, anon;
revoke all on function public.review_sop_capture(text, text, text, text, text) from public, anon;
revoke all on function public.create_sop(text, text, text, text, text, text[]) from public, anon;
revoke all on function public.publish_sop(text, text, text, text[], text, text) from public, anon;
revoke all on function public.ack_sop(text) from public, anon;
revoke all on function public.enroll_user_in_role_courses(uuid, text) from public, anon;
revoke all on function public.trg_user_role_enroll() from public, anon;
revoke all on function public.signoff_course(text) from public, anon;
revoke all on function public.waive_assignment(text, text) from public, anon;
revoke all on function public.my_training() from public, anon;
grant execute on function public.playbooks_org() to authenticated, service_role;
grant execute on function public.submit_sop_capture(text, text, text, text, text) to authenticated, service_role;
grant execute on function public.review_sop_capture(text, text, text, text, text) to authenticated, service_role;
grant execute on function public.create_sop(text, text, text, text, text, text[]) to authenticated, service_role;
grant execute on function public.publish_sop(text, text, text, text[], text, text) to authenticated, service_role;
grant execute on function public.ack_sop(text) to authenticated, service_role;
grant execute on function public.enroll_user_in_role_courses(uuid, text) to authenticated, service_role;
grant execute on function public.signoff_course(text) to authenticated, service_role;
grant execute on function public.waive_assignment(text, text) to authenticated, service_role;
grant execute on function public.my_training() to authenticated, service_role;
grant execute on function public.open_training_task(public.training_assignment, text, text) to service_role;
grant execute on function public.close_training_tasks(text) to service_role;
