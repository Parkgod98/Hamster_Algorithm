import type { SupabaseClient } from "@supabase/supabase-js";
import { DB } from "./db";
import { dateRange, evaluateTimelineByDay, type TimelineResult } from "./progress";
import { normalizeRuleConfig, submissionCredit } from "./rules";
import { normalizeRuleVersions, rulesForDate, type EffectiveRules, type RuleVersionRow } from "./rule-version";
import { studyDateFromTimestamp } from "./study-day";
import type { NotificationProgressState } from "./notification-rules";
import type { Platform } from "./types";

type ProblemRelation = { platform: Platform; difficulty: string };

export async function memberProgressSnapshot(
  admin: SupabaseClient,
  studyId: string,
  userId: string,
  targetDate: string,
): Promise<TimelineResult | null> {
  const [{ data: study }, { data: membership }, versionsResult, submissionsResult, postponementsResult] = await Promise.all([
    admin.from(DB.studies)
      .select("id,created_at,max_presolve_days,max_consecutive_postpone,postpone_deadline_hour,postpone_deadline_minute,rule_config")
      .eq("id", studyId)
      .single(),
    admin.from(DB.studyMembers).select("joined_at").eq("study_id", studyId).eq("user_id", userId).single(),
    admin.from(DB.studyRuleVersions)
      .select("effective_from,rule_config,postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone,max_presolve_days")
      .eq("study_id", studyId)
      .order("effective_from", { ascending: true }),
    admin.from(DB.submissions)
      .select("solved_at,hamster_problems(platform,difficulty)")
      .eq("study_id", studyId)
      .eq("user_id", userId),
    admin.from(DB.postponements)
      .select("study_date")
      .eq("study_id", studyId)
      .eq("user_id", userId),
  ]);

  if (!study || !membership) return null;
  const joinedDate = studyDateFromTimestamp(membership.joined_at);
  if (targetDate < joinedDate) return null;

  const fallback: EffectiveRules = {
    effectiveFrom: studyDateFromTimestamp(study.created_at),
    ruleConfig: normalizeRuleConfig(study.rule_config),
    postponeDeadlineHour: study.postpone_deadline_hour,
    postponeDeadlineMinute: study.postpone_deadline_minute,
    maxConsecutivePostpone: study.max_consecutive_postpone,
    maxPresolveDays: study.max_presolve_days,
  };
  const versions = normalizeRuleVersions((versionsResult.error ? [] : versionsResult.data ?? []) as RuleVersionRow[], normalizeRuleConfig);
  const creditMap = new Map<string, number>();

  for (const submission of submissionsResult.data ?? []) {
    const relation = Array.isArray(submission.hamster_problems) ? submission.hamster_problems[0] : submission.hamster_problems;
    const problem = relation as ProblemRelation | null;
    if (!problem) continue;
    const date = studyDateFromTimestamp(submission.solved_at);
    if (date > targetDate) continue;
    const config = rulesForDate(versions, date, fallback).ruleConfig;
    creditMap.set(date, (creditMap.get(date) ?? 0) + submissionCredit(problem.platform, problem.difficulty, config));
  }

  const postponed = new Set((postponementsResult.data ?? []).map((item) => item.study_date));
  const timeline = evaluateTimelineByDay(
    dateRange(joinedDate, targetDate).map((date) => ({ date, credits: creditMap.get(date) ?? 0, postponed: postponed.has(date) })),
    targetDate,
    (date) => rulesForDate(versions, date, fallback).maxPresolveDays,
  );
  return timeline.at(-1) ?? null;
}

export async function memberProgressForStudyDay(
  admin: SupabaseClient,
  studyId: string,
  userId: string,
  targetDate: string,
): Promise<NotificationProgressState> {
  const snapshot = await memberProgressSnapshot(admin, studyId, userId, targetDate);
  return snapshot?.state ?? "missed";
}
