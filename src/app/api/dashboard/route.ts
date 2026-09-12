import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";
import { addStudyDays, studyDateFromTimestamp } from "@/lib/study-day";
import { normalizeRuleConfig, submissionCredit } from "@/lib/rules";
import { dateRange, evaluateTimelineByDay } from "@/lib/progress";
import { normalizeRuleVersions, rulesForDate, type EffectiveRules, type RuleVersionRow } from "@/lib/rule-version";
import type { Platform } from "@/lib/types";

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

type ProblemRow = {
  platform: Platform;
  external_id: string;
  title: string;
  difficulty: string;
};

type DayMember = {
  userId: string;
  name: string;
  state: "inactive" | "upcoming" | "presolved" | "complete" | "in-progress" | "postponed" | "missed";
  credits: number;
  directCredits: number;
  penalty: number;
  consecutiveMisses: number;
  postponedAt: string | null;
  submissions: Array<Record<string, unknown>>;
};

function requestedMonth(url: string, current: string) {
  const value = new URL(url).searchParams.get("month");
  if (!value) return current.slice(0, 7);
  const match = MONTH_PATTERN.exec(value);
  if (!match) return current.slice(0, 7);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? value : current.slice(0, 7);
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${month}-01`;
  const endDate = new Date(Date.UTC(year, monthNumber, 0));
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}

function problemFromRelation(value: unknown): ProblemRow | null {
  if (Array.isArray(value)) return (value[0] as ProblemRow | undefined) ?? null;
  if (value && typeof value === "object") return value as ProblemRow;
  return null;
}

function monthStats(days: Array<{ date: string; members: DayMember[] }>, members: Array<{ user_id: string; display_name: string }>, current: string) {
  return members.map((member) => {
    const states = days
      .filter((day) => day.date <= current)
      .map((day) => day.members.find((item) => item.userId === member.user_id))
      .filter((item): item is DayMember => Boolean(item) && item?.state !== "inactive");
    const complete = states.filter((item) => item.state === "complete" || item.state === "presolved").length;
    const missed = states.filter((item) => item.state === "missed").length;
    const postponed = states.filter((item) => item.state === "postponed").length;
    const required = complete + missed + states.filter((item) => item.state === "in-progress").length;
    let streak = 0;
    for (let index = states.length - 1; index >= 0; index -= 1) {
      const state = states[index].state;
      if (state === "postponed") continue;
      if (state === "complete" || state === "presolved") streak += 1;
      else break;
    }
    return {
      userId: member.user_id,
      name: member.display_name,
      complete,
      missed,
      postponed,
      totalPenalty: states.reduce((sum, item) => sum + item.penalty, 0),
      completionRate: required > 0 ? Math.round((complete / required) * 100) : 0,
      streak,
    };
  });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const admin = createAdminClient();
    const { data: membership } = await admin
      .from(DB.studyMembers)
      .select("study_id,role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    const current = studyDateFromTimestamp(new Date().toISOString());
    const month = requestedMonth(request.url, current);
    const bounds = monthBounds(month);

    if (!membership) {
      return NextResponse.json({
        study: null,
        members: [],
        repositories: [],
        days: [],
        summary: { complete: 0, postponed: 0, missed: 0, inProgress: 0 },
        statistics: [],
        ruleHistory: [],
        currentUserId: user.id,
        studyDate: current,
        month,
      });
    }

    const { data: study } = await admin
      .from(DB.studies)
      .select("id,name,invite_code,created_at,max_presolve_days,max_consecutive_postpone,postpone_deadline_hour,postpone_deadline_minute,rule_config")
      .eq("id", membership.study_id)
      .single();
    if (!study) return NextResponse.json({ error: "study not found" }, { status: 404 });

    const fallback: EffectiveRules = {
      effectiveFrom: studyDateFromTimestamp(study.created_at),
      ruleConfig: normalizeRuleConfig(study.rule_config),
      postponeDeadlineHour: study.postpone_deadline_hour,
      postponeDeadlineMinute: study.postpone_deadline_minute,
      maxConsecutivePostpone: study.max_consecutive_postpone,
      maxPresolveDays: study.max_presolve_days,
    };

    const [membersResult, reposResult, subsResult, postponementsResult, penaltiesResult, versionsResult] = await Promise.all([
      admin.from(DB.studyMembers).select("user_id,display_name,joined_at").eq("study_id", study.id).order("joined_at", { ascending: true }),
      admin.from(DB.repositoryConnections).select("id,full_name").eq("study_id", study.id).eq("user_id", user.id).eq("active", true),
      admin.from(DB.submissions).select("user_id,solved_at,hamster_problems(platform,external_id,title,difficulty)").eq("study_id", study.id).order("solved_at", { ascending: true }),
      admin.from(DB.postponements).select("user_id,study_date,requested_at").eq("study_id", study.id),
      admin.from(DB.penalties).select("user_id,amount,study_date,consecutive_misses").eq("study_id", study.id),
      admin.from(DB.studyRuleVersions).select("effective_from,rule_config,postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone,max_presolve_days,changed_by,created_at").eq("study_id", study.id).order("effective_from", { ascending: true }),
    ]);

    const memberRows = membersResult.data ?? [];
    const submissionRows = subsResult.data ?? [];
    const postponementRows = postponementsResult.data ?? [];
    const penaltyRows = penaltiesResult.data ?? [];
    const rawVersions = (versionsResult.error ? [] : versionsResult.data ?? []) as RuleVersionRow[];
    const versions = normalizeRuleVersions(rawVersions);
    const monthDates = dateRange(bounds.start, bounds.end);
    const maxCarry = Math.max(fallback.maxPresolveDays, ...versions.map((version) => version.maxPresolveDays), 0);
    const presolveEnd = addStudyDays(current, maxCarry);
    const evaluationEnd = bounds.end < presolveEnd ? bounds.end : presolveEnd;

    const days = monthDates.map((date) => ({ date, members: [] as DayMember[] }));
    const dayMap = new Map(days.map((day) => [day.date, day]));

    for (const member of memberRows) {
      const joinedDate = studyDateFromTimestamp(member.joined_at);
      const creditMap = new Map<string, number>();
      const submissionsByDate = new Map<string, Array<Record<string, unknown>>>();

      for (const submission of submissionRows) {
        if (submission.user_id !== member.user_id) continue;
        const problem = problemFromRelation(submission.hamster_problems);
        if (!problem) continue;
        const date = studyDateFromTimestamp(submission.solved_at);
        const effective = rulesForDate(versions, date, fallback);
        const credit = submissionCredit(problem.platform, problem.difficulty, effective.ruleConfig);
        creditMap.set(date, (creditMap.get(date) ?? 0) + credit);
        const list = submissionsByDate.get(date) ?? [];
        list.push({
          platform: problem.platform,
          problemId: problem.external_id,
          title: problem.title,
          difficulty: problem.difficulty,
          credit,
          solvedAt: submission.solved_at,
        });
        submissionsByDate.set(date, list);
      }

      const memberPostponements = postponementRows.filter((item) => item.user_id === member.user_id);
      const postponed = new Set(memberPostponements.map((item) => item.study_date));
      const requestedAtMap = new Map(memberPostponements.map((item) => [item.study_date, item.requested_at]));
      const penaltyMap = new Map(
        penaltyRows
          .filter((item) => item.user_id === member.user_id)
          .map((item) => [item.study_date, { amount: item.amount ?? 0, consecutiveMisses: item.consecutive_misses }]),
      );

      const timelineMap = new Map<string, ReturnType<typeof evaluateTimelineByDay>[number]>();
      if (joinedDate <= evaluationEnd) {
        const timeline = evaluateTimelineByDay(
          dateRange(joinedDate, evaluationEnd).map((date) => ({
            date,
            credits: creditMap.get(date) ?? 0,
            postponed: postponed.has(date),
          })),
          current,
          (date) => rulesForDate(versions, date, fallback).maxPresolveDays,
        );
        for (const item of timeline) timelineMap.set(item.date, item);
      }

      for (const date of monthDates) {
        const day = dayMap.get(date);
        if (!day) continue;
        const directCredits = creditMap.get(date) ?? 0;
        const timeline = timelineMap.get(date);
        let state: DayMember["state"];

        if (date < joinedDate) state = "inactive";
        else if (date > current) state = timeline?.state === "complete" ? "presolved" : "upcoming";
        else state = timeline?.state ?? (date === current ? "in-progress" : "missed");

        const penalty = penaltyMap.get(date);
        day.members.push({
          userId: member.user_id,
          name: member.display_name,
          state,
          credits: Math.min(1, timeline?.available ?? directCredits),
          directCredits,
          penalty: penalty?.amount ?? 0,
          consecutiveMisses: penalty?.consecutiveMisses ?? 0,
          postponedAt: requestedAtMap.get(date) ?? null,
          submissions: submissionsByDate.get(date) ?? [],
        });
      }
    }

    const summary = { complete: 0, postponed: 0, missed: 0, inProgress: 0 };
    for (const day of days) {
      for (const member of day.members) {
        if (member.state === "complete" || member.state === "presolved") summary.complete += 1;
        else if (member.state === "postponed") summary.postponed += 1;
        else if (member.state === "missed") summary.missed += 1;
        else if (member.state === "in-progress") summary.inProgress += 1;
      }
    }

    const memberName = new Map(memberRows.map((member) => [member.user_id, member.display_name]));
    const currentRules = rulesForDate(versions, current, fallback);
    const ruleHistory = [...rawVersions].reverse().map((version) => ({
      effectiveFrom: version.effective_from,
      changedBy: version.changed_by ? memberName.get(version.changed_by) ?? "스터디원" : "초기 설정",
      createdAt: version.created_at ?? null,
    }));

    return NextResponse.json({
      study: {
        id: study.id,
        name: study.name,
        inviteCode: study.invite_code,
        role: membership.role,
        rules: currentRules.ruleConfig,
        postponeDeadlineHour: currentRules.postponeDeadlineHour,
        postponeDeadlineMinute: currentRules.postponeDeadlineMinute,
        maxConsecutivePostpone: currentRules.maxConsecutivePostpone,
        maxPresolveDays: currentRules.maxPresolveDays,
      },
      members: memberRows.map((member) => ({ userId: member.user_id, name: member.display_name })),
      repositories: (reposResult.data ?? []).map((repo) => ({ id: repo.id, fullName: repo.full_name })),
      days,
      summary,
      statistics: monthStats(days, memberRows, current),
      ruleHistory,
      currentUserId: user.id,
      studyDate: current,
      month,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "unexpected error" }, { status: 500 });
  }
}
