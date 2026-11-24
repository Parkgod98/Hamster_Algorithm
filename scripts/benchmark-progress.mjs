// Isolated PostgreSQL/WASM; no network, environment credentials or production writes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { runtime } from "../tests/helpers/postponement-runtime.mjs";
import { measureSync } from "./measure-local-sync.mjs";

const db = new PGlite({ extensions: { pgcrypto } });
const today = new Date(Date.now() + 5*3600000).toISOString().slice(0,10);
const dayBefore = n => new Date(Date.parse(today+"T00:00:00Z") - n*86400000).toISOString().slice(0,10);
const variables = { HAMSTER_PROGRESS_MODE:"off", HAMSTER_PROGRESS_STUDIES:"*" };
const api = runtime({ variables });
api.setNow(today+"T12:00:00+09:00");
const { DB, RPC } = api.load("src/lib/db.ts");
const tables = new Set(Object.values(DB));
let rowsRead = 0;

// Translate the small read-only PostgREST surface used by these two real routes
// into bound SQL. Return the same date/timestamp JSON representation as PostgREST.
function tableQuery(table) {
  assert.ok(tables.has(table));
  let cols="*", size, start=0, single=false;
  const filters=[], args=[], order=[];
  const ident=name=>{assert.match(name,/^[a-z_]+$/); return '"'+name+'"';};
  const bind=value=>{args.push(value);return "$"+args.length;};
  const where=(k,op,v)=>{filters.push(ident(k)+op+bind(v));return q;};
  const q={
    select(v){cols=v.split(",").map(ident).join(",");return q;},
    eq:(k,v)=>where(k,"=",v), lt:(k,v)=>where(k,"<",v), lte:(k,v)=>where(k,"<=",v), gte:(k,v)=>where(k,">=",v),
    in(k,v){filters.push(ident(k)+" in ("+v.map(bind).join(",")+")");return q;},
    order(k,o){order.push(ident(k)+(o?.ascending===false?" desc":" asc"));return q;},
    range(a,b){start=a;size=b-a+1;return q;}, limit(n){size=n;return q;},
    maybeSingle(){single=true;return q;},single(){single=true;return q;},
    then(resolve,reject) {
      const sql="select "+cols+" from "+ident(table)+(filters.length?" where "+filters.join(" and "):"")+
        (order.length?" order by "+order.join(","):"")+(size===undefined?"":" limit "+Number(size))+" offset "+Number(start);
      return db.query("select row_to_json(s) as value from ("+sql+") s",args).then(r=>{
        rowsRead+=r.rows.length;
        const values=r.rows.map(row=>row.value);
        return {error:null,data:single?values[0]??null:values};
      }).then(resolve,reject);
    },
  };
  return q;
}
api.admin.from=tableQuery;
api.admin.rpc=async(name,args)=>{
  assert.ok([RPC.readProgressCheckpoints,RPC.saveProgressCheckpoints,RPC.guardedPostponement].includes(name));
  const values=Object.values(args).map(v=>v&&typeof v==="object"?JSON.stringify(v):v);
  const parameters=Object.keys(args).map((k,i)=>{assert.match(k,/^p_[a-z]+$/);return k+" => $"+(i+1);});
  const r=await db.query("select "+name+"("+parameters.join(",")+") result",values);
  const data=r.rows[0].result;
  // Count each returned member checkpoint as a logical row, not one JSON envelope.
  rowsRead+=data?.members ? 1+Object.keys(data.members).length : 1;
  return {data,error:null};
};
const dashboard=(study,user)=>api.request("GET",undefined,{user,url:"/api/dashboard?studyId="+study,
  route:"src/app/api/dashboard/route.ts"});
const postpone=(study,user,write=false)=>api.request(write?"POST":"GET",write?{studyId:study,studyDate:today}:undefined,
  {user,url:"/api/postponements?studyId="+study});
const p75=values=>Math.ceil([...values].sort((a,b)=>a-b)[Math.ceil(values.length*.75)-1]);

try {
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema realtime; create function realtime.send(payload jsonb,event text,topic text,private boolean)
    returns void language sql as $$select pg_notify('hamster_local_events',payload::text)$$;`);
  const dir=new URL("../supabase/migrations/",import.meta.url);
  const files=(await readdir(dir)).sort();
  const migrate=async arr=>{for(const f of arr)await db.exec(await readFile(new URL(f,dir),"utf8"));};
  await migrate(files.filter(n=>n<"202611230008"));
  const problem=randomUUID(), fixtures=[];
  await db.query("insert into hamster_problems(id,platform,external_id,title,difficulty) values($1,'BOJ','test','연습','Gold V')",[problem]);
  for (const members of [2,20]) for (const history of [30,365,730]) {
    const study=randomUUID(),users=Array.from({length:members},()=>randomUUID()),joined=dayBefore(history-1);
    await db.query("insert into auth.users select unnest($1::uuid[])",[users]);
    await db.query("insert into hamster_profiles(id,display_name) select unnest($1::uuid[]),'연습회원'",[users]);
    await db.query("insert into hamster_studies(id,name,created_by,created_at,postpone_deadline_hour,postpone_deadline_minute) values ($1,'연습',$2,$3,3,59)",
      [study,users[0],joined+"T04:00:00+09:00"]);
    await db.query("insert into hamster_study_members(study_id,user_id,display_name,joined_at) select $1,unnest($2::uuid[]),'회원',$3",
      [study,users,joined+"T04:00:00+09:00"]);
    await db.query(`insert into hamster_submissions(user_id,study_id,problem_id,solved_at,source,source_event_id)
      select u,$1,$2,d,'manual',u::text||':'||d::text from unnest($3::uuid[]) u
      cross join generate_series($4::timestamptz, $5::timestamptz,interval '1 day') d`,
      [study,problem,users,joined+"T12:00:00+09:00",dayBefore(1)+"T12:00:00+09:00"]);
    fixtures.push({study,users,members,history});
  }
  await migrate(files.filter(n=>n>="202611230008"));
  const results=[];
  const preparation=[];
  for(const {study,users,members,history} of fixtures) {
    variables.HAMSTER_PROGRESS_MODE="off";
    rowsRead=0;
    const fullStart=performance.now();
    const baseline=await dashboard(study,users[0]), fullMs=Math.ceil(performance.now()-fullStart),fullRows=rowsRead;
    const status=await postpone(study,users[0]);
    assert.equal(baseline.httpStatus,200);assert.equal(status.httpStatus,200);
    variables.HAMSTER_PROGRESS_MODE="shadow";
    rowsRead=0;
    const shadowStart=performance.now();
    const primed=await dashboard(study,users[0]);
    const shadowMs=Math.ceil(performance.now()-shadowStart),shadowRows=rowsRead;
    assert.equal(primed.httpStatus,200);
    variables.HAMSTER_PROGRESS_MODE="on";
    rowsRead=0;
    const active=await dashboard(study,users[0]), calendarRows=rowsRead;
    assert.equal(active.httpStatus,200);
    assert.deepEqual(active.body.days,baseline.body.days);
    assert.deepEqual(active.body.todayPostponement,baseline.body.todayPostponement);
    rowsRead=0;
    const current=await postpone(study,users[0]), postponeRows=rowsRead;
    assert.deepEqual(current.body,status.body);
    let errors=0;
    const durations=await Promise.all(Array.from({length:20},async(_,i)=>{
      const now=performance.now(), res=await dashboard(study,users[i%members]);
      if(res.httpStatus!==200)errors++;
      assert.deepEqual(res.body.days,baseline.body.days);
      return performance.now()-now;
    }));
    // Check the normal write path as well, with fully independent user actions.
    const saves=await Promise.all(users.map(async user=>{
      const now=performance.now(), res=await postpone(study,user,true);
      assert.equal(res.httpStatus,200,JSON.stringify(res.body));assert.equal(res.body.status.alreadyPostponed,true);
      return performance.now()-now;
    }));
    assert.equal(errors,0);
    assert.equal((await postpone(study, users[0], true)).body.duplicate, true);
    assert.equal((await db.query("select count(*)::int n from hamster_postponements where study_id=$1",[study])).rows[0].n,members);
    results.push({members,history,calendarRows,postponeRows,concurrentCalendar:20,errors,calendarP75ms:p75(durations),saveP75ms:p75(saves)});
    if (history === 730) {
      const checkpointCount = async () => (await db.query(
        "select count(*)::int n from hamster_progress_checkpoints where study_id=$1", [study])).rows[0].n;
      assert.equal(await checkpointCount(), members);
      await db.query("insert into hamster_postponements(study_id,user_id,study_date) values ($1,$2,$3)",
        [study,users[0],dayBefore(65)]);
      assert.equal(await checkpointCount(), members-1);
      rowsRead=0;
      const replayStart=performance.now();
      const replay=await dashboard(study,users[0]);
      const replayMs=Math.ceil(performance.now()-replayStart), replayRows=rowsRead;
      assert.equal(replay.httpStatus,200);
      assert.equal(await checkpointCount(), members);
      variables.HAMSTER_PROGRESS_MODE="off";
      const reference=await dashboard(study,users[0]);
      assert.deepEqual(replay.body.days,reference.body.days);
      assert.deepEqual(replay.body.todayPostponement,reference.body.todayPostponement);
      preparation.push({members,history,fullRows,fullMs,shadowRows,shadowMs,replayedMembers:1,replayRows,replayMs});
    }
  }
  for(const members of [2,20]){
    const measured=results.filter(r=>r.members===members);
    assert.equal(measured[1].calendarRows,measured[2].calendarRows);
    assert.equal(measured[1].postponeRows,measured[2].postponeRows);
  }
  console.table(results);
  console.table(preparation);
  variables.HAMSTER_PROGRESS_MODE="on";
  const {study, users} = fixtures[0];
  await db.query("delete from hamster_postponements where study_id=$1 and study_date=$2",[study,today]);
  await measureSync({db, api, study, users, today,
    postpone: () => postpone(study,users[0],true),
    solve: () => db.query(`insert into hamster_submissions(user_id,study_id,problem_id,solved_at,source,source_event_id)
      values($1,$2,$3,$4,'manual','local-sync-check')`,[users[0],study,problem,today+"T12:00:00+09:00"]),
  });
} finally { await db.close(); }
