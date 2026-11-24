import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runtime } from "./helpers/postponement-runtime.mjs";

test("수동 목표 하나를 등록하면 설정·인증·하루 판정·월 통계에서 함께 사용할 수 있다", async () => {
  // Add a descriptor only inside this isolated module graph. Exercise is not a released goal.
  const env = runtime({ transformSource(file, source) {
    if (file !== "src/lib/rules.ts") return source;
    return source.replace("export const GOALS = {", 'export const GOALS = { exercise: { label: "운동", input: "manual", mark: "◎", example: "걷기" },');
  } });
  const rules = env.load("src/lib/rules.ts");
  const policy = rules.withGoalInstructions({ ...rules.DEFAULT_GOALS, allowed: ["english", "exercise"], required: 2 }, "exercise", "20분 걷기");
  assert.equal(rules.validGoalPolicy(policy), true);
  assert.equal(rules.goalPolicy({ goals: policy }).instructions.exercise, "20분 걷기");

  const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
  const form = render(env.load("src/components/study-goal-fields.tsx").GoalPolicyFields, { value: policy, onChange() {} });
  assert.match(form, /운동 규칙/);
  assert.match(form, /20분 걷기/);
  const day = "2026-09-15";
  const detail = render(env.load("src/components/manual-goal-panel.tsx").ManualGoalPanel, {
    viewerId: "alice", studyId: "study", date: day, data: { policy, entries: [], canSubmit: true }, onChanged() {},
  });
  assert.match(detail, /운동 완료/);
  assert.match(detail, /20분 걷기/);

  const saved = [];
  env.admin.rpc = async (_, args) => {
    saved.push(args);
    const id = "cert-" + args.p_goal;
    env.rows[env.table.goals].push({id, study_id: args.p_study, user_id: args.p_user, study_date: args.p_day,
      goal: args.p_goal, created_at: env.now, photo_type: args.p_type});
    return { data: id, error: null };
  };
  const api = env.load("src/app/api/goals/route.ts");
  async function certify(goal) {
    const body = new FormData();
    for (const [key, value] of Object.entries({studyId: "study", date: day, goal})) body.set(key, value);
    return api.POST(new Request("https://hamster.test/api/goals", { method: "POST", headers: { Authorization: "Bearer alice" }, body }));
  }
  assert.equal((await certify("exercise")).status, 200);
  assert.equal(saved[0].p_goal, "exercise");
  assert.equal((await certify("not_registered")).status, 400);
  assert.equal(saved.length, 1);

  const { evaluateTimelineByDay } = env.load("src/lib/progress.ts");
  const evaluate = goals => evaluateTimelineByDay([{date: day, credits: 0, postponed: false}], day, () => 2, () => policy,
    goals.map(goal => ({target: day, earned: day, goal})))[0];
  assert.equal(evaluate(["exercise"]).state, "in-progress");
  const complete = evaluate(["english", "exercise"]);
  assert.equal(complete.state, "complete");
  env.rows[env.table.versions][0].rule_config = { goals: policy };
  assert.equal((await certify("english")).status, 200);
  const calendar = await env.request("GET", undefined, { url: "/api/dashboard?month=2026-09", route: "src/app/api/dashboard/route.ts" });
  assert.equal(calendar.httpStatus, 200);
  assert.deepEqual(calendar.body.monthGoals, ["english", "exercise"]);
  const calendarRow = calendar.body.days.find(item => item.date === day).members[0];
  assert.equal(calendarRow.state, "complete");
  assert.deepEqual([...calendarRow.completedGoals].sort(), ["english","exercise"]);

  const requests = [];
  env.load("src/components/use-study-panel.ts").useStudyPanel = (_, key, url) => {
    requests.push(url);
    return key.startsWith("penalty:") ? { data: { penalties: [] } } : null;
  };
  const { StudyStatistics } = env.load("src/components/study-statistics.tsx");
  const props = { month: "2026-09", heading: "9월", studyId: "study", viewerId: "alice", studyDate: day,
    days: calendar.body.days, members: [{name: "회원", userId: "alice"}],
    selectedUserId: "alice", onSelectUser() {}, onMove() {} };
  const stats = render(StudyStatistics, {...props, goals: policy.allowed});
  assert.match(stats, /운동 인증<\/span><strong>1일/);
  assert.doesNotMatch(stats, /풀이 성장/);
  assert.equal(requests.filter(url => url.startsWith("/api/growth-stats")).length, 0);
  const mixed = render(StudyStatistics, {...props, goals: ["algorithm", ...policy.allowed]});
  assert.match(mixed, /풀이 성장/);
  assert.match(mixed, /role="tablist"/);
  assert.match(mixed, /role="tabpanel"/);
  assert.equal(requests.filter(url => url.startsWith("/api/growth-stats")).length, 1);
});
