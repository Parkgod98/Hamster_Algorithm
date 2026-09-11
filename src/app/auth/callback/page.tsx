"use client";

import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

export default function AuthCallback() {
  const [message, setMessage] = useState("GitHub 로그인을 확인하고 있습니다…");

  useEffect(() => {
    async function completeLogin() {
      const code = new URLSearchParams(window.location.search).get("code");
      if (!code) {
        await Promise.resolve();
        setMessage("로그인 code가 없습니다.");
        return;
      }

      const { error } = await browserSupabase().auth.exchangeCodeForSession(code);
      if (error) {
        setMessage(`로그인 실패: ${error.message}`);
        return;
      }

      const next = localStorage.getItem("hamster-next") || "/dashboard";
      localStorage.removeItem("hamster-next");
      window.location.replace(next);
    }

    void completeLogin();
  }, []);

  return <main className="shell"><section className="card"><h1>{message}</h1></section></main>;
}
