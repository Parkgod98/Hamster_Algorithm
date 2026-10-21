import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";
import { addStudyDays, studyDateFromTimestamp, studyDayStartTimestamp, studyDayEndExclusiveTimestamp } from "@/lib/study-day";
import { dateRange, evaluateTimelineByDay, penaltyLevelForBacklog } from "@/lib/progress";
import { normalizeRuleConfig, penaltyForConsecutiveMisses, submissionCredit } from "@/lib/rules";
import { normalizeRuleVersions, rulesForDate, type EffectiveRules, type RuleVersionRow } from "@/lib/rule-version";
import type { Platform } from "@/lib/types";
import { readAllRows } from "@/lib/read-all-rows";

type Problem = { platform: Platform; difficulty: string };
type Study = { id: string; created_at: string; max_presolve_days: number; postpone_deadline_hour: number;
  postpone_deadline_minute: number; max_consecutive_postpone: number; rule_config: unknown };
type Member = { user_id: string; joined_at: string };
type Submission = { user_id: string; solved_at: string; hamster_problems: Problem | Problem[] | null };
type Postponement = { user_id: string; study_date: string };
type Penalty = { study_id: string; user_id: string; study_date: string; consecutive_misses: number; amount: number; reason: string };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Freeze the target once, even if a slow read crosses 04:00.
  const current = studyDateFromTimestamp(new Date().toISOString());
  const target = addStudyDays(current, -1);
  let penalties = 0;
  let phase: "read" | "write" = "read";
  try {
    const admin = createAdminClient();
    const studies = await readAllRows<Study>((from, to) => admin.from(DB.studies)
      .select("id,created_at,max_presolve_days,postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone,rule_config")
      .order("id", { ascending: true }).range(from, to));
    const pending: Penalty[] = [];

    // Finish every required read before the first write. Failed pages are never empty histories.
    for (const study of studies) {
      const fallback: EffectiveRules = {
        effectiveFrom: studyDateFromTimestamp(study.created_at),
        ruleConfig: normalizeRuleConfig(study.rule_config),
        postponeDeadlineHour: study.postpone_deadline_hour,
        postponeDeadlineMinute: study.postpone_deadline_minute,
        maxConsecutivePostpone: study.max_consecutive_postpone,
        maxPresolveDays: study.max_presolve_days,
      };
      const members = await readAllRows<Member>((from, to) => admin.from(DB.studyMembers)
        .select("user_id,joined_at").eq("study_id", study.id)
        .order("user_id", { ascending: true }).range(from, to));
      const joinedDates = new Map(members.map((member) => [member.user_id, studyDateFromTimestamp(member.joined_at)]));
      const earliestJoined = [...joinedDates.values()].filter((date) => date <= target).sort()[0];
      if (!earliestJoined) continue;
      const [subs, post, versionRows, existingPenalties] = await Promise.all([
        readAllRows<Submission>((from, to) => admin.from(DB.submissions)
          .select("user_id,solved_at,hamster_problems(platform,difficulty)")
          .eq("study_id", study.id)
          .gte("solved_at", studyDayStartTimestamp(earliestJoined))
          .lt("solved_at", studyDayEndExclusiveTimestamp(target))
          .order("solved_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
        readAllRows<Postponement>((from, to) => admin.from(DB.postponements)
          .select("user_id,study_date").eq("study_id", study.id).gte("study_date", earliestJoined).lte("study_date", target)
          .order("study_date", { ascending: true }).order("user_id", { ascending: true }).range(from, to)),
        readAllRows<RuleVersionRow>((from, to) => admin.from(DB.studyRuleVersions)
          .select("effective_from,rule_config,postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone,max_presolve_days")
          .eq("study_id", study.id).lte("effective_from", target).order("effective_from", { ascending: true }).range(from, to)),
        readAllRows<{ user_id: string }>((from, to) => admin.from(DB.penalties)
          .select("user_id").eq("study_id", study.id).eq("study_date", target)
          .order("user_id", { ascending: true }).range(from, to)),
      ]);
      const versions = normalizeRuleVersions(versionRows, normalizeRuleConfig);
      const creditsByUser = new Map<string, Map<string, number>>();
      for (const submission of subs) {
        const joinedDate = joinedDates.get(submission.user_id);
        if (!joinedDate) continue;
        const date = studyDateFromTimestamp(submission.solved_at);
        if (date < joinedDate || date > target) continue;
        if (Array.isArray(submission.hamster_problems) && submission.hamster_problems.length !== 1) {
          throw new Error("Incomplete problem relation");
        }
        const rawProblem = Array.isArray(submission.hamster_problems) ? submission.hamster_problems[0] : submission.hamster_problems;
        const problem = rawProblem as Problem | null;
        if (!problem || typeof problem.platform !== "string" || typeof problem.difficulty !== "string") {
          throw new Error("Incomplete problem relation");
        }
        const config = rulesForDate(versions, date, fallback).ruleConfig;
        const creditMap = creditsByUser.get(submission.user_id) ?? new Map<string, number>();
        creditMap.set(date, (creditMap.get(date) ?? 0) + submissionCredit(problem.platform, problem.difficulty, config));
        creditsByUser.set(submission.user_id, creditMap);
      }
      const postponementsByUser = new Map<string, Set<string>>();
      for (const item of post) {
        const set = postponementsByUser.get(item.user_id) ?? new Set<string>();
        set.add(item.study_date);
        postponementsByUser.set(item.user_id, set);
      }
      const existingPenaltyUsers = new Set(existingPenalties.map((item) => item.user_id));

      for (const member of members) {
        const joinedDate = studyDateFromTimestamp(member.joined_at);
        if (target < joinedDate || existingPenaltyUsers.has(member.user_id)) continue;
        const dates = dateRange(joinedDate, target);
        const creditMap = creditsByUser.get(member.user_id) ?? new Map<string, number>();
        const postponed = postponementsByUser.get(member.user_id) ?? new Set<string>();
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
        if (amount === null) continue;
        pending.push({
          study_id: study.id,
          user_id: member.user_id,
          study_date: target,
          consecutive_misses: level,
          amount,
          reason: "missed",
        });
      }
    }

    phase = "write";
    for (const penalty of pending) {
      const { error } = await admin.from(DB.penalties).insert(penalty);
      // Existing unique(study_id,user_id,study_date) handles concurrent executions.
      if (error?.code === "23505") continue;
      if (error) throw error;
      penalties += 1;
    }
    return NextResponse.json({ ok: true, target, penalties });
  } catch {
    // A partial write can be retried; already-finalized rows are never overwritten.
    return NextResponse.json({ ok: false, target, penalties, phase, error: "penalty-finalization-failed" }, { status: 500 });
  }
}
