import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runtime } from "./helpers/postponement-runtime.mjs";

const dateAt = (offset) => new Date(Date.parse("2026-09-15T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
const submit = (env, extra = {}) => env.request("POST", { studyId: "study", ...extra });
const status = (env) => env.request("GET", undefined, { url: "/api/postponements?studyId=study" });
const dashboard = (env, month) => env.request("GET", undefined, { url: `/api/dashboard?month=${month}`, route: "src/app/api/dashboard/route.ts" });

for (let limit = 1; limit <= 7; limit += 1) {
  test(`실제 POST: N=${limit}회 미루기 후 N+1번째는 거부하고 완전 상환 후만 허용한다`, async () => {
    const env = runtime({ limit });
    for (let day = 0; day < limit; day += 1) {
      env.setNow(`${dateAt(day)}T22:00:00+09:00`);
      const result = await submit(env);
      assert.equal(result.httpStatus, 200);
      assert.equal(result.body.duplicate, false);
      assert.equal(env.writes.length, day + 1);
    }
    const today = dateAt(limit);
    env.setNow(`${today}T22:00:00+09:00`);
    const before = await status(env);
    assert.equal(before.body.status.canPostpone, false);
    assert.equal(before.body.status.backlogCount, limit + 1);
    assert.equal(before.body.status.limit, limit);
    assert.equal(before.body.status.requiredRepaymentDays, 1);
    const denied = await submit(env, { canPostpone: true, backlogCount: 0, maxConsecutivePostpone: 999 });
    assert.equal(denied.httpStatus, 409);
    assert.equal(denied.body.code, "limit-reached");
    assert.equal(env.writes.length, limit, "거부 시 INSERT를 실행하지 않는다");
    env.solve(today, "Silver III");
    assert.equal((await submit(env)).httpStatus, 409);
    assert.equal(env.writes.length, limit);
    env.solve(today, "Silver III");
    const repaid = await status(env);
    assert.equal(repaid.body.status.canPostpone, true);
    assert.equal(repaid.body.status.backlogCount, limit);
    assert.equal((await submit(env)).httpStatus, 200);
    assert.equal(env.writes.length, limit + 1);
    const retry = await submit(env);
    assert.equal(retry.body.duplicate, true);
    assert.equal(env.writes.length, limit + 1, "재요청은 추가 사용이 아니다");
    const calendar = await dashboard(env, "2026-09");
    assert.equal(calendar.httpStatus, 200);
    const icons = calendar.body.days.flatMap((day) => day.members).filter((member) => member.userId === "alice" && member.state === "postponed");
    assert.equal(icons.length, limit, "상환된 가장 오래된 날짜는 완료로 바뀐다");
    assert.equal(calendar.body.todayPostponement.alreadyPostponed, true);
  });
}

test("상한 0은 풀이 여부와 관계없이 신규 미루기를 허용하지 않는다", async () => {
  const env = runtime({ limit: 0 });
  assert.equal((await submit(env)).body.code, "disabled");
  env.solve("2026-09-15");
  assert.equal((await submit(env)).body.code, "complete");
  assert.equal(env.writes.length, 0);
});

test("오래된 허용 화면도 요청 시점의 규칙 버전 N으로 다시 검사한다", async () => {
  const env = runtime({ limit: 7 });
  env.postpone("2026-09-15");
  env.setNow("2026-09-16T22:00:00+09:00");
  assert.equal((await status(env)).body.status.canPostpone, true);
  env.rows[env.table.versions].push({ study_id: "study", effective_from: "2026-09-16", rule_config: {},
    max_consecutive_postpone: 1, max_presolve_days: 2, postpone_deadline_hour: 23, postpone_deadline_minute: 59 });
  const result = await submit(env);
  assert.equal(result.httpStatus, 409);
  assert.equal(result.body.status.limit, 1);
  assert.equal((await dashboard(env, "2026-09")).body.todayPostponement.limit, 1);
  assert.equal(env.writes.length, 0);
});

test("동시 재요청은 한 날짜에 한 건만 저장한다", async () => {
  const env = runtime();
  const results = await Promise.all([submit(env), submit(env), submit(env)]);
  assert.equal(results.filter((result) => result.httpStatus === 200).length, 3);
  assert.equal(results.filter((result) => result.body.duplicate).length, 2);
  assert.equal(env.writes.length, 1);
});

test("미인증, 다른 멤버, 잘못된 입력은 저장하지 않는다", async () => {
  const env = runtime();
  assert.equal((await env.request("POST", { studyId: "study" }, { user: null })).httpStatus, 401);
  assert.equal((await env.request("POST", { studyId: "study" }, { user: "bob" })).httpStatus, 403);
  assert.equal((await env.request("POST", "{invalid")).httpStatus, 400);
  assert.equal((await env.request("POST", {})).httpStatus, 400);
  assert.equal((await env.request("GET", undefined, { url: "/api/postponements?studyId=study", user: "bob" })).httpStatus, 403);
  assert.equal(env.writes.length, 0);
});

test("다른 사용자의 풀이로 내 상한을 해제할 수 없다", async () => {
  const env = runtime();
  env.postpone("2026-09-15"); env.postpone("2026-09-16");
  env.setNow("2026-09-17T22:00:00+09:00");
  env.solve("2026-09-17", "Gold V", "bob");
  assert.equal((await submit(env)).httpStatus, 409);
  assert.equal(env.writes.length, 0);
});

test("기본 23:59 마감은 자정 이후 다시 열리지 않는다", async () => {
  const env = runtime();
  env.setNow("2026-09-15T23:59:59.999+09:00");
  assert.equal((await status(env)).body.status.canPostpone, true);
  env.setNow("2026-09-16T00:00:00+09:00");
  const result = await submit(env);
  assert.equal(result.httpStatus, 409);
  assert.equal(result.body.code, "deadline-passed");
  assert.equal(result.body.status.studyDate, "2026-09-15");
  assert.equal(env.writes.length, 0);
});

test("새벽 마감 설정은 같은 Study Day의 다음 날 마감으로 계산한다", async () => {
  const env = runtime();
  env.rows[env.table.studies][0].postpone_deadline_hour = 3;
  env.rows[env.table.studies][0].postpone_deadline_minute = 59;
  env.setNow("2026-09-16T03:59:59.999+09:00");
  assert.equal((await submit(env, { studyDate: "2026-09-15" })).httpStatus, 200);
  env.setNow("2026-09-16T04:00:00+09:00");
  const stale = await submit(env, { studyDate: "2026-09-15" });
  assert.equal(stale.httpStatus, 409);
  assert.equal(stale.body.code, "study-day-changed");
  assert.equal(env.writes.length, 1);
});

test("조회 중 마감이나 04:00을 지나면 저장하지 않는다", async () => {
  for (const crossing of ["2026-09-16T00:00:00+09:00", "2026-09-16T04:00:00+09:00"]) {
    const env = runtime();
    env.setNow("2026-09-15T23:59:59+09:00");
    env.setReadHook((table) => { if (table === env.table.submissions) env.setNow(crossing); });
    const result = await submit(env);
    assert.equal(result.httpStatus, 409);
    assert.equal(env.writes.length, 0);
  }
});

for (const key of ["studies", "members", "versions", "submissions", "postponements"]) {
  test(`${key} 조회 실패를 빈 이력으로 간주하지 않고 미루기를 차단한다`, async () => {
    const env = runtime(); env.fail(key);
    const result = await submit(env);
    assert.equal(result.httpStatus, 503);
    assert.equal(env.writes.length, 0);
    assert.doesNotMatch(JSON.stringify(result.body), /private database detail/);
  });
}

test("저장 실패는 성공이라고 응답하지 않는다", async () => {
  const env = runtime(); env.fail("postponements", "insert");
  assert.equal((await submit(env)).httpStatus, 503);
  assert.equal(env.writes.length, 0);
});

test("1,000행 이후의 상환도 포함하며 프로젝트 행 제한이 더 작아도 누락하지 않는다", async () => {
  const env = runtime({ cap: 100 });
  env.postpone("2026-09-15"); env.postpone("2026-09-16");
  env.setNow("2026-09-17T22:00:00+09:00");
  for (let i = 0; i < 1000; i += 1) env.solve("2026-09-17", "Bronze V");
  env.solve("2026-09-17");
  const result = await submit(env);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.backlogCount, 2);
  assert.ok(env.queries.some((query) => query.table === env.table.submissions && query.from >= 1000));
});

test("중간 페이지 실패 후 부분 이력으로 신청을 허용하지 않는다", async () => {
  const env = runtime();
  for (let i = 0; i < 501; i += 1) env.solve("2026-09-15", "Bronze V");
  env.fail("submissions", "select", 500);
  assert.equal((await submit(env)).httpStatus, 503);
  assert.equal(env.writes.length, 0);
});

test("과거 월의 아이콘에도 다음 달 상환을 반영하고 확정 벌금과 신청 이력은 보존한다", async () => {
  const env = runtime({ joined: "2026-09-30" });
  env.postpone("2026-09-30"); env.postpone("2026-10-01");
  env.setNow("2026-10-02T22:00:00+09:00");
  env.rows[env.table.penalties].push({ study_id: "study", user_id: "alice", study_date: "2026-09-30", amount: 25000, consecutive_misses: 2 });
  env.solve("2026-10-02");
  const september = await dashboard(env, "2026-09");
  assert.equal(september.httpStatus, 200);
  const day = september.body.days.find((row) => row.date === "2026-09-30").members[0];
  assert.equal(day.state, "complete");
  assert.equal(day.resolvedOn, "2026-10-02");
  assert.ok(day.postponedAt);
  assert.equal(day.penalty, 25000);
  assert.equal(day.submissions.length, 0, "실제 풀이 날짜는 이동하지 않는다");
  assert.equal(september.body.todayPostponement.canPostpone, true);
  assert.equal((await submit(env)).httpStatus, 200);
  const october = await dashboard(env, "2026-10");
  assert.equal(october.body.days.flatMap((row) => row.members).filter((member) => member.state === "postponed").length, 2);
  assert.equal(env.rows[env.table.penalties][0].amount, 25000);
  assert.equal(env.rows[env.table.postponements].length, 3, "완료된 과거 신청 이력은 삭제하지 않는다");
});

test("잠긴 버튼과 이유를 실제 React 컴포넌트에 렌더링한다", async () => {
  const env = runtime(); env.postpone("2026-09-15"); env.postpone("2026-09-16");
  env.setNow("2026-09-17T22:00:00+09:00");
  const decision = (await status(env)).body.status;
  const { PostponementControl } = env.load("src/components/postponement-control.tsx");
  const props = { studyId: "study", studyDate: "2026-09-17", onChanged: async () => {}, onMessage: () => {} };
  const html = renderToStaticMarkup(createElement(PostponementControl, { ...props, initialStatus: decision }));
  assert.match(html, /disabled=""/);
  assert.match(html, /미루기 불가/);
  assert.match(html, /1일치를 완전히 해결/);
  const unavailable = renderToStaticMarkup(createElement(PostponementControl, { ...props, initialStatus: null }));
  assert.match(unavailable, /disabled=""/);
  env.solve("2026-09-17");
  const allowed = (await status(env)).body.status;
  const ready = renderToStaticMarkup(createElement(PostponementControl, { ...props, initialStatus: allowed }));
  assert.doesNotMatch(ready, /disabled=""/);
  assert.match(ready, /오늘 미루기/);
});

test("미루기 응답은 공유 HTTP 캐시에 저장하지 않는다", async () => {
  const env = runtime();
  assert.match((await status(env)).headers.get("cache-control"), /no-store/);
  assert.match((await submit(env)).headers.get("cache-control"), /no-store/);
});

test("직접 INSERT 경로는 닫되 migration에 설정이나 과거 데이터 보정은 없다", () => {
  const sql = fs.readFileSync("supabase/migrations/202610160001_guard_postponement_writes.sql", "utf8");
  assert.match(sql, /drop policy hamster_postponements_self_insert on public\.hamster_postponements/i);
  assert.match(sql, /revoke insert on public\.hamster_postponements from anon, authenticated/i);
  assert.doesNotMatch(sql, /\b(update|delete|truncate)\b/i);
  assert.doesNotMatch(sql, /public\.(?!hamster_)/);
});
