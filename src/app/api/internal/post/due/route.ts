import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/db/supabase";
import {
  requireInternalApiKey,
  InternalAuthConfigError,
  InternalAuthError
} from "@/lib/internal/require-internal-auth";

const schema = z.object({
  before: z.string().datetime().optional(),
  limit: z.number().int().positive().max(200).default(100)
});

export async function POST(request: Request) {
  try {
    requireInternalApiKey(request);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
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
      return NextResponse.json({ error: "Failed to fetch due posts" }, { status: 500 });
    }

    return NextResponse.json({ postIds: (data ?? []).map((row) => row.id) });
  } catch (error) {
    if (error instanceof InternalAuthError || error instanceof InternalAuthConfigError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
