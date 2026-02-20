import { NextResponse } from "next/server";
import { createPresignedGetUrl } from "@/lib/assets/r2";
import { AuthError, requireUser } from "@/lib/auth/require-user";
import { getSupabaseUserClient } from "@/lib/db/supabase";

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    const { accessToken } = await requireUser(request);
    const supabase = getSupabaseUserClient(accessToken);
    const assetId = context.params.id;

    const { data: asset, error } = await supabase
      .from("media_assets")
      .select("id,object_key,status")
      .eq("id", assetId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !asset || asset.status !== "uploaded") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const signed = await createPresignedGetUrl(asset.object_key);
    return NextResponse.json({
      assetId: asset.id,
      getUrl: signed.url,
      expiresIn: signed.expiresIn
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
