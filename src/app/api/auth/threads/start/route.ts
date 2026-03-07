import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth/require-user";
import { assertBrandMemberOrNotFound, BrandAccessError } from "@/lib/authz/brand-membership";
import { getSupabaseAdminClient, getSupabaseUserClient } from "@/lib/db/supabase";
import {
  buildMetaAuthorizeUrl,
  createOauthState,
  createStateVerifier,
  metaScopeForProvider
} from "@/lib/providers/meta/oauth";

export const runtime = "nodejs";

const schema = z.object({
  brandId: z.string().uuid()
});

function requiredEnv() {
  const clientId = process.env.META_CLIENT_ID;
  const redirectUri = process.env.THREADS_OAUTH_REDIRECT_URI;
  const scope = metaScopeForProvider("threads");
  const missing = [!clientId ? "META_CLIENT_ID" : null, !redirectUri ? "THREADS_OAUTH_REDIRECT_URI" : null].filter(
    Boolean
  );
  return { clientId, redirectUri, scope, missing };
}

export async function POST(request: Request) {
  try {
    const env = requiredEnv();
    if (env.missing.length > 0) {
      return NextResponse.json({ error: "Service misconfigured", missing: env.missing }, { status: 503 });
    }

    const { userId, accessToken } = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const userClient = getSupabaseUserClient(accessToken);
    await assertBrandMemberOrNotFound({ supabase: userClient, brandId: parsed.data.brandId });

    const state = createOauthState();
    const verifier = createStateVerifier();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const adminClient = getSupabaseAdminClient();
    const { error: insertError } = await adminClient.from("oauth_connect_states").insert({
      state,
      provider: "threads",
      brand_id: parsed.data.brandId,
      user_id: userId,
      code_verifier: verifier,
      redirect_uri: env.redirectUri,
      expires_at: expiresAt
    });

    if (insertError) {
      return NextResponse.json({ error: "Failed to initialize OAuth state" }, { status: 500 });
    }

    const authorizeUrl = buildMetaAuthorizeUrl({
      clientId: env.clientId as string,
      redirectUri: env.redirectUri as string,
      scope: env.scope,
      state
    });

    return NextResponse.json({
      provider: "threads",
      authorizeUrl,
      state,
      expiresIn: 600
    });
  } catch (error) {
    if (error instanceof AuthError || error instanceof BrandAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
