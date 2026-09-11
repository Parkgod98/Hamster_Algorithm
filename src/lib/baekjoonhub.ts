import type { NormalizedSubmission } from "./types";

export type PushCommit = { id: string; message: string; timestamp: string; added?: string[]; modified?: string[] };

export function parseBaekjoonHubCommit(repoId: number, commit: PushCommit): NormalizedSubmission[] {
  const files = [...(commit.added ?? []), ...(commit.modified ?? [])];
  const seen = new Set<string>();
  const results: NormalizedSubmission[] = [];

  for (const path of files) {
    const boj = path.match(/^백준\/([^/]+)\/(\d+)[.\u2000-\u206F\s]/u);
    if (boj) {
      const [, difficulty, externalId] = boj;
      const key = `BOJ:${externalId}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ platform: "BOJ", externalId, title: titleFromMessage(commit.message), difficulty: normalizeBojDifficulty(difficulty), solvedAt: commit.timestamp, sourceEventId: `github:${repoId}:${commit.id}:${key}` });
      }
      continue;
    }

    const pg = path.match(/^프로그래머스\/(\d+)\//u);
    if (pg) {
      const level = pg[1];
      const problemMatch = path.match(/\/(\d+)[.\u2000-\u206F\s]/u);
      const externalId = problemMatch?.[1] ?? `${commit.id.slice(0, 12)}-${level}`;
      const key = `PROGRAMMERS:${externalId}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ platform: "PROGRAMMERS", externalId, title: titleFromMessage(commit.message), difficulty: `Level ${level}`, solvedAt: commit.timestamp, sourceEventId: `github:${repoId}:${commit.id}:${key}` });
      }
    }
  }
  return results;
}

function titleFromMessage(message: string) {
  return message.match(/Title:\s*([^,]+)/i)?.[1]?.trim() ?? "알고리즘 문제";
}

function normalizeBojDifficulty(raw: string) {
  return raw.replace(/([a-z])([IV]+)$/i, "$1 $2").replace(/\s+/g, " ").trim();
}
