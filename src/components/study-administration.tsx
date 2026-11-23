"use client";

import { useState } from "react";
import { communityMessage, communityRequest } from "@/lib/community-client";
import type { CommunityManagement, CommunityOptions } from "@/lib/community";
import { CommunityFields } from "./community-fields";
import { useStudyPanel } from "./use-study-panel";
import { invalidateViews, peekView, putView } from "@/lib/view-cache";
import styles from "./study-community.module.css";
import sheet from "./study-settings.module.css";

export function StudyAdministration({ viewerId, studyId, visible }: { viewerId: string; studyId: string; visible: boolean }) {
  const key = `manage:${studyId}`;
  const panel = useStudyPanel<CommunityManagement>(viewerId, key,
    visible ? `/api/studies/manage?studyId=${encodeURIComponent(studyId)}` : null);
  const state = panel?.data;
  const [draft, setOptions] = useState<CommunityOptions>();
  const options = draft ?? state;
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  async function action(name: string, targetId?: string) {
    setBusy(name); setMessage("");
    try {
      const response = await communityRequest<{ code?: string; member?: CommunityManagement["members"][number] | null; refresh?: boolean }>("/api/studies/manage", {
        studyId, action: name, targetId, ...(name === "configure" && options ? {
          description: options.description, joinPolicy: options.joinPolicy, discoverable: options.discoverable
        } : {}),
      }, undefined, viewerId);
      if (name === "invite" && response.code) {
        setInvite(new URL(`/join/${response.code}`, window.location.origin).href);
      } else {
        const previous = peekView<CommunityManagement>(viewerId, key);
        const affected = [key, "directory:", "invite:"];
        if (name === "approve" || name === "promote") affected.push(`calendar:${studyId}:`);
        invalidateViews(viewerId, affected);
        const hasMemberResult = !["approve", "promote"].includes(name) || "member" in response;
        if (previous && hasMemberResult && !response.refresh) {
          let next = previous;
          if (name === "configure" && options) {
            next = { ...previous, description: options.description.trim(), joinPolicy: options.joinPolicy, discoverable: options.discoverable };
          } else if (name === "approve" || name === "reject") {
            next = { ...previous, requests: previous.requests.filter(person => person.id !== targetId) };
          }
          if (response.member) {
            const person = response.member;
            const exists = next.members.some(member => member.id === person.id);
            next = { ...next, members: exists ? next.members.map(member => member.id === person.id ? person : member) : [...next.members, person] };
          }
          putView(viewerId, key, next);
        }
        if (name === "configure") setOptions(undefined);
        setMessage(name === "configure" ? "가입 설정을 저장했어요." : "멤버 정보를 반영했어요.");
      }
    } catch (cause) { setMessage(communityMessage(cause)); }
    finally { setBusy(""); }
  }
  return <section className={sheet.management} aria-label="가입과 멤버 관리">
    {!state && !panel?.error && <p>멤버 정보를 불러오는 중…</p>}
    {!state && panel?.error && <><p role="alert">{panel.error}</p><button className="secondary-button"
      onClick={() => invalidateViews(viewerId, [key])}>다시 조회</button></>}
    {state && options && <>
      <form className={sheet.managementForm} onSubmit={(e) => { e.preventDefault(); void action("configure"); }}>
        <CommunityFields value={options} onChange={setOptions} />
        <button className={sheet.quietButton} disabled={Boolean(busy)}>{busy === "configure" ? "저장 중…" : "가입 설정 저장"}</button>
      </form>
      <div className={sheet.accountGroup}><h3>초대 링크</h3>
      {invite ? <div className={sheet.inviteLink}>
        <input aria-label="공유할 초대 링크" value={invite} readOnly onFocus={(e) => e.target.select()} />
        <button className="secondary-button" onClick={() => {
          void navigator.clipboard.writeText(invite).then(() => setMessage("초대 링크를 복사했어요."))
            .catch(() => setMessage("위 링크를 선택해 복사해 주세요."));
        }}>링크 복사</button>
      </div> : <button className={sheet.quietButton} onClick={() => void action("invite")} disabled={Boolean(busy)}>초대 링크 발급</button>}
      </div>
      <div className={sheet.accountGroup}><h3>가입 신청 <span className={sheet.personCount}>{state.requests.length}명</span></h3>
      {state.requests.length === 0 ? <p className={sheet.caption}>대기 중인 신청이 없어요.</p> : <ul className={styles.memberList}>
        {state.requests.map((person) => <li key={person.id}><strong>{person.name}</strong><div className={styles.actions}>
          <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void action("approve", person.id)}>승인</button>
          <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void action("reject", person.id)}>거절</button>
        </div></li>)}</ul>}
      </div>
      <div className={sheet.accountGroup}><h3>멤버 <span className={sheet.personCount}>{state.members.length}명</span></h3><ul className={styles.memberList}>
        {state.members.map((person) => <li key={person.id}><strong>{person.name}</strong>
          {person.role === "admin" ? <span>스터디장</span> :
            <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void action("promote", person.id)}>공동 스터디장 지정</button>}
        </li>)}</ul></div>
    </>}
    {message && <p className={sheet.notice} role="status">{message}</p>}
  </section>;
}
