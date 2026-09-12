import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRuleVersions, rulesForDate } from "../src/lib/rule-version.ts";
import { DEFAULT_RULE_CONFIG, normalizeRuleConfig } from "../src/lib/rules.ts";

const fallback = {
  effectiveFrom: "2026-09-01",
  ruleConfig: DEFAULT_RULE_CONFIG,
  postponeDeadlineHour: 23,
  postponeDeadlineMinute: 59,
  maxConsecutivePostpone: 2,
  maxPresolveDays: 2,
};

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
  assert.equal(rulesForDate(versions, "2026-09-09", fallback).ruleConfig.bojSilverCount, 2);
  assert.equal(rulesForDate(versions, "2026-09-10", fallback).ruleConfig.bojSilverCount, 3);
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
  assert.equal(rulesForDate(versions, "2026-09-15", fallback).ruleConfig.bojGoldCount, 3);
  assert.equal(rulesForDate(versions, "2026-09-21", fallback).ruleConfig.bojGoldCount, 2);
  assert.equal(rulesForDate(versions, "2026-09-21", fallback).maxPresolveDays, 0);
});
