import { resumeCheckMs, clearViewer, invalidateViews, notifyViews, setViewsConnected, waitForViewCheck, acceptFirstCalendarSnapshot } from "./view-cache";
import { changedViews } from "./view-changes";
import type { SyncSnapshot } from "./sync-stream";
import { refreshMemberCalendars } from "./member-calendar-refresh";
import { forgetAccountSession, type AppSession } from "./supabase-browser";
import { studyDateFromTimestamp, studyDayEndExclusiveTimestamp } from "./study-day";

export async function readChangeStream(response: Response, consume: (event: string, data: string) => void, pulse: () => void) {
  if (!response.body) throw new Error("Missing change stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "", event = "", data: string[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      pulse();
      pending += decoder.decode(part.value, { stream: true });
      let at = pending.indexOf("\n");
      while (at >= 0) {
        const line = pending.slice(0, at).replace(/\r$/, "");
        pending = pending.slice(at + 1);
        if (!line) {
          if (data.length) consume(event || "message", data.join("\n"));
          event = ""; data = [];
        } else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        else if (line.startsWith("event:")) event = line.slice(6).trim();
        at = pending.indexOf("\n");
      }
    }
  } finally { reader.releaseLock(); }
}

// One connection per foreground app, regardless of how many views it opens.
export function syncAccount(session: AppSession) {
  const viewer = session.user.id;
  const headers = { Authorization: `Bearer ${session.access_token}` };
  let previous: SyncSnapshot | undefined;
  let controller: AbortController | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let suspend: ReturnType<typeof setTimeout> | undefined;
  let rollover: ReturnType<typeof setTimeout>;
  let hiddenAt: number | undefined;
  let stopped = false, failures = 0, bootstrapFallback = false;
  let thaw: (() => void) | undefined;
  let studyDay = studyDateFromTimestamp(new Date().toISOString());
  const visible = () => document.visibilityState === "visible";

  function stopConnection() {
    clearTimeout(retry); retry = undefined;
    controller?.abort(); controller = undefined;
    setViewsConnected(false);
  }
  function expireSession() {
    if (forgetAccountSession(session.access_token)) window.location.replace("/");
    stopped = true; stopConnection();
  }
  function accept(snapshot: SyncSnapshot, release: () => void) {
    if (!snapshot.changes || !snapshot.studies) throw new Error("Invalid change snapshot");
    setViewsConnected(true);
    release();
    if (previous) {
      const { prefixes, members } = changedViews(previous, snapshot);
      invalidateViews(viewer, prefixes);
      for (const [study, users] of members) for (const user of users) void refreshMemberCalendars(viewer, study, user);
    } else {
      // An authenticated cold calendar may finish before the stream opens.
      // Its read revision avoids repeating an unchanged first query.
      acceptFirstCalendarSnapshot(viewer, snapshot.studies, bootstrapFallback);
    }
    previous = snapshot;
  }

  async function connect(checkBeforeReads: boolean) {
    if (stopped || controller || !visible() || !navigator.onLine) return;
    const active = new AbortController();
    controller = active;
    const release = checkBeforeReads ? waitForViewCheck(viewer, !previous) : () => {};
    // Private reads can still reach their normal, authenticated endpoints during an outage.
    let seen = false, live = false;
    let watchdog: ReturnType<typeof setTimeout>;
    function pulse() { clearTimeout(watchdog); watchdog = setTimeout(() => active.abort(), 45_000); }
    pulse();
    const fallback = setTimeout(() => {
      if (!previous && !seen) bootstrapFallback = true;
      release();
    }, 1200);
    try {
      const res = await fetch("/api/sync/changes", { headers, cache: "no-store", signal: active.signal });
      if (res.status === 401) { expireSession(); return; }
      if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream")) throw new Error("Sync unavailable");
      await readChangeStream(res, (event, payload) => {
        if (active.signal.aborted || stopped) return;
        if (event === "unauthorized") { expireSession(); return; }
        if (event === "ready") { live = true; failures = 0; return; }
        if (event === "error") throw new Error("Sync unavailable");
        seen = true; clearTimeout(fallback);
        accept(JSON.parse(payload), release);
      }, pulse);
    } catch { /* The durable snapshot covers a missed disconnect or broadcast. */ }
    finally {
      if (!active.signal.aborted && !stopped && !seen) {
        try {
          const once = await fetch("/api/sync/changes?once=1", {
            headers, cache: "no-store", signal: AbortSignal.any([active.signal, AbortSignal.timeout(8000)]),
          });
          if (once.status === 401) expireSession();
          else if (once.ok && !active.signal.aborted) accept(await once.json(), release);
        } catch { /* reconnect with backoff */ }
      }
      clearTimeout(watchdog!); clearTimeout(fallback); release();
      if (controller === active) {
        controller = undefined; setViewsConnected(false);
        if (!stopped && visible()) {
          const delay = live ? 1000 : Math.min(60_000, 2000 * 2 ** Math.min(5, failures++));
          retry = setTimeout(() => { retry = undefined; void connect(false); }, delay);
        }
      }
    }
  }

  function checkDay() {
    const now = studyDateFromTimestamp(new Date().toISOString());
    if (studyDay !== now) {
      studyDay = now;
      invalidateViews(viewer, ["calendar:", "day:", "growth:", "directory:", "invite:", "history:"]);
    }
    clearTimeout(rollover);
    rollover = setTimeout(checkDay, Math.max(25, Date.parse(studyDayEndExclusiveTimestamp(now)) - Date.now()));
  }
  function visibility() {
    clearTimeout(suspend);
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      suspend = setTimeout(stopConnection, resumeCheckMs);
      return;
    }
    checkDay();
    const long = hiddenAt !== undefined && Date.now() - hiddenAt >= resumeCheckMs;
    hiddenAt = undefined;
    if (long) stopConnection();
    if (long || !controller) { clearTimeout(retry); void connect(long || !previous); }
  }
  function online() { stopConnection(); void connect(true); }
  function pagehide() {
    stopConnection(); clearViewer(viewer, false); previous = undefined; bootstrapFallback = false;
    // An aborted read in the outgoing document must not issue a replacement GET.
    thaw = waitForViewCheck(viewer);
  }
  function pageshow(event: PageTransitionEvent) {
    if (!event.persisted) return;
    thaw?.(); thaw = undefined;
    checkDay(); void connect(true); notifyViews(viewer, ['']);
  }
  checkDay(); void connect(true);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("online", online);
  window.addEventListener("offline", stopConnection);
  window.addEventListener("pagehide", pagehide);
  window.addEventListener("pageshow", pageshow);
  return () => {
    stopped = true; stopConnection();
    clearTimeout(rollover); clearTimeout(suspend);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("online", online);
    window.removeEventListener("offline", stopConnection);
    window.removeEventListener("pagehide", pagehide);
    window.removeEventListener("pageshow", pageshow);
    clearViewer(viewer);
  };
}
