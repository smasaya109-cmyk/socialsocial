import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/db/supabase";
import {
  requireInternalApiKey,
  InternalAuthConfigError,
  InternalAuthError
} from "@/lib/internal/require-internal-auth";
import { redactBody } from "@/lib/logging/redaction";

const schema = z.object({
  postId: z.string().uuid()
});
const mediaKindSchema = z.enum(["video", "image", "thumbnail"]);

export async function POST(request: Request) {
  try {
    requireInternalApiKey(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const { data: post, error: postError } = await supabase
      .from("scheduled_posts")
      .select("*")
      .eq("id", parsed.data.postId)
      .maybeSingle();

    if (postError || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (!["scheduled", "queued"].includes(post.status)) {
      return NextResponse.json({ claimed: false, reason: "invalid_status" }, { status: 200 });
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from("scheduled_posts")
      .update({ status: "processing", last_attempt_at: new Date().toISOString() })
      .eq("id", post.id)
      .in("status", ["scheduled", "queued"])
      .select("id");

    if (updateError || !updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ claimed: false, reason: "already_claimed" }, { status: 200 });
    }

    const { data: connection, error: connError } = await supabase
      .from("social_connections")
      .select("id,provider,provider_account_id,access_token_enc,refresh_token_enc,key_version")
      .eq("id", post.connection_id)
      .eq("brand_id", post.brand_id)
      .maybeSingle();

    if (connError || !connection) {
      await supabase
        .from("scheduled_posts")
        .update({ status: "failed", error_code: "CONNECTION_NOT_FOUND" })
        .eq("id", post.id)
        .eq("status", "processing");
      return NextResponse.json({ claimed: false, reason: "connection_not_found" }, { status: 200 });
    }

    let asset: {
      id: string;
      objectKey: string;
      mimeType: string;
      kind: "video" | "image" | "thumbnail";
    } | null = null;

    if (post.asset_id) {
      const { data: assetRow, error: assetError } = await supabase
        .from("media_assets")
        .select("id,object_key,mime_type,kind,status")
        .eq("id", post.asset_id)
        .eq("brand_id", post.brand_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (assetError || !assetRow || assetRow.status !== "uploaded") {
        await supabase
          .from("scheduled_posts")
          .update({ status: "failed", error_code: "ASSET_NOT_FOUND" })
          .eq("id", post.id)
          .eq("status", "processing");
        return NextResponse.json({ claimed: false, reason: "asset_not_found" }, { status: 200 });
      }

      asset = {
        id: assetRow.id,
        objectKey: assetRow.object_key,
        mimeType: assetRow.mime_type,
        kind: mediaKindSchema.parse(assetRow.kind)
      };
    }

    return NextResponse.json({
      claimed: true,
      post: {
        id: post.id,
        brandId: post.brand_id,
        scheduledAt: post.scheduled_at,
        idempotencyKey: post.idempotency_key,
        body: post.body,
        bodyPreview: redactBody(post.body),
        safeModeEnabled: post.safe_mode_enabled,
        previousPostBody: post.previous_post_body,
        assetId: post.asset_id ?? null
      },
      connection: {
        id: connection.id,
        provider: connection.provider,
        providerAccountId: connection.provider_account_id,
        accessTokenEnc: connection.access_token_enc,
        refreshTokenEnc: connection.refresh_token_enc,
        keyVersion: connection.key_version
      },
      asset
    });
  } catch (error) {
    if (error instanceof InternalAuthError || error instanceof InternalAuthConfigError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
