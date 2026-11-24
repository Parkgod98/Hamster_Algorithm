import assert from "node:assert/strict";
import { test } from "node:test";
import { liveDeployment, promotionTime } from "../src/lib/production-promotion.ts";
import { studyDateFromTimestamp } from "../src/lib/study-day.ts";

const sha = "a".repeat(40), host = "hamsteralgorithm-fixture-parkgod.vercel.app";
const prod = {VERCEL_ENV:"production", VERCEL_GIT_COMMIT_REF:"main", VERCEL_GIT_COMMIT_SHA:sha, VERCEL_URL:host};
const bot = {id:35613825,login:"vercel[bot]"};
const getRequest = origin => new Request(origin + "/api/release/activate", {headers:{"x-hamster-release-sha":sha}});

test("정식 운영 호스트·배포 커밋과 GitHub Vercel 승격 증거가 모두 맞아야 최초 마감을 연다", async () => {
  const location = getRequest("https://hamsteralgorithm.vercel.app");
  assert.equal(liveDeployment(location, {...prod,VERCEL_ENV:"preview"}),null);
  assert.equal(liveDeployment(getRequest("https://" + host), prod), null);
  assert.equal(liveDeployment(location,{...prod,VERCEL_GIT_COMMIT_SHA:"b".repeat(40)}),null);
  const target = liveDeployment(location, prod);
  assert.deepEqual(target,{sha,host});
  const deployment = {id:81,sha,environment:"Production",creator:bot};
  // Callback and retry after 04:00. Successful promotion was at 03:59 KST.
  const status = {state:"success",created_at:"2026-11-24T18:59:00Z",environment_url:"https://"+host,creator:bot};
  const afterFour = Date.parse("2026-11-24T19:10:00Z");
  const service = (d,s) => async url => {
    assert.ok(url.startsWith("https://api.github.com/repos/Parkgod98/Hamster_Algorithm/deployments"));
    return Response.json(url.includes("/statuses?") ? s : [d]);
  };
  const promotion = await promotionTime(target, service(deployment,[status]),afterFour);
  assert.equal(studyDateFromTimestamp(promotion),"2026-11-24");
  const repromoted = await promotionTime(target, service(deployment,[
    {...status,created_at:"2026-11-24T19:01:00Z"}, {...status,state:"inactive"}, status,
  ]),afterFour);
  assert.equal(studyDateFromTimestamp(repromoted),"2026-11-25");
  for (const [d,s] of [
    [{...deployment,sha:"b".repeat(40)},[status]], [deployment,[{...status,environment_url:"https://old.vercel.app"}]],
    [deployment,[{...status,state:"inactive"},status]], [deployment,[{...status,creator:{id:10,login:"other"}}]],
    [{...deployment,environment:"Preview"},[status]], [deployment,[{...status,created_at:"2027-01-01T00:00:00Z"}]],
  ]) await assert.rejects(promotionTime(target,service(d,s),afterFour),/No confirmed/);
});
