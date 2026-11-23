import { NextResponse } from "next/server";
import { parseBaekjoonHubCommit } from "@/lib/baekjoonhub";
import { DB } from "@/lib/db";
import { installationToken } from "@/lib/github-app";
import { recordGitHubSolutions } from "@/lib/github-ingestion";
import { studyDateFromTimestamp,studyDayStartTimestamp } from "@/lib/study-day";
import { createAdminClient,requireUser } from "@/lib/supabase";

const BATCH = 20;
type Detail = {sha:string;commit:{message:string;committer:{date:string}|null;author:{date:string}|null};files?:Array<{filename:string;status:string}>};

export async function POST(request: Request) {
  try {
    const user=await requireUser(request);
    const {connectionId,head,page=1}=await request.json() as {connectionId?:string;head?:string;page?:number};
    if(!connectionId || !Number.isSafeInteger(page) || page<1 || (page>1 && !head) || (head && !/^[a-f0-9]{40,64}$/.test(head)))
      return NextResponse.json({error:"가져올 범위를 확인해주세요."},{status:400});
    const db=createAdminClient();
    const [connection,membership]=await Promise.all([
      db.from(DB.repositoryConnections).select("id,installation_id,github_repository_id,full_name").eq("id",connectionId).eq("user_id",user.id).eq("active",true).maybeSingle(),
      db.from(DB.studyMembers).select("joined_at").eq("user_id",user.id).order("joined_at").limit(1).maybeSingle(),
    ]);
    if(connection.error || membership.error)throw new Error("Repository lookup failed");
    if(!connection.data?.installation_id || !membership.data)return NextResponse.json({error:"연결된 저장소를 찾을 수 없어요."},{status:404});
    const {id,installation_id,github_repository_id,full_name}=connection.data;
    const token=await installationToken(installation_id);
    const endpoint=`https://api.github.com/repos/${full_name}/commits`;
    const headers={Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json"};
    const params=new URLSearchParams({per_page:String(BATCH),page:String(page),since:studyDayStartTimestamp(studyDateFromTimestamp(membership.data.joined_at))});
    if(head)params.set("sha",head);
    const list=await fetch(`${endpoint}?${params}`,{headers,cache:"no-store"});
    if(!list.ok)throw new Error("GitHub read failed");
    const commits=await list.json() as Array<{sha:string}>;
    const items=new Map<string,ReturnType<typeof parseBaekjoonHubCommit>[number]>();
    for(let start=0;start<commits.length;start+=5){
      const parsed=await Promise.all(commits.slice(start,start+5).map(async ({sha})=>{
        let detail:Detail | undefined;
        const files:string[]=[];
        for(let filePage=1;;filePage++){
          const res=await fetch(`${endpoint}/${sha}?per_page=100&page=${filePage}`,{headers,cache:"no-store"});
          if(!res.ok)throw new Error("GitHub commit read failed");
          const part=await res.json() as Detail;
          detail??=part;
          files.push(...(part.files??[]).filter(f=>f.status!=="removed").map(f=>f.filename));
          if(!res.headers.get("link")?.includes('rel="next"'))break;
        }
        const timestamp=detail.commit.committer?.date || detail.commit.author?.date;
        if(!timestamp)throw new Error("Missing commit date");
        return parseBaekjoonHubCommit(github_repository_id,{id:sha,message:detail.commit.message,timestamp,modified:files});
      }));
      for(const item of parsed.flat())items.set(item.sourceEventId,item);
    }
    const saved=items.size ? await recordGitHubSolutions(db,id,"backfill",[...items.values()]) : [];
    return NextResponse.json({ok:true,inserted:new Set(saved.map(row=>row.event_id)).size,
      head:head || commits[0]?.sha || null,nextPage:list.headers.get("link")?.includes('rel="next"')?page+1:null});
  }catch(error){
    if(error instanceof Error && error.message==="UNAUTHORIZED")return NextResponse.json({error:"로그인해주세요."},{status:401});
    return NextResponse.json({error:"풀이를 가져오지 못했어요. 다시 누르면 마지막 저장 지점부터 이어갑니다."},{status:503});
  }
}
