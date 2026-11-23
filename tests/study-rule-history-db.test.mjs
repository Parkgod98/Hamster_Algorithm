import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { normalizeRuleConfig, submissionCredit } from "../src/lib/rules.ts";
import { normalizeRuleVersions, rulesForDate } from "../src/lib/rule-version.ts";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const repair = "202611230001_preserve_study_rule_history.sql";
const adminId = "00000000-0000-4000-a000-000000000001";
const memberId = "00000000-0000-4000-a000-000000000002";

test("개설·변경·기존 이력 복구를 실제 PostgreSQL에서 검증한다", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role bypassrls;
  `);
  await db.query("insert into auth.users values ($1), ($2)", [adminId, memberId]);
  const migrationSQL = (name) => readFile(new URL(name, migrations), "utf8");
  for (const name of (await readdir(migrations)).sort().filter((entry) => entry < repair)) {
    await db.exec(await migrationSQL(name));
  }
  async function createStudy(name, createdAt) {
    const result = await db.query(
      "insert into hamster_studies (name, created_by, created_at) values ($1, $2, $3) returning id",
      [name, adminId, createdAt],
    );
    return result.rows[0].id;
  }
  async function versions(id) {
    const result = await db.query(
      `select effective_from::text, rule_config, postpone_deadline_hour, postpone_deadline_minute,
        max_consecutive_postpone, max_presolve_days from hamster_study_rule_versions
        where study_id=$1 order by effective_from`,
      [id],
    );
    return normalizeRuleVersions(result.rows, normalizeRuleConfig);
  }
  const legacy = await createStudy("기존 스터디", "2026-10-01T04:00:00+09:00");
  await db.query("update hamster_studies set rule_config=jsonb_set(rule_config,'{bojSilverCount}','1') where id=$1", [legacy]);
  await db.query(`
    insert into hamster_study_rule_versions (study_id, effective_from, rule_config, postpone_deadline_hour,
      postpone_deadline_minute, max_consecutive_postpone, max_presolve_days, changed_by)
    select id, '2026-10-15', rule_config, postpone_deadline_hour, postpone_deadline_minute,
      max_consecutive_postpone, max_presolve_days, created_by from hamster_studies where id=$1
  `, [legacy]);
  const untouched = await createStudy("변경 없는 스터디", "2026-10-01T03:59:00+09:00");
  const ambiguous = await createStudy("저장 실패로 현재 값만 변경됨", "2026-10-01T05:00:00+09:00");
  await db.query("update hamster_studies set max_presolve_days=5 where id=$1", [ambiguous]);
  const sql = await migrationSQL(repair);
  await assert.rejects(db.exec(sql), (error) => error.message.includes(ambiguous));
  assert.equal((await versions(legacy)).length, 1, "실패한 보정 트랜잭션은 부분 반영되지 않는다");
  await db.query("delete from hamster_studies where id=$1", [ambiguous]);
  await db.exec(sql);

  await t.test("10월 10일 실버 1문제는 0.5, 15일부터는 1.0이다", async () => {
    const history = await versions(legacy);
    assert.deepEqual(history.map((item) => item.effectiveFrom), ["2026-10-01", "2026-10-15"]);
    assert.equal(submissionCredit("BOJ", "Silver I", rulesForDate(history, "2026-10-10").ruleConfig), 0.5);
    assert.equal(submissionCredit("BOJ", "Silver I", rulesForDate(history, "2026-10-15").ruleConfig), 1);
    assert.equal((await versions(untouched))[0].effectiveFrom, "2026-09-30");
  });
  await t.test("신규 개설 시 실제 초기값을 같은 트랜잭션으로 기록한다", async () => {
    const { rows } = await db.query(`
      insert into hamster_studies (name, created_by, created_at, max_presolve_days)
      values ('새 스터디', $1, '2026-10-15T03:59:59+09:00', 4) returning id
    `, [adminId]);
    const history = await versions(rows[0].id);
    assert.equal(history.length, 1);
    assert.equal(history[0].effectiveFrom, "2026-10-14");
    assert.equal(history[0].maxPresolveDays, 4);
    assert.throws(() => rulesForDate(history, "2026-10-13"), /Missing effective/);
  });
  await t.test("스터디장만 변경하고 같은 다음 인증일의 예약은 한 건이다", async () => {
    const studyId = await createStudy("예약 설정", new Date().toISOString());
    await db.query(`insert into hamster_study_members (study_id,user_id,display_name,role)
      values ($1,$2,'스터디장','admin'), ($1,$3,'회원','member')`, [studyId, adminId, memberId]);
    const schedule = (actor, count) => db.query(
      "select hamster_schedule_study_rules($1,$2,$3,23,59,2,2)::text as day",
      [studyId, actor, JSON.stringify({ ...normalizeRuleConfig({}), bojSilverCount: count })],
    );
    await assert.rejects(schedule(memberId, 9), (e) => e.code === "42501");
    assert.equal((await versions(studyId)).length, 1);
    const next = (await db.query("select (((now() at time zone 'Asia/Seoul') - interval '4 hours')::date+1)::text as day")).rows[0].day;
    assert.equal((await schedule(adminId, 3)).rows[0].day, next);
    await schedule(adminId, 4);
    const history = await versions(studyId);
    assert.equal(history.length, 2);
    assert.equal(history.at(-1).ruleConfig.bojSilverCount, 4);
    assert.equal(history[0].ruleConfig.bojSilverCount, 2);
    const archived = await db.query(
      "select snapshot from hamster_superseded_rule_versions where study_id=$1", [studyId],
    );
    assert.deepEqual(archived.rows.map((r) => r.snapshot.rule_config.bojSilverCount), [3]);
    assert.equal(archived.rows[0].snapshot.changed_by, adminId);
  });
  await t.test("스터디 회원의 날짜별 영어 인증 · 사진 저장 · 재전송을 함께 검증한다", async () => {
    await db.exec(await migrationSQL("202611230003_study_goals.sql"));
    const policy = { allowed: ["english"], mode: "all", required: 1, englishRule: "오늘의 회화" };
    const { rows: [study] } = await db.query(
      "insert into hamster_studies (name,created_by,rule_config) values ('영어',$1,$2) returning id",
      [adminId, JSON.stringify({ ...normalizeRuleConfig({}), goals: policy })]);
    await db.query("insert into hamster_study_members(study_id,user_id,display_name) values ($1,$2,'공부중')", [study.id, adminId]);
    const today = "((now() at time zone 'Asia/Seoul') - interval '4 hours')::date";
    const save = (user, offset, photo = null) => db.query(
      `select hamster_record_goal($1,$2,${today} + $3::int,'english',$4,$5) as id`,
      [study.id, user, offset, photo && "image/png", photo]);
    await assert.rejects(save(memberId, 0), (e) => e.code === "42501");
    await assert.rejects(save(adminId, 3), (e) => e.message === "presolve_limit");
    await save(adminId, 0);
    const { rows: first } = await save(adminId, 2, "aGk=");
    assert.equal((await save(adminId, 2)).rows[0].id, first[0].id);
    assert.equal((await db.query("select count(*)::int as n from hamster_goal_completions")).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::int as n from hamster_goal_photos")).rows[0].n, 1);
    const result = await db.query("select has_table_privilege('authenticated','hamster_goal_photos','SELECT') as direct");
    assert.equal(result.rows[0].direct, false);

    await db.exec(await migrationSQL("202611230005_daily_solution_counts.sql"));
    const { rows: [problem] } = await db.query("insert into hamster_problems(platform,external_id,title,difficulty) values ('BOJ','example','예제','Silver I') returning id");
    await db.query("insert into hamster_goal_completions(study_id,user_id,study_date,goal,created_at) values ($1,$2,'2026-10-09','english','2026-10-10T12:00:00+09:00')",
      [study.id, adminId]);
    await db.query(`insert into hamster_submissions (study_id,user_id,problem_id,solved_at,source,source_event_id)
      select $1,$2,$3,ts,'manual',ts::text from unnest(array['2026-10-10T08:00:00+09:00','2026-10-10T09:00:00+09:00',
      '2026-10-10T13:00:00+09:00']::timestamptz[]) ts`, [study.id, adminId, problem.id]);
    const counts = await db.query("select solves from hamster_daily_solution_counts where study_id=$1 order by solved_through", [study.id]);
    assert.deepEqual(counts.rows.map((row) => row.solves), [2,1]);
  });
});
