# RAZZLE DAZZLE — Supabase + Vercel

Migration proof-of-concept: the base44 "RAZZLE DAZZLE" app running on a **Supabase**
Postgres backend, deployable to **Vercel**. The React frontend is unchanged — only the
data layer was swapped.

## How the migration works

The original app talked to base44 through one small SDK surface
(`base44.entities.*`, `base44.auth.*`, `base44.functions.invoke`,
`base44.integrations.Core.*`). That surface is re-implemented on top of
`supabase-js` in a single compatibility shim, so the ~66k-line frontend runs as-is.

| Concern | base44 | This project |
| --- | --- | --- |
| Database + CRUD | Managed entities | Postgres (44 tables) + PostgREST via `supabase-js` |
| The SDK (`base44.*`) | base44 SDK | `src/api/base44Client.js` shim |
| Auth | Managed | Supabase Auth (POC uses a seeded demo user) |
| Serverless functions | 96 Deno functions | Supabase Edge Functions (also Deno) — port incrementally |
| Integrations (LLM/email/SMS/upload) | Managed | Provider SDKs (stubbed in the POC) |

### Key files
- `src/api/base44Client.js` — the base44→Supabase shim (the whole migration seam)
- `src/lib/supabaseClient.js` — the `supabase-js` client
- `src/lib/AuthContext.jsx` — Supabase-aware auth context (same interface as before)
- `supabase/migrations/0001_create_schema.sql` — all 44 tables, generated from the entity schemas
- `supabase/seed.sql` — demo dataset

## Run locally

```bash
npm install
npm run dev
```

Env vars are optional — public Supabase defaults are baked in (`src/lib/supabaseClient.js`).
To point at a different project, create `.env` from `.env.example`.

## Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

`vercel.json` sets the Vite framework preset and an SPA rewrite so deep links
(`/Customers`, `/Dashboard`, …) resolve. No env vars are required for the demo
(public keys are baked in); for a real project set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` in the Vercel dashboard instead.

## What is POC-grade (revisit for production)
- **RLS** is permissive (anon+authenticated full access) so the demo works without login.
  Scope policies to `auth.uid()` / roles before real use.
- **Auth** resolves to a seeded demo admin. Wire real Supabase Auth for multi-user.
- **The 96 serverless functions** and **integrations** (Twilio, RFMS, GHL, Stripe,
  AssemblyAI, Google, LLM/email) are stubbed. Port each base44 Deno function to a
  Supabase Edge Function and flip `VITE_EDGE_FUNCTIONS_ENABLED=true`.
- **Data migration**: this project ships demo data. Real cutover = export base44
  records and load them (table names/columns already match).
