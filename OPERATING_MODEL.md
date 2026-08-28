# RAZZLE DAZZLE — The Operating Model
## Demand to warranty, one journey, one engine

**Author's note on reconciliation.** Seven specialists designed seven segments and one designed the engine. Where they disagreed, I made a call and said so. Four rulings shape everything below:

1. **One stage spine, single-owner, monotonic.** Segment 4 was right that a ninth arbitrary stage key breaks `STAGES`, `STAGE_TONE`, `stageIndex` and `byStage`. But it was wrong that the answer is never to add keys. The rule is: **a new stage key exists only where the owning department, the SLA, and the definition of done are all genuinely different.** Everything else is a `substage` (material readiness ramp) or a `blocker` (holds, finance, compliance).
2. **Finance work after QA is not on the spine.** Segment 7 wants `final_billing`, `job_cost` and `sub_payable` as stages running in parallel with `cx_followup`. That makes `stageIndex` a lattice and breaks every ops board. Ruling: **the post-install spine is `qa → cx_followup → warranty_active`. Money is three cross-cutting obligation tracks** with their own tasks, SLAs and `crit` blockers. flow.js already reassigns a job's owner to whoever owns the critical blocker (`const owner = critical?.owner || def.owner`), so an unpaid balance moves the job into the Finance inbox *without moving its stage*. A customer must never wait on AR, and Finance's statutory 7/30-day sub-pay clock is not the customer's spine.
3. **Segment 4's `ready_to_schedule` and segment 5's proposed new `scheduling` stage are the same work.** One stage: `ready_to_schedule`, owned by Install Coordination, entered on `project.material_certified_at`, exited on a *confirmed* date. The duplicate key is dropped.
4. **`complete` is deleted as a terminal owner-null stage.** It is replaced by `warranty_active`, which has an owner, because a lifetime labor obligation that the system cannot represent is a liability nobody can size.

Two facts govern every line of this document:

- **RAZZLE DAZZLE is the operational system of record. RFMS is authoritative for material only.** Dates flow OUT to RFMS, never in.
- **RFMS Web API is UNCHECKED on Floor Daddy's install (customer 61152) and 0 of 8 integration credentials are configured.** Every RFMS touchpoint below is a design for a connected end-state. The operating model must be fully operable at zero integrations, and it is — except for material verification, which degrades to a named human attestation.

---

## 1. The journey at a glance

Legend: `⏱` = wall-clock, otherwise business hours (Mon–Sat 07:00–17:00, America/Phoenix). **Bold** stage keys are new to `src/lib/ops/flow.js`.

### 1a. Demand spine (entity `demand`)

| # | Stage | Dept | Role | Trigger | Definition of done (all data, no judgement) | SLA |
|---|---|---|---|---|---|---|
| 1 | **`demand`** | Marketing | Marketing Manager | GHL webhook fires (paid/Meta/chat/missed call), or CSR opens Checklist 2.0 cold | `lead.external_id` non-null (or `source_channel='inbound_call'`) AND `source_channel` + `source_campaign` non-null ('unattributed' legal, NULL not) AND (`phone_e164` valid OR `email`) AND `assigned_csr` AND `queued_at` non-null | **60s p95** webhook→queued lead; any lead with `queued_at − source_created_at > 5 min` is a Marketing blocker |
| 2 | **`lead_working`** | CSR | Assigned CSR (`lead.assigned_csr`) | `queued_at` set and `assigned_csr` non-null | Exactly one terminal outcome: **BOOKED** (`checklist_v2.appointment` non-null via `create_appointment_from_checklist`) or **DISPOSITIONED** (`lead.disposition` in closed vocab + `disposition_at`; `not_ready` needs `recall_date`; `no_contact_exhausted` needs ≥7 attempts over ≥14 days) | **First dial ≤5 min**, 90% target, hard ceiling 15 min. Live call ends booked-or-dispositioned. 7 attempts / 14 days |
| 3 | **`booked`** | CSR | Booking CSR (`appointment.assigned_csr`) — ownership is sticky until the DC is in the house | `create_appointment_from_checklist` returns an appointment id | **HELD**: `status='Scheduled'` AND `assigned_dc` AND `confirmation_sent_at` AND **`customer_confirmed_at`** AND `consultant_arrived_time`, all non-null | Confirmation ≤5 min; DC assigned ≤4 bh; **hard gate: no booking inside 48h without a DC**; `customer_confirmed_at` by T−24h; reconfirm T−2h |

### 1b. Appointment & close (entity `job`, appointment-backed)

| # | Stage | Dept | Role | Trigger | Definition of done | SLA |
|---|---|---|---|---|---|---|
| 4 | **`appt_on_site`** | Sales | Design Consultant (`appointment.assigned_dc`) | `consultant_arrived_time` stamped (the timestamp, never the label) | `status` in the 7-outcome vocabulary AND **`appointment.outcome_recorded_at`** non-null | 4h from arrival; **hard stop 23:59 same calendar day** |
| 5 | **`sold_capture`** | Sales | DC (`sale.assigned_dc`); Sales Manager holds the only override | DC selects 'Sold' | `sale_pack_complete` = sale row + signed contract (esign `sealed_pdf_hash`, or wet-signed with `wet_signed_override_by`) + `sale_balance.amount_paid ≥ round(sale_amount*0.50,2)` (or `deposit_waiver_approved_by`) + ≥1 `sale_line` with product_code/qty/uom + `driver_license_photo_url` | **2h from `outcome_recorded_at`** (before the DC leaves the driveway); escalate 24h; money gate escalates to Finance crit at 48h and holds the job out of `to_order` |
| 5b | **`awaiting_signature`** | Sales | DC → Sales Manager at 72h | Contract sent for remote signature (`signature_request` for `sales_contract`) | `status='signed'` + `sealed_pdf_hash` + `signature_event` rows for `consented` and `signed` (+ `otp_verified` if required). Re-enters `sold_capture` with gate (b) met | 72h to escalation; auto-void at `expiry_days` (14) |
| 6 | **`rehash_queue`** | Sales | **Sales Manager owns the queue**; originating DC works the touches | `status` in (Pitch and Miss, One-Leg, Follow-Up) + `outcome_recorded_at` | Sold (re-enters `sold_capture`), OR Lost + `not_sold_reason_code`, OR `rehash_closed_at` with disposition `nurture` | First touch 48h; dispositioned in 14 days; 4 logged attempts (+2/+5/+10/+14) |
| 7 | **`credit_rework`** | Sales + Finance | Sales Manager jointly with Finance | `status='Credit Decline'` | A `finance_application` row with a decision exists, AND one of: sale exists / Sold with non-financed method / Lost with `not_sold_reason_code='credit'` | **5 business days** |
| 8 | **`lost_closed`** | Marketing | Marketing owns nurture; Sales Manager owns reason-code integrity | `status='Lost'`, or rehash/credit dispositioned to nurture | `not_sold_reason_code` non-null (closed vocab) AND `nurture_handoff_at` (or recorded consent refusal). Terminal | No stage SLA; **reason code within 24h** |

### 1c. Ordering (entity `job`, sale/project-backed)

| # | Stage | Dept | Role | Trigger | Definition of done | SLA |
|---|---|---|---|---|---|---|
| 9 | `to_order` | Ordering | Order Processor stamped on `project.order_entry_id` | `convert_to_sale` commits; `sale.invoice_number IS NULL` | **The order round-trips**: `invoice_number` non-null AND `rfms_sync_status='synced'` AND `rfms_order_data->'result'->>'number'` = `invoice_number` AND soldTo surname matches. Degraded: format-valid CG number + actor-stamped human verification + `order_source='manual'` | **1 business day**, clock **paused** while a blocking DC ticket is open (today's flat 2 days with no pause is wrong in both directions) |
| 10 | **`order_entry`** | Ordering | Same Order Processor (never hand a half-entered order to a second person) | Verified CG number exists | ≥1 line with both `lines[].id` and `lineNumber` persisted; every material line `quantity>0` and `unitCost>0`; `|order.totals.total − sale.net_amount| ≤ max($25, 0.5%)` or an approved change order; **zero material lines at status `None`** | 1 bd (2 bd for builder/multifamily) |
| 11 | **`material_ordered`** | Ordering | **Purchasing Coordinator** (role does not exist in `team_member.role` — add it, even if one person wears both hats) | Every material line at `GenPO` | **A real PO exists per material line**: `purchaseorder/find` returns `purchaseOrderNumber` with `amountOrdered ≥ line qty`, OR the line is `Cut`/`Resvd`/`Del` from stock. No line at `None` or `GenPO` | 1 bd (2 bd special order). **Wall target: SOLD → PO RAISED IN 3 BUSINESS DAYS** |
| 12 | `awaiting_material` | Ordering | Purchasing & Receiving Coordinator | PO raised, material not yet certified | `project.material_certified_at` stamped by a **named certifier**, roll-up = MATERIALS DELIVERED, `shortLines = 0`, verified by post-write order re-read | **The promise date is the SLA**, per line, worst line wins — not a flat 14 days. 14 days survives only as the degraded fallback when no `promiseDate` is obtainable |

`awaiting_material` substages (no new stage keys — `classifyJob()` returns `substage`, `substageLabel`, `rollup`, `readiness{}`, `certifiedAt`):

| Substage | RFMS roll-up | Exit | Sub-SLA |
|---|---|---|---|
| `mat_no_lines` | NO LINES | ≥1 material line with `productId` | 1 bd — this is a data defect, not a delay |
| `mat_not_allocated` | MATERIALS NOT ALLOCATED | zero lines at None/GenPO | 2 bd; promise date must exist within 2 bd of PO |
| `mat_on_order` | — | zero lines OnOrder, `amountRemaining = 0` | breach = `today > promiseDate` |
| `mat_exception` | — | `material_exception` row with resolution + a `communication` row proving the customer was told | Ordering 1 bd to revise; relay 1 bd to tell the customer |
| `mat_allocated` | MATERIALS ALLOCATED | roll-up = MIN over lines, `shortLines = 0`, store codes match | complete by install − 5 bd |
| `mat_delivered` | MATERIALS DELIVERED | every line Staged/Delivered, verified by re-read, `material_certified_at` stamped | certify within 1 bd of last line reaching Cut |

### 1d. Install (entity `job`)

| # | Stage | Dept | Role | Trigger | Definition of done | SLA |
|---|---|---|---|---|---|---|
| 13 | `ready_to_schedule` | Install Coordination | Install Coordinator (`project.install_coordinator_id`, defaulted from `region_assignment`) | `material_certified_at` stamped AND not stale AND `installation_date IS NULL` | `installation_date` + **`installation_date_confirmed_at`** + `held_crew_id` + a `crew_day_booking` row + a `communication` row recording the customer's agreement. **A date with no confirmation is a hold, not a schedule** | Offer within 2 bd, booked within 3 calendar days — **clock starts at `material_certified_at`, not `rfms_sync_date`** |
| 14 | `scheduled` | Install Coordination | Coordinator issues the Work Order; Field Manager owns crew readiness after acceptance | `installation_date_confirmed_at` set | Work order issued **and accepted** by the crew | **2 days** (today `sla: null` — the stage with the most ways to fail is the only one with no clock) |
| 15 | **`crew_assigned`** | Install Coordination → Field | Crew Lead accepts; Field Manager owns readiness | `work_order_accepted_at` stamped | `work_order_id` + `work_order_accepted_at` + crew compliance valid at install date + `pre_install_call_completed_date` + material ready-or-attested + balance settled or COD recorded | WO issued ≤1 bd of confirmation; accepted ≤2 bd **and no later than install − 5 calendar days**, whichever binds first |
| 16 | `in_progress` — **"Install Day"** | Field | Crew Lead performs (controls means and methods); Field Manager owns the day | `installation_date ≤ today` and WO accepted | Walkthrough signed, zero open punch items, close-out photos → `actual_completion_date` = date of the **signed walkthrough event** | **Duration-aware: `(scheduled_end − scheduled_start) + 1`**, not a flat 2 days. Outcome or explicit CONTINUING TOMORROW captured before 20:00 each day |
| 17 | `qa` | Field / Install Coordination | Field Manager (the crew can never approve its own work — `APPROVAL_ACTIONS` + `can_edit`, enforced server-side) | Final walkthrough `SubmittedForApproval` | `qa_completed_date` + `project.status='Completed'` + warranty fields stamped + close-out package complete + **contract-labor cost row written** | **1 bd** — it gates installer payment and the customer's completion email |
| 17b | **`punch_open`** | Install Coordination | Coordinator schedules; **original crew cures** (FD-02 §1.3/§3.3 first-right-to-fix) | Any `punch_item` open at customer acceptance | Every item `cured_at` + cure photo, OR `waived_by_customer_at` + signature, OR converted to a claim. Last close sets **`contract_completion_date`** | **5 bd** — deliberately tighter than the FD-02 10-bd claim window; emergency same day |

### 1e. Post-install (entity `job`)

| # | Stage | Dept | Role | Trigger | Definition of done | SLA |
|---|---|---|---|---|---|---|
| 18 | `cx_followup` | Customer Experience | CX Coordinator | `actual_completion_date` set — **runs in parallel with the money tracks** | `check_in_completed_date` non-null AND a warranty-certificate `communication` row with `delivery_status='delivered'` — OR three logged attempts across ≥2 channels. **Tightened**: today `cxDone = check_in || welcome_call`, so a pre-install-flavoured welcome call satisfies the post-install gate | Check-in within 2 bd; whole sequence closed by T+10 |
| 19 | **`review_referral`** | Marketing | Marketing Manager (executed by CX in the same call) | Check-in complete AND (score ≥9 or T+7 passed) AND `payment_status='paid'` AND no open claim | A `review_request` row in a terminal state AND a referral disposition (referral row / `asked_declined` / `not_asked` + reason) | Sent within 1 bd of qualification. **No escalation** — it expires at 7 days. Chasing a customer for a review is worse than not asking |
| 20 | **`warranty_active`** | CX holds the record; Operations owns any claim | CX Coordinator; Field Manager on a live claim | CX closed, warranty minted | Resting state. Entered correctly when: `labor_term='lifetime'`, `worry_free_expires_at` = completion +12mo, `sub_liability_expires_at` = completion +2y, ≥1 sub attributed with portion, sealed walkthrough PDF referenced | None. Two dated obligations hang off it: 21-month sub-liability warning, retention release at completion +90 |
| 20b | **`claim_cure`** | Operations owns the cure; CX intakes; Finance executes any back-charge | Field Manager who conducted **the original walkthrough** makes the determination (FD-02 §3.5) | `project_claim` created — **re-entrant**: pulls the job back onto the active board | `cured_at` + customer confirmation, OR `determination='not_covered'` with the written §3.5 determination, OR a `back_charge` row passing the six-element constraint and within cap | **Contractual, in business days**: acknowledge 1 bd, schedule 3 bd, cure 10 bd, emergency same day. Back-charge branch: Master §7.6 **14-day** itemized statement — target day 7, hard stop day 12, or the offset right is forfeited |

### 1f. Cross-cutting obligation tracks (owned by Finance, expressed as blockers not stages)

| Track | Trigger | Done when | SLA |
|---|---|---|---|
| **Final billing** | `actual_completion_date` set | `sale_balance.balance_due ≤ 0` OR an `ar_arrangement` with a promised date and a named approver | Retail 3 days (§7.5 means a post-install retail balance is by definition an exception); builder invoice ≤2 bd then contract terms |
| **Job costing / GP** | Balance settled OR completion + 5 bd, **whichever comes first** | `sale_gross_profit()->>'costs_complete' = true` AND a `gp_reconciliation` row within $1.00 of RFMS `NetSales`, or a stored variance reason | 5 bd — the job must cost inside the month it completed |
| **Subcontractor pay** | Close-out package complete + walkthrough approved | `sub_payment` row `paid` with gross/retention/offsets/net + conditional waiver id + payment reference, plus a paired retention-release row due completion +90 | **The earlier of (customer payment +7 days) and (completion +30 days)** — A.R.S. § 32-1129.02, not negotiable. Escalate at T−5 and T−1, *before* the breach |

---

## 2. Department playbooks

`flow.js` `DEPARTMENTS` today is `sales, ordering, scheduling, install, cx, finance`. **Three departments must be added: `marketing`, `csr`, `field`.** Without `field`, `departmentView()` cannot tell "waiting on the crew" from "waiting on the Field Manager" — the single most common handoff in the whole install phase.

### Marketing
**Owns:** the `demand` stage, the lead-source vocabulary, and `lost_closed` nurture.
**Inbox:** the Unattributed queue (`source_channel='unknown'`); the nightly GHL reconciliation delta; leads unworked past 4 business hours, **priced on screen with the dollar cost of that lead** (spend ÷ leads for its campaign that week); Stage-2 dispositions by campaign — `below_minimum` clustering in one ad set is a targeting defect, not a CSR defect.
**Must produce before handing on:** a lead row with a real phone or email, a resolved source, a servicing region, an assigned CSR and a `queued_at`. Ingestion is spending the CSR's 5-minute budget; anything over 60 seconds has eaten a fifth of it.
**Accountable for:** cost per booked appointment and cost per sale **by campaign** — impossible today because `MarketingPerformance.jsx` joins an aggregate GHL count to an aggregate appointment count to an aggregate sale count to a Google Sheet. There is no per-lead campaign join anywhere. Also: **held-rate and no-show-rate by source**, which is the real channel-quality number, not booked-rate.
**Also owns the RFMS ad-source map.** No endpoint anywhere in the API enumerates `adSource`, yet it is a filter on `POST /v2/order/find/advanced` and a field on the order header. RD owns the vocabulary and maintains a hand-verified map, round-tripped through that filter.

### CSR / Front Office
**Owns:** `lead_working` and `booked`. Booking ownership is **sticky** — the booking CSR owns the appointment until the consultant is standing in the house.
**Inbox:** the Lead Queue with a 5-minute clock; `lead_attempt_{n}` tasks on the day-0/1/3/7/14 cadence; `appointment_confirm` (auto-completed by `customer_confirmed_at`); `appointment_reconfirm` at T−2h; `appointment_no_show_followup` within 30 minutes; `stale_checklist` at 24h.
**Must produce:** a booked appointment against **real capacity** (a live availability grid, not a free-text block picker), with a DC assigned before the confirmation goes out, a verified geocoded address, a history check, and a customer who has actively confirmed.
**Accountable for:** speed-to-lead, contact rate, book rate, and **held rate** — a CSR who books well and holds poorly is overselling on the phone.
**Plainly blocked today:** `task.due_date` is a DATE. A 5-minute speed-to-lead task and a T−2h reconfirm are *literally unrepresentable*. Nothing in this playbook can be implemented until the task table is fixed.

### Sales / Design Consultants
**Owns:** `appt_on_site`, `sold_capture`, `awaiting_signature`, `rehash_queue` (Sales Manager owns the queue, the DC works the touches), `credit_rework`.
**Inbox:** today's appointments with no outcome by 20:00; incomplete sale packs; unsigned contracts at 72h; rehash touches at +2/+5/+10/+14; `variance_approval` and `gp_review` from Ordering; **"we are blocking Ordering"** — `departmentView()` already computes this list and nothing consumes it for Sales.
**Must produce:** a complete sale pack. Signed contract, 50% deposit **in the payment ledger**, ≥1 `sale_line` with a real RFMS product code and a unit of measure, driver's licence photo. Soft: folder photo, yard sign (or opt-out), product photos.
**Accountable for:** close rate, GP on the *final* change-order-adjusted sale amount, outcome-capture discipline, and the honesty of `not_sold_reason_code`. A DC whose losses are 90% "price" is usually not describing a price problem.
**Never:** the DC creates nothing in RFMS. The first RFMS write for any job happens at SOLD, and order creation belongs to Ordering in `to_order`.

### Ordering / Order Processing
**Owns:** `to_order`, `order_entry`, `material_ordered`, `awaiting_material`. Three genuinely distinct pieces of work that are collapsed into two stages today — which is why a job with lines entered and no purchase order looks identical to one whose material is in transit.
**Inbox:** the **derived** ordering queue (`buildOrderingQueue()` already selects every live sale with no invoice number — a job cannot be forgotten out of it, only ignored); `order_entry`, `line_entry`, `raise_po`, `supplier_chase`, `po_slip`, `mat_receive_verify`, `mat_transfer_needed`, `mat_certify`.
**Must produce:** a **certification**. Not a status, not a label — `project.material_certified_at` with a named certifier, a source (`rfms|manual`), a roll-up and a staleness horizon. That certification is the artifact Scheduling consumes and the thing that stops Scheduling inheriting Ordering's aging.
**Accountable for:** sold → PO raised in 3 business days; promise-date accuracy; zero short lines at certification.
**The single most dangerous false positive in the company:** treating Gen PO as ordered. **Gen PO is a flag meaning "this still has to be bought."** `metrics.js` `STATUS_HELP.GenPO` currently reads "PO generated, not sent" — the exact inversion of the truth. Fix the copy and split the readiness ramp: None+GenPO = NOT PURCHASED (Ordering's problem); OnOrder = PURCHASED AND WAITING (the supplier's problem).

### Install Coordination (`scheduling` in flow.js)
**Owns:** `ready_to_schedule`, `scheduled`, `crew_assigned`, `punch_open`, and the schedule itself.
**Inbox:** the scheduling queue sorted by certification age then sale value; `issue_work_order`; `await_crew_acceptance` escalating at T−5 and T−3; `pre_install_call`; `verify_material_delivery`; `mat_uncommit_date` when material moves under a committed date; `schedule_punch_return`.
**Must produce:** a confirmed date, a compliant crew who has **accepted a written Work Order**, a duration, and a customer who knows what to expect.
**Accountable for:** held rate, reschedule count **by initiator** (`initiated_by='us'` is the number that should embarrass someone), crew utilisation.
**Plainly blocked today, and this is the biggest missing primitive in the whole design:** *there is no capacity model of any kind.* No crew-day, no crew-hours, no skills, no days off, no job-size estimate. `buildInstallBoard.crewLoad` counts **jobs per crew** — a 40-unit multifamily turn and a single bedroom count the same. `Dashboard.jsx:399` already narrates an `installCapacity` number with nothing behind it. Until `crew_capacity`, `crew_day_booking` and a job-days rate card exist, "schedule against capacity" is a slogan.
**Also blocked:** `region_assignment` carries zip codes, polygons, a field manager, an install coordinator and a preferred crew — and **nothing in the booking or scheduling path reads it.**

### Field (crews + Field Manager) — *new department*
**Owns:** `in_progress` and the crew half of `crew_assigned`. The Field Manager owns the day; the crew controls its own means and methods (FD-01 §3.2 — the app must issue scope and results, never instructions that read as supervision of the manner of work).
**Inbox:** the 07:00 day sheet; checkpoint approvals (`approve_job_start`, `approve_floor_prep` — the prep gate is the one where a crew is *physically idle*, so 60 minutes is the outer defensible limit); exception resolutions; `capture_completion` at 09:00 next day, which **must never auto-close**.
**Must produce:** field-captured timestamps and photographs, a signed Completion Certificate, and an honest punch list.
**Accountable for:** completion capture on the day, callback rate, and the integrity of the walkthrough record — which FD-02 §2.4 makes the baseline against which every future claim is evaluated.
**Plainly blocked today, and it blocks four stages:** **crews have no logins and never will.** `installer` has five columns (crew_id, name, email, phone, is_active) and no auth user. `installerMode` is a *URL query parameter*. `notifyInstallerAssigned` texts the crew a link to a page behind the auth guard, which they cannot open. Every day-of capture, every Work Order acceptance, every punch cure and the completion date itself depend on solving this. The answer already exists twice in this codebase: `installer_application.public_token` + `installerUpload`, and `signature_request.token` + the esign engine. **Crew Pass**: a per-job, per-crew capability token, SMS-delivered, no account, valid 04:00 install-day → 04:00 after `scheduled_end_date`, authorising SUBMIT actions only and **categorically barred server-side from every `APPROVAL_ACTION`**.
**Second blocker:** compliance data lives on `installer_application` and `roc_licensee`, not on the crew record. FD-01 §4.1 requires an active ROC licence at acceptance of *every* Work Order, §4.2 requires the right classification (R-8/C-8/CR-8 floor covering, R-48/C-48/CR-48 tile). Assignment cannot check what the contract requires it to check.

### Finance
**Owns:** the three obligation tracks — final billing, job costing/GP, subcontractor pay/retention/waivers — plus deposit clearance and back-charge execution.
**Inbox:** the AR board built on `sale_balance`; `order_entry` deposit gates; `price_and_post_change_order`; `release_installer_payment` with a statutory hard date; `assemble_backcharge_evidence`; the weekly GP-variance review; low-GP reviews fired **pre-commit at `order_entry`**, not after the order is built.
**Must produce:** a deposit receipt (mandatory today under DECISIONS §2 and never issued), a costed job with all four GP components, a paid sub with a conditional waiver on the statutory A.R.S. § 33-1008 form, and a retention balance that actually exists.
**Accountable for:** GP per the **one** definition — Revenue − (material + contract labor + finance dealer fee + sales commission), on a **tax-exclusive** denominator.
**Plainly broken today:**
- Migration 0051 shipped `public.payment`, `sale_balance` and `sale_gross_profit()` and **not one line of `src/` reads any of them.** `Finance.jsx` is a list of projects filtered on a free-text `installation_date_status`.
- `convert_to_sale` writes `sale.deposit_amount` but never inserts a payment row, so **every sale created since 0051 reads `amount_paid = 0` and `payment_status = 'unpaid'`** on a job where the DC physically collected 50% at the table.
- `GrossProfitReport.jsx` computes material-only margin on a **tax-inclusive** denominator, overstating margin by ~3.6 points at a 5.63% effective TPT rate — and the low-GP alert threshold reads from it.
- There is no subcontractor payable, retention or lien-waiver table of any kind. Master §7.2, §7.4, §7.6 and Exhibit B are entirely unimplemented — which also means `cost_labor`, one of the four GP components, **has no source**.

### Customer Experience
**Owns:** `cx_followup`, `warranty_active`, and claim intake.
**Inbox:** `cx_check_in` (T+1), `cx_satisfaction` (T+7), `cx_30day` (automated SMS, not a human task), `warranty_stamp`, `claim_ack` on a 1-business-day contractual clock, `worry_free_11mo`.
**Must produce:** a completed check-in, a **delivered** warranty certificate, and a claim record with real timestamps.
**Accountable for:** claim clock compliance, review conversion, referral capture, and the retrievability of the walkthrough record — FD-02 §6.4 requires retention for the warranty period **plus two years**, which is four years minimum and is a storage policy, not a nice-to-have.
**Plainly blocked:** `communication` has `lead_id`, `customer_id` and `appointment_id` and **no `project_id`**. Every install and post-install customer message is project-scoped, so "was the customer told?" cannot be made a data condition — and several definitions of done above require exactly that.

---

## 3. The handoffs

Stage is derived from data that has already changed, so a sending department **cannot be prevented from pushing**. The receiving department instead gets a **reject** action with a controlled reason, which:

1. inserts a `handoff_rejection` row (open);
2. makes `classifyJob()` emit a `crit` blocker owned by the **sending** department;
3. which the existing line `const owner = critical?.owner || def.owner;` **already** turns into an ownership reassignment — no new ownership logic required;
4. creates a priority-0 task on the sender with the reason and a 4-hour clock;
5. notifies at L2 immediately. This is rework; it should sting.

Ownership moves. **Stage does not.** That is honest — the job really is at `awaiting_material`, it is just Sales' problem again.

| Seam | Receiving dept accepts only if | Rejection reasons | What happens today |
|---|---|---|---|
| **Marketing → CSR** (`demand`→`lead_working`) | source resolved (or explicitly 'unattributed'), phone or email present, region matched, CSR assigned, `queued_at` stamped | `no_contact_method`, `unattributed`, `out_of_area`, `duplicate` | No handoff exists. There is no inbound webhook and no lead ingestion path at all — every lead arrives because a human typed it |
| **CSR → Sales** (`booked`→`appt_on_site`) | DC assigned, address geocoded, `customer_confirmed_at` present, no unresolved qualification flag (`prequal_below_minimum`, `scope_flag_out_of_scope`, `prequal_dm_track`) | `no_dc`, `bad_address`, `unconfirmed`, `below_minimum`, `out_of_scope`, `dm_absent` | Qualification gates are **captured and then ignored** by `canConvert` (ChecklistV2Detail.jsx:214-221), which checks only name, phone, date, block and `heard_about_us`. A consultant can be dispatched to a job the CSR already flagged as below minimum |
| **Sales → Ordering** (`sold_capture`→`to_order`) | signed contract · deposit **in the ledger** · product/style/colour per room · measure quantities in **square feet** with an explicit uom · address validated | `missing_contract`, `missing_deposit`, `incomplete_selection`, `missing_measure`, `bad_address` | The Sold gate lives in a React button's `disabled` attribute. `handleSubmitStatus` re-checks three things; deposit method, amount, check number, check date and installation date are enforced **only** in the disabled expression — and the page has an `?action=sold` deep link |
| **Ordering → Scheduling** (`awaiting_material`→`ready_to_schedule`) | `material_certified_at` non-stale · every line `Del`/`Resvd`/`Cut` **or** an explicit `material_override` with a named grantor, a reason and an expected-by date · no finance hold · no open change order | `material_short`, `no_eta`, `stale_certification`, `finance_hold`, `open_change_order` | **This seam is inverted.** flow.js's final `else` assigns `ready_to_schedule` whenever material is null or has no lines — so with RFMS disconnected, *every ordered job in the company classifies as Ready to Schedule*. Unknown must HOLD, not release |
| **Scheduling → Field** (`crew_assigned`→`in_progress`) | crew compliance valid at install date · **Work Order accepted** · duration set · material located · access confirmed · pre-install checklist approved | `no_crew`, `compliance_lapsed`, `wo_unaccepted`, `material_not_located`, `no_access`, `checklist_incomplete` | There is no Work Order artifact, no acceptance, no compliance check and no crew identity. FD-01 §1.2 is explicit that **no engagement exists until the crew accepts a written Work Order** — so today "assigned" is a field on a row, not an agreement |
| **Field → QA/CX** (`qa`→`cx_followup`) | `actual_completion_date` captured **at the site** · completion photos per area · customer signature · zero open punch (or `punch_open` branch entered explicitly) | `no_completion_stamp`, `no_photos`, `no_signature`, `punchlist_open` | `submitCheckpoint` writes **nothing** back to the project. A job can pass all four checklists, be FM-approved and submitted for payment while flow.js still shows `in_progress` with a permanent `not_closed` crit blocker |
| **CX → warranty_active** | check-in logged · warranty entitlement stamped · balance zero or on a written plan · review requested-or-dispositioned | `no_checkin`, `no_warranty_record`, `balance_outstanding` | `complete` is terminal with `owner: null`. Nothing after the follow-up call is represented at all |

**Ping-pong guard.** The second rejection on the same job within one stage auto-escalates to the Operations Manager with both rejection records attached, and **the Ops Manager — not either department — assigns the next owner.** Two departments arguing through the app is a management event, not a workflow state.

**The metric that changes upstream behaviour.** `departmentView(flow, dept).weAreBlocking` already exists. Give it a companion: *how often does work you sent come back?* Every rejection and resolution lands in `workflow_event`, so this is a query, not a survey.

---

## 4. RFMS integration map

**RAZZLE DAZZLE is the operational system of record. RFMS is authoritative for material only.** Dates flow OUT. Schedule, tasks, payments ledger, claims workflow, warranty entitlement and customer comms all live in RD and are correct with zero RFMS.

**Current state, stated plainly:** Web API is **UNCHECKED** on Floor Daddy's install (customer 61152). **0 of 8** integration credentials are configured. `rfmsContext()` returns null; `rfmsQuery` answers `{stub:true}`. Order creation, line writes, Reserve, Cut and job create/update are **Enterprise-only** and there is no line-less create variant at any lower tier. Do **not** build on a TPD key — a TPD session is granted Plus regardless of the store's level and reads as a **ceiling** that can never reach Enterprise.

| # | Journey moment | R/W | Endpoint | What moves | Degrades to |
|---|---|---|---|---|---|
| 1 | All stages — the connection | both | `POST /v2/session/begin` (Basic `storeQueue:apiKey`, no body) → Basic `storeQueue:sessionToken` | Sliding-expiry session. `sessionExpires` is `'M/d/yyyy h:mm:ss tt zzz'` — **never `Date.parse` it**. No logout, no introspect. Refresh on auth-failure | Everything below is dark. **Note `_shared/rfms.ts` `sessionAuth()` builds `Basic(storeId : sessionToken)` — the docs require the storeQueue. As written this likely 401s on every post-session call. Five-minute test, everything depends on it** |
| 2 | Lead ingest / booking — repeat-buyer detection | read | `POST /v2/customers/find` (Standard; matches in `detail[]`, `result` is always `[]`) | Existing customer / warranty caller / referral. Cache on `lead.rfms_customer_id` | Local match on normalized E.164 phone → email → surname+zip; flag `rfms_history_checked=false` so the DC brief says "RFMS not checked" rather than implying a clean new customer |
| 3 | Booking — existing order at this address | read | `POST /v2/order/find/advanced` (Plus; `stores` is the only required param) | Warranty visit misrouted as a measure; phase-2 job; builder address with an open contract. **The only order search matching phone/address/PO/job number, and the only place `voided` and `closedDate` appear anywhere in the API** | Local address match on `project`/`sale`. Time-box it so a slow RFMS never blocks a booking |
| 4 | **Never** — leads and appointments | write | `POST /v2/customer/`, `POST /v2/opportunity` | — | **Deliberate non-integration.** `POST /v2/opportunity` is CREATE-ONLY: no update, no stage change, no Won/Lost, no delete at any tier. RD would open opportunities it could never close. A lead has no material, and RFMS is material-authoritative. Stages 1–3 ship at full fidelity with zero credentials |
| 5 | `appt_on_site` — measure sheet | read | `POST /v2/product/find` (Plus, fixed 10/page) → `POST /v2/product/get` | `productId`, `colorOptions[].id`, supplier, price levels, and **`saleUnits`** — which decides the unit conversion per line. `activeProduct` is absent from `/find`, so a discontinued style needs the `/get`. The live payload misspells the colour attachment key as **`attactments`** — quote it exactly | **Nightly catalog snapshot via the licensed Product Import/Export path, which does NOT need the Web API.** This is the v1 requirement, not a fallback. Free-text product names are never permitted, connected or not |
| 6 | `appt_on_site` — "do you have it in stock" | read | `POST /v2/product/inventorycheck` (Plus, exact match) | `availableQuantity`, `rollNumber`, `inventoryLink`. Filter `isOnOrder:true` — that stock has not landed. **Takes no soft hold**, so two DCs can be shown the same roll | Hide the panel; say "availability confirmed at ordering". Never render it as a reservation |
| 7 | `sold_capture` — customer master | write | `POST /v2/customer/` (**trailing slash is load-bearing**) | Creates when `customerId` omitted, updates when present. No documented duplicate check | Durable queue with exponential backoff, already correct in `rfmsQuery`/`processJobs`. **BUG: `processJobs/index.ts:333` posts to `/customer/create`, which does not exist in the 86-endpoint collection.** Latent only because nothing is connected; guaranteed to fail on day one. Both saved 200 examples have empty bodies, so read the id back via `customers/find` |
| 8 | `to_order` — create the order | write | `POST /v2/order/create` (**ENTERPRISE ONLY**, supports `messageId`) | The CG order. Body **must** carry `"category":"Order"` or RFMS creates a Web Order, which can never be given a billing group. Stamp `poNumber` = sale id, `jobNumber` = project id — the only fields advanced search can find, hence the retry-safety net. Set both `storeCode` and `storeNumber` | Keyed in the desktop; CG number typed into `sale.invoice_number` with `order_source='manual'` and an actor-stamped human verification |
| 9 | `to_order` / `order_entry` — verify + read lines | read | `GET /v2/order/{number}?locked=false` | Round-trip verification; `lines[].id` AND `lineNumber` (**the API splits its write surface between them** — `save/linestatus` takes ids, reserve/cut/stage/deliver/PO-find take numbers); `totals{}` | `sale.rfms_order_data` stays null; reconcile against a shadow line list typed from the contract. **Always `locked=false`** — taking a lock is Plus, releasing via `GET /v2/unlock/:id` is Enterprise, and locked orders are the #1 documented cause of card payments failing to post |
| 10 | `order_entry` — write lines | write | `POST /v2/order` (header Plus, **LINES ENTERPRISE**; sparse merge) | Adds omit `id`, edits include it, deletes are `{"id":N,"delete":true}`. **A dropped `lines[].id` silently CREATES A DUPLICATE LINE instead of erroring.** **THE NOTES TRAP: `{number, privateNotes}` appends; `{number, privateNotes, poNumber}` REPLACES** | Lines entered in the desktop. Architectural guard, in `_shared/rfms.ts`: the order-update client **rejects any body containing both a note field and a non-note field** |
| 11 | Any note, any stage | write | `POST /v2/order/notes` | Appends unconditionally, survives job costing and the post-book lock. Already correct in `rfmsQuery` `append_note` | Notes live in `project_log`. Prefix every generated note with a unique marker — appends are not idempotent |
| 12 | `order_entry` — flag lines to be bought | write | `POST /v2/order/save/linestatus` `{orderNumber, lineIds[], setToGeneratePO}` | None ⇄ GenPO. **The only reversible transition in the entire 86-endpoint API**, and therefore the only line-status write safe to automate. Precondition (stated twice): lines must currently be None or GenPO. **It does not create a purchase order** | Desk sets the flag in Core; RD tracks the intent as a task |
| 13 | `material_ordered` / `awaiting_material` — the PO watch | read | `POST /v2/order/purchaseorder/find` (**body key is `number`, not `orderNumber`**) | **The ONLY material-ETA source in the API.** `purchaseOrderNumber` (order + 4-digit sequence, e.g. `CG1051590001`), `supplierName`, `amountOrdered/Received/Remaining`, `promiseDate`, `requiredDate`, `status`, `trackingNumber`. Reachable only via an order+line you already know — **no list by supplier, status, date or PO number** | A visibly-marked manual PO record, **superseded not merged** when the API answers. Store a promise-date **history** — there is no change feed for POs anywhere, so RD's own history is the only way a slip is detectable |
| 14 | `awaiting_material` — allocation | write | `POST /v2/order/inventory/reserve` · `/cut` (Enterprise, identical bodies) | Assign a roll to a line. Never set `width` on a line intended for reservation — it converts the line to unreferenced | **Named human confirm dialog, permanently, connected or not. There is no un-reserve or un-cut endpoint at any tier.** Reserve returns an unstructured string; Cut has no published response — verify by re-reading the order |
| 15 | `awaiting_material` — stage & deliver | write | `POST /v2/order/inventory/stage` · `/deliver` `{orderNumber, orderDate, lines:[lineNumbers]}` | **Floor Daddy has ERRM ON**, so Deliver consumes inventory AND posts real-time journal entries, and stamps the date driving AR aging and commission basis. `orderDate` is misnamed — it is the stage/deliver date in **MM-DD-YYYY**, unlike ISO elsewhere. Deliver returns the literal string `'Cut Lines Processed'` and **names no lines** | **Warehouse prints the picking ticket in Core. This degradation is safe and arguably preferable for phase 1** — it keeps a GL-posting call out of the integration until the store's version and Deliver's failure modes are probed on a sandbox order. Never blind-retry on `waiting`: no `messageId` idempotency is documented for any inventory write |
| 16 | `order_entry` — margin cross-check | read | `GET /v2/order/grossprofit/{orderNumber}` | `NetSales = TotalTransaction − TaxCost` (tax-exclusive, so revenue reconciles). **Never add `TaxCost` to a cost total** — despite the name it sits on the revenue side. Margin deliberately will not reconcile: RFMS computes GP **before commissions** while DECISIONS §3 subtracts commission and dealer fees | RD computes GP from its own four components with no external cross-check; flag as unreconciled |
| 17 | `ready_to_schedule` — crews and existing schedule | read | `GET /v2/crews` · `POST /v2/jobs/find` · `GET /v2/timeslots` · `GET /v2/statuses` + `GET /v2/jobstatusids` | Crew roster (space-padded fixed-width — trim). **Crews are referenced by NAME STRING everywhere; no endpoint accepts a crew id** — store `crews[].id` purely as a rename-detection key. Request dates MM-DD-YYYY, response dates differ. Cache both status vocabularies and **join on description, never array position** | Capacity is computed entirely in RD anyway — **RFMS exposes no capacity endpoint at any tier**, and `availability` is a static weekly boolean pattern with no hours, no PTO, no load |
| 18 | `crew_assigned` — push the schedule OUT | write | `POST /v2/job/create` (from order) · `POST /v2/job` (upsert) · `POST /v2/job/status` | **Omit `jobId` and it silently CREATES A DUPLICATE JOB.** At line level, omitting `lineId` is how you ADD a line. Implement the `jobChecks` override handshake with **PascalCase→camelCase renaming**. One order maps to MANY jobs (1:N, one per crew per date window) — RD's project→date model is 1:1 and must change | Queued; RD's schedule is authoritative. **Prerequisite: `ProjectsCalendarView.jsx:123` (`effectiveRfmsDate \|\| installDate`) must be removed and inverted before any of this ships**, or the system of record has been chosen and then quietly ignored |
| 19 | `qa` / claims — attachments | write | `POST /v2/attachment` `{documentNumber, documentType:'Order'\|'Claim', fileData(base64)}` | Sealed contract, measure sheet, Completion Certificate, claim photos. **Deferred job keyed on `sale.id`, fired when `invoice_number` lands** — the same trigger pattern `trg_sale_rfms_fetch` already uses | Supabase Storage is authoritative (private documents bucket, 0025; sealed-PDF path in the esign engine). Upload response undocumented, so keep your own attachment ledger. **`POST /v2/attachments` returns full inline base64 for every match with no metadata-only mode** — never list attachments on a photo-heavy order from a UI request path |
| 20 | Post-install — mirror a payment | write | `POST /v2/payment` (Plus) | **DELIBERATELY NOT WIRED IN V1.** Four independently sufficient reasons: (1) there is no void, refund, reverse or delete-payment endpoint anywhere; (2) RFMS defect v24.4 — a Check Number value overwrote the Check Register Account Code so the journal entry never posted, and Floor Daddy's flow is check-heavy; (3) v24.3 corrupted Commission Base on job-costed orders; (4) Last Journal Close and Last GL Close are both **12/31/23** | `public.payment` + `sale_balance` are the ledger of record from day one. **This is not a degraded mode — it is the design** |
| 21 | Claims | write | `POST /v2/claim/create` (Enterprise) · `POST /v2/claim/notes` (Plus) | Only when a supplier demands a CL number. Nothing in the body links a claim to an order — persist the mapping yourself. **There is no Get Claim and no Find Claims at any tier**; the only read-back is advanced search with `orderSearchType:'Claim'` | The `project_claim` row with its FD-02 clocks is authoritative and the entire cure cycle runs without RFMS |
| 22 | **Never**, at any stage | write | `POST /v2/order/provider` · `POST /v2/job/provider` · `POST /v2/payables` · `POST /v2/quote/:number/export` · `DELETE /v2/job/:id` · `GET /v2/cacherefresh` · `POST /v2/{quote\|order}/report/generate` with any `allow*` flag | Named so nobody adds them later. Provider returns **no record id**, has no get/update/delete at any tier, is non-idempotent, and with **Integrate Provider's Earnings ON** must balance by product code against service-line cost or the order will not job cost. Payables has no read, update or delete at all. `DELETE /v2/job/:id` needs only **Plus** while create needs **Enterprise** — a lower-tier credential can destroy work it cannot recreate. `cacherefresh` has a documented ~16-hour multi-customer DoS precedent. Report-generate with `allowAuthorization:true` (which is what the published sample ships) arms a card pre-authorization on an unauthenticated capability-token URL with **no documented revoke and no expiry** | n/a — permanent exclusions. Everything here stays a named human action in Core, or stays in RD |

**The unit trap, stated once and enforced everywhere.** Floor Daddy's RFMS is configured in **Square Yards**; RAZZLE DAZZLE talks square feet throughout. 1 sy = 9 sf. Store the canonical quantity in square feet with an explicit `uom` column on every line; **never store a converted value.** Convert only at the integration boundary, **per line, using that product's own `saleUnits`** from `/product/get` — not a global constant, because carpet genuinely is sold in square yards while LVP is not. Add a pre-flight assertion rejecting any outbound line whose converted quantity differs from the contract quantity by a factor within 1% of 9 or 1/9 — the two ways this bug presents. Getting it backwards is not a crash; it is a plausible-looking number on a purchase order.

**Blocking spike, Q4.** All three published `GET /v2/order/:number` samples truncate at 2500 characters just past `productId`. **It is not proven what the per-line material status field is called, or whether it exists on that response at all.** The readiness roll-up, the `material_short` blocker and `material_ordered`'s definition of done all hang on it. Capture one complete untruncated response on a real multi-line order in mixed states before building anything downstream.

---

## 5. The workflow engine

### 5.1 The one idea

`classifyJob()` is a **total pure function of data**. It says *where a job is and who owns it*. It is the only thing in the system that cannot lie.

A task is a **durable, addressable commitment by a named person**. It says *who moves next and by when*.

> **Data closes tasks. Tasks never close stages.**
> A stage never advances because someone ticked a box. An auto task disappears the moment its predicate stops being true — nobody "completes" it.

| Class | `source` | Created by | Closed by | Human tick? |
|---|---|---|---|---|
| **Derived** | `auto` | reconciler, while predicate true | reconciler → `auto_closed / data_satisfied` | **No.** Snooze-to-`waiting` or `waive` with a reason only |
| **Act-and-record** | `auto_once` | one-shot on an event | human, and completion **writes the fact** (`check_in_completed_date`, `actual_completion_date`) | Yes — but the write is the point; the tick is a side effect |
| **Discretionary** | `manual` | a person | a person | Yes |

"Call the customer" is not a status flip; it is a recording action whose artifact satisfies the derived predicate and closes the task on the next reconcile. One source of truth; the task list is a **view onto pressure**, not a parallel status model.

### 5.2 The task model

`0052_task_engine.sql` **extends** `public.task` — `MyTasks.jsx`, `uq_task_followup` and `backfill_followup_tasks()` all depend on it. Key additions: `subject_type` / `subject_id` (polymorphic across lead, appointment, sale, project, claim), `rule_key`, `stage`, `dept`, `assigned_role`, `priority`, `source`, `state`, `waiting_on` + `waiting_until`, **`due_at timestamptz`**, `escalate_after_hours`, `escalation_level`, `resolved_at`, `resolution`, `created_reason jsonb`.

Two constraints carry the whole design:

```sql
-- "Waiting" is only legitimate if it names a party AND a date.
alter table public.task add constraint task_waiting_needs_reason
  check (state <> 'waiting' or (waiting_on is not null and waiting_until is not null));

-- At most ONE live task per (subject, rule). Same proven pattern as uq_task_followup.
create unique index uq_task_rule on public.task (subject_type, subject_id, rule_key)
  where state in ('open','waiting') and rule_key is not null;
```

A legacy-status trigger keeps `MyTasks.jsx` alive on day one. Supporting tables: `task_rule` (**the SLA catalog lives in data, so the argument is settled without a deploy**), `dept_roster` (with `ooo_until` and `backup_member_id`), `task_notification`, `workflow_event` (append-only), `workflow_exception`, `handoff_rejection`, `stage_gate`, `job_flow_snapshot`, `job_flow_transition`.

**Assignee resolution — a person, or it's a violation.** `resolve_assignee(dept, subject_type, subject_id)`: (1) the named person on the row — `project.install_coordinator_id`, `project.field_manager_id`, `project.order_entry_id`, `sale.assigned_dc`, `appointment.assigned_csr`. These columns already exist and are **currently decorative**; this is what makes them load-bearing. (2) Dept roster primary, skipping anyone OOO. (3) Nothing → task created with `assigned_role` and null `assigned_to`, and an **E2 UNOWNED** exception within 15 minutes. An unassignable task is a management failure surfaced fast, not a silent drop.

**`job_flow_transition` is how the SLA argument gets won.** After 90 days you have real p50/p90 dwell per stage per department, and `STAGES[].sla` stops being a guess. Feed it through the existing `distribution()` in `metrics.js`.

### 5.3 Auto-generation rules

Selected — the full catalog is the union of the `tasksGenerated` blocks in the seven stage designs, seeded into `task_rule`. `⏱` = wall-clock.

| rule_key | Stage | Predicate | Task → assignee | Due | Escalation |
|---|---|---|---|---|---|
| `lead_first_contact` | `demand`→`lead_working` | `queued_at` set | Dial this lead → assigned CSR | **`queued_at` + 5 min ⏱**, priority urgent | +15m reassign to next CSR on rota + SMS CSR Team Lead; +60m Sales Manager, `crit` blocker; **+4 bh becomes a MARKETING-owned blocker labelled with the dollar cost of that lead** |
| `lead_attempt_{n}` | `lead_working` | previous attempt dispositioned 'no answer' | Next attempt → CSR | day 0/1/3/7/14 | **after attempt 4 the task reassigns to a DIFFERENT CSR** — a second voice measurably lifts contact rate and breaks the pattern where one CSR's dead list is nobody's problem |
| `stale_checklist` | `lead_working` | `checklist_status='active'`, no activity 24h | Close or convert → CSR | 24h | 72h → CSR Team Lead |
| `appointment_assign_dc` | `booked` | region routing resolved nobody | Assign a DC → Sales Manager | immediate if inside 48h | hourly inside T−24h |
| `appointment_confirm` | `booked` | no `customer_confirmed_at` | Live-call the customer → booking CSR | T−24h, auto-completed by the one-tap link | T−12h CSR Team Lead, T−4h Sales Manager |
| `appointment_no_show_followup` | `booked` | DC marks No-Show | "We stopped by and missed you" → booking CSR | 30 min ⏱ | — |
| `appt_no_outcome` | `appt_on_site` | arrived, status still On Site at 20:00 | Record the outcome → DC | same day ⏱ | 09:00 next day → Sales Manager; 48h → org admin |
| `sold_pack_gate` (one per missing gate) | `sold_capture` | any hard gate unmet | Named artifact ("Deposit not recorded — $X of $Y") → DC | same day | 24h Sales Manager; **money gate at 48h becomes a Finance crit and holds the job out of `to_order`** |
| `rehash_touch` | `rehash_queue` | on entry, then +5/+10/+14 | Work the rehash → Sales Manager, reassignable to DC | +2 days | no touch by +5 → org admin; +14 with no disposition → force-listed with aggregate dollar value |
| `not_ordered` | `to_order` | flow blocker `not_ordered` | Place the order in RFMS → Order Processor | 1 bd, **paused while a blocking DC ticket is open** | 48h Ops Mgr, 96h owner |
| `variance_approval` | `order_entry` | totals variance > max($25, 0.5%) | Approve or correct → Sales Manager | **blocking** | — |
| `gp_review` | `order_entry` | GP < `sms_settings.gp_alert_threshold` | Review margin **before it ships** → Sales Manager | 24h | 48h owner. *(Today this SMS fires from `fetch_rfms_order` after the order is built — move it to a pre-commit gate where it can still change the outcome)* |
| `raise_po` | `material_ordered` | all lines GenPO | Raise the PO → Purchasing Coordinator | 1 bd | +1 Ops Mgr, +3 owner digest |
| `supplier_chase` | `awaiting_material` | `promiseDate > need-by`, or null >2 days after PO | Chase the supplier → Purchasing, cc Ops | 24h | simultaneously surfaced to the install coordinator as a schedule-risk item |
| `po_slip` | `awaiting_material` | a **stored** `promiseDate` is observed to move later | Slip on {job}, install {date} → Operations | immediate | **Alert on CHANGE, not value — there is no PO change feed anywhere in the API** |
| `material_unverified` | `awaiting_material` | **`materialKnown = false`** and install within 14 days | Confirm material readiness manually → Order Processor | 1 bd | 3 bd Ops Mgr. *This is the pre-connection mode: it turns flow.js's honest silence into an owned action* |
| `mat_certify` | `awaiting_material` | roll-up ALLOCATED and `shortLines=0` | Certify readiness → Coordinator | +1 bd | +2 Ops Mgr — an uncertified ready job is the most expensive stall: the work is done and nobody downstream knows |
| `sched_offer_date` | `ready_to_schedule` | certification non-stale, no date | Offer a date → Install Coordinator | +2 bd | +3 Ops Mgr, +5 Sales Manager (an uncontacted ready customer is a cancellation risk) |
| `await_crew_acceptance` | `scheduled` | WO issued, not accepted | Chase acceptance → Coordinator | +2 bd | **T−5 Field Manager, T−3 Operations: "unstaffed job installing in 3 days"** |
| `pre_install_call` | `crew_assigned` | T−2, `pre_install_call_completed_date` null | Confirmation call → CSR/Coordinator | T−2 | T−1 Field Manager. *Writes the two dormant columns nothing in the codebase has ever written* |
| `no_start_stamp` | `in_progress` | install date = today, no `actual_start_date` by 10:00 | Confirm the crew is on site → Field Manager | 10:00 ⏱ | 12:00 Ops Mgr + SMS |
| `chase_daily_progress` | `in_progress` | active multi-day job, no progress submit | Daily photo submit → Coordinator | 18:00 ⏱ | Field Manager next morning |
| `asbestos_stop` | `in_progress` | hard stop fired | **Do not proceed** → Ops Mgr + owner | immediate ⏱, priority 0 | immediate SMS, `bypass_quiet_hours` |
| `not_closed` | `in_progress` | install date passed, no completion | **Capture the completion date** → Field Manager | 18:00 same day ⏱, priority 0 | 12h Ops Mgr SMS, 24h owner SMS. **Never auto-waivable and never auto-closing** — DECISIONS §4 starts a lifetime obligation on this date |
| `change_order_unpriced` | `in_progress` | CO recorded, `sale_amount` unchanged | Price the change order → DC | 24h | 48h Sales Manager |
| `cure_punch_item` | `punch_open` | open punch at acceptance | Cure and photograph → crew (via Crew Pass) | +5 bd | day 5 Field Manager; day 7 "FD cures and back-charges", which requires the full FD-02 §3.6 evidence set |
| `cx_check_in` | `cx_followup` | completion stamped | Post-install check-in → CX | +1 bd | +4 to the **selling DC** (they have the number the customer answers), +7 Sales Manager |
| `warranty_stamp` | `cx_followup` | completion, no `warranty_start_date` | Stamp entitlement → CX, priority 0 | 24h | 48h owner |
| `balance_due` | Finance track | `balance_due > 0` at completion | Collect → AR Specialist | 3 days | 7 days Sales Manager, 21 days owner. **`crit` beyond 30 days, which reassigns the job's owner to Finance** |
| `sub_pay_due` | Finance track | close-out + walkthrough approved | Pay {sub} ${net} → AP Clerk | **statutory: earlier of customer payment +7d and completion +30d** | Controller at T−5, owner at T−1 — **before the breach, because after is just a report** |
| `retention_release` | Finance track | auto-created at completion +83 | Release retention → AP Clerk | completion +90 | §7.4 requires no request from the sub |
| `claim_ack` / `claim_schedule` / `claim_cure` | `claim_cure` | claim created / acknowledged / scheduled | Chase the sub → Install Coordinator | **1 / 3 / 10 business days** | each breach stamps `clock_missed_at` — **the miss is the evidence that unlocks FD's §3.3/§13.4 cure right, and inferring it later from timestamps is not the same as recording it** |
| `backcharge_statement_due` | `claim_cure` | 10-bd cure breach | Issue the §7.6 itemized statement → Controller | breach +7, **hard stop breach +12** | The 14-day deadline is a **forfeiture**, not a delay |
| `worry_free_11mo` / `sub_liability_21mo` | `warranty_active` | completion +335d / +21mo | Proactive check → CX / Field Manager | on date | — |

### 5.4 Escalation

| Level | Trigger | Channel | Recipient |
|---|---|---|---|
| L0 | task created | **in-app only, no push** | assignee |
| L1 | `due_at` passed | email, **batched into the 07:00 / 15:00 digest** | assignee |
| L2 | `due_at + escalate_after_hours` | SMS to assignee + email to dept lead | assignee, dept lead |
| L3 | L2 + interval | SMS to dept lead; row on the exception report | dept lead, Ops Mgr |
| L4 | priority-0 rules only (`lead_first_contact` 4h, `not_closed`, `asbestos_stop`, `material_short_scheduled`, `warranty_stamp`, E1/E8) | immediate SMS, `bypass_quiet_hours: true` | Ops Mgr + owner |

**Most tasks never leave L0.** That is the design. If every task pinged a phone, the pings stop meaning anything — the exact failure mode of the existing `past_due` blast.

Four rails already exist and must be fed correctly, not duplicated:
- **Arm switch.** `sms_outbound_enabled !== true` fails **closed**. All escalation SMS is inert until Twilio is armed; while disarmed, L2–L4 downgrade to email + an in-app banner and the reconciler writes an **E7** rather than pretending the escalation happened.
- **Quiet hours — a live trap.** `sendMessage` computes `customerFacing = !!(p.lead_id || p.customer_id) && !bypass_quiet_hours`. **An internal escalation payload that helpfully includes `lead_id` for context will be silently deferred until 08:00.** Rule: internal task payloads must never set `lead_id` or `customer_id`; carry context in `task_id` / `subject_type` / `subject_id`.
- **Anti-spam.** `unique index uq_task_notify on task_notification (task_id, level)`. One notification per task per level, ever. Digest rollup: one email listing N tasks, not N emails.
- **Durability.** Everything goes through `enqueue_job` → `processJobs` → `sendMessage`, inheriting suppression, delivery tracking and retry. Nothing calls Twilio or Resend directly. A `failed` job at `max_attempts` becomes **E7 — the escalation about the failed escalation.**

Suppression must be **split into marketing and transactional scopes**. Today a STOP on a promotional text silently kills the appointment confirmation, the reminder and the en-route SMS, and the CSR has no idea. Transactional suppression falls back to email **plus** a `call_to_confirm` task, with a visible "SMS opted out" badge.

### 5.5 The un-droppable invariant

> For every **active** job J (non-cancelled, derived stage ≠ `warranty_active`):
> 1. J has **exactly one** derived stage — structurally guaranteed: `classifyJob`'s if/else chain is total and ends in an `else`. ✅ already true.
> 2. J has **exactly one accountable person** — `owner_person_id` resolves to an active team member, not merely a department.
> 3. J has **at least one** `open` task, or a `waiting` task whose `waiting_on` and `waiting_until` are both set with `waiting_until >= today`.
>
> Any violation is written to `workflow_exception`, surfaced on a page, digested daily. **The target is zero.**

There is deliberately **no "nothing to do right now" escape hatch**. A job at `scheduled` with an install three weeks out holds a `waiting` task (`waiting_on='calendar'`, `waiting_until = installation_date − 7`) which expires into `open` and generates `pre_install_call`. Idle is always *explicitly* idle, with an owner and an expiry.

**The reconciler** (`reconcile_workflow`, a new `processJobs` handler, every 15 minutes, six set-based passes): classify → materialize → **auto-close** → reassign → expire waits → escalate and assert. Pass 3 is what keeps the task list from becoming a graveyard and is why the stage engine and the task engine can never disagree.

**The exception report:**

| Code | Condition | Meaning | Fires |
|---|---|---|---|
| **E1 ORPHAN** | no open tasks, no valid waits | The un-droppable violation. Nobody is holding this job | immediate, priority 0 |
| **E2 UNOWNED** | `owner_person_id` null, or assignee inactive/OOO | A department owns it, no human does | immediate |
| **E3 STALE_WAIT** | `waiting_until` passed, untouched >24h | A "waiting on X" nobody came back to | daily |
| **E4 CONTRADICTION** | live auto task whose stage ≠ snapshot stage | Reconciler pass 3 failed — an engine bug, not an ops problem | immediate, engineering |
| **E5 GHOST** | live task on a cancelled/complete subject | Should have been superseded | daily |
| **E6 UNVERIFIABLE** | `material_known = false` and install ≤7 days | The honest pre-RFMS gap | daily until credentials land |
| **E7 DEAD_LETTER** | failed notify job, or `communication.delivery_status='failed'` on an escalation | The escalation itself was dropped | immediate |
| **E8 CLOCK** | `installation_date < today − 2` and no `actual_completion_date` | **Warranty clock unstarted — legal exposure** | immediate SMS to Ops Mgr + owner |

Surfaces: a new `WorkflowExceptions.jsx`; a **"Unaccounted jobs: 0"** KPI tile on `JobFlow.jsx` (already granted to every role by 0047) — that single tile is the proof, and a non-zero value is the first agenda item at standup; a 07:30 Phoenix digest.

### 5.6 One copy of the stage engine

`flow.js` must run in the browser (JobFlow, dept inboxes) **and** in Deno (the reconciler). Two copies will diverge and the invariant becomes fiction. Move the module to `supabase/functions/_shared/ops/{flow.js,metrics.js}` and alias it in `vite.config.js` (`'@/lib/ops' → supabase/functions/_shared/ops`), so no import in `src/` changes. Fallback if the bundler fights it: a `check:flow-parity` byte-comparison in CI — but treat that as debt, not a design.

---

## 6. What has to be built

### 6.1 What already exists and must be reused, not rebuilt

| Asset | Where | Why it matters |
|---|---|---|
| **The stage engine** | `src/lib/ops/flow.js`, `metrics.js` | `classifyJob` is total, `buildJobFlow`/`departmentView`/`byOwner` are correct, and the `critical?.owner \|\| def.owner` line is what makes every ownership reassignment in this document work with **no new code** |
| **Payments ledger** | `0051_money_model.sql` — `public.payment`, `sale_balance`, `sale_gross_profit()` | Built, correct, and **read by nothing** |
| **Checkpoint engine** | `submitCheckpoint` + the four checklist components | The state machine (job_start → floor_prep → installation → final_walkthrough), the asbestos hard stop, the material-shortage and change-order alerts, and the server-side crew-cannot-approve-own-work rule are all **already good**. They are simply unreachable by the people standing in the house, and they write nothing back to `project` |
| **Job queue** | `0006`/`0007` + `processJobs` | Durable, retrying, exponential backoff on `waiting`, already re-enqueues correctly. Every task, notification and RFMS write rides this |
| **Comms pipeline** | `sendMessage`, `smsDispatch`, `emailDispatch`, `sms_settings` templates, suppression, `incomingSMS` STOP handling, pg_cron | Mature. **Every template is pre-appointment.** The rails are built; the messages are missing |
| **E-sign engine** | `0014` | UETA-aligned: token access, server-captured IP/UA, SHA-256 document hashing, sealed PDF, audit certificate. Seeded **disabled**, with no document type for the in-home contract, the completion certificate, or a change order |
| **Public-token rail** | `0032` + `installer_application.public_token` + `installerUpload` | The pattern that solves crew identity already exists twice and was never applied to job execution |
| **Ops boards** | `JobFlow.jsx`, `OrderingTeam.jsx`, `InstallTeam.jsx`, `ClaimsDashboard.jsx`, `AppointmentRehashReport.jsx` | Real surfaces with honest empty states. `AppointmentRehashReport` in particular is already the right query — it just needs an owner, a next-touch date, an attempt counter and a disposition to become a queue instead of a report |
| **Region routing** | `region_assignment` (zips, polygons, field manager, install coordinator, preferred crew) | Complete and read by nothing in the booking or scheduling path |
| **ROC ingest** | Phase 1 of installer onboarding — `roc_licensee` with live expiration and status | The compliance gate's data source already exists; it just isn't joined to the crew record |

### 6.2 Not blocked on RFMS — build now (this is most of the system)

**P0 — structural, everything else depends on these**

1. **`task` table rewrite** (`0052`). Polymorphic subject, `due_at timestamptz`, dept, role, priority, state, waiting-with-reason constraint, escalation chain, `uq_task_rule`. *Today `task` is appointment-scoped with a DATE due date: **not one task in this entire document can be created**, and a 5-minute or T−2h SLA is literally unrepresentable.* Named as the single largest structural blocker by four of the seven segments independently.
2. **Invert the material default in `flow.js`.** The final `else` assigns `ready_to_schedule` when material is null. With RFMS dark — today — **every ordered job in the company classifies as Ready to Schedule.** Unknown must hold: classify `awaiting_material` with a `material_unknown` warn blocker, add `readinessSource` ('rfms'|'manual'|'unknown'), and render Unknown as grey, never green.
3. **`convert_to_sale` writes the deposit into `public.payment`** in the same transaction, and `flow.js`'s `depositMissing` test repoints from `sale.deposit_amount` to `sale_balance.amount_paid`. *The single highest-value fix in the codebase: every sale created today reads unpaid on a job where 50% was collected at the table.*
4. **Stop fabricating `installation_date` at Sold.** `handleStatusSelect('Sold')` writes `appointment_date + 2 weeks` before the DC has entered anything; `convert_to_sale` copies it to `project.installation_date`; `classifyJob` evaluates `installDate` **before** `!invoice`, so the job resolves to `scheduled` with a `no_crew` blocker and **never appears in `to_order`, `order_entry` or `awaiting_material` at all** — while `buildOrderingQueue` still shows it. JobFlow and OrderProcessing disagree about the same job on the same day. Capture the DC's verbal commitment as `sale.customer_promised_window` and leave `project.installation_date` NULL until a scheduler commits it. Add an assertion at the top of `classifyJob`: *nothing but Scheduling writes this field.*
5. **`submitCheckpoint` writes back to `project`.** job_start approve → `actual_start_date` + status; final walkthrough submit → `actual_completion_date` + `qa_in_progress_date`; `approve_final` → `qa_completed_date`; `submit_for_payment` → status Completed. Plus a nightly reconciliation listing any project whose checkpoint state and project fields disagree. That report should be empty forever, and it will not be on day one.
6. **Enforce the Sold hard gates in `convert_to_sale` with a RAISE**, not in a React button's `disabled` expression. Same principle 0050 already applied successfully to the append-only logs.
7. **Fix `installation_date_status` case.** `submitCheckpoint` writes `'on hold'`; `metrics.js:259` tests `=== 'Hold'`. **No held project — including an asbestos-halted one — has ever appeared as on-hold on the install board.** Same for `'pending payment'`, `'pending contract'`, `'pending cancellation'`. Replace with a constrained set and a `halted` crit blocker that suppresses the misleading `not_closed`.
8. **Fix `line_statuses` storage.** `processJobs/index.ts:313` stores `[...new Set(...)]` while `materialIndex()` counts occurrences. **Every readiness percentage, pipeline bar and "N of M lines" string in the app is arithmetically wrong.** A 40-line order stores 3 entries. Replace with a per-line `rfms_order_line` table.

**P1 — the things that make the model real**

9. **Crew Pass** — per-job capability token, SMS-delivered, offline-first PWA (IndexedDB + client ULID idempotency key, photos reduced to 1600px/q0.7 *before* queueing), SMS-back fallback (`START CG100123` / `DONE CG100123` via the existing `incomingSMS`), and `crew_stamp_completion()`. **Unblocks four stages.** Half of Phoenix-metro new construction is a stucco box with no LTE inside; today `UploadFile`'s catch only `console.error`s and the crew loses photos silently believing they saved.
10. **Capacity model** — `crew_capacity`, `crew_day_booking`, a job-days rate card seeded from the actual_start→actual_completion spread of the last 200 completed jobs. **Unblocks `ready_to_schedule` entirely.** Without it, scheduling against capacity is a slogan and `Dashboard.jsx:399` keeps narrating a number with nothing behind it.
11. **`work_order` + Exhibit B piece-rate schedule + crew acceptance.** FD-01 §1.2: no engagement exists until the crew accepts. This is also the only source for `cost_labor`, one of the four GP components.
12. **`installer_compliance` view** joining installer → installer_application → roc_licensee. Work Order issue refuses a crew whose licence or certificate expires before the install date; 30-day expiry warnings on the roster.
13. **Structured measurement — `sale_line`.** `sale, room_name, rfms_product_id, product_code, style_name, color_name, quantity numeric(12,3), uom CHECK in ('sf','sy','lf','ea'), waste_pct, unit_price, line_total` **tax-exclusive**. *There is no square-foot, square-yard, room or area column anywhere in the schema today. What was sold lives in a PDF and some JPEGs, and Ordering re-keys the entire job by reading a photograph — which is precisely why `ContractDiscrepancy` had to be built.*
14. **`punch_item`, `change_order`, `material_exception`, `finance_application`, `schedule_event`, `referral`, `review_request`, `crew_pass`, `warranty`.** Every one is currently a boolean, a free-text field, or nothing.
15. **`communication.project_id`.** Without it, "was the customer told?" cannot be a data condition, and FD-02 §6.4 record retention is unmet.
16. **The 20 missing message templates.** Lead auto-reply, missed-call text-back, no-answer sequence, below-minimum, out-of-area, T−2h reconfirm, no-show follow-up, material ordered, material arrived, install scheduled, install confirmed T−2, install reminder T−1, crew en route, install complete, warranty certificate, care guide, check-in, satisfaction, 30-day, review request, claim acknowledgement. **The infrastructure is mature. The messages simply do not exist.**
17. **Reason-code vocabularies:** `not_sold_reason_code`, `lead.disposition`, `No-Show` appointment status + `no_show_at`. *Today a consultant who drives across the valley and finds nobody home is recorded identically to a customer who called ahead — so no-show rate, the single most important quality signal on both the CSR and the lead source, cannot be computed.*
18. **Split suppression into marketing and transactional scopes.**
19. **Warranty entitlement fields + the customer-facing warranty document.** `esign_document_type` seeds three types, all installer-facing. **The document Floor Daddy's sales script sells does not exist in the system**, and FD-02 §5.1 promises subcontractors a copy of it.
20. **Back-charge six-element insert constraint.** `project_claim.is_back_charge` is a bare boolean. **Every back-charge Floor Daddy has ever made is contractually unsupported and unwinnable if contested.**
21. **Remove the RFMS date override** at `ProjectsCalendarView.jsx:123`. A small code change and a large behavioural one — DECISIONS §1 chose a system of record and this line quietly ignores it.
22. **Tighten `cxDone`** to require `check_in_completed_date` specifically, and rename `welcome_call_*` to `satisfaction_call_*`. The ambiguity is the bug.
23. **Fix `LINE_STATUSES`** to the true ramp in true order — None, GenPO, OnOrder, **Resvd, Cut, Staged**, Del, JobCosted (Reserved belongs *before* Cut; the array has it last, and Staged is missing entirely even though ERRM is ON, so **a fully staged job can never reach readiness 1.0**). Fix `STATUS_HELP.GenPO`.
24. **Region-aware DC routing and live availability grid at booking.** `region_assignment` exists and is unread; there is no conflict check anywhere in the codebase and the system's only acknowledgement that double-booking happens is "Scheduling conflict" appearing as a *cancellation reason*.

**P2 — real but sequenced behind the above**

25. `ghlWebhook` edge function + nightly reconciliation (needs GHL credentials, not RFMS).
26. Subcontractor payable, retention (5% to a **cumulative** $2,500 cap per sub, not per job), and A.R.S. § 33-1008 lien waivers.
27. QuickBooks integration — DECISIONS §2 names QBO the accounting system of record and there is **no QuickBooks provider among the eight seeded integrations**. Reconciliation currently has no target.
28. `WorkflowExceptions.jsx`, `DeptInbox.jsx`, `CrewJobView.jsx`, `MyTasks.jsx` rewrite, Settings rule editor.

### 6.3 Blocked on RFMS credentials / entitlement

Genuinely blocked — everything else above ships without them:

- Order create, line writes, Reserve, Cut, job create/update — **Enterprise-only, no lower-tier variant**.
- Real material readiness, per-line status, `promiseDate` and the entire PO watch → without them, `awaiting_material` degrades to a named human attestation with a 24-hour staleness horizon and the flat 14-day SLA. **This is strictly worse and should be stated as such in the rollout plan.**
- Catalog binding at the kitchen table → **use the licensed Product Import/Export snapshot path, which does not require the Web API.** This is the v1 requirement, not a fallback.
- GP cross-check, attachment mirroring, claim documents, schedule write-back.

**Three commercial questions gate all of it, and they are not config toggles:** (a) is the Web API switched on at all (ROS → RFMS Online tile → API → Generate Key); (b) is the store at **Enterprise**; (c) is the TPD Plus grant a floor or a **ceiling** — if a ceiling, RAZZLE DAZZLE cannot run on a TPD key at all.

**Four latent bugs will fail on day one of the integration, not in testing.** Fix them before the first credential lands: `sessionAuth()` using `storeId` instead of `storeQueue`; `/customer/create` (not an endpoint); no `messageId` support anywhere, so no write is idempotent; `normalizeResult()` preferring `result` over `detail` universally, which breaks the documented `result === "OK" → read detail` rule.

**And run spike Q4 first** — the untruncated `GET /v2/order/:number` on a real multi-line order. The readiness roll-up, the `material_short` blocker and stage 11's definition of done all depend on knowing what the per-line status field is called.

---

## 7. Sequencing

**The known failure mode is scope collapse across three large builds** — journey stages, workflow engine, RFMS integration — attempted simultaneously. The sequence below makes each phase independently shippable and independently valuable, and puts the legal exposure ahead of the integration.

### Phase 0 — Truth (2 weeks). *Nothing new; stop lying.*
Fix what is actively wrong today: the material default inversion, the `Set` line-status bug, the `'on hold'`/`'Hold'` case mismatch, the fabricated `installation_date`, the deposit-into-ledger fix in `convert_to_sale`, `LINE_STATUSES`, `STATUS_HELP.GenPO`, and the RFMS date override. Add `marketing`, `csr`, `field` to `DEPARTMENTS`.
**Why first:** every board in the company currently shows numbers that are arithmetically wrong or semantically inverted. You cannot sequence work against a map that lies. This phase adds no features and changes what people see on Monday.

### Phase 1 — The engine skeleton (3 weeks). *Value on day one with zero notifications.*
`0052_task_engine.sql` + reconciler passes 1–3 + `job_flow_snapshot` / `job_flow_transition` + the exception report + the "Unaccounted jobs" tile.
**Why second:** the exception report immediately shows how many live jobs currently have nobody holding them, using nothing but data that already exists. That number is the argument for everything that follows. And `job_flow_transition` starts accumulating the dwell data that turns `STAGES[].sla` from a guess into evidence — it needs 90 days, so start the clock now.

### Phase 2 — Assignment and inboxes (3 weeks).
`dept_roster` + `resolve_assignee` + `MyTasks.jsx` rewrite + `DeptInbox.jsx` mounted inside the existing `InstallTeam`, `OrderingTeam` and `ClaimsDashboard` — **not** yet another standalone board. Escalation ladder, email only, SMS still disarmed.
**Why third:** work becomes addressable to a named person. `project.install_coordinator_id`, `field_manager_id`, `order_entry_id` and `sale.assigned_dc` stop being decorative.

### Phase 3 — The legal exposure (4 weeks). *Do this before cutover regardless of RFMS. It depends on nothing external.*
Crew Pass + offline PWA + SMS-back + `crew_stamp_completion` + `punch_item` + walkthrough e-sign document type + warranty minting + `actual_completion_date` capture with provenance.
**Why here and not later:** DECISIONS §4 starts a **lifetime** labor obligation on a date that is currently typed from memory into a bare `date` column by an office person days after the fact, with no time, no actor and no provenance — and FD-02 §2.4 makes the walkthrough photo set the only defence in a two-year-old dispute. This is not hygiene. It is the one item on this list where the cost of waiting is unbounded, and it needs no credentials, no capacity model and no integration.

### Phase 4 — The top of the funnel (4 weeks).
`ghlWebhook` + lead pipeline columns + `slaMinutes` / `minuteDiff()` + the 5-minute task with its escalation ladder + `buildLeadFunnel()` + the eleven pre-sale message templates + Twilio armed.
**Why here:** it is the highest-revenue-leverage segment and it needs GHL and Twilio, not RFMS. But it needs the task engine's minute-resolution `due_at` first, which is why it cannot come earlier. Speed-to-lead is not merely unmet today — it is **unmeasurable**: no `source_created_at`, no `first_dial_at`, no attempt count, and `buildCycleReport()` starts its clock at the measure appointment.

### Phase 5 — Capacity and the install spine (5 weeks).
`crew_capacity` + `crew_day_booking` + the job-days rate card + `work_order` + Exhibit B rates + crew acceptance + compliance gate + `schedule_event` + the six install message templates + `sale_line` structured measurement.
**Why fifth:** this is the largest single build and it has the most prerequisites — it needs Crew Pass (Phase 3) for acceptance, the task engine (Phase 1) for the T−5 escalation, and `sale_line` for Work Order quantities. Attempting it earlier is the scope collapse.

### Phase 6 — Money (4 weeks).
AR board on `sale_balance` + deposit receipt + change orders that move `sale_amount` + the one GP definition replacing `GrossProfitReport.jsx` + subcontractor payable/retention/waivers + QuickBooks + the back-charge evidence constraint.
**Why sixth and not earlier:** `cost_labor` has no source until Exhibit B exists (Phase 5), so the GP number cannot be completed before then. The statutory sub-pay clock, however, is real from the day the first Work Order is accepted — so Phase 5 and Phase 6 overlap by design, and `sub_pay_due` ships with Phase 5's Work Order, not with Phase 6's ledger.

### Phase 7 — RFMS, when and only when entitlement lands.
In order: settle the four latent bugs and the `sessionAuth` question → run spikes Q2, Q3, Q4, Q10 → reads first (order get, product find, customers find, purchaseorder/find) → then the PO watch and real material certification → then order create and line writes → then schedule write-back. **Never** provider posts, payables, payment mirroring, `DELETE /v2/job`, or report-generate with `allow*` flags.

**The commitment worth making publicly:** phases 0–6 deliver the entire operating model — every stage, every task, every escalation, the un-droppable guarantee, the warranty record, and honest customer communication from first ad to twelve-month check-in — **with zero RFMS credentials.** Material verification is the only thing that degrades, and it degrades to a named human's attestation with their name on it and a staleness clock, which is more accountable than what exists today. The integration makes the material gate automatic. It does not make the business run.