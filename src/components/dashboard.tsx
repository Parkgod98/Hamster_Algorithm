"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";
import { GrowthStatsSection, invalidateGrowthStatsCache } from "./growth-stats-section";
import { PostponementControl } from "./postponement-control";
import { useCalendarData } from "./use-calendar-data";
import type { PostponementStatus } from "@/lib/postponement-status";

import { useStudyPanel } from "./use-study-panel";
import { NicknameSettings } from "./account-settings";
import { backfillGitHubRepository, startGitHubConnection } from "@/lib/github-connect-browser";
import { StudyAdministration } from "./study-administration";
import { GoalPolicyFields } from "./study-goal-fields";
import { EnglishDayPanel } from "./english-day-panel";
import { GOAL_LABELS, type StudyRuleConfig, type StudyGoal } from "@/lib/rules";

type Repo={id:string;fullName:string};
type Submission={platform:string;problemId:string;title:string;difficulty:string;credit:number;solvedAt:string;source:string};
type MemberState="inactive"|"upcoming"|"presolved"|"complete"|"in-progress"|"postponed"|"missed";
type DayMember={userId:string;name:string;state:MemberState;credits:number;directCredits:number;penalty:number;consecutiveMisses:number;postponedAt:string|null;resolvedOn?:string|null;completedGoals:StudyGoal[]};
type CalendarDay={date:string;members:DayMember[]};
type Study={id:string;name:string;role:"admin"|"member";scheduledRules?:RulesDraft|null;rules:StudyRuleConfig;postponeDeadlineHour:number;postponeDeadlineMinute:number;maxConsecutivePostpone:number;maxPresolveDays:number};
type MemberStat={userId:string;name:string;complete:number;missed:number;postponed:number;totalPenalty:number;completionRate:number;streak:number};
type RuleHistory = { effective_from:string; changed_by:string|null; created_at:string };
type Penalty = { user_id:string; study_date:string; amount:number };
type DayPanel = { algorithm:boolean; submissions:Array<Submission & {userId:string}>; penalties:Penalty[] };
type SettingsPanel = { repositories:Repo[]; ruleHistory:RuleHistory[] };
type DashboardData={study:Study|null;members:Array<{userId:string;name:string}>;days:CalendarDay[];summary:{complete:number;postponed:number;missed:number;inProgress:number};currentUserId:string;studyDate:string;month:string;todayPostponement?:PostponementStatus|null};
type RulesDraft={ruleConfig:StudyRuleConfig;postponeDeadlineHour:number;postponeDeadlineMinute:number;maxConsecutivePostpone:number;maxPresolveDays:number};
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
const STATE_META:Record<MemberState,{icon:string;label:string}>={complete:{icon:"✅",label:"완료"},presolved:{icon:"●",label:"선풀이"},"in-progress":{icon:"🟡",label:"진행 중"},postponed:{icon:"⏭",label:"미루기"},missed:{icon:"❌",label:"미제출"},upcoming:{icon:"·",label:"예정"},inactive:{icon:"",label:"참여 전"}};
const WEEKDAYS=["일","월","화","수","목","금","토"];

async function accessToken(){const{data}=await browserSupabase().auth.getSession();return data.session?.access_token ?? null;}
function formatMonth(month:string){const[y,m]=month.split("-");return`${y}년 ${Number(m)}월`;}
function shiftMonth(month:string,delta:number){const[y,m]=month.split("-").map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));return`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;}
function formatDateHeading(date:string){const d=new Date(`${date}T00:00:00Z`);const weekday=new Intl.DateTimeFormat("ko-KR",{weekday:"long",timeZone:"UTC"}).format(d);const[,m,day]=date.split("-");return`${Number(m)}월 ${Number(day)}일 ${weekday}`;}
function formatTime(value:string|null){if(!value)return"";return new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));}
function calendarSlots(month:string){const[y,m]=month.split("-").map(Number);const first=new Date(Date.UTC(y,m-1,1));const firstWeekday=first.getUTCDay();const daysInMonth=new Date(Date.UTC(y,m,0)).getUTCDate();return Array.from({length:42},(_,i)=>{const day=i-firstWeekday+1;const d=new Date(Date.UTC(y,m-1,day));return{date:d.toISOString().slice(0,10),currentMonth:day>=1&&day<=daysInMonth};});}
function cloneRules(study: Study): RulesDraft {
  if (study.role === "admin" && study.scheduledRules) return structuredClone(study.scheduledRules);
  return {
    ruleConfig: structuredClone(study.rules),
    postponeDeadlineHour: study.postponeDeadlineHour,
    postponeDeadlineMinute: study.postponeDeadlineMinute,
    maxConsecutivePostpone: study.maxConsecutivePostpone,
    maxPresolveDays: study.maxPresolveDays,
  };
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
function NumberField({label,value,min=0,max=20,suffix,onChange}:{label:string;value:number;min?:number;max?:number;suffix:string;onChange:(value:number)=>void}){return<label className="rule-field"><span>{label}</span><div><input type="number" min={min} max={max} value={value} onChange={e=>onChange(Number(e.target.value))}/><em>{suffix}</em></div></label>}

export function Dashboard({githubAppSlug}:{githubAppSlug:string}){
  const calendar=useCalendarData<DashboardData>();
  const{data,error,warning,refreshing,month,selectedDate,setSelectedDate,navigate,clear}=calendar;
  const[busy,setBusy]=useState("");const[growthRevision,setGrowthRevision]=useState(0);
  const[settingsOpen,setSettingsOpen]=useState(false);const[detailOpen,setDetailOpen]=useState(false);const[rulesDraft,setRulesDraft]=useState<RulesDraft|null>(null);const[toast,setToast]=useState("");
  const[tab,setTab]=useState<"calendar"|"stats">("calendar");const[calendarMode,setCalendarMode]=useState<"month"|"week">("month");const[growthUserId,setGrowthUserId]=useState("");
  const[installPrompt,setInstallPrompt]=useState<InstallPromptEvent|null>(null);const[showInstall,setShowInstall]=useState(false);const[iosInstall,setIosInstall]=useState(false);
  const[manualOpen,setManualOpen]=useState(false);const[manualPlatform,setManualPlatform]=useState<ManualPlatform>("BOJ");const[manualDifficulty,setManualDifficulty]=useState(MANUAL_DIFFICULTIES.BOJ[1].value);const[manualCount,setManualCount]=useState(1);

  async function reload(targetMonth?:string){
    if(data?.study)for(const member of data.members)invalidateGrowthStatsCache(member.userId,data.study.id);
    await calendar.reload(targetMonth);setGrowthRevision(value=>value+1);
  }
  function switchTab(next:"calendar"|"stats"){setTab(next);void navigate(month)}
  useEffect(()=>{if(!toast)return;const id=window.setTimeout(()=>setToast(""),2800);return()=>window.clearTimeout(id)},[toast]);
  useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==="Escape"){setDetailOpen(false);setSettingsOpen(false);setManualOpen(false)}};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[]);
  useEffect(()=>{const standalone=window.matchMedia("(display-mode: standalone)").matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);if(standalone||localStorage.getItem("hamster-install-dismissed")==="1")return;const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);const timer=window.setTimeout(()=>{setIosInstall(ios);if(ios)setShowInstall(true)},0);const handler=(event:Event)=>{event.preventDefault();setInstallPrompt(event as InstallPromptEvent);setShowInstall(true)};window.addEventListener("beforeinstallprompt",handler);return()=>{window.clearTimeout(timer);window.removeEventListener("beforeinstallprompt",handler)}},[]);

  function openSettings(){if(data?.study)setRulesDraft(cloneRules(data.study));setSettingsOpen(true)}
  function connect() {
    if (!data?.study || !githubAppSlug) { setToast("GitHub App 연결을 확인해주세요."); return; }
    void startGitHubConnection(data.study.id, githubAppSlug);
  }
  async function backfill(repo: Repo) {
    if (!data?.study) return;
    setBusy(repo.id);
    try {
      const access = await accessToken();
      if (!access) throw new Error("로그인이 필요해요.");
      const count = await backfillGitHubRepository(repo.id, access);
      setToast(count + "개 풀이를 가져왔어요.");
      await reload(month);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "과거 기록을 가져오지 못했어요.");
    } finally {
      setBusy("");
    }
  }
  async function saveRules() {
    if (data?.study?.role !== "admin" || !rulesDraft) return;
    setBusy("rules");
    try {
      const access = await accessToken();
      const response = await fetch("/api/studies/settings", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ studyId: data.study.id, ...rulesDraft }),
      });
      const result = await response.json() as { error?: string; effectiveFrom?: string };
      if (!response.ok) {
        setToast(result.error ?? "규칙을 저장하지 못했습니다.");
        return;
      }
      setToast(`${result.effectiveFrom} 오전 4시부터 새 규칙을 적용합니다.`);
      await reload(month);
    } catch {
      setToast("저장 결과를 확인할 수 없어요. 설정을 다시 열어 확인해주세요.");
    } finally {
      setBusy("");
    }
  }
  async function addManualSubmission(){if(!data?.study||selectedDate>data.studyDate)return;setBusy("manual");const access=await accessToken();const r=await fetch("/api/submissions/manual",{method:"POST",headers:{Authorization:`Bearer ${access}`,"Content-Type":"application/json"},body:JSON.stringify({studyId:data.study.id,studyDate:selectedDate,platform:manualPlatform,difficulty:manualDifficulty,count:manualCount})});const p=await r.json() as{error?:string;inserted?:number};setBusy("");if(!r.ok){setToast(p.error??"수동 인증을 등록하지 못했습니다.");return;}invalidateGrowthStatsCache(data.currentUserId,data.study.id);setToast(`${p.inserted??manualCount}문제를 수동 인증으로 등록했습니다.`);setManualOpen(false);await reload(month)}
  async function logout(){if(data?.study)for(const member of data.members)invalidateGrowthStatsCache(member.userId,data.study.id);clear();await browserSupabase().auth.signOut();localStorage.removeItem("hamster-study-id");window.location.replace("/")}
  async function moveMonth(delta:number){const next=shiftMonth(month,delta);setDetailOpen(false);setManualOpen(false);await navigate(next)}
  async function goToday(){const latest=await navigate();if(!latest)return;setSelectedDate(latest.studyDate);setDetailOpen(true);setManualOpen(false)}
  async function openDate(date:string,currentMonth:boolean){if(!currentMonth){const next=await navigate(date.slice(0,7));if(!next)return;}setSelectedDate(date);setDetailOpen(true);setManualOpen(false)}
  async function installApp(){if(installPrompt){await installPrompt.prompt();const choice=await installPrompt.userChoice;if(choice.outcome==="accepted")setShowInstall(false)}else if(iosInstall)setToast("Safari 공유 버튼 → 홈 화면에 추가 → 웹 앱으로 열기를 선택하세요.")}
  function dismissInstall(){localStorage.setItem("hamster-install-dismissed","1");setShowInstall(false)}
  function changeManualPlatform(platform:ManualPlatform){setManualPlatform(platform);setManualDifficulty(MANUAL_DIFFICULTIES[platform][0].value)}

  const dayByDate=useMemo(()=>new Map((data?.days??[]).map(d=>[d.date,d])),[data]);const slots=useMemo(()=>(month?calendarSlots(month):[]),[month]);
  const visibleSlots=useMemo(()=>{if(calendarMode==="month"||!selectedDate)return slots;const i=slots.findIndex(s=>s.date===selectedDate);const start=i<0?0:Math.floor(i/7)*7;return slots.slice(start,start+7)},[calendarMode,selectedDate,slots]);
  const selectedDay=selectedDate?dayByDate.get(selectedDate):undefined;

  const panelBase = data?.study ? "/api/dashboard/panel?studyId=" + encodeURIComponent(data.study.id) : null;
  const detail = useStudyPanel<DayPanel>(detailOpen && panelBase && selectedDate ? panelBase + "&view=day&date=" + selectedDate : null, growthRevision);
  const settings = useStudyPanel<SettingsPanel>(settingsOpen && panelBase ? panelBase + "&view=settings" : null, growthRevision);
  const stats = useStudyPanel<{penalties:Penalty[]}>(tab === "stats" && panelBase ? panelBase + "&view=statistics&month=" + month : null, growthRevision);
  const repositories = settings?.data?.repositories ?? [];
  const statistics = useMemo(() => data && stats?.data ? memberStatistics(data, stats.data.penalties) : [], [data,stats]);
  function confirmPostponement(status: PostponementStatus, requestedAt: string) {
    calendar.updateConfirmed(current => {
      if (current.studyDate !== status.studyDate || current.study?.id !== data?.study?.id) return current;
      return { ...current, todayPostponement: status, days: current.days.map(day => day.date !== status.studyDate ? day : {
        ...day, members: day.members.map(member => member.userId === current.currentUserId && member.state !== "complete" ? {
          ...member, state: "postponed", postponedAt: member.postponedAt ?? requestedAt,
        } : member)
      }) };
    });
    void reload(month);
  }

  if(error)return<main className="app-shell"><div className="empty-state"><strong>대시보드를 불러오지 못했습니다.</strong><p>{error}</p><Link href="/studies">스터디 선택</Link><button className="secondary-button" onClick={()=>void reload(month)}>다시 시도</button></div></main>;
  if(!data)return<main className="app-shell"><div className="loading-state">햄쮸터를 불러오는 중…</div></main>;
  if(!data.study)return <main className="app-shell"><section className="onboarding-card">
    <h1>참여할 스터디를 골라주세요</h1><Link className="primary-button" href="/studies">스터디 찾기 · 만들기</Link>
    <NicknameSettings /></section></main>;
  const study=data.study;
  const editableRules=rulesDraft??cloneRules(study);
  const calendarView=<><section className="calendar-toolbar"><div className="month-navigation"><button className="nav-button" onClick={()=>void moveMonth(-1)}>‹</button><h2>{formatMonth(month)}</h2><button className="nav-button" onClick={()=>void moveMonth(1)}>›</button><button className="today-button" onClick={()=>void goToday()}>오늘</button><div className="view-toggle"><button className={calendarMode==="week"?"active":""} onClick={()=>setCalendarMode("week")}>주</button><button className={calendarMode==="month"?"active":""} onClick={()=>setCalendarMode("month")}>월</button></div></div><div className="summary-strip"><span><strong>{data.members.length}</strong>명</span><span><strong>{data.summary.complete}</strong> 완료</span><span><strong>{data.summary.postponed}</strong> 미루기</span><span><strong>{data.summary.missed}</strong> 미제출</span></div></section><section className={`calendar-card mode-${calendarMode}`} aria-busy={refreshing}><div className="weekday-row">{WEEKDAYS.map(d=><div key={d}>{d}</div>)}</div><div className="calendar-grid">{visibleSlots.map(slot=>{const day=dayByDate.get(slot.date);const today=slot.date===data.studyDate;const selected=slot.date===selectedDate;return<button key={slot.date} className={`calendar-day${slot.currentMonth?"":" is-adjacent"}${today?" is-today":""}${selected?" is-selected":""}`} onClick={()=>void openDate(slot.date,slot.currentMonth)} aria-pressed={selected}><div className="day-heading"><span>{Number(slot.date.slice(-2))}</span>{today&&<em>오늘</em>}</div><div className="day-members">{(day?.members??[]).filter(m=>m.state!=="inactive").map(m=>{const meta=STATE_META[m.state];return<div key={m.userId} className={`member-chip state-${m.state}`} title={`${m.name} · ${meta.label}`}><span className="member-name">{m.name}</span><span className="member-state">{meta.icon}</span></div>})}</div></button>})}</div></section><p className="calendar-footnote">인증일은 Asia/Seoul 기준 오전 4시에 바뀝니다. 날짜를 누르면 풀이와 인정량을 확인할 수 있습니다.</p></>;
  const selectedGrowthUserId=data.members.some(member=>member.userId===growthUserId)?growthUserId:data.currentUserId;
  const statsView=<section className="stats-panel"><div className="stats-heading"><div><p className="eyebrow">MONTHLY REPORT</p><h2>{formatMonth(month)} 통계</h2></div><div className="stats-month-nav"><button className="nav-button" onClick={()=>void moveMonth(-1)}>‹</button><button className="nav-button" onClick={()=>void moveMonth(1)}>›</button></div></div><p role="status">{stats?.error || (!stats?.data ? "통계를 불러오는 중…" : "")}</p><div className="stat-cards">{statistics.map(s=><button type="button" className={`stat-card stat-card-button${s.userId===selectedGrowthUserId?" is-selected":""}`} key={s.userId} onClick={()=>setGrowthUserId(s.userId)} aria-pressed={s.userId===selectedGrowthUserId}><div className="stat-card-head"><strong>{s.name}</strong>{s.userId===data.currentUserId&&<span className="me-badge">나</span>}</div><div className="stat-rate"><b>{s.completionRate}%</b><span>이번 달 인증률</span></div><div className="stat-grid"><div><span>완료</span><strong>{s.complete}</strong></div><div><span>미제출</span><strong>{s.missed}</strong></div><div><span>미루기</span><strong>{s.postponed}</strong></div><div><span>연속 인증</span><strong>{s.streak}일</strong></div></div><div className="stat-penalty"><span>선택 월 확정 벌금</span><strong>{s.totalPenalty.toLocaleString()}원</strong></div></button>)}</div><GrowthStatsSection key={`${data.currentUserId}:${data.studyDate}:${growthRevision}`} month={month} studyId={study.id} selectedUserId={selectedGrowthUserId} currentUserId={data.currentUserId} members={data.members} onSelectUser={setGrowthUserId}/></section>;

  return<main className="app-shell"><header className="app-header"><div className="brand-block"><div className="brand-mark">🐹</div><div><p className="eyebrow">HAMJJUTER</p><h1>{study.name}</h1></div></div><div className="header-actions"><Link className="today-button" href="/studies">스터디 전환·찾기</Link><div className="app-tabs"><button className={tab==="calendar"?"active":""} onClick={()=>switchTab("calendar")}>캘린더</button><button className={tab==="stats"?"active":""} onClick={()=>switchTab("stats")}>통계</button></div><button className="icon-button" onClick={()=>void reload(month)} disabled={refreshing} aria-label="달력과 통계 새로고침" title="최신 기록 새로고침">↻</button><button className="icon-button" onClick={openSettings} aria-label="스터디 설정 열기">⚙</button></div></header>
  {(refreshing||warning)&&<p className="calendar-footnote" role="status">{warning||"최신 기록을 확인하는 중…"}</p>}
  {showInstall&&<section className="install-banner"><div><strong>햄쮸터를 앱처럼 쓰기</strong><p>{iosInstall?"Safari에서 홈 화면에 추가하면 주소창 없이 바로 열립니다.":"홈 화면에 설치하면 다음부터 햄쮸터로 바로 들어올 수 있습니다."}</p></div><div><button className="secondary-button" onClick={()=>void installApp()}>{iosInstall?"설치 방법":"설치"}</button><button className="text-button" onClick={dismissInstall}>나중에</button></div></section>}
  {tab==="calendar"?calendarView:statsView}

  {detailOpen&&<div className="sheet-layer" onMouseDown={e=>{if(e.currentTarget===e.target)setDetailOpen(false)}}><aside className="side-sheet" role="dialog" aria-modal="true"><div className="sheet-header"><div><p className="eyebrow">DAILY DETAIL</p><h2>{formatDateHeading(selectedDate)}</h2><p>04:00 ~ 다음 날 03:59</p></div><button className="close-button" onClick={()=>setDetailOpen(false)}>×</button></div><div className="detail-members">{(selectedDay?.members??[]).filter(m=>m.state!=="inactive").map(m=>{const meta=STATE_META[m.state]; const submissions=detail?.data?.submissions.filter(row=>row.userId===m.userId)??[]; const penalty=detail?.data?.penalties.find(row=>row.user_id===m.userId)?.amount??0;return<section className="detail-member" key={m.userId}><div className="detail-member-heading"><div><strong>{m.name}</strong>{m.userId===data.currentUserId&&<span className="me-badge">나</span>}</div><span className={`state-label state-${m.state}`}>{meta.icon} {meta.label}</span></div>{(m.completedGoals??[]).length>0&&<p>{m.completedGoals.map(goal=>GOAL_LABELS[goal]).join(" · ")} 완료</p>}{submissions.length?<div className="submission-list">{submissions.map((s,i)=><div className="submission-row" key={`${s.problemId}-${s.solvedAt}-${i}`}><div><strong>{s.source==="manual"?`${PLATFORM_LABEL[s.platform as ManualPlatform]??s.platform} · ${s.difficulty}`:s.title}</strong><span>{s.source==="manual"?<>수동 인증 <em className="manual-badge">수동</em></>:<>{s.platform} {s.problemId} · {s.difficulty} · {formatTime(s.solvedAt)}</>}</span></div><b>+{s.credit.toFixed(2)}</b></div>)}</div>:<p className="empty-copy">{detail?.error || (!detail?.data ? "상세 기록을 불러오는 중…" : detail.data.algorithm ? "이 날짜에 직접 기록된 풀이가 없습니다." : "")}</p>}<div className="credit-row"><span>직접 풀이 인정량</span><strong>{m.directCredits.toFixed(2)} / 1.00</strong></div>{m.state==="presolved"&&<p className="presolve-note">이전 풀이의 남은 인정량으로 미리 인증된 날짜입니다.</p>}{m.resolvedOn&&m.resolvedOn>selectedDate&&<p className="presolve-note">{m.resolvedOn}에 보충 완료한 인증입니다.</p>}{m.postponedAt&&<p className="postpone-note">{formatTime(m.postponedAt)} 미루기 신청</p>}{penalty>0&&<div className="penalty-row"><span>미제출 벌금</span><strong>{penalty.toLocaleString()}원</strong></div>}</section>})}
    {detail?.data?.algorithm && selectedDate<=data.studyDate&&<section className="manual-certification"><button className="manual-toggle" onClick={()=>setManualOpen(open=>!open)} aria-expanded={manualOpen}><span><strong>자동 인증이 안 됐나요?</strong><small>플랫폼 · 난이도 · 문제 수만 입력하면 됩니다.</small></span><b>{manualOpen?"−":"+ 수동 풀이 등록"}</b></button>{manualOpen&&<div className="manual-form"><label><span>플랫폼</span><select value={manualPlatform} onChange={e=>changeManualPlatform(e.target.value as ManualPlatform)}>{(Object.keys(PLATFORM_LABEL) as ManualPlatform[]).map(platform=><option value={platform} key={platform}>{PLATFORM_LABEL[platform]}</option>)}</select></label><label><span>난이도</span><select value={manualDifficulty} onChange={e=>setManualDifficulty(e.target.value)}>{MANUAL_DIFFICULTIES[manualPlatform].map(option=><option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label><span>문제 수</span><input type="number" min={1} max={20} value={manualCount} onChange={e=>setManualCount(Math.max(1,Math.min(20,Number(e.target.value)||1)))}/></label><button className="primary-button full" onClick={()=>void addManualSubmission()} disabled={busy==="manual"}>{busy==="manual"?"등록 중…":`${manualCount}문제 등록`}</button><p>사진이나 문제 번호는 저장하지 않습니다. 본인 풀이만 수동으로 추가됩니다.</p></div>}</section>}
  <EnglishDayPanel key={study.id+selectedDate} studyId={study.id} date={selectedDate} getAccessToken={accessToken} completedGoals={selectedDay?.members.find(m=>m.userId===data.currentUserId)?.completedGoals} onChanged={()=>reload(month)} />
  </div>{selectedDate===data.studyDate&&<PostponementControl key={`${study.id}:${data.studyDate}:${JSON.stringify(data.todayPostponement)}`} studyId={study.id} studyDate={data.studyDate} initialStatus={data.todayPostponement??null} onChanged={confirmPostponement} onMessage={setToast}/>}</aside></div>}

  {settingsOpen&&<div className="sheet-layer" onMouseDown={e=>{if(e.currentTarget===e.target)setSettingsOpen(false)}}><aside className="side-sheet settings-sheet" role="dialog" aria-modal="true"><div className="sheet-header"><div><p className="eyebrow">STUDY SETTINGS</p><h2>스터디 설정</h2><p>인증 규칙과 연결된 저장소를 확인할 수 있습니다.</p></div><button className="close-button" onClick={()=>setSettingsOpen(false)}>×</button></div>
  <section className="settings-section"><div className="section-title"><div><h3>GitHub Repository</h3><p>BaekjoonHub가 push하는 알고리즘 저장소를 연결합니다.</p></div><button className="secondary-button" onClick={connect}>Repository 연결</button></div><div className="repository-list">{repositories.length?repositories.map(repo=><div className="repository-row" key={repo.id}><div><strong>{repo.fullName}</strong><span>자동 인증 연결됨</span></div><button className="text-button" onClick={()=>void backfill(repo)} disabled={busy===repo.id}>{busy===repo.id?"가져오는 중…":"과거 기록 가져오기"}</button></div>):<div className="settings-empty">{settings?.error || (settings?.data ? "연결된 저장소가 없습니다." : "저장소를 확인하는 중…")}</div>}</div></section>
  {study.role==="admin"&&<StudyAdministration key={study.id} studyId={study.id}/>}
  <section className="settings-section rule-editor"><div className="section-title"><div><h3>인증 규칙</h3><p>스터디장이 수정한 규칙은 다음 인증일 오전 4시부터 적용됩니다.</p></div><span className="fixed-cutoff">Study Day 04:00 고정</span></div>
  <fieldset disabled={study.role!=="admin"} className="study-rule-fields">
  <GoalPolicyFields value={editableRules.ruleConfig.goals} onChange={goals=>setRulesDraft({...editableRules,ruleConfig:{...editableRules.ruleConfig,goals}})} />
  <div className="rule-group"><h4>Baekjoon</h4><div className="rule-grid"><NumberField label="Bronze II~I" value={editableRules.ruleConfig.bojBronzeCount} min={1} suffix="문제" onChange={v=>setRulesDraft({...editableRules,ruleConfig:{...editableRules.ruleConfig,bojBronzeCount:v}})}/><NumberField label="Silver V~I" value={editableRules.ruleConfig.bojSilverCount} min={1} suffix="문제" onChange={v=>setRulesDraft({...editableRules,ruleConfig:{...editableRules.ruleConfig,bojSilverCount:v}})}/><NumberField label="Gold 이상" value={editableRules.ruleConfig.bojGoldCount} min={1} suffix="문제" onChange={v=>setRulesDraft({...editableRules,ruleConfig:{...editableRules.ruleConfig,bojGoldCount:v}})}/></div></div>
  <div className="rule-group"><h4>기타 플랫폼</h4><div className="rule-grid"><NumberField label="Programmers Lv.0~1" value={editableRules.ruleConfig.programmersLowCount} min={1} suffix="문제" onChange={v=>setRulesDraft({...editableRules,ruleConfig:{...editableRules.ruleConfig,programmersLowCount:v}})}/><NumberField label="Programmers Lv.2+" value={editableRules.ruleConfig.programmersHighCount} min={1} suffix="문제" onChange={v=>setRulesDraft({...editableRules,ruleConfig:{...editableRules.ruleConfig,programmersHighCount:v}})}/><NumberField label="SWEA D2~D3" value={editableRules.ruleConfig.sweaLowCount} min={1} suffix="문제" onChange={v=>setRulesDraft({...editableRules,ruleConfig:{...editableRules.ruleConfig,sweaLowCount:v}})}/><NumberField label="SWEA D4+" value={editableRules.ruleConfig.sweaHighCount} min={1} suffix="문제" onChange={v=>setRulesDraft({...editableRules,ruleConfig:{...editableRules.ruleConfig,sweaHighCount:v}})}/><NumberField label="CodeTree 삼성 기출" value={editableRules.ruleConfig.codetreeSamsungCount} min={1} suffix="문제" onChange={v=>setRulesDraft({...editableRules,ruleConfig:{...editableRules.ruleConfig,codetreeSamsungCount:v}})}/></div></div>
  <div className="rule-group"><h4>미루기 · 선풀이</h4><div className="rule-grid"><NumberField label="미루기 마감 시" value={editableRules.postponeDeadlineHour} max={23} suffix="시" onChange={v=>setRulesDraft({...editableRules,postponeDeadlineHour:v})}/><NumberField label="미루기 마감 분" value={editableRules.postponeDeadlineMinute} max={59} suffix="분" onChange={v=>setRulesDraft({...editableRules,postponeDeadlineMinute:v})}/><NumberField label="미해결 날짜 한도" value={editableRules.maxConsecutivePostpone} max={7} suffix="일" onChange={v=>setRulesDraft({...editableRules,maxConsecutivePostpone:v})}/><NumberField label="미리 풀기" value={editableRules.maxPresolveDays} max={14} suffix="일" onChange={v=>setRulesDraft({...editableRules,maxPresolveDays:v})}/></div></div>
  <div className="rule-group"><h4>미제출 벌금</h4><div className="rule-grid">{([1,2,3] as const).map(day=><NumberField key={day} label={`${day}일 미해결`} value={editableRules.ruleConfig.penalties[day]} max={1000000} suffix="원" onChange={v=>setRulesDraft({...editableRules,ruleConfig:{...editableRules.ruleConfig,penalties:{...editableRules.ruleConfig.penalties,[day]:v}}})}/>)}</div></div></fieldset>{study.role==="admin"&&<button className="primary-button full rules-save" onClick={()=>void saveRules()} disabled={busy==="rules"}>{busy==="rules"?"저장 중…":"인증 규칙 저장"}</button>}<p className="rule-warning">{study.role==="admin" && study.scheduledRules?"다음 인증일에 적용할 예약 설정을 표시하고 있습니다.":"현재 적용 중인 설정입니다."}</p></section>
  <section className="settings-section"><h3>규칙 변경 이력</h3><div className="history-list">{settings?.data?.ruleHistory.length?settings.data.ruleHistory.map((h,i)=><div className="history-row" key={`${h.effective_from}-${i}`}><strong>{h.effective_from}</strong><span>{data.members.find(m=>m.userId===h.changed_by)?.name ?? "초기 설정"}</span></div>):<div className="settings-empty">{settings?.error || (settings?.data ? "변경 이력이 없습니다." : "이력을 불러오는 중…")}</div>}</div></section>
  <NicknameSettings onSaved={()=>void reload(month)} /><section className="settings-section account-section"><div><h3>계정</h3><p>직접 로그아웃하기 전까지 로그인 상태를 유지합니다.</p></div><button className="secondary-button danger-button" onClick={()=>void logout()}>로그아웃</button></section></aside></div>}
  {toast&&<div className="toast" role="status" aria-live="polite">{toast}</div>}</main>;
}
