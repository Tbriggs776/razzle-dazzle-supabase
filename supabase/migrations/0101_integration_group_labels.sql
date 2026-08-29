-- ─────────────────────────────────────────────────────────────────────────────
-- 0101 — The Integrations page rendered one flat column. That was fine at eight
-- providers; 0100 makes it thirteen, and the telephony and advertising
-- credentials become impossible to find.
--
-- The obvious fix — group by `category` — does not work: `category` is the
-- specific line printed under each provider's name (Messaging, ERP, AI · LLM,
-- Telephony · Attribution …) and there are twelve distinct values across
-- thirteen rows. Grouping on it yields twelve headings of one card each, which
-- is worse than no grouping at all.
--
-- So `category` keeps its job as the per-card label, and `group_label` is added
-- as the coarse family the page groups on. sort_order is rewritten so each
-- family's members are contiguous — verified — which lets the client group by
-- first-seen order without re-sorting and without a second ordering column.
--
-- Both columns stay data-driven: a new provider picks its family in its INSERT,
-- and the page needs no edit.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.integration add column if not exists group_label text;

update public.integration set group_label = v.grp, sort_order = v.ord
from (values
  ('twilio',      'Customer messaging',      10),
  ('resend',      'Customer messaging',      20),
  ('shortio',     'Customer messaging',      30),
  ('callrail',    'Phone & call attribution', 40),
  ('ringcentral', 'Phone & call attribution', 50),
  ('ghl',         'Marketing & advertising', 60),
  ('google_ads',  'Marketing & advertising', 70),
  ('meta',        'Marketing & advertising', 80),
  ('ga4',         'Marketing & advertising', 90),
  ('rfms',        'Business systems',        100),
  ('google',      'Business systems',        110),
  ('assemblyai',  'AI',                      120),
  ('anthropic',   'AI',                      130)
) as v(key, grp, ord)
where public.integration.key = v.key;

-- Anything added later without a family still groups, under its own category.
update public.integration set group_label = coalesce(group_label, category) where group_label is null;

create or replace function public.admin_get_integrations()
returns jsonb language sql security definer set search_path to 'public'
as $function$
  select case when public.is_org_admin() then coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'key', i.key, 'name', i.name, 'category', i.category,
        'group_label', coalesce(i.group_label, i.category),
        'is_enabled', i.is_enabled, 'status', i.status,
        'last_tested_at', i.last_tested_at, 'last_error', i.last_error,
        'config', i.config, 'config_fields', i.config_fields,
        'secret_fields', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'name', sf->>'name', 'label', sf->>'label',
            'is_set', exists(select 1 from vault.secrets vs where vs.name = sf->>'name')
          )), '[]'::jsonb)
          from jsonb_array_elements(i.secret_fields) sf
        )
      ) order by i.sort_order
    ) from public.integration i
  ), '[]'::jsonb) else '[]'::jsonb end;
$function$;
