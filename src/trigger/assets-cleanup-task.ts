import { logger, schedules } from "@trigger.dev/sdk/v3";
import { redactBody } from "@/lib/logging/redaction";

export const cleanupExpiredAssets = schedules.task({
  id: "cleanup-expired-assets",
  cron: "0 3 * * *",
  run: async () => {
    const baseUrl = process.env.INTERNAL_API_BASE_URL;
    const internalApiKey = process.env.INTERNAL_API_KEY;
    if (!baseUrl || !internalApiKey) {
      throw new Error("INTERNAL_API_BASE_URL and INTERNAL_API_KEY are required");
    }

    const response = await fetch(`${baseUrl}/api/internal/assets/cleanup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": internalApiKey
      }
    });

    const payload = (await response.json()) as {
      ok?: boolean;
      deletedExpired?: number;
      deletedOrphans?: number;
      error?: string;
    };
    if (!response.ok || !payload.ok) {
      logger.error("Asset cleanup failed", {
        status: response.status,
        error: redactBody(payload.error ?? "unknown")
      });
      throw new Error("Asset cleanup failed");
    }

    logger.info("Asset cleanup completed", {
      deletedExpired: payload.deletedExpired ?? 0,
      deletedOrphans: payload.deletedOrphans ?? 0
    });

    return payload;
  }
});
