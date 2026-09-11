import type { Platform } from "./types";

export const DEFAULT_RULES = {
  cutoffHour: 4,
  postponeDeadlineHour: 23,
  postponeDeadlineMinute: 59,
  maxConsecutivePostpone: 2,
  maxPresolveDays: 2,
  penalties: { 1: 10000, 2: 25000, 3: 50000 } as Record<number, number>,
};

export function submissionCredit(platform: Platform, difficulty: string): number {
  const d = difficulty.trim().toUpperCase();
  if (platform === "BOJ") {
    if (/^BRONZE\s+(I|II)$/.test(d)) return 1 / 3;
    if (/^SILVER\s+(I|II|III|IV|V)$/.test(d)) return 1 / 2;
    if (/^(GOLD|PLATINUM|DIAMOND|RUBY)\b/.test(d)) return 1;
    return 0;
  }
  if (platform === "PROGRAMMERS") {
    const level = Number(d.match(/(?:LEVEL|LV\.?)[\s]*(\d+)/)?.[1] ?? d.match(/^(\d+)$/)?.[1]);
    if (level === 0 || level === 1) return 1 / 3;
    if (level >= 2) return 1;
    return 0;
  }
  if (platform === "SWEA") {
    const level = Number(d.match(/D(\d+)/)?.[1]);
    if (level === 2 || level === 3) return 1 / 2;
    if (level >= 4) return 1;
    return 0;
  }
  if (platform === "CODETREE" && d.includes("SAMSUNG")) return 1;
  return 0;
}

export function isComplete(credits: number): boolean {
  return credits + Number.EPSILON >= 1;
}

export function penaltyForConsecutiveMisses(days: number): number | null {
  return DEFAULT_RULES.penalties[days] ?? null;
}

export type CreditLot = { earnedOn: string; credit: number };
export function consumeForDay(lots: CreditLot[], targetDate: string, maxCarryDays = 2) {
  const valid = lots.filter((lot) => dayDiff(lot.earnedOn, targetDate) >= 0 && dayDiff(lot.earnedOn, targetDate) <= maxCarryDays && lot.credit > 0);
  let need = 1;
  const consumed: CreditLot[] = [];
  for (const lot of valid.sort((a,b)=>a.earnedOn.localeCompare(b.earnedOn))) {
    if (need <= 0) break;
    const amount = Math.min(lot.credit, need);
    lot.credit -= amount;
    need -= amount;
    consumed.push({ earnedOn: lot.earnedOn, credit: amount });
  }
  return { complete: need <= Number.EPSILON, remainingNeed: Math.max(0, need), lots, consumed };
}

function dayDiff(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
