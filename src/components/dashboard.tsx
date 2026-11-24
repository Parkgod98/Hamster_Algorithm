"use client";

import Link from "next/link";
import { ReleaseNotice } from "./release-notice";
import { useEffect, useMemo, useState } from "react";
import { AppBrand } from "./app-brand";
import { addStudyDays, shiftMonth, studyDateFromTimestamp } from "@/lib/study-day";
import "./calendar.css";
import { browserSupabase } from "@/lib/supabase-browser";
import { StudyStatistics } from "./study-statistics";
import { PeriodArrows } from "./period-arrows";
import { DayDetail } from "./day-detail";
import { useManualRegistration } from "./manual-registration";
import { useCalendarData } from "./use-calendar-data";
import type { PostponementStatus } from "@/lib/postponement-status";

import { invalidateViews, peekView, putView } from "@/lib/view-cache";
import { summarizeCalendar, type CalendarDay } from "@/lib/calendar-snapshot";
import { CALENDAR_STATE, calendarStateLabel, formatDateHeading } from "@/lib/calendar-state";
import { refreshMemberCalendars } from "@/lib/member-calendar-refresh";
import { StudySettingsSheet } from "./study-settings-sheet";
import type { SettingsStudy } from "./study-rule-editor";
import type { StudyGoal } from "@/lib/rules";

type Study = SettingsStudy;

type DashboardData={study:Study|null;monthGoals?:StudyGoal[];members:Array<{userId:string;name:string}>;days:CalendarDay[];summary:{complete:number;postponed:number;missed:number;inProgress:number};currentUserId:string;studyDate:string;month:string;todayPostponement?:PostponementStatus|null};
type InstallPromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:"accepted"|"dismissed"}>};
const WEEKDAYS=["일","월","화","수","목","금","토"];

function formatMonth(month:string){const[y,m]=month.split("-");return`${y}년 ${Number(m)}월`;}
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

function CalendarDate({ slot, day, viewerId, today, selected, week, onOpen }: {
  slot: ReturnType<typeof calendarSlots>[number]; day?: CalendarDay; viewerId: string;
  today: boolean; selected: boolean; week: boolean; onOpen: () => void;
}) {
  const members = day?.members.filter(member => member.state !== "inactive") ?? [];
  const title = [formatDateHeading(slot.date), today && "오늘", ...members.map(member =>
    `${member.name}${member.userId === viewerId ? " (나)" : ""} ${calendarStateLabel(member, slot.date)}`)].filter(Boolean).join(", ");

  return <button type="button" className={`calendar-day${slot.currentMonth ? "" : " is-adjacent"}${today ? " is-today" : ""}${selected ? " is-selected" : ""}`}
    data-calendar-date={slot.date} aria-pressed={selected} aria-current={today ? "date" : undefined} aria-label={title} onClick={onOpen}>
    <span className="day-heading"><span className="day-number">{Number(slot.date.slice(-2))}</span>
      <span className="week-day-name">{!slot.currentMonth && `${Number(slot.date.slice(5,7))}월 · `}{slot.weekday}요일</span>{today && <em>오늘</em>}</span>
    <span className="day-members">{week && !slot.currentMonth && <span className="other-members">이 날짜 기록 보기</span>}
      {members.map(member => {
        const status = CALENDAR_STATE[member.state];
        return <span key={member.userId} className={`calendar-member state-${member.state}`}>
          <span className="calendar-member-name">{member.name}</span>
          <span className="calendar-member-status">
            <span className="calendar-member-icon" aria-hidden="true">{status.icon}</span>
            <span className="calendar-member-label">{calendarStateLabel(member, slot.date)}</span>
          </span>
        </span>;
      })}
    </span>
  </button>;
}


export function Dashboard({githubAppSlug}:{githubAppSlug:string}){
  const calendar=useCalendarData<DashboardData>();
  const{data,error,warning,refreshing,month,selectedDate,setSelectedDate,navigate,clear}=calendar;
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
  const manual = useManualRegistration({ studyId: data?.study?.id, studyDate: data?.studyDate, selectedDate, viewerId: viewer, onMessage: setToast });
  const { setManualOpen } = manual;

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
  useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==="Escape"){setDetailOpen(false);setSettingsOpen(false);setManualOpen(false)}};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[setManualOpen]);
  useEffect(()=>{const standalone=window.matchMedia("(display-mode: standalone)").matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);if(standalone||localStorage.getItem("hamster-install-dismissed")==="1")return;const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);const timer=window.setTimeout(()=>{setIosInstall(ios);if(ios)setShowInstall(true)},0);const handler=(event:Event)=>{event.preventDefault();setInstallPrompt(event as InstallPromptEvent);setShowInstall(true)};window.addEventListener("beforeinstallprompt",handler);return()=>{window.clearTimeout(timer);window.removeEventListener("beforeinstallprompt",handler)}},[]);

  function openSettings(){setSettingsOpen(true)}
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
  const dayByDate=useMemo(()=>new Map((data?.days??[]).map(d=>[d.date,d])),[data]);const slots=useMemo(()=>(month?calendarSlots(month):[]),[month]);
  const visibleSlots=useMemo(()=>{if(calendarMode==="month"||!selectedDate)return slots;const i=slots.findIndex(s=>s.date===selectedDate);const start=i<0?0:Math.floor(i/7)*7;return slots.slice(start,start+7)},[calendarMode,selectedDate,slots]);
  const selectedDay=selectedDate?dayByDate.get(selectedDate):undefined;

  const viewerId = data?.currentUserId ?? "";
  const studyId = data?.study?.id;
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
      <dl className="calendar-summary" aria-label="이달의 스터디 인증 집계">
        <div><dt>완료</dt><dd>{data.summary.complete}</dd></div>
        <div><dt>미루기</dt><dd>{data.summary.postponed}</dd></div>
        <div><dt>미제출</dt><dd>{data.summary.missed}</dd></div>
      </dl>
    </div>
  </>;
  const selectedGrowthUserId=data.members.some(member=>member.userId===growthUserId)?growthUserId:data.currentUserId;
  const statsView = <StudyStatistics month={month} heading={formatMonth(month)} studyId={study.id} viewerId={data.currentUserId}
    days={data.days} studyDate={data.studyDate} members={data.members} goals={data.monthGoals ?? study.rules.goals.allowed}
    selectedUserId={selectedGrowthUserId} onSelectUser={setGrowthUserId} onMove={delta => void moveMonth(delta)} />;

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
  <ReleaseNotice accountId={viewerId} />

  {detailOpen && <DayDetail studyId={study.id} viewerId={viewerId} date={selectedDate} studyDate={data.studyDate}
    day={selectedDay} manual={manual} postponement={data.todayPostponement} onPostpone={confirmPostponement}
    toast={toast} onMessage={setToast} onClose={()=>setDetailOpen(false)} />}

  {settingsOpen && <StudySettingsSheet key={study.id} study={study} members={data.members} viewerId={viewerId}
    githubAppSlug={githubAppSlug} onClose={()=>setSettingsOpen(false)} onLogout={logout} />}
  {toast&&!detailOpen&&!settingsOpen&&<div className="toast" role="status" aria-live="polite">{toast}</div>}</main>;
}
