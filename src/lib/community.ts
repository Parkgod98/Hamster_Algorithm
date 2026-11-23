import type { GoalPolicy } from "./study-goals";

export type JoinPolicy = "open" | "approval";
export type CommunityOptions = { description: string; discoverable: boolean; joinPolicy: JoinPolicy };
export type StudyPreview = {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  joinPolicy: JoinPolicy;
  goals: Pick<GoalPolicy, "allowed" | "mode" | "required">;
  memberRole: "admin" | "member" | null;
  pending: boolean;
};
export type StudyList = { studies: StudyPreview[]; nextOffset: number | null };
export type JoinResult = { status: "joined" | "pending"; studyId: string };
export type CommunityManagement = CommunityOptions & {
  members: Array<{ id: string; name: string; role: "admin" | "member" }>;
  requests: Array<{ id: string; name: string }>;
};

export function validId(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
}

export function validCode(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{12,32}$/i.test(value);
}

export function validCommunityOptions<T extends Partial<CommunityOptions>>(value: T): value is T & CommunityOptions {
  return typeof value.description === "string" && value.description.length <= 1000
    && typeof value.discoverable === "boolean" && (value.joinPolicy === "open" || value.joinPolicy === "approval");
}
