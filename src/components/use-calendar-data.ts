"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserSupabase, currentAccountId, forgetAccountSession, type AppSession } from "@/lib/supabase-browser";
import { validId } from "@/lib/community";
import { forgetStudy, rememberedStudy, rememberStudy } from "@/lib/study-navigation";
import { type CalendarSnapshot } from "@/lib/calendar-cache";
import { invalidateViews, peekView, putView, readView } from "@/lib/view-cache";
import { knownEmptyDirectory, rememberEmptyDirectory } from "@/lib/directory-cache";
import { useViewRevision } from "./use-view-revision";
import { studyDateFromTimestamp, studyDayEndExclusiveTimestamp } from "@/lib/study-day";

class CalendarAccessError extends Error {
  constructor(readonly status: number, readonly session: AppSession, readonly studyId: string) {
    super("대시보드 접근 권한을 확인해주세요.");
  }
}

function calendarUsable(snapshot: CalendarSnapshot, today: string, viewerId: string, studyId: string, month: string) {
  const status = snapshot.todayPostponement;
  return snapshot.currentUserId === viewerId && snapshot.study?.id === studyId && snapshot.month === month
    && snapshot.studyDate === today && !(status?.canPostpone && status.deadlineAt && Date.parse(status.deadlineAt) <= Date.now());
}
export function useCalendarData<T extends CalendarSnapshot>() {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setDate] = useState("");
  const liveData = useRef<T | null>(null);
  const viewer = useRef("");
  const requestedMonth = useRef("");
  const sequence = useRef(0);
  const mounted = useRef(false);

  const run = useCallback(async (targetMonth?: string, force = false): Promise<T | null> => {
    const requestId = ++sequence.current;
    const currentDate = studyDateFromTimestamp(new Date().toISOString());
    const active = () => mounted.current && requestId === sequence.current;
    try {
      const { data: auth } = await browserSupabase().auth.getSession();
      if (!active()) return null;
      const session = auth.session;
      if (!session) {
        liveData.current = null; setData(null);
        window.location.replace("/");
        return null;
      }
      if (viewer.current && viewer.current !== session.user.id) {
        liveData.current = null; setData(null);
      }
      viewer.current = session.user.id;
      const studyId = new URLSearchParams(window.location.search).get("studyId")
        || liveData.current?.study?.id || rememberedStudy(session.user.id) || "";
      if (studyId && !validId(studyId)) {
        forgetStudy(session.user.id, studyId);
        router.replace("/studies");
        return null;
      }
      const id = session.user.id;
      if (!studyId && knownEmptyDirectory(id)) {
        router.replace("/studies");
        return null;
      }
      const position = studyId ? peekView<string>(id, `calendar-position:${studyId}`) : undefined;
      const month = targetMonth || position?.slice(0, 7) || currentDate.slice(0, 7);
      requestedMonth.current = month;
      const key = `calendar:${studyId}:${month}`;
      const apply = (value: T) => {
        if (!active()) return;
        liveData.current = value; setData(value); setError(""); setWarning("");
        const stored = value.study ? peekView<string>(id, `calendar-position:${value.study.id}`) : undefined;
        const date = stored?.startsWith(value.month) ? stored : value.studyDate.startsWith(value.month) ? value.studyDate : `${value.month}-01`;
        if (value.study) putView(id, `calendar-position:${value.study.id}`, date);
        setDate(date);
      };
      const cached = studyId ? peekView<T>(id, key) : undefined;
      if (cached && !force && calendarUsable(cached, currentDate, id, studyId, month)) {
        apply(cached);
        setRefreshing(false);
        return cached;
      }
      if (force || cached) invalidateViews(id, [key]);
      // An expired action cannot be used while the current result loads.
      if (liveData.current?.todayPostponement?.canPostpone) setData({ ...liveData.current, todayPostponement: null });
      setRefreshing(true);
      setError(""); setWarning("");
      const load = async (signal: AbortSignal) => {
        const response = await fetch(`/api/dashboard?${new URLSearchParams({month, studyId})}`, {
          headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal,
        });
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          throw new CalendarAccessError(response.status, session, studyId);
        }
        if (!response.ok) throw new Error("달력을 불러오지 못했습니다.");
        const value = await response.json() as T;
        if (value.currentUserId !== id || value.month !== month || (studyId && value.study?.id !== studyId)) {
          throw new Error("Calendar response scope mismatch");
        }
        return value;
      };
      // A live change can supersede the very first request, before this hook
      // knows which calendar to subscribe to. The active navigation still needs a result.
      let next: T;
      for (;;) {
        try { next = await readView(id, key, load, studyId ? {} : { ttlMs: 0 }); break; }
        catch (err) {
          if (!(err instanceof Error && err.name === 'AbortError') || !active() || currentAccountId() !== id) throw err;
        }
      }
      if (!active()) return null;
      if (!next.study) {
        rememberEmptyDirectory(id);
        router.replace("/studies");
        return null;
      }
      if (!studyId) putView(id, `calendar:${next.study.id}:${month}`, next);
      rememberStudy(session.user.id, next.study.id);
      apply(next);
      return next;
    } catch (caught) {
      if (!active() || (caught instanceof Error && caught.name === "AbortError")) return null;
      if (caught instanceof CalendarAccessError || (caught instanceof Error && caught.message === "Calendar response scope mismatch")) {
        liveData.current = null; setData(null);
        if (caught instanceof CalendarAccessError) {
          if (caught.status === 401 && forgetAccountSession(caught.session.access_token)) {
            window.location.replace("/");
            return null;
          }
          if (caught.status !== 401 && caught.studyId) {
            forgetStudy(caught.session.user.id, caught.studyId);
            router.replace("/studies");
            return null;
          }
        }
        setError("로그인과 스터디 참여 상태를 다시 확인해주세요.");
      } else if (liveData.current) {
        setWarning("최신 정보를 가져오지 못했어요. 이전 화면을 표시 중입니다. 새로고침해주세요.");
      } else setError("달력을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      return null;
    } finally {
      if (active()) setRefreshing(false);
    }
  }, [router]);

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
      liveData.current = null; viewer.current = "";
      setData(null); setError(""); setWarning("");
      window.setTimeout(() => { if (mounted.current) void run(); }, 0);
    });
    return () => {
      mounted.current = false; sequence.current += 1;
      window.clearTimeout(timer); listener.subscription.unsubscribe();
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [run]);

  const revision = useViewRevision(data?.currentUserId ?? "", data?.study ? `calendar:${data.study.id}:${data.month}` : "");
  const observed = useRef(revision);
  useEffect(() => {
    if (observed.current === revision) return;
    observed.current = revision;
    if (mounted.current) void run(requestedMonth.current);
  }, [revision, run]);

  const studyDate = data?.studyDate;
  useEffect(() => {
    if (!studyDate) return;
    const delay = Math.max(0, Date.parse(studyDayEndExclusiveTimestamp(studyDate)) - Date.now());
    const timer = window.setTimeout(() => {
      if (viewer.current) invalidateViews(viewer.current, ["calendar:", "day:", "growth:"]);
      if (liveData.current) setData({ ...liveData.current, todayPostponement: null });
      if (document.visibilityState === "visible") void run(requestedMonth.current);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [studyDate, run]);

  const updateConfirmed = useCallback((change: (current: T) => T) => {
    const previous = liveData.current;
    if (!previous?.study) return;
    sequence.current += 1;
    const patched = change(previous);
    putView(previous.currentUserId, `calendar:${previous.study.id}:${patched.month}`, patched);
    liveData.current = patched;
    setData(patched);
  }, []);
  const reload = useCallback(async (month?: string) => { await run(month, true); }, [run]);
  const navigate = useCallback((month?: string) => run(month), [run]);
  const clear = useCallback(() => {
    sequence.current += 1; liveData.current = null; viewer.current = ""; setData(null);
  }, []);
  const setSelectedDate = useCallback((date: string) => {
    const snapshot = liveData.current;
    if (snapshot?.study) putView(snapshot.currentUserId, `calendar-position:${snapshot.study.id}`, date);
    setDate(date);
  }, []);
  return { data, error, warning, refreshing, month: data?.month ?? "", selectedDate, setSelectedDate, reload, navigate, clear, updateConfirmed };
}
