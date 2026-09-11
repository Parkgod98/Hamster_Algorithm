"use client";
import { createClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createClient> | null = null;
export function browserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase public environment is not configured");
  client ??= createClient(url, key);
  return client;
}
