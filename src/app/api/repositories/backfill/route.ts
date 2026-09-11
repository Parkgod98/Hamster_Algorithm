import { NextResponse } from "next/server";
import { parseBaekjoonHubCommit } from "@/lib/baekjoonhub";
import { DB } from "@/lib/db";
import { installationToken } from "@/lib/github-app";
import { createAdminClient, requireUser } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const { connectionId } = await request.json() as { connectionId?: string };
    if (!connectionId) return NextResponse.json({ error: "connectionId required" }, { status: 400 });

    const admin = createAdminClient();
    const { data: connection } = await admin.from(DB.repositoryConnections).select("id,user_id,study_id,installation_id,github_repository_id,full_name").eq("id", connectionId).eq("user_id", user.id).maybeSingle();
    if (!connection || !connection.installation_id) return NextResponse.json({ error: "repository not found" }, { status: 404 });

    const token = await installationToken(connection.installation_id);
    let scanned = 0;
    let inserted = 0;
    for (let page = 1; page <= 10; page += 1) {
      const list = await fetch(`https://api.github.com/repos/${connection.full_name}/commits?per_page=100&page=${page}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      if (!list.ok) return NextResponse.json({ error: "github backfill list failed" }, { status: 502 });
      const commits = await list.json() as Array<{ sha: string }>;
      if (!commits.length) break;

      for (const summary of commits) {
        const detailRes = await fetch(`https://api.github.com/repos/${connection.full_name}/commits/${summary.sha}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
        if (!detailRes.ok) continue;
        const detail = await detailRes.json() as { sha: string; commit: { message: string; committer: { date: string } | null; author: { date: string } | null }; files?: Array<{ filename: string }> };
        const timestamp = detail.commit.committer?.date || detail.commit.author?.date;
        if (!timestamp) continue;
        scanned += 1;

        const parsed = parseBaekjoonHubCommit(connection.github_repository_id, { id: detail.sha, message: detail.commit.message, timestamp, modified: (detail.files ?? []).map((file) => file.filename) });
        for (const submission of parsed) {
          const { data: problem } = await admin.from(DB.problems).upsert({ platform: submission.platform, external_id: submission.externalId, title: submission.title, difficulty: submission.difficulty }, { onConflict: "platform,external_id" }).select("id").single();
          if (!problem) continue;
          const { error } = await admin.from(DB.submissions).insert({ user_id: connection.user_id, study_id: connection.study_id, repository_connection_id: connection.id, problem_id: problem.id, solved_at: submission.solvedAt, source: "backfill", source_event_id: submission.sourceEventId });
          if (!error) inserted += 1;
        }
      }
      if (commits.length < 100) break;
    }
    return NextResponse.json({ ok: true, scanned, inserted });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "unexpected error" }, { status: 500 });
  }
}
