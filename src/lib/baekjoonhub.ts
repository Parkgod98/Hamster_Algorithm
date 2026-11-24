import type { NormalizedSubmission } from "./types";

export type PushCommit = { id: string; message: string; timestamp: string; added?: string[]; modified?: string[] };

export function parseBaekjoonHubCommit(repoId: number, commit: PushCommit): NormalizedSubmission[] {
  const files = [...(commit.added ?? []), ...(commit.modified ?? [])];
  const seen = new Set<string>();
  const results: NormalizedSubmission[] = [];
  const bojPath = /^백준\/([^/]+)\/(\d+)[.\u2000-\u206F\s]/u;
  const bojProblems = new Set(files.map(path => path.match(bojPath)?.[2]).filter(Boolean));
  const rankSubject = bojProblems.size === 1 ? commit.message : "";

  for (const path of files) {
    const boj = path.match(bojPath);
    if (boj) {
      const [, difficulty, externalId] = boj;
      const key = `BOJ:${externalId}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ platform: "BOJ", externalId, title: titleFromMessage(commit.message), difficulty: bojDifficulty(difficulty, rankSubject), solvedAt: commit.timestamp, sourceEventId: `github:${repoId}:${commit.id}:${key}` });
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
      continue;
    }

    const swea = path.match(/^SWEA\/(D\d+)\/(\d+)[.\u2000-\u206F\s]/u);
    if (swea) {
      const [, difficulty, externalId] = swea;
      const key = `SWEA:${externalId}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ platform: "SWEA", externalId, title: titleFromMessage(commit.message), difficulty: difficulty.toUpperCase(), solvedAt: commit.timestamp, sourceEventId: `github:${repoId}:${commit.id}:${key}` });
      }
    }
  }
  return results;
}

function titleFromMessage(message: string) {
  return message.match(/Title:\s*([^,]+)/i)?.[1]?.trim() ?? "알고리즘 문제";
}

function bojDifficulty(folder: string, message: string) {
  const tier = folder.trim().replace(/\s+/g, " ");
  const ranked = tier.match(/^(Bronze|Silver|Gold|Platinum|Diamond|Ruby)\s*(IV|V|III|II|I)$/i);
  if (ranked) return `${ranked[1]} ${ranked[2].toUpperCase()}`;
  // The default extension directory has only the band; the commit subject has the rank.
  const subject = message.match(/^\s*\[(Bronze|Silver|Gold|Platinum|Diamond|Ruby)\s+(IV|V|III|II|I)\]\s*Title:/i);
  return subject && tier.toLowerCase() === subject[1].toLowerCase() ? `${tier} ${subject[2].toUpperCase()}` : tier;
}
