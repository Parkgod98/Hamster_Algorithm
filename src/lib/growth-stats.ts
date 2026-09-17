import type { Platform } from "./types";

export type GrowthSubmission = {
  studyDate: string;
  platform: Platform;
  difficulty: string;
};

export type DifficultyBucket = {
  difficulty: string;
  count: number;
  rank: number | null;
};

export type PlatformGrowth = {
  platform: Platform;
  count: number;
  difficulties: DifficultyBucket[];
  highestDifficulty: string | null;
  averageRank: number | null;
  averageDifficulty: string | null;
  upperCount: number;
  upperRate: number;
};

export type WeeklyGrowth = {
  week: number;
  platforms: Array<{
    platform: Platform;
    count: number;
    averageRank: number | null;
    averageDifficulty: string | null;
    upperRate: number;
  }>;
};

export type MonthlyGrowthPoint = {
  month: string;
  total: number;
  platforms: Array<{
    platform: Platform;
    count: number;
    averageRank: number | null;
    averageDifficulty: string | null;
    upperRate: number;
  }>;
};

export type GrowthReport = {
  month: string;
  total: number;
  previousTotal: number;
  delta: number;
  activeDays: number;
  averagePerActiveDay: number;
  platformCounts: Array<{ platform: Platform; count: number }>;
  platforms: PlatformGrowth[];
  weekly: WeeklyGrowth[];
  recentMonths: MonthlyGrowthPoint[];
};

const PLATFORM_ORDER: Platform[] = ["BOJ", "PROGRAMMERS", "SWEA", "CODETREE"];
const BOJ_TIERS = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ruby"] as const;
const ROMAN_SCORE: Record<string, number> = { V: 1, IV: 2, III: 3, II: 4, I: 5 };
const SCORE_ROMAN = ["", "V", "IV", "III", "II", "I"] as const;

export function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function difficultyRank(platform: Platform, difficulty: string): number | null {
  if (platform === "BOJ") {
    const match = /^(Bronze|Silver|Gold|Platinum|Diamond|Ruby)\s+(V|IV|III|II|I)$/i.exec(difficulty.trim());
    if (!match) return null;
    const tier = BOJ_TIERS.findIndex((item) => item.toLowerCase() === match[1].toLowerCase());
    const roman = ROMAN_SCORE[match[2].toUpperCase()];
    return tier < 0 || !roman ? null : tier * 5 + roman;
  }
  if (platform === "PROGRAMMERS") {
    const match = /^Level\s+(\d+)$/i.exec(difficulty.trim());
    return match ? Number(match[1]) : null;
  }
  if (platform === "SWEA") {
    const match = /^D(\d+)$/i.exec(difficulty.trim());
    return match ? Number(match[1]) : null;
  }
  return null;
}

export function difficultyLabelForRank(platform: Platform, rank: number | null): string | null {
  if (rank === null || !Number.isFinite(rank)) return null;
  const rounded = Math.max(1, Math.round(rank));
  if (platform === "BOJ") {
    const tierIndex = Math.floor((rounded - 1) / 5);
    const within = ((rounded - 1) % 5) + 1;
    const tier = BOJ_TIERS[tierIndex];
    return tier ? `${tier} ${SCORE_ROMAN[within]}` : null;
  }
  if (platform === "PROGRAMMERS") return `Level ${rounded}`;
  if (platform === "SWEA") return `D${rounded}`;
  return null;
}

export function isUpperDifficulty(platform: Platform, difficulty: string) {
  const rank = difficultyRank(platform, difficulty);
  if (rank === null) return false;
  if (platform === "BOJ") return rank >= 11;
  if (platform === "PROGRAMMERS") return rank >= 2;
  if (platform === "SWEA") return rank >= 4;
  return false;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function aggregatePlatform(rows: GrowthSubmission[], platform: Platform): PlatformGrowth {
  const filtered = rows.filter((row) => row.platform === platform);
  const counts = new Map<string, number>();
  for (const row of filtered) counts.set(row.difficulty, (counts.get(row.difficulty) ?? 0) + 1);
  const difficulties = [...counts.entries()]
    .map(([difficulty, count]) => ({ difficulty, count, rank: difficultyRank(platform, difficulty) }))
    .sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1) || b.count - a.count || a.difficulty.localeCompare(b.difficulty));
  const ranked = filtered.map((row) => difficultyRank(platform, row.difficulty)).filter((rank): rank is number => rank !== null);
  const averageRank = ranked.length ? roundOne(ranked.reduce((sum, rank) => sum + rank, 0) / ranked.length) : null;
  const upperCount = filtered.filter((row) => isUpperDifficulty(platform, row.difficulty)).length;
  return {
    platform,
    count: filtered.length,
    difficulties,
    highestDifficulty: difficulties.find((item) => item.rank !== null)?.difficulty ?? null,
    averageRank,
    averageDifficulty: difficultyLabelForRank(platform, averageRank),
    upperCount,
    upperRate: filtered.length ? Math.round((upperCount / filtered.length) * 100) : 0,
  };
}

function aggregateMonth(rows: GrowthSubmission[], month: string): MonthlyGrowthPoint {
  const inMonth = rows.filter((row) => row.studyDate.startsWith(month));
  return {
    month,
    total: inMonth.length,
    platforms: PLATFORM_ORDER.map((platform) => {
      const aggregated = aggregatePlatform(inMonth, platform);
      return {
        platform,
        count: aggregated.count,
        averageRank: aggregated.averageRank,
        averageDifficulty: aggregated.averageDifficulty,
        upperRate: aggregated.upperRate,
      };
    }),
  };
}

export function buildGrowthReport(rows: GrowthSubmission[], month: string): GrowthReport {
  const currentRows = rows.filter((row) => row.studyDate.startsWith(month));
  const previousMonth = shiftMonth(month, -1);
  const previousRows = rows.filter((row) => row.studyDate.startsWith(previousMonth));
  const activeDays = new Set(currentRows.map((row) => row.studyDate)).size;
  const platforms = PLATFORM_ORDER.map((platform) => aggregatePlatform(currentRows, platform));
  const weeks = [1, 2, 3, 4, 5].map((week) => {
    const weekRows = currentRows.filter((row) => Math.floor((Number(row.studyDate.slice(-2)) - 1) / 7) + 1 === week);
    return {
      week,
      platforms: PLATFORM_ORDER.map((platform) => {
        const aggregated = aggregatePlatform(weekRows, platform);
        return {
          platform,
          count: aggregated.count,
          averageRank: aggregated.averageRank,
          averageDifficulty: aggregated.averageDifficulty,
          upperRate: aggregated.upperRate,
        };
      }),
    };
  });
  const recentMonths = [shiftMonth(month, -2), previousMonth, month].map((target) => aggregateMonth(rows, target));
  return {
    month,
    total: currentRows.length,
    previousTotal: previousRows.length,
    delta: currentRows.length - previousRows.length,
    activeDays,
    averagePerActiveDay: activeDays ? roundOne(currentRows.length / activeDays) : 0,
    platformCounts: platforms.map(({ platform, count }) => ({ platform, count })),
    platforms,
    weekly: weeks,
    recentMonths,
  };
}
