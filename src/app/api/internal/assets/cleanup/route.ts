import { NextResponse } from "next/server";
import { deleteObject, listManagedObjects } from "@/lib/assets/r2";
import { getSupabaseAdminClient } from "@/lib/db/supabase";
import {
  requireInternalApiKey,
  InternalAuthConfigError,
  InternalAuthError
} from "@/lib/internal/require-internal-auth";
import { redactObjectKey } from "@/lib/logging/redaction";

const DEFAULT_LIMIT = 200;

export async function POST(request: Request) {
  try {
    requireInternalApiKey(request);
    const supabase = getSupabaseAdminClient();
    const now = new Date().toISOString();

    const { data: expiredAssets, error: expiredError } = await supabase
      .from("media_assets")
      .select("id,object_key")
      .eq("status", "uploaded")
      .is("deleted_at", null)
      .lt("expires_at", now)
      .order("expires_at", { ascending: true })
      .limit(DEFAULT_LIMIT);

    if (expiredError) {
      return NextResponse.json({ error: "Failed to fetch expired assets" }, { status: 500 });
    }

    let deletedExpired = 0;
    for (const asset of expiredAssets ?? []) {
      try {
        await deleteObject(asset.object_key);
      } catch (error) {
        // Continue and tombstone record even when object is already missing.
        void error;
      }

      const { error: markError } = await supabase
        .from("media_assets")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", asset.id)
        .is("deleted_at", null);
      if (!markError) {
        deletedExpired += 1;
      }
    }

    const listed = await listManagedObjects();
    const keys = (listed.Contents ?? []).map((item) => item.Key).filter(Boolean) as string[];
    let deletedOrphans = 0;

    if (keys.length > 0) {
      const { data: activeRows, error: activeError } = await supabase
        .from("media_assets")
        .select("object_key")
        .in("object_key", keys)
        .is("deleted_at", null);
      if (activeError) {
        return NextResponse.json({ error: "Failed to check orphan keys" }, { status: 500 });
      }

      const active = new Set((activeRows ?? []).map((row) => row.object_key));
      for (const key of keys) {
        if (active.has(key)) continue;
        try {
          await deleteObject(key);
          deletedOrphans += 1;
        } catch (error) {
          console.warn("Orphan delete failed", { objectKey: redactObjectKey(key) });
          void error;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      deletedExpired,
      deletedOrphans
    });
  } catch (error) {
    if (error instanceof InternalAuthError || error instanceof InternalAuthConfigError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
