import type { SupabaseClient } from "@supabase/supabase-js";
import { DB } from "./db";
import { readAllRows } from "./read-all-rows";
import { goalPolicy, type GoalPolicy, type ManualGoal } from "./rules";
import { addStudyDays, studyDateFromTimestamp } from "./study-day";

export type DayGoalEntry = { id: string; mine: boolean; name: string; goal: ManualGoal; counted: boolean; hasPhoto: boolean };
export type DayGoals = { policy: GoalPolicy | null; canSubmit: boolean; entries: DayGoalEntry[] };
type Entry = {
  id: string; user_id: string; goal: ManualGoal; photo_type: string | null; created_at: string;
  hamster_study_members: { display_name: string } | { display_name: string }[] | null;
};

export async function dayRule(db: SupabaseClient, studyId: string, date: string) {
  const result = await db.from(DB.studyRuleVersions).select("rule_config,max_presolve_days")
    .eq("study_id", studyId).lte("effective_from", date).order("effective_from", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

export async function dayGoals(db: SupabaseClient, studyId: string, date: string, viewerId: string, joinedAt: string,
  rule: { rule_config: unknown; max_presolve_days: number } | null, visibleOnly = false): Promise<DayGoals> {
  if (!rule) return { policy: null, canSubmit: false, entries: [] };
  const policy = goalPolicy(rule.rule_config);
  const horizon = rule.max_presolve_days;
  const today = studyDateFromTimestamp(new Date().toISOString());
  const canSubmit = date >= studyDateFromTimestamp(joinedAt) && date <= addStudyDays(today, horizon);
  if (visibleOnly && policy.allowed.every(goal => goal === "algorithm")) return { policy, canSubmit, entries: [] };
  const rows = await readAllRows<Entry>((from, to) => db.from(DB.goalCompletions)
    .select("id,user_id,goal,photo_type,created_at,hamster_study_members(display_name)")
    .eq("study_id", studyId).eq("study_date", date).order("created_at").order("id").range(from, to));
  const entries = rows.map(item => {
    const owner = Array.isArray(item.hamster_study_members) ? item.hamster_study_members[0] : item.hamster_study_members;
    return { id: item.id, mine: item.user_id === viewerId, name: owner?.display_name ?? "스터디원", goal: item.goal,
      counted: policy.allowed.includes(item.goal) && date <= addStudyDays(studyDateFromTimestamp(item.created_at), horizon),
      hasPhoto: Boolean(item.photo_type) };
  });
  return { policy, canSubmit, entries };
}
