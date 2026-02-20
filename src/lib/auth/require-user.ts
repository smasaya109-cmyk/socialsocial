import { createClient } from "@supabase/supabase-js";

export class AuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getBearerToken(request: Request): string {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    throw new AuthError("Unauthorized", 401);
  }
  return authHeader.slice(7);
}

export async function requireUser(request: Request): Promise<{ userId: string; accessToken: string }> {
  const accessToken = getBearerToken(request);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase env vars are missing");
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new AuthError("Unauthorized", 401);
  }

  return { userId: data.user.id, accessToken };
}
