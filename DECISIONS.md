# RAZZLE DAZZLE — Structural Decisions

Decided by Tyler Briggs (owner), 2026-08-28.

These four answers determine the shape of every large build that follows. They
are recorded here rather than in a chat log because the whole team needs to be
able to point at them, and because building on both sides of an open question is
how a month gets spent in the wrong direction.

---

## 1. System of record — **RAZZLE DAZZLE is primary**

RAZZLE DAZZLE is the operational system of record. RFMS becomes downstream, and
is authoritative only for **material**: order lines, PO/receipt status, and
material cost.

**What this means in practice**

- The **install schedule lives here.** Crew assignment, capacity and conflicts
  are decided in RAZZLE DAZZLE, and dates flow *out* to RFMS — not in.
- This **reverses today's behaviour.** The projects calendar currently lets an
  RFMS crew date override whatever a scheduler entered locally. That override
  must be removed and inverted, or we will have chosen a system of record and
  then quietly ignored it.
- Material readiness continues to be *read* from RFMS. We do not rebuild
  purchasing.

**Consequence to accept:** this is the largest of the three big builds and the
one with the most change-management risk, because it moves where people work —
not just where they look.

---

## 2. Money — **RAZZLE DAZZLE records payments; QuickBooks does the accounting**

RAZZLE DAZZLE gets a real payments/receipts ledger and an operational view of
what is owed. QuickBooks Online remains the accounting system of record and the
place the books are closed.

**What this means in practice**

- A **payments ledger**: amount, date, method, actor, reference — every receipt,
  not just the first deposit.
- **Stored balance due and aging**, so "who owes us money and how old is it" is
  answerable operationally.
- A **receipt on the appointment→Sold path**, where a deposit is already
  mandatory and today nothing is issued.
- **Change orders move the sale amount**, so the balance and the margin
  denominator stay honest.
- We do **not** build invoicing, collections dunning, or a payment processor.
  Reconciliation to QBO stays a finance process, not a product feature.

---

## 3. Gross profit — **Revenue − (material + contract labor + finance dealer fees + sales commission)**

One definition. It replaces the four formulas currently coexisting in the app.

| Cost component | Source |
| --- | --- |
| Material | RFMS order lines (unit cost × qty) |
| Contract labor | Subcontractor pay — unit/piece rate per the Exhibit B schedule |
| Finance dealer fees | The Synchrony / MOMNT dealer-fee tables already modelled in the Invoice Calculator, selected by the sale's payment method |
| Sales commission | Design consultant commission on the sale |

**What this means in practice**

- GP is **true job cost**, not a material-only margin. Labor-heavy installs stop
  looking more profitable than they are.
- Every GP surface — the sale detail page, the GP report, the DC performance
  matrix and the low-GP alert — must compute from this single definition. Today
  they disagree with each other.
- Because warranty rework is a company cost (see §4), **rework spend should land
  against the job's realized margin**, not disappear.

**Still open:** whether `sale_amount` is gross or net of AZ transaction privilege
tax. Confirm with the CPA before the tax fields are designed — every GP
percentage depends on which one it is.

---

## 4. Warranty — **Lifetime labor, as sold**

Floor Daddy honours what the sales script promises: **lifetime labor**, plus the
12-month Worry-Free Guarantee.

**What this means in practice**

- The signed subcontractor agreement (FD-02) caps sub liability at **two years**.
  Beyond that, **rework is Floor Daddy's own cost** — that gap is deliberate and
  now explicit, rather than an unnoticed contradiction between two documents.
- Warranty entitlement is **stored on the job**, with the clock starting at
  actual completion — which means the completion date has to be captured
  reliably at the job site, not typed later from memory.
- The claims workflow carries the FD-02 acknowledge / schedule / cure clocks, and
  back-charging a subcontractor requires the contractual notice-and-cure record
  to exist first.

---

## 5. Cutover — **still open**

Needs a **date**, and a commitment that the whiteboard and the departmental
spreadsheets are formally retired on it. Without both, the system stays optional
and becomes a second place to type things.
