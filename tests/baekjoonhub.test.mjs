import test from "node:test";
import assert from "node:assert/strict";
import { parseBaekjoonHubCommit } from "../src/lib/baekjoonhub.ts";
import { submissionCredit } from "../src/lib/rules.ts";

test("백준허브 기본 폴더의 Silver III와 Bronze II는 커밋 제목의 등급으로 인정한다", () => {
  for (const [rank, band, credit] of [["Silver III", "Silver", 0.5], ["Bronze II", "Bronze", 1 / 3]]) {
    const [solve] = parseBaekjoonHubCommit(11, {
      id: "commit", message: `[${rank}] Title: 연습, Time: 12 ms`, timestamp: "2026-11-01T05:00:00Z",
      added: [`백준/${band}/1234. 연습/README.md`, `백준/${band}/1234. 연습/연습.py`],
    });
    assert.equal(solve.difficulty, rank);
    assert.equal(submissionCredit(solve.platform, solve.difficulty), credit);
  }
});

test("SWEA BaekjoonHub 경로에서 문제 번호와 난이도를 파싱한다", () => {
  const result = parseBaekjoonHubCommit(123, {
    id: "5d62e3dc35b2c44844f730538ed97ff319a27198",
    message: "[D5] Title: 최장 증가 부분 수열 (Hard), Time: 261 ms, Memory: 6,612 KB -BaekjoonHub",
    timestamp: "2026-09-12T16:11:13Z",
    added: [
      "SWEA/D5/3308.\u2005최장\u2005증가\u2005부분\u2005수열\u2005（Hard）/README.md",
      "SWEA/D5/3308.\u2005최장\u2005증가\u2005부분\u2005수열\u2005（Hard）/최장.cpp",
    ],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].platform, "SWEA");
  assert.equal(result[0].externalId, "3308");
  assert.equal(result[0].difficulty, "D5");
  assert.equal(result[0].title, "최장 증가 부분 수열 (Hard)");
  assert.equal(result[0].solvedAt, "2026-09-12T16:11:13Z");
});

test("기존 BOJ 파싱은 그대로 유지한다", () => {
  const result = parseBaekjoonHubCommit(1, {
    id: "boj-commit",
    message: "[Gold V] Title: 테스트 문제, Time: 1 ms",
    timestamp: "2026-09-12T12:00:00Z",
    added: ["백준/Gold III/1234.\u2005테스트/README.md"],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].platform, "BOJ");
  assert.equal(result[0].externalId, "1234");
  assert.equal(result[0].difficulty, "Gold III");
});
