import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DB } from "./db";
import { NOTIFICATION_COPY } from "./notification-rules";

export type NotificationKind = "completion" | "reminder";

function configureWebPush() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export function webPushPublicKey() {
  return process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? "";
}

export async function sendStudyNotificationOnce(
  admin: SupabaseClient,
  input: { studyId: string; userId: string; studyDate: string; kind: NotificationKind },
) {
  if (!configureWebPush()) return { sent: 0, skipped: "not-configured" as const };

  const { data: preference } = await admin.from(DB.notificationPreferences)
    .select("completion_enabled,reminder_enabled")
    .eq("user_id", input.userId)
    .maybeSingle();
  const enabled = input.kind === "completion"
    ? preference?.completion_enabled ?? true
    : preference?.reminder_enabled ?? true;
  if (!enabled) return { sent: 0, skipped: "disabled" as const };

  const { data: subscriptions } = await admin.from(DB.pushSubscriptions)
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", input.userId);
  if (!subscriptions?.length) return { sent: 0, skipped: "no-subscription" as const };

  const { error: deliveryError } = await admin.from(DB.notificationDeliveries).insert({
    study_id: input.studyId,
    user_id: input.userId,
    study_date: input.studyDate,
    kind: input.kind,
  });
  if (deliveryError?.code === "23505") return { sent: 0, skipped: "duplicate" as const };
  if (deliveryError) throw deliveryError;

  const copy = NOTIFICATION_COPY[input.kind];
  const payload = JSON.stringify({ ...copy, url: "/dashboard", icon: "/icon-192.png" });
  let sent = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload);
      sent += 1;
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from(DB.pushSubscriptions).delete().eq("id", subscription.id);
        continue;
      }
      console.error("push delivery failed", { kind: input.kind, statusCode });
    }
  }
  return { sent };
}
