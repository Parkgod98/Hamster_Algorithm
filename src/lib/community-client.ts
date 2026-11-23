"use client";

import { browserSupabase, currentAccountId, forgetAccountSession } from "./supabase-browser";
import { rememberAccountReturn } from "./study-navigation";

export async function communityRequest<T>(url: string, body?: unknown, signal?: AbortSignal, viewerId?: string): Promise<T> {
  const { data } = await browserSupabase().auth.getSession();
  if (!data.session) {
    rememberAccountReturn();
    window.location.replace("/");
    throw new Error("로그인이 필요합니다.");
  }
  if (viewerId && data.session.user.id !== viewerId) throw new DOMException("계정이 변경됐어요.", "AbortError");
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store", signal,
  });
  if (response.status === 401 && !signal?.aborted && forgetAccountSession(data.session.access_token)) {
    rememberAccountReturn();
    window.location.replace("/");
    throw new Error("다시 로그인해주세요.");
  }
  const payload = await response.json();
  if (viewerId && currentAccountId() !== viewerId) throw new DOMException("계정이 변경됐어요.", "AbortError");
  if (!response.ok) throw new Error(payload.error ?? "스터디 요청을 완료하지 못했어요.");
  return payload as T;
}

export function studyPath(studyId: string) {
  return `/dashboard?studyId=${encodeURIComponent(studyId)}`;
}

export function communityMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 완료하지 못했어요. 다시 시도해 주세요.";
}
