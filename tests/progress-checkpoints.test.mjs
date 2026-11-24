import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { evaluateTimelineByDay } from "../src/lib/progress.ts";
import { acceptFirstCalendarSnapshot, clearViewer, peekView, readView, staleColdCalendar, waitForViewCheck } from "../src/lib/view-cache.ts";

test("월 경계의 미해결 의무, 부분 풀이, 선풀이와 늦은 영어 보충을 그대로 이어 계산한다", () => {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const day = i => new Date(start+i*86400000).toISOString().slice(0,10);
  for (const daily of [0, 0.5, 2.5]) {
    const days = Array.from({length:40}, (_,i) => ({date:day(i),credits:i%5 === 2 ? 0.5 : daily,postponed:i%3===0}));
    const policies = date => date<day(6) ? {allowed:["english"],required:1}
      : date<day(21) ? {allowed:["algorithm","english"],required:2} : {allowed:["algorithm","english"],required:1};
    const manual = [{target:day(2),earned:day(30),goal:"english"},{target:day(19),earned:day(28),goal:"english"},
      {target:day(31),earned:day(29),goal:"english"}];
    const args = [day(38), ()=>2, policies, manual];
    const all = evaluateTimelineByDay(days,...args);
    let checkpoint;
    evaluateTimelineByDay(days.slice(0,25),...args,{captureDate:day(24),capture:value=>{checkpoint=value;}});
    const resumed = evaluateTimelineByDay(days.slice(25),...args,{initial:structuredClone(checkpoint)});
    assert.deepEqual(resumed, all.slice(25));
  }
});

test("첫 달력은 구독보다 먼저 열고 그 사이 들어온 변경만 다시 읽는다", async () => {
  const user="cold-start", key="calendar:s:2026-10";
  for (const revision of ["2","3"]) {
    const release=waitForViewCheck(user,true);
    const data={study:{id:"s"},readRevision:"2"};
    assert.deepEqual(await readView(user,key,async()=>data),data);
    release();
    acceptFirstCalendarSnapshot(user,{s:revision});
    assert.equal(!!peekView(user,key),revision==="2");
    assert.equal(staleColdCalendar(user,data),revision==="3");
    clearViewer(user);
  }
});

test("소급 쓰기·권한 변경은 같은 커밋에서 중간 상태를 폐기하고 오래된 계산 발행을 거절한다", async t => {
  const db=new PGlite({extensions:{pgcrypto}});
  t.after(()=>db.close());
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema realtime; create function realtime.send(jsonb,text,text,boolean) returns void language sql as 'select';`);
  const migrations=new URL("../supabase/migrations/",import.meta.url);
  for (const file of (await readdir(migrations)).filter(f=>f<="202611240006_progress_checkpoints.sql").sort()) {
    await db.exec(await readFile(new URL(file,migrations),"utf8"));
  }
  const user=randomUUID(),study=randomUUID();
  await db.query("insert into auth.users values($1)",[user]);
  await db.query("select hamster_register_account($1,'tester','테스터','x','memory','y','token')",[user]);
  await db.query("select hamster_create_community_study($1,$2,'모임','',true,'open','{}')",[user,study]);
  const read=async()=> (await db.query("select hamster_read_progress_checkpoints($1,$2,'2026-02-01') result",[study,user])).rows[0].result;
  const state={ version:1,through:"2025-12-31",open:[],carry:[] };
  const save=async rev=>(await db.query("select hamster_save_progress_checkpoints($1,$2,$3) saved",
    [study,rev,JSON.stringify({[user]:state})])).rows[0].saved;
  const initial=await read();
  assert.equal(await save(initial.revision),true);
  assert.deepEqual((await read()).members[user],state);
  const post=day=>db.query("insert into hamster_postponements(study_id,user_id,study_date) values($1,$2,$3)",[study,user,day]);
  await post("2026-01-02");
  assert.deepEqual((await read()).members[user],state);
  await post("2025-12-30");
  assert.deepEqual((await read()).members,{});
  assert.equal(await save(initial.revision),false);
  const fresh=await read();
  assert.equal(await save(fresh.revision),true);
  await db.query("update hamster_study_members set joined_at=joined_at-interval '1 day' where study_id=$1 and user_id=$2",[study,user]);
  assert.deepEqual((await read()).members,{});
});
