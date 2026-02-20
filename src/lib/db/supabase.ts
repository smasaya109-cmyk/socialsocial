import { createClient } from "@supabase/supabase-js";
import { assertRequiredEnv, logMissingEnv } from "@/lib/env/required-env";

const ADMIN_REQUIRED_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const USER_REQUIRED_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

export function getSupabaseAdminClient() {
  logMissingEnv("db.supabase.admin", ADMIN_REQUIRED_ENV);
  assertRequiredEnv("db.supabase.admin", ADMIN_REQUIRED_ENV);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

  return createClient(url, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function getSupabaseUserClient(accessToken: string) {
  logMissingEnv("db.supabase.user", USER_REQUIRED_ENV);
  assertRequiredEnv("db.supabase.user", USER_REQUIRED_ENV);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

  return createClient(url, anon, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
