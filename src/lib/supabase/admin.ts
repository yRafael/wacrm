import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy, shared service-role client.
//
// Every module that needs to bypass RLS (flows engine, automations,
// AI auto-reply, webhooks, Fire Control, public API key lookup)
// should import from here instead of creating its own instance.
// The singleton avoids leaking a new client per cold start.
let _adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}
