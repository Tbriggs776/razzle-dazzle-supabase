---
name: rfms-pro
description: Deep RFMS (Cyncly) flooring-ERP expertise — domain model, order lifecycle, material line statuses, job cost and GP formulas, the REST API and its tier limits, and the RAZZLE DAZZLE integration boundary. Use when working on anything that reads from, writes to, reconciles against, or reasons about RFMS.
---

# RFMS Pro

Working knowledge of RFMS for the Floor Daddy / RAZZLE DAZZLE integration, distilled
from a full read of the RFMS help centre (2,355 articles).

## Which reference to read

| File | What it is | Authority |
|---|---|---|
| `reference/rfms-api-v2-reference.md` | **The API reference.** All 86 endpoints from the official published Postman collection, plus corrections, integration design and spike questions. | **Highest — this wins on anything API-related.** |
| `reference/rfms-api-v2-raw-endpoints.md` | Raw dump of every endpoint (URL, headers, body, sample response) for lookup. | Primary source |
| `reference/rfms-engineering-reference.md` | Product/domain knowledge from the help centre (2,355 articles): domain model, flooring concepts, order lifecycle, money, purchasing, traps, glossary. | Good on the **product**; ⚠️ **wrong in places about the API** — see §3 of the API reference |
| `reference/floor-daddy-system.md` | Floor Daddy's actual install (customer 61152). | Ground truth for this client |

> ⚠️ **The help-centre reference contains ~16 API claims the official API docs disprove.**
> The corrections are catalogued in §3 of the API reference. The big ones are repeated
> below. When the two disagree, **the API reference is right.**

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

5. **Scheduling HAS a full API.** ~~No scheduling API~~ — that help-centre claim is
   **wrong**. v2 ships 18 Schedule Pro endpoints: Create Job, Create Job From Order,
   Update Job, Delete Job, Change Job Status, Get Crews, Get Time Slots, Find Jobs,
   Post Provider Record From Job. RAZZLE DAZZLE can own scheduling *and* write it back.

6. **The API token impersonates a specific RFMS user.** Visible stores, assignable
   inventory, searchable documents and price levels all follow that user's *System
   Options*, not the token. Changing the user in ROS silently changes API behaviour.
   Use a dedicated integration user and treat its System Options as part of the contract.

7. **Store Queue and API Token are rotatable configuration, never constants.** An
   Azure Service Bus incident once changed store queue IDs and invalidated every
   issued key.

8. **Tier gating is per FOLDER and returns `Unauthorized`, not a `failed` envelope.**
   `/Order Entry` requires Plus or Enterprise. **All creates (order/quote/estimate) are
   Enterprise, and there is no line-less create variant** — so at Standard the only
   usable folder is `/Customers`, and the only route to a selling document is
   `POST /v2/opportunity`. There is no cheap on-ramp.

---

## Identifiers

| Thing | Format |
|---|---|
| Customer Order / Invoice | `CG` + year digit + 5-digit seq (`CG100123`). With per-store sequencing the 4th char is the store code. Rolls into base-36 **excluding I, L, O**. `CG` is reserved and may never appear in a manual number. |
| Quote | `ES` + digits — its **own independent sequence** |
| BidPro Estimate | `JE` + digits, plus an **Est Sub Number** |
| Claim | `CL` + digits — must attach to an order |

---

## Money — and how our number relates to theirs

`GET /v2/order/grossprofit/:number` returns **exactly one** percentage, and its
denominator is `NetSales = TotalTransaction − TaxCost` — i.e. **tax-EXCLUSIVE**
(verified to the cent against both published samples). It is the analogue of Core's
`GPNetSales`.

⚠️ **`TaxCost` is not a cost.** Tax sits on the revenue side, not the cost side. The
help-centre reference's formula ("… + Load + Load% + Tax" in costs) double-counts tax
and understates margin. Do not port it.

Header money buckets are `{material, labor, misc, total, salesTax, miscTax, grandTotal,
recycleFee}` — "Services" maps to `labor`, and there is a `recycleFee` bucket.

**Our one deliberate divergence** (see `DECISIONS.md` §3): **we subtract sales commission
and finance dealer fees; RFMS's GP is computed BEFORE commissions** (it subtracts referral
fees, not commissions). So our GP is structurally lower and is a truer job cost. Our
tax-exclusive denominator, by contrast, **does** line up with the API's `NetSales` — so
revenue reconciles even though margin deliberately does not.

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

**Auth — settled, not guesswork.** Store Queue + API Token, generated in RFMS Online
Services → RFMS Online tile → **API** button → Generate Key → pick a default user →
label → Save. Tokens are revocable.

```
POST /v2/session/begin      Basic( storeQueue : apiKey )     no body
  → { authorized, sessionToken, sessionExpires }             (bare — no envelope)

every other call             Basic( storeQueue : sessionToken )
```

The `/Authentication` folder states it verbatim: *"The session token must be sent with
all API requests as the password using HTTP Basic Auth. User name should be set using
the same user name you used in the first step."*

- **Sliding expiry** — the session is extended on every call, so a busy integration may
  never re-begin while an idle one dies silently. Refresh on auth-failure; treat
  `sessionExpires` as a hint only.
- `sessionExpires` is **not ISO-8601** (`M/d/yyyy h:mm:ss tt zzz`). Never `Date.parse` it.
- There is **no logout/revoke/introspect endpoint**. Revocation is a human action in ROS.
- **Do not build on a TPD key.** A TPD session is granted Plus *"regardless of the store's
  actual subscription level"* — read as a **ceiling**, it could never reach any
  Enterprise endpoint, which is exactly the set a material-authoritative integration
  needs. Use Floor Daddy's own store credentials at Enterprise.

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

**Also available** (contradicting the help centre): `POST /v2/order/purchaseorder/find`
(the **only** material-ETA source — per-(order,line), so drive a poller from OUR open-job
list, not an RFMS sweep), `POST /v2/calculatetaxes`, `POST /v2/payables`,
`POST /v2/order/provider`, and the full Schedule Pro surface.

**Genuinely absent:** receiving, GL/journal postings, payroll, adjustments.

### Non-negotiable client rules

- Always read with **`?locked=false`** (the default). Locking is opt-in via `locked=true`
  — routine reads are safe and need no lock machinery. If you ever take a lock, release
  it in a `finally` via `GET /v2/unlock/:id`.
- **Persist both `lineNumber` and `lines[].id`.** `lines[].id` is the reconciliation key
  — *not* (invoice number, line number).
- **Never set `width` on a line you intend to reserve against** — it becomes unreferenced.
- **Never blind-retry an inventory write on `waiting`.** Only Create Order and Record
  Payment document a `messageId` header for idempotency; the inventory writes do not.
- Treat **Reserve / Cut / Deliver as irreversible and human-gated.** `setToGeneratePO`
  (`POST /v2/order/save/linestatus`) is the *only* reversible transition and is safe to
  automate — but it does **not** create a PO, so the purchasing loop cannot close
  programmatically.
- **Determine the ERRM regime before any inventory write ships.** Non-ERRM consumes
  inventory at **Cut**; ERRM at **Deliver**, which also posts real-time journal entries.
  *(Floor Daddy has ERRM ON — see `floor-daddy-system.md`.)* Same code, opposite
  accounting effects.
- Write a **tolerant unwrapper**: eight endpoints return bare objects with no
  `{status,result}` envelope, and the payload key varies across the rest.
  `GET /v2/customers` never contacts the store, so it can never return `waiting` — it is
  **not** a valid connectivity probe.

Before building, settle the spike questions in §5 of the API reference — chiefly whether
the TPD Plus grant is a floor or a ceiling, and a full untruncated `Get Order` response
(the published sample truncates before any line-status field, and the whole material
readiness roll-up depends on it).
