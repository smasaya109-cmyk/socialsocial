import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth/require-user";
import { assertBrandMemberOrNotFound, BrandAccessError } from "@/lib/authz/brand-membership";
import { getSupabaseUserClient } from "@/lib/db/supabase";
import { encryptSecret } from "@/lib/security/encryption";

export const runtime = "nodejs";

const schema = z.object({
  brandId: z.string().uuid(),
  provider: z.enum(["instagram", "x", "threads", "tiktok"]),
  providerAccountId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional()
});

type PgErrorLike = Partial<PostgrestError> & {
  code?: string;
  message?: string;
  hint?: string;
  details?: string;
};

function redact(value: string | undefined): string | undefined {
  if (!value) return value;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9+/_-]{20,}\.[A-Za-z0-9+/_-]{10,}\.[A-Za-z0-9+/_-]{10,}/g, "[redacted-jwt]");
}

function safeDetails(value: string | undefined): string | null {
  const text = redact(value);
  if (!text) return null;
  return text.slice(0, 300);
}

function stringifyUnknown(error: unknown): string {
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

function toHint(error: PgErrorLike | undefined): string {
  if (!error) return "unexpected_error";
  if (error.code === "42501") return "permission_denied";
  if (error.code === "23505") return "duplicate_key";
  if (error.code === "42P01") return "relation_missing";
  return "database_error";
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
      hint: redact(pgError?.hint) || toHint(pgError),
      details: safeDetails(pgError?.details)
    },
    status
  );
}

function getMissingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!process.env.TOKEN_ENCRYPTION_KEYS_JSON) missing.push("TOKEN_ENCRYPTION_KEYS_JSON");
  if (!process.env.TOKEN_ACTIVE_KEY_VERSION) missing.push("TOKEN_ACTIVE_KEY_VERSION");
  return missing;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.info("[req]", { requestId, route: "/api/social-connections", method: request.method });
  const missing = getMissingEnv();
  if (missing.length > 0) {
    console.error("[api.social-connections.env] missing required env", { requestId, missing });
    return jsonWithRequestId(requestId, { error: "Service misconfigured", requestId, missing }, 503);
  }

  try {
    const { accessToken } = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonWithRequestId(requestId, { error: parsed.error.flatten(), requestId }, 400);
    }

    const input = parsed.data;
    const supabase = getSupabaseUserClient(accessToken);
    await assertBrandMemberOrNotFound({ supabase, brandId: input.brandId });

    const encryptedAccess = encryptSecret(input.accessToken);
    const encryptedRefresh = input.refreshToken ? encryptSecret(input.refreshToken) : null;
    const { data, error } = await supabase
      .from("social_connections")
      .insert({
        brand_id: input.brandId,
        provider: input.provider,
        provider_account_id: input.providerAccountId,
        access_token_enc: encryptedAccess.encrypted,
        refresh_token_enc: encryptedRefresh?.encrypted ?? null,
        key_version: encryptedAccess.keyVersion
      })
      .select("id,brand_id,provider,provider_account_id,created_at")
      .single();

    if (error) {
      console.error("[api.social-connections.db] failure", {
        requestId,
        code: error.code ?? null,
        message: redact(error.message),
        details: safeDetails(error.details),
        hint: redact(error.hint),
        serialized: stringifyUnknown(error)
      });
      if (error.code === "42501") {
        return internalErrorResponse(requestId, error, 403);
      }
      return internalErrorResponse(requestId, error, 500);
    }

    return jsonWithRequestId(requestId, { connection: data, requestId }, 200);
  } catch (error) {
    const err = error as { name?: string; message?: string; stack?: string } | undefined;
    const pgError = asPgErrorLike(error);
    console.error("[api.social-connections.exception] failure", {
      requestId,
      name: redact(err?.name),
      message: redact(err?.message),
      stack: redact(err?.stack),
      code: pgError?.code ?? null,
      details: safeDetails(pgError?.details),
      hint: redact(pgError?.hint),
      serialized: stringifyUnknown(error)
    });
    if (error instanceof AuthError || error instanceof BrandAccessError) {
      return jsonWithRequestId(requestId, { error: error.message, requestId }, error.status);
    }
    if (pgError?.code === "42501") {
      return internalErrorResponse(requestId, pgError, 403);
    }
    return internalErrorResponse(requestId, pgError, 500);
  }
}
