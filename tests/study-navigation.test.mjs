import assert from "node:assert/strict";
import test from "node:test";
import { accountDestination, forgetStudy, rememberAccountReturn, rememberedStudy, rememberStudy } from "../src/lib/study-navigation.ts";

const storage = () => {
  const entries = new Map();
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key),
  };
};

test("일반 가입은 탐색, 초대 중 가입은 원래 초대, 기존 회원은 자신의 달력으로 이동한다", () => {
  // This test file has its own Node test process and in-memory browser storage.
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage() });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage() });
  const location = { pathname: "/join/012345abcdef", search: "?from=message" };
  globalThis.window = { location };

  localStorage.setItem("hamster-study-id", "legacy-unowned-selection");
  rememberStudy("first", "first-study");
  assert.equal(rememberedStudy("new"), null);
  assert.equal(accountDestination(true), "/studies");
  rememberAccountReturn();
  assert.equal(accountDestination(true), location.pathname);
  assert.equal(accountDestination(), "/dashboard");

  location.pathname = "/dashboard";
  location.search = "?studyId=11111111-1111-1111-1111-111111111111";
  rememberAccountReturn();
  assert.equal(accountDestination(true), "/studies");
  rememberAccountReturn();
  assert.equal(accountDestination(), location.pathname + location.search);
  location.pathname = "//external.example";
  rememberAccountReturn();
  assert.equal(accountDestination(), "/dashboard");

  rememberStudy("new", "revoked-study");
  forgetStudy("new", "other-study");
  assert.equal(rememberedStudy("new"), "revoked-study");
  forgetStudy("new", "revoked-study");
  assert.equal(rememberedStudy("new"), null);
  assert.equal(rememberedStudy("first"), "first-study");
});
