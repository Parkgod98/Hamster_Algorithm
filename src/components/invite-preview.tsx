"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { communityMessage, communityRequest, studyPath } from "@/lib/community-client";
import { currentAccountId } from "@/lib/supabase-browser";
import { invalidateViews, peekView, putView, readView } from "@/lib/view-cache";
import { useViewRevision } from "./use-view-revision";
import type { JoinResult, StudyList, StudyPreview } from "@/lib/community";
import { StudyCard } from "./community-fields";
import { AppBrand } from "./app-brand";
import styles from "./study-community.module.css";

function InvitedStudy({ code }: { code: string }) {
  const router = useRouter();
  const viewerId = typeof window !== "undefined" ? currentAccountId() ?? "" : "";
  const key = `invite:${code}`;
  const revision = useViewRevision(viewerId, key);
  const [resume, setResume] = useState(0);
  const [resolved, setResolved] = useState<{ revision: number; resume: number; study?: StudyPreview }>();
  const study = resolved?.revision === revision && resolved?.resume === resume
    ? resolved.study : peekView<StudyList>(viewerId, key)?.studies[0];
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible" && !peekView(viewerId, key)) setResume(value => value + 1);
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [viewerId, key]);
  useEffect(() => {
    let active = true;
    readView<StudyList>(viewerId, key,
      signal => communityRequest(`/api/studies?scope=invite&code=${encodeURIComponent(code)}`, undefined, signal, viewerId),
      { ttlMs: 30_000 })
      .then(({ studies }) => {
        if (!active) return;
        const preview = studies[0];
        if (!preview) { setResolved({ revision, resume }); setMessage("사용할 수 없는 초대 링크예요."); return; }
        setMessage("");
        if (preview.memberRole) router.replace(studyPath(preview.id));
        else setResolved({ revision, resume, study: preview });
      }).catch((cause) => { if (active) { setResolved({ revision, resume }); setMessage(communityMessage(cause)); } });
    return () => { active = false; };
  }, [code, key, viewerId, router, revision, resume]);
  async function join() {
    if (busy) return;
    setMessage(""); setBusy(true);
    try {
      const result = await communityRequest<JoinResult>("/api/studies/join", { code }, undefined, viewerId);
      invalidateViews(viewerId, ["directory:", "invite:"]);
      if (result.status === "joined") router.replace(studyPath(result.studyId));
      else if (study) {
        const pending = { ...study, pending: true };
        putView(viewerId, "browse-tab", "mine");
        putView(viewerId, key, { studies: [pending], nextOffset: null }, { ttlMs: 30_000 });
        setResolved({ revision, resume, study: pending });
      }
    } catch (cause) { setMessage(communityMessage(cause)); }
    finally { setBusy(false); }
  }
  const pending = study?.pending === true;
  return <>
    {message && <p role="alert" className={styles.error}>{message}</p>}
    {study ? <StudyCard study={study}>
      <button className={styles.primary} disabled={busy || pending} onClick={() => void join()}>
        {busy ? "처리 중…" : pending ? "승인 대기 중" : "가입 신청"}</button>
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
