import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";
import { studyDateFromTimestamp } from "@/lib/study-day";
import { evaluateMemberProgress, loadStudyProgressContext } from "@/lib/server-progress";
import { isReminderWindow, shouldSendReminder } from "@/lib/notification-rules";
import { sendStudyNotificationOnce } from "@/lib/push";

type MemberRow = { study_id: string; user_id: string; joined_at: string };

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
  const [membersResult, subscriptionsResult, preferencesResult, sentResult] = await Promise.all([
    admin.from(DB.studyMembers).select("study_id,user_id,joined_at"),
    admin.from(DB.pushSubscriptions).select("id,user_id"),
    admin.from(DB.notificationPreferences).select("user_id,reminder_enabled"),
    admin.from(DB.notificationDeliveries)
      .select("study_id,user_id,subscription_id")
      .eq("study_date", studyDate)
      .eq("kind", "reminder")
      .eq("status", "sent"),
  ]);
  if (membersResult.error) return NextResponse.json({ error: "member lookup failed" }, { status: 500 });
  if (subscriptionsResult.error || preferencesResult.error || sentResult.error) {
    return NextResponse.json({ error: "reminder eligibility lookup failed" }, { status: 500 });
  }

  const subscriptionsByUser = new Map<string, string[]>();
  for (const subscription of subscriptionsResult.data ?? []) {
    const list = subscriptionsByUser.get(subscription.user_id) ?? [];
    list.push(subscription.id);
    subscriptionsByUser.set(subscription.user_id, list);
  }
  const reminderEnabledByUser = new Map(
    (preferencesResult.data ?? []).map((preference) => [preference.user_id, preference.reminder_enabled]),
  );
  const sentByStudyUser = new Map<string, Set<string>>();
  for (const delivery of sentResult.data ?? []) {
    if (!delivery.subscription_id) continue;
    const key = `${delivery.study_id}:${delivery.user_id}`;
    const sent = sentByStudyUser.get(key) ?? new Set<string>();
    sent.add(delivery.subscription_id);
    sentByStudyUser.set(key, sent);
  }

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
  const candidatesByStudy = new Map<string, MemberRow[]>();

  for (const member of (membersResult.data ?? []) as MemberRow[]) {
    if (studyDateFromTimestamp(member.joined_at) > studyDate) continue;
    summary.checked += 1;

    const subscriptions = subscriptionsByUser.get(member.user_id) ?? [];
    if (!subscriptions.length || reminderEnabledByUser.get(member.user_id) === false) {
      summary.skipped += 1;
      continue;
    }

    const sent = sentByStudyUser.get(`${member.study_id}:${member.user_id}`) ?? new Set<string>();
    if (subscriptions.every((subscriptionId) => sent.has(subscriptionId))) {
      summary.skipped += 1;
      continue;
    }

    const candidates = candidatesByStudy.get(member.study_id) ?? [];
    candidates.push(member);
    candidatesByStudy.set(member.study_id, candidates);
  }

  for (const [studyId, members] of candidatesByStudy) {
    let context;
    try {
      context = await loadStudyProgressContext(admin, studyId, studyDate, members.map((member) => member.user_id));
      if (!context) throw new Error("study progress context missing");
    } catch (error) {
      summary.errors += members.length;
      console.error("push reminder study progress load failed", { studyId, error });
      continue;
    }

    for (const member of members) {
      try {
        const state = evaluateMemberProgress(context, member.user_id, studyDate)?.state ?? "missed";
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
  }

  console.info("push reminder run completed", { studyDate, now, ...summary });
  return NextResponse.json({ ok: true, studyDate, now, ...summary });
}
