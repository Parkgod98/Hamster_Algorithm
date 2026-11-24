import type { SupabaseClient } from "@supabase/supabase-js";
import { DB } from "./db";
import { dateRange, evaluateTimelineByDay, type TimedCredit, type TimelineDay, type TimelineResult, type TimelineResume } from "./progress";
import { normalizeRuleConfig, submissionCredit, type ManualGoal } from "./rules";
import { normalizeRuleVersions, rulesForDate, type EffectiveRules, type RuleVersionRow } from "./rule-version";
import { studyDateFromTimestamp, studyDayEndExclusiveTimestamp, studyDayStartTimestamp } from "./study-day";
import { readAllRows } from "./read-all-rows";
import type { NotificationProgressState } from "./notification-rules";
import type { Platform } from "./types";

type MemberRow = { user_id: string; joined_at: string };
export type DailySolutions = { user_id: string; study_date: string; platform: Platform; difficulty: string; solves: number; solved_through: string };
type PostponementRow = { user_id: string; study_date: string };
export type GoalCompletionRow = { user_id: string; study_date: string; goal: ManualGoal; created_at: string };

export type ProgressSubmission = { solvedAt: string; platform: Platform; difficulty: string };

export type StudyProgressContext = {
  studyId: string;
  targetDate: string;
  versions: ReturnType<typeof normalizeRuleVersions>;
  members: Map<string, { joinedAt: string; joinedDate: string }>;
  solutionsByUser: Map<string, DailySolutions[]>;
  postponementsByUser: Map<string, Set<string>>;
  completionsByUser: Map<string, GoalCompletionRow[]>;
};

export function readGoalCompletions(admin: SupabaseClient, studyId: string, through: string, userIds?: string[], asOf?: string,
  since?: string, lateBefore?: string) {
  return readAllRows<GoalCompletionRow>((from, to) => {
    let query = admin.from(DB.goalCompletions).select("user_id,study_date,goal,created_at")
      .eq("study_id", studyId).lte("study_date", through);
    if (userIds?.length) query = query.in("user_id", userIds);
    if (asOf) query = query.lt("created_at", asOf);
    if (since) query = query.gte("study_date", since);
    if (lateBefore) query = query.lt("study_date", lateBefore).gte("created_at", studyDayStartTimestamp(lateBefore));
    return query.order("study_date").order("user_id").order("goal").range(from, to);
  });
}

export function evaluateStudyTimeline(days: TimelineDay[], current: string, versions: EffectiveRules[], completions: GoalCompletionRow[],
  resume?: TimelineResume) {
  return evaluateTimelineByDay(days, current,
    (date) => rulesForDate(versions, date).maxPresolveDays,
    (date) => rulesForDate(versions, date).ruleConfig.goals,
    completions.map((row) => ({ target: row.study_date, earned: studyDateFromTimestamp(row.created_at), at: row.created_at, goal: row.goal })), resume);
}

export function groupDailyCredits(rows: DailySolutions[], versions: EffectiveRules[], joinedDate: string, endDate: string) {
  const groups = new Map<string, { credits: number; creditEvents: TimedCredit[] }>();
  for (const row of rows) {
    const date = row.study_date;
    if (date < joinedDate || date > endDate) continue;
    const credits = row.solves * submissionCredit(row.platform, row.difficulty, rulesForDate(versions, date).ruleConfig);
    if (!credits) continue;
    const group = groups.get(date) ?? { credits: 0, creditEvents: [] };
    group.credits += credits;
    group.creditEvents.push({ at: row.solved_through, credits });
    groups.set(date, group);
  }
  return groups;
}

export async function loadStudyProgressContext(
  admin: SupabaseClient, studyId: string, targetDate: string, userIds?: string[],
): Promise<StudyProgressContext | null> {
  const [memberRows, versionRows, submissionRows, postponementRows, goalRows, studyResult] = await Promise.all([
    readAllRows<MemberRow>((from, to) => {
      let query = admin.from(DB.studyMembers).select("user_id,joined_at").eq("study_id", studyId);
      if (userIds?.length) query = query.in("user_id", userIds);
      return query.order("user_id", { ascending: true }).range(from, to);
    }),
    readAllRows<RuleVersionRow>((from, to) => admin.from(DB.studyRuleVersions)
      .select("effective_from,rule_config,postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone,max_presolve_days")
      .eq("study_id", studyId).lte("effective_from", targetDate)
      .order("effective_from", { ascending: true }).range(from, to)),
    readAllRows<DailySolutions>((from, to) => {
      let query = admin.from(DB.dailySolutionCounts).select("user_id,study_date,platform,difficulty,solves,solved_through")
        .eq("study_id", studyId).lte("study_date", targetDate);
      if (userIds?.length) query = query.in("user_id", userIds);
      return query.order("study_date").order("user_id").order("platform").order("difficulty").order("solved_through").range(from, to);
    }),
    readAllRows<PostponementRow>((from, to) => {
      let query = admin.from(DB.postponements).select("user_id,study_date")
        .eq("study_id", studyId).lte("study_date", targetDate);
      if (userIds?.length) query = query.in("user_id", userIds);
      return query.order("study_date", { ascending: true }).order("user_id", { ascending: true }).range(from, to);
    }),
    readGoalCompletions(admin, studyId, targetDate, userIds, studyDayEndExclusiveTimestamp(targetDate)),
    admin.from(DB.studies).select("id").eq("id", studyId).maybeSingle(),
  ]);
  if (studyResult.error) throw studyResult.error;
  if (!studyResult.data) return null;

  const versions = normalizeRuleVersions(versionRows, normalizeRuleConfig);
  const members = new Map<string, { joinedAt: string; joinedDate: string }>();
  for (const member of memberRows) members.set(member.user_id, {
    joinedAt: member.joined_at, joinedDate: studyDateFromTimestamp(member.joined_at),
  });

  const solutionsByUser = new Map<string, DailySolutions[]>();
  for (const row of submissionRows) {
    if (!Number.isSafeInteger(row.solves) || row.solves < 1 || !row.platform || typeof row.difficulty !== "string") throw new Error("Invalid daily solution count");
    const list = solutionsByUser.get(row.user_id) ?? [];
    list.push(row);
    solutionsByUser.set(row.user_id, list);
  }
  const postponementsByUser = new Map<string, Set<string>>();
  for (const row of postponementRows) {
    const dates = postponementsByUser.get(row.user_id) ?? new Set<string>();
    dates.add(row.study_date);
    postponementsByUser.set(row.user_id, dates);
  }
  const completionsByUser = new Map<string, GoalCompletionRow[]>();
  for (const row of goalRows) {
    const list = completionsByUser.get(row.user_id) ?? [];
    list.push(row);
    completionsByUser.set(row.user_id, list);
  }
  return { studyId, targetDate, versions, members, solutionsByUser, postponementsByUser, completionsByUser };
}

export function appendProgressSubmissions(context: StudyProgressContext, userId: string, submissions: ProgressSubmission[]) {
  if (!submissions.length) return;
  const existing = context.solutionsByUser.get(userId) ?? [];
  for (const submission of submissions) existing.push({
    user_id: userId, study_date: studyDateFromTimestamp(submission.solvedAt), platform: submission.platform,
    difficulty: submission.difficulty, solves: 1, solved_through: submission.solvedAt,
  });
  context.solutionsByUser.set(userId, existing);
}

/** Calendar needs the current state of past obligations, not a month-end snapshot. */
export function evaluateMemberTimeline(
  context: StudyProgressContext, userId: string, targetDate = context.targetDate,
): TimelineResult[] {
  if (targetDate > context.targetDate) throw new Error("Progress context does not include target date");
  const membership = context.members.get(userId);
  if (!membership || targetDate < membership.joinedDate) return [];
  const creditMap = groupDailyCredits(context.solutionsByUser.get(userId) ?? [], context.versions, membership.joinedDate, targetDate);
  const postponed = context.postponementsByUser.get(userId) ?? new Set<string>();
  return evaluateStudyTimeline(
    dateRange(membership.joinedDate, targetDate).map((date) => ({ date, ...(creditMap.get(date) ?? { credits: 0 }), postponed: postponed.has(date) })),
    targetDate, context.versions, context.completionsByUser.get(userId) ?? [],
  );
}

export function evaluateMemberProgress(
  context: StudyProgressContext, userId: string, targetDate = context.targetDate,
): TimelineResult | null {
  return evaluateMemberTimeline(context, userId, targetDate).at(-1) ?? null;
}

/** Completion notifications are emitted when all obligations through today are settled. */
export function notificationStateForProgress(snapshot: TimelineResult | null): NotificationProgressState {
  if (snapshot?.state === "complete" && snapshot.backlogCount > 0) return "in-progress";
  return snapshot?.state ?? "missed";
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
