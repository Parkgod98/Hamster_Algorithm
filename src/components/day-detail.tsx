"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CALENDAR_STATE, calendarStateLabel, formatDateHeading } from "@/lib/calendar-state";
import type { CalendarDay, DayMember } from "@/lib/calendar-snapshot";
import { type DayGoals, type DayGoalEntry } from "@/lib/day-goals";
import { refreshMemberCalendars } from "@/lib/member-calendar-refresh";
import type { PostponementStatus } from "@/lib/postponement-status";
import { GOAL_LABELS } from "@/lib/rules";
import { invalidateViews, peekView } from "@/lib/view-cache";
import { ManualGoalPanel } from "./manual-goal-panel";
import { ManualRegistration, PLATFORM_LABEL, type useManualRegistration } from "./manual-registration";
import { PostponementControl } from "./postponement-control";
import { useStudyPanel } from "./use-study-panel";

type Submission = {
  userId: string; platform: keyof typeof PLATFORM_LABEL; problemId: string; title: string; difficulty: string;
  credit: number; solvedAt: string; source: string;
};
type DayPanel = {
  algorithm: boolean; goals: DayGoals; submissions: Submission[]; penalties: Array<{ user_id: string; amount: number }>;
};
type Props = {
  date: string; studyDate: string; viewerId: string; studyId: string; day?: CalendarDay;
  manual: ReturnType<typeof useManualRegistration>; postponement?: PostponementStatus | null;
  onPostpone: (status: PostponementStatus, requestedAt: string) => void;
  toast: string; onMessage: (message: string) => void; onClose: () => void;
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {timeZone: "Asia/Seoul", hour:"2-digit", minute:"2-digit", hour12:false}).format(new Date(value));
}

function DaySheet({ children, onClose, date }: { children: ReactNode; onClose: () => void; date: string }) {
  const sheet = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = sheet.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = originalOverflow;
      const returnTarget = opener?.isConnected && opener !== document.body ? opener : document.querySelector<HTMLElement>(`[data-calendar-date="${date}"]`);
      returnTarget?.focus({ preventScroll: true });
    };
  }, [date]);

  return <dialog ref={sheet} className="ham-day-sheet" aria-labelledby="ham-day-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    {children}
  </dialog>;
}

function MemberDetail({ member, mine, date, panel, error }: {
  member: DayMember; mine: boolean; date: string; panel?: DayPanel; error?: string;
}) {
  const submissions = panel?.submissions.filter(row => row.userId === member.userId) ?? [];
  const penalty = panel?.penalties.find(row => row.user_id === member.userId)?.amount ?? 0;
  return <section className="detail-member">
    <div className="detail-member-heading">
      <div><strong>{member.name}</strong>{mine && <span className="me-badge">나</span>}</div>
      <span className={`state-label state-${member.state}`}><span aria-hidden="true">{CALENDAR_STATE[member.state].icon}</span> {calendarStateLabel(member, date)}</span>
    </div>
    {member.completedGoals?.length > 0 && <p>{member.completedGoals.map(goal => GOAL_LABELS[goal]).join(" · ")} 완료</p>}
    {submissions.length ? <div className="submission-list">{submissions.map((s,i) =>
      <div className="submission-row" key={`${s.problemId}-${s.solvedAt}-${i}`}>
        <div>
          <strong>{s.source === "manual" ? `${PLATFORM_LABEL[s.platform] ?? s.platform} · ${s.difficulty}` : s.title}</strong>
          <span>{s.source === "manual" ? <>수동 인증 <em className="manual-badge">수동</em></>
            : <>{s.platform} {s.problemId} · {s.difficulty} · {formatTime(s.solvedAt)}</>}</span>
        </div><b>+{s.credit.toFixed(2)}</b>
      </div>)}</div> : (error || !panel || panel.algorithm) && <p className="empty-copy">
        {error || (!panel ? "상세 기록을 불러오는 중…" : "이 날짜에 직접 기록된 풀이가 없습니다.")}</p>}
    {panel?.algorithm && <div className="credit-row"><span>직접 풀이 인정량</span><strong>{member.directCredits.toFixed(2)} / 1.00</strong></div>}
    {member.state === "presolved" && <p className="presolve-note">미리 인증한 목표가 반영된 날짜예요.</p>}
    {member.resolvedOn && member.resolvedOn > date && <p className="presolve-note">{member.resolvedOn}에 보충 완료한 인증입니다.</p>}
    {member.postponedAt && <p className="postpone-note">{formatTime(member.postponedAt)} 미루기 신청</p>}
    {penalty > 0 && <div className="penalty-row"><span>미제출 벌금</span><strong>{penalty.toLocaleString()}원</strong></div>}
  </section>;
}

export function DayDetail({date, studyDate, viewerId, studyId, day, manual, postponement, onPostpone, toast, onMessage, onClose}: Props) {
  const key = `day:${studyId}:${date}`;
  const url = "/api/dashboard/panel?" + new URLSearchParams({studyId, view: "day", date});
  const detail = useStudyPanel<DayPanel>(viewerId, key, url);
  function confirmGoal(entry: DayGoalEntry | null) {
    const current = peekView<DayPanel>(viewerId, key);
    if (entry && current && detail) {
      const { goals } = current;
      detail.replace({ ...current, goals: { ...goals, entries: [...goals.entries.filter(row => row.id !== entry.id), entry] } });
    } else {
      invalidateViews(viewerId, [key]);
    }
    refreshMemberCalendars(viewerId, studyId, viewerId);
  }
  return <DaySheet date={date} onClose={onClose}>
    <div className="sheet-header"><div><h2 id="ham-day-title">{formatDateHeading(date)}</h2>
      <p>오전 4시부터 다음 날 오전 3시 59분까지</p></div>
      <button type="button" className="close-button" aria-label="날짜 상세 닫기" onClick={onClose}>×</button>
    </div>
    <div className="detail-members">
      {day?.members.filter(m => m.state !== "inactive").map(member => <MemberDetail key={member.userId}
        member={member} mine={member.userId === viewerId} date={date} panel={detail?.data} error={detail?.error} />)}
      {detail?.data?.algorithm && date <= studyDate && <ManualRegistration {...manual} />}
      {detail?.data?.goals && <ManualGoalPanel key={studyId + date} viewerId={viewerId} studyId={studyId} date={date}
        data={detail.data.goals} completedGoals={day?.members.find(m => m.userId === viewerId)?.completedGoals} onChanged={confirmGoal} />}
    </div>
    {date === studyDate && <PostponementControl key={`${studyId}:${studyDate}:${JSON.stringify(postponement)}`}
      studyId={studyId} studyDate={studyDate} initialStatus={postponement ?? null} onChanged={onPostpone} onMessage={onMessage} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </DaySheet>;
}
