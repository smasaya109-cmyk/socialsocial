import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAssetObjectKey } from "@/lib/assets/object-key";
import { createPresignedPutUrl } from "@/lib/assets/r2";
import { AssetQuotaError, getBrandPlanAndUsage, getPlanRetentionDays } from "@/lib/assets/quota";
import { AuthError, requireUser } from "@/lib/auth/require-user";
import { assertBrandMemberOrNotFound, BrandAccessError } from "@/lib/authz/brand-membership";
import { getSupabaseUserClient } from "@/lib/db/supabase";
import { acquireRedisLock, releaseRedisLock } from "@/lib/idempotency/lock";

export const runtime = "nodejs";

const schema = z.object({
  brandId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
  kind: z.enum(["video", "image", "thumbnail"])
});

function jsonWithRequestId(requestId: string, body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("x-request-id", requestId);
  return response;
}

function getMissingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!process.env.UPSTASH_REDIS_REST_URL) missing.push("UPSTASH_REDIS_REST_URL");
  if (!process.env.UPSTASH_REDIS_REST_TOKEN) missing.push("UPSTASH_REDIS_REST_TOKEN");
  if (!process.env.R2_ENDPOINT) missing.push("R2_ENDPOINT");
  if (!process.env.R2_ACCESS_KEY_ID) missing.push("R2_ACCESS_KEY_ID");
  if (!process.env.R2_SECRET_ACCESS_KEY) missing.push("R2_SECRET_ACCESS_KEY");
  if (!process.env.R2_BUCKET) missing.push("R2_BUCKET");
  return missing;
}

async function safeReleaseLock(lockKey: string, requestId: string) {
  try {
    await releaseRedisLock(lockKey);
  } catch (error) {
    const err = error as { message?: string } | undefined;
    console.error("[api.assets.upload-url.lock_release_failed]", {
      requestId,
      message: err?.message ?? "unknown_error"
    });
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.info("[req]", { requestId, route: "/api/assets/upload-url", method: request.method });
  const missing = getMissingEnv();
  if (missing.length > 0) {
    console.error("[api.assets.upload-url.env] missing required env", { requestId, missing });
    return jsonWithRequestId(requestId, { error: "Service misconfigured", requestId, missing }, 503);
  }

  try {
    const { userId, accessToken } = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonWithRequestId(requestId, { error: parsed.error.flatten(), requestId }, 400);
    }
    const input = parsed.data;
    const supabase = getSupabaseUserClient(accessToken);
    const quotaLockKey = `quota-lock:brand:${input.brandId}`;

    await assertBrandMemberOrNotFound({ supabase, brandId: input.brandId });
    const lockOk = await acquireRedisLock(quotaLockKey, 10);
    if (!lockOk) {
      throw new AssetQuotaError("Quota check in progress. Retry shortly.", 409);
    }

    try {
      const usage = await getBrandPlanAndUsage({ supabase, brandId: input.brandId });

      if (usage.usedBytes + input.sizeBytes > usage.storageLimitBytes) {
        throw new AssetQuotaError("Storage limit exceeded", 409);
      }

      const assetId = crypto.randomUUID();
      const objectKey = buildAssetObjectKey({
        userId,
        brandId: input.brandId,
        assetId,
        fileName: input.fileName
      });
      const retentionDays = getPlanRetentionDays(usage.plan);
      const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();

      const { error: insertError } = await supabase.from("media_assets").insert({
        id: assetId,
        brand_id: input.brandId,
        owner_user_id: userId,
        object_key: objectKey,
        file_name: input.fileName,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        kind: input.kind,
        status: "pending",
        expires_at: expiresAt
      });
      if (insertError) {
        console.error("[api.assets.upload-url.db_insert_failed]", {
          requestId,
          code: insertError.code ?? null,
          message: insertError.message ?? "insert_error"
        });
        return jsonWithRequestId(
          requestId,
          { error: "Failed to create pending asset", requestId, code: insertError.code ?? null },
          insertError.code === "42501" ? 404 : 500
        );
      }

      const presigned = await createPresignedPutUrl({
        objectKey,
        mimeType: input.mimeType
      });

      return jsonWithRequestId(requestId, {
        assetId,
        objectKey,
        putUrl: presigned.url,
        expiresIn: presigned.expiresIn
      });
    } finally {
      await safeReleaseLock(quotaLockKey, requestId);
    }
  } catch (error) {
    const err = error as { message?: string; stack?: string } | undefined;
    console.error("[api.assets.upload-url.exception]", {
      requestId,
      message: err?.message ?? "unknown_error",
      stack: err?.stack ?? null
    });
    if (
      error instanceof AuthError ||
      error instanceof BrandAccessError ||
      error instanceof AssetQuotaError
    ) {
      return jsonWithRequestId(requestId, { error: error.message, requestId }, error.status);
    }
    if (err?.message?.includes("env vars are missing") || err?.message?.includes("R2_BUCKET is required")) {
      return jsonWithRequestId(requestId, { error: "Service misconfigured", requestId }, 503);
    }
    return jsonWithRequestId(requestId, { error: "Internal server error", requestId }, 500);
  }
}
