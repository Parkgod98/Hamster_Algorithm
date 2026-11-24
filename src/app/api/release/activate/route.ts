import { DB, RPC } from "@/lib/db";
import { liveDeployment, promotionTime } from "@/lib/production-promotion";
import { studyDateFromTimestamp } from "@/lib/study-day";
import { createAdminClient } from "@/lib/supabase";

export async function POST(request: Request) {
  const live = liveDeployment(request, process.env);
  if (!live) return Response.json({ok:false}, {status:409});
  try {
    const db = createAdminClient();
    const current = await db.from(DB.finalizationCursor).select("first_date,next_date").eq("singleton",true).maybeSingle();
    if (current.error) throw new Error("cursor unavailable");
    if (current.data) return Response.json({ok:true, nextDate:current.data.next_date});
    const first = studyDateFromTimestamp(await promotionTime(live));
    const cursor = await db.rpc(RPC.activateFinalization, {p_day: first});
    if (cursor.error || !cursor.data?.day) throw new Error("activation failed");
    return Response.json({ok:true, nextDate:cursor.data.day});
  } catch {
    return Response.json({ok:false, error:"deployment-activation-unavailable"}, {status:503});
  }
}
