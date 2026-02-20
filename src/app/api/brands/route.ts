import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth/require-user";
import { getSupabaseUserClient } from "@/lib/db/supabase";

const schema = z.object({
  name: z.string().min(1).max(120),
  plan: z.enum(["free", "solo", "creator", "studio"]).default("free")
});

export async function POST(request: Request) {
  try {
    const { userId, accessToken } = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = getSupabaseUserClient(accessToken);
    const { data: brand, error: brandError } = await supabase
      .from("brands")
      .insert({ name: parsed.data.name, plan: parsed.data.plan })
      .select("id,name,plan,created_at")
      .single();

    if (brandError || !brand) {
      return NextResponse.json({ error: "Failed to create brand" }, { status: 500 });
    }

    const { error: memberError } = await supabase.from("brand_members").insert({
      brand_id: brand.id,
      user_id: userId,
      role: "owner"
    });

    if (memberError) {
      return NextResponse.json({ error: "Failed to create owner membership" }, { status: 500 });
    }

    return NextResponse.json({ brand }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
