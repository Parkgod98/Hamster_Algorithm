type Options = { ttlMs?: number };
type Entry = { viewer: string; key: string; data: unknown; saved: number; expires: number; bytes: number };
type Flight = { viewer: string; key: string; controller: AbortController; promise: Promise<unknown> };
type Watch = { viewer: string; prefix: string; notify: () => void; revision: number };

const minute = 60_000;
export const resumeCheckMs = 5 * minute;
const day = 24 * 60 * minute;
const memoryLimit = 8 * 1024 * 1024;
const entries = new Map<string, Entry>();
const flights = new Map<string, Flight>();
const watchers = new Set<Watch>();
let connected = false;
let lastContact = 0;
let sequence = 0;
let gate: { viewer: string; wait: Promise<void>; release: () => void; cancelled: boolean } | undefined;

export function waitForViewCheck(viewer: string) {
  gate?.release();
  let done!: () => void;
  const wait = new Promise<void>(resolve => { done = resolve; });
  const release = () => { if (gate?.wait === wait) gate = undefined; done(); };
  gate = { viewer, wait, release, cancelled: false };
  return release;
}

const id = (viewer: string, key: string) => JSON.stringify([viewer, key]);
const overlaps = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

// Module memory belongs to this page. Nothing here is written to browser storage.
export function putView<T>(viewer: string, key: string, data: T, options: Options = {}) {
  if (!viewer || data === undefined || options.ttlMs === 0) return;
  const now = Date.now();
  const bytes = typeof Blob !== 'undefined' && data instanceof Blob ? data.size : (JSON.stringify(data)?.length ?? 0) * 2;
  const k = id(viewer, key);
  entries.delete(k);
  if (bytes > memoryLimit) return;
  entries.set(k, { viewer, key, data, saved: now, expires: now + Math.min(day, options.ttlMs ?? day), bytes });
  let total = 0;
  let photos = 0;
  let calendars = 0;
  let count = 0;
  for (const [old, entry] of Array.from(entries).reverse()) {
    if ((entry.key.startsWith('photo:') && ++photos > 4) || (entry.key.startsWith('calendar:') && ++calendars > 12) ||
        count >= 100 || total + entry.bytes > memoryLimit || entry.expires <= now) entries.delete(old);
    else { total += entry.bytes; count++; }
  }
}

function fresh(entry: Entry, now: number) {
  return now < entry.expires && (connected || now - Math.max(lastContact, entry.saved) < resumeCheckMs);
}
export function peekView<T>(viewer: string, key: string): T | undefined {
  if (gate?.viewer === viewer) return;
  const k = id(viewer, key);
  const entry = entries.get(k);
  if (!entry) return;
  if (!fresh(entry, Date.now())) { entries.delete(k); return; }
  entries.delete(k); entries.set(k, entry);
  return entry.data as T;
}

export function listViewKeys(viewer: string, prefix: string) {
  const now = Date.now();
  return Array.from(entries.values()).filter(e => e.viewer === viewer && e.key.startsWith(prefix) && fresh(e, now)).map(e => e.key);
}

export function readView<T>(viewer: string, key: string, load: (signal: AbortSignal) => Promise<T>, options: Options = {}): Promise<T> {
  const pendingCheck = gate;
  if (pendingCheck?.viewer === viewer) return pendingCheck.wait.then(() => {
    if (pendingCheck.cancelled) throw new DOMException('Session changed', 'AbortError');
    return readView(viewer, key, load, options);
  });
  const hit = peekView<T>(viewer, key);
  if (hit !== undefined) return Promise.resolve(hit);
  const k = id(viewer, key);
  const running = flights.get(k);
  if (running) return running.promise as Promise<T>;
  const controller = new AbortController();
  const promise = Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return load(controller.signal);
  }).then(data => {
    controller.signal.throwIfAborted();
    putView(viewer, key, data, options);
    return data;
  }).finally(() => { if (flights.get(k)?.controller === controller) flights.delete(k); });
  flights.set(k, { viewer, key, controller, promise });
  return promise;
}

export function cancelViewLoads(viewer: string, prefixes: string[]) {
  const cancelled: string[] = [];
  for (const [k, flight] of flights) if (flight.viewer === viewer && prefixes.some(p => flight.key.startsWith(p))) {
    flights.delete(k); flight.controller.abort(); cancelled.push(flight.key);
  }
  return cancelled;
}

export function notifyViews(viewer: string, prefixes: string[]) {
  const revision = ++sequence;
  for (const watch of watchers) if (watch.viewer === viewer && prefixes.some(prefix => overlaps(watch.prefix, prefix))) {
    watch.revision = revision; watch.notify();
  }
}

export function invalidateViews(viewer: string, prefixes: string[]) {
  if (!prefixes.length) return;
  for (const [k, entry] of entries) if (entry.viewer === viewer && prefixes.some(p => entry.key.startsWith(p))) entries.delete(k);
  cancelViewLoads(viewer, prefixes);
  notifyViews(viewer, prefixes);
}

export function watchView(viewer: string, prefix: string, notify: () => void) {
  const watch = { viewer, prefix, notify, revision: viewRevision(viewer, prefix) };
  watchers.add(watch);
  return () => { watchers.delete(watch); };
}
export function viewRevision(viewer: string, prefix: string) {
  for (const watch of watchers) if (watch.viewer === viewer && watch.prefix === prefix) return watch.revision;
  return 0;
}

export function setViewsConnected(value: boolean) {
  if (connected || value) lastContact = Date.now();
  connected = value;
}

export function clearViewer(viewer: string) {
  if (gate?.viewer === viewer) { gate.cancelled = true; gate.release(); }
  connected = false; lastContact = 0;
  invalidateViews(viewer, ['']);
}
