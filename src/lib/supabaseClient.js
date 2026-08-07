import { createClient } from '@supabase/supabase-js';

// Public project defaults so a plain `vercel`/`npm run build` deploy works with
// zero env configuration. These are the *publishable* (anon) key and project URL
// — safe to ship in the browser bundle; access is governed by RLS. Override via
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY for a different project.
const DEFAULT_URL = 'https://zoyvqznftltlitspgdxn.supabase.co';
const DEFAULT_ANON_KEY = 'sb_publishable_qpmDEE__KETNjRD1rkEjrw_CpBj7iWz';

const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
