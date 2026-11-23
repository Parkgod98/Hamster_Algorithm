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
  // The sign-in form navigates this tab immediately. Other tabs receive the storage event.
}
export function currentAccountId() {
  return localSession()?.user.id;
}

export async function forgetLegacySession(expectedToken: string) {
  const client = oauthClient();
  const { data, error } = await client.auth.getSession();
  if (error && localStorage.getItem("hamster-auth")) throw error;
  if (!data.session) return true;
  if (data.session.access_token !== expectedToken) return false;
  const result = await client.auth.signOut({ scope: "local" });
  if (result.error && localStorage.getItem("hamster-auth")) throw result.error;
  return true;
}

export function forgetAccountSession(expectedToken: string) {
  if (localSession()?.access_token !== expectedToken) return false;
  localStorage.removeItem(accountKey);
  window.dispatchEvent(new Event(accountKey));
  return true;
}

export function onStoredAccountChange(callback: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === accountKey || event.key === null) callback(); };
  window.addEventListener(accountKey, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(accountKey, callback);
    window.removeEventListener("storage", onStorage);
  };
}

export function browserSupabase() {
  return { auth: {
    async getSession(): Promise<{ data: { session: AppSession | null } }> {
      const session = localSession();
      if (session) return { data: { session } };
      if (!localStorage.getItem("hamster-auth")) return { data: { session: null } };
      const result = await oauthClient().auth.getSession();
      if (result.error && localStorage.getItem("hamster-auth")) throw result.error;
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
      if (legacy || localStorage.getItem("hamster-auth")) await oauthClient().auth.signOut({ scope: "local" });
      if (session) forgetAccountSession(session.access_token);
    },
    onAuthStateChange(callback: (event: string, session: AppSession | null) => void) {
      const update = () => callback("ACCOUNT_CHANGED", localSession());
      const unsubscribeAccount = onStoredAccountChange(update);
      const { data } = oauthClient().auth.onAuthStateChange((event, session) => callback(event, localSession() || session));
      return { data: { subscription: { unsubscribe() {
        data.subscription.unsubscribe();
        unsubscribeAccount();
      } } } };
    },
  } };
}
