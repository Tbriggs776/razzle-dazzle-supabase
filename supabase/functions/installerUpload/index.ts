// Token-scoped document upload for the pre-login installer onboarding apply page. The applicant
// has no account; the unguessable application public_token is the capability. Files (COI, W-9,
// ROC license, bond, voided check) go to the PRIVATE installer-onboarding bucket (service-role
// only; staff view via signed URLs), and the matching *_file column is stamped with the path.
// Public endpoint, verify_jwt off — authorized entirely by a valid, still-editable token.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// kind -> the column it fills
const KIND_COL: Record<string, string> = {
  roc_license: 'roc_license_file',
  bond: 'bond_file',
  coi: 'coi_file',
  w9: 'w9_file',
  voided_check: 'voided_check_file',
};
const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp'];
const MAX_BYTES = 25 * 1024 * 1024;

const safe = (s: string) => (s || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const form = await req.formData();
    const token = String(form.get('token') || '');
    const kind = String(form.get('kind') || '');
    const file = form.get('file');
    const col = KIND_COL[kind];
    if (!token || !col) return Response.json({ error: 'Missing or invalid token/kind' }, { status: 400, headers: cors });
    if (!(file instanceof File)) return Response.json({ error: 'Missing file' }, { status: 400, headers: cors });
    if (file.size > MAX_BYTES) return Response.json({ error: 'File too large (max 25 MB)' }, { status: 400, headers: cors });
    if (file.type && !OK_TYPES.includes(file.type)) return Response.json({ error: `Unsupported file type ${file.type}` }, { status: 400, headers: cors });

    const s = svc();
    // Token must map to an application that is still applicant-editable.
    const { data: app } = await s.from('installer_application').select('id, status')
      .eq('public_token', token).maybeSingle();
    if (!app || !['draft', 'submitted'].includes(app.status)) {
      return Response.json({ error: 'Invalid or closed application' }, { status: 403, headers: cors });
    }

    const path = `${app.id}/${kind}-${safe(file.name)}`;
    const { error: upErr } = await s.storage.from('installer-onboarding')
      .upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
    if (upErr) return Response.json({ error: upErr.message }, { status: 502, headers: cors });

    const { error: updErr } = await s.from('installer_application')
      .update({ [col]: path, updated_date: new Date().toISOString() }).eq('id', app.id);
    if (updErr) return Response.json({ error: updErr.message }, { status: 502, headers: cors });

    return Response.json({ ok: true, kind, path }, { headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
