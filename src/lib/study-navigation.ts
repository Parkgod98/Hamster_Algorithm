// A sign-in in another tab may belong to a different account or invitation.
const returnKey = "hamster-next";

export function rememberAccountReturn() {
  sessionStorage.setItem(returnKey, window.location.pathname + window.location.search);
}

export function accountDestination(newAccount = false, noStudies = false) {
  const path = sessionStorage.getItem(returnKey);
  sessionStorage.removeItem(returnKey);
  const pathname = path?.split("?")[0];
  if (pathname && /^\/join\/[\w-]+$/.test(pathname)) return pathname;
  if (pathname === "/studies" || newAccount) return "/studies";
  if (path && /^\/dashboard\?studyId=[\da-f-]+$/i.test(path)) return path;
  return noStudies ? "/studies" : "/dashboard";
}

function selectionKey(viewerId: string) {
  return `hamster-study-id:${viewerId}`;
}

export function rememberedStudy(viewerId: string) {
  return localStorage.getItem(selectionKey(viewerId));
}

export function rememberStudy(viewerId: string, studyId: string) {
  localStorage.setItem(selectionKey(viewerId), studyId);
}

export function forgetStudy(viewerId: string, studyId: string) {
  if (rememberedStudy(viewerId) === studyId) localStorage.removeItem(selectionKey(viewerId));
}
