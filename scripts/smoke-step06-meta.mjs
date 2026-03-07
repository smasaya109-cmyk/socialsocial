#!/usr/bin/env node

const BASE_URL = mustEnv("BASE_URL");
const PROVIDER = (process.env.PROVIDER || "threads").toLowerCase();
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const A_EMAIL = process.env.A_EMAIL;
const A_PASSWORD = process.env.A_PASSWORD;
const SMOKE_A_TOKEN = process.env.SMOKE_A_TOKEN;
const CONNECTION_ID = process.env.CONNECTION_ID;
const BRAND_ID = process.env.BRAND_ID;
const ASSET_ID = process.env.ASSET_ID;

const WAIT_MS = Number(process.env.SMOKE_WAIT_MS || 240000);
const POLL_MS = Number(process.env.SMOKE_POLL_MS || 10000);

if (!new Set(["instagram", "threads"]).has(PROVIDER)) {
  console.error(`[smoke6-meta] invalid PROVIDER: ${PROVIDER}`);
  process.exit(1);
}

function mustEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[smoke6-meta] missing env: ${name}`);
    process.exit(1);
  }
  return value;
}

function mask(text) {
  if (!text) return "[redacted]";
  if (text.length < 10) return "[redacted]";
  return `${text.slice(0, 4)}...[redacted]...${text.slice(-3)}`;
}

function redactSnippet(text) {
  if (!text) return "";
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9+/_-]{20,}\.[A-Za-z0-9+/_-]{10,}\.[A-Za-z0-9+/_-]{10,}/g, "[redacted-jwt]")
    .replace(/https?:\/\/[^\s]+/g, "[redacted-url]")
    .slice(0, 320);
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const rawText = await response.text();
  let body = null;
  if ((response.headers.get("content-type") || "").includes("application/json") && rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      body = null;
    }
  }
  return { response, body, rawText };
}

function authHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  };
}

async function loginSupabase(email, password) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL/SUPABASE_ANON_KEY required when SMOKE_A_TOKEN is not provided");
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) {
    throw new Error(`Supabase login failed: ${response.status}`);
  }
  const json = await response.json();
  if (!json.access_token) throw new Error("Supabase login returned no token");
  return json.access_token;
}

async function resolveToken() {
  if (SMOKE_A_TOKEN) return SMOKE_A_TOKEN;
  if (!A_EMAIL || !A_PASSWORD) {
    throw new Error("Provide SMOKE_A_TOKEN or A_EMAIL/A_PASSWORD");
  }
  return loginSupabase(A_EMAIL, A_PASSWORD);
}

async function createBrand(aToken) {
  const { response, body, rawText } = await api("/api/brands", {
    method: "POST",
    headers: authHeaders(aToken),
    body: JSON.stringify({ name: `smoke6-${PROVIDER}-${Date.now()}`, plan: "free" })
  });
  if (response.status !== 201 || !body?.brand?.id) {
    throw new Error(`brand create failed status=${response.status} body=${redactSnippet(rawText)}`);
  }
  return body.brand.id;
}

async function createSchedule(aToken, brandId, connectionId, assetId) {
  const payload = {
    brandId,
    connectionId,
    assetId,
    body: `step06 ${PROVIDER} smoke post ${Date.now()}`,
    scheduledAt: new Date(Date.now() + 90 * 1000).toISOString(),
    safeModeEnabled: false
  };
  const { response, body, rawText } = await api("/api/schedules", {
    method: "POST",
    headers: authHeaders(aToken),
    body: JSON.stringify(payload)
  });
  if (response.status !== 200 || !body?.scheduledPost?.id) {
    throw new Error(`schedule create failed status=${response.status} body=${redactSnippet(rawText)}`);
  }
  return body.scheduledPost.id;
}

async function waitForCompletion(aToken, scheduleId) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const { response, body, rawText } = await api(`/api/schedules/${scheduleId}`, {
      method: "GET",
      headers: authHeaders(aToken)
    });
    if (response.status !== 200) {
      throw new Error(`status fetch failed: ${response.status} body=${redactSnippet(rawText)}`);
    }
    const status = body?.scheduledPost?.status;
    const errorCode = body?.scheduledPost?.error_code || null;
    const publishResult = body?.publishLog?.result || null;
    const providerPostId = body?.delivery?.provider_post_id || null;
    console.log(`[smoke6-meta] status=${status} errorCode=${errorCode || "-"}`);
    if (status === "posted" || status === "failed" || status === "canceled") {
      return { status, errorCode, publishResult, providerPostId };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error("schedule did not complete within timeout");
}

async function main() {
  console.log(`[smoke6-meta] base=${BASE_URL} provider=${PROVIDER}`);
  try {
    if (!CONNECTION_ID) throw new Error("CONNECTION_ID is required");
    if (!ASSET_ID) throw new Error("ASSET_ID is required");

    const aToken = await resolveToken();
    console.log(`[smoke6-meta] token=${mask(aToken)}`);

    const brandId = BRAND_ID || (await createBrand(aToken));
    console.log(`[smoke6-meta] brand=${brandId}`);
    console.log(`[smoke6-meta] connection=${CONNECTION_ID}`);
    console.log(`[smoke6-meta] asset=${ASSET_ID}`);

    const scheduleId = await createSchedule(aToken, brandId, CONNECTION_ID, ASSET_ID);
    console.log(`[smoke6-meta] schedule=${scheduleId}`);

    const completed = await waitForCompletion(aToken, scheduleId);

    if (completed.status === "failed" && completed.errorCode && !String(completed.errorCode).startsWith(PROVIDER.toUpperCase())) {
      console.log(`[smoke6-meta] note: non-provider error=${completed.errorCode}`);
    }
    if (completed.status === "posted" && !completed.providerPostId) {
      throw new Error("posted without providerPostId");
    }

    console.log(`[smoke6-meta] completed status=${completed.status} errorCode=${completed.errorCode || "-"}`);
    console.log(`[smoke6-meta] publishResult=${completed.publishResult || "-"} providerPostId=${completed.providerPostId || "-"}`);
  } catch (error) {
    console.error(`[smoke6-meta] failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
}

await main();
