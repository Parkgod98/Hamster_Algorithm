import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

test("스터디 공개 범위, 승인, 공동 스터디장과 초대 재방문을 실제 DB에서 보존한다", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(`create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role bypassrls;`);
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  const community = "202611230004_community.sql";
  for (const name of (await readdir(migrations)).sort().filter((n) => n < "202611230002" || n === community)) {
    await db.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  const owner = randomUUID(), member = randomUUID(), stranger = randomUUID(), studyId = randomUUID();
  for (const id of [owner, member, stranger]) {
    await db.query("insert into auth.users values ($1)", [id]);
    await db.query("insert into hamster_profiles(id,display_name) values ($1,'같은 닉네임')", [id]);
  }
  const create = (id) => db.query("select hamster_create_community_study($1,$2,'영어','소개',false,'approval',$3)", [
    owner, id, JSON.stringify({ goals: { allowed: ["english"], mode: "all", required: 1, englishRule: "듣기" } }),
  ]);
  await create(studyId);
  await create(studyId);
  await create(randomUUID());
  const list = async (actor, scope, code = null) => (await db.query(
    "select * from hamster_community_catalog($1,$2,'',$3,0)", [actor, scope, code])).rows;
  const manage = async (actor, action, target = null, policy = null) => (await db.query(
    "select hamster_administer_community_study($1,$2,$3,$4,'소개',true,$5) as result",
    [actor, studyId, action, target, policy])).rows[0].result;
  const join = async (actor, code) => (await db.query("select hamster_join_community_study($1,$2,$3) as result",
    [actor,studyId,code])).rows[0].result;
  const membership = async (actor) => (await db.query("select * from hamster_study_members where study_id=$1 and user_id=$2",
    [studyId,actor])).rows[0];

  assert.equal((await list(owner,"mine")).length, 2);
  assert.deepEqual(await list(member,"search"), []);
  await assert.rejects(join(member,null), (e) => e.code === "P0002");
  const { code } = await manage(owner,"invite");
  assert.deepEqual((await list(member,"invite",code))[0].goals.allowed, ["english"]);
  // Old clients also have to wait for a real approval.
  await db.query("insert into hamster_study_members(study_id,user_id,display_name) values ($1,$2,'구버전 가입')",
    [studyId,member]);
  assert.equal(await membership(member), undefined);
  assert.equal((await join(member,code)).status, "pending");
  assert.equal((await join(member,code)).status, "pending");
  assert.equal(Number((await list(member,"invite",code))[0].member_count), 1);
  assert.equal((await manage(owner,"read")).requests.length, 1);
  await manage(owner,"approve",member);
  await assert.rejects(manage(member,"invite"), (e) => e.code === "42501");
  await manage(owner,"promote",member);
  const previous = await membership(member);
  await join(member,code);
  await db.query(`insert into hamster_study_members(study_id,user_id,display_name,role)
    values ($1,$2,'옛 GitHub 이름','member') on conflict(study_id,user_id)
    do update set display_name=excluded.display_name,role=excluded.role`, [studyId,member]);
  assert.deepEqual(await membership(member), previous);
  assert.equal((await manage(member,"invite")).code, code);
  await manage(member,"configure",null,"open");
  assert.equal((await list(stranger,"search")).length, 1);
  assert.equal((await join(stranger,null)).status, "joined");
  assert.equal((await manage(owner,"read")).members.length, 3);
});
