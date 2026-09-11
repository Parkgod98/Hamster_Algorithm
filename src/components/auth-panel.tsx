"use client";

import { useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

export function AuthPanel() {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        {loading ? "GitHub로 이동 중…" : "GitHub로 시작하기"}
      </button>
      {message ? <p>{message}</p> : null}
    </div>
  );
}
