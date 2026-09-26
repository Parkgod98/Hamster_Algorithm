import test from "node:test";
import assert from "node:assert/strict";
import { buildGrowthReport, difficultyLabelForRank, difficultyRank, isUpperDifficulty } from "../src/lib/growth-stats.ts";

test("BOJ 난이도는 같은 티어에서 V보다 I가 높고 Gold V가 Silver I보다 높다", () => {
  assert.equal(difficultyRank("BOJ", "Silver V"), 6);
  assert.equal(difficultyRank("BOJ", "Silver I"), 10);
  assert.equal(difficultyRank("BOJ", "Gold V"), 11);
  assert.equal(difficultyLabelForRank("BOJ", 11), "Gold V");
});

test("플랫폼별 상위 난이도 기준을 서로 섞지 않는다", () => {
  assert.equal(isUpperDifficulty("BOJ", "Gold V"), true);
  assert.equal(isUpperDifficulty("BOJ", "Silver I"), false);
  assert.equal(isUpperDifficulty("PROGRAMMERS", "Level 2"), true);
  assert.equal(isUpperDifficulty("PROGRAMMERS", "Level 1"), false);
  assert.equal(isUpperDifficulty("SWEA", "D4"), true);
  assert.equal(isUpperDifficulty("SWEA", "D3"), false);
  assert.equal(difficultyRank("CODETREE", "SAMSUNG"), null);
});

test("선택한 달의 풀이 수, 활동일, 전월 비교와 난이도 분포를 집계한다", () => {
  const report = buildGrowthReport([
    { studyDate: "2026-08-31", platform: "BOJ", difficulty: "Silver III" },
    { studyDate: "2026-09-01", platform: "BOJ", difficulty: "Silver I" },
    { studyDate: "2026-09-01", platform: "BOJ", difficulty: "Gold V" },
    { studyDate: "2026-09-08", platform: "PROGRAMMERS", difficulty: "Level 2" },
    { studyDate: "2026-09-15", platform: "SWEA", difficulty: "D5" },
    { studyDate: "2026-09-15", platform: "CODETREE", difficulty: "SAMSUNG" },
  ], "2026-09");

  assert.equal(report.total, 5);
  assert.equal(report.previousTotal, 1);
  assert.equal(report.delta, 4);
  assert.equal(report.activeDays, 3);
  assert.equal(report.averagePerActiveDay, 1.7);
  assert.equal(report.daily.length, 14);
  assert.equal(report.daily.at(-1)?.date, "2026-09-30");

  const boj = report.platforms.find((item) => item.platform === "BOJ");
  assert.equal(boj?.count, 2);
  assert.equal(boj?.highestDifficulty, "Gold V");
  assert.equal(boj?.upperCount, 1);
  assert.equal(boj?.upperRate, 50);

  const codetree = report.platforms.find((item) => item.platform === "CODETREE");
  assert.equal(codetree?.averageRank, null);
  assert.equal(codetree?.highestDifficulty, null);
});

test("현재 월은 현재 Study Day를 끝점으로 최근 14일 일별 풀이량을 만든다", () => {
  const report = buildGrowthReport([
    { studyDate: "2026-09-12", platform: "BOJ", difficulty: "Silver III" },
    { studyDate: "2026-09-25", platform: "BOJ", difficulty: "Gold V" },
    { studyDate: "2026-09-25", platform: "PROGRAMMERS", difficulty: "Level 2" },
    { studyDate: "2026-09-26", platform: "SWEA", difficulty: "D4" },
  ], "2026-09", "2026-09-26");

  assert.equal(report.daily.length, 14);
  assert.equal(report.daily[0].date, "2026-09-13");
  assert.equal(report.daily.at(-1)?.date, "2026-09-26");
  assert.equal(report.daily.find((item) => item.date === "2026-09-25")?.total, 2);
  assert.equal(report.daily.find((item) => item.date === "2026-09-26")?.total, 1);
  assert.equal(report.daily.find((item) => item.date === "2026-09-24")?.total, 0);
});

test("주간 평균 난이도는 플랫폼별로 따로 계산한다", () => {
  const report = buildGrowthReport([
    { studyDate: "2026-09-02", platform: "BOJ", difficulty: "Silver V" },
    { studyDate: "2026-09-03", platform: "BOJ", difficulty: "Gold V" },
    { studyDate: "2026-09-04", platform: "PROGRAMMERS", difficulty: "Level 3" },
    { studyDate: "2026-09-10", platform: "BOJ", difficulty: "Gold III" },
  ], "2026-09");

  const week1 = report.weekly[0];
  const boj = week1.platforms.find((item) => item.platform === "BOJ");
  const programmers = week1.platforms.find((item) => item.platform === "PROGRAMMERS");
  assert.equal(boj?.count, 2);
  assert.equal(boj?.averageRank, 8.5);
  assert.equal(programmers?.averageRank, 3);
  assert.equal(report.weekly[1].platforms.find((item) => item.platform === "BOJ")?.averageDifficulty, "Gold III");
});
