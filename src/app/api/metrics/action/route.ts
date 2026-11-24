import { RPC } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";

export async function POST(request: Request) {
  // Preview and production may share a database. Only live member traffic
  // belongs in the operating sample.
  if (process.env.VERCEL_ENV !== "production") return new Response(null, { status: 204 });
  try {
    if (!request.headers.get("authorization")) return new Response(null, { status: 401 });
    if (Number(request.headers.get("content-length")) > 256) return new Response(null, { status: 413 });
    const body = await request.text();
    if (body.length > 256) return new Response(null, { status: 413 });
    const sample = JSON.parse(body);
    if (!sample || !["calendar_cold", "postpone"].includes(sample.action) || !Number.isSafeInteger(sample.duration) ||
        sample.duration < 0 || typeof sample.mobile !== "boolean" || typeof sample.ok !== "boolean") {
      return new Response(null, { status: 400 });
    }
    await requireUser(request);
    const { error } = await createAdminClient().rpc(RPC.recordTiming, {
      p_action: sample.action, p_mobile: sample.mobile, p_ok: sample.ok,
      p_bucket: Math.min(60000, Math.ceil(sample.duration / 100) * 100),
    });
    return new Response(null, { status: error ? 503 : 204 });
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 503;
    return new Response(null, { status });
  }
}
