import test from "node:test";
import assert from "node:assert/strict";
import { runtime } from "./helpers/postponement-runtime.mjs";

const calendar = (env, month = "2026-10") => env.request("GET", undefined, {
  url: `/api/dashboard?month=${month}`, route: "src/app/api/dashboard/route.ts",
});
const growth = (env, month = "2026-10", userId = "alice") => env.request("GET", undefined, {
  url: `/api/growth-stats?month=${month}&userId=${userId}`, route: "src/app/api/growth-stats/route.ts",
});
const dayPanel = (env, date) => env.request("GET", undefined, {
  url: "/api/dashboard/panel?studyId=study&view=day&date=" + date, route: "src/app/api/dashboard/panel/route.ts",
});
const condition = (query, op, key) => query.conditions.find((item) => item.op === op && item.key === key)?.value;

test("첫 변경과 내일 예약이 있어도 10월 10일의 실버는 개설 당시 규칙을 사용한다", async () => {
  const env = runtime({ joined: "2026-10-01" });
  env.setNow("2026-10-15T22:00:00+09:00");
  const initial = env.rows[env.table.versions][0];
  env.rows[env.table.versions].push(
    { ...initial, effective_from: "2026-10-15", rule_config: { bojSilverCount: 1 } },
    { ...initial, effective_from: "2026-10-16", rule_config: { bojSilverCount: 3 } },
  );
  env.rows[env.table.studies][0].rule_config = { bojSilverCount: 3 };
  env.solve("2026-10-10", "Silver III");
  env.solve("2026-10-15", "Silver III");
  const { body, httpStatus } = await calendar(env);
  assert.equal(httpStatus, 200);
  const creditOn = (date) => body.days.find((day) => day.date === date).members[0].directCredits;
  assert.equal(creditOn("2026-10-10"), 0.5);
  assert.equal(creditOn("2026-10-15"), 1);
  assert.equal(body.study.rules.bojSilverCount, 1);
  assert.equal(body.study.scheduledRules.ruleConfig.bojSilverCount, 3);
});

for (const cap of [1000, 100]) {
  test(`응답 제한 ${cap}: 1,004건 중 마지막 두 풀이를 달력과 성장 통계에 포함한다`, async () => {
    const env = runtime({ cap, joined: "2026-10-13" });
    env.setNow("2026-10-15T23:58:00+09:00");
    env.postpone("2026-10-13"); env.postpone("2026-10-14");
    for (let i = 0; i < 1002; i += 1) env.solve("2026-10-14", "Bronze V");
    for (const problemId of ["tail-a", "tail-b"]) {
      env.solve("2026-10-15");
      const row = env.rows[env.table.submissions].at(-1);
      row.source = "github";
      row.hamster_problems = { platform: "PROGRAMMERS", difficulty: "Level 2", external_id: problemId, title: problemId };
    }
    const result = await calendar(env);
    assert.equal(result.httpStatus, 200);
    const at = (date) => result.body.days.find((day) => day.date === date).members[0];
    assert.equal(at("2026-10-15").submissions, undefined);
    const details = await dayPanel(env,"2026-10-15");
    assert.deepEqual(details.body.submissions.map((item) => item.problemId), ["tail-a", "tail-b"]);
    assert.equal(at("2026-10-15").directCredits, 2);
    assert.equal(at("2026-10-13").state, "complete"); assert.equal(at("2026-10-14").state, "complete");
    assert.equal(result.body.todayPostponement.backlogCount, 1);
    const statistics = await growth(env);
    assert.equal(statistics.httpStatus, 200);
    assert.equal(statistics.body.report.total, 1004);
    assert.equal(statistics.body.report.daily.find((point) => point.date === "2026-10-15").total, 2);
    assert.ok(env.queries.some((query) => query.table === env.table.submissions && query.from >= 1000));
    assert.equal(env.writes.length, 0, "조회는 원본 기록을 수정하지 않는다");
  });
}

test("첫 표시는 일별 집계만 조회하고 상세 풀이는 선택한 하루만 조회한다", async () => {
  const env = runtime({ joined: "2026-09-30" });
  env.setNow("2026-10-02T22:00:00+09:00");
  env.solve("2026-09-30"); env.solve("2026-10-02");
  const result = await calendar(env);
  assert.equal(result.httpStatus, 200);
  assert.ok(env.queries.some(q => q.table === env.table.counts));
  assert.ok(!env.queries.some(q => [env.table.submissions,env.table.penalties,env.table.repositories].includes(q.table)));
  assert.equal(result.body.statistics, undefined);
  const detail = await dayPanel(env, "2026-10-02");
  assert.equal(detail.body.submissions.length, 1);
  const query = env.queries.find(q => q.table === env.table.submissions);
  assert.equal(condition(query,"gte","solved_at"),"2026-10-01T19:00:00.000Z");
  assert.equal(condition(query,"lt","solved_at"),"2026-10-02T19:00:00.000Z");
});

test("다른 멤버보다 늦게 참여한 사용자의 참여 전 풀이는 인증량으로 쓰지 않는다", async () => {
  const env = runtime({ joined: "2026-09-01" });
  env.rows[env.table.members].push({ study_id: "study", user_id: "bob", display_name: "Bob", joined_at: "2026-10-02T08:00:00+09:00" });
  env.setNow("2026-10-02T22:00:00+09:00");
  env.solve("2026-10-01", "Gold V", "bob");
  const result = await calendar(env);
  const bob = result.body.days.find((day) => day.date === "2026-10-02").members.find((member) => member.userId === "bob");
  assert.equal(bob.state, "in-progress"); assert.equal(bob.credits, 0);
});

test("미래 월을 열어도 오늘의 미루기 판정은 유지하고 미래 상세 조회는 생략한다", async () => {
  const env = runtime({ joined: "2026-10-15" });
  const result = await calendar(env, "2026-11");
  assert.equal(result.httpStatus, 200); assert.equal(result.body.month, "2026-11");
  assert.equal(result.body.todayPostponement.backlogCount, 1);
  assert.equal(env.queries.some((query) => query.table === env.table.submissions && query.columns.includes("title")), false);
});

test("성장 통계는 최근 3개월 Study Day 범위와 같은 Study 대상 권한을 유지한다", async () => {
  const env = runtime({ joined: "2026-07-01" }); env.setNow("2026-10-16T10:00:00+09:00");
  env.solve("2026-07-31"); env.solve("2026-08-01"); env.solve("2026-10-15"); env.solve("2026-11-01");
  const result = await growth(env);
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.report.recentMonths.map((point) => point.total), [1, 0, 1]);
  for (const query of env.queries.filter((entry) => entry.table === env.table.submissions)) {
    assert.equal(condition(query, "gte", "solved_at"), "2026-07-31T19:00:00.000Z");
    assert.equal(condition(query, "lt", "solved_at"), "2026-10-31T19:00:00.000Z");
    assert.equal(condition(query, "eq", "user_id"), "alice");
  }
  env.queries.length = 0;
  assert.equal((await growth(env, "2026-10", "outsider")).httpStatus, 403);
  assert.equal(env.queries.some((query) => query.table === env.table.submissions), false);
});

for (const endpoint of [calendar, growth]) {
  test(`${endpoint.name}: 중간 페이지 오류는 일부 통계를 정상 결과로 반환하지 않는다`, async () => {
    const env = runtime({ joined: "2026-10-15" });
    for (let i = 0; i < 501; i += 1) env.solve("2026-10-15", "Test " + i);
    env.fail(endpoint === calendar ? "counts" : "submissions", "select", 500);
    const result = await endpoint(env);
    assert.equal(result.httpStatus, 503);
    assert.equal(result.body.report, undefined); assert.equal(result.body.days, undefined);
    assert.doesNotMatch(JSON.stringify(result.body), /private database detail/);
    assert.match(result.headers.get("cache-control"), /no-store/);
  });
}
