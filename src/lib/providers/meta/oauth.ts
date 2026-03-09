import crypto from "node:crypto";
import type { SocialProvider } from "@/lib/providers/types";

const META_OAUTH_BASE = "https://www.facebook.com/v23.0/dialog/oauth";
const META_GRAPH_BASE = "https://graph.facebook.com/v23.0";
const THREADS_OAUTH_BASE = "https://threads.net/oauth/authorize";
const THREADS_GRAPH_BASE = "https://graph.threads.net";

type MetaTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

type MetaGraphError = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
  };
};

export function createOauthState(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function createStateVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function buildMetaAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: input.scope,
    state: input.state
  });

  return `${META_OAUTH_BASE}?${params.toString()}`;
}

export async function exchangeMetaCodeForToken(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<MetaTokenResponse> {
  const params = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code
  });

  const response = await fetch(`${META_GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`meta_token_exchange_failed:${response.status}:${maskSnippet(text)}`);
  }
  return JSON.parse(text) as MetaTokenResponse;
}

export async function exchangeThreadsCodeForToken(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<MetaTokenResponse> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
    code: input.code
  });

  const response = await fetch(`${THREADS_GRAPH_BASE}/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`threads_token_exchange_failed:${response.status}:${maskSnippet(text)}`);
  }
  return JSON.parse(text) as MetaTokenResponse;
}

export async function resolveInstagramBusinessAccount(userAccessToken: string): Promise<{
  providerAccountId: string;
  tokenToStore: string;
}> {
  const fields = "id,name,access_token,instagram_business_account{id,username}";
  const params = new URLSearchParams({ fields, access_token: userAccessToken });
  const response = await fetch(`${META_GRAPH_BASE}/me/accounts?${params.toString()}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`instagram_accounts_failed:${response.status}:${maskSnippet(text)}`);
  }

  const parsed = JSON.parse(text) as {
    data?: Array<{
      id?: string;
      access_token?: string;
      instagram_business_account?: { id?: string; username?: string };
    }>;
  };

  const matched =
    parsed.data?.find((item) => item.instagram_business_account?.id && item.access_token) ?? null;

  if (!matched?.instagram_business_account?.id || !matched.access_token) {
    throw new Error("instagram_account_not_found");
  }

  return {
    providerAccountId: matched.instagram_business_account.id,
    tokenToStore: matched.access_token
  };
}

export async function resolveThreadsAccount(userAccessToken: string): Promise<{
  providerAccountId: string;
  tokenToStore: string;
}> {
  // Threads is linked to Instagram business account in Meta Graph.
  const fields = "id,name,access_token,instagram_business_account{id,threads_user_id}";
  const params = new URLSearchParams({ fields, access_token: userAccessToken });
  const response = await fetch(`${META_GRAPH_BASE}/me/accounts?${params.toString()}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`threads_accounts_failed:${response.status}:${maskSnippet(text)}`);
  }

  const parsed = JSON.parse(text) as {
    data?: Array<{
      id?: string;
      access_token?: string;
      instagram_business_account?: { id?: string; threads_user_id?: string };
      threads_user_id?: string;
    }>;
  };

  const matched =
    parsed.data?.find(
      (item) => (item.threads_user_id || item.instagram_business_account?.threads_user_id) && item.access_token
    ) ?? null;

  const threadsUserId = matched?.threads_user_id || matched?.instagram_business_account?.threads_user_id;
  if (!threadsUserId || !matched?.access_token) {
    throw new Error("threads_account_not_found");
  }

  return {
    providerAccountId: threadsUserId,
    tokenToStore: matched.access_token
  };
}

export async function resolveThreadsProfile(accessToken: string): Promise<{
  providerAccountId: string;
  tokenToStore: string;
}> {
  const params = new URLSearchParams({
    fields: "id,username",
    access_token: accessToken
  });
  const response = await fetch(`${THREADS_GRAPH_BASE}/v1.0/me?${params.toString()}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`threads_me_failed:${response.status}:${maskSnippet(text)}`);
  }

  const parsed = JSON.parse(text) as { id?: string; username?: string };
  if (!parsed.id) {
    throw new Error("threads_profile_not_found");
  }

  return {
    providerAccountId: parsed.id,
    tokenToStore: accessToken
  };
}

export function buildThreadsAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scope,
    response_type: "code",
    state: input.state
  });
  return `${THREADS_OAUTH_BASE}?${params.toString()}`;
}

export function metaScopeForProvider(provider: SocialProvider): string {
  if (provider === "instagram") {
    return process.env.INSTAGRAM_OAUTH_SCOPE || "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management";
  }
  if (provider === "threads") {
    return process.env.THREADS_OAUTH_SCOPE || "threads_basic,threads_content_publish";
  }
  return "";
}

export function maskMetaErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const payload = JSON.parse(trimmed) as MetaGraphError;
    const message = payload.error?.message || "";
    return maskSnippet(message || trimmed);
  } catch {
    return maskSnippet(trimmed);
  }
}

function maskSnippet(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 200);
}
