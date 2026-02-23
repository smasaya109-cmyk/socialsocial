import { logger, task } from "@trigger.dev/sdk/v3";
import { acquireIdempotencyLock } from "@/lib/idempotency/lock";
import { redactBody, redactToken } from "@/lib/logging/redaction";
import { resolveProviderClient } from "@/lib/providers";
import { isSafeModeDuplicate } from "@/lib/safe-mode/similarity";
import { decryptSecret } from "@/lib/security/encryption";

type DispatchPayload = {
  scheduledPostId: string;
};

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

function snippet(text: string): string {
  if (!text) return "";
  return redactBody(text).slice(0, 140);
}

type ClaimResponse =
  | {
      claimed: true;
      post: {
        id: string;
        brandId: string;
        scheduledAt: string;
        idempotencyKey: string;
        body: string;
        safeModeEnabled: boolean;
        previousPostBody: string | null;
      };
      connection: {
        provider: "instagram" | "x" | "threads" | "tiktok";
        accessTokenEnc: string;
        refreshTokenEnc: string | null;
      };
    }
  | { claimed: false; reason: string };

export const scheduledPostDispatch = task({
  id: "scheduled-post-dispatch",
  run: async (payload: DispatchPayload) => {
    const baseUrl = process.env.INTERNAL_API_BASE_URL;
    const internalApiKey = process.env.INTERNAL_API_KEY;
    logger.info("Dispatch task started", {
      scheduledPostId: payload.scheduledPostId,
      baseUrl: baseUrl ? maskUrl(baseUrl) : null,
      hasInternalApiKey: Boolean(internalApiKey)
    });

    if (!baseUrl || !internalApiKey) {
      logger.error("Dispatch task missing required env", {
        hasBaseUrl: Boolean(baseUrl),
        hasInternalApiKey: Boolean(internalApiKey)
      });
      throw new Error("INTERNAL_API_BASE_URL and INTERNAL_API_KEY are required");
    }

    const claimResponse = await fetch(`${baseUrl}/api/internal/post/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": internalApiKey
      },
      body: JSON.stringify({ postId: payload.scheduledPostId })
    });

    if (!claimResponse.ok) {
      const claimText = await claimResponse.text().catch(() => "");
      logger.error("Claim request failed", {
        scheduledPostId: payload.scheduledPostId,
        status: claimResponse.status,
        body: snippet(claimText)
      });
      if (claimResponse.status === 404 || claimResponse.status === 409) {
        return { skipped: true, reason: "not_claimable" };
      }
      throw new Error(`Claim failed: ${claimResponse.status}`);
    }

    const claimed = (await claimResponse.json()) as ClaimResponse;
    logger.info("Claim request completed", {
      scheduledPostId: payload.scheduledPostId,
      claimed: claimed.claimed,
      reason: claimed.claimed ? null : claimed.reason
    });
    if (!claimed.claimed) {
      return { skipped: true, reason: claimed.reason };
    }

    const complete = async (input: {
      result: "published" | "failed";
      errorCode?: string;
      providerPostId?: string;
      providerResponseMasked?: string;
    }) => {
      const completeResponse = await fetch(`${baseUrl}/api/internal/post/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-api-key": internalApiKey
        },
        body: JSON.stringify({
          postId: claimed.post.id,
          result: input.result,
          provider: claimed.connection.provider,
          idempotencyKey: claimed.post.idempotencyKey,
          errorCode: input.errorCode,
          providerPostId: input.providerPostId,
          providerResponseMasked: input.providerResponseMasked
        })
      });
      if (!completeResponse.ok) {
        const completeText = await completeResponse.text().catch(() => "");
        logger.error("Complete request failed", {
          scheduledPostId: claimed.post.id,
          status: completeResponse.status,
          body: snippet(completeText)
        });
        throw new Error(`Complete failed: ${completeResponse.status}`);
      }
      logger.info("Complete request succeeded", {
        scheduledPostId: claimed.post.id,
        result: input.result,
        errorCode: input.errorCode ?? null
      });
    };

    const lockOk = await acquireIdempotencyLock(claimed.post.idempotencyKey, 120);
    if (!lockOk) {
      await complete({ result: "failed", errorCode: "IDEMPOTENCY_LOCKED" });
      return { skipped: true, reason: "idempotency_lock" };
    }

    if (claimed.connection.provider === "x") {
      const minuteBucket = claimed.post.scheduledAt.slice(0, 16);
      const xLockOk = await acquireIdempotencyLock(`x-safe:${claimed.post.brandId}:${minuteBucket}`, 180);
      if (!xLockOk) {
        await complete({ result: "failed", errorCode: "SAFE_MODE_X_SIMULTANEOUS_BLOCKED" });
        return { skipped: true, reason: "safe_mode_x_simultaneous" };
      }
    }

    if (claimed.post.safeModeEnabled && claimed.post.previousPostBody) {
      if (isSafeModeDuplicate(claimed.post.previousPostBody, claimed.post.body)) {
        await complete({ result: "failed", errorCode: "SAFE_MODE_DUPLICATE" });
        return { skipped: true, reason: "safe_mode_duplicate" };
      }
    }

    const accessToken = decryptSecret(claimed.connection.accessTokenEnc);
    logger.info("Dispatching scheduled post", {
      provider: claimed.connection.provider,
      token: redactToken(accessToken),
      body: redactBody(claimed.post.body)
    });

    const stubMode = process.env.PROVIDER_STUB_MODE ?? "success";
    if (stubMode === "fail") {
      await complete({
        result: "failed",
        errorCode: "PROVIDER_STUB_FAILURE",
        providerResponseMasked: "stub-failure"
      });
      return { ok: false, scheduledPostId: claimed.post.id };
    }

    if (stubMode === "off") {
      const providerClient = resolveProviderClient(claimed.connection.provider);
      const result = await providerClient.publish({
        provider: claimed.connection.provider,
        accessToken,
        body: claimed.post.body
      });
      if (!result.ok) {
        await complete({
          result: "failed",
          errorCode: result.errorCode ?? "PROVIDER_CLIENT_ERROR",
          providerResponseMasked: result.providerResponseMasked ?? "provider-client-failed"
        });
        return { ok: false, scheduledPostId: claimed.post.id };
      }
      await complete({
        result: "published",
        providerPostId: result.providerPostId,
        providerResponseMasked: result.providerResponseMasked ?? "provider-client-success"
      });
      return { ok: true, scheduledPostId: claimed.post.id };
    }

    const providerPostId = `mock_${claimed.post.id}`;
    await complete({
      result: "published",
      providerPostId,
      providerResponseMasked: "stub-success"
    });

    return { ok: true, scheduledPostId: claimed.post.id };
  }
});
