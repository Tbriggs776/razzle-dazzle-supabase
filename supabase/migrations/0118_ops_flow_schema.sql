-- ─────────────────────────────────────────────────────────────────────────────
-- 0118 — Ops Flow: the published stage graph, its checker, and the proposal inbox.
-- Implements razzle-ops-flow-spec.md (schema + RPCs). Seed and the job_stage
-- cutover are 0119 — split so this file is pure DDL and the seed can be
-- re-derived without re-touching functions.
--
-- WHAT THIS IS. The company's stage graph (labels, owners, SLAs, edges) moves
-- from src/lib/ops/flow.js constants into data, published in immutable
-- versions. The classifier's PREDICATES — what data means a job is in a stage —
-- stay exactly where they are: the CASE in the job_stage view, one copy, SQL.
-- Editing the chart cannot move a job. Data closes tasks; tasks never close
-- stages; publishing never touches a job row.
--
-- WRITE PATH. Tables are SELECT-only under RLS. Every write goes through a
-- SECURITY DEFINER RPC that begins with is_org_admin(). The bot (opsFlowAdvise,
-- separate deploy) only ever INSERTs proposals via service role — it cannot
-- publish, and nothing here auto-applies anything.
--
-- GRAPH DOCUMENT (ops_flow_version.graph):
--   { "departments": [{key,label,sort_order}],
--     "stages": [{key,label,blurb,owner_dept,sla_hours,sort_order,is_terminal,
--                 tone,classifier_key}],
--     "edges": [{from,to,sort_order}] }
--
-- SPEC DEVIATION, stated plainly: the spec writes `classifier_key text not
-- null` and, two lines later, "new nodes without a classifier_key are
-- planning-only". Both cannot hold; nullable wins because planning-only nodes
-- are a required feature (Done-when #4). NULL classifier_key = sketch node:
-- drawn dashed, no job ever lands there, the checker files it as unbound_node.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tables ───────────────────────────────────────────────────────────────────

create table public.ops_flow (
  id              text primary key default gen_random_uuid()::text,
  org_id          text not null unique,
  current_version int  not null default 1,
  published_at    timestamptz,
  published_by    uuid references public.app_user(id)
);

create table public.ops_flow_version (
  id           text primary key default gen_random_uuid()::text,
  flow_id      text not null references public.ops_flow(id) on delete cascade,
  version      int  not null,
  graph        jsonb not null,
  note         text,
  published_by uuid references public.app_user(id),
  published_at timestamptz not null default now(),
  unique (flow_id, version)
);
comment on table public.ops_flow_version is
  'Immutable published snapshots. Never UPDATE a row here; a revert publishes a copy of an old graph as a NEW version.';

create table public.ops_department (
  org_id     text not null,
  key        text not null,
  label      text not null,
  sort_order int  not null default 0,
  primary key (org_id, key)
);

create table public.ops_stage (
  org_id         text not null,
  key            text not null,
  label          text not null,
  blurb          text,
  owner_dept     text,
  sla_hours      int,
  sort_order     int  not null default 0,
  is_terminal    boolean not null default false,
  tone           text,
  -- Which PREDICATE in the job_stage view this node binds to. NULL = planning-
  -- only. The UI cannot invent predicates: publish_ops_flow() rejects any value
  -- outside ops_classifier_keys(), and requires every predicate to stay bound.
  classifier_key text,
  primary key (org_id, key),
  unique (org_id, classifier_key)
);
comment on column public.ops_stage.sla_hours is
  'CLOCK hours, not business hours (2-day SLA = 48). v1 deliberately has no business-hours calendar; revisit when one exists.';

create table public.ops_edge (
  org_id     text not null,
  from_key   text not null,
  to_key     text not null,
  sort_order int  not null default 0,
  primary key (org_id, from_key, to_key)
);
comment on table public.ops_edge is
  'The chart''s arrows. Documentation + checker input only — the classifier derives stage from data, never from edges.';

create table public.ops_change_proposal (
  id                text primary key default gen_random_uuid()::text,
  org_id            text not null,
  source            text not null check (source in ('checker','bot','human')),
  kind              text not null check (kind in
    ('sla_mismatch','orphan_rule','orphan_sop','missing_owner','missing_edge',
     'dead_end','dept_missing','unbound_node','add_stage','clone_role',
     'new_task_rule','disable_rule','other')),
  severity          text not null default 'info' check (severity in ('info','warn','crit')),
  title             text not null,
  body_md           text,
  payload           jsonb,
  status            text not null default 'open'
                    check (status in ('open','accepted','rejected','applied','superseded')),
  flow_version_from int,
  flow_version_to   int,
  created_date      timestamptz not null default now(),
  resolved_by       uuid references public.app_user(id),
  resolved_at       timestamptz,
  resolve_note      text
);
create index ops_change_proposal_open_idx
  on public.ops_change_proposal (org_id, created_date desc) where status = 'open';

create table public.ops_flow_audit (
  id           text primary key default gen_random_uuid()::text,
  org_id       text not null,
  actor        uuid,
  action       text not null,
  detail       jsonb,
  created_date timestamptz not null default now()
);
comment on table public.ops_flow_audit is 'Append-only. Who published/reverted/resolved what. No update/delete policies on purpose.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Published graph: readable by any active staff member (every board needs it —
-- job_stage joins ops_stage, and JobFlow/InstallTeam/OrderingTeam all render
-- from it). Proposals + audit: org admin only. NO write policies anywhere.

alter table public.ops_flow            enable row level security;
alter table public.ops_flow_version    enable row level security;
alter table public.ops_department      enable row level security;
alter table public.ops_stage           enable row level security;
alter table public.ops_edge            enable row level security;
alter table public.ops_change_proposal enable row level security;
alter table public.ops_flow_audit      enable row level security;

create policy ops_flow_read       on public.ops_flow            for select using (public.is_active_staff());
create policy ops_flow_ver_read   on public.ops_flow_version    for select using (public.is_active_staff());
create policy ops_dept_read       on public.ops_department      for select using (public.is_active_staff());
create policy ops_stage_read      on public.ops_stage           for select using (public.is_active_staff());
create policy ops_edge_read       on public.ops_edge            for select using (public.is_active_staff());
create policy ops_proposal_read   on public.ops_change_proposal for select using (public.is_org_admin());
create policy ops_audit_read      on public.ops_flow_audit      for select using (public.is_org_admin());

revoke all on public.ops_flow, public.ops_flow_version, public.ops_department,
              public.ops_stage, public.ops_edge, public.ops_change_proposal,
              public.ops_flow_audit from anon;
grant select on public.ops_flow, public.ops_flow_version, public.ops_department,
                public.ops_stage, public.ops_edge, public.ops_change_proposal,
                public.ops_flow_audit to authenticated;

-- ── The one list of predicates ───────────────────────────────────────────────
-- These are the keys the job_stage CASE can emit, and therefore the only legal
-- classifier_key values. Adding a predicate is an ENGINEERING act: extend the
-- view's CASE and this list in the same migration. The UI can never do it.

create or replace function public.ops_classifier_keys()
returns text[] language sql immutable
as $$ select array['to_order','awaiting_material','ready_to_schedule','scheduled',
                   'in_progress','qa','cx_followup','complete'] $$;

-- ── Checker ──────────────────────────────────────────────────────────────────
-- The plant talking. Pure read: run on publish (findings become proposals) and
-- from the editor's Check button (dry run, writes nothing). Not AI.

create or replace function public.check_ops_flow(p_graph jsonb)
returns table (kind text, severity text, title text, body_md text, payload jsonb)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_stage_keys      text[];  -- every node key
  v_classifier_keys text[];  -- the bound predicates
  v_dept_keys       text[];
begin
  if not public.is_org_admin() then
    raise exception 'Only an org admin may run the flow checker';
  end if;

  select coalesce(array_agg(s->>'key'), '{}') into v_stage_keys
    from jsonb_array_elements(coalesce(p_graph->'stages','[]'::jsonb)) s;
  select coalesce(array_agg(s->>'classifier_key'), '{}') into v_classifier_keys
    from jsonb_array_elements(coalesce(p_graph->'stages','[]'::jsonb)) s
   where s->>'classifier_key' is not null;
  select coalesce(array_agg(d->>'key'), '{}') into v_dept_keys
    from jsonb_array_elements(coalesce(p_graph->'departments','[]'::jsonb)) d;

  -- sla_mismatch: an active task_rule clocks a stage at a number that disagrees
  -- with the published SLA by more than 10%. Payload is the structured patch an
  -- admin can apply from the proposal inbox.
  return query
  select 'sla_mismatch'::text, 'warn'::text,
         'Rule ' || tr.rule_key || ' clocks ' || tr.stage || ' at ' || tr.due_in_hours
           || 'h; the published SLA is ' || (s.j->>'sla_hours') || 'h',
         'task_rule.due_in_hours and ops_stage.sla_hours disagree by more than 10%. '
           || 'Accepting aligns the rule to the published number.',
         jsonb_build_object('task_rule', jsonb_build_object(
           'rule_key', tr.rule_key, 'due_in_hours', (s.j->>'sla_hours')::int))
    from public.task_rule tr
    join lateral (
      select st as j from jsonb_array_elements(coalesce(p_graph->'stages','[]'::jsonb)) st
       where st->>'classifier_key' = tr.stage
    ) s on true
   where tr.is_active and tr.due_in_hours is not null
     and (s.j->>'sla_hours') is not null
     and abs(tr.due_in_hours - (s.j->>'sla_hours')::int) > 0.1 * (s.j->>'sla_hours')::int;

  -- orphan_rule: a rule fires on a stage no live node is bound to.
  return query
  select 'orphan_rule'::text, 'warn'::text,
         'Rule ' || tr.rule_key || ' targets stage "' || tr.stage || '" which is not in the graph',
         'The reconciler fires this rule on a classifier stage the published graph no longer names. '
           || 'Either the graph lost the node or the rule is stale.',
         jsonb_build_object('rule_key', tr.rule_key, 'stage', tr.stage)
    from public.task_rule tr
   where tr.is_active and tr.stage is not null
     and tr.stage <> all (v_classifier_keys);

  return query
  select 'orphan_rule'::text, 'warn'::text,
         'Comms rule ' || cr.rule_key || ' targets stage "' || cr.stage || '" which is not in the graph',
         'A customer-message rule points at a stage the graph does not name.',
         jsonb_build_object('comms_rule_key', cr.rule_key, 'stage', cr.stage)
    from public.comms_rule cr
   where cr.stage is not null and cr.stage <> all (v_classifier_keys);

  -- orphan_sop: a playbook pinned to a job stage the graph does not run.
  -- Guarded so this file stands alone if the playbooks tables are absent
  -- (playbooks ships on its own branch; plpgsql resolves the table at first
  -- execution of the guarded path, never at create time).
  if to_regclass('public.sop') is not null then
    return query
    select 'orphan_sop'::text, 'info'::text,
           'Playbook ' || sp.key || ' is pinned to stage "' || sp.job_stage || '" which is not in the graph',
           'The SOP names a stage jobs can never sit in. Usually an OPERATING_MODEL stage '
             || 'engineering has not bound a predicate for yet.',
           jsonb_build_object('sop_key', sp.key, 'job_stage', sp.job_stage)
      from public.sop sp
     where sp.job_stage is not null
       and sp.job_stage <> all (v_stage_keys);
  end if;

  -- missing_owner: node owned by a department the graph does not define.
  return query
  select 'missing_owner'::text, 'crit'::text,
         'Stage ' || (st->>'key') || ' is owned by unknown department "' || (st->>'owner_dept') || '"',
         'Every board groups by owner; an unknown department makes the stage unroutable.',
         jsonb_build_object('stage', st->>'key', 'owner_dept', st->>'owner_dept')
    from jsonb_array_elements(coalesce(p_graph->'stages','[]'::jsonb)) st
   where st->>'owner_dept' is not null
     and (st->>'owner_dept') <> all (v_dept_keys);

  -- missing_edge: non-terminal node with no way out drawn.
  return query
  select 'missing_edge'::text, 'warn'::text,
         'Stage ' || (st->>'key') || ' has no outbound edge and is not terminal',
         'The chart shows work entering this stage and never leaving.',
         jsonb_build_object('stage', st->>'key')
    from jsonb_array_elements(coalesce(p_graph->'stages','[]'::jsonb)) st
   where not coalesce((st->>'is_terminal')::boolean, false)
     and not exists (
       select 1 from jsonb_array_elements(coalesce(p_graph->'edges','[]'::jsonb)) e
        where e->>'from' = st->>'key');

  -- dead_end: a LIVE node from which no drawn path reaches any terminal node.
  -- This is the hard stop — publish_ops_flow refuses outright, no acknowledge.
  return query
  with recursive reach as (
    -- walk BACKWARD from terminals; anything not visited cannot reach one
    select st->>'key' as k
      from jsonb_array_elements(coalesce(p_graph->'stages','[]'::jsonb)) st
     where coalesce((st->>'is_terminal')::boolean, false)
    union
    select e->>'from'
      from jsonb_array_elements(coalesce(p_graph->'edges','[]'::jsonb)) e
      join reach r on e->>'to' = r.k
  )
  select 'dead_end'::text, 'crit'::text,
         'Live stage ' || (st->>'key') || ' has no path to any terminal stage',
         'Jobs classified here would be stuck on the chart forever. Publishing this graph is blocked.',
         jsonb_build_object('stage', st->>'key')
    from jsonb_array_elements(coalesce(p_graph->'stages','[]'::jsonb)) st
   where st->>'classifier_key' is not null
     and not coalesce((st->>'is_terminal')::boolean, false)
     and (st->>'key') not in (select k from reach);

  -- dept_missing (spec's name): a rule assigns a role that is not a role.key.
  return query
  select 'dept_missing'::text, 'warn'::text,
         'Rule ' || tr.rule_key || ' assigns role "' || tr.assigned_role || '" which is not a role key',
         'resolve_owners() will find nobody; the task lands unassigned.',
         jsonb_build_object('rule_key', tr.rule_key, 'assigned_role', tr.assigned_role)
    from public.task_rule tr
   where tr.is_active and tr.assigned_role is not null
     and not exists (select 1 from public.role r where r.key = tr.assigned_role);

  -- unbound_node: a sketch. Info only — this is the FEATURE, not a defect.
  return query
  select 'unbound_node'::text, 'info'::text,
         'Stage ' || (st->>'key') || ' is planning-only (no classifier bound)',
         'Drawn dashed; jobs never land here until engineering binds a predicate.',
         jsonb_build_object('stage', st->>'key')
    from jsonb_array_elements(coalesce(p_graph->'stages','[]'::jsonb)) st
   where st->>'classifier_key' is null;
end $$;

-- ── Rebuild (internal) ───────────────────────────────────────────────────────
-- Wholesale replace of the relational mirror from a graph document. Called by
-- publish_ops_flow and by the 0119 seed. Never exposed to clients.

create or replace function public.ops_rebuild_from_graph(p_org text, p_graph jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  delete from public.ops_edge       where org_id = p_org;
  delete from public.ops_stage      where org_id = p_org;
  delete from public.ops_department where org_id = p_org;

  insert into public.ops_department (org_id, key, label, sort_order)
  select p_org, d->>'key', d->>'label', coalesce((d->>'sort_order')::int, 0)
    from jsonb_array_elements(coalesce(p_graph->'departments','[]'::jsonb)) d;

  insert into public.ops_stage
    (org_id, key, label, blurb, owner_dept, sla_hours, sort_order, is_terminal, tone, classifier_key)
  select p_org, s->>'key', s->>'label', s->>'blurb', s->>'owner_dept',
         (s->>'sla_hours')::int, coalesce((s->>'sort_order')::int, 0),
         coalesce((s->>'is_terminal')::boolean, false), s->>'tone', s->>'classifier_key'
    from jsonb_array_elements(coalesce(p_graph->'stages','[]'::jsonb)) s;

  insert into public.ops_edge (org_id, from_key, to_key, sort_order)
  select p_org, e->>'from', e->>'to', coalesce((e->>'sort_order')::int, 0)
    from jsonb_array_elements(coalesce(p_graph->'edges','[]'::jsonb)) e;
end $$;

-- ── Publish ──────────────────────────────────────────────────────────────────

create or replace function public.publish_ops_flow(
  p_graph jsonb, p_note text, p_acknowledge_crit boolean default false
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_org text; v_flow public.ops_flow%rowtype; v_version int;
  v_bad text; v_n int; v_findings int := 0; v_crit int := 0; v_dead int := 0;
begin
  if not public.is_org_admin() then
    raise exception 'Only an org admin may publish the flow';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'A publish note is required';
  end if;

  select org_id into v_org from public.app_user where id = auth.uid();
  if v_org is null then raise exception 'No org for caller'; end if;

  -- Structural validation. Everything here is a hard error, not a finding:
  -- a graph that fails these cannot be rendered, let alone argued with.
  if jsonb_array_length(coalesce(p_graph->'stages','[]'::jsonb)) = 0 then
    raise exception 'Graph has no stages';
  end if;
  select s->>'key' into v_bad
    from jsonb_array_elements(p_graph->'stages') s
   group by 1 having count(*) > 1 limit 1;
  if v_bad is not null then raise exception 'Duplicate stage key %', v_bad; end if;

  -- The UI cannot invent a predicate…
  select s->>'classifier_key' into v_bad
    from jsonb_array_elements(p_graph->'stages') s
   where s->>'classifier_key' is not null
     and (s->>'classifier_key') <> all (public.ops_classifier_keys())
   limit 1;
  if v_bad is not null then
    raise exception 'Unknown classifier_key "%" — predicates are bound by engineering, not the editor', v_bad;
  end if;
  -- …cannot bind one twice…
  select s->>'classifier_key' into v_bad
    from jsonb_array_elements(p_graph->'stages') s
   where s->>'classifier_key' is not null
   group by 1 having count(*) > 1 limit 1;
  if v_bad is not null then raise exception 'classifier_key "%" is bound to two stages', v_bad; end if;
  -- …and cannot orphan one. Every predicate the view can emit must keep an
  -- identity row, or jobs classified there vanish from every board.
  select count(*) into v_n
    from unnest(public.ops_classifier_keys()) ck
   where not exists (
     select 1 from jsonb_array_elements(p_graph->'stages') s
      where s->>'classifier_key' = ck);
  if v_n > 0 then
    raise exception '% classifier predicate(s) left unbound — every predicate must keep a stage', v_n;
  end if;

  select count(*) into v_n
    from jsonb_array_elements(coalesce(p_graph->'edges','[]'::jsonb)) e
   where e->>'from' not in (select s->>'key' from jsonb_array_elements(p_graph->'stages') s)
      or e->>'to'   not in (select s->>'key' from jsonb_array_elements(p_graph->'stages') s);
  if v_n > 0 then raise exception '% edge(s) reference unknown stage keys', v_n; end if;

  -- Checker verdict. dead_end blocks outright; other crits need the checkbox.
  select count(*),
         count(*) filter (where c.severity = 'crit'),
         count(*) filter (where c.kind = 'dead_end')
    into v_findings, v_crit, v_dead
    from public.check_ops_flow(p_graph) c;
  if v_dead > 0 then
    raise exception 'Publish blocked: a live stage has no path to a terminal stage (dead_end)';
  end if;
  if v_crit > 0 and not p_acknowledge_crit then
    raise exception 'Publish blocked: % critical finding(s) — acknowledge to publish anyway', v_crit;
  end if;

  -- Version + rebuild.
  select * into v_flow from public.ops_flow where org_id = v_org for update;
  if v_flow.id is null then
    insert into public.ops_flow (org_id, current_version, published_at, published_by)
    values (v_org, 1, now(), auth.uid()) returning * into v_flow;
    v_version := 1;
  else
    v_version := v_flow.current_version + 1;
    update public.ops_flow
       set current_version = v_version, published_at = now(), published_by = auth.uid()
     where id = v_flow.id;
  end if;

  insert into public.ops_flow_version (flow_id, version, graph, note, published_by)
  values (v_flow.id, v_version, p_graph, btrim(p_note), auth.uid());

  perform public.ops_rebuild_from_graph(v_org, p_graph);

  -- Fresh findings replace last publish's unresolved ones — a stale checker
  -- row about a graph that no longer exists is noise, not signal.
  update public.ops_change_proposal
     set status = 'superseded', resolved_at = now()
   where org_id = v_org and source = 'checker' and status = 'open';

  insert into public.ops_change_proposal
    (org_id, source, kind, severity, title, body_md, payload, flow_version_from)
  select v_org, 'checker', c.kind, c.severity, c.title, c.body_md, c.payload, v_version
    from public.check_ops_flow(p_graph) c;

  insert into public.ops_flow_audit (org_id, actor, action, detail)
  values (v_org, auth.uid(), 'publish',
          jsonb_build_object('version', v_version, 'note', btrim(p_note),
                             'findings', v_findings, 'crit', v_crit,
                             'acknowledged_crit', p_acknowledge_crit));

  return jsonb_build_object('version', v_version, 'findings', v_findings, 'crit', v_crit);
end $$;

-- ── Revert ───────────────────────────────────────────────────────────────────
-- History is never rewritten: reverting to N publishes a COPY of N's graph as
-- the next version.

create or replace function public.revert_ops_flow(p_version int, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_org text; v_graph jsonb; v_out jsonb;
begin
  if not public.is_org_admin() then
    raise exception 'Only an org admin may revert the flow';
  end if;
  select org_id into v_org from public.app_user where id = auth.uid();

  select fv.graph into v_graph
    from public.ops_flow_version fv
    join public.ops_flow f on f.id = fv.flow_id
   where f.org_id = v_org and fv.version = p_version;
  if v_graph is null then raise exception 'No published version % to revert to', p_version; end if;

  -- A graph that was legal to publish stays legal; acknowledge_crit=true so a
  -- known-warned historical graph does not need its checkbox re-ticking.
  -- dead_end still hard-stops inside publish_ops_flow.
  v_out := public.publish_ops_flow(
    v_graph, coalesce(nullif(btrim(coalesce(p_note,'')),''), 'Revert to v' || p_version), true);

  insert into public.ops_flow_audit (org_id, actor, action, detail)
  values (v_org, auth.uid(), 'revert',
          jsonb_build_object('to_version', p_version, 'as_version', v_out->'version'));
  return v_out;
end $$;

-- ── Resolve a proposal ───────────────────────────────────────────────────────
-- Accept applies ONLY the structured payloads this function knows:
--   {task_rule:{rule_key,due_in_hours}}  → update the rule       (status: applied)
--   kind=add_stage {add_stage:{...}}     → publish current graph + one
--                                          planning-only node    (status: applied)
-- Anything else Accept merely marks accepted — the change happens out of band
-- (clone_role goes through userAdmin, new predicates through engineering).
-- Applying a payload never publishes a flow version EXCEPT add_stage, which by
-- construction adds an unbound node no job can land on.

create or replace function public.resolve_ops_proposal(
  p_id text, p_action text, p_note text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_org text; v_p public.ops_change_proposal%rowtype;
  v_status text; v_graph jsonb; v_node jsonb; v_out jsonb;
begin
  if not public.is_org_admin() then
    raise exception 'Only an org admin may resolve proposals';
  end if;
  if p_action not in ('accept','reject') then
    raise exception 'Action must be accept or reject';
  end if;
  select org_id into v_org from public.app_user where id = auth.uid();

  select * into v_p from public.ops_change_proposal
   where id = p_id and org_id = v_org for update;
  if v_p.id is null then raise exception 'No such proposal'; end if;
  if v_p.status <> 'open' then raise exception 'Proposal is already %', v_p.status; end if;

  if p_action = 'reject' then
    v_status := 'rejected';
  elsif v_p.payload ? 'task_rule'
        and v_p.payload->'task_rule'->>'rule_key' is not null
        and (v_p.payload->'task_rule'->>'due_in_hours') is not null then
    update public.task_rule
       set due_in_hours = (v_p.payload->'task_rule'->>'due_in_hours')::int
     where rule_key = v_p.payload->'task_rule'->>'rule_key';
    if not found then raise exception 'Payload names a rule that does not exist'; end if;
    v_status := 'applied';
  elsif v_p.kind = 'add_stage' and v_p.payload ? 'add_stage' then
    v_node := v_p.payload->'add_stage';
    if nullif(btrim(coalesce(v_node->>'key','')),'') is null then
      raise exception 'add_stage payload has no key';
    end if;
    select fv.graph into v_graph
      from public.ops_flow f
      join public.ops_flow_version fv on fv.flow_id = f.id and fv.version = f.current_version
     where f.org_id = v_org;
    if v_graph is null then raise exception 'No published flow to add a stage to'; end if;
    if exists (select 1 from jsonb_array_elements(v_graph->'stages') s
                where s->>'key' = v_node->>'key') then
      raise exception 'Stage key % already exists', v_node->>'key';
    end if;
    -- Planning-only BY CONSTRUCTION: classifier_key is stripped, whatever the
    -- payload claimed. The bot cannot smuggle a live node through Accept.
    v_graph := jsonb_set(v_graph, '{stages}',
      (v_graph->'stages') || jsonb_build_array(
        (v_node - 'classifier_key')
          || jsonb_build_object(
               'sort_order', coalesce((v_node->>'sort_order')::int, 999),
               'is_terminal', false)));
    v_out := public.publish_ops_flow(
      v_graph, 'Accepted proposal: ' || v_p.title, true);
    v_status := 'applied';
  else
    v_status := 'accepted';
  end if;

  update public.ops_change_proposal
     set status = v_status, resolved_by = auth.uid(), resolved_at = now(),
         resolve_note = p_note,
         flow_version_to = coalesce((v_out->>'version')::int, flow_version_to)
   where id = p_id;

  insert into public.ops_flow_audit (org_id, actor, action, detail)
  values (v_org, auth.uid(), 'resolve_proposal',
          jsonb_build_object('proposal', p_id, 'kind', v_p.kind, 'action', p_action,
                             'result', v_status, 'note', p_note));

  return jsonb_build_object('status', v_status,
                            'published_version', v_out->'version');
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke all on function public.ops_classifier_keys() from public, anon;
revoke all on function public.check_ops_flow(jsonb) from public, anon;
revoke all on function public.ops_rebuild_from_graph(text, jsonb) from public, anon, authenticated;
revoke all on function public.publish_ops_flow(jsonb, text, boolean) from public, anon;
revoke all on function public.revert_ops_flow(int, text) from public, anon;
revoke all on function public.resolve_ops_proposal(text, text, text) from public, anon;

grant execute on function public.ops_classifier_keys() to authenticated, service_role;
grant execute on function public.check_ops_flow(jsonb) to authenticated, service_role;
grant execute on function public.ops_rebuild_from_graph(text, jsonb) to service_role;
grant execute on function public.publish_ops_flow(jsonb, text, boolean) to authenticated, service_role;
grant execute on function public.revert_ops_flow(int, text) to authenticated, service_role;
grant execute on function public.resolve_ops_proposal(text, text, text) to authenticated, service_role;
