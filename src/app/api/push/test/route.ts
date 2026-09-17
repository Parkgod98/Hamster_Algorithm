import { NextResponse } from "next/server";
import { sendTestNotification } from "@/lib/push";
import { createAdminClient, requireUser } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const raw = await request.json() as Record<string, unknown>;
    const endpoint = typeof raw.endpoint === "string" ? raw.endpoint : "";
    if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });

    const result = await sendTestNotification(createAdminClient(), user.id, endpoint);
    if (!result.ok) {
      const status = result.error === "not-subscribed" || result.error === "expired" ? 409 : 502;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
