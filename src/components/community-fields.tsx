"use client";

import { useId, type ReactNode } from "react";
import type { CommunityOptions, StudyPreview } from "@/lib/community";
import { GOAL_LABELS } from "@/lib/study-goals";
import styles from "./study-community.module.css";

export function CommunityFields({ value, onChange, children }: {
  value: CommunityOptions;
  onChange: (value: CommunityOptions) => void;
  children?: ReactNode;
}) {
  const id = useId();
  return <>
    <section className={styles.formSection}>
      <h3>스터디 소개</h3>
      <div className={styles.inset}>
        {children}
        <label className={styles.field}>
          <span>소개 <small>선택</small></span>
          <textarea maxLength={1000} rows={2} value={value.description}
            placeholder="어떤 공부를 함께 하나요?"
            onChange={(event) => onChange({ ...value, description: event.target.value })} />
        </label>
      </div>
    </section>
    <section className={styles.formSection}>
      <h3>참여 방법</h3>
      <div className={styles.inset}>
        <fieldset className={styles.choiceGroup}>
          <legend>검색 공개 여부</legend>
          <div className={styles.choices}>
            {[{ label: "공개", description: "스터디 찾기에 표시", public: true },
              { label: "비공개", description: "초대 링크로만 참여", public: false }].map((item) =>
              <label key={item.label} className={styles.choice}>
                <input type="radio" name={id + "-visibility"} checked={value.discoverable === item.public}
                  onChange={() => onChange({ ...value, discoverable: item.public })} />
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </label>)}
          </div>
        </fieldset>
        <fieldset className={styles.choiceGroup}>
          <legend>가입 방식</legend>
          <div className={styles.choices}>
            {[{ label: "자유 가입", description: "바로 참여", policy: "open" },
              { label: "승인 후 가입", description: "스터디장이 확인", policy: "approval" }].map((item) =>
              <label key={item.policy} className={styles.choice}>
                <input type="radio" name={id + "-join-policy"} checked={value.joinPolicy === item.policy}
                  onChange={() => onChange({ ...value, joinPolicy: item.policy === "open" ? "open" : "approval" })} />
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </label>)}
          </div>
        </fieldset>
      </div>
    </section>
  </>;
}

export function StudyCard({ study, children }: { study: StudyPreview; children: ReactNode }) {
  const { allowed, required, mode } = study.goals;
  const criterion = allowed.length === 1 ? `${GOAL_LABELS[allowed[0]]} 완료`
    : mode === "all" || required === allowed.length ? `목표 ${allowed.length}개 모두 완료`
    : `${allowed.length}개 중 ${required}개 완료`;

  return <article className={styles.card}>
    <header className={styles.cardTitle}>
      <h3>{study.name}</h3>
      <span aria-label={`멤버 ${study.memberCount}명`}>{study.memberCount}명</span>
    </header>
    {study.description && <p className={styles.description}>{study.description}</p>}
    <ul className={styles.goals} aria-label="허용 목표">
      {allowed.map((goal) => <li key={goal} data-goal={goal}>{GOAL_LABELS[goal]}</li>)}
    </ul>
    <footer className={styles.cardFoot}>
      <div className={styles.criteria}>
        <span>하루 인증 · {study.joinPolicy === "open" ? "자유 가입" : "승인제"}</span>
        <strong>{criterion}</strong>
      </div>
      {children}
    </footer>
  </article>;
}
