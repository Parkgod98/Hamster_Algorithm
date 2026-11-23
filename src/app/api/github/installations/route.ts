import { NextResponse } from "next/server";
import { DB,RPC } from "@/lib/db";
import { createGithubAppJwt,installationToken } from "@/lib/github-app";
import { createAdminClient,requireUser } from "@/lib/supabase";

function github(path: string, token: string) {
  return fetch(`https://api.github.com${path}`,{cache:"no-store",headers:{
    Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",
  }});
}
export async function POST(request: Request) {
  try {
    const user=await requireUser(request);
    const {installationId,studyId,githubToken}=await request.json() as {installationId?:number;studyId?:string;githubToken?:string};
    if(!Number.isSafeInteger(installationId) || !installationId || installationId<1 || !studyId || typeof githubToken!=="string" || !githubToken)
      return NextResponse.json({error:"연결 정보를 확인해주세요."},{status:400});
    const admin=createAdminClient();
    const member=await admin.from(DB.studyMembers).select("study_id").eq("user_id",user.id).eq("study_id",studyId).maybeSingle();
    if(member.error)throw member.error;
    if(!member.data)return NextResponse.json({error:"스터디 멤버만 연결할 수 있어요."},{status:403});
    const [identityResult,installResult]=await Promise.all([github("/user",githubToken),github(`/app/installations/${installationId}`,createGithubAppJwt())]);
    if(!identityResult.ok || !installResult.ok) return NextResponse.json({error:"GitHub 설치 소유자를 확인할 수 없어요."},{status:403});
    const identity=await identityResult.json() as {id:number};
    const installation=await installResult.json() as {account:{id:number;login:string;type:string}};
    const owner=installation.account;
    let authorized=owner.type==="User" && owner.id===identity.id;
    if(owner.type==="Organization"){
      const response=await github(`/user/memberships/orgs/${encodeURIComponent(owner.login)}`,githubToken);
      if(response.ok){const membership=await response.json();authorized=membership.state==="active" && membership.role==="admin";}
    }
    if(!authorized)return NextResponse.json({error:"이 GitHub 설치를 관리하는 계정으로 연결해주세요."},{status:403});
    const token=await installationToken(installationId);
    const repos:Array<{id:number;full_name:string}>=[];
    for(let page=1;;page++){
      const response=await github(`/installation/repositories?per_page=100&page=${page}`,token);
      if(!response.ok)return NextResponse.json({error:"GitHub 저장소 목록을 불러오지 못했어요."},{status:502});
      const result=await response.json() as {repositories:Array<{id:number;full_name:string}>};
      repos.push(...result.repositories.map(({id,full_name})=>({id,full_name})));
      if(result.repositories.length<100)break;
    }
    const saved=await admin.rpc(RPC.linkGitHubRepositories,{p_user:user.id,p_study:studyId,p_installation:installationId,p_owner:owner.login,p_repositories:repos});
    if(saved.error?.code==="42501")return NextResponse.json({error:"이미 다른 햄쮸터 계정에 연결된 설치예요."},{status:403});
    if(saved.error)throw saved.error;
    return NextResponse.json({ok:true,repositories:repos});
  }catch(error){
    if(error instanceof Error && error.message==="UNAUTHORIZED")return NextResponse.json({error:"로그인해주세요."},{status:401});
    return NextResponse.json({error:"GitHub 저장소를 연결하지 못했어요. 다시 시도해주세요."},{status:500});
  }
}
