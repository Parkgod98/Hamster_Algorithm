import { AuthPanel } from "@/components/auth-panel";

const previewDays = [
  { day: "8", members: [["현성", "✅"], ["세진", "✅"], ["현수", "⏭"]] },
  { day: "9", members: [["현성", "✅"], ["세진", "✅"], ["현수", "✅"]] },
  { day: "10", members: [["현성", "✅"], ["세진", "🟡"], ["현수", "✅"]] },
  { day: "11", members: [["현성", "✅"], ["세진", "✅"], ["현수", "❌"]], today: true },
  { day: "12", members: [["현성", "·"], ["세진", "·"], ["현수", "·"]] },
  { day: "13", members: [["현성", "·"], ["세진", "·"], ["현수", "·"]] },
  { day: "14", members: [["현성", "·"], ["세진", "·"], ["현수", "·"]] },
];

export default function Home() {
  return <main className="landing-shell">
    <nav className="landing-nav">
      <div className="landing-brand"><span>🐹</span><strong>햄쮸터</strong></div>
      <span className="landing-badge">Algorithm Study Automation</span>
    </nav>

    <section className="landing-hero">
      <div className="landing-copy">
        <p className="landing-kicker">GitHub 풀이 기록으로 자동 인증</p>
        <h1>문제만 풀면,<br /><span>인증은 끝.</span></h1>
        <p className="landing-description">BaekjoonHub가 남긴 commit을 햄쮸터가 읽고, 스터디 규칙에 맞춰 자동으로 인증합니다. 캡처도, Notion 체크도 필요 없습니다.</p>
        <AuthPanel />
        <div className="landing-trust"><span>✓ Repository는 읽기 전용</span><span>✓ 오전 4시 Study Day</span><span>✓ PWA 설치 지원</span></div>
      </div>

      <div className="product-preview" aria-label="햄쮸터 월간 인증 캘린더 미리보기">
        <div className="preview-window-bar"><span></span><span></span><span></span><strong>햄쮸터 알고리즘</strong></div>
        <div className="preview-header"><div><small>2026년</small><strong>9월</strong></div><div className="preview-stats"><span>3명</span><span>완료 18</span><span>미루기 2</span></div></div>
        <div className="preview-weekdays">{["월", "화", "수", "목", "금", "토", "일"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="preview-calendar">
          {previewDays.map((date) => <div key={date.day} className={`preview-day${date.today ? " today" : ""}`}>
            <div className="preview-date">{date.day}{date.today && <em>오늘</em>}</div>
            {date.members.map(([name, state]) => <div className="preview-member" key={name}><span>{name}</span><b>{state}</b></div>)}
          </div>)}
        </div>
      </div>
    </section>

    <section className="landing-flow" aria-label="햄쮸터 사용 흐름">
      <article><span>01</span><div><strong>평소처럼 풉니다</strong><p>BaekjoonHub가 개인 Repository에 풀이를 push합니다.</p></div></article>
      <article><span>02</span><div><strong>햄쮸터가 판정합니다</strong><p>난이도, 미루기, 선풀이와 스터디별 규칙을 적용합니다.</p></div></article>
      <article><span>03</span><div><strong>달력만 확인합니다</strong><p>같은 그룹 멤버들의 인증 상태를 한 달 단위로 봅니다.</p></div></article>
    </section>
  </main>;
}
