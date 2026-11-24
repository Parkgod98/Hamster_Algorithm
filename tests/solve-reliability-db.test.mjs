import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

test("배포 전 인정량을 보존하고 수동 재시도와 벌금 마감을 원자적으로 기록한다", async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role bypassrls;`);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(dir)).sort();
  const migrate = async names => { for (const file of names) await db.exec(await readFile(new URL(file, dir), "utf8")); };
  await migrate(files.filter(file => file < "20261124"));
  const [user, study] = [randomUUID(), randomUUID()];
  await db.query("insert into auth.users values($1)", [user]);
  await db.query("insert into hamster_profiles(id,display_name) values($1,'스터디원')", [user]);
  await db.query("insert into hamster_studies(id,name,created_by,created_at) values($1,'연습',$2,'2025-01-01')", [study,user]);
  await db.query("insert into hamster_study_members(study_id,user_id,display_name,joined_at) values($1,$2,'스터디원','2025-01-01')", [study,user]);
  const repo = JSON.stringify([{id:11, full_name:"sample/repo"}]);
  await db.query("select hamster_link_github_repositories($1,$2,1,'sample',$3)", [user,study,repo]);
  const connection = (await db.query("select id from hamster_repository_connections")).rows[0].id;
  const save = (event, difficulty, day) => db.query("select * from hamster_record_github_solutions($1,'github',$2)", [connection,JSON.stringify([{
    platform:"BOJ", externalId:"1234", title:"연습", difficulty, sourceEventId:event, solvedAt:day+"T05:00:00Z",
  }])]);
  await save("old", "Silver", "2025-01-10");
  await migrate(files.filter(file => file >= "202611240001" && file < "202611240004"));
  await save("new", "Gold V", "2025-01-11");
  await save("old", "Silver III", "2025-01-10");
  const grades = await db.query("select source_event_id,earned_difficulty from hamster_submissions order by solved_at");
  assert.deepEqual(grades.rows.map(r=>r.earned_difficulty), ["Silver","Gold V"]);
  assert.deepEqual((await db.query("select difficulty from hamster_daily_solution_counts order by study_date")).rows.map(r=>r.difficulty), ["Silver","Gold V"]);
  assert.equal((await db.query("select difficulty from hamster_problems where external_id='1234'")).rows[0].difficulty,"Silver");
  const oldEmbed=await db.query("select p.difficulty from hamster_submissions s cross join lateral hamster_problems(s) p order by s.solved_at");
  assert.deepEqual(oldEmbed.rows.map(p=>p.difficulty),["Silver","Gold V"]);

  const key = randomUUID();
  const manual = (id, count=2) => db.query("select hamster_record_manual_batch($1,$2,$3,'2025-01-12','BOJ','Silver III',$4,'manual:BOJ:SILVER-III') as inserted", [user,study,id,count]);
  assert.equal((await manual(key)).rows[0].inserted,true);
  assert.equal((await manual(key)).rows[0].inserted,false);
  await assert.rejects(manual(key,1),e=>e.code==="22023");
  assert.equal((await manual(randomUUID())).rows[0].inserted,true);
  assert.equal((await db.query("select count(*)::int as n from hamster_submissions where source='manual'")).rows[0].n,4);

  const start = day => db.query("select hamster_activate_finalization($1) as cursor",[day]);
  const nextDay = () => db.query("select hamster_next_finalization_day() as cursor");
  const close = (day,rev,penalties=[]) => db.query("select hamster_finish_finalization_day($1,$2,$3) as n",[day,rev,JSON.stringify(penalties)]);
  const privileges = await db.query(`select
    has_function_privilege('anon','hamster_record_manual_batch(uuid,uuid,uuid,date,text,text,integer,text)','execute') as anonymous_registration,
    has_function_privilege('authenticated','hamster_finish_finalization_day(date,bigint,jsonb)','execute') as member_close,
    has_function_privilege('service_role','hamster_finish_finalization_day(date,bigint,jsonb)','execute') as service_close`);
  assert.deepEqual(privileges.rows,[{anonymous_registration:false,member_close:false,service_close:true}]);
  await db.exec("begin");
  await db.query("insert into hamster_penalties(study_id,user_id,study_date,consecutive_misses,amount) values($1,$2,'2025-01-11',1,111)",[study,user]);
  await db.exec("rollback");
  assert.equal((await nextDay()).rows[0].cursor,null);
  assert.equal((await db.query("select count(*)::integer n from hamster_finalization_cursor")).rows[0].n,0);
  assert.equal((await start("2025-01-11")).rows[0].cursor.day,"2025-01-11");
  await assert.rejects(db.query("insert into hamster_penalties(study_id,user_id,study_date,consecutive_misses,amount) values($1,$2,'2025-01-11',1,111)",[study,user]),e=>e.code==="55000");
  const receipt = {repository:{id:11},commits:[{timestamp:"2025-01-11T12:00:00Z"}]};
  await db.query("insert into hamster_webhook_events(delivery_id,event_name,repository_id,payload) values('waiting','push',11,$1)",[JSON.stringify(receipt)]);
  await assert.rejects(close("2025-01-11",0),e=>e.code==="55000");
  await db.exec("update hamster_webhook_events set processed_at=now(),payload=null where delivery_id='waiting'");
  await save("delayed","Gold V","2025-01-11");
  await assert.rejects(close("2025-01-11",0),e=>e.code==="40001");
  assert.equal((await start("2025-01-13")).rows[0].cursor.day,"2025-01-11");
  const next=(await nextDay()).rows[0].cursor;
  assert.equal(next.day,"2025-01-11");
  const entry={study_id:study,user_id:user,consecutive_misses:1,amount:123};
  assert.equal((await close(next.day,next.revision,[entry])).rows[0].n,1);
  assert.equal((await close(next.day,next.revision,[{...entry,amount:1}])).rows[0].n,0);
  await save("late-after-close","Gold V","2025-01-11");
  assert.equal((await db.query("select count(*)::int as n from hamster_late_solve_reviews")).rows[0].n,1);
  assert.deepEqual((await db.query("select amount from hamster_penalties")).rows,[{amount:123}]);
});
