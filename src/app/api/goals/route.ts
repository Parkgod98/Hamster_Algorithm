import { NextResponse } from "next/server";
import { DB, RPC } from "@/lib/db";
import { readAllRows } from "@/lib/read-all-rows";
import { goalPolicy, type ManualGoal } from "@/lib/rules";
import { addStudyDays, studyDateFromTimestamp } from "@/lib/study-day";
import { createAdminClient, requireUser } from "@/lib/supabase";

const maxBytes = 2 * 1024 * 1024;
type Entry = {
  id: string; user_id: string; goal: ManualGoal; photo_type: string | null; created_at: string;
  hamster_study_members: { display_name: string } | { display_name: string }[] | null;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
function validDate(date: string | null): date is string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ms = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}
function failed(error: unknown) {
  return error instanceof Error && error.message === "UNAUTHORIZED"
    ? json({ error: "로그인이 필요합니다." }, 401)
    : json({ error: "인증 정보를 확인할 수 없어요. 다시 시도해 주세요." }, 503);
}

export async function GET(request: Request) {
  try {
    const viewer = await requireUser(request);
    const params = new URL(request.url).searchParams;
    const studyId = params.get("studyId");
    const date = params.get("date");
    if (!studyId || !validDate(date)) return json({ error: "스터디와 인증일을 확인해 주세요." }, 400);
    const admin = createAdminClient();
    const member = await admin.from(DB.studyMembers).select("joined_at")
      .eq("study_id", studyId).eq("user_id", viewer.id).maybeSingle();
    if (member.error) throw member.error;
    if (!member.data) return json({ error: "스터디 멤버만 볼 수 있습니다." }, 403);
    const [rule, entries] = await Promise.all([
      admin.from(DB.studyRuleVersions).select("rule_config,max_presolve_days")
        .eq("study_id", studyId).lte("effective_from", date).order("effective_from", { ascending: false }).limit(1).maybeSingle(),
      readAllRows<Entry>((from, to) => admin.from(DB.goalCompletions)
        .select("id,user_id,goal,photo_type,created_at,hamster_study_members(display_name)")
        .eq("study_id", studyId).eq("study_date", date).order("created_at").order("id").range(from, to)),
    ]);
    if (rule.error) throw rule.error;
    if (!rule.data) return json({ policy: null, canSubmit: false, entries: [] });
    const policy = goalPolicy(rule.data.rule_config);
    const horizon = rule.data.max_presolve_days;
    const today = studyDateFromTimestamp(new Date().toISOString());
    return json({
      policy,
      canSubmit: date >= studyDateFromTimestamp(member.data.joined_at) && date <= addStudyDays(today, horizon),
      entries: entries.map((item) => {
        const owner = Array.isArray(item.hamster_study_members) ? item.hamster_study_members[0] : item.hamster_study_members;
        return { id: item.id, mine: item.user_id === viewer.id, name: owner?.display_name ?? "스터디원", goal: item.goal,
          counted: policy.allowed.includes(item.goal) && date <= addStudyDays(studyDateFromTimestamp(item.created_at), horizon),
          hasPhoto: Boolean(item.photo_type) };
      }),
    });
  } catch (error) { return failed(error); }
}

function imageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function POST(request: Request) {
  try {
    const viewer = await requireUser(request);
    if (Number(request.headers.get("content-length") ?? 0) > maxBytes + 65536) return json({ error: "사진은 2MB까지 올릴 수 있어요." }, 413);
    let form: FormData;
    try { form = await request.formData(); } catch { return json({ error: "인증 양식을 확인해 주세요." }, 400); }
    const studyId = form.get("studyId");
    const date = form.get("date");
    const goal = form.get("goal");
    if (typeof studyId !== "string" || !studyId || typeof date !== "string" || !validDate(date)
        || (goal !== "english" && goal !== "reading")) return json({ error: "스터디와 인증일, 목표를 확인해 주세요." }, 400);
    const photo = form.get("photo");
    let bytes: Buffer | null = null;
    let type: string | null = null;
    if (photo !== null) {
      if (typeof photo === "string" || !photo.size || photo.size > maxBytes) return json({ error: "사진은 한 장, 2MB까지 올릴 수 있어요." }, 400);
      bytes = Buffer.from(await photo.arrayBuffer());
      type = imageType(bytes);
      if (!type) return json({ error: "PNG, JPG 또는 WebP 사진을 선택해 주세요." }, 400);
    }
    const { data, error } = await createAdminClient().rpc(RPC.recordGoal, { p_study: studyId, p_user: viewer.id,
      p_day: date, p_goal: goal, p_type: type, p_photo: bytes?.toString("base64") ?? null });
    if (error?.code === "42501") return json({ error: "스터디 멤버만 인증할 수 있어요." }, 403);
    if (error?.code === "22023") {
      const reasons: Record<string, string> = { before_membership: "가입 전 날짜에는 인증할 수 없어요.",
        goal_unavailable: "해당 날짜에 허용된 목표를 확인해 주세요.", presolve_limit: "스터디의 미리 인증 한도를 넘었어요.",
        photo_invalid: "첨부할 사진을 확인해 주세요." };
      return json({ error: reasons[error.message] ?? "인증 내용을 확인해 주세요." }, 409);
    }
    if (error) throw error;
    return json({ ok: true, id: data });
  } catch (error) { return failed(error); }
}
