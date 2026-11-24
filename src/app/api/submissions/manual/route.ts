import { NextResponse } from "next/server";
import { RPC } from "@/lib/db";
import { manualProblemExternalId, manualSolvedAt, normalizeManualSubmissionInput } from "@/lib/manual-submission";
import { shouldSendCompletion } from "@/lib/notification-rules";
import { rulesForDate } from "@/lib/rule-version";
import { sendStudyNotificationOnce } from "@/lib/push";
import {
  appendProgressSubmissions,
  evaluateMemberProgress,
  loadStudyProgressContext,
  notificationStateForProgress,
} from "@/lib/server-progress";
import { studyDateFromTimestamp } from "@/lib/study-day";
import { createAdminClient, requireUser } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const raw = await request.json() as Record<string, unknown>;
    const input = normalizeManualSubmissionInput(raw);
    const studyId = typeof raw.studyId === "string" ? raw.studyId : "";
    if (!studyId || !input) return NextResponse.json({ error: "플랫폼, 난이도, 문제 수, 인증 날짜를 확인해주세요." }, { status: 400 });
    if (raw.requestId !== undefined && (typeof raw.requestId !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(raw.requestId))) {
      return NextResponse.json({ error: "등록 번호를 확인한 뒤 다시 시도해주세요." }, { status: 400 });
    }
    // Clients loaded before rollout did not send a request ID.
    const requestId = raw.requestId ?? crypto.randomUUID();

    const currentStudyDate = studyDateFromTimestamp(new Date().toISOString());
    if (input.studyDate > currentStudyDate) {
      return NextResponse.json({ error: "미래 날짜에는 수동 인증을 등록할 수 없습니다." }, { status: 409 });
    }

    const admin = createAdminClient();
    const progressContext = await loadStudyProgressContext(admin, studyId, currentStudyDate, [user.id]);
    const membership = progressContext?.members.get(user.id);
    if (!progressContext || !membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    if (input.studyDate < membership.joinedDate) {
      return NextResponse.json({ error: "스터디 참여 전 날짜에는 등록할 수 없습니다." }, { status: 409 });
    }

    if (!rulesForDate(progressContext.versions, input.studyDate).ruleConfig.goals.allowed.includes("algorithm")) {
      return NextResponse.json({ error: "이 날짜의 스터디 규칙에는 알고리즘 목표가 없습니다." }, { status: 409 });
    }

    const beforeState = notificationStateForProgress(evaluateMemberProgress(progressContext, user.id, currentStudyDate));

    const { data: inserted, error } = await admin.rpc(RPC.recordManualBatch, {
      p_user: user.id, p_study: studyId, p_request: requestId, p_day: input.studyDate,
      p_platform: input.platform, p_difficulty: input.difficulty, p_count: input.count,
      p_external_id: manualProblemExternalId(input.platform, input.difficulty),
    });
    if (error?.code === "22023") return NextResponse.json({ error: "등록 번호와 인증 내용을 확인해주세요." }, { status: 409 });
    if (error || typeof inserted !== "boolean") {
      console.error("manual submission write failed", { code: error?.code ?? "invalid-result" });
      return NextResponse.json({ error: "저장 여부를 확인할 수 없어요. 같은 내용으로 다시 눌러주세요." }, { status: 503 });
    }
    if (!inserted) return NextResponse.json({ ok: true, inserted: input.count, duplicate: true, studyDate: input.studyDate });
    const solvedAt = manualSolvedAt(input.studyDate);

    appendProgressSubmissions(progressContext, user.id, Array.from({ length: input.count }, () => ({
      solvedAt,
      platform: input.platform,
      difficulty: input.difficulty,
    })));

    if (beforeState) {
      try {
        const afterState = notificationStateForProgress(evaluateMemberProgress(progressContext, user.id, currentStudyDate));
        if (shouldSendCompletion(beforeState, afterState)) {
          await sendStudyNotificationOnce(admin, { studyId, userId: user.id, studyDate: currentStudyDate, kind: "completion" });
        }
      } catch (notificationError) {
        console.error("completion push failed after manual submission saved", { studyId, userId: user.id, error: notificationError });
      }
    }

    return NextResponse.json({ ok: true, inserted: input.count, studyDate: input.studyDate });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
