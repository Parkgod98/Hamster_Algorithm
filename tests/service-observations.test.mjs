import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { closeHealth } from "../src/lib/close-health.ts";
import { expectedClosedDay } from "../src/lib/study-day.ts";
import { checkDeployment } from "../scripts/check-deployment.mjs";

test("마감 허용 지연 이후 실행 누락·진행 중·실패·복구를 구분한다", () => {
  const target = "2026-11-23";
  assert.equal(expectedClosedDay(new Date("2026-11-24T05:04:59+09:00")), "2026-11-22");
  assert.equal(expectedClosedDay(new Date("2026-11-24T05:05:00+09:00")), target);
  assert.equal(closeHealth(target, null, null).reason, "no-start-observed");
  const attempt = { target_day: target, stage: "started", error_code: null };
  assert.equal(closeHealth(target, target, attempt).reason, "worker-incomplete");
  assert.equal(closeHealth(target, target, { ...attempt, stage: "write", error_code: "55000" }).reason, "worker-failed");
  assert.equal(closeHealth(target, "2026-11-24", attempt).ok, true);
});

test("배포 전 인증과 실제 스키마를 읽어 다른 프로젝트·누락된 컬럼을 거부한다", async () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", HAMSTER_EXPECTED_SUPABASE_HOST: "example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "server" };
  const ok = async () => Response.json(true);
  await checkDeployment(env, ok);
  await assert.rejects(checkDeployment({ ...env, HAMSTER_EXPECTED_SUPABASE_HOST: "other.supabase.co" }, ok), /host mismatch/);
  await assert.rejects(checkDeployment(env, async url => Response.json(true, {status: url.pathname.endsWith("submissions") ? 400 : 200})), /grades/);
});

test("익명 집계가 모바일 성공 p75·실패 수·표본 부족을 따로 보고한다", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role service_role; create role anon; create role authenticated");
  await db.exec(await readFile(new URL("../supabase/migrations/202611240010_service_measurements.sql", import.meta.url), "utf8"));
  await db.exec("create table hamster_late_solve_reviews(study_date date)");
  await db.exec(`select hamster_record_action_timing('postpone',true,true,case when x<=23 then 900 else 1900 end)
    from generate_series(1,30) as x;
    select hamster_record_action_timing('postpone',true,false,400);
    select hamster_record_action_timing('calendar_cold',false,true,2000);`);
  const [result] = await db.exec(await readFile(new URL("../scripts/report-service.sql", import.meta.url), "utf8"));
  const postpone = result.rows.find(x => x.action === "postpone");
  assert.equal(Number(postpone.p75_ms_upper), 900);
  assert.equal(Number(postpone.successful_samples), 30);
  assert.equal(Number(postpone.unsuccessful_samples), 1);
  assert.equal(postpone.timing_result, "pass");
  assert.equal(result.rows.find(x => x.action === "calendar_cold").timing_result, "insufficient_samples");
});
