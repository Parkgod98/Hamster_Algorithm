import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { manualProblemExternalId, manualSolvedAt, normalizeManualSubmissionInput } from "@/lib/manual-submission";
import { shouldSendCompletion } from "@/lib/notification-rules";
import { sendStudyNotificationOnce } from "@/lib/push";
import { memberProgressForStudyDay } from "@/lib/server-progress";
import { studyDateFromTimestamp } from "@/lib/study-day";
import { createAdminClient, requireUser } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const raw = await request.json() as Record<string, unknown>;
    const input = normalizeManualSubmissionInput(raw);
    const studyId = typeof raw.studyId === "string" ? raw.studyId : "";
    if (!studyId || !input) return NextResponse.json({ error: "플랫폼, 난이도, 문제 수, 인증 날짜를 확인해주세요." }, { status: 400 });

    const currentStudyDate = studyDateFromTimestamp(new Date().toISOString());
    if (input.studyDate > currentStudyDate) {
      return NextResponse.json({ error: "미래 날짜에는 수동 인증을 등록할 수 없습니다." }, { status: 409 });
    }

    const admin = createAdminClient();
    const { data: membership } = await admin
      .from(DB.studyMembers)
      .select("study_id,joined_at")
      .eq("study_id", studyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const joinedStudyDate = studyDateFromTimestamp(membership.joined_at);
    if (input.studyDate < joinedStudyDate) {
      return NextResponse.json({ error: "스터디 참여 전 날짜에는 등록할 수 없습니다." }, { status: 409 });
    }

    let beforeState: Awaited<ReturnType<typeof memberProgressForStudyDay>> | null = null;
    try {
      beforeState = await memberProgressForStudyDay(admin, studyId, user.id, currentStudyDate);
    } catch (error) {
      console.error("completion push pre-state lookup failed for manual submission", { studyId, userId: user.id, error });
    }

    const { data: problem, error: problemError } = await admin
      .from(DB.problems)
      .upsert({
        platform: input.platform,
        external_id: manualProblemExternalId(input.platform, input.difficulty),
        title: `${input.difficulty} 수동 인증`,
        difficulty: input.difficulty,
      }, { onConflict: "platform,external_id" })
      .select("id")
      .single();
    if (problemError) return NextResponse.json({ error: problemError.message }, { status: 500 });

    const batchId = crypto.randomUUID();
    const rows = Array.from({ length: input.count }, (_, index) => ({
      user_id: user.id,
      study_id: studyId,
      problem_id: problem.id,
      solved_at: manualSolvedAt(input.studyDate),
      source: "manual" as const,
      source_event_id: `manual:${user.id}:${batchId}:${index + 1}`,
    }));

    const { error } = await admin.from(DB.submissions).insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (beforeState) {
      try {
        const afterState = await memberProgressForStudyDay(admin, studyId, user.id, currentStudyDate);
        if (shouldSendCompletion(beforeState, afterState)) {
          await sendStudyNotificationOnce(admin, { studyId, userId: user.id, studyDate: currentStudyDate, kind: "completion" });
        }
      } catch (notificationError) {
        console.error("completion push failed after manual submission saved", { studyId, userId: user.id, error: notificationError });
      }
    }

    return NextResponse.json({ ok: true, inserted: rows.length, studyDate: input.studyDate });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
