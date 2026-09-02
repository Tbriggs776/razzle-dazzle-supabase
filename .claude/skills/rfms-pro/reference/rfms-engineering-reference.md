# RFMS — Engineering Reference for the Floor Daddy / RAZZLE DAZZLE Integration

*Synthesised from a full read of the RFMS help centre (2,355 articles) by sixteen domain specialists. Everything below is drawn from RFMS's own documentation. Where the corpus was silent or self-contradictory, that is stated explicitly rather than guessed.*

---

## 1. What RFMS Is

RFMS (now owned by **Cyncly**) is a vertical ERP for flooring dealers. The core product is a **Windows desktop fat client** — a Clarion-built application that runs from a network share (`rfmsnav.exe`, no per-workstation install) against a **single Microsoft SQL Server database** of roughly 700–800 tables. Everything else in the RFMS ecosystem is a satellite of that one database.

It is not a modern SaaS. It is a 30-year-old accounting-first ERP with a modern web/mobile veneer bolted on. Understanding that shapes every integration decision: the desktop app is the system of record, the API is a bridge service on the customer's own server, and most "business logic" is actually hundreds of **System Options** whose values differ per install and, in many cases, per user.

### 1.1 Modules and satellites

| Component | What it is | Where it runs |
|---|---|---|
| **RFMS Core** | Order Entry, Inventory, Products, Accounting (AR/AP/GL/Payroll), Purchasing, E-Commerce, Sales Reports | Windows desktop off a file share |
| **Order Entry** | Quotes, Customer Orders, Claims, Billing Groups, Providers, Job Cost | Core module |
| **Inventory** | Roll & Item inventory, **Purchase Orders live here**, Receiving/Costing, Adjustments, Transfers | Core module |
| **Products** | Master catalog (Rolls / Items / Services), 12 price levels + SRP, cost buckets | Core module |
| **Accounting** | Journal + General Ledger, AR, AP, Banking, Sales Commissions, Human Resources/Payroll | Core module |
| **BidPro** | Separately licensed **cost-driven** estimating module (builder/commercial) | Core add-on |
| **Schedule Pro** | Installation scheduling; keeps its own `X*` tables and syncs to orders via an alert queue | Core add-on |
| **Project Manager (PM / CPM)** | CRM-ish grouping of related records under a "Project"; date-offset workflow automation | Core add-on |
| **RFMS Mobile ("RM")** | Salesperson app — quotes, orders, POS, products, inventory, payments | iOS/Android/web (app.rfms.online) |
| **Warehouse Mobile ("WM")** | Warehouse app — receiving, moves, picking tickets, customer pickup | iOS/Android |
| **RFMS CRM** | Opportunity pipeline (To Do → Contact → Products → Measure → Quote → Won/Lost) | Separate licensed app |
| **Measure Mobile / Desktop** | Takeoff/measuring; exports into an Order, Quote, or BidPro Estimate via "RFMS Link" | Cloud + desktop |
| **RFMS Online Services (ROS)** | Cloud admin portal (admin.rfms.online): users, roles, licenses, branding, **API keys**, record locks | Web |
| **RFMS Next** | Newer web UI (rfms.online) over the **same Core database** — AP, banking, GL, POs, commissions, reports, read-only quotes | Web |
| **My Flooring Link (MFL)** | Customer-facing web doc for view / approve / sign / pre-authorize / pay | Web |
| **Payments Flex** (formerly Cyncly Pay, formerly CardPointe/Clover) | Embedded card processing | Portal inside Core |

### 1.2 The one architectural fact that matters most

**RFMS Mobile, Warehouse Mobile, CRM, Measure exports, RFMS Next, and the public REST API all run through the same on-premise Windows service** — named `RFMSDataEndpoint` on newer versions and `MeasureOrderEntryService` (a.k.a. "the RFMS MOE API service") on older ones. It must be installed on the machine hosting the RFMS program files. Traffic reaches it from Azure via a **Service Bus "store queue."**

Consequences you must design for:

- **Every RFMS Core update is a guaranteed API outage.** The documented update procedure requires stopping this service (plus Gateway, RFMSB2BService, CCA Data Exchange, Sales Force Integration) and confirming they are gone from Task Manager.
- If the dealer's server reboots badly, the service can hang in "Starting" and the API dies silently.
- Azure-side incidents have historically caused multi-hour outages **and once changed store queue IDs**, invalidating every issued API key.
- One badly behaved third-party integration DoS'd the shared API endpoints in Aug 2023, taking the API down for ~16 hours for everyone. Rate-limit yourself.

### 1.3 Subscription tiers

| ERP subscription | API tier | Adds |
|---|---|---|
| Core ERP | **Standard** | CRM only: Customer CRUD/search/get; create Quote / Order / BidPro-Estimate **headers with no lines** (internal notes can be inserted) |
| Professional ERP | **Plus** | Workflow tools, scheduling apps, payment processors; get quotes/orders **with lines**; update headers (no line editing); post (not process) a payment; product search/get; quote/order search; inventory search/get; create claim headers; export quote→order; get/add attachments |
| Enterprise ERP | **Enterprise** | **Order Management + Inventory Management**: create orders *with lines*, manage/edit orders (headers and lines), **assign inventory to orders** |

**If RAZZLE DAZZLE must write order lines or assign inventory, Floor Daddy needs the Enterprise tier.** Confirm this before anything else.

---

## 2. The Core Domain Model

### 2.1 The central insight: there is no separate invoice

**The Customer Order *is* the invoice.** There is no invoice entity, no invoice table, no invoice number distinct from the order number. "Invoicing" is a print/posting event on the same record. The document prints the word **"Acknowledgment"** while it is un-job-costed and **"Invoice"** once job costed — so the header text on a printout is a reliable indicator of state.

Similarly: **there is no separate AR invoice.** The order *is* the receivable. Money received before job costing is not AR — it sits in a Customer Deposits liability and is reclassified at job cost.

### 2.2 Entity map

```
Customer ──┬── Quote (ES…)          ──export/append──┐
           ├── BidPro Estimate (JE…) ──export────────┤
           └── Claim (CL…) ──must attach to──┐       │
                                             ▼       ▼
                                    Customer Order (CG…)
                                       │  = the invoice
                                       │  = the receivable
         ┌─────────────────────────────┼──────────────────────────┐
         ▼            ▼                ▼            ▼             ▼
   Order Lines   Receipts        Provider Records  Job Cost   Billing Group
         │                         (installer pay)  record     (many orders)
         │
   ┌─────┴────────┬──────────────┬─────────────┐
   ▼              ▼              ▼             ▼
Inventory      Purchase Order  Work Order    Overage /
Record         (PO line)       Line          Add-On / Credit Memo
(roll or item)
```

### 2.3 Identifiers — be precise, this is where integrations break

| Entity | Key | Format / notes |
|---|---|---|
| **Customer Order / Invoice** | Order Number | Computer-generated: `CG` + one digit for year-of-decade + 5-digit sequence, e.g. `CG100123`. Max 99,999/year, then rolls into base-36 **excluding I, L, and O**. With "CG Sequence Number by Store" on, the 4th character is the store code (`CG512456` = CG / year 5 / store 1 / seq 2456), 9,999/year/store. Manual numbers are allowed unless "Only Allow Computer Generated Invoices and Quotes" = Yes; `CG` is reserved and may never appear in a manual number. Store prefixes are per-store configurable (a store can use `AO` instead of `CG`, in which case numbering runs sequentially **without regard to year**). |
| **Quote** | Quote / Estimate Number | `ES` + digits, e.g. `ES000011`. **Its own independent sequence.** |
| **BidPro Estimate** | Estimate # + **Est Sub Number** | Observed `JE000012`. Sub Number 0 = primary, >0 = sub-estimate. Estimate # alone is **not** unique. |
| **Claim** | Claim number | `CL000001`–`CL999999`, own sequence. |
| **Customer** | Customer Number (a.k.a. Customer Sequence Number) | System-assigned consecutive integer. **Immutable, never typed.** Duplicate detection = Customer Name **AND** Telephone 1 both matching. |
| **Order Line** | Line Number within order | Sequential; determines print order. `(Invoice Number, Line Number)` is the join key. Not stable — multi-roll receiving auto-splits lines. |
| **Roll inventory** | `(Store, Roll #)` + **SRN** | Roll # ≤12 chars, usually the mill roll number. Roll numbers are unique *unless* "Allow Duplicate Roll Numbers Using Auto Incrementing Suffixes" is on (207091, 207091A, 207091B…). |
| **Item inventory** | `(Store, Product Code, Item Number, **Seq #**)` + **SRN** | **Item Number alone is NOT unique.** Seq # auto-increments each time a record with the same item number is received. |
| **SRN (System Reference Number)** | Unique per inventory record | The true surrogate key. Printed as a barcode on the Inventory Tag **without** a prefix and on the Picking Ticket **with an `I` prefix**. |
| **Purchase Order** | PO Number | Stock POs: `#ST` + consecutive digits. Special Order POs: user-designated ≤8 chars, conventionally **the customer order CG number** so PO / on-order inventory / order share one identifier. |
| **PO Line** | PO Number + 4-digit suffix | Displayed `#ST05807-0027`; **report filters demand the no-dash concatenated form `#ST058070027`**. |
| **Product (catalog)** | **ProductSeqNum** (header) + **ColorSeqNum** (color) | System-generated surrogate keys. Database-instance-specific — must be preserved when round-tripping within one DB and **stripped** when moving between DBs. Style names and SKUs are descriptive and duplicable. |
| **Billing Group** | Billing Group Number | Surfaces on reports/CSVs as **"Project Number."** |
| **Receipt** | Receipt Number | Sequential **per receipt register**, not globally. A receipt number alone is meaningless without its register. |
| **Job Number** | **NOT AN IDENTIFIER** | Free-text, user-relabelable via the "Job Number Prompt" system option, auto-generated on quote export. Never key on it. |

### 2.4 Document-type prefixes at a glance

`CG` = customer order/invoice · `ES` = quote · `JE` = BidPro estimate · `CL` = claim · `#ST` = stock PO · `D001/D002/D003` = document barcode prefixes for invoice / work order / picking ticket · `I…` = item inventory barcode (SRN) · `R…` = grouping barcode for fungible items.

---

## 3. Flooring-Specific Concepts an Outsider Gets Wrong

### 3.1 There are three product files, not one

RFMS's Products module is **three parallel tables**: **Rolls**, **Items**, **Services**. They have different screens, different fields, different CSV shapes.

- **Rolls** — carpet and sheet vinyl. Product Code is **always 01 or 02** and cannot be changed. Measured as **width × linear feet**, converted to square yards. Carries **two costs**: roll cost and cut cost.
- **Items** — everything countable: tile, wood, pad, sundries, rugs, supplies. Single item cost. Carries carton/pallet/truck/container tiered costs.
- **Services** — labor. Single service cost, no freight/pad/rebate structure.

A single API abstraction over "product" loses information.

### 3.2 Roll vs Cut vs Remnant — three different things

- **Roll / Cut** is a flag (`R` / `C`) on the PO line and inventory record describing *how you bought it*: a full mill roll, or a piece the mill cut to length. It does not change the quantity math, but every roll report can filter on it, and the Roll/Cut Comparison screen models buying a longer roll cheaper vs an exact cut.
- **"Cut" as a line status** is completely unrelated: it means material has been physically committed off an inventory record to an order line.
- **Remnants** are handled by a *Transfer to Item Inventory* adjustment: the roll remainder becomes an **item** in Product Code 03 (rugs) with the roll number as the item number, quantity 1, priced at (yardage × per-yard cost) — **and the physical dimensions become free text in the comments field**, no longer queryable.

### 3.3 Product Code (PC) — the classification everything hangs off

A 2-digit code, 01–99. No new codes can be created; only descriptions are editable, and 01/02 cannot be edited at all.

- 01 Carpet, 02 Vinyl (roll goods, always)
- 03 Rug, 04 Pad, 05 Wallpaper, 06 Ceramic, 07 Wood, 08 Supplies, 09 Sundries, 10 In-Store Use, 11 Composition Tile, 12 Draperies, 13 Laminates (shipped defaults)
- Everything from 03 up to **(Starting Service Code − 1)** = material
- **Starting Service Code** (default 80, settable 2–98) up to 98 = labor/service

**This single option determines how the order header's Material vs Services money buckets are computed.** It cannot be changed once codes in the affected range are in use.

### 3.4 Unit of measure is not a simple field

Three independent layers:
1. The product's `Units` field (from a maintained list of 100+ values, from "Square Yard" to "55 Gallon Drum").
2. Buy Qty / Sell Qty / BuyConversion / SellConversion / "Buy in Multiples of" / "Sell in Multiples of."
3. **Workstation-level display options**: `Square Foot Calculations`, `Use Meters`, `Use Linear Meters`, `Item Products Size (Width × Length)`.

Two users can legitimately see different numbers for the same product. Roll prices are stored internally in square yards and divided by 9 for square-foot users, producing real round-trip drift (\$5.00/SY → .556/SF → \$5.004/SY) that RFMS writes back as a *new cost record*. Any cost comparison must tolerate ~0.005 and must not treat a changed transaction date as evidence of a real edit.

RFMS's documented answer to "we buy in cartons and sell in square feet" is **create two product records and move stock between them with an inventory adjustment**. Expect deliberate duplicate-looking products.

### 3.5 "Job" is ambiguous three ways

1. Informally, the whole piece of work (an order, or a billing group).
2. The **Job Number** header field — free text, relabelable, not a key.
3. **Job Cost** — the posting routine that recognises revenue.

### 3.6 "Delivered" never means delivered

**"Delivered" on an order means job costed.** The Delivery Date field is the job-cost date, not a logistics date. A job physically installed and paid but not job costed is "Undelivered" for every report in the system.

At the *line* level under ERRM, "Delivered" does mean the delivery ticket printed. The two senses coexist. This is the single most reliable way to get a margin report wrong.

### 3.7 Store is a first-class scoping dimension

Store Code is a single character (blank, 0–9, A–Z; max 37) unless "Store By Number" is on (then 001–254, zero-padded). It is **immutable after creation** and deletion requires an RFMS access code. It carries tax configuration, document-number prefixes, duplicate-order checking, a purchasing ship-to, and per-user visibility.

There are **three separate per-user store visibility options**: Order Stores Visible to User, Product Stores Visible to User (None/View/Assign), Inventory Stores Visible to User (None/**Request**/View/Assign). The user's default store is always forced to Assign.

**An API reading "all orders" may quietly get a subset**, depending on the default user bound to the token.

---

## 4. The Order Lifecycle, End to End

### 4.1 The document ladder

```
CRM Opportunity ──► Measure Project ──► Quote (ES) ─┐
                                                     ├─► Customer Order (CG) ─► Job Cost ─► AR ─► Cash
                     BidPro Estimate (JE) ───────────┘
```

- **Export** creates a *new* order. **Append** adds lines to an *existing, non-job-costed* order.
- The source document is never deleted, only flagged exported.
- **A quote or estimate can be exported more than once**, producing multiple orders. Never assume 1:1.

### 4.2 The material line-status ramp (this is the real state machine)

Order-level status is nearly meaningless; **line status is where the truth is.**

```
None ──► Gen PO ──► On Order ──► [receive] ──► Cut ──► [ERRM: Staged] ──► Delivered ──► Job Costed
  │                                              ▲
  └──► Reserved ─────────────────────────────────┘
  └──► Requested ──► InTransit ──► Reserved   (cross-store)
```

**Stored internal codes** (visible in Audit Viewer and likely in raw data): `(blank)`=None, `P`=Gen PO, `O`=On Order, `R`=Reserved, `C`=Cut, `J`=Job Costed. PO status: `O`=Open, `S`=Satisfied.

| Status | Meaning |
|---|---|
| **None** | Nothing committed. |
| **Gen PO** | Flag on the *order line* meaning "this must still be purchased." **Not a purchase order** — the PO only exists once someone presses the line's PO button or runs Auto PO. |
| **On Order** | A PO line exists and is assigned to this order line. |
| **Requested / InTransit** | Cross-store pull: this order wants inventory in a store the user only has "Request" access to. |
| **Reserved** | A specific inventory record is soft-committed. Reserved value **is** counted in inventory value reports. |
| **Cut** | Inventory hard-committed / physically allocated. Counts toward inventory "Used" (non-ERRM). Job costing requires every line Cut or Delivered. |
| **Staged** | **ERRM only.** Created by printing the picking ticket. Inventory record stays Reserved. Staged lines are *not* counted in the "Requisition" total. |
| **Delivered** | Shipped/installed. Under ERRM, set by the delivery ticket, and this is what flips the inventory record Reserved→Used with immediate journal entries. |
| **Job Costed** | Terminal. |

Reporting semantics you'll need:
- **"Requisition"** = Cut + Delivered only (excludes Gen PO, On Order, Reserved, None, Staged).
- **"Material Cost to Date"** = Gen PO + On Order + Reserved + Cut + Delivered (excludes None).
- Order-level roll-up used by Project Manager: `NO LINES` / `MATERIALS NOT ALLOCATED` (any line None/GenPO/OnOrder) / `MATERIALS ALLOCATED` (none of those and ≥1 Cut/Staged/Reserved) / `MATERIALS DELIVERED` / `COMPLETED` (all job costed). **This roll-up is a ready-made contract for a "material readiness" field.**

### 4.3 The two accounting regimes — you must know which one Floor Daddy runs

| | **Non-ERRM (default)** | **ERRM** |
|---|---|---|
| Line ramp | Cut → Delivered (picking ticket does both) | Cut → **Staged** → Delivered |
| Inventory Reserved→Used | at Cut | at **Delivery Ticket** |
| GL postings | monthly lump "Month End Summary" at Journal Close | **real-time**, per transaction, with Batch Numbers |
| Revenue event | Job Cost | **Book** (separate from Bill and from Job Cost) |
| Sales booked | **gross, including sales tax** | net; tax posts to Sales Tax Payable at Book |
| AR ages by | Delivery (job cost) date | **Bill date** |
| Extra accounts | — | WIP Material, WIP Labor, Accrued Inventory, Accrued Labor, A/R Unbilled, Inventory in Uncosted, Receipts Not Deposited |

**ERRM cannot be uninstalled.** The only reversal is restoring a pre-installation backup. It forces `Balance Lines with Header = Yes` (then hides the option) and `Job Cost Not Costed Inventory = No`. Pre-ERRM records are not converted and keep old behaviour forever — so a mid-transition database has two populations of orders behaving differently.

**ERRM order sequence:** Bill (creates the AR invoice, stamps Bill Date, posts JEs) → **Book** (requires all lines Delivered and providers balanced; posts revenue and COGS; stamps Delivery Date; **locks the order**) → Job Cost (close date, commissions). To edit a billed order you must Un-Bill it first.

### 4.4 Printing is a state transition

This trips up everyone:

- **Printing a picking ticket moves Cut lines to Delivered** (non-ERRM) or Staged (ERRM).
- **Printing an invoice auto-job-costs the order** if it contains all cut material and is paid in full — stamping the Delivery Date, posting GL and commissions, and locking the order.
- Printing an acknowledgement stamps/advances the Invoice Date, which can never be moved backwards.

An integration that triggers document printing can inadvertently close a period-sensitive posting.

---

## 5. Money in RFMS

### 5.1 Pricing

There is no single "price." A product carries **12 numbered price levels plus SRP**, each holding *either* a literal price *or* an algebraic formula that the system evaluates to produce the stored price.

Formula variables: `C` cut cost, `R` roll cost, `I` item cost, `S` service cost, `F` freight factor, `P` pad cost, `L` load ($), `LP` load %, `P1`–`P12` previously generated levels (a level may only reference *lower*-numbered levels; only SRP may reference all).

**Price resolution order** with `Use Price Level = Price Levels`:
1. The price level named on the customer record →
2. Price Level 1 if the customer has none →
3. the selling price on the **inventory** record if the product has no price levels →
4. **zero**, requiring manual entry.

If the customer's level is lower than any level defined on the product, RFMS silently falls back to the product's *lowest* level.

Layered on top, mutually interfering: **Discount Levels** (percentage by product code — and turning them on *hides* the product price levels entirely, then discounts on top of the already-discounted formula price — genuine double discounting), **Price Modifier** (line shows pre-discount unit price, invoice prints the modified one; the delta is only visible via View Lines), and **Contract Pricing** (dated per-customer/property price or margin).

**Contract Pricing resolution order:** line-level override → property contract → company contract → catalog price.

Whether prices are even current depends on `Price Update Method`: "Update All Prices Automatically" vs "Update Prices Manually in Products Mode" — under the latter, Order Entry will **not** refresh a price when a product is pulled onto a line, and a newly entered formula produces no price at all.

### 5.2 Cost buckets

Cost is not one number either:

| Bucket | Source | Posts to GL? |
|---|---|---|
| **Gross Cost** | inventory record (specific identification — no FIFO/LIFO) | Yes — this is what job cost credits Inventory for |
| **Net Cost** | Gross − AP discount + AP freight costed on the payable | reporting only |
| **Freight** | actual freight on the supplier invoice, allocated at costing | Yes |
| **Freight Factor** | per-unit or %-of-cost adder from the product file | **No** — never charged to the GL |
| **Load / Load %** | flat adder on product, inventory, or supplier record | **Never posts to the GL** — job cost and commission only |
| **Overhead Margin** | a *gross-up*: `cost ÷ (1 − OH%)` | **Never posts to the GL** |
| **Labor** | **Provider records**, not service lines | Yes |
| **Misc Extra Cost** | entered at job cost | not retained through un-job-cost |
| **Use Tax** | computed on material gross cost at job cost | **never auto-posted in any RFMS environment** — must be accrued manually |

**Overhead Margin worked example:** \$500 cost at 5% → 500/.95 = \$526.32, i.e. \$26.32 of overhead, dropping a 50% job to 47.37%. Changes are only inherited by orders created *after* the change (since v10.5).

There is **exactly one Cost of Material account and one Sales account.** Any breakdown by product category must be derived from reports, not from GL accounts.

### 5.3 Gross profit

Authoritative formula (RFMS "Accounting Terms"):

```
GP% = (Total Selling Price − Total Costs) ÷ Total Selling Price × 100
```

computed **before commissions**. Net Profit includes them. Cost side = Material + Labor + Misc + Freight + Overhead Margin + Load + Load% + Tax.

**Job Cost Analysis stores THREE gross profit percentages per job, not one:**
- `GPGrsSales` — GP ÷ Delivered Sales (invoice total incl. labor and sales tax)
- `GPMatOnly` — GP ÷ material-only sales
- `GPNetSales` — GP ÷ (invoice total − sales tax)

plus `Profit_After_Comm_D` / `_P`.

Because Non-ERRM books Sales *gross of tax*, several RFMS margin denominators are **tax-inclusive**. A tax-exclusive GP computed externally will never match.

**Sales commission is NOT subtracted from RFMS gross profit.** Referral fees *are* (they add to Service Cost).

⚠️ **"Net Sales" means three different things** depending on the report: Sales Totals = ex sales tax and use tax; Profit Analysis = `Total Sales − (Labor Cost + Tax Liability)`; Job Cost Analysis = `Invoice Total − Sales Tax`.

### 5.4 Header money buckets are computed, not free-form

`header.Material` = sum of lines whose PC falls in the material range. `header.Services` = sum of lines in the service range. `Misc. Charges` is a header-only dollar field with **no backing lines**.

If `Balance Lines with Header = Yes` (mandatory under ERRM), the sums are *enforced* and edits are rejected otherwise.

**There is no Recalculate button.** Recalculation is continuous and implicit, and it can silently overwrite manual overrides. The documented rounding-correction cascade is: adjust the **largest material line** by the difference → then the largest service line → then Misc Charges → finally Sales Tax. **An integration that writes a precise line amount can find that exact line silently adjusted by cents.**

### 5.5 Tax

**Resolution order:** Customer Tax Type → Tax Certificate → **City List matched on the ship-to city** → Store Code → order/line checkboxes under Line Tax.

`Compute Sales Tax by Selling Store's Location` forces the store's setup for **sales tax only**; **use tax always checks the ship-to city first.**

**Tax methods** (per city or per store): Sales Tax · Use Tax · **Line Tax** (decided per line, prompting on every line) · HST. A store/city method mismatch silently pushes the order into Line Tax mode.

**Tax bases** are set in City or Store setup and **cannot be changed inside an order**: Material / Material+Labor / Material+Labor+Misc / Material+Misc (Misc Tax Base adds two more that include Sales Tax in the base).

**Use Tax** is the store's own liability, computed on **material gross cost at job cost time**, invisible on customer documents. It switches on when the ship-to city or store is configured for Use Tax **and** the order has a service line, a service amount, or a material line with zero price — which means an order can legitimately show Sales Tax with only material lines, then have that Sales Tax *removed* from the header once a labour line is added.

RFMS distinguishes **Sales Tax Collected** (the editable header field — what the customer paid) from **Sales Tax Due** (recomputed from store/city setup). They differ materially whenever anyone hand-edited the order.

### 5.6 Cash: the three-stage pipeline

```
(1) process at the gateway  →  (2) post a RECEIPT in RFMS  →  (3) post a BANK DEPOSIT
                                    (order balance drops)        (this is where GL entries happen)
```

Stages 1 and 2 are decoupled and **routinely drift** — hence the Pending Payments queue with Retry Post / Kill Post. The API's payment capability is **stage 2 only**: "post a payment to an order (not process)."

**Receipts** are the durable artifact. They live in numbered **receipt registers** (typically one per store and/or tender type), and receipt numbers are sequential *per register*. Deposits must consume an unbroken contiguous range of receipt numbers, **including \$0.00 receipts created by discount-only postings**, all within the same month as the deposit date.

**Card number → register routing:** typing the card number into the `Reference` field matches it against **Credit Card Prefix** records, which auto-select the receipt register. RFMS never stores card data or tokens — tokens live in the processor.

**ERRM bill-date pivot:** a payment received **on or before** the Bill Date credits Customer Deposits; **after** the Bill Date it credits A/R. Same dollar, one day apart, different balance-sheet account.

### 5.7 Commissions

Computed **at job cost**, from a sliding-scale **Commission Schedule** (up to 99 schedules, 16 splits each) attached to the salesperson. Written as Sales Commission records; the dollar figures are then **hand-keyed into payroll** — commission never posts to the GL until it is paid.

Two separately configurable dimensions:
- **Commission Base Type** (the dollar base): Invoice Total − Tax | Profit | Amount Paid (collected) | Material | Inv. Total − Tax (Original Only) | Inv. Total − Tax (Overages Only)
- **Commission Base Percent Type** (the *ratio* that selects which split row applies): Profit/(Invoice Total − Tax) | Profit/Material Only | **Profit/Installation Cost** | Material Profit/Material Total

Because the percent type can divide profit by installation cost, the "Base Percent" on a job cost sheet can read 185.71% on a job with 43.33% gross profit. **Never treat commission base percent as a margin.**

**Commission Pay Type** (global): Written Sales (**creates no commission records at all**) | Delivered Sales | Delivered & Paid (requires zero balance) | Delivered and Paid Less Retainage.

### 5.8 Period close and reversibility

Two-tier lock: monthly **Journal Close** (preliminary → save) then **General Ledger Close**, then annual **G/L Year End** (which zeroes income-statement accounts to Retained Earnings and **deletes journal detail**).

**Un-Job Cost posts its reversals into the ORIGINAL delivery month, not the current one.** Job costed in January, un-job costed in February → January's numbers change. It is blocked entirely if that month's journal is closed; the only remedy then is a brand-new adjusting order.

Reopening requires an **access code** from RFMS and rolls back exactly one month per invocation. Both Re-Open Journal and Re-Open G/L are automatically written to the Audit Viewer.

---

## 6. Material & Purchasing

### 6.1 Purchasing lives in the Inventory module

`Inventory > File > Purchase Orders`. There is no separate Purchasing module.

**The PO line is 1:1 with a physical material record.** The moment a PO line is created, RFMS writes a corresponding **"On Order" inventory record** (roll or item) that later mutates *in place* into the received record. For a Special Order PO, the PO number, the on-order inventory record, and the customer order line can all share one identifier (the CG number).

### 6.2 PO statuses

| Status | How it is set |
|---|---|
| **To Be Ordered** | `Taken By` is blank |
| **Open** | Populating `Ordered By` / `Taken By` — **that is literally what flips the status**; there is no "send order" action in Core |
| **Open-WA** | Will Advise flag (green) — pre-alert to the mill |
| **Sent EC** | Transmitted electronically, no supplier pickup confirmation yet (yellow) |
| **OPEN (EC)** | Supplier acknowledgement (855) received (turquoise); **red** = on HOLD or Rejected |
| **Backordered** | Manual toggle after a short shipment |
| **Satisfied** | *Every* line received |
| **Cancelled** | Deletes the on-order inventory record and its SKU |

### 6.3 Two ways to create POs

- **Per line:** put the order line in Gen PO status, press the line PO button, fill Express PO Generation (`Taken By` and `Promise Date` required). Two outcomes: *Generate PO Only* → PO Open, line On Order; *Generate PO AND Receive the Goods* → PO immediately **Satisfied**, an inventory record is created, amount shows as Used, line goes to **Cut**, and the new roll/item number = invoice number + a 4-digit suffix. That second one is effectively irreversible bookkeeping in one click, and the cost is provisional until the supplier invoice arrives.
- **Auto PO / To Buy List:** bulk-converts all Gen PO lines. Can assign existing stock instead of buying (green roll icon = match on Product Code + Style + Color, and Store if configured, with Available > 0 — it does *not* consider dye lot, width, or age).

### 6.4 Receiving, then costing — two separate steps

- **Receive from Bill of Lading** creates an **uncosted** record: no invoice number, no invoice date. That absence is the reliable programmatic test for "uncosted."
- **Cost from Invoice** verifies the supplier price, stamps invoice number + date onto the record, and pushes the payable into AP. **Inventory payables must originate here, not from AP directly.**

During receiving you are asked **"Cut/Deduct from Inventory?"** — behaviour differs by regime: non-ERRM Yes → line Cut and inventory moves to Used; **ERRM Yes → line Cut but inventory stays Reserved** until the delivery ticket.

**Multi-Roll Receiving:** receiving part of a PO line auto-generates an **additional PO line** for the balance *and splits the corresponding customer order line*. So PO line counts and order line counts are not stable over the life of a PO.

### 6.5 Quantity math

```
Available = Beginning (received) − Used − Reserved
```

- **Used** = quantity on lines in Cut, Delivered or Job-Costed status, plus size adjustments. **Not** reflected in inventory value reports.
- **Reserved** = quantity from assigned order lines. **Is** reflected in inventory value reports.
- **Soft Reserve** = a temporary, order-independent hold that **can still be sold**. Separate bucket.
- `Total Available for Sale = Available − Soft Reserves − Allocated to Orders`, where "Allocated" means matching order lines in **None** status.

**Never write Available, Used, or Reserved.** They are derived from order line status. The only sanctioned way to change Reserved is to change a line status; the only sanctioned way to change quantity after costing is an **Adjustment**.

### 6.6 Adjustments and which ones hit the GL

| Type | Posts to GL? | Creates a new record? |
|---|---|---|
| Scrap, Shortage, Sample, Replacement | **Yes** | No |
| Transfer → Another Roll | No | Yes (requires costed) |
| Transfer → Item Inventory | No | Yes (requires costed) |
| Transfer → Remove from Inventory | **Yes** | No (also writes a job cost file record) |
| Transfer → **Another Store** | **Yes** (two adjustments) | Yes — **the only adjustment allowed on uncosted inventory** |

Sign convention is inverted from intuition: on the Inventory Adjustment Report a **negative** material cost total *increases* inventory.

### 6.7 E-Commerce / FCB2B

Electronic purchasing runs on the Flooring B2B standard: **832** catalog · **850** PO · **855** acknowledgement · **856** ASN · **810** invoice · **860** PO change.

**ASN matching is exact on three fields only: PO number, SKU, quantity.** Statuses: New → Partially Matched → Matched. Finalize Match is all-or-nothing; any "No Match" means archiving the ASN and falling back to Receive from BOL.

---

## 7. Scheduling & Field Execution

### 7.1 Schedule Pro is semi-detached

Schedule Pro **copies** order lines into its own tables (all prefixed `X`: `Xjobhdr`, `Xjobdtl`, `Xcrew`, `XDepot`, `Xstatus`, `Xmattype`, `XmatPC`, `Xbcoe`…) rather than scheduling order lines in place. It stays in sync via a one-way **Alert** queue plus optional Estimated-Delivery-Date write-back into the order.

Core objects: **Scheduled Job** (header) → **Scheduled Job Lines** → assigned to a **Crew** belonging to an **Installation Depot**, on a **Date + Job Time Slot**, categorised by **Job Type** (derived from Product Code via a *required* mapping table), moving through a **fully user-definable Job Status list**.

**Job statuses are data, not code.** Ten defaults ship and every one is editable or deletable. The commonly documented convention is `SCHEDULE REQUESTED → SCHEDULED → CONFIRMED → IN PROGRESS → PHASE COMPLETE / JOB COMPLETE`, with side exits to Reschedule, Inspect, Cancelled. **Resolve statuses by lookup; never hard-code the strings.**

### 7.2 Change reconciliation is manual and lossy

Order Entry edits do **not** flow automatically into Schedule Pro. They raise alerts — but **only if the editing user had the corresponding "Create Alerts for…" checkbox ticked in their own system options.** If not, the change happens silently and the schedule diverges.

Four bulk "auto update" buttons clear alerts (quantities, voids, deleted lines, job-costed housekeeping) — and **they ignore the on-screen filters entirely.** Style/Color/Unit changes have **no** auto-update path at all.

### 7.3 Capacity is computed

Capacity depends on a 2×3 matrix of options (Auto vs Manual depot capacity × Crews-Available vs Quantity-Available × Auto vs Manual deduction), with real formulas including a "crossover deduction" for crews who install multiple job types. Adding or editing a job type, crew, or capacity requires manually running **Reset Depot & Crew Capacities** or the screen shows stale numbers with no warning.

### 7.4 Labor pay: Provider records

Installer/subcontractor pay is **not** entered in HR and **not** entered as order lines. It is a **Provider Record** attached to the customer order.

- The provider must first exist in HR Worker Information with Provider = Yes and Active. Free-typed names cannot create valid provider records.
- With `Integrate Provider's Earnings = Yes`, provider charges **must balance, by product code, against the COST of the order's service lines** (PC 80–98) — an unbalanced order will not job cost.
- Force-balancing **rewrites unit costs on existing service lines** (all lines of that product code) or inserts a "Computer Generated" line, destroying the estimate-vs-actual baseline.
- Negative provider records implement back charges. `Do Not Pay` excludes from pay but **still accrues**; `Do Not Accrue` removes it from the GL/WIP. "OK to pay but Do Not Accrue should NEVER be used."
- Print & Post is a **two-step, effectively one-way** cycle: preliminary print (repeatable) → **Final Print & Post** (stamps Date Paid, records vanish from all earnings reports). Unposting needs an access code.

### 7.5 Mobile Work Orders

Installers are invited by email as guest identities (Installer = own crew; Field Supervisor = multiple crews) and see Schedule Pro work orders inside RFMS Mobile. Permissions gate Work Ticket Notes, Work Order Notes, Labor Amounts, Balance Due, Change Status, All Attachments, and a hard **days-before / days-after visibility window**. Invitations are **single-use**.

### 7.6 ⚠️ Scheduling has no API

**The documented RFMS REST API contains no create/read/update of scheduled jobs, crews, depots, capacities, or job statuses at any tier.** "Scheduling Apps" appears only as a marketing-level capability of the Plus tier; the enumerated methods do not include scheduling. The only documented access path is the `X*` tables via Crystal Reports/SQL, or CSV exports (Daily Scheduling CSV, Job Summary CSV).

**This is the single most important finding for a project that intends to own scheduling.**

---

## 8. The API

### 8.1 Shape

- **REST**, Azure-hosted public endpoint → Azure Service Bus **store queue** → on-prem `RFMSDataEndpoint` service → SQL database.
- Auth = **Store Queue** value (format `store-xxx1234`) + **API Token** (opaque string).
- Generated at **RFMS Online Services → RFMS Online tile → API button → Generate Key** by an Administrator. You must choose a **default user** and give the token a label. Tokens are listable and individually revocable.
- **Third Party Developer opt-in:** a TPD requests access using the store's **RFMS Business ID**; an admin approves and picks the RFMS user the requests run as. Produces a key the store cannot use itself but can revoke.
- Prerequisite: the **RFMS MOE API service** installed store-side (already present if they use RFMS Mobile, RFMS Cloud Link, CRM, or the Podium integration).

### 8.2 Capability by tier

| Capability | Standard | Plus | Enterprise |
|---|:---:|:---:|:---:|
| Create / edit / search / get **Customer** (with duplicate detection) | ✅ | ✅ | ✅ |
| Create Quote / Order / BidPro Estimate **headers** (no lines; internal notes OK) | ✅ | ✅ | ✅ |
| Get quotes and orders **with lines** | — | ✅ | ✅ |
| Update quote/order **header** info (no line editing) | — | ✅ | ✅ |
| Search quotes and orders | — | ✅ | ✅ |
| **Post** a payment to an order (not process) | — | ✅ | ✅ |
| Search / get **product** information | — | ✅ | ✅ |
| Search / get **inventory** information | — | ✅ | ✅ |
| Create **claim headers** | — | ✅ | ✅ |
| Export a quote to an order | — | ✅ | ✅ |
| Get / add **attachments** | — | ✅ | ✅ |
| **Create orders WITH lines** | — | — | ✅ |
| **Manage / edit orders (headers and lines)** | — | — | ✅ |
| **Assign inventory to orders** | — | — | ✅ |

*(The exact checkmark grid did not fully survive scraping of the tier table; the tier→capability mapping above reflects the narrative descriptions. **Confirm the precise tier for "post a payment" and "get quotes and orders with lines" with RFMS during the live spike.**)*

Explicitly **not present at any tier**: purchase orders, receiving, scheduling, crews, provider/installer pay, commissions, GL/journal, payroll, adjustments, work orders.

> ⚠️ **CORRECTED — this sentence is wrong about scheduling, crews and provider pay.**
> It is one of the ~16 help-centre API claims catalogued in §3 of the API reference.
> §2.6 there documents 18 Schedule Pro endpoints, and Cyncly confirmed in writing
> (2026-08-31) that Floor Daddy holds Enterprise, whose published matrix includes
> "Schedule new jobs and edit existing jobs", "Create provider records" and "Get
> scheduled jobs by crew or order number". Purchase orders, receiving, commissions,
> GL/journal, payroll and adjustments remain genuinely absent.
> Left in place rather than deleted so the catalogue of help-centre errors stays honest.

### 8.3 The token inherits a human user's permissions

This is critical and easy to miss. RFMS's own guidance: the default user "should generally have broad System Option permissions." Practically:

- The API's visible stores, assignable inventory, searchable documents, and price levels are all functions of that user's **System Options** — not of the token.
- A failing call may be caused by `Order Stores Visible to User`, `Inventory Stores Visible to User`, `Allow Unreferenced Lines`, `Allow Over Assignment of Inventory`, or an Order Line Status password level — not by the endpoint.
- Changing that user silently changes API behaviour.

Create a **dedicated integration user**, document its System Options, and treat that config as part of the integration contract.

### 8.4 Concurrency: record locks are real

- RFMS takes a **record lock** on a quote/order while it is being edited in Core Order Entry, RFMS Mobile, or via the API.
- ROS exposes **Quote/Order Locks** management (Manager/Administrator) so locks can be inspected and revoked; `Accounting > Utilities > Release API Locks` is the Core equivalent.
- **The #1 documented cause of a card payment failing to post as a receipt is that the order is open or in edit mode.** Anything that holds orders open will manufacture failures for humans.
- Design for 409-style contention. Do not hold records open across long operations.

### 8.5 Reliability history (plan for it)

- Aug 2023: ~16 hours of API timeouts caused by a client integration that "unintentionally simulated a Denial-of-Service attack."
- Aug 2023: ~16 hours of blanket 403 Forbidden for TPD accounts after an RFMS security change.
- Apr 2023: Azure Service Bus maintenance broke the endpoint; recovery required **regenerating every API key**, and **store queue IDs changed.**
- Published maintenance windows take down the Public API, RFMS Mobile online, CRM online, ROS, Next, and My Flooring Link **together**.

Treat Store Queue and Token as **rotatable configuration**, never constants in code.

### 8.6 Non-API read paths

Where the API tier does not reach, these exist and are documented per report with named CSV columns:

- **Materials Analysis (Orders)** — the widest line-level extract: `UnitCost, TotalCost, UnitPrice, LineTotal, Profit, ProfPerc, OCFrt, OCLoad, OCOverhead, UseTaxLine, APInvNumber (vendor invoice number per line), PO Number, Inventory PO Num, Date_Rcvd, DelTicketDate, Promise Date, Measure Date, Stock flag, Bin Location, LineStatus`
- **Job Cost Analysis** — effectively the job cost record schema
- **Purchase Order Summary / Listing / Needs** — the only structured PO extract
- **Roll/Item Inventory Range, Value, Information, Physical; Inventory Balance; Adjustments; History; Reserve; Stock Status; Stock Replenishment**
- **Daily Scheduling / Job Summary CSV** (Schedule Pro)
- **Receipt Recap** (payments)
- Reports can be automated with a saved filter + Windows Task Scheduler — though **saved filters are user-specific**, and RFMS's older scheduled-email mechanism was discontinued in June 2026.
- Direct SQL/ODBC read (db_datareader) is a documented pattern; the full table list is published.

---

## 9. Integration Playbook for RAZZLE DAZZLE

**Premise:** RAZZLE DAZZLE is the operational system of record. RFMS is authoritative for material — cost, PO/receipt status, and line-level fulfilment.

### 9.1 Where the boundary should sit — opinionated

| Concern | Owner | Why |
|---|---|---|
| Customer identity | **RFMS** (mirror it) | System-assigned immutable Customer Number; duplicate detection is built into the API |
| Selling document (quote/order) | **RFMS** — it is the invoice and the receivable | Creating a parallel order document guarantees divergence |
| Material cost | **RFMS** | Specific-identification inventory, costing against supplier invoices, no equivalent elsewhere |
| PO / receipt / inventory status | **RFMS** | The line-status ramp is the only truth |
| **Scheduling & crew dispatch** | **RAZZLE DAZZLE** | No API exists; Schedule Pro's sync is a lossy alert queue. Own this outright. |
| Field execution, photos, checklists, subcontractor onboarding | **RAZZLE DAZZLE** | RFMS's mobile surfaces are thin and permission-gated |
| Installer pay computation | **RAZZLE DAZZLE** proposes, **RFMS** records | Provider records must balance to service lines; write only through Enterprise-tier order edits or leave manual |
| Accounting, tax, GL, AR/AP, commissions, payroll | **RFMS only** | No API. Do not attempt to mirror or compute. |

### 9.2 What to READ from RFMS

Read continuously, keyed on `Invoice Number` and `(Invoice Number, Line Number)`:

1. **Order headers** — store, sold-to/ship-to, customer number, PO number, order date, delivery date (= job cost date), tax status, totals, balance due, job-cost state.
2. **Order lines** — Product Code, style/color, quantity/UOM, **line status**, gross cost, PO number, inventory PO number, date received, delivery ticket date, promise date, area, line group.
3. **Inventory records** for those lines — SRN, roll/item number + seq #, PO number, Available/Used/Reserved/Soft Reserve, date received, **invoice # and invoice date** (the costed/uncosted test), dye/run lot, location, gross cost.
4. **Products** for catalog identity — persist **both** `ProductSeqNum` and `ColorSeqNum` plus a natural-key fallback (PC + Supplier + Private Style + Color).
5. **Attachments** (Plus tier) — but note **PNG and HEIC are not supported**; a mobile-photo pipeline must convert to JPG.

Derive a **material readiness** field per order using RFMS's own roll-up definition (§4.2) rather than inventing one.

### 9.3 What to WRITE to RFMS

Ordered by risk, lowest first:

1. **Customers** (Standard tier) — safe. Always populate Telephone 1 (it is half the duplicate key). Normalise to **UPPER CASE**: "RFMS cannot convert data when it's copied and pasted."
2. **Quote / Order / BidPro Estimate headers as sales opportunities** (Standard tier) — safe, but they carry no lines.
3. **Internal Notes** on those headers (Standard tier) — a legitimate low-risk channel for carrying a RAZZLE DAZZLE reference ID into RFMS. Keep it short: only ~24 lines print and a note must fit one page.
4. **Attachments** (Plus tier) — good for photos, signed documents, measure output.
5. **Post a payment** (Plus tier) — this is *receipt-writing only*, equivalent to Core's "Post Receipt Only." It does not authorize or capture. **Only do this if RAZZLE DAZZLE is genuinely taking money elsewhere**, and never against an order that might be open in Core.
6. **Order lines and inventory assignment** (Enterprise tier only) — the highest-value and highest-risk write. See constraints below.

### 9.4 What you must NOT try to do

- ❌ **Do not build scheduling on RFMS.** There is no API. Do not try to write Schedule Pro `X*` tables directly.
- ❌ **Do not write Available / Used / Reserved.** They are derived. Change line status instead.
- ❌ **Do not create or receive purchase orders via the API.** There are no PO endpoints.
- ❌ **Do not post to the GL, create journal entries, or compute tax.** No API, and tax depends on store/city configuration you cannot see.
- ❌ **Do not trigger document printing** (invoice, picking ticket) as a side effect. Printing is a state transition that can job-cost and lock an order.
- ❌ **Do not key on Job Number.** Free text, relabelable, non-unique.
- ❌ **Do not key on Item Number alone.** Use `(Store, PC, Item Number, Seq #)` or SRN.
- ❌ **Do not parse the store out of a CG number.** If the store code on an order is changed after creation, the CG number does not change.
- ❌ **Do not cache material cost without also capturing line status.** Cost re-derives from Products when status is None/Gen PO and from Inventory when Reserved/Cut/Delivered.
- ❌ **Do not assume quote:order is 1:1.** Quotes and estimates can be exported repeatedly.
- ❌ **Do not use RFMS notifications as change-data-capture.** Edit notifications fire only on a fixed short field list (name, ship-to city, store, job #, PO #, sales reps, dates, tax status, totals, commission split) — line-level changes never fire. And automated notifications only send between 7am–9pm workstation clock, and not at all until someone opens the program that day.
- ❌ **Do not touch the access-code "Fix" routines** or expect data that passed through them to reconcile.

### 9.5 Practical integration shape

**Recommended architecture:**

```
RAZZLE DAZZLE (operational SoR)
   │
   ├── polls RFMS API on a schedule (with backoff) for:
   │     order headers changed since T, order lines, inventory for referenced records
   │
   ├── writes: customers, opportunity headers + internal notes, attachments
   │     (+ order lines / inventory assignment ONLY if Enterprise tier)
   │
   ├── owns entirely: scheduling, crew dispatch, field app, subcontractor onboarding
   │
   └── reconciles nightly against a CSV/report extract (Materials Analysis, PO Summary)
         to catch anything the API missed or anything a Fix routine mutated
```

**Polling, not push.** There is no webhook. Notifications are too field-narrow to be a change feed. Poll with a `since` window generous enough to catch backdated edits — remember that un-job-costing rewrites history into a *past* month.

**Idempotency.** Every write should carry a RAZZLE DAZZLE reference in the Internal Note or PO Number field so a retry can be detected. Expect record-lock failures as a normal, retryable condition.

**Reconciliation is mandatory, not optional.** Because of Fix routines, silent rounding cascades, price modifiers, and auto-job-costing, the two systems *will* drift. Build a nightly comparison on `(Invoice Number, Line Number)` covering quantity, gross cost, and line status, and alert on divergence.

**Provenance.** Every RFMS write is stamped `COMPUTER:USER` from the token's default user. Use a dedicated integration user so RAZZLE-DAZZLE-originated rows are distinguishable from human-entered ones.

**Audit Viewer is your reconciliation escape hatch.** Filter `Table = 'Maintenance'` to detect Re-Open Journal, Fix Header, Fix Line, Fix Receipts, Fix Jobcost, Un-Post Providers, and Purge routines. If RAZZLE DAZZLE disagrees with RFMS on material cost or order state, look here first.

### 9.6 Questions to settle during the live spike

These matter and the corpus could not answer them:

1. **What API tier is Floor Daddy on?** Everything downstream depends on it.
2. **Does Floor Daddy run ERRM?** It changes the line ramp, when inventory moves, aging basis, and the meaning of "Delivered."
3. **What is their `Starting Service Code`?** Defines the material/service boundary for every header total.
4. **Are they on Store Specific Products?** If so, "the same product" is N per-store records with different seq numbers, and bundles/crossover do not follow.
5. **Exact request/response shapes.** The help centre documents *capabilities*, not endpoints, payloads, field names, pagination, rate limits, error codes, or filter syntax. **Nothing about the wire format is knowable from the corpus — get the actual API docs from RFMS.**
6. **Is there any change-feed / delta query?** Unknown. If not, polling strategy must be designed around full-scan windows.
7. **Does the Enterprise "assign inventory to orders" call let you specify Reserve vs Cut?** Unknown from the corpus.
8. **Rate limits.** Unknown, but given the Aug 2023 DoS incident, assume they exist or that you will be blamed if they don't.
9. **The default user's full System Option set** — capture it as configuration.

---

## 10. Traps

### Reversibility & irreversibility
- **Un-Job Cost posts into the ORIGINAL delivery month.** January work reversed in February changes January.
- **Un-Job Cost is blocked by a closed journal month** and by posted finance charges. If the month can't be reopened, the only remedy is a new adjusting order.
- **Voids are terminal everywhere.** A voided AP invoice can never be un-voided *and its invoice number stays consumed for that supplier*. A voided check can never be un-voided. A bank charge cannot be voided at all — post a negative one.
- **Voiding an AP invoice posts using the SYSTEM date**, not the original period. Re-issuing invoices after voiding a check uses the **last date in the check register**.
- **An order cannot be voided if any payment or provider record exists** — and the header may show \$0.00 payments while receipts actually exist.
- **Print and Post Commissions cannot be cancelled once started.** Unposting needs an access code.
- **Final Print & Post of Provider Earnings** stamps Date Paid and the records vanish from every subsequent report.
- **Purge PDF History, all Purge routines, and G/L Year End are irreversible.** Year End *deletes journal detail*.
- **ERRM cannot be uninstalled.**
- **"Setup Sales Tax Accounting" is a permanent one-way switch.**
- **Store Specific Products** requires an access code to enable and RFMS assistance to disable, and the option disappears from the browse once on.

### Silent state changes
- **Printing a picking ticket flips Cut lines to Delivered** (or Staged under ERRM). Once Delivered/Staged a line cannot be picked again unless manually set back to Cut. Run the picking *sheet* before picking tickets.
- **Printing an invoice auto-job-costs** an order that is all-cut and paid in full.
- **Saving an RFMS Mobile Point of Sale ticket puts lines in Cut. Accepting the pickup signature puts every line in Delivered.**
- **Exporting a quote captures (charges) any card pre-authorization on it** — and quotes can be exported repeatedly.
- **Entering a sales or misc tax amount on an Exempt or Resale order silently flips it to Taxable.** So does making it Cash & Carry.
- **Changing the customer on an order can reset tax and price-list data** and triggers a credit check.
- **Editing a customer record prompts to push changes into Quotes and BidPro estimates** — rewriting historical documents.
- **"Update Customer Data" (bulk) overrides record-level protections**, updating locked Sold-To and Ship-To regardless.
- **There is no Recalculate button.** Recalculation is continuous and can silently adjust your exact line amount by cents via the largest-material-line rounding cascade.
- **Adjust Total is irreversible in BidPro** and adjusts pre-tax totals only elsewhere, so grand totals shift after tax recalculation.

### Data model traps
- **Item Number is not unique** — you need Seq #. Roll numbers are unique *unless* duplicate-suffix mode is on.
- **Changing the cost on a costed inventory record CREATES A NEW RECORD.** Any cache keyed on the old id goes stale.
- **Changing the manufacturer or supplier name on one roll rewrites every roll costed on the same manufacturer invoice.**
- **Invoice # and Invoice Date on an inventory record become immutable once costed or once history exists.** So do roll and item numbers.
- **A comma or quotation mark in an item number breaks receiving** — order lines silently stay Reserved instead of going Cut.
- **Recreated records appear from nowhere**: when a line is unassigned and no matching record exists, RFMS *creates* one, marked Costed, dated today.
- **Quote line costs are frozen copies**, not live lookups — that is the entire premise of the Quote Cost Comparison report.
- **Product identity includes the supplier**: "the system considers the same product with a different supplier to be a different product."
- **Editing Product Code, Supplier, Private Style, Private Item Number, Private Description, roll Width, or Units on a product with inventory DISASSOCIATES the product and inventory records.**

### Sign, arithmetic, and definition traps
- **Add-on sign convention is inverted at the header:** entering a POSITIVE number (an Add-On) *decreases* the header figures. And add-ons/credit memos make **no changes to order lines at all**, so header totals will not tie to the line sum.
- **Inventory adjustment sign is inverted:** a negative Material Cost total *increases* inventory.
- **"Net Sales" means three different things** by report. **"Gross Sales" includes sales tax but excludes use tax.**
- **Overhead Margin is a gross-up (`cost ÷ (1 − OH%)`), not a markup**, and never posts to the GL.
- **Commission Base Percent is not a margin.**
- **The California Stewardship Assessment Fee is excluded from Total Sales on every profit and sales report.**
- **Freight can double-apply** if a product carries a freight factor *and* invoice freight is entered at costing.
- **Extra Costing Labels (GST, CA recycling fee) are carried to the payable but NOT added to inventory net cost** — inventory and AP legitimately disagree by these amounts.

### Concurrency & locking
- **Opening or editing an order locks it.** Use View Lines to read without locking — but editing a note from that screen *will* lock it.
- **Two orders in the same billing group cannot be edited simultaneously.**
- **Payment posts fail when the order is open**, and the money is already captured at the processor.
- **Journal Close is single-workstation.** So are GL Close and Year End.

### Configuration traps
- **Changing a system option's Type from User/Assigned to Global resets every user to the option's built-in DEFAULT**, not to any user's current value.
- **Field labels are configuration.** Job Number Prompt, Measure Date Prompt, Serial Number Prompt, Telephone Prompts 1–5, Contract/Order/Service Type Prompts, Price Level Prompts — two installs call the same column different things. **Map by underlying field, never by label.**
- **"Always required" field options retroactively block existing records** — opening an old order or importing an old quote forces the missing value.
- **Restrict-level warnings can be bypassed** by any user with "Display System Setting Restrict Message as a Warning Message" checked. Nothing in Schedule Pro is truly enforced.
- **A blank Level 1 password disables all RFMS security.** Ships as `PASSWORD` (level 1) and `GO` (all others).
- **A LOCKED password level rejects higher-level passwords.** And a selection carrying both level 3 and level 1 rejects the level 3 password.
- **Access codes** are, in RFMS's own words, used "to circumvent standard accounting and security protocols," and an access-code-authorized user can add or remove other authorized users. Audit that list.

### Operational traps
- **Every RFMS Core update stops the API service.** Updates fail silently if services are still running or if the update is run across the network.
- **SQL Express caps the database at 10 GB and degrades past ~1 GB memory / ~15 users.** PDF History (bloated by large logos) is a documented cause of out-of-space errors.
- **Permissions rot.** RFMS's remedy is to *remove and re-apply* share + NTFS permissions, because Windows Updates corrupt them and merely verifying is insufficient.
- **Attachments break easily:** renaming an `Image####.ext` file, moving the Attachment Directory, or a user setting a local path all break links silently. Deleting an attachment removes the DB link but leaves the file.
- **Deleted store codes still appear on Journal and G/L reports** when "all stores" is selected.
- **A "Find" filter being active is invisible except for a blue icon**, and "Tag All" only tags the filtered subset.
- **Exported BidPro estimates vanish from the default browse** (which shows non-exported only). Nothing was deleted.

### Known version defects worth knowing
- **v24.3** — Commission Base could reflect the full sale instead of profit when commissions are "Delivered and Paid," the order is job costed with a balance, and **the final payment came in via API** (RFMS Mobile / MyFlooringLink / credit card). Fix requires un-job-costing and re-job-costing every affected order. **Directly relevant to any integration posting payments.**
- **v24.4** — Payments posted from RFMS Mobile *with a value in the Check Number field* overwrote the Check Register Account Code, so the journal entry never posted at deposit time.
- **v24.4.0/24.4.1** — Month End Inventory Balance Report omitted costed records, duplicated Cut+Delivered lines, and showed current rather than received cost on backdated uncosted records.
- **Warehouse Mobile** — the "satisfies PO" checkbox does not satisfy a *Special Order* PO when under-received; the remainder stays open in both app and Core.
- **ASN unit-of-measure mismatches silently receive the wrong quantity.**
- **iOS 17.4** breaks barcode scanning on several iPad models across all RFMS apps.

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Acknowledgment** | What an un-job-costed order prints as. Job-costed orders print as "Invoice." Same record. |
| **Add-On / Credit Memo** | Header-only monetary adjustment inside an existing order so the customer keeps one order number. Positive = add-on (which *decreases* header figures), negative = credit memo. Touches no lines. |
| **Baseline** | Point-in-time snapshot of an order or billing group for later comparison. Covers lines only — no misc charges, no taxes, never change orders. |
| **BCOE** | Legacy internal name for RFMS Core Order Entry. |
| **Billing Group** | Container linking multiple orders for progress/partial/percentage/AIA billing and retainage. Its number appears on reports as "Project Number." |
| **Book / Bill** (ERRM) | Bill = create the AR invoice. Book = recognise revenue; requires all lines Delivered and providers balanced; **locks the order**. |
| **CG number** | Computer-generated order/invoice number. `CG` + year digit + [store char] + sequence, base-36 overflow excluding I, L, O. |
| **Change Order** | An order inside a billing group flagged as adjusting the Contract Total. The primary order can never be one. |
| **Costed / Uncosted** | Costed = supplier AP invoice posted and an invoice date exists on the inventory record. Uncosted = received on a BOL, no invoice number or date. |
| **Curtain** | RFMS Mobile's tap-to-reveal hiding of cost, GP, referral, freight & load. |
| **Cut** | (a) A piece the mill cut to length (vs a full Roll). (b) A line status meaning inventory is hard-committed. Unrelated meanings. |
| **Delivered** | For an ORDER: job costed. For a LINE under ERRM: the delivery ticket printed. Never means "shipped" at order level. |
| **Delivery Date** | The **job cost date**. Not a logistics date. |
| **ERRM** | Enhanced Revenue Recognition Method (also rendered Enhanced Real-time Revenue Management). Real-time GL posting, WIP/accrual accounts, Bill/Book/Job Cost, Staged line status. Cannot be uninstalled. |
| **FCB2B** | Flooring B2B EDI standard: 832 catalog, 850 PO, 855 ack, 856 ASN, 810 invoice, 860 change. |
| **Gen PO** | Order-line status meaning "still to be purchased." Not a purchase order. |
| **Job Cost** | The posting event that finalises costs, stamps Delivery Date, posts GL and commissions, and makes the order a receivable. |
| **Job Number** | User-defined free-text field with a relabelable prompt. **Not a key.** |
| **Load / Load %** | Paper-only cost adder affecting job cost, gross profit, and commission. **Never posts to the GL.** |
| **MOE / RFMSDataEndpoint** | The on-prem Windows service serving the API, mobile apps, CRM, Measure, and Next. |
| **Overage** | Additional-charge record attached to an order — classically a builder allowance overrun billed to a *different* customer. Has its own invoice number but no lines of its own. |
| **PC / Product Code** | 2-digit classification, 01–99. 01/02 always roll goods. Material/service boundary set by Starting Service Code. |
| **Provider** | Installer/subcontractor. "Provider record" = a labor pay record on an order. Not a material vendor. |
| **Remark** | Project Manager notation — deliberately named differently from a Note, capped at 500 chars, and by default **permanent** (cannot be edited or deleted, only inactivated). |
| **Requisition** | Report term: order lines in Cut or Delivered status only. |
| **Reserved / Soft Reserve** | Reserved = an order line holds a specific inventory record. Soft Reserve = an order-independent temporary hold that can still be sold. |
| **ROS** | RFMS Online Services (admin.rfms.online) — cloud admin: users, roles, licenses, branding, **API keys**, record locks. |
| **Seq #** | Three unrelated things: Customer Sequence Number (customer id), **Item Sequence Number** (part of the inventory key), Source/Destination Record Sequence Number (tracking rows). Also ProductSeqNum/ColorSeqNum in the catalog. |
| **Sidemark** | ≤12-char job/order identifier stamped on shipments and roll tags. |
| **SRN** | System Reference Number — the unique surrogate key of an inventory record. Printed with an `I` prefix on picking tickets, without one on inventory tags. |
| **Staged** | ERRM-only line status between Cut and Delivered, created by the picking ticket. |
| **Store Queue** | Half the API credential (`store-xxx1234`); literally an Azure Service Bus queue id. **Can change.** |
| **Tag** | RFMS's universal multi-select gesture. Almost every bulk operation acts on the *tagged* set, not the highlighted row. |
| **Tracking record** | Immutable audit row created on every record insert and on exports/appends. Logs *actions*. Distinct from **PDF History**, which stores *documents*. |
| **Unreferenced line** | Free-typed line not linked to Products or Inventory. Explicitly "NOT RECOMMENDED AS A BEST BUSINESS PRACTICE." Displays in red. Severely restricts later line-status transitions. |
| **Used / Available** | Used = quantity on Cut/Delivered/Job-Costed lines (not in inventory value). Available = Beginning − Used − Reserved. Both derived; never write them. |
| **Will Advise (WA)** | Pre-order signal to a mill to schedule production before formal ordering. |

---

### Contact
RFMS support: **rfms-help@cyncly.com**. Access codes and program updates: **portal.rfms.com**. Cloud admin and API keys: **admin.rfms.online**.