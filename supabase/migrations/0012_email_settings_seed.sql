-- P4: the transactional email cluster needs a singleton email_settings row, which
-- was never seeded (the table is empty, so every base44 email sender no-ops). Seed
-- it with a default sale-confirmation template + the internal notification list.
-- cc_emails is the INTERNAL staff distribution for ops notifications — the
-- 'ops@example.com' placeholder should be replaced with the real Floor Daddy list
-- in the settings admin. Also add the finance-report recipient list used by the
-- funds-received / finance-report senders (ported next).

insert into public.email_settings (id, send_sale_confirmation_email, cc_emails, divert_all_emails_to, sale_confirmation_template)
values (
  'email_settings_1',
  true,
  '["ops@example.com"]'::jsonb,
  '',
  $tpl$A new sale has been closed.

Customer: {customer_name}
Sale amount: {sale_amount}
Design consultant: {consultant_name}
Appointment date: {appointment_date}
Location: {location_address}

View the sale: {sale_detail_url}

— Razzle Dazzle by Floor Daddy$tpl$
)
on conflict (id) do nothing;

alter table public.sms_settings
  add column if not exists finance_report_emails jsonb not null default '[]'::jsonb;
