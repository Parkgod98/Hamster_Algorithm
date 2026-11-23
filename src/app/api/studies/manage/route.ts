import { communityError, communityResponse } from "@/lib/community-api";
import { validCommunityOptions, validId, type CommunityOptions } from "@/lib/community";
import { DB, RPC } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";

async function manage(request: Request, readOnly: boolean) {
  try {
    const user = await requireUser(request);
    const body = (readOnly ? { studyId: new URL(request.url).searchParams.get("studyId"), action: "read" }
      : await request.json()) as Partial<CommunityOptions> & { studyId?: string; action?: string; targetId?: string };
    const action = body?.action ?? "";
    if (!validId(body?.studyId) || !["read", "invite", "configure", "promote", "approve", "reject"].includes(action)
      || (action === "configure" && !validCommunityOptions(body))
      || (["promote", "approve", "reject"].includes(action) && !validId(body.targetId))) {
      return communityResponse({ error: "스터디 관리 요청을 확인해 주세요." }, 400);
    }
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(RPC.administerCommunityStudy, {
      p_actor: user.id, p_study_id: body.studyId, p_action: action, p_target: body.targetId ?? null,
      p_description: body.description?.trim() ?? null, p_discoverable: body.discoverable ?? null,
      p_join_policy: body.joinPolicy ?? null,
    });
    if (error) return communityError(error);
    if (action === "approve" || action === "promote") {
      // Approval is idempotent. Another admin may have rejected or approved this request already.
      const member = await admin.from(DB.studyMembers).select("user_id,display_name,role")
        .eq("study_id", body.studyId).eq("user_id", body.targetId!).maybeSingle();
      // The write has committed even if this optional row lookup is unavailable.
      if (member.error) return communityResponse({ ok: true, refresh: true });
      return communityResponse({ ok: true, member: member.data && {
        id: member.data.user_id, name: member.data.display_name, role: member.data.role,
      } });
    }
    return communityResponse(data);
  } catch (error) {
    return communityError(error);
  }
}

export function GET(request: Request) { return manage(request, true); }
export function POST(request: Request) { return manage(request, false); }
