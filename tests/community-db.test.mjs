import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { runtime } from "./helpers/postponement-runtime.mjs";

test("회원이 없다는 달력 응답은 대기 목록을 보존하고 대기자가 인증 사진을 열 수 없다", async () => {
  const env = runtime();
  const directory = env.load("src/lib/directory-cache.ts");
  const cache = env.load("src/lib/view-cache.ts");
  const key = directory.directoryKey("mine", "", 0);
  directory.rememberNoMembership("waiting");
  assert.equal(directory.knownEmptyDirectory("waiting"), true);
  assert.equal(cache.peekView("waiting", key), undefined);
  const list = { studies: [{id: "study", pending: true, memberRole: null}], nextOffset: null };
  cache.putView("waiting", key, list);
  directory.rememberNoMembership("waiting");
  assert.deepEqual(cache.peekView("waiting", key), list);
  cache.putView("waiting", key, { ...list, studies: [{id: "study", pending: false, memberRole: "member"}] });
  assert.equal(directory.knownEmptyDirectory("waiting"), false);
  const photo = env.load("src/app/api/goals/photo/route.ts");
  const response = await photo.GET(new Request("https://hamster.test/api/goals/photo?studyId=study&id=entry", {
    headers: { Authorization: "Bearer waiting" },
  }));
  assert.equal(response.status, 403);
  assert.equal(env.queries.some(q => q.table === env.table.goals), false);
});

test("스터디 공개 범위, 승인, 공동 스터디장과 초대 재방문을 실제 DB에서 보존한다", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(`create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role bypassrls;`);
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  const community = "202611230004_community.sql";
  for (const name of (await readdir(migrations)).sort().filter((n) => n < "202611230002" || n === community || n === "202611240004_invite_approval.sql")) {
    await db.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  const owner = randomUUID(), member = randomUUID(), stranger = randomUUID(), studyId = randomUUID();
  for (const id of [owner, member, stranger]) {
    await db.query("insert into auth.users values ($1)", [id]);
    await db.query("insert into hamster_profiles(id,display_name) values ($1,'같은 닉네임')", [id]);
  }
  const create = (id) => db.query("select hamster_create_community_study($1,$2,'영어','소개',false,'open',$3)", [
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
  const [preview] = await list(member,"invite",code);
  assert.equal(Number(preview.member_count), 1);
  assert.equal(preview.join_policy, "approval");
  assert.deepEqual(await list(member,"mine"), []);
  const [waiting] = await list(member,"mine-with-requests");
  assert.equal(waiting.id, studyId);
  assert.equal(waiting.pending, true);
  assert.equal(waiting.member_role, null);
  assert.deepEqual(await list(stranger,"mine-with-requests"), []);
  assert.equal((await manage(owner,"read")).requests.length, 1);
  await assert.rejects(manage(member,"read"), e => e.code === "42501");
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
  assert.equal((await join(stranger,code)).status, "pending");
  assert.equal((await join(stranger,null)).status, "joined");
  assert.equal((await list(stranger,"mine-with-requests"))[0].pending, false);
  assert.equal((await manage(owner,"read")).members.length, 3);
});
