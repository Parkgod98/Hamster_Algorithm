import { createClient } from "@supabase/supabase-js";
import { DB } from "./db";
import { tokenHash } from "./account-crypto";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server environment is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function createUserVerifier() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase public environment is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requireLegacyUser(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("UNAUTHORIZED");
  const { data, error } = await createUserVerifier().auth.getUser(token);
  if (error || !data.user || !data.user.identities?.some((identity) => identity.provider === "github")) throw new Error("UNAUTHORIZED");
  return data.user;
}

export async function requireUser(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!/^hs1_[0-9a-f]{64}$/.test(token)) throw new Error("UNAUTHORIZED");
  const { data, error } = await createAdminClient().from(DB.accountSessions).select("user_id")
    .eq("token_hash", tokenHash(token)).maybeSingle();
  if (error) throw new Error("Account session lookup failed");
  if (!data) throw new Error("UNAUTHORIZED");
  return { id: String(data.user_id) };
}
