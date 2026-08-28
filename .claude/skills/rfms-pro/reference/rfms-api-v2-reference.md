# RFMS API v2 — Developer Reference (RAZZLE DAZZLE integration)

**Source:** the official published RFMS Postman collection (`rfms_api_v2.json`, 86 endpoints), read at both request level and **folder level**. Several earlier readings of this API were done from a flattened dump (`rfms_api_endpoints.md`) that preserved only *request* descriptions and silently dropped *folder* descriptions. Two of the most consequential facts in this document — how the session token is transported, and how tier gating is applied — live only in the folder descriptions. Where the collection publishes no sample, this document says "undocumented" rather than guessing a shape.

---

## 1. Getting connected

### 1.1 Base URL and transport

```
https://api.rfms.online/v2/
```

All endpoints are HTTP Basic auth. The collection sets `auth: {type: "basic"}` at the **collection level**; all 86 requests inherit it (`isInherited: true`). Exactly one request overrides it: `POST /v2/session/begin`, which sets `password: {{apikey}}`. **No request in the entire collection declares an `Authorization`, `X-Session`, or bearer header.** The only custom header anywhere in the collection is `messageId` (on Create Order and Record Payment).

The API is a **relay in front of an on-premise RFMS installation**, reached over an Azure Service Bus store queue. That architecture explains three things you must design around: the `waiting` status, the settings cache (`GET /v2/cacherefresh`), and why store outages present as protocol states rather than HTTP errors.

### 1.2 Session establishment

**Step 1 — begin a session.**

```
POST /v2/session/begin
Authorization: Basic base64(<storeQueue> : <apiKey>)
(no body, no Content-Type)
```

`storeQueue` is the **entire** Store Queue string (format `store-xxx1234`). Credentials are generated in RFMS Online Services → "RFMS Online" section → **API** button in the toolbar (an Administrator action; the admin also chooses the RFMS user the API will impersonate).

Response — **bare object, no envelope**:

```json
{ "authorized": true,
  "sessionToken": "1598c4a37c1c54552732bb907013176d",
  "sessionExpires": "3/5/2018 7:00:39 PM +00:00" }
```

`sessionToken` is 32 lowercase hex. `sessionExpires` is **not ISO-8601** — it is `M/d/yyyy h:mm:ss tt zzz` with an explicit UTC offset. Parse with an explicit format string; do not pass it to `Date.parse`.

**Step 2 — every subsequent call.** The `/Authentication` folder description states verbatim:

> "The session token must be sent with all API requests as the password using HTTP Basic Auth. User name should be set using the same user name you used in the first step."

So:

```
Authorization: Basic base64(<storeQueue> : <sessionToken>)
```

Identical wording appears in the deprecated v1 collection, so this is stable across versions. **Confirm this on the very first live call anyway** — it is inference-adjacent (folder prose, not a per-request header example), and every other analysis of this API treated it as unknown. It is a five-minute test and everything else depends on it.

**Sliding expiry.** Same folder: *"The session token can be used for a limited time. It will expire automatically but is extended each time a method is called."* Therefore:

- `sessionExpires` is a **floor**, refreshed on every successful call.
- A busy integration may never need to re-begin; an idle one dies silently even though the cached timestamp looks fine.
- Build refresh-on-auth-failure as the primary trigger; treat the timestamp as a hint only. Re-read `sessionExpires` from responses if it is echoed.

**No logout.** There is no `session/end`, revoke, or introspect endpoint. Revocation is a human action in ROS (tokens are listable and individually revocable there). What happens to a live session when an admin revokes the underlying key is undocumented.

**The token impersonates a specific RFMS user.** The folder text: the token "identif[ies] a specific user at your store the API methods should impersonate." Visible stores, assignable inventory, searchable documents, price levels, and probably Schedule Pro alert behaviour are all functions of that user's System Options. Changing the impersonated user in ROS silently changes what every API call can see and do.

### 1.3 Third-Party Developer (TPD) mode

```
POST /v2/session/request      # consent request; Basic = TPD id + TPD password
  { "rfmsBusId": 99999, "reason": "…" }      # reason is shown verbatim to the store
POST /v2/session/begin        # Basic = "{rfmsBusId}@{TPD-ID}" : <TPD password>
```

Then all subsequent calls use `Basic base64("{rfmsBusId}@{TPD-ID}" : <sessionToken>)` — "the same user name you used in the first step."

**A TPD session is granted Plus-level access *regardless of the store's actual subscription*.** Whether that is a floor or a **ceiling** is the single highest-leverage unresolved question in this API (§5). Read literally it is a ceiling, which would mean a TPD session at an Enterprise store can never call Create Order/Quote/Estimate, Reserve/Cut Inventory, Create/Update Job, Post Provider Record, Get Personnel, Get Suppliers, or Unlock Document. If that reading is right, **RAZZLE DAZZLE cannot run on a TPD key** and must use Floor Daddy's own store credentials.

`POST /v2/session/request` has **no published response shape**, no status polling, no cancel, and no "who has granted me access" listing. `rfmsBusId` must be obtained out of band.

### 1.4 Tier model

Four levels: Standard, Plus, Enterprise (plus TPD-as-Plus). **Gating is enforced at the folder level, which is why per-endpoint tier statements look inconsistent.**

| Folder | Folder-level rule |
|---|---|
| `/Customers` | Standard minimum |
| `/Order Entry` | "require either the 'Plus' or 'Enterprise' level… **Requests from 'Standard' API accounts will return Unauthorized**" |
| `/Accounts Payable` | Plus |
| `/Schedule Pro`, `/Reports`, `/Order History`, `/Store Settings` | **no folder description** — only the per-method line applies |

Tier failures surface as **Unauthorized**, not as a `failed` envelope. Practical summary: at Standard the only usable folder is `/Customers`, and the only way to create any selling document is `POST /v2/opportunity`.

### 1.5 The response envelope — and the eight places it does not apply

The documented contract is `{status: "success"|"waiting"|"failed", result, detail}`. RFMS reserves the right to **add** keys without notice but not to change or remove existing ones.

**This contract is not universal. Write a tolerant unwrapper.**

**A. No envelope at all (bare object/array):**

| Endpoint | Bare shape |
|---|---|
| `POST /v2/session/begin` | `{authorized, sessionToken, sessionExpires}` |
| `GET /v2/stores/:id` | `[{storeId, isDefault}]` |
| `GET /v2/customers` | `{customerType[], entryType[], taxStatus[], taxMethod[], preferredSalesperson1[], preferredSalesperson2[], stores[]}` — docs say explicitly: *"since this method does not actually communicate with the store, it returns a simple result — not the regular response with status and result."* |
| `GET /v2/order` (values) | `{userOrderTypeId[], serviceTypeId[], contractTypeId[]}` |
| `GET /v2/payments` | `{receiptAccounts[]}` |
| `GET /v2/product/get/productcodes` | `{productCodes[]}` |
| `GET /v2/statuses` | `{activeStatuses[]}` |
| `GET /v2/jobtypes` | `{jobTypes[]}` |

Corollary: `GET /v2/customers` never touches the store, so it **can never return `waiting`** — and is therefore *not* a valid probe for store connectivity, however tempting.

**B. Enveloped, but the payload key varies.** Two conventions coexist:

- **Payload in `result`, `detail: null`** — Get Terms, Generate Report, all creates (`result` = new document number string), Advanced Order Search, List Payments, Record Payables (`result` = human-readable string `"ACME - XS101 Added"`), product endpoints, List Attachments, opportunities.
- **`result: "OK"`, payload in `detail`** — Get Personnel, Get Suppliers, Get Remark Types, Get Order History, **Export Quote to Order**, both Gross Profit endpoints, Calculate Taxes, Get Attachment, Get Product ETaggs, and essentially all of Schedule Pro (Get Job, Get All Scheduled Jobs, Get Crews, Get Time Slots, Get Job Track Listings, Get Job Status Ids).

Rule: **if `result === "OK"`, read `detail`.**

**C. Both, duplicated or divergent:**

- `POST /v2/jobs/find` returns the **full result array in both `result` and `detail`** (double payload).
- `POST /v2/quote/find` and `POST /v2/order/find` return a thin projection in `result` and a **richer superset in `detail`** — always read `detail`.
- `POST /v2/customers/find` returns `result: []` (empty) and the matches in `detail[]`. `POST /v2/customers/find/advanced` returns matches in `result[]`. `GET /v2/customer/{id}` returns the **same customer twice in two different shapes** in `result` (nested/modern) and `detail` (flat/legacy), and in the official sample **they disagree**.

**D. Non-envelope failure shape.** `POST /v2/opportunity` duplicate-customer rejection returns:

```json
{ "accepted": false, "requestId": "",
  "messages": ["A Sales Lead, Prospect or Customer record with this name and phone number already exists.",
               "existingCustomerId:74028"] }
```

No `status`, no `result`. The existing customer id must be **string-parsed out of a message array**. A handler that switches on `status` mishandles every duplicate.

### 1.6 The `waiting` protocol and idempotency

`status: "waiting"` means **the on-prem store has not replied yet. The request was not rejected and may still be executing.** Never treat it as failure, and never blind-retry a write.

Documented recovery mechanism (Record Payment):

```json
{"status":"waiting",
 "result":"Store has not replied. Try again later with provided message id",
 "detail":"a11fbbb82ea34977bd3feabb36ca40eb"}
```

Retrieve the stored result by **re-calling the same endpoint with an HTTP header `messageId: <that id>`**. This is the API's idempotency primitive.

**Two incompatible shapes for the same idea — do not write one generic handler:**

| Endpoint | Where the resume id lives |
|---|---|
| `POST /v2/payment` | `detail` — a **bare 32-hex string** |
| `POST /v2/order/create` | `detail.docId` — an **object** |
| `POST /v2/estimate/create` | `detail.docId` — **a different meaning entirely**: the estimate's internal DB id (`"4907"`), not a message id |

`messageId` is documented **only** on Create Order and Record Payment. Every other write (Create Quote, Update Quote/Order/Estimate, **Export Quote to Order**, Create Claim, Create Job, provider posts, payables) can presumably return `waiting` with no documented resume path. That is the core operational risk of this API: for those endpoints a retry after ambiguity may duplicate a document, a payment, a pay record, or an AP liability.

**Defence in depth where no messageId exists:** stamp a RAZZLE DAZZLE reference into `poNumber` or `jobNumber` on creation and search for it before retrying — but note only **Advanced Order Search** (and Find Estimate) can search those fields; `POST /v2/order/find` and `/v2/quote/find` match customer name only.

### 1.7 Error handling and rate-limit etiquette

- **Unauthorized** = tier/permission failure (folder gating), not a `failed` envelope.
- `status: "failed"` carries a human-readable reason in `result`. Two structured failure payloads exist: the opportunity duplicate shape (§1.5-D) and the Schedule Pro `jobChecks` array (§2.6).
- **Rate limiting:** none is documented. A third-party integration has previously caused ~16 hours of API timeouts by "unintentionally simulating a Denial-of-Service attack" against shared RFMS endpoints. Self-impose concurrency limits and backoff.
- **`GET /v2/cacherefresh` is a loaded gun.** Zero-parameter GET, "very taxing on the server and should be used sparingly and with intent," no published response, no tier stated. Never wire it into a health check, uptime monitor, prefetcher, or retry loop. Gate it behind an explicit human admin action and rate-limit it hard.
- **The API serves cached store settings.** The existence of `cacherefresh` is itself the finding — no other RFMS documentation mentions a cache. Value lists (order values, product codes, remark types, job statuses, time slots, terms, personnel, suppliers) may serve **stale** data after configuration changes in Core, for an undocumented window. A newly created terms block/product code/job status missing from an API read is more likely cache than permissions.

### 1.8 Cross-cutting data hazards

- **Two coexisting store identifier spaces.** Numeric `storeId`/`storeNumber`/`defaultStore`/`store` (32, 50, 52…) **and** single-character `storeCode`/`displayCode` (`" "`, `"2"`, `"A"`, `"K"`). A single Get Order response carries both. `GET /v2/report/terms` keys on the character code; `GET /v2/stores/:id` and `GET /v2/customers.stores[]` return both. Neither is derivable from the other — **persist both on every mirrored record.** Note `" "` (a single space) is a real, distinct store, and `"default"` is a magic value in the terms response. Never trim or normalise these.
- **A third scoping axis exists: `companyId`** ("secondary companies"), on `GET /v2/report/terms/{companyId}` and as a body field on `POST /v2/opportunity`. No endpoint enumerates company ids.
- **Document-number prefixes are NOT a type discriminator.** CG/ES/JE/CL are conventional but store-configurable. Advanced Order Search returns `"WO394853"` and `"PM1023"`; the Update **Quote** sample body uses `"number": "CG903368"`. Determine type from the endpoint or `orderSearchType`, never by parsing a prefix.
- **Date/time formats are inconsistent per endpoint.** ISO `2021-08-19T00:00:00`; ISO date `2022-04-07`; compact `20210617`; US `1/1/2018`, `3/1/2019`, `9/24/19`; `MM-DD-YYYY` on Find Jobs and Stage/Deliver; `{"Year":2017,"Month":10,"Day":30}` on Product ETaggs; four-digit-hour times `0008:30:00`; minute-precision `6/28/2021 1:58 PM`. **No timestamp except `sessionExpires` carries a timezone.** Map format per endpoint; never share one date parser.
- **Space-padded fixed-width strings** are common in Schedule Pro responses (`"CREW A                        "`, `"NE   "`). Trim everything before comparing or storing.
- **Type drift on ids.** `customerId` is an int on customer endpoints, a **string** on CRM opportunities. Product `id` is a string from `/product/find` and `/product/get`, a number to `/product/get/productbundle` and `/claim/create`, and `SeqNum` (int) on `/product/etaggs`. `docId` returns as a quoted string; `jobId` reads as a bare int. `laborTotal` is written as a string, read as a number. Coerce at the boundary.

---

## 2. Endpoint reference by domain

Tier notation: **S**=Standard, **P**=Plus minimum, **E**=Enterprise only, **—**=no tier stated in the docs.

### 2.1 Auth, session, stores, settings, reports

| Method | Path | Tier | Payload |
|---|---|---|---|
| POST | `/v2/session/begin` | — | bare object |
| POST | `/v2/session/request` | TPD | **undocumented** |
| GET | `/v2/stores/:id` | P | bare array |
| GET | `/v2/personnel` | **E** | `detail[]` |
| GET | `/v2/suppliers` | **E** | `detail[]` |
| GET | `/v2/unlock/:id` | **E** | **undocumented** |
| GET | `/v2/report/terms[/{companyId}]` | P | `result[]` |
| POST | `/v2/{quote\|order}/report/generate` | P | `result` = URL string |
| GET | `/v2/cacherefresh` | — | **undocumented** |

**`GET /v2/stores/:id`** — despite the parameter name, the description says "Retrieves visible and default store(s) for a salesperson **by name**." Returns `[{storeId:int, isDefault:bool}]`. **Catch-22 at Plus:** this needs a salesperson name, but the only personnel-listing endpoint is Enterprise. At Plus/TPD you must source salesperson names from `salesperson1`/`salesperson2` on documents or out of band.

**`GET /v2/personnel`** — `{id:int, firstName, lastName}` only. No email, role, store, or active flag. Sample surnames are literally `"PROVIDER"`, so this list plausibly mixes salespeople, installers and providers with nothing to distinguish them. Unordered, unpaged, unfiltered — cache the full dump.

**`GET /v2/suppliers`** — `{id, name, contactPhone, accountNumber, email}`. `accountNumber` is *your* account with that supplier and is frequently blank. `contactPhone` is unnormalised free text. Names are UPPER CASE. Supplier identity is part of product identity in RFMS ("the same product with a different supplier is a different product").

**`GET /v2/unlock/:id`** — takes the `lockId` returned by a Get Order/Get Quote called with `?locked=true`. **It is a GET that mutates state** — anything that speculatively prefetches or retries GETs can silently release locks. **Critical asymmetry: taking a lock is Plus, releasing it is Enterprise.** A Plus or TPD integration can create locks it cannot programmatically release; the only remedy is a human in ROS (Quote/Order Locks) or Core (Accounting → Utilities → Release API Locks). There is no list-locks endpoint and no documented lock timeout. **Rule: never pass `locked=true` unless you are on Floor Daddy's own Enterprise key with a guaranteed unlock in a `finally` block.**

**`GET /v2/report/terms`** — `[{storeId: string, terms: [title strings]}]`. Explicit fallback rule you must implement: *"Only stores that have terms and conditions saved will appear… Other stores ought to use the terms belonging to the default option."* Titles are the only handle, are **not unique across stores**, and are case-sensitive (the sample contains a real typo, `"Mutiple Choice T&C"`, which you must reproduce verbatim to select it). You cannot read a terms **body** through the API.

**`POST /v2/{quote|order}/report/generate`** — renders a customer-facing My Flooring Link document and returns `result` = `https://myflooringlink.com/#/view/<32-hex>`. Body: `{documentNumber, options:{…}}`. **All options default to false**, so an empty `options` object yields a nearly blank document (no logo, no store name, no prices, no totals). Options: `showLogo, storeAddress, storeName, showRoomPlan, showSeams, showGrandTotal, showColorChip, showQuantity, showUnitPrice, showLineTotal, showApprove, showDeliveryDate, showPhotos, showLineNotes, showLineGroups, showPayment, showSignature, showAuthorization, allowAuthorization, allowPayment`, plus `termsToShow[]` (titles from Get Terms) and `defaultShareMessage`.

> **Treat `allowPayment` and `allowAuthorization` as money-moving flags.** The published sample ships `allowAuthorization: true` — do not copy it into production. Exporting a quote to an order **captures** any card pre-authorization sitting on it, and quotes can be exported repeatedly. RFMS v24.3 had a defect where a final payment arriving via MyFlooringLink corrupted Commission Base on job-costed orders. The URL is an **unauthenticated capability token** with no documented revoke or expiry — keep it out of logs and analytics.

"Generate Report" is document rendering, **not** the RFMS reporting suite. Materials Analysis, Job Cost Analysis and PO Summary remain CSV/ODBC-only.

### 2.2 Customers and CRM opportunities

| Method | Path | Tier | Payload |
|---|---|---|---|
| POST | `/v2/customers/find` | S | **`detail[]`** (`result` is `[]`) |
| POST | `/v2/customers/find/advanced` | **P** | `result[]` |
| GET | `/v2/customer/{customerId}` | S | `result` (nested) **and** `detail` (flat) |
| GET | `/v2/customers` | S | **bare object** |
| POST | `/v2/customer/` | S | **empty body in both saved 200 examples** |
| POST | `/v2/opportunity` | S | `result` = document number string |
| GET | `/v2/opportunities` | P | `result[]` — modified in last 7 days |
| GET | `/v2/opportunities/{stage}` | P | `result[]` — **no time limit stated** |
| GET | `/v2/opportunities/lastmodified` | P | `result[]` — change events, 7-day window |
| GET | `/v2/opportunity/{id}` | P | `result` |

Path singular/plural is load-bearing: `GET /v2/customers` = value lists; `GET /v2/customer/{id}` = one record; `POST /v2/customer/` = write (note the trailing slash).

**Three incompatible customer projections.** Basic Find returns the flat legacy shape (`customerName`, `customerAddress` as a **string**, `customerZIP`, `defaultStore`, plus commercial fields `terms`/`termDays`/`creditLimit`/`preferredPriceLevel`/`taxId`/`remarks[]`/`internalNotes`). Advanced Find returns the modern nested shape (`customerAddress` as an **object**) plus audit fields (`active`, `dateCreated`, `createdBy`, `dateUpdated`, `updatedBy`, `contact1`, `contact2`, `phone3`, address `country`) that appear nowhere else. Get Customer returns **both, and in the official sample they disagree** (`result.customerAddress.businessName: null` vs `detail.customerBusinessName: "CARLOS BANUELOS"`). Pick one projection per code path. `detail` is richer; credit terms and internal notes exist only there.

**Paging is three different idioms across this API:** `startIndex` (row offset, Find Customers — 10/page, no total, terminate on a short page), `resultPageNumber` / `pageResultNumber` (page ordinal, Find Quotes/Orders/Estimates — the docs contradict themselves on the name), `pageIndex` (page ordinal, Find Products). **Advanced Find Customers and Advanced Order Search document no paging at all.**

**`POST /v2/customer/`** creates when `customerId` is omitted and updates when present. **Both saved 200 examples have literally empty bodies**, so it is undocumented whether the new `customerId` is returned. There is **no documented duplicate check on this endpoint** (dedupe is documented only on `POST /v2/opportunity`, and even there it is conditional on store configuration). There is no delete, no writable `active`, no `notes` field, and `phone3` is readable but not writable. Whether an update is a merge or a full replace is unknown — **do not send a partial update until proven.**

**`POST /v2/opportunity`** is the highest-leverage write in the group and the **only Standard-tier way to create any selling document**. It creates a customer **and exactly one** document, selected by flags: `useCRM` (CRM Opportunity, requires an active CRM licence), default (empty Quote), `createOrder` (empty Order), `useBidPro` (+`modelName`) (BidPro estimate), `useProjectManager` (PM sales lead — **silently overrides and ignores `useBidPro`/`createOrder`**). Other fields: `customerId` (written lowercase `"customerid"` in the code sample), `shipTo`, `orderType`, `documentNumber`, `salespersonEmail` (the CRM salesperson assignment field), `companyId`, `journey`/`journeyDetail` (TPD-only), `marketingOptIn{email,sms,optInDate,ipAddress}`, `notes`, `estimatedDeliveryDate`, `poNumber`, `jobNumber`.

Two documented data hazards: (a) omitting `orderType` when `createOrder: true` produces a **web order**; (b) supplying `businessName` on an address means "it will be used as the `lastName` on the quote or order, and the `firstName` will be left blank" — the customer keeps the person's name, the document does not.

**CRM opportunities are create-only over the API.** There is no update, stage-change, Won/Lost, or delete endpoint. RAZZLE DAZZLE can open an opportunity but can never advance or close one; every transition happens by hand in the CRM app and the API observes it after the fact. `POST /v2/opportunity` returns a **document number**, not an opportunity id — with `useCRM: true` what comes back is undocumented, and CRM ids are a different format entirely (10-char uppercase alphanumeric, `"N07W7BPIXY"`).

**`GET /v2/opportunities/lastmodified` is the only real change-data-capture feed in the API.** Rows are **events**, not records: `{opportunityId, opportunityName, eventName, eventTime, user, detail}`. Only two `eventName` values are observed: `"OPPORTUNITY CREATED"` (`detail` = starting stage) and `"STAGE CHANGED"` (`detail` = `"Quote -> Measure"`, a literal `From -> To` string you must parse). No parameters, no cursor, no paging, **fixed seven-day retention with no backfill** — a polling gap longer than seven days loses those events permanently. Events repeat per opportunity; dedupe by id before hydrating. The event carries no `customerId`, `totalValue`, or quote numbers, so every distinct changed id needs a follow-up `GET /v2/opportunity/{id}` (inherently N+1 — rate-limit it). Coverage is narrower than the prose implies: a change to `totalValue`, `products`, or attached quotes may produce no row. **Union it with `GET /v2/opportunities`** (all modified in 7 days) and treat neither as complete.

`GET /v2/opportunities/{stage}` — stages are `To Do, Contact, Products, Measure, Quote, Won, Lost`. These are the **generic** names; a company can rename stages in CRM and the API still returns the generic value, so RAZZLE DAZZLE must own the mapping. `To Do` contains a space and must be URL-encoded. **Path collision:** `lastmodified` is a reserved literal in the `{stage}` slot — never interpolate an unvalidated stage string. This endpoint's description carries no seven-day qualifier and appears to be the only full-backfill path.

Data defects present in official samples: `quotes[]` and `quoteApproval` can contain the literal string `"undefined"`; `store: 0` occurs on real opportunities; `salesperson` is sometimes an email, sometimes a display name; `user` on change events is a display name that cannot be joined to `salesperson`. `"Won -> Quote"` appears twice — **Won is not terminal.**

### 2.3 Quotes, estimates, orders

Path collisions on the same root — routing is verb+shape sensitive, and there is **no PUT or PATCH anywhere in the API**:

```
GET  /v2/order          → master value lists (NOT an order)
GET  /v2/order/:number  → one order
POST /v2/order          → update an existing order
POST /v2/order/create   → create
```
Same pattern for `quote` and `estimate`.

| Method | Path | Tier | Notes |
|---|---|---|---|
| GET | `/v2/order` | — | bare object: `userOrderTypeId[]`, `serviceTypeId[]`, `contractTypeId[]` |
| GET | `/v2/quote/:number?locked=&includeAttachments=` | P | |
| POST | `/v2/quote/create` | **E** | `result` = new number |
| POST | `/v2/quote` | P header / **E** lines | sparse merge |
| POST | `/v2/quote/find` | P | `detail[]` richer |
| POST | `/v2/quote/:number/export` | P | **`detail`** = new order number |
| GET | `/v2/order/:number?locked=&includeAttachments=` | P | |
| POST | `/v2/order/create` | **E** | `messageId` header supported |
| POST | `/v2/order` | P header / **E** lines | sparse merge |
| POST | `/v2/order/notes` | P (header) / **E** (line) | **appends** |
| POST | `/v2/order/find` | P | name search only |
| POST | `/v2/order/find/advanced` | P | **`stores` required**; `updatedDateFrom` |
| GET | `/v2/orders/jobcosted` | — | **response undocumented** |
| GET | `/v2/estimate/:number?subNumber=` | P | |
| POST | `/v2/estimate/create` | **E** | `detail.docId` = DB id |
| POST | `/v2/estimate` | **E** | note: update is Enterprise, unlike quote/order |
| POST | `/v2/estimate/find` | P | **response undocumented** |
| POST | `/v2/remark` | P | needs internal DB id |
| GET | `/v2/remark/types` | P | `detail[]` |
| GET | `/v2/order/history/:number` | P | `detail` = source document |

**The stable line key is `lines[].id`** (e.g. 217399), not `lineNumber` (print/display ordering only). Every line edit/delete/note addresses `id`. Deletes are `{"id": N, "delete": true}`; adds omit `id`; edits include it. **A serialization bug that drops `id` silently creates a duplicate line instead of erroring.** Work-order (area) lines nest as `lines[].workOrderLines[]` and their quantities must equal or sum to the parent line quantity.

**Header/document shape** (Get Quote/Order/Estimate): `id` (internal DB id — the value `POST /v2/remark` needs), `number`, `originalNumber`, `category`, `soldTo{}`, `shipTo{}`, `salesperson1/2`, `salespersonSplitPercent`, `storeCode`, `storeNumber`, `jobNumber`, `poNumber`, `privateNotes`, `publicNotes`, `workOrderNotes`, `estimatedDeliveryDate`, `enteredDate`, `measureDate`, `taxStatus`, `taxMethod`, `adSource`, `userOrderTypeId`, `serviceTypeId`, `contractTypeId`, `totals{material, labor, misc, total, salesTax, miscTax, grandTotal, recycleFee}`, `lines[]`. **All three GET samples truncate at 2500 chars mid-line-object** just past `productId`/`colorId` — the full line schema (including any line status field) is unknown from the docs and must be captured live.

> **⚠️ THE NOTES TRAP — the highest-blast-radius behaviour in this API.** On `POST /v2/quote` and `POST /v2/order`: *"To replace notes, include additional fields. To append notes, only include note fields in the body of the request."* So `{number, privateNotes}` **appends**, while `{number, privateNotes, poNumber}` **replaces**. A caller that batches a note with any other change silently destroys existing note content. **Never write notes through Update Quote/Order. Always use `POST /v2/order/notes` (or `/v2/claim/notes`), which appends unconditionally.** Assume the same trap applies to Update Estimate ("similar to updating quotes").

**Line-write conditionals:** `priceLevel` can only be set when `productId` is also supplied; `unitCost` follows the same rule for referenced/non-service lines; `isUseTaxLine` is **silently ignored** unless store permissions allow it *and* the document's `taxMethod` is LineTax or UseTax. `lineStatus` is a supported element with **no published enumeration**.

**`POST /v2/quote/:number/export` — the web-order trap.** Export produces a new order and **flags it a "Web Order."** `POST /v2/order` states *"Only non-Web Orders may be updated with a billing group."* Composed: **an order created by export can never be given a billing group through the API.** If a job needs a billing group (which surfaces as "Project Number" on reports), build it with `POST /v2/order/create` carrying `{"category":"Order"}` instead of exporting. Export takes no body, has **no documented `messageId` resume path**, and is explicitly non-idempotent (quotes can be exported repeatedly, producing multiple orders) — guard it on your side.

**`POST /v2/order/create`** — same vocabulary as Create Quote plus `category` (send `"Order"` or you get a Web Order), `orderDate`, `tract`/`block`/`lot`, and `billingGroup` in one of two forms: new (`{description, contactList:[…≤4 contacts]}`) or existing (`{parentOrder: "CG003616"}`). Setting `width` on a line **converts it to an unreferenced line** — never do this if you intend to reserve or cut inventory against it. `soldTo.customerId` triggers a customer fetch that populates both `soldTo` and `shipTo`, overridden field-by-field by anything you also send. Supplying `productId` copies catalog attributes onto the line.

**`POST /v2/order/find/advanced` is the real search endpoint and the primary incremental-sync query.** `stores` (array of int) is the **only required parameter**. `searchText` matches customer name, **phone, address, PO number and job number** — the only order search that can find a stamped reference. Filters: `orderSearchType` (`"Order"|"Quote"|"Claim"`, default Order), `orderType`/`contractType`/`serviceType` (ints from Get order values — but **returned as display strings**, so you need a bidirectional map), five date dimensions (`estimatedDelivery`, `orderDate`, `measureDate`, `deliveryDate`, plus **`updatedDateFrom`**), `adSource`, `scheduleProStatus`. Returns everything in `result[]` with no `detail`; the customer object is keyed `customer` here but `soldTo` on Get Order. **Only place `voided` and `closedDate` appear anywhere in the API.** **No pagination, no limit, no total, no sort order is documented** — measure this before building a sync on it.

**`GET /v2/orders/jobcosted`** — "orders with a delivery date in the last 31 days **and** updated in the last 48 hours." Delivery date is the job-cost date in RFMS, so this is effectively the recently-job-costed feed. **No published response shape, no parameters, no tier, no pagination.** The two windows are ANDed and hard-coded: an order job-costed 40 days ago and edited yesterday will not appear, and **a poller outage longer than 48 hours loses those deltas permanently** with no catch-up parameter. Fallback is Advanced Order Search with `updatedDateFrom` + `deliveryDateFrom`.

**BidPro estimates:** `(number, subNumber)` is the key — `number` alone is not unique. **The primary sub-estimate is `subNumber: 1`, not 0**, and both Create and Update **default to 1 silently**, so omitting it on a multi-sub estimate is a wrong-record write, not an error. Get Order History returns the source as the dotted composite `"JE100250.1"`. Update Estimate is **Enterprise** while Get/Find Estimate are Plus — estimates are readable but not writable below Enterprise. Find Estimate has the widest `searchText` in the family (customer name, **estimate number, project name, model**, salesperson1/2), but its `viewExportedOnly` and `viewOpenOnly` carry an **identical description** in the docs and the sample sends contradictory values.

**`POST /v2/remark`** — `{id, entityType, remarkType, isPublicRemark, remark}`. `id` is the **internal DB id**, not the document number (`result.id` from Get Quote/Get Order, `databaseId` from Find Orders, `id` from Advanced Order Search, or `customerId`). `entityType` is exactly one of `"Customer" | "Header" | "Quote"` — **an order is "Header"; there is no "Order" value.** `remarkType` is the **string** from Get Remark Types, not its numeric id. Request field `isPublicRemark`, response field `isPublic`. **There is no read, update, or delete for remarks** — you cannot check for duplicates before posting, and remarks are permanent (inactivatable only in Core). Keep your own ledger of `remarkId`s you created. Assume a 500-character cap.

**`GET /v2/order/history/:number`** — provenance, one-directional. `detail` = the source quote or estimate; **`detail: null` is a meaningful result meaning "created directly," not an error.** A dotted value is `estimate.subNumber`. There is no reverse endpoint (quote → orders), and since a quote can be exported repeatedly, that relationship is 1:many — invert it yourself.

### 2.4 Money: gross profit, taxes, payments, payables

| Method | Path | Tier | Payload |
|---|---|---|---|
| GET | `/v2/order/grossprofit/{orderNumber}` | P | `detail{}` |
| GET | `/v2/quote/grossprofit/{quoteNumber}` | P | `detail{}` |
| POST | `/v2/calculatetaxes` | **—** | `detail{SalesTax, MiscTax, UseTax}` |
| POST | `/v2/payment` | P | `result{InvoiceNumber, Balance}` |
| GET | `/v2/payments` | P | **bare** `{receiptAccounts[]}` |
| GET | `/v2/order/payments/{invoiceNumber}` | P | `result[]` |
| POST | `/v2/payables` | P | `result` = string |

**Gross profit — the formula is fully determined and closes to the cent on both published samples:**

```
NetSales           = TotalTransaction − TaxCost
GrossProfit        = NetSales − (MaterialGrossCost + LaborCost + FreightCost
                                 + Load + MiscOverheadCost + MiscExtraCost + ReferralTotal)
GrossProfitPercent = 100 × GrossProfit / NetSales        ← denominator is TAX-EXCLUSIVE
```

Quote sample: 6433.47 − 584.86 = 5848.61; costs 1658.64 + 29.81 + 184.29 = 1872.74; GP 3975.87; 67.98%. Order sample: 3.86 − 0.35 = 3.51; costs 2.04 + 0.16 + 1.49 + 0.06 = 3.75; GP −0.24; −6.84%. Using `TotalTransaction` as the denominator gives 61.80 / −6.22 and matches neither.

**`TaxCost` is not a cost bucket despite its name** — it is the tax carved out of `TotalTransaction` to reach `NetSales`. Adding it to a cost total double-counts. `Load` **is** subtracted even though Load never posts to the GL, so this GP will not tie to any GL-derived margin. `LaborCost`, `MiscExtraCost` and `ReferralTotal` are 0.0 in both samples — their inclusion is inferred from the exact fit, not proven. The response carries no date, no job-cost-status flag, no line breakdown, and no commission figure; the quote and order responses are schema-identical, so **you cannot tell an estimated cost from a costed actual from the payload.** The echoed key is `InvoiceNumber` even when the value is a quote number.

**`POST /v2/calculatetaxes` is stateless and side-effect-free** — no document number in or out, nothing persisted. Body is an order template. Documented rules: `shipTo` required (tax resolves on ship-to city); per line `lineTotal` required; per line `productCode` conditionally required ("Either include this field, or relevant product information, i.e. productId, quantity, priceLevel") — because the store/city tax **base** (Material / Material+Labor / Material+Misc / all) decides which lines enter the base, and `productCode` carries the material-vs-service split; per line `useLineTax` optional.

**`lineTotal` is the pre-tax base and returned tax is additive** (`TotalTransaction = NetSales + TaxCost` corroborates). If RAZZLE DAZZLE carries TPT-gross amounts, they are **not valid `lineTotal` values** — sending them un-grossed-down computes tax on tax and inflates grand total, balance, NetSales and GrossProfit. A single division by (1+rate) is wrong whenever material and labor/misc lines are mixed, because the blended rate is not knowable a priori. Because the endpoint is stateless, the safe method is iterative (post candidates, read `SalesTax`, rescale, 2–3 rounds, absorb the residual cent) — **but the cheaper answer is to carry tax-exclusive line totals in RAZZLE DAZZLE and treat the TPT-inclusive figure as presentation-layer only.**

> **The published Calculate Taxes sample contradicts itself.** `SalesTax` 982.20 is exactly 10.000% of **all three** lines (9822.01) including the two flagged `useLineTax: true` that the docs say must be excluded — and `UseTax` comes back 0. Either the sample is canned or `useLineTax` does not behave as documented. Do not use it as a fixture. Separately: tax RFMS actually stamps on a real order is recomputed store-side, so this result is **advisory**, never the authoritative liability.

**`POST /v2/payment` — "attach a record of payment to an existing quote or order."** It records money already taken elsewhere. There is no card number, token, gateway, capture/authorize flag or merchant credential in the body — only `approvalCode` (an auth code from a real processor) and `paymentReference` (free text, e.g. `"Visa - 1443"`). Body: `documentNumber`, `paymentMethod` (only `"creditcard"` appears anywhere; **the valid set is not published and Get Payment Values does not return one**), `paymentAmount`, `approvalCode`, `receiptAccountId`, `paymentFee`, `paymentReference`. **No date field** — the posting date is assigned store-side. Response: `{InvoiceNumber, Balance}` — **no receipt id**, so you cannot key your ledger to the RFMS receipt from this call.

> **There is no void, refund, reverse, or delete-payment endpoint in the entire 86-endpoint collection.** A posted payment is irreversible via API. On `waiting`, the correct retry is the **`messageId` header** to retrieve the stored result — re-sending the body creates a second receipt. Also: `paymentFee` is accepted and echoed back by **nothing** (not the POST response, not List Payments) and the docs never say whether it is included in, added to, or deducted from `paymentAmount`. The endpoint accepts a **quote** number, but List Payments takes an order invoice number — a payment recorded against a quote may be unreadable via the API.

Two RFMS defects specifically target this call: **v24.3** (a final payment posted via API on a job-costed order with a balance made Commission Base reflect the full sale instead of profit — fix requires un-job-costing and re-job-costing every affected order) and **v24.4** (a payment with a value in the Check Number field overwrote the Check Register Account Code so the journal entry never posted at deposit). **Confirm the store's version before enabling this write.**

**`GET /v2/payments`** (plural — one character from the irreversible write; guard it in code) returns bare `{receiptAccounts:[{id, name, creditCardPrefixes:[int]}]}`. `creditCardPrefixes` are card leading digits (3 = Amex, 6 = Discover); an empty array is the catch-all register. Ids are per-store — cache per queue, never globally.

**`GET /v2/order/payments/{invoiceNumber}`** returns `result[]` of `{documentNumber, paymentNumber, paymentMethod, paymentAmount, approvalCode, receiptAccountId, paymentReference, paymentDate, orderDate, beginningBalance, remainingBalance, discountAmount, discountAccountNumber, financingCharge, customerName, storeNumber, notes}`. **Do not chain `beginningBalance`/`remainingBalance` into a ledger** — in the official sample, payment 132 goes 127.53 → 0 and payment 133 then starts at 1438.80 because the order total changed between postings. They are point-in-time snapshots. Take the live balance from Record Payment's `Balance` or Get Order's `balanceDue`. Write/read asymmetry: this returns `discountAmount`, `discountAccountNumber`, `financingCharge`, `notes` — none of which POST can set — while POST accepts `paymentFee`, which is not returned. **You cannot round-trip a payment.** No `voided` flag appears on payment rows.

**`POST /v2/payables` — the highest-blast-radius write in the API.** Body is a **top-level JSON array** (unique in the API). Header fields: `supplierName` (a **name string**, must match an existing supplier exactly), `invoiceNumber` (the *supplier's* invoice number), `invoiceDate`, `dueDate`, `discountableAmount`, `nonDiscountableAmount`, `discountRate`, `linkedDocumentNumber` (**the docs leave its RFMS field name blank**), `internalNotes`, `remittanceAdviceNotes`, `detailLines[]`. Each detail line: `storeNumber` (explicit warning: "you must supply the Store number (32), not the Store display code"), `accountCode` (GL account, string), `subAccountCode`, `amount`, `comment`.

> **`(supplierName, invoiceNumber)` must be unique — and the `/Accounts Payable` folder contains no read, update, or delete endpoint.** There is no way to check whether a payable exists before creating one, and no way to remove one afterwards. A voided AP invoice can never be un-voided and **its invoice number stays consumed for that supplier**. A blind retry after ambiguity is either rejected as a duplicate or creates a second bill you can only kill by burning the number. Log every attempt with the exact pair before sending; **never auto-retry.** The response names exactly **one** payable (`"ACME - XS101 Added"`) regardless of array length, so **partial success is unobservable** — post one payable per call until proven otherwise. Also: **tier trap** — this needs `supplierName`, but `GET /v2/suppliers` is **Enterprise**, and no chart-of-accounts endpoint exists at any tier. Date format here is `"9/24/19"` (M/D/YY) against ISO everywhere else. `discountRate: 0.1` is unit-ambiguous. **Do not use this for inventory/material bills** — those must originate from Cost from Invoice in receiving, or job cost is corrupted.

### 2.5 Inventory and the material state machine

```
None ⇄ GenPO  ···[no API]···►  On Order
  │
  └──► Reserved ──► Cut ──► [Staged, ERRM only] ──► Delivered  ···[no API]···►  Job Costed
```

| Method | Path | Tier | Transition |
|---|---|---|---|
| POST | `/v2/product/inventorycheck` | P | lookup → `inventoryLink` |
| POST | `/v2/order/inventory/reserve` | **E** | → Reserved |
| POST | `/v2/order/inventory/cut` | **E** | → Cut (**response undocumented**) |
| POST | `/v2/order/inventory/stage` | P | → Staged (**ERRM orders only**) |
| POST | `/v2/order/inventory/deliver` | P | → Delivered |
| POST | `/v2/inventory/location` | P | bin move (note different path root) |
| POST | `/v2/order/save/linestatus` | **—** | None ⇄ GenPO (**the only reversible call**) |
| POST | `/v2/order/purchaseorder/find` | P | PO read for one order line |

**Canonical order:** `inventorycheck` → `reserve` **or** `cut` → (`stage` if ERRM) → `deliver`. Nothing in the docs requires reserving before cutting; both take the same `inventoryLink`.

> **⚠️ The tier split is asymmetric and counterintuitive.** Reserve and Cut are **Enterprise** ("Requests from other level API accounts will return Unauthorized"). Stage, Deliver, inventorycheck, set-location and purchaseorder/find are only **Plus**. **A Plus (or TPD) account cannot assign inventory to a line, yet CAN mark lines Staged and Delivered — the transitions that move inventory to Used and, under ERRM, post real-time journal entries.**

> **⚠️ Irreversibility.** Across all 86 endpoints there is **no** un-reserve, un-cut, un-stage, un-deliver, or release-inventory call. The **only** reversible transition in the group is None ⇄ GenPO via `setToGeneratePO: false`. Every other call is a one-way door; reversal requires a human in Core.

**`POST /v2/product/inventorycheck`** — `{productCode, styleName, colorName}`, **exact match**, not a search. Returns an array of inventory instances: `storeId, productCode, styleName, colorName, styleNumber, colorNumber, lotName, supplierName, manufacturerName, availableQuantity, unitPrice, saleUnits, location, availableLengthInInches, isOnOrder, rollWidth, inventoryLink{inventoryId, rollNumber}`. **Pass `inventoryLink` back verbatim as an object; do not decompose it.** In the inventorycheck sample `inventoryId` is 0 and only `rollNumber` is meaningful, while the Reserve/Cut samples show `inventoryId: 39` — both shapes occur, so `inventoryId` alone does not identify the record. **Filter `isOnOrder: true` rows** — that stock has not landed. The call is read-only and takes no soft hold: two callers can both see the same roll as available. Scope is implicitly the impersonated user's "Inventory Stores Visible to User" option.

**Reserve / Cut** — single form: `{orderNumber, lineNumber, inventoryLink}`. Multi form: `{orderNumber, inventoryList:[{lineNumber, inventoryLink}]}`. The two are mutually exclusive. Reserve returns an unstructured string (`"Line 1: Assigned"`); **Cut has no published response at all** — do not string-match it until verified. Behaviour when `availableQuantity` < line quantity is undocumented and probably governed by the "Allow Over Assignment of Inventory" System Option, i.e. **the same call can succeed or fail depending on a user permission you cannot see over the API.**

**The accounting effect of Cut is regime-dependent.** Non-ERRM: inventory moves Reserved → Used at **Cut**. ERRM: the line goes to Cut but the inventory record stays Reserved until **Deliver**. Same code, opposite inventory consequence. **Determine Floor Daddy's regime before shipping anything that calls Cut or Deliver.**

**Stage / Deliver** — `{orderNumber, orderDate, lines:[int line numbers]}`. **`orderDate` is misnamed**: it is "date to mark the lines as staged/delivered," i.e. the staging/delivery date, in `MM-DD-YYYY` (proved by the Deliver sample `06-20-2024`). The stamped date becomes the delivery date, feeding AR aging and commission basis. Stage is **ERRM-only** with an undocumented failure mode on non-ERRM orders. Deliver returns the literal string `"Cut Lines Processed"` — on the *deliver* endpoint. Neither response names the lines processed, so **a silently-skipped line is indistinguishable from success**; verify by re-reading the order.

**`POST /v2/order/save/linestatus`** — `{orderNumber, lineId | lineIds[], setToGeneratePO: bool}`. **No tier is stated.** Hard precondition, stated twice: the line(s) must currently be status None or GenPO. **Identifier trap: this endpoint takes internal `lineId`s (e.g. 200380), while reserve/cut/stage/deliver/purchaseorder-find take line NUMBERS (1, 3, 5).** Persist both per line. GenPO **does not create a purchase order** — it is only a flag meaning "must still be purchased"; the actual PO requires a human pressing the line's PO button or running Auto PO. So an automated material-readiness feature can flag the need but **cannot close the purchasing loop.**

**`POST /v2/order/purchaseorder/find`** — `{number, lineNumber}` (note: `number`, not `orderNumber`). Returns a **single object**: `purchaseOrderNumber, referenceNumber, supplierName, styleName, colorName, manufacturerName, amountOrdered, amountReceived, amountRemaining, units, freightCarrier, trackingNumber, orderDate, promiseDate, requiredDate, requestedShipDate, status, orderedBy, takenBy, comments`. **This is the material-ETA feed.** PO number format confirmed: `"CG1051590001"` = order number + 4-digit zero-padded sequence. Severe scope limit: you can only reach a PO through an order+line you already know — there is no list-by-supplier/status/date/PO-number, so no purchasing dashboard without iterating every order line. A line split across multiple POs may silently return only one.

**`POST /v2/inventory/location`** — `{productCode, location, id}` where `id` is the "System Reference Number." **Nothing in the API returns an SRN.** `inventorycheck` returns `inventoryLink.inventoryId` (0 in its own sample) and the docs never equate the two. As documented, bin management is **not implementable**.

### 2.6 Schedule Pro (18 endpoints)

| Method | Path | Tier |
|---|---|---|
| GET | `/v2/job/:id` | P |
| GET | `/v2/order/jobs/:number` | P |
| GET | `/v2/jobs/:crew` | P |
| POST | `/v2/jobs/crew` | P |
| POST | `/v2/jobs/find` | P |
| GET | `/v2/statuses` | **—** (bare envelope) |
| GET | `/v2/jobstatusids` | P |
| GET | `/v2/timeslots` | P |
| GET | `/v2/jobtypes` | P (bare envelope) |
| GET | `/v2/job/tracklist` | P |
| GET | `/v2/crews` | P |
| POST | `/v2/job/status` | P |
| POST | `/v2/job/notes` | P |
| **DELETE** | `/v2/job/:id` | **P** |
| POST | `/v2/job/create` (from order) | **E** |
| POST | `/v2/job` (create **and** update) | **E** |
| POST | `/v2/job/provider` | **E** |

**One order maps to many jobs.** The `GET /v2/order/jobs/:number` sample returns jobIds 17458/17459/17460 all on `CG105092`, one per crew with sequential date windows. Model 1:N.

**Job model:** header (`jobId` int) with site address, phones, `customerName`, `salesperson`, `storeNumber`, `documentNumber`, `jobNumber`+`jobNumberCaption`, `jobName`, `crewName`+`secondaryCrew`, `depotName`, `scheduledStart`/`scheduledEnd`, `skipSaturday`/`skipSunday`, `jobStatus`, `laborTotal`, `notes` (work-order) and `workTicketNotes`, plus `track1Description` (service reason) and `track2Description` (alternate list). `lines[]` (`lineId` int) are **copies of order lines** carrying `material, productCode, styleName, colorName, units, quantity, length, width, lineNumber + documentNumber` back-reference, `scheduledDate`, `scheduledStartTime`/`EndTime`, per-line `crewName`, notes, `lineGroup`, `displayColor`, `rollNumber`, `areas`, `attachedFiles`.

**`POST /v2/job` is an upsert.** Omit `jobId` → create; include it → update. The collection's saved response is literally named "Create Or Update Job." **A bug that drops `jobId` silently creates a duplicate job.** Same trap at line level: **omitting `lineId` is how you ADD a line**, so a dropped `lineId` on an edit creates a duplicate line. Delete a line with `{"lineId": N, "delete": true}`. Whether `lines[]` is a merge or a full replace is **not documented** — the delete-by-flag mechanism implies merge, but confirm destructively on a sandbox job before any production write.

**The `jobChecks` override protocol (mandatory for any write).** On store-configured validation, `POST /v2/job` returns:

```json
{"status":"failed","result":"Error saving job",
 "detail":[{"JobCheckType":"Track1NoSelection","RestrictLevel":"Warning",
            "Message":"NO SELECTION HAS BEEN MADE FOR SERVICE REASON","Override":null}]}
```

To force the save, echo the array back as `jobChecks` on the job body with `override: true` on each entry. **Casing trap: the response returns PascalCase keys, the request expects camelCase** (`jobCheckType`, `restrictLevel`, `message`, `override`) — you must rename, not echo verbatim. The full vocabularies of `jobCheckType` and `restrictLevel` are unpublished, and it is not stated whether a level stricter than `"Warning"` can be overridden at all.

**`POST /v2/job/notes` is a destructive overwrite with an append-shaped name.** Parameters are `id` (**not `jobId` — the only write in the group that uses `id`**), `workOrderNotes`, `workTicketNotes` (send one or the other, not both). The docs: *"Otherwise, the existing notes will be replaced by the new content."* Mandatory pattern: GET the job first (via `/v2/order/jobs/:number`, the only read returning both note fields), concatenate client-side, POST the whole string. Reads return RTF-converted HTML with author+timestamp headers and `<img src="images\image1.png">` references you cannot resolve through this API; the write example sends bare plain text and preservation semantics are unstated.

> **⚠️ `DELETE /v2/job/:id` requires only Plus, while create and update require Enterprise.** A Plus-tier or TPD credential can irreversibly destroy scheduled work it cannot recreate through the API. No soft delete, no restore, no `force` flag, no published response. Nothing is documented about what happens to the job's lines, notes, attachments, posted provider records, the originating order's link, or previously deducted capacity. Gate behind explicit human confirmation and snapshot via `GET /v2/job/:id` first.

**`POST /v2/jobs/find` is the incremental-sync endpoint.** Body: `startDate`/`endDate` (**record-status** window — when the row was inserted/updated), `scheduledStartDate`/`scheduledEndDate`, `installStartDate`/`installEndDate`, `crews[]`, `secondaryCrews[]`, `jobStatus[]`, `recordStatus` (`"Inserted"|"Updated"|"Both"`). **Request dates are `MM-DD-YYYY`; every response date is a different format.** The published example contains a malformed value (`"installEndDate": "0401-2022"`) — do not copy it. **No job object anywhere in the API carries a last-modified timestamp**, so changes cannot be ordered or deduped client-side; poll windows must overlap. No paging, no cap, no sort documented.

**Controlled vocabularies — all store-configurable, never hard-code:**

| Lookup | Returns | Feeds |
|---|---|---|
| `GET /v2/statuses` | bare `{activeStatuses:[strings]}` | `status` **string** on `POST /v2/job/status` |
| `GET /v2/jobstatusids` | `detail[{id, description}]`, ids sparse (6,7,9,10,11,15,18,19) | `jobStatusId` **int** in the job body |
| `GET /v2/timeslots` | `{id, slot, startTime, endTime}` | `timeSlotId` int |
| `GET /v2/job/tracklist` | `detail{track1Listings[], track2Listings[]}` | `track1Description`/`track2Description` — **the description STRING, not the id**, and the two lists are not interchangeable |
| `GET /v2/jobtypes` | bare `{jobTypes:[strings]}` | **nothing** — no write field accepts a job type |
| `GET /v2/crews` | `{id, name, description, depot, nickname, rfmsName, telephone1/2(+Description), availability{Sun..Sat bools}}` | `crewName`, `secondaryCrew`, `crews[]` — **by NAME string; no endpoint accepts a crew id** |

Fetch and cache **both** status endpoints, joined on `description` (never array position — the ordering differs). Watch the string collisions: `CONTINUED` and `FINISH` are both statuses **and** time-slot names; `GROUT` and `MOVE FURNITURE` are both statuses **and** track1 descriptions. A bare string is ambiguous without knowing its source field.

**No write surface for crews, depots, job types, statuses, time slots, or track listings, and no capacity endpoint at any tier.** `availability` is a static weekly boolean pattern — no hours, no capacity, no PTO. RAZZLE DAZZLE **cannot ask RFMS whether a crew is free**; it must compute that from Find Jobs. The only capacity lever exposed is the per-line boolean `deductCapacity` on Update Job — a **write-only consumption of a shared resource you cannot query or reverse.** Job type is derived server-side from `productCode`; there is no endpoint exposing that mapping.

**`track1Description`/`track2Description` are write-only** — no read endpoint returns them and Find Jobs cannot filter on them. If RAZZLE DAZZLE uses them for warranty/commercial classification, it must keep its own copy and can never reconcile.

**`GET /v2/job/:id` is the only read exposing `jobLock` and `orderLock`** (both null in the sample, otherwise entirely undocumented) and the only one exposing per-line `lineStatus`, `orderLineNote`, `woLineNote`, and the `delete` flag.

Crew name handling: use **`POST /v2/jobs/crew`** (body form) exclusively and never build the GET path — the GET form breaks on `& . * ( ) , [ ]`, and real crew names in the sample already include `"COLLAZO, JESUS"`. Both forms are unbounded (no date/status filter, no paging); use `POST /v2/jobs/find` with a `crews` filter for production.

### 2.7 Products, attachments, providers, claims

| Method | Path | Tier | Payload |
|---|---|---|---|
| GET | `/v2/product/get/productcodes` | P | **bare** `{productCodes[]}` |
| POST | `/v2/product/get` | P | `result[]` (ids as **strings**) |
| POST | `/v2/product/find` | P | `result[]`, 10/page via `pageIndex` |
| POST | `/v2/product/get/productbundle` | P | `result[]` bundles |
| GET | `/v2/product/templates/:id` | P | `result[]` — **`:id` is a PRODUCT CODE** |
| GET | `/v2/product/etaggs` | P | **`detail[]`**, PascalCase keys |
| POST | `/v2/attachment` | P | **response undocumented** |
| POST | `/v2/attachments` (list) | P | `result[]` incl. inline base64 |
| GET | `/v2/attachment/:id` | P | **`detail`** = base64 |
| DELETE | `/v2/attachment/:id` | P | **no response published** |
| POST | `/v2/attachment/paperless/doctype` | P | `result[{id, name}]` |
| POST | `/v2/order/provider` | **E** | `result: "OK"` — **no id** |
| POST | `/v2/job/provider` | **E** | `result: "OK"` — **no id** |
| POST | `/v2/claim/create` | **E** | `result` = `"CL903428"` |
| POST | `/v2/claim/notes` | P | appends |

**The catalog is read-only to the API — there is no product create, update, or deactivate at any tier.**

**Product identity:** the product key is `id` (the help-centre's ProductSeqNum) and the color key is `colorOptions[].id` (ColorSeqNum). Those help-centre names appear in **no** API payload. `SKU` exists but is empty in every sample. Product Code is a zero-padded 2-char string (`"01"`), doubles as the `:id` of Get Product Templates, and encodes the material/service split (services start at 80 in the sample: 80 MISCELLANEOUS, 81 CARPET INSTALLATION, … 87 WOOD INSTALLATION).

RFMS's three underlying product files (Rolls / Items / Services) are **flattened into one product object**. You recover the distinction only from populated `rollNumber`/`rollLengthInches`/`rollWidthInInches`, from `saleUnits`, from `productCode`, or from the `isRoll`/`isInventory`/`isService` flags — which **only List Attachments exposes.**

Full product object: `id, productCode, storeNumber, styleName, styleNumber, defaultPrice, saleUnits, rollWidthInInches, rollLengthInches, patternWidthInInches, patternLengthInInches, rollNumber, supplierName, privateSupplierName, manufacturerName, activeProduct, sellByQuantity, notes, inventoryUnits, priceListings{}, colorOptions[]`. `priceListings` is a **sparse** map keyed `"Price1"…"Price12"` plus `"Cut"` and `"Roll"` — a missing key means "not priced at that level," not zero. `colorOptions[]` entries carry `id, colorName, colorNumber, SKU, activeColor, relatedProductAvailable`, and **`attactments`** — misspelled in the live payload; quote it exactly or your deserializer drops color attachments silently.

**`POST /v2/product/find`** — `searchText` required, matched in style and color names. Optional `productCode`, `storeNumber`, `colorSKU`, `pageIndex`, `ecProductId`/`ecColorId`/`ecSizeId`. Fixed 10/page, no total, no active-only filter (`activeProduct` isn't in this response — re-fetch via `/product/get` to know whether a hit is discontinued). `colorOptions` returns **all** colors for a matched style, not just those matching the search text.

**`GET /v2/product/templates/:id` — the path parameter name is a lie: it takes a PRODUCT CODE, not a product id.** Highest-risk naming trap in the group. Template `id` is a per-store ordinal, not a stable key. **There is no endpoint that applies a template to a document** — you read the member products and post them yourself via Create/Update Order (Enterprise).

**`GET /v2/product/etaggs`** is a whole-company dump with **no paging, no filter, no store selector, no updated-since parameter**. It is the only source of `FiberType, Backing, Warranty, Species, Quality, Collection, MSRP, ThicknessUOM` and the Sell/Buy conversion factors. Unit mismatch to watch: `RollLength 150.0`/`RollWidth 12.0` here are **feet**, while the product object reports `rollLengthInches 2400`/`rollWidthInInches 144`. `TransactionDate` is `{Year, Month, Day}`. Keys are PascalCase with a trailing-underscore field (`FreeText_`).

**Attachments are base64-in-JSON, in and out.** `POST /v2/attachment` takes either a document target (`documentNumber` + `documentType` ∈ {Quote, Order, Estimate, Claim}, optional `lineNumber`, optional `subNumber` for estimates) **or** a product target (`productId`), plus `fileExtension` (bare, no dot, free text), `fileData` (base64), optional `description` and `paperlessDocType`. **The collection puts the request example in the response slot, so the upload response — including whether it returns the new attachment id — is undocumented.** No file-size limit, no MIME field, and no allowed-extension list appears anywhere; the only evidenced type is `png`.

`POST /v2/attachments` (list) is the **only** way to discover attachment ids, and **it returns the full base64 `fileData` inline for every match** — there is no metadata-only mode. Listing a photo-heavy order returns multiple megabytes in one response. It also returns the store's internal UNC `path`. Its parameter table does **not** list `"Claim"` as a documentType even though upload accepts it.

`DELETE /v2/attachment/:id` is **irreversible at Plus tier with no published response** — the same tier as read-only product search. Log id, path, description and size before calling.

`POST /v2/attachment/paperless/doctype` — **naming inversion:** in this enum `Est*` means **Quote** (`EstHeadPictures` = "Quote Header") and `Je*` means BidPro Estimate — the opposite of the `documentType` convention on upload. Decode via the Explanation column, never the prefix. The returned list is **user-dependent** — do not hard-code ids.

**Provider records = installer pay.** A provider record is a pay record hung off a **specific order line** or **job line** — not HR, not payroll, not an order line.

`POST /v2/order/provider`: `{documentNumber, lineNumber, installDate, supplierId | providerId, rate?, hoursRegular?, hoursOvertime?, hoursDoubleTime?}`. **Exactly one of `supplierId`** (from `GET /v2/suppliers`) **or `providerId`** (from `GET /v2/personnel`) — both **Enterprise-only lookups**. `rate` defaults to "line gross cost or personnel hourly rate," so omitting it means two different behaviours depending on which id you sent. Note the supplier list is a general vendor list (84 LUMBER, a gas utility, a radio station) — **nothing prevents booking installer pay against a material vendor.**

`POST /v2/job/provider`: `{jobId, jobLineId}` only. No payee, rate or hours — all derived. **Documented hard precondition: "The job line must already have a document number and a line number associated with it."** Ordering: Update Job to bind `documentNumber` + `lineNumber` on the line → then post the provider record.

> Both return `{status:"success", result:"OK", detail:null}` — **no record id.** There is **no get, update, or delete provider endpoint at any tier.** Creation is write-only, non-idempotent and irreversible; a retry after a timeout or `waiting` creates a second pay record you cannot detect or remove through the API. Downstream: with `Integrate Provider's Earnings = Yes`, provider charges must balance by product code against the **cost** of the order's service lines (PC 80–98) or the order will not job cost; force-balancing rewrites unit costs on existing service lines and destroys the estimate-vs-actual baseline. An order with any provider record **cannot be voided**. **Do not automate this in v1.**

**Claims.** `POST /v2/claim/create` (Enterprise) posts a full document body modelled on Create Order — including `lines[]` with `productId, colorId, quantity, priceLevel` — and returns the new claim number as a bare string in `result`. **There is no Get Claim and no Find Claims**; the only read-back path in the whole API is `POST /v2/order/find/advanced` with `orderSearchType: "Claim"`. **Nothing in the documented body links the claim to an order.** Create Order's `messageId`/`waiting` protocol is not restated for claims — assume it applies and design for idempotency, because a blind retry may create a second claim.

`POST /v2/claim/notes` (Plus — **lower than create; you can annotate claims you cannot create**) appends to `publicNotes`, `privateNotes`, `workOrderNotes`, and `lineNotes[{id, note}]` where `id` is a **line ID, not a lineNumber**. Per the parent Add Notes doc, this works **even after the document is job costed** — notes are the one write channel that survives job costing and the post-book lock. Being an append, it is not idempotent: prefix generated notes with a unique marker. Only ~24 lines of a note print.

---

## 3. ⚠️ Corrections to our help-centre reference

Ordered by consequence.

### 3.1 Scheduling has a full API. Retract §7.6, §9.1, §9.4 and §10 in full.

The reference's headline claim — *"The documented RFMS REST API contains no create/read/update of scheduled jobs, crews, depots, capacities, or job statuses at any tier"* — is **false**. The published collection contains an 18-endpoint `/Schedule Pro` folder with read, search, create, update, **delete**, status change, note replacement, provider posting, and four lookup vocabularies. Corroborated elsewhere in the collection: Create/Update Quote and Order accept `timeSlot`, and Advanced Order Search filters on `scheduleProStatus`.

The recommendation to own scheduling in RAZZLE DAZZLE may still be correct, but **"no API exists" is not the reason and must be replaced**. The real constraints are: job create/update is Enterprise; crews/depots/job types/statuses/slots/tracks/capacity are read-only at every tier; there is no change feed and no last-modified field on any job object; and **DELETE is Plus while create/update is Enterprise.**

### 3.2 The sessionToken transport is documented — stop calling it unknown.

The `/Authentication` **folder** description states it verbatim (§1.2). Identical wording appears in the deprecated v1 collection. Machine-readable corroboration: collection-level `auth: {type: basic}` inherited by all 86 requests, only `session/begin` overriding the password. The reason this looked unknown is that the flattened dump preserved only request-level descriptions. **Every section of our reference should be re-read against the raw collection's folder descriptions.**

### 3.3 Creates are Enterprise, not Standard. There is no cheap on-ramp.

§1.3/§8.2 claim Standard can *"create Quote / Order / BidPro-Estimate headers with no lines"* and §9.3 builds a playbook on it. `POST /v2/quote/create`, `/v2/order/create` and `/v2/estimate/create` each state Enterprise, "Requests from other level API accounts will return Unauthorized," and **there is no line-less create variant.** The `/Order Entry` folder returns Unauthorized to Standard for everything in it. **At Standard the only usable folder is `/Customers`, and the only route to any selling document is `POST /v2/opportunity`.** Note-writing is also not a Standard channel: Add Notes to Order is Plus, line notes are Enterprise.

### 3.4 The API does NOT lock records implicitly, and lock release is not Core-only.

§8.4 asserts *"Opening or editing an order locks it"* via the API. That is desktop behaviour. Via the API, locking is **opt-in**: `?locked=false` is the documented default and *"To request a lock when retrieving the order, add the query parameter locked=true."* **Routine reads are safe and need no lock-management machinery.** Separately, §8.4 presents lock release as ROS/Core-only — `GET /v2/unlock/:id` exists, **but at Enterprise while taking a lock is Plus** (§2.1).

### 3.5 Purchase orders, tax, AP, AR cash, and provider pay all have APIs.

§8.2's "explicitly not present at any tier" list and §9.1's ownership table are substantially wrong:

- **Purchase orders**: `POST /v2/order/purchaseorder/find` (Plus) returns full PO detail including `promiseDate`, `amountReceived`, `amountRemaining`, `freightCarrier`, `trackingNumber`. The prohibition on **creating or receiving** POs still stands — no such endpoint exists.
- **Tax**: `POST /v2/calculatetaxes` exists. §9.4's *"Do not… compute tax. No API"* is wrong on availability; the caveat that the result depends on store/city config you cannot see, and that RFMS recomputes tax its own way on the real order, survives.
- **AP**: `POST /v2/payables` is a **Plus-tier write that sets GL account codes**.
- **AR cash**: `POST /v2/payment`, `GET /v2/order/payments/:number`.
- **Provider/installer pay**: `POST /v2/order/provider` and `POST /v2/job/provider` (Enterprise).

### 3.6 Gross profit: the API's single percentage is TAX-EXCLUSIVE, and it can be matched.

§5.3 says RFMS stores three GP percentages and warns *"a tax-exclusive GP computed externally will never match."* Whatever Core's reports store, **the API returns exactly one percentage and its denominator is `NetSales` = `TotalTransaction − TaxCost`** — verified to the cent on both samples (§2.4). It is the analogue of GPNetSales. A tax-exclusive GP computed externally is precisely what this endpoint returns.

§5.3's cost formula *"…+ Load + Load% + TAX"* is wrong: **tax is not on the cost side.** The field name `TaxCost` invites exactly that error; anyone porting the reference's formula will double-count tax and understate margin.

Also: the header money buckets are `{material, labor, misc, total, salesTax, miscTax, grandTotal, recycleFee}` — "Services" is `labor`, and there is a `recycleFee` bucket the reference's model omits.

### 3.7 The `{status, result}` envelope is not universal, and the payload key varies.

See §1.5. Eight endpoints return no envelope at all; the opportunity-duplicate failure has its own shape; Find Jobs duplicates the payload into both keys; Find Quotes/Orders and Get Customer return two divergent projections. A single generic unwrapper breaks in at least eleven places.

### 3.8 Duplicate detection is NOT built into the API generally.

§9.1/§8.2 say duplicate detection is built in and §9.3 calls customer writes "safe." Duplicate detection is documented on **exactly one** endpoint, `POST /v2/opportunity`, and even there it is conditional: *"Depending on your store's configuration…"*. `POST /v2/customer/` documents **no duplicate check whatsoever**. RAZZLE DAZZLE must implement search-before-create and verify the dedupe configuration **per install**. (§2.3 of the reference is right in substance that the check is name + phone1 but too narrow in scope: the API's message spans *Sales Lead, Prospect or Customer*.)

### 3.9 Line reconciliation key: `lines[].id`, not (Invoice Number, Line Number).

§2.3/§9.2 tell integrators to key lines on `(Invoice Number, Line Number)` and warn it is unstable. The API never uses that pair for writes — every line edit, delete, note and work-order-line op addresses the opaque `lines[].id`. **But** reserve/cut/stage/deliver/purchaseorder-find take **line numbers**, while `/v2/order/save/linestatus` takes **line ids**. **Persist both per line.**

### 3.10 BidPro primary sub-number is 1, not 0.

§2.3 says "Sub Number 0 = primary." Create and Update Estimate both *"default to 1"*, Get Estimate returns `subNumber: 1` for the primary, and Order History returns `"JE100250.1"`. Anything built on 0-as-primary addresses the wrong record — and Update Estimate **defaults silently rather than erroring.**

### 3.11 Change feeds exist. §9.6 question 6 is answered.

Four incremental hooks, each with a hard limit:
1. `POST /v2/order/find/advanced` with **`updatedDateFrom`** — date-granular (not a timestamp), so always re-poll from the previous day and dedupe. No paging documented.
2. `GET /v2/orders/jobcosted` — delivery ≤31 days **AND** updated ≤48 hours, both hard-coded. **A poller outage >48h loses deltas permanently.**
3. `GET /v2/opportunities/lastmodified` — CRM events, **fixed 7-day retention, no cursor, no backfill.**
4. `POST /v2/jobs/find` with `recordStatus` + a rolling date window — the only schedule change detection, and **no job carries a last-modified field**, so changes cannot be ordered or deduped.

§9.4's blanket "do not use RFMS notifications as CDC" remains right about Core's notification system, but must carve these out.

### 3.12 Exported orders are Web Orders, and Web Orders cannot take a billing group.

Not in the reference at all. Composed from three statements across three endpoints (§2.3). Since billing group number surfaces as "Project Number" on reports, this silently blocks project-level billing for anything RAZZLE DAZZLE exports.

### 3.13 Stage and Deliver are reachable without printing.

§239/§671 state Staged and Delivered are reached by printing a picking/delivery ticket, and §601 says never trigger printing via the API. Both are true of the desktop. The API provides **direct non-printing transitions** (`/v2/order/inventory/stage`, `/deliver`) at **Plus** tier. This materially expands the feasible design of a material-readiness feature — and materially expands the risk, since Deliver under ERRM posts real-time journal entries.

### 3.14 Reserve vs Cut: answered.

§649 asks whether the Enterprise "assign inventory" call lets you specify Reserve vs Cut. **They are two separate endpoints with identical request bodies**, and nothing requires reserving before cutting.

### 3.15 TPD access is capped, not equivalent.

§8.1 describes the TPD opt-in neutrally, implying parity. The docs say a TPD session is granted Plus *"regardless of the store's actual API subscription level."* Read as a ceiling, a TPD session can never reach any Enterprise endpoint even at an Enterprise store.

### 3.16 Smaller but load-bearing corrections

- **Claim creation is Enterprise, not Plus** (§8.2 has it under Plus), and it takes **lines**, not just a header.
- **PNG is supported.** §9.2's "PNG and HEIC are not supported" is contradicted by the official List Attachments sample returning `"fileExtension": "png"`. The API documents **no** file-type whitelist. HEIC remains untested.
- **Attachment capability is understated**: Plus grants four attachment endpoints **plus an irreversible DELETE**.
- **Providers may be suppliers.** §7.4 says the provider must exist in HR Worker Information. The API accepts `providerId` (personnel) **or** `supplierId` (the general vendor list).
- **Provider records attach to a LINE**, not "to the order."
- **Store identity**: §3.7 treats numeric store numbering as an *alternative* to single-char codes. The API shows both **coexisting on the same record.**
- **`companyId`** is a scoping axis above store that the reference never mentions.
- **The API caches store settings** — never mentioned in the reference; reframes a whole class of "missing data" bugs as staleness, not permissions.
- **§9.4's blanket "do not trigger document printing"** needs amending for Generate Report, which is a non-printing path that produces a customer-facing, money-armable document.
- **Idempotency-by-PO-number only works on Advanced Order Search** (and Find Estimate). Find Orders/Find Quotes match customer name only.
- **Confirmed, no change needed:** Record Payment is Plus; Get Quote/Get Order with lines is Plus; the payment endpoint is receipt-writing only, not processing; §7.1's Schedule Pro object model.

---

## 4. What this means for RAZZLE DAZZLE

Premises from `DECISIONS.md`: **RAZZLE DAZZLE is the operational system of record; RFMS is authoritative for material.**

### 4.0 Two decisions that gate everything else

1. **Run on Floor Daddy's own store credentials at Enterprise tier. Do not build on a TPD key.** If the Plus grant is a ceiling (§5, Q1), a TPD session can never create documents, assign inventory, create or update jobs, post provider records, or list personnel/suppliers. Even at Plus-as-floor, the Enterprise-only set (Create Order/Quote/Estimate, Reserve, Cut, Create/Update Job, Unlock, Get Personnel, Get Suppliers) is exactly the set a material-authoritative integration needs. **This is an architectural ceiling, not a config toggle — settle it before anything is built.**
2. **Determine the ERRM regime before any inventory write ships.** Under non-ERRM inventory is consumed at **Cut**; under ERRM at **Deliver**, which also posts real-time journal entries. The same code has opposite accounting effects.

### 4.1 Material readiness — the highest-value integration

RFMS is authoritative for material, and this is where the API is strongest.

**Read path (poll):**
- `POST /v2/order/purchaseorder/find` per order line for `amountOrdered / amountReceived / amountRemaining / promiseDate / requiredDate / status / trackingNumber`. **This is the only material-ETA source in the API.** It is Plus, but it is per-(order, line) only — there is no list-by-supplier or by-status, so build a per-line poller driven off RAZZLE DAZZLE's own list of open jobs, not off an RFMS sweep.
- `POST /v2/product/inventorycheck` for on-hand availability. Filter `isOnOrder: true`.
- `GET /v2/order/:number` (**with `locked=false`, always**) for line state. **Capture a complete, untruncated Get Order response in the spike** — the published sample truncates before any line-status field, and the entire readiness roll-up depends on whether a per-line status exists.

**Write path (Enterprise, human-gated):**
- `POST /v2/order/save/linestatus` with `setToGeneratePO` — **the only reversible transition in the API.** Safe to automate. But it does **not** create a PO; a human or Auto PO must still act, so the purchasing loop cannot close programmatically.
- `POST /v2/order/inventory/reserve` / `/cut` — assign rolls. **Irreversible; require explicit human confirmation in RAZZLE DAZZLE.**
- `POST /v2/order/inventory/stage` (ERRM only) / `/deliver` — **treat Deliver as privileged and money-adjacent**, never as an automatic consequence of a field-app tap. It stamps the delivery date that drives AR aging and commission basis, and under ERRM it posts journal entries.

**Design rules:** persist both `lineNumber` and `lineId` per line. Never set `width` on a line you intend to reserve against (it becomes unreferenced). Never pass `locked=true` outside an Enterprise key with a guaranteed `finally` unlock. Never blind-retry an inventory write on `waiting` — no `messageId` is documented for any of these.

### 4.2 Order sync (incremental)

**Primary feed:** `POST /v2/order/find/advanced` with `stores: [Floor Daddy's store ids]` + `updatedDateFrom`. Run every 15–60 minutes with `updatedDateFrom = today − 1` (date granularity forces the overlap) and dedupe on `documentNumber`. This is also the **only** search that matches PO number and job number, so it is your retry-safety net for creates with no `messageId`. It is also the only place `voided` and `closedDate` appear — **it is your only voided-order detector.**

**Completed-work feed:** `GET /v2/orders/jobcosted`, polled every **6–12 hours** so a few consecutive failures cannot open a 48-hour gap. Response shape is unpublished — treat the first live call as exploratory. Because un-job-costing rewrites figures into the *original* delivery month, an order's financials can change without reappearing in a forward-looking 31-day window: **reconcile periodically against Advanced Order Search rather than trusting this feed alone.**

**Hydration:** `GET /v2/order/:number?locked=false` for full header + lines. `GET /v2/order/history/:number` once per order to capture provenance (`detail: null` = created directly).

**Reference maps to cache per store:** `GET /v2/order` (order/service/contract types — needed **bidirectionally**, since Advanced Search filters on ints but returns strings), `GET /v2/customers` (all customer enums + the store id↔displayCode map), `GET /v2/remark/types`. Refresh these on a schedule and remember they may be stale (§1.7).

**Writes:** create orders with `POST /v2/order/create` + `{"category":"Order"}` **always** — never rely on export if the order might need a billing group. Use the `messageId` header on every create and on Record Payment. **Never write notes through `POST /v2/order`** — always `POST /v2/order/notes`.

### 4.3 Gross profit reconciliation

Use `GET /v2/order/grossprofit/{orderNumber}` as the reconciliation target and **implement RFMS's exact formula** (§2.4) on the RAZZLE DAZZLE side. Reconcile field-by-field, not just on the percentage:

- `NetSales` vs your tax-exclusive revenue — this is where a TPT gross-up error surfaces first.
- `MaterialGrossCost` vs your material cost; `LaborCost` vs provider/installer cost; `FreightCost`; `Load` (**note: subtracted here but never posts to the GL**, so this GP will not tie to any GL-derived margin — do not try to make it).
- Never add `TaxCost` to a cost total.

`GET /v2/quote/grossprofit/{quoteNumber}` gives projected margin pre-conversion, but the response is schema-identical to the order version with **no flag distinguishing estimated from actual cost** — tag the source document type yourself. Also note the quote→order export produces a **new number**, so quote GP and order GP for the same job are keyed differently: **store the mapping at export time.**

**Do not compute tax in RAZZLE DAZZLE.** Carry tax-exclusive line totals and treat the TPT-inclusive price as presentation-layer. `POST /v2/calculatetaxes` is safe to call (stateless, no document, no side effects) and useful as a cross-check, but its result is advisory — RFMS recomputes tax its own way on the real order, and whether its engine can model AZ prime-contracting TPT at all is unresolved.

### 4.4 Payments

Use `POST /v2/payment` **only to mirror money that has already moved through a real processor.** Sequence: `GET /v2/payments` once per store to cache `receiptAccounts` and route by card prefix → post with `documentNumber`, `paymentAmount`, `approvalCode`, `receiptAccountId`, `paymentReference` → read back with `GET /v2/order/payments/{invoiceNumber}`.

Hard rules:
- **On `waiting`, retry only with the `messageId` header.** A body retry creates a second receipt, and there is no void endpoint anywhere.
- **Take the live balance from the POST's `Balance` or Get Order's `balanceDue`** — never by walking `beginningBalance`/`remainingBalance` in the payment list (§2.4).
- `POST` returns no receipt id; matching to `paymentNumber` is heuristic (amount + date + reference). Keep your own ledger keyed to what you sent.
- **Confirm the store's RFMS version against the v24.3 and v24.4 defects before enabling this write at all.**
- Prefer posting against **orders**, not quotes — quote-attached payments have no documented read-back path.
- **Do not automate `POST /v2/payables` in v1.** Uniqueness on `(supplierName, invoiceNumber)`, no read-back, no delete, unobservable partial success, and a Plus-tier path to creating GL-coded liabilities. If it ships later: one payable per call, log the pair before sending, never auto-retry, and restrict it to non-inventory overhead bills only.

### 4.5 Customer sync

**RAZZLE DAZZLE owns customers; RFMS mirrors.**

- **Search-before-create, always.** There is no dedupe on `POST /v2/customer/`.
- Read with `POST /v2/customers/find/advanced` (Plus) for the audit fields (`active`, `dateCreated`, `createdBy`, `dateUpdated`, `updatedBy`). It is the only viable basis for incremental customer sync — **but there is no modified-since filter**, only `dateCreatedFrom/To`. You can page by creation date; you cannot query by modification date. There is also **no documented paging on this endpoint**, which must be measured before designing a full sync.
- `GET /v2/customer/{id}` returns two divergent projections. **Read `detail`** if you need terms/credit limit/price level/internal notes; read `result` for the nested address. Never treat one as a mirror of the other.
- Internal notes come back as **styled HTML** — strip before diffing or every sync sees a phantom change. Notes require RFMS ≥ 20.99 and are **not writable** through `POST /v2/customer/` (only `POST /v2/opportunity` documents a `notes` field). **Do not design a round-trip reference id through customer internal notes.**
- **Prove update semantics (merge vs replace) on a throwaway record before any production write.** If it is a replace, omitting `phone2` or `preferredSalesperson2` blanks them.
- Cache `GET /v2/customers` for all writable enums and the store id↔displayCode map. Never hard-code.
- `customerId` is an **int** on customer endpoints and a **string** on CRM opportunities — cast at the join.

**CRM:** treat it as read-only. Backfill by iterating the seven stages via `GET /v2/opportunities/{stage}` (URL-encode `To Do`), then run **daily or better**: union `GET /v2/opportunities/lastmodified` with `GET /v2/opportunities`, dedupe ids, hydrate each with `GET /v2/opportunity/{id}`. Persist every event on receipt — the 7-day window is a hard data-loss boundary with no backfill. Map generic stage names to Floor Daddy's CRM labels in RAZZLE DAZZLE. Filter the literal string `"undefined"` out of `quotes[]`/`quoteApproval`. Handle `"Won -> Quote"` — Won is not terminal.

### 4.6 Scheduling write-back

The API supports it; the question is whether to use it. **Recommended: RAZZLE DAZZLE owns scheduling as the operational system of record, and writes back a narrow, well-defined slice to RFMS so office staff and RFMS Mobile stay in sync.**

**Read/mirror (Plus):** `POST /v2/jobs/find` with `recordStatus: "Both"` and a rolling, **overlapping** window as the change detector (no last-modified field exists, so overlap is mandatory); `GET /v2/order/jobs/:number` to hydrate an order's jobs with lines and notes; `GET /v2/job/:id` for full detail plus `jobLock`/`orderLock`; `POST /v2/jobs/crew` (never the GET form) for crew rosters. Cache `GET /v2/crews`, `/v2/statuses` **and** `/v2/jobstatusids` (joined on description), `/v2/timeslots`, `/v2/job/tracklist`.

**Write-back, in ascending risk:**
1. `POST /v2/job/status` (Plus) — **the highest-value Plus-tier write available.** Validate against `GET /v2/statuses` first; it takes the **string**.
2. `POST /v2/job/notes` (Plus) — **read-modify-write only.** It replaces despite its name. Fetch via `/v2/order/jobs/:number`, concatenate, post the whole string.
3. `POST /v2/job/create` (Enterprise) from an order + line ids, or `POST /v2/job` (Enterprise) for from-scratch jobs. **Guard `jobId` presence explicitly** (absent = create) and **`lineId` presence on every line edit** (absent = add). Implement the `jobChecks` override handshake with **PascalCase→camelCase key renaming**.
4. **Do not automate `DELETE /v2/job/:id`.** It is Plus-tier, irreversible, and can destroy work an Enterprise-only call created. Human confirmation plus a `GET /v2/job/:id` snapshot before every call.
5. **Do not automate `POST /v2/job/provider` or `POST /v2/order/provider` in v1.** They write to money, return no receipt, cannot be reversed, and can silently block job costing via the product-code balance rule.

**Accept these gaps as RAZZLE DAZZLE's responsibility:** crew provisioning (read-only in RFMS — a newly onboarded subcontractor must be keyed into RFMS by hand before any job can reference them, which directly affects the installer-onboarding workflow); capacity (no query endpoint — compute it from Find Jobs, and be aware `deductCapacity: true` consumes a shared resource you cannot read or reverse); job type (derived from `productCode`, not settable); `track1Description`/`track2Description` (write-only — keep your own copy).

**Crew references are by NAME string everywhere.** A crew rename in RFMS breaks every stored reference. Store `crews[].id` alongside the name purely as a rename-detection key.

### 4.7 Client architecture requirements (non-negotiable)

- A **tolerant response unwrapper**: handle bare bodies per an endpoint allow-list; if `result === "OK"`, read `detail`; prefer `detail` on Find Quotes/Orders; handle the `{accepted, messages[]}` duplicate shape and the `jobChecks` failure array.
- **Per-endpoint date/time codecs.** No shared parser.
- A **`waiting` handler with a per-endpoint resume strategy**: `messageId` header where documented (Create Order, Record Payment); for everything else, a documented, endpoint-specific reconciliation query (Advanced Order Search on a stamped `poNumber`/`jobNumber`) plus a hard "never blind-retry writes" rule.
- **Durable identifier persistence per record**: internal `id` **and** document number; `lineId` **and** `lineNumber`; numeric store id **and** store code; product `id` **and** `colorId`; every `lockId` you take, written durably *before* use.
- **A write allow-list.** Deliver, Cut, Reserve, Payment, Payables, Provider, DELETE Job, Export, and Generate Report with `allow*` flags should each require an explicit, named human action — not a background job.

---

## 5. Open questions for the live spike

Ordered by blocking severity. Each: what, why, how.

**Q1. Is the TPD Plus grant a ceiling or a floor?**
*Why:* decides whether RAZZLE DAZZLE can run on a TPD key at all, or must use Floor Daddy's own Enterprise credentials. Every Enterprise capability (document creation, inventory assignment, job create/update, provider posting, personnel/supplier lookup, unlock) hangs on this.
*How:* ask RFMS directly, and empirically call `GET /v2/personnel` on a TPD session against a known-Enterprise store. Unauthorized ⇒ ceiling.

**Q2. Confirm the Basic-auth session-token transport, and the expired-token failure mode.**
*Why:* nothing works until this is settled, and the failure mode (HTTP 401 vs `{"status":"failed"}`) determines the refresh trigger.
*How:* `session/begin`, then `GET /v2/customers` with `Basic(storeQueue, sessionToken)`. Then let a token idle to expiry and observe the failure. Measure the idle timeout and whether the sliding extension has a bounded absolute maximum.

**Q3. Does the notes replace-vs-append rule really key off the presence of non-note fields?**
*Why:* highest blast radius in the API — the same `privateNotes` value behaves differently depending on unrelated fields in the body, and a wrong guess silently destroys human-authored notes.
*How:* on a scratch quote and a scratch order, POST `{number, privateNotes}` then `{number, privateNotes, poNumber}` and diff. Repeat on an estimate.

**Q4. Capture a complete, untruncated `GET /v2/order/:number` response — specifically, is there a per-line material status field?**
*Why:* the entire material-readiness feature depends on being able to confirm a transition landed, compute the allocated/delivered roll-up, and reconcile. All three GET samples truncate at 2500 chars just past `productId`.
*How:* fetch a real order with several lines in mixed states and dump the full line object. Also determine what `includeAttachments=true` adds (metadata, URLs, or inline base64) and its payload cost.

**Q5. Preconditions and failure modes for Stage and Deliver.**
*Why:* Deliver posts journal entries under ERRM and is Plus-tier, irreversible, and its response string says "Cut Lines Processed." Guessing is unacceptable.
*How:* on a sandbox order, call Deliver on an unassigned line, on a Cut line, and on a Staged line; call Stage on a non-ERRM order. Record each outcome. Also confirm whether a timed-out Deliver may still have posted, and what (if any) idempotency protects a retry.

**Q6. Does `POST /v2/job` treat `lines[]` as a merge or a full replace on update?**
*Why:* if it is a replace, any partial job update silently destroys every line not sent.
*How:* destructively, on a sandbox job with three lines, send an update containing one line and re-read.

**Q7. Is the `jobChecks` override actually accepted?**
*Why:* the entire Schedule Pro write path depends on it, and in the published sample a request sending `"override": true` still returns `status: "failed"` with `"Override": null`.
*How:* trigger `Track1NoSelection` by omitting `track1Description`, then retry with the camelCase override array. Also probe for a `restrictLevel` stricter than `"Warning"` and whether it can be overridden at all.

**Q8. Does an API customer update propagate into existing Quotes and BidPro estimates?**
*Why:* Core prompts a human to push customer edits into those documents. The API is headless — if it silently answers yes, an innocuous address correction rewrites historical priced documents.
*How:* create a customer, create a quote from it, change the customer's address via `POST /v2/customer/`, re-read the quote.

**Q9. Is `POST /v2/customer/` an update a merge or a full replace, and does create return the new `customerId`?**
*Why:* both saved 200 examples are empty bodies. Without a returned id every create needs a racy follow-up search; without merge semantics no partial update is safe.
*How:* create with a full body, inspect the response, then update with a minimal body and re-read.

**Q10. Does Advanced Order Search paginate or cap?**
*Why:* the whole order sync design rests on it, and it documents no page parameter, no limit, no total, and no sort order.
*How:* run a deliberately wide `stores` + `updatedDateFrom` query and count. Compare against a narrower query whose true count you know. Determine whether results truncate, and in what order.

**Q11. What does `GET /v2/orders/jobcosted` return?**
*Why:* it is the best-fit completed-jobs feed and has no published response, no parameters, no tier, no pagination.
*How:* call it once and dump. Establish the envelope, whether it paginates, and its tier.

**Q12. Does the `waiting` → `messageId` resume path exist outside Create Order and Record Payment?**
*Why:* determines whether one generic idempotent client is buildable or every write needs bespoke handling. Most acute for **Export Quote to Order**, which is non-idempotent by design.
*How:* ask RFMS. Empirically, induce a `waiting` (if the store can be taken offline briefly on a sandbox) on Create Quote and Update Order and try the header.

**Q13. Confirm the lock asymmetry and `lockId` mechanics.**
*Why:* if `GET /v2/unlock/:id` really is Enterprise while `?locked=true` is Plus, a crashed Plus/TPD integration leaves documents locked with only a human remedy — and locked orders are the #1 documented cause of card payments failing to post.
*How:* take a lock, inspect where the lockId appears in the payload, attempt to pass it on `POST /v2/order` (it appears in no request sample), then unlock. Test unlock with an unknown id, an already-released lock, and a lock held elsewhere. Ask whether locks auto-expire and whether outstanding locks can be enumerated.

**Q14. Is ERRM on, and is Floor Daddy on Enterprise?**
*Why:* ERRM decides whether Cut or Deliver is the inventory-consuming, GL-posting event; tier decides whether inventory can be assigned at all.
*How:* ask Floor Daddy's controller and confirm in ROS.

**Q15. Does `useLineTax: true` actually exclude a line from sales tax?**
*Why:* the published sample says no — `SalesTax` is exactly 10% of all three lines including the two flagged, and `UseTax` is 0.
*How:* post the sample body verbatim, then post it with the flags removed, and compare.

**Q16. Are the gross-profit costs estimated or actual, and are `LaborCost`/`MiscExtraCost`/`ReferralTotal` really subtracted?**
*Why:* decides whether the GP endpoint is usable for real margin reporting or only pipeline forecasting; the three buckets are 0.0 in both samples so their inclusion is inferred.
*How:* call `/order/grossprofit` on a job-costed order with service lines and a referral fee, and on an uncosted order, and check the arithmetic and whether costs change after job costing.

**Q17. What are the valid `paymentMethod` values, and what does `paymentFee` do?**
*Why:* `"creditcard"` is the only value seen anywhere; `GET /v2/payments` — whose stated job is to return "master lists used to submit payments" — returns no method list. `paymentFee` is accepted and echoed by nothing.
*How:* ask RFMS for the enum. For `paymentFee`, post a payment with a non-zero fee and compare the returned `Balance` against the amount.

**Q18. Does `POST /v2/attachment` return the new attachment id, and what are the file limits?**
*Why:* without an id, every upload needs a follow-up list, and a timeout retry silently duplicates. No size limit, MIME field, or extension whitelist is documented anywhere.
*How:* upload and dump the response. Then test a multi-MB PDF, a 12MP JPEG, a PNG, a HEIC, and a file whose `fileExtension` contradicts its bytes.

**Q19. Timezone on every timestamp.**
*Why:* `dateCreated`, `lastModified`, `eventTime`, `paymentDate`, job dates all carry no offset, while `sessionExpires` explicitly carries `+00:00` — which suggests the others are *not* UTC. Getting this wrong corrupts every incremental-sync watermark.
*How:* create a record at a known wall-clock instant and compare the returned timestamp against store-local, UTC, and Azure-region local.

**Q20. `resultPageNumber` or `pageResultNumber`?**
*Why:* the parameter table and the request sample disagree, across Find Quotes, Find Orders and Find Estimate. A silently-ignored page parameter means re-reading page 1 forever.
*How:* send each name against a >10-result search and compare the returned sets.

**Q21. Does `POST /v2/order` work on a job-costed order?**
*Why:* Add Notes goes out of its way to say notes work post-job-cost, which strongly implies header updates do not. Determines whether RAZZLE DAZZLE can correct anything after completion.
*How:* attempt a header update on a job-costed sandbox order; record whether it rejects, silently ignores, or succeeds.

**Q22. What tier is `GET /v2/cacherefresh`, what does it return, and what call frequency is safe?**
*Why:* no tier is stated anywhere, it may respond `waiting`, and there is a DoS-by-integration precedent.
*How:* **establish the safe frequency with RFMS before calling it even once in production.** Then call once and record the response, duration, and whether concurrent calls are rejected or queued. Separately, measure the settings-cache staleness window: create a terms block / product code / job status in Core and time how long until it appears via the API.

**Q23. How do you obtain the System Reference Number that `POST /v2/inventory/location` requires?**
*Why:* nothing in the API returns an SRN; `inventoryLink.inventoryId` is 0 in its own sample. As documented, bin management is unimplementable.
*How:* ask RFMS whether `inventoryId` is the SRN; try a known `inventoryId` from a Reserve response against the endpoint.

**Q24. Multi-line partial-failure semantics.**
*Why:* determines whether batched inventory and job writes are retry-safe. If line 2 of 3 fails, is the top-level `status` `failed` or `success` with error text embedded in a free-text string? Is the batch atomic?
*How:* send a Reserve `inventoryList` with one deliberately invalid line, and a Stage `lines[]` with one line in the wrong state.

**Q25. `GET /v2/stores/:id` — name or id, and what format?**
*Why:* multi-store scoping depends on it, and at Plus you cannot list personnel to find out.
*How:* try `"CARLOS BANUELOS"` (matching `salesperson1`), `"BANUELOS, CARLOS"`, and the integer id from Get Personnel. Test an unknown name (empty array or error?) and URL-encoding of the space.

**Q26. `termsToShow` resolution across stores.**
*Why:* titles are not unique across stores and Generate Report takes no store parameter. A title that does not exist for that document's store may be silently ignored, producing a document with **no terms** that still returns success.
*How:* generate with a valid title, an invalid title, and a title valid only for another store — then **open each rendered URL** and inspect. Also determine whether repeat calls return a new token, whether a URL can be revoked or expires, and whether `/v2/estimate/report/generate` exists.

**Q27. Batch and format semantics on `POST /v2/payables`.**
*Why:* the response names one payable regardless of array size, dates use M/D/YY against ISO elsewhere, `discountRate: 0.1` is unit-ambiguous, `linkedDocumentNumber` has no documented RFMS field, and detailLines-must-sum is inferred from one sample.
*How:* against a sandbox company only — post a two-item array with one deliberately invalid; test ISO vs M/D/YY dates; test a non-zero discount rate and read the resulting bill in Core.

**Q28. `POST /v2/opportunity` with `useCRM: true` — what comes back in `result`?**
*Why:* the only sample shows a quote number, while CRM ids are a 10-char alphanumeric. If the CRM path also returns a document number, there is **no way to obtain the new opportunity's id at creation time** — you would have to poll `lastmodified` for the matching `OPPORTUNITY CREATED` event and correlate by name and timestamp.
*How:* create one with `useCRM: true` and inspect. Also settle which address field names are authoritative (`customerAddress`/`shipToAddress` vs `shipTo` vs `soldTo`) and whether `customerId` casing is tolerated.

**Q29. Is `GET /v2/opportunities/{stage}` genuinely unbounded by the seven-day window, and is there a row cap?**
*Why:* if yes, iterating the seven stages is the **only** full-backfill path for CRM and the entire initial-load design depends on it.
*How:* compare the union of the seven stage calls against a known total from the CRM app.

**Q30. Enumerations with no lookup endpoint.**
*Why:* each blocks a specific feature.
*How:* ask RFMS for: valid `lineStatus` values on Update Quote/Order (and how they relate to the separate None↔GenPO endpoint — this determines whether inventory can be reserved via the order-update path at all); `lineGroupId`; the `priceLevel` string format (`"Price1"`–`"Price12"`; is SRP addressable?); the `status` strings in Find results; `documentType` 0 vs 1; `category` values beyond `"Order"` and `"OriginalInvoice"`; the full PO `status` enumeration (O=Open / S=Satisfied?); the complete `eventName` set on `/v2/opportunities/lastmodified`; and the chart-of-accounts codes for Record Payables (no endpoint lists them at any tier).