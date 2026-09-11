export type Platform = "BOJ" | "PROGRAMMERS" | "SWEA" | "CODETREE";

export type NormalizedSubmission = {
  platform: Platform;
  externalId: string;
  title: string;
  difficulty: string;
  solvedAt: string;
  sourceEventId: string;
};

export type DailyState = "complete" | "in-progress" | "postponed" | "missed";
