import { NextResponse } from "next/server";
import { DB, RPC } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";
import { addStudyDays, studyDateFromTimestamp, studyDayStartTimestamp, studyDayEndExclusiveTimestamp } from "@/lib/study-day";
import { dateRange, penaltyLevelForBacklog, type TimedCredit } from "@/lib/progress";
import { evaluateStudyTimeline, readGoalCompletions, type GoalCompletionRow } from "@/lib/server-progress";
import { normalizeRuleConfig, penaltyForConsecutiveMisses, submissionCredit } from "@/lib/rules";
import { normalizeRuleVersions, rulesForDate, type RuleVersionRow } from "@/lib/rule-version";
import type { Platform } from "@/lib/types";
import { readAllRows } from "@/lib/read-all-rows";

type Problem = { platform: Platform };
type Study = { id: string };
type Member = { user_id: string; joined_at: string };
type Submission = { user_id: string; solved_at: string; source: string; created_at: string; earned_difficulty: string; hamster_problems: Problem | Problem[] | null };
type Postponement = { user_id: string; study_date: string };
type Penalty = { study_id: string; user_id: string; study_date: string; consecutive_misses: number; amount: number; reason: string };

async function collectPenalties(admin: ReturnType<typeof createAdminClient>, target: string) {
  const closesAt = studyDayEndExclusiveTimestamp(target);
  const closesAtMs = Date.parse(closesAt);
  const studies = await readAllRows<Study>((from, to) => admin.from(DB.studies)
    .select("id")
    .order("id", { ascending: true }).range(from, to));
  const pending: Penalty[] = [];

  // Finish every required read before the first write. Failed pages are never empty histories.
  for (const study of studies) {
    const members = await readAllRows<Member>((from, to) => admin.from(DB.studyMembers)
      .select("user_id,joined_at").eq("study_id", study.id)
      .order("user_id", { ascending: true }).range(from, to));
    const joinedDates = new Map(members.map((member) => [member.user_id, studyDateFromTimestamp(member.joined_at)]));
    const earliestJoined = [...joinedDates.values()].filter((date) => date <= target).sort()[0];
    if (!earliestJoined) continue;
    const [subs, post, versionRows, existingPenalties, completions] = await Promise.all([
      readAllRows<Submission>((from, to) => admin.from(DB.submissions)
        .select("user_id,solved_at,source,created_at,earned_difficulty,hamster_problems(platform)")
        .eq("study_id", study.id)
        .gte("solved_at", studyDayStartTimestamp(earliestJoined))
        .lt("solved_at", closesAt)
        .order("solved_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
      readAllRows<Postponement>((from, to) => admin.from(DB.postponements)
        .select("user_id,study_date").eq("study_id", study.id).gte("study_date", earliestJoined).lte("study_date", target)
        .lt("requested_at", closesAt)
        .order("study_date", { ascending: true }).order("user_id", { ascending: true }).range(from, to)),
      readAllRows<RuleVersionRow>((from, to) => admin.from(DB.studyRuleVersions)
        .select("effective_from,rule_config,postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone,max_presolve_days")
        .eq("study_id", study.id).lte("effective_from", target).order("effective_from", { ascending: true }).range(from, to)),
      readAllRows<{ user_id: string }>((from, to) => admin.from(DB.penalties)
        .select("user_id").eq("study_id", study.id).eq("study_date", target)
        .order("user_id", { ascending: true }).range(from, to)),
      readGoalCompletions(admin, study.id, target, undefined, closesAt),
    ]);
    const versions = normalizeRuleVersions(versionRows, normalizeRuleConfig);
    const creditsByUser = new Map<string, Map<string, { credits: number; creditEvents: TimedCredit[] }>>();
    for (const submission of subs) {
      const joinedDate = joinedDates.get(submission.user_id);
      if (!joinedDate) continue;
      if (submission.source === "manual" && Date.parse(submission.created_at) >= closesAtMs) continue;
      const date = studyDateFromTimestamp(submission.solved_at);
      if (date < joinedDate || date > target) continue;
      if (Array.isArray(submission.hamster_problems) && submission.hamster_problems.length !== 1) {
        throw new Error("Incomplete problem relation");
      }
      const rawProblem = Array.isArray(submission.hamster_problems) ? submission.hamster_problems[0] : submission.hamster_problems;
      const problem = rawProblem as Problem | null;
      if (!problem || typeof problem.platform !== "string" || typeof submission.earned_difficulty !== "string") {
        throw new Error("Incomplete problem relation");
      }
      const config = rulesForDate(versions, date).ruleConfig;
      const credit = submissionCredit(problem.platform, submission.earned_difficulty, config);
      if (!credit) continue;
      const creditMap = creditsByUser.get(submission.user_id) ?? new Map<string, { credits: number; creditEvents: TimedCredit[] }>();
      const group = creditMap.get(date) ?? { credits: 0, creditEvents: [] };
      group.credits += credit;
      group.creditEvents.push({ at: submission.solved_at, credits: credit });
      creditMap.set(date, group);
      creditsByUser.set(submission.user_id, creditMap);
    }
    const postponementsByUser = new Map<string, Set<string>>();
    for (const item of post) {
      const set = postponementsByUser.get(item.user_id) ?? new Set<string>();
      set.add(item.study_date);
      postponementsByUser.set(item.user_id, set);
    }
    const existingPenaltyUsers = new Set(existingPenalties.map((item) => item.user_id));
    const completedByUser = new Map<string, GoalCompletionRow[]>();
    for (const completion of completions) {
      const rows = completedByUser.get(completion.user_id) ?? [];
      rows.push(completion);
      completedByUser.set(completion.user_id, rows);
    }

    for (const member of members) {
      const joinedDate = studyDateFromTimestamp(member.joined_at);
      if (target < joinedDate || existingPenaltyUsers.has(member.user_id)) continue;
      const dates = dateRange(joinedDate, target);
      const creditMap = creditsByUser.get(member.user_id);
      const postponed = postponementsByUser.get(member.user_id) ?? new Set<string>();
      const timeline = evaluateStudyTimeline(
        dates.map((date) => ({ date, ...(creditMap?.get(date) ?? { credits: 0 }), postponed: postponed.has(date) })),
        target, versions, completedByUser.get(member.user_id) ?? [],
      );
      const targetResult = timeline.at(-1);
      if (!targetResult || targetResult.state === "complete" || postponed.has(target) || targetResult.backlogCount <= 0) continue;

      const level = penaltyLevelForBacklog(targetResult.backlogCount);
      if (level <= 0) continue;
      const config = rulesForDate(versions, target).ruleConfig;
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
  return pending;
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(process.env.VERCEL_ENV === "production" && secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

// Called once when promoting the new worker. Pin the currently open 04:00
// study day so an outage on the very first scheduled run does not erase it.
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const today = studyDateFromTimestamp(new Date().toISOString());
  try {
    const cursor = await createAdminClient().rpc(RPC.activateFinalization, { p_day: today });
    if (cursor.error || !cursor.data?.day) throw new Error("cursor");
    return NextResponse.json({ ok: true, nextDate: cursor.data.day });
  } catch {
    return NextResponse.json({ ok: false, error: "activation-failed" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const latest = addStudyDays(studyDateFromTimestamp(new Date().toISOString()), -1);
  let target = latest;
  let penalties = 0;
  let completed = 0;
  let phase: "read" | "write" = "read";
  let activated = false;
  const recordAttempt = async (stage: "started" | "read" | "write", code: string | null) => {
    try {
      const observedAt = new Date().toISOString();
      const { error } = await createAdminClient().from(DB.closeAttempts).upsert({
        scheduled_day: latest, target_day: target, stage, error_code: code, observed_at: observedAt,
        ...(code ? { last_failure_at: observedAt, last_failure_code: code, last_failure_stage: stage, last_failure_target: target } : {}),
      }, { onConflict: "scheduled_day" });
      if (error) console.error("close observation unavailable", { target, stage });
    } catch { console.error("close observation unavailable", { target, stage }); }
  };
  try {
    const admin = createAdminClient();
    // Bound each invocation. A partial catch-up has a committed cursor for the next one.
    while (completed < 7) {
      phase = "read";
      const cursor = await admin.rpc(RPC.nextFinalizationDay);
      if (!cursor.error && cursor.data === null) {
        return NextResponse.json({ ok: false, error: "activation-required" }, { status: 503 });
      }
      if (cursor.error || !cursor.data?.day || typeof cursor.data.revision !== "string") throw new Error("cursor");
      if (!activated) {
        activated = true;
        await recordAttempt("started", null);
      }
      if (cursor.data.day > latest) break;
      target = cursor.data.day;
      const pending = await collectPenalties(admin, target);
      phase = "write";
      const saved = await admin.rpc(RPC.finishFinalizationDay, {
        p_day: target, p_revision: cursor.data.revision, p_penalties: pending,
      });
      if (saved.error || typeof saved.data !== "number") throw new Error(saved.error?.code ?? "commit");
      penalties += saved.data;
      completed++;
      if (target === latest) break;
    }
    return NextResponse.json({ ok: true, target, penalties, completed, caughtUp: target === latest });
  } catch (error) {
    const code = error instanceof Error && (error.message === "55000" || error.message === "40001") ? error.message : "finalization-failed";
    console.error("study day close failed", { target, phase, code });
    if (activated) await recordAttempt(phase, code);
    return NextResponse.json({ ok: false, target, penalties, completed, phase, error: "penalty-finalization-failed" }, { status: 500 });
  }
}
