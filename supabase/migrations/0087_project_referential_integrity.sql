-- ─────────────────────────────────────────────────────────────────────────────
-- 0087 — C2. `project` had NO inbound foreign keys at all, so deleting one
-- silently detached everything that referenced it. 6 of 27 project_log rows were
-- already orphaned, pointing at projects that no longer exist.
--
-- Checked before writing: project_log is the ONLY one of the six referencing
-- tables holding any data (27 rows). communication, design_mod,
-- inspection_report, project_checkpoint and project_claim are all empty, so their
-- constraints go on with no cleanup step at all.
--
-- THE ORPHANS ARE DETACHED, NOT DELETED. Every column here is nullable, so the six
-- rows keep their action, details, actor and timestamp and merely lose a pointer
-- that already pointed at nothing. Deleting audit history to satisfy a constraint
-- would be the wrong trade in a system whose ROC defence IS its audit trail.
--
-- ON DELETE is chosen per table rather than uniformly, because these rows do not
-- all mean the same thing:
--
--   CASCADE   project_checkpoint — checklist answers have no meaning whatsoever
--             without the project they describe.
--   SET NULL  project_log, communication — a record of something that happened,
--             or a message actually sent to a customer. Both stand on their own
--             and should outlive the project record.
--   RESTRICT  design_mod, inspection_report, project_claim — change orders and
--             dispute evidence. Deleting a project out from under one of these
--             should FAIL LOUDLY rather than quietly detach it, because that is
--             exactly the material a claim turns on.
--
-- CONSEQUENCE WORTH KNOWING: cancel_sale() deletes projects, so RESTRICT will now
-- block cancelling a sale whose project carries a claim or an inspection report.
-- That is intended — it is a question a human should answer, not something to do
-- silently — but it is a behaviour change and it will surface the first time
-- someone cancels a job that has been in dispute.
--
-- Verified after applying: 0 orphans, all 27 log rows still present, 6 detached
-- but intact, 6 foreign keys on project.
-- ─────────────────────────────────────────────────────────────────────────────

update public.project_log
   set project = null
 where project is not null
   and not exists (select 1 from public.project p where p.id = project_log.project);

alter table public.project_checkpoint
  drop constraint if exists project_checkpoint_project_id_fkey,
  add  constraint project_checkpoint_project_id_fkey
       foreign key (project_id) references public.project(id) on delete cascade;

alter table public.project_log
  drop constraint if exists project_log_project_fkey,
  add  constraint project_log_project_fkey
       foreign key (project) references public.project(id) on delete set null;

alter table public.communication
  drop constraint if exists communication_project_id_fkey,
  add  constraint communication_project_id_fkey
       foreign key (project_id) references public.project(id) on delete set null;

alter table public.design_mod
  drop constraint if exists design_mod_project_fkey,
  add  constraint design_mod_project_fkey
       foreign key (project) references public.project(id) on delete restrict;

alter table public.inspection_report
  drop constraint if exists inspection_report_project_fkey,
  add  constraint inspection_report_project_fkey
       foreign key (project) references public.project(id) on delete restrict;

alter table public.project_claim
  drop constraint if exists project_claim_project_fkey,
  add  constraint project_claim_project_fkey
       foreign key (project) references public.project(id) on delete restrict;

-- Every FK wants an index on the referencing side, or each delete degrades into a
-- sequential scan of the child table.
create index if not exists project_checkpoint_project_id_idx on public.project_checkpoint (project_id);
create index if not exists project_log_project_idx           on public.project_log (project);
create index if not exists communication_project_id_idx      on public.communication (project_id);
create index if not exists design_mod_project_idx            on public.design_mod (project);
create index if not exists inspection_report_project_idx     on public.inspection_report (project);
create index if not exists project_claim_project_idx         on public.project_claim (project);
