import { logger, schedules, tasks } from "@trigger.dev/sdk/v3";

type DueResponse = { postIds: string[] };

export const scheduledPostSweeper = schedules.task({
  id: "scheduled-post-sweeper",
  cron: "*/5 * * * *",
  run: async () => {
    const baseUrl = process.env.INTERNAL_API_BASE_URL;
    const internalApiKey = process.env.INTERNAL_API_KEY;
    if (!baseUrl || !internalApiKey) {
      throw new Error("INTERNAL_API_BASE_URL and INTERNAL_API_KEY are required");
    }

    const dueResponse = await fetch(`${baseUrl}/api/internal/post/due`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": internalApiKey
      },
      body: JSON.stringify({ limit: 100 })
    });

    if (!dueResponse.ok) {
      throw new Error(`Due list failed: ${dueResponse.status}`);
    }

    const due = (await dueResponse.json()) as DueResponse;
    for (const postId of due.postIds) {
      await tasks.trigger(
        "scheduled-post-dispatch",
        { scheduledPostId: postId },
        {
          idempotencyKey: `post:${postId}:sweep`,
          delay: "0s"
        }
      );
    }

    logger.info("Scheduled post sweeper completed", { dueCount: due.postIds.length });
    return { dueCount: due.postIds.length };
  }
});
