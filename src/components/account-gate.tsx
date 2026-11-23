"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AccountRequestError, accountRequest } from "@/lib/account-browser";
import { knownEmptyDirectory } from "@/lib/directory-cache";
import { accountDestination, rememberAccountReturn } from "@/lib/study-navigation";
import { browserSupabase, currentAccountId, forgetLegacySession, onStoredAccountChange } from "@/lib/supabase-browser";
import { AppBrand } from "./app-brand";
import { AuthPanel } from "./auth-panel";

type EntryState =
  | { kind: "checking" | "ready" | "error" }
  | { kind: "migration"; userId: string; nickname: string };

export function AccountGate({ children, landing = false }: { children: ReactNode; landing?: boolean }) {
  const router = useRouter();
  const [entry, setEntry] = useState<EntryState>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);

  function retry() {
    setEntry({ kind: "checking" });
    setAttempt(previous => previous + 1);
  }

  useEffect(() => {
    let active = true;
    const initialId = currentAccountId();
    const unsubscribe = onStoredAccountChange(() => {
      if (!active || currentAccountId() === initialId) return;
      active = false;
      retry();
    });
    function showGuest() {
      if (landing) setEntry({ kind: "ready" });
      else router.replace("/");
    }

    async function check() {
      const { data: { session } } = await browserSupabase().auth.getSession();
      if (!active) return;
      if (session?.access_token.startsWith("hs1_")) {
        if (landing) router.replace(accountDestination(false, knownEmptyDirectory(session.user.id)));
        else setEntry({ kind: "ready" });
        return;
      }
      if (!landing) rememberAccountReturn();
      if (!session) { showGuest(); return; }

      let status;
      try {
        status = await accountRequest(undefined, session.access_token);
      } catch (error) {
        if (!(error instanceof AccountRequestError && error.status === 401)) throw error;
      }
      if (!active) return;
      if (status?.status === "legacy") {
        setEntry({ kind: "migration", userId: session.user.id, nickname: status.nickname || "" });
        return;
      }
      if (status && status.status !== "registered" && status.status !== "none") {
        throw new Error("Unexpected account status");
      }
      const removed = await forgetLegacySession(session.access_token);
      if (!active) return;
      if (removed) showGuest();
      else retry();
    }

    void check().catch(() => { if (active) setEntry({ kind: "error" }); });
    return () => { active = false; unsubscribe(); };
  }, [attempt, landing, router]);

  if (entry.kind === "ready") return children;
  return <main className="account-page"><AppBrand /><section>
    {entry.kind === "migration" ? <>
      <h1>햄쮸터가 업데이트됐어요!</h1>
      <p>기존 스터디와 공부 기록을 이어갈 수 있도록, 앞으로 사용할 로그인 아이디와 비밀번호를 한 번만 등록해주세요.</p>
      <AuthPanel key={entry.userId} migration={{ userId: entry.userId, nickname: entry.nickname }} />
    </> : entry.kind === "error" ? <>
      <p role="alert">계정 상태를 확인하지 못했어요. 다시 시도해주세요.</p>
      <button type="button" className="secondary-button" onClick={retry}>다시 시도</button>
    </> : <p role="status">로그인 상태 확인 중…</p>}
  </section></main>;
}
