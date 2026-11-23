export type SyncHint = {
  rev: string;
  kind: "catalog" | "profile" | "repos" | "push" | "mine" | "manage" | "metadata" | "member"
    | "rules" | "submission" | "goal" | "postponement" | "penalty";
  userId?: string;
  studyId?: string;
  date?: string;
  id?: string;
};

export type SyncSnapshot = {
  catalog: string;
  account: string;
  studies: Record<string,string>;
  changes: { catalog: SyncHint[]; account: SyncHint[]; studies: Record<string,SyncHint[]> };
};

export type ViewerSyncState = { topic: string; routes: string[]; snapshot: SyncSnapshot };
export type SyncObserver = {
  ready(): void;
  wake(routes: Set<string> | null): void;
  disconnect(): void;
};

const encoder = new TextEncoder();
const heartbeatMs = 15_000;
const streamLifetimeMs = 275_000;

function sameVersions(previous: SyncSnapshot, next: SyncSnapshot) {
  const studies = Object.keys(next.studies);
  return previous.catalog === next.catalog && previous.account === next.account
    && studies.length === Object.keys(previous.studies).length
    && studies.every(id => next.studies[id] === previous.studies[id]);
}

function newHints(hints: SyncHint[], since: string | undefined) {
  return since === undefined ? hints : hints.filter(h => BigInt(h.rev) > BigInt(since));
}

function sinceSnapshot(current: SyncSnapshot, previous: SyncSnapshot): SyncSnapshot {
  return { ...current, changes: {
    catalog: newHints(current.changes.catalog,previous.catalog),
    account: newHints(current.changes.account,previous.account),
    studies: Object.fromEntries(Object.entries(current.changes.studies)
      .filter(([id]) => previous.studies[id] !== current.studies[id])
      .map(([id,hints]) => [id,newHints(hints,previous.studies[id])])),
  } };
}

export function createViewerStream(
  initial: ViewerSyncState,
  read: () => Promise<ViewerSyncState | null>,
  observe: (observer: SyncObserver) => () => void,
  signal: AbortSignal,
) {
  let cancel = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let stopped = false;
      let reading = false;
      let dirty = false;
      let joined = false;
      let confirmed = false;
      let state = initial;
      let unsubscribe = () => {};
      const send = (message: string) => controller.enqueue(encoder.encode(message));
      const heartbeat = setInterval(() => send(": heartbeat\n\n"), heartbeatMs);
      const deadline = setTimeout(close, streamLifetimeMs);

      function release() {
        if (stopped) return;
        stopped = true;
        clearTimeout(deadline);
        clearInterval(heartbeat);
        signal.removeEventListener("abort",close);
        unsubscribe();
      }
      function close() {
        if (!stopped) { release(); controller.close(); }
      }
      async function refresh() {
        dirty = true;
        if (reading || stopped) return;
        reading = true;
        try {
          while (dirty && !stopped) {
            dirty = false;
            const subscribedBeforeRead = joined;
            const next = await read();
            if (stopped) break;
            if (!next) {
              send("event: unauthorized\ndata: {}\n\n");
              close();
              break;
            }
            if (!sameVersions(state.snapshot,next.snapshot)) {
              send("data: " + JSON.stringify(sinceSnapshot(next.snapshot,state.snapshot)) + "\n\n");
            }
            state = next;
            if (subscribedBeforeRead && !confirmed) {
              confirmed = true;
              send("event: ready\ndata: {}\n\n");
            }
          }
        } catch { close(); }
        finally { reading = false; }
      }
      cancel = release;
      if (signal.aborted) { close(); return; }
      signal.addEventListener("abort",close,{ once: true });
      send("data: " + JSON.stringify(initial.snapshot) + "\n\n");
      try {
        const detach = observe({
          // Catch writes between the first query and the subscription acknowledgement.
          ready: () => { joined = true; void refresh(); },
          wake: (routes) => {
            // During a refresh, the result may include a newly joined study. A wake
            // for that study must queue another read even before routes are replaced.
            if (reading || routes === null || state.routes.some(route => routes.has(route))) void refresh();
          },
          disconnect: close,
        });
        if (stopped) detach(); else unsubscribe = detach;
      } catch { close(); }
    },
    cancel() { cancel(); },
  });
}
