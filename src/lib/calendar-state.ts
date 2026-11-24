import type { MemberState } from "./calendar-snapshot";

export const CALENDAR_STATE = {
  complete: { icon: "✅", label: "완료" },
  presolved: { icon: "🔵", label: "미리 인증" },
  "in-progress": { icon: "🟡", label: "진행 중" },
  postponed: { icon: "⏭️", label: "미루기" },
  missed: { icon: "❌", label: "미제출" },
  upcoming: { icon: "·", label: "예정" },
  inactive: { icon: "—", label: "참여 전" },
} satisfies Record<MemberState, { icon: string; label: string }>;
