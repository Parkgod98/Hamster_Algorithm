"use client";

import { useEffect, useRef, useState } from "react";
import { browserSupabase, currentAccountId } from "@/lib/supabase-browser";
import { communityRequest } from "@/lib/community-client";
import { invalidateViews, putView, readView } from "@/lib/view-cache";
import { useViewRevision } from "./use-view-revision";

type PushSettings = {
  publicKey: string;
  subscribed: boolean;
  deviceSubscribed: boolean;
  completionEnabled: boolean;
  reminderEnabled: boolean;
};

function decodeVapidKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function subscriptionUsesKey(subscription: PushSubscription, publicKey: string) {
  const applicationServerKey = subscription.options.applicationServerKey;
  if (!applicationServerKey || !publicKey) return true;
  const expected = decodeVapidKey(publicKey);
  const actual = new Uint8Array(applicationServerKey);
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

async function token() {
  const { data } = await browserSupabase().auth.getSession();
  return data.session?.access_token;
}

async function localSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

function pushViewKey(subscription: PushSubscription | null) {
  return `push:${Notification.permission}:${subscription?.endpoint ?? "off"}`;
}

export function PushNotificationControl() {
  const viewerId = typeof window !== "undefined" ? currentAccountId() ?? "" : "";
  const revision = useViewRevision(viewerId, "push:");
  const activeKey = useRef("");
  const [settings, setSettings] = useState<PushSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [unsupported, setUnsupported] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);

  useEffect(() => {
    if (!open || !viewerId || !("Notification" in window)) return;
    let active = true;
    void (async () => {
      const subscription = await localSubscription();
      if (!active) return;
      const key = pushViewKey(subscription);
      const query = subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : "";
      const next = await readView<PushSettings>(viewerId, key,
        signal => communityRequest(`/api/push/subscriptions${query}`, undefined, signal, viewerId));
      if (!active) return;
      activeKey.current = key;
      if (subscription && next.publicKey && !subscriptionUsesKey(subscription, next.publicKey)) {
        setSettings({ ...next, deviceSubscribed: false });
        setMessage("알림 키가 변경되어 이 기기에서 알림을 다시 켜야 해요.");
      } else { setSettings(next); }
    })().catch(() => {
      if (active) { setSettings(null); setMessage("알림 설정을 불러오지 못했어요."); }
    });
    return () => { active = false; };
  }, [open, viewerId, revision]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
        if (!supported) {
          setUnsupported(true);
          return;
        }
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
        if (ios && !standalone) setNeedsInstall(true);
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function removeServerSubscription(endpoint: string) {
    const access = await token();
    if (!access) throw new Error("로그인이 필요해요.");
    const response = await fetch("/api/push/subscriptions", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    if (!response.ok) throw new Error("구독을 해제하지 못했어요.");
  }

  async function enable() {
    if (!settings?.publicKey || needsInstall) {
      setMessage(needsInstall ? "iPhone은 홈 화면에 추가한 햄쮸터에서 알림을 켤 수 있어요." : "Push 설정이 아직 준비되지 않았어요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("브라우저 알림 권한이 필요해요.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !subscriptionUsesKey(subscription, settings.publicKey)) {
        await removeServerSubscription(subscription.endpoint);
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(settings.publicKey),
        });
      }
      const access = await token();
      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!response.ok) throw new Error("subscription failed");
      const next = { ...settings, deviceSubscribed: true, subscribed: true };
      invalidateViews(viewerId, ["push:"]);
      activeKey.current = pushViewKey(subscription);
      putView(viewerId, activeKey.current, next);
      setSettings(next);
      setMessage("이 기기의 알림을 켰어요. 테스트 알림으로 바로 확인할 수 있어요.");
    } catch {
      setMessage("알림을 켜지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      const subscription = await localSubscription();
      if (subscription) {
        await removeServerSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      invalidateViews(viewerId, ["push:"]);
      setMessage("이 기기의 알림을 껐어요.");
    } catch {
      setMessage("알림을 끄지 못했어요. 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function testPush() {
    setBusy(true);
    setMessage("");
    try {
      const subscription = await localSubscription();
      if (!subscription) {
        setMessage("이 기기의 Push 구독이 없어요. 알림을 다시 켜주세요.");
        invalidateViews(viewerId, ["push:"]);
        return;
      }
      const access = await token();
      const response = await fetch("/api/push/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        if (payload.error === "expired" || payload.error === "not-subscribed") {
          setMessage("이 기기의 Push 구독이 만료됐어요. 알림을 다시 켜주세요.");
          invalidateViews(viewerId, ["push:"]);
          return;
        }
        throw new Error("test failed");
      }
      setMessage("테스트 알림을 보냈어요. 기기 알림을 확인해주세요.");
    } catch {
      setMessage("테스트 알림 전송에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function savePreference(key: "completionEnabled" | "reminderEnabled", value: boolean) {
    if (!settings || busy) return;
    const next = { ...settings, [key]: value };
    setBusy(true);
    setSettings(next);
    try {
      const access = await token();
      const response = await fetch("/api/push/subscriptions", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ completionEnabled: next.completionEnabled, reminderEnabled: next.reminderEnabled }),
      });
      if (!response.ok) throw new Error("설정 저장 실패");
      invalidateViews(viewerId, ["push:"]);
      if (activeKey.current) putView(viewerId, activeKey.current, next);
    } catch {
      setSettings(settings);
      setMessage("알림 설정을 저장하지 못했어요.");
    } finally { setBusy(false); }
  }

  if (unsupported) return null;
  const deviceOn = settings?.deviceSubscribed ?? false;
  return <div className={`push-control${open ? " is-open" : ""}`}>
    <button className="push-control-trigger" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="알림 설정">
      🔔
      <span>{settings ? deviceOn ? "이 기기 알림 켜짐" : "알림 켜기" : "알림 설정"}</span>
    </button>
    {open && <section className="push-control-panel">
      <div className="push-control-heading"><div><strong>햄쮸터 알림</strong><p>인증 완료와 밤 9시 이후 미인증 알림을 받을 수 있어요.</p></div><button onClick={() => setOpen(false)} aria-label="닫기">×</button></div>
      {needsInstall && <p className="push-help">iPhone은 Safari에서 햄쮸터를 홈 화면에 추가한 뒤 앱으로 열어야 Push 알림을 사용할 수 있어요.</p>}
      {!deviceOn ? <button className="primary-button full" onClick={() => void enable()} disabled={busy || !settings}>{busy ? "설정 중…" : "이 기기 알림 켜기"}</button> : <>
        <label className="push-option"><span><strong>인증 완료</strong><small>오늘 인증이 완료되는 순간 알려줘요.</small></span><input type="checkbox" disabled={busy} checked={settings?.completionEnabled ?? true} onChange={(event) => void savePreference("completionEnabled", event.target.checked)}/></label>
        <label className="push-option"><span><strong>미인증 reminder</strong><small>밤 9시 이후에도 미완료이고 미루기도 안 했다면 알려줘요.</small></span><input type="checkbox" disabled={busy} checked={settings?.reminderEnabled ?? true} onChange={(event) => void savePreference("reminderEnabled", event.target.checked)}/></label>
        <button className="secondary-button full push-test" onClick={() => void testPush()} disabled={busy}>{busy ? "확인 중…" : "테스트 알림 보내기"}</button>
        <button className="text-button push-disable" onClick={() => void disable()} disabled={busy}>이 기기 알림 끄기</button>
      </>}
      {settings?.subscribed && !deviceOn && <p className="push-help">다른 기기에는 알림이 등록되어 있지만 현재 기기는 등록되지 않았어요.</p>}
      {message && <p className="push-message">{message}</p>}
    </section>}
  </div>;
}
