import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { canPostponeWithBacklog } from "@/lib/progress";
import { evaluateMemberProgress, loadStudyProgressContext } from "@/lib/server-progress";
import { createAdminClient, requireUser } from "@/lib/supabase";
import { studyDateFromTimestamp } from "@/lib/study-day";

function seoulParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { hour: get("hour"), minute: get("minute") };
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const { studyId } = await request.json() as { studyId?: string };
    if (!studyId) return NextResponse.json({ error: "studyId required" }, { status: 400 });

    const admin = createAdminClient();
    const current = studyDateFromTimestamp(new Date().toISOString());
    const context = await loadStudyProgressContext(admin, studyId, current, [user.id]);
    const member = context?.members.get(user.id);
    if (!context || !member) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const study = context.study;

    if (context.postponementsByUser.get(user.id)?.has(current)) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const time = seoulParts();
    if (time.hour > study.postpone_deadline_hour || (time.hour === study.postpone_deadline_hour && time.minute > study.postpone_deadline_minute)) {
      const deadline = `${String(study.postpone_deadline_hour).padStart(2, "0")}:${String(study.postpone_deadline_minute).padStart(2, "0")}`;
      return NextResponse.json({ error: `미루기 신청 마감(${deadline})이 지났습니다.` }, { status: 409 });
    }

    const progress = evaluateMemberProgress(context, user.id, current);
    if (!progress) return NextResponse.json({ error: "진행 상태를 계산하지 못했습니다." }, { status: 409 });
    if (progress.state === "complete") return NextResponse.json({ error: "오늘까지 필요한 인증을 이미 완료했습니다." }, { status: 409 });
    if (!canPostponeWithBacklog(progress, study.max_consecutive_postpone)) {
      const needToRepay = progress.backlogCount - study.max_consecutive_postpone;
      return NextResponse.json({
        error: `현재 ${progress.backlogCount}일치가 밀려 있습니다. 최소 ${needToRepay}일치를 완전히 상환해야 오늘 미룰 수 있습니다.`,
        backlogCount: progress.backlogCount,
        requiredRepaymentDays: needToRepay,
      }, { status: 409 });
    }

    const { error } = await admin.from(DB.postponements).insert({ study_id: studyId, user_id: user.id, study_date: current });
    if (error?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, studyDate: current, backlogCount: progress.backlogCount });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
