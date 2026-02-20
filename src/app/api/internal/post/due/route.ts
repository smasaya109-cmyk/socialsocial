import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/db/supabase";
import {
  requireInternalApiKey,
  InternalAuthConfigError,
  InternalAuthError
} from "@/lib/internal/require-internal-auth";

export const runtime = "nodejs";
console.info("[boot] /api/internal/post/due module loaded");

const schema = z.object({
  before: z.string().datetime().optional(),
  limit: z.number().int().positive().max(200).default(100)
});

function redactLogText(value: string | undefined): string {
  if (!value) return "";
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9+/_-]{20,}\.[A-Za-z0-9+/_-]{10,}\.[A-Za-z0-9+/_-]{10,}/g, "[redacted-jwt]");
}

function jsonWithRequestId(requestId: string, body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("x-request-id", requestId);
  return response;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.info("[req]", { requestId, route: "/api/internal/post/due", method: request.method });
  if (!process.env.INTERNAL_API_KEY) {
    console.error("[err]", {
      requestId,
      route: "/api/internal/post/due",
      name: "InternalAuthConfigError",
      message: "Service misconfigured: missing INTERNAL_API_KEY",
      stack: ""
    });
    return jsonWithRequestId(
      requestId,
      { error: "Service misconfigured", requestId, missing: ["INTERNAL_API_KEY"] },
      503
    );
  }

  try {
    requireInternalApiKey(request);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return jsonWithRequestId(requestId, { error: parsed.error.flatten(), requestId }, 400);
    }

    const before = parsed.data.before ?? new Date(Date.now() - 60 * 1000).toISOString();
    const supabase = getSupabaseAdminClient();

    const { data, error } = await supabase
      .from("scheduled_posts")
      .select("id")
      .in("status", ["scheduled", "queued"])
      .lte("scheduled_at", before)
      .order("scheduled_at", { ascending: true })
      .limit(parsed.data.limit);

    if (error) {
      console.error("[err]", {
        requestId,
        route: "/api/internal/post/due",
        name: "PostgrestError",
        message: redactLogText(error.message),
        stack: ""
      });
      return jsonWithRequestId(requestId, { error: "Internal", requestId }, 500);
    }

    return jsonWithRequestId(requestId, { postIds: (data ?? []).map((row) => row.id), requestId });
  } catch (error) {
    const err = error as { name?: string; message?: string; stack?: string } | undefined;
    console.error("[err]", {
      requestId,
      route: "/api/internal/post/due",
      name: redactLogText(err?.name),
      message: redactLogText(err?.message),
      stack: redactLogText(err?.stack)
    });
    if (error instanceof InternalAuthError || error instanceof InternalAuthConfigError) {
      return jsonWithRequestId(requestId, { error: error.message, requestId }, error.status);
    }
    return jsonWithRequestId(requestId, { error: "Internal", requestId }, 500);
  }
}
