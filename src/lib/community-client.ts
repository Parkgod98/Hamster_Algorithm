"use client";

import { browserSupabase } from "./supabase-browser";

export async function communityRequest<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const { data } = await browserSupabase().auth.getSession();
  if (!data.session) {
    localStorage.setItem("hamster-next", window.location.pathname + window.location.search);
    window.location.replace("/");
    throw new Error("로그인이 필요합니다.");
  }
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store", signal,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "스터디 요청을 완료하지 못했어요.");
  return payload as T;
}

export function enterStudy(studyId: string) {
  localStorage.setItem("hamster-study-id", studyId);
  window.location.assign(`/dashboard?studyId=${encodeURIComponent(studyId)}`);
}

export function communityMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 완료하지 못했어요. 다시 시도해 주세요.";
}
