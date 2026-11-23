"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { GOAL_LABELS, type ManualGoal, type StudyGoal } from "@/lib/study-goals";
import type { DayGoals, DayGoalEntry } from "@/lib/day-goals";
import { browserSupabase } from "@/lib/supabase-browser";
import { invalidateViews, readView } from "@/lib/view-cache";
import { useViewRevision } from "./use-view-revision";
import "./study-goals.css";

type Props = {
  viewerId: string; studyId: string; date: string; data: DayGoals; completedGoals?: StudyGoal[];
  onChanged: (entry: DayGoalEntry | null) => void;
};

async function sessionHeaders(viewerId: string) {
  const { data } = await browserSupabase().auth.getSession();
  if (data.session?.user.id !== viewerId) throw new Error("로그인이 필요해요.");
  return { Authorization: `Bearer ${data.session.access_token}` };
}

function EntryPhoto({ studyId, entry, viewerId }: { studyId: string; entry: DayGoalEntry; viewerId: string }) {
  const [show, setShow] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  const revision = useViewRevision(viewerId, `photo:${studyId}:${entry.id}`);
  useEffect(() => {
    if (!show) return;
    let active = true;
    let objectUrl = "";
    const key = `photo:${studyId}:${entry.id}`;
    async function load() {
      const blob = await readView(viewerId, key, async signal => {
        const response = await fetch(`/api/goals/photo?${new URLSearchParams({ studyId, id: entry.id })}`, {
          headers: await sessionHeaders(viewerId), cache: "no-store", signal,
        });
        if (!response.ok) throw new Error("사진을 열 수 없어요.");
        return await response.blob();
      });
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }
    void load().catch(() => { if (active) setError(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [entry.id, viewerId, studyId, show, revision]);
  return <div>
    <button type="button" className="text-button" aria-expanded={show} onClick={() => {
      setShow(!show); setUrl(""); setError(false);
    }}>{show ? "사진 닫기" : "인증 사진 보기"}</button>
    {show && (url
      ? <Image src={url} alt={`${entry.name}님의 ${GOAL_LABELS[entry.goal]} 인증 사진`} width={480} height={360} unoptimized className="goal-photo" />
      : <p role="status">{error ? "사진을 열 수 없어요. 다시 열어 주세요." : "사진을 불러오는 중…"}</p>)}
  </div>;
}

export function EnglishDayPanel({ viewerId, studyId, date, data, completedGoals = [], onChanged }: Props) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<ManualGoal | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<ManualGoal, File>>>({});
  async function complete(goal: ManualGoal) {
    setBusy(goal); setMessage("");
    try {
      const form = new FormData();
      form.set("date", date); form.set("studyId", studyId); form.set("goal", goal);
      if (photos[goal]) form.set("photo", photos[goal]);
      const response = await fetch("/api/goals", { method: "POST", headers: await sessionHeaders(viewerId), body: form });
      const result = await response.json() as { error?: string; id?: string; hasPhoto?: boolean };
      if (!response.ok || !result.id) throw new Error(result.error ?? "인증을 저장할 수 없어요.");
      const entry = typeof result.hasPhoto === "boolean"
        ? { id: result.id, name: "나", mine: true, goal, counted: true, hasPhoto: result.hasPhoto }
        : null;
      invalidateViews(viewerId, [`photo:${studyId}:${result.id}`]);
      setMessage(`${GOAL_LABELS[goal]} 인증을 저장했어요.`);
      onChanged(entry);
    } catch (error) { setMessage(error instanceof Error ? error.message : "인증을 저장할 수 없어요."); }
    finally { setBusy(null); }
  }

  if (!data.policy) return null;
  const policy = data.policy;
  const manualGoals = policy.allowed.filter((goal): goal is ManualGoal => goal !== "algorithm");
  if (!manualGoals.length) return null;
  const completed = new Set([...completedGoals, ...data.entries.filter((item) => item.mine && item.counted).map((item) => item.goal)]);
  const remaining = policy.allowed.filter((goal) => !completed.has(goal));
  const needed = Math.max(0, policy.required - (policy.allowed.length - remaining.length));
  return <section className="day-goals">
    <h3>이날의 목표</h3>
    <p>{policy.allowed.map((goal) => GOAL_LABELS[goal]).join(" · ")} 중 {policy.required}개 완료</p>
    {needed > 0 && data.canSubmit && <p>남은 목표 중 {needed}개를 완료해 주세요. {remaining.map((goal) => GOAL_LABELS[goal]).join(" · ")}</p>}
    {manualGoals.map((goal) => {
      const done = data.entries.some((item) => item.mine && item.counted && item.goal === goal);
      return <div key={goal} className="day-goal">
        <h4>{GOAL_LABELS[goal]}</h4>
        {goal === "english" && policy.englishRule && <p className="goal-instructions">{policy.englishRule}</p>}
        {done ? <p>인증 완료</p> : data.canSubmit && <>
          <label>인증 사진 (선택, 최대 2MB)
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file && file.size > 2 * 1024 * 1024) {
                setMessage("사진은 2MB까지 올릴 수 있어요."); event.target.value = ""; setPhotos({ ...photos, [goal]: undefined });
              } else { setMessage(""); setPhotos({ ...photos, [goal]: file }); }
            }} /></label>
          <button type="button" className="primary-button" disabled={busy !== null}
            onClick={() => void complete(goal)}>{busy === goal ? "저장 중…" : `${GOAL_LABELS[goal]} 완료`}</button>
        </>}
      </div>;
    })}
    {data.entries.length > 0 && <ul className="goal-records">{data.entries.map((entry) => <li key={entry.id}>
      <span>{entry.name} · {GOAL_LABELS[entry.goal]} {entry.counted ? "완료" : "규칙 변경으로 다시 인증 필요"}</span>
      {entry.hasPhoto && <EntryPhoto studyId={studyId} entry={entry} viewerId={viewerId} />}
    </li>)}</ul>}
    {message && <p role="status">{message}</p>}
  </section>;
}
