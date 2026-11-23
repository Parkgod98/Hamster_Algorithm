"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppBrand } from "@/components/app-brand";
import { clearInstallation } from "@/lib/github-connect-browser";
import { browserSupabase } from "@/lib/supabase-browser";

// A direct link for previous members who no longer have a session on this device.
export default function RestoreAccount() {
  const [message, setMessage] = useState("예전에 쓰던 GitHub 계정을 확인하고 있어요…");
  useEffect(() => {
    let active = true;
    async function restore() {
      const { auth } = browserSupabase();
      const { data } = await auth.getSession();
      if (!active) return;
      if (data.session) {
        location.replace("/");
        return;
      }
      clearInstallation();
      const { error } = await auth.signInWithOAuth({
        provider: "github", options: { redirectTo: new URL("/auth/callback", location.origin).href },
      });
      if (error) throw error;
    }
    void restore().catch(() => {
      if (active) setMessage("GitHub 계정을 확인하지 못했어요. 새로고침해 다시 시도해 주세요.");
    });
    return () => { active = false; };
  }, []);
  return <main className="account-page">
    <AppBrand /><section><p role="status">{message}</p><Link href="/">햄쮸터로 돌아가기</Link></section>
  </main>;
}
