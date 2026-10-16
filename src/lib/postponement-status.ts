import type { TimelineResult } from "./progress";

export type PostponementReason =
  | "available" | "already-postponed" | "complete" | "disabled"
  | "limit-reached" | "deadline-passed" | "unavailable";

export type PostponementStatus = {
  studyDate: string;
  canPostpone: boolean;
  alreadyPostponed: boolean;
  reason: PostponementReason;
  limit: number;
  backlogCount: number | null;
  requiredRepaymentDays: number;
  /** Exclusive deadline, including the configured minute, capped at 04:00. */
  deadlineAt: string | null;
  message: string;
};

type Input = {
  studyDate: string;
  now: string;
  limit: number;
  deadlineHour: number;
  deadlineMinute: number;
  alreadyPostponed: boolean;
  progress: TimelineResult | null;
};

/** One decision for the status endpoint and the write endpoint. Never clamp N to 2. */
export function getPostponementStatus(input: Input): PostponementStatus {
  const { studyDate, limit, progress, alreadyPostponed } = input;
  const status: PostponementStatus = {
    studyDate, limit, alreadyPostponed, canPostpone: false, reason: "unavailable",
    backlogCount: progress?.backlogCount ?? null, requiredRepaymentDays: 0,
    deadlineAt: null, message: "진행 상태를 확인하지 못했어요. 상태를 다시 확인해주세요.",
  };
  const midnight = Date.parse(`${studyDate}T00:00:00+09:00`);
  const now = Date.parse(input.now);
  if (!Number.isFinite(midnight) || !Number.isFinite(now)
    || !Number.isInteger(limit) || limit < 0
    || !Number.isInteger(input.deadlineHour) || input.deadlineHour < 0 || input.deadlineHour > 23
    || !Number.isInteger(input.deadlineMinute) || input.deadlineMinute < 0 || input.deadlineMinute > 59) return status;

  const hourMs = 3_600_000;
  const cutoff = midnight + 28 * hourMs;
  const deadlineDayOffset = input.deadlineHour < 4 ? 24 : 0;
  const deadline = Math.min(cutoff, midnight + (deadlineDayOffset + input.deadlineHour) * hourMs
    + (input.deadlineMinute + 1) * 60_000);
  status.deadlineAt = new Date(deadline).toISOString();
  if (now < midnight + 4 * hourMs || now >= cutoff) return status;

  if (alreadyPostponed) return { ...status, reason: "already-postponed", message: "이미 오늘 미루기를 신청했어요." };
  if (!progress || progress.date !== studyDate || !Number.isInteger(progress.backlogCount)
    || progress.backlogCount < 0) return status;
  if (progress.state === "complete" && progress.backlogCount === 0) {
    return { ...status, reason: "complete", message: "오늘까지 필요한 인증을 모두 완료했어요." };
  }
  if (progress.backlogCount === 0 || progress.state === "complete") return status;
  status.requiredRepaymentDays = Math.max(0, progress.backlogCount - limit);
  if (limit === 0) return { ...status, reason: "disabled", message: "이 스터디는 미루기를 사용하지 않도록 설정되어 있어요." };
  if (now >= deadline) {
    const label = `${String(input.deadlineHour).padStart(2, "0")}:${String(input.deadlineMinute).padStart(2, "0")}`;
    return { ...status, reason: "deadline-passed", message: `오늘 미루기 신청 마감(${label})이 지났어요.` };
  }
  if (progress.backlogCount > limit) {
    return { ...status, reason: "limit-reached", message: `현재 ${progress.backlogCount}일치가 남아 있어요. 가장 오래된 날짜부터 ${status.requiredRepaymentDays}일치를 완전히 해결해야 다시 미룰 수 있어요. (상한 ${limit}일)` };
  }
  return { ...status, canPostpone: true, reason: "available", message: `오늘 포함 ${progress.backlogCount}일치가 남아 있어요. 미루기 상한 ${limit}일 이내라 신청할 수 있어요.` };
}
