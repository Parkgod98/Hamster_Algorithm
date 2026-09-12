import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";
import { normalizeRuleConfig } from "@/lib/rules";
import { studyDateFromTimestamp } from "@/lib/study-day";

const MAX_POSTPONE = 7;
const MAX_PRESOLVE = 14;

function validInt(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json() as {
      studyId?: string;
      ruleConfig?: unknown;
      postponeDeadlineHour?: number;
      postponeDeadlineMinute?: number;
      maxConsecutivePostpone?: number;
      maxPresolveDays?: number;
    };

    if (!body.studyId) return NextResponse.json({ error: "studyId required" }, { status: 400 });
    if (!validInt(body.postponeDeadlineHour, 0, 23) || !validInt(body.postponeDeadlineMinute, 0, 59)) {
      return NextResponse.json({ error: "미루기 마감 시각이 올바르지 않습니다." }, { status: 400 });
    }
    if (!validInt(body.maxConsecutivePostpone, 0, MAX_POSTPONE)) {
      return NextResponse.json({ error: `연속 미루기는 0~${MAX_POSTPONE}회까지 설정할 수 있습니다.` }, { status: 400 });
    }
    if (!validInt(body.maxPresolveDays, 0, MAX_PRESOLVE)) {
      return NextResponse.json({ error: `미리 풀기는 0~${MAX_PRESOLVE}일까지 설정할 수 있습니다.` }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: membership } = await admin
      .from(DB.studyMembers)
      .select("study_id")
      .eq("study_id", body.studyId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "스터디 참여원만 인증 규칙을 변경할 수 있습니다." }, { status: 403 });
    }

    const ruleConfig = normalizeRuleConfig(body.ruleConfig);
    const settings = {
      rule_config: ruleConfig,
      postpone_deadline_hour: body.postponeDeadlineHour,
      postpone_deadline_minute: body.postponeDeadlineMinute,
      max_consecutive_postpone: body.maxConsecutivePostpone,
      max_presolve_days: body.maxPresolveDays,
    };

    const { error } = await admin.from(DB.studies).update(settings).eq("id", body.studyId);
    if (error) return NextResponse.json({ error: "규칙을 저장하지 못했습니다." }, { status: 500 });

    const effectiveFrom = studyDateFromTimestamp(new Date().toISOString());
    const { error: historyError } = await admin.from(DB.studyRuleVersions).upsert({
      study_id: body.studyId,
      effective_from: effectiveFrom,
      rule_config: ruleConfig,
      postpone_deadline_hour: body.postponeDeadlineHour,
      postpone_deadline_minute: body.postponeDeadlineMinute,
      max_consecutive_postpone: body.maxConsecutivePostpone,
      max_presolve_days: body.maxPresolveDays,
      changed_by: user.id,
      created_at: new Date().toISOString(),
    }, { onConflict: "study_id,effective_from" });

    if (historyError) return NextResponse.json({ error: "규칙 변경 이력을 저장하지 못했습니다." }, { status: 500 });
    return NextResponse.json({ ok: true, ruleConfig, effectiveFrom });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
