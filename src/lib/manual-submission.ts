import type { Platform } from "./types";

export type ManualSubmissionInput = {
  platform: Platform;
  difficulty: string;
  count: number;
  studyDate: string;
};

const ALLOWED_PLATFORMS = new Set<Platform>(["BOJ", "PROGRAMMERS", "SWEA", "CODETREE"]);
const STUDY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeManualSubmissionInput(value: unknown): ManualSubmissionInput | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const platform = raw.platform as Platform;
  const difficulty = typeof raw.difficulty === "string" ? raw.difficulty.trim() : "";
  const count = raw.count;
  const studyDate = typeof raw.studyDate === "string" ? raw.studyDate : "";

  if (!ALLOWED_PLATFORMS.has(platform) || !difficulty) return null;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 20) return null;
  if (!STUDY_DATE_PATTERN.test(studyDate)) return null;
  return { platform, difficulty, count, studyDate };
}

export function manualProblemExternalId(platform: Platform, difficulty: string) {
  return `manual:${platform}:${difficulty.trim().toUpperCase().replace(/\s+/g, "-")}`;
}

export function manualSolvedAt(studyDate: string) {
  return new Date(`${studyDate}T12:00:00+09:00`).toISOString();
}
