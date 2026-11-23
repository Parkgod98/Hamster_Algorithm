"use client";

import { useEffect, useState } from "react";
import { browserSupabase, forgetAccountSession } from "@/lib/supabase-browser";
import { invalidateViews, peekView, putView, readView } from "@/lib/view-cache";
import { useViewRevision } from "./use-view-revision";

export function useStudyPanel<T>(viewerId: string, key: string | null, url: string | null) {
  const revision = useViewRevision(viewerId, key ?? "");
  const version = JSON.stringify([viewerId, key, revision]);
  const [result, setResult] = useState<{ version: string; data?: T; error?: string } | null>(null);
  const cached = key && viewerId ? peekView<T>(viewerId, key) : undefined;

  useEffect(() => {
    if (!viewerId || !url || !key) return;
    let active = true;
    const read = (signal: AbortSignal) => browserSupabase().auth.getSession().then(async ({ data }) => {
      if (data.session?.user.id !== viewerId) throw Error("로그인이 필요해요.");
      const response = await fetch(url, {
        headers: { Authorization: "Bearer " + data.session.access_token }, cache: "no-store", signal,
      });
      if (response.status === 401 && !signal.aborted && forgetAccountSession(data.session.access_token)) {
        window.location.replace("/");
        throw Error("다시 로그인해주세요.");
      }
      if (response.status === 403 && !signal.aborted) {
        // Re-check the caller's current membership rather than trusting an old list or role.
        const study = new URL(url, window.location.origin).searchParams.get("studyId");
        if (study) invalidateViews(viewerId, [`calendar:${study}:`, "directory:mine:"]);
      }
      if (!response.ok) throw Error("상세 정보를 불러오지 못했어요. 다시 시도해주세요.");
      return await response.json() as T;
    });
    void readView(viewerId, key, read).then(
      data => { if (active) setResult({ version, data }); },
      error => {
        if (active && !(error instanceof Error && error.name === "AbortError")) {
          setResult({ version, error: error instanceof Error ? error.message : "다시 시도해주세요." });
        }
      },
    );
    return () => { active = false; };
  }, [viewerId, key, url, version]);

  if (!key || !viewerId) return null;
  const data = cached ?? (result?.version === version ? result.data : undefined);
  const error = result?.version === version ? result.error : undefined;
  const replace = (value: T) => {
    putView(viewerId, key, value);
    setResult({ version, data: value });
  };
  return { data, error, replace };
}
