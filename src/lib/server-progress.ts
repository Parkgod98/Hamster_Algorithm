import type { SupabaseClient } from "@supabase/supabase-js";
import { DB } from "./db";
import { dateRange, evaluateTimelineByDay, type TimelineResult } from "./progress";
import { normalizeRuleConfig, submissionCredit } from "./rules";
import { normalizeRuleVersions, rulesForDate, type EffectiveRules, type RuleVersionRow } from "./rule-version";
import { studyDateFromTimestamp, studyDayEndExclusiveTimestamp } from "./study-day";
import { readAllRows } from "./read-all-rows";
import type { NotificationProgressState } from "./notification-rules";
import type { Platform } from "./types";

type ProblemRelation = { platform: Platform; difficulty: string };
type StudyRow = {
  id: string;
  created_at: string;
  max_presolve_days: number;
  max_consecutive_postpone: number;
  postpone_deadline_hour: number;
  postpone_deadline_minute: number;
  rule_config: unknown;
};
type MemberRow = { user_id: string; joined_at: string };
type SubmissionRow = { user_id: string; solved_at: string; hamster_problems: unknown };
type PostponementRow = { user_id: string; study_date: string };

export type ProgressSubmission = { solvedAt: string; platform: Platform; difficulty: string };

export type StudyProgressContext = {
  studyId: string;
  targetDate: string;
  study: StudyRow;
  fallback: EffectiveRules;
  versions: ReturnType<typeof normalizeRuleVersions>;
  members: Map<string, { joinedAt: string; joinedDate: string }>;
  submissionsByUser: Map<string, ProgressSubmission[]>;
  postponementsByUser: Map<string, Set<string>>;
};

function problemFromRelation(value: unknown): ProblemRelation | null {
  if (Array.isArray(value)) return (value[0] as ProblemRelation | undefined) ?? null;
  if (value && typeof value === "object") return value as ProblemRelation;
  return null;
}

export async function loadStudyProgressContext(
  admin: SupabaseClient, studyId: string, targetDate: string, userIds?: string[],
): Promise<StudyProgressContext | null> {
  const studyResult = await admin.from(DB.studies)
    .select("id,created_at,max_presolve_days,max_consecutive_postpone,postpone_deadline_hour,postpone_deadline_minute,rule_config")
    .eq("id", studyId).maybeSingle();
  if (studyResult.error) throw studyResult.error;
  if (!studyResult.data) return null;

  const [memberRows, versionRows, submissionRows, postponementRows] = await Promise.all([
    readAllRows<MemberRow>((from, to) => {
      let query = admin.from(DB.studyMembers).select("user_id,joined_at").eq("study_id", studyId);
      if (userIds?.length) query = query.in("user_id", userIds);
      return query.order("user_id", { ascending: true }).range(from, to);
    }),
    readAllRows<RuleVersionRow>((from, to) => admin.from(DB.studyRuleVersions)
      .select("effective_from,rule_config,postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone,max_presolve_days")
      .eq("study_id", studyId).lte("effective_from", targetDate)
      .order("effective_from", { ascending: true }).range(from, to)),
    readAllRows<SubmissionRow>((from, to) => {
      let query = admin.from(DB.submissions).select("user_id,solved_at,hamster_problems(platform,difficulty)")
        .eq("study_id", studyId).lt("solved_at", studyDayEndExclusiveTimestamp(targetDate));
      if (userIds?.length) query = query.in("user_id", userIds);
      return query.order("solved_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
    }),
    readAllRows<PostponementRow>((from, to) => {
      let query = admin.from(DB.postponements).select("user_id,study_date")
        .eq("study_id", studyId).lte("study_date", targetDate);
      if (userIds?.length) query = query.in("user_id", userIds);
      return query.order("study_date", { ascending: true }).order("user_id", { ascending: true }).range(from, to);
    }),
  ]);

  const study = studyResult.data as StudyRow;
  const fallback: EffectiveRules = {
    effectiveFrom: studyDateFromTimestamp(study.created_at),
    ruleConfig: normalizeRuleConfig(study.rule_config),
    postponeDeadlineHour: study.postpone_deadline_hour,
    postponeDeadlineMinute: study.postpone_deadline_minute,
    maxConsecutivePostpone: study.max_consecutive_postpone,
    maxPresolveDays: study.max_presolve_days,
  };
  const versions = normalizeRuleVersions(versionRows, normalizeRuleConfig);
  const members = new Map<string, { joinedAt: string; joinedDate: string }>();
  for (const member of memberRows) members.set(member.user_id, {
    joinedAt: member.joined_at, joinedDate: studyDateFromTimestamp(member.joined_at),
  });

  const submissionsByUser = new Map<string, ProgressSubmission[]>();
  for (const submission of submissionRows) {
    const problem = problemFromRelation(submission.hamster_problems);
    if (!problem) throw new Error("Progress submission is missing its problem");
    const list = submissionsByUser.get(submission.user_id) ?? [];
    list.push({ solvedAt: submission.solved_at, platform: problem.platform, difficulty: problem.difficulty });
    submissionsByUser.set(submission.user_id, list);
  }
  const postponementsByUser = new Map<string, Set<string>>();
  for (const row of postponementRows) {
    const dates = postponementsByUser.get(row.user_id) ?? new Set<string>();
    dates.add(row.study_date);
    postponementsByUser.set(row.user_id, dates);
  }
  return { studyId, targetDate, study, fallback, versions, members, submissionsByUser, postponementsByUser };
}

export function appendProgressSubmissions(context: StudyProgressContext, userId: string, submissions: ProgressSubmission[]) {
  if (!submissions.length) return;
  const existing = context.submissionsByUser.get(userId) ?? [];
  existing.push(...submissions);
  context.submissionsByUser.set(userId, existing);
}

/** Calendar needs the current state of past obligations, not a month-end snapshot. */
export function evaluateMemberTimeline(
  context: StudyProgressContext, userId: string, targetDate = context.targetDate,
): TimelineResult[] {
  if (targetDate > context.targetDate) throw new Error("Progress context does not include target date");
  const membership = context.members.get(userId);
  if (!membership || targetDate < membership.joinedDate) return [];
  const creditMap = new Map<string, number>();
  for (const submission of context.submissionsByUser.get(userId) ?? []) {
    const date = studyDateFromTimestamp(submission.solvedAt);
    if (date < membership.joinedDate || date > targetDate) continue;
    const config = rulesForDate(context.versions, date, context.fallback).ruleConfig;
    creditMap.set(date, (creditMap.get(date) ?? 0) + submissionCredit(submission.platform, submission.difficulty, config));
  }
  const postponed = context.postponementsByUser.get(userId) ?? new Set<string>();
  return evaluateTimelineByDay(
    dateRange(membership.joinedDate, targetDate).map((date) => ({ date, credits: creditMap.get(date) ?? 0, postponed: postponed.has(date) })),
    targetDate, (date) => rulesForDate(context.versions, date, context.fallback).maxPresolveDays,
  );
}

export function evaluateMemberProgress(
  context: StudyProgressContext, userId: string, targetDate = context.targetDate,
): TimelineResult | null {
  return evaluateMemberTimeline(context, userId, targetDate).at(-1) ?? null;
}

export async function memberProgressSnapshot(
  admin: SupabaseClient, studyId: string, userId: string, targetDate: string,
): Promise<TimelineResult | null> {
  const context = await loadStudyProgressContext(admin, studyId, targetDate, [userId]);
  return context ? evaluateMemberProgress(context, userId, targetDate) : null;
}

export async function memberProgressForStudyDay(
  admin: SupabaseClient, studyId: string, userId: string, targetDate: string,
): Promise<NotificationProgressState> {
  const snapshot = await memberProgressSnapshot(admin, studyId, userId, targetDate);
  return snapshot?.state ?? "missed";
}
