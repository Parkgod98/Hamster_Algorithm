"use client";
import { createClient } from "@supabase/supabase-js";

const accountKey = "hamster-account-session";
let legacy: ReturnType<typeof newOAuthClient> | undefined;
let connection: ReturnType<typeof newOAuthClient> | undefined;

function newOAuthClient(linking: boolean) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase public environment is not configured");
  return createClient(url, key, { auth: { flowType: "pkce", detectSessionInUrl: false,
    persistSession: true, autoRefreshToken: !linking,
    storage: linking ? window.sessionStorage : window.localStorage, storageKey: linking ? "hamster-github-proof" : "hamster-auth",
  } });
}
function oauthClient(linking = false) {
  if (linking) return connection ??= newOAuthClient(true);
  return legacy ??= newOAuthClient(false);
}

export function githubProofClient() { return oauthClient(true); }

export type AppSession = { user: { id: string }; access_token: string };
function localSession(): AppSession | null {
  const raw = localStorage.getItem(accountKey);
  if (!raw) return null;
  try {
    const { token, userId } = JSON.parse(raw);
    return typeof userId === "string" && typeof token === "string" && /^hs1_[a-f0-9]{64}$/.test(token)
      ? { access_token: token, user: { id: userId } } : null;
  } catch { return null; }
}

export function saveAccountSession(token: string, userId: string) {
  localStorage.setItem(accountKey, JSON.stringify({ token, userId }));
  window.dispatchEvent(new Event(accountKey));
}
export function forgetAccountSession() {
  localStorage.removeItem(accountKey);
  window.dispatchEvent(new Event(accountKey));
}
export function accountDestination() {
  const path = localStorage.getItem("hamster-next") || "/dashboard";
  localStorage.removeItem("hamster-next");
  return /^\/(?:dashboard|studies|join\/[\w-]+)(?:\?[^#]*)?$/.test(path) ? path : "/dashboard";
}

export function browserSupabase() {
  return { auth: {
    async getSession(): Promise<{ data: { session: AppSession | null } }> {
      const session = localSession();
      if (session) return { data: { session } };
      const result = await oauthClient().auth.getSession();
      return { data: { session: result.data.session } };
    },
    signInWithOAuth: (...args: Parameters<ReturnType<typeof createClient>["auth"]["signInWithOAuth"]>) =>
      oauthClient().auth.signInWithOAuth(...args),
    exchangeCodeForSession: (code: string) => oauthClient().auth.exchangeCodeForSession(code),
    async signOut() {
      const session = localSession();
      if (session) {
        const response = await fetch("/api/account", { method: "POST", headers: {
          "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`,
        }, body: JSON.stringify({ action: "logout" }) });
        if (!response.ok) throw new Error("로그아웃에 실패했어요. 잠시 후 다시 시도해주세요.");
      }
      // The legacy OAuth session is only needed for upgrading an existing account.
      await oauthClient().auth.signOut({ scope: "local" });
      forgetAccountSession();
    },
    onAuthStateChange(callback: (event: string, session: AppSession | null) => void) {
      const update = () => callback("ACCOUNT_CHANGED", localSession());
      const onStorage = (event: StorageEvent) => { if (event.key === accountKey || event.key === null) update(); };
      window.addEventListener(accountKey, update);
      window.addEventListener("storage", onStorage);
      const { data } = oauthClient().auth.onAuthStateChange((event, session) => callback(event, localSession() || session));
      return { data: { subscription: { unsubscribe() {
        data.subscription.unsubscribe();
        window.removeEventListener(accountKey, update);
        window.removeEventListener("storage", onStorage);
      } } } };
    },
  } };
}
