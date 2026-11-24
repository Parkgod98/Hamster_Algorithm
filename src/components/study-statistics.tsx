"use client";

import { useMemo } from "react";
import type { CalendarDay, DayMember } from "@/lib/calendar-snapshot";
import { GOALS, GOAL_LABELS, isManualGoal, type StudyGoal } from "@/lib/study-goals";
import { GrowthStatsSection } from "./growth-stats-section";
import { PeriodArrows } from "./period-arrows";
import { useStudyPanel } from "./use-study-panel";

type Member = {userId: string; name: string};
type Penalty = {user_id: string; amount: number};
type Props = {
  month: string; heading: string; studyId: string; viewerId: string; studyDate: string;
  days: CalendarDay[]; members: Member[]; goals: StudyGoal[];
  selectedUserId: string; onSelectUser: (id: string) => void; onMove: (delta: number) => void;
};

export function StudyStatistics({ month, heading, studyId, viewerId, studyDate, days, members, goals,
  selectedUserId, onSelectUser, onMove }: Props) {
  const key = `penalty:${studyId}:${month}`;
  const url = "/api/dashboard/panel?" + new URLSearchParams({studyId, view: "statistics", month});
  const result = useStudyPanel<{penalties: Penalty[]}>(viewerId, key, url);
  const penalties = result?.data?.penalties;
  const statistics = useMemo(() => {
    const byMember = new Map<string, DayMember[]>();
    for (const day of days) {
      if (day.date > studyDate) continue;
      for (const row of day.members) {
        const records = byMember.get(row.userId);
        if (records) records.push(row);
        else byMember.set(row.userId, [row]);
      }
    }
    const totals = new Map<string, number>();
    for (const penalty of penalties ?? []) totals.set(penalty.user_id, (totals.get(penalty.user_id) ?? 0) + penalty.amount);
    return members.map(member => {
      const records = byMember.get(member.userId) ?? [];
      const complete = records.filter(row => row.state === "complete" || row.state === "presolved").length;
      const missed = records.filter(row => row.state === "missed").length;
      const postponed = records.filter(row => row.state === "postponed").length;
      const required = complete + missed + records.filter(row => row.state === "in-progress").length;
      let streak = 0;
      for (let i = records.length - 1; i >= 0; i--) {
        const state = records[i].state;
        if (state === "postponed") continue;
        if (state !== "complete" && state !== "presolved") break;
        streak++;
      }
      const manual = goals.filter(isManualGoal).map(goal => ({
        goal, days: records.filter(row => row.completedGoals?.includes(goal)).length,
      }));
      return { ...member, complete, missed, postponed, streak, manual, rate: required ? Math.round(complete * 100 / required) : 0,
        penalty: penalties ? (totals.get(member.userId) ?? 0).toLocaleString() + "원" : "—" };
    });
  }, [days, studyDate, goals, members, penalties]);
  const solutions = goals.some(goal => GOALS[goal].input === "solutions");
  const Card = solutions ? "button" : "article";
  return <section className="stats-panel">
    <div className="stats-heading"><h2>{heading} 통계</h2><PeriodArrows label="달" onMove={onMove} /></div>
    <p className="stats-status" role="status">{result?.error || (!penalties ? "벌금 기록을 확인하는 중…" : "")}</p>
    <div className="stat-cards">{statistics.map(s => {
      const selected = solutions && s.userId === selectedUserId;
      return <Card key={s.userId} className={`stat-card${solutions ? " stat-card-button" : ""}${selected ? " is-selected" : ""}`}
        {...(solutions ? {type: "button" as const, "aria-pressed": selected, onClick: () => onSelectUser(s.userId)} : {})}>
        <div className="stat-card-head"><strong>{s.name}</strong>{s.userId === viewerId && <span className="me-badge">나</span>}</div>
        <div className="stat-rate"><b>{s.rate}%</b><span>선택 월 인증률</span></div>
        <div className="stat-grid">
          <div><span>완료</span><strong>{s.complete}</strong></div>
          <div><span>미제출</span><strong>{s.missed}</strong></div>
          <div><span>미루기</span><strong>{s.postponed}</strong></div>
          <div><span>연속 인증</span><strong>{s.streak}일</strong></div>
          {s.manual.map(item => <div key={item.goal}><span>{GOAL_LABELS[item.goal]} 인증</span><strong>{item.days}일</strong></div>)}
        </div>
        <div className="stat-penalty"><span>선택 월 확정 벌금</span><strong>{s.penalty}</strong></div>
      </Card>;
    })}</div>
    {solutions && <GrowthStatsSection month={month} studyId={studyId} selectedUserId={selectedUserId}
      currentUserId={viewerId} members={members} onSelectUser={onSelectUser} />}
  </section>;
}
