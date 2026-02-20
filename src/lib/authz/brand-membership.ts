import type { SupabaseClient } from "@supabase/supabase-js";

export class BrandAccessError extends Error {
  status: number;

  constructor() {
    super("Not found");
    this.status = 404;
  }
}

export async function assertBrandMemberOrNotFound(input: {
  supabase: SupabaseClient;
  brandId: string;
}) {
  const { data, error } = await input.supabase
    .from("brand_members")
    .select("brand_id")
    .eq("brand_id", input.brandId)
    .maybeSingle();

  if (error || !data) {
    throw new BrandAccessError();
  }
}
