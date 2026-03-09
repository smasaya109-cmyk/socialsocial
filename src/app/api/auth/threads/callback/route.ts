import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/db/supabase";
import { redactToken } from "@/lib/logging/redaction";
import {
  exchangeThreadsCodeForToken,
  maskMetaErrorMessage,
  resolveThreadsProfile
} from "@/lib/providers/meta/oauth";
import { encryptSecret } from "@/lib/security/encryption";

export const runtime = "nodejs";

function getRequiredEnv() {
  const clientId = process.env.META_CLIENT_ID;
  const clientSecret = process.env.META_CLIENT_SECRET;
  const missing = [!clientId ? "META_CLIENT_ID" : null, !clientSecret ? "META_CLIENT_SECRET" : null].filter(Boolean);
  return { clientId, clientSecret, missing };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const oauthErrorDescription = url.searchParams.get("error_description");

  if (oauthError) {
    return NextResponse.json(
      {
        error: "OAuth authorization failed",
        provider: "threads",
        reason: oauthError,
        detail: oauthErrorDescription
      },
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
      .select("state,provider,brand_id,user_id,redirect_uri,expires_at,used_at")
      .eq("state", state)
      .eq("provider", "threads")
      .maybeSingle();

    if (stateError || !stateRow) return NextResponse.json({ error: "Invalid state" }, { status: 400 });
    if (stateRow.used_at) return NextResponse.json({ error: "State already used" }, { status: 400 });
    if (new Date(stateRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "State expired" }, { status: 400 });
    }

    const token = await exchangeThreadsCodeForToken({
      clientId: env.clientId as string,
      clientSecret: env.clientSecret as string,
      code,
      redirectUri: stateRow.redirect_uri
    });
    if (!token.access_token) {
      return NextResponse.json({ error: "Token exchange returned no access token" }, { status: 502 });
    }

    const account = await resolveThreadsProfile(token.access_token);
    const encryptedAccess = encryptSecret(account.tokenToStore);
    const tokenExpiresAt =
      typeof token.expires_in === "number"
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : null;

    const { error: upsertError } = await supabase.from("social_connections").upsert(
      {
        brand_id: stateRow.brand_id,
        provider: "threads",
        provider_account_id: account.providerAccountId,
        access_token_enc: encryptedAccess.encrypted,
        refresh_token_enc: null,
        key_version: encryptedAccess.keyVersion,
        token_expires_at: tokenExpiresAt,
        updated_at: new Date().toISOString()
      },
      { onConflict: "brand_id,provider,provider_account_id" }
    );

    if (upsertError) {
      return NextResponse.json({ error: "Failed to save social connection" }, { status: 500 });
    }

    await supabase.from("oauth_connect_states").update({ used_at: new Date().toISOString() }).eq("state", stateRow.state);

    console.info("[threads.callback] connection completed", {
      brandId: stateRow.brand_id,
      userId: stateRow.user_id,
      providerAccountId: account.providerAccountId,
      accessToken: redactToken(account.tokenToStore)
    });

    return NextResponse.json({
      ok: true,
      provider: "threads",
      brandId: stateRow.brand_id,
      providerAccountId: account.providerAccountId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[threads.callback] failed", {
      message: maskMetaErrorMessage(message)
    });
    return NextResponse.json({ error: "OAuth callback failed", provider: "threads" }, { status: 500 });
  }
}
