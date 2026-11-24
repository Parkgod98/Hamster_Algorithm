"use client";

type Action = "calendar_cold" | "calendar_warm" | "postpone";

// Only a direct dashboard navigation starts at document navigation. On a client
// transition the prior page may have been open for hours.
let autoEntry = false;
export function markAutomaticCalendarNavigation() {
  autoEntry = true;
}

export function markCalendarEntry() {
  const navigation = performance.getEntriesByType("navigation")[0];
  const initialPath = navigation && new URL(navigation.name).pathname;
  const start = navigation && (initialPath === "/dashboard" || (autoEntry && initialPath === "/"))
    && performance.getEntriesByName("hamster:calendar-entry").length === 0
    ? navigation.startTime : performance.now();
  autoEntry = false;
  performance.clearMarks("hamster:calendar-entry");
  performance.mark("hamster:calendar-entry");
  return start;
}

export function reportAfterPaint(action: Action, start: number, token: string, ok: boolean) {
  if (document.visibilityState !== "visible") return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (document.visibilityState !== "visible") return;
    const duration = Math.round(performance.now() - start);
    const name = "hamster:" + action;
    performance.clearMeasures(name);
    performance.measure(name, { start, duration });
    // A warm revisit has zero telemetry network/DB calls.
    if (action === "calendar_warm") return;
    void fetch("/api/metrics/action", {
      method: "POST", keepalive: true, cache: "no-store",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ action, duration, mobile: matchMedia("(max-width: 767px)").matches, ok }),
    }).catch(() => undefined);
  }));
}
