"use client";

import { useEffect, useState } from "react";
import { communityMessage, communityRequest } from "@/lib/community-client";
import type { CommunityManagement, CommunityOptions } from "@/lib/community";
import { CommunityFields } from "./community-fields";
import styles from "./study-community.module.css";

export function StudyAdministration({ studyId }: { studyId: string }) {
  const [state, setState] = useState<CommunityManagement>();
  const [options, setOptions] = useState<CommunityOptions>();
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    communityRequest<CommunityManagement>(`/api/studies/manage?studyId=${encodeURIComponent(studyId)}`, undefined, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState(data);
        setOptions((current) => current ?? { description: data.description, joinPolicy: data.joinPolicy, discoverable: data.discoverable });
      }).catch((cause) => { if (!controller.signal.aborted) setMessage(communityMessage(cause)); });
    return () => controller.abort();
  }, [studyId, revision]);
  async function action(name: string, targetId?: string) {
    setBusy(name); setMessage("");
    try {
      const response = await communityRequest<{ code?: string }>("/api/studies/manage", {
        studyId, action: name, targetId, ...(name === "configure" ? options : {}),
      });
      if (name === "invite" && response.code) {
        setInvite(new URL(`/join/${response.code}`, window.location.origin).href);
      } else {
        setMessage(name === "configure" ? "가입 설정을 저장했어요." : "멤버 정보를 반영했어요.");
        setRevision((r) => r + 1);
      }
    } catch (cause) { setMessage(communityMessage(cause)); }
    finally { setBusy(""); }
  }
  return <section className="settings-section">
    <h3>가입 및 멤버 관리</h3>
    {!state && !message && <p>멤버 정보를 불러오는 중…</p>}
    {!state && message && <button className="secondary-button" onClick={() => setRevision((r) => r + 1)}>다시 조회</button>}
    {state && options && <>
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); void action("configure"); }}>
        <CommunityFields value={options} onChange={setOptions} />
        <button className="secondary-button" disabled={Boolean(busy)}>가입 설정 저장</button>
      </form>
      <h4>초대 링크</h4>
      {invite ? <div className={styles.search}>
        <input aria-label="공유할 초대 링크" value={invite} readOnly onFocus={(e) => e.target.select()} />
        <button className="secondary-button" onClick={() => {
          void navigator.clipboard.writeText(invite).then(() => setMessage("초대 링크를 복사했어요."))
            .catch(() => setMessage("위 링크를 선택해 복사해 주세요."));
        }}>링크 복사</button>
      </div> : <button className="secondary-button" onClick={() => void action("invite")} disabled={Boolean(busy)}>초대 링크 발급</button>}
      <h4>가입 신청 · {state.requests.length}명</h4>
      {state.requests.length === 0 ? <p>대기 중인 신청이 없어요.</p> : <ul className={styles.memberList}>
        {state.requests.map((person) => <li key={person.id}><strong>{person.name}</strong><div className={styles.actions}>
          <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void action("approve", person.id)}>승인</button>
          <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void action("reject", person.id)}>거절</button>
        </div></li>)}</ul>}
      <h4>멤버 · {state.members.length}명</h4><ul className={styles.memberList}>
        {state.members.map((person) => <li key={person.id}><strong>{person.name}</strong>
          {person.role === "admin" ? <span>스터디장</span> :
            <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void action("promote", person.id)}>공동 스터디장 지정</button>}
        </li>)}</ul>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
