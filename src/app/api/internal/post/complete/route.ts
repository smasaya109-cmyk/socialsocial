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
  postId: z.string().uuid(),
  result: z.enum(["published", "failed"]),
  provider: z.enum(["instagram", "x", "threads", "tiktok"]),
  idempotencyKey: z.string().uuid(),
  providerPostId: z.string().optional(),
  providerResponseMasked: z.string().optional(),
  errorCode: z.string().optional()
});

export async function POST(request: Request) {
  try {
    requireInternalApiKey(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const input = parsed.data;
    const supabase = getSupabaseAdminClient();

    const { data: post, error: postError } = await supabase
      .from("scheduled_posts")
      .select("id,brand_id,status")
      .eq("id", input.postId)
      .maybeSingle();

    if (postError || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (post.status !== "processing") {
      return NextResponse.json({ ok: false, reason: "invalid_status" }, { status: 200 });
    }

    const nextStatus = input.result === "published" ? "posted" : "failed";
    const patch =
      input.result === "published"
        ? { status: "posted", posted_at: new Date().toISOString(), error_code: null }
        : { status: "failed", error_code: input.errorCode ?? "PROVIDER_ERROR" };

    const { error: deliveryError } = await supabase.from("post_deliveries").insert({
      brand_id: post.brand_id,
      scheduled_post_id: post.id,
      provider: input.provider,
      provider_post_id: input.providerPostId ?? null,
      status: nextStatus,
      idempotency_key: input.idempotencyKey,
      error_message: input.errorCode ?? null
    });
    if (deliveryError && deliveryError.code !== "23505") {
      console.error("[api.internal.post.complete] post_deliveries insert failed", {
        code: deliveryError.code ?? null,
        message: deliveryError.message ?? "delivery_insert_failed"
      });
      return NextResponse.json({ error: "Internal", code: deliveryError.code ?? null }, { status: 500 });
    }

    const { error: publishLogError } = await supabase.from("publish_logs").insert({
      brand_id: post.brand_id,
      scheduled_post_id: post.id,
      result: input.result,
      provider_response_masked: input.providerResponseMasked
        ? redactBody(input.providerResponseMasked)
        : null,
      error_code: input.errorCode ?? null
    });
    if (publishLogError) {
      console.error("[api.internal.post.complete] publish_logs insert failed", {
        code: publishLogError.code ?? null,
        message: publishLogError.message ?? "publish_log_insert_failed"
      });
      return NextResponse.json({ error: "Internal", code: publishLogError.code ?? null }, { status: 500 });
    }

    const { data: changedRows, error: statusError } = await supabase
      .from("scheduled_posts")
      .update(patch)
      .eq("id", post.id)
      .eq("status", "processing")
      .select("id");

    if (statusError || !changedRows || changedRows.length === 0) {
      return NextResponse.json({ ok: false, reason: "cas_failed" }, { status: 200 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof InternalAuthError || error instanceof InternalAuthConfigError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
