---
name: rfms-pro
description: Deep RFMS (Cyncly) flooring-ERP expertise — domain model, order lifecycle, material line statuses, job cost and GP formulas, the REST API and its tier limits, and the RAZZLE DAZZLE integration boundary. Use when working on anything that reads from, writes to, reconciles against, or reasons about RFMS.
---

# RFMS Pro

Working knowledge of RFMS for the Floor Daddy / RAZZLE DAZZLE integration, distilled
from a full read of the RFMS help centre (2,355 articles).

**Full reference:** `reference/rfms-engineering-reference.md` (~68 KB, 11 sections —
domain model, flooring concepts, order lifecycle, money, purchasing, scheduling, the
API, integration playbook, traps, glossary). Read it when you need detail; the
essentials are below.

**Floor Daddy's own configuration:** `reference/floor-daddy-system.md`. Read this
before assuming anything about their install — several defaults are non-obvious.

---

## The seven things that will bite you first

1. **The Customer Order *is* the invoice.** There is no invoice entity, no separate
   invoice number, no AR invoice. "Invoicing" is a print/posting event on the same
   record. The printed header says **"Acknowledgment"** until job costed and
   **"Invoice"** after — that word is a reliable state indicator.

2. **Line status is the truth; order status is nearly meaningless.** The real state
   machine lives on order *lines*:
   `None → Gen PO → On Order → Cut → [Staged, ERRM only] → Delivered → Job Costed`,
   with `Reserved` and cross-store `Requested → InTransit` as side paths. Internal
   codes: blank=None, `P`=Gen PO, `O`=On Order, `R`=Reserved, `C`=Cut, `J`=Job Costed.

3. **"Gen PO" is not a purchase order.** It is a flag meaning "this still has to be
   bought." The PO only exists once someone presses the line's PO button or runs
   Auto PO. Treating Gen PO as "ordered" overstates readiness.

4. **"Delivered" does not mean delivered to the customer.** It is an inventory/
   accounting state. Do not surface it to a customer as a delivery.

5. **Scheduling has NO API at any tier.** No create/read/update of scheduled jobs,
   crews, capacities or job statuses. Only the `X*` tables via SQL/Crystal, or CSV
   exports. This is decisive for anything that intends to own scheduling.

6. **The API token inherits a human user's permissions.** Visible stores, assignable
   inventory, searchable documents and price levels all follow that user's *System
   Options*, not the token. Changing the user silently changes API behaviour. Use a
   dedicated integration user and treat its System Options as part of the contract.

7. **Store Queue and API Token are rotatable configuration, never constants.** An
   Azure Service Bus incident once changed store queue IDs and invalidated every
   issued key.

---

## Identifiers

| Thing | Format |
|---|---|
| Customer Order / Invoice | `CG` + year digit + 5-digit seq (`CG100123`). With per-store sequencing the 4th char is the store code. Rolls into base-36 **excluding I, L, O**. `CG` is reserved and may never appear in a manual number. |
| Quote | `ES` + digits — its **own independent sequence** |
| BidPro Estimate | `JE` + digits, plus an **Est Sub Number** |
| Claim | `CL` + digits — must attach to an order |

---

## Money — and why our number will never equal theirs

RFMS's own formula (Accounting Terms):

```
GP% = (Total Selling Price − Total Costs) ÷ Total Selling Price × 100     … before commissions
```

Cost side = Material + Labor + Misc + Freight + Overhead Margin + Load + Load% + Tax.

Job Cost Analysis stores **three** GP percentages per job, not one:
`GPGrsSales` (÷ delivered sales incl. tax), `GPMatOnly`, `GPNetSales` (÷ invoice total − sales tax).

**Two deliberate divergences in RAZZLE DAZZLE** (see `DECISIONS.md` §3) — document them,
never "fix" them by matching RFMS:

- **We subtract sales commission; RFMS does not.** (RFMS subtracts referral fees, not
  commissions.) Our GP is therefore structurally lower and is a truer job cost.
- **We divide by revenue net of TPT.** Several RFMS denominators are tax-*inclusive*,
  so a tax-exclusive GP computed externally will never match by construction.

⚠️ **"Net Sales" means three different things** across RFMS reports (Sales Totals =
ex sales + use tax; Profit Analysis = total sales − (labor + tax liability); Job Cost
Analysis = invoice total − sales tax). Always ask *which* net.

Cash is a three-stage pipeline: money taken before job costing sits in a **Customer
Deposits liability** and is reclassified at job cost. It is not AR until then.

---

## Material readiness — use RFMS's own roll-up

Project Manager already defines an order-level roll-up. Prefer it over inventing one:

`NO LINES` → `MATERIALS NOT ALLOCATED` (any line None/GenPO/OnOrder) →
`MATERIALS ALLOCATED` (none of those, ≥1 Cut/Staged/Reserved) → `MATERIALS DELIVERED`
→ `COMPLETED` (all job costed).

Reporting semantics that differ from intuition:
- **"Requisition"** = Cut + Delivered only.
- **"Material Cost to Date"** = Gen PO + On Order + Reserved + Cut + Delivered (excludes None).

---

## API tiers — what you can actually do

| | Standard (Core) | Plus (Professional) | Enterprise |
|---|:---:|:---:|:---:|
| Customer CRUD/search/get (+ dup detection) | ✓ | ✓ | ✓ |
| Create quote/order/BidPro **headers**, no lines | ✓ | ✓ | ✓ |
| Get quotes/orders **with lines**, search, header updates, post (not process) a payment, product & inventory search, claim headers, quote→order export, attachments | | ✓ | ✓ |
| **Create orders WITH lines · edit orders · assign inventory** | | | ✓ |

Not available at **any** tier: purchase orders, receiving, scheduling, crews,
provider/installer pay, commissions, GL/journal, payroll, adjustments, work orders.

**Auth:** Store Queue + API Token, generated in RFMS Online Services → RFMS Online tile
→ **API** button → Generate Key → pick a default user → label → Save. Tokens are
revocable. A "Third Party Developer Opt-in" flow also exists (developer requests using
the store's Business ID; admin approves).

**Transport:** everything (Mobile, Warehouse Mobile, CRM, Measure export, Next, and the
REST API) runs through one on-prem Windows service — `RFMSDataEndpoint`, formerly
`MeasureOrderEntryService` ("the MOE API service") — reached from Azure via a Service
Bus store queue. **Every RFMS Core update stops that service, so every update is a
guaranteed API outage.** Rate-limit yourself: a third party once DoS'd the shared
endpoint and took the API down for ~16 hours for everyone.

---

## Non-API read paths (important when the tier or the API falls short)

- **Materials Analysis (Orders)** — the widest line-level extract, with named columns
  including `UnitCost, TotalCost, UnitPrice, LineTotal, Profit, ProfPerc, PO Number,
  Date_Rcvd, Promise Date, Measure Date, Bin Location, LineStatus`. This is almost
  certainly the export behind the GBTN ops reports.
- **Job Cost Analysis** — effectively the job-cost record schema.
- **Purchase Order Summary / Listing / Needs** — the only structured PO extract.
- Inventory range/value/physical/balance/adjustment/history/reserve/stock reports.
- **Daily Scheduling / Job Summary CSV** (Schedule Pro) — the only schedule extract.
- Direct SQL/ODBC read (`db_datareader`) is a documented pattern; the table list is published.

Caveat: saved report filters are **user-specific**, and the older scheduled-email
mechanism was discontinued in June 2026.

---

## Integration boundary for RAZZLE DAZZLE

Per `DECISIONS.md` §1, RAZZLE DAZZLE is the operational system of record and RFMS is
authoritative for **material**.

**Read from RFMS:** order lines with costs, line statuses (→ material readiness),
inventory availability, product/catalog data, order/quote headers for reconciliation.

**Write to RFMS:** customers (dup detection is built in), quote/order headers, internal
notes, attachments, payments (post only, Plus+), order lines and inventory assignment
(**Enterprise only**).

**Do not attempt:** scheduling (no API), purchase orders, receiving, GL/journal
postings, payroll, commissions, adjustments. Those stay in RFMS or move wholly to us.

Before building against any of it, settle the questions in §9.6 of the full reference
during a live spike — several tier boundaries and payload shapes are documented
ambiguously and can only be confirmed against the real endpoint.
