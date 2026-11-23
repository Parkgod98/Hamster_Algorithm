import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient, requireUser } from "@/lib/supabase";
import { readAllRows } from "@/lib/read-all-rows";
import { studyDayStartTimestamp, studyDayEndExclusiveTimestamp } from "@/lib/study-day";
import { normalizeRuleConfig, submissionCredit, goalPolicy } from "@/lib/rules";
import type { Platform } from "@/lib/types";

type Problem = { platform: Platform; external_id: string; title: string; difficulty: string };
type Solve = { user_id: string; solved_at: string; source: string; hamster_problems: unknown };
type Penalty = { user_id: string; study_date: string; amount: number };
type Version = { effective_from: string; changed_by: string | null; created_at: string };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const params = new URL(request.url).searchParams;
    const studyId = params.get("studyId");
    const view = params.get("view");
    if (!studyId) return json({ error: "스터디를 선택해주세요." }, 400);
    const db = createAdminClient();
    const member = await db.from(DB.studyMembers).select("user_id").eq("study_id", studyId).eq("user_id", user.id).maybeSingle();
    if (member.error) throw member.error;
    if (!member.data) return json({ error: "이 스터디의 멤버만 확인할 수 있어요." }, 403);

    if (view === "settings") {
      const [repos, versions] = await Promise.all([
        readAllRows<{id: string; full_name: string}>((from,to) => db.from(DB.repositoryConnections)
          .select("id,full_name").eq("user_id", user.id).eq("active", true).order("id").range(from,to)),
        readAllRows<Version>((from,to) => db.from(DB.studyRuleVersions).select("effective_from,changed_by,created_at")
          .eq("study_id", studyId).order("effective_from", { ascending: false }).range(from,to)),
      ]);
      return json({ repositories: repos.map(r => ({id:r.id, fullName:r.full_name})), ruleHistory: versions });
    }

    const date = params.get("date") ?? "";
    const month = params.get("month") ?? "";
    const isDay = view === "day";
    if (isDay ? !/^\d{4}-\d\d-\d\d$/.test(date) : view !== "statistics" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return json({ error: "날짜를 확인해주세요." }, 400);
    }
    if (isDay && (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) {
      return json({ error: "날짜를 확인해주세요." }, 400);
    }
    const start = isDay ? date : month + "-01";
    const end = isDay ? date : new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(-2)),0)).toISOString().slice(0,10);
    const penalties = readAllRows<Penalty>((from,to) => db.from(DB.penalties).select("user_id,study_date,amount")
      .eq("study_id", studyId).gte("study_date",start).lte("study_date",end).order("study_date").order("user_id").range(from,to));
    if (!isDay) return json({ penalties: await penalties });
    const [penaltyRows, rules, submissions] = await Promise.all([
      penalties,
      db.from(DB.studyRuleVersions).select("rule_config").eq("study_id", studyId).lte("effective_from", date)
        .order("effective_from",{ascending:false}).limit(1).maybeSingle(),
      readAllRows<Solve>((from,to) => db.from(DB.submissions).select("user_id,solved_at,source,hamster_problems(platform,external_id,title,difficulty)")
        .eq("study_id", studyId).gte("solved_at",studyDayStartTimestamp(date)).lt("solved_at",studyDayEndExclusiveTimestamp(date))
        .order("solved_at").order("id").range(from,to)),
    ]);
    if (rules.error) throw rules.error;
    if (!rules.data) return json({ penalties: penaltyRows, submissions: [], algorithm: false });
    const config = normalizeRuleConfig(rules.data.rule_config);
    const details = submissions.map(row => {
      const p = (Array.isArray(row.hamster_problems) ? row.hamster_problems[0] : row.hamster_problems) as Problem;
      return { userId: row.user_id, platform:p.platform, problemId:p.external_id, title:p.title, difficulty:p.difficulty,
        credit:submissionCredit(p.platform,p.difficulty,config), solvedAt:row.solved_at, source:row.source };
    });
    return json({ penalties: penaltyRows, submissions: details, algorithm: goalPolicy(config).allowed.includes("algorithm") });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ error: "로그인이 필요해요." }, 401);
    return json({ error: "상세 정보를 불러오지 못했어요." }, 503);
  }
}
