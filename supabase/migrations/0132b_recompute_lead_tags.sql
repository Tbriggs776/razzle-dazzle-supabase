-- Recompute the derived tags from the corpus.
--
-- Owns only the tags flagged is_derived. A manual tag someone applied by hand is
-- never added, removed or reordered here -- that separation is the whole reason
-- the two kinds are distinguished in 0132.
--
-- Each lead is summarised once in `facts` rather than evaluated once per rule,
-- because this runs over every lead in the system.
--
-- The `replied` test deliberately accepts two different proofs. An inbound
-- ghl_message is the strong one, but it only exists once that thread's history
-- has been pulled. The conversation summary also carries lastMessageDirection,
-- which is available for every thread immediately -- so a customer whose last
-- message came inbound is known to have replied long before the backfill
-- reaches them. It is one-way evidence: inbound proves a reply, outbound proves
-- nothing, which is exactly why `never_replied` needs the stronger test.
create or replace function public.recompute_lead_tags()
returns table (leads_touched int, tags_added int, tags_removed int)
language plpgsql security definer set search_path = public as $$
declare v_touched int; v_added int; v_removed int;
begin
  with derived as (
    select rule_key, id from public.tag where is_derived and rule_key is not null
  ),
  facts as (
    select l.id as lead_id,
           l.tags as old_tags,
           count(gc.id)                                              as conversations,
           count(gc.id) filter (where gc.messages_synced_at is null) as unpulled,
           max(gc.last_message_at)                                   as last_activity,
           bool_or(gc.raw->>'lastMessageDirection' = 'inbound')      as last_was_inbound,
           bool_or(exists (
             select 1 from public.ghl_message m
              where m.conversation_id = gc.id and m.direction = 'inbound'
           ))                                                        as has_inbound_message
      from public.lead l
      left join public.ghl_conversation gc on gc.lead_id = l.id
     group by l.id, l.tags
  ),
  verdict as (
    select f.lead_id, f.old_tags,
           f.conversations = 0                                          as no_conversation,
           coalesce(f.has_inbound_message or f.last_was_inbound, false) as replied,
           f.unpulled > 0                                               as unpulled,
           coalesce(f.last_activity > now() - interval '90 days', false) as active_90d
      from facts f
  ),
  wanted as (
    select v.lead_id, v.old_tags,
           array_remove(array[
             case when v.no_conversation then (select id from derived where rule_key='no_conversation') end,
             case when v.replied then (select id from derived where rule_key='replied') end,
             -- Claimed only with complete history; otherwise say so instead.
             case when not v.no_conversation and not v.replied and not v.unpulled
                  then (select id from derived where rule_key='never_replied') end,
             case when not v.no_conversation and not v.replied and v.unpulled
                  then (select id from derived where rule_key='history_pending') end,
             case when v.active_90d then (select id from derived where rule_key='active_90d') end,
             case when v.replied and not v.active_90d
                  then (select id from derived where rule_key='gone_quiet') end
           ], null) as derived_ids
      from verdict v
  ),
  recomputed as (
    select w.lead_id, w.old_tags,
           (
             select coalesce(jsonb_agg(t order by t), '[]'::jsonb)
               from (
                 -- manual tags survive; derived ones are replaced wholesale
                 select value as t
                   from jsonb_array_elements_text(w.old_tags) value
                  where value not in (select id from derived)
                 union
                 select unnest(w.derived_ids)
               ) x
           ) as new_tags
      from wanted w
  ),
  changed as (
    -- Compare order-insensitively, so a reshuffle is not counted as a change.
    select r.lead_id, r.new_tags, r.old_tags
      from recomputed r
     where r.new_tags is distinct from (
             select coalesce(jsonb_agg(t order by t), '[]'::jsonb)
               from jsonb_array_elements_text(r.old_tags) t
           )
  ),
  applied as (
    update public.lead l
       set tags = c.new_tags, updated_date = now()
      from changed c
     where l.id = c.lead_id
    returning
      (select count(*) from jsonb_array_elements_text(c.new_tags)) as n_new,
      (select count(*) from jsonb_array_elements_text(c.old_tags)) as n_old
  )
  select count(*)::int,
         greatest(coalesce(sum(n_new - n_old), 0), 0)::int,
         greatest(coalesce(sum(n_old - n_new), 0), 0)::int
    into v_touched, v_added, v_removed
    from applied;

  return query select coalesce(v_touched,0), coalesce(v_added,0), coalesce(v_removed,0);
end $$;

comment on function public.recompute_lead_tags() is
  'Recompute the derived tags on every lead from the conversation corpus. Manual tags are never touched. "Never Replied" is claimed only when all of that lead''s threads have complete history; otherwise "History Pending" says so honestly.';

revoke execute on function public.recompute_lead_tags() from public, anon;
grant execute on function public.recompute_lead_tags() to authenticated, service_role;
