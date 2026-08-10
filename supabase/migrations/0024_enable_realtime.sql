-- Enable Supabase Realtime for the tables whose pages use base44's entity.subscribe()
-- (Appointments, CommunicationHub, AppointmentDetail, ConsultantAppointmentView,
-- RecordingDetail). The shim's subscribe() opens a postgres_changes channel; without the
-- table in the supabase_realtime publication the channel is a harmless no-op, so this makes
-- the live-update feature actually deliver events. RLS still applies to realtime, so a
-- client only receives changes for rows it can already SELECT. Idempotent.
do $$
declare t text;
begin
  foreach t in array array['appointment','appointment_log','communication'] loop
    if to_regclass('public.'||t) is not null
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
