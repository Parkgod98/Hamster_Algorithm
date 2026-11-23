"use client";

import { useEffect, useState, type FormEvent } from "react";
import { RECOVERY_QUESTIONS } from "@/lib/account";
import { accountRequest } from "@/lib/account-browser";
import { clearInstallation } from "@/lib/github-connect-browser";
import { browserSupabase, saveAccountSession } from "@/lib/supabase-browser";
import { accountDestination } from "@/lib/study-navigation";

type Mode = "login" | "register" | "recover" | "migrate";
export function AuthPanel({ migration }: { migration?: { token: string; nickname: string } }) {
  const [mode,setMode] = useState<Mode>(migration ? "migrate" : "login");
  const [login,setLogin] = useState("");
  const [question,setQuestion] = useState("");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  useEffect(() => {
    if (migration) return;
    let active = true;
    void (async () => {
      const { data } = await browserSupabase().auth.getSession();
      if (!active || !data.session) return;
      if (!data.session.access_token.startsWith("hs1_")) {
        const account = await accountRequest(undefined,data.session.access_token);
        if (account.status === "registered") {
          await browserSupabase().auth.signOut();
          if (active) setMessage("전환을 마친 계정이에요. 햄쮸터 아이디로 로그인해주세요.");
          return;
        }
      }
      if (active) window.location.replace(accountDestination());
    })().catch(() => { if (active) setMessage("로그인 상태를 확인하지 못했어요."); });
    return () => { active = false; };
  }, [migration]);

  function changeMode(next: Mode) { setMode(next); setMessage(""); setQuestion(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setMessage("");
    try {
      const action = mode === "recover" ? (question ? "reset" : "question") : mode;
      const body: Record<string,string> = { action, login };
      for (const name of ["password","nickname","question","answer"]) {
        const value = data.get(name);
        if (typeof value === "string") body[name] = value;
      }
      const result = await accountRequest(body, migration?.token);
      if (action === "question") { setQuestion(result.question || ""); return; }
      if (action === "reset") {
        changeMode("login"); setMessage("비밀번호를 바꿨어요. 새 비밀번호로 로그인해주세요."); return;
      }
      if (result.token && result.userId) {
        saveAccountSession(result.token,result.userId);
        window.location.replace(accountDestination(action === "register"));
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "다시 시도해주세요."); }
    finally { setBusy(false); }
  }
  async function legacyLogin() {
    setBusy(true);
    clearInstallation();
    try {
      const { error } = await browserSupabase().auth.signInWithOAuth({
        provider: "github", options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch { setBusy(false); setMessage("GitHub 로그인을 시작하지 못했어요."); }
  }
  const registration = mode === "register" || mode === "migrate";
  const submitText = mode === "recover" ? (question ? "비밀번호 재설정" : "복구 질문 확인")
    : mode === "migrate" ? "새 로그인 방법 등록" : mode === "register" ? "가입하기" : "로그인";
  return <div className="account-panel">
    {!migration && <h1 className="account-title">{mode === "recover" ? "비밀번호 찾기" : mode === "register" ? "계정 만들기" : "로그인"}</h1>}
    {(mode === "login" || mode === "register") && <div className="account-modes" role="group" aria-label="계정 메뉴">
      <button type="button" aria-pressed={mode === "login"} disabled={busy} onClick={() => changeMode("login")}>로그인</button>
      <button type="button" aria-pressed={mode === "register"} disabled={busy} onClick={() => changeMode("register")}>새 계정 만들기</button>
    </div>}
    {mode === "migrate" && <p>햄쮸터가 업데이트됐어요. 기존 스터디와 기록을 이어 쓸 로그인 아이디와 복구 방법을 등록해주세요.</p>}
    <form key={mode} onSubmit={submit}>
      <label>로그인 아이디<input name="login" autoComplete="username" autoCapitalize="none" spellCheck={false} value={login} readOnly={mode === "recover" && !!question}
        onChange={e=>setLogin(e.target.value)} minLength={2} maxLength={40} required /></label>
      {registration && <label>닉네임<input name="nickname" defaultValue={migration?.nickname} maxLength={40} autoComplete="nickname" required /></label>}
      {(mode !== "recover" || question) && <label>{mode === "recover" ? "새 비밀번호" : "비밀번호"}<input type="password" name="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={256} placeholder={mode === "login" ? undefined : "8자 이상"} required /></label>}
      {registration && <label>비밀번호 복구 질문<select name="question">{RECOVERY_QUESTIONS.map(q=><option key={q.id} value={q.id}>{q.label}</option>)}</select></label>}
      {(registration || (mode === "recover" && question)) && <label>{mode === "recover" ? question : "복구 답변"}
        <input name="answer" autoComplete="off" maxLength={256} required /></label>}
      <button type="submit" className="button" disabled={busy}>{busy ? "확인 중…" : submitText}</button>
    </form>
    {!migration && mode !== "register" && <div className="account-links">
      {mode === "recover" && <button disabled={busy} onClick={()=>changeMode("login")} type="button">로그인으로</button>}
      {mode === "login" && <><button disabled={busy} onClick={()=>changeMode("recover")} type="button">비밀번호 찾기</button>
        <button onClick={()=>void legacyLogin()} type="button" disabled={busy}>기존 GitHub 회원 전환</button></>}
    </div>}
    <p role="status">{message}</p>
  </div>;
}
