import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import type { Database } from "./types";

let adminClient: SupabaseClient<Database> | null = null;

/**
 * Returns a typed Supabase client initialized with the SERVICE_ROLE_KEY.
 * Strictly used server-side; bypassing client RLS via service role.
 */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (adminClient) {
    return adminClient;
  }

  const env = getEnv();

  adminClient = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  return adminClient;
}
