import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { getPostponementStatus, type PostponementStatus } from "@/lib/postponement-status";
import { evaluateMemberProgress, loadStudyProgressContext } from "@/lib/server-progress";
import { rulesForDate } from "@/lib/rule-version";
import { createAdminClient, requireUser } from "@/lib/supabase";
import { studyDateFromTimestamp } from "@/lib/study-day";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function validStudyId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

async function handle(request: Request, write: boolean) {
  try {
    const user = await requireUser(request);
    let input: { studyId?: unknown; studyDate?: unknown };
    if (write) {
      try {
        const body: unknown = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "잘못된 요청입니다." }, 400);
        input = body;
      } catch {
        return json({ error: "잘못된 요청입니다." }, 400);
      }
    } else {
      input = { studyId: new URL(request.url).searchParams.get("studyId") };
    }
    if (!validStudyId(input.studyId)) return json({ error: "studyId required" }, 400);
    if (input.studyDate !== undefined && (typeof input.studyDate !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(input.studyDate))) return json({ error: "인증 날짜를 확인해주세요." }, 400);

    const current = studyDateFromTimestamp(new Date().toISOString());
    if (write && input.studyDate !== undefined && input.studyDate !== current) {
      return json({ error: "인증일이 바뀌었어요. 달력을 새로고침해주세요.", code: "study-day-changed", studyDate: current }, 409);
    }
    const admin = createAdminClient();
    const context = await loadStudyProgressContext(admin, input.studyId, current, [user.id]);
    if (!context || !context.members.has(user.id)) return json({ error: "forbidden" }, 403);
    const rules = rulesForDate(context.versions, current, context.fallback);
    const progress = evaluateMemberProgress(context, user.id, current);
    const makeStatus = (): PostponementStatus => getPostponementStatus({
      studyDate: current,
      now: new Date().toISOString(),
      limit: rules.maxConsecutivePostpone,
      deadlineHour: rules.postponeDeadlineHour,
      deadlineMinute: rules.postponeDeadlineMinute,
      alreadyPostponed: context.postponementsByUser.get(user.id)?.has(current) ?? false,
      progress,
    });

    // Recheck the clock after I/O; a screen opened before 04:00 must not submit for the next day.
    const latestDate = studyDateFromTimestamp(new Date().toISOString());
    if (current !== latestDate) {
      return json({ error: "인증일이 바뀌었어요. 달력을 새로고침해주세요.", code: "study-day-changed", studyDate: latestDate }, 409);
    }
    const status = makeStatus();
    if (!write) return json({ status });
    if (status.alreadyPostponed) return json({ ok: true, duplicate: true, studyDate: current, status });
    if (!status.canPostpone) {
      return json({ error: status.message, code: status.reason, status,
        backlogCount: status.backlogCount, requiredRepaymentDays: status.requiredRepaymentDays,
      }, status.reason === "unavailable" ? 503 : 409);
    }

    // Never accept client-provided counts, flags or limits. Only this server decision permits INSERT.
    const { error } = await admin.from(DB.postponements).insert({ study_id: input.studyId, user_id: user.id, study_date: current });
    if (error && error.code !== "23505") {
      console.error("postponement insert failed", { code: error.code });
      return json({ error: "ミ루기를 저장하지 못했어요. 잠시 후 다시 확인해주세요.".replace("ミ", "미") }, 503);
    }
    const savedStatus: PostponementStatus = { ...status, canPostpone: false, alreadyPostponed: true,
      reason: "already-postponed", message: "이미 오늘 미루기를 신청했어요." };
    return json({ ok: true, duplicate: error?.code === "23505", studyDate: current,
      backlogCount: status.backlogCount, status: savedStatus });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ error: "unauthorized" }, 401);
    console.error("postponement status unavailable");
    return json({ error: "진행 상태를 확인하지 못했어요. 잠시 후 다시 확인해주세요.", code: "unavailable" }, 503);
  }
}

export async function GET(request: Request) {
  return handle(request, false);
}

export async function POST(request: Request) {
  return handle(request, true);
}
