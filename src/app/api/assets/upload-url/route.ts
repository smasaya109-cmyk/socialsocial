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

const schema = z.object({
  brandId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
  kind: z.enum(["video", "image", "thumbnail"])
});

export async function POST(request: Request) {
  try {
    const { userId, accessToken } = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
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
        return NextResponse.json({ error: "Failed to create pending asset" }, { status: 500 });
      }

      const presigned = await createPresignedPutUrl({
        objectKey,
        mimeType: input.mimeType
      });

      return NextResponse.json({
        assetId,
        objectKey,
        putUrl: presigned.url,
        expiresIn: presigned.expiresIn
      });
    } finally {
      await releaseRedisLock(quotaLockKey);
    }
  } catch (error) {
    if (
      error instanceof AuthError ||
      error instanceof BrandAccessError ||
      error instanceof AssetQuotaError
    ) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
