# Floor Daddy's actual RFMS configuration

Read from the **RFMS System Information Summary** screen, 2026-08-28. This is ground
truth for customer **61152** and overrides any generic assumption about how RFMS is set up.

---

## ✅ ENTERPRISE tier — confirmed by Cyncly, 2026-08-31

Cassie Justice (Account Manager, Cyncly) confirmed in writing: *"Floor Daddy's
subscription includes the Enterprise-level API service."* Her capability matrix
matches §2.6 of the API reference exactly, including the two rows that decide
whether an end-to-end scheduling integration is possible at all:

| Function | Std | Plus | **Ent** |
|---|:--:|:--:|:--:|
| Get scheduled jobs by crew or order number | — | ✓ | ✓ |
| Change status and add notes on a job | — | ✓ | ✓ |
| Create provider records | — | ✓ | ✓ |
| Create and edit orders (headers and lines) | — | — | ✓ |
| Assign inventory to orders | — | — | ✓ |
| **Schedule new jobs and edit existing jobs** | — | — | **✓** |

So the whole Schedule Pro surface is reachable: reads and status/notes at Plus,
create/update and provider records at Enterprise. Line-level material cost and
line statuses — which the gross-profit model and the material boards both need —
are in scope.

### Still to switch on: the per-install Web API checkbox

The subscription entitlement and the install-level toggle are two different
things. Under *RFMS Mobile and Web Software* this install still shows
`Measure Mobile ☑`, `Web API ☐`, and that is what returns 403 on
`/v2/session/begin` — it is not a credential problem. Tyler is having it enabled.

**Cheap confirmation once it is on:** RFMS Online Services → RFMS Online tile →
**API** button (upper right) → Generate Key. A Store Queue + Token means it is live.

The on-prem MOE API service is said to be already installed wherever RFMS Mobile, Cloud
Link or Podium is in use. Measure Mobile is licensed here, which *may* satisfy that —
unconfirmed.

---

## ⚠️ Units are SQUARE YARDS

`Units: Square Yards`. RAZZLE DAZZLE talks in **square feet** throughout. **1 sy = 9 sf.**
Every quantity crossing the boundary must be converted. Getting this backwards silently
scales every area by 9× — the highest-probability bug in the integration.

---

## Identity and scale

| | |
|---|---|
| RFMS Customer Number | **61152** (usernames are prefixed: `61152.TylerB`) |
| Licensee | FLOOR DADDY, LLC · 3910 S. Rural Rd #104, Tempe AZ 85282 · 602-888-4669 |
| License status | ACTIVE |
| Users | 16 allowed, 11 current |
| **Store Codes** | **3** — this is a multi-store install; store scoping matters |
| Directories | `\\vmappsh-4\61152`, attachments `\\VMAPPSH-4\61152-Attachments`, EDI `\\Vmappsh-4\61152` |
| Version | Database revision **2800**, version **25.99.2.39410** |
| Numbering | Account Code Length 3 · Last CG Roll Number **CG3** |

On-prem Windows file shares — a locally hosted install, not SaaS.

---

## Accounting posture

**Last Journal Close and Last GL Close are both 12/31/23** — over two years stale.
RFMS accounting is not being closed monthly; the books live in QuickBooks.

Consequences:
- Independently validates `DECISIONS.md` §2 (RAZZLE DAZZLE records payments, QuickBooks
  does the accounting).
- **RFMS GL/AR data must not be treated as authoritative.** Reconcile to QBO, not to RFMS.
- `Batch Job Costing` is **off**, which bears on whether RFMS is computing job cost for
  them at all.

---

## Flags that are ON internally

`ERRM ☑` · `Integrate Inventory ☑` · `Integrate Provider's Earnings ☑` · `PO Integration ☑`
`Store By Number ☐` · `Store Specific Products ☐`

ERRM being on is significant: it changes the material state machine (adds **Staged**, set
by printing the picking ticket) and changes how sales are booked with respect to tax.

---

## Licensed add-ons

**On:** Bid Pro (ACTIVE, 16u) · **Project Manager — license type "Commercial Project
Manager"** (16u) · **Schedule Pro** (ACTIVE, 16u) · Business Insights · Contract Pricing ·
Customer Import Export · E Commerce · Hyper Pay · PIE · Pricing and Tagging · Product
Import/Export · Measure Mobile · Custom Work Order

**Off:** NHMS · Batch Inventory Allocation · **Batch Job Costing** · Color Crossover ·
Direct Deposit · Enterprise Manager · Gateway · Inventory Move · 2020 Integration ·
Sales Pro Mobile · Installer Pro Mobile · OPS Connect · Property Connect · Custom
Invoice · Custom Quote · Custom Product Tag · Custom Roll/Item Inventory Tag

---

## Two implications worth arguing about

**They already own Schedule Pro and Project Manager**, 16 users each. `DECISIONS.md` §1
makes RAZZLE DAZZLE the scheduling system of record — which duplicates licensed software.

⚠️ **That decision was justified on a false premise and should be re-made.** This file
previously said *"Schedule Pro has no API at any tier, so we could never have synced to
it anyway"* — repeating one of the help-centre errors §3 of the API reference catalogues.
It is wrong. §2.6 documents 18 Schedule Pro endpoints, and Cyncly has confirmed Floor
Daddy holds Enterprise, which includes *"Schedule new jobs and edit existing jobs."*

The sync was always possible. Owning scheduling in RAZZLE DAZZLE may still be the right
call — one system of record, no split brain — but it is now a choice rather than a
constraint, and the alternative (RFMS stays the scheduler, RAZZLE DAZZLE drives it
through the API) is genuinely available. Confirm whether Schedule Pro is actually used
or is shelfware before either path.

**Customer Import Export and Product Import/Export are licensed.** That is a bulk data
path which does **not** require the Web API — a viable route for the initial data
migration, and a fallback if the API entitlement stays unavailable.
