import type { CalendarDay, CalendarSummary, MemberCalendarPatch } from "./calendar-snapshot";
import { summarizeCalendar } from "./calendar-snapshot";
import type { PostponementStatus } from "./postponement-status";
import { studyDateFromTimestamp } from "./study-day";
import { browserSupabase } from "./supabase-browser";
import { cancelViewLoads, invalidateViews, listViewKeys, notifyViews, peekView, putView, readView } from "./view-cache";

type Snapshot = {
  currentUserId: string; study: { id: string }; studyDate: string; month: string;
  days: CalendarDay[]; summary: CalendarSummary; todayPostponement?: PostponementStatus | null;
};
const pending = new Set<string>();

/** One authorized timeline for a changed member also settles older FIFO obligations in other cached months. */
export function refreshMemberCalendars(viewer: string, study: string, member: string) {
  const prefix = `calendar:${study}:`;
  const patchKey = `member-progress:${study}:${member}`;
  const cancelled = cancelViewLoads(viewer, [prefix, "calendar::"]);
  if (cancelled.length) notifyViews(viewer, cancelled);
  cancelViewLoads(viewer, [patchKey]);
  const scope = JSON.stringify([viewer, patchKey]);
  if (pending.has(scope) || !listViewKeys(viewer, prefix).length) return;
  pending.add(scope);
  setTimeout(() => {
    pending.delete(scope);
    void update().catch(error => {
      if (!(error instanceof Error && error.name === "AbortError")) invalidateViews(viewer, [prefix]);
    });
  }, 120);

  async function update() {
    // Keep inactive months lazy when a long-running tab has accumulated many views.
    const keys = listViewKeys(viewer, prefix);
    if (keys.length > 12) invalidateViews(viewer, keys.splice(0, keys.length - 12));
    const before = keys.map(key => ({ key, value: peekView<Snapshot>(viewer, key) })).filter(item => item.value !== undefined);
    if (!before.length) return;
    const months = before.map(item => item.value!.month);
    const patch = await readView(viewer, patchKey, async signal => {
      const { data } = await browserSupabase().auth.getSession();
      if (data.session?.user.id !== viewer) throw new DOMException("Session changed", "AbortError");
      const params = new URLSearchParams({ studyId: study, member, months: months.join(",") });
      const response = await fetch(`/api/dashboard?${params}`, {
        headers: { Authorization: "Bearer " + data.session.access_token }, cache: "no-store", signal,
      });
      if (!response.ok) throw Error("달력 갱신 실패");
      return await response.json() as MemberCalendarPatch;
    }, { ttlMs: 0 });
    if (patch.viewerId !== viewer || patch.studyId !== study || patch.memberId !== member ||
        patch.studyDate !== studyDateFromTimestamp(new Date().toISOString())) throw Error("달력 범위가 바뀌었어요.");
    const byDate = new Map(patch.days.map(day => [day.date, day.members[0]]));
    const updated: string[] = [];
    for (const { key, value: initial } of before) {
      const current = peekView<Snapshot>(viewer, key);
      if (!current || !initial) continue;
      if (current.studyDate !== patch.studyDate || current.currentUserId !== viewer || current.study?.id !== study) {
        invalidateViews(viewer, [key]);
        continue;
      }
      // A new full response for this month already superseded the requested patch.
      if (current.days.length !== initial.days.length || current.days.some((day, i) =>
        day.members.find(row => row.userId === member) !== initial.days[i].members.find(row => row.userId === member))) continue;
      if (current.days.some(day => byDate.get(day.date)?.userId !== member || !day.members.some(row => row.userId === member))) {
        invalidateViews(viewer, [key]);
        continue;
      }
      const days = current.days.map(day => ({ ...day, members: day.members.map(row => row.userId === member ? byDate.get(day.date)! : row) }));
      putView(viewer, key, { ...current, days, summary: summarizeCalendar(days),
        todayPostponement: viewer === member ? patch.todayPostponement : current.todayPostponement });
      updated.push(key);
    }
    if (updated.length) notifyViews(viewer, updated);
  }
}
