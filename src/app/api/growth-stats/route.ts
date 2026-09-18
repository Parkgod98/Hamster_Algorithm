import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { buildGrowthReport, shiftMonth, type GrowthSubmission } from "@/lib/growth-stats";
import { studyDateFromTimestamp, studyDayStartTimestamp } from "@/lib/study-day";
import { createAdminClient, requireUser } from "@/lib/supabase";
import type { Platform } from "@/lib/types";

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

type ProblemRelation = { platform: Platform; difficulty: string };

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
    const { data: membership, error: membershipError } = await admin
      .from(DB.studyMembers)
      .select("study_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (membershipError) return NextResponse.json({ error: "study lookup failed" }, { status: 500 });
    if (!membership) return NextResponse.json({ report: buildGrowthReport([], month) });

    const rangeStartMonth = shiftMonth(month, -2);
    const rangeEndMonth = shiftMonth(month, 1);
    const rangeStart = studyDayStartTimestamp(`${rangeStartMonth}-01`);
    const rangeEndExclusive = studyDayStartTimestamp(`${rangeEndMonth}-01`);
    const { data: submissions, error } = await admin
      .from(DB.submissions)
      .select("solved_at,hamster_problems(platform,difficulty)")
      .eq("study_id", membership.study_id)
      .eq("user_id", user.id)
      .gte("solved_at", rangeStart)
      .lt("solved_at", rangeEndExclusive)
      .order("solved_at", { ascending: true });
    if (error) return NextResponse.json({ error: "submission lookup failed" }, { status: 500 });

    const rows: GrowthSubmission[] = [];
    for (const submission of submissions ?? []) {
      const problem = problemFromRelation(submission.hamster_problems);
      if (!problem) continue;
      rows.push({
        studyDate: studyDateFromTimestamp(submission.solved_at),
        platform: problem.platform,
        difficulty: problem.difficulty,
      });
    }

    return NextResponse.json({ report: buildGrowthReport(rows, month) });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
