import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const { name } = await request.json() as { name?: string };
    const admin = createAdminClient();
    const { data: existing } = await admin.from(DB.studyMembers).select("study_id").eq("user_id", user.id).limit(1).maybeSingle();
    if (existing) return NextResponse.json({ studyId: existing.study_id, existing: true });

    const { data: study, error } = await admin.from(DB.studies).insert({ name: name?.trim() || "햄쮸터", created_by: user.id }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const displayName = (user.user_metadata?.user_name || user.user_metadata?.preferred_username || user.email || "스터디원") as string;
    await admin.from(DB.profiles).upsert({ id: user.id, github_login: user.user_metadata?.user_name ?? null, display_name: displayName });
    const { error: memberError } = await admin.from(DB.studyMembers).insert({ study_id: study.id, user_id: user.id, display_name: displayName, role: "admin" });
    if (memberError) return NextResponse.json({ error: memberError.message }, { status: 500 });
    return NextResponse.json({ studyId: study.id });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
