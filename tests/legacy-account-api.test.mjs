import test from "node:test";
import assert from "node:assert/strict";
import { runtime } from "./helpers/postponement-runtime.mjs";

test("공유 GitHub 로그인만으로 전환하지 않고, 기존 햄쮸터 기록의 소유자만 같은 ID로 전환한다", async () => {
  const env = runtime();
  const { DB, RPC } = env.load("src/lib/db.ts");
  const account = (user, body) => env.request(body ? "POST" : "GET", body, { user, url: "/api/account", route: "src/app/api/account/route.ts" });
  const form = { action: "migrate", login: "oldmember", password: "local-test-password", nickname: "새 이름", question: "treasure", answer: "수첩" };
  env.rows[DB.profiles] = [{ id: "former", display_name: "기존 프로필" }];
  env.rows[DB.accountCredentials] = [];
  env.admin.rpc = async (name, args) => {
    assert.equal(name, RPC.registerAccount);
    assert.equal(args.p_user, "alice");
    env.rows[DB.accountCredentials].push({ user_id: args.p_user, login_id: args.p_login });
    return { error: null };
  };

  assert.deepEqual((await account("scheduler-only")).body, { status: "none" });
  assert.equal((await account("scheduler-only", form)).httpStatus, 403);
  assert.deepEqual((await account("former")).body, { status: "legacy", nickname: "기존 프로필" });
  assert.equal((await account("alice")).body.status, "legacy"); // membership without a profile
  const migrated = await account("alice", form);
  assert.equal(migrated.httpStatus, 201);
  assert.equal(migrated.body.userId, "alice");
  assert.equal((await account("alice")).body.status, "registered");
  assert.equal((await account("alice", form)).httpStatus, 409);
  env.fail("members");
  assert.equal((await account("scheduler-only")).httpStatus, 500);
});
