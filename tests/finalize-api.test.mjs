import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime} from './helpers/finalize-runtime.mjs';

for(const cap of [1000,100])test(`전체 조회: ${cap}행 응답 제한에서도 1004번째 상환을 읽는다`,async()=>{
  const env=runtime({cap,joined:'2026-10-16'});
  for(let i=0;i<1002;i++)env.solve('2026-10-16','Bronze V');
  env.solve('2026-10-17');env.solve('2026-10-17');
  assert.equal((await env.request()).status,200);assert.equal(env.writes.length,0);
  assert.ok(env.queries.some(q=>q.table===env.table.submissions&&q.from>=1000));
});
for(const key of ['studies','members','submissions','postponements','versions','penalties'])test(`${key} 조회 실패는 500이며 벌금 저장이 없다`,async()=>{
  const env=runtime();env.fail(key);const r=await env.request();
  assert.equal(r.status,500);assert.equal(r.body.phase,'read');assert.equal(env.writes.length,0);
  assert.ok(!JSON.stringify(r).includes('private database detail'));
});
test('중간 페이지 오류는 부분 자료로 벌금을 만들지 않는다',async()=>{
  const env=runtime();for(let i=0;i<600;i++)env.solve('2026-10-17','Bronze V');
  env.fail('submissions',{from:500});assert.equal((await env.request()).status,500);assert.equal(env.writes.length,0);
});
test('null data도 성공한 빈 배열로 취급하지 않는다',async()=>{
  const env=runtime();env.fail('submissions',{nullData:true});assert.equal((await env.request()).status,500);assert.equal(env.writes.length,0);
});
test('문제 관계 누락은 0 credit이 아니라 조회 실패다',async()=>{
  const env=runtime();env.solve('2026-10-17');env.rows[env.table.submissions][0].hamster_problems=null;
  assert.equal((await env.request()).status,500);assert.equal(env.writes.length,0);
});
test('1000행 이후 미루기도 전부 읽는다',async()=>{
  const env=runtime();for(let i=0;i<1001;i++)env.postpone('2026-10-17',`0-${i}`);env.postpone('2026-10-17');
  assert.equal((await env.request()).status,200);assert.equal(env.writes.length,0);
});
test('반복 및 동시 확정은 동일 날짜 벌금 한 건만 저장한다',async()=>{
  const env=runtime();const results=await Promise.all([env.request(),env.request()]);
  assert.ok(results.every(r=>r.status===200));assert.equal(env.writes.length,1);assert.equal(env.writes[0].amount,10000);
  assert.equal((await env.request()).body.penalties,0);assert.equal(env.writes.length,1);
});
test('04:00 경계에서 이전 Study Day만 대상으로 삼는다',async()=>{
  const before=runtime({now:'2026-10-18T03:59:59.999+09:00'});const after=runtime({now:'2026-10-18T04:00:00+09:00'});
  assert.equal((await before.request()).body.target,'2026-10-16');assert.equal(before.writes.length,0);
  assert.equal((await after.request()).body.target,'2026-10-17');assert.equal(after.writes.length,1);
});
test('03:59:59 풀이만 이전 날짜에 포함하며 04:00 풀이는 제외한다',async()=>{
  const before=runtime();before.solve('2026-10-18T03:59:59.999+09:00');await before.request();assert.equal(before.writes.length,0);
  const after=runtime();after.solve('2026-10-18T04:00:00+09:00');await after.request();assert.equal(after.writes.length,1);
});
test('조회 중 04:00을 넘어도 시작 시점의 대상 날짜를 유지한다',async()=>{
  const env=runtime({joined:'2026-10-16',now:'2026-10-18T03:59:59+09:00'});env.setReadHook(()=>env.setNow('2026-10-18T04:01:00+09:00'));
  assert.equal((await env.request()).body.target,'2026-10-16');assert.equal(env.writes[0].study_date,'2026-10-16');
});
test('나중에 보충해 완료되어도 정상 확정 벌금은 그대로 보존한다',async()=>{
  const env=runtime();await env.request();const original=JSON.stringify(env.rows[env.table.penalties]);
  env.solve('2026-10-18');env.solve('2026-10-18');env.setNow('2026-10-19T04:05:00+09:00');await env.request();
  assert.equal(JSON.stringify(env.rows[env.table.penalties]),original);
});
test('가입 전 풀이와 다른 사용자·스터디 풀이는 상환에 쓰지 않는다',async()=>{
  const env=runtime();env.solve('2026-10-16');env.solve('2026-10-17','Gold V','bob');env.solve('2026-10-17','Gold V','alice','other');
  await env.request();assert.equal(env.writes.length,1);assert.equal(env.writes[0].amount,10000);
});
test('날짜별 규칙을 사용하고 미래 규칙은 적용하지 않는다',async()=>{
  const env=runtime();env.rows[env.table.versions].push({study_id:'study',effective_from:'2026-10-17',rule_config:{bojGoldCount:2,penalties:{1:12000}},max_presolve_days:2},
    {study_id:'study',effective_from:'2026-10-18',rule_config:{bojGoldCount:1,penalties:{1:99000}},max_presolve_days:2});
  env.solve('2026-10-17');await env.request();assert.equal(env.writes[0].amount,12000);
});
test('부분 credit은 의무 개수를 줄이지 않고 최고 벌금은 3단계다',async()=>{
  const env=runtime({joined:'2026-10-14'});env.solve('2026-10-17','Silver III');await env.request();
  assert.equal(env.writes[0].consecutive_misses,3);assert.equal(env.writes[0].amount,50000);
});
test('선풀이 credit은 원래 획득일부터 2일까지만 유효하다',async()=>{
  const env=runtime({joined:'2026-10-14'});for(let i=0;i<4;i++)env.solve('2026-10-14');await env.request();
  assert.equal(env.writes[0].amount,10000);
});
test('뒤 스터디의 조회 실패도 앞 스터디의 쓰기 전에 중단한다',async()=>{
  const env=runtime();env.rows[env.table.studies].push({...env.rows[env.table.studies][0],id:'zzz'});
  env.rows[env.table.members].push({study_id:'zzz',user_id:'bob',joined_at:'2026-10-17T04:00:00+09:00'});
  env.fail('submissions',{when:q=>q.filters.some(fn=>fn({study_id:'zzz',solved_at:'2026-10-17T12:00:00+09:00'}))&&q.filters.every(fn=>fn({study_id:'zzz',solved_at:'2026-10-17T12:00:00+09:00'}))});
  assert.equal((await env.request()).status,500);assert.equal(env.writes.length,0);
});
test('저장 실패는 실패로 반환하고 재시도 시 이미 저장된 원장은 보존한다',async()=>{
  const env=runtime();env.rows[env.table.members].push({study_id:'study',user_id:'bob',joined_at:'2026-10-17T04:00:00+09:00'});
  env.fail('penalties',{mode:'insert',when:q=>q.input.user_id==='bob'});
  const failed=await env.request();assert.equal(failed.status,500);assert.equal(failed.body.phase,'write');assert.equal(failed.body.penalties,1);
  const original=JSON.stringify(env.writes[0]);env.failures.length=0;await env.request();
  assert.equal(env.writes.length,2);assert.equal(JSON.stringify(env.writes[0]),original);
});
test('인증 실패 또는 cron secret 누락이면 DB에 접근하지 않는다',async()=>{
  const env=runtime();assert.equal((await env.request('wrong')).status,401);assert.equal(env.queries.length,0);
  const noSecret=runtime({secret:''});assert.equal((await noSecret.request('undefined')).status,401);assert.equal(noSecret.queries.length,0);
});
