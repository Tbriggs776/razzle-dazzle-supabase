// Installation-journey checkpoint state machine (ports base44 submitCheckpoint). Drives the
// job-start -> floor-prep -> installation -> final-walkthrough flow on project_checkpoint, with
// field-manager / installer / customer / ops notifications, the asbestos HARD-STOP (halts the
// project), material-shortage / change-order / five-star alerts, and test/customer divert.
//
// Actions: submit | approve | reject | approve_prep | submit_install | approve_final |
//          submit_for_payment | resend_notification | resend_installer_notification.
//
// Notifications route through the durable queue (enqueue_job send_email/send_sms -> sendMessage:
// suppression, delivery tracking, retry, skip-when-unconfigured) instead of base44's direct
// Resend/Twilio calls. Auth: an authenticated user (installer/manager) OR internal secret.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const APP_URL = Deno.env.get('APP_URL') || 'https://razzle-dazzle-supabase.vercel.app';
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const STEP_LABELS: Record<string, string> = {
  pre_install_checklist: 'Pre-Install Checklist', job_start_checklist: 'Job Start Checklist',
  floor_prep_checklist: 'Floor Prep Checklist', final_walkthrough_checklist: 'Final Walkthrough Checklist',
};

async function getSecret(s: any, name: string): Promise<string | null> {
  const { data, error } = await s.rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

async function currentUser(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const u = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data } = await u.auth.getUser();
  return data?.user ?? null;
}

const fmtUsd = (n: number) =>
  '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function one(s: any, table: string, id: string | null | undefined) {
  if (!id) return null;
  const { data } = await s.from(table).select('*').eq('id', id).maybeSingle();
  return data;
}

// Test divert wins for everything; customer divert redirects customer-facing email; else real recipient.
function divertEmail(cfg: any, to: string, isCustomer: boolean): string | null {
  if (cfg.test_divert_enabled && cfg.test_divert_email) return cfg.test_divert_email;
  if (isCustomer && cfg.customer_divert_enabled && cfg.customer_divert_email) return cfg.customer_divert_email;
  return to || null;
}
function divertSms(cfg: any, to: string): string | null {
  if (cfg.test_divert_enabled && cfg.test_divert_phone) return cfg.test_divert_phone;
  return to || null;
}
async function qEmail(s: any, cfg: any, to: string, subject: string, body: string, isCustomer = false): Promise<boolean> {
  const dest = divertEmail(cfg, to, isCustomer);
  if (!dest) return false;
  await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to: dest, subject, body, sent_by: 'System' } });
  return true;
}
async function qSms(s: any, cfg: any, to: string, body: string): Promise<boolean> {
  const dest = divertSms(cfg, to);
  if (!dest) return false;
  await s.rpc('enqueue_job', { p_type: 'send_sms', p_payload: { to: dest, body, sent_by: 'System' } });
  return true;
}

async function matchRegion(s: any, customer: any) {
  if (!customer?.zip) return null;
  const { data: regions } = await s.from('region_assignment').select('*').eq('is_active', true);
  return (regions || []).find((r: any) => (r.zip_codes || []).includes(customer.zip)) || null;
}
async function alertMembers(s: any, groupName: string): Promise<any[]> {
  const { data: groups } = await s.from('alert_group').select('*').eq('name', groupName).eq('enabled', true).limit(1);
  const g = groups?.[0];
  if (!g || !(g.member_ids || []).length) return [];
  const { data: members } = await s.from('team_member').select('id,first_name,email,phone').in('id', g.member_ids);
  return members || [];
}
async function installerOf(s: any, project: any) {
  if (!project?.installer_crew_id) return null;
  const { data } = await s.from('installer').select('*').eq('crew_id', project.installer_crew_id).limit(1);
  return data?.[0] || null;
}
async function projectCtx(s: any, projectId: string) {
  const project = await one(s, 'project', projectId);
  const customer = project?.customer ? await one(s, 'customer', project.customer) : null;
  const customerName = customer ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Unknown' : 'Unknown';
  return { project, customer, customerName, url: `${APP_URL}/JourneyProjectDetail?project_id=${projectId}` };
}
async function upsertCheckpoint(s: any, checkpointId: string | null, insertRow: any, updateFields: any) {
  if (checkpointId) { const { data } = await s.from('project_checkpoint').update(updateFields).eq('id', checkpointId).select().maybeSingle(); return data; }
  const { data } = await s.from('project_checkpoint').insert(insertRow).select().maybeSingle(); return data;
}

async function handle(s: any, body: any, user: any): Promise<{ status: number; body: Record<string, unknown> }> {
  const { checkpoint_id, project_id, step_key, checklist_data, action, rejection_notes } = body;
  const userName = user?.user_metadata?.full_name || user?.email || 'System';
  const userEmail = user?.email || null;
  const nowIso = new Date().toISOString();
  const label = STEP_LABELS[step_key] || step_key;
  const { data: ssList } = await s.from('sms_settings').select('*').limit(1);
  const cfg: any = ssList?.[0] || {};

  switch (action) {
    case 'submit': {
      // Billable floor-prep change order: the crew must have called it in for approval BEFORE
      // doing the work and recorded the dollar amount that was called in. This is the compliance
      // gate (belt-and-suspenders with the checklist's client-side validation). Submitting a
      // chargeable prep then notifies Order Entry + the Install Coordinator (below) so they can
      // create the actual customer change order — it does not block on customer signature/payment.
      if (step_key === 'floor_prep_checklist' && checklist_data?.change_order?.is_chargeable) {
        const co = checklist_data.change_order;
        if (!co.called_in_before_work)
          return { status: 400, body: { error: 'Chargeable prep must be called in for approval before the work is done. Confirm the call-in before submitting.' } };
        if (!(Number(co.amount) > 0))
          return { status: 400, body: { error: 'Enter the dollar amount that was called in for approval before submitting.' } };
      }
      const fields = { checklist_data, status: 'SubmittedForApproval', submitted_by_name: userName, submitted_by_email: userEmail, submitted_date: nowIso };
      const checkpoint = await upsertCheckpoint(s, checkpoint_id, { project_id, step_key, ...fields }, fields);

      const { project, customer, customerName, url } = await projectCtx(s, project_id);
      const region = await matchRegion(s, customer);
      const fmId = region?.field_manager_id || project?.field_manager_id;
      if (fmId) {
        const fm = await one(s, 'team_member', fmId);
        if (fm) {
          const regionName = region?.region_name || 'Unassigned';
          await qEmail(s, cfg, fm.email, `[Field Manager] Approval Needed: ${label} — ${customerName}`,
            `Hi ${fm.first_name || 'Manager'},\n\n${label} has been submitted for approval and is awaiting your review.\n\nCustomer: ${customerName}\nSubmitted by: ${userName}\nRegion: ${regionName}\n\nReview and approve here: ${url}`);
          await qSms(s, cfg, fm.phone, `Floor Daddy: ${label} submitted for ${customerName} in ${regionName}. Approval needed: ${url}`);
        }
      }
      if (step_key === 'final_walkthrough_checklist' && customer)
        await qEmail(s, cfg, customer.email, '[Customer] Your project is nearing completion',
          `Hi ${customer.first_name || 'there'},\n\nYour project is nearing completion. A final walkthrough is being scheduled.\n\nThank you for choosing Floor Daddy!`, true);

      const asbestos = checklist_data?.safety?.asbestos_suspected === true;
      if (asbestos) {
        const members = await alertMembers(s, 'asbestos_hard_stop');
        for (const m of members)
          await qEmail(s, cfg, m.email, '[Alert Team] 🚨 HARD STOP — Asbestos Suspected',
            `Asbestos suspected at project ${project_id}. Installation HALTED. Customer must engage a licensed abatement company and provide a clearance certificate before work resumes.`);

        // The in-app inbox is the ONLY channel here that cannot silently fail:
        // email needs a Resend key, SMS needs a Twilio from-number, and the
        // asbestos alert group has zero members. This is a safety stop — it must
        // land somewhere a human will see it and must be ACKNOWLEDGED, not just
        // delivered. notify_* falls back to org admins and reports anyone
        // unreachable rather than pretending the alert arrived.
        const ids = members.map((m: any) => m.id).filter(Boolean);
        if (ids.length) {
          await s.rpc('notify_team_members', {
            p_team_member_ids: ids,
            p_title: '🚨 HARD STOP — asbestos suspected',
            p_body: `Installation is HALTED at ${customerName}. The customer must engage a licensed abatement company and provide a clearance certificate before work resumes.`,
            p_kind: 'alert', p_severity: 'crit',
            p_subject_type: 'project', p_subject_id: project_id,
            p_route: `/JourneyProjectDetail?id=${project_id}`,
            p_rule_key: 'asbestos_hard_stop',
            p_dedupe_key: `asbestos:${project_id}`,
            p_requires_ack: true,
          });
        } else {
          await s.rpc('notify_role', {
            p_role_name: 'Operations',
            p_title: '🚨 HARD STOP — asbestos suspected',
            p_body: `Installation is HALTED at ${customerName}. No asbestos alert group is configured, so this was routed by role.`,
            p_kind: 'alert', p_severity: 'crit',
            p_subject_type: 'project', p_subject_id: project_id,
            p_route: `/JourneyProjectDetail?id=${project_id}`,
            p_rule_key: 'asbestos_hard_stop',
            p_dedupe_key: `asbestos:${project_id}`,
            p_requires_ack: true,
          });
        }

        await s.from('project').update({ installation_date_status: 'on hold' }).eq('id', project_id);
      }
      // ── GATE 2: install-start collection backstop ────────────────────────
      // Collection belongs to Install Coordination BEFORE install day (task rule
      // collect_balance). This is the net under that, not the process itself.
      //
      // OBSERVE-ONLY by owner decision: it records and alerts, it never blocks.
      // The submit must always succeed — the "Take Photos First" evidence
      // captured here is what the claims process later depends on.
      //
      // The hold is written to workflow_exception, NEVER to
      // project.installation_date_status: that column carries the asbestos halt
      // (which this must not clobber) and get_public_project exports it to the
      // customer's own public tracker, where it would publish their delinquency.
      let codHold = false;
      let amountDue = 0;
      if (step_key === 'job_start_checklist') {
        const { data: bal } = await s
          .from('sale_balance')
          .select('sale_id, gross_amount, balance_due, amount_paid, fully_collected, is_cancelled, collection_terms, collect_exempt')
          .eq('sale_id', project?.sale ?? '__none__')
          .maybeSingle();

        // No sale (manual project), no balance row, or a cancelled sale: never
        // invent a debt. E11 already flags live-project-on-cancelled-sale.
        //
        // An UNPRICED sale is excluded too. sale_balance forces
        // fully_collected=false when sale_amount <= 0 while balance_due goes
        // NEGATIVE once a deposit exists, so this block would have alerted
        // "-$11,460.00 outstanding" and raised a crit that no payment could ever
        // clear. An unpriced sale is a Sales data problem — flow.js already
        // raises 'sale_unpriced' owned by Sales for it.
        if (bal && !bal.is_cancelled && Number(bal.gross_amount) > 0 && bal.fully_collected === false) {
          codHold = true;
          // Clamped, and clamped the SAME way install_collection_status clamps,
          // so the crew's banner and the coordinator's alert can never quote
          // two different numbers for one hold.
          amountDue = Math.max(0, Number(bal.balance_due) || 0);

          // The exception row is NOT written here. The trg_checkpoint_cod_gate
          // trigger on project_checkpoint already wrote it during upsertCheckpoint
          // above, and it is the single writer on purpose: this Edge Function is
          // only one of two doors into project_checkpoint — the projects UI
          // PATCHes the row directly through PostgREST. Duplicating the write
          // here would mean two definitions of the same decision.
          //
          // What stays here is the UX the trigger cannot do: the response flag
          // and the notifications.

          // Tell the people who own collection, not the crew in the driveway.
          // Wording is deliberately "balance"/"COD", never "payment" — in this
          // same function submit_for_payment means INSTALLER pay, and a crew
          // reading "payment hold" hears "we are not getting paid".
          //
          // The recipient chain MUST terminate somewhere real. On this database
          // today there are zero region_assignment rows, zero alert_group rows
          // and zero projects with a field_manager_id — so every configured path
          // resolves empty and the loop would run zero times. An observe-only
          // gate that alerts nobody observes into a void, which is worse than no
          // gate at all because it looks like coverage. Org admins are the
          // backstop; they always exist.
          const icIds = [region?.install_coordinator_id, project?.field_manager_id].filter(Boolean);
          let icRecs: any[] = [];
          if (icIds.length) { const { data } = await s.from('team_member').select('*').in('id', icIds); icRecs = data || []; }
          if (!icRecs.length) icRecs = await alertMembers(s, 'cod_uncollected');
          if (!icRecs.length) {
            const { data } = await s.from('app_user')
              .select('team_member:team_member_id(id, first_name, email, phone)')
              .eq('is_org_admin', true).eq('is_active', true);
            icRecs = (data || []).map((r: any) => r.team_member).filter((m: any) => m?.email);
          }
          // If even that is empty the exception row is still written above, so
          // the record survives — but say so in the logs rather than silently.
          if (!icRecs.length) console.error(`[gate2] COD hold on ${project_id} reached NO recipients — configure an install coordinator, an alert group, or an org admin.`);

          // Same reasoning as the asbestos stop: the inbox is the channel that
          // works today. Deliberately NO dollar figure — an inbox row is visible
          // to its recipient whatever module permissions they hold, and the
          // balance belongs behind the Finance screens.
          const codIds = icRecs.map((m: any) => m.id).filter(Boolean);
          if (codIds.length) {
            await s.rpc('notify_team_members', {
              p_team_member_ids: codIds,
              p_title: 'Balance outstanding at install start',
              p_body: `${customerName} started installation with a balance still outstanding. The crew was NOT stopped. Collect it, or record what was already taken.`,
              p_kind: 'alert', p_severity: 'crit',
              p_subject_type: 'project', p_subject_id: project_id,
              p_route: `/JourneyProjectDetail?id=${project_id}`,
              p_rule_key: 'cod_uncollected',
              p_dedupe_key: `cod:${project_id}`,
              p_requires_ack: true,
            });
          } else {
            await s.rpc('notify_role', {
              p_role_name: 'Operations',
              p_title: 'Balance outstanding at install start',
              p_body: `${customerName} started installation with a balance still outstanding. The crew was NOT stopped.`,
              p_kind: 'alert', p_severity: 'crit',
              p_subject_type: 'project', p_subject_id: project_id,
              p_route: `/JourneyProjectDetail?id=${project_id}`,
              p_rule_key: 'cod_uncollected',
              p_dedupe_key: `cod:${project_id}`,
              p_requires_ack: true,
            });
          }

          for (const m of icRecs) {
            await qEmail(s, cfg, m.email, `[Ops Team] Balance outstanding at install start — ${customerName}`,
              `Hi ${m.first_name || 'there'},\n\nThe Job Start Checklist was submitted for ${customerName} with ${fmtUsd(amountDue)} still outstanding.\n\nThe crew was NOT stopped — this is a record, not a block.\n\nThe balance is due before install starts. Collect it, or record what was already taken, here: ${url}`);
            await qSms(s, cfg, m.phone, `Floor Daddy: ${customerName} started install with ${fmtUsd(amountDue)} outstanding. Not blocked — please collect. ${url}`);
          }
        }
      }

      if (checklist_data?.verification?.material_shortage === true) {
        const cnt = checklist_data?.verification?.shortage_count || 0;
        const notes = checklist_data?.verification?.shortage_notes || 'No details provided';
        for (const m of await alertMembers(s, 'material_shortage'))
          await qEmail(s, cfg, m.email, '[Alert Team] ⚠️ Material Shortage / Discrepancy',
            `Material shortage reported on project ${project_id}.\n\nShortage count: ${cnt}\nDetails: ${notes}\n\nPlease review and coordinate.`);
      }
      if (step_key === 'floor_prep_checklist' && checklist_data?.change_order?.is_chargeable) {
        const co = checklist_data.change_order;
        const amt = co.amount || 'N/A';
        const desc = co.what_prep || 'No details provided';
        const calledIn = co.called_in_before_work ? 'Yes' : 'No';
        const regionName = region?.region_name || 'Unassigned';
        // Recipients: the region's Install Coordinator + Order Entry. If the customer's zip
        // matches no region (so no recipient IDs), fall back to the 'change_order' alert group
        // so the notification the UI promises always reaches someone once that group is set up.
        const ids = [region?.install_coordinator_id, region?.order_entry_id].filter(Boolean);
        let recs: any[] = [];
        if (ids.length) { const { data } = await s.from('team_member').select('*').in('id', ids); recs = data || []; }
        if (!recs.length) recs = await alertMembers(s, 'change_order');
        for (const m of recs)
          await qEmail(s, cfg, m.email, `[Ops Team] Change Order — Billable Floor Prep — ${customerName}`,
            `Hi ${m.first_name},\n\nA billable floor prep change order has been submitted for ${customerName}.\n\nCalled in for approval before work: ${calledIn}\nAmount: $${amt}\nWhat prep: ${desc}\nRegion: ${regionName}\n\nProject: ${url}`);
      }
      // cod_hold rides back on a 200: the submit succeeded and the crew is not
      // blocked. The client shows it as a notice, not an error.
      return { status: 200, body: { success: true, checkpoint, asbestos_halt: asbestos, cod_hold: codHold, amount_due: amountDue } };
    }

    case 'approve_prep': {
      const existing = await one(s, 'project_checkpoint', checkpoint_id);
      const checkpoint = await upsertCheckpoint(s, checkpoint_id, null, {
        status: 'Completed',
        checklist_data: { ...(existing?.checklist_data || {}), prep_approved_by_name: userName, prep_approved_by_email: userEmail, prep_approved_date: nowIso },
      });
      const { project, customer, customerName, url } = await projectCtx(s, project_id);
      if (customer) await qEmail(s, cfg, customer.email, '[Customer] Floor preparation complete and approved',
        `Hi ${customer.first_name || 'there'},\n\nFloor preparation is complete and approved. Installation can now begin.\n\nThank you for choosing Floor Daddy!`, true);
      const installer = await installerOf(s, project);
      if (installer) {
        await qEmail(s, cfg, installer.email, `[Installer] Prep Approved — Installation Unlocked — ${customerName}`,
          `Hi ${installer.crew_name},\n\nFloor prep has been approved by ${userName}. You are clear to begin installation.\n\nProject: ${url}`);
        await qSms(s, cfg, installer.phone, `Floor Daddy: Prep APPROVED for ${customerName}. Installation unlocked — you're clear to lay floor.`);
        await s.from('project_checkpoint').update({ checklist_data: { ...(checkpoint?.checklist_data || {}), installer_notified_date: nowIso, installer_notified_name: installer.crew_name } }).eq('id', checkpoint_id);
      }
      return { status: 200, body: { success: true, checkpoint } };
    }

    case 'submit_install': {
      const existing = checkpoint_id ? await one(s, 'project_checkpoint', checkpoint_id) : null;
      const prev = existing?.checklist_data || {};
      const merged = {
        ...prev,
        install_core: checklist_data?.install_core ?? prev.install_core,
        install_hard_surface: checklist_data?.install_hard_surface ?? prev.install_hard_surface,
        install_carpet: checklist_data?.install_carpet ?? prev.install_carpet,
        install_tile: checklist_data?.install_tile ?? prev.install_tile,
      };
      const fields = { status: 'Completed', checklist_data: merged, submitted_by_name: userName, submitted_by_email: userEmail, submitted_date: nowIso };
      const checkpoint = await upsertCheckpoint(s, checkpoint_id, { project_id, step_key, ...fields }, fields);
      const { customer, customerName, url } = await projectCtx(s, project_id);
      const region = await matchRegion(s, customer);
      if (region?.install_coordinator_id) {
        const ic = await one(s, 'team_member', region.install_coordinator_id);
        if (ic) await qEmail(s, cfg, ic.email, `[Install Coordinator] Midpoint Cleared — ${customerName}`,
          `Hi ${ic.first_name},\n\nFloor prep and installation are underway for ${customerName}. Midpoint has been cleared.\n\nRegion: ${region.region_name}\nProject: ${url}`);
      }
      return { status: 200, body: { success: true, checkpoint } };
    }

    case 'approve': {
      const checkpoint = await upsertCheckpoint(s, checkpoint_id, null, {
        status: 'Completed', approved_by_name: userName, approved_by_email: userEmail, approved_date: nowIso, rejection_notes: null,
      });
      const { project, customer, customerName, url } = await projectCtx(s, project_id);
      if (step_key === 'job_start_checklist') {
        for (const m of await alertMembers(s, 'job_started'))
          await qEmail(s, cfg, m.email, '[Alert Team] Job Started — Installation Underway',
            `Installation has started for ${customerName} (Project ${project_id}). Job start checklist approved by ${userName}.`);
        if (customer) await qEmail(s, cfg, customer.email, '[Customer] Your installation is underway',
          `Hi ${customer.first_name || 'there'},\n\nYour installer has arrived and your installation is now underway.\n\nThank you for choosing Floor Daddy!`, true);
      }
      const installer = await installerOf(s, project);
      if (installer) {
        await qEmail(s, cfg, installer.email, `[Installer] Approved: ${label} — ${customerName}`,
          `Hi ${installer.crew_name},\n\nYour ${label} for ${customerName} has been approved. You're clear to proceed.\n\nProject: ${url}`);
        await qSms(s, cfg, installer.phone, `Floor Daddy: Your ${label} for ${customerName} has been APPROVED. You're clear to proceed.`);
      }
      return { status: 200, body: { success: true, checkpoint } };
    }

    case 'approve_final': {
      const existing = await one(s, 'project_checkpoint', checkpoint_id);
      const checkpoint = await upsertCheckpoint(s, checkpoint_id, null, {
        status: 'PrepApproved',
        checklist_data: { ...(existing?.checklist_data || {}), final_approved_by_name: userName, final_approved_by_email: userEmail, final_approved_date: nowIso },
      });
      const { project, customerName, url } = await projectCtx(s, project_id);
      const installer = await installerOf(s, project);
      if (installer) {
        await qEmail(s, cfg, installer.email, `[Installer] Final Walkthrough Approved — Payment Unlocked — ${customerName}`,
          `Hi ${installer.crew_name},\n\nFinal walkthrough has been approved by ${userName}. Payment submission is now unlocked.\n\nProject: ${url}`);
        await qSms(s, cfg, installer.phone, `Floor Daddy: Final walkthrough APPROVED for ${customerName}. Payment submission unlocked.`);
        await s.from('project_checkpoint').update({ checklist_data: { ...(checkpoint?.checklist_data || {}), installer_notified_date: nowIso, installer_notified_name: installer.crew_name } }).eq('id', checkpoint_id);
      }
      return { status: 200, body: { success: true, checkpoint } };
    }

    case 'submit_for_payment': {
      const existing = await one(s, 'project_checkpoint', checkpoint_id);
      const merged = { ...(existing?.checklist_data || {}), ...(checklist_data || {}) };
      const checkpoint = await upsertCheckpoint(s, checkpoint_id, null, {
        status: 'Completed',
        checklist_data: { ...merged, payment_submitted_by_name: userName, payment_submitted_by_email: userEmail, payment_submitted_date: nowIso },
      });
      const { customer, customerName, url } = await projectCtx(s, project_id);
      const region = await matchRegion(s, customer);
      if (region) {
        const ids = [region.field_manager_id, region.install_coordinator_id, region.order_entry_id].filter(Boolean);
        if (ids.length) {
          const { data: recs } = await s.from('team_member').select('*').in('id', ids);
          for (const m of recs || [])
            await qEmail(s, cfg, m.email, `[Ops Team] Job Complete — Payment Submitted — ${customerName}`,
              `Hi ${m.first_name},\n\nThe final walkthrough is complete and payment has been submitted for ${customerName}.\n\nRegion: ${region.region_name}\nProject: ${url}`);
        }
      }
      if (customer) await qEmail(s, cfg, customer.email, '[Customer] Your installation is complete',
        `Hi ${customer.first_name || 'there'},\n\nYour installation is complete. Thank you for choosing Floor Daddy!`, true);
      if (merged?.five_star_review?.review_request_made) {
        for (const r of await alertMembers(s, 'five_star_review'))
          await qEmail(s, cfg, r.email, `[Review Team] 5-Star Review Request — ${customerName}`,
            `Hi ${r.first_name},\n\nA 5-star review request was made onsite for ${customerName}. Please close the loop and follow up.\n\nProject: ${url}`);
      }
      return { status: 200, body: { success: true, checkpoint } };
    }

    case 'reject': {
      const notes = rejection_notes || 'Please review and resubmit.';
      const checkpoint = await upsertCheckpoint(s, checkpoint_id, null, { status: 'Rejected', rejection_notes: notes });
      const { project, customerName, url } = await projectCtx(s, project_id);
      const installer = await installerOf(s, project);
      if (installer) {
        await qEmail(s, cfg, installer.email, `[Installer] Action Needed: ${label} Rejected — ${customerName}`,
          `Hi ${installer.crew_name},\n\nYour ${label} for ${customerName} was rejected and needs revisions.\n\nReason: ${notes}\n\nProject: ${url}`);
        await qSms(s, cfg, installer.phone, `Floor Daddy: Your ${label} for ${customerName} was REJECTED. ${String(notes).substring(0, 100)}`);
      }
      return { status: 200, body: { success: true, checkpoint } };
    }

    case 'resend_notification': {
      const cp = await one(s, 'project_checkpoint', checkpoint_id);
      if (!cp) return { status: 404, body: { error: 'Checkpoint not found' } };
      const { project, customer, customerName, url } = await projectCtx(s, cp.project_id || project_id);
      const region = await matchRegion(s, customer);
      const fmId = region?.field_manager_id || project?.field_manager_id;
      if (!fmId) return { status: 404, body: { error: 'No field manager assigned to this region or project' } };
      const fm = await one(s, 'team_member', fmId);
      if (!fm) return { status: 404, body: { error: 'Field manager not found' } };
      const cpLabel = STEP_LABELS[cp.step_key] || cp.step_key;
      const regionName = region?.region_name || 'Unassigned';
      const emailSent = await qEmail(s, cfg, fm.email, `[Field Manager] Approval Needed: ${cpLabel} — ${customerName}`,
        `Hi ${fm.first_name || 'Manager'},\n\n${cpLabel} has been submitted for approval and is awaiting your review.\n\nCustomer: ${customerName}\nSubmitted by: ${cp.submitted_by_name || 'Installer'}\nRegion: ${regionName}\n\nReview and approve here: ${url}`);
      const smsSent = await qSms(s, cfg, fm.phone, `Floor Daddy: ${cpLabel} submitted for ${customerName} in ${regionName}. Approval needed: ${url}`);
      return { status: 200, body: { success: true, emailSent, smsSent, fieldManager: `${fm.first_name} ${fm.last_name}` } };
    }

    case 'resend_installer_notification': {
      const cp = await one(s, 'project_checkpoint', checkpoint_id);
      if (!cp) return { status: 404, body: { error: 'Checkpoint not found' } };
      const { project, customerName, url } = await projectCtx(s, cp.project_id || project_id);
      const installer = await installerOf(s, project);
      if (!installer) return { status: 404, body: { error: 'No installer assigned' } };
      const emailSent = await qEmail(s, cfg, installer.email, `[Installer] Prep Approved — Installation Unlocked — ${customerName}`,
        `Hi ${installer.crew_name},\n\nFloor prep has been approved by ${userName}. You are clear to begin installation.\n\nProject: ${url}`);
      const smsSent = await qSms(s, cfg, installer.phone, `Floor Daddy: Prep APPROVED for ${customerName}. Installation unlocked — you're clear to lay floor.`);
      await s.from('project_checkpoint').update({ checklist_data: { ...(cp.checklist_data || {}), installer_notified_date: nowIso, installer_notified_name: installer.crew_name } }).eq('id', checkpoint_id);
      return { status: 200, body: { success: true, emailSent, smsSent, installer: installer.crew_name } };
    }

    default:
      return { status: 400, body: { error: 'Unknown action' } };
  }
}

/**
 * Actions that release a job, clear a safety stop, or move money. The UI shows
 * these only to a field manager, but the UI is not a security boundary: the
 * approval screen was reachable by editing a URL parameter, which meant a crew
 * could sign off their own work — including approving past the asbestos
 * hard-stop. Enforce it server-side.
 */
const APPROVAL_ACTIONS = new Set([
  'approve',
  'approve_prep',
  'approve_final',
  'reject',
  'submit_for_payment',
]);

async function canApprove(req: Request): Promise<boolean> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const [{ data: isAdmin }, { data: journey }, { data: projects }] = await Promise.all([
    asUser.rpc('is_org_admin'),
    asUser.rpc('can_edit', { m: 'journey' }),
    asUser.rpc('can_edit', { m: 'projects' }),
  ]);
  return !!(isAdmin || journey || projects);
}

// Weaker than canApprove on purpose: a crew member fills a checklist in but must
// not be able to approve it. Journey VIEW is the closest thing to "this person is
// part of the install workflow" until an installer role exists.
async function canParticipate(req: Request): Promise<boolean> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const [{ data: isAdmin }, { data: journey }, { data: projects }] = await Promise.all([
    asUser.rpc('is_org_admin'),
    asUser.rpc('can_view', { m: 'journey' }),
    asUser.rpc('can_edit', { m: 'projects' }),
  ]);
  return !!(isAdmin || journey || projects);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const s = svc();
  const internal = await getSecret(s, 'CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  let user: any = null;
  if (!isInternal) { user = await currentUser(req); if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors }); }

  try {
    const body = await req.json();
    if (!body?.action) return Response.json({ error: 'action required' }, { status: 400, headers: cors });

    if (!isInternal && APPROVAL_ACTIONS.has(body.action) && !(await canApprove(req))) {
      return Response.json(
        { error: 'Not authorized to approve, reject or release this checkpoint' },
        { status: 403, headers: cors },
      );
    }

    // EVERY OTHER ACTION was authenticated but not authorized: it ran as SERVICE
    // ROLE against a body-supplied project_id, so any logged-in account — with no
    // roles whatsoever — could submit a checkpoint for ANY project. Including
    // claiming asbestos, which halts the job and alerts management, on someone
    // else's install.
    //
    // The check is module-level, not per-project. There is no installer role and
    // no crew-to-project linkage in the schema yet, so "is this YOUR job?" is not
    // answerable here. Requiring the journey module blocks the zero-role account,
    // which is the actual hole, and breaks nobody who legitimately uses the
    // screen. Per-project scoping belongs with the subcontractor portal, when
    // crew membership actually exists to check against.
    if (!isInternal && !APPROVAL_ACTIONS.has(body.action) && !(await canParticipate(req))) {
      return Response.json(
        { error: 'Not authorized to submit checkpoints for this project' },
        { status: 403, headers: cors },
      );
    }

    const result = await handle(s, body, user);
    return Response.json(result.body, { status: result.status, headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
