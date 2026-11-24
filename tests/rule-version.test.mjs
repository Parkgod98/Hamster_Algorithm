import test from "node:test";
import assert from "node:assert/strict";
import { goalsInPeriod, normalizeRuleVersions, rulesForDate } from "../src/lib/rule-version.ts";
import { DEFAULT_RULE_CONFIG, normalizeRuleConfig } from "../src/lib/rules.ts";

const initial = {
  effectiveFrom: "2026-09-01",
  ruleConfig: DEFAULT_RULE_CONFIG,
  postponeDeadlineHour: 23,
  postponeDeadlineMinute: 59,
  maxConsecutivePostpone: 2,
  maxPresolveDays: 2,
};

test("월별 통계는 기간 내에 실제로 허용된 목표만 사용한다", () => {
  const history = [initial, { ...initial, effectiveFrom: "2026-09-18", ruleConfig: { ...DEFAULT_RULE_CONFIG,
    goals: { ...DEFAULT_RULE_CONFIG.goals, allowed: ["english"] } } }];
  assert.deepEqual(goalsInPeriod(history, "2026-08-01", "2026-08-31"), []);
  assert.deepEqual(goalsInPeriod(history, "2026-09-01", "2026-09-17"), ["algorithm"]);
  assert.deepEqual(goalsInPeriod(history, "2026-09-01", "2026-09-30"), ["algorithm", "english"]);
  assert.deepEqual(goalsInPeriod(history, "2026-10-01", "2026-10-31"), ["english"]);
});

test("규칙 변경일 이전 날짜는 이전 규칙을 유지한다", () => {
  const versions = normalizeRuleVersions([
    {
      effective_from: "2026-09-10",
      rule_config: { ...DEFAULT_RULE_CONFIG, bojSilverCount: 3 },
      postpone_deadline_hour: 22,
      postpone_deadline_minute: 30,
      max_consecutive_postpone: 1,
      max_presolve_days: 1,
    },
  ], normalizeRuleConfig);
  assert.equal(rulesForDate([initial, ...versions], "2026-09-09").ruleConfig.bojSilverCount, 2);
  assert.equal(rulesForDate([initial, ...versions], "2026-09-10").ruleConfig.bojSilverCount, 3);
});

test("여러 규칙 이력 중 날짜에 맞는 가장 최근 버전을 선택한다", () => {
  const versions = normalizeRuleVersions([
    {
      effective_from: "2026-09-20",
      rule_config: { ...DEFAULT_RULE_CONFIG, bojGoldCount: 2 },
      postpone_deadline_hour: 21,
      postpone_deadline_minute: 0,
      max_consecutive_postpone: 1,
      max_presolve_days: 0,
    },
    {
      effective_from: "2026-09-10",
      rule_config: { ...DEFAULT_RULE_CONFIG, bojGoldCount: 3 },
      postpone_deadline_hour: 22,
      postpone_deadline_minute: 0,
      max_consecutive_postpone: 2,
      max_presolve_days: 1,
    },
  ], normalizeRuleConfig);
  assert.equal(rulesForDate([initial, ...versions], "2026-09-15").ruleConfig.bojGoldCount, 3);
  assert.equal(rulesForDate([initial, ...versions], "2026-09-21").ruleConfig.bojGoldCount, 2);
  assert.equal(rulesForDate([initial, ...versions], "2026-09-21").maxPresolveDays, 0);
});
