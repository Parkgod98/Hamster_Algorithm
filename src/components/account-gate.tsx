"use client";
import { useEffect, useState, type ReactNode } from "react";
import { AuthPanel } from "./auth-panel";
import { accountRequest } from "@/lib/account-browser";
import { browserSupabase, currentAccountId, onStoredAccountChange } from "@/lib/supabase-browser";
import { rememberAccountReturn } from "@/lib/study-navigation";

export function AccountGate({ children, allowGuest = false }: { children: ReactNode; allowGuest?: boolean }) {
  const [ready,setReady] = useState(false);
  const [legacy,setLegacy] = useState<{token:string;nickname:string} | null>(null);
  const [message,setMessage] = useState("로그인 상태 확인 중…");
  const [accountVersion,setAccountVersion] = useState(0);
  useEffect(() => {
    let active = true;
    const initialId = currentAccountId();
    const unsubscribe = onStoredAccountChange(() => {
      if (!active || currentAccountId() === initialId) return;
      active = false;
      setReady(false);
      setLegacy(null);
      setMessage("로그인 상태 확인 중…");
      setAccountVersion(version => version + 1);
    });
    void (async()=>{
      const { data: { session } } = await browserSupabase().auth.getSession();
      if (!active) return;
      if (session?.access_token.startsWith("hs1_") || (!session && allowGuest)) { setReady(true); return; }
      rememberAccountReturn();
      if (!session) { location.replace("/"); return; }
      const account = await accountRequest(undefined, session.access_token);
      if (!active) return;
      if (account.status === "registered") {
        await browserSupabase().auth.signOut();
        location.replace("/"); return;
      }
      setLegacy({ token: session.access_token, nickname: account.nickname || "" });
    })().catch(()=>{ if(active) setMessage("계정 상태를 확인하지 못했어요. 새로고침해주세요."); });
    return ()=>{ active = false; unsubscribe(); };
  },[allowGuest,accountVersion]);
  if (ready) return children;
  return <main className="shell"><section className="card">{legacy ? <><h1>햄쮸터 계정 전환</h1><AuthPanel migration={legacy}/></> : <p role="status">{message}</p>}</section></main>;
}
