"use client";

const requestKey = "hamster-github-install-request";
export type InstallRequest = { studyId: string; state: string; userId?: string; installationId?: number };
export function startGitHubConnection(studyId: string, githubAppSlug: string) {
  if (!githubAppSlug) throw new Error("GitHub App 설정을 확인해주세요.");
  const state = crypto.randomUUID();
  sessionStorage.setItem(requestKey,JSON.stringify({studyId,state}));
  location.assign(`https://github.com/apps/${encodeURIComponent(githubAppSlug)}/installations/new?state=${state}`);
}
export function pendingInstallation(): InstallRequest | null {
  const raw = sessionStorage.getItem(requestKey);
  return raw ? JSON.parse(raw) : null;
}
export function bindInstallation(request: InstallRequest) { sessionStorage.setItem(requestKey,JSON.stringify(request)); }
export function clearInstallation() {
  sessionStorage.removeItem(requestKey);
  sessionStorage.removeItem("hamster-github-proof");
  sessionStorage.removeItem("hamster-github-proof-code-verifier");
}

export async function backfillGitHubRepository(connectionId: string, access: string) {
  const key = `hamster-backfill:${connectionId}`;
  const state = JSON.parse(localStorage.getItem(key) || '{"page":1,"head":null,"count":0}') as {
    page:number; head:string|null; count:number;
  };
  while (true) {
    const result = await fetch("/api/repositories/backfill",{method:"POST",headers:{
      Authorization:`Bearer ${access}`,"Content-Type":"application/json",
    },body:JSON.stringify({connectionId,page:state.page,head:state.head})});
    const data = await result.json() as {error?:string;inserted:number;nextPage:number|null;head:string|null};
    if(!result.ok)throw new Error(data.error || "과거 기록을 가져오지 못했어요.");
    state.count+=data.inserted;
    if(!data.nextPage){localStorage.removeItem(key);return state.count;}
    state.page=data.nextPage;state.head=data.head;
    localStorage.setItem(key,JSON.stringify(state));
  }
}
