"use client";

import { useEffect, useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

type Repo = { id: string; fullName: string };
type Submission = {
  platform: string;
  problemId: string;
  title: string;
  difficulty: string;
  credit: number;
  solvedAt: string;
};
type MemberState = "inactive" | "upcoming" | "presolved" | "complete" | "in-progress" | "postponed" | "missed";
type DayMember = {
  userId: string;
  name: string;
  state: MemberState;
  credits: number;
  directCredits: number;
  penalty: number;
  consecutiveMisses: number;
  postponedAt: string | null;
  submissions: Submission[];
};
type CalendarDay = { date: string; members: DayMember[] };
type RuleConfig = {
  bojBronzeCount: number;
  bojSilverCount: number;
  bojGoldCount: number;
  programmersLowCount: number;
  programmersHighCount: number;
  sweaLowCount: number;
  sweaHighCount: number;
  codetreeSamsungCount: number;
  penalties: { 1: number; 2: number; 3: number };
};
type Study = {
  id: string;
  name: string;
  inviteCode: string;
  role: "admin" | "member";
  rules: RuleConfig;
  postponeDeadlineHour: number;
  postponeDeadlineMinute: number;
  maxConsecutivePostpone: number;
  maxPresolveDays: number;
};
type DashboardData = {
  study: Study | null;
  members: Array<{ userId: string; name: string }>;
  repositories: Repo[];
  days: CalendarDay[];
  summary: { complete: number; postponed: number; missed: number; inProgress: number };
  currentUserId: string;
  studyDate: string;
  month: string;
};
type RulesDraft = {
  ruleConfig: RuleConfig;
  postponeDeadlineHour: number;
  postponeDeadlineMinute: number;
  maxConsecutivePostpone: number;
  maxPresolveDays: number;
};

const STATE_META: Record<MemberState, { icon: string; label: string }> = {
  complete: { icon: "✅", label: "완료" },
  presolved: { icon: "●", label: "선풀이" },
  "in-progress": { icon: "🟡", label: "진행 중" },
  postponed: { icon: "⏭", label: "미루기" },
  missed: { icon: "❌", label: "미제출" },
  upcoming: { icon: "·", label: "예정" },
  inactive: { icon: "", label: "참여 전" },
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

async function accessToken() {
  const { data } = await browserSupabase().auth.getSession();
  return data.session?.access_token;
}

function formatMonth(month: string) {
  const [year, value] = month.split("-");
  return `${year}년 ${Number(value)}월`;
}

function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatDateHeading(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "long", timeZone: "UTC" }).format(parsed);
  const [, month, day] = date.split("-");
  return `${Number(month)}월 ${Number(day)}일 ${weekday}`;
}

function formatTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDeadline(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function calendarSlots(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const firstWeekday = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const slots: Array<{ date: string; currentMonth: boolean }> = [];
  for (let i = 0; i < 42; i += 1) {
    const dayNumber = i - firstWeekday + 1;
    const date = new Date(Date.UTC(year, monthNumber - 1, dayNumber));
    slots.push({
      date: date.toISOString().slice(0, 10),
      currentMonth: dayNumber >= 1 && dayNumber <= daysInMonth,
    });
  }
  return slots;
}

function cloneRules(study: Study): RulesDraft {
  return {
    ruleConfig: {
      ...study.rules,
      penalties: { ...study.rules.penalties },
    },
    postponeDeadlineHour: study.postponeDeadlineHour,
    postponeDeadlineMinute: study.postponeDeadlineMinute,
    maxConsecutivePostpone: study.maxConsecutivePostpone,
    maxPresolveDays: study.maxPresolveDays,
  };
}

function NumberField({ label, value, disabled, min = 0, max = 20, suffix, onChange }: {
  label: string;
  value: number;
  disabled: boolean;
  min?: number;
  max?: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return <label className="rule-field">
    <span>{label}</span>
    <div><input type="number" min={min} max={max} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} /><em>{suffix}</em></div>
  </label>;
}

export function Dashboard({ githubAppSlug }: { githubAppSlug: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [month, setMonth] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [rulesDraft, setRulesDraft] = useState<RulesDraft | null>(null);
  const [toast, setToast] = useState("");

  async function reload(targetMonth?: string) {
    const access = await accessToken();
    if (!access) {
      window.location.replace("/");
      return;
    }
    const query = targetMonth ? `?month=${encodeURIComponent(targetMonth)}` : "";
    const response = await fetch(`/api/dashboard${query}`, { headers: { Authorization: `Bearer ${access}` } });
    const payload = await response.json() as DashboardData & { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "조회 실패");
      return;
    }
    setError("");
    setData(payload);
    setMonth(payload.month);
    if (!selectedDate || !selectedDate.startsWith(payload.month)) {
      setSelectedDate(payload.studyDate.startsWith(payload.month) ? payload.studyDate : `${payload.month}-01`);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function initialLoad() {
      const access = await accessToken();
      if (!access) {
        window.location.replace("/");
        return;
      }
      const response = await fetch("/api/dashboard", { headers: { Authorization: `Bearer ${access}` } });
      const payload = await response.json() as DashboardData & { error?: string };
      if (cancelled) return;
      if (!response.ok) {
        setError(payload.error ?? "조회 실패");
        return;
      }
      setData(payload);
      setMonth(payload.month);
      setSelectedDate(payload.studyDate.startsWith(payload.month) ? payload.studyDate : `${payload.month}-01`);
    }
    void initialLoad();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDetailOpen(false);
        setSettingsOpen(false);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
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

  function openSettings() {
    if (data?.study) setRulesDraft(cloneRules(data.study));
    setSettingsOpen(true);
  }

  function connect() {
    if (!data?.study) return;
    if (!githubAppSlug) {
      setToast("GitHub App 설정이 아직 연결되지 않았습니다.");
      return;
    }
    localStorage.setItem("hamster-study-id", data.study.id);
    window.location.href = `https://github.com/apps/${githubAppSlug}/installations/new`;
  }

  async function postpone() {
    if (!data?.study || selectedDate !== data.studyDate) return;
    setBusy("postpone");
    const access = await accessToken();
    const response = await fetch("/api/postponements", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ studyId: data.study.id }),
    });
    const payload = await response.json() as { error?: string; duplicate?: boolean };
    setBusy("");
    if (!response.ok) setToast(payload.error ?? "미루기 신청에 실패했습니다.");
    else {
      setToast(payload.duplicate ? "이미 오늘 미루기를 신청했습니다." : "오늘 미루기를 적용했습니다.");
      await reload(month);
    }
  }

  async function backfill(repo: Repo) {
    setBusy(repo.id);
    const access = await accessToken();
    const response = await fetch("/api/repositories/backfill", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: repo.id }),
    });
    const payload = await response.json() as { error?: string; inserted?: number };
    setBusy("");
    if (!response.ok) setToast(payload.error ?? "과거 기록을 가져오지 못했습니다.");
    else {
      setToast(`${payload.inserted ?? 0}개 풀이를 가져왔습니다.`);
      await reload(month);
    }
  }

  async function saveRules() {
    if (!data?.study || !rulesDraft || data.study.role !== "admin") return;
    setBusy("rules");
    const access = await accessToken();
    const response = await fetch("/api/studies/settings", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        studyId: data.study.id,
        ...rulesDraft,
      }),
    });
    const payload = await response.json() as { error?: string };
    setBusy("");
    if (!response.ok) {
      setToast(payload.error ?? "규칙을 저장하지 못했습니다.");
      return;
    }
    setToast("인증 규칙을 저장했습니다.");
    await reload(month);
  }

  async function copyInvite() {
    if (!data?.study) return;
    const invite = `${window.location.origin}/join/${data.study.inviteCode}`;
    await navigator.clipboard.writeText(invite);
    setToast("초대 링크를 복사했습니다.");
  }

  async function moveMonth(delta: number) {
    const next = shiftMonth(month, delta);
    setDetailOpen(false);
    await reload(next);
  }

  async function goToday() {
    if (!data) return;
    const todayMonth = data.studyDate.slice(0, 7);
    await reload(todayMonth);
    setSelectedDate(data.studyDate);
    setDetailOpen(true);
  }

  async function openDate(date: string, currentMonth: boolean) {
    if (!currentMonth) await reload(date.slice(0, 7));
    setSelectedDate(date);
    setDetailOpen(true);
  }

  const dayByDate = useMemo(() => new Map((data?.days ?? []).map((day) => [day.date, day])), [data]);
  const slots = useMemo(() => (month ? calendarSlots(month) : []), [month]);
  const selectedDay = selectedDate ? dayByDate.get(selectedDate) : undefined;
  const mySelectedState = selectedDay?.members.find((member) => member.userId === data?.currentUserId);

  if (error) return <main className="app-shell"><div className="empty-state"><strong>대시보드를 불러오지 못했습니다.</strong><p>{error}</p><button className="secondary-button" onClick={() => void reload(month)}>다시 시도</button></div></main>;
  if (!data) return <main className="app-shell"><div className="loading-state">햄쮸터를 불러오는 중…</div></main>;
  if (!data.study) return <main className="app-shell"><section className="onboarding"><span className="eyebrow">HAMJJUTER</span><h1>첫 알고리즘 스터디를<br />만들어보세요.</h1><p>GitHub에 올라온 풀이 기록으로 인증을 자동화합니다.</p><button className="primary-button" onClick={createStudy}>스터디 만들기</button></section></main>;

  const study = data.study;
  const editableRules = rulesDraft ?? cloneRules(study);
  const canEditRules = study.role === "admin";

  return <main className="app-shell">
    <header className="app-header">
      <div className="brand-block">
        <div className="brand-mark" aria-hidden="true">🐹</div>
        <div><p className="eyebrow">HAMJJUTER</p><h1>{study.name}</h1></div>
      </div>
      <button className="icon-button" onClick={openSettings} aria-label="스터디 설정 열기" title="스터디 설정">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.36.7.64.98.28.28.63.49 1.01.6H21v4h-.1A1.7 1.7 0 0 0 19.4 15Z"/></svg>
      </button>
    </header>

    <section className="calendar-toolbar" aria-label="캘린더 탐색">
      <div className="month-navigation">
        <button className="nav-button" onClick={() => void moveMonth(-1)} aria-label="이전 달">‹</button>
        <h2>{formatMonth(month)}</h2>
        <button className="nav-button" onClick={() => void moveMonth(1)} aria-label="다음 달">›</button>
        <button className="today-button" onClick={() => void goToday()}>오늘</button>
      </div>
      <div className="summary-strip" aria-label="이번 달 요약">
        <span><strong>{data.members.length}</strong>명</span>
        <span><strong>{data.summary.complete}</strong> 완료</span>
        <span><strong>{data.summary.postponed}</strong> 미루기</span>
        <span><strong>{data.summary.missed}</strong> 미제출</span>
      </div>
    </section>

    <section className="calendar-card" aria-label={`${formatMonth(month)} 인증 캘린더`}>
      <div className="weekday-row" aria-hidden="true">{WEEKDAYS.map((day) => <div key={day}>{day}</div>)}</div>
      <div className="calendar-grid">
        {slots.map((slot) => {
          const day = dayByDate.get(slot.date);
          const isToday = slot.date === data.studyDate;
          const isSelected = slot.date === selectedDate;
          const dayNumber = Number(slot.date.slice(-2));
          return <button
            key={slot.date}
            className={`calendar-day${slot.currentMonth ? "" : " is-adjacent"}${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}`}
            onClick={() => void openDate(slot.date, slot.currentMonth)}
            aria-pressed={isSelected}
            aria-label={`${slot.date} 인증 상세`}
          >
            <div className="day-heading"><span>{dayNumber}</span>{isToday && <em>오늘</em>}</div>
            <div className="day-members">
              {(day?.members ?? []).filter((member) => member.state !== "inactive").map((member) => {
                const meta = STATE_META[member.state];
                return <div key={member.userId} className={`member-chip state-${member.state}`} title={`${member.name} · ${meta.label}`}>
                  <span className="member-name">{member.name}</span><span className="member-state" aria-label={meta.label}>{meta.icon}</span>
                </div>;
              })}
            </div>
          </button>;
        })}
      </div>
    </section>

    <p className="calendar-footnote">인증일은 Asia/Seoul 기준 오전 4시에 바뀝니다. 날짜를 누르면 풀이와 인정량을 확인할 수 있습니다.</p>

    {detailOpen && <div className="sheet-layer" onMouseDown={(event) => { if (event.currentTarget === event.target) setDetailOpen(false); }}>
      <aside className="side-sheet" role="dialog" aria-modal="true" aria-label="날짜별 인증 상세">
        <div className="sheet-header">
          <div><p className="eyebrow">DAILY DETAIL</p><h2>{formatDateHeading(selectedDate)}</h2><p>04:00 ~ 다음 날 03:59</p></div>
          <button className="close-button" onClick={() => setDetailOpen(false)} aria-label="상세 닫기">×</button>
        </div>
        <div className="detail-members">
          {(selectedDay?.members ?? []).filter((member) => member.state !== "inactive").map((member) => {
            const meta = STATE_META[member.state];
            return <section className="detail-member" key={member.userId}>
              <div className="detail-member-heading"><div><strong>{member.name}</strong>{member.userId === data.currentUserId && <span className="me-badge">나</span>}</div><span className={`state-label state-${member.state}`}>{meta.icon} {meta.label}</span></div>
              {member.submissions.length > 0 ? <div className="submission-list">{member.submissions.map((submission, index) => <div className="submission-row" key={`${submission.problemId}-${submission.solvedAt}-${index}`}>
                <div><strong>{submission.title}</strong><span>{submission.platform} {submission.problemId} · {submission.difficulty} · {formatTime(submission.solvedAt)}</span></div><b>+{submission.credit.toFixed(2)}</b>
              </div>)}</div> : <p className="empty-copy">이 날짜에 직접 기록된 풀이가 없습니다.</p>}
              <div className="credit-row"><span>직접 풀이 인정량</span><strong>{member.directCredits.toFixed(2)} / 1.00</strong></div>
              {member.state === "presolved" && <p className="presolve-note">이전 풀이의 남은 인정량으로 미리 인증된 날짜입니다.</p>}
              {member.postponedAt && <p className="postpone-note">{formatTime(member.postponedAt)} 미루기 신청</p>}
              {member.penalty > 0 && <div className="penalty-row"><span>미제출 벌금</span><strong>{member.penalty.toLocaleString()}원</strong></div>}
            </section>;
          })}
          {!selectedDay && <div className="empty-copy">이 달의 상세 데이터를 불러오지 못했습니다.</div>}
        </div>
        {selectedDate === data.studyDate && mySelectedState?.state !== "postponed" && <div className="sheet-actions">
          <button className="primary-button full" onClick={() => void postpone()} disabled={busy === "postpone"}>{busy === "postpone" ? "처리 중…" : "오늘 미루기"}</button>
          <p>미루기는 당일 {formatDeadline(study.postponeDeadlineHour, study.postponeDeadlineMinute)}까지, 연속 최대 {study.maxConsecutivePostpone}회 사용할 수 있습니다.</p>
        </div>}
      </aside>
    </div>}

    {settingsOpen && <div className="sheet-layer" onMouseDown={(event) => { if (event.currentTarget === event.target) setSettingsOpen(false); }}>
      <aside className="side-sheet settings-sheet" role="dialog" aria-modal="true" aria-label="스터디 설정">
        <div className="sheet-header"><div><p className="eyebrow">STUDY SETTINGS</p><h2>스터디 설정</h2><p>Repository, 초대 링크, 인증 규칙을 관리합니다.</p></div><button className="close-button" onClick={() => setSettingsOpen(false)} aria-label="설정 닫기">×</button></div>
        <section className="settings-section">
          <div className="section-title"><div><h3>GitHub Repository</h3><p>BaekjoonHub가 push하는 알고리즘 저장소를 연결합니다.</p></div><button className="secondary-button" onClick={connect}>Repository 연결</button></div>
          <div className="repository-list">{data.repositories.length ? data.repositories.map((repo) => <div className="repository-row" key={repo.id}><div><strong>{repo.fullName}</strong><span>자동 인증 연결됨</span></div><button className="text-button" onClick={() => void backfill(repo)} disabled={busy === repo.id}>{busy === repo.id ? "가져오는 중…" : "과거 기록 가져오기"}</button></div>) : <div className="settings-empty">아직 연결된 Repository가 없습니다.</div>}</div>
        </section>
        <section className="settings-section">
          <div className="section-title"><div><h3>스터디 초대</h3><p>같이 인증할 사람에게 초대 링크를 공유하세요.</p></div></div>
          <button className="copy-button" onClick={() => void copyInvite()}><span>{`/join/${study.inviteCode}`}</span><strong>링크 복사</strong></button>
        </section>
        <section className="settings-section rule-editor">
          <div className="section-title"><div><h3>인증 규칙</h3><p>{canEditRules ? "변경하면 이후 캘린더 판정에 즉시 반영됩니다." : "관리자만 규칙을 변경할 수 있습니다."}</p></div><span className="fixed-cutoff">Study Day 04:00 고정</span></div>
          <div className="rule-group"><h4>Baekjoon</h4><div className="rule-grid">
            <NumberField label="Bronze II~I" value={editableRules.ruleConfig.bojBronzeCount} disabled={!canEditRules} min={1} suffix="문제" onChange={(value) => setRulesDraft({ ...editableRules, ruleConfig: { ...editableRules.ruleConfig, bojBronzeCount: value } })} />
            <NumberField label="Silver V~I" value={editableRules.ruleConfig.bojSilverCount} disabled={!canEditRules} min={1} suffix="문제" onChange={(value) => setRulesDraft({ ...editableRules, ruleConfig: { ...editableRules.ruleConfig, bojSilverCount: value } })} />
            <NumberField label="Gold 이상" value={editableRules.ruleConfig.bojGoldCount} disabled={!canEditRules} min={1} suffix="문제" onChange={(value) => setRulesDraft({ ...editableRules, ruleConfig: { ...editableRules.ruleConfig, bojGoldCount: value } })} />
          </div></div>
          <div className="rule-group"><h4>기타 플랫폼</h4><div className="rule-grid">
            <NumberField label="Programmers Lv.0~1" value={editableRules.ruleConfig.programmersLowCount} disabled={!canEditRules} min={1} suffix="문제" onChange={(value) => setRulesDraft({ ...editableRules, ruleConfig: { ...editableRules.ruleConfig, programmersLowCount: value } })} />
            <NumberField label="Programmers Lv.2+" value={editableRules.ruleConfig.programmersHighCount} disabled={!canEditRules} min={1} suffix="문제" onChange={(value) => setRulesDraft({ ...editableRules, ruleConfig: { ...editableRules.ruleConfig, programmersHighCount: value } })} />
            <NumberField label="SWEA D2~D3" value={editableRules.ruleConfig.sweaLowCount} disabled={!canEditRules} min={1} suffix="문제" onChange={(value) => setRulesDraft({ ...editableRules, ruleConfig: { ...editableRules.ruleConfig, sweaLowCount: value } })} />
            <NumberField label="SWEA D4+" value={editableRules.ruleConfig.sweaHighCount} disabled={!canEditRules} min={1} suffix="문제" onChange={(value) => setRulesDraft({ ...editableRules, ruleConfig: { ...editableRules.ruleConfig, sweaHighCount: value } })} />
            <NumberField label="CodeTree 삼성 기출" value={editableRules.ruleConfig.codetreeSamsungCount} disabled={!canEditRules} min={1} suffix="문제" onChange={(value) => setRulesDraft({ ...editableRules, ruleConfig: { ...editableRules.ruleConfig, codetreeSamsungCount: value } })} />
          </div></div>
          <div className="rule-group"><h4>미루기 · 선풀이</h4><div className="rule-grid">
            <NumberField label="미루기 마감 시" value={editableRules.postponeDeadlineHour} disabled={!canEditRules} min={0} max={23} suffix="시" onChange={(value) => setRulesDraft({ ...editableRules, postponeDeadlineHour: value })} />
            <NumberField label="미루기 마감 분" value={editableRules.postponeDeadlineMinute} disabled={!canEditRules} min={0} max={59} suffix="분" onChange={(value) => setRulesDraft({ ...editableRules, postponeDeadlineMinute: value })} />
            <NumberField label="연속 미루기" value={editableRules.maxConsecutivePostpone} disabled={!canEditRules} min={0} max={7} suffix="회" onChange={(value) => setRulesDraft({ ...editableRules, maxConsecutivePostpone: value })} />
            <NumberField label="미리 풀기" value={editableRules.maxPresolveDays} disabled={!canEditRules} min={0} max={14} suffix="일" onChange={(value) => setRulesDraft({ ...editableRules, maxPresolveDays: value })} />
          </div></div>
          <div className="rule-group"><h4>미제출 벌금</h4><div className="rule-grid">
            <NumberField label="1일 연속" value={editableRules.ruleConfig.penalties[1]} disabled={!canEditRules} max={1000000} suffix="원" onChange={(value) => setRulesDraft({ ...editableRules, ruleConfig: { ...editableRules.ruleConfig, penalties: { ...editableRules.ruleConfig.penalties, 1: value } } })} />
            <NumberField label="2일 연속" value={editableRules.ruleConfig.penalties[2]} disabled={!canEditRules} max={1000000} suffix="원" onChange={(value) => setRulesDraft({ ...editableRules, ruleConfig: { ...editableRules.ruleConfig, penalties: { ...editableRules.ruleConfig.penalties, 2: value } } })} />
            <NumberField label="3일 연속" value={editableRules.ruleConfig.penalties[3]} disabled={!canEditRules} max={1000000} suffix="원" onChange={(value) => setRulesDraft({ ...editableRules, ruleConfig: { ...editableRules.ruleConfig, penalties: { ...editableRules.ruleConfig.penalties, 3: value } } })} />
          </div></div>
          {canEditRules && <button className="primary-button full rules-save" onClick={() => void saveRules()} disabled={busy === "rules"}>{busy === "rules" ? "저장 중…" : "인증 규칙 저장"}</button>}
          <p className="rule-warning">규칙 변경은 현재 판정부터 적용됩니다. 이미 확정된 과거 벌금 기록은 자동으로 다시 계산하지 않습니다.</p>
        </section>
      </aside>
    </div>}

    {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
  </main>;
}
