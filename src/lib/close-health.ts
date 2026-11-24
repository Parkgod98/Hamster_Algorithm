export type CloseAttempt = { stage: string; target_day: string; error_code: string | null };

export function closeHealth(expected: string, next: string | null, attempt: CloseAttempt | null) {
  if (next && next > expected) return { ok: true, expected };
  if (!attempt) return { ok: false, expected, reason: "no-start-observed" };
  return { ok: false, expected, target: attempt.target_day,
    reason: attempt.error_code ? "worker-failed" : "worker-incomplete", stage: attempt.stage, code: attempt.error_code };
}
