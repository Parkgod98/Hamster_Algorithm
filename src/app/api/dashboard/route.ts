import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";
import { studyDateFromTimestamp } from "@/lib/study-day";
import { submissionCredit } from "@/lib/rules";
import { dateRange, evaluateTimeline } from "@/lib/progress";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const admin = createAdminClient();
    const { data: membership } = await admin.from(DB.studyMembers).select("study_id").eq("user_id", user.id).limit(1).maybeSingle();
    const current = studyDateFromTimestamp(new Date().toISOString());
    if (!membership) return NextResponse.json({ study: null, members: [], repositories: [], studyDate: current });

    const { data: study } = await admin.from(DB.studies).select("id,name,invite_code,created_at,max_presolve_days").eq("id", membership.study_id).single();
    if (!study) return NextResponse.json({ error: "study not found" }, { status: 404 });

    const [{ data: members }, { data: repos }, { data: subs }, { data: postponements }, { data: penalties }] = await Promise.all([
      admin.from(DB.studyMembers).select("user_id,display_name").eq("study_id", study.id),
      admin.from(DB.repositoryConnections).select("id,full_name").eq("study_id", study.id).eq("user_id", user.id).eq("active", true),
      admin.from(DB.submissions).select("user_id,solved_at,hamster_problems(platform,difficulty)").eq("study_id", study.id),
      admin.from(DB.postponements).select("user_id,study_date").eq("study_id", study.id),
      admin.from(DB.penalties).select("user_id,amount,study_date").eq("study_id", study.id),
    ]);

    const dates = dateRange(studyDateFromTimestamp(study.created_at), current);
    const result = (members ?? []).map((member) => {
      const creditMap = new Map<string, number>();
      for (const submission of subs ?? []) {
        if (submission.user_id !== member.user_id) continue;
        const problem = Array.isArray(submission.hamster_problems) ? submission.hamster_problems[0] : submission.hamster_problems;
        if (!problem) continue;
        const date = studyDateFromTimestamp(submission.solved_at);
        creditMap.set(date, (creditMap.get(date) ?? 0) + submissionCredit(problem.platform, problem.difficulty));
      }
      const postponed = new Set((postponements ?? []).filter((item) => item.user_id === member.user_id).map((item) => item.study_date));
      const timeline = evaluateTimeline(dates.map((date) => ({ date, credits: creditMap.get(date) ?? 0, postponed: postponed.has(date) })), current, study.max_presolve_days);
      const today = timeline.at(-1) ?? { state: "in-progress", available: 0 };
      const label = today.state === "complete" ? "✅ 완료" : today.state === "postponed" ? "⏭️ 미루기" : today.state === "missed" ? "❌ 미제출" : "🟡 진행 중";
      const penalty = (penalties ?? []).filter((item) => item.user_id === member.user_id).reduce((sum, item) => sum + (item.amount ?? 0), 0);
      return {
        userId: member.user_id,
        name: member.display_name,
        state: label,
        credits: Math.min(1, today.available),
        detail: `오늘 credit ${Math.min(1, today.available).toFixed(2)} / 1.00 · 벌금 ${penalty.toLocaleString()}원`,
      };
    });

    return NextResponse.json({
      study: { id: study.id, name: study.name, inviteCode: study.invite_code },
      members: result,
      repositories: (repos ?? []).map((repo) => ({ id: repo.id, fullName: repo.full_name })),
      studyDate: current,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "unexpected error" }, { status: 500 });
  }
}
