-- ─────────────────────────────────────────────────────────────────────────────
-- 0059 — Put balance collection where it actually happens.
--
-- Owner, 2026-08-28: "The sales guys have it on their process and our install
-- coordinators handle the collection before the start of install. The welcome
-- call also handles it with the Razzle Dazzle process."
--
-- Collection is a HUMAN process, owned by Install Coordination, completed BEFORE
-- install day — not a customer-messaging campaign and not a driveway
-- transaction. This matches the signed COD clause, which authorises the OFFICE
-- to charge the card on file "prior to starting the installation".
--
-- The system's job is to make that existing process visible and un-droppable.
-- The install-start gate is the backstop for when it was missed, not the
-- mechanism for collecting.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. `collect_balance` already existed but could never fire: it sat on dept
--    'finance' with stage NULL, so no stage transition ever created it, and it
--    pointed at the wrong team. Anchor it to 'scheduled' — the moment an install
--    date exists is the moment collection becomes actionable — and hand it to
--    Install Coordination.
update public.task_rule set
  dept             = 'scheduling',
  stage            = 'scheduled',
  assigned_role    = 'Install Coordinator',
  label            = 'Collect the balance before install',
  description      = 'The full remaining balance is due before this install starts. '
                     || 'Collected by Install Coordination ahead of the crew arriving — '
                     || 'the office may charge the card on file per the signed COD clause.',
  due_in_hours     = 48,
  escalate_after_hours = 24,
  escalate_to_dept = 'scheduling',
  is_active        = true,
  updated_date     = now()
where rule_key = 'collect_balance';

-- The welcome call also covers the balance, per the owner.
update public.task_rule set
  description = coalesce(description || ' ', '')
                || 'Also confirm the customer knows the remaining balance is due before install starts.',
  updated_date = now()
where rule_key = 'welcome_call';

-- 2. The COD exception permission.
--    Owner: "Only assigned users with a permission level we can set."
--    A module is the existing unit of permission (can_edit -> module permission),
--    so a new module drops straight into the Settings permission editor with no
--    new machinery.
insert into public.module (key, name, icon, sort_order, is_core, is_active)
values ('cod_exception', 'COD Exceptions', 'ShieldCheck', 145, false, true)
on conflict (key) do nothing;

insert into public.org_module_entitlement (org_id, module_key, is_enabled)
select distinct org_id, 'cod_exception', true from public.org_module_entitlement
on conflict do nothing;

-- Deliberately NO role grants seeded. Until the owner assigns this in Settings,
-- the only people who can waive a collection stop are org admins.

-- 3. Exception vocabulary for the collection gate. workflow_exception.code is
--    free text, so this is documentation rather than a constraint.
comment on column public.workflow_exception.code is
  'E1-E8 workflow defects (0053). E9_COD_UNCOLLECTED: install start reached with a balance outstanding. E10_COD_WAIVED: a cod_exception holder let an install proceed unpaid. E11_LIVE_PROJECT_ON_CANCELLED_SALE: a project is progressing against a cancelled sale, which the gate can neither pass nor block safely, so a human must look.';

-- A cancelled sale cannot be collected against, yet live projects sit on them
-- today. Surface those rather than letting the gate guess.
insert into public.workflow_exception (id, code, subject_type, subject_id, detail, severity, first_seen_at, last_seen_at)
select gen_random_uuid()::text, 'E11_LIVE_PROJECT_ON_CANCELLED_SALE', 'project', p.id,
       'Project is ' || p.status || ' but sale ' || s.id || ' is cancelled with '
         || to_char(coalesce(s.sale_amount,0), 'FM$999,999,990.00') || ' outstanding.',
       'warn', now(), now()
from public.project p
join public.sale s on s.id = p.sale
where s.is_cancelled
  and coalesce(p.status,'') <> 'Cancelled'
  and not exists (
    select 1 from public.workflow_exception w
    where w.code = 'E11_LIVE_PROJECT_ON_CANCELLED_SALE'
      and w.subject_type = 'project' and w.subject_id = p.id
      and w.resolved_at is null);
