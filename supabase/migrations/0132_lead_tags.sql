-- Tags on leads, in two kinds.
--
-- Follows the convention already in the codebase: appointment.tags and
-- project.tags are jsonb arrays of tag ids, driven by TagSelector/TagManager.
-- lead.tags is the same shape, so the existing components work on leads with no
-- new UI.
--
-- MANUAL VERSUS DERIVED, AND WHY IT MATTERS. "Hot Lead" is a judgement a person
-- makes. "Never Replied" is a fact about the record. Storing them the same way
-- is fine; MAINTAINING them the same way is not. A derived tag applied by hand
-- goes stale the moment the customer replies, and a stale "Never Replied" on a
-- customer who did reply is worse than no tag at all -- it is a wrong answer
-- delivered confidently.
--
-- So tags carry is_derived. recompute_lead_tags() owns the derived ones and
-- recomputes them from the corpus; it never adds, removes or reorders a manual
-- tag. Both kinds live in the same lead.tags array, so a person sees one list.
--
-- THE HONESTY PROBLEM THIS HAD TO SOLVE. Only a fraction of conversations have
-- had their message history pulled. Marking the rest "Never Replied" would be
-- reporting our own backlog as a fact about the customer -- the single most
-- misleading thing this feature could do. So:
--
--   Replied          proven: an inbound message exists, OR the conversation's
--                    last message came inbound (true even before history is
--                    pulled, because direction is on the thread summary).
--   Never Replied    only when every one of their threads has been fully
--                    pulled and none contains anything inbound.
--   History Pending  they have not replied as far as we know, but at least one
--                    thread is still un-pulled, so we genuinely do not know.
--                    Self-clearing: it disappears as the backfill drains.
--
-- The third tag is the point. Without it, "not replied" and "not looked at yet"
-- are indistinguishable, and 17,000 leads would be labelled with a conclusion
-- nobody had earned.

alter table public.lead
  add column if not exists tags jsonb not null default '[]'::jsonb;

comment on column public.lead.tags is
  'Array of tag ids, same convention as appointment.tags and project.tags. Holds both manual and derived tags; recompute_lead_tags() maintains only the derived ones.';

create index if not exists lead_tags_idx on public.lead using gin (tags);

alter table public.tag
  add column if not exists is_derived boolean not null default false,
  add column if not exists rule_key   text;

comment on column public.tag.is_derived is
  'True when recompute_lead_tags() owns this tag. Derived tags are recomputed from the corpus and must never be applied or removed by hand -- a stale one states a falsehood confidently.';
comment on column public.tag.rule_key is
  'Stable key the recompute matches on, so renaming a derived tag in the UI does not orphan its rule.';

create unique index if not exists tag_rule_key_uniq
  on public.tag (rule_key) where rule_key is not null;

-- ---- the derived vocabulary --------------------------------------------------
insert into public.tag (id, name, color, emoji, is_derived, rule_key)
values
  (gen_random_uuid()::text, 'Replied',         '#1E6B4F', '💬', true, 'replied'),
  (gen_random_uuid()::text, 'Never Replied',   '#9B1B30', '🔇', true, 'never_replied'),
  (gen_random_uuid()::text, 'History Pending', '#8A6D00', '⏳', true, 'history_pending'),
  (gen_random_uuid()::text, 'Active 90d',      '#12506E', '🔥', true, 'active_90d'),
  (gen_random_uuid()::text, 'Gone Quiet',      '#6B5B73', '—', true, 'gone_quiet'),
  (gen_random_uuid()::text, 'No Conversation', '#5A6572', '—',  true, 'no_conversation')
on conflict (rule_key) where rule_key is not null do nothing;
