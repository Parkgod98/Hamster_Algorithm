"use client";
export async function accountRequest(body?: Record<string, string>, token?: string) {
  const response = await fetch("/api/account", {
    method: body ? "POST" : "GET", cache: "no-store",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json() as { error?: string; token?: string; userId?: string;
    nickname?: string; question?: string; status?: "legacy" | "registered" | "active" };
  if (!response.ok) throw new Error(result.error || "계정 요청에 실패했어요.");
  return result;
}
