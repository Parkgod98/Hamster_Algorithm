import { communityError, communityResponse } from "@/lib/community-api";
import { validCommunityOptions, validCode, validId, type CommunityOptions, type StudyPreview } from "@/lib/community";
import { RPC } from "@/lib/db";
import { normalizeRuleConfig } from "@/lib/rules";
import { goalPolicy, validGoalPolicy } from "@/lib/study-goals";
import { createAdminClient, requireUser } from "@/lib/supabase";

type CatalogRow = {
  id: string; name: string; description: string; member_count: number; join_policy: CommunityOptions["joinPolicy"];
  goals: unknown; member_role: StudyPreview["memberRole"]; pending: boolean;
};

export async function GET(request: Request) {
  try {
    const actor = await requireUser(request);
    const params = new URL(request.url).searchParams;
    const scope = params.get("scope") ?? "search";
    const query = (params.get("q") ?? "").trim();
    const code = params.get("code");
    const offset = Number(params.get("offset") ?? "0");
    if (!["mine","search","invite"].includes(scope) || query.length > 80 ||
      (scope === "invite" && !validCode(code)) || !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483600) {
      return communityResponse({ error: "검색어 또는 초대 링크를 확인해 주세요." }, 400);
    }
    const { data, error } = await createAdminClient().rpc(RPC.communityCatalog, {
      p_actor: actor.id, p_scope: scope, p_query: query, p_code: code, p_offset: offset,
    });
    if (error) return communityError(error);
    const rows = (data ?? []) as CatalogRow[];
    if (scope === "invite" && !rows.length) return communityResponse({ error: "유효하지 않은 초대 링크예요." }, 404);
    const studies: StudyPreview[] = rows.slice(0, 20).map((row) => {
      const { allowed, mode, required } = goalPolicy(row.goals == null ? {} : { goals: row.goals });
      return { id: row.id, name: row.name, description: row.description, memberCount: row.member_count,
        joinPolicy: row.join_policy, goals: { allowed, mode, required }, memberRole: row.member_role, pending: row.pending };
    });
    return communityResponse({ studies, nextOffset: rows.length > 20 ? offset + 20 : null });
  } catch (error) {
    return communityError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireUser(request);
    const body = await request.json() as Partial<CommunityOptions> & { name?: string; studyId?: string; goals?: unknown };
    if (!validId(body?.studyId) || typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80 ||
      !validCommunityOptions(body) || !validGoalPolicy(body.goals)) {
      return communityResponse({ error: "스터디 이름과 가입 방식, 인증 기준을 확인해 주세요." }, 400);
    }
    const { data, error } = await createAdminClient().rpc(RPC.createCommunityStudy, {
      p_study_id: body.studyId, p_actor: actor.id, p_name: body.name.trim(), p_description: body.description.trim(),
      p_discoverable: body.discoverable, p_join_policy: body.joinPolicy, p_config: normalizeRuleConfig({ goals: body.goals }),
    });
    if (error) return communityError(error);
    return communityResponse({ studyId: data }, 201);
  } catch (error) {
    return communityError(error);
  }
}
