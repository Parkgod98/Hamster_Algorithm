"use client";
import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

export default function AuthCallback() {
  const [message, setMessage] = useState("GitHub 로그인을 확인하고 있습니다…");
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) { setMessage("로그인 code가 없습니다."); return; }
    browserSupabase().auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) setMessage(`로그인 실패: ${error.message}`);
      else window.location.replace("/dashboard");
    });
  }, []);
  return <main className="shell"><section className="card"><h1>{message}</h1></section></main>;
}
