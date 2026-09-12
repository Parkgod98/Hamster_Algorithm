import test from "node:test";
import assert from "node:assert/strict";
import { parseBaekjoonHubCommit } from "../src/lib/baekjoonhub.ts";

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
    added: ["백준/Gold V/1234.\u2005테스트/README.md"],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].platform, "BOJ");
  assert.equal(result[0].externalId, "1234");
});
