-- Give customers a matchable phone number, so an inbound ops text can find its job.
--
-- Leads have had this since day one: `lead.phone_e164` is a STORED GENERATED column
-- and is uniquely indexed. Customers were left with raw `phone` -- 691 stored as
-- "(602) 699-8747", 53 as "602-699-8747", 50 bare, and one that is an email address.
-- Matching an inbound SMS against that means comparing "(602) 699-8747" to
-- "6026998747" and hoping, which is not matching, it is guessing.
--
-- GENERATED, not a trigger, and not a backfilled plain column. The value cannot drift
-- from `phone` because Postgres recomputes it on every write; there is no trigger to
-- forget on a new code path and no backfill to re-run. It reuses public.to_e164()
-- (IMMUTABLE, already the normaliser everywhere else) rather than copying the CASE
-- expression `lead` inlines -- one definition of "what this number really is".
--
-- ============================================================================
-- DELIBERATELY NOT UNIQUE. This is the part worth reading.
-- ============================================================================
-- The obvious move is to mirror `lead`'s unique index. It would fail, and it *should*
-- fail: 43 normalised numbers are already shared by 127 customers, and the worst case
-- is SEVENTEEN customers on one number.
--
--     30 of the 43 share a surname   -- one household, or a duplicate record
--     13 have different surnames     -- a property manager, builder, or landlord
--
-- That is not dirty data. Floor Daddy works for property managers who have many jobs
-- under one contact number, and for households where two people are both on file. A
-- unique constraint would assert something false about the business and block real
-- records at insert time.
--
-- THE CONSEQUENCE FOR INBOUND ROUTING, stated here because this is where someone will
-- look for it: a text arriving on the ops number CANNOT be resolved to a customer by
-- phone alone. It has to resolve to a JOB. When a number matches one active project,
-- route there. When it matches several -- the seventeen-job property manager texting
-- "when are you coming Thursday" -- do NOT guess. Surface the candidates and let a
-- human file it. Misfiling a customer conversation onto the wrong job is worse than
-- asking, because it is silent and nobody goes looking for it later.
alter table public.customer
  add column if not exists phone_e164 text
  generated always as (public.to_e164(phone)) stored;

comment on column public.customer.phone_e164 is
  'E.164 form of phone, generated. NOT unique on purpose -- 43 numbers are shared by 127 customers (worst case 17, a property manager). Inbound texts must resolve to a JOB, not to this column alone; on multiple matches, ask rather than guess.';

-- Partial: the one customer whose phone field holds an email address normalises to
-- NULL, and a lookup index has no use for rows that can never be matched.
create index if not exists customer_phone_e164_idx
  on public.customer (phone_e164)
  where phone_e164 is not null;
