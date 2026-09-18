import { NextResponse } from "next/server";
import { parseBaekjoonHubCommit } from "@/lib/baekjoonhub";
import { DB } from "@/lib/db";
import { verifyGithubSignature } from "@/lib/github-app";
import { shouldSendCompletion } from "@/lib/notification-rules";
import { sendStudyNotificationOnce } from "@/lib/push";
import {
  appendProgressSubmissions,
  evaluateMemberProgress,
  loadStudyProgressContext,
  type StudyProgressContext,
} from "@/lib/server-progress";
import { studyDateFromTimestamp } from "@/lib/study-day";
import type { NotificationProgressState } from "@/lib/notification-rules";
import { createAdminClient } from "@/lib/supabase";

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyGithubSignature(raw, request.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event") ?? "unknown";
  if (!deliveryId) return NextResponse.json({ error: "missing delivery id" }, { status: 400 });

  const payload = JSON.parse(raw) as { repository?: { id: number; full_name: string }; commits?: Array<{ id: string; message: string; timestamp: string; added?: string[]; modified?: string[] }> };
  const admin = createAdminClient();
  const { error: eventError } = await admin.from(DB.webhookEvents).insert({ delivery_id: deliveryId, event_name: event, repository_id: payload.repository?.id ?? null });
  if (eventError?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
  if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });
  if (event !== "push" || !payload.repository) return NextResponse.json({ ok: true, ignored: event });

  const { data: connection, error: connectionError } = await admin.from(DB.repositoryConnections).select("id,user_id,study_id").eq("github_repository_id", payload.repository.id).eq("active", true).maybeSingle();
  if (connectionError) return NextResponse.json({ error: connectionError.message }, { status: 500 });
  if (!connection) return NextResponse.json({ ok: true, ignored: "unconnected repository" });

  const currentStudyDate = studyDateFromTimestamp(new Date().toISOString());
  let progressContext: StudyProgressContext | null = null;
  let beforeState: NotificationProgressState | null = null;
  try {
    progressContext = await loadStudyProgressContext(admin, connection.study_id, currentStudyDate, [connection.user_id]);
    beforeState = progressContext ? evaluateMemberProgress(progressContext, connection.user_id, currentStudyDate)?.state ?? null : null;
  } catch (error) {
    console.error("completion push pre-state lookup failed", { deliveryId, error });
  }

  let inserted = 0;
  for (const commit of payload.commits ?? []) {
    for (const submission of parseBaekjoonHubCommit(payload.repository.id, commit)) {
      const { data: problem, error: problemError } = await admin.from(DB.problems).upsert({ platform: submission.platform, external_id: submission.externalId, title: submission.title, difficulty: submission.difficulty }, { onConflict: "platform,external_id" }).select("id").single();
      if (problemError) return NextResponse.json({ error: problemError.message }, { status: 500 });
      const { error } = await admin.from(DB.submissions).insert({ user_id: connection.user_id, study_id: connection.study_id, repository_connection_id: connection.id, problem_id: problem.id, solved_at: submission.solvedAt, source: "github", source_event_id: submission.sourceEventId });
      if (!error) {
        inserted += 1;
        if (progressContext) {
          appendProgressSubmissions(progressContext, connection.user_id, [{
            solvedAt: submission.solvedAt,
            platform: submission.platform,
            difficulty: submission.difficulty,
          }]);
        }
      } else if (error.code !== "23505") {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  }

  if (inserted > 0 && progressContext && beforeState) {
    try {
      const afterState = evaluateMemberProgress(progressContext, connection.user_id, currentStudyDate)?.state ?? "missed";
      if (shouldSendCompletion(beforeState, afterState)) {
        await sendStudyNotificationOnce(admin, {
          studyId: connection.study_id,
          userId: connection.user_id,
          studyDate: currentStudyDate,
          kind: "completion",
        });
      }
    } catch (error) {
      console.error("completion push failed after GitHub submission saved", { deliveryId, error });
    }
  }

  await admin.from(DB.webhookEvents).update({ processed_at: new Date().toISOString() }).eq("delivery_id", deliveryId);
  return NextResponse.json({ ok: true, inserted });
}
