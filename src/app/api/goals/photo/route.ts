import { DB } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function empty(status: number) { return new Response(null, { status, headers: privateHeaders }); }

export async function GET(request: Request) {
  try {
    const viewer = await requireUser(request);
    const params = new URL(request.url).searchParams;
    const study = params.get("studyId");
    const id = params.get("id");
    if (!study || !id) return empty(400);
    const admin = createAdminClient();
    const membership = await admin.from(DB.studyMembers).select("user_id")
      .eq("study_id", study).eq("user_id", viewer.id).maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data) return empty(403);
    const { data, error } = await admin.from(DB.goalCompletions)
      .select("photo_type,hamster_goal_photos(image)").eq("study_id", study).eq("id", id).maybeSingle();
    if (error) throw error;
    const photo = Array.isArray(data?.hamster_goal_photos) ? data.hamster_goal_photos[0] : data?.hamster_goal_photos;
    const hex = photo?.image;
    if (!data?.photo_type || typeof hex !== "string" || !hex.startsWith("\\x")) return empty(404);
    return new Response(new Uint8Array(Buffer.from(hex.slice(2), "hex")), {
      headers: { ...privateHeaders, "Content-Type": data.photo_type },
    });
  } catch (error) { return empty(error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 503); }
}
