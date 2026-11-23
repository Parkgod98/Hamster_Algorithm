"use client";

import { GOAL_LABELS, type GoalPolicy, type StudyGoal } from "@/lib/study-goals";

export function GoalPolicyFields({ value, onChange }: { value: GoalPolicy; onChange: (policy: GoalPolicy) => void }) {
  function toggle(goal: StudyGoal) {
    const allowed = value.allowed.includes(goal) ? value.allowed.filter((item) => item !== goal) : [...value.allowed, goal];
    if (!allowed.length) return;
    onChange({ ...value, allowed, required: value.mode === "all" ? allowed.length : Math.min(value.required, allowed.length) });
  }
  return <div className="rule-group goal-policy">
    <h4>허용 목표</h4>
    <div className="goal-options">{(Object.keys(GOAL_LABELS) as StudyGoal[]).map((goal) =>
      <label key={goal}><input type="checkbox" checked={value.allowed.includes(goal)}
        disabled={value.allowed.length === 1 && value.allowed[0] === goal}
        onChange={() => toggle(goal)} /> {GOAL_LABELS[goal]}</label>)}</div>
    <label>하루 인증 기준
      <select value={value.mode} onChange={(event) => {
        const mode = event.target.value === "all" ? "all" : "count";
        onChange({ ...value, mode, required: mode === "all" ? value.allowed.length : value.required });
      }}><option value="all">허용 목표 전부 완료</option><option value="count">서로 다른 목표 중 N개 완료</option></select>
    </label>
    {value.mode === "count" && <label>필요한 목표 수
      <select value={value.required} onChange={(event) => onChange({ ...value, required: Number(event.target.value) })}>
        {value.allowed.map((_, index) => <option key={index} value={index + 1}>{index + 1}개</option>)}
      </select></label>}
    {value.allowed.includes("english") && <label>영어 공부 규칙
      <textarea rows={3} maxLength={4000} value={value.englishRule} onChange={(event) => onChange({ ...value, englishRule: event.target.value })} />
    </label>}
  </div>;
}
