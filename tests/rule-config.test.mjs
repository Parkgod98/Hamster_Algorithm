import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RULE_CONFIG,
  normalizeRuleConfig,
  penaltyForConsecutiveMisses,
  submissionCredit,
} from "../src/lib/rules.ts";

test("기본 햄쮸터 문제 수는 기존 규칙과 같은 credit을 만든다", () => {
  assert.equal(submissionCredit("BOJ", "Bronze I"), 1 / 3);
  assert.equal(submissionCredit("BOJ", "Silver III"), 1 / 2);
  assert.equal(submissionCredit("BOJ", "Gold V"), 1);
  assert.equal(submissionCredit("PROGRAMMERS", "Level 1"), 1 / 3);
  assert.equal(submissionCredit("PROGRAMMERS", "Level 2"), 1);
  assert.equal(submissionCredit("SWEA", "D3"), 1 / 2);
  assert.equal(submissionCredit("SWEA", "D4"), 1);
  assert.equal(submissionCredit("CODETREE", "SAMSUNG"), 1);
});

test("Study별 필요 문제 수가 credit에 반영된다", () => {
  const config = normalizeRuleConfig({
    ...DEFAULT_RULE_CONFIG,
    bojSilverCount: 3,
    programmersHighCount: 2,
  });
  assert.equal(submissionCredit("BOJ", "Silver III", config), 1 / 3);
  assert.equal(submissionCredit("PROGRAMMERS", "Level 2", config), 1 / 2);
});

test("잘못된 rule config 값은 안전한 기본값으로 보정한다", () => {
  const config = normalizeRuleConfig({
    bojBronzeCount: 0,
    bojSilverCount: 100,
    penalties: { 1: -1, 2: 30000, 3: 2000000 },
  });
  assert.equal(config.bojBronzeCount, 3);
  assert.equal(config.bojSilverCount, 2);
  assert.equal(config.penalties[1], 10000);
  assert.equal(config.penalties[2], 30000);
  assert.equal(config.penalties[3], 50000);
});

test("Study별 벌금 설정을 사용하고 3일 초과도 최고 단계 금액으로 제한한다", () => {
  const config = normalizeRuleConfig({
    ...DEFAULT_RULE_CONFIG,
    penalties: { 1: 12000, 2: 30000, 3: 60000 },
  });
  assert.equal(penaltyForConsecutiveMisses(1, config), 12000);
  assert.equal(penaltyForConsecutiveMisses(3, config), 60000);
  assert.equal(penaltyForConsecutiveMisses(4, config), 60000);
  assert.equal(penaltyForConsecutiveMisses(10, config), 60000);
});
