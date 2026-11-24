import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { migrateRelease, migrationTarget, release, releaseMigrations } from "../scripts/migrate-release.mjs";

test("머지 마이그레이션은 전체 성공 시 한 번만 반영되며 과거 벌금은 보존된다", async t => {
  const db = new PGlite({extensions: {pgcrypto}});
  t.after(() => db.close());
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role bypassrls;`);
  const scans = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(scans)).sort().filter(name => name < "20261124")) {
    await db.exec(await readFile(new URL(file, scans), "utf8"));
  }
  const owner = "00000000-0000-4000-8000-000000000001";
  await db.query("insert into auth.users values ($1)", [owner]);
  const study = (await db.query("insert into public.hamster_studies(name,created_by) values('fixture',$1) returning id", [owner])).rows[0].id;
  await db.query("insert into public.hamster_penalties(study_id,user_id,study_date,consecutive_misses,amount) values($1,$2,'2025-03-01',1,137)", [study,owner]);
  const transaction = fn => db.transaction(tx => fn({
    exec: statement => tx.exec(statement),
    query: async (statement, values = []) => (await tx.query(statement, values)).rows,
  }));
  const plan = await releaseMigrations();
  const broken = {file: "synthetic_failure.sql", checksum: "injected", sql: "select 1/0"};
  await assert.rejects(migrateRelease(transaction, [...plan, broken]), /synthetic_failure/);
  assert.equal((await db.query("select to_regclass('public.hamster_schema_releases') as ledger")).rows[0].ledger, null);
  assert.equal((await db.query("select to_regclass('public.hamster_manual_receipts') as receipts")).rows[0].receipts, null);
  assert.equal(await migrateRelease(transaction, plan), plan.length);
  assert.equal(await migrateRelease(transaction, plan), 0);
  assert.deepEqual((await db.query("select file,checksum from public.hamster_schema_releases order by file")).rows,
    plan.map(({file, checksum}) => ({file, checksum})));
  await assert.rejects(migrateRelease(transaction, plan.map((m,i) => i === 0 ? {...m, checksum: "changed"} : m)), /history differs/);
  assert.equal((await db.query("select count(*)::int as n from public.hamster_finalization_cursor")).rows[0].n, 0);
  assert.deepEqual((await db.query("select study_date::text,amount from public.hamster_penalties")).rows, [{study_date:"2025-03-01",amount:137}]);
});

test("프리뷰는 DB를 호출하지 않고 운영·로컬 주소가 엇갈리면 접속 전에 거부한다", async () => {
  const env = {NEXT_PUBLIC_SUPABASE_URL: "https://testref.supabase.co",
    HAMSTER_MIGRATION_DATABASE_URL: "postgres://postgres.testref:example@aws-0-test.pooler.supabase.com:5432/postgres?sslmode=disable"};
  assert.equal(migrationTarget(env).search, "");
  assert.throws(() => migrationTarget({...env, NEXT_PUBLIC_SUPABASE_URL:"https://other.supabase.co"}), /differ/);
  assert.throws(() => migrationTarget({HAMSTER_TEST_DATABASE_URL: env.HAMSTER_MIGRATION_DATABASE_URL}, true), /loopback/);
  await release({...env, VERCEL_ENV:"preview"}, {request: () => assert.fail("preview network call")});
  await assert.rejects(release({...env, VERCEL_ENV:"production", VERCEL_GIT_COMMIT_REF:"feat/preview"}), /main/);

  const ledger = (await releaseMigrations()).map(({file,checksum}) => ({file,checksum}));
  const already = {NEXT_PUBLIC_SUPABASE_URL:env.NEXT_PUBLIC_SUPABASE_URL, VERCEL_ENV:"production",
    VERCEL_GIT_COMMIT_REF:"main", NEXT_PUBLIC_SUPABASE_ANON_KEY:"public-test", SUPABASE_SERVICE_ROLE_KEY:"server-test"};
  await release(already, {request: async url => Response.json(url.pathname.endsWith("hamster_schema_releases") ? ledger : true)});
});
