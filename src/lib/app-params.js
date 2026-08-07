/**
 * Legacy app-params shim. The base44 build injected app_id / server_url / token
 * here. On Supabase we don't need them, but a couple of modules still import
 * `appParams`, so we export a harmless object.
 */
export const appParams = {
  appId: 'razzle-dazzle',
  serverUrl: import.meta.env.VITE_SUPABASE_URL || '',
  token: null,
  fromUrl: typeof window !== 'undefined' ? window.location.href : '',
  functionsVersion: 'prod',
};
