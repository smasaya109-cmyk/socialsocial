import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth/require-user";
import { assertBrandMemberOrNotFound, BrandAccessError } from "@/lib/authz/brand-membership";
import { getSupabaseUserClient } from "@/lib/db/supabase";
import { encryptSecret } from "@/lib/security/encryption";

const schema = z.object({
  brandId: z.string().uuid(),
  provider: z.enum(["instagram", "x", "threads", "tiktok"]),
  providerAccountId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional()
});

export async function POST(request: Request) {
  try {
    const { accessToken } = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
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
      return NextResponse.json({ error: "Failed to store connection" }, { status: 500 });
    }

    return NextResponse.json({ connection: data });
  } catch (error) {
    if (error instanceof AuthError || error instanceof BrandAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
