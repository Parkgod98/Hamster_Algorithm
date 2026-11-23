import type { PostponementStatus } from "./postponement-status";
import type { StudyGoal } from "./rules";

export type MemberState = "inactive" | "upcoming" | "presolved" | "complete" | "in-progress" | "postponed" | "missed";
export type DayMember = {
  userId: string; name: string; state: MemberState; credits: number; directCredits: number;
  postponedAt: string | null; resolvedOn?: string | null; completedGoals: StudyGoal[];
};
export type CalendarDay = { date: string; members: DayMember[] };
export type CalendarSummary = { complete: number; postponed: number; missed: number; inProgress: number };
export type MemberCalendarPatch = {
  viewerId: string; studyId: string; memberId: string; studyDate: string;
  days: CalendarDay[]; todayPostponement: PostponementStatus | null;
};

export function summarizeCalendar(days: CalendarDay[]): CalendarSummary {
  const summary = { complete: 0, postponed: 0, missed: 0, inProgress: 0 };
  for (const day of days) for (const member of day.members) {
    if (member.state === "complete" || member.state === "presolved") summary.complete++;
    else if (member.state === "postponed") summary.postponed++;
    else if (member.state === "missed") summary.missed++;
    else if (member.state === "in-progress") summary.inProgress++;
  }
  return summary;
}
