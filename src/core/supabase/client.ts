import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getRuntimeCloudConfig, type EvaluatedCloudConfig } from './config';

let cachedClient: SupabaseClient | null = null;
let cachedSignature = '';

/**
 * Returns a real @supabase/supabase-js client ONLY when valid public env vars
 * (VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY) are configured.
 * Returns null otherwise — NEVER creates a mock backend.
 */
export function getSupabaseClient(
  overrideConfig?: EvaluatedCloudConfig
): SupabaseClient | null {
  const config = overrideConfig ?? getRuntimeCloudConfig();
  if (!config.isReady || !config.supabaseUrl || !config.publishableKey) {
    return null;
  }

  const signature = `${config.supabaseUrl}|${config.publishableKey}`;
  if (cachedClient && cachedSignature === signature) {
    return cachedClient;
  }

  cachedClient = createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'teacheros-supabase-auth',
    },
  });
  cachedSignature = signature;
  return cachedClient;
}

export function resetSupabaseClientCache(): void {
  cachedClient = null;
  cachedSignature = '';
}
