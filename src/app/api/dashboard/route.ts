import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";
import { addStudyDays, studyDateFromTimestamp } from "@/lib/study-day";
import { normalizeRuleConfig } from "@/lib/rules";
import { dateRange } from "@/lib/progress";
import { normalizeRuleVersions, rulesForDate, type RuleVersionRow } from "@/lib/rule-version";
import { getPostponementStatus, type PostponementStatus } from "@/lib/postponement-status";
import { readAllRows } from "@/lib/read-all-rows";
import { readGoalCompletions, evaluateStudyTimeline, groupDailyCredits, type DailySolutions } from "@/lib/server-progress";
import { summarizeCalendar, type DayMember } from "@/lib/calendar-snapshot";

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
type MemberRow = { user_id: string; display_name: string; joined_at: string };
type PostponementRow = { user_id: string; study_date: string; requested_at: string };

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
function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return { start: `${month}-01`, end: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10) };
}
function groupByUser<T extends { user_id: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.user_id) ?? [];
    group.push(row);
    groups.set(row.user_id, group);
  }
  return groups;
}
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const admin = createAdminClient();
    const params = new URL(request.url).searchParams;
    const requestedStudy = params.get("studyId");
    let memberships = admin.from(DB.studyMembers).select("study_id,role").eq("user_id", user.id);
    if (requestedStudy) memberships = memberships.eq("study_id", requestedStudy);
    const membershipResult = await memberships.order("joined_at").order("study_id").limit(1).maybeSingle();
    if (membershipResult.error) throw membershipResult.error;
    const membership = membershipResult.data;
    const current = studyDateFromTimestamp(new Date().toISOString());
    const month = requestedMonth(request.url, current);
    const memberId = params.get("member");
    let months = [month];
    if (memberId !== null) {
      if (!memberId || !requestedStudy) return json({ error: "스터디와 멤버를 선택해주세요." }, 400);
      months = [...new Set((params.get("months") ?? "").split(","))].sort();
      if (!months.length || months.length > 12 || months.some(value => !/^\d{4}-(0[1-9]|1[0-2])$/.test(value))) {
        return json({ error: "확인할 달을 선택해주세요." }, 400);
      }
    }
    const bounds = months.map(monthBounds);
    if (requestedStudy && !membership) return json({ error: "forbidden" }, 403);
    if (!membership) return json({ study: null, members: [], repositories: [], days: [],
      summary: { complete: 0, postponed: 0, missed: 0, inProgress: 0 }, statistics: [], ruleHistory: [],
      currentUserId: user.id, studyDate: current, month, todayPostponement: null });

    const [studyResult, rawVersions, memberRows] = await Promise.all([
      admin.from(DB.studies).select("id,name").eq("id", membership.study_id).single(),
      readAllRows<RuleVersionRow>((from, to) => admin.from(DB.studyRuleVersions)
        .select("effective_from,rule_config,postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone,max_presolve_days")
        .eq("study_id", membership.study_id).lte("effective_from", addStudyDays(current, 1))
        .order("effective_from", { ascending: true }).range(from, to)),
      readAllRows<MemberRow>((from, to) => {
        let query = admin.from(DB.studyMembers).select("user_id,display_name,joined_at").eq("study_id", membership.study_id);
        if (memberId) query = query.eq("user_id", memberId);
        return query.order("joined_at", { ascending: true }).order("user_id", { ascending: true }).range(from, to);
      }),
    ]);
    if (memberId && memberRows.length === 0) return json({ error: "멤버를 찾을 수 없어요." }, 404);
    if (studyResult.error) throw studyResult.error;
    const study = studyResult.data;
    if (!study) return json({ error: "study not found" }, 404);
    const versions = normalizeRuleVersions(rawVersions, normalizeRuleConfig);
    const currentRules = rulesForDate(versions, current);
    const scheduledRules = versions.find((version) => version.effectiveFrom > current);
    const monthDates = bounds.flatMap(({start, end}) => dateRange(start, end));
    const maxCarry = Math.max(...versions.map((version) => version.maxPresolveDays), 0);
    const futureEnd = addStudyDays(current, maxCarry);
    // Later repayments must update old-month icons. Never truncate the FIFO input to the visible month.
    const lastDay = bounds[bounds.length - 1].end;
    const evaluationEnd = lastDay < current ? current : lastDay < futureEnd ? lastDay : futureEnd;
    const memberIds = memberRows.map((member) => member.user_id);
    const earliestJoined = memberRows.map((member) => studyDateFromTimestamp(member.joined_at)).sort()[0];
    const [creditRows, goalRows, postponementRows] = await Promise.all([
      earliestJoined && earliestJoined <= current ? readAllRows<DailySolutions>((from, to) => {
        let query = admin.from(DB.dailySolutionCounts).select("user_id,study_date,platform,difficulty,solves,solved_through")
          .eq("study_id", study.id).gte("study_date", earliestJoined).lte("study_date", current);
        if (memberId) query = query.eq("user_id", memberId);
        return query.order("study_date").order("user_id").order("platform").order("difficulty").order("solved_through").range(from, to);
      }) : [],
      readGoalCompletions(admin, study.id, evaluationEnd, memberIds),
      earliestJoined && earliestJoined <= current ? readAllRows<PostponementRow>((from, to) => admin.from(DB.postponements)
        .select("user_id,study_date,requested_at").eq("study_id", membership.study_id).in("user_id", memberIds)
        .gte("study_date", earliestJoined).lte("study_date", current)
        .order("study_date", { ascending: true }).order("user_id", { ascending: true }).range(from, to)) : Promise.resolve([]),
    ]);
    const creditsByUser = groupByUser(creditRows);
    const goalsByUser = groupByUser(goalRows);
    const postponementsByUser = groupByUser(postponementRows);

    const days = monthDates.map((date) => ({ date, members: [] as DayMember[] }));
    const dayMap = new Map(days.map((day) => [day.date, day]));
    let todayPostponement: PostponementStatus | null = null;
    for (const member of memberRows) {
      const joinedDate = studyDateFromTimestamp(member.joined_at);
      const creditMap = groupDailyCredits(creditsByUser.get(member.user_id) ?? [], versions, joinedDate, current);
      const memberPostponements = postponementsByUser.get(member.user_id) ?? [];
      const postponed = new Set(memberPostponements.map((item) => item.study_date));
      const requestedAtMap = new Map(memberPostponements.map((item) => [item.study_date, item.requested_at]));
      const timelineMap = new Map<string, ReturnType<typeof evaluateStudyTimeline>[number]>();
      if (joinedDate <= evaluationEnd) {
        const timeline = evaluateStudyTimeline(
          dateRange(joinedDate, evaluationEnd).map((date) => ({ date, ...(creditMap.get(date) ?? { credits: 0 }), postponed: postponed.has(date) })),
          current, versions, goalsByUser.get(member.user_id) ?? [],
        );
        for (const item of timeline) timelineMap.set(item.date, item);
      }
      if (member.user_id === user.id) todayPostponement = getPostponementStatus({
        studyDate: current, now: new Date().toISOString(), limit: currentRules.maxConsecutivePostpone,
        deadlineHour: currentRules.postponeDeadlineHour, deadlineMinute: currentRules.postponeDeadlineMinute,
        alreadyPostponed: postponed.has(current), progress: timelineMap.get(current) ?? null,
      });
      for (const date of monthDates) {
        const day = dayMap.get(date); if (!day) continue;
        const directCredits = creditMap.get(date)?.credits ?? 0;
        const timeline = timelineMap.get(date);
        let state: DayMember["state"];
        if (date < joinedDate) state = "inactive";
        else if (date > current) state = timeline?.state === "complete" ? "presolved" : "upcoming";
        else state = timeline?.state ?? (date === current ? "in-progress" : "missed");

        day.members.push({ userId: member.user_id, name: member.display_name, state,
          completedGoals: timeline?.completedGoals ?? [], credits: Math.min(1, timeline?.available ?? directCredits), directCredits,
          postponedAt: requestedAtMap.get(date) ?? null, resolvedOn: timeline?.resolvedOn ?? null,
        });
      }
    }
    if (memberId) return json({ viewerId: user.id, studyId: study.id, memberId, studyDate: current, days, todayPostponement });
    const summary = summarizeCalendar(days);
    return json({
      study: { id: study.id, name: study.name, role: membership.role, rules: currentRules.ruleConfig,
        postponeDeadlineHour: currentRules.postponeDeadlineHour, postponeDeadlineMinute: currentRules.postponeDeadlineMinute,
        maxConsecutivePostpone: currentRules.maxConsecutivePostpone, maxPresolveDays: currentRules.maxPresolveDays,
        scheduledRules: scheduledRules ?? null },
      members: memberRows.map((member) => ({ userId: member.user_id, name: member.display_name })),
      days, summary, todayPostponement,
      currentUserId: user.id, studyDate: current, month,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ error: "unauthorized" }, 401);
    console.error("dashboard progress unavailable");
    return json({ error: "진행 상태를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
  }
}
