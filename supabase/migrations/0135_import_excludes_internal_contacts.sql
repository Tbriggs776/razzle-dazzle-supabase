-- Your own staff are not leads.
--
-- The GHL contact list contains Floor Daddy's own people and machinery, because
-- everyone the system has ever emailed has a contact record. The import took
-- them at face value and created leads for aaron@, bryant@, katie@, shared
-- inboxes like info@ / leads@ / estimates@ / installation@, test accounts
-- (jonathan+22@), and six different misspellings of noreply@.
--
-- It surfaced as absurd attempt counts once GHL messages started counting:
-- "Maya Rodriguez, 4,589 outbound attempts". Nobody texts a customer 4,589
-- times. That is a staff mailbox, and left alone it would sit at the top of
-- every worked-leads report as the most contacted customer in the business.
--
-- ============================================================================
-- READ THIS BEFORE REPLAYING: THE VERSION APPLIED HERE HAD A BUG.
--
-- The applied version derived the internal-domain list straight from
-- team_member.email with no further filter. Six staff use gmail.com, two
-- yahoo.com, one outlook.com -- so those providers were classified as internal
-- and 8,588 real customers were excluded from the import and deleted by the
-- cleanup below.
--
-- 0136 fixes it by subtracting public providers, and the delete in this file has
-- been corrected to match. The bug is described in full in 0136; recovery was a
-- re-run of the import, since the affected rows were minutes old and had no
-- sale, appointment or communication attached.
--
-- The file deviates from what was literally applied ONLY here, deliberately: a
-- replay of the original predicate on a populated database would repeat the
-- deletion, and shipping a known-destructive statement for the sake of
-- historical fidelity is the wrong trade.
-- ============================================================================
--
-- Deleting is safe in this narrow case and would not be in general: the rows
-- were created by the import minutes earlier and had no sale, appointment or
-- communication attached. Their conversations detach to lead_id null rather than
-- disappearing -- an internal thread belongs in the corpus but should hang off
-- nobody.
--
-- The import function itself is superseded by 0136; only the cleanup is kept
-- here, guarded.
delete from public.lead
 where notes = 'Imported from GoHighLevel conversation history.'
   and (
     -- Internal domains, with public providers subtracted. Inline rather than
     -- via internal_email_domains(), which does not exist until 0136.
     lower(split_part(coalesce(email,''),'@',2)) in (
       select distinct lower(split_part(btrim(tm.email),'@',2))
         from public.team_member tm
        where tm.email is not null
          and position('@' in tm.email) > 0
          and lower(split_part(btrim(tm.email),'@',2)) not in (
            'gmail.com','googlemail.com','yahoo.com','ymail.com','hotmail.com',
            'outlook.com','live.com','msn.com','icloud.com','me.com','mac.com',
            'aol.com','comcast.net','cox.net','att.net','verizon.net','sbcglobal.net',
            'protonmail.com','proton.me','gmx.com','mail.com','zoho.com','qq.com'
          )
          and lower(split_part(btrim(tm.email),'@',2)) <> ''
     )
     or coalesce(lower(email),'') ~ '^(no-?re?p+l+[yi]|do-?not-?reply|mailer-daemon|postmaster)'
     or exists (select 1 from public.team_member tm
                 where tm.email is not null and public.lead.email is not null
                   and lower(btrim(tm.email)) = lower(btrim(public.lead.email)))
     or exists (select 1 from public.team_member tm
                 where tm.phone is not null and public.lead.phone_e164 is not null
                   and public.to_e164(tm.phone) = public.lead.phone_e164)
   );
