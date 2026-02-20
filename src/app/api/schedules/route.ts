import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth/require-user";
import { assertBrandMemberOrNotFound, BrandAccessError } from "@/lib/authz/brand-membership";
import { getSupabaseUserClient } from "@/lib/db/supabase";
import { redactBody } from "@/lib/logging/redaction";

const schema = z.object({
  brandId: z.string().uuid(),
  connectionId: z.string().uuid(),
  body: z.string().min(1).max(5000),
  scheduledAt: z.string().datetime(),
  safeModeEnabled: z.boolean().default(true)
});

export async function POST(request: Request) {
  try {
    const { userId, accessToken } = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;
    const idempotencyKey = crypto.randomUUID();
    const supabase = getSupabaseUserClient(accessToken);

    await assertBrandMemberOrNotFound({ supabase, brandId: input.brandId });

    const { data: post, error: postError } = await supabase
      .from("scheduled_posts")
      .insert({
        brand_id: input.brandId,
        created_by: userId,
        connection_id: input.connectionId,
        body: input.body,
        body_preview: redactBody(input.body),
        scheduled_at: input.scheduledAt,
        status: "scheduled",
        safe_mode_enabled: input.safeModeEnabled,
        idempotency_key: idempotencyKey
      })
      .select("id,brand_id,scheduled_at,status,idempotency_key")
      .single();

    if (postError || !post) {
      return NextResponse.json({ error: "Failed to schedule post" }, { status: 500 });
    }

    await supabase.from("idempotency_keys").insert({
      brand_id: input.brandId,
      key: idempotencyKey,
      resource_type: "scheduled_post",
      resource_id: post.id
    });

    const scheduledAt = new Date(input.scheduledAt);
    const now = new Date();
    const delay = scheduledAt > now ? scheduledAt : "0s";

    try {
      const dispatchIdempotencyKey = `post:${post.id}`;
      const handle = await tasks.trigger(
        "scheduled-post-dispatch",
        { scheduledPostId: post.id },
        {
          idempotencyKey: dispatchIdempotencyKey,
          delay
        }
      );

      await supabase
        .from("scheduled_posts")
        .update({
          status: "queued",
          trigger_run_id: handle.id,
          trigger_task_id: "scheduled-post-dispatch",
          trigger_enqueued_at: new Date().toISOString()
        })
        .eq("id", post.id)
        .in("status", ["scheduled", "queued"]);

      return NextResponse.json({
        scheduledPost: {
          ...post,
          status: "queued",
          triggerRunId: handle.id
        },
        triggerEnqueued: true
      });
    } catch {
      return NextResponse.json({
        scheduledPost: post,
        triggerEnqueued: false
      });
    }
  } catch (error) {
    if (error instanceof AuthError || error instanceof BrandAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
