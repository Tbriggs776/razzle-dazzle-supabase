// Ported from base44 getAppUrl. Returns the app's public URL.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('APP_URL') || 'https://razzle-dazzle-supabase.vercel.app';
  return new Response(JSON.stringify({ url }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
