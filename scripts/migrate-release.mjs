// Production runs after the application has built and before Vercel promotes it.
// The isolated integration test uses --local and a loopback-only database URL.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { checkDeployment } from "./check-deployment.mjs";

const baseline = "202611230008";
const directory = new URL("../supabase/migrations/", import.meta.url);
class ReleaseError extends Error {}

// Driver messages may include connection strings, SQL, and authentication details.
const connectionCodes = new Set([
  "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_DESTROYED", "CONNECTION_ENDED",
  "EAI_AGAIN", "ENOTFOUND", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT", "EPIPE",
  "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "EADDRNOTAVAIL", "SASL_SIGNATURE_MISMATCH",
  "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_NOT_YET_VALID", "CERT_HAS_EXPIRED", "CERT_REVOKED",
]);

export async function releaseMigrations() {
  const files = (await readdir(directory)).filter(file => /^\d{12}_[a-z\d_]+\.sql$/.test(file) && file.slice(0,12) > baseline).sort();
  return Promise.all(files.map(async file => {
    const sql = (await readFile(new URL(file, directory), "utf8")).replaceAll("\r\n", "\n");
    return {file, sql, checksum: createHash("sha256").update(sql).digest("hex")};
  }));
}

function appliedPrefix(rows, migrations) {
  for (const [i, row] of rows.entries()) {
    if (row.file !== migrations[i]?.file || row.checksum !== migrations[i]?.checksum) {
      throw new ReleaseError("Migration history differs from this release. Inspect the deployment before retrying.");
    }
  }
  return rows.length;
}

export async function migrateRelease(transaction, migrations) {
  return transaction(async db => {
    await db.exec("set local lock_timeout='5s'; set local statement_timeout='90s';");
    await db.query("select pg_advisory_xact_lock(hashtext('hamster_schema_release'),1)");
    const [previous] = await db.query(`select
      to_regprocedure('public.hamster_sync_snapshot(text)') is not null
      and to_regprocedure('public.hamster_record_github_solutions(uuid,text,jsonb,text)') is not null
      and to_regclass('public.hamster_account_sessions') is not null
      and to_regclass('public.hamster_study_rule_versions') is not null as present`);
    if (!previous.present) throw new ReleaseError("Existing hamster schema through 202611230008 is required.");
    await db.exec(`create table if not exists public.hamster_schema_releases (
      file text primary key, checksum text not null, applied_at timestamptz not null default clock_timestamp()
    );
    alter table public.hamster_schema_releases enable row level security;
    revoke all on public.hamster_schema_releases from public,anon,authenticated,service_role;
    grant select on public.hamster_schema_releases to service_role;`);
    const saved = await db.query("select file,checksum from public.hamster_schema_releases order by file");
    const missing = migrations.slice(appliedPrefix(saved, migrations));
    for (const migration of missing) {
      try {
        await db.exec(migration.sql);
        await db.query("insert into public.hamster_schema_releases(file,checksum) values($1,$2)",
          [migration.file, migration.checksum]);
      } catch (error) {
        // Database driver errors can carry SQL and connection details.
        throw new ReleaseError("Migration failed at " + migration.file + " (" + safeCode(error) + ").");
      }
    }
    if (missing.length) await db.exec("notify pgrst, 'reload schema'");
    return missing.length;
  });
}

function safeCode(error) {
  const code = error?.code;
  return typeof code === "string" && (/^[0-9A-Z]{5}$/.test(code) || connectionCodes.has(code))
    ? code : "DB_ERROR";
}

export function migrationFailure(error, transactionStarted) {
  if (error instanceof ReleaseError) return error;
  const stage = transactionStarted ? "transaction" : "connection";
  return new Error("Database migration " + stage + " failed (" + safeCode(error) + ").");
}

function apiUrl(env) {
  const publicUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  if (publicUrl.protocol !== "https:" || !/^[a-z0-9]+\.supabase\.co$/.test(publicUrl.hostname) ||
      publicUrl.port || publicUrl.username || publicUrl.password || publicUrl.pathname !== "/" ||
      (env.HAMSTER_EXPECTED_SUPABASE_HOST && env.HAMSTER_EXPECTED_SUPABASE_HOST !== publicUrl.hostname)) {
    throw new Error("Unexpected public Supabase project address.");
  }
  return publicUrl;
}

export function migrationTarget(env, local = false) {
  const value = local ? env.HAMSTER_TEST_DATABASE_URL :
    env.HAMSTER_MIGRATION_DATABASE_URL || env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL;
  if (!value) throw new Error("A production-only HAMSTER_MIGRATION_DATABASE_URL or integrated Postgres URL is required.");
  let url;
  try { url = new URL(value); } catch { throw new Error("Invalid database connection address."); }
  if (!["postgresql:","postgres:"].includes(url.protocol) || url.pathname !== "/postgres" || !url.username || !url.password) {
    throw new Error("Expected a PostgreSQL connection to database postgres.");
  }
  if (local) {
    if (!["127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("The test runner requires a loopback database.");
  } else {
    const project = apiUrl(env).hostname.split(".")[0];
    const direct = url.hostname === "db." + project + ".supabase.co";
    const pool = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
      decodeURIComponent(url.username).endsWith("." + project);
    if (!direct && !pool) throw new Error("Database connection and public Supabase project differ.");
  }
  // Only use the checked endpoint, user, password and database. Host, SSL and
  // session parameters from a connection string cannot override our settings.
  url.search = "";
  return url;
}

async function applyToDatabase(url, migrations, ssl) {
  const {default: postgres} = await import("postgres");
  let transactionStarted = false;
  try {
    const sql = postgres(url.href, {ssl, max: 1, prepare: false, connect_timeout: 10, onnotice: () => {}});
    try {
      return await migrateRelease(fn => sql.begin(tx => {
        transactionStarted = true;
        return fn({
          query: (statement, values = []) => tx.unsafe(statement, values),
          exec: statement => tx.unsafe(statement).simple(),
        });
      }), migrations);
    } finally { await sql.end({timeout: 5}); }
  } catch (error) {
    throw migrationFailure(error, transactionStarted);
  }
}

async function alreadyInstalled(env, migrations, request) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error("Missing Supabase deployment settings.");
  const url = new URL("/rest/v1/hamster_schema_releases?select=file,checksum&order=file", apiUrl(env));
  const headers = {apikey: key, ...(key.split(".").length === 3 ? {Authorization: "Bearer " + key} : {})};
  const response = await request(url, {headers, signal: AbortSignal.timeout(10000), redirect: "error"});
  if (response.status === 404) return false;
  if (!response.ok) throw new Error("Cannot verify the migration ledger (" + response.status + ").");
  return appliedPrefix(await response.json(), migrations) === migrations.length;
}

export async function release(env, {local = false, request = fetch} = {}) {
  if (!local && env.VERCEL_ENV !== "production") return;
  if (!local && env.VERCEL_GIT_COMMIT_REF !== "main") throw new Error("Only the production main branch may run database migrations.");
  const migrations = await releaseMigrations();
  if (local) {
    const applied = await applyToDatabase(migrationTarget(env, true), migrations, false);
    console.log("Isolated migration files applied:", applied);
    return;
  }
  if (!await alreadyInstalled(env, migrations, request)) {
    const ca = env.HAMSTER_MIGRATION_CA_CERT?.replaceAll("\\n", "\n");
    const applied = await applyToDatabase(migrationTarget(env), migrations, {rejectUnauthorized: true, ...(ca && {ca})});
    console.log("Hamster migration files applied:", applied);
  }
  // PostgREST reloads its schema asynchronously after COMMIT.
  for (let attempt = 1; ; attempt++) {
    try {
      await checkDeployment(env, request);
      if (!await alreadyInstalled(env, migrations, request)) throw new Error("Migration ledger is not ready.");
      break;
    } catch (error) {
      if (attempt === 8) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  console.log("Production schema and auth verified.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await release(process.env, {local: process.argv[2] === "--local"}); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
