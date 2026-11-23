import { NextResponse } from "next/server";

export function communityResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function communityError(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") return communityResponse({ error: "로그인이 필요합니다." }, 401);
  if (error instanceof SyntaxError) return communityResponse({ error: "입력 내용을 확인해 주세요." }, 400);
  const code = typeof error === "object" && error && "code" in error ? error.code : "";
  if (code === "42501") return communityResponse({ error: "스터디장만 이 작업을 할 수 있어요." }, 403);
  if (code === "P0002") return communityResponse({ error: "스터디 또는 참여 정보를 찾을 수 없어요." }, 404);
  if (code === "22023" || code === "23514") return communityResponse({ error: "입력 내용을 확인해 주세요." }, 400);
  return communityResponse({ error: "스터디 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요." }, 500);
}
