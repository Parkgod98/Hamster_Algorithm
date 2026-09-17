export type NotificationProgressState = "complete" | "in-progress" | "postponed" | "missed";
export type DeliveryState = "pending" | "sent" | "failed";

export function shouldSendCompletion(previous: NotificationProgressState, next: NotificationProgressState) {
  return previous !== "complete" && next === "complete";
}

export function shouldSendReminder(state: NotificationProgressState) {
  return state !== "complete" && state !== "postponed";
}

export function canAttemptDelivery(
  status: DeliveryState | null,
  attemptedAt: string | null,
  now = Date.now(),
  pendingStaleMs = 5 * 60 * 1000,
) {
  if (!status || status === "failed") return true;
  if (status === "sent") return false;
  if (!attemptedAt) return true;
  const attempted = Date.parse(attemptedAt);
  return Number.isNaN(attempted) || now - attempted >= pendingStaleMs;
}

export function isTransientPushFailure(statusCode: number) {
  return statusCode === 0 || statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

export function isExpiredPushSubscription(statusCode: number) {
  return statusCode === 404 || statusCode === 410;
}

export function isReminderWindow(iso: string) {
  const seoul = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const hour = seoul.getUTCHours();
  const minute = seoul.getUTCMinutes();
  return (hour === 23 && minute >= 30) || hour === 0 || hour === 1 || hour === 2 || hour === 3;
}

export const NOTIFICATION_COPY = {
  completion: {
    title: "햄쮸터",
    body: "🐹 오늘 인증 완료! 수고했다 쮸!",
  },
  reminder: {
    title: "햄쮸터",
    body: "🐹 아직 오늘 인증이 안 됐어. 04:00 전까지 풀거나 미루기 신청해줘! 쮸!",
  },
  test: {
    title: "햄쮸터",
    body: "🐹 테스트 알림 도착! 햄쮸터 Push가 정상 동작 중이야. 쮸!",
  },
} as const;
