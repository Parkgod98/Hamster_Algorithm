import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createViewerStream } from "../src/lib/sync-stream.ts";
import { runtime } from "../tests/helpers/postponement-runtime.mjs";

// Two independent page heaps/identities, PostgreSQL journal and production SSE,
// invalidation and member-patch code. Local NOTIFY replaces hosted Realtime.
export async function measureSync({ db, api, study, users, today, postpone, solve }) {
  const observers = new Set();
  const clients = [];
  const calendarKey = "calendar:" + study + ":" + today.slice(0, 7);
  const stopListening = await db.listen("hamster_local_events", raw => {
    const payload = JSON.parse(raw);
    for (const observer of observers) observer.wake(payload.all ? null : new Set(payload.routes));
  });

  async function waitFor(check, label) {
    const deadline = performance.now() + 5000;
    while (!check()) {
      assert.ok(performance.now() < deadline, label);
      await sleep(5);
    }
  }

  try {
    for (const user of users) {
      const token = "local-session-" + user;
      await db.query(`insert into hamster_account_credentials(user_id,login_id,password_hash,question_id,answer_hash)
        values ($1,$2,'x','memory','y')`, [user, user]);
      await db.query("insert into hamster_account_sessions(token_hash,user_id) values($1,$2)", [token, user]);
      const readState = async () => (await db.query("select hamster_sync_snapshot($1) as state", [token])).rows[0].state;
      const getCalendar = url => api.request("GET", undefined, { user, url, route: "src/app/api/dashboard/route.ts" });
      const fetch = async (url, options) => {
        assert.equal(options.headers.Authorization, "Bearer " + token);
        if (url.startsWith("/api/dashboard?")) {
          const result = await getCalendar(url);
          return Response.json(result.body, { status: result.httpStatus });
        }
        assert.equal(url, "/api/sync/changes");
        const stream = createViewerStream(await readState(), readState, observer => {
          observers.add(observer);
          observer.ready();
          return () => observers.delete(observer);
        }, options.signal);
        return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
      };
      const session = { user: { id: user }, access_token: token };
      const browser = { session, globals: {
        window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
        navigator: { onLine: true }, fetch, TextDecoder, AbortController, AbortSignal, DOMException,
      } };
      const page = runtime({ browser });
      page.setNow(today + "T12:00:00+09:00");
      const cache = page.load("src/lib/view-cache.ts");
      const stop = page.load("src/lib/sync-client.ts").syncAccount(session);
      clients.push({ stop, cache, user });
      await waitFor(() => !cache.needsCalendarStamp(user), "Initial change stream did not arrive");
      const snapshot = await getCalendar("/api/dashboard?studyId=" + study);
      assert.equal(snapshot.httpStatus, 200);
      cache.putView(user, calendarKey, snapshot.body);
    }

    const state = ({ cache, user }) => cache.peekView(user, calendarKey)?.days
      .find(day => day.date === today)?.members.find(row => row.userId === users[0])?.state;
    assert.deepEqual(clients.map(state), ["in-progress", "in-progress"]);
    for (const [label, action, expected] of [
      ["postponement", async () => assert.equal((await postpone()).httpStatus, 200), "postponed"],
      ["algorithm submission", solve, "complete"],
    ]) {
      const start = performance.now();
      await action();
      await waitFor(() => clients.every(client => state(client) === expected), "Calendar patch missing for " + label);
      console.log("Both independent client caches reflected %s in %d ms (local NOTIFY + SSE).", label,
        Math.ceil(performance.now() - start));
    }
  } finally {
    for (const client of clients) client.stop();
    await stopListening();
  }
}
