import { AccountGate } from "@/components/account-gate";
import { AppBrand } from "@/components/app-brand";
import { AuthPanel } from "@/components/auth-panel";
import { CALENDAR_STATE } from "@/lib/calendar-state";
import styles from "./home.module.css";

const sampleMembers = ["모카", "두부", "보리"] as const;
const exampleDays = [
  { date: 16, weekday: "월", states: ["complete", "complete", "complete"] },
  { date: 17, weekday: "화", states: ["complete", "complete", "missed"] },
  { date: 18, weekday: "수", states: ["complete", "postponed", "missed"] },
  { date: 19, weekday: "목", states: ["complete", "complete", "complete"] },
  { date: 20, weekday: "금", states: ["postponed", "complete", "complete"] },
  { date: 21, weekday: "토", states: ["complete", "missed", "complete"] },
  { date: 22, weekday: "일", states: ["complete", "complete", "complete"] },
] as const;

function CalendarPreview() {
  return (
    <figure className={styles.preview}>
      <figcaption>
        <span className={styles.caption}>스터디 인증 달력 예시</span>
        <h2 className={styles.month}><span>2026년</span> 11월</h2>
      </figcaption>
      <div className={styles.weekViewport} role="region" aria-label="11월 16일부터 22일까지의 인증 예시" tabIndex={0}>
        <ol className={styles.days}>
          {exampleDays.map(({ date, weekday, states }) => (
            <li key={date} className={styles.day}>
              <h3><time dateTime={`2026-11-${date}`}>{date}<span>{weekday}요일</span></time></h3>
              <ul className={styles.records}>
                {sampleMembers.map((name, index) => {
                  const state = states[index];
                  const { icon, label } = CALENDAR_STATE[state];
                  return (
                    <li key={name} data-state={state}>
                      <strong>{name}</strong>
                      <span className={styles.status}><span className={styles.icon} aria-hidden="true">{icon}</span>{label}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </div>
      <p className={styles.previewNote}>GitHub에 올린 풀이와 직접 인증한 공부를 같은 달력에서 확인해요.</p>
    </figure>
  );
}

export default function Home() {
  return (
    <AccountGate landing>
      <main className={styles.home}>
        <header className={styles.header}>
          <AppBrand />
          <a href="#account" className={styles.loginLink}>로그인하기 <span aria-hidden="true">↓</span></a>
        </header>
        <div className={styles.content}>
          <CalendarPreview />
          <section id="account" className={styles.access} aria-label="햄쮸터 계정">
            <AuthPanel />
          </section>
        </div>
      </main>
    </AccountGate>
  );
}
