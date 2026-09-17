import test from "node:test";
import assert from "node:assert/strict";
import {
  canPostponeWithBacklog,
  evaluateTimeline,
  penaltyLevelForBacklog,
} from "../src/lib/progress.ts";

function stateMap(timeline) {
  return Object.fromEntries(timeline.map((item) => [item.date, item]));
}

const base = [
  { date: "2026-09-15", credits: 0, postponed: true },
  { date: "2026-09-16", credits: 0, postponed: true },
];

test("이틀 미룬 뒤 하루치 풀이는 가장 오래된 의무만 완전히 상환한다", () => {
  const timeline = evaluateTimeline([...base, { date: "2026-09-17", credits: 1, postponed: false }], "2026-09-17");
  const days = stateMap(timeline);
  assert.equal(days["2026-09-15"].state, "complete");
  assert.equal(days["2026-09-15"].resolvedOn, "2026-09-17");
  assert.equal(days["2026-09-16"].state, "postponed");
  assert.equal(days["2026-09-17"].state, "in-progress");
  assert.equal(days["2026-09-17"].backlogCount, 2);
  assert.equal(canPostponeWithBacklog(days["2026-09-17"], 2), true);
});

test("0.5일치 부분 풀이는 하루 상환으로 인정하지 않아 미루기 불가다", () => {
  const timeline = evaluateTimeline([...base, { date: "2026-09-17", credits: 0.5, postponed: false }], "2026-09-17");
  const today = timeline.at(-1);
  assert.equal(timeline[0].state, "postponed");
  assert.equal(timeline[0].remaining, 0.5);
  assert.equal(today.backlogCount, 3);
  assert.equal(canPostponeWithBacklog(today, 2), false);
});

test("이틀치 풀이는 두 과거 의무를 FIFO로 해결하고 오늘 의무를 남긴다", () => {
  const timeline = evaluateTimeline([...base, { date: "2026-09-17", credits: 2, postponed: false }], "2026-09-17");
  assert.deepEqual(timeline.map((item) => item.state), ["complete", "complete", "in-progress"]);
  assert.equal(timeline.at(-1).backlogCount, 1);
  assert.equal(canPostponeWithBacklog(timeline.at(-1), 2), true);
});

test("세 일치를 풀면 backlog와 오늘 의무까지 모두 완료한다", () => {
  const timeline = evaluateTimeline([...base, { date: "2026-09-17", credits: 3, postponed: false }], "2026-09-17");
  assert.deepEqual(timeline.map((item) => item.state), ["complete", "complete", "complete"]);
  assert.equal(timeline.at(-1).backlogCount, 0);
});

test("backlog를 모두 갚은 뒤 남는 credit만 미래 선풀이로 쓴다", () => {
  const timeline = evaluateTimeline([
    ...base,
    { date: "2026-09-17", credits: 4, postponed: false },
    { date: "2026-09-18", credits: 0, postponed: false },
  ], "2026-09-17", 2);
  assert.deepEqual(timeline.map((item) => item.state), ["complete", "complete", "complete", "complete"]);
  assert.equal(timeline[3].resolvedOn, "2026-09-17");
});

test("벌금 단계는 미해결 의무 수를 따르고 3회에서 최고 금액 단계로 제한한다", () => {
  assert.equal(penaltyLevelForBacklog(0), 0);
  assert.equal(penaltyLevelForBacklog(1), 1);
  assert.equal(penaltyLevelForBacklog(2), 2);
  assert.equal(penaltyLevelForBacklog(3), 3);
  assert.equal(penaltyLevelForBacklog(8), 3);
});

test("오늘 미루기를 쓰면 상환 후 남은 현재 의무는 postponed로 유지된다", () => {
  const timeline = evaluateTimeline([
    ...base,
    { date: "2026-09-17", credits: 1, postponed: true },
  ], "2026-09-17");
  assert.deepEqual(timeline.map((item) => item.state), ["complete", "postponed", "postponed"]);
  assert.equal(timeline.at(-1).backlogCount, 2);
});
