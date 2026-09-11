"use client";

import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

type Member = { userId: string; name: string; state: string; credits: number; detail: string };
type Repo = { id: string; fullName: string };
type DashboardData = {
  study: null | { id: string; name: string; inviteCode: string };
  members: Member[];
  repositories: Repo[];
  studyDate: string;
};

async function accessToken() {
  const { data } = await browserSupabase().auth.getSession();
  return data.session?.access_token;
}

export function Dashboard({ githubAppSlug }: { githubAppSlug: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function reload() {
    const access = await accessToken();
    if (!access) {
      window.location.replace("/");
      return;
    }
    const response = await fetch("/api/dashboard", { headers: { Authorization: `Bearer ${access}` } });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "조회 실패");
      return;
    }
    setData(payload);
  }

  useEffect(() => {
    async function initialLoad() {
      const access = await accessToken();
      if (!access) {
        window.location.replace("/");
        return;
      }
      const response = await fetch("/api/dashboard", { headers: { Authorization: `Bearer ${access}` } });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "조회 실패");
        return;
      }
      setData(payload);
    }
    void initialLoad();
  }, []);

  async function createStudy() {
    const access = await accessToken();
    const response = await fetch("/api/studies", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "햄쮸터" }),
    });
    if (response.ok) await reload();
  }

  function connect() {
    if (!data?.study || !githubAppSlug) return;
    localStorage.setItem("hamster-study-id", data.study.id);
    window.location.href = `https://github.com/apps/${githubAppSlug}/installations/new`;
  }

  async function postpone() {
    const access = await accessToken();
    const response = await fetch("/api/postponements", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ studyId: data?.study?.id }),
    });
    const payload = await response.json();
    if (!response.ok) alert(payload.error ?? "미루기 실패");
    else await reload();
  }

  async function backfill(repo: Repo) {
    setBusy(repo.id);
    const access = await accessToken();
    const response = await fetch("/api/repositories/backfill", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: repo.id }),
    });
    const payload = await response.json();
    setBusy("");
    if (!response.ok) alert(payload.error ?? "가져오기 실패");
    else {
      alert(`${payload.inserted}개 풀이를 가져왔습니다.`);
      await reload();
    }
  }

  if (error) return <main className="shell"><div className="card">{error}</div></main>;
  if (!data) return <main className="shell"><div className="card">불러오는 중…</div></main>;
  if (!data.study) return <main className="shell"><section className="hero"><h1>첫 햄쮸터를<br />만들어보세요.</h1><button className="button" onClick={createStudy}>스터디 만들기</button></section></main>;

  const invite = `${window.location.origin}/join/${data.study.inviteCode}`;
  return <main className="shell">
    <section className="hero">
      <p>🐹 {data.study.name}</p>
      <h1>{data.studyDate}<br />인증 현황</h1>
      <p className="muted">각자 자기 Repository를 연결하면 풀이만 해도 자동으로 인증됩니다.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="button" onClick={connect}>내 Repository 연결</button>
        <button className="button" onClick={postpone}>오늘 미루기</button>
        <button className="button" onClick={() => navigator.clipboard.writeText(invite)}>초대 링크 복사</button>
      </div>
    </section>
    <section className="card">
      <h2>스터디원</h2>
      <div className="members">{data.members.map((member) => <div className="member" key={member.userId}><div><strong>{member.name}</strong><div className="muted">{member.detail}</div></div><span>{member.state} · {(member.credits * 100).toFixed(0)}%</span></div>)}</div>
    </section>
    <section className="card" style={{ marginTop: 14 }}>
      <h2>내 연결 Repository</h2>
      {data.repositories.length ? data.repositories.map((repo) => <div className="member" key={repo.id}><span>{repo.fullName}</span><button onClick={() => backfill(repo)} disabled={busy === repo.id}>{busy === repo.id ? "가져오는 중…" : "과거 기록 가져오기"}</button></div>) : <p className="muted">아직 연결된 Repository가 없습니다.</p>}
    </section>
  </main>;
}
