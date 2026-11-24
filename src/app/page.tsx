import { AccountGate } from "@/components/account-gate";
import { AppBrand } from "@/components/app-brand";
import { AuthPanel } from "@/components/auth-panel";
import { CALENDAR_STATE } from "@/lib/calendar-state";
import styles from "./home.module.css";

const exampleDays = [
  { date: "16", weekday: "월", records: [["모카", "complete"], ["두부", "complete"], ["보리", "complete"]] },
  { date: "17", weekday: "화", records: [["모카", "complete"], ["두부", "complete"], ["보리", "missed"]] },
  { date: "18", weekday: "수", records: [["모카", "complete"], ["두부", "postponed"], ["보리", "missed"]] },
] as const;

function CalendarPreview() {
  return (
    <figure className={styles.preview}>
      <figcaption>
        <span className={styles.caption}>스터디 인증 달력 예시</span>
        <h2 className={styles.month}><span>2026년</span> 11월</h2>
      </figcaption>
      <ol className={styles.days}>
        {exampleDays.map(({ date, weekday, records }) => (
          <li key={date} className={styles.day}>
            <h3><time dateTime={`2026-11-${date}`}>{date}<span>{weekday}요일</span></time></h3>
            <ul className={styles.records}>
              {records.map(([name, state]) => (
                <li key={name} data-state={state}>
                  <strong>{name}</strong>
                  <span className={styles.status}>
                    <span className={styles.icon} aria-hidden="true">{CALENDAR_STATE[state].icon}</span>
                    {CALENDAR_STATE[state].label}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
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
