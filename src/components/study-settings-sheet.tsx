"use client";

import { useEffect, useId, useRef, useState } from "react";
import { backfillGitHubRepository, startGitHubConnection } from "@/lib/github-connect-browser";
import { browserSupabase } from "@/lib/supabase-browser";
import { invalidateViews } from "@/lib/view-cache";
import { NicknameSettings } from "./account-settings";
import { StudyAdministration } from "./study-administration";
import { StudyRuleEditor, type SettingsStudy } from "./study-rule-editor";
import { useStudyPanel } from "./use-study-panel";
import s from "./study-settings.module.css";

type SettingsPanel = {
  repositories: Array<{id: string; fullName: string}>;
  ruleHistory: Array<{ effective_from: string; changed_by: string | null }>;
};
type Tab = "rules" | "members" | "account";
type Props = {
  study: SettingsStudy;
  members: Array<{userId: string; name: string}>;
  viewerId: string;
  githubAppSlug: string;
  onClose: () => void;
  onLogout: () => Promise<void>;
};

export function StudySettingsSheet({ study, members, viewerId, githubAppSlug, onClose, onLogout }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const [tab, setTab] = useState<Tab>("rules");
  const [visited, setVisited] = useState<Tab[]>(["rules"]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const panel = "/api/dashboard/panel?studyId=" + encodeURIComponent(study.id);
  const history = useStudyPanel<Pick<SettingsPanel, "ruleHistory">>(viewerId, `history:${study.id}`,
    tab === "rules" && historyOpen ? panel + "&view=history" : null);
  const repositories = useStudyPanel<Pick<SettingsPanel, "repositories">>(viewerId, "repos",
    tab === "account" ? panel + "&view=repositories" : null);

  useEffect(() => {
    const sheet = dialog.current;
    if (!sheet) return;
    const previousOverflow = document.body.style.overflow;
    sheet.showModal();
    document.body.style.overflow = "hidden";
    return () => { sheet.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  async function backfill(id: string) {
    setBusy(id); setMessage("");
    try {
      const { data } = await browserSupabase().auth.getSession();
      if (!data.session) throw new Error("로그인이 필요해요.");
      const count = await backfillGitHubRepository(id, data.session.access_token);
      setMessage(count + "개 풀이를 가져왔어요.");
      invalidateViews(viewerId, ["calendar:", "day:", "growth:"]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "과거 기록을 가져오지 못했어요.");
    } finally { setBusy(""); }
  }
  async function logout() {
    setBusy("logout"); setMessage("");
    try { await onLogout(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "로그아웃에 실패했어요."); }
    finally { setBusy(""); }
  }
  function connect() {
    setMessage("");
    if (!githubAppSlug) { setMessage("GitHub App 연결을 확인해 주세요."); return; }
    try { startGitHubConnection(study.id, githubAppSlug); }
    catch { setMessage("GitHub 연결을 시작하지 못했어요."); }
  }
  function openTab(next: Tab) {
    setTab(next);
    setVisited(previous => previous.includes(next) ? previous : [...previous, next]);
    content.current?.scrollTo(0, 0);
  }

  return <dialog ref={dialog} aria-labelledby={headingId} className={s.dialog}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className={s.header}>
      <div><p>{study.name}</p><h2 id={headingId}>스터디 설정</h2></div>
      <button type="button" className={s.close} aria-label="스터디 설정 닫기" onClick={onClose}>×</button>
    </header>
    <div className={s.navigation} role="group" aria-label="스터디 설정 메뉴">
      <button type="button" aria-pressed={tab === "rules"} onClick={() => openTab("rules")}>인증 규칙</button>
      {study.role === "admin" && <button type="button" aria-pressed={tab === "members"} onClick={() => openTab("members")}>가입·멤버</button>}
      <button type="button" aria-pressed={tab === "account"} onClick={() => openTab("account")}>내 계정</button>
    </div>
    <div ref={content} className={s.scrollArea} key={study.id}>
      <div hidden={tab !== "rules"}>
        <StudyRuleEditor study={study} onChanged={async () => {
          invalidateViews(viewerId, [`history:${study.id}`, `calendar:${study.id}:`, "directory:", "invite:"]);
        }} />
        <details className={s.history} onToggle={event => setHistoryOpen(event.currentTarget.open)}>
          <summary>규칙 변경 이력</summary>
          {historyOpen && <div className={s.disclosureBody}>
            {history?.data?.ruleHistory.length ? history.data.ruleHistory.map((item, index) =>
              <div className={s.ruleRow} key={item.effective_from + "-" + index}>
                <strong>{item.effective_from}</strong><span>{members.find(m => m.userId === item.changed_by)?.name || "초기 설정"}</span>
              </div>) : <p className={s.caption}>{history?.error || (history?.data ? "변경 이력이 없어요." : "이력을 불러오는 중…")}</p>}
          </div>}
        </details>
      </div>
      {visited.includes("members") && study.role === "admin" && <div hidden={tab !== "members"}><StudyAdministration viewerId={viewerId} studyId={study.id} visible={tab === "members"} /></div>}
      {visited.includes("account") && <div hidden={tab !== "account"}><div className={s.accountGroups}>
        <div className={s.accountGroup}><NicknameSettings visible={tab === "account"} /></div>
        <section className={s.accountGroup} aria-label="GitHub 저장소">
          <header className={s.ruleHeading}><div><h3>GitHub 저장소</h3><p>연결한 저장소에서 알고리즘 풀이를 가져와요.</p></div></header>
          {repositories?.data?.repositories.length ? <ul className={s.repositories}>
            {repositories.data.repositories.map(repo => <li key={repo.id}><strong>{repo.fullName}</strong>
              <button type="button" className={s.quietButton} disabled={!!busy} onClick={() => void backfill(repo.id)}>
                {busy === repo.id ? "가져오는 중…" : "과거 기록 가져오기"}
              </button></li>)}</ul> : <p className={s.caption}>{repositories?.error || (repositories?.data ? "연결된 저장소가 없어요." : "저장소를 확인하는 중…")}</p>}
          <button type="button" className={s.quietButton} onClick={connect}>저장소 연결</button>
        </section>
        <button type="button" className={s.logout} disabled={!!busy} onClick={() => void logout()}>{busy === "logout" ? "로그아웃 중…" : "로그아웃"}</button>
        {message && <p className={s.notice} role="status">{message}</p>}
      </div></div>}
    </div>
  </dialog>;
}
