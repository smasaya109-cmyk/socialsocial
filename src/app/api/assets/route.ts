import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/require-user";
import { assertBrandMemberOrNotFound, BrandAccessError } from "@/lib/authz/brand-membership";
import { getSupabaseUserClient } from "@/lib/db/supabase";

export async function GET(request: Request) {
  try {
    const { accessToken } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get("brand_id");
    if (!brandId) {
      return NextResponse.json({ error: "brand_id is required" }, { status: 400 });
    }

    const supabase = getSupabaseUserClient(accessToken);
    await assertBrandMemberOrNotFound({ supabase, brandId });

    const { data, error } = await supabase
      .from("media_assets")
      .select(
        "id,brand_id,file_name,mime_type,size_bytes,kind,status,created_at,uploaded_at,expires_at,deleted_at"
      )
      .eq("brand_id", brandId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to list assets" }, { status: 500 });
    }

    return NextResponse.json({ assets: data ?? [] });
  } catch (error) {
    if (error instanceof AuthError || error instanceof BrandAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
