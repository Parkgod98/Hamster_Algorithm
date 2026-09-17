import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DB } from "./db";
import {
  NOTIFICATION_COPY,
  canAttemptDelivery,
  isExpiredPushSubscription,
  isTransientPushFailure,
} from "./notification-rules";

export type NotificationKind = "completion" | "reminder";
type SubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };
type DeliveryRow = {
  id: string;
  status: "pending" | "sent" | "failed";
  attempt_count: number;
  attempted_at: string | null;
};

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

function pushStatusCode(error: unknown) {
  if (typeof error === "object" && error && "statusCode" in error) {
    return Number((error as { statusCode?: unknown }).statusCode) || 0;
  }
  return 0;
}

function pushErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "push delivery failed";
}

async function sendWithOneRetry(subscription: SubscriptionRow, payload: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload);
      return { ok: true as const, statusCode: 201, error: null };
    } catch (error) {
      lastError = error;
      const statusCode = pushStatusCode(error);
      if (isExpiredPushSubscription(statusCode) || !isTransientPushFailure(statusCode) || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return { ok: false as const, statusCode: pushStatusCode(lastError), error: lastError };
}

async function beginDelivery(
  admin: SupabaseClient,
  input: { studyId: string; userId: string; studyDate: string; kind: NotificationKind; subscriptionId: string },
) {
  const existingResult = await admin.from(DB.notificationDeliveries)
    .select("id,status,attempt_count,attempted_at")
    .eq("study_id", input.studyId)
    .eq("user_id", input.userId)
    .eq("study_date", input.studyDate)
    .eq("kind", input.kind)
    .eq("subscription_id", input.subscriptionId)
    .maybeSingle();
  if (existingResult.error) throw existingResult.error;

  const existing = existingResult.data as DeliveryRow | null;
  if (existing && !canAttemptDelivery(existing.status, existing.attempted_at)) return null;

  const attemptedAt = new Date().toISOString();
  if (existing) {
    const { data, error } = await admin.from(DB.notificationDeliveries)
      .update({
        status: "pending",
        attempt_count: existing.attempt_count + 1,
        attempted_at: attemptedAt,
        last_error: null,
        last_status_code: null,
      })
      .eq("id", existing.id)
      .eq("status", existing.status)
      .eq("attempt_count", existing.attempt_count)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    return data?.id as string | undefined ?? null;
  }

  const { data, error } = await admin.from(DB.notificationDeliveries)
    .insert({
      study_id: input.studyId,
      user_id: input.userId,
      study_date: input.studyDate,
      kind: input.kind,
      subscription_id: input.subscriptionId,
      status: "pending",
      attempt_count: 1,
      attempted_at: attemptedAt,
      sent_at: null,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return null;
  if (error) throw error;
  return data.id as string;
}

export async function sendStudyNotificationOnce(
  admin: SupabaseClient,
  input: { studyId: string; userId: string; studyDate: string; kind: NotificationKind },
) {
  if (!configureWebPush()) {
    console.error("push skipped: VAPID is not configured", { kind: input.kind });
    return { attempted: 0, sent: 0, failed: 0, expired: 0, skipped: 1 };
  }

  const { data: preference, error: preferenceError } = await admin.from(DB.notificationPreferences)
    .select("completion_enabled,reminder_enabled")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (preferenceError) throw preferenceError;
  const enabled = input.kind === "completion"
    ? preference?.completion_enabled ?? true
    : preference?.reminder_enabled ?? true;
  if (!enabled) return { attempted: 0, sent: 0, failed: 0, expired: 0, skipped: 1 };

  const { data, error: subscriptionsError } = await admin.from(DB.pushSubscriptions)
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", input.userId);
  if (subscriptionsError) throw subscriptionsError;
  const subscriptions = (data ?? []) as SubscriptionRow[];
  if (!subscriptions.length) return { attempted: 0, sent: 0, failed: 0, expired: 0, skipped: 1 };

  const copy = NOTIFICATION_COPY[input.kind];
  const payload = JSON.stringify({ ...copy, url: "/dashboard", icon: "/icon-192.png" });
  const summary = { attempted: 0, sent: 0, failed: 0, expired: 0, skipped: 0 };

  for (const subscription of subscriptions) {
    let deliveryId: string | null = null;
    try {
      deliveryId = await beginDelivery(admin, { ...input, subscriptionId: subscription.id });
      if (!deliveryId) {
        summary.skipped += 1;
        continue;
      }
      summary.attempted += 1;
      const result = await sendWithOneRetry(subscription, payload);
      if (result.ok) {
        const { error: sentError } = await admin.from(DB.notificationDeliveries).update({
          status: "sent",
          sent_at: new Date().toISOString(),
          last_error: null,
          last_status_code: result.statusCode,
        }).eq("id", deliveryId);
        if (sentError) throw sentError;
        summary.sent += 1;
        continue;
      }

      const statusCode = result.statusCode;
      if (isExpiredPushSubscription(statusCode)) {
        summary.expired += 1;
        await admin.from(DB.pushSubscriptions).delete().eq("id", subscription.id);
      } else {
        summary.failed += 1;
      }
      await admin.from(DB.notificationDeliveries).update({
        status: "failed",
        sent_at: null,
        last_error: pushErrorMessage(result.error),
        last_status_code: statusCode || null,
      }).eq("id", deliveryId);
      console.error("push delivery failed", { kind: input.kind, statusCode, subscriptionId: subscription.id });
    } catch (error) {
      summary.failed += 1;
      console.error("push delivery processing failed", { kind: input.kind, subscriptionId: subscription.id, error });
      if (deliveryId) {
        await admin.from(DB.notificationDeliveries).update({
          status: "failed",
          sent_at: null,
          last_error: pushErrorMessage(error),
          last_status_code: pushStatusCode(error) || null,
        }).eq("id", deliveryId);
      }
    }
  }
  return summary;
}

export async function sendTestNotification(admin: SupabaseClient, userId: string, endpoint: string) {
  if (!configureWebPush()) return { ok: false as const, error: "not-configured" as const };
  const { data, error } = await admin.from(DB.pushSubscriptions)
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", userId)
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (error) throw error;
  const subscription = data as SubscriptionRow | null;
  if (!subscription) return { ok: false as const, error: "not-subscribed" as const };

  const copy = NOTIFICATION_COPY.test;
  const payload = JSON.stringify({ ...copy, url: "/dashboard", icon: "/icon-192.png" });
  const result = await sendWithOneRetry(subscription, payload);
  if (result.ok) return { ok: true as const };
  if (isExpiredPushSubscription(result.statusCode)) {
    await admin.from(DB.pushSubscriptions).delete().eq("id", subscription.id);
    return { ok: false as const, error: "expired" as const };
  }
  console.error("test push delivery failed", { statusCode: result.statusCode, subscriptionId: subscription.id });
  return { ok: false as const, error: "delivery-failed" as const, statusCode: result.statusCode };
}
