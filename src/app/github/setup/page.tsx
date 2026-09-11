"use client";
import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

export default function GithubSetup(){
  const [message,setMessage]=useState("Repository 연결을 마무리하고 있습니다…");
  useEffect(()=>{void (async()=>{
    const installationId=Number(new URLSearchParams(location.search).get("installation_id"));
    const studyId=localStorage.getItem("hamster-study-id");
    const {data}=await browserSupabase().auth.getSession();
    if(!installationId||!studyId||!data.session){setMessage("설치 정보 또는 로그인 정보가 없습니다.");return;}
    const r=await fetch("/api/github/installations",{method:"POST",headers:{Authorization:`Bearer ${data.session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({installationId,studyId})});
    if(!r.ok){const j=await r.json();setMessage(j.error??"Repository 연결 실패");return;}
    localStorage.removeItem("hamster-study-id"); location.replace("/dashboard");
  })()},[]);
  return <main className="shell"><div className="card"><h1>{message}</h1></div></main>;
}
