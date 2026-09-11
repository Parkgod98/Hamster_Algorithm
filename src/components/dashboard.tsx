"use client";
import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

type Member = { userId:string; name:string; state:string; credits:number; detail:string };
type DashboardData = { study:null | { id:string; name:string }; members:Member[]; repositories:string[]; studyDate:string };

export function Dashboard({ githubAppSlug }: { githubAppSlug:string }) {
  const [data,setData]=useState<DashboardData|null>(null);
  const [error,setError]=useState("");
  async function token(){ const {data}=await browserSupabase().auth.getSession(); return data.session?.access_token; }
  async function load(){
    const access=await token(); if(!access){ window.location.replace("/"); return; }
    const r=await fetch("/api/dashboard",{headers:{Authorization:`Bearer ${access}`}}); const j=await r.json();
    if(!r.ok){setError(j.error??"조회 실패");return;} setData(j);
  }
  useEffect(()=>{void load();},[]);
  async function createStudy(){ const access=await token(); const r=await fetch("/api/studies",{method:"POST",headers:{Authorization:`Bearer ${access}`,"Content-Type":"application/json"},body:JSON.stringify({name:"햄쮸터"})}); if(r.ok) await load(); }
  function connect(){ if(!data?.study||!githubAppSlug)return; localStorage.setItem("hamster-study-id",data.study.id); window.location.href=`https://github.com/apps/${githubAppSlug}/installations/new`; }
  async function postpone(){ const access=await token(); const r=await fetch("/api/postponements",{method:"POST",headers:{Authorization:`Bearer ${access}`,"Content-Type":"application/json"},body:JSON.stringify({studyId:data?.study?.id})}); const j=await r.json(); if(!r.ok)alert(j.error??"미루기 실패"); else await load(); }
  if(error)return <main className="shell"><div className="card">{error}</div></main>;
  if(!data)return <main className="shell"><div className="card">불러오는 중…</div></main>;
  if(!data.study)return <main className="shell"><section className="hero"><h1>첫 햄쮸터를<br/>만들어보세요.</h1><button className="button" onClick={createStudy}>스터디 만들기</button></section></main>;
  return <main className="shell"><section className="hero"><p>🐹 {data.study.name}</p><h1>{data.studyDate}<br/>인증 현황</h1><p className="muted">Repository는 사람마다 달라도 됩니다. 각자 GitHub App에서 자신의 알고리즘 Repository를 선택합니다.</p><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="button" onClick={connect}>내 Repository 연결</button><button className="button" onClick={postpone}>오늘 미루기</button></div></section><section className="card"><h2>스터디원</h2><div className="members">{data.members.map(m=><div className="member" key={m.userId}><div><strong>{m.name}</strong><div className="muted">{m.detail}</div></div><span>{m.state} · {(m.credits*100).toFixed(0)}%</span></div>)}</div></section><section className="card" style={{marginTop:14}}><h2>내 연결 Repository</h2>{data.repositories.length?data.repositories.map(r=><p key={r}>{r}</p>):<p className="muted">아직 연결된 Repository가 없습니다.</p>}</section></main>;
}
