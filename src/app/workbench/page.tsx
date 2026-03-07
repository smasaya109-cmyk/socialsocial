"use client";

import { useMemo, useState } from "react";

type Brand = {
  id: string;
  name: string;
  plan: string;
};

type Connection = {
  id: string;
  provider: "x" | "instagram" | "threads" | "tiktok";
  provider_account_id: string;
  created_at: string;
};

type ScheduleResponse = {
  scheduledPost?: {
    id: string;
    status: string;
    error_code: string | null;
    trigger_run_id?: string | null;
  };
  publishLog?: {
    result: string;
    error_code: string | null;
    provider_response_masked: string | null;
  } | null;
  delivery?: {
    provider_post_id: string | null;
  } | null;
  errorMeta?: {
    title: string;
    message: string;
    retryable: boolean;
  } | null;
  error?: string;
};

const BASE_URL = "";

function formatApiError(input: unknown, fallback: string): string {
  if (!input) return fallback;
  if (typeof input === "string") return input;
  try {
    const serialized = JSON.stringify(input);
    return serialized.length > 280 ? `${serialized.slice(0, 280)}...` : serialized;
  } catch {
    return fallback;
  }
}

export default function WorkbenchPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [brandName, setBrandName] = useState("x-workbench-brand");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [provider, setProvider] = useState<"x" | "instagram" | "threads">("x");
  const [postBody, setPostBody] = useState(`workbench post ${new Date().toISOString()}`);
  const [scheduledPostId, setScheduledPostId] = useState("");
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const hasAuth = token.length > 20;

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }),
    [token]
  );

  const pushLog = (line: string) => setStatusLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev]);

  async function login() {
    setBusy(true);
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnon) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing");
      }
      const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: supabaseAnon,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });
      const json = await response.json();
      if (!response.ok || !json.access_token) {
        throw new Error(
          json.error_description ||
            formatApiError(json.error, "") ||
            `login failed: ${response.status}`
        );
      }
      setToken(json.access_token);
      pushLog("login succeeded");
    } catch (error) {
      pushLog(`login failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function createBrand() {
    if (!hasAuth) return;
    setBusy(true);
    try {
      const response = await fetch(`${BASE_URL}/api/brands`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: brandName, plan: "free" })
      });
      const json = await response.json();
      if (!response.ok || !json.brand?.id) {
        throw new Error(formatApiError(json.error, `create brand failed: ${response.status}`));
      }
      setBrandId(json.brand.id);
      pushLog(`brand created: ${json.brand.id}`);
      await loadConnections(json.brand.id);
    } catch (error) {
      pushLog(`create brand failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function startProviderConnect() {
    if (!hasAuth || !brandId) return;
    setBusy(true);
    try {
      const response = await fetch(`${BASE_URL}/api/auth/${provider}/start`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ brandId })
      });
      const json = await response.json();
      if (!response.ok || !json.authorizeUrl) {
        throw new Error(formatApiError(json.error, `${provider} start failed: ${response.status}`));
      }
      window.open(json.authorizeUrl, "_blank", "noopener,noreferrer");
      pushLog(`opened ${provider} authorize URL in new tab`);
    } catch (error) {
      pushLog(`${provider} connect start failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadConnections(forBrandId?: string) {
    if (!hasAuth) return;
    const targetBrandId = forBrandId || brandId;
    if (!targetBrandId) return;
    setBusy(true);
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnon) throw new Error("supabase env missing");

      const query = new URLSearchParams({
        select: "id,provider,provider_account_id,created_at",
        brand_id: `eq.${targetBrandId}`,
        provider: `eq.${provider}`,
        order: "created_at.desc"
      });
      const response = await fetch(`${supabaseUrl}/rest/v1/social_connections?${query.toString()}`, {
        headers: {
          apikey: supabaseAnon,
          Authorization: `Bearer ${token}`
        }
      });
      const json = await response.json();
      if (!response.ok || !Array.isArray(json)) {
        throw new Error(`load connections failed: ${response.status}`);
      }
      setConnections(json);
      if (json[0]?.id) {
        setConnectionId(json[0].id);
        pushLog(`loaded ${provider} connections: ${json.length}, latest=${json[0].id}`);
      } else {
        pushLog(`loaded ${provider} connections: 0 (connect ${provider} first)`);
      }
    } catch (error) {
      pushLog(`load connections failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function createSchedule() {
    if (!hasAuth || !brandId || !connectionId) return;
    setBusy(true);
    try {
      const scheduledAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      const response = await fetch(`${BASE_URL}/api/schedules`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          brandId,
          connectionId,
          assetId: assetId || undefined,
          body: `${postBody} ${Math.random().toString(36).slice(2, 7)}`,
          scheduledAt,
          safeModeEnabled: false
        })
      });
      const json = await response.json();
      if (!response.ok || !json.scheduledPost?.id) {
        throw new Error(formatApiError(json.error, `create schedule failed: ${response.status}`));
      }
      setScheduledPostId(json.scheduledPost.id);
      pushLog(`schedule created: ${json.scheduledPost.id}`);
    } catch (error) {
      pushLog(`create schedule failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function checkSchedule() {
    if (!hasAuth || !scheduledPostId) return;
    setBusy(true);
    try {
      const response = await fetch(`${BASE_URL}/api/schedules/${scheduledPostId}`, {
        headers: authHeaders
      });
      const json = (await response.json()) as ScheduleResponse;
      if (!response.ok || !json.scheduledPost) {
        throw new Error(formatApiError(json.error, `check schedule failed: ${response.status}`));
      }
      pushLog(
        `status=${json.scheduledPost.status} error=${json.scheduledPost.error_code ?? "-"} providerPostId=${
          json.delivery?.provider_post_id ?? "-"
        }`
      );
      if (json.errorMeta) {
        pushLog(`errorMeta: ${json.errorMeta.title} / ${json.errorMeta.message}`);
      }
    } catch (error) {
      pushLog(`check schedule failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function retrySchedule() {
    if (!hasAuth || !scheduledPostId) return;
    setBusy(true);
    try {
      const response = await fetch(`${BASE_URL}/api/schedules/${scheduledPostId}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ action: "retry" })
      });
      const json = await response.json();
      if (!response.ok || !json.newScheduledPostId) {
        throw new Error(
          formatApiError(json.error, "") ||
            formatApiError(json.reason, "") ||
            `retry failed: ${response.status}`
        );
      }
      setScheduledPostId(json.newScheduledPostId);
      pushLog(`retry enqueued: ${json.newScheduledPostId}`);
    } catch (error) {
      pushLog(`retry failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <section className="hero">
        <h1>X / Instagram / Threads Workbench</h1>
        <p>ログイン後、Brand作成→SNS連携→予約投稿→状態確認をこの画面で実行できます。</p>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>1) Login</h3>
          <input className="wb-input" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            className="wb-input"
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn primary wb-btn" disabled={busy} onClick={login}>
            Login
          </button>
        </article>

        <article className="card">
          <h3>2) Brand</h3>
          <input
            className="wb-input"
            placeholder="brand name"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
          />
          <button className="btn wb-btn" disabled={busy || !hasAuth} onClick={createBrand}>
            Create Brand
          </button>
          <input
            className="wb-input"
            placeholder="brand id"
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
          />
        </article>

        <article className="card">
          <h3>3) Connect Provider</h3>
          <select className="wb-input" value={provider} onChange={(e) => setProvider(e.target.value as "x" | "instagram" | "threads")}>
            <option value="x">X</option>
            <option value="instagram">Instagram</option>
            <option value="threads">Threads</option>
          </select>
          <button className="btn wb-btn" disabled={busy || !hasAuth || !brandId} onClick={startProviderConnect}>
            Start {provider} OAuth
          </button>
          <button className="btn wb-btn" disabled={busy || !hasAuth || !brandId} onClick={() => loadConnections()}>
            Reload {provider} Connections
          </button>
          <input
            className="wb-input"
            placeholder="connection id"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
          />
          <p className="muted">loaded: {connections.length}</p>
        </article>

        <article className="card">
          <h3>4) Schedule</h3>
          <textarea
            className="wb-input"
            rows={4}
            value={postBody}
            onChange={(e) => setPostBody(e.target.value)}
            placeholder="post body"
          />
          <button className="btn wb-btn" disabled={busy || !hasAuth || !brandId || !connectionId} onClick={createSchedule}>
            Create Schedule (+2min)
          </button>
          <input
            className="wb-input"
            placeholder="scheduled post id"
            value={scheduledPostId}
            onChange={(e) => setScheduledPostId(e.target.value)}
          />
          <input
            className="wb-input"
            placeholder="asset id (required for instagram)"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
          />
          <div className="cta-row">
            <button className="btn wb-btn" disabled={busy || !scheduledPostId || !hasAuth} onClick={checkSchedule}>
              Check Status
            </button>
            <button className="btn wb-btn" disabled={busy || !scheduledPostId || !hasAuth} onClick={retrySchedule}>
              Retry Failed
            </button>
          </div>
        </article>
      </section>

      <section>
        <h2>Logs</h2>
        <div className="card wb-log">
          {statusLog.length === 0 ? <p className="muted">no logs yet</p> : null}
          {statusLog.map((line) => (
            <p key={line} className="wb-log-line">
              {line}
            </p>
          ))}
        </div>
      </section>
    </main>
  );
}
