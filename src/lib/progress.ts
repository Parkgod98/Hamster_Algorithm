import type { ManualGoal, StudyGoal } from "./rules";

export type TimedCredit = { at: string; credits: number };
export type TimelineDay = { date: string; credits: number; postponed: boolean; creditEvents?: TimedCredit[] };
type DayPolicy = { allowed: StudyGoal[]; required: number };
export type DatedCompletion = { target: string; earned: string; goal: ManualGoal; at?: string };
export type TimelineState = "complete" | "in-progress" | "postponed" | "missed";
export type TimelineResult = {
  date: string;
  state: TimelineState;
  available: number;
  remaining: number;
  backlogCount: number;
  resolvedOn: string | null;
  algorithmCredits: number;
  completedGoals: StudyGoal[];
};

type Obligation = {
  policy: DayPolicy;
  result: TimelineResult;
  latestContribution: string;
};

type CreditLot = { earnedOn: string; credit: number };

// Consecutive untouched obligations with the same policy share one range.
// A member who misses a year still needs that FIFO debt when returning.
type OpenRange = {
  from: string; to: string; policy: DayPolicy; credits: number; goals: StudyGoal[]; latest: string;
};
export type TimelineCheckpoint = { version: 1; through: string; open: OpenRange[]; carry: CreditLot[] };
export type TimelineResume = {
  initial?: TimelineCheckpoint;
  captureDate?: string;
  capture?: (checkpoint: TimelineCheckpoint) => void;
};

const EPSILON = 1e-9;

export function evaluateTimeline(days: TimelineDay[], currentDate: string, maxCarryDays = 2): TimelineResult[] {
  return evaluateTimelineByDay(days, currentDate, () => maxCarryDays);
}

export function evaluateTimelineByDay(
  days: TimelineDay[],
  currentDate: string,
  maxCarryDaysForDate: (date: string) => number,
  policyForDate: (date: string) => DayPolicy = () => ({ allowed: ["algorithm"], required: 1 }),
  completions: DatedCompletion[] = [],
  resume?: TimelineResume,
): TimelineResult[] {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const algorithmQueue: Obligation[] = [];
  const byDate = new Map<string, Obligation>();
  const actions = new Map<string, DatedCompletion[]>();
  for (const completion of completions) {
    if (completion.earned < completion.target && dayDistance(completion.earned, completion.target) > maxCarryDaysForDate(completion.target)) continue;
    const applies = completion.earned > completion.target ? completion.earned : completion.target;
    const group = actions.get(applies) ?? [];
    group.push(completion);
    actions.set(applies, group);
  }
  const carryLots: CreditLot[] = resume?.initial?.carry.map(lot => ({ ...lot })) ?? [];
  const results: TimelineResult[] = [];
  let oldestUnresolvedIndex = 0;
  let backlogCount = 0;

  if (resume?.initial) {
    const checkpoint = resume.initial;
    if (checkpoint.version !== 1 || (ordered.length && checkpoint.through >= ordered[0].date))
      throw new Error("Incompatible progress checkpoint");
    for (const range of checkpoint.open) {
      for (const date of dateRange(range.from, range.to)) {
        const result: TimelineResult = { date, state: "missed", available: 0, remaining: 1, backlogCount: 0,
          resolvedOn: null, algorithmCredits: range.credits, completedGoals: [...range.goals] };
        const obligation = { policy: range.policy, result, latestContribution: range.latest };
        byDate.set(date, obligation);
        if (range.policy.allowed.includes("algorithm") && range.credits < 1) algorithmQueue.push(obligation);
        backlogCount++;
      }
    }
  }

  const update = (obligation: Obligation, earnedOn: string) => {
    const { result, policy } = obligation;
    if (result.state === "complete") return;
    if (earnedOn > obligation.latestContribution) obligation.latestContribution = earnedOn;
    const partial = result.completedGoals.includes("algorithm") ? 0 : result.algorithmCredits;
    result.available = Math.min(1, (result.completedGoals.length + partial) / policy.required);
    result.remaining = normalize(1 - result.available);
    if (result.completedGoals.length >= policy.required) {
      result.state = "complete";
      result.resolvedOn = obligation.latestContribution;
      backlogCount -= 1;
    }
  };

  const applyCredit = (lot: CreditLot) => {
    while (lot.credit > EPSILON && oldestUnresolvedIndex < algorithmQueue.length) {
      const obligation = algorithmQueue[oldestUnresolvedIndex];
      const { result } = obligation;
      if (result.state === "complete" || result.algorithmCredits >= 1) {
        oldestUnresolvedIndex += 1;
        continue;
      }
      const amount = Math.min(1 - result.algorithmCredits, lot.credit);
      lot.credit = normalize(lot.credit - amount);
      result.algorithmCredits += amount;
      if (1 - result.algorithmCredits <= EPSILON) {
        result.algorithmCredits = 1;
        result.completedGoals.push("algorithm");
        oldestUnresolvedIndex += 1;
      }
      update(obligation, lot.earnedOn);
    }
  };

  for (const day of ordered) {
    const maxCarryDays = Math.max(0, maxCarryDaysForDate(day.date));
    expireCarry(carryLots, day.date, maxCarryDays);

    const result: TimelineResult = {
      date: day.date,
      state: unresolvedState(day.date, currentDate, day.postponed),
      available: 0,
      remaining: 1,
      backlogCount: 0,
      resolvedOn: null,
      algorithmCredits: 0,
      completedGoals: [],
    };
    const policy = policyForDate(day.date);
    const obligation = { policy, result, latestContribution: "" };
    byDate.set(day.date, obligation);
    if (policy.allowed.includes("algorithm")) algorithmQueue.push(obligation);
    results.push(result);
    backlogCount += 1;

    function applyManual(item: DatedCompletion) {
      const target = byDate.get(item.target);
      if (!target || !target.policy.allowed.includes(item.goal) || target.result.completedGoals.includes(item.goal)) return;
      target.result.completedGoals.push(item.goal);
      update(target, item.earned);
    }
    const earnedToday: DatedCompletion[] = [];
    for (const item of actions.get(day.date) ?? []) {
      if (item.earned < day.date) applyManual(item);
      else earnedToday.push(item);
    }

    for (const lot of carryLots) {
      if (lot.credit <= EPSILON) continue;
      applyCredit(lot);
    }

    function earn(credit: number) {
      if (credit <= EPSILON) return;
      const todayLot = { earnedOn: day.date, credit };
      applyCredit(todayLot);
      if (todayLot.credit > EPSILON && policy.allowed.includes("algorithm")) carryLots.push(todayLot);
    }
    if (earnedToday.length && day.creditEvents?.length) {
      // SQL splits a day's aggregates at manual check-in times. A later
      // English make-up must not undo an earlier FIFO algorithm allocation.
      const events = [
        ...earnedToday.map((item) => ({ time: item.at ? eventTime(item.at) : 0, apply: () => applyManual(item) })),
        ...day.creditEvents.map((event) => ({ time: eventTime(event.at), apply: () => earn(event.credits) })),
      ].sort((a, b) => a.time - b.time);
      for (const event of events) event.apply();
    } else {
      for (const item of earnedToday) applyManual(item);
      earn(day.credits);
    }

    cleanupCarry(carryLots);
    result.backlogCount = backlogCount;
    if (day.date === resume?.captureDate && resume.capture) {
      const open: OpenRange[] = [];
      for (const [date, item] of byDate) {
        if (item.result.state === "complete") continue;
        const { algorithmCredits: credits, completedGoals: goals } = item.result;
        const prior = open.at(-1);
        if (prior && !goals.length && !prior.goals.length && credits === 0 && prior.credits === 0
          && !item.latestContribution && !prior.latest && prior.policy.required === item.policy.required
          && prior.policy.allowed.join() === item.policy.allowed.join() && dayDistance(prior.to, date) === 1) {
          prior.to = date;
        } else {
          open.push({ from: date, to: date, policy: { allowed: [...item.policy.allowed], required: item.policy.required },
            credits, goals: [...goals], latest: item.latestContribution });
        }
      }
      resume.capture({ version: 1, through: day.date, open, carry: carryLots.map(lot => ({ ...lot })) });
    }
  }

  return results;
}

export function canPostponeWithBacklog(result: TimelineResult, maxConsecutivePostpone: number) {
  if (result.state === "complete") return false;
  return result.backlogCount <= Math.max(0, maxConsecutivePostpone);
}

export function penaltyLevelForBacklog(backlogCount: number) {
  if (backlogCount <= 0) return 0;
  return Math.min(3, Math.floor(backlogCount));
}

export function dateRange(start: string, end: string) {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addStudyDaysLocal(date, 1)) dates.push(date);
  return dates;
}

function expireCarry(lots: CreditLot[], targetDate: string, maxCarryDays: number) {
  for (const lot of lots) {
    if (dayDistance(lot.earnedOn, targetDate) > maxCarryDays) lot.credit = 0;
  }
  cleanupCarry(lots);
}

function cleanupCarry(lots: CreditLot[]) {
  for (let index = lots.length - 1; index >= 0; index -= 1) {
    if (lots[index].credit <= EPSILON) lots.splice(index, 1);
  }
}

function unresolvedState(date: string, currentDate: string, postponed: boolean): TimelineState {
  if (postponed) return "postponed";
  if (date === currentDate) return "in-progress";
  return "missed";
}

function normalize(value: number) {
  return Math.abs(value) <= EPSILON ? 0 : value;
}

function addStudyDaysLocal(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dayDistance(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

// PostgreSQL keeps microseconds. Preserve their order on either side of a
// check-in even when JavaScript Date places two events in one millisecond.
function eventTime(timestamp: string) {
  const fraction = timestamp.match(/\.(\d+)/)?.[1] ?? "";
  return Date.parse(timestamp) * 1000 + Number(fraction.padEnd(6, "0").slice(3, 6));
}
