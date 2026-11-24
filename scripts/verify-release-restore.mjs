// Synthetic isolated PostgreSQL rehearsal. Requires the previous release commit locally.
// Does not accept a database URL, Supabase token, or Vercel credentials.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import ts from "typescript";

const previous = "696fa92c30db9d9a571516ef5ec9b30424b36f77";
const project = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const hash = value => createHash("sha256").update(value).digest("hex");
const study = randomUUID(), owner = randomUUID(), visitor = randomUUID();
const requestId = randomUUID();
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAecVbdAAAAABJRU5ErkJggg==", "base64");
const options = { extensions: { pgcrypto } };

function loadPrevious(path, imports = {}) {
  const source = execFileSync("git", ["show", previous + ":" + path], { cwd: project, encoding: "utf8" });
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exported = {};
  Function("require", "exports", "process", outputText)(id => {
    if (!(id in imports)) throw new Error("Unmapped previous-release dependency " + id);
    return imports[id];
  }, exported, { env: { NEXT_PUBLIC_SUPABASE_URL: "http://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture" } });
  return exported;
}

const names = loadPrevious("src/lib/db.ts");
const { DB, RPC } = names;
const oldCrypto = loadPrevious("src/lib/account-crypto.ts", {
  "node:crypto": nativeRequire("node:crypto"), "node:util": nativeRequire("node:util"),
});
const ownerSession = oldCrypto.newAccountToken(), visitorSession = oldCrypto.newAccountToken();

// The previous release's handlers and session checks execute unmodified.
// Only the PostgREST transport is adapted to the local PostgreSQL.
function previousServer(db) {
  const admin = {
    async rpc(name, p) {
      assert.equal(name, RPC.recordGoal);
      try {
        const { rows } = await db.query("select hamster_record_goal($1,$2,$3,$4,$5,$6) as id",
          [p.p_study, p.p_user, p.p_day, p.p_goal, p.p_type, p.p_photo]);
        return { data: rows[0].id };
      } catch (error) { return { error }; }
    },
    from(table) {
      const filters = new Map();
      let projection;
      return {
        select(fields) { projection = fields; return this; },
        eq(key, value) { filters.set(key, value); return this; },
        async maybeSingle() {
          const values = key => filters.get(key);
          let result;
          if (table === DB.accountSessions && projection === "user_id") {
            result = await db.query("select user_id from hamster_account_sessions where token_hash=$1", [values("token_hash")]);
          } else if (table === DB.studyMembers && projection === "user_id") {
            result = await db.query("select user_id from hamster_study_members where study_id=$1 and user_id=$2",
              [values("study_id"), values("user_id")]);
          } else if (table === DB.goalCompletions && projection === "photo_type") {
            result = await db.query("select photo_type from hamster_goal_completions where study_id=$1 and user_id=$2 and id=$3",
              [values("study_id"), values("user_id"), values("id")]);
          } else {
            assert.equal(table, DB.goalCompletions);
            assert.equal(projection, "photo_type,hamster_goal_photos(image)");
            result = await db.query(`select c.photo_type, json_build_object('image',p.image) as hamster_goal_photos
              from hamster_goal_completions c join hamster_goal_photos p on p.completion_id=c.id
              where c.study_id=$1 and c.id=$2`, [values("study_id"), values("id")]);
          }
          return { data: result.rows[0] ?? null };
        },
      };
    },
  };
  const imports = {
    "next/server": nativeRequire("next/server"),
    "@/lib/db": names,
    "@/lib/day-goals": {},
    "@/lib/supabase": loadPrevious("src/lib/supabase.ts", {
      "@supabase/supabase-js": { createClient: () => admin }, "./db": names, "./account-crypto": oldCrypto,
    }),
  };
  return {
    certify: loadPrevious("src/app/api/goals/route.ts", imports).POST,
    photo: loadPrevious("src/app/api/goals/photo/route.ts", imports).GET,
  };
}

async function verifyOldWrite(api, date) {
  const form = new FormData();
  form.set("studyId", study);
  form.set("date", date);
  form.set("goal", "english");
  form.set("photo", new Blob([image], { type: "image/png" }), "fixture.png");
  const response = await api.certify(new Request("http://fixture.invalid/api/goals", {
    method: "POST", headers: { authorization: "Bearer " + ownerSession }, body: form,
  }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.ok && result.hasPhoto && result.id);
  return result.id;
}

async function verifyOldRead(api, id) {
  const url = "http://fixture.invalid/api/goals/photo?studyId=" + study + "&id=" + id;
  const get = token => api.photo(new Request(url, { headers: { authorization: "Bearer " + token } }));
  const response = await get(ownerSession);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  assert.equal((await get(visitorSession)).status, 403);
  assert.equal((await get("missing")).status, 401);
}

async function snapshot(db) {
  const { rows } = await db.query(`select tablename from pg_tables
    where schemaname='public' and tablename ~ '^hamster_[a-z0-9_]+$' order by tablename`);
  const signatures = {};
  for (const table of ["auth.users", ...rows.map(r => 'public."' + r.tablename + '"')]) {
    const data = await db.query(`select count(*)::int as rows,
      md5(coalesce(string_agg(row_to_json(t)::text,chr(10) order by row_to_json(t)::text),'')) as checksum from ${table} t`);
    signatures[table] = data.rows[0];
  }
  return signatures;
}

const dir = new URL("../supabase/migrations/", import.meta.url);
const files = (await readdir(dir)).filter(name => name.endsWith(".sql")).sort();
const live = new PGlite(options);
let restored;
try {
  await live.exec(`create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role bypassrls;`);
  async function apply(list) {
    for (const file of list) await live.exec(await readFile(new URL(file, dir), "utf8"));
  }
  await apply(files.filter(file => file < "20261124"));
  for (const [user, nick, session] of [[owner, "owner", ownerSession], [visitor, "visitor", visitorSession]]) {
    await live.query("insert into auth.users values($1)", [user]);
    await live.query("select hamster_register_account($1,$2,$2,$3,'fixture',$4,$5)", [user,nick,hash(randomUUID()),hash(randomUUID()),hash(session)]);
  }
  const rule = { goals: { allowed: ["algorithm", "english"], mode: "count", required: 1, englishRule: "듣기" } };
  await live.query("insert into hamster_studies(id,name,created_by,created_at,rule_config) values($1,'fixture',$2,'2025-01-01',$3)", [study,owner,rule]);
  await live.query("insert into hamster_study_members(study_id,user_id,display_name,role,joined_at) values($1,$2,'owner','admin','2025-01-01')", [study,owner]);
  await live.query("select hamster_link_github_repositories($1,$2,99,'fixture',$3)", [owner,study,JSON.stringify([{ id: 77, full_name: "fixture/example" }])]);
  await live.query("insert into hamster_postponements(study_id,user_id,study_date) values($1,$2,'2025-01-02')", [study,owner]);
  await live.query("insert into hamster_penalties(study_id,user_id,study_date,consecutive_misses,amount) values($1,$2,'2025-01-03',1,157)", [study,owner]);
  const before = await verifyOldWrite(previousServer(live), "2025-01-04");
  await apply(files.filter(file => file >= "20261124"));

  const manual = db => db.query("select hamster_record_manual_batch($1,$2,$3,'2025-01-05','BOJ','Silver III',1,'manual:BOJ:SILVER-III') as inserted",
    [owner,study,requestId]);
  assert.equal((await manual(live)).rows[0].inserted, true);
  await live.query("select hamster_activate_finalization('2025-01-05')");
  await live.query("select hamster_finish_finalization_day('2025-01-05',0,'[]')");
  const rollbackStart = performance.now();
  const oldServer = previousServer(live);
  await verifyOldRead(oldServer, before);
  const after = await verifyOldWrite(oldServer, "2025-01-06");
  const rollbackMs = Math.round(performance.now() - rollbackStart);
  const expected = await snapshot(live);
  const backup = await live.dumpDataDir("gzip");
  const restoreStart = performance.now();
  restored = new PGlite({ ...options, loadDataDir: backup });
  assert.deepEqual(await snapshot(restored), expected);
  const recovered = previousServer(restored);
  await verifyOldRead(recovered, before);
  await verifyOldRead(recovered, after);
  assert.equal((await manual(restored)).rows[0].inserted, false);
  assert.equal((await restored.query("select role from hamster_study_members where study_id=$1 and user_id=$2", [study,owner])).rows[0].role, "admin");
  assert.deepEqual((await restored.query("select amount from hamster_penalties")).rows, [{ amount: 157 }]);
  assert.equal((await restored.query("select next_date::text from hamster_finalization_cursor")).rows[0].next_date, "2025-01-06");
  console.log(JSON.stringify({ previous: previous.slice(0,7), isolated: true, verifiedTables: Object.keys(expected).length,
    rollbackReadWriteMs: rollbackMs, restoreAndVerificationMs: Math.round(performance.now()-restoreStart) }));
} finally {
  await restored?.close();
  await live.close();
}
