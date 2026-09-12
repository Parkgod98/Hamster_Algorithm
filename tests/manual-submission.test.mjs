import test from "node:test";
import assert from "node:assert/strict";
import {
  manualProblemExternalId,
  manualSolvedAt,
  normalizeManualSubmissionInput,
} from "../src/lib/manual-submission.ts";

test("수동 인증 입력을 플랫폼·난이도·문제 수·날짜로 정규화한다", () => {
  assert.deepEqual(normalizeManualSubmissionInput({
    platform: "BOJ",
    difficulty: " Silver III ",
    count: 2,
    studyDate: "2026-09-13",
  }), {
    platform: "BOJ",
    difficulty: "Silver III",
    count: 2,
    studyDate: "2026-09-13",
  });
});

test("잘못된 플랫폼이나 문제 수는 거부한다", () => {
  assert.equal(normalizeManualSubmissionInput({ platform: "OTHER", difficulty: "Gold V", count: 1, studyDate: "2026-09-13" }), null);
  assert.equal(normalizeManualSubmissionInput({ platform: "BOJ", difficulty: "Gold V", count: 0, studyDate: "2026-09-13" }), null);
  assert.equal(normalizeManualSubmissionInput({ platform: "BOJ", difficulty: "Gold V", count: 21, studyDate: "2026-09-13" }), null);
});

test("수동 문제 id는 같은 난이도 구간에서 재사용 가능하게 만든다", () => {
  assert.equal(manualProblemExternalId("BOJ", "Silver III"), "manual:BOJ:SILVER-III");
});

test("수동 인증 시각은 선택한 Study Day 안에 배치한다", () => {
  assert.equal(manualSolvedAt("2026-09-13"), "2026-09-13T03:00:00.000Z");
});
