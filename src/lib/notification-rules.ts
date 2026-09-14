export type NotificationProgressState = "complete" | "in-progress" | "postponed" | "missed";

export function shouldSendCompletion(previous: NotificationProgressState, next: NotificationProgressState) {
  return previous !== "complete" && next === "complete";
}

export function shouldSendReminder(state: NotificationProgressState) {
  return state !== "complete" && state !== "postponed";
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
} as const;
