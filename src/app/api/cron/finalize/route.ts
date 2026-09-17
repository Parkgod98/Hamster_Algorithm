import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";
import { addStudyDays, studyDateFromTimestamp } from "@/lib/study-day";
import { dateRange, evaluateTimelineByDay, penaltyLevelForBacklog } from "@/lib/progress";
import { normalizeRuleConfig, penaltyForConsecutiveMisses, submissionCredit } from "@/lib/rules";
import { normalizeRuleVersions, rulesForDate, type EffectiveRules, type RuleVersionRow } from "@/lib/rule-version";
import type { Platform } from "@/lib/types";

type Problem = { platform: Platform; difficulty: string };

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const current = studyDateFromTimestamp(new Date().toISOString());
  const target = addStudyDays(current, -1);
  const { data: studies } = await admin
    .from(DB.studies)
    .select("id,created_at,max_presolve_days,postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone,rule_config");
  let penalties = 0;

  for (const study of studies ?? []) {
    const fallback: EffectiveRules = {
      effectiveFrom: studyDateFromTimestamp(study.created_at),
      ruleConfig: normalizeRuleConfig(study.rule_config),
      postponeDeadlineHour: study.postpone_deadline_hour,
      postponeDeadlineMinute: study.postpone_deadline_minute,
      maxConsecutivePostpone: study.max_consecutive_postpone,
      maxPresolveDays: study.max_presolve_days,
    };
    const [{ data: members }, { data: subs }, { data: post }, versionsResult] = await Promise.all([
      admin.from(DB.studyMembers).select("user_id,joined_at").eq("study_id", study.id),
      admin.from(DB.submissions).select("user_id,solved_at,hamster_problems(platform,difficulty)").eq("study_id", study.id),
      admin.from(DB.postponements).select("user_id,study_date").eq("study_id", study.id),
      admin.from(DB.studyRuleVersions).select("effective_from,rule_config,postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone,max_presolve_days").eq("study_id", study.id).order("effective_from", { ascending: true }),
    ]);
    const versions = normalizeRuleVersions((versionsResult.error ? [] : versionsResult.data ?? []) as RuleVersionRow[], normalizeRuleConfig);

    for (const member of members ?? []) {
      const joinedDate = studyDateFromTimestamp(member.joined_at);
      if (target < joinedDate) continue;
      const dates = dateRange(joinedDate, target);
      const creditMap = new Map<string, number>();
      for (const submission of subs ?? []) {
        if (submission.user_id !== member.user_id) continue;
        const rawProblem = Array.isArray(submission.hamster_problems) ? submission.hamster_problems[0] : submission.hamster_problems;
        const problem = rawProblem as Problem | null;
        if (!problem) continue;
        const date = studyDateFromTimestamp(submission.solved_at);
        if (date > target) continue;
        const config = rulesForDate(versions, date, fallback).ruleConfig;
        creditMap.set(date, (creditMap.get(date) ?? 0) + submissionCredit(problem.platform, problem.difficulty, config));
      }
      const postponed = new Set((post ?? []).filter((item) => item.user_id === member.user_id).map((item) => item.study_date));
      const timeline = evaluateTimelineByDay(
        dates.map((date) => ({ date, credits: creditMap.get(date) ?? 0, postponed: postponed.has(date) })),
        "__past__",
        (date) => rulesForDate(versions, date, fallback).maxPresolveDays,
      );
      const targetResult = timeline.at(-1);
      if (!targetResult || postponed.has(target) || targetResult.backlogCount <= 0) continue;

      const level = penaltyLevelForBacklog(targetResult.backlogCount);
      if (level <= 0) continue;
      const config = rulesForDate(versions, target, fallback).ruleConfig;
      const amount = penaltyForConsecutiveMisses(level, config);
      const { data: existing } = await admin.from(DB.penalties)
        .select("id")
        .eq("study_id", study.id)
        .eq("user_id", member.user_id)
        .eq("study_date", target)
        .maybeSingle();
      if (existing) continue;

      const { error } = await admin.from(DB.penalties).insert({
        study_id: study.id,
        user_id: member.user_id,
        study_date: target,
        consecutive_misses: level,
        amount,
        reason: "missed",
      });
      if (!error) penalties += 1;
    }
  }

  return NextResponse.json({ ok: true, target, penalties });
}
