import test from "node:test";
import assert from "node:assert/strict";
import {
  studyDateFromTimestamp,
  studyDayEndExclusiveTimestamp,
  studyDayStartTimestamp,
} from "../src/lib/study-day.ts";

test("Study Day 경계는 Asia/Seoul 04:00이다", () => {
  assert.equal(studyDateFromTimestamp("2026-09-18T18:59:59.999Z"), "2026-09-18");
  assert.equal(studyDateFromTimestamp("2026-09-18T19:00:00.000Z"), "2026-09-19");
  assert.equal(studyDayStartTimestamp("2026-09-19"), "2026-09-18T19:00:00.000Z");
  assert.equal(studyDayEndExclusiveTimestamp("2026-09-19"), "2026-09-19T19:00:00.000Z");
});
