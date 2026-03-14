import type { ProviderClient, ProviderPublishInput, ProviderPublishResult } from "@/lib/providers/types";
import { refreshThreadsLongLivedToken } from "@/lib/providers/meta/oauth";

const REQUEST_TIMEOUT_MS = 20_000;
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
    const parsed = JSON.parse(raw) as MetaErrorPayload;
    return parsed;
  } catch {
    return null;
  }
}

function classifyThreadsError(status: number, payload: MetaErrorPayload | null): string {
  const code = payload?.error?.code;
  const message = (payload?.error?.message || "").toLowerCase();

  if (status === 401 || code === 190) return "THREADS_UNAUTHORIZED";
  if (status === 403 || code === 10 || message.includes("permission")) return "THREADS_SCOPE_MISSING";
  if (status === 429 || code === 4 || code === 17) return "THREADS_RATE_LIMIT";
  if (status >= 500) return "THREADS_PROVIDER_UNAVAILABLE";
  if (status === 400 && message.includes("video")) return "THREADS_VIDEO_INVALID";
  if (status === 400 && message.includes("image")) return "THREADS_IMAGE_INVALID";
  if (status === 400 && message.includes("text")) return "THREADS_BAD_REQUEST";
  return "THREADS_PROVIDER_ERROR";
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

function getVideoPublishRetryIntervalMs(): number {
  const raw = Number(process.env.THREADS_VIDEO_PUBLISH_RETRY_INTERVAL_MS ?? DEFAULT_VIDEO_PUBLISH_RETRY_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw < 500) return DEFAULT_VIDEO_PUBLISH_RETRY_INTERVAL_MS;
  return Math.min(Math.floor(raw), 30000);
}

function getVideoPublishRetryCount(): number {
  const raw = Number(process.env.THREADS_VIDEO_PUBLISH_RETRY_COUNT ?? DEFAULT_VIDEO_PUBLISH_RETRY_COUNT);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_VIDEO_PUBLISH_RETRY_COUNT;
  return Math.min(Math.floor(raw), 24);
}

function shouldRetryVideoPublish(status: number, payload: MetaErrorPayload | null): boolean {
  if (status !== 400 && status !== 500 && status !== 503) return false;
  const message = (payload?.error?.message || "").toLowerCase();
  return (
    message.includes("processing") ||
    message.includes("please wait") ||
    message.includes("not ready") ||
    message.includes("temporarily unavailable") ||
    message.includes("try again")
  );
}

async function createContainer(input: {
  apiBase: string;
  accountId: string;
  accessToken: string;
  text: string;
  mediaUrl?: string;
  mediaKind?: "video" | "image" | "thumbnail";
  signal: AbortSignal;
}): Promise<{ ok: true; creationId: string } | { ok: false; status: number; raw: string }> {
  const url = `${input.apiBase}/${input.accountId}/threads`;
  const body = new URLSearchParams({
    text: input.text,
    access_token: input.accessToken
  });

  if (input.mediaUrl && input.mediaKind === "video") {
    body.set("media_type", "VIDEO");
    body.set("video_url", input.mediaUrl);
  } else if (input.mediaUrl) {
    body.set("media_type", "IMAGE");
    body.set("image_url", input.mediaUrl);
  } else {
    body.set("media_type", "TEXT");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: input.signal
  });

  const raw = await readText(response);
  if (!response.ok) {
    return { ok: false, status: response.status, raw };
  }

  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }

  const creationId =
    json && typeof json === "object" && "id" in json ? String((json as { id?: string }).id || "") : "";

  if (!creationId) {
    return { ok: false, status: 502, raw: "threads_create_missing_id" };
  }
  return { ok: true, creationId };
}

async function publishContainer(input: {
  apiBase: string;
  accountId: string;
  accessToken: string;
  creationId: string;
  signal: AbortSignal;
}): Promise<{ ok: true; providerPostId: string } | { ok: false; status: number; raw: string }> {
  const url = `${input.apiBase}/${input.accountId}/threads_publish`;
  const body = new URLSearchParams({
    creation_id: input.creationId,
    access_token: input.accessToken
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: input.signal
  });

  const raw = await readText(response);
  if (!response.ok) {
    return { ok: false, status: response.status, raw };
  }

  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }

  const providerPostId =
    json && typeof json === "object" && "id" in json ? String((json as { id?: string }).id || "") : "";

  if (!providerPostId) {
    return { ok: false, status: 502, raw: "threads_publish_missing_id" };
  }

  return { ok: true, providerPostId };
}

export class ThreadsProviderClient implements ProviderClient {
  async publish(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    const apiBase = (process.env.THREADS_API_BASE_URL || "https://graph.threads.net/v1.0").replace(/\/$/, "");
    const accountId = input.providerAccountId || process.env.THREADS_PROVIDER_ACCOUNT_ID || "";

    if (!accountId) {
      return {
        ok: false,
        errorCode: "THREADS_ACCOUNT_ID_MISSING",
        providerResponseMasked: "threads_provider_account_id_missing"
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const created = await createContainer({
        apiBase,
        accountId,
        accessToken: input.accessToken,
        text: input.body,
        mediaUrl: input.mediaUrl,
        mediaKind: input.mediaKind,
        signal: controller.signal
      });

      if (!created.ok) {
        const payload = parseMetaError(created.raw);
        return {
          ok: false,
          errorCode: classifyThreadsError(created.status, payload),
          providerResponseMasked: `create status=${created.status} body=${maskSnippet(payload?.error?.message || created.raw)}`
        };
      }

      const publishRetryCount = input.mediaKind === "video" ? getVideoPublishRetryCount() : 1;
      const publishRetryIntervalMs = getVideoPublishRetryIntervalMs();
      let activeAccessToken = input.accessToken;
      let rotatedAccessToken: string | undefined;
      let rotatedExpiresIn: number | undefined;
      let published: Awaited<ReturnType<typeof publishContainer>> | null = null;

      for (let attempt = 1; attempt <= publishRetryCount; attempt += 1) {
        published = await publishContainer({
          apiBase,
          accountId,
          accessToken: activeAccessToken,
          creationId: created.creationId,
          signal: controller.signal
        });

        if (published.ok) break;

        const payload = parseMetaError(published.raw);
        if (published.status === 401 || payload?.error?.code === 190) {
          try {
            const refreshed = await refreshThreadsLongLivedToken(activeAccessToken);
            if (refreshed.access_token) {
              activeAccessToken = refreshed.access_token;
              rotatedAccessToken = refreshed.access_token;
              rotatedExpiresIn = typeof refreshed.expires_in === "number" ? refreshed.expires_in : undefined;
              if (attempt < publishRetryCount) {
                continue;
              }
            }
          } catch {
            // Fall through to classified unauthorized response below.
          }
        }
        if (input.mediaKind === "video" && attempt < publishRetryCount && shouldRetryVideoPublish(published.status, payload)) {
          await sleep(publishRetryIntervalMs);
          continue;
        }

        return {
          ok: false,
          errorCode: classifyThreadsError(published.status, payload),
          providerResponseMasked: `publish status=${published.status} body=${maskSnippet(payload?.error?.message || published.raw)}`,
          rotatedAccessToken,
          rotatedExpiresIn
        };
      }

      if (!published || !published.ok) {
        return {
          ok: false,
          errorCode: "THREADS_VIDEO_PROCESSING_TIMEOUT",
          providerResponseMasked: "threads_video_processing_timeout",
          rotatedAccessToken,
          rotatedExpiresIn
        };
      }

      return {
        ok: true,
        providerPostId: published.providerPostId,
        providerResponseMasked: "status=200",
        rotatedAccessToken,
        rotatedExpiresIn
      };
    } catch (error) {
      const err = error as { name?: string; message?: string } | undefined;
      if (err?.name === "AbortError") {
        return {
          ok: false,
          errorCode: "THREADS_TIMEOUT",
          providerResponseMasked: "request_timeout"
        };
      }
      return {
        ok: false,
        errorCode: "THREADS_NETWORK_ERROR",
        providerResponseMasked: `network_error:${maskSnippet(err?.message || "")}`
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
