import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";
import { addStudyDays, studyDateFromTimestamp } from "@/lib/study-day";
import { dateRange, evaluateTimeline } from "@/lib/progress";
import { penaltyForConsecutiveMisses, submissionCredit } from "@/lib/rules";

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const current = studyDateFromTimestamp(new Date().toISOString());
  const target = addStudyDays(current, -1);
  const { data: studies } = await admin.from(DB.studies).select("id,created_at,max_presolve_days");
  let penalties = 0;

  for (const study of studies ?? []) {
    const [{ data: members }, { data: subs }, { data: post }] = await Promise.all([
      admin.from(DB.studyMembers).select("user_id").eq("study_id", study.id),
      admin.from(DB.submissions).select("user_id,solved_at,hamster_problems(platform,difficulty)").eq("study_id", study.id),
      admin.from(DB.postponements).select("user_id,study_date").eq("study_id", study.id),
    ]);
    const dates = dateRange(studyDateFromTimestamp(study.created_at), target);

    for (const member of members ?? []) {
      const creditMap = new Map<string, number>();
      for (const submission of subs ?? []) {
        if (submission.user_id !== member.user_id) continue;
        const problem = Array.isArray(submission.hamster_problems) ? submission.hamster_problems[0] : submission.hamster_problems;
        if (!problem) continue;
        const date = studyDateFromTimestamp(submission.solved_at);
        creditMap.set(date, (creditMap.get(date) ?? 0) + submissionCredit(problem.platform, problem.difficulty));
      }
      const postponed = new Set((post ?? []).filter((item) => item.user_id === member.user_id).map((item) => item.study_date));
      const timeline = evaluateTimeline(dates.map((date) => ({ date, credits: creditMap.get(date) ?? 0, postponed: postponed.has(date) })), "__past__", study.max_presolve_days);
      let streak = 0;
      for (let index = timeline.length - 1; index >= 0; index -= 1) {
        if (timeline[index].state === "missed") streak += 1;
        else break;
      }
      if (streak > 0) {
        const amount = penaltyForConsecutiveMisses(streak);
        const { error } = await admin.from(DB.penalties).upsert({ study_id: study.id, user_id: member.user_id, study_date: target, consecutive_misses: streak, amount, reason: "missed" }, { onConflict: "study_id,user_id,study_date" });
        if (!error) penalties += 1;
      }
    }
  }

  return NextResponse.json({ ok: true, target, penalties });
}
