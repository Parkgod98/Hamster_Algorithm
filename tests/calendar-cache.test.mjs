import test from "node:test";
import assert from "node:assert/strict";
import { createCalendarCache } from "../src/lib/calendar-cache.ts";

const day = "2026-10-16";
const scope = (month = "2026-10", viewerId = "alice", studyId = "study") => ({ viewerId, studyId, month });
const snapshot = (month = "2026-10", viewerId = "alice", studyId = "study") => ({
  month, currentUserId: viewerId, study: { id: studyId }, studyDate: day, todayPostponement: null,
});
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  let clock = Date.parse(`${day}T00:00:00Z`);
  return { cache: createCalendarCache({ now: () => clock }), setNow(value) { clock = value; }, get now() { return clock; } };
}

test("10월 → 9월 → 10월 왕복은 유효 캐시를 재사용해 두 번만 읽는다", async () => {
  const { cache } = fixture(); let calls = 0;
  async function visit(month) {
    const saved = cache.peek(scope(month), day);
    if (saved?.fresh) return saved.data;
    return cache.load(scope(month), async () => { calls += 1; return snapshot(month); });
  }
  await visit("2026-10"); await visit("2026-09"); await visit("2026-10"); await visit("2026-09");
  assert.equal(calls, 2); assert.equal(cache.size, 2);
});

test("TTL이 지나도 기존 화면 데이터는 남기고 fresh만 해제한다", async () => {
  const env = fixture(); env.cache.put(snapshot());
  env.setNow(env.now + 299_999);
  assert.equal(env.cache.peek(scope(), day).fresh, true);
  env.setNow(env.now + 1);
  assert.equal(env.cache.peek(scope(), day).fresh, false);
  assert.equal(env.cache.peek(scope(), day).data.month, "2026-10");
});

test("같은 진행 중 요청은 하나의 promise와 loader를 공유한다", async () => {
  const { cache } = fixture(); const waiting = deferred(); let calls = 0;
  const loader = () => { calls += 1; return waiting.promise; };
  const a = cache.load(scope(), loader); const b = cache.load(scope(), loader);
  assert.equal(a, b); await Promise.resolve(); assert.equal(calls, 1);
  waiting.resolve(snapshot()); await a;
});

test("계정과 스터디가 다르면 같은 월 캐시를 재사용하지 않는다", () => {
  const { cache } = fixture(); cache.put(snapshot());
  assert.equal(cache.peek(scope("2026-10", "bob"), day), null);
  assert.equal(cache.peek(scope("2026-10", "alice", "other"), day), null);
});

test("mutation은 영향 Study의 과거 월까지 무효화한다", () => {
  const { cache } = fixture();
  cache.put(snapshot("2026-09")); cache.put(snapshot()); cache.put(snapshot("2026-10", "alice", "other"));
  cache.invalidateStudy("alice", "study");
  assert.equal(cache.peek(scope("2026-09"), day), null); assert.equal(cache.peek(scope(), day), null);
  assert.ok(cache.peek(scope("2026-10", "alice", "other"), day));
});

test("무효화 이전 응답은 늦게 와도 cache를 되살리지 않는다", async () => {
  const { cache } = fixture(); const waiting = deferred();
  const pending = cache.load(scope(), () => waiting.promise);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await Promise.resolve(); cache.invalidateStudy("alice", "study"); waiting.resolve(snapshot()); await rejected;
  assert.equal(cache.peek(scope(), day), null);
});

test("이전 월 요청 취소 후 늦은 응답은 선택한 월을 덮을 수 없다", async () => {
  const { cache } = fixture(); const waiting = deferred(); let oldSignal;
  const pending = cache.load(scope("2026-09"), (signal) => { oldSignal = signal; return waiting.promise; });
  const rejected = assert.rejects(pending, { name: "AbortError" }); await Promise.resolve();
  cache.cancelOtherRequests(scope());
  assert.equal(oldSignal.aborted, true);
  const selected = await cache.load(scope(), async () => snapshot());
  waiting.resolve(snapshot("2026-09")); await rejected;
  assert.equal(selected.month, "2026-10"); assert.equal(cache.peek(scope("2026-09"), day), null);
});

test("refresh 실패는 기존 데이터를 보존하며 다음 요청으로 재시도한다", async () => {
  const env = fixture(); env.cache.put(snapshot()); env.setNow(env.now + 300_000);
  await assert.rejects(env.cache.load(scope(), async () => { throw new Error("network"); }), /network/);
  assert.equal(env.cache.peek(scope(), day).fresh, false);
  await env.cache.load(scope(), async () => snapshot());
  assert.equal(env.cache.peek(scope(), day).fresh, true);
});

test("04:00 Study Day 경계를 넘으면 전날 캐시를 반환하지 않는다", () => {
  const env = fixture(); env.setNow(Date.parse(`${day}T18:59:59Z`)); env.cache.put(snapshot());
  env.setNow(Date.parse(`${day}T19:00:00Z`));
  assert.equal(env.cache.peek(scope(), "2026-10-17"), null);
});

test("미루기 마감은 5분 TTL보다 먼저 캐시를 만료시킨다", () => {
  const env = fixture();
  env.cache.put({ ...snapshot(), todayPostponement: { canPostpone: true, deadlineAt: new Date(env.now + 1000).toISOString() } });
  env.setNow(env.now + 1000);
  assert.equal(env.cache.peek(scope(), day).fresh, false);
});

test("최대 12개 월만 남기며 가장 오래 사용하지 않은 결과를 제거한다", () => {
  const { cache } = fixture();
  for (let month = 1; month <= 12; month += 1) cache.put(snapshot(`2025-${String(month).padStart(2, "0")}`));
  cache.peek(scope("2025-01"), day); cache.put(snapshot());
  assert.equal(cache.size, 12);
  assert.equal(cache.peek(scope("2025-02"), day), null); assert.ok(cache.peek(scope("2025-01"), day));
});

test("잘못된 사용자나 월 응답은 저장하지 않는다", async () => {
  const { cache } = fixture();
  await assert.rejects(cache.load(scope(), async () => snapshot("2026-09")), /scope mismatch/);
  await assert.rejects(cache.load(scope(), async () => snapshot("2026-10", "bob")), /scope mismatch/);
  assert.equal(cache.size, 0);
});

test("로그아웃 clear는 캐시와 진행 중 응답을 모두 폐기한다", async () => {
  const { cache } = fixture(); cache.put(snapshot("2026-09")); const waiting = deferred();
  const pending = cache.load(scope(), () => waiting.promise);
  const rejected = assert.rejects(pending, { name: "AbortError" }); await Promise.resolve();
  cache.clear(); waiting.resolve(snapshot()); await rejected;
  assert.equal(cache.size, 0);
});
