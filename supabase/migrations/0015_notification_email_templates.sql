-- P4: port base44's sendNotificationEmail (the generic customer-notification
-- dispatcher). Its per-type templates live on sms_settings; add + seed them. These
-- are CUSTOMER-facing emails (to the lead/customer, CC the team), distinct from the
-- internal "New Sale Closed" (email_settings.sale_confirmation_template) already ported.

alter table public.sms_settings
  add column if not exists reply_to_email text,
  add column if not exists lead_appointment_created_email_subject text,
  add column if not exists lead_appointment_created_email_template text,
  add column if not exists send_lead_appointment_created_email boolean not null default true,
  add column if not exists divert_lead_appointment_created_email boolean not null default false,
  add column if not exists lead_rescheduled_email_subject text,
  add column if not exists lead_rescheduled_email_template text,
  add column if not exists send_lead_rescheduled_email boolean not null default true,
  add column if not exists divert_lead_rescheduled_email boolean not null default false,
  add column if not exists lead_cancelled_email_subject text,
  add column if not exists lead_cancelled_email_template text,
  add column if not exists send_lead_cancelled_email boolean not null default true,
  add column if not exists divert_lead_cancelled_email boolean not null default false,
  add column if not exists customer_sale_confirmation_email_subject text,
  add column if not exists customer_sale_confirmation_email_template text,
  add column if not exists send_customer_sale_confirmation_email boolean not null default true,
  add column if not exists divert_customer_sale_confirmation_email boolean not null default false,
  add column if not exists lead_not_sold_email_subject text,
  add column if not exists lead_not_sold_email_template text,
  add column if not exists send_lead_not_sold_email boolean not null default true,
  add column if not exists divert_lead_not_sold_email boolean not null default false,
  add column if not exists customer_project_created_email_subject text,
  add column if not exists customer_project_created_email_template text,
  add column if not exists send_customer_project_created_email boolean not null default true,
  add column if not exists divert_customer_project_created_email boolean not null default false;

-- Seed default templates on the singleton row (coalesce; admin-editable; base44
-- bodies lived in its DB so these are authored Floor Daddy defaults).
update public.sms_settings set
  lead_appointment_created_email_subject = coalesce(lead_appointment_created_email_subject, $s$Your Floor Daddy appointment is scheduled, {lead_first_name}!$s$),
  lead_appointment_created_email_template = coalesce(lead_appointment_created_email_template,
    $t$Hi {lead_first_name},

Your free in-home flooring consultation is scheduled for {appointment_date} during the {appointment_time} window at {location_address}.

Your design consultant: {dc_name}

View or manage your appointment: {lead_tracking_url}

We look forward to seeing you!
- The Floor Daddy Team$t$),
  lead_rescheduled_email_subject = coalesce(lead_rescheduled_email_subject, $s$Your Floor Daddy appointment has been rescheduled$s$),
  lead_rescheduled_email_template = coalesce(lead_rescheduled_email_template,
    $t$Hi {lead_first_name},

Your Floor Daddy appointment has been rescheduled to {appointment_date} during the {appointment_time} window.

View your appointment: {lead_tracking_url}

- The Floor Daddy Team$t$),
  lead_cancelled_email_subject = coalesce(lead_cancelled_email_subject, $s$Your Floor Daddy appointment has been cancelled$s$),
  lead_cancelled_email_template = coalesce(lead_cancelled_email_template,
    $t$Hi {lead_first_name},

Your Floor Daddy appointment for {appointment_date} has been cancelled. If this was a mistake or you would like to reschedule, just reply to this email and we will be glad to help.

- The Floor Daddy Team$t$),
  customer_sale_confirmation_email_subject = coalesce(customer_sale_confirmation_email_subject, $s$Thank you for choosing Floor Daddy, {customer_first_name}!$s$),
  customer_sale_confirmation_email_template = coalesce(customer_sale_confirmation_email_template,
    $t$Hi {customer_first_name},

Thank you for your purchase! We are excited to get started on your new floors.

Total: {sale_amount}
Design consultant: {consultant_name}

Track your project: {project_tracker_url}

- The Floor Daddy Team$t$),
  lead_not_sold_email_subject = coalesce(lead_not_sold_email_subject, $s$Thank you for your time, {lead_first_name}$s$),
  lead_not_sold_email_template = coalesce(lead_not_sold_email_template,
    $t$Hi {lead_first_name},

Thank you for taking the time to meet with us about your flooring project. If you have any questions or decide you would like to move forward, we are here to help - just reply to this email.

- The Floor Daddy Team$t$),
  customer_project_created_email_subject = coalesce(customer_project_created_email_subject, $s$Your Floor Daddy project is underway, {customer_first_name}!$s$),
  customer_project_created_email_template = coalesce(customer_project_created_email_template,
    $t$Hi {customer_first_name},

Great news - your project is now in progress!

Installation date: {installation_date}
Project manager: {project_manager_name}
Location: {location_address}

Follow your project every step of the way: {project_tracker_url}

- The Floor Daddy Team$t$),
  reply_to_email = coalesce(reply_to_email, '')
where id = 'sms_settings_1';
