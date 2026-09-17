import type { Platform } from "./types";

export type StudyRuleConfig = {
  bojBronzeCount: number;
  bojSilverCount: number;
  bojGoldCount: number;
  programmersLowCount: number;
  programmersHighCount: number;
  sweaLowCount: number;
  sweaHighCount: number;
  codetreeSamsungCount: number;
  penalties: Record<1 | 2 | 3, number>;
};

export const DEFAULT_RULE_CONFIG: StudyRuleConfig = {
  bojBronzeCount: 3,
  bojSilverCount: 2,
  bojGoldCount: 1,
  programmersLowCount: 3,
  programmersHighCount: 1,
  sweaLowCount: 2,
  sweaHighCount: 1,
  codetreeSamsungCount: 1,
  penalties: { 1: 10000, 2: 25000, 3: 50000 },
};

export const DEFAULT_RULES = {
  cutoffHour: 4,
  postponeDeadlineHour: 23,
  postponeDeadlineMinute: 59,
  maxConsecutivePostpone: 2,
  maxPresolveDays: 2,
};

function safePositiveInt(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20 ? value : fallback;
}

function safePenalty(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : fallback;
}

export function normalizeRuleConfig(value: unknown): StudyRuleConfig {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const penalties = raw.penalties && typeof raw.penalties === "object"
    ? raw.penalties as Record<string, unknown>
    : {};
  return {
    bojBronzeCount: safePositiveInt(raw.bojBronzeCount, DEFAULT_RULE_CONFIG.bojBronzeCount),
    bojSilverCount: safePositiveInt(raw.bojSilverCount, DEFAULT_RULE_CONFIG.bojSilverCount),
    bojGoldCount: safePositiveInt(raw.bojGoldCount, DEFAULT_RULE_CONFIG.bojGoldCount),
    programmersLowCount: safePositiveInt(raw.programmersLowCount, DEFAULT_RULE_CONFIG.programmersLowCount),
    programmersHighCount: safePositiveInt(raw.programmersHighCount, DEFAULT_RULE_CONFIG.programmersHighCount),
    sweaLowCount: safePositiveInt(raw.sweaLowCount, DEFAULT_RULE_CONFIG.sweaLowCount),
    sweaHighCount: safePositiveInt(raw.sweaHighCount, DEFAULT_RULE_CONFIG.sweaHighCount),
    codetreeSamsungCount: safePositiveInt(raw.codetreeSamsungCount, DEFAULT_RULE_CONFIG.codetreeSamsungCount),
    penalties: {
      1: safePenalty(penalties["1"], DEFAULT_RULE_CONFIG.penalties[1]),
      2: safePenalty(penalties["2"], DEFAULT_RULE_CONFIG.penalties[2]),
      3: safePenalty(penalties["3"], DEFAULT_RULE_CONFIG.penalties[3]),
    },
  };
}

export function submissionCredit(
  platform: Platform,
  difficulty: string,
  config: StudyRuleConfig = DEFAULT_RULE_CONFIG,
): number {
  const d = difficulty.trim().toUpperCase();
  if (platform === "BOJ") {
    if (/^BRONZE\s+(I|II)$/.test(d)) return 1 / config.bojBronzeCount;
    if (/^SILVER\s+(I|II|III|IV|V)$/.test(d)) return 1 / config.bojSilverCount;
    if (/^(GOLD|PLATINUM|DIAMOND|RUBY)\b/.test(d)) return 1 / config.bojGoldCount;
    return 0;
  }
  if (platform === "PROGRAMMERS") {
    const level = Number(d.match(/(?:LEVEL|LV\.?)[\s]*(\d+)/)?.[1] ?? d.match(/^(\d+)$/)?.[1]);
    if (level === 0 || level === 1) return 1 / config.programmersLowCount;
    if (level >= 2) return 1 / config.programmersHighCount;
    return 0;
  }
  if (platform === "SWEA") {
    const level = Number(d.match(/D(\d+)/)?.[1]);
    if (level === 2 || level === 3) return 1 / config.sweaLowCount;
    if (level >= 4) return 1 / config.sweaHighCount;
    return 0;
  }
  if (platform === "CODETREE" && d.includes("SAMSUNG")) return 1 / config.codetreeSamsungCount;
  return 0;
}

export function isComplete(credits: number): boolean {
  return credits + Number.EPSILON >= 1;
}

export function penaltyForConsecutiveMisses(
  days: number,
  config: StudyRuleConfig = DEFAULT_RULE_CONFIG,
): number | null {
  if (days <= 0) return null;
  const level = Math.min(3, Math.floor(days)) as 1 | 2 | 3;
  return config.penalties[level];
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
