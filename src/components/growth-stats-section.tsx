"use client";

import { useEffect, useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";
import type { GrowthReport, PlatformGrowth } from "@/lib/growth-stats";
import type { Platform } from "@/lib/types";

const PLATFORM_LABEL: Record<Platform, string> = {
  BOJ: "Baekjoon",
  PROGRAMMERS: "Programmers",
  SWEA: "SWEA",
  CODETREE: "CodeTree",
};

const UPPER_LABEL: Partial<Record<Platform, string>> = {
  BOJ: "Gold 이상",
  PROGRAMMERS: "Lv.2 이상",
  SWEA: "D4 이상",
};

const GROWTH_CACHE_TTL_MS = 5 * 60 * 1000;
type GrowthCacheEntry = { report: GrowthReport; fetchedAt: number };
const growthReportCache = new Map<string, GrowthCacheEntry>();

function growthCacheKey(userId: string, studyId: string, month: string) {
  return `${userId}:${studyId}:${month}`;
}

export function invalidateGrowthStatsCache(userId: string, studyId: string) {
  const prefix = `${userId}:${studyId}:`;
  for (const key of growthReportCache.keys()) {
    if (key.startsWith(prefix)) growthReportCache.delete(key);
  }
}

async function accessToken() {
  const { data } = await browserSupabase().auth.getSession();
  return data.session?.access_token;
}

function formatMonth(month: string) {
  const [, value] = month.split("-");
  return `${Number(value)}월`;
}

function deltaLabel(delta: number) {
  if (delta > 0) return `전월보다 +${delta}`;
  if (delta < 0) return `전월보다 ${delta}`;
  return "전월과 동일";
}

function platformSummary(platform: PlatformGrowth) {
  if (!platform.count) return "아직 풀이 없음";
  if (platform.platform === "CODETREE") return `${platform.count}문제`;
  const difficulty = platform.averageDifficulty ? `평균 ${platform.averageDifficulty}` : "난이도 집계 없음";
  return `${difficulty} · ${UPPER_LABEL[platform.platform]} ${platform.upperRate}%`;
}

export function GrowthStatsSection({ month, studyId, userId }: { month: string; studyId: string; userId: string }) {
  const [report, setReport] = useState<GrowthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const key = growthCacheKey(userId, studyId, month);
      const cached = growthReportCache.get(key);
      const fresh = cached && Date.now() - cached.fetchedAt < GROWTH_CACHE_TTL_MS;

      if (cached) {
        setReport(cached.report);
        setLoading(false);
        setError("");
      } else {
        setReport(null);
        setLoading(true);
        setError("");
      }
      if (fresh || cancelled) return;

      void (async () => {
        const access = await accessToken();
        if (!access || cancelled) return;
        const response = await fetch(`/api/growth-stats?month=${encodeURIComponent(month)}`, {
          headers: { Authorization: `Bearer ${access}` },
        });
        const payload = await response.json() as { report?: GrowthReport; error?: string };
        if (cancelled) return;
        if (!response.ok || !payload.report) {
          if (!cached) setError(payload.error ?? "풀이 성장 통계를 불러오지 못했습니다.");
          setLoading(false);
          return;
        }
        growthReportCache.set(key, { report: payload.report, fetchedAt: Date.now() });
        setReport(payload.report);
        setError("");
        setLoading(false);
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [month, studyId, userId]);

  const maxPlatformCount = useMemo(() => Math.max(1, ...(report?.platformCounts.map((item) => item.count) ?? [1])), [report]);

  return <section className="growth-section">
    <div className="growth-heading">
      <div><p className="eyebrow">SOLUTION GROWTH</p><h3>내 풀이 성장</h3><p>풀이량과 난이도 흐름을 플랫폼별로 봅니다. 난이도 상승을 곧바로 실력 점수로 환산하지 않습니다.</p></div>
    </div>
    {loading ? <div className="growth-empty">풀이 기록을 집계하는 중…</div> : error ? <div className="growth-empty">{error}</div> : report ? <>
      <div className="growth-kpis">
        <article><span>이번 달 풀이</span><strong>{report.total}<em>문제</em></strong><small>{deltaLabel(report.delta)} · 지난달 {report.previousTotal}문제</small></article>
        <article><span>활동일</span><strong>{report.activeDays}<em>일</em></strong><small>실제 풀이가 기록된 Study Day</small></article>
        <article><span>풀이한 날 평균</span><strong>{report.averagePerActiveDay}<em>문제</em></strong><small>활동일 기준 평균 풀이량</small></article>
        <article><span>BOJ 최고 난이도</span><strong className="growth-text-kpi">{report.platforms.find((item) => item.platform === "BOJ")?.highestDifficulty ?? "-"}</strong><small>선택한 달 기록 기준</small></article>
      </div>

      <div className="growth-grid">
        <article className="growth-card">
          <div className="growth-card-title"><strong>플랫폼별 풀이 수</strong><span>{report.total}문제</span></div>
          <div className="growth-bars">{report.platformCounts.map((item) => <div className="growth-bar-row" key={item.platform}><div><span>{PLATFORM_LABEL[item.platform]}</span><strong>{item.count}</strong></div><div className="growth-bar-track"><i style={{ width: `${Math.round((item.count / maxPlatformCount) * 100)}%` }}/></div></div>)}</div>
        </article>

        <article className="growth-card growth-recent-card">
          <div className="growth-card-title"><strong>최근 3개월 풀이량</strong><span>월별</span></div>
          <div className="growth-months">{report.recentMonths.map((item) => <div key={item.month}><span>{formatMonth(item.month)}</span><strong>{item.total}</strong><small>문제</small></div>)}</div>
        </article>
      </div>

      <div className="growth-platforms">{report.platforms.map((platform) => <article className="growth-platform-card" key={platform.platform}>
        <div className="growth-platform-head"><div><strong>{PLATFORM_LABEL[platform.platform]}</strong><span>{platformSummary(platform)}</span></div><b>{platform.count}문제</b></div>
        {platform.difficulties.length ? <div className="difficulty-list">{platform.difficulties.map((item) => {
          const max = Math.max(1, ...platform.difficulties.map((difficulty) => difficulty.count));
          return <div className="difficulty-row" key={item.difficulty}><span>{item.difficulty}</span><div className="difficulty-track"><i style={{ width: `${Math.round((item.count / max) * 100)}%` }}/></div><strong>{item.count}</strong></div>;
        })}</div> : <p className="growth-no-data">이 달에는 기록된 풀이가 없습니다.</p>}
      </article>)}</div>

      <article className="growth-card growth-trend-card">
        <div className="growth-card-title"><strong>주간 난이도 추세</strong><span>플랫폼 내부 순서 기준</span></div>
        <div className="weekly-growth">{report.weekly.map((week) => <div className="weekly-growth-column" key={week.week}><b>{week.week}주</b>{week.platforms.filter((item) => item.count > 0 && item.platform !== "CODETREE").map((item) => <div key={item.platform}><span>{PLATFORM_LABEL[item.platform]}</span><strong>{item.averageDifficulty ?? "-"}</strong><small>{UPPER_LABEL[item.platform]} {item.upperRate}%</small></div>)}</div>)}</div>
      </article>

      <article className="growth-card growth-history-card">
        <div className="growth-card-title"><strong>최근 3개월 도전 수준</strong><span>상위 난이도 비중</span></div>
        <div className="growth-history-table"><div className="growth-history-head"><span>월</span><span>BOJ</span><span>Programmers</span><span>SWEA</span></div>{report.recentMonths.map((point) => <div className="growth-history-row" key={point.month}><strong>{formatMonth(point.month)}</strong>{(["BOJ", "PROGRAMMERS", "SWEA"] as Platform[]).map((platform) => { const item = point.platforms.find((value) => value.platform === platform); return <span key={platform}><b>{item?.averageDifficulty ?? "-"}</b><small>{item?.count ? `${item.upperRate}%` : "-"}</small></span>; })}</div>)}</div>
        <p className="growth-footnote">상위 난이도 비중: BOJ Gold 이상 · Programmers Lv.2 이상 · SWEA D4 이상. 플랫폼 간 난이도는 직접 합산하지 않습니다.</p>
      </article>
    </> : null}
  </section>;
}
