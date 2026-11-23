"use client";

import { useState, type FormEvent } from "react";
import { RECOVERY_QUESTIONS } from "@/lib/account";
import { accountRequest } from "@/lib/account-browser";
import { browserSupabase, currentAccountId, saveAccountSession } from "@/lib/supabase-browser";
import { accountDestination } from "@/lib/study-navigation";

type Mode = "login" | "register" | "recover" | "migrate";
export function AuthPanel({ migration }: { migration?: { userId: string; nickname: string } }) {
  const [mode,setMode] = useState<Mode>(migration ? "migrate" : "login");
  const [login,setLogin] = useState("");
  const [question,setQuestion] = useState("");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
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
      let token: string | undefined;
      if (migration) {
        const { data: { session } } = await browserSupabase().auth.getSession();
        if (!session || session.user.id !== migration.userId || session.access_token.startsWith("hs1_")) {
          throw new Error("로그인 상태가 바뀌었어요. 새로고침해서 계정을 다시 확인해주세요.");
        }
        token = session.access_token;
      }
      const result = await accountRequest(body, token);
      if (action === "question") { setQuestion(result.question || ""); return; }
      if (action === "reset") {
        changeMode("login"); setMessage("비밀번호를 바꿨어요. 새 비밀번호로 로그인해주세요."); return;
      }
      if (result.token && result.userId) {
        if (migration) {
          const activeUser = currentAccountId();
          if (activeUser && activeUser !== migration.userId) return;
        }
        saveAccountSession(result.token,result.userId);
        window.location.replace(accountDestination(action === "register"));
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "다시 시도해주세요."); }
    finally { setBusy(false); }
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
      {mode === "login" && <button disabled={busy} onClick={()=>changeMode("recover")} type="button">비밀번호 찾기</button>}
    </div>}
    <p role="status">{message}</p>
  </div>;
}
