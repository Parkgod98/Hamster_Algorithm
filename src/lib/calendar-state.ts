import type { DayMember, MemberState } from "./calendar-snapshot";

export const CALENDAR_STATE = {
  complete: { icon: "✅", label: "완료" },
  presolved: { icon: "🔵", label: "미리 인증" },
  "in-progress": { icon: "🟡", label: "진행 중" },
  postponed: { icon: "⏭️", label: "미루기" },
  missed: { icon: "❌", label: "미제출" },
  upcoming: { icon: "·", label: "예정" },
  inactive: { icon: "—", label: "참여 전" },
} satisfies Record<MemberState, { icon: string; label: string }>;


export function calendarStateLabel(member: DayMember, date: string) {
  if (member.state === "complete" && member.resolvedOn && member.resolvedOn > date) return "보충 완료";
  return CALENDAR_STATE[member.state].label;
}

const weekdayFormatter = new Intl.DateTimeFormat("ko-KR", { weekday: "long", timeZone: "UTC" });
export function formatDateHeading(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${month}월 ${day}일 ${weekdayFormatter.format(new Date(`${date}T00:00:00Z`))}`;
}
