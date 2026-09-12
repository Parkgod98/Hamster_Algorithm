import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";
import { addStudyDays, studyDateFromTimestamp } from "@/lib/study-day";

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

    const { data: study } = await admin.from(DB.studies).select("postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone").eq("id", studyId).single();
    const { data: member } = await admin.from(DB.studyMembers).select("study_id").eq("study_id", studyId).eq("user_id", user.id).maybeSingle();
    if (!study || !member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const current = studyDateFromTimestamp(new Date().toISOString());
    const time = seoulParts();
    if (time.hour > study.postpone_deadline_hour || (time.hour === study.postpone_deadline_hour && time.minute > study.postpone_deadline_minute)) {
      const deadline = `${String(study.postpone_deadline_hour).padStart(2, "0")}:${String(study.postpone_deadline_minute).padStart(2, "0")}`;
      return NextResponse.json({ error: `미루기 신청 마감(${deadline})이 지났습니다.` }, { status: 409 });
    }

    let consecutive = 0;
    for (let i = 1; i <= study.max_consecutive_postpone; i += 1) {
      const date = addStudyDays(current, -i);
      const { data } = await admin.from(DB.postponements).select("id").eq("study_id", studyId).eq("user_id", user.id).eq("study_date", date).maybeSingle();
      if (!data) break;
      consecutive += 1;
    }
    if (consecutive >= study.max_consecutive_postpone) return NextResponse.json({ error: `연속 미루기는 최대 ${study.max_consecutive_postpone}회입니다.` }, { status: 409 });

    const { error } = await admin.from(DB.postponements).insert({ study_id: studyId, user_id: user.id, study_date: current });
    if (error?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, studyDate: current });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
