import type { ProviderClient, ProviderPublishInput, ProviderPublishResult } from "@/lib/providers/types";

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_IMAGE_PUBLISH_RETRY_INTERVAL_MS = 3_000;
const DEFAULT_IMAGE_PUBLISH_RETRY_COUNT = 5;
const DEFAULT_VIDEO_PUBLISH_RETRY_INTERVAL_MS = 5_000;
const DEFAULT_VIDEO_PUBLISH_RETRY_COUNT = 12;

type MetaErrorPayload = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
  };
};

function maskSnippet(text: string): string {
  return text
    .replace(/https?:\/\/[^\s]+/g, "[redacted-url]")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function parseMetaError(raw: string): MetaErrorPayload | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MetaErrorPayload;
  } catch {
    return null;
  }
}

function classifyInstagramError(status: number, payload: MetaErrorPayload | null): string {
  const code = payload?.error?.code;
  const message = (payload?.error?.message || "").toLowerCase();
  if (status === 401 || code === 190) return "INSTAGRAM_UNAUTHORIZED";
  if (status === 403 || code === 10 || message.includes("permission")) return "INSTAGRAM_SCOPE_MISSING";
  if (status === 429 || code === 4 || code === 17) return "INSTAGRAM_RATE_LIMIT";
  if (status >= 500) return "INSTAGRAM_PROVIDER_UNAVAILABLE";
  if (status === 400 && message.includes("media")) return "INSTAGRAM_MEDIA_INVALID";
  if (status === 400 && message.includes("video")) return "INSTAGRAM_VIDEO_INVALID";
  return "INSTAGRAM_PROVIDER_ERROR";
}

async function readText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getImagePublishRetryIntervalMs(): number {
  const raw = Number(process.env.INSTAGRAM_IMAGE_PUBLISH_RETRY_INTERVAL_MS ?? DEFAULT_IMAGE_PUBLISH_RETRY_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw < 500) return DEFAULT_IMAGE_PUBLISH_RETRY_INTERVAL_MS;
  return Math.min(Math.floor(raw), 15000);
}

function getImagePublishRetryCount(): number {
  const raw = Number(process.env.INSTAGRAM_IMAGE_PUBLISH_RETRY_COUNT ?? DEFAULT_IMAGE_PUBLISH_RETRY_COUNT);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_IMAGE_PUBLISH_RETRY_COUNT;
  return Math.min(Math.floor(raw), 10);
}

function getVideoPublishRetryIntervalMs(): number {
  const raw = Number(process.env.INSTAGRAM_VIDEO_PUBLISH_RETRY_INTERVAL_MS ?? DEFAULT_VIDEO_PUBLISH_RETRY_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw < 500) return DEFAULT_VIDEO_PUBLISH_RETRY_INTERVAL_MS;
  return Math.min(Math.floor(raw), 30000);
}

function getVideoPublishRetryCount(): number {
  const raw = Number(process.env.INSTAGRAM_VIDEO_PUBLISH_RETRY_COUNT ?? DEFAULT_VIDEO_PUBLISH_RETRY_COUNT);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_VIDEO_PUBLISH_RETRY_COUNT;
  return Math.min(Math.floor(raw), 24);
}

function shouldRetryPublish(status: number, payload: MetaErrorPayload | null): boolean {
  if (status !== 400) return false;
  const message = (payload?.error?.message || "").toLowerCase();
  return (
    message.includes("media id is not available") ||
    message.includes("not available") ||
    message.includes("not ready") ||
    message.includes("still being processed") ||
    message.includes("please wait")
  );
}

export class InstagramProviderClient implements ProviderClient {
  async publish(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    if (!input.providerAccountId) {
      return {
        ok: false,
        errorCode: "INSTAGRAM_ACCOUNT_ID_MISSING",
        providerResponseMasked: "instagram_provider_account_id_missing"
      };
    }

    if (!input.mediaUrl || !input.mediaKind || !input.mediaMimeType) {
      return {
        ok: false,
        errorCode: "INSTAGRAM_MEDIA_REQUIRED",
        providerResponseMasked: "instagram_media_required"
      };
    }

    const apiBase = (process.env.INSTAGRAM_API_BASE_URL || "https://graph.facebook.com/v23.0").replace(/\/$/, "");
    const publishRetryCount = input.mediaKind === "video" ? getVideoPublishRetryCount() : getImagePublishRetryCount();
    const publishRetryIntervalMs =
      input.mediaKind === "video" ? getVideoPublishRetryIntervalMs() : getImagePublishRetryIntervalMs();
    const timeoutBudgetMs =
      input.mediaKind === "video"
        ? Math.max(REQUEST_TIMEOUT_MS, publishRetryCount * publishRetryIntervalMs + 30_000)
        : REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutBudgetMs);

    try {
      const createUrl = `${apiBase}/${input.providerAccountId}/media`;
      const createBody = new URLSearchParams({
        caption: input.body,
        access_token: input.accessToken
      });

      if (input.mediaKind === "video") {
        const videoMediaType = process.env.INSTAGRAM_VIDEO_MEDIA_TYPE || "REELS";
        createBody.set("video_url", input.mediaUrl);
        createBody.set("media_type", videoMediaType);
      } else {
        createBody.set("image_url", input.mediaUrl);
      }

      const createResponse = await fetch(createUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: createBody.toString(),
        signal: controller.signal
      });
      const createRaw = await readText(createResponse);
      if (!createResponse.ok) {
        const payload = parseMetaError(createRaw);
        return {
          ok: false,
          errorCode: classifyInstagramError(createResponse.status, payload),
          providerResponseMasked: `create status=${createResponse.status} body=${maskSnippet(payload?.error?.message || createRaw)}`
        };
      }

      let createJson: unknown = null;
      try {
        createJson = JSON.parse(createRaw);
      } catch {
        createJson = null;
      }

      const creationId =
        createJson && typeof createJson === "object" && "id" in createJson
          ? String((createJson as { id?: string }).id || "")
          : "";

      if (!creationId) {
        return {
          ok: false,
          errorCode: "INSTAGRAM_RESPONSE_INVALID",
          providerResponseMasked: "create_response_missing_id"
        };
      }

      const publishUrl = `${apiBase}/${input.providerAccountId}/media_publish`;

      let publishRaw = "";
      let publishJson: unknown = null;
      let publishOk = false;

      for (let attempt = 1; attempt <= publishRetryCount; attempt += 1) {
        const publishBody = new URLSearchParams({
          creation_id: creationId,
          access_token: input.accessToken
        });

        const publishResponse = await fetch(publishUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: publishBody.toString(),
          signal: controller.signal
        });

        publishRaw = await readText(publishResponse);
        if (!publishResponse.ok) {
          const payload = parseMetaError(publishRaw);
          if (attempt < publishRetryCount && shouldRetryPublish(publishResponse.status, payload)) {
            await sleep(publishRetryIntervalMs);
            continue;
          }
          return {
            ok: false,
            errorCode: classifyInstagramError(publishResponse.status, payload),
            providerResponseMasked: `publish status=${publishResponse.status} body=${maskSnippet(payload?.error?.message || publishRaw)}`
          };
        }

        try {
          publishJson = JSON.parse(publishRaw);
        } catch {
          publishJson = null;
        }
        publishOk = true;
        break;
      }

      if (!publishOk) {
        return {
          ok: false,
          errorCode: "INSTAGRAM_MEDIA_INVALID",
          providerResponseMasked: "publish_response_unavailable"
        };
      }

      const providerPostId =
        publishJson && typeof publishJson === "object" && "id" in publishJson
          ? String((publishJson as { id?: string }).id || "")
          : "";

      if (!providerPostId) {
        return {
          ok: false,
          errorCode: "INSTAGRAM_RESPONSE_INVALID",
          providerResponseMasked: "publish_response_missing_id"
        };
      }

      return {
        ok: true,
        providerPostId,
        providerResponseMasked: "status=200"
      };
    } catch (error) {
      const err = error as { name?: string; message?: string } | undefined;
      if (err?.name === "AbortError") {
        return {
          ok: false,
          errorCode: "INSTAGRAM_TIMEOUT",
          providerResponseMasked: "request_timeout"
        };
      }
      return {
        ok: false,
        errorCode: "INSTAGRAM_NETWORK_ERROR",
        providerResponseMasked: `network_error:${maskSnippet(err?.message || "")}`
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
