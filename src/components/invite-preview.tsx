"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { communityMessage, communityRequest, enterStudy } from "@/lib/community-client";
import type { JoinResult, StudyList, StudyPreview } from "@/lib/community";
import { StudyCard } from "./community-fields";
import { AppBrand } from "./app-brand";
import styles from "./study-community.module.css";

function InvitedStudy({ code }: { code: string }) {
  const [study, setStudy] = useState<StudyPreview>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    communityRequest<StudyList>(`/api/studies?scope=invite&code=${encodeURIComponent(code)}`, undefined, controller.signal)
      .then(({ studies }) => {
        if (controller.signal.aborted) return;
        const preview = studies[0];
        if (!preview) { setMessage("사용할 수 없는 초대 링크예요."); return; }
        if (preview.memberRole) enterStudy(preview.id);
        else setStudy(preview);
      }).catch((cause) => { if (!controller.signal.aborted) setMessage(communityMessage(cause)); });
    return () => controller.abort();
  }, [code]);
  async function join() {
    if (busy) return;
    setMessage(""); setBusy(true);
    try {
      const result = await communityRequest<JoinResult>("/api/studies/join", { code });
      if (result.status === "joined") enterStudy(result.studyId);
      else setStudy((s) => s && { ...s, pending: true });
    } catch (cause) { setMessage(communityMessage(cause)); }
    finally { setBusy(false); }
  }
  const pending = study?.pending && study?.joinPolicy === "approval";
  return <>
    {message && <p role="alert" className={styles.error}>{message}</p>}
    {study ? <StudyCard study={study}>
      <button className={styles.primary} disabled={busy || pending} onClick={() => void join()}>
        {busy ? "처리 중…" : pending ? "승인 대기 중" : study.joinPolicy === "open" ? "스터디 가입" : "가입 신청"}</button>
    </StudyCard> : !message && <p role="status" className={styles.status}>초대를 확인하고 있어요…</p>}
  </>;
}

export function InvitePreview({ code }: { code: string }) {
  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <AppBrand />
      <Link href="/studies" className={styles.back}>스터디 목록</Link>
    </header>
    <section className={`${styles.content} ${styles.inviteContent}`}>
      <div className={styles.titleRow}><h1>스터디 초대</h1></div>
      <InvitedStudy key={code} code={code} />
    </section>
  </main>;
}
