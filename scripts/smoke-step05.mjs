#!/usr/bin/env node

const BASE_URL = mustEnv("BASE_URL");
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const A_EMAIL = process.env.A_EMAIL;
const A_PASSWORD = process.env.A_PASSWORD;
const B_EMAIL = process.env.B_EMAIL;
const B_PASSWORD = process.env.B_PASSWORD;
const SMOKE_A_TOKEN = process.env.SMOKE_A_TOKEN;
const SMOKE_B_TOKEN = process.env.SMOKE_B_TOKEN;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

const WAIT_MS = Number(process.env.SMOKE_WAIT_MS || 150000);
const POLL_MS = Number(process.env.SMOKE_POLL_MS || 10000);

function mustEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[smoke] missing env: ${name}`);
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
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, options);
  const rawText = await response.text();
  let body = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json") && rawText) {
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
    throw new Error("SUPABASE_URL/SUPABASE_ANON_KEY required when tokens are not provided");
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
    throw new Error(`Supabase login failed for ${email}: ${response.status}`);
  }
  const json = await response.json();
  if (!json.access_token) {
    throw new Error(`Supabase login returned no token for ${email}`);
  }
  return json.access_token;
}

async function resolveTokens() {
  if (SMOKE_A_TOKEN && SMOKE_B_TOKEN) {
    console.log("[smoke] using pre-issued tokens");
    return { aToken: SMOKE_A_TOKEN, bToken: SMOKE_B_TOKEN };
  }
  if (!A_EMAIL || !A_PASSWORD || !B_EMAIL || !B_PASSWORD) {
    throw new Error(
      "provide A/B email+password or SMOKE_A_TOKEN/SMOKE_B_TOKEN for authentication"
    );
  }

  console.log("[smoke] signing in A/B via Supabase Auth");
  const [aToken, bToken] = await Promise.all([
    loginSupabase(A_EMAIL, A_PASSWORD),
    loginSupabase(B_EMAIL, B_PASSWORD)
  ]);
  return { aToken, bToken };
}

async function createBrand(aToken) {
  const payload = { name: `smoke-${Date.now()}`, plan: "free" };
  const { response, body, rawText } = await api("/api/brands", {
    method: "POST",
    headers: authHeaders(aToken),
    body: JSON.stringify(payload)
  });
  if (response.status !== 201 || !body?.brand?.id) {
    const reqId = response.headers.get("x-request-id") || "n/a";
    console.error(
      `[smoke] brand create failed status=${response.status} requestId=${reqId} body=${redactSnippet(rawText)}`
    );
    throw new Error(`brand create failed: ${response.status}`);
  }
  console.log("[smoke] brand created");
  return body.brand.id;
}

async function createConnection(aToken, brandId) {
  const payload = {
    brandId,
    provider: "x",
    providerAccountId: `acct-${Date.now()}`,
    accessToken: "smoke-token-access",
    refreshToken: "smoke-token-refresh"
  };
  const { response, body } = await api("/api/social-connections", {
    method: "POST",
    headers: authHeaders(aToken),
    body: JSON.stringify(payload)
  });
  if (response.status !== 200 || !body?.connection?.id) {
    throw new Error(`social connection create failed: ${response.status}`);
  }
  console.log("[smoke] social connection created");
  return body.connection.id;
}

async function createSchedule(aToken, brandId, connectionId) {
  const scheduledAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const payload = {
    brandId,
    connectionId,
    body: `smoke post ${Date.now()}`,
    scheduledAt,
    safeModeEnabled: false
  };

  const { response, body } = await api("/api/schedules", {
    method: "POST",
    headers: authHeaders(aToken),
    body: JSON.stringify(payload)
  });

  if (response.status !== 200 || !body?.scheduledPost?.id) {
    throw new Error(`schedule create failed: ${response.status}`);
  }
  console.log(
    `[smoke] schedule created status=${body.scheduledPost.status} triggerEnqueued=${String(
      body.triggerEnqueued
    )}`
  );
  return body.scheduledPost.id;
}

async function assertBForbiddenOnABrand(bToken, brandId) {
  const payload = {
    brandId,
    connectionId: "11111111-1111-1111-1111-111111111111",
    body: "forbidden test",
    scheduledAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    safeModeEnabled: true
  };
  const { response } = await api("/api/schedules", {
    method: "POST",
    headers: authHeaders(bToken),
    body: JSON.stringify(payload)
  });
  if (response.status !== 404) {
    throw new Error(`expected 404 for B on A brand, got ${response.status}`);
  }
  console.log("[smoke] A/B isolation ok (404)");
}

async function checkInternalDueAuth() {
  if (!INTERNAL_API_KEY) {
    console.log("[smoke] INTERNAL_API_KEY not provided; skip internal-auth smoke");
    return;
  }

  const noHeader = await api("/api/internal/post/due", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  if (noHeader.response.status !== 401) {
    throw new Error(`expected 401 for internal due without key, got ${noHeader.response.status}`);
  }

  const withHeader = await api("/api/internal/post/due", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-api-key": INTERNAL_API_KEY
    },
    body: JSON.stringify({ limit: 5 })
  });
  if (![200, 503].includes(withHeader.response.status)) {
    throw new Error(
      `expected 200 or 503 for internal due with key, got ${withHeader.response.status}`
    );
  }

  console.log(`[smoke] internal due auth check ok (${withHeader.response.status})`);
}

async function waitForScheduleCompletion(aToken, scheduleId) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const { response, body } = await api(`/api/schedules/${scheduleId}`, {
      method: "GET",
      headers: authHeaders(aToken)
    });
    if (response.status !== 200) {
      throw new Error(`schedule status fetch failed: ${response.status}`);
    }
    const status = body?.scheduledPost?.status;
    console.log(`[smoke] schedule status=${status}`);
    if (status === "posted" || status === "failed" || status === "canceled") {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error("schedule did not complete within timeout");
}

async function runUploadRace(aToken, brandId) {
  const req = () =>
    api("/api/assets/upload-url", {
      method: "POST",
      headers: authHeaders(aToken),
      body: JSON.stringify({
        brandId,
        fileName: `race-${Date.now()}.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 600 * 1024 * 1024,
        kind: "video"
      })
    });

  const [r1, r2] = await Promise.all([req(), req()]);
  const statuses = [r1.response.status, r2.response.status].sort((a, b) => a - b);
  const ok = (statuses[0] === 200 && statuses[1] === 409) || (statuses[0] === 409 && statuses[1] === 409);
  if (!ok) {
    throw new Error(`unexpected upload race statuses: ${statuses.join(",")}`);
  }
  console.log(`[smoke] upload race ok statuses=${statuses.join(",")}`);
}

async function main() {
  console.log(`[smoke] base=${BASE_URL}`);
  try {
    const { aToken, bToken } = await resolveTokens();
    console.log(`[smoke] token A=${mask(aToken)} token B=${mask(bToken)}`);

    const brandId = await createBrand(aToken);
    const connectionId = await createConnection(aToken, brandId);
    const scheduleId = await createSchedule(aToken, brandId, connectionId);

    await assertBForbiddenOnABrand(bToken, brandId);
    await checkInternalDueAuth();
    await runUploadRace(aToken, brandId);

    const status = await waitForScheduleCompletion(aToken, scheduleId);
    console.log(`[smoke] schedule completed with status=${status}`);
    console.log("[smoke] step05 smoke passed");
  } catch (error) {
    console.error(`[smoke] failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
}

await main();
