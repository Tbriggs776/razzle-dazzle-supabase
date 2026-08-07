-- Auto-generated schema from 44 base44 entities
-- System columns per table: id (text PK), created_date, updated_date, created_by

create table if not exists public."alert_group" (
  "id" text primary key default gen_random_uuid()::text,
  "name" text,
  "label" text,
  "description" text,
  "member_ids" jsonb default '[]'::jsonb,
  "channels" jsonb default '[]'::jsonb,
  "enabled" boolean default true,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."app_settings" (
  "id" text primary key default gen_random_uuid()::text,
  "show_role_assignment_splash" boolean default true,
  "quotes_enabled" boolean default false,
  "quotes_admin_only" boolean default true,
  "ad_spend_spreadsheet_id" text,
  "journey_nav_item_enabled" boolean default true,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."appointment" (
  "id" text primary key default gen_random_uuid()::text,
  "customer" text,
  "status" text default 'Lead',
  "appointment_date" date,
  "appointment_block" text,
  "appointment_start_time" text,
  "appointment_end_time" text,
  "installation_date" date,
  "assigned_csr" text,
  "assigned_dc" text,
  "location_address" text,
  "tags" jsonb default '[]'::jsonb,
  "notes" jsonb default '[]'::jsonb,
  "google_calendar_event_id" text,
  "lead_short_url" text,
  "consultant_short_url" text,
  "street_view_url" text,
  "consultant_en_route_time" timestamptz,
  "consultant_arrived_time" timestamptz,
  "rfms_sync_status" text,
  "rfms_sync_date" timestamptz,
  "rfms_sync_error" text,
  "recording_url" text,
  "recording_status" text,
  "recording_analysis" jsonb,
  "recording_transcript_id" text,
  "analyzed_not_sold_reason" text,
  "appointment_created_date" timestamptz,
  "confirmation_email_sent_at" timestamptz,
  "reminder_email_sent_at" timestamptz,
  "day1_followup_email_sent_at" timestamptz,
  "day2_followup_email_sent_at" timestamptz,
  "day3_followup_email_sent_at" timestamptz,
  "pre_install_checklist_signature_url" text,
  "pre_install_product_info" text,
  "not_sold_deal_size" double precision,
  "cancelled_reason" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."appointment_log" (
  "id" text primary key default gen_random_uuid()::text,
  "appointment" text,
  "action" text,
  "details" text,
  "user_email" text,
  "user_name" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."appointment_setting_checklist" (
  "id" text primary key default gen_random_uuid()::text,
  "appointment" text,
  "tags" jsonb default '[]'::jsonb,
  "introduction" jsonb default '[]'::jsonb,
  "how_process_works" boolean default false,
  "set_expectations" boolean default false,
  "customer_first_name" text,
  "customer_last_name" text,
  "customer_phone" text,
  "secondary_phone" text,
  "customer_email" text,
  "customer_street" text,
  "city" text,
  "state" text,
  "postal_code" text,
  "additional_address_details" text,
  "other_project_notes" text,
  "lives_at_address" text,
  "home_built_era" text,
  "property_year" double precision,
  "reason_for_call" text,
  "number_of_rooms" text,
  "value_adds_1" jsonb default '[]'::jsonb,
  "estimated_sq_footage" text,
  "flooring_products" jsonb default '[]'::jsonb,
  "colors_interest" text,
  "unique_product_color" boolean default false,
  "value_adds_2" jsonb default '[]'::jsonb,
  "plank_size_preference" text,
  "has_pets" text,
  "significant_other_name" text,
  "require_all_parties_present" text,
  "work_from_home" text,
  "owner_occupied_status" text,
  "financing_options" text,
  "credit_score_range" text,
  "project_timeframe" text,
  "in_stock_product_options" text,
  "next_day_or_2_day_install" boolean default false,
  "collected_other_estimates" text,
  "other_companies_estimates" text,
  "free_air_duct_cleaning" boolean default false,
  "unique_value_prop" text,
  "project_budget" text,
  "availability_notes" text,
  "preferred_appointment_date" date,
  "appointment_day" text,
  "preferred_appointment_block" text,
  "two_hour_window_confirmation" text,
  "customer_scheduling_requests" text,
  "heard_about_us" text,
  "heard_about_us_other" text,
  "verified_accuracy" text,
  "photos" jsonb default '[]'::jsonb,
  "home_size" text,
  "material_type" jsonb default '[]'::jsonb,
  "budget_range" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."checklist_v2" (
  "id" text primary key default gen_random_uuid()::text,
  "appointment" text,
  "checklist_status" text default 'active',
  "checklist_status_reason" text,
  "greeting_completed" boolean default false,
  "caller_type" text,
  "caller_type_notes" text,
  "frame_greeted_properly" boolean default false,
  "frame_experience_delivered" boolean default false,
  "customer_first_name" text,
  "customer_last_name" text,
  "customer_phone" text,
  "secondary_phone" text,
  "customer_email" text,
  "customer_street" text,
  "city" text,
  "state" text,
  "postal_code" text,
  "additional_address_details" text,
  "lives_at_address" text,
  "home_built_era" text,
  "owner_occupied_status" text,
  "discovery_q1" text,
  "discovery_q2" text,
  "discovery_q3" text,
  "discovery_q4" text,
  "discovery_q5" text,
  "scope_gap_fill_notes" text,
  "scope_flooring_products" jsonb default '[]'::jsonb,
  "scope_pets_kids_notes" text,
  "scope_flag_over_tile" boolean default false,
  "scope_flag_out_of_scope" boolean default false,
  "scope_baseboards" text,
  "scope_tile_removal" text,
  "super_sale_delivered" boolean default false,
  "value_stack_delivered" boolean default false,
  "prequal_below_minimum" boolean default false,
  "prequal_dm_track" text,
  "prequal_ladder_covered" boolean default false,
  "work_from_home" text,
  "financing_notes" text,
  "credit_score_range" text,
  "project_timeframe" text,
  "collected_other_estimates" text,
  "other_companies_estimates" text,
  "availability_notes" text,
  "preferred_appointment_date" date,
  "appointment_day" text,
  "preferred_appointment_block" text,
  "two_hour_window_confirmation" text,
  "customer_scheduling_requests" text,
  "recap_completed" boolean default false,
  "heard_about_us" text,
  "heard_about_us_other" text,
  "outro_completed" boolean default false,
  "ai_summary" text,
  "other_project_notes" text,
  "created_by_name" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."communication" (
  "id" text primary key default gen_random_uuid()::text,
  "type" text,
  "direction" text,
  "contact_phone" text,
  "contact_email" text,
  "contact_name" text,
  "body" text,
  "subject" text,
  "status" text,
  "lead_id" text,
  "customer_id" text,
  "appointment_id" text,
  "twilio_sid" text,
  "sent_by" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."customer" (
  "id" text primary key default gen_random_uuid()::text,
  "first_name" text,
  "last_name" text,
  "email" text,
  "phone" text,
  "address_line1" text,
  "address_line2" text,
  "city" text,
  "state" text,
  "zip" text,
  "notes" text,
  "converted_from_lead" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."customer_project_settings" (
  "id" text primary key default gen_random_uuid()::text,
  "show_progress_tracker" boolean default true,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."design_mod" (
  "id" text primary key default gen_random_uuid()::text,
  "project" text,
  "customer_id" text,
  "customer_first_name" text,
  "customer_last_name" text,
  "customer_email" text,
  "job_number" text,
  "products_or_changes" text,
  "value_added_costs" double precision,
  "funds_collected_terms" text,
  "status" text default 'draft',
  "email_sent_at" timestamptz,
  "signed_at" timestamptz,
  "customer_printed_name" text,
  "customer_signature" text,
  "short_url" text,
  "created_by_name" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."email_settings" (
  "id" text primary key default gen_random_uuid()::text,
  "lead_appointment_created_template" text default 'Hi Team,

A new appointment has been scheduled!

Customer: {lead_name}
Phone: {lead_phone}
Email: {lead_email}
Appointment Date: {appointment_date}
Time Block: {appointment_block}
Location: {location_address}
Assigned CSR: {csr_name}
Assigned DC: {dc_name}

View Appointment Details: {appointment_detail_url}

Best regards,
Razzle Dazzle',
  "send_lead_appointment_created_email" boolean default true,
  "lead_rescheduled_template" text default 'Hi Team,

An appointment has been rescheduled!

Customer: {lead_name}
New Date: {appointment_date}
New Time Block: {appointment_block}
Location: {location_address}
Assigned DC: {dc_name}

View Appointment Details: {appointment_detail_url}

Best regards,
Razzle Dazzle',
  "send_lead_rescheduled_email" boolean default true,
  "lead_cancelled_template" text default 'Hi Team,

An appointment has been cancelled.

Customer: {lead_name}
Original Date: {appointment_date}
Original Time Block: {appointment_block}
Location: {location_address}
Assigned DC: {dc_name}

View Appointment Details: {appointment_detail_url}

Best regards,
Razzle Dazzle',
  "send_lead_cancelled_email" boolean default true,
  "sale_confirmation_template" text default 'Hi Team,

A new sale has been closed!

Customer: {customer_name}
Amount: {sale_amount}
Consultant: {consultant_name}
Appointment Date: {appointment_date}
Location: {location_address}

View Sale Details: {sale_detail_url}

Best regards,
Razzle Dazzle',
  "send_sale_confirmation_email" boolean default true,
  "customer_project_created_template" text default 'Hi Team,

A new project has been created!

Customer: {customer_name}
Project Manager: {project_manager_name}
Installation Manager: {installation_manager_name}
Installation Date: {installation_date}
Location: {location_address}

View Project Details: {project_detail_url}

Best regards,
Razzle Dazzle',
  "send_customer_project_created_email" boolean default true,
  "cc_emails" jsonb default '[]'::jsonb,
  "divert_all_emails_to" text default '',
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."fleet_driver" (
  "id" text primary key default gen_random_uuid()::text,
  "first_name" text,
  "last_name" text,
  "phone" text,
  "email" text,
  "license_number" text,
  "status" text default 'active',
  "notes" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."fleet_maintenance" (
  "id" text primary key default gen_random_uuid()::text,
  "vehicle_id" text,
  "service_type" text,
  "scheduled_date" date,
  "status" text default 'scheduled',
  "description" text,
  "cost" text,
  "vendor" text,
  "receipt_urls" jsonb default '[]'::jsonb,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."fleet_vehicle" (
  "id" text primary key default gen_random_uuid()::text,
  "make" text,
  "model" text,
  "year" text,
  "vin" text,
  "license_plate" text,
  "status" text default 'active',
  "notes" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."ghl_contact_cache" (
  "id" text primary key default gen_random_uuid()::text,
  "date_added_list" jsonb default '[]'::jsonb,
  "synced_at" timestamptz,
  "contact_count" double precision,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."inspection_report" (
  "id" text primary key default gen_random_uuid()::text,
  "project" text,
  "customer_name" text,
  "job_number" text,
  "address" text,
  "phone_primary" text,
  "phone_secondary" text,
  "inspected_by" text,
  "inspected_on" date,
  "installer_name" text,
  "installers" jsonb default '[]'::jsonb,
  "installation_date" date,
  "issue_to_inspect" text,
  "material_installed" text,
  "action_materials_labor_cost" text,
  "send_original_installer_back" text,
  "back_charge_installer" text,
  "back_charge_date" date,
  "payment_to_different_installer" text,
  "time_to_resolve" text,
  "resolution" text,
  "materials_order_needs" text,
  "worry_free_guarantee" boolean default false,
  "customer_signature" text,
  "images" jsonb default '[]'::jsonb,
  "files" jsonb default '[]'::jsonb,
  "email_recipients" jsonb default '[]'::jsonb,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."installer" (
  "id" text primary key default gen_random_uuid()::text,
  "crew_id" text,
  "crew_name" text,
  "email" text,
  "phone" text,
  "is_active" boolean default true,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."journey_order" (
  "id" text primary key default gen_random_uuid()::text,
  "rfms_order_id" text,
  "invoice_number" text,
  "customer_name" text,
  "address" text,
  "city" text,
  "state" text,
  "zip_code" text,
  "lat" double precision,
  "lng" double precision,
  "region_assignment_id" text,
  "region_name" text,
  "field_manager_id" text,
  "install_coordinator_id" text,
  "order_entry_id" text,
  "preferred_installer_crew_id" text,
  "preferred_installer_crew_name" text,
  "installer_crews" jsonb default '[]'::jsonb,
  "line_items" jsonb default '[]'::jsonb,
  "order_date" date,
  "install_date" date,
  "order_total" double precision,
  "status" text default 'unassigned',
  "rfms_raw" jsonb,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."lead" (
  "id" text primary key default gen_random_uuid()::text,
  "first_name" text,
  "last_name" text,
  "email" text,
  "phone" text,
  "address_line1" text,
  "address_line2" text,
  "city" text,
  "state" text,
  "zip" text,
  "notes" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."log" (
  "id" text primary key default gen_random_uuid()::text,
  "type" text,
  "level" text,
  "function_name" text,
  "appointment_id" text,
  "message" text,
  "details" jsonb,
  "error_message" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."manual_sales_contract" (
  "id" text primary key default gen_random_uuid()::text,
  "customer_first_name" text,
  "customer_last_name" text,
  "customer_email" text,
  "customer_phone" text,
  "customer_address" text,
  "consultant_name" text,
  "sale_date" date,
  "install_date" date,
  "products_description" text,
  "sale_amount" double precision,
  "deposit_amount" double precision,
  "deposit_payment_method" text,
  "check_number" text,
  "notes" text,
  "status" text default 'draft',
  "short_url" text,
  "email_sent_at" timestamptz,
  "customer_printed_name" text,
  "customer_signature" text,
  "signed_at" timestamptz,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."project" (
  "id" text primary key default gen_random_uuid()::text,
  "sale" text,
  "customer" text,
  "status" text default 'Accepted',
  "tags" jsonb default '[]'::jsonb,
  "project_manager" text,
  "installation_manager" text,
  "field_manager_id" text,
  "install_coordinator_id" text,
  "order_entry_id" text,
  "installer_crew_id" text,
  "installer_crew_name" text,
  "installation_date" date,
  "installation_date_status" text,
  "pending_cancellation_date" timestamptz,
  "hold_cleared_date" timestamptz,
  "cancelled_date" timestamptz,
  "cancelled_by" text,
  "cancelled_reason" text,
  "cancellation_save_attempt_by" text,
  "cancellation_save_attempt_date" timestamptz,
  "cancellation_updates" jsonb default '[]'::jsonb,
  "pre_cancelled_status" text,
  "rfms_crew_date" date,
  "rfms_crew_name" text,
  "rfms_crew_cached_at" timestamptz,
  "scheduled_start_date" date,
  "scheduled_end_date" date,
  "actual_start_date" date,
  "actual_completion_date" date,
  "project_notes" text,
  "materials_notes" text,
  "quality_check_notes" text,
  "project_tracker_url" text,
  "welcome_call_attempted_date" timestamptz,
  "welcome_call_completed_date" timestamptz,
  "check_in_attempted_date" timestamptz,
  "check_in_completed_date" timestamptz,
  "pre_install_call_attempted_date" timestamptz,
  "pre_install_call_completed_date" timestamptz,
  "qa_in_progress_date" timestamptz,
  "qa_completed_date" timestamptz,
  "notes" jsonb default '[]'::jsonb,
  "images" jsonb default '[]'::jsonb,
  "files" jsonb default '[]'::jsonb,
  "pre_install_checklist_signature_url" text,
  "pre_install_product_info" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."project_checkpoint" (
  "id" text primary key default gen_random_uuid()::text,
  "project_id" text,
  "template_id" text,
  "step_key" text,
  "status" text default 'Pending',
  "checklist_data" jsonb,
  "notes" text,
  "photo_urls" jsonb default '[]'::jsonb,
  "submitted_by_name" text,
  "submitted_by_email" text,
  "submitted_date" timestamptz,
  "approved_by_name" text,
  "approved_by_email" text,
  "approved_date" timestamptz,
  "rejection_notes" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."project_checkpoint_template" (
  "id" text primary key default gen_random_uuid()::text,
  "name" text,
  "description" text,
  "category" text,
  "order" bigint,
  "required_photos" boolean default false,
  "is_active" boolean default true,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."project_claim" (
  "id" text primary key default gen_random_uuid()::text,
  "project" text,
  "claim_type" text,
  "installer_name" text,
  "installers" jsonb default '[]'::jsonb,
  "customer_name" text,
  "job_number" text,
  "address" text,
  "notes" text,
  "billable_repair" boolean default false,
  "is_back_charge" boolean default false,
  "back_charge_party" text,
  "payment_status" text,
  "need_to_order_material" boolean default false,
  "material_details" text,
  "submitted_by" text,
  "submitted_on" date,
  "images" jsonb default '[]'::jsonb,
  "email_recipients" jsonb default '[]'::jsonb,
  "is_completed" boolean default false,
  "is_cancelled" boolean default false,
  "reference_number" text,
  "eta" text,
  "completed_by" text,
  "completed_on" timestamptz,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."project_log" (
  "id" text primary key default gen_random_uuid()::text,
  "project" text,
  "action" text,
  "details" text,
  "user_email" text,
  "user_name" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."quote" (
  "id" text primary key default gen_random_uuid()::text,
  "appointment" text,
  "lead" text,
  "assigned_dc" text,
  "assigned_csr" text,
  "quote_date" timestamptz,
  "expiration_date" date,
  "status" text default 'Draft',
  "quote_amount" double precision,
  "location_address" text,
  "appointment_date" date,
  "appointment_block" text,
  "quote_file_url" text,
  "receipt_file_url" text,
  "contract_file_url" text,
  "deposit_amount" double precision,
  "deposit_payment_method" text,
  "check_number" text,
  "check_date" date,
  "converted_sale_id" text,
  "notes" text,
  "sent_at" timestamptz,
  "folder_photo_url" text,
  "yard_sign_photo_url" text,
  "driver_license_photo_url" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."rfms_item" (
  "id" text primary key default gen_random_uuid()::text,
  "item_name" text,
  "item_cost" double precision default 0,
  "freight" double precision default 0,
  "cont_labor" double precision default 0,
  "load" double precision default 0,
  "load_percent" double precision default 0,
  "per_unit_cost" double precision default 0,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."rfms_order_cache" (
  "id" text primary key default gen_random_uuid()::text,
  "document_number" text,
  "customer_name" text,
  "address" text,
  "city" text,
  "state" text,
  "zip_code" text,
  "line_items" jsonb default '[]'::jsonb,
  "order_total" double precision,
  "cached_at" timestamptz,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."rfms_order_status" (
  "id" text primary key default gen_random_uuid()::text,
  "document_number" text,
  "has_on_order" boolean,
  "line_statuses" jsonb default '[]'::jsonb,
  "checked_at" timestamptz,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."rfms_roll" (
  "id" text primary key default gen_random_uuid()::text,
  "style_name" text,
  "cut_cost" double precision default 0,
  "pad_cost" double precision default 0,
  "cont_labor" double precision default 0,
  "frt_factor" double precision default 0,
  "load" double precision default 0,
  "load_percent" double precision default 0,
  "per_unit_cost" double precision default 0,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."rfms_session" (
  "id" text primary key default gen_random_uuid()::text,
  "session_token" text,
  "session_expires" timestamptz,
  "bearer_token" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."region_assignment" (
  "id" text primary key default gen_random_uuid()::text,
  "region_name" text,
  "color" text default '#4F46E5',
  "polygon_coordinates" jsonb default '[]'::jsonb,
  "zip_codes" jsonb default '[]'::jsonb,
  "field_manager_id" text,
  "install_coordinator_id" text,
  "order_entry_id" text,
  "preferred_installer_crew_id" text,
  "preferred_installer_crew_name" text,
  "is_active" boolean default true,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."role_permissions" (
  "id" text primary key default gen_random_uuid()::text,
  "role" text,
  "accessible_pages" jsonb default '[]'::jsonb,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."sms_settings" (
  "id" text primary key default gen_random_uuid()::text,
  "past_due_alert_phones" jsonb default '[]'::jsonb,
  "past_due_alert_member_ids" jsonb default '[]'::jsonb,
  "pending_cancellation_alert_member_ids" jsonb default '[]'::jsonb,
  "unassigned_dc_alert_phones" jsonb default '[]'::jsonb,
  "gp_alert_member_ids" jsonb default '[]'::jsonb,
  "gp_alert_threshold" double precision default 30,
  "gp_alert_include_dc" boolean default false,
  "journey_high_value_threshold" double precision default 20000,
  "lead_appointment_created_template" text default 'Hi {lead_first_name}! Your appointment with Floor Daddy is scheduled for {appointment_date} at {appointment_time}. Track your appointment: {lead_tracking_url}',
  "lead_appointment_created_email_subject" text default 'New Appointment Scheduled - {lead_name}',
  "lead_appointment_created_email_template" text,
  "send_lead_appointment_created_email" boolean default true,
  "divert_lead_appointment_created_email" boolean default false,
  "lead_day1_followup_email_subject" text,
  "lead_day1_followup_email_template" text,
  "send_lead_day1_followup_email" boolean default true,
  "divert_lead_day1_followup_email" boolean default false,
  "lead_day2_followup_email_subject" text,
  "lead_day2_followup_email_template" text,
  "send_lead_day2_followup_email" boolean default true,
  "divert_lead_day2_followup_email" boolean default false,
  "lead_day3_followup_email_subject" text,
  "lead_day3_followup_email_template" text,
  "send_lead_day3_followup_email" boolean default true,
  "divert_lead_day3_followup_email" boolean default false,
  "consultant_assigned_template" text,
  "lead_consultant_assigned_template" text,
  "lead_rescheduled_template" text,
  "lead_rescheduled_email_subject" text,
  "lead_rescheduled_email_template" text,
  "send_lead_rescheduled_email" boolean default true,
  "divert_lead_rescheduled_email" boolean default false,
  "consultant_rescheduled_template" text,
  "lead_cancelled_template" text,
  "lead_cancelled_email_subject" text,
  "lead_cancelled_email_template" text,
  "send_lead_cancelled_email" boolean default true,
  "divert_lead_cancelled_email" boolean default false,
  "consultant_cancelled_template" text,
  "lead_reminder_template" text,
  "lead_reminder_email_subject" text,
  "lead_reminder_email_template" text,
  "send_lead_reminder_email" boolean default true,
  "divert_lead_reminder_email" boolean default false,
  "consultant_on_my_way_template" text,
  "consultant_arrived_template" text,
  "lead_not_sold_template" text,
  "lead_not_sold_email_subject" text,
  "lead_not_sold_email_template" text,
  "send_lead_not_sold_sms" boolean default true,
  "send_lead_not_sold_email" boolean default true,
  "divert_lead_not_sold_email" boolean default false,
  "customer_sale_confirmation_template" text,
  "customer_sale_confirmation_email_subject" text,
  "customer_sale_confirmation_email_template" text,
  "send_customer_sale_confirmation_email" boolean default true,
  "divert_customer_sale_confirmation_email" boolean default false,
  "customer_project_created_template" text,
  "customer_project_created_email_subject" text,
  "customer_project_created_email_template" text,
  "send_customer_project_created_email" boolean default true,
  "divert_customer_project_created_email" boolean default false,
  "divert_emails_to" text default '',
  "reply_to_email" text default '',
  "dc_ticket_assigned_template" text,
  "requester_category_resolved_template" text,
  "dc_new_message_template" text,
  "requester_new_message_template" text,
  "dc_resolution_denied_template" text,
  "dc_ticket_reminder_template" text,
  "dc_followup_reminder_template" text,
  "send_lead_sms" boolean default true,
  "send_consultant_sms" boolean default true,
  "send_reminders" boolean default true,
  "send_customer_sale_sms" boolean default true,
  "send_customer_project_sms" boolean default true,
  "send_dc_ticket_sms" boolean default true,
  "send_requester_resolved_sms" boolean default true,
  "send_ticket_message_sms" boolean default true,
  "send_dc_resolution_denied_sms" boolean default true,
  "send_dc_ticket_reminder_sms" boolean default true,
  "send_dc_followup_reminder_sms" boolean default true,
  "require_folder_photo" boolean default true,
  "require_yard_sign_photo" boolean default true,
  "cc_group_calendar_id" text,
  "cc_emails" jsonb default '[]'::jsonb,
  "value_add_keywords" jsonb default '[]'::jsonb,
  "inbound_sms_alert_emails" jsonb default '[]'::jsonb,
  "finance_report_emails" jsonb default '[]'::jsonb,
  "test_divert_enabled" boolean default false,
  "test_divert_email" text default 'user7@example.com',
  "test_divert_phone" text default '5555550100',
  "customer_divert_enabled" boolean default false,
  "customer_divert_email" text default 'user7@example.com',
  "customer_divert_phone" text default '5555550100',
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."sale" (
  "id" text primary key default gen_random_uuid()::text,
  "appointment" text,
  "customer" text,
  "lead" text,
  "assigned_dc" text,
  "sale_date" timestamptz,
  "contract_file_url" text,
  "appointment_date" date,
  "appointment_block" text,
  "location_address" text,
  "sale_amount" double precision,
  "deposit_amount" double precision,
  "notes" text,
  "folder_photo_url" text,
  "yard_sign_photo_url" text,
  "yard_sign_opted_out" boolean default false,
  "driver_license_photo_url" text,
  "product_photos" jsonb default '[]'::jsonb,
  "deposit_payment_method" text,
  "check_number" text,
  "check_date" date,
  "invoice_number" text,
  "invoice_line_items" jsonb default '[]'::jsonb,
  "contract_extraction_status" text default 'pending',
  "rfms_order_data" jsonb,
  "rfms_sync_date" timestamptz,
  "pre_install_checklist_signature_url" text,
  "pre_install_product_info" text,
  "is_cancelled" boolean default false,
  "cancelled_date" timestamptz,
  "cancelled_reason" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."standalone_pre_install_checklist" (
  "id" text primary key default gen_random_uuid()::text,
  "customer_first_name" text,
  "customer_last_name" text,
  "customer_email" text,
  "product_info" text,
  "job_number" text,
  "status" text default 'draft',
  "signature_url" text,
  "customer_printed_name" text,
  "short_url" text,
  "email_sent_at" timestamptz,
  "signed_at" timestamptz,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."tag" (
  "id" text primary key default gen_random_uuid()::text,
  "name" text,
  "color" text default '#6366F1',
  "emoji" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."task" (
  "id" text primary key default gen_random_uuid()::text,
  "appointment" text,
  "assigned_to" text,
  "due_date" date,
  "status" text default 'pending',
  "type" text default 'follow_up',
  "notes" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."team_member" (
  "id" text primary key default gen_random_uuid()::text,
  "first_name" text,
  "last_name" text,
  "email" text,
  "phone" text,
  "role" text,
  "profile_photo" text,
  "bio" text,
  "is_active" boolean default true,
  "calendar_integration_enabled" boolean default false,
  "google_calendar_id" text,
  "timezone" text default 'America/Phoenix',
  "calendar_color" text default '#4F46E5',
  "availability" jsonb default '[]'::jsonb,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."ticket" (
  "id" text primary key default gen_random_uuid()::text,
  "order_number" text,
  "customer_last_name" text,
  "categories" jsonb default '[]'::jsonb,
  "description" text,
  "requester" text,
  "assigned_dc" text,
  "cc_members" jsonb default '[]'::jsonb,
  "dc_short_url" text,
  "requester_short_url" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."ticket_log" (
  "id" text primary key default gen_random_uuid()::text,
  "ticket" text,
  "action" text,
  "details" text,
  "user_email" text,
  "user_name" text,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."ticket_message" (
  "id" text primary key default gen_random_uuid()::text,
  "ticket" text,
  "message" text,
  "sender_email" text,
  "sender_name" text,
  "sender_role" text,
  "file_urls" jsonb default '[]'::jsonb,
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

create table if not exists public."time_block_settings" (
  "id" text primary key default gen_random_uuid()::text,
  "time_block_9am_11am_color" text default '#DBEAFE',
  "time_block_12pm_2pm_color" text default '#F1F5F9',
  "time_block_3pm_5pm_color" text default '#FED7AA',
  "time_block_6pm_8pm_color" text default '#DCFCE7',
  "created_date" timestamptz not null default now(),
  "updated_date" timestamptz not null default now(),
  "created_by" text
);

-- Auto-update updated_date on row update
create or replace function public.set_updated_date() returns trigger as $$
begin
  new.updated_date = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_alert_group_updated on public."alert_group";
create trigger trg_alert_group_updated before update on public."alert_group" for each row execute function public.set_updated_date();
drop trigger if exists trg_app_settings_updated on public."app_settings";
create trigger trg_app_settings_updated before update on public."app_settings" for each row execute function public.set_updated_date();
drop trigger if exists trg_appointment_updated on public."appointment";
create trigger trg_appointment_updated before update on public."appointment" for each row execute function public.set_updated_date();
drop trigger if exists trg_appointment_log_updated on public."appointment_log";
create trigger trg_appointment_log_updated before update on public."appointment_log" for each row execute function public.set_updated_date();
drop trigger if exists trg_appointment_setting_checklist_updated on public."appointment_setting_checklist";
create trigger trg_appointment_setting_checklist_updated before update on public."appointment_setting_checklist" for each row execute function public.set_updated_date();
drop trigger if exists trg_checklist_v2_updated on public."checklist_v2";
create trigger trg_checklist_v2_updated before update on public."checklist_v2" for each row execute function public.set_updated_date();
drop trigger if exists trg_communication_updated on public."communication";
create trigger trg_communication_updated before update on public."communication" for each row execute function public.set_updated_date();
drop trigger if exists trg_customer_updated on public."customer";
create trigger trg_customer_updated before update on public."customer" for each row execute function public.set_updated_date();
drop trigger if exists trg_customer_project_settings_updated on public."customer_project_settings";
create trigger trg_customer_project_settings_updated before update on public."customer_project_settings" for each row execute function public.set_updated_date();
drop trigger if exists trg_design_mod_updated on public."design_mod";
create trigger trg_design_mod_updated before update on public."design_mod" for each row execute function public.set_updated_date();
drop trigger if exists trg_email_settings_updated on public."email_settings";
create trigger trg_email_settings_updated before update on public."email_settings" for each row execute function public.set_updated_date();
drop trigger if exists trg_fleet_driver_updated on public."fleet_driver";
create trigger trg_fleet_driver_updated before update on public."fleet_driver" for each row execute function public.set_updated_date();
drop trigger if exists trg_fleet_maintenance_updated on public."fleet_maintenance";
create trigger trg_fleet_maintenance_updated before update on public."fleet_maintenance" for each row execute function public.set_updated_date();
drop trigger if exists trg_fleet_vehicle_updated on public."fleet_vehicle";
create trigger trg_fleet_vehicle_updated before update on public."fleet_vehicle" for each row execute function public.set_updated_date();
drop trigger if exists trg_ghl_contact_cache_updated on public."ghl_contact_cache";
create trigger trg_ghl_contact_cache_updated before update on public."ghl_contact_cache" for each row execute function public.set_updated_date();
drop trigger if exists trg_inspection_report_updated on public."inspection_report";
create trigger trg_inspection_report_updated before update on public."inspection_report" for each row execute function public.set_updated_date();
drop trigger if exists trg_installer_updated on public."installer";
create trigger trg_installer_updated before update on public."installer" for each row execute function public.set_updated_date();
drop trigger if exists trg_journey_order_updated on public."journey_order";
create trigger trg_journey_order_updated before update on public."journey_order" for each row execute function public.set_updated_date();
drop trigger if exists trg_lead_updated on public."lead";
create trigger trg_lead_updated before update on public."lead" for each row execute function public.set_updated_date();
drop trigger if exists trg_log_updated on public."log";
create trigger trg_log_updated before update on public."log" for each row execute function public.set_updated_date();
drop trigger if exists trg_manual_sales_contract_updated on public."manual_sales_contract";
create trigger trg_manual_sales_contract_updated before update on public."manual_sales_contract" for each row execute function public.set_updated_date();
drop trigger if exists trg_project_updated on public."project";
create trigger trg_project_updated before update on public."project" for each row execute function public.set_updated_date();
drop trigger if exists trg_project_checkpoint_updated on public."project_checkpoint";
create trigger trg_project_checkpoint_updated before update on public."project_checkpoint" for each row execute function public.set_updated_date();
drop trigger if exists trg_project_checkpoint_template_updated on public."project_checkpoint_template";
create trigger trg_project_checkpoint_template_updated before update on public."project_checkpoint_template" for each row execute function public.set_updated_date();
drop trigger if exists trg_project_claim_updated on public."project_claim";
create trigger trg_project_claim_updated before update on public."project_claim" for each row execute function public.set_updated_date();
drop trigger if exists trg_project_log_updated on public."project_log";
create trigger trg_project_log_updated before update on public."project_log" for each row execute function public.set_updated_date();
drop trigger if exists trg_quote_updated on public."quote";
create trigger trg_quote_updated before update on public."quote" for each row execute function public.set_updated_date();
drop trigger if exists trg_rfms_item_updated on public."rfms_item";
create trigger trg_rfms_item_updated before update on public."rfms_item" for each row execute function public.set_updated_date();
drop trigger if exists trg_rfms_order_cache_updated on public."rfms_order_cache";
create trigger trg_rfms_order_cache_updated before update on public."rfms_order_cache" for each row execute function public.set_updated_date();
drop trigger if exists trg_rfms_order_status_updated on public."rfms_order_status";
create trigger trg_rfms_order_status_updated before update on public."rfms_order_status" for each row execute function public.set_updated_date();
drop trigger if exists trg_rfms_roll_updated on public."rfms_roll";
create trigger trg_rfms_roll_updated before update on public."rfms_roll" for each row execute function public.set_updated_date();
drop trigger if exists trg_rfms_session_updated on public."rfms_session";
create trigger trg_rfms_session_updated before update on public."rfms_session" for each row execute function public.set_updated_date();
drop trigger if exists trg_region_assignment_updated on public."region_assignment";
create trigger trg_region_assignment_updated before update on public."region_assignment" for each row execute function public.set_updated_date();
drop trigger if exists trg_role_permissions_updated on public."role_permissions";
create trigger trg_role_permissions_updated before update on public."role_permissions" for each row execute function public.set_updated_date();
drop trigger if exists trg_sms_settings_updated on public."sms_settings";
create trigger trg_sms_settings_updated before update on public."sms_settings" for each row execute function public.set_updated_date();
drop trigger if exists trg_sale_updated on public."sale";
create trigger trg_sale_updated before update on public."sale" for each row execute function public.set_updated_date();
drop trigger if exists trg_standalone_pre_install_checklist_updated on public."standalone_pre_install_checklist";
create trigger trg_standalone_pre_install_checklist_updated before update on public."standalone_pre_install_checklist" for each row execute function public.set_updated_date();
drop trigger if exists trg_tag_updated on public."tag";
create trigger trg_tag_updated before update on public."tag" for each row execute function public.set_updated_date();
drop trigger if exists trg_task_updated on public."task";
create trigger trg_task_updated before update on public."task" for each row execute function public.set_updated_date();
drop trigger if exists trg_team_member_updated on public."team_member";
create trigger trg_team_member_updated before update on public."team_member" for each row execute function public.set_updated_date();
drop trigger if exists trg_ticket_updated on public."ticket";
create trigger trg_ticket_updated before update on public."ticket" for each row execute function public.set_updated_date();
drop trigger if exists trg_ticket_log_updated on public."ticket_log";
create trigger trg_ticket_log_updated before update on public."ticket_log" for each row execute function public.set_updated_date();
drop trigger if exists trg_ticket_message_updated on public."ticket_message";
create trigger trg_ticket_message_updated before update on public."ticket_message" for each row execute function public.set_updated_date();
drop trigger if exists trg_time_block_settings_updated on public."time_block_settings";
create trigger trg_time_block_settings_updated before update on public."time_block_settings" for each row execute function public.set_updated_date();

