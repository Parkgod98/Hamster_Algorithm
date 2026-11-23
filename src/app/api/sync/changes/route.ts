import { tokenHash } from "@/lib/account-crypto";
import { RPC } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";
import { observeSync } from "@/lib/sync-realtime";
import { createViewerStream, type ViewerSyncState } from "@/lib/sync-stream";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store, no-transform", Vary: "Authorization" };

export async function GET(request: Request) {
  const match = request.headers.get("authorization")?.match(/^Bearer (hs1_[0-9a-f]{64})$/i);
  const denied = () => Response.json({ error: "로그인이 필요해요." },{ status: 401, headers: privateHeaders });
  if (!match) return denied();
  try {
    const db = createAdminClient();
    const hash = tokenHash(match[1]);
    const read = async (): Promise<ViewerSyncState | null> => {
      const { data,error } = await db.rpc(RPC.syncSnapshot,{ p_session_hash: hash });
      if (error) throw new Error("Sync snapshot unavailable");
      return data;
    };
    const initial = await read();
    if (!initial) return denied();
    if (new URL(request.url).searchParams.get("once") === "1") {
      return Response.json(initial.snapshot,{ headers: privateHeaders });
    }
    const stream = createViewerStream(initial,read,observer => observeSync(initial.topic,observer),request.signal);
    return new Response(stream,{ headers: { ...privateHeaders,
      "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" } });
  } catch {
    return Response.json({ error: "변경 내역을 확인할 수 없어요." },{ status: 503, headers: privateHeaders });
  }
}
