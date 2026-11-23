"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppBrand } from "./app-brand";
import { addStudyDays, studyDateFromTimestamp } from "@/lib/study-day";
import "./calendar.css";
import { browserSupabase } from "@/lib/supabase-browser";
import { GrowthStatsSection } from "./growth-stats-section";
import { PostponementControl } from "./postponement-control";
import { useCalendarData } from "./use-calendar-data";
import type { PostponementStatus } from "@/lib/postponement-status";

import { invalidateViews, peekView, putView } from "@/lib/view-cache";
import { summarizeCalendar, type MemberState, type CalendarDay } from "@/lib/calendar-snapshot";
import { refreshMemberCalendars } from "@/lib/member-calendar-refresh";
import type { DayGoals, DayGoalEntry } from "@/lib/day-goals";
import { useStudyPanel } from "./use-study-panel";
import { StudySettingsSheet } from "./study-settings-sheet";
import type { SettingsStudy } from "./study-rule-editor";
import { EnglishDayPanel } from "./english-day-panel";
import { GOAL_LABELS } from "@/lib/rules";

type Submission={platform:string;problemId:string;title:string;difficulty:string;credit:number;solvedAt:string;source:string};
type Study = SettingsStudy;
type MemberStat={userId:string;name:string;complete:number;missed:number;postponed:number;totalPenalty:number;completionRate:number;streak:number};
type Penalty = { user_id:string; study_date:string; amount:number };
type DayPanel = { algorithm:boolean; goals:DayGoals; submissions:Array<Submission & {userId:string}>; penalties:Penalty[] };
type DashboardData={study:Study|null;members:Array<{userId:string;name:string}>;days:CalendarDay[];summary:{complete:number;postponed:number;missed:number;inProgress:number};currentUserId:string;studyDate:string;month:string;todayPostponement?:PostponementStatus|null};
type InstallPromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:"accepted"|"dismissed"}>};
type ManualPlatform="BOJ"|"PROGRAMMERS"|"SWEA"|"CODETREE";

type DifficultyOption={label:string;value:string};
const MANUAL_DIFFICULTIES:Record<ManualPlatform,DifficultyOption[]>={
  BOJ:[{label:"Bronze II~I",value:"Bronze I"},{label:"Silver V~I",value:"Silver III"},{label:"Gold 이상",value:"Gold V"}],
  PROGRAMMERS:[{label:"Lv.0~1",value:"Level 1"},{label:"Lv.2 이상",value:"Level 2"}],
  SWEA:[{label:"D2~D3",value:"D3"},{label:"D4 이상",value:"D4"}],
  CODETREE:[{label:"삼성 기출",value:"SAMSUNG"}],
};
const PLATFORM_LABEL:Record<ManualPlatform,string>={BOJ:"Baekjoon",PROGRAMMERS:"Programmers",SWEA:"SWEA",CODETREE:"CodeTree"};
const STATE_META: Record<MemberState, { icon: string; label: string }> = {
  complete: { icon: "✓", label: "완료" },
  presolved: { icon: "↗", label: "미리 인증" },
  "in-progress": { icon: "◐", label: "진행 중" },
  postponed: { icon: "→", label: "미루기" },
  missed: { icon: "−", label: "미제출" },
  upcoming: { icon: "·", label: "예정" },
  inactive: { icon: "", label: "참여 전" },
};
const WEEKDAYS=["일","월","화","수","목","금","토"];

async function accessToken(){const{data}=await browserSupabase().auth.getSession();return data.session?.access_token ?? null;}
function formatMonth(month:string){const[y,m]=month.split("-");return`${y}년 ${Number(m)}월`;}
function shiftMonth(month:string,delta:number){const[y,m]=month.split("-").map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));return`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;}
const weekdayFormatter = new Intl.DateTimeFormat("ko-KR", { weekday: "long", timeZone: "UTC" });
function formatDateHeading(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${month}월 ${day}일 ${weekdayFormatter.format(new Date(`${date}T00:00:00Z`))}`;
}
function formatTime(value:string|null){if(!value)return"";return new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));}
function calendarSlots(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstWeekday + 1;
    const date = new Date(Date.UTC(year, monthNumber - 1, day)).toISOString().slice(0, 10);
    return { date, weekday: WEEKDAYS[index % 7], currentMonth: day >= 1 && day <= daysInMonth };
  });
}

function DaySheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const sheet = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = sheet.current;
    if (!dialog) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  return <dialog ref={sheet} className="ham-day-sheet" aria-labelledby="ham-day-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    {children}
  </dialog>;
}

function PeriodArrows({ label, onMove }: { label: string; onMove: (delta: number) => void }) {
  return <div className="period-arrows">
    <button type="button" aria-label={`이전 ${label}`} onClick={() => onMove(-1)}>‹</button>
    <button type="button" aria-label={`다음 ${label}`} onClick={() => onMove(1)}>›</button>
  </div>;
}

function CalendarDate({ slot, day, viewerId, today, selected, week, onOpen }: {
  slot: ReturnType<typeof calendarSlots>[number]; day?: CalendarDay; viewerId: string;
  today: boolean; selected: boolean; week: boolean; onOpen: () => void;
}) {
  const members = day?.members.filter(member => member.state !== "inactive") ?? [];
  const visibleMembers = week ? members : members.slice(0, 3);
  const mine = members.find(member => member.userId === viewerId);
  const done = members.filter(member => member.state === "complete" || member.state === "presolved").length;
  const hasActivity = members.some(member => member.state !== "upcoming");
  const title = [formatDateHeading(slot.date), today && "오늘", mine && `내 인증 ${STATE_META[mine.state].label}`,
    members.length > 0 && `멤버 ${members.length}명 중 ${done}명 완료`].filter(Boolean).join(", ");

  return <button type="button" className={`calendar-day${slot.currentMonth ? "" : " is-adjacent"}${today ? " is-today" : ""}${selected ? " is-selected" : ""}`}
    aria-pressed={selected} aria-current={today ? "date" : undefined} aria-label={title} onClick={onOpen}>
    <span className="day-heading"><span className="day-number">{Number(slot.date.slice(-2))}</span>
      <span className="week-day-name">{!slot.currentMonth && `${Number(slot.date.slice(5,7))}월 · `}{slot.weekday}요일</span>{today && <em>오늘</em>}</span>
    <span className="day-members">{week && !slot.currentMonth && <span className="other-members">이 날짜 기록 보기</span>}
      {visibleMembers.map(member => <span key={member.userId}
      className={`calendar-member state-${member.state}`} title={`${member.name} · ${STATE_META[member.state].label}`}>
      <span className="calendar-member-icon" aria-hidden="true">{STATE_META[member.state].icon}</span>
      <span className="calendar-member-name">{member.name}</span>
      <span className="calendar-member-label">{STATE_META[member.state].label}</span>
    </span>)}
      {members.length > visibleMembers.length && <span className="other-members">외 {members.length - visibleMembers.length}명</span>}
    </span>
    <span className="day-compact">
      {mine && mine.state !== "upcoming" && <span className={`compact-state state-${mine.state}`}>{STATE_META[mine.state].label}</span>}
      {hasActivity && <span className="day-completions">{done}/{members.length}명</span>}
    </span>
  </button>;
}
function memberStatistics(data: DashboardData, penalties: Penalty[]): MemberStat[] {
  return data.members.map(({userId,name}) => {
    const states = data.days.filter(day => day.date <= data.studyDate).map(day => day.members.find(m => m.userId === userId)?.state);
    const complete = states.filter(s => s === "complete" || s === "presolved").length;
    const postponed = states.filter(s => s === "postponed").length;
    const missed = states.filter(s => s === "missed").length;
    const required = complete + missed + states.filter(s => s === "in-progress").length;
    let streak = 0;
    for (const state of states.reverse()) {
      if (state === "postponed") continue;
      if (state !== "complete" && state !== "presolved") break;
      streak++;
    }
    return { userId, name, complete, missed, postponed, streak, completionRate: required ? Math.round(complete * 100 / required) : 0,
      totalPenalty: penalties.filter(row => row.user_id === userId).reduce((sum,row) => sum + row.amount, 0) };
  });
}

export function Dashboard({githubAppSlug}:{githubAppSlug:string}){
  const calendar=useCalendarData<DashboardData>();
  const{data,error,warning,refreshing,month,selectedDate,setSelectedDate,navigate,clear}=calendar;
  const[busy,setBusy]=useState("");
  const[settingsOpen,setSettingsOpen]=useState(false);const[detailOpen,setDetailOpen]=useState(false);const[toast,setToast]=useState("");
  const viewer = data?.currentUserId ?? "";
  const studyKey = data?.study ? `calendar-layout:${data.study.id}` : "";
  type Layout = { tab: "calendar" | "stats"; mode: "month" | "week"; growthUserId: string };
  const [visibleLayout, setVisibleLayout] = useState<{ key: string; viewer: string; value: Layout } | null>(null);
  const layout: Layout = visibleLayout?.key === studyKey && visibleLayout.viewer === viewer ? visibleLayout.value
    : peekView<Layout>(viewer, studyKey) ?? { tab: "calendar", mode: "month", growthUserId: "" };
  const { tab, mode: calendarMode, growthUserId } = layout;
  function setLayout(change: Partial<Layout>) {
    const value = { ...layout, ...change };
    putView(viewer, studyKey, value);
    setVisibleLayout({ key: studyKey, viewer, value });
  }
  const setGrowthUserId = (id: string) => setLayout({ growthUserId: id });
  const setCalendarMode = (mode: Layout["mode"]) => setLayout({ mode });
  const setTab = (next: Layout["tab"]) => setLayout({ tab: next });
  const[installPrompt,setInstallPrompt]=useState<InstallPromptEvent|null>(null);const[showInstall,setShowInstall]=useState(false);const[iosInstall,setIosInstall]=useState(false);
  const[manualOpen,setManualOpen]=useState(false);const[manualPlatform,setManualPlatform]=useState<ManualPlatform>("BOJ");const[manualDifficulty,setManualDifficulty]=useState(MANUAL_DIFFICULTIES.BOJ[1].value);const[manualCount,setManualCount]=useState(1);

  async function reload(targetMonth?: string) {
    if (data?.study) {
      const id = data.study.id;
      const keys = [];
      if (detailOpen) keys.push(`day:${id}:${selectedDate}`);
      if (tab === "stats") keys.push(`penalty:${id}:${month}`, `growth:${id}:${growthUserId || data.currentUserId}:${month}`);
      invalidateViews(data.currentUserId, keys);
    }
    await calendar.reload(targetMonth);
  }
  function switchTab(next:"calendar"|"stats"){setTab(next);void navigate(month)}
  useEffect(()=>{if(!toast)return;const id=window.setTimeout(()=>setToast(""),2800);return()=>window.clearTimeout(id)},[toast]);
  useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==="Escape"){setDetailOpen(false);setSettingsOpen(false);setManualOpen(false)}};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[]);
  useEffect(()=>{const standalone=window.matchMedia("(display-mode: standalone)").matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);if(standalone||localStorage.getItem("hamster-install-dismissed")==="1")return;const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);const timer=window.setTimeout(()=>{setIosInstall(ios);if(ios)setShowInstall(true)},0);const handler=(event:Event)=>{event.preventDefault();setInstallPrompt(event as InstallPromptEvent);setShowInstall(true)};window.addEventListener("beforeinstallprompt",handler);return()=>{window.clearTimeout(timer);window.removeEventListener("beforeinstallprompt",handler)}},[]);

  function openSettings(){setSettingsOpen(true)}
  async function addManualSubmission() {
    if (!data?.study || selectedDate > data.studyDate) return;
    const studyId = data.study.id;
    setBusy("manual");
    try {
      const access = await accessToken();
      const response = await fetch("/api/submissions/manual", {
        method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ studyId, studyDate: selectedDate, platform: manualPlatform, difficulty: manualDifficulty, count: manualCount }),
      });
      const result = await response.json() as { error?: string; inserted?: number };
      if (!response.ok) throw Error(result.error ?? "수동 인증을 등록하지 못했습니다.");
      const solveMonth = selectedDate.slice(0, 7);
      invalidateViews(data.currentUserId, [
        `day:${studyId}:${selectedDate}`,
        ...[0, 1, 2].map(offset => `growth:${studyId}:${data.currentUserId}:${shiftMonth(solveMonth, offset)}`),
      ]);
      refreshMemberCalendars(data.currentUserId, studyId, data.currentUserId);
      setToast(`${result.inserted ?? manualCount}문제를 수동 인증으로 등록했습니다.`);
      setManualOpen(false);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "수동 인증을 등록하지 못했습니다.");
    } finally { setBusy(""); }
  }
  async function logout(){
    await browserSupabase().auth.signOut();
    clear();window.location.replace("/");
  }
  async function moveMonth(delta:number){const next=shiftMonth(month,delta);setDetailOpen(false);setManualOpen(false);await navigate(next)}
  async function moveCalendar(delta: number) {
    if (calendarMode !== "week" || !selectedDate) return moveMonth(delta);
    const date = addStudyDays(selectedDate, delta * 7);
    const targetMonth = date.slice(0, 7);
    if (targetMonth !== month && !(await navigate(targetMonth))) return;
    setSelectedDate(date);
  }
  async function goToday(){const today = studyDateFromTimestamp(new Date().toISOString());const latest=await navigate(today.slice(0,7));if(!latest)return;setSelectedDate(latest.studyDate);setDetailOpen(true);setManualOpen(false)}
  async function openDate(date:string,currentMonth:boolean){if(!currentMonth){const next=await navigate(date.slice(0,7));if(!next)return;}setSelectedDate(date);setDetailOpen(true);setManualOpen(false)}
  async function installApp(){if(installPrompt){await installPrompt.prompt();const choice=await installPrompt.userChoice;if(choice.outcome==="accepted")setShowInstall(false)}else if(iosInstall)setToast("Safari 공유 버튼 → 홈 화면에 추가 → 웹 앱으로 열기를 선택하세요.")}
  function dismissInstall(){localStorage.setItem("hamster-install-dismissed","1");setShowInstall(false)}
  function changeManualPlatform(platform:ManualPlatform){setManualPlatform(platform);setManualDifficulty(MANUAL_DIFFICULTIES[platform][0].value)}

  const dayByDate=useMemo(()=>new Map((data?.days??[]).map(d=>[d.date,d])),[data]);const slots=useMemo(()=>(month?calendarSlots(month):[]),[month]);
  const visibleSlots=useMemo(()=>{if(calendarMode==="month"||!selectedDate)return slots;const i=slots.findIndex(s=>s.date===selectedDate);const start=i<0?0:Math.floor(i/7)*7;return slots.slice(start,start+7)},[calendarMode,selectedDate,slots]);
  const selectedDay=selectedDate?dayByDate.get(selectedDate):undefined;

  const viewerId = data?.currentUserId ?? "";
  const studyId = data?.study?.id;
  const panelBase = studyId ? "/api/dashboard/panel?studyId=" + encodeURIComponent(studyId) : null;
  const dayKey = detailOpen && studyId && selectedDate ? `day:${studyId}:${selectedDate}` : null;
  const detail = useStudyPanel<DayPanel>(viewerId, dayKey, dayKey ? panelBase + "&view=day&date=" + selectedDate : null);
  const penaltyKey = tab === "stats" && studyId ? `penalty:${studyId}:${month}` : null;
  const stats = useStudyPanel<{penalties:Penalty[]}>(viewerId, penaltyKey, penaltyKey ? panelBase + "&view=statistics&month=" + month : null);
  const penalties = stats?.data?.penalties;
  const statistics = useMemo(() => data && penalties ? memberStatistics(data, penalties) : [], [data, penalties]);

  function confirmGoal(entry: DayGoalEntry | null) {
    if (!dayKey || !studyId) return;
    const current = peekView<DayPanel>(viewerId, dayKey);
    if (entry && current && detail) {
      const {goals} = current;
      detail.replace({ ...current, goals: { ...goals, entries: [...goals.entries.filter(row => row.id !== entry.id), entry] } });
    } else {
      invalidateViews(viewerId, [dayKey]);
    }
    refreshMemberCalendars(viewerId, studyId, viewerId);
  }
  function confirmPostponement(status: PostponementStatus, requestedAt: string) {
    calendar.updateConfirmed(current => {
      if (current.studyDate !== status.studyDate || current.study?.id !== data?.study?.id) return current;
      const days = current.days.map(day => day.date !== status.studyDate ? day : {
        ...day, members: day.members.map(member => member.userId === current.currentUserId && member.state !== "complete" ? {
          ...member, state: "postponed" as const, postponedAt: member.postponedAt ?? requestedAt,
        } : member),
      });
      return { ...current, todayPostponement: status, days, summary: summarizeCalendar(days) };
    });
    if (studyId) refreshMemberCalendars(viewerId, studyId, viewerId);
  }

  if(error)return<main className="app-shell"><div className="empty-state"><strong>대시보드를 불러오지 못했습니다.</strong><p>{error}</p><Link href="/studies">스터디 선택</Link><button className="secondary-button" onClick={()=>void reload(month)}>다시 시도</button></div></main>;
  if(!data?.study)return<main className="app-shell"><div className="loading-state">햄쮸터를 불러오는 중…</div></main>;
  const study=data.study;
  const calendarView = <>
    <section className="calendar-toolbar" aria-label="달력 탐색">
      <div className="month-navigation">
        <h2>{formatMonth(month)}</h2>
        <PeriodArrows label={calendarMode === "week" ? "주" : "달"} onMove={delta => void moveCalendar(delta)} />
      </div>
      <div className="calendar-controls">
        <button type="button" className="calendar-today" onClick={() => void goToday()}>오늘</button>
        <div className="view-toggle" role="group" aria-label="달력 보기">
          {(["month", "week"] as const).map(mode => <button key={mode} type="button"
            aria-pressed={calendarMode === mode} onClick={() => setCalendarMode(mode)}>{mode === "month" ? "월" : "주"}</button>)}
        </div>
      </div>
    </section>
    <section className={`calendar-card mode-${calendarMode}`} aria-label={`${formatMonth(month)} 인증 달력`} aria-busy={refreshing}>
      <div className="weekday-row" aria-hidden="true">{WEEKDAYS.map(day => <div key={day}>{day}</div>)}</div>
      <div className="calendar-grid">{visibleSlots.map(slot => <CalendarDate key={slot.date} slot={slot}
        day={dayByDate.get(slot.date)} viewerId={data.currentUserId} today={slot.date === data.studyDate}
        selected={slot.date === selectedDate} week={calendarMode === "week"} onOpen={() => void openDate(slot.date, slot.currentMonth)} />)}</div>
    </section>
    <div className="calendar-caption">
      <p className="calendar-cutoff">인증일은 한국시간 오전 4시에 바뀌어요.</p>
      {calendarMode === "month" && <p className="mobile-day-key">내 인증 상태 · 완료 인원/참여 인원</p>}
      <dl className="calendar-summary" aria-label="이달의 스터디 인증 집계">
        <div><dt>완료</dt><dd>{data.summary.complete}</dd></div>
        <div><dt>미루기</dt><dd>{data.summary.postponed}</dd></div>
        <div><dt>미제출</dt><dd>{data.summary.missed}</dd></div>
      </dl>
    </div>
  </>;
  const selectedGrowthUserId=data.members.some(member=>member.userId===growthUserId)?growthUserId:data.currentUserId;
  const statsView=<section className="stats-panel"><div className="stats-heading"><div><h2>{formatMonth(month)} 통계</h2></div><PeriodArrows label="달" onMove={delta => void moveMonth(delta)} /></div><p className="stats-status" role="status">{stats?.error || (!stats?.data ? "통계를 불러오는 중…" : "")}</p><div className="stat-cards">{statistics.map(s=><button type="button" className={`stat-card stat-card-button${s.userId===selectedGrowthUserId?" is-selected":""}`} key={s.userId} onClick={()=>setGrowthUserId(s.userId)} aria-pressed={s.userId===selectedGrowthUserId}><div className="stat-card-head"><strong>{s.name}</strong>{s.userId===data.currentUserId&&<span className="me-badge">나</span>}</div><div className="stat-rate"><b>{s.completionRate}%</b><span>이번 달 인증률</span></div><div className="stat-grid"><div><span>완료</span><strong>{s.complete}</strong></div><div><span>미제출</span><strong>{s.missed}</strong></div><div><span>미루기</span><strong>{s.postponed}</strong></div><div><span>연속 인증</span><strong>{s.streak}일</strong></div></div><div className="stat-penalty"><span>선택 월 확정 벌금</span><strong>{s.totalPenalty.toLocaleString()}원</strong></div></button>)}</div><GrowthStatsSection key={data.currentUserId} month={month} studyId={study.id} selectedUserId={selectedGrowthUserId} currentUserId={data.currentUserId} members={data.members} onSelectUser={setGrowthUserId}/></section>;

  return <main className="app-shell ham-calendar">
    <header className="ham-calendar-top">
      <AppBrand />
      <div className="calendar-utilities">
        <Link className="study-switch" href="/studies">스터디 전환</Link>
        <button className="utility-icon refresh-icon" onClick={() => void reload(month)} disabled={refreshing}
          aria-label="달력과 통계 새로고침" title="최신 기록 새로고침">↻</button>
        <button className="utility-icon" onClick={openSettings} aria-label="스터디 설정 열기" title="스터디 설정">⚙︎</button>
      </div>
    </header>
    <div className="calendar-masthead">
      <div className="calendar-study"><h1>{study.name}</h1><p>멤버 {data.members.length}명</p></div>
      <nav className="calendar-sections" aria-label="스터디 화면">
        <button type="button" aria-pressed={tab === "calendar"} onClick={() => switchTab("calendar")}>캘린더</button>
        <button type="button" aria-pressed={tab === "stats"} onClick={() => switchTab("stats")}>통계</button>
      </nav>
    </div>
  {(refreshing||warning)&&<p className="calendar-footnote" role="status">{warning||"최신 기록을 확인하는 중…"}</p>}
  {showInstall&&<section className="install-banner"><div><strong>햄쮸터를 앱처럼 쓰기</strong><p>{iosInstall?"Safari에서 홈 화면에 추가하면 주소창 없이 바로 열립니다.":"홈 화면에 설치하면 다음부터 햄쮸터로 바로 들어올 수 있습니다."}</p></div><div><button className="secondary-button" onClick={()=>void installApp()}>{iosInstall?"설치 방법":"설치"}</button><button className="text-button" onClick={dismissInstall}>나중에</button></div></section>}
  {tab==="calendar"?calendarView:statsView}

  {detailOpen && <DaySheet onClose={() => setDetailOpen(false)}>
    <div className="sheet-header"><div><h2 id="ham-day-title">{formatDateHeading(selectedDate)}</h2>
      <p>오전 4시부터 다음 날 오전 3시 59분까지</p></div>
      <button type="button" className="close-button" aria-label="날짜 상세 닫기" onClick={() => setDetailOpen(false)}>×</button>
    </div>
    <div className="detail-members">{(selectedDay?.members??[]).filter(m=>m.state!=="inactive").map(m=>{const meta=STATE_META[m.state]; const submissions=detail?.data?.submissions.filter(row=>row.userId===m.userId)??[]; const penalty=detail?.data?.penalties.find(row=>row.user_id===m.userId)?.amount??0;return<section className="detail-member" key={m.userId}><div className="detail-member-heading"><div><strong>{m.name}</strong>{m.userId===data.currentUserId&&<span className="me-badge">나</span>}</div><span className={`state-label state-${m.state}`}>{meta.icon} {meta.label}</span></div>{(m.completedGoals??[]).length>0&&<p>{m.completedGoals.map(goal=>GOAL_LABELS[goal]).join(" · ")} 완료</p>}{submissions.length?<div className="submission-list">{submissions.map((s,i)=><div className="submission-row" key={`${s.problemId}-${s.solvedAt}-${i}`}><div><strong>{s.source==="manual"?`${PLATFORM_LABEL[s.platform as ManualPlatform]??s.platform} · ${s.difficulty}`:s.title}</strong><span>{s.source==="manual"?<>수동 인증 <em className="manual-badge">수동</em></>:<>{s.platform} {s.problemId} · {s.difficulty} · {formatTime(s.solvedAt)}</>}</span></div><b>+{s.credit.toFixed(2)}</b></div>)}</div>:<p className="empty-copy">{detail?.error || (!detail?.data ? "상세 기록을 불러오는 중…" : detail.data.algorithm ? "이 날짜에 직접 기록된 풀이가 없습니다." : "")}</p>}{detail?.data?.algorithm && <div className="credit-row"><span>직접 풀이 인정량</span><strong>{m.directCredits.toFixed(2)} / 1.00</strong></div>}{m.state==="presolved"&&<p className="presolve-note">미리 인증한 목표가 반영된 날짜예요.</p>}{m.resolvedOn&&m.resolvedOn>selectedDate&&<p className="presolve-note">{m.resolvedOn}에 보충 완료한 인증입니다.</p>}{m.postponedAt&&<p className="postpone-note">{formatTime(m.postponedAt)} 미루기 신청</p>}{penalty>0&&<div className="penalty-row"><span>미제출 벌금</span><strong>{penalty.toLocaleString()}원</strong></div>}</section>})}
    {detail?.data?.algorithm && selectedDate<=data.studyDate&&<section className="manual-certification"><button className="manual-toggle" onClick={()=>setManualOpen(open=>!open)} aria-expanded={manualOpen}><span><strong>자동 인증이 안 됐나요?</strong><small>플랫폼 · 난이도 · 문제 수만 입력하면 됩니다.</small></span><b>{manualOpen?"−":"+ 수동 풀이 등록"}</b></button>{manualOpen&&<div className="manual-form"><label><span>플랫폼</span><select value={manualPlatform} onChange={e=>changeManualPlatform(e.target.value as ManualPlatform)}>{(Object.keys(PLATFORM_LABEL) as ManualPlatform[]).map(platform=><option value={platform} key={platform}>{PLATFORM_LABEL[platform]}</option>)}</select></label><label><span>난이도</span><select value={manualDifficulty} onChange={e=>setManualDifficulty(e.target.value)}>{MANUAL_DIFFICULTIES[manualPlatform].map(option=><option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label><span>문제 수</span><input type="number" min={1} max={20} value={manualCount} onChange={e=>setManualCount(Math.max(1,Math.min(20,Number(e.target.value)||1)))}/></label><button className="primary-button full" onClick={()=>void addManualSubmission()} disabled={busy==="manual"}>{busy==="manual"?"등록 중…":`${manualCount}문제 등록`}</button><p>사진이나 문제 번호는 저장하지 않습니다. 본인 풀이만 수동으로 추가됩니다.</p></div>}</section>}
    {detail?.data?.goals && <EnglishDayPanel key={study.id+selectedDate} viewerId={viewerId} studyId={study.id} date={selectedDate}
      data={detail.data.goals} completedGoals={selectedDay?.members.find(m=>m.userId===viewerId)?.completedGoals} onChanged={confirmGoal} />}
  </div>{selectedDate===data.studyDate&&<PostponementControl key={`${study.id}:${data.studyDate}:${JSON.stringify(data.todayPostponement)}`} studyId={study.id} studyDate={data.studyDate} initialStatus={data.todayPostponement??null} onChanged={confirmPostponement} onMessage={setToast}/>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </DaySheet>}

  {settingsOpen && <StudySettingsSheet key={study.id} study={study} members={data.members} viewerId={viewerId}
    githubAppSlug={githubAppSlug} onClose={()=>setSettingsOpen(false)} onLogout={logout} />}
  {toast&&!detailOpen&&!settingsOpen&&<div className="toast" role="status" aria-live="polite">{toast}</div>}</main>;
}
