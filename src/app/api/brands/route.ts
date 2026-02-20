import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth/require-user";
import { getSupabaseUserClient } from "@/lib/db/supabase";

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

function toSafeHint(error: PgErrorLike | undefined): string {
  if (!error) return "unexpected_error";
  if (error.code === "42501") return "permission_denied";
  if (error.code === "23505") return "duplicate_key";
  if (error.code === "42P01") return "relation_missing";
  return "database_error";
}

function logServerError(scope: string, requestId: string, error: unknown, pgError?: PgErrorLike) {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(`[${scope}] failure`, {
    requestId,
    name: err.name,
    message: redactLogText(err.message),
    stack: redactLogText(err.stack),
    pgCode: pgError?.code ?? null,
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

function internalErrorResponse(requestId: string, pgError?: PgErrorLike, status = 500) {
  return jsonWithRequestId(
    requestId,
    {
      error: "Internal",
      requestId,
      code: pgError?.code ?? null,
      hint: toSafeHint(pgError)
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

    const supabase = getSupabaseUserClient(accessToken);
    const { data: brand, error: brandError } = await supabase
      .from("brands")
      .insert({ name: parsed.data.name, plan: parsed.data.plan })
      .select("id,name,plan,created_at")
      .single();

    if (brandError || !brand) {
      logServerError(
        "api.brands.create_brand",
        requestId,
        brandError ?? new Error("brand insert failed"),
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
      logServerError(
        "api.brands.create_membership",
        requestId,
        memberError ?? new Error("membership insert failed"),
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
    logServerError("api.brands.exception", requestId, error);
    return internalErrorResponse(requestId);
  }
}
