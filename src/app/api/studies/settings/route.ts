import { NextResponse } from "next/server";
import { RPC } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";
import { normalizeRuleConfig, validGoalPolicy } from "@/lib/rules";

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
    if (!body.ruleConfig || typeof body.ruleConfig !== "object" || !("goals" in body.ruleConfig)
        || !validGoalPolicy(body.ruleConfig.goals)) {
      return NextResponse.json({ error: "허용 목표와 하루 인증 기준을 확인해 주세요. 이전 화면이라면 새로고침해 주세요." }, { status: 400 });
    }
    if (!validInt(body.postponeDeadlineHour, 0, 23) || !validInt(body.postponeDeadlineMinute, 0, 59)) {
      return NextResponse.json({ error: "미루기 마감 시각이 올바르지 않습니다." }, { status: 400 });
    }
    if (!validInt(body.maxConsecutivePostpone, 0, MAX_POSTPONE)) {
      return NextResponse.json({ error: `미루기 한도는 미해결 날짜 0~${MAX_POSTPONE}일로 설정할 수 있습니다.` }, { status: 400 });
    }
    if (!validInt(body.maxPresolveDays, 0, MAX_PRESOLVE)) {
      return NextResponse.json({ error: `미리 풀기는 0~${MAX_PRESOLVE}일까지 설정할 수 있습니다.` }, { status: 400 });
    }

    const admin = createAdminClient();
    const ruleConfig = normalizeRuleConfig(body.ruleConfig);
    const { data: effectiveFrom, error } = await admin.rpc(RPC.scheduleStudyRules, {
      p_study_id: body.studyId,
      p_actor: user.id,
      p_config: ruleConfig,
      p_hour: body.postponeDeadlineHour,
      p_minute: body.postponeDeadlineMinute,
      p_max_postpone: body.maxConsecutivePostpone,
      p_max_presolve: body.maxPresolveDays,
    });
    if (error?.code === "42501") {
      return NextResponse.json({ error: "스터디장만 인증 규칙을 변경할 수 있습니다." }, { status: 403 });
    }
    if (error) return NextResponse.json({ error: "규칙을 저장하지 못했습니다." }, { status: 500 });
    return NextResponse.json({ ok: true, ruleConfig, effectiveFrom });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
