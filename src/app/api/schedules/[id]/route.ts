import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { runs, tasks } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth/require-user";
import { getSupabaseUserClient } from "@/lib/db/supabase";
import { getPublishErrorMeta } from "@/lib/publishing/error-codes";
import { redactBody } from "@/lib/logging/redaction";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("reschedule"), scheduledAt: z.string().datetime() }),
  z.object({ action: z.literal("retry"), scheduledAt: z.string().datetime().optional() })
]);

export async function PATCH(request: Request, context: { params: { id: string } }) {
  try {
    const { accessToken, userId } = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = getSupabaseUserClient(accessToken);
    const scheduledPostId = context.params.id;
    const { data: post, error: postError } = await supabase
      .from("scheduled_posts")
      .select("id,brand_id,status,trigger_run_id,connection_id,asset_id,body,safe_mode_enabled")
      .eq("id", scheduledPostId)
      .maybeSingle();

    if (postError || !post) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (parsed.data.action === "cancel") {
      if (post.trigger_run_id) {
        await runs.cancel(post.trigger_run_id).catch(() => undefined);
      }

      const { data: changed, error: updateError } = await supabase
        .from("scheduled_posts")
        .update({ status: "canceled" })
        .eq("id", scheduledPostId)
        .in("status", ["scheduled", "queued"])
        .select("id");

      if (updateError || !changed || changed.length === 0) {
        return NextResponse.json({ ok: false, reason: "not_cancelable" }, { status: 200 });
      }
      return NextResponse.json({ ok: true, status: "canceled" });
    }

    if (parsed.data.action === "retry") {
      if (post.status !== "failed") {
        return NextResponse.json({ ok: false, reason: "not_retryable" }, { status: 200 });
      }
      const scheduledAt = parsed.data.scheduledAt ?? new Date(Date.now() + 60 * 1000).toISOString();
      const idempotencyKey = crypto.randomUUID();
      const { data: retriedPost, error: insertError } = await supabase
        .from("scheduled_posts")
        .insert({
          brand_id: post.brand_id,
          created_by: userId,
          connection_id: post.connection_id,
          asset_id: post.asset_id ?? null,
          body: post.body,
          body_preview: redactBody(post.body),
          scheduled_at: scheduledAt,
          status: "scheduled",
          safe_mode_enabled: post.safe_mode_enabled,
          idempotency_key: idempotencyKey
        })
        .select("id,scheduled_at,status")
        .single();
      if (insertError || !retriedPost) {
        return NextResponse.json({ error: "Failed to retry post" }, { status: 500 });
      }

      await supabase.from("idempotency_keys").insert({
        brand_id: post.brand_id,
        key: idempotencyKey,
        resource_type: "scheduled_post",
        resource_id: retriedPost.id
      });

      const handle = await tasks.trigger(
        "scheduled-post-dispatch",
        { scheduledPostId: retriedPost.id },
        { idempotencyKey: `post:${retriedPost.id}`, delay: new Date(scheduledAt) }
      );

      await supabase
        .from("scheduled_posts")
        .update({
          status: "queued",
          trigger_run_id: handle.id,
          trigger_task_id: "scheduled-post-dispatch",
          trigger_enqueued_at: new Date().toISOString()
        })
        .eq("id", retriedPost.id)
        .in("status", ["scheduled", "queued"]);

      return NextResponse.json({
        ok: true,
        status: "queued",
        retriedFrom: scheduledPostId,
        newScheduledPostId: retriedPost.id,
        triggerRunId: handle.id
      });
    }

    const newDate = new Date(parsed.data.scheduledAt);
    if (post.trigger_run_id) {
      try {
        const rescheduled = await runs.reschedule(post.trigger_run_id, { delay: newDate });
        await supabase
          .from("scheduled_posts")
          .update({
            scheduled_at: parsed.data.scheduledAt,
            trigger_run_id: rescheduled.id,
            trigger_enqueued_at: new Date().toISOString(),
            status: "queued"
          })
          .eq("id", scheduledPostId);
        return NextResponse.json({ ok: true, status: "queued", triggerRunId: rescheduled.id });
      } catch {
        await runs.cancel(post.trigger_run_id).catch(() => undefined);
      }
    }

    const handle = await tasks.trigger(
      "scheduled-post-dispatch",
      { scheduledPostId },
      { idempotencyKey: `post:${scheduledPostId}:reschedule`, delay: newDate }
    );
    await supabase
      .from("scheduled_posts")
      .update({
        scheduled_at: parsed.data.scheduledAt,
        trigger_run_id: handle.id,
        trigger_task_id: "scheduled-post-dispatch",
        trigger_enqueued_at: new Date().toISOString(),
        status: "queued"
      })
      .eq("id", scheduledPostId);

    return NextResponse.json({ ok: true, status: "queued", triggerRunId: handle.id });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    const { accessToken } = await requireUser(request);
    const supabase = getSupabaseUserClient(accessToken);
    const scheduledPostId = context.params.id;

    const { data: post, error } = await supabase
      .from("scheduled_posts")
      .select("id,brand_id,asset_id,scheduled_at,status,error_code,trigger_run_id,posted_at,created_at")
      .eq("id", scheduledPostId)
      .maybeSingle();

    if (error || !post) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [deliveryRes, publishLogRes] = await Promise.all([
      supabase
        .from("post_deliveries")
        .select("id,provider,provider_post_id,status,error_message,created_at")
        .eq("scheduled_post_id", scheduledPostId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("publish_logs")
        .select("id,result,error_code,provider_response_masked,created_at")
        .eq("scheduled_post_id", scheduledPostId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    return NextResponse.json({
      scheduledPost: post,
      delivery: deliveryRes.error ? null : (deliveryRes.data ?? null),
      publishLog: publishLogRes.error ? null : (publishLogRes.data ?? null),
      errorMeta: getPublishErrorMeta(post.error_code),
      diagnostics: {
        deliveryQueryErrorCode: deliveryRes.error?.code ?? null,
        publishLogQueryErrorCode: publishLogRes.error?.code ?? null
      }
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
