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

function buildTokenUrl(baseUrl: string): string {
  const path = process.env.X_API_TOKEN_PATH || "/oauth2/token";
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

type XErrorPayload = {
  title?: string;
  detail?: string;
  type?: string;
  errors?: Array<{ message?: string; title?: string; detail?: string; type?: string }>;
};

function parseXErrorPayload(raw: string): XErrorPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as XErrorPayload;
    if (parsed && typeof parsed === "object") return parsed;
    return null;
  } catch {
    return null;
  }
}

function extractXErrorText(payload: XErrorPayload | null): string {
  if (!payload) return "";
  const values = [
    payload.title,
    payload.detail,
    payload.type,
    payload.errors?.[0]?.title,
    payload.errors?.[0]?.detail,
    payload.errors?.[0]?.message,
    payload.errors?.[0]?.type
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return values;
}

function classifyXError(status: number, payload: XErrorPayload | null): string {
  const text = extractXErrorText(payload);

  if (status === 402) {
    if (text.includes("credit") || text.includes("credits")) return "X_CREDITS_DEPLETED";
    return "X_PAYMENT_REQUIRED";
  }
  if (status === 401) return "X_UNAUTHORIZED";
  if (status === 403) {
    if (text.includes("scope") || text.includes("permission")) return "X_SCOPE_MISSING";
    if (text.includes("suspended") || text.includes("locked")) return "X_ACCOUNT_RESTRICTED";
    return "X_FORBIDDEN";
  }
  if (status === 429) return "X_RATE_LIMIT";
  if (status >= 500) return "X_PROVIDER_UNAVAILABLE";

  if (status === 400) {
    if (text.includes("duplicate") || text.includes("already")) return "X_DUPLICATE_CONTENT";
    if (text.includes("too long") || text.includes("length")) return "X_TEXT_TOO_LONG";
    if (text.includes("invalid request") || text.includes("invalid")) return "X_BAD_REQUEST";
    return "X_BAD_REQUEST";
  }

  return "X_PROVIDER_ERROR";
}

function buildMaskedFailure(status: number, raw: string, payload: XErrorPayload | null): string {
  const text = extractXErrorText(payload);
  const primary = text ? maskResponseSnippet(text) : maskResponseSnippet(raw);
  return `status=${status} body=${primary}`;
}

type XRefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

async function publishOnce(input: {
  url: string;
  accessToken: string;
  body: string;
  signal: AbortSignal;
}): Promise<Response> {
  return fetch(input.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`
    },
    body: JSON.stringify({ text: input.body }),
    signal: input.signal
  });
}

async function refreshAccessToken(baseUrl: string, refreshToken: string): Promise<XRefreshResponse> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("x_refresh_missing_client_credentials");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  const response = await fetch(buildTokenUrl(baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  const raw = await readResponseText(response);
  if (!response.ok) {
    throw new Error(`x_refresh_failed:${response.status}:${maskResponseSnippet(raw)}`);
  }
  return JSON.parse(raw) as XRefreshResponse;
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
      let response = await publishOnce({
        url,
        accessToken: input.accessToken,
        body: input.body,
        signal: controller.signal
      });
      let rotatedAccessToken: string | undefined;
      let rotatedRefreshToken: string | null | undefined;
      let rotatedExpiresIn: number | undefined;

      if (response.status === 401 && input.refreshToken) {
        try {
          const refreshed = await refreshAccessToken(apiBase, input.refreshToken);
          if (refreshed.access_token) {
            rotatedAccessToken = refreshed.access_token;
            rotatedRefreshToken = refreshed.refresh_token ?? input.refreshToken;
            rotatedExpiresIn = typeof refreshed.expires_in === "number" ? refreshed.expires_in : undefined;
            response = await publishOnce({
              url,
              accessToken: refreshed.access_token,
              body: input.body,
              signal: controller.signal
            });
          }
        } catch (refreshError) {
          const err = refreshError as { message?: string } | undefined;
          return {
            ok: false,
            errorCode: "X_REFRESH_FAILED",
            providerResponseMasked: `refresh_failed:${maskResponseSnippet(err?.message ?? "")}`
          };
        }
      }

      if (!response.ok) {
        const raw = await readResponseText(response);
        const payload = parseXErrorPayload(raw);
        return {
          ok: false,
          errorCode: classifyXError(response.status, payload),
          providerResponseMasked: buildMaskedFailure(response.status, raw, payload),
          rotatedAccessToken,
          rotatedRefreshToken,
          rotatedExpiresIn
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
        providerResponseMasked: `status=${response.status}`,
        rotatedAccessToken,
        rotatedRefreshToken,
        rotatedExpiresIn
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
