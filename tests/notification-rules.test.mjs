import test from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_COPY, shouldSendCompletion, shouldSendReminder } from "../src/lib/notification-rules.ts";

test("현재 Study Day가 미완료에서 완료로 바뀔 때만 완료 알림을 보낸다", () => {
  assert.equal(shouldSendCompletion("in-progress", "complete"), true);
  assert.equal(shouldSendCompletion("missed", "complete"), true);
  assert.equal(shouldSendCompletion("complete", "complete"), false);
  assert.equal(shouldSendCompletion("postponed", "postponed"), false);
});

test("완료 또는 미루기 상태에는 23시 30분 미인증 알림을 보내지 않는다", () => {
  assert.equal(shouldSendReminder("in-progress"), true);
  assert.equal(shouldSendReminder("missed"), true);
  assert.equal(shouldSendReminder("complete"), false);
  assert.equal(shouldSendReminder("postponed"), false);
});

test("미인증 알림 문구는 04시 마감 기준을 안내한다", () => {
  assert.equal(NOTIFICATION_COPY.reminder.body, "🐹 아직 오늘 인증이 안 됐어. 04:00 전까지 풀거나 미루기 신청해줘! 쮸!");
});
