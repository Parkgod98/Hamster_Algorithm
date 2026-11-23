"use client";
import { useEffect, useState, type FormEvent } from "react";
import { accountRequest } from "@/lib/account-browser";
import { browserSupabase } from "@/lib/supabase-browser";
export function NicknameSettings({ onSaved }: { onSaved?: () => void } = {}) {
  const [nickname,setNickname]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    void (async()=>{
      const {data}=await browserSupabase().auth.getSession();
      const account=await accountRequest(undefined,data.session?.access_token);
      if(active) setNickname(account.nickname || "");
    })().catch(()=>{ if(active)setMessage("닉네임을 불러오지 못했어요."); });
    return ()=>{active=false;};
  },[]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const {data}=await browserSupabase().auth.getSession();
      const result=await accountRequest({action:"nickname",nickname},data.session?.access_token);
      setNickname(result.nickname || nickname);setMessage("모든 스터디의 닉네임을 변경했어요.");onSaved?.();
    } catch (error) {setMessage(error instanceof Error?error.message:"닉네임 변경에 실패했어요.");}
    finally {setBusy(false);}
  }
  return <form className="account-panel" onSubmit={save}><label>계정 닉네임<input value={nickname} maxLength={40} required onChange={e=>setNickname(e.target.value)}/></label>
    <button className="button" disabled={busy || !nickname.trim()}>닉네임 저장</button><p role="status">{message}</p></form>;
}
