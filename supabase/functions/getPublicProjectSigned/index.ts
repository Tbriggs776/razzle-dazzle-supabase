// Anon-safe signer for the customer project tracker (CustomerProjectView renders outside the
// auth guard). Calls get_public_project (a curated SECURITY DEFINER projection) with the service
// role, then replaces the 'uploads' storage paths in sale.contract_file_url and each manager's
// profile_photo with short-lived signed URLs — so a logged-out customer can view their own
// contract + manager photos without the 'uploads' bucket being public. Anon cannot createSignedUrl
// itself (no storage grant), which is exactly why this runs server-side.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PUB = '/object/public/uploads/';
const SIG = '/object/sign/uploads/';

async function sign(s: any, value: unknown): Promise<string | null> {
  if (!value || typeof value !== 'string') return (value as string) ?? null;
  let path = value;
  if (/^https?:\/\//i.test(value)) {
    const p = value.indexOf(PUB);
    const g = value.indexOf(SIG);
    if (p !== -1) path = decodeURIComponent(value.slice(p + PUB.length).split('?')[0]);
    else if (g !== -1) path = decodeURIComponent(value.slice(g + SIG.length).split('?')[0]);
    else return value; // external URL (public-assets, etc.) — leave as-is
  } else {
    path = value.replace(/^\/+/, '');
  }
  const { data } = await s.storage.from('uploads').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { id } = await req.json();
    if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: cors });
    const s = svc();
    const { data, error } = await s.rpc('get_public_project', { p_id: id });
    if (error) return Response.json({ error: error.message }, { status: 500, headers: cors });
    if (!data) return Response.json(null, { headers: cors });

    if (data.sale?.contract_file_url) data.sale.contract_file_url = await sign(s, data.sale.contract_file_url);
    if (data.projectManager?.profile_photo) data.projectManager.profile_photo = await sign(s, data.projectManager.profile_photo);
    if (data.installationManager?.profile_photo) data.installationManager.profile_photo = await sign(s, data.installationManager.profile_photo);

    return Response.json(data, { headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
