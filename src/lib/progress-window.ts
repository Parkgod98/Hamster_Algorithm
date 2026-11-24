import type { SupabaseClient } from "@supabase/supabase-js";
import { DB, RPC } from "./db";
import { dateRange, type TimelineCheckpoint, type TimelineResult } from "./progress";
import { readAllRows } from "./read-all-rows";
import { evaluateStudyTimeline, groupDailyCredits, readGoalCompletions, type DailySolutions } from "./server-progress";
import type { EffectiveRules, RuleVersionRow } from "./rule-version";
import { addStudyDays, studyDateFromTimestamp } from "./study-day";

type Member = { user_id: string; joined_at: string };
type Postponement = { user_id: string; study_date: string; requested_at: string };
type Evaluated = { dates: Map<string, TimelineResult>; credits: Map<string, number>; postponed: Map<string, string> };
type Rollout = {
  mode: "shadow" | "on"; revision: string; boundary: string; floor: string; members: Record<string, TimelineCheckpoint>;
};
export class ProgressChanged extends Error {}

// Roll out to named studies after a shadow comparison. Unconfigured and pre-migration
// deployments continue to use the original input history.
export async function readCheckpointRollout(db: SupabaseClient, study: string, member: string | null,
  firstDate: string, today: string): Promise<Rollout | null> {
  const mode = typeof process === "undefined" ? undefined : process.env.HAMSTER_PROGRESS_MODE;
  if (mode !== "on" && mode !== "shadow") return null;
  const studies = (process.env.HAMSTER_PROGRESS_STUDIES ?? "").split(",").map(s => s.trim());
  if (!studies.includes(study) && !studies.includes("*")) return null;
  const date = firstDate < today ? firstDate : today;
  const boundary = addStudyDays(date.slice(0, 7) + "-01", -1);
  const { data, error } = await db.rpc(RPC.readProgressCheckpoints, { p_study: study, p_member: member, p_boundary: boundary });
  if (error || !data || typeof data.revision !== "string") return null;
  return { mode, revision: data.revision, boundary, floor: data.floor, members: data.members };
}

const ruleFields = "effective_from,rule_config,postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone,max_presolve_days";
export async function readWindowRules(db: SupabaseClient, study: string, through: string, rollout: Rollout | null) {
  const floor = rollout?.mode === "on" && Object.keys(rollout.members).length ? rollout.floor : undefined;
  const [rows, prior, carry] = await Promise.all([
    readAllRows<RuleVersionRow>((from, to) => {
      let q = db.from(DB.studyRuleVersions).select(ruleFields).eq("study_id",study).lte("effective_from",through);
      if (floor) q = q.gte("effective_from",floor);
      return q.order("effective_from").range(from,to);
    }),
    floor ? db.from(DB.studyRuleVersions).select(ruleFields).eq("study_id",study)
      .lt("effective_from",floor).order("effective_from",{ ascending:false }).limit(1).maybeSingle() : null,
    floor ? db.from(DB.studyRuleVersions).select("max_presolve_days").eq("study_id",study)
      .lte("effective_from",through).order("max_presolve_days",{ ascending:false }).limit(1).maybeSingle() : null,
  ]);
  if (prior?.error) throw prior.error;
  if (carry?.error) throw carry.error;
  if (prior?.data) rows.unshift(prior.data);
  return { rows, maxCarry: carry?.data?.max_presolve_days ?? Math.max(0,...rows.map(r => r.max_presolve_days)) };
}

function byMember<T extends { user_id: string }>(rows: T[]) {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const list = result.get(row.user_id);
    if (list) list.push(row);
    else result.set(row.user_id, [row]);
  }
  return result;
}

type WindowInput = {
  db: SupabaseClient; study: string; members: Member[]; versions: EffectiveRules[]; today: string;
  end: string; single: string | null; asOf?: string;
};

async function evaluateWindow(input: WindowInput, rollout: Rollout | null) {
  if (rollout && input.members.length > 1) {
    const seeded = input.members.filter(member => rollout.members[member.user_id]);
    const cold = input.members.filter(member => !rollout.members[member.user_id]);
    // A retroactive correction to one member must not replay everyone else's history.
    if (seeded.length && cold.length) {
      const [a, b] = await Promise.all([seeded, cold].map(members =>
        evaluateCohort({ ...input, members }, rollout, true)));
      return { values: new Map([...a.values, ...b.values]), states: { ...a.states, ...b.states } };
    }
  }
  return evaluateCohort(input, rollout, false);
}

async function evaluateCohort(input: WindowInput, rollout: Rollout | null, subset: boolean) {
  const { db, study, members, versions, today, end, single, asOf } = input;
  const states: Record<string, TimelineCheckpoint> = {};
  const values = new Map<string, Evaluated>();
  const starts = members.map(m => {
    const seed = rollout?.members[m.user_id];
    return seed ? addStudyDays(seed.through, 1) : studyDateFromTimestamp(m.joined_at);
  });
  const floor = [...starts].sort()[0];
  if (!floor) return { values, states };
  const ids = members.map(m => m.user_id);
  const hasSeed = members.some(member => rollout?.members[member.user_id]);
  const [solutions, posts, goals, makeups] = await Promise.all([
    floor <= today ? readAllRows<DailySolutions>((from, to) => {
      let query = db.from(DB.dailySolutionCounts).select("user_id,study_date,platform,difficulty,solves,solved_through")
        .eq("study_id", study).gte("study_date", floor).lte("study_date", today);
      if (single) query = query.eq("user_id", single);
      else if (subset) query = query.in("user_id", ids);
      return query.order("study_date").order("user_id").order("platform").order("difficulty").order("solved_through").range(from,to);
    }) : [],
    floor <= today ? readAllRows<Postponement>((from, to) => db.from(DB.postponements)
      .select("user_id,study_date,requested_at").eq("study_id", study).in("user_id", ids)
      .gte("study_date", floor).lte("study_date", today).order("study_date").order("user_id").range(from,to)) : [],
    readGoalCompletions(db, study, end, ids, asOf, floor),
    // Last month's unpaid English obligation can be fulfilled today.
    hasSeed ? readGoalCompletions(db, study, end, ids, asOf, undefined, floor) : [],
  ]);
  const memberSolutions = byMember(solutions), memberPosts = byMember(posts), memberGoals = byMember([...goals,...makeups]);
  members.forEach((member, index) => {
    const user = member.user_id, first = starts[index], initial = rollout?.members[user];
    const direct = groupDailyCredits(memberSolutions.get(user) ?? [], versions, first, today);
    const postponed = new Map((memberPosts.get(user) ?? []).map(p => [p.study_date,p.requested_at]));
    const targets = (memberGoals.get(user) ?? []).filter(g => g.study_date >= first || studyDateFromTimestamp(g.created_at) >= first);
    const days = dateRange(first, end).map(date => ({
      date, ...(direct.get(date) ?? { credits: 0 }), postponed: postponed.has(date),
    }));
    const timeline = evaluateStudyTimeline(days, today, versions, targets, rollout ? {
      initial, captureDate: rollout.boundary, capture: state => { states[user] = state; },
    } : undefined);
    values.set(user, { dates: new Map(timeline.map(day => [day.date, day])), postponed,
      credits: new Map(Array.from(direct, ([date,value]) => [date,value.credits])) });
  });
  return { values, states };
}

// Compare the public interval, including later repayments of visible dates. Prefix
// obligations restored from a checkpoint belong to earlier (unrequested) dates.
function agrees(a: Map<string, Evaluated>, b: Map<string, Evaluated>, since: string) {
  for (const [user, full] of a) {
    const fast = b.get(user);
    if (!fast) return false;
    for (const [date, row] of full.dates) {
      if (date <= since) continue;
      if (JSON.stringify(row) !== JSON.stringify(fast.dates.get(date)) ||
          full.credits.get(date) !== fast.credits.get(date) || full.postponed.get(date) !== fast.postponed.get(date)) return false;
    }
  }
  return true;
}

export async function readProgressWindow(input: WindowInput, rollout: Rollout | null) {
  const fast = await evaluateWindow(input, rollout);
  if (!rollout) return fast.values;
  let result = fast.values;
  if (rollout.mode === "shadow" && Object.keys(rollout.members).length) {
    const full = await evaluateWindow(input, null);
    result = full.values;
    if (!agrees(full.values, fast.values, rollout.boundary)) {
      console.error("progress.checkpoint.mismatch");
      return result;
    }
  }
  if (Object.keys(fast.states).length) {
    const { data, error } = await input.db.rpc(RPC.saveProgressCheckpoints, {
      p_study: input.study, p_revision: rollout.revision, p_states: fast.states,
    });
    if (error || data !== true) throw new ProgressChanged("Progress changed during replay");
  } else {
    const head = await input.db.from(DB.syncHeads).select("revision").eq("scope","s:" + input.study).maybeSingle();
    if (head.error || String(head.data?.revision ?? 0) !== rollout.revision)
      throw new ProgressChanged("Progress changed during replay");
  }
  return result;
}
