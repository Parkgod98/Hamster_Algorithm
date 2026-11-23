"use client";
import { useState, type FormEvent } from "react";
import { accountRequest } from "@/lib/account-browser";
import { browserSupabase, currentAccountId } from "@/lib/supabase-browser";
import { invalidateViews, putView } from "@/lib/view-cache";
import { useStudyPanel } from "./use-study-panel";
export function NicknameSettings({ visible = true }: { visible?: boolean } = {}) {
  const viewerId = typeof window !== "undefined" ? currentAccountId() ?? "" : "";
  const profile = useStudyPanel<{ nickname: string }>(viewerId, "profile", visible ? "/api/account" : null);
  const [draft, setDraft] = useState<string | null>(null);
  const nickname = draft ?? profile?.data?.nickname ?? "";
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const {data}=await browserSupabase().auth.getSession();
      const result=await accountRequest({action:"nickname",nickname},data.session?.access_token);
      invalidateViews(viewerId, ["profile", "calendar:", "manage:"]);
      putView(viewerId, "profile", { nickname: result.nickname ?? nickname });
      setDraft(null);
      setMessage("모든 스터디의 닉네임을 변경했어요.");
    } catch (error) {setMessage(error instanceof Error?error.message:"닉네임 변경에 실패했어요.");}
    finally {setBusy(false);}
  }
  return <form className="account-panel" onSubmit={save}><label>계정 닉네임<input value={nickname} maxLength={40} required onChange={e=>setDraft(e.target.value)}/></label>
    <button className="button" disabled={busy || !nickname.trim()}>닉네임 저장</button><p role="status">{message || profile?.error}</p></form>;
}
