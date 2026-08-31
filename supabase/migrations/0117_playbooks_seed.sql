-- ─────────────────────────────────────────────────────────────────────────────
-- 0117 — Playbooks seed. The module, its entitlement and grants, the four
-- pages, six onboarding courses, and nineteen SOP SHELLS keyed to the spine
-- and pinned to real pages (every app_page_key checked against app_page).
--
-- The shells are is_published = false with empty bodies ON PURPOSE: the spec
-- draws a hard line — ops writes the SOPs, engineering ships the rails.
-- Nothing is assigned to anybody until a manager publishes a shell with a
-- real body, at which point the publish machinery (0116) opens the
-- assignments and the training_due tasks by itself.
--
-- Grants: every staff role gets VIEW because everyone must be able to read
-- and ack; sales_manager / operations / project_manager get EDIT (publish,
-- assign, sign off); the admin role gets admin. Crew logins hold no role and
-- therefore see none of it.
-- ─────────────────────────────────────────────────────────────────────────────

do $seed$
declare v_org text;
begin
  select id into v_org from public.organization order by created_date asc limit 1;

  -- Module + entitlement. Named Playbooks, not Training, per spec.
  insert into public.module (key, name, icon, sort_order, is_core, is_active)
  values ('playbooks', 'Playbooks', 'BookOpen', 155, false, true)
  on conflict (key) do nothing;
  insert into public.org_module_entitlement (org_id, module_key, is_enabled)
  values (v_org, 'playbooks', true)
  on conflict (org_id, module_key) do update set is_enabled = true;

  -- Grants: every staff role can VIEW (they must be able to ack); publishing
  -- and assigning is edit for the four manager roles; admin only for admin.
  insert into public.role_module_permission (role_id, module_key, permission)
  select r.id, 'playbooks',
         case when r.key = 'admin' then 'admin'
              when r.key in ('sales_manager','operations','project_manager') then 'edit'
              else 'view' end
    from public.role r where r.org_id = v_org
  on conflict (role_id, module_key) do update set permission = excluded.permission;

  -- Pages. TrainingAdmin needs edit to be useful; the guard model reads
  -- min_permission through my_access.
  insert into public.app_page (key, module_key, label, route_path, is_public, min_permission) values
    ('Playbooks',     'playbooks', 'Playbooks',      '/Playbooks',     false, 'view'),
    ('PlaybookDetail','playbooks', 'Playbook Detail','/PlaybookDetail',false, 'view'),
    ('MyTraining',    'playbooks', 'My Training',    '/MyTraining',    false, 'view'),
    ('TrainingAdmin', 'playbooks', 'Training Admin', '/TrainingAdmin', false, 'edit')
  on conflict (key) do nothing;

  -- Courses: the onboarding spine per role. Content people fill the bodies;
  -- engineering ships the rails. All shells are is_published=false, so nothing
  -- is assigned to anyone until a manager publishes with a real body.
  insert into public.course (org_id, key, title, role_key, kind) values
    (v_org, 'onboard.customer_service_rep', 'CSR onboarding',              'customer_service_rep', 'onboarding'),
    (v_org, 'onboard.design_consultant',    'Design Consultant onboarding','design_consultant',    'onboarding'),
    (v_org, 'onboard.order_processor',      'Order Processor onboarding',  'order_processor',      'onboarding'),
    (v_org, 'onboard.project_manager',      'Project / field onboarding',  'project_manager',      'onboarding'),
    (v_org, 'onboard.operations',           'Operations onboarding',       'operations',           'onboarding'),
    (v_org, 'onboard.customer_experience',  'Customer Experience onboarding','customer_experience','onboarding')
  on conflict (org_id, key) do nothing;

  -- SOP shells, keyed to the spine and pinned to real pages so Help is useful
  -- on day one. Every app_page_key below verified against app_page.
  insert into public.sop (org_id, key, title, job_stage, app_page_key, target_role_keys) values
    (v_org, 'csr.speed_to_lead',       'Speed to lead: the five-minute dial', 'lead_working', 'LeadQueue',            '{customer_service_rep}'),
    (v_org, 'csr.book_checklist_v2',   'Booking through Checklist 2.0',       'booked',       'ChecklistV2Detail',    '{customer_service_rep}'),
    (v_org, 'csr.confirmation',        'Confirmation and customer_confirmed_at', 'booked',    'Appointments',         '{customer_service_rep}'),
    (v_org, 'csr.communication_hub',   'The Communication Hub: SMS vs email', null,           'CommunicationHub',     '{customer_service_rep,customer_experience}'),
    (v_org, 'csr.dispositions',        'Closing out a lead: the dispositions', 'lead_working','LeadQueue',            '{customer_service_rep}'),
    (v_org, 'dc.consultant_view',      'Running the appointment from the consultant view', 'appt_on_site', null,      '{design_consultant}'),
    (v_org, 'dc.outcomes',             'The seven outcomes, same day, every day', 'appt_on_site', 'MyAppointments',   '{design_consultant}'),
    (v_org, 'dc.convert_to_sale',      'Converting the sale before leaving the driveway', 'sold_capture', null,       '{design_consultant}'),
    (v_org, 'dc.design_mods',          'Design modifications',                null,           'ManualDesignMods',     '{design_consultant}'),
    (v_org, 'dc.no_self_approve_qa',   'What a consultant must never do: self-approve field QA', 'qa', null,          '{design_consultant}'),
    (v_org, 'op.order_entry',          'Order entry: to_order to material_ordered', 'to_order', 'OrderProcessing',    '{order_processor}'),
    (v_org, 'op.rfms_material_only',   'RFMS is material, not truth',         null,           'RFMSCustomers',        '{order_processor}'),
    (v_org, 'op.contract_discrepancy', 'Contract vs RFMS discrepancies',      null,           'ContractDiscrepancy',  '{order_processor}'),
    (v_org, 'field.region_assignment', 'Region assignment',                   null,           'Journey',              '{project_manager,operations}'),
    (v_org, 'field.crew_assign',       'Work orders and assigning the crew',  'crew_assigned','Journey',              '{project_manager,operations}'),
    (v_org, 'field.pre_install',       'Pre-install',                         'scheduled',    null,                   '{project_manager,operations}'),
    (v_org, 'field.walkthrough_qa',    'Walkthrough and QA: the crew never signs its own work', 'qa', 'JourneyProjectDetail', '{project_manager,operations}'),
    (v_org, 'cx.warranty_active',      'The warranty record',                 'warranty_active', null,                '{customer_experience}'),
    (v_org, 'cx.claim_clocks',         'Claim clocks: acknowledge 1bd, schedule 3bd, cure 10bd', null, 'ClaimsDashboard', '{customer_experience}')
  on conflict (org_id, key) do nothing;

  -- Lessons: ordered lists of those shells.
  insert into public.course_lesson (course_id, sop_id, sort_order)
  select c.id, s.id, x.ord
  from (values
    ('onboard.customer_service_rep', 'csr.speed_to_lead',       10),
    ('onboard.customer_service_rep', 'csr.book_checklist_v2',   20),
    ('onboard.customer_service_rep', 'csr.confirmation',        30),
    ('onboard.customer_service_rep', 'csr.communication_hub',   40),
    ('onboard.customer_service_rep', 'csr.dispositions',        50),
    ('onboard.design_consultant',    'dc.consultant_view',      10),
    ('onboard.design_consultant',    'dc.outcomes',             20),
    ('onboard.design_consultant',    'dc.convert_to_sale',      30),
    ('onboard.design_consultant',    'dc.design_mods',          40),
    ('onboard.design_consultant',    'dc.no_self_approve_qa',   50),
    ('onboard.order_processor',      'op.order_entry',          10),
    ('onboard.order_processor',      'op.rfms_material_only',   20),
    ('onboard.order_processor',      'op.contract_discrepancy', 30),
    ('onboard.project_manager',      'field.region_assignment', 10),
    ('onboard.project_manager',      'field.crew_assign',       20),
    ('onboard.project_manager',      'field.pre_install',       30),
    ('onboard.project_manager',      'field.walkthrough_qa',    40),
    ('onboard.operations',           'field.region_assignment', 10),
    ('onboard.operations',           'field.crew_assign',       20),
    ('onboard.operations',           'field.pre_install',       30),
    ('onboard.operations',           'field.walkthrough_qa',    40),
    ('onboard.customer_experience',  'cx.warranty_active',      10),
    ('onboard.customer_experience',  'cx.claim_clocks',         20),
    ('onboard.customer_experience',  'csr.communication_hub',   30)
  ) as x(course_key, sop_key, ord)
  join public.course c on c.org_id = v_org and c.key = x.course_key
  join public.sop s on s.org_id = v_org and s.key = x.sop_key
  on conflict (course_id, sop_id) do nothing;
end $seed$;
