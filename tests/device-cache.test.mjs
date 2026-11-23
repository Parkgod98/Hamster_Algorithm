import assert from "node:assert/strict";
import test from "node:test";
import { clearViewer, invalidateViews, listViewKeys, peekView, putView, readView, waitForViewCheck, watchView } from "../src/lib/view-cache.ts";
import { changedViews } from "../src/lib/view-changes.ts";

test("같은 조회는 합쳐 재사용하고 계정 로그아웃·무효화 후 늦은 응답을 버린다", async () => {
  const viewer = "reader", key = "day:study:today";
  let loads = 0;
  const load = () => Promise.resolve(++loads);
  assert.deepEqual(await Promise.all([readView(viewer,key,load), readView(viewer,key,load)]), [1,1]);
  assert.equal(await readView(viewer,key,load), 1);
  assert.equal(peekView("other",key), undefined);
  invalidateViews(viewer,["day:study:"]);
  const deferred = Promise.withResolvers();
  const pending = readView(viewer,key,() => deferred.promise);
  await Promise.resolve();
  clearViewer(viewer); deferred.resolve(9);
  await assert.rejects(pending, { name:"AbortError" });
  assert.equal(peekView(viewer,key), undefined);
  const release = waitForViewCheck(viewer);
  const after = readView(viewer,key,load);
  assert.equal(loads,1); release();
  assert.equal(await after,2);
  clearViewer(viewer);
  waitForViewCheck(viewer);
  const signedOut = readView(viewer,key,load);
  clearViewer(viewer);
  await assert.rejects(signedOut,{name:'AbortError'});
  assert.equal(loads,2);
  let reloads = 0;
  const unwatch = watchView(viewer,key,() => { reloads++; });
  putView(viewer,key,'cached');
  clearViewer(viewer,false);
  assert.equal(peekView(viewer,key),undefined);
  assert.equal(reloads,0);
  unwatch();
});

test("디스크 없이 사진 4장·달력 12개 및 전체 용량을 제한한다", () => {
  const user = "bounded";
  const writes = [];
  const original = Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{setItem:(...args)=>writes.push(args)}});
  try {
    for (let i=0;i<15;i++) putView(user,`calendar:s:${i}`,{ month: i });
    assert.equal(listViewKeys(user,"calendar:").length,12);
    for (let i=0;i<5;i++) putView(user,`photo:s:${i}`,new Blob(["i"]));
    assert.equal(listViewKeys(user,"photo:").length,4);
    putView(user,"large",new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]));
    assert.equal(peekView(user,"large"),undefined);
    for (let i=0;i<4;i++) putView(user,`image:${i}`,new Blob([new Uint8Array(2 * 1024 * 1024)]));
    assert.equal(listViewKeys(user,"calendar:").length,0);
    assert.deepEqual(writes,[]);
  } finally {
    clearViewer(user);
    if (original) Object.defineProperty(globalThis,"localStorage",original); else delete globalThis.localStorage;
  }
});

test("영어 완료는 해당 멤버와 날짜에만, 늦은 풀이는 이후 두 달 성장 통계에 반영한다", () => {
  const baseline={account:"0",catalog:"0",studies:{s:"10"},changes:{account:[],catalog:[],studies:{s:[]}}};
  const at=(revision,items)=>({...baseline,studies:{s:revision},changes:{...baseline.changes,studies:{s:items}}});
  const hint={rev:"11",kind:"goal",userId:"member",date:"2026-12-31",id:"img"};
  const one=changedViews(baseline,at("11",[hint]));
  assert.deepEqual(one.prefixes.sort(),["day:s:2026-12-31","photo:s:img"]);
  assert.deepEqual([...one.members.get("s")],["member"]);
  const solve=changedViews(baseline,at("11",[{...hint,kind:"submission"}]));
  assert.deepEqual(solve.prefixes.filter(k=>k.startsWith("growth:")),["growth:s:member:2026-12","growth:s:member:2027-01","growth:s:member:2027-02"]);
  assert.equal(changedViews(baseline,at("45",[])).prefixes.includes("calendar:s:"),true);
  assert.equal(changedViews(baseline,{...baseline,studies:{}}).prefixes.includes("photo:s:"),true);
});
