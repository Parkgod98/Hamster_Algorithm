import { closeHealth } from "@/lib/close-health";
import { expectedClosedDay } from "@/lib/study-day";
import { DB, RPC } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";

function reply(result: { ok: boolean }) {
  return Response.json(result, { status: result.ok ? 200 : 503,
    headers: { "Cache-Control": "public, max-age=0, s-maxage=30" } });
}

export async function GET(request: Request) {
  const expected = expectedClosedDay(new Date());
  try {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
    const expectedHost = process.env.HAMSTER_EXPECTED_SUPABASE_HOST;
    if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || (expectedHost && host !== expectedHost)) {
      return reply({ ok: false });
    }
    const admin = createAdminClient();
    const cursor = await admin.from(DB.finalizationCursor).select("next_date").eq("singleton", true).maybeSingle();
    if (cursor.error) return reply({ ok: false });
    if (new URL(request.url).searchParams.get("mode") === "ready") {
      // Probe the deployed REST relationship and the final schema, also on an empty DB.
      const [probes, policy, auth] = await Promise.all([Promise.all([
        admin.from(DB.submissions).select("earned_difficulty,hamster_problems(difficulty)").limit(0),
        admin.from(DB.actionTimings).select("sample_day").limit(0),
        admin.from(DB.closeAttempts).select("last_failure_code").limit(0),
        admin.from(DB.manualReceipts).select("request_id").limit(0),
        admin.from(DB.manualGoals).select("goal").limit(0),
        admin.from(DB.progressCheckpoints).select("through_day").limit(0),
      ]), admin.rpc(RPC.joinRequiresApproval, { p_invite: true, p_policy: "open" }),
        fetch(new URL("/auth/v1/settings", process.env.NEXT_PUBLIC_SUPABASE_URL), {
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }, cache: "no-store",
          signal: AbortSignal.timeout(5000),
        }),
      ]);
      return reply({ ok: probes.every(probe => !probe.error) && policy.data === true && !policy.error && auth.ok });
    }
    const attempt = await admin.from(DB.closeAttempts).select("stage,target_day,error_code").eq("scheduled_day", expected).maybeSingle();
    return attempt.error ? reply({ ok: false }) : reply(closeHealth(expected, cursor.data?.next_date ?? null, attempt.data));
  } catch { return reply({ ok: false }); }
}
