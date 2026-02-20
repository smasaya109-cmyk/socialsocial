import { PLAN_LIMITS, PlanName } from "@/lib/plans";
import type { SupabaseClient } from "@supabase/supabase-js";

export class AssetQuotaError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

export function getPlanStorageLimitBytes(plan: PlanName): number {
  return PLAN_LIMITS[plan].assetStorageGb * 1024 * 1024 * 1024;
}

export function getPlanRetentionDays(plan: PlanName): number {
  return PLAN_LIMITS[plan].assetRetentionDays;
}

export async function getBrandPlanAndUsage(input: {
  supabase: SupabaseClient;
  brandId: string;
}): Promise<{ plan: PlanName; usedBytes: number; storageLimitBytes: number }> {
  const { data: brand, error: brandError } = await input.supabase
    .from("brands")
    .select("plan")
    .eq("id", input.brandId)
    .maybeSingle();
  if (brandError || !brand) {
    throw new Error("Brand not found");
  }

  const plan = brand.plan as PlanName;
  const { data: assets, error: assetsError } = await input.supabase
    .from("media_assets")
    .select("size_bytes")
    .eq("brand_id", input.brandId)
    .in("status", ["uploaded", "pending"])
    .is("deleted_at", null);

  if (assetsError) {
    throw new Error("Failed to fetch asset usage");
  }

  const usedBytes = (assets ?? []).reduce((total, row) => total + Number(row.size_bytes), 0);
  const storageLimitBytes = getPlanStorageLimitBytes(plan);
  return { plan, usedBytes, storageLimitBytes };
}
