import assert from "node:assert/strict";
import { test } from "node:test";
import { migrationFailure } from "../scripts/migrate-release.mjs";

test("마이그레이션 오류는 발생 단계와 알려진 코드만 표시한다", () => {
  const driverMessage = "Migration postgres://example:private@host/postgres";
  for (const code of ["SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ECONNRESET"]) {
    const error = Object.assign(new Error(driverMessage), { code });
    assert.equal(migrationFailure(error, false).message, `Database migration connection failed (${code}).`);
  }
  assert.equal(migrationFailure({ code: "42501", message: driverMessage }, true).message,
    "Database migration transaction failed (42501).");
  for (const code of ["PRIVATE_VALUE", driverMessage, undefined]) {
    assert.equal(migrationFailure({ code, message: driverMessage }, true).message,
      "Database migration transaction failed (DB_ERROR).");
  }
});
