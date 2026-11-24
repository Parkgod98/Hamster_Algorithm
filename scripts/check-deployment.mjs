import { pathToFileURL } from "node:url";

// The production postbuild runs the same read-only probes after the transaction.
export async function checkDeployment(env, request = fetch) {
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  const expected = env.HAMSTER_EXPECTED_SUPABASE_HOST;
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
      (expected ? url.hostname !== expected : !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname))) {
    throw new Error("Supabase project host mismatch");
  }
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anon || !service) throw new Error("Missing Supabase deployment settings");
  const probes = [
    ["public auth", "/auth/v1/settings", anon],
    ["account sessions", "/rest/v1/hamster_account_sessions?select=user_id&limit=0", service],
    ["study rules", "/rest/v1/hamster_study_rule_versions?select=effective_from&limit=0", service],
    ["submission grades", "/rest/v1/hamster_submissions?select=earned_difficulty,hamster_problems(difficulty)&limit=0", service],
    ["finalization", "/rest/v1/hamster_finalization_cursor?select=next_date&limit=0", service],
    ["read-only close status", "/rest/v1/rpc/hamster_next_finalization_day", service],
    ["measurements", "/rest/v1/hamster_action_timings?select=sample_day&limit=0", service],
    ["manual registration", "/rest/v1/hamster_manual_receipts?select=request_id&limit=0", service],
    ["invite approval", "/rest/v1/rpc/hamster_join_requires_approval?p_invite=true&p_policy=open", service],
    ["goal registry", "/rest/v1/hamster_manual_goals?select=goal&limit=0", service],
    ["progress checkpoints", "/rest/v1/hamster_progress_checkpoints?select=through_day&limit=0", service],
    ["close diagnostics", "/rest/v1/hamster_close_attempts?select=last_failure_code&limit=0", service],
  ];
  await Promise.all(probes.map(async ([label, path, key]) => {
    const result = await request(new URL(path, url), {
      headers: { apikey: key, ...(key.split(".").length === 3 ? { Authorization: "Bearer " + key } : {}) },
      signal: AbortSignal.timeout(10000), redirect: "error",
    });
    if (!result.ok) throw new Error(label + " read-only check failed (" + result.status + ")");
    if (label === "invite approval" && await result.json() !== true) throw new Error("Wrong invite policy");
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.env.VERCEL_ENV === "preview") {
  try {
    await checkDeployment(process.env);
    console.log("Deployment database and auth checks passed.");
  } catch (error) {
    console.error("Deployment readiness:", error.message);
    console.warn("Preview is available for UI review. Verify /api/health?mode=ready before promotion.");
  }
}
