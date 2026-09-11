import test from "node:test";
import assert from "node:assert/strict";

function credit(platform, difficulty) {
  const d = difficulty.toUpperCase();
  if (platform === "BOJ" && /^SILVER\s+(I|II|III|IV|V)$/.test(d)) return .5;
  if (platform === "BOJ" && /^(GOLD|PLATINUM|DIAMOND|RUBY)\b/.test(d)) return 1;
  if (platform === "PROGRAMMERS" && /LEVEL\s+2/.test(d)) return 1;
  return 0;
}

test("Silver 두 문제는 하루 인증량이다", () => assert.equal(credit("BOJ","Silver III") * 2, 1));
test("Gold 한 문제는 하루 인증량이다", () => assert.equal(credit("BOJ","Gold V"), 1));
test("Programmers Lv2는 한 문제로 인정한다", () => assert.equal(credit("PROGRAMMERS","Level 2"), 1));
