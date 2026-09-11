import { NextResponse } from "next/server";
import type { Platform } from "@/lib/types";
import { createAdminClient, requireUser } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json() as { studyId?: string; platform?: Platform; externalId?: string; title?: string; difficulty?: string; solvedAt?: string; eventId?: string };
    if (!body.studyId || !body.platform || !body.externalId || !body.difficulty) return NextResponse.json({ error: "missing fields" }, { status: 400 });
    const admin = createAdminClient();
    const { data: membership } = await admin.from("study_members").select("study_id").eq("study_id", body.studyId).eq("user_id", user.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { data: problem, error: problemError } = await admin.from("problems").upsert({ platform: body.platform, external_id: body.externalId, title: body.title ?? "알고리즘 문제", difficulty: body.difficulty }, { onConflict: "platform,external_id" }).select("id").single();
    if (problemError) return NextResponse.json({ error: problemError.message }, { status: 500 });
    const sourceEventId = body.eventId ?? `manual:${user.id}:${body.platform}:${body.externalId}:${body.solvedAt ?? new Date().toISOString()}`;
    const { error } = await admin.from("submissions").insert({ user_id: user.id, study_id: body.studyId, problem_id: problem.id, solved_at: body.solvedAt ?? new Date().toISOString(), source: "manual", source_event_id: sourceEventId });
    if (error?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
