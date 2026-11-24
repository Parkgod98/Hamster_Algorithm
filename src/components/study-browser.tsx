"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { communityMessage, communityRequest, studyPath } from "@/lib/community-client";
import { browserSupabase, currentAccountId } from "@/lib/supabase-browser";
import { cachedDirectoryPages, directoryKey, type DirectoryScope } from "@/lib/directory-cache";
import { studyDateFromTimestamp } from "@/lib/study-day";
import { invalidateViews, peekView, putView, readView } from "@/lib/view-cache";
import { useViewRevision } from "./use-view-revision";
import { rememberedStudy } from "@/lib/study-navigation";
import { validCode, type CommunityOptions, type JoinResult, type StudyList, type StudyPreview } from "@/lib/community";
import { DEFAULT_GOALS, type GoalPolicy } from "@/lib/study-goals";
import { AppBrand } from "./app-brand";
import { GoalPolicyFields } from "./study-goal-fields";
import { CommunityFields, StudyCard } from "./community-fields";
import { NicknameSettings } from "./account-settings";
import styles from "./study-community.module.css";

type Directory = DirectoryScope;
type BrowsePosition = { query: string; offset: number; scroll: number };
const navigationOptions = { ttlMs: 30 * 60_000 };

function CreateStudy({ viewerId, onDismiss }: { viewerId: string; onDismiss: () => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<"info" | "rules">("info");
  const [name, setName] = useState("");
  const [options, setOptions] = useState<CommunityOptions>({ description: "", discoverable: true, joinPolicy: "open" });
  const [goals, setGoals] = useState<GoalPolicy>(DEFAULT_GOALS);
  const [studyId, setStudyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
    dialog.current?.scrollTo(0, 0);
  }, [step]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step === "info") { setStep("rules"); return; }
    setBusy(true);
    setError("");
    const id = studyId || crypto.randomUUID();
    setStudyId(id);
    try {
      const result = await communityRequest<{ studyId: string }>("/api/studies", { name, goals, studyId: id, ...options }, undefined, viewerId);
      invalidateViews(viewerId, ["directory:"]);
      router.push(studyPath(result.studyId));
    } catch (cause) {
      setError(communityMessage(cause));
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className={styles.sheet} aria-labelledby="create-study-title" onClose={onDismiss}
    onCancel={(event) => { if (busy) event.preventDefault(); }}>
    <div className={styles.sheetHead}>
      <ol aria-label="스터디 개설 단계" className={styles.steps}>
        <li aria-current={step === "info" ? "step" : undefined}>모임 정보</li>
        <li aria-current={step === "rules" ? "step" : undefined}>인증 규칙</li>
      </ol>
      <button className={styles.close} type="button" aria-label="스터디 개설 닫기" disabled={busy}
        onClick={() => dialog.current?.close()}>×</button>
    </div>
    <form onSubmit={submit} className={styles.createForm}>
      <div className={styles.sheetBody}>
        <h2 id="create-study-title" ref={title} tabIndex={-1}>{step === "info" ? "새 스터디 만들기" : "인증 규칙 정하기"}</h2>
        {step === "info" ? <CommunityFields value={options} onChange={setOptions}>
          <label className={styles.field}><span>스터디 이름</span>
            <input required maxLength={80} pattern={".*\\S.*"} title="스터디 이름을 입력해주세요."
              value={name} onChange={(event) => setName(event.target.value)} placeholder="예) 퇴근 후 20분 영어" />
          </label>
        </CommunityFields> : <>
          <div className={styles.reviewLine}>
            <strong>{name}</strong><span>{options.discoverable ? "검색 공개" : "비공개"} · {options.discoverable && options.joinPolicy === "open" ? "자유 가입" : "승인 후 가입"}</span>
          </div>
          <GoalPolicyFields value={goals} onChange={setGoals} />
        </>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>
      <footer className={styles.sheetFoot}>
        {step === "rules" && <button className={styles.secondary} type="button" disabled={busy}
          onClick={() => { setStep("info"); setError(""); }}>이전</button>}
        <button type="submit" className={styles.primary} disabled={busy}>
          {step === "info" ? "다음 · 인증 규칙" : busy ? "개설 중…" : "스터디 개설"}
        </button>
      </footer>
    </form>
  </dialog>;
}

function InviteEntry() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  function open(event: FormEvent) {
    event.preventDefault();
    const value = input.trim().replace(/\/$/, "");
    const code = value.includes("/") ? value.split("/").at(-1) : value;
    if (!validCode(code)) { setError("받은 초대 링크나 코드를 확인해 주세요."); return; }
    router.push(`/join/${code}`);
  }
  return <details className={styles.invite}>
    <summary>초대 링크로 참여</summary>
    <form onSubmit={open}>
      <label htmlFor="invite-link">초대 링크 또는 코드</label>
      <div className={styles.search}><input id="invite-link" value={input} required
        onChange={(event) => { setInput(event.target.value); setError(""); }} />
        <button className={styles.secondary}>초대 확인</button>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </form>
  </details>;
}

function StudyDirectory({ viewerId, scope, onSearch, onCreate }: { viewerId: string; scope: Directory; onSearch: () => void; onCreate: () => void }) {
  const router = useRouter();
  const positionKey = `browse-position:${scope}`;
  const [position] = useState(() => peekView<BrowsePosition>(viewerId, positionKey));
  const [input, setInput] = useState(position?.query ?? "");
  const [query, setQuery] = useState(position?.query ?? "");
  const [page, setPage] = useState({ offset: position?.offset ?? 0, retry: 0 });
  const day = studyDateFromTimestamp(new Date().toISOString());
  const revision = useViewRevision(viewerId, `directory:${scope}:`);
  const resultKey = JSON.stringify([viewerId, scope, query, day, revision]);
  const [result, setResult] = useState<{ key: string; offset: number; list: StudyList } | undefined>(() => {
    const pages = cachedDirectoryPages(viewerId, scope, query, page.offset, day);
    const last = pages.at(-1);
    if (!last) return;
    return { key: resultKey, offset: last.list.nextOffset === null || last.list.nextOffset > page.offset ? page.offset : -1,
      list: { studies: pages.flatMap(item => item.list.studies), nextOffset: last.list.nextOffset } };
  });
  const restoredScroll = useRef(position?.scroll ?? 0);
  const [joining, setJoining] = useState("");
  const [loadError, setLoadError] = useState("");
  const [joinError, setJoinError] = useState("");
  const sameResult = result?.key === resultKey;
  const studies = sameResult ? result.list.studies : [];
  const groups = scope === "mine"
    ? [{ key: "joined", items: studies.filter(study => study.memberRole) },
       { key: "pending", items: studies.filter(study => !study.memberRole && study.pending) }]
    : [{ key: "search", items: studies }];
  const more = sameResult ? result.list.nextOffset : null;
  const busy = !loadError && (!sameResult || result.offset !== page.offset);
  useEffect(() => {
    let top = restoredScroll.current || window.scrollY;
    const track = () => { top = window.scrollY; };
    const remember = () => {
      if (currentAccountId() === viewerId) {
        putView(viewerId, positionKey, { query, offset: page.offset, scroll: top }, navigationOptions);
      }
    };
    window.addEventListener("scroll", track, { passive: true });
    return () => {
      window.removeEventListener("scroll", track);
      remember();
    };
  }, [viewerId, positionKey, query, page.offset]);
  useEffect(() => {
    if (!sameResult || busy || !restoredScroll.current) return;
    window.scrollTo(0, restoredScroll.current);
    restoredScroll.current = 0;
  }, [sameResult, busy]);
  useEffect(() => {
    if (!viewerId) return;
    let active = true;
    async function load() {
      setLoadError("");
      try {
        const list: StudyList = { studies: [], nextOffset: 0 };
        do {
          const offset: number = list.nextOffset!;
          const params = new URLSearchParams({ scope, q: query, offset: String(offset) });
          const chunk = await readView<StudyList>(viewerId, directoryKey(scope, query, offset, day),
            signal => communityRequest(`/api/studies?${params}`, undefined, signal, viewerId));
          if (!active) return;
          list.studies.push(...chunk.studies);
          list.nextOffset = chunk.nextOffset;
        } while (list.nextOffset !== null && list.nextOffset <= page.offset);
        setResult({ key: resultKey, offset: page.offset, list });
      } catch (cause) {
        if (active) setLoadError(communityMessage(cause));
      }
    }
    void load();
    return () => { active = false; };
  }, [viewerId, scope, query, page, resultKey, day]);

  function search(term: string) {
    setJoinError("");
    const next = term.trim();
    if (next.toLowerCase() === query.toLowerCase() && !loadError &&
      peekView<StudyList>(viewerId, directoryKey(scope, query, 0, day))) return;
    restoredScroll.current = 0;
    setQuery(next);
    setPage((previous) => ({ offset: 0, retry: previous.retry + 1 }));
  }
  async function join(study: StudyPreview) {
    if (study.memberRole) { router.push(studyPath(study.id)); return; }
    if (joining) return;
    setJoining(study.id); setJoinError("");
    try {
      const result = await communityRequest<JoinResult>("/api/studies/join", { studyId: study.id }, undefined, viewerId);
      const pages = cachedDirectoryPages(viewerId, scope, query, page.offset, day);
      invalidateViews(viewerId, ["directory:", "invite:"]);
      if (result.status === "pending") {
        for (const { key, list } of pages) {
          putView(viewerId, key, { ...list, studies: list.studies.map(
            item => item.id === study.id ? { ...item, pending: true } : item
          ) });
        }
      }
      if (result.status === "joined") router.push(studyPath(result.studyId));
    } catch (cause) { setJoinError(communityMessage(cause)); }
    finally { setJoining(""); }
  }

  return <>
    {scope === "search" && <>
      <form role="search" className={styles.find} onSubmit={(event) => { event.preventDefault(); search(input); }}>
        <span className={styles.magnifier} aria-hidden="true" />
        <input type="search" aria-label="스터디 이름 검색" placeholder="스터디 이름으로 검색" maxLength={80}
          value={input} onChange={(event) => setInput(event.target.value)} />
        <button className={styles.primary}>검색</button>
      </form>
      <InviteEntry />
    </>}
    <section className={styles.results} aria-labelledby="directory-heading">
      <div className={styles.resultHeading}>
        <h2 id="directory-heading">{scope === "mine" ? "참여·신청 현황" : query ? "검색 결과" : "공개 스터디"}</h2>
        {!busy && !loadError && <span>{studies.length}{more !== null ? "+" : ""}개</span>}
      </div>
      {groups.map(group => group.items.length > 0 && <div key={group.key}>
        {scope === "mine" && <h3>{group.key === "pending" ? "승인 대기 중" : "참여 중"}</h3>}
        <div className={styles.grid}>{group.items.map(study => {
          const pending = study.pending && !study.memberRole && (scope === "mine" || study.joinPolicy === "approval");
          return <StudyCard key={study.id} study={study}>
            <button className={styles.cardButton} disabled={Boolean(joining) || pending} onClick={() => void join(study)}>
              {joining === study.id ? "처리 중…" : study.memberRole ? "스터디 열기" : pending ? "승인 대기 중"
                : study.joinPolicy === "open" ? "바로 가입" : "가입 신청"}
            </button>
          </StudyCard>;
        })}</div>
      </div>)}
      {joinError && <p role="alert" className={styles.error}>{joinError}</p>}
      {loadError && <div role="alert" className={styles.empty}><p>{loadError}</p>
        <button className={styles.secondary} onClick={() => setPage({ ...page, retry: page.retry + 1 })}>다시 조회</button></div>}
      {!busy && !loadError && !studies.length && <div className={styles.empty}>
        <p>{scope === "mine" ? "아직 참여한 스터디가 없어요." : query ? "이 이름으로 찾은 스터디가 없어요." : "아직 공개된 스터디가 없어요."}</p>
        {scope === "mine" ? <button className={styles.secondary} onClick={onSearch}>스터디 찾기</button>
          : query ? <button className={styles.secondary} onClick={() => { setInput(""); search(""); }}>전체 스터디 보기</button>
          : <button className={styles.secondary} onClick={onCreate}>첫 스터디 만들기</button>}
      </div>}
      {busy && <p className={styles.status} role="status">스터디를 불러오는 중…</p>}
      {more !== null && !busy && !loadError && <button className={styles.more}
        onClick={() => setPage({ offset: more, retry: 0 })}>더 보기</button>}
    </section>
  </>;
}

export function StudyBrowser() {
  const accountId = typeof window !== "undefined" ? currentAccountId() ?? "" : "";
  const hasCalendar = accountId && rememberedStudy(accountId);
  const [tab, setTab] = useState<Directory>(() => peekView<Directory>(accountId, "browse-tab") ?? (hasCalendar ? "mine" : "search"));
  function openTab(next: Directory) {
    putView(accountId, "browse-tab", next, navigationOptions);
    setTab(next);
  }
  const [creating, setCreating] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  async function logout() {
    setLoggingOut(true); setLogoutError("");
    try {
      await browserSupabase().auth.signOut();
      window.location.replace("/");
    } catch (cause) {
      setLoggingOut(false); setLogoutError(communityMessage(cause));
    }
  }
  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <AppBrand />
      <div className={styles.topActions}>
        {hasCalendar && <Link href="/dashboard">달력으로</Link>}
        <button type="button" aria-expanded={accountOpen} aria-controls="study-account"
          onClick={() => setAccountOpen(!accountOpen)}>내 계정</button>
      </div>
    </header>
    {accountOpen && <section id="study-account" aria-label="내 계정" className={styles.account}>
      <NicknameSettings />
      <button className={styles.secondary} disabled={loggingOut} onClick={() => void logout()}>로그아웃</button>
      {logoutError && <p role="alert" className={styles.error}>{logoutError}</p>}
    </section>}
    <div className={styles.content}>
      <div className={styles.titleRow}>
        <h1>{tab === "mine" ? "내 스터디" : "스터디 찾기"}</h1>
        <button className={styles.createButton} onClick={() => setCreating(true)}><span aria-hidden="true">+</span> 스터디 만들기</button>
      </div>
      <nav className={styles.tabs} aria-label="스터디 탐색">
        {([["search", "스터디 찾기"], ["mine", "내 스터디"]] as const).map(([value, label]) =>
          <button key={value} type="button" aria-pressed={tab === value} onClick={() => openTab(value)}>{label}</button>)}
      </nav>
      <StudyDirectory key={accountId + tab} viewerId={accountId} scope={tab} onSearch={() => openTab("search")} onCreate={() => setCreating(true)} />
    </div>
    {creating && <CreateStudy viewerId={accountId} onDismiss={() => setCreating(false)} />}
  </main>;
}
