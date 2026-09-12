"use client";

import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

export function AuthPanel() {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        const { data } = await browserSupabase().auth.getSession();
        if (cancelled) return;
        if (data.session) {
          window.location.replace("/dashboard");
          return;
        }
      } catch {
        // 로그인 버튼을 계속 제공한다.
      }
      if (!cancelled) setLoading(false);
    }
    void restoreSession();
    return () => { cancelled = true; };
  }, []);

  async function login() {
    setLoading(true);
    setMessage(null);

    try {
      const supabase = browserSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });

      if (error) {
        setMessage(`GitHub 로그인 시작 실패: ${error.message}`);
        setLoading(false);
      }
    } catch (error) {
      setMessage(
        `GitHub 로그인 시작 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      );
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="button" onClick={login} disabled={loading}>
        {loading ? "로그인 상태 확인 중…" : "GitHub로 시작하기"}
      </button>
      <div aria-live="polite">{message ? <p>{message}</p> : null}</div>
    </div>
  );
}
