import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const TABLE = {
  studies: "hamster_studies", members: "hamster_study_members", versions: "hamster_study_rule_versions",
  submissions: "hamster_submissions", postponements: "hamster_postponements", penalties: "hamster_penalties",
  repositories: "hamster_repository_connections",
};

/** Real route, context loader and engine. Only Auth and Supabase I/O are doubles. No production access. */
export function runtime({ limit = 2, joined = "2026-09-15", cap = 1000 } = {}) {
  let clock = Date.parse(`${joined}T22:00:00+09:00`);
  let sequence = 0;
  const state = {
    failures: [], queries: [], writes: [], onRead: null,
    rows: Object.fromEntries(Object.values(TABLE).map((name) => [name, []])),
  };
  state.rows[TABLE.studies].push({ id: "study", name: "테스트 스터디", invite_code: "test", created_at: `${joined}T04:00:00+09:00`,
    max_presolve_days: 2, max_consecutive_postpone: limit, postpone_deadline_hour: 23, postpone_deadline_minute: 59, rule_config: {} });
  state.rows[TABLE.members].push({ study_id: "study", user_id: "alice", joined_at: `${joined}T04:00:00+09:00`, display_name: "테스트 사용자", role: "member" });
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.orders = []; this.mode = "select"; }
    select() { return this; }
    eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
    in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
    lt(key, value) { this.filters.push((row) => row[key] < value); return this; }
    lte(key, value) { this.filters.push((row) => row[key] <= value); return this; }
    gte(key, value) { this.filters.push((row) => row[key] >= value); return this; }
    order(key, options = {}) { this.orders.push([key, options.ascending !== false]); return this; }
    limit(size) { this.size = size; return this; }
    range(from, to) { this.from = from; this.to = to; return this; }
    maybeSingle() { this.singleRow = true; return this; }
    single() { this.singleRow = true; return this; }
    insert(rows) { this.mode = "insert"; this.input = Array.isArray(rows) ? rows : [rows]; return this; }
    then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject); }
    execute() {
      state.queries.push({ table: this.table, mode: this.mode, from: this.from ?? 0, to: this.to });
      const failure = state.failures.find((item) => item.table === this.table && (!item.mode || item.mode === this.mode)
        && (item.from === undefined || item.from === (this.from ?? 0)));
      if (failure) return { data: null, error: { code: "TEST_DB_FAILURE", message: "private database detail" } };
      if (this.mode === "insert") {
        if (this.table !== TABLE.postponements) throw new Error("Unexpected test write");
        for (const row of this.input) {
          if (state.rows[this.table].some((saved) => saved.study_id === row.study_id && saved.user_id === row.user_id && saved.study_date === row.study_date)) {
            return { data: null, error: { code: "23505" } };
          }
        }
        for (const row of this.input) {
          const saved = { ...row, id: `post-${++sequence}`, requested_at: new TestDate().toISOString() };
          state.rows[this.table].push(saved);
          state.writes.push(saved);
        }
        return { data: null, error: null };
      }
      state.onRead?.(this.table);
      let data = (state.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)));
      data.sort((a, b) => {
        for (const [key, ascending] of this.orders) {
          const compared = String(a[key]).localeCompare(String(b[key]));
          if (compared) return ascending ? compared : -compared;
        }
        return 0;
      });
      const from = this.from ?? 0;
      const size = Math.min(cap, this.size ?? Infinity, this.to === undefined ? Infinity : this.to - from + 1);
      data = structuredClone(data.slice(from, from + size));
      return { data: this.singleRow ? data[0] ?? null : data, error: null };
    }
  }
  const admin = { from: (table) => new Query(table) };
  const auth = {
    createAdminClient: () => admin,
    requireUser: async (request) => {
      const token = request.headers.get("authorization");
      if (!token?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
      return { id: token.slice(7) };
    },
  };
  const modules = new Map();
  function load(filename) {
    const absolute = path.resolve(root, filename);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const source = fs.readFileSync(absolute, "utf8");
    const compiled = ts.transpileModule(source, { fileName: absolute, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const module = { exports: {} };
    modules.set(absolute, module);
    const scopedRequire = (name) => {
      if (name === "@/lib/supabase") return auth;
      if (name === "@/lib/supabase-browser") return { browserSupabase: () => { throw new Error("Browser I/O in server test"); } };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : path.resolve(path.dirname(absolute), name);
        const found = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!found) throw new Error(`Missing source module: ${name}`);
        return load(found);
      }
      return nodeRequire(name);
    };
    new vm.Script(`(function(exports, require, module) { ${compiled}\n})`, { filename: absolute }).runInNewContext({
      Date: TestDate, Error, Request, Response, Headers, URL, URLSearchParams, console, setTimeout, clearTimeout,
    })(module.exports, scopedRequire, module);
    return module.exports;
  }
  async function request(method, body, { user = "alice", url = "/api/postponements", route = "src/app/api/postponements/route.ts" } = {}) {
    const handler = load(route)[method];
    const response = await handler(new Request(`https://hamster.test${url}`, {
      method, headers: { ...(user ? { Authorization: `Bearer ${user}` } : {}), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    }));
    return { httpStatus: response.status, body: await response.json(), headers: response.headers };
  }
  return {
    ...state, admin, load, request, table: TABLE,
    get now() { return new TestDate().toISOString(); },
    setNow(value) { clock = Date.parse(value); },
    setReadHook(fn) { state.onRead = fn; },
    solve(date, difficulty = "Gold V", user = "alice") {
      state.rows[TABLE.submissions].push({ id: `sub-${String(++sequence).padStart(8, "0")}`, study_id: "study", user_id: user,
        solved_at: new Date(`${date}T12:00:00+09:00`).toISOString(), source: "manual",
        hamster_problems: { platform: "BOJ", difficulty, external_id: `${sequence}`, title: "테스트 문제" } });
    },
    postpone(date) { state.rows[TABLE.postponements].push({ id: `post-${++sequence}`, study_id: "study", user_id: "alice",
      study_date: date, requested_at: new Date(`${date}T22:00:00+09:00`).toISOString() }); },
    fail(key, mode = "select", from) { state.failures.push({ table: TABLE[key], mode, from }); },
  };
}
