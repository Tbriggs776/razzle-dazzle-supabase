-- P9: Google service-account + GHL v2 integration config.
-- NOTE: originally applied via the Supabase MCP; captured here so the repo reproduces the DB.
update public.integration set
  secret_fields = jsonb_build_array(
    jsonb_build_object('name','GOOGLE_MAPS_API_KEY','label','Maps / Geocoding API Key'),
    jsonb_build_object('name','GOOGLE_SA_JSON','label','Service Account JSON (Calendar + Sheets)')
  ),
  config_fields = jsonb_build_array(
    jsonb_build_object('name','google_calendar_id','type','text','label','Shared Calendar ID','placeholder','ops@yourdomain.com or calendar id'),
    jsonb_build_object('name','calendar_mode','type','text','label','Calendar Mode (shared|impersonate)','placeholder','shared'),
    jsonb_build_object('name','calendar_impersonate_subject','type','text','label','Impersonate Subject (Workspace DWD, optional)','placeholder','')
  )
where key='google';

update public.integration set
  config_fields = jsonb_build_array(
    jsonb_build_object('name','ghl_location_id','type','text','label','GHL Location ID')
  )
where key='ghl';

-- ghl_contact_cache gets inserted by the sync handler; give it a default id.
alter table public.ghl_contact_cache alter column id set default gen_random_uuid()::text;

-- base44's calendar sync read this for a group-calendar attendee; add it (optional).
alter table public.sms_settings add column if not exists cc_group_calendar_id text;
