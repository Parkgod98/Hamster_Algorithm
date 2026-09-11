import { NextResponse } from "next/server";
import { installationToken } from "@/lib/github-app";
import { createAdminClient, requireUser } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const { installationId, studyId } = await request.json() as { installationId?: number; studyId?: string };
    if (!installationId || !studyId) return NextResponse.json({ error: "missing fields" }, { status: 400 });
    const admin = createAdminClient();
    const { data: membership } = await admin.from("study_members").select("study_id").eq("study_id", studyId).eq("user_id", user.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const token = await installationToken(installationId);
    const response = await fetch("https://api.github.com/installation/repositories?per_page=100", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
    if (!response.ok) return NextResponse.json({ error: "github repository sync failed" }, { status: 502 });
    const result = await response.json() as { repositories: Array<{ id: number; full_name: string }> };
    await admin.from("github_installations").upsert({ installation_id: installationId, user_id: user.id });
    for (const repo of result.repositories) {
      await admin.from("repository_connections").upsert({ user_id: user.id, study_id: studyId, installation_id: installationId, github_repository_id: repo.id, full_name: repo.full_name, active: true }, { onConflict: "github_repository_id" });
    }
    return NextResponse.json({ ok: true, repositories: result.repositories });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
