"use client";

import { useRef, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";
import { shiftMonth } from "@/lib/study-day";
import { refreshMemberCalendars } from "@/lib/member-calendar-refresh";
import { invalidateViews } from "@/lib/view-cache";

type ManualPlatform="BOJ"|"PROGRAMMERS"|"SWEA"|"CODETREE";

type DifficultyOption={label:string;value:string};
const MANUAL_DIFFICULTIES:Record<ManualPlatform,DifficultyOption[]>={
  BOJ:[{label:"Bronze II~I",value:"Bronze I"},{label:"Silver V~I",value:"Silver III"},{label:"Gold 이상",value:"Gold V"}],
  PROGRAMMERS:[{label:"Lv.0~1",value:"Level 1"},{label:"Lv.2 이상",value:"Level 2"}],
  SWEA:[{label:"D2~D3",value:"D3"},{label:"D4 이상",value:"D4"}],
  CODETREE:[{label:"삼성 기출",value:"SAMSUNG"}],
};
export const PLATFORM_LABEL:Record<ManualPlatform,string>={BOJ:"Baekjoon",PROGRAMMERS:"Programmers",SWEA:"SWEA",CODETREE:"CodeTree"};

type Options = {
  studyId?: string; studyDate?: string; selectedDate: string; viewerId: string; onMessage: (message: string) => void;
};

export function useManualRegistration({ studyId, studyDate, selectedDate, viewerId, onMessage }: Options) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualPlatform, setManualPlatform] = useState<ManualPlatform>("BOJ");
  const [manualDifficulty, setManualDifficulty] = useState(MANUAL_DIFFICULTIES.BOJ[1].value);
  const [manualCount, setManualCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const manualSaving = useRef(false);
  const pendingManual = useRef(new Map<string, string>());
  async function addManualSubmission() {
    if (!studyId || !studyDate || selectedDate > studyDate || manualSaving.current) return;
    const payload = { studyId, studyDate: selectedDate, platform: manualPlatform, difficulty: manualDifficulty, count: manualCount };
    const key = "hamster-manual-pending:" + JSON.stringify([viewerId, payload]);
    let requestId = pendingManual.current.get(key);
    if (!requestId) {
      try { requestId = sessionStorage.getItem(key) ?? undefined; } catch { /* Private storage can be unavailable. */ }
      requestId ??= crypto.randomUUID();
      pendingManual.current.set(key, requestId);
      try { sessionStorage.setItem(key, requestId); } catch { /* Keep the in-memory copy for retries. */ }
    }
    manualSaving.current = true;
    setBusy(true);
    try {
      const { data } = await browserSupabase().auth.getSession();
      if (data.session?.user.id !== viewerId) throw Error("다시 로그인해 주세요.");
      const access = data.session.access_token;
      const response = await fetch("/api/submissions/manual", {
        method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId }),
      });
      const result = await response.json() as { error?: string; inserted?: number };
      if (!response.ok) throw Error(result.error ?? "수동 인증을 등록하지 못했습니다.");
      pendingManual.current.delete(key);
      try { sessionStorage.removeItem(key); } catch { /* Memory already released the confirmed request. */ }
      const solveMonth = selectedDate.slice(0, 7);
      invalidateViews(viewerId, [
        `day:${studyId}:${selectedDate}`,
        ...[0, 1, 2].map(offset => `growth:${studyId}:${viewerId}:${shiftMonth(solveMonth, offset)}`),
      ]);
      refreshMemberCalendars(viewerId, studyId, viewerId);
      onMessage(`${result.inserted ?? manualCount}문제를 수동 인증으로 등록했습니다.`);
      setManualOpen(false);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "수동 인증을 등록하지 못했습니다.");
    } finally { manualSaving.current = false; setBusy(false); }
  }
  function changePlatform(platform: ManualPlatform) {
    setManualPlatform(platform);
    setManualDifficulty(MANUAL_DIFFICULTIES[platform][0].value);
  }
  return { manualOpen, setManualOpen, manualPlatform, changePlatform, manualDifficulty, setManualDifficulty,
    manualCount, setManualCount, busy, addManualSubmission };
}

export function ManualRegistration({ manualOpen, setManualOpen, manualPlatform, changePlatform, manualDifficulty,
  setManualDifficulty, manualCount, setManualCount, busy, addManualSubmission }: ReturnType<typeof useManualRegistration>) {
  return <section className="manual-certification">
    <button type="button" className="manual-toggle" onClick={() => setManualOpen(open => !open)} aria-expanded={manualOpen}>
      <span><strong>자동 인증이 안 됐나요?</strong><small>플랫폼 · 난이도 · 문제 수만 입력하면 됩니다.</small></span>
      <b>{manualOpen ? "−" : "+ 수동 풀이 등록"}</b>
    </button>
    {manualOpen && <div className="manual-form">
      <label><span>플랫폼</span><select value={manualPlatform} onChange={e => changePlatform(e.target.value as ManualPlatform)}>
        {(Object.keys(PLATFORM_LABEL) as ManualPlatform[]).map(platform => <option value={platform} key={platform}>{PLATFORM_LABEL[platform]}</option>)}
      </select></label>
      <label><span>난이도</span><select value={manualDifficulty} onChange={e => setManualDifficulty(e.target.value)}>
        {MANUAL_DIFFICULTIES[manualPlatform].map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select></label>
      <label><span>문제 수</span><input type="number" min={1} max={20} value={manualCount}
        onChange={e => setManualCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
      <button type="button" className="primary-button full" onClick={() => void addManualSubmission()} disabled={busy}>
        {busy ? "등록 중…" : `${manualCount}문제 등록`}</button>
      <p>사진이나 문제 번호는 저장하지 않습니다. 본인 풀이만 수동으로 추가됩니다.</p>
    </div>}
  </section>;
}
