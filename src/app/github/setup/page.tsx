"use client";
import { useEffect, useRef, useState } from "react";
import { browserSupabase, githubProofClient } from "@/lib/supabase-browser";
import { bindInstallation,pendingInstallation } from "@/lib/github-connect-browser";

export default function GithubSetup() {
  const [message,setMessage]=useState("GitHub 연결 정보를 확인하고 있어요…");
  const started=useRef(false);
  useEffect(()=>{
    if (started.current) return;
    started.current = true;
    void (async()=>{
      const params = new URLSearchParams(location.search);
      const installationId = Number(params.get("installation_id"));
      const pending = pendingInstallation();
      if (!pending || pending.state !== params.get("state") || !Number.isSafeInteger(installationId) || installationId <= 0) {
        throw new Error("스터디 설정에서 GitHub 연결을 다시 시작해주세요.");
      }
      const {data}=await browserSupabase().auth.getSession();
      if(!data.session?.access_token.startsWith("hs1_")) throw new Error("햄쮸터에 로그인한 뒤 연결해주세요.");
      bindInstallation({...pending,userId:data.session.user.id,installationId});
      const {error}=await githubProofClient().auth.signInWithOAuth({provider:"github",options:{
        scopes:"read:org",redirectTo:`${location.origin}/auth/callback`,
      }});
      if(error)throw new Error("GitHub 계정 확인을 시작하지 못했어요.");
    })().catch(e=>setMessage(e instanceof Error ? e.message : "연결을 다시 시도해주세요."));
  },[]);
  return <main className="shell"><section className="card"><h1>{message}</h1><a href="/dashboard">대시보드로</a></section></main>;
}
