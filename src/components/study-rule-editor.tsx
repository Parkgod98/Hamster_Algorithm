"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { GOAL_LABELS, type StudyRuleConfig } from "@/lib/rules";
import { browserSupabase } from "@/lib/supabase-browser";
import { GoalPolicyFields } from "./study-goal-fields";
import s from "./study-settings.module.css";

export type RulesDraft = {
  ruleConfig: StudyRuleConfig;
  postponeDeadlineHour: number;
  postponeDeadlineMinute: number;
  maxConsecutivePostpone: number;
  maxPresolveDays: number;
};
export type SettingsStudy = Omit<RulesDraft, "ruleConfig"> & {
  id: string;
  name: string;
  role: "admin" | "member";
  rules: StudyRuleConfig;
  scheduledRules?: RulesDraft | null;
};

const platforms = [
  { name: "Baekjoon", tiers: [["Bronze II~I", "bojBronzeCount"], ["Silver V~I", "bojSilverCount"], ["Gold 이상", "bojGoldCount"]] },
  { name: "Programmers", tiers: [["Lv.0~1", "programmersLowCount"], ["Lv.2 이상", "programmersHighCount"]] },
  { name: "SWEA", tiers: [["D2~D3", "sweaLowCount"], ["D4 이상", "sweaHighCount"]] },
  { name: "CodeTree", tiers: [["삼성 기출", "codetreeSamsungCount"]] },
] as const;

function currentSnapshot(study: SettingsStudy): RulesDraft {
  return {
    ruleConfig: study.rules,
    postponeDeadlineHour: study.postponeDeadlineHour,
    postponeDeadlineMinute: study.postponeDeadlineMinute,
    maxConsecutivePostpone: study.maxConsecutivePostpone,
    maxPresolveDays: study.maxPresolveDays,
  };
}

function Quantity({ label, value, unit, min = 0, max, onChange }: {
  label: string; value: number; unit: string; min?: number; max: number; onChange?: (n: number) => void;
}) {
  if (!onChange) return <div className={s.ruleRow}><span>{label}</span><strong>{value.toLocaleString("ko-KR")}{unit}</strong></div>;
  return <label className={s.ruleRow}>
    <span>{label}</span>
    <span className={s.quantity}>
      <input aria-label={label} type="number" inputMode="numeric" min={min} max={max} required
        value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(e.target.valueAsNumber)} />
      <span>{unit}</span>
    </span>
  </label>;
}

function RuleDetails({ title, children }: { title: string; children: ReactNode }) {
  return <details className={s.disclosure}><summary>{title}</summary><div className={s.disclosureBody}>{children}</div></details>;
}

export function StudyRuleEditor({ study, onChanged }: { study: SettingsStudy; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState<RulesDraft | null>(null);
  const [confirmed, setConfirmed] = useState<{ previous: SettingsStudy["scheduledRules"]; saved: RulesDraft } | null>(null);
  const [version, setVersion] = useState<"current" | "scheduled">("current");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const admin = study.role === "admin";
  const editing = admin && draft !== null;
  const scheduled = admin
    ? (confirmed && confirmed.previous === study.scheduledRules ? confirmed.saved : study.scheduledRules)
    : null;
  const showingScheduled = !!scheduled && version === "scheduled";
  const current = currentSnapshot(study);
  const value = editing ? draft : showingScheduled ? scheduled : current;
  const config = value.ruleConfig;
  const goals = config.goals;
  const hour = value.postponeDeadlineHour;
  const minute = value.postponeDeadlineMinute;
  const time = Number.isFinite(hour) && Number.isFinite(minute) ? String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") : "";

  function startEditing() {
    setFeedback("");
    setDraft(structuredClone(scheduled || current));
  }
  function changeConfig(patch: Partial<StudyRuleConfig>) {
    setDraft({ ...value, ruleConfig: { ...config, ...patch } });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true); setFeedback("");
    try {
      const { data } = await browserSupabase().auth.getSession();
      if (!data.session) throw new Error("로그인이 필요해요.");
      const response = await fetch("/api/studies/settings", {
        method: "PATCH",
        headers: { Authorization: "Bearer " + data.session.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ studyId: study.id, ...draft }),
      });
      const result = await response.json() as { error?: string; effectiveFrom: string; ruleConfig: StudyRuleConfig };
      if (!response.ok) throw new Error(result.error || "규칙을 저장하지 못했어요.");
      setConfirmed({ previous: study.scheduledRules, saved: { ...draft, ruleConfig: result.ruleConfig } });
      setFeedback(result.effectiveFrom + " 오전 4시부터 새 규칙을 적용해요.");
      setVersion("scheduled"); setDraft(null);
    } catch (error) {
      setFeedback(error instanceof Error && error.name !== "TypeError" ? error.message : "저장 결과를 확인하지 못했어요. 설정을 다시 열어 확인해 주세요.");
      return;
    } finally { setBusy(false); }
    void onChanged().catch(() => { /* The saved rule stays visible until the next calendar refresh. */ });
  }

  return <section aria-label="인증 규칙">
    <div className={s.ruleHeading}>
      <div>
        <h3>{editing ? "규칙 편집" : showingScheduled ? "예약된 규칙" : "현재 규칙"}</h3>
        <p>{editing ? "저장하면 다음 인증일 오전 4시부터 적용돼요." : showingScheduled ? "다음 인증일 오전 4시부터 적용돼요." : "매일 오전 4시에 새 인증일이 시작돼요."}</p>
      </div>
      {admin && !editing && <button type="button" className={s.quietButton} onClick={startEditing}>{scheduled ? "예약 규칙 편집" : "규칙 편집"}</button>}
    </div>
    {scheduled && !editing && <div className={s.versionSwitch} aria-label="적용할 규칙 선택">
      <button type="button" aria-pressed={!showingScheduled} onClick={() => setVersion("current")}>현재</button>
      <button type="button" aria-pressed={Boolean(showingScheduled)} onClick={() => setVersion("scheduled")}>다음 인증일</button>
    </div>}
    <form className={s.ruleForm} onSubmit={save} onInvalidCapture={e => {
      if (e.target instanceof HTMLElement) {
        const section = e.target.closest("details");
        if (section) section.open = true;
      }
    }}>
      <fieldset disabled={busy} className={s.ruleControls}>
        <div className={s.group}>
          {editing ? <GoalPolicyFields value={goals} onChange={next => changeConfig({ goals: next })} /> : <>
            <h4>하루 인증 기준</h4>
            <p className={s.goalSummary}>{goals.allowed.length === 1 ? GOAL_LABELS[goals.allowed[0]] + " 완료" :
              goals.mode === "all" ? "모든 목표 완료" : "목표 " + goals.allowed.length + "개 중 " + goals.required + "개 완료"}</p>
            {goals.allowed.length > 1 && <p className={s.allowedGoals}>{goals.allowed.map(goal => GOAL_LABELS[goal]).join(" · ")}</p>}
            {goals.allowed.includes("english") && <div className={s.englishRule}><strong>영어 공부 규칙</strong>
              <p>{goals.englishRule || "등록된 영어 규칙이 없어요."}</p></div>}
          </>}
        </div>
        <div className={s.ruleList}>
          {(editing || goals.allowed.includes("algorithm")) && <RuleDetails title="알고리즘 난이도별 문제 수">
            {platforms.map(platform => <div key={platform.name} className={s.platformGroup}>
              <h4>{platform.name}</h4>
              {platform.tiers.map(([tier, key]) => <Quantity key={key} label={tier} value={config[key]} min={1} max={20} unit="문제"
                onChange={editing ? n => changeConfig({ [key]: n }) : undefined} />)}
            </div>)}
          </RuleDetails>}
          <RuleDetails title="미루기와 미리 인증">
            {editing ? <label className={s.ruleRow}><span>미루기 마감</span>
              <input aria-label="미루기 마감" className={s.time} type="time" required value={time} onChange={e => {
                const [h, m] = e.target.value.split(":");
                setDraft({ ...value, postponeDeadlineHour: h ? Number(h) : NaN, postponeDeadlineMinute: m ? Number(m) : NaN });
              }} />
            </label> : <div className={s.ruleRow}><span>미루기 마감</span><strong>{time}</strong></div>}
            <Quantity label="미룰 수 있는 미해결 날짜" value={value.maxConsecutivePostpone} max={7} unit="일" onChange={editing ? n => setDraft({ ...value, maxConsecutivePostpone: n }) : undefined} />
            <Quantity label="미리 인증할 수 있는 날짜" value={value.maxPresolveDays} max={14} unit="일" onChange={editing ? n => setDraft({ ...value, maxPresolveDays: n }) : undefined} />
          </RuleDetails>
          <RuleDetails title="미제출 벌금">
            {([1, 2, 3] as const).map(day => <Quantity key={day} label={day === 3 ? "3일 이상 미해결" : day + "일 미해결"} value={config.penalties[day]}
              max={1000000} unit="원" onChange={editing ? n => changeConfig({ penalties: { ...config.penalties, [day]: n } }) : undefined} />)}
          </RuleDetails>
        </div>
      </fieldset>
      {editing && <div className={s.editActions}>
        <button type="button" className={s.quietButton} disabled={busy} onClick={() => {setDraft(null); setFeedback("");}}>취소</button>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "저장 중…" : "인증 규칙 저장"}</button>
      </div>}
    </form>
    {feedback && <p className={s.notice} role="status">{feedback}</p>}
  </section>;
}
