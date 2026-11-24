import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";
import { addStudyDays, studyDateFromTimestamp } from "@/lib/study-day";
import { normalizeRuleConfig } from "@/lib/rules";
import { dateRange } from "@/lib/progress";
import { goalsInPeriod, normalizeRuleVersions, rulesForDate } from "@/lib/rule-version";
import { getPostponementStatus, type PostponementStatus } from "@/lib/postponement-status";
import { readAllRows } from "@/lib/read-all-rows";
import { ProgressChanged, readCheckpointRollout, readProgressWindow, readWindowRules } from "@/lib/progress-window";
import { summarizeCalendar, type DayMember } from "@/lib/calendar-snapshot";

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
type MemberRow = { user_id: string; display_name: string; joined_at: string };

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
export function GET(request: Request) { return dashboard(request, true); }
async function dashboard(request: Request, checkpointAllowed: boolean): Promise<Response> {
  let stage = "session";
  try {
    const user = await requireUser(request);
    stage = "membership";
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

    stage = "rules";
    const rollout = checkpointAllowed ? await readCheckpointRollout(admin, membership.study_id, memberId, bounds[0].start, current) : null;
    let readRevision: string | null = rollout?.revision ?? null;
    if (!readRevision && params.get("baseline") === "1") {
      const head = await admin.from(DB.syncHeads).select("revision").eq("scope","s:" + membership.study_id).maybeSingle();
      if (!head.error) readRevision = String(head.data?.revision ?? 0);
    }
    const [studyResult, rawVersions, memberRows] = await Promise.all([
      admin.from(DB.studies).select("id,name").eq("id", membership.study_id).single(),
      readWindowRules(admin, membership.study_id, addStudyDays(current, 1), rollout),
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
    const versions = normalizeRuleVersions(rawVersions.rows, normalizeRuleConfig);
    const currentRules = rulesForDate(versions, current);
    const scheduledRules = versions.find((version) => version.effectiveFrom > current);
    const monthDates = bounds.flatMap(({start, end}) => dateRange(start, end));
    const maxCarry = rawVersions.maxCarry;
    const futureEnd = addStudyDays(current, maxCarry);
    // Later repayments must update old-month icons. Never truncate the FIFO input to the visible month.
    const lastDay = bounds[bounds.length - 1].end;
    const evaluationEnd = lastDay < current ? current : lastDay < futureEnd ? lastDay : futureEnd;
    stage = "progress";
    const memberWindows = await readProgressWindow({ db: admin, study: study.id, single: memberId, members: memberRows,
      versions, today: current, end: evaluationEnd }, rollout);
    const days = monthDates.map((date) => ({ date, members: [] as DayMember[] }));
    const dayMap = new Map(days.map((date) => [date.date, date]));
    let todayPostponement: PostponementStatus | null = null;
    for (const member of memberRows) {
      const joinedDate = studyDateFromTimestamp(member.joined_at);
      const { dates: timelineMap, credits: creditMap, postponed: requestedAtMap } = memberWindows.get(member.user_id)!;
      if (member.user_id === user.id) todayPostponement = getPostponementStatus({
        studyDate: current, now: new Date().toISOString(), limit: currentRules.maxConsecutivePostpone,
        deadlineHour: currentRules.postponeDeadlineHour, deadlineMinute: currentRules.postponeDeadlineMinute,
        alreadyPostponed: requestedAtMap.has(current), progress: timelineMap.get(current) ?? null,
      });
      for (const date of monthDates) {
        const day = dayMap.get(date); if (!day) continue;
        const directCredits = creditMap.get(date) ?? 0;
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
      monthGoals: goalsInPeriod(versions, bounds[0].start, bounds[0].end < current ? bounds[0].end : current),
      currentUserId: user.id, studyDate: current, month, readRevision,
    });
  } catch (error) {
    if (error instanceof ProgressChanged && checkpointAllowed) return dashboard(request, false);
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ error: "unauthorized" }, 401);
    const reference = "CAL-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    console.error("dashboard progress unavailable", { stage, reference });
    return json({ error: "진행 상태를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.", reference }, 503);
  }
}
