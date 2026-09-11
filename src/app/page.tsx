const members = [
  ["현성", "완료", "BOJ G4 · 1/1"],
  ["친구 A", "진행 중", "BOJ S2 · 1/2"],
  ["친구 B", "미루기", "1/2회"],
];

export default function Home() {
  return <main className="shell">
    <section className="hero">
      <p>🐹 HAMSTER ALGORITHM</p>
      <h1>풀기만 하세요.<br/>인증은 햄쮸터가.</h1>
      <p className="muted">각자 자기 GitHub Repository에 BaekjoonHub가 남긴 풀이를 모아 오전 4시 기준으로 자동 판정합니다.</p>
      <a className="button" href="#today">오늘 현황 보기</a>
    </section>
    <section id="today" className="grid">
      <article className="card"><p className="muted">오늘 상태</p><div className="status">✅ 인증 완료</div><p>Gold IV · 1문제</p><div className="bar"><span style={{width:"100%"}}/></div></article>
      <article className="card"><p className="muted">Study Day</p><div className="status">04:00 → 03:59</div><p>새벽 풀이도 전날 인증으로 안전하게 계산합니다.</p></article>
      <article className="card"><p className="muted">연결 방식</p><div className="status">GitHub App</div><p>사용자마다 다른 Repository를 선택해 연결합니다.</p></article>
    </section>
    <section className="card" style={{marginTop:14}}><h2>오늘 스터디</h2><div className="members">{members.map(([name,state,detail])=><div className="member" key={name}><strong>{name}</strong><span>{state} · {detail}</span></div>)}</div></section>
  </main>;
}
