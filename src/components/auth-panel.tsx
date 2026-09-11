"use client";
import { browserSupabase } from "@/lib/supabase-browser";

export function AuthPanel() {
  async function login() {
    const supabase = browserSupabase();
    await supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${window.location.origin}/auth/callback` } });
  }
  return <button className="button" onClick={login}>GitHub로 시작하기</button>;
}
