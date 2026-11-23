import { NextResponse } from "next/server";
import { answerKey, loginKey, questionLabel, validLogin, validNickname, validPassword } from "@/lib/account";
import { accountIdentityId, hashSecret, newAccountToken, tokenHash, verifySecret } from "@/lib/account-crypto";
import { DB, RPC } from "@/lib/db";
import { createAdminClient, requireLegacyUser, requireUser } from "@/lib/supabase";

type Admin = ReturnType<typeof createAdminClient>;
type Input = Record<string, unknown>;
const field = (body: Input, key: string) => typeof body[key] === "string" ? body[key] : "";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status: number) => json({ error }, status);
const isAppSession = (request: Request) => request.headers.get("authorization")?.startsWith("Bearer hs1_");

async function readProfile(admin: Admin, userId: string) {
  const { data, error } = await admin.from(DB.profiles).select("display_name").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function legacyAccount(admin: Admin, user: Awaited<ReturnType<typeof requireLegacyUser>>) {
  const [credentials, profile] = await Promise.all([
    admin.from(DB.accountCredentials).select("user_id").eq("user_id", user.id).maybeSingle(),
    readProfile(admin, user.id),
  ]);
  if (credentials.error) throw credentials.error;
  if (credentials.data) return { status: "registered" as const };
  const githubName = user.user_metadata?.user_name || "";
  if (profile) return { status: "legacy" as const, nickname: profile.display_name || githubName };

  // The original join flow saved the membership even when its profile upsert failed.
  const { data: member, error } = await admin.from(DB.studyMembers).select("display_name")
    .eq("user_id", user.id).order("joined_at").order("study_id").limit(1).maybeSingle();
  if (error) throw error;
  return member ? { status: "legacy" as const, nickname: member.display_name || githubName } : { status: "none" as const };
}

export async function GET(request: Request) {
  try {
    const admin = createAdminClient();
    if (isAppSession(request)) {
      const user = await requireUser(request);
      return json({ status: "active", nickname: (await readProfile(admin, user.id))?.display_name || "" });
    }
    const user = await requireLegacyUser(request);
    return json(await legacyAccount(admin, user));
  } catch (error) {
    return accountError(error);
  }
}

async function register(request: Request, admin: Admin, body: Input, legacy: boolean) {
  const login = loginKey(field(body,"login"));
  const password = field(body,"password");
  const question = field(body,"question");
  const answer = answerKey(field(body,"answer"));
  const nickname = field(body,"nickname").trim();
  if (!validLogin(login) || !validPassword(password) || !validNickname(nickname) || !questionLabel(question) ||
      !answer || answer.length > 256) return fail("아이디, 닉네임, 비밀번호와 복구 질문·답변을 확인해주세요.",400);
  const legacyUser = legacy ? await requireLegacyUser(request) : null;
  if (legacyUser) {
    const account = await legacyAccount(admin, legacyUser);
    if (account.status === "none") return fail("이 GitHub 계정으로 사용한 햄쮸터 기록이 없어요. 새 계정을 만들어주세요.",403);
    if (account.status === "registered") return fail("이미 전환한 계정이에요. 햄쮸터 아이디로 로그인해주세요.",409);
  }
  const { data: taken, error: lookupError } = await admin.from(DB.accountCredentials).select("user_id").eq("login_id",login).maybeSingle();
  if (lookupError) throw lookupError;
  if (taken) return fail("이미 사용 중인 로그인 아이디예요.",409);
  const [passwordDigest,answerDigest] = await Promise.all([hashSecret(password),hashSecret(answer)]);
  const userId = legacyUser?.id ?? accountIdentityId(login);
  if (!legacyUser) {
    // The existing foreign keys reference auth.users. This opaque identity has
    // no end-user credentials and never sends mail or issues a Supabase session.
    const email = `${userId}@accounts.hamster.invalid`;
    const { data, error } = await admin.auth.admin.createUser({
      id: userId, email, email_confirm: true,
      password: newAccountToken(), app_metadata: { hamster_local: true },
    });
    if (error || data.user?.id !== userId) {
      // A timeout or concurrent attempt may already have provisioned this ID.
      const existing = await admin.auth.admin.getUserById(userId);
      if (existing.error || existing.data.user?.email !== email || existing.data.user.app_metadata.hamster_local !== true)
        throw new Error("Account provisioning failed");
    }
  }
  const token = newAccountToken();
  const { error } = await admin.rpc(RPC.registerAccount, {
    p_user: userId, p_login: login, p_nickname: nickname, p_password: passwordDigest,
    p_question: question, p_answer: answerDigest, p_token: tokenHash(token),
  });
  if (error) {
    if (error.code === "23505") return fail("이미 등록한 계정이거나 사용 중인 로그인 아이디예요.",409);
    throw error;
  }
  return json({ token, userId },201);
}

async function authenticate(admin: Admin, body: Input, action: string) {
  const login = loginKey(field(body,"login"));
  if (!validLogin(login)) return fail("로그인 아이디를 확인해주세요.",400);
  const { data, error } = await admin.from(DB.accountCredentials)
    .select("user_id,password_hash,question_id,answer_hash").eq("login_id", login).maybeSingle();
  if (error) throw error;
  const denied = () => fail(action === "login" ? "아이디 또는 비밀번호를 확인해주세요." : "아이디 또는 복구 답변을 확인해주세요.",401);
  if (!data) return denied();
  if (action === "question") return json({ question: questionLabel(data.question_id) });
  const password = field(body,"password");
  if (!validPassword(password)) return fail("비밀번호는 8~256자로 입력해주세요.",400);
  const answer = answerKey(field(body,"answer"));
  if (action === "reset" && (!answer || answer.length > 256)) return fail("복구 답변을 입력해주세요.",400);
  const { data: allowed, error: limitError } = await admin.rpc(RPC.consumeAccountAttempt, { p_user: data.user_id, p_purpose: action });
  if (limitError) throw limitError;
  if (!allowed) return fail("입력 횟수를 초과했어요. 15분 뒤 다시 시도해주세요.",429);
  if (action === "reset") {
    if (!await verifySecret(answer,data.answer_hash)) return denied();
    const result = await admin.rpc(RPC.resetAccountPassword, {
      p_user: data.user_id, p_expected: data.password_hash, p_password: await hashSecret(password),
    });
    if (result.error) throw result.error;
    if (!result.data) return fail("계정이 변경되었어요. 다시 시도해주세요.",409);
    return json({ ok: true });
  }
  if (!await verifySecret(password,data.password_hash)) return denied();
  const token = newAccountToken();
  const result = await admin.rpc(RPC.startAccountSession, { p_user: data.user_id, p_expected: data.password_hash, p_token: tokenHash(token) });
  if (result.error) throw result.error;
  if (!result.data) return denied();
  return json({ token, userId: data.user_id });
}

function accountError(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("다시 로그인해주세요.",401);
  return fail("계정 정보를 처리하지 못했어요. 잠시 후 다시 시도해주세요.",500);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as Input | null;
    if (!body || typeof body !== "object") return fail("계정 정보를 입력해주세요.",400);
    const action = field(body,"action");
    const admin = createAdminClient();
    if (action === "register" || action === "migrate") return await register(request,admin,body,action === "migrate");
    if (["login","question","reset"].includes(action)) return await authenticate(admin,body,action);
    if (action === "logout") {
      const token = request.headers.get("authorization")?.slice(7) || "";
      if (!/^hs1_[a-f0-9]{64}$/.test(token)) return fail("다시 로그인해주세요.",401);
      const { error } = await admin.from(DB.accountSessions).delete().eq("token_hash", tokenHash(token));
      if (error) throw error;
      return json({ ok: true });
    }
    if (action === "nickname") {
      const { id } = await requireUser(request);
      const nickname = field(body,"nickname").trim();
      if (!validNickname(nickname)) return fail("닉네임을 1~40자로 정해주세요.",400);
      const { error } = await admin.rpc(RPC.renameAccount,{p_user:id,p_nickname:nickname});
      if (error) throw error;
      return json({ nickname });
    }
    return fail("지원하지 않는 요청이에요.",400);
  } catch (error) {
    return accountError(error);
  }
}
