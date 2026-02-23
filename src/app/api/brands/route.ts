import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createClient, type PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";
console.info("[boot] /api/brands module loaded");

const schema = z.object({
  name: z.string().min(1).max(120),
  plan: z.enum(["free", "solo", "creator", "studio"]).default("free")
});

type PgErrorLike = Partial<PostgrestError> & {
  code?: string;
  message?: string;
  hint?: string;
  details?: string;
};

function redactLogText(value: string | undefined): string {
  if (!value) return "";
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9+/_-]{20,}\.[A-Za-z0-9+/_-]{10,}\.[A-Za-z0-9+/_-]{10,}/g, "[redacted-jwt]");
}

function safeDetails(value: string | undefined): string | null {
  const redacted = redactLogText(value);
  if (!redacted) return null;
  return redacted.slice(0, 300);
}

function maskId(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length < 8) return "[redacted]";
  return `${value.slice(0, 6)}...[redacted]`;
}

function serializeUnknown(error: unknown): string {
  try {
    if (error instanceof Error) {
      return JSON.stringify({
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function asPgErrorLike(error: unknown): PgErrorLike | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as PgErrorLike;
  if (!candidate.code && !candidate.message && !candidate.details && !candidate.hint) {
    return undefined;
  }
  return candidate;
}

function toSafeHint(error: PgErrorLike | undefined): string {
  if (!error) return "unexpected_error";
  if (error.code === "42501") return "permission_denied";
  if (error.code === "23505") return "duplicate_key";
  if (error.code === "42P01") return "relation_missing";
  return "database_error";
}

function logServerError(scope: string, requestId: string, error: unknown, pgError?: PgErrorLike) {
  const err = error instanceof Error ? error : new Error(serializeUnknown(error));
  console.error(`[${scope}] failure`, {
    requestId,
    name: err.name,
    message: redactLogText(err.message),
    stack: redactLogText(err.stack),
    pgCode: pgError?.code ?? null,
    pgMessage: redactLogText(pgError?.message),
    pgDetails: redactLogText(pgError?.details),
    pgHint: redactLogText(pgError?.hint)
  });
}

function logCatchError(route: string, requestId: string, error: unknown) {
  const err = error as { name?: string; message?: string; stack?: string } | undefined;
  console.error("[err]", {
    requestId,
    route,
    name: redactLogText(err?.name),
    message: redactLogText(err?.message),
    stack: redactLogText(err?.stack)
  });
}

function jsonWithRequestId(requestId: string, body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("x-request-id", requestId);
  return response;
}

function getUserContextClient(accessToken: string) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      `missing_supabase_env:${JSON.stringify({
        missing: [
          !url ? "SUPABASE_URL" : null,
          !anonKey ? "SUPABASE_ANON_KEY" : null
        ].filter(Boolean)
      })}`
    );
  }

  const authFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers ?? {});
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("apikey", anonKey);
    return fetch(input, {
      ...init,
      headers
    });
  };

  return createClient(url, anonKey, {
    global: {
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      fetch: authFetch
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function internalErrorResponse(requestId: string, pgError?: PgErrorLike, status = 500) {
  return jsonWithRequestId(
    requestId,
    {
      error: "Internal",
      requestId,
      code: pgError?.code ?? null,
      hint: redactLogText(pgError?.hint) || toSafeHint(pgError),
      details: safeDetails(pgError?.details)
    },
    status
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.info("[req]", { requestId, route: "/api/brands", method: request.method });
  const missing: string[] = [];
  if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    missing.push("SUPABASE_URL");
  }
  if (!process.env.SUPABASE_ANON_KEY && !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    missing.push("SUPABASE_ANON_KEY");
  }
  if (missing.length > 0) {
    console.error("[api.brands.env] missing required env", { requestId, missing });
    return jsonWithRequestId(requestId, { error: "Service misconfigured", requestId, missing }, 503);
  }

  try {
    const { userId, accessToken } = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonWithRequestId(requestId, { error: parsed.error.flatten(), requestId }, 400);
    }

    const supabase = getUserContextClient(accessToken);
    const debugJwt2 = await supabase.rpc("debug_jwt2");
    const debugUidRaw =
      debugJwt2.data && typeof debugJwt2.data === "object" && "uid" in debugJwt2.data
        ? (debugJwt2.data as { uid?: string | null }).uid
        : null;
    const hasClaims =
      debugJwt2.data && typeof debugJwt2.data === "object" && "claims" in debugJwt2.data
        ? (debugJwt2.data as { claims?: unknown }).claims != null
        : false;

    if (debugJwt2.error) {
      console.error("[brands] debug_jwt2_error", {
        requestId,
        code: debugJwt2.error.code ?? null,
        message: redactLogText(debugJwt2.error.message),
        details: safeDetails(debugJwt2.error.details),
        hint: redactLogText(debugJwt2.error.hint)
      });
    }

    console.info("[brands] debug_jwt2", {
      requestId,
      uid: maskId(debugUidRaw),
      claims: hasClaims ? "[present]" : null
    });

    const brand = {
      id: crypto.randomUUID(),
      name: parsed.data.name,
      plan: parsed.data.plan
    };

    const { error: brandError } = await supabase.from("brands").insert(brand);

    if (brandError) {
      const serializedBrandError = serializeUnknown(brandError);
      logServerError(
        "api.brands.create_brand",
        requestId,
        brandError ? new Error(serializedBrandError) : new Error("brand insert failed"),
        brandError
      );
      if (brandError?.code === "42501") {
        return internalErrorResponse(requestId, brandError, 403);
      }
      return internalErrorResponse(requestId, brandError);
    }

    const { error: memberError } = await supabase.from("brand_members").insert({
      brand_id: brand.id,
      user_id: userId,
      role: "owner"
    });

    if (memberError) {
      const serializedMemberError = serializeUnknown(memberError);
      logServerError(
        "api.brands.create_membership",
        requestId,
        memberError ? new Error(serializedMemberError) : new Error("membership insert failed"),
        memberError
      );
      if (memberError?.code === "42501") {
        return internalErrorResponse(requestId, memberError, 403);
      }
      return internalErrorResponse(requestId, memberError);
    }

    return jsonWithRequestId(requestId, { brand, requestId }, 201);
  } catch (error) {
    logCatchError("/api/brands", requestId, error);
    if (error instanceof AuthError) {
      return jsonWithRequestId(requestId, { error: error.message, requestId }, error.status);
    }
    const pgError = asPgErrorLike(error);
    logServerError("api.brands.exception", requestId, error, pgError);
    return internalErrorResponse(requestId, pgError);
  }
}
