export const RECOVERY_QUESTIONS = [
  { id: "treasure", label: "내 보물 1호는?" },
  { id: "memory", label: "처음으로 기억에 남은 여행지는?" },
  { id: "character", label: "어릴 때 가장 좋아했던 캐릭터는?" },
  { id: "book", label: "가장 기억에 남는 책의 제목은?" },
] as const;

export const loginKey = (value: string) => value.normalize("NFKC").trim().toLowerCase();
export const answerKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko");
export const validLogin = (value: string) => /^[\p{L}\p{N}._-]{2,40}$/u.test(value);
export const validPassword = (value: string) => value.length >= 8 && value.length <= 256;
export const validNickname = (value: string) => value.trim().length > 0 && value.trim().length <= 40;
export const questionLabel = (id: string) => RECOVERY_QUESTIONS.find((entry) => entry.id === id)?.label;
