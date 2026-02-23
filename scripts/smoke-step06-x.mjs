#!/usr/bin/env node

const BASE_URL = mustEnv("BASE_URL");
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const A_EMAIL = process.env.A_EMAIL;
const A_PASSWORD = process.env.A_PASSWORD;
const SMOKE_A_TOKEN = process.env.SMOKE_A_TOKEN;

const WAIT_MS = Number(process.env.SMOKE_WAIT_MS || 180000);
const POLL_MS = Number(process.env.SMOKE_POLL_MS || 10000);
const X_TEST_ACCESS_TOKEN = process.env.X_TEST_ACCESS_TOKEN || "x-smoke-invalid-token";

function mustEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[smoke6] missing env: ${name}`);
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
    .slice(0, 300);
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
    body: JSON.stringify({ name: `smoke6-${Date.now()}`, plan: "free" })
  });
  if (response.status !== 201 || !body?.brand?.id) {
    const requestId = response.headers.get("x-request-id") || "n/a";
    throw new Error(
      `brand create failed status=${response.status} requestId=${requestId} body=${redactSnippet(rawText)}`
    );
  }
  return body.brand.id;
}

async function createXConnection(aToken, brandId) {
  const payload = {
    brandId,
    provider: "x",
    providerAccountId: `xacct-${Date.now()}`,
    accessToken: X_TEST_ACCESS_TOKEN
  };
  const { response, body, rawText } = await api("/api/social-connections", {
    method: "POST",
    headers: authHeaders(aToken),
    body: JSON.stringify(payload)
  });
  if (response.status !== 200 || !body?.connection?.id) {
    const requestId = response.headers.get("x-request-id") || "n/a";
    throw new Error(
      `social connection failed status=${response.status} requestId=${requestId} body=${redactSnippet(rawText)}`
    );
  }
  return body.connection.id;
}

async function createSchedule(aToken, brandId, connectionId) {
  const payload = {
    brandId,
    connectionId,
    body: `step06 smoke post ${Date.now()}`,
    scheduledAt: new Date(Date.now() + 90 * 1000).toISOString(),
    safeModeEnabled: false
  };
  const { response, body, rawText } = await api("/api/schedules", {
    method: "POST",
    headers: authHeaders(aToken),
    body: JSON.stringify(payload)
  });
  if (response.status !== 200 || !body?.scheduledPost?.id) {
    throw new Error(`schedule create failed: ${response.status} body=${redactSnippet(rawText)}`);
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
    const providerResponseMasked = body?.publishLog?.provider_response_masked || null;
    const providerPostId = body?.delivery?.provider_post_id || null;
    const diagnostics = body?.diagnostics || null;
    console.log(`[smoke6] status=${status} errorCode=${errorCode || "-"}`);
    if (status === "posted" || status === "failed" || status === "canceled") {
      return { status, errorCode, publishResult, providerResponseMasked, providerPostId, diagnostics };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error("schedule did not complete within timeout");
}

async function main() {
  console.log(`[smoke6] base=${BASE_URL}`);
  try {
    const aToken = await resolveToken();
    console.log(`[smoke6] token=${mask(aToken)}`);
    const brandId = await createBrand(aToken);
    console.log(`[smoke6] brand=${brandId}`);
    const connectionId = await createXConnection(aToken, brandId);
    console.log(`[smoke6] connection=${connectionId}`);
    const scheduleId = await createSchedule(aToken, brandId, connectionId);
    console.log(`[smoke6] schedule=${scheduleId}`);
    const completed = await waitForCompletion(aToken, scheduleId);

    if (completed.status === "failed" && completed.errorCode && !String(completed.errorCode).startsWith("X_")) {
      throw new Error(`unexpected errorCode for x provider: ${completed.errorCode}`);
    }
    if (completed.status === "posted" && completed.providerResponseMasked === "stub-success") {
      throw new Error("step06 expected provider client path, but got stub-success");
    }
    if (completed.status === "posted" && (!completed.publishResult || !completed.providerPostId)) {
      throw new Error(
        `posted without publish log/delivery record diagnostics=${JSON.stringify(completed.diagnostics || {})}`
      );
    }
    if (completed.status === "failed" && !completed.publishResult) {
      throw new Error("failed without publish log record");
    }
    console.log(`[smoke6] completed status=${completed.status} errorCode=${completed.errorCode || "-"}`);
    console.log(
      `[smoke6] publishResult=${completed.publishResult || "-"} providerPostId=${completed.providerPostId || "-"}`
    );
  } catch (error) {
    console.error(`[smoke6] failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
}

await main();
