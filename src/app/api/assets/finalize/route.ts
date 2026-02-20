import { NextResponse } from "next/server";
import { z } from "zod";
import { headObject } from "@/lib/assets/r2";
import { AuthError, requireUser } from "@/lib/auth/require-user";
import { getSupabaseUserClient } from "@/lib/db/supabase";
import { redactObjectKey } from "@/lib/logging/redaction";

const schema = z.object({
  assetId: z.string().uuid()
});

export async function POST(request: Request) {
  try {
    const { accessToken } = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = getSupabaseUserClient(accessToken);
    const { data: asset, error: assetError } = await supabase
      .from("media_assets")
      .select("id,brand_id,object_key,mime_type,size_bytes,status")
      .eq("id", parsed.data.assetId)
      .is("deleted_at", null)
      .maybeSingle();

    if (assetError || !asset) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (asset.status !== "pending") {
      return NextResponse.json({ ok: true, alreadyFinalized: true });
    }

    let head;
    try {
      head = await headObject(asset.object_key);
    } catch {
      return NextResponse.json(
        { error: "Uploaded object not found", objectKey: redactObjectKey(asset.object_key) },
        { status: 409 }
      );
    }
    const contentType = head.ContentType ?? "";
    const contentLength = Number(head.ContentLength ?? 0);

    if (contentType !== asset.mime_type || contentLength !== Number(asset.size_bytes)) {
      return NextResponse.json(
        {
          error: "Uploaded object metadata mismatch",
          objectKey: redactObjectKey(asset.object_key)
        },
        { status: 409 }
      );
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from("media_assets")
      .update({ status: "uploaded", uploaded_at: new Date().toISOString() })
      .eq("id", asset.id)
      .eq("status", "pending")
      .is("deleted_at", null)
      .select("id");

    if (updateError || !updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ ok: false, reason: "cas_failed" }, { status: 200 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
