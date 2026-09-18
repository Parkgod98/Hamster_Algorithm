import { NextResponse } from "next/server";
import { parseBaekjoonHubCommit } from "@/lib/baekjoonhub";
import { DB } from "@/lib/db";
import { installationToken } from "@/lib/github-app";
import { createAdminClient, requireUser } from "@/lib/supabase";

const DETAIL_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const { connectionId } = await request.json() as { connectionId?: string };
    if (!connectionId) return NextResponse.json({ error: "connectionId required" }, { status: 400 });

    const admin = createAdminClient();
    const { data: connection } = await admin.from(DB.repositoryConnections)
      .select("id,user_id,study_id,installation_id,github_repository_id,full_name")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!connection || !connection.installation_id) return NextResponse.json({ error: "repository not found" }, { status: 404 });

    const token = await installationToken(connection.installation_id);
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
    let scanned = 0;
    let inserted = 0;

    for (let page = 1; page <= 10; page += 1) {
      const list = await fetch(`https://api.github.com/repos/${connection.full_name}/commits?per_page=100&page=${page}`, { headers });
      if (!list.ok) return NextResponse.json({ error: "github backfill list failed" }, { status: 502 });
      const commits = await list.json() as Array<{ sha: string }>;
      if (!commits.length) break;

      const details = await mapWithConcurrency(commits, DETAIL_CONCURRENCY, async (summary) => {
        const detailRes = await fetch(`https://api.github.com/repos/${connection.full_name}/commits/${summary.sha}`, { headers });
        if (!detailRes.ok) return null;
        return await detailRes.json() as {
          sha: string;
          commit: { message: string; committer: { date: string } | null; author: { date: string } | null };
          files?: Array<{ filename: string }>;
        };
      });

      const parsedByEvent = new Map<string, ReturnType<typeof parseBaekjoonHubCommit>[number]>();
      for (const detail of details) {
        if (!detail) continue;
        const timestamp = detail.commit.committer?.date || detail.commit.author?.date;
        if (!timestamp) continue;
        scanned += 1;
        const parsed = parseBaekjoonHubCommit(connection.github_repository_id, {
          id: detail.sha,
          message: detail.commit.message,
          timestamp,
          modified: (detail.files ?? []).map((file) => file.filename),
        });
        for (const submission of parsed) parsedByEvent.set(submission.sourceEventId, submission);
      }

      const parsed = [...parsedByEvent.values()];
      if (parsed.length) {
        const uniqueProblems = new Map<string, { platform: string; external_id: string; title: string; difficulty: string }>();
        for (const submission of parsed) {
          uniqueProblems.set(`${submission.platform}:${submission.externalId}`, {
            platform: submission.platform,
            external_id: submission.externalId,
            title: submission.title,
            difficulty: submission.difficulty,
          });
        }

        const { data: problems, error: problemError } = await admin.from(DB.problems)
          .upsert([...uniqueProblems.values()], { onConflict: "platform,external_id" })
          .select("id,platform,external_id");
        if (problemError) return NextResponse.json({ error: "problem backfill save failed" }, { status: 500 });

        const problemIdByKey = new Map(
          (problems ?? []).map((problem) => [`${problem.platform}:${problem.external_id}`, problem.id]),
        );
        const submissionRows = parsed.flatMap((submission) => {
          const problemId = problemIdByKey.get(`${submission.platform}:${submission.externalId}`);
          if (!problemId) return [];
          return [{
            user_id: connection.user_id,
            study_id: connection.study_id,
            repository_connection_id: connection.id,
            problem_id: problemId,
            solved_at: submission.solvedAt,
            source: "backfill" as const,
            source_event_id: submission.sourceEventId,
          }];
        });

        if (submissionRows.length) {
          const { data: saved, error: saveError } = await admin.from(DB.submissions)
            .upsert(submissionRows, { onConflict: "source_event_id", ignoreDuplicates: true })
            .select("id");
          if (saveError) return NextResponse.json({ error: "submission backfill save failed" }, { status: 500 });
          inserted += saved?.length ?? 0;
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
