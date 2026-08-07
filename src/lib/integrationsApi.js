import { supabase } from '@/lib/supabaseClient';

// All admin-gated on the server (is_org_admin). Secrets are write-only from here —
// they go into Supabase Vault and never come back to the browser.
export async function getIntegrations() {
  const { data, error } = await supabase.rpc('admin_get_integrations');
  if (error) throw error;
  return data || [];
}

export async function setSecret(name, value) {
  const { error } = await supabase.rpc('admin_set_secret', { p_name: name, p_value: value });
  if (error) throw error;
}

export async function clearSecret(name) {
  const { error } = await supabase.rpc('admin_clear_secret', { p_name: name });
  if (error) throw error;
}

export async function setIntegration(key, isEnabled, config) {
  const { error } = await supabase.rpc('admin_set_integration', {
    p_key: key,
    p_is_enabled: isEnabled,
    p_config: config,
  });
  if (error) throw error;
}

export async function testIntegration(key) {
  const { data, error } = await supabase.functions.invoke('testIntegration', {
    body: { integration: key },
  });
  if (error) throw error;
  return data;
}
