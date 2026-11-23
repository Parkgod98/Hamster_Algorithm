import assert from "node:assert/strict";
import { readFile,readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { answerKey,loginKey } from "../src/lib/account.ts";
import { hashSecret,verifySecret,newAccountToken,tokenHash } from "../src/lib/account-crypto.ts";

test("계정 전환과 로그인 및 GitHub 재처리를 실제 SQL로 검증한다",async (t)=>{
  const db=new PGlite({extensions:{pgcrypto}});
  t.after(()=>db.close());
  const user="00000000-0000-4000-a000-000000000099";
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role bypassrls;`);
  const dir=new URL("../supabase/migrations/",import.meta.url);
  for(const filename of (await readdir(dir)).sort().filter(name=> name < "202611230003" || name.endsWith("_github_collection.sql"))){
    await db.exec(await readFile(new URL(filename,dir),"utf8"));
  }
  await db.query("insert into auth.users values ($1)",[user]);
  await db.query("insert into hamster_profiles(id,display_name) values ($1,'이전닉')",[user]);
  const study=async(name,config,joined="2026-10-01")=>{
    const result=await db.query(`insert into hamster_studies(name,created_by,created_at,rule_config)
      values ($1,$2,'2026-10-01T05:00:00+09:00',$3) returning id`,[name,user,JSON.stringify(config)]);
    const id=result.rows[0].id;
    await db.query("insert into hamster_study_members(study_id,user_id,display_name,role,joined_at) values ($1,$2,'이전닉','admin',$3)",[id,user,joined+"T12:00:00+09:00"]);
    return id;
  };
  const first=await study("알고 1",{bojSilverCount:1});
  const second=await study("알고 2",{bojSilverCount:2});
  await study("영어",{goals:{allowed:["english"]}});
  await study("나중 가입",{bojSilverCount:1},"2026-10-17");

  await t.test("같은 UUID와 역할을 유지하고 재설정 직전 비밀번호로 세션을 만들 수 없다",async()=>{
    const token=newAccountToken();
    const password=await hashSecret("비밀번호 여덟 글자");
    const answer=await hashSecret(answerKey("  내  햄쮸  "));
    assert.equal(await verifySecret("내 햄쮸",answer),true);
    assert.equal(await verifySecret("다른 답변",answer),false);
    assert.equal(loginKey("  HAm  "),"ham");
    await db.query("select hamster_register_account($1,'ham','새닉',$2,'treasure',$3,$4)",[user,password,answer,tokenHash(token)]);
    const names=await db.query("select user_id,display_name,role from hamster_study_members");
    assert.ok(names.rows.every(m=>m.user_id===user && m.role==="admin" && m.display_name==="새닉"));
    await db.query("update hamster_profiles set display_name='GitHub 닉네임' where id=$1",[user]);
    assert.equal((await db.query("select display_name from hamster_profiles where id=$1",[user])).rows[0].display_name,"새닉");
    await db.query("select hamster_rename_account($1,'새 계정 닉네임')",[user]);
    assert.ok((await db.query("select display_name from hamster_study_members")).rows.every(m=>m.display_name==="새 계정 닉네임"));
    assert.equal((await db.query("select hamster_start_account_session($1,$2,'second') ok",[user,password])).rows[0].ok,true);
    const next=await hashSecret("새 비밀번호 여덟 글자");
    assert.equal((await db.query("select hamster_reset_account_password($1,$2,$3) ok",[user,password,next])).rows[0].ok,true);
    assert.equal((await db.query("select count(*)::int n from hamster_account_sessions")).rows[0].n,0);
    assert.equal((await db.query("select hamster_start_account_session($1,$2,'stale') ok",[user,password])).rows[0].ok,false);
  });

  await t.test("수집 도중 실패한 뒤 한 번씩만 기록하고 참여일과 목표를 확인한다",async()=>{
    await db.query("select hamster_link_github_repositories($1,$2,1,'owner',$3)",[user,first,JSON.stringify([{id:51,full_name:"owner/algo"}])]);
    const conn=(await db.query("select id from hamster_repository_connections")).rows[0].id;
    await db.exec("insert into hamster_webhook_events(delivery_id,event_name,payload) values ('push-1','push','{}')");
    const saved=(items)=>db.query("select * from hamster_record_github_solutions($1,'github',$2,'push-1')",[conn,JSON.stringify(items)]);
    const item={platform:"BOJ",externalId:"1001",title:"test",difficulty:"Silver I",solvedAt:"2026-10-15T07:00:00+09:00",sourceEventId:"github:51:sha:BOJ:1001"};
    await assert.rejects(saved([item,{...item,platform:"INVALID"}]));
    assert.equal((await db.query("select count(*)::int n from hamster_submissions")).rows[0].n,0);
    assert.equal((await db.query("select processed_at from hamster_webhook_events")).rows[0].processed_at,null);
    assert.deepEqual(new Set((await saved([item])).rows.map(row=>row.target_study)),new Set([first,second]));
    assert.equal((await saved([item])).rows.length,0);
    const duplicate=await db.query("select * from hamster_record_github_solutions($1,'backfill',$2,null)",[conn,JSON.stringify([item])]);
    assert.equal(duplicate.rows.length,0);
    assert.equal((await db.query("select count(*)::int n from hamster_submissions")).rows[0].n,2);
    await db.query(`insert into hamster_submissions(user_id,study_id,repository_connection_id,problem_id,solved_at,source,source_event_id)
      select user_id,study_id,repository_connection_id,problem_id,solved_at,'backfill','older-deploy'
      from hamster_submissions where source_event_id=$1 on conflict(source_event_id) do nothing`,[item.sourceEventId]);
    const legacyRows=await db.query("select study_id from hamster_submissions where source_event_id like 'older-deploy%'");
    assert.deepEqual(new Set(legacyRows.rows.map(row=>row.study_id)),new Set([first,second]));
  });
});
