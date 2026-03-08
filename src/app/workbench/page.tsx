"use client";

import { useEffect, useMemo, useState } from "react";

type Provider = "x" | "instagram" | "threads";
type QueueStatus = "scheduled" | "queued" | "processing" | "posted" | "failed" | "canceled";
type CalendarView = "week" | "month";

type Brand = {
  id: string;
  name: string;
  plan: string;
  created_at?: string;
};

type Connection = {
  id: string;
  provider: "x" | "instagram" | "threads" | "tiktok";
  provider_account_id: string;
  created_at: string;
};

type Asset = {
  id: string;
  kind: "video" | "image" | "thumbnail";
  file_name: string;
  status: "pending" | "uploaded" | "deleted";
  created_at: string;
};

type QueueItem = {
  id: string;
  scheduled_at: string;
  status: QueueStatus;
  error_code: string | null;
  connection_id: string;
  asset_id: string | null;
  created_at: string;
};

type Draft = {
  id: string;
  title: string;
  body: string;
  provider: Provider;
  assetId?: string;
  updatedAt: string;
};

type ScheduleResponse = {
  scheduledPost?: {
    id: string;
    status: QueueStatus;
    error_code: string | null;
  };
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
const DRAFTS_STORAGE_KEY = "wb-drafts-v1";

function formatApiError(input: unknown, fallback: string): string {
  if (!input) return fallback;
  if (typeof input === "string") return input;
  try {
    const serialized = JSON.stringify(input);
    return serialized.length > 220 ? `${serialized.slice(0, 220)}...` : serialized;
  } catch {
    return fallback;
  }
}

function toDateTimeLocalString(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function parseDateTimeLocal(value: string): string {
  return new Date(value).toISOString();
}

function statusTone(status: QueueStatus): "neutral" | "good" | "warn" | "bad" {
  if (status === "posted") return "good";
  if (status === "failed" || status === "canceled") return "bad";
  if (status === "processing") return "warn";
  return "neutral";
}

function providerLabel(provider: Provider) {
  if (provider === "x") return "X";
  if (provider === "instagram") return "Instagram";
  return "Threads";
}

function dateLabel(input: string): string {
  return new Date(input).toLocaleString();
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function weekDays(base = new Date()): Date[] {
  const start = new Date(base);
  const dow = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dow);
  start.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }).map((_, idx) => {
    const day = new Date(start);
    day.setDate(start.getDate() + idx);
    return day;
  });
}

function monthGrid(base = new Date()): Date[] {
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  const start = new Date(first);
  const offset = (first.getDay() + 6) % 7;
  start.setDate(first.getDate() - offset);

  const end = new Date(last);
  const endOffset = 6 - ((last.getDay() + 6) % 7);
  end.setDate(last.getDate() + endOffset);

  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function fileKind(mimeType: string): "video" | "image" | "thumbnail" {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  return "thumbnail";
}

export default function WorkbenchPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const [brandName, setBrandName] = useState("My Brand");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState("");

  const [provider, setProvider] = useState<Provider>("x");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState("");

  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState("");
  const [uploadingAsset, setUploadingAsset] = useState(false);

  const [postBody, setPostBody] = useState(`post ${new Date().toISOString()}`);
  const [scheduledAtLocal, setScheduledAtLocal] = useState(
    toDateTimeLocalString(new Date(Date.now() + 5 * 60 * 1000))
  );

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [focusedScheduleId, setFocusedScheduleId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | QueueStatus>("all");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [calendarView, setCalendarView] = useState<CalendarView>("week");
  const [calendarBase, setCalendarBase] = useState<Date>(new Date());
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [draftTitle, setDraftTitle] = useState("Campaign");
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const hasAuth = token.length > 20;

  const authHeaders = useMemo(
    () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
    [token]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Draft[];
      if (!Array.isArray(parsed)) return;
      setDrafts(parsed.slice(0, 20));
    } catch {
      // ignore storage parse error
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts.slice(0, 20)));
    } catch {
      // ignore storage write error
    }
  }, [drafts]);

  const queueFiltered = useMemo(() => {
    let sorted = [...queue].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    if (statusFilter !== "all") {
      sorted = sorted.filter((item) => item.status === statusFilter);
    }
    if (selectedDate) {
      const day = new Date(selectedDate);
      sorted = sorted.filter((item) => isSameDay(new Date(item.scheduled_at), day));
    }
    return sorted;
  }, [queue, statusFilter, selectedDate]);

  const queueStats = useMemo(() => {
    return {
      total: queue.length,
      queued: queue.filter((x) => x.status === "queued" || x.status === "scheduled").length,
      processing: queue.filter((x) => x.status === "processing").length,
      posted: queue.filter((x) => x.status === "posted").length,
      failed: queue.filter((x) => x.status === "failed").length
    };
  }, [queue]);

  const week = useMemo(() => weekDays(calendarBase), [calendarBase]);
  const month = useMemo(() => monthGrid(calendarBase), [calendarBase]);

  const pushLog = (line: string) => {
    setStatusLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 180));
  };

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
        headers: { apikey: supabaseAnon, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const json = await response.json();
      if (!response.ok || !json.access_token) {
        throw new Error(json.error_description || formatApiError(json.error, `login failed: ${response.status}`));
      }

      setToken(json.access_token);
      pushLog("login succeeded");
      await loadBrands(json.access_token);
    } catch (error) {
      pushLog(`login failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadBrands(currentToken = token) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnon || !currentToken) return;

    const query = new URLSearchParams({ select: "id,name,plan,created_at", order: "created_at.desc" });
    const response = await fetch(`${supabaseUrl}/rest/v1/brands?${query.toString()}`, {
      headers: { apikey: supabaseAnon, Authorization: `Bearer ${currentToken}` }
    });

    const json = await response.json();
    if (!response.ok || !Array.isArray(json)) {
      throw new Error(`load brands failed: ${response.status}`);
    }

    setBrands(json);
    const nextBrandId = json[0]?.id || "";
    if (!brandId && nextBrandId) setBrandId(nextBrandId);
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
      await loadBrands();
      await Promise.all([loadConnections(json.brand.id), loadAssets(json.brand.id), loadQueue(json.brand.id)]);
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
      pushLog(`opened ${provider} authorize URL`);
    } catch (error) {
      pushLog(`${provider} connect failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadConnections(targetBrandId = brandId) {
    if (!hasAuth || !targetBrandId) return;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnon) return;

    const query = new URLSearchParams({
      select: "id,provider,provider_account_id,created_at",
      brand_id: `eq.${targetBrandId}`,
      provider: `eq.${provider}`,
      order: "created_at.desc"
    });

    const response = await fetch(`${supabaseUrl}/rest/v1/social_connections?${query.toString()}`, {
      headers: { apikey: supabaseAnon, Authorization: `Bearer ${token}` }
    });

    const json = await response.json();
    if (!response.ok || !Array.isArray(json)) {
      throw new Error(`load connections failed: ${response.status}`);
    }

    setConnections(json);
    if (json[0]?.id) {
      setConnectionId(json[0].id);
      pushLog(`loaded ${provider} connections: ${json.length}`);
    } else {
      setConnectionId("");
      pushLog(`no ${provider} connections`);
    }
  }

  async function loadAssets(targetBrandId = brandId) {
    if (!hasAuth || !targetBrandId) return;
    const response = await fetch(`${BASE_URL}/api/assets?brand_id=${targetBrandId}`, { headers: authHeaders });
    const json = await response.json();
    if (!response.ok || !Array.isArray(json.assets)) {
      throw new Error(formatApiError(json.error, `load assets failed: ${response.status}`));
    }

    const uploadedOnly = (json.assets as Asset[]).filter((asset) => asset.status === "uploaded");
    setAssets(uploadedOnly);
    if (!assetId && uploadedOnly[0]?.id) setAssetId(uploadedOnly[0].id);
  }

  async function uploadAsset(file: File) {
    if (!hasAuth || !brandId) return;
    setUploadingAsset(true);
    try {
      const uploadUrlResponse = await fetch(`${BASE_URL}/api/assets/upload-url`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          brandId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          kind: fileKind(file.type)
        })
      });

      const uploadUrlJson = await uploadUrlResponse.json();
      if (!uploadUrlResponse.ok || !uploadUrlJson.putUrl || !uploadUrlJson.assetId) {
        throw new Error(formatApiError(uploadUrlJson.error, `upload-url failed: ${uploadUrlResponse.status}`));
      }

      const putResponse = await fetch(uploadUrlJson.putUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream"
        },
        body: file
      });
      if (!putResponse.ok) {
        throw new Error(`upload PUT failed: ${putResponse.status}`);
      }

      const finalizeResponse = await fetch(`${BASE_URL}/api/assets/finalize`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ assetId: uploadUrlJson.assetId })
      });
      const finalizeJson = await finalizeResponse.json();
      if (!finalizeResponse.ok || !finalizeJson.ok) {
        throw new Error(formatApiError(finalizeJson.error || finalizeJson.reason, `finalize failed: ${finalizeResponse.status}`));
      }

      pushLog(`asset uploaded: ${uploadUrlJson.assetId}`);
      await loadAssets();
      setAssetId(uploadUrlJson.assetId);
    } catch (error) {
      pushLog(`asset upload failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setUploadingAsset(false);
    }
  }

  async function loadQueue(targetBrandId = brandId) {
    if (!hasAuth || !targetBrandId) return;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnon) return;

    const query = new URLSearchParams({
      select: "id,scheduled_at,status,error_code,connection_id,asset_id,created_at",
      brand_id: `eq.${targetBrandId}`,
      order: "scheduled_at.asc",
      limit: "80"
    });

    const response = await fetch(`${supabaseUrl}/rest/v1/scheduled_posts?${query.toString()}`, {
      headers: { apikey: supabaseAnon, Authorization: `Bearer ${token}` }
    });

    const json = await response.json();
    if (!response.ok || !Array.isArray(json)) {
      throw new Error(`load queue failed: ${response.status}`);
    }

    setQueue(json);
  }

  async function refreshWorkspace() {
    if (!brandId) return;
    setBusy(true);
    try {
      await Promise.all([loadBrands(), loadConnections(), loadAssets(), loadQueue()]);
      pushLog("workspace refreshed");
    } catch (error) {
      pushLog(`refresh failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function createSchedule() {
    if (!hasAuth || !brandId || !connectionId) return;
    setBusy(true);
    try {
      const response = await fetch(`${BASE_URL}/api/schedules`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          brandId,
          connectionId,
          assetId: assetId || undefined,
          body: postBody,
          scheduledAt: parseDateTimeLocal(scheduledAtLocal),
          safeModeEnabled: false
        })
      });
      const json = await response.json();
      if (!response.ok || !json.scheduledPost?.id) {
        throw new Error(formatApiError(json.error, `create schedule failed: ${response.status}`));
      }

      setFocusedScheduleId(json.scheduledPost.id);
      setDraftTitle("Campaign");
      pushLog(`schedule created: ${json.scheduledPost.id}`);
      await loadQueue();
    } catch (error) {
      pushLog(`create schedule failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function checkSchedule(id: string) {
    if (!hasAuth || !id) return;
    setBusy(true);
    try {
      const response = await fetch(`${BASE_URL}/api/schedules/${id}`, { headers: authHeaders });
      const json = (await response.json()) as ScheduleResponse;
      if (!response.ok || !json.scheduledPost) {
        throw new Error(formatApiError(json.error, `check schedule failed: ${response.status}`));
      }

      setFocusedScheduleId(id);
      pushLog(
        `schedule=${id.slice(0, 8)} status=${json.scheduledPost.status} error=${json.scheduledPost.error_code ?? "-"} providerPostId=${json.delivery?.provider_post_id ?? "-"}`
      );
      if (json.errorMeta) {
        pushLog(`hint: ${json.errorMeta.title} / ${json.errorMeta.message}`);
      }
      await loadQueue();
    } catch (error) {
      pushLog(`check failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function retrySchedule(id: string) {
    if (!hasAuth || !id) return;
    setBusy(true);
    try {
      const response = await fetch(`${BASE_URL}/api/schedules/${id}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ action: "retry" })
      });
      const json = await response.json();
      if (!response.ok || !json.newScheduledPostId) {
        throw new Error(formatApiError(json.error || json.reason, `retry failed: ${response.status}`));
      }

      setFocusedScheduleId(json.newScheduledPostId);
      pushLog(`retry queued: ${json.newScheduledPostId}`);
      await loadQueue();
    } catch (error) {
      pushLog(`retry failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  function quickSchedule(minutes: number) {
    setScheduledAtLocal(toDateTimeLocalString(new Date(Date.now() + minutes * 60000)));
  }

  function saveDraft() {
    const title = draftTitle.trim() || `Draft ${new Date().toLocaleString()}`;
    const draft: Draft = {
      id: crypto.randomUUID(),
      title,
      body: postBody,
      provider,
      assetId: assetId || undefined,
      updatedAt: new Date().toISOString()
    };
    setDrafts((prev) => [draft, ...prev].slice(0, 20));
    pushLog(`draft saved: ${title}`);
  }

  function applyDraft(draft: Draft) {
    setDraftTitle(draft.title);
    setPostBody(draft.body);
    setProvider(draft.provider);
    setAssetId(draft.assetId || "");
    pushLog(`draft loaded: ${draft.title}`);
  }

  function deleteDraft(id: string) {
    setDrafts((prev) => prev.filter((item) => item.id !== id));
  }

  function shiftCalendar(direction: -1 | 1) {
    setCalendarBase((prev) => {
      const next = new Date(prev);
      if (calendarView === "week") {
        next.setDate(next.getDate() + direction * 7);
      } else {
        next.setMonth(next.getMonth() + direction);
      }
      return next;
    });
  }

  const calendarDays = calendarView === "week" ? week : month;

  return (
    <main className="wb-app">
      <section className="wb-topbar">
        <div>
          <h1>Publish</h1>
          <p className="muted">Plan, queue, and automate cross-channel posts.</p>
        </div>
        <div className="wb-top-actions">
          <button className="btn wb-btn-inline" disabled={busy || !hasAuth || !brandId} onClick={refreshWorkspace}>
            Refresh
          </button>
          <span className={`wb-presence ${hasAuth ? "on" : "off"}`}>{hasAuth ? "Connected" : "Disconnected"}</span>
        </div>
      </section>

      <section className="wb-kpis">
        <article className="wb-kpi"><p>Total</p><strong>{queueStats.total}</strong></article>
        <article className="wb-kpi"><p>Queued</p><strong>{queueStats.queued}</strong></article>
        <article className="wb-kpi"><p>Processing</p><strong>{queueStats.processing}</strong></article>
        <article className="wb-kpi"><p>Posted</p><strong>{queueStats.posted}</strong></article>
        <article className="wb-kpi"><p>Failed</p><strong>{queueStats.failed}</strong></article>
      </section>

      <section className="wb-layout">
        <aside className="wb-sidebar">
          <div className="wb-panel">
            <h3>Account</h3>
            <input className="wb-input" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="wb-input" placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn primary wb-btn" disabled={busy} onClick={login}>Login</button>
          </div>

          <div className="wb-panel">
            <h3>Brands</h3>
            <input className="wb-input" placeholder="new brand" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
            <button className="btn wb-btn" disabled={busy || !hasAuth} onClick={createBrand}>Create</button>
            <div className="wb-brand-list">
              {brands.length === 0 ? <p className="muted">No brands</p> : null}
              {brands.map((brand) => (
                <button key={brand.id} className={`wb-brand-item ${brandId === brand.id ? "active" : ""}`} onClick={() => setBrandId(brand.id)}>
                  <span className="wb-avatar">{initials(brand.name)}</span>
                  <span>
                    <strong>{brand.name}</strong>
                    <small>{brand.plan}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="wb-panel">
            <h3>Channels</h3>
            <select className="wb-input" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
              <option value="x">X</option>
              <option value="instagram">Instagram</option>
              <option value="threads">Threads</option>
            </select>
            <button className="btn wb-btn" disabled={busy || !hasAuth || !brandId} onClick={startProviderConnect}>
              Connect {providerLabel(provider)}
            </button>
            <button className="btn wb-btn" disabled={busy || !hasAuth || !brandId} onClick={() => loadConnections()}>
              Reload
            </button>
            <select className="wb-input" value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
              <option value="">select connection</option>
              {connections.map((conn) => (
                <option key={conn.id} value={conn.id}>{conn.provider_account_id}</option>
              ))}
            </select>
            <p className="muted">{connections.length} connected</p>
          </div>

          <div className="wb-panel">
            <h3>Assets</h3>
            <button className="btn wb-btn" disabled={busy || !hasAuth || !brandId} onClick={() => loadAssets()}>
              Reload Assets
            </button>
            <input
              className="wb-input"
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void uploadAsset(file);
              }}
            />
            <button className="btn wb-btn" disabled={uploadingAsset || !hasAuth || !brandId} onClick={() => pushLog("Select a file to upload")}>Upload Asset</button>
            <select className="wb-input" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">no asset</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.kind} / {asset.file_name}</option>
              ))}
            </select>
            <p className="muted">{uploadingAsset ? "uploading..." : `${assets.length} uploaded`}</p>
          </div>

          <div className="wb-panel">
            <h3>Drafts</h3>
            <button className="btn wb-btn" onClick={saveDraft}>Save Current</button>
            <div className="wb-draft-list">
              {drafts.length === 0 ? <p className="muted">No drafts</p> : null}
              {drafts.map((draft) => (
                <div key={draft.id} className="wb-draft-item">
                  <button className="wb-draft-open" onClick={() => applyDraft(draft)}>{draft.title}</button>
                  <button className="wb-draft-del" onClick={() => deleteDraft(draft.id)}>x</button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="wb-main">
          <div className="wb-panel wb-composer">
            <div className="wb-composer-head">
              <h2>Create Post</h2>
              <div className="wb-badges">
                <span className="wb-badge">{providerLabel(provider)}</span>
                {brandId ? <span className="wb-badge muted">Brand selected</span> : <span className="wb-badge muted">No brand</span>}
              </div>
            </div>

            <input className="wb-input" placeholder="Campaign title" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />

            <textarea className="wb-input wb-editor" rows={9} value={postBody} onChange={(e) => setPostBody(e.target.value)} placeholder="Write your post copy..." />

            <p className="muted">{postBody.length} chars</p>

            <div className="wb-row-2">
              <input className="wb-input" type="datetime-local" value={scheduledAtLocal} onChange={(e) => setScheduledAtLocal(e.target.value)} />
              <div className="wb-quick-time">
                <button className="btn wb-btn-inline" onClick={() => quickSchedule(10)}>+10m</button>
                <button className="btn wb-btn-inline" onClick={() => quickSchedule(30)}>+30m</button>
                <button className="btn wb-btn-inline" onClick={() => quickSchedule(120)}>+2h</button>
                <button className="btn wb-btn-inline" onClick={() => quickSchedule(24 * 60)}>+1d</button>
              </div>
            </div>

            <div className="wb-template-row">
              <button className="btn wb-btn-inline" onClick={() => setPostBody((t) => `${t}\n\n#announcement`)}>Add #announcement</button>
              <button className="btn wb-btn-inline" onClick={() => setPostBody((t) => `${t}\n\nLearn more: https://`)}>Add link CTA</button>
              <button className="btn wb-btn-inline" onClick={() => setPostBody("")}>Clear</button>
            </div>

            {provider === "instagram" && !assetId ? <p className="wb-inline-warn">Instagram requires an asset.</p> : null}

            <div className="cta-row">
              <button className="btn primary wb-btn-inline" disabled={busy || !hasAuth || !brandId || !connectionId} onClick={createSchedule}>Queue Post</button>
              {focusedScheduleId ? <button className="btn wb-btn-inline" disabled={busy || !hasAuth} onClick={() => checkSchedule(focusedScheduleId)}>Check Focused</button> : null}
            </div>

            <div className="wb-preview">
              <h4>Preview</h4>
              <p className="wb-preview-provider">{providerLabel(provider)}</p>
              <p className="wb-preview-text">{postBody || "Your post preview will appear here"}</p>
              <p className="muted">{scheduledAtLocal ? `Scheduled: ${dateLabel(parseDateTimeLocal(scheduledAtLocal))}` : "No schedule"}</p>
            </div>
          </div>
        </section>

        <aside className="wb-rail">
          <div className="wb-panel">
            <div className="wb-rail-head">
              <h3>Queue</h3>
              <select className="wb-input wb-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | QueueStatus)}>
                <option value="all">all</option>
                <option value="queued">queued</option>
                <option value="scheduled">scheduled</option>
                <option value="processing">processing</option>
                <option value="posted">posted</option>
                <option value="failed">failed</option>
              </select>
            </div>

            <div className="wb-queue">
              {queueFiltered.length === 0 ? <p className="muted">No posts</p> : null}
              {queueFiltered.map((item) => (
                <div key={item.id} className={`wb-queue-item tone-${statusTone(item.status)}`}>
                  <p className="wb-queue-line"><strong>{dateLabel(item.scheduled_at)}</strong></p>
                  <p className="wb-queue-line">status: {item.status}</p>
                  <p className="wb-queue-line">error: {item.error_code ?? "-"}</p>
                  <div className="cta-row">
                    <button className="btn wb-btn-inline" disabled={busy || !hasAuth} onClick={() => checkSchedule(item.id)}>Check</button>
                    <button className="btn wb-btn-inline" disabled={busy || !hasAuth || item.status !== "failed"} onClick={() => retrySchedule(item.id)}>Retry</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="wb-panel">
            <div className="wb-rail-head">
              <h3>{calendarView === "week" ? "Week" : "Month"} Calendar</h3>
              <div className="wb-calendar-switch">
                <button className="btn wb-btn-inline" onClick={() => setCalendarView("week")}>Week</button>
                <button className="btn wb-btn-inline" onClick={() => setCalendarView("month")}>Month</button>
              </div>
            </div>

            <div className="wb-calendar-nav">
              <button className="btn wb-btn-inline" onClick={() => shiftCalendar(-1)}>Prev</button>
              <p className="muted">{calendarBase.toLocaleDateString(undefined, { year: "numeric", month: "long" })}</p>
              <button className="btn wb-btn-inline" onClick={() => shiftCalendar(1)}>Next</button>
            </div>

            <div className={calendarView === "week" ? "wb-week" : "wb-month"}>
              {calendarDays.map((day) => {
                const count = queue.filter((post) => isSameDay(new Date(post.scheduled_at), day)).length;
                const isSelected = selectedDate ? isSameDay(new Date(selectedDate), day) : false;
                return (
                  <button
                    key={day.toISOString()}
                    className={`wb-day ${isSelected ? "active" : ""}`}
                    onClick={() => setSelectedDate(isSelected ? "" : day.toISOString())}
                  >
                    <p>{day.toLocaleDateString(undefined, { weekday: calendarView === "week" ? "short" : undefined })}</p>
                    <strong>{day.getDate()}</strong>
                    <span>{count} posts</span>
                  </button>
                );
              })}
            </div>
            {selectedDate ? <p className="muted">Filtered by: {new Date(selectedDate).toLocaleDateString()}</p> : null}
          </div>

          <div className="wb-panel">
            <h3>Activity</h3>
            <div className="wb-log">
              {statusLog.length === 0 ? <p className="muted">no logs yet</p> : null}
              {statusLog.map((line) => (
                <p key={line} className="wb-log-line">{line}</p>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
