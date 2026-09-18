export type TimelineDay = { date: string; credits: number; postponed: boolean };
export type TimelineState = "complete" | "in-progress" | "postponed" | "missed";
export type TimelineResult = {
  date: string;
  state: TimelineState;
  available: number;
  remaining: number;
  backlogCount: number;
  resolvedOn: string | null;
};

type Obligation = {
  date: string;
  remaining: number;
  result: TimelineResult;
};

type CreditLot = { earnedOn: string; credit: number };

const EPSILON = 1e-9;

export function evaluateTimeline(days: TimelineDay[], currentDate: string, maxCarryDays = 2): TimelineResult[] {
  return evaluateTimelineByDay(days, currentDate, () => maxCarryDays);
}

export function evaluateTimelineByDay(
  days: TimelineDay[],
  currentDate: string,
  maxCarryDaysForDate: (date: string) => number,
): TimelineResult[] {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const obligations: Obligation[] = [];
  const carryLots: CreditLot[] = [];
  const results: TimelineResult[] = [];
  let oldestUnresolvedIndex = 0;
  let backlogCount = 0;

  const advanceOldestUnresolved = () => {
    while (
      oldestUnresolvedIndex < obligations.length
      && obligations[oldestUnresolvedIndex].remaining <= EPSILON
    ) {
      oldestUnresolvedIndex += 1;
    }
  };

  const applyCredit = (lot: CreditLot, resolvedOn: string) => {
    advanceOldestUnresolved();
    while (lot.credit > EPSILON && oldestUnresolvedIndex < obligations.length) {
      const obligation = obligations[oldestUnresolvedIndex];
      const amount = Math.min(obligation.remaining, lot.credit);
      obligation.remaining = normalize(obligation.remaining - amount);
      lot.credit = normalize(lot.credit - amount);
      obligation.result.remaining = obligation.remaining;
      obligation.result.available = normalize(1 - obligation.remaining);

      if (obligation.remaining <= EPSILON) {
        obligation.result.state = "complete";
        obligation.result.resolvedOn = resolvedOn;
        backlogCount -= 1;
        oldestUnresolvedIndex += 1;
        advanceOldestUnresolved();
      }
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
    };
    obligations.push({ date: day.date, remaining: 1, result });
    results.push(result);
    backlogCount += 1;

    for (const lot of carryLots) {
      if (lot.credit <= EPSILON) continue;
      applyCredit(lot, lot.earnedOn);
    }

    if (day.credits > EPSILON) {
      const todayLot = { earnedOn: day.date, credit: day.credits };
      applyCredit(todayLot, day.date);
      if (todayLot.credit > EPSILON) carryLots.push(todayLot);
    }

    cleanupCarry(carryLots);
    result.backlogCount = backlogCount;
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
