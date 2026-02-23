import type { ProviderClient, ProviderPublishInput, ProviderPublishResult } from "@/lib/providers/types";

const REQUEST_TIMEOUT_MS = 15_000;

function normalizeBaseUrl(raw: string): string {
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function buildPostUrl(baseUrl: string): string {
  const path = process.env.X_API_POST_PATH || "/tweets";
  if (!path.startsWith("/")) {
    return `${normalizeBaseUrl(baseUrl)}/${path}`;
  }
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

function maskResponseSnippet(text: string): string {
  if (!text) return "";
  return text
    .replace(/[A-Za-z0-9+/_-]{20,}\.[A-Za-z0-9+/_-]{10,}\.[A-Za-z0-9+/_-]{10,}/g, "[redacted-jwt]")
    .slice(0, 240);
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export class XProviderClient implements ProviderClient {
  async publish(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    const apiBase = process.env.X_API_BASE_URL || "https://api.x.com/2";
    if (!apiBase) {
      return {
        ok: false,
        errorCode: "X_NOT_CONFIGURED",
        providerResponseMasked: "x_api_base_missing"
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const url = buildPostUrl(apiBase);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.accessToken}`
        },
        body: JSON.stringify({ text: input.body }),
        signal: controller.signal
      });

      if (!response.ok) {
        const raw = await readResponseText(response);
        const masked = maskResponseSnippet(raw);
        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            errorCode: "X_UNAUTHORIZED",
            providerResponseMasked: `status=${response.status} body=${masked}`
          };
        }
        if (response.status === 429) {
          return {
            ok: false,
            errorCode: "X_RATE_LIMIT",
            providerResponseMasked: `status=429 body=${masked}`
          };
        }
        if (response.status >= 500) {
          return {
            ok: false,
            errorCode: "X_PROVIDER_UNAVAILABLE",
            providerResponseMasked: `status=${response.status} body=${masked}`
          };
        }
        if (response.status === 400) {
          return {
            ok: false,
            errorCode: "X_BAD_REQUEST",
            providerResponseMasked: `status=400 body=${masked}`
          };
        }
        return {
          ok: false,
          errorCode: "X_PROVIDER_ERROR",
          providerResponseMasked: `status=${response.status} body=${masked}`
        };
      }

      let json: unknown = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }

      const providerPostId =
        json && typeof json === "object" && "data" in json
          ? String((json as { data?: { id?: string } }).data?.id || "")
          : "";
      if (!providerPostId) {
        return {
          ok: false,
          errorCode: "X_RESPONSE_INVALID",
          providerResponseMasked: "response_missing_data_id"
        };
      }

      return {
        ok: true,
        providerPostId,
        providerResponseMasked: `status=${response.status}`
      };
    } catch (error) {
      const err = error as { name?: string; message?: string } | undefined;
      if (err?.name === "AbortError") {
        return {
          ok: false,
          errorCode: "X_TIMEOUT",
          providerResponseMasked: "request_timeout"
        };
      }
      return {
        ok: false,
        errorCode: "X_NETWORK_ERROR",
        providerResponseMasked: `network_error:${maskResponseSnippet(err?.message ?? "")}`
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
