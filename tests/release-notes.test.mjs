import assert from "node:assert/strict";
import { test } from "node:test";
import { hasReadRelease, releaseNote, rememberRelease } from "../src/lib/release-notes.ts";

test("다시 열면 읽은 공지를 건너뛰고 다음 버전과 다른 계정은 따로 안내한다", async () => {
  const disk = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value),
  } });
  try {
    assert.equal(hasReadRelease("member"), false);
    rememberRelease("member");
    // A new page has new module memory but retains the same account's receipt.
    const nextPage = await import("../src/lib/release-notes.ts?new-page");
    assert.equal(nextPage.hasReadRelease("member"), true);
    assert.equal(nextPage.hasReadRelease("other"), false);
    const nextVersion = releaseNote.version + 1;
    assert.equal(nextPage.hasReadRelease("member", nextVersion), false);
    nextPage.rememberRelease("member", nextVersion);
    rememberRelease("member", releaseNote.version);
    assert.equal(disk.get("hamster-release:member"), String(nextVersion));
    assert.equal(disk.size, 1);
  } finally { delete globalThis.localStorage; }
});
