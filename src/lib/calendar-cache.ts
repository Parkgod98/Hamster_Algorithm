export type CalendarSnapshot = {
  currentUserId: string;
  study: { id: string } | null;
  month: string;
  studyDate: string;
  todayPostponement?: { canPostpone: boolean; deadlineAt: string | null } | null;
};
export type CalendarScope = { viewerId: string; studyId: string; month: string };
type Entry<T> = { data: T; fetchedAt: number; expiresAt: number };
type Flight<T> = { scope: CalendarScope; controller: AbortController; promise: Promise<T> };

function key(scope: CalendarScope) {
  return JSON.stringify([scope.viewerId, scope.studyId, scope.month]);
}
function abortError() {
  const error = new Error("Calendar request superseded");
  error.name = "AbortError";
  return error;
}

/** Per-dashboard memory only. Never stores tokens or authorizes a mutation. */
export function createCalendarCache<T extends CalendarSnapshot>(
  { ttlMs = 300_000, maxEntries = 12, now = Date.now } = {},
) {
  if (ttlMs <= 0 || !Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("Invalid cache bounds");
  const entries = new Map<string, Entry<T>>();
  const flights = new Map<string, Flight<T>>();

  function put(data: T) {
    if (!data.study) return;
    const fetchedAt = now();
    // Study Day D ends at D 19:00 UTC (D+1 04:00 Seoul).
    let expiresAt = Math.min(fetchedAt + ttlMs, Date.parse(`${data.studyDate}T19:00:00Z`));
    const deadline = data.todayPostponement?.canPostpone && data.todayPostponement.deadlineAt;
    if (deadline) expiresAt = Math.min(expiresAt, Date.parse(deadline));
    const id = key({ viewerId: data.currentUserId, studyId: data.study.id, month: data.month });
    entries.delete(id);
    entries.set(id, { data, fetchedAt, expiresAt });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
  }

  function peek(scope: CalendarScope, studyDate: string) {
    const id = key(scope);
    const entry = entries.get(id);
    if (!entry) return null;
    if (entry.data.studyDate !== studyDate) {
      entries.delete(id);
      return null;
    }
    entries.delete(id);
    entries.set(id, entry);
    return { ...entry, fresh: now() < entry.expiresAt };
  }

  function cancel(id: string, flight: Flight<T>) {
    flights.delete(id);
    flight.controller.abort();
  }
  function invalidateStudy(viewerId: string, studyId: string) {
    for (const [id, entry] of entries) {
      if (entry.data.currentUserId === viewerId && entry.data.study?.id === studyId) entries.delete(id);
    }
    for (const [id, flight] of flights) {
      if (flight.scope.viewerId === viewerId && flight.scope.studyId === studyId) cancel(id, flight);
    }
  }
  function clear() {
    entries.clear();
    for (const [id, flight] of flights) cancel(id, flight);
  }
  function cancelOtherRequests(scope: CalendarScope) {
    const keep = key(scope);
    for (const [id, flight] of flights) if (id !== keep) cancel(id, flight);
  }
  function load(scope: CalendarScope, loader: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const id = key(scope);
    const existing = flights.get(id);
    if (existing) return existing.promise;
    const controller = new AbortController();
    // Defer the loader so the flight is registered even when the loader throws synchronously.
    const promise = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw abortError();
      return loader(controller.signal);
    }).then((data) => {
      if (controller.signal.aborted || flights.get(id) !== flight) throw abortError();
      if (data.currentUserId !== scope.viewerId || data.month !== scope.month
        || (scope.studyId && data.study?.id !== scope.studyId)) {
        throw new Error("Calendar response scope mismatch");
      }
      put(data);
      return data;
    }).finally(() => {
      if (flights.get(id) === flight) flights.delete(id);
    });
    const flight: Flight<T> = { scope, controller, promise };
    flights.set(id, flight);
    return promise;
  }
  return { peek, put, load, invalidateStudy, clear, cancelOtherRequests,
    get size() { return entries.size; } };
}
