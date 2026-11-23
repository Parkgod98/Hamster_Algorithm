"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { GOAL_LABELS, type GoalPolicy, type ManualGoal, type StudyGoal } from "@/lib/study-goals";
import "./study-goals.css";

type Token = () => Promise<string | null | undefined>;
type Entry = { id: string; mine: boolean; name: string; goal: ManualGoal; counted: boolean; hasPhoto: boolean };
type Day = { policy: GoalPolicy | null; canSubmit: boolean; entries: Entry[] };
type Props = { studyId: string; date: string; completedGoals?: StudyGoal[]; getAccessToken: Token; onChanged: () => void };

async function sessionHeaders(getAccessToken: Token) {
  const token = await getAccessToken();
  if (!token) throw new Error("로그인이 필요해요.");
  return { Authorization: `Bearer ${token}` };
}

function EntryPhoto({ studyId, entry, getAccessToken }: { studyId: string; entry: Entry; getAccessToken: Token }) {
  const [show, setShow] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!show) return;
    const abort = new AbortController();
    let objectUrl = "";
    async function load() {
      const response = await fetch(`/api/goals/photo?${new URLSearchParams({ studyId, id: entry.id })}`, {
        headers: await sessionHeaders(getAccessToken), cache: "no-store", signal: abort.signal,
      });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }
    void load().catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [entry.id, studyId, getAccessToken, show]);
  return <div>
    <button type="button" className="text-button" aria-expanded={show} onClick={() => {
      setShow(!show); setUrl(""); setError(false);
    }}>{show ? "사진 닫기" : "인증 사진 보기"}</button>
    {show && (url
      ? <Image src={url} alt={`${entry.name}님의 ${GOAL_LABELS[entry.goal]} 인증 사진`} width={480} height={360} unoptimized className="goal-photo" />
      : <p role="status">{error ? "사진을 열 수 없어요. 다시 열어 주세요." : "사진을 불러오는 중…"}</p>)}
  </div>;
}

function DayPanel({ studyId, date, completedGoals = [], getAccessToken, onChanged }: Props) {
  const [data, setData] = useState<Day>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<ManualGoal | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<ManualGoal, File>>>({});
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      const response = await fetch(`/api/goals?${new URLSearchParams({ studyId, date })}`, {
        headers: await sessionHeaders(getAccessToken), cache: "no-store", signal: abort.signal,
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as Day;
      if (!abort.signal.aborted) setData(result);
    }
    void load().catch(() => { if (!abort.signal.aborted) setMessage("날짜별 목표를 불러오지 못했어요."); });
    return () => abort.abort();
  }, [date, studyId, getAccessToken, revision]);

  async function complete(goal: ManualGoal) {
    setBusy(goal); setMessage("");
    try {
      const form = new FormData();
      form.set("date", date); form.set("studyId", studyId); form.set("goal", goal);
      if (photos[goal]) form.set("photo", photos[goal]);
      const response = await fetch("/api/goals", { method: "POST", headers: await sessionHeaders(getAccessToken), body: form });
      const result = await response.json() as { error?: string; id?: string };
      if (!response.ok || !result.id) throw new Error(result.error ?? "인증을 저장할 수 없어요.");
      const entry: Entry = { id: result.id, name: "나", mine: true, goal, counted: true, hasPhoto: Boolean(photos[goal]) };
      setData((previous) => previous ? { ...previous, entries: [...previous.entries.filter((item) => item.id !== entry.id), entry] } : previous);
      setMessage(`${GOAL_LABELS[goal]} 인증을 저장했어요.`);
      setRevision((value) => value + 1);
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "인증을 저장할 수 없어요."); }
    finally { setBusy(null); }
  }

  if (!data) return <p role="status">{message || "날짜별 목표를 불러오는 중…"}</p>;
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
      {entry.hasPhoto && <EntryPhoto studyId={studyId} entry={entry} getAccessToken={getAccessToken} />}
    </li>)}</ul>}
    {message && <p role="status">{message}</p>}
  </section>;
}

export function EnglishDayPanel(props: Props) {
  return <DayPanel {...props} key={props.studyId + props.date} />;
}
