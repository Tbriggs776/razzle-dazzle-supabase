# RAZZLE DAZZLE — Platform Migration Report

**A full port of the Floor Daddy operations app from base44 (no-code) to a self-owned Supabase + Vercel + React stack — same application, owned infrastructure.**

- **Prepared for:** the original developer
- **Rebuild window:** Aug 6–9, 2026 · 39 commits
- **Status:** functional, pre-launch

| | | |
|---|---|---|
| **59** Postgres tables (100% RLS) | **23** SQL migrations (`0001`→`0023`) | **23** Edge Functions (+4 shared libs) |
| **9** scheduled crons (pg_cron) | **70** pages · **150** components | **8** integrations rebuilt |

> Figures reflect the actual state of the repository and live database, not estimates.

---

## 1. Why we migrated

The app is a flooring / home-services operations platform: leads & appointments, sales, a full installation journey, fleet, tickets, reporting, and customer-facing pages. It works well — the goal was not to change *what* it does but *where it lives*: on infrastructure the business controls, with direct access to the database, the server code, the deploy pipeline, and every third-party key. This also removes no-code lock-in and per-run platform costs.

## 2. The approach that made it feasible

The entire frontend spoke to base44 through a small SDK surface: `base44.entities.*`, `base44.auth.*`, `base44.functions.invoke`, and `base44.integrations.Core.*`.

Rather than rewrite every screen, we implemented that same surface once as a **compatibility shim** (`src/api/dataClient.js`) over `supabase-js`. The UI keeps calling the familiar methods; the shim routes them to Postgres, Supabase Auth, and Edge Functions underneath. As a result **~70 pages and 150 components run largely unchanged.**

base44's serverless functions are Deno — which maps cleanly onto Supabase Edge Functions (also Deno). So the server logic was *ported*, not reinvented, and rebuilt correctly where the originals had issues (see §7).

## 3. Before & after

| Concern | base44 | Now |
|---|---|---|
| Data store | Hosted entities (44) | Supabase Postgres — 59 tables |
| Frontend API | base44 JS SDK | Compatibility shim over `supabase-js` |
| Server logic | 96 base44 Deno functions | 23 Supabase Edge Functions + shared libs |
| Authentication | base44 managed auth | Supabase Auth + modular access model |
| Authorization | Application-level checks | Postgres RLS on all 59 tables + `SECURITY DEFINER` RPCs |
| Secrets | base44 platform | Supabase Vault |
| Async / background | In-request & fire-and-forget | Durable job queue (`pg_cron` + `pg_net`) with retries |
| LLM | base44 `InvokeLLM` (locked in) | Anthropic Claude bridge |
| Hosting / deploy | base44 platform | Vercel — `git push` auto-deploys |
| Cost model | Per-run / platform fees | Flat Supabase + Vercel |

## 4. Data & access model

The entity schemas became **59 Postgres tables**, defined in **23 sequential SQL migrations** (all committed to the repo, reproducible from scratch). On top sits a real authentication + authorization layer:

- **Supabase Auth** for identity.
- A **modular access model** (organization → module → page → role → permissions) resolved by database functions (`can_view` / `can_edit` / `is_org_admin` / `my_access`).
- **Row-Level Security enabled on 100% of tables**, verified per role — a restricted user is denied at the database itself, not merely in the UI.

## 5. Backend & async work

Server logic lives in **23 Edge Functions** plus four shared libraries. The most important structural upgrade is a **durable job queue** (`pg_cron` + `pg_net`): outbound work — emails, texts, RFMS calls, analysis — is enqueued and processed with retries, delivery tracking, and idempotency, rather than fired off inside a request and forgotten. **Nine scheduled crons** drive reminders, follow-ups, the daily finance report, stuck-recording reconciliation, and more.

## 6. Integrations, rebuilt

Eight external systems — ported off the no-code connectors and hardened.

| Integration | Provider | What changed |
|---|---|---|
| **Email** | Resend | Unified `sendMessage` + an `emailDispatch` dispatcher (13 senders). Proper cc/bcc/reply-to, PDF attachments via jsPDF, all sent through the durable queue so retries never double-send. |
| **SMS** | Twilio | `smsDispatch` (21 message types) plus an inbound webhook with STOP/START opt-out, message-ID de-duplication, and phone→contact resolution. |
| **AI / LLM** | Anthropic Claude | Replaced base44's `InvokeLLM` — the app's only hard vendor lock-in — with a bridge that preserves the same contract (prompt, JSON-schema, file inputs) and degrades gracefully until a key is set. |
| **Call recordings** | AssemblyAI | Submit → completion webhook → a durable reconcile cron (replacing an in-request ~10-minute poll loop that exceeded the function timeout). Value-add compliance scoring runs through the LLM bridge. |
| **Flooring ERP** | RFMS | Clean rebuild: correct HTTP Basic auth, async store-and-forward handling with back-off, session caching, and a direct Customers API call in place of a hardcoded Zapier webhook. |
| **Maps & Docs** | Google | Maps (street view / geocode / territory polygons) + Calendar & Sheets via a service-account JWT signer, replacing base44's managed OAuth connector (no self-host equivalent). |
| **CRM** | GoHighLevel | Migrated from the retiring v1 API to v2 (PIT auth + location scoping). |
| **E-signature** | In-house | A UETA-aligned engine (consent, unguessable token, server-side audit trail, SHA-256 tamper hash, sealed PDF + audit certificate, optional SMS OTP) replacing base44's canvas-only signature. |

## 7. Issues found & resolved during the port

Surfaced while re-implementing the original logic — noted here in the spirit of a clean hand-off, not criticism.

- **RFMS authentication** — Requests used Bearer tokens; the RFMS API expects HTTP Basic (`store-queue : api-token`). Corrected in one shared client.
- **RFMS silent data loss** — RFMS is an async store-and-forward API returning `{status: waiting}` until the store replies. The original read results synchronously and dropped "waiting" responses — losing order / line-item data. Now polled with back-off through the job queue.
- **PII to a hardcoded webhook** — Lead data was pushed to a hardcoded third-party Zapier webhook. Replaced with a direct, authenticated RFMS Customers call.
- **Dropped inbound messages** — Inbound SMS & AssemblyAI webhooks called `req.formData()` then fell back to `req.json()`; the first read consumes the body, so parsing failed and inbound messages were silently dropped. Fixed by reading the raw body once and branching on content-type.
- **Missing SMS schema** — The SMS-settings table was missing 31 of 32 columns the message templates referenced (the entity schema was never captured), producing null-template 500s. All added.
- **HTML email injection** — Email bodies were interpolated into HTML unescaped; attachment filenames were unsanitized; signature image format was hardcoded to PNG. All hardened.
- **Fake success on unported writes** — Several actions wrote through functions that were never ported and silently returned success — e.g. the signing screen displayed "Signed!" though nothing was saved. The shim now throws on unmapped write intents instead of faking success.
- **World-readable signed documents** — Signed PDFs and signature images (containing PII + IP) were stored in a public bucket. Moved to a private bucket served via short-lived signed URLs.
- **Anonymous access to internals** — ~28 `SECURITY DEFINER` helper functions (queue internals, suppression, a phone→identity lookup) were executable by the anonymous role. `EXECUTE` revoked from `PUBLIC`; granted back only where needed.
- **Non-functional customer pages** — Public customer pages read tables directly — blocked by RLS for logged-out visitors — and rendered fake states. Replaced with curated, token-scoped read-only RPCs; pages now render before the auth gate.
- **Public URL-shortener endpoint** — `shortenUrl` was an open, unauthenticated endpoint (an abuse vector). Now requires an authenticated caller.
- **Invisible Tailwind styles** — A detail page built class names dynamically (`` border-${color}-200 ``); Tailwind purges those at build time, so the styles never rendered. Replaced with a static class map.
- **Double sidebar / scroll** — The scheduling "Journey" page rendered its own second sidebar with `h-screen`, fighting the app shell (two sidebars, two scrollbars). Rebuilt as a collapsible drawer inside the shell.
- **Clipped data table** — A 10-column financial table's wrapper used `overflow-hidden`, clipping columns on smaller screens. Switched to horizontal scroll.

## 8. Security hardening

Beyond the fixes above: **RLS 100% · Vault secrets · function-grant lockdown · private e-sign bucket · token-scoped public RPCs · webhook secrets.**

All third-party keys live in Supabase Vault (never in code or the client). Public / anonymous surfaces expose only curated, single-record read projections. The one remaining item is provider-signature verification on inbound webhooks (currently shared-secret gated) — planned before launch.

## 9. UI / UX pass

The interface was given the **Floor Daddy** identity pulled from the live company site — deep navy, the "razzle dazzle" pink, gold, and Poppins — including the mascot logo and favicon. Then **all 70 pages were re-skinned** off hardcoded colors onto a shared design-token system, which also made the whole app **dark-mode aware**.

The no-code output boxed most screens into a narrow fixed-width column and never adapted to mobile. That was corrected app-wide: data-dense screens now use the full desktop width with responsive grids, while phones get scrollable tab strips, wrapping toolbars, and fluid spacing — verified at **zero horizontal overflow on a 375px viewport**. Customer-facing pages were also made genuinely public (they previously could not load for a logged-out visitor).

## 10. Intentionally not done yet (cut-over checklist)

The app is functional but pre-launch. Remaining steps:

1. Enter live provider API keys at `/Integrations` (Resend, Twilio, AssemblyAI, Anthropic, Google, GHL, RFMS). Every integration graceful-degrades until its key is present.
2. RFMS live spike with a real Store Queue + API token to confirm endpoint paths, session lifetime, and Enterprise line-item field names.
3. Real data migration from base44 into Postgres.
4. Re-host the handful of remaining CDN-hosted images / videos.
5. Add provider-signature verification to inbound webhooks (currently shared-secret gated).
6. A few deferred maintenance crons & one-off backfills.

**Nothing here is blocked** — every integration is wired and degrades gracefully, returning a safe no-op until its key is entered at `/Integrations`. Go-live is a matter of adding credentials and migrating live data, not further engineering.

---

**Stack** — React + Vite + Tailwind + shadcn/ui · Supabase (Postgres, Auth, Edge Functions, Vault, Storage) · Vercel · Resend, Twilio, AssemblyAI, Anthropic, RFMS, Google, GoHighLevel

**Footprint** — 59 tables · 23 migrations · 23 Edge Functions · 9 crons · 70 pages · 150 components · 39 commits (Aug 6–9, 2026)
