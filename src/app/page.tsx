import { AppBrand } from "@/components/app-brand";
import { AccountGate } from "@/components/account-gate";
import { AuthPanel } from "@/components/auth-panel";
import styles from "./home.module.css";

const exampleWeek = [
  ["월", 16, "완료"], ["화", 17, "완료"], ["수", 18, "미루기"],
  ["목", 19, "완료"], ["금", 20, ""], ["토", 21, ""], ["일", 22, ""],
] as const;

function CalendarPreview() {
  return (
    <figure className={styles.preview} aria-label="스터디 인증 달력 예시">
      <figcaption>인증 달력 미리보기</figcaption>
      <p className={styles.month}>11월<span>2026</span></p>
      <ol className={styles.week}>
        {exampleWeek.map(([weekday, date, state]) => (
          <li key={date} className={date === 19 ? styles.selected : undefined}>
            <span>{weekday}</span><strong>{date}</strong>
            <i data-state={state} aria-label={state || "예정"} />
          </li>
        ))}
      </ol>
      <div className={styles.day}>
        <h2>19일 목요일</h2>
        <ul>
          <li><span className={styles.avatar}>윤</span><div><strong>윤서</strong><small>영어 인증</small></div><span className={styles.done}>완료</span></li>
          <li><span className={styles.avatar}>지</span><div><strong>지우</strong><small>알고리즘 인증</small></div><span className={styles.done}>완료</span></li>
        </ul>
      </div>
    </figure>
  );
}

export default function Home() {
  return (
    <AccountGate landing><main className={styles.home}>
      <header className={styles.header}><AppBrand /></header>
      <div className={styles.content}>
        <section className={styles.access} aria-label="햄쮸터 계정"><AuthPanel /></section>
        <CalendarPreview />
      </div>
    </main></AccountGate>
  );
}
