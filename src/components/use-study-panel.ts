"use client";

import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

export function useStudyPanel<T>(url: string | null, revision: number) {
  const [result, setResult] = useState<{key: string; data?: T; error?: string} | null>(null);
  const key = url ? revision + ":" + url : null;
  useEffect(() => {
    if (!url || !key) return;
    const controller = new AbortController();
    async function load() {
      try {
        const {data} = await browserSupabase().auth.getSession();
        if (!data.session) throw Error("로그인이 필요해요.");
        const response = await fetch(url!, {headers:{ Authorization: "Bearer " + data.session.access_token }, cache:"no-store", signal:controller.signal});
        if (!response.ok) throw Error("상세 정보를 불러오지 못했어요. 새로고침해주세요.");
        const payload = await response.json() as T;
        if (!controller.signal.aborted) setResult({ key:key!, data:payload });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key:key!, error:error instanceof Error ? error.message : "다시 시도해주세요." });
      }
    }
    void load();
    return () => controller.abort();
  }, [url,key]);
  return result?.key === key ? result : null;
}
