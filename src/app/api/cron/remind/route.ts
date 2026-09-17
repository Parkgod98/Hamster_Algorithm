import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";
import { studyDateFromTimestamp } from "@/lib/study-day";
import { memberProgressForStudyDay } from "@/lib/server-progress";
import { isReminderWindow, shouldSendReminder } from "@/lib/notification-rules";
import { sendStudyNotificationOnce } from "@/lib/push";

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  if (!isReminderWindow(now)) {
    console.info("push reminder skipped outside delivery window", { now });
    return NextResponse.json({ ok: true, skipped: "outside-reminder-window", now });
  }

  const admin = createAdminClient();
  const studyDate = studyDateFromTimestamp(now);
  const { data: members, error } = await admin.from(DB.studyMembers).select("study_id,user_id,joined_at");
  if (error) return NextResponse.json({ error: "member lookup failed" }, { status: 500 });

  const summary = {
    checked: 0,
    eligible: 0,
    attempted: 0,
    sent: 0,
    failed: 0,
    expired: 0,
    skipped: 0,
    errors: 0,
  };

  for (const member of members ?? []) {
    if (studyDateFromTimestamp(member.joined_at) > studyDate) continue;
    summary.checked += 1;
    try {
      const state = await memberProgressForStudyDay(admin, member.study_id, member.user_id, studyDate);
      if (!shouldSendReminder(state)) {
        summary.skipped += 1;
        continue;
      }
      summary.eligible += 1;
      const result = await sendStudyNotificationOnce(admin, {
        studyId: member.study_id,
        userId: member.user_id,
        studyDate,
        kind: "reminder",
      });
      summary.attempted += result.attempted;
      summary.sent += result.sent;
      summary.failed += result.failed;
      summary.expired += result.expired;
      summary.skipped += result.skipped;
    } catch (memberError) {
      summary.errors += 1;
      console.error("push reminder member processing failed", {
        studyId: member.study_id,
        userId: member.user_id,
        error: memberError,
      });
    }
  }

  console.info("push reminder run completed", { studyDate, now, ...summary });
  return NextResponse.json({ ok: true, studyDate, now, ...summary });
}
