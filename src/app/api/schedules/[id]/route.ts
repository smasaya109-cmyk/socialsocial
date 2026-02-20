import { NextResponse } from "next/server";
import { runs, tasks } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth/require-user";
import { getSupabaseUserClient } from "@/lib/db/supabase";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("reschedule"), scheduledAt: z.string().datetime() })
]);

export async function PATCH(request: Request, context: { params: { id: string } }) {
  try {
    const { accessToken } = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = getSupabaseUserClient(accessToken);
    const scheduledPostId = context.params.id;
    const { data: post, error: postError } = await supabase
      .from("scheduled_posts")
      .select("id,brand_id,status,trigger_run_id")
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
      .select("id,brand_id,scheduled_at,status,error_code,trigger_run_id,posted_at,created_at")
      .eq("id", scheduledPostId)
      .maybeSingle();

    if (error || !post) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ scheduledPost: post });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
