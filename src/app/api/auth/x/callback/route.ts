import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/db/supabase";
import { redactToken } from "@/lib/logging/redaction";
import { encryptSecret } from "@/lib/security/encryption";

export const runtime = "nodejs";

type XTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

function getRequiredEnv() {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const missing = [
    !clientId ? "X_CLIENT_ID" : null,
    !clientSecret ? "X_CLIENT_SECRET" : null
  ].filter(Boolean);
  return { clientId, clientSecret, missing };
}

async function exchangeCodeForToken(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<XTokenResponse> {
  const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`, "utf8").toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier
  });

  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`x_token_exchange_failed:${response.status}:${text.slice(0, 200)}`);
  }

  return JSON.parse(text) as XTokenResponse;
}

async function fetchXUserId(accessToken: string): Promise<string> {
  const response = await fetch("https://api.x.com/2/users/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`x_users_me_failed:${response.status}:${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text) as { data?: { id?: string } };
  const userId = parsed.data?.id;
  if (!userId) {
    throw new Error("x_users_me_missing_id");
  }
  return userId;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const oauthErrorDescription = url.searchParams.get("error_description");

  if (oauthError) {
    return NextResponse.json(
      { error: "OAuth authorization failed", provider: "x", reason: oauthError, detail: oauthErrorDescription },
      { status: 400 }
    );
  }
  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  const env = getRequiredEnv();
  if (env.missing.length > 0) {
    return NextResponse.json({ error: "Service misconfigured", missing: env.missing }, { status: 503 });
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data: stateRow, error: stateError } = await supabase
      .from("oauth_connect_states")
      .select("state,provider,brand_id,user_id,code_verifier,redirect_uri,expires_at,used_at")
      .eq("state", state)
      .eq("provider", "x")
      .maybeSingle();

    if (stateError || !stateRow) {
      return NextResponse.json({ error: "Invalid state" }, { status: 400 });
    }
    if (stateRow.used_at) {
      return NextResponse.json({ error: "State already used" }, { status: 400 });
    }
    if (new Date(stateRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "State expired" }, { status: 400 });
    }

    const token = await exchangeCodeForToken({
      clientId: env.clientId as string,
      clientSecret: env.clientSecret as string,
      code,
      redirectUri: stateRow.redirect_uri,
      codeVerifier: stateRow.code_verifier
    });
    if (!token.access_token) {
      return NextResponse.json({ error: "Token exchange returned no access token" }, { status: 502 });
    }

    const providerAccountId = await fetchXUserId(token.access_token);
    const encryptedAccess = encryptSecret(token.access_token);
    const encryptedRefresh = token.refresh_token ? encryptSecret(token.refresh_token) : null;
    const tokenExpiresAt =
      typeof token.expires_in === "number"
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : null;

    const { error: upsertError } = await supabase.from("social_connections").upsert(
      {
        brand_id: stateRow.brand_id,
        provider: "x",
        provider_account_id: providerAccountId,
        access_token_enc: encryptedAccess.encrypted,
        refresh_token_enc: encryptedRefresh?.encrypted ?? null,
        key_version: encryptedAccess.keyVersion,
        token_expires_at: tokenExpiresAt,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "brand_id,provider,provider_account_id"
      }
    );
    if (upsertError) {
      return NextResponse.json({ error: "Failed to save social connection" }, { status: 500 });
    }

    await supabase
      .from("oauth_connect_states")
      .update({ used_at: new Date().toISOString() })
      .eq("state", stateRow.state);

    console.info("[x.callback] connection completed", {
      brandId: stateRow.brand_id,
      userId: stateRow.user_id,
      providerAccountId,
      accessToken: redactToken(token.access_token)
    });

    return NextResponse.json({
      ok: true,
      provider: "x",
      brandId: stateRow.brand_id,
      providerAccountId
    });
  } catch (error) {
    const err = error as { message?: string } | undefined;
    console.error("[x.callback] failed", {
      message: err?.message ?? "unknown_error"
    });
    return NextResponse.json({ error: "OAuth callback failed", provider: "x" }, { status: 500 });
  }
}

