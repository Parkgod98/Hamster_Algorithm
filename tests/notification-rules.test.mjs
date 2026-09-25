import test from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_COPY,
  canAttemptDelivery,
  isExpiredPushSubscription,
  isReminderWindow,
  isTransientPushFailure,
  shouldSendCompletion,
  shouldSendReminder,
} from "../src/lib/notification-rules.ts";

test("현재 Study Day가 미완료에서 완료로 바뀔 때만 완료 알림을 보낸다", () => {
  assert.equal(shouldSendCompletion("in-progress", "complete"), true);
  assert.equal(shouldSendCompletion("missed", "complete"), true);
  assert.equal(shouldSendCompletion("complete", "complete"), false);
  assert.equal(shouldSendCompletion("postponed", "postponed"), false);
});

test("완료 또는 미루기 상태에는 미인증 reminder를 보내지 않는다", () => {
  assert.equal(shouldSendReminder("in-progress"), true);
  assert.equal(shouldSendReminder("missed"), true);
  assert.equal(shouldSendReminder("complete"), false);
  assert.equal(shouldSendReminder("postponed"), false);
});

test("sent delivery는 재시도하지 않고 failed 또는 오래된 pending만 재시도한다", () => {
  const now = Date.parse("2026-09-17T15:10:00.000Z");
  assert.equal(canAttemptDelivery(null, null, now), true);
  assert.equal(canAttemptDelivery("failed", "2026-09-17T15:09:50.000Z", now), true);
  assert.equal(canAttemptDelivery("sent", "2026-09-17T15:00:00.000Z", now), false);
  assert.equal(canAttemptDelivery("pending", "2026-09-17T15:08:00.000Z", now), false);
  assert.equal(canAttemptDelivery("pending", "2026-09-17T15:00:00.000Z", now), true);
});

test("Push 상태 코드를 만료와 일시 실패로 구분한다", () => {
  assert.equal(isExpiredPushSubscription(404), true);
  assert.equal(isExpiredPushSubscription(410), true);
  assert.equal(isExpiredPushSubscription(500), false);
  assert.equal(isTransientPushFailure(0), true);
  assert.equal(isTransientPushFailure(429), true);
  assert.equal(isTransientPushFailure(503), true);
  assert.equal(isTransientPushFailure(400), false);
});

test("reminder는 서울 21시 이후부터 Study Day 종료 전까지만 실행한다", () => {
  assert.equal(isReminderWindow("2026-09-17T11:59:59.000Z"), false);
  assert.equal(isReminderWindow("2026-09-17T12:00:00.000Z"), true);
  assert.equal(isReminderWindow("2026-09-17T14:30:00.000Z"), true);
  assert.equal(isReminderWindow("2026-09-17T18:59:59.000Z"), true);
  assert.equal(isReminderWindow("2026-09-17T19:00:00.000Z"), false);
});

test("미인증 알림 문구는 04시 마감 기준을 안내한다", () => {
  assert.equal(NOTIFICATION_COPY.reminder.body, "🐹 아직 오늘 인증이 안 됐어. 04:00 전까지 풀거나 미루기 신청해줘! 쮸!");
});

test("기기 테스트 알림 문구를 제공한다", () => {
  assert.equal(NOTIFICATION_COPY.test.body, "🐹 테스트 알림 도착! 햄쮸터 Push가 정상 동작 중이야. 쮸!");
});
