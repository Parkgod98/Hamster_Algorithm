"use client";

import type { CommunityOptions, StudyPreview } from "@/lib/community";
import { GOAL_LABELS } from "@/lib/study-goals";
import styles from "./study-community.module.css";

export function CommunityFields({ value, onChange }: {
  value: CommunityOptions; onChange: (value: CommunityOptions) => void;
}) {
  return <>
    <label className={styles.field}>소개
      <textarea maxLength={1000} rows={3} value={value.description}
        onChange={(e) => onChange({ ...value, description: e.target.value })} />
    </label>
    <label className={styles.field}>검색 공개 여부
      <select value={value.discoverable ? "public" : "private"}
        onChange={(e) => onChange({ ...value, discoverable: e.target.value === "public" })}>
        <option value="public">공개 · 스터디 검색에 표시</option>
        <option value="private">비공개 · 초대 링크로만 참여</option>
      </select>
    </label>
    <label className={styles.field}>가입 방식
      <select value={value.joinPolicy}
        onChange={(e) => onChange({ ...value, joinPolicy: e.target.value === "approval" ? "approval" : "open" })}>
        <option value="open">자유 가입</option><option value="approval">스터디장 승인 후 가입</option>
      </select>
    </label>
  </>;
}

export function StudyCard({ study, children }: { study: StudyPreview; children: React.ReactNode }) {
  const policy = study.goals;
  return <article className={styles.card}>
    <header><h3>{study.name}</h3><span>{study.memberCount}명</span></header>
    <p className={styles.description}>{study.description || "등록된 소개가 없어요."}</p>
    <dl className={styles.facts}>
      <dt>허용 목표</dt><dd>{policy.allowed.map((goal) => GOAL_LABELS[goal]).join(" · ")}</dd>
      <dt>하루 인증 기준</dt><dd>{policy.mode === "all" ? "모든 목표 완료" : `서로 다른 목표 ${policy.required}개 완료`}</dd>
      <dt>가입 방식</dt><dd>{study.joinPolicy === "open" ? "자유 가입" : "스터디장 승인"}</dd>
    </dl>
    <div className={styles.actions}>{children}</div>
  </article>;
}
