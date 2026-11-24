// All identities, sessions and database connections belong to this disposable CI runner.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function loopback(value, port) {
  const url = new URL(value);
  assert.equal(url.hostname, "127.0.0.1", "Integration tests require a local stack");
  assert.equal(url.port, port);
  return url;
}

async function* events(response) {
  let buffer = "";
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      yield frame;
    }
  }
  throw new Error("The Realtime event stream closed before the update");
}

async function configure() {
  const local = JSON.parse(execFileSync("supabase", ["status", "--workdir", process.env.STACK, "-o", "json"]));
  loopback(local.API_URL, "54321");
  loopback(local.DB_URL, "54322");
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, HAMSTER_TEST_DATABASE_URL: local.DB_URL,
  };
  for (const [name, value] of Object.entries(env)) {
    assert.ok(typeof value === "string" && value.length && !/[\r\n]/.test(value), name);
    if (name !== "NEXT_PUBLIC_SUPABASE_URL") console.log("::add-mask::" + value);
    await appendFile(process.env.GITHUB_ENV, name + "=" + value + "\n");
  }
}

async function exercise(phase) {
  const app = loopback(process.env.NEXT_PUBLIC_APP_URL, "3412");
  const db = loopback(process.env.NEXT_PUBLIC_SUPABASE_URL, "54321");
  assert.equal(process.env.VERCEL_ENV, "preview");
  const fixture = join(process.env.RUNNER_TEMP, "hamster-preview-fixture.json");
  async function call(path, { token, body, expected = 200 } = {}) {
    const form = body instanceof FormData;
    const res = await fetch(new URL(path, app), {
      method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { ...(token && { Authorization: "Bearer " + token }), ...(body && !form && { "Content-Type": "application/json" }) },
      body: form ? body : body ? JSON.stringify(body) : undefined,
    });
    assert.equal(res.status, expected, path.split("?")[0] + " returned HTTP " + res.status);
    return res.status === 403 ? null : res.json();
  }
  async function rest(path, method = "GET", body) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(new URL("/rest/v1/" + path, db), {
      method, redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Prefer: "return=representation" },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.ok(res.ok, "PostgREST " + path.split("?")[0] + " returned HTTP " + res.status);
    return res.json();
  }
  const password = "preview-only-password";
  function register(login) {
    return call("/api/account", { body: { action: "register", login, password, nickname: "검증회원",
      question: "treasure", answer: "연습" }, expected: 201 });
  }
  if (phase === "before") {
    const login = "before-" + randomUUID().slice(0, 8);
    const owner = await register(login);
    const study = randomUUID();
    await call("/api/studies", { token: owner.token, expected: 201, body: {
      studyId: study, name: "프리뷰 인증 모임", description: "격리 검증", discoverable: false, joinPolicy: "open",
      goals: { allowed: ["algorithm", "english"], mode: "count", required: 1, englishRule: "영어 듣기" },
    } });
    // A full study-day deadline makes the same scenario valid before and after midnight.
    await rest("hamster_study_rule_versions?study_id=eq." + study, "PATCH", {
      postpone_deadline_hour: 3, postpone_deadline_minute: 59,
    });
    const [problem] = await rest("hamster_problems", "POST", {
      platform: "BOJ", external_id: "preview-legacy", title: "기존 풀이", difficulty: "Silver III",
    });
    await rest("hamster_submissions", "POST", { user_id: owner.userId, study_id: study, problem_id: problem.id,
      solved_at: new Date().toISOString(), source: "manual", source_event_id: "preview-legacy" });
    await writeFile(fixture, JSON.stringify({ owner, study, login, problem: problem.id }), { mode: 0o600 });
    console.log("Previous schema stored a member session, study and solution.");
    return;
  }
  assert.equal(phase, "after");
  for (let attempt = 0; ; attempt++) {
    const ready = await fetch(new URL("/api/health?mode=ready", app));
    if (ready.ok && (await ready.json()).ok) break;
    assert.ok(attempt < 15, "Release readiness did not succeed after migration and REST schema reload");
    await delay(500);
  }
  const { owner, study, login, problem } = JSON.parse(await readFile(fixture, "utf8"));
  assert.equal((await call("/api/account", { token: owner.token })).status, "active");
  assert.equal((await call("/api/account", { body: { action: "login", login, password } })).userId, owner.userId);
  await rest("hamster_problems?id=eq." + problem, "PATCH", { difficulty: "Gold I" });
  const [historical] = await rest("hamster_submissions?source_event_id=eq.preview-legacy&select=earned_difficulty,hamster_problems(difficulty)");
  assert.equal(historical.earned_difficulty, "Silver III");
  assert.equal(historical.hamster_problems.difficulty, "Silver III");

  const guest = await register("after-" + randomUUID().slice(0, 8));
  assert.equal((await call("/api/dashboard", { token: guest.token })).study, null);
  const invitation = await call("/api/studies/manage", { token: owner.token, body: { action: "invite", studyId: study } });
  const requested = await call("/api/studies/join", { token: guest.token, body: { code: invitation.code } });
  assert.equal(requested.status, "pending");
  assert.equal((await call("/api/studies?scope=mine", { token: guest.token })).studies[0].pending, true);
  await call("/api/dashboard?studyId=" + study, { token: guest.token, expected: 403 });
  await call("/api/studies/manage", { token: owner.token, body: { action: "approve", studyId: study, targetId: guest.userId } });
  const calendar = () => call("/api/dashboard?studyId=" + study, { token: guest.token });
  const day = (await calendar()).studyDate;
  const postpone = () => call("/api/postponements", { token: guest.token, body: { studyId: study, studyDate: day } });
  assert.equal((await postpone()).status.alreadyPostponed, true);
  assert.equal((await postpone()).duplicate, true);
  const snapshot = () => call("/api/sync/changes?once=1", { token: guest.token });
  const before = await snapshot();
  const form = new FormData();
  for (const [k, v] of [["studyId", study], ["date", day], ["goal", "english"]]) form.set(k, v);
  const stream = new AbortController();
  try {
    const response = await fetch(new URL("/api/sync/changes", app), {
      headers: { Authorization: "Bearer " + guest.token },
      signal: AbortSignal.any([stream.signal, AbortSignal.timeout(20000)]),
    });
    assert.ok(response.ok && response.headers.get("content-type")?.includes("text/event-stream"));
    const frames = events(response);
    while (!(await frames.next()).value.startsWith("event: ready\n")) { /* Wait for the subscribed server. */ }
    const start = performance.now();
    const completion = await call("/api/goals", { token: owner.token, body: form });
    assert.equal(completion.hasPhoto, false);
    for await (const frame of frames) {
      if (!frame.startsWith("data: ")) continue;
      const hints = JSON.parse(frame.slice(6)).changes.studies[study] ?? [];
      if (hints.some(hint => hint.kind === "goal" && hint.userId === owner.userId && hint.date === day)) break;
    }
    console.log("Second session received English completion over local Supabase Realtime/SSE in " + Math.ceil(performance.now() - start) + "ms.");
  } finally { stream.abort(); }
  assert.notDeepEqual(await snapshot(), before);
  const manual = { studyId: study, studyDate: day, platform: "BOJ", difficulty: "Silver III", count: 1, requestId: randomUUID() };
  await call("/api/submissions/manual", { token: owner.token, body: manual });
  assert.equal((await call("/api/submissions/manual", { token: owner.token, body: manual })).duplicate, true);
  assert.equal((await calendar()).study.id, study);
  console.log("HTTP readiness, existing session, login, immutable grades, invite approval, calendar, postponement, English completion, sync and manual retry passed.");
}

if (process.argv[2] === "config") await configure();
else await exercise(process.argv[2]);
