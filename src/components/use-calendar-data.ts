"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";
import { createCalendarCache, type CalendarSnapshot } from "@/lib/calendar-cache";
import { studyDateFromTimestamp, studyDayEndExclusiveTimestamp } from "@/lib/study-day";

class CalendarAccessError extends Error {}

/** The cache lives with Dashboard, not in a server process or Service Worker. */
export function useCalendarData<T extends CalendarSnapshot>() {
  const [cache] = useState(() => createCalendarCache<T>());
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const liveData = useRef<T | null>(null);
  const viewer = useRef("");
  const requestedMonth = useRef("");
  const sequence = useRef(0);
  const mounted = useRef(false);

  const run = useCallback(async (targetMonth?: string, force = false): Promise<T | null> => {
    const requestId = ++sequence.current;
    const currentDate = studyDateFromTimestamp(new Date().toISOString());
    const month = targetMonth || currentDate.slice(0, 7);
    requestedMonth.current = month;
    const active = () => mounted.current && requestId === sequence.current;
    try {
      const { data: auth } = await browserSupabase().auth.getSession();
      if (!active()) return null;
      const session = auth.session;
      if (!session) {
        cache.clear(); liveData.current = null; setData(null);
        window.location.replace("/");
        return null;
      }
      if (viewer.current && viewer.current !== session.user.id) {
        cache.clear(); liveData.current = null; setData(null);
      }
      viewer.current = session.user.id;
      const scope = { viewerId: session.user.id, studyId: liveData.current?.study?.id ?? "", month };
      if (force) {
        if (scope.studyId) cache.invalidateStudy(scope.viewerId, scope.studyId);
        else cache.clear();
      }
      const cached = cache.peek(scope, currentDate);
      const apply = (value: T) => {
        if (!active()) return;
        liveData.current = value; setData(value); setError(""); setWarning("");
        setSelectedDate((previous) => previous.startsWith(value.month) ? previous
          : value.studyDate.startsWith(value.month) ? value.studyDate : `${value.month}-01`);
      };
      cache.cancelOtherRequests(scope);
      if (cached) apply(cached.data);
      if (cached?.fresh) { setRefreshing(false); return cached.data; }
      // An old snapshot is display-only. Disable its action while revalidating.
      if (liveData.current) setData({ ...liveData.current, todayPostponement: null });
      setRefreshing(true);
      setError(""); setWarning("");
      const next = await cache.load(scope, async (signal) => {
        const response = await fetch(`/api/dashboard?${new URLSearchParams({ month })}`, {
          headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal,
        });
        if (response.status === 401 || response.status === 403) throw new CalendarAccessError("로그인과 스터디 참여 상태를 다시 확인해주세요.");
        if (!response.ok) throw new Error("달력을 불러오지 못했습니다.");
        return await response.json() as T;
      });
      if (!active()) return null;
      apply(next);
      return next;
    } catch (caught) {
      if (!active() || (caught instanceof Error && caught.name === "AbortError")) return null;
      if (caught instanceof CalendarAccessError || (caught instanceof Error && caught.message === "Calendar response scope mismatch")) {
        cache.clear(); liveData.current = null; setData(null);
        setError("로그인과 스터디 참여 상태를 다시 확인해주세요.");
      } else if (liveData.current) {
        setWarning("최신 정보를 가져오지 못했어요. 이전 화면을 표시 중입니다. 새로고침해주세요.");
      } else setError("달력을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      return null;
    } finally {
      if (active()) setRefreshing(false);
    }
  }, [cache]);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => void run(), 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run(requestedMonth.current);
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    // Keep the auth callback synchronous; session lookups run outside the auth lock.
    const { data: listener } = browserSupabase().auth.onAuthStateChange((_event, session) => {
      if (!viewer.current || viewer.current === session?.user.id) return;
      sequence.current += 1;
      cache.clear(); liveData.current = null; viewer.current = "";
      setData(null); setError(""); setWarning("");
      window.setTimeout(() => { if (mounted.current) void run(); }, 0);
    });
    return () => {
      mounted.current = false; sequence.current += 1;
      window.clearTimeout(timer); cache.clear(); listener.subscription.unsubscribe();
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cache, run]);

  const studyDate = data?.studyDate;
  useEffect(() => {
    if (!studyDate) return;
    const delay = Math.max(0, Date.parse(studyDayEndExclusiveTimestamp(studyDate)) - Date.now());
    const timer = window.setTimeout(() => {
      cache.clear();
      if (liveData.current) setData({ ...liveData.current, todayPostponement: null });
      if (document.visibilityState === "visible") void run(requestedMonth.current);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [studyDate, cache, run]);

  const reload = useCallback(async (month?: string) => { await run(month, true); }, [run]);
  const navigate = useCallback((month?: string) => run(month), [run]);
  const clear = useCallback(() => {
    sequence.current += 1; cache.clear(); liveData.current = null; viewer.current = ""; setData(null);
  }, [cache]);
  return { data, error, warning, refreshing, month: data?.month ?? "", selectedDate, setSelectedDate, reload, navigate, clear };
}
