"use client";

import { useEffect, useRef, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";
import { studyDateFromTimestamp } from "@/lib/study-day";
import type { PostponementStatus } from "@/lib/postponement-status";

type Props = {
  studyId: string;
  studyDate: string;
  initialStatus: PostponementStatus | null;
  onChanged: () => Promise<void>;
  onMessage: (message: string) => void;
};
type Payload = { status?: PostponementStatus; error?: string; duplicate?: boolean };

export function PostponementControl({ studyId, studyDate, initialStatus, onChanged, onMessage }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState(() => isExpired(initialStatus, studyDate));
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);

  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => {
    if (!status?.deadlineAt || !status.canPostpone) return;
    const delay = Math.max(0, Date.parse(status.deadlineAt) - Date.now());
    const timer = window.setTimeout(() => setExpired(true), delay);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function send(write: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const { data } = await browserSupabase().auth.getSession();
      const access = data.session?.access_token;
      if (!access) {
        setStatus(null);
        setMessage("로그인이 필요해요. 다시 로그인한 뒤 확인해주세요.");
        return;
      }
      const url = write ? "/api/postponements" : `/api/postponements?studyId=${encodeURIComponent(studyId)}`;
      const response = await fetch(url, {
        method: write ? "POST" : "GET", cache: "no-store", signal: abort.signal,
        headers: { Authorization: `Bearer ${access}`, ...(write ? { "Content-Type": "application/json" } : {}) },
        ...(write ? { body: JSON.stringify({ studyId, studyDate }) } : {}),
      });
      const payload = await response.json() as Payload;
      if (abort.signal.aborted) return;
      const nextStatus = payload.status ?? null;
      setStatus(nextStatus);
      setExpired(isExpired(nextStatus, studyDate));
      if (!response.ok) {
        setMessage(payload.error ?? "진행 상태를 확인하지 못했어요. 다시 확인해주세요.");
        return;
      }
      if (write) {
        const text = payload.duplicate ? "이미 오늘 미루기를 신청했어요. 추가 사용되지 않았어요." : "오늘 미루기를 신청했어요.";
        setMessage(text);
        onMessage(text);
        // A successful mutation invalidates the calendar; never pretend a failed refresh undid the write.
        try { await onChanged(); } catch { onMessage("미루기는 저장됐어요. 달력을 새로고침해주세요."); }
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      setStatus(null);
      setMessage(write ? "처리 결과를 확인하지 못했어요. 상태를 다시 확인해주세요." : "진행 상태를 불러오지 못했어요. 다시 확인해주세요.");
      if (!(error instanceof Error)) console.error("postponement request failed");
    } finally {
      pending.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  }

  const locked = busy || !status?.canPostpone || expired;
  const label = busy ? "확인 중…" : status?.alreadyPostponed ? "오늘 미루기 신청됨"
    : status?.reason === "complete" ? "오늘 인증 완료" : locked ? "미루기 불가" : "오늘 미루기";
  const explanation = message || (expired ? "마감 또는 인증일이 바뀌었어요. 상태를 다시 확인해주세요." : status?.message)
    || "진행 상태를 확인한 뒤 미루기를 사용할 수 있어요.";

  return <div className="sheet-actions">
    <button type="button" className="primary-button full" disabled={locked} onClick={() => void send(true)}
      aria-describedby="postponement-status-message">{label}</button>
    <p id="postponement-status-message" role="status" aria-live="polite">{explanation}</p>
    <button type="button" className="text-button" disabled={busy} onClick={() => void send(false)}>상태 다시 확인</button>
  </div>;
}

function isExpired(status: PostponementStatus | null, studyDate: string) {
  if (studyDateFromTimestamp(new Date().toISOString()) !== studyDate) return true;
  if (status && status.studyDate !== studyDate) return true;
  return Boolean(status?.canPostpone && status.deadlineAt && Date.now() >= Date.parse(status.deadlineAt));
}
