import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createViewerStream } from "../src/lib/sync-stream.ts";

test("실제 저장 시 변경 범위, 커밋·롤백, 로그 보존 한도와 세션 권한을 검증한다", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema realtime;
    create table realtime.sent(payload jsonb, event text, topic text, private boolean);
    create function realtime.send(jsonb,text,text,boolean) returns void language sql
      as 'insert into realtime.sent values ($1,$2,$3,$4)';`);
  const migrations = new URL("../supabase/migrations/",import.meta.url);
  for (const filename of (await readdir(migrations)).sort()) {
    await db.exec(await readFile(new URL(filename,migrations),"utf8"));
  }
  const [owner, outsider, study, problem, goal] = Array.from({length:5},() => randomUUID());
  for (const user of [owner, outsider]) {
    await db.query("insert into auth.users values ($1)",[user]);
    await db.query("select hamster_register_account($1,$2,'닉네임','x','memory','y',$2)",[user,user]);
  }
  const state = async user => (await db.query("select hamster_sync_snapshot($1) as value",[user])).rows[0].value;
  await db.query("select hamster_create_community_study($1,$2,'비공개','소개',false,'approval','{}')",[owner,study]);
  await db.query("insert into hamster_problems(id,platform,external_id,title,difficulty) values($1,'BOJ','999','연습','Silver I')",[problem]);
  const before = (await state(owner)).snapshot;
  const otherBefore = (await state(outsider)).snapshot;
  assert.deepEqual(otherBefore.studies,{});
  await db.exec("truncate realtime.sent");
  const solve = dbClient => dbClient.query(`insert into hamster_submissions(study_id,user_id,problem_id,solved_at,source,source_event_id)
    select $1,$2,$3,ts,'manual',ts::text from unnest(array['2026-11-23T02:00:00+09','2026-11-23T03:59:00+09']::timestamptz[]) ts`,
    [study,owner,problem]);
  await assert.rejects(db.transaction(async tx => { await solve(tx); throw Error("rollback"); }),/rollback/);
  assert.deepEqual((await state(owner)).snapshot,before);
  await db.transaction(async tx => {
    await solve(tx);
    await tx.query("insert into hamster_goal_completions(id,study_id,user_id,study_date,goal) values($1,$2,$3,'2026-11-23','english')",[goal,study,owner]);
    await tx.query("insert into hamster_goal_photos(completion_id,image) values($1,decode('ab','hex'))",[goal]);
  });
  const after = (await state(owner)).snapshot;
  assert.equal(+after.studies[study], +before.studies[study] + 2);
  const hints = after.changes.studies[study].filter(h => +h.rev > +before.studies[study]);
  assert.deepEqual(hints.map(h => [h.kind,h.date]).sort(),[["goal","2026-11-23"],["submission","2026-11-22"]]);
  assert.equal(hints.find(h => h.kind === "goal").id,goal);
  assert.ok(hints.every(h => h.userId === owner));
  assert.deepEqual((await state(outsider)).snapshot,otherBefore);
  const broadcasts = (await db.query("select * from realtime.sent")).rows;
  assert.equal(broadcasts.length,1);
  assert.equal(broadcasts[0].private,true);
  assert.deepEqual(Object.keys(broadcasts[0].payload),["routes"]);
  assert.ok(broadcasts[0].payload.routes.every(key => /^\w{32}$/.test(key)));

  await db.query("insert into hamster_join_requests(study_id,user_id) values($1,$2)",[study,outsider]);
  assert.equal((await state(owner)).snapshot.changes.account.at(-1).kind,"manage");
  assert.equal(JSON.stringify((await state(outsider)).snapshot).includes(study),false);
  await db.query("update hamster_studies set discoverable=true where id=$1",[study]);
  assert.equal(+(await state(outsider)).snapshot.catalog,+otherBefore.catalog+1);
  await db.query("select hamster_administer_community_study($1,$2,'approve',$3,null,null,null)",[owner,study,outsider]);
  assert.ok((await state(outsider)).snapshot.studies[study]);
  await db.query("delete from hamster_study_members where study_id=$1 and user_id=$2",[study,outsider]);
  assert.deepEqual((await state(outsider)).snapshot.studies,{});
  await db.query(`insert into hamster_penalties(study_id,user_id,study_date,consecutive_misses,amount)
    select $1,$2,date '2026-10-01'+i,1,100 from generate_series(0,39) i`,[study,owner]);
  const journal = (await state(owner)).snapshot.changes.studies[study];
  assert.equal(journal.length,32);
  assert.equal(+journal.at(-1).rev - +journal[0].rev,31);
  assert.ok(journal.every(h => h.kind === "penalty"));
  await db.query("delete from hamster_account_sessions where user_id=$1",[owner]);
  assert.equal(await state(owner),null);
  const permissions = (await db.query(`select has_function_privilege('anon','hamster_sync_snapshot(text)','execute') as rpc,
    has_table_privilege('authenticated','hamster_sync_heads','select') as journal,
    has_table_privilege('authenticated','hamster_sync_channel','select') as channel`)).rows[0];
  assert.deepEqual(permissions,{rpc:false,journal:false,channel:false});
});

test("스트림 개설 중 또는 조회 중에 도착한 신호를 보존하고 세션 해제 후 닫는다", async () => {
  let live;
  let reads = 0;
  let released = 0;
  let resolveRead;
  const initial = {
    topic:"server-only",routes:["my-account"],
    snapshot:{catalog:"0",account:"0",studies:{},changes:{catalog:[],account:[],studies:{}}},
  };
  const next = { ...initial, routes:["my-account","new-study"], snapshot:{
    ...initial.snapshot,account:"1",studies:{joined:"0"},changes:{catalog:[],account:[{kind:"mine",rev:"1"}],studies:{joined:[]}},
  }};
  const stream = createViewerStream(initial, () => {
    reads++;
    return new Promise(resolve => { resolveRead=resolve; });
  }, observer => { live=observer; return () => { released++; }; },new AbortController().signal);
  const reader=stream.getReader();
  const readText=async () => new TextDecoder().decode((await reader.read()).value);
  assert.deepEqual(JSON.parse((await readText()).slice(6)),initial.snapshot);
  live.wake(new Set(["unrelated"]));
  assert.equal(reads,0);
  live.ready();
  live.wake(new Set(["new-study"]));
  resolveRead(next);
  assert.deepEqual(JSON.parse((await readText()).slice(6)),next.snapshot);
  assert.equal(reads,2);
  assert.match(await readText(),/event: ready/);
  resolveRead(null);
  assert.match(await readText(),/event: unauthorized/);
  assert.equal((await reader.read()).done,true);
  assert.equal(released,1);
});
