import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS — server-side only, used by the
 * token-validated customer routes (worksheet fill, signing) and by
 * background jobs. Never import from client components.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
