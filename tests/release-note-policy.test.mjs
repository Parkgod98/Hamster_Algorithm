import assert from "node:assert/strict";
import { test } from "node:test";
import { requiresReleaseNote } from "../scripts/requires-release-note.mjs";

test("새 DB 설명만 추가할 때는 사용자 업데이트 공지를 띄우지 않는다", () => {
  const path = "supabase/migrations/202611240011_describe_timing_bucket.sql";
  const column = "comment on column public.hamster_action_timings.bucket_ms is 'Elapsed time in milliseconds.';";
  const check = (sql, status = "A") => requiresReleaseNote(status, path, () => sql);
  assert.equal(check(column), false);
  assert.equal(check("COMMENT ON TABLE public.hamster_studies IS 'Study settings.';"), false);
  assert.equal(check(column, "M"), true);
  assert.equal(check("", "D"), true);
  assert.equal(check(column + "\nalter table public.hamster_studies add column size integer;"), true);
  assert.equal(check("alter table public.hamster_studies add column size integer;"), true);
  assert.equal(check("comment on table public.unrelated is 'Study settings.';"), true);
  assert.equal(requiresReleaseNote("M", "src/app/page.tsx", () => column), true);
});
