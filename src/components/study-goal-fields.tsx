"use client";

import { useId } from "react";
import { GOAL_LABELS, type GoalPolicy, type StudyGoal } from "@/lib/study-goals";
import "./study-goals.css";

const goals = Object.keys(GOAL_LABELS) as StudyGoal[];
const marks: Record<StudyGoal, string> = { algorithm: "⟨/⟩", english: "Aa", reading: "" };

export function GoalPolicyFields({ value, onChange }: { value: GoalPolicy; onChange: (policy: GoalPolicy) => void }) {
  const group = useId();
  function toggle(goal: StudyGoal) {
    const allowed = value.allowed.includes(goal) ? value.allowed.filter((item) => item !== goal) : [...value.allowed, goal];
    if (!allowed.length) return;
    onChange({ ...value, allowed, required: value.mode === "all" ? allowed.length : Math.min(value.required, allowed.length) });
  }

  return <div className="goal-policy">
    <fieldset className="goal-picker">
      <legend>허용 목표</legend>
      <div className="goal-options">{goals.map((goal) => {
        const selected = value.allowed.includes(goal);
        return <label key={goal} className="goal-option">
          <input type="checkbox" checked={selected} disabled={selected && value.allowed.length === 1} onChange={() => toggle(goal)} />
          <span className="goal-tile">
            <span aria-hidden="true" className={goal === "reading" ? "goal-symbol goal-symbol-book" : "goal-symbol"}>{marks[goal]}</span>
            <span>{GOAL_LABELS[goal]}</span>
            <span aria-hidden="true" className="goal-check" />
          </span>
        </label>;
      })}</div>
    </fieldset>

    <fieldset className="goal-criterion">
      <legend>하루 인증 기준</legend>
      {value.allowed.length === 1 ? <p className="goal-single-rule">{GOAL_LABELS[value.allowed[0]]} 목표를 달성하면 하루 인증이에요.</p> : <>
        <div className="goal-mode">{(["all", "count"] as const).map((mode) =>
          <label key={mode}>
            <input type="radio" name={group} checked={value.mode === mode} onChange={() =>
              onChange({ ...value, mode, required: mode === "all" ? value.allowed.length : value.required })} />
            <span>{mode === "all" ? "모두 완료" : "개수 지정"}</span>
          </label>)}</div>
        {value.mode === "count" && <label className="goal-count">완료할 목표 수
          <select value={value.required} onChange={(event) => onChange({ ...value, required: Number(event.target.value) })}>
            {value.allowed.map((_, index) => <option key={index} value={index + 1}>{index + 1}개</option>)}
          </select>
        </label>}
      </>}
    </fieldset>
    {value.allowed.includes("english") && <label className="goal-english">영어 공부 규칙
      <textarea rows={3} maxLength={4000} value={value.englishRule} placeholder="예) 매일 고른 영어 콘텐츠로 20분 공부하기"
        onChange={(event) => onChange({ ...value, englishRule: event.target.value })} />
    </label>}
  </div>;
}
