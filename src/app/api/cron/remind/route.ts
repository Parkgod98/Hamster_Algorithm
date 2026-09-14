import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";
import { studyDateFromTimestamp } from "@/lib/study-day";
import { memberProgressForStudyDay } from "@/lib/server-progress";
import { shouldSendReminder } from "@/lib/notification-rules";
import { sendStudyNotificationOnce } from "@/lib/push";

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const studyDate = studyDateFromTimestamp(new Date().toISOString());
  const { data: members, error } = await admin.from(DB.studyMembers).select("study_id,user_id,joined_at");
  if (error) return NextResponse.json({ error: "member lookup failed" }, { status: 500 });

  let checked = 0;
  let eligible = 0;
  let sent = 0;

  for (const member of members ?? []) {
    if (studyDateFromTimestamp(member.joined_at) > studyDate) continue;
    checked += 1;
    const state = await memberProgressForStudyDay(admin, member.study_id, member.user_id, studyDate);
    if (!shouldSendReminder(state)) continue;
    eligible += 1;
    const result = await sendStudyNotificationOnce(admin, {
      studyId: member.study_id,
      userId: member.user_id,
      studyDate,
      kind: "reminder",
    });
    sent += result.sent;
  }

  return NextResponse.json({ ok: true, studyDate, checked, eligible, sent });
}
