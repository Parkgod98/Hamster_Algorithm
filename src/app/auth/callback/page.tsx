"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppBrand } from "@/components/app-brand";
import { browserSupabase,githubProofClient } from "@/lib/supabase-browser";
import { accountDestination } from "@/lib/study-navigation";
import { clearInstallation,pendingInstallation } from "@/lib/github-connect-browser";
export default function AuthCallback() {
  const [message,setMessage]=useState("GitHub 계정을 확인하고 있어요…");
  const started=useRef(false);
  useEffect(()=>{
    if(started.current)return;
    started.current=true;
    void (async()=>{
      const code=new URLSearchParams(location.search).get("code");
      if(!code)throw new Error("GitHub 인증을 완료해주세요.");
      const pending=pendingInstallation();
      if(pending?.installationId){
        try {
          const {data: {session}}=await browserSupabase().auth.getSession();
          if(!session || session.user.id!==pending.userId)throw new Error("연결을 시작한 햄쮸터 계정으로 로그인해주세요.");
          const proof=await githubProofClient().auth.exchangeCodeForSession(code);
          const githubToken=proof.data.session?.provider_token;
          if(!githubToken)throw new Error("GitHub 소유자 확인에 실패했어요.");
          const response=await fetch("/api/github/installations",{method:"POST",headers:{
            Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json",
          },body:JSON.stringify({installationId:pending.installationId,studyId:pending.studyId,githubToken})});
          if(!response.ok){const result=await response.json();throw new Error(result.error || "연결에 실패했어요.");}
        } finally {
          try { await githubProofClient().auth.signOut({scope:"local"}); }
          finally { clearInstallation(); }
        }
        location.replace(`/dashboard?studyId=${encodeURIComponent(pending.studyId)}`);
        return;
      }
      const {error}=await browserSupabase().auth.exchangeCodeForSession(code);
      if(error)throw new Error("GitHub 로그인을 완료하지 못했어요.");
      location.replace(accountDestination());
    })().catch(error=>setMessage(error instanceof Error?error.message:"다시 로그인해주세요."));
  },[]);
  return <main className="account-page"><AppBrand /><section><h1 role="status">{message}</h1><Link href="/">햄쮸터로 돌아가기</Link></section></main>;
}
