"use client";

import { useEffect, useMemo, useState } from "react";

type Provider = "x" | "instagram" | "threads";
type QueueStatus = "scheduled" | "queued" | "processing" | "posted" | "failed" | "canceled";
type CalendarView = "week" | "month";
type ColumnView = "queue" | "sent" | "failed";

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
  updated_at?: string;
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
const DRAFTS_STORAGE_KEY = "wb-drafts-v2";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://socialsocial-three.vercel.app";
const REVIEWER_EMAIL = process.env.NEXT_PUBLIC_REVIEWER_EMAIL || "";
const REVIEWER_BRAND = process.env.NEXT_PUBLIC_REVIEWER_BRAND_NAME || "";
const REVIEWER_NOTE = process.env.NEXT_PUBLIC_REVIEWER_NOTE || "";

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

function relativeTimeLabel(input?: string): string {
  if (!input) return "unknown";
  const deltaMs = Date.now() - new Date(input).getTime();
  const minutes = Math.round(deltaMs / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
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

function mergeDateWithTime(targetDay: Date, sourceDateTime: string): string {
  const source = new Date(sourceDateTime);
  const merged = new Date(targetDay);
  merged.setHours(source.getHours(), source.getMinutes(), 0, 0);
  return merged.toISOString();
}

function matchesColumn(item: QueueItem, column: ColumnView): boolean {
  if (column === "queue") return ["scheduled", "queued", "processing"].includes(item.status);
  if (column === "sent") return item.status === "posted";
  return ["failed", "canceled"].includes(item.status);
}

function providerHint(provider: Provider): string {
  if (provider === "x") return "Fastest path for reviewer demos. OAuth, text-first flow, direct publish.";
  if (provider === "instagram") return "Requires Meta app approval path, connected Facebook Page, and an image or reel asset.";
  return "Supports text, image, and video. Reconnect if the access token rotates or expires.";
}

function reviewRequirements(provider: Provider): string[] {
  if (provider === "instagram") {
    return [
      "Use a Professional Instagram account connected to a Facebook Page",
      "Show public privacy, terms, contact, and data deletion routes",
      "Attach an image or reel asset before queueing",
      "Demonstrate queued to posted state in the same session"
    ];
  }
  if (provider === "threads") {
    return [
      "Use the Threads app credentials and callback registered in Threads settings",
      "Show legal pages and contact route without authentication",
      "Connect, queue, and verify a posted text, image, or video item",
      "Keep activity logs visible for reviewer troubleshooting"
    ];
  }
  return [
    "Use OAuth with posting scope enabled",
    "Queue a post and confirm posted status",
    "Show public legal and contact routes",
    "Expose failure states and retry actions in the queue"
  ];
}

function reviewSteps(provider: Provider): string[] {
  if (provider === "instagram") {
    return [
      "Login and select the review brand",
      "Connect Instagram and confirm the latest connected account",
      "Upload an image or reel asset",
      "Queue the post and use Check to reveal providerPostId"
    ];
  }
  if (provider === "threads") {
    return [
      "Login and select the review brand",
      "Connect Threads and reload connections",
      "Queue text, image, or video with the latest connection selected",
      "Open Check and activity logs to confirm delivery"
    ];
  }
  return [
    "Login and select the review brand",
    "Connect X",
    "Queue a text post",
    "Use Check to show posted status and provider ID"
  ];
}

function reviewerAccessSummary(): string {
  if (REVIEWER_EMAIL && REVIEWER_BRAND) {
    return `Reviewer login is pre-provisioned for ${REVIEWER_EMAIL}. Select ${REVIEWER_BRAND} after login.`;
  }
  if (REVIEWER_EMAIL) {
    return `Reviewer login is pre-provisioned for ${REVIEWER_EMAIL}.`;
  }
  return "Reviewer login is not configured in public env yet. Add NEXT_PUBLIC_REVIEWER_EMAIL and NEXT_PUBLIC_REVIEWER_BRAND_NAME before sharing this screen.";
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
  const [columnView, setColumnView] = useState<ColumnView>("queue");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [calendarView, setCalendarView] = useState<CalendarView>("week");
  const [calendarBase, setCalendarBase] = useState<Date>(new Date());
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [draftTitle, setDraftTitle] = useState("Campaign");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

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
      setDrafts(parsed.slice(0, 30));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts.slice(0, 30)));
    } catch {
      // ignore
    }
  }, [drafts]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMetaEnter = (event.metaKey || event.ctrlKey) && event.key === "Enter";
      if (!isMetaEnter) return;
      event.preventDefault();
      void createSchedule();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    const sameProvider = connections.filter((conn) => conn.provider === provider);
    if (sameProvider.length === 0) {
      setConnectionId("");
      return;
    }
    if (!connectionId || !sameProvider.some((conn) => conn.id === connectionId)) {
      setConnectionId(sameProvider[0].id);
    }
  }, [provider, connections, connectionId]);

  useEffect(() => {
    if (!hasAuth || !brandId) {
      setAssets([]);
      setAssetId("");
      return;
    }

    setAssetId("");
    void Promise.all([loadConnections(brandId), loadAssets(brandId), loadQueue(brandId)]).catch(() => {
      // surface errors through explicit user actions and activity log
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, hasAuth]);

  useEffect(() => {
    if (!autoRefresh || !hasAuth || !brandId) return;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnon || !token) return;

    const tick = async () => {
      const query = new URLSearchParams({
        select: "id,scheduled_at,status,error_code,connection_id,asset_id,created_at",
        brand_id: `eq.${brandId}`,
        order: "scheduled_at.asc",
        limit: "100"
      });
      const response = await fetch(`${supabaseUrl}/rest/v1/scheduled_posts?${query.toString()}`, {
        headers: { apikey: supabaseAnon, Authorization: `Bearer ${token}` }
      });
      const json = await response.json();
      if (response.ok && Array.isArray(json)) {
        setQueue(json);
      }
    };

    const timer = setInterval(() => {
      void tick();
    }, 15000);
    return () => clearInterval(timer);
  }, [autoRefresh, hasAuth, brandId, token]);

  const queueFiltered = useMemo(() => {
    let sorted = [...queue].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    sorted = sorted.filter((item) => matchesColumn(item, columnView));

    if (statusFilter !== "all") {
      sorted = sorted.filter((item) => item.status === statusFilter);
    }
    if (selectedDate) {
      const day = new Date(selectedDate);
      sorted = sorted.filter((item) => isSameDay(new Date(item.scheduled_at), day));
    }
    return sorted;
  }, [queue, statusFilter, selectedDate, columnView]);

  const queueStats = useMemo(() => {
    return {
      total: queue.length,
      queued: queue.filter((x) => x.status === "queued" || x.status === "scheduled").length,
      processing: queue.filter((x) => x.status === "processing").length,
      posted: queue.filter((x) => x.status === "posted").length,
      failed: queue.filter((x) => x.status === "failed" || x.status === "canceled").length
    };
  }, [queue]);

  const providerConnections = useMemo(
    () => connections.filter((conn) => conn.provider === provider),
    [connections, provider]
  );

  const latestProviderConnection = providerConnections[0] ?? null;
  const selectedAsset = useMemo(() => assets.find((asset) => asset.id === assetId) ?? null, [assets, assetId]);

  const reviewReadiness = useMemo(() => {
    const requiresAsset = provider === "instagram";
    return {
      auth: hasAuth,
      brand: Boolean(brandId),
      connection: Boolean(latestProviderConnection),
      asset: !requiresAsset || Boolean(assetId)
    };
  }, [assetId, brandId, hasAuth, latestProviderConnection, provider]);

  const connectionCountByProvider = useMemo(() => {
    return {
      x: connections.filter((conn) => conn.provider === "x").length,
      instagram: connections.filter((conn) => conn.provider === "instagram").length,
      threads: connections.filter((conn) => conn.provider === "threads").length
    };
  }, [connections]);

  const setupProgress = useMemo(() => {
    return {
      loggedIn: hasAuth,
      brandSelected: Boolean(brandId),
      connected: providerConnections.length > 0,
      readyToQueue: Boolean(brandId && connectionId)
    };
  }, [hasAuth, brandId, providerConnections.length, connectionId]);

  const week = useMemo(() => weekDays(calendarBase), [calendarBase]);
  const month = useMemo(() => monthGrid(calendarBase), [calendarBase]);
  const calendarDays = calendarView === "week" ? week : month;

  const pushLog = (line: string) => {
    setStatusLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 200));
  };

  function clearSelection() {
    setSelectedIds([]);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAllVisible() {
    const visibleIds = queueFiltered.map((item) => item.id);
    if (visibleIds.length === 0) return;
    const allSelected = visibleIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  }

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
        throw new Error(
          formatApiError(
            {
              status: response.status,
              requestId: json?.requestId ?? response.headers.get("x-request-id"),
              code: json?.code ?? null,
              hint: json?.hint ?? null,
              error: json?.error ?? null,
              missing: json?.missing ?? null,
              message: json?.message ?? null,
              details: json?.details ?? null
            },
            `create brand failed: ${response.status}`
          )
        );
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
      select: "id,provider,provider_account_id,created_at,updated_at",
      brand_id: `eq.${targetBrandId}`,
      order: "updated_at.desc"
    });

    const response = await fetch(`${supabaseUrl}/rest/v1/social_connections?${query.toString()}`, {
      headers: { apikey: supabaseAnon, Authorization: `Bearer ${token}` }
    });

    const json = await response.json();
    if (!response.ok || !Array.isArray(json)) {
      throw new Error(`load connections failed: ${response.status}`);
    }

    setConnections(json);
    const sameProvider = (json as Connection[]).filter((conn) => conn.provider === provider);
    if (sameProvider[0]?.id) {
      setConnectionId(sameProvider[0].id);
      pushLog(`loaded ${provider} connections: ${sameProvider.length}`);
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
        throw new Error(
          formatApiError(finalizeJson.error || finalizeJson.reason, `finalize failed: ${finalizeResponse.status}`)
        );
      }

      pushLog(`asset uploaded: ${uploadUrlJson.assetId}`);
      await loadAssets();
      setAssetId(uploadUrlJson.assetId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "Failed to fetch") {
        pushLog("asset upload failed: browser could not reach R2 signed URL. Check R2 bucket CORS for PUT from this app origin.");
      } else {
        pushLog(`asset upload failed: ${message}`);
      }
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
      limit: "100"
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
    if (uploadingAsset) {
      pushLog("wait for media upload to finish before queueing");
      return;
    }
    if (provider === "instagram" && !assetId) {
      pushLog("instagram requires a selected image or video asset");
      return;
    }
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
  }

  async function retrySchedule(id: string, scheduledAt?: string) {
    const response = await fetch(`${BASE_URL}/api/schedules/${id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ action: "retry", scheduledAt })
    });
    const json = await response.json();
    if (!response.ok || !json.newScheduledPostId) {
      throw new Error(formatApiError(json.error || json.reason, `retry failed: ${response.status}`));
    }

    setFocusedScheduleId(json.newScheduledPostId);
    pushLog(`retry queued: ${json.newScheduledPostId}`);
  }

  async function cancelSchedule(id: string) {
    const response = await fetch(`${BASE_URL}/api/schedules/${id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ action: "cancel" })
    });
    const json = await response.json();
    if (!response.ok || !json.ok) {
      throw new Error(formatApiError(json.error || json.reason, `cancel failed: ${response.status}`));
    }

    pushLog(`canceled: ${id}`);
  }

  async function reschedule(id: string, newDateIso: string) {
    const response = await fetch(`${BASE_URL}/api/schedules/${id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ action: "reschedule", scheduledAt: newDateIso })
    });
    const json = await response.json();
    if (!response.ok || !json.ok) {
      throw new Error(formatApiError(json.error || json.reason, `reschedule failed: ${response.status}`));
    }

    pushLog(`rescheduled: ${id.slice(0, 8)} -> ${dateLabel(newDateIso)}`);
  }

  async function bulkCheck() {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      for (const id of selectedIds) {
        await checkSchedule(id);
      }
      await loadQueue();
    } catch (error) {
      pushLog(`bulk check failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function bulkRetryFailed() {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      const targets = queue.filter((item) => selectedIds.includes(item.id) && item.status === "failed");
      for (const item of targets) {
        await retrySchedule(item.id);
      }
      clearSelection();
      await loadQueue();
    } catch (error) {
      pushLog(`bulk retry failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function bulkCancelQueue() {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      const targets = queue.filter(
        (item) =>
          selectedIds.includes(item.id) && ["scheduled", "queued", "processing"].includes(item.status)
      );
      for (const item of targets) {
        await cancelSchedule(item.id);
      }
      clearSelection();
      await loadQueue();
    } catch (error) {
      pushLog(`bulk cancel failed: ${error instanceof Error ? error.message : "unknown"}`);
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
    setDrafts((prev) => [draft, ...prev].slice(0, 30));
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

  async function dropToCalendarDay(day: Date, postId: string) {
    const source = queue.find((item) => item.id === postId);
    if (!source) return;

    setBusy(true);
    try {
      if (["scheduled", "queued", "processing"].includes(source.status)) {
        await reschedule(postId, mergeDateWithTime(day, source.scheduled_at));
      } else if (source.status === "failed") {
        await retrySchedule(postId, mergeDateWithTime(day, source.scheduled_at));
      } else {
        pushLog(`drop ignored for status=${source.status}`);
      }
      await loadQueue();
    } catch (error) {
      pushLog(`drop reschedule failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wb-app">
      <section className="wb-topbar">
        <div>
          <h1>Publish</h1>
          <p className="muted">Plan, queue, and automate cross-channel posts.</p>
        </div>
        <div className="wb-top-actions">
          <button className="btn wb-btn-inline" onClick={() => setAutoRefresh((v) => !v)}>
            Auto {autoRefresh ? "On" : "Off"}
          </button>
          <button className="btn wb-btn-inline" disabled={busy || !hasAuth || !brandId} onClick={refreshWorkspace}>
            Refresh
          </button>
          <span className={`wb-presence ${hasAuth ? "on" : "off"}`}>{hasAuth ? "Connected" : "Disconnected"}</span>
        </div>
      </section>

      <section className="wb-setup">
        <div className={`wb-step ${setupProgress.loggedIn ? "done" : ""}`}>1. Login</div>
        <div className={`wb-step ${setupProgress.brandSelected ? "done" : ""}`}>2. Select Brand</div>
        <div className={`wb-step ${setupProgress.connected ? "done" : ""}`}>3. Connect {providerLabel(provider)}</div>
        <div className={`wb-step ${setupProgress.readyToQueue ? "done" : ""}`}>4. Queue First Post</div>
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
            <div className="wb-channel-grid">
              {(["x", "instagram", "threads"] as Provider[]).map((p) => (
                <button
                  key={p}
                  className={`wb-channel-card ${provider === p ? "active" : ""}`}
                  onClick={() => setProvider(p)}
                >
                  <strong>{providerLabel(p)}</strong>
                  <span>{connectionCountByProvider[p]} connected</span>
                </button>
              ))}
            </div>
            <button className="btn wb-btn" disabled={busy || !hasAuth || !brandId} onClick={startProviderConnect}>
              Connect {providerLabel(provider)}
            </button>
            <button className="btn wb-btn" disabled={busy || !hasAuth || !brandId} onClick={() => loadConnections()}>
              Reload All Connections
            </button>
            <div className="wb-connection-state">
              <div className="wb-connection-head">
                <strong>{providerLabel(provider)} Status</strong>
                <span className={`wb-state-pill ${latestProviderConnection ? "ready" : "idle"}`}>
                  {latestProviderConnection ? "Ready" : "Needs connect"}
                </span>
              </div>
              <p className="muted">{providerHint(provider)}</p>
              {latestProviderConnection ? (
                <div className="wb-connection-meta">
                  <p><strong>Latest account</strong> {latestProviderConnection.provider_account_id}</p>
                  <p><strong>Updated</strong> {relativeTimeLabel(latestProviderConnection.updated_at || latestProviderConnection.created_at)}</p>
                  <p><strong>Connection ID</strong> {latestProviderConnection.id.slice(0, 8)}...</p>
                </div>
              ) : (
                <p className="wb-inline-warn">No {providerLabel(provider)} connection yet. Run OAuth, then reload this panel.</p>
              )}
            </div>
            <select className="wb-input" value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
              <option value="">select connection</option>
              {providerConnections.map((conn) => (
                <option key={conn.id} value={conn.id}>
                  {conn.provider_account_id} ({relativeTimeLabel(conn.updated_at || conn.created_at)})
                </option>
              ))}
            </select>
            <p className="muted">{providerConnections.length} {providerLabel(provider)} account(s)</p>
          </div>

          <div className="wb-panel">
            <h3>Review Ready</h3>
            <div className="wb-review-grid">
              <div className={`wb-review-item ${reviewReadiness.auth ? "done" : ""}`}>Auth</div>
              <div className={`wb-review-item ${reviewReadiness.brand ? "done" : ""}`}>Brand</div>
              <div className={`wb-review-item ${reviewReadiness.connection ? "done" : ""}`}>Connection</div>
              <div className={`wb-review-item ${reviewReadiness.asset ? "done" : ""}`}>Asset</div>
            </div>
            <p className="muted">
              {reviewReadiness.auth && reviewReadiness.brand && reviewReadiness.connection && reviewReadiness.asset
                ? `${providerLabel(provider)} can be demoed from this workspace.`
                : `Next: ${
                    !reviewReadiness.auth
                      ? "login"
                      : !reviewReadiness.brand
                        ? "create/select a brand"
                        : !reviewReadiness.connection
                          ? `connect ${providerLabel(provider)}`
                          : "attach an asset"
                  }.`}
            </p>
          </div>

          <div className="wb-panel">
            <h3>Review Links</h3>
            <div className="wb-link-list">
              <a href={`${APP_URL}/legal/privacy`} target="_blank" rel="noreferrer">
                Privacy Policy
              </a>
              <a href={`${APP_URL}/legal/terms`} target="_blank" rel="noreferrer">
                Terms of Service
              </a>
              <a href={`${APP_URL}/legal/data-deletion`} target="_blank" rel="noreferrer">
                Data Deletion
              </a>
              <a href={`${APP_URL}/contact`} target="_blank" rel="noreferrer">
                Contact
              </a>
            </div>
            <p className="muted">Meta reviewers typically validate these public routes before or during app review.</p>
          </div>

          <div className="wb-panel">
            <div className="wb-rail-head">
              <h3>Reviewer Access</h3>
              <span className={`wb-state-pill ${REVIEWER_EMAIL ? "ready" : "idle"}`}>
                {REVIEWER_EMAIL ? "Configured" : "Pending"}
              </span>
            </div>
            <p className="muted">{reviewerAccessSummary()}</p>
            <div className="wb-review-access">
              <div className="wb-review-access-item">
                <strong>Login email</strong>
                <span>{REVIEWER_EMAIL || "Set NEXT_PUBLIC_REVIEWER_EMAIL"}</span>
              </div>
              <div className="wb-review-access-item">
                <strong>Review brand</strong>
                <span>{REVIEWER_BRAND || "Set NEXT_PUBLIC_REVIEWER_BRAND_NAME"}</span>
              </div>
              <div className="wb-review-access-item">
                <strong>Password</strong>
                <span>Share through the review submission notes, not the public UI.</span>
              </div>
            </div>
            {REVIEWER_NOTE ? <p className="muted">{REVIEWER_NOTE}</p> : null}
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

            <p className="muted">{postBody.length} chars • Shortcut: Cmd/Ctrl + Enter</p>

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

            <div className="wb-media-box">
              <div className="wb-media-head">
                <div>
                  <h4>Media</h4>
                  <p className="muted">Attach an image or video directly from the composer.</p>
                </div>
                <div className="wb-media-actions">
                  <span className={`wb-state-pill ${selectedAsset ? "ready" : "idle"}`}>
                    {selectedAsset ? `${selectedAsset.kind} selected` : "No media"}
                  </span>
                  <button className="btn wb-btn-inline" disabled={busy || !hasAuth || !brandId} onClick={() => loadAssets()}>
                    Reload Media
                  </button>
                </div>
              </div>

              <div className="wb-row-2">
                <select className="wb-input" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                  <option value="">select image or video</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.kind} / {asset.file_name}
                    </option>
                  ))}
                </select>
                <input
                  className="wb-input"
                  type="file"
                  accept="image/*,video/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void uploadAsset(file);
                  }}
                />
              </div>

              {selectedAsset ? (
                <div className="wb-media-meta">
                  <p><strong>Selected file</strong> {selectedAsset.file_name}</p>
                  <p><strong>Type</strong> {selectedAsset.kind}</p>
                  <p><strong>Uploaded</strong> {dateLabel(selectedAsset.created_at)}</p>
                </div>
              ) : (
                <p className="muted">No media selected. X and Threads can post text only. Instagram requires media.</p>
              )}
              {uploadingAsset ? <p className="wb-inline-warn">Uploading media. Queue Post will unlock when finalize completes.</p> : null}
            </div>

            {provider === "instagram" && !assetId ? <p className="wb-inline-warn">Instagram requires an asset.</p> : null}

            <div className="cta-row">
              <button
                className="btn primary wb-btn-inline"
                disabled={busy || uploadingAsset || !hasAuth || !brandId || !connectionId || (provider === "instagram" && !assetId)}
                onClick={createSchedule}
              >
                {uploadingAsset ? "Uploading..." : "Queue Post"}
              </button>
              {focusedScheduleId ? <button className="btn wb-btn-inline" disabled={busy || !hasAuth} onClick={() => void checkSchedule(focusedScheduleId)}>Check Focused</button> : null}
            </div>

            <div className="wb-preview">
              <h4>Preview</h4>
              <p className="wb-preview-provider">{providerLabel(provider)}</p>
              <p className="wb-preview-text">{postBody || "Your post preview will appear here"}</p>
              <p className="muted">{scheduledAtLocal ? `Scheduled: ${dateLabel(parseDateTimeLocal(scheduledAtLocal))}` : "No schedule"}</p>
            </div>
          </div>

          <div className="wb-panel">
            <div className="wb-rail-head">
              <h3>Reviewer Demo</h3>
              <span className="wb-state-pill ready">Review flow</span>
            </div>
            <p className="muted">{providerHint(provider)}</p>
            <div className="wb-review-columns">
              <div>
                <strong>Review criteria</strong>
                <ul className="wb-review-list">
                  {reviewRequirements(provider).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Reviewer flow</strong>
                <ol className="wb-review-list ordered">
                  {reviewSteps(provider).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        <aside className="wb-rail">
          <div className="wb-panel">
            <div className="wb-column-tabs">
              <button className={`wb-tab ${columnView === "queue" ? "active" : ""}`} onClick={() => setColumnView("queue")}>Queue</button>
              <button className={`wb-tab ${columnView === "sent" ? "active" : ""}`} onClick={() => setColumnView("sent")}>Sent</button>
              <button className={`wb-tab ${columnView === "failed" ? "active" : ""}`} onClick={() => setColumnView("failed")}>Failed</button>
            </div>

            <div className="wb-rail-head">
              <h3>Items</h3>
              <select className="wb-input wb-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | QueueStatus)}>
                <option value="all">all</option>
                <option value="queued">queued</option>
                <option value="scheduled">scheduled</option>
                <option value="processing">processing</option>
                <option value="posted">posted</option>
                <option value="failed">failed</option>
                <option value="canceled">canceled</option>
              </select>
            </div>

            <div className="wb-bulk-row">
              <button className="btn wb-btn-inline" onClick={toggleAllVisible}>Toggle All</button>
              <button className="btn wb-btn-inline" disabled={busy || selectedIds.length === 0} onClick={() => void bulkCheck()}>Bulk Check</button>
              <button className="btn wb-btn-inline" disabled={busy || selectedIds.length === 0} onClick={() => void bulkRetryFailed()}>Bulk Retry</button>
              <button className="btn wb-btn-inline" disabled={busy || selectedIds.length === 0} onClick={() => void bulkCancelQueue()}>Bulk Cancel</button>
              <button className="btn wb-btn-inline" onClick={clearSelection}>Clear</button>
            </div>

            <div className="wb-queue">
              {queueFiltered.length === 0 ? <p className="muted">No posts</p> : null}
              {queueFiltered.map((item) => (
                <div
                  key={item.id}
                  className={`wb-queue-item tone-${statusTone(item.status)}`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/post-id", item.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <label className="wb-queue-check">
                    <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} />
                    <span>{item.id.slice(0, 8)}</span>
                  </label>
                  <p className="wb-queue-line"><strong>{dateLabel(item.scheduled_at)}</strong></p>
                  <p className="wb-queue-line">status: {item.status}</p>
                  <p className="wb-queue-line">error: {item.error_code ?? "-"}</p>
                  <div className="cta-row">
                    <button className="btn wb-btn-inline" disabled={busy || !hasAuth} onClick={() => void checkSchedule(item.id)}>Check</button>
                    <button className="btn wb-btn-inline" disabled={busy || !hasAuth || item.status !== "failed"} onClick={() => void retrySchedule(item.id)}>Retry</button>
                    <button className="btn wb-btn-inline" disabled={busy || !hasAuth || !["scheduled", "queued", "processing"].includes(item.status)} onClick={() => void cancelSchedule(item.id)}>Cancel</button>
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
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const postId = event.dataTransfer.getData("text/post-id");
                      if (!postId) return;
                      void dropToCalendarDay(day, postId);
                    }}
                  >
                    <p>{day.toLocaleDateString(undefined, { weekday: calendarView === "week" ? "short" : undefined })}</p>
                    <strong>{day.getDate()}</strong>
                    <span>{count} posts</span>
                  </button>
                );
              })}
            </div>
            {selectedDate ? <p className="muted">Filtered by: {new Date(selectedDate).toLocaleDateString()}</p> : null}
            <p className="muted">Tip: drag a queue card onto a day to reschedule.</p>
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
