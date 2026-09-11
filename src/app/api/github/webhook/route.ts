import { NextResponse } from "next/server";
import { parseBaekjoonHubCommit } from "@/lib/baekjoonhub";
import { verifyGithubSignature } from "@/lib/github-app";
import { createAdminClient } from "@/lib/supabase";

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyGithubSignature(raw, request.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event") ?? "unknown";
  if (!deliveryId) return NextResponse.json({ error: "missing delivery id" }, { status: 400 });

  const payload = JSON.parse(raw) as { repository?: { id: number; full_name: string }; commits?: Array<{ id: string; message: string; timestamp: string; added?: string[]; modified?: string[] }> };
  const admin = createAdminClient();
  const { error: eventError } = await admin.from("webhook_events").insert({ delivery_id: deliveryId, event_name: event, repository_id: payload.repository?.id ?? null });
  if (eventError?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
  if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });
  if (event !== "push" || !payload.repository) return NextResponse.json({ ok: true, ignored: event });

  const { data: connection, error: connectionError } = await admin.from("repository_connections").select("id,user_id,study_id").eq("github_repository_id", payload.repository.id).eq("active", true).maybeSingle();
  if (connectionError) return NextResponse.json({ error: connectionError.message }, { status: 500 });
  if (!connection) return NextResponse.json({ ok: true, ignored: "unconnected repository" });

  let inserted = 0;
  for (const commit of payload.commits ?? []) {
    for (const submission of parseBaekjoonHubCommit(payload.repository.id, commit)) {
      const { data: problem, error: problemError } = await admin.from("problems").upsert({ platform: submission.platform, external_id: submission.externalId, title: submission.title, difficulty: submission.difficulty }, { onConflict: "platform,external_id" }).select("id").single();
      if (problemError) return NextResponse.json({ error: problemError.message }, { status: 500 });
      const { error } = await admin.from("submissions").insert({ user_id: connection.user_id, study_id: connection.study_id, repository_connection_id: connection.id, problem_id: problem.id, solved_at: submission.solvedAt, source: "github", source_event_id: submission.sourceEventId });
      if (!error) inserted += 1;
      else if (error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  await admin.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("delivery_id", deliveryId);
  return NextResponse.json({ ok: true, inserted });
}
