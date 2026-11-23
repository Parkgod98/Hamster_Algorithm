"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { communityMessage, communityRequest, enterStudy } from "@/lib/community-client";
import { validCode, type CommunityOptions, type JoinResult, type StudyList, type StudyPreview } from "@/lib/community";
import { DEFAULT_GOALS, type GoalPolicy } from "@/lib/study-goals";
import { GoalPolicyFields } from "./study-goal-fields";
import { CommunityFields, StudyCard } from "./community-fields";
import styles from "./study-community.module.css";

type Tab = "mine" | "search" | "create";

function CreateStudy() {
  const [name, setName] = useState("");
  const [options, setOptions] = useState<CommunityOptions>({ description: "", discoverable: true, joinPolicy: "open" });
  const [goals, setGoals] = useState<GoalPolicy>(DEFAULT_GOALS);
  const [studyId, setStudyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    const id = studyId || crypto.randomUUID();
    setStudyId(id);
    try {
      const result = await communityRequest<{ studyId: string }>("/api/studies", { name, goals, studyId: id, ...options });
      enterStudy(result.studyId);
    } catch (cause) {
      setError(communityMessage(cause)); setBusy(false);
    }
  }
  return <form className={styles.form} onSubmit={submit}>
    <label className={styles.field}>스터디 이름<input required maxLength={80} value={name}
      onChange={(e) => setName(e.target.value)} /></label>
    <CommunityFields value={options} onChange={setOptions} />
    <GoalPolicyFields value={goals} onChange={setGoals} />
    {error && <p role="alert">{error}</p>}
    <button className="primary-button" disabled={busy}>{busy ? "개설 중…" : "스터디 개설"}</button>
  </form>;
}

function StudyDirectory({ scope }: { scope: "mine" | "search" }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<{ offset: number; retry: number }>({ offset: 0, retry: 0 });
  const [studies, setStudies] = useState<StudyPreview[]>([]);
  const [more, setMore] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [joining, setJoining] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setBusy(true); setError("");
      if (page.offset === 0) { setStudies([]); setMore(null); }
      try {
        const params = new URLSearchParams({ scope, q: query, offset: String(page.offset) });
        const result = await communityRequest<StudyList>(`/api/studies?${params}`, undefined, controller.signal);
        if (!controller.signal.aborted) {
          setStudies((previous) => page.offset ? [...previous, ...result.studies] : result.studies);
          setMore(result.nextOffset);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(communityMessage(cause));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [scope, query, page]);
  function search(event: FormEvent) {
    event.preventDefault(); setQuery(input.trim()); setPage({ offset: 0, retry: page.retry + 1 });
  }
  async function join(study: StudyPreview) {
    if (study.memberRole) { enterStudy(study.id); return; }
    setJoining(study.id); setError("");
    try {
      const result = await communityRequest<JoinResult>("/api/studies/join", { studyId: study.id });
      if (result.status === "joined") enterStudy(result.studyId);
      else setStudies((all) => all.map((item) => item.id === study.id ? { ...item, pending: true } : item));
    } catch (cause) { setError(communityMessage(cause)); }
    finally { setJoining(""); }
  }
  return <>
    {scope === "search" && <form onSubmit={search} className={styles.search}>
      <input aria-label="스터디 이름 검색" placeholder="스터디 이름" maxLength={80} value={input} onChange={(e) => setInput(e.target.value)} />
      <button className="primary-button">검색</button>
    </form>}
    <div className={styles.grid}>{studies.map((study) =>
      <StudyCard key={study.id} study={study}>
        <button className="secondary-button" disabled={joining === study.id || (study.pending && study.joinPolicy === "approval")}
          onClick={() => void join(study)}>{study.memberRole ? "스터디 열기" : study.pending && study.joinPolicy === "approval" ? "승인 대기 중"
            : study.joinPolicy === "open" ? "가입하기" : "가입 신청"}</button>
      </StudyCard>)}</div>
    {error && <p role="alert">{error} <button className="secondary-button"
      onClick={() => setPage({ ...page, retry: page.retry + 1 })}>다시 조회</button></p>}
    {!busy && !error && !studies.length && <p>{scope === "mine" ? "아직 참여한 스터디가 없어요." : "검색된 스터디가 없어요."}</p>}
    {busy && <p role="status">스터디를 불러오는 중…</p>}
    {more !== null && !busy && !error && <button className="secondary-button" onClick={() => setPage({ offset: more, retry: 0 })}>더 보기</button>}
  </>;
}

function InviteEntry() {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  function open(event: FormEvent) {
    event.preventDefault();
    const value = input.trim().replace(/\/$/, "");
    const code = value.includes("/") ? value.split("/").at(-1) : value;
    if (!validCode(code)) { setError("받은 초대 링크나 코드를 확인해 주세요."); return; }
    window.location.assign(`/join/${code}`);
  }
  return <form onSubmit={open} className={styles.invite}>
    <label htmlFor="invite-link">초대 링크 또는 코드</label>
    <div className={styles.search}><input id="invite-link" value={input} onChange={(e) => setInput(e.target.value)} required />
      <button className="secondary-button">초대 확인</button></div>
    {error && <p role="alert">{error}</p>}
  </form>;
}

export function StudyBrowser() {
  const [tab, setTab] = useState<Tab>(() => typeof window !== "undefined" && localStorage.getItem("hamster-study-id") ? "mine" : "search");
  return <main className={styles.shell}>
    <header className={styles.heading}><h1>스터디</h1><Link href="/dashboard">달력으로</Link></header>
    <nav className={styles.tabs} aria-label="스터디 탐색">
      {([["mine","내 스터디"],["search","스터디 찾기"],["create","새 스터디"]] as const).map(([value,label]) =>
        <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}
    </nav>
    {tab === "create" ? <CreateStudy /> : <StudyDirectory key={tab} scope={tab} />}
    {tab === "search" && <InviteEntry />}
  </main>;
}
