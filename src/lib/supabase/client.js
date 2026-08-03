import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let browserClient;

export const supabaseEnvironment = {
  configured: Boolean(supabaseUrl && supabasePublishableKey),
  missing: [
    !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !supabasePublishableKey &&
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (또는 NEXT_PUBLIC_SUPABASE_ANON_KEY)",
  ].filter(Boolean),
};

export function getSupabaseBrowserClient() {
  if (!supabaseEnvironment.configured) return null;

  if (!browserClient) {
    browserClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}
