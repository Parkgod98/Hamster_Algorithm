import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";
import { webPushPublicKey } from "@/lib/push";

function subscriptionPayload(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const endpoint = typeof raw.endpoint === "string" ? raw.endpoint : "";
  const keys = raw.keys && typeof raw.keys === "object" ? raw.keys as Record<string, unknown> : {};
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  return endpoint && p256dh && auth ? { endpoint, p256dh, auth } : null;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const admin = createAdminClient();
    const endpoint = new URL(request.url).searchParams.get("endpoint") ?? "";
    const preferencePromise = admin.from(DB.notificationPreferences)
      .select("completion_enabled,reminder_enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    const userCountPromise = admin.from(DB.pushSubscriptions)
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    const deviceCountPromise = endpoint
      ? admin.from(DB.pushSubscriptions).select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("endpoint", endpoint)
      : Promise.resolve({ count: 0, error: null });
    const [{ data: preference, error: preferenceError }, userCount, deviceCount] = await Promise.all([
      preferencePromise,
      userCountPromise,
      deviceCountPromise,
    ]);
    if (preferenceError || userCount.error || deviceCount.error) return NextResponse.json({ error: "push settings lookup failed" }, { status: 500 });
    return NextResponse.json({
      publicKey: webPushPublicKey(),
      subscribed: (userCount.count ?? 0) > 0,
      deviceSubscribed: (deviceCount.count ?? 0) > 0,
      completionEnabled: preference?.completion_enabled ?? true,
      reminderEnabled: preference?.reminder_enabled ?? true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const raw = await request.json() as Record<string, unknown>;
    const subscription = subscriptionPayload(raw.subscription);
    if (!subscription) return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
    const admin = createAdminClient();
    const { error } = await admin.from(DB.pushSubscriptions).upsert({
      user_id: user.id,
      ...subscription,
      updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });
    if (error) return NextResponse.json({ error: "subscription save failed" }, { status: 500 });
    await admin.from(DB.notificationPreferences).upsert({ user_id: user.id }, { onConflict: "user_id" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const raw = await request.json() as Record<string, unknown>;
    const completionEnabled = typeof raw.completionEnabled === "boolean" ? raw.completionEnabled : true;
    const reminderEnabled = typeof raw.reminderEnabled === "boolean" ? raw.reminderEnabled : true;
    const admin = createAdminClient();
    const { error } = await admin.from(DB.notificationPreferences).upsert({
      user_id: user.id,
      completion_enabled: completionEnabled,
      reminder_enabled: reminderEnabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return NextResponse.json({ error: "preference save failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const raw = await request.json() as Record<string, unknown>;
    const endpoint = typeof raw.endpoint === "string" ? raw.endpoint : "";
    if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
    const admin = createAdminClient();
    const { error } = await admin.from(DB.pushSubscriptions).delete().eq("user_id", user.id).eq("endpoint", endpoint);
    if (error) return NextResponse.json({ error: "subscription delete failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
