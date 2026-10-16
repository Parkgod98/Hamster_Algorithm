import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { buildGrowthReport, shiftMonth, type GrowthSubmission } from "@/lib/growth-stats";
import { readAllRows } from "@/lib/read-all-rows";
import { studyDateFromTimestamp, studyDayStartTimestamp } from "@/lib/study-day";
import { createAdminClient, requireUser } from "@/lib/supabase";
import type { Platform } from "@/lib/types";

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
type ProblemRelation = { platform: Platform; difficulty: string };
type SubmissionRow = { solved_at: string; hamster_problems: unknown };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
function requestedMonth(url: string, current: string) {
  const value = new URL(url).searchParams.get("month");
  if (!value) return current.slice(0, 7);
  const match = MONTH_PATTERN.exec(value);
  if (!match) return current.slice(0, 7);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? value : current.slice(0, 7);
}
function problemFromRelation(value: unknown): ProblemRelation | null {
  if (Array.isArray(value)) return (value[0] as ProblemRelation | undefined) ?? null;
  if (value && typeof value === "object") return value as ProblemRelation;
  return null;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const admin = createAdminClient();
    const currentStudyDate = studyDateFromTimestamp(new Date().toISOString());
    const month = requestedMonth(request.url, currentStudyDate);
    const targetUserId = new URL(request.url).searchParams.get("userId") || user.id;
    const { data: membership, error: membershipError } = await admin.from(DB.studyMembers)
      .select("study_id").eq("user_id", user.id).limit(1).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return json({ report: buildGrowthReport([], month, currentStudyDate) });

    const { data: targetMembership, error: targetMembershipError } = await admin.from(DB.studyMembers)
      .select("user_id").eq("study_id", membership.study_id).eq("user_id", targetUserId).maybeSingle();
    if (targetMembershipError) throw targetMembershipError;
    if (!targetMembership) return json({ error: "forbidden" }, 403);

    const rangeStart = studyDayStartTimestamp(`${shiftMonth(month, -2)}-01`);
    const rangeEndExclusive = studyDayStartTimestamp(`${shiftMonth(month, 1)}-01`);
    const submissions = await readAllRows<SubmissionRow>((from, to) => admin.from(DB.submissions)
      .select("solved_at,hamster_problems(platform,difficulty)")
      .eq("study_id", membership.study_id).eq("user_id", targetUserId)
      .gte("solved_at", rangeStart).lt("solved_at", rangeEndExclusive)
      .order("solved_at", { ascending: true }).order("id", { ascending: true }).range(from, to));
    const rows: GrowthSubmission[] = [];
    for (const submission of submissions) {
      const problem = problemFromRelation(submission.hamster_problems);
      if (!problem) throw new Error("Submission problem missing");
      rows.push({ studyDate: studyDateFromTimestamp(submission.solved_at), platform: problem.platform, difficulty: problem.difficulty });
    }
    return json({ report: buildGrowthReport(rows, month, currentStudyDate) });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ error: "unauthorized" }, 401);
    console.error("growth statistics unavailable");
    return json({ error: "풀이 성장 통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
  }
}
