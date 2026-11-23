import { communityError, communityResponse } from "@/lib/community-api";
import { validCode, validId } from "@/lib/community";
import { RPC } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json() as { code?: string; studyId?: string };
    if (!body || !(body.code ? validCode(body.code) : validId(body.studyId))) {
      return communityResponse({ error: "스터디 또는 초대 링크를 확인해 주세요." }, 400);
    }
    const { data, error } = await createAdminClient().rpc(RPC.joinCommunityStudy, {
      p_actor: user.id, p_study_id: body.code ? null : body.studyId, p_code: body.code ?? null,
    });
    if (error) return communityError(error);
    return communityResponse(data);
  } catch (error) {
    return communityError(error);
  }
}
