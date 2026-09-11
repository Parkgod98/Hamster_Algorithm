import { NextResponse } from "next/server";
import { createAdminClient,requireUser } from "@/lib/supabase";
import { studyDateFromTimestamp } from "@/lib/study-day";
import { submissionCredit } from "@/lib/rules";
import { dateRange,evaluateTimeline } from "@/lib/progress";

export async function GET(request:Request){
  try{
    const user=await requireUser(request);const admin=createAdminClient();
    const {data:membership}=await admin.from("study_members").select("study_id").eq("user_id",user.id).limit(1).maybeSingle();
    const current=studyDateFromTimestamp(new Date().toISOString());
    if(!membership)return NextResponse.json({study:null,members:[],repositories:[],studyDate:current});
    const {data:study}=await admin.from("studies").select("id,name,created_at,max_presolve_days").eq("id",membership.study_id).single();
    if(!study)return NextResponse.json({error:"study not found"},{status:404});
    const [{data:members},{data:repos},{data:subs},{data:postponements}]=await Promise.all([
      admin.from("study_members").select("user_id,display_name").eq("study_id",study.id),
      admin.from("repository_connections").select("full_name").eq("study_id",study.id).eq("user_id",user.id).eq("active",true),
      admin.from("submissions").select("user_id,solved_at,problems(platform,difficulty)").eq("study_id",study.id).lte("solved_at",new Date(Date.now()+86400000).toISOString()),
      admin.from("postponements").select("user_id,study_date").eq("study_id",study.id),
    ]);
    const earliest=studyDateFromTimestamp(study.created_at); const dates=dateRange(earliest,current);
    const result=(members??[]).map((m)=>{
      const creditMap=new Map<string,number>();
      for(const s of subs??[]){if(s.user_id!==m.user_id)continue;const p=Array.isArray(s.problems)?s.problems[0]:s.problems;if(!p)continue;const d=studyDateFromTimestamp(s.solved_at);creditMap.set(d,(creditMap.get(d)??0)+submissionCredit(p.platform,p.difficulty));}
      const postponed=new Set((postponements??[]).filter(p=>p.user_id===m.user_id).map(p=>p.study_date));
      const timeline=evaluateTimeline(dates.map(date=>({date,credits:creditMap.get(date)??0,postponed:postponed.has(date)})),current,study.max_presolve_days);
      const today=timeline.at(-1)??{state:"in-progress",available:0}; const label=today.state==="complete"?"✅ 완료":today.state==="postponed"?"⏭️ 미루기":today.state==="missed"?"❌ 미제출":"🟡 진행 중";
      return {userId:m.user_id,name:m.display_name,state:label,credits:Math.min(1,today.available),detail:`오늘 credit ${Math.min(1,today.available).toFixed(2)} / 1.00`};
    });
    return NextResponse.json({study:{id:study.id,name:study.name},members:result,repositories:(repos??[]).map(r=>r.full_name),studyDate:current});
  }catch(e){if(e instanceof Error&&e.message==="UNAUTHORIZED")return NextResponse.json({error:"unauthorized"},{status:401});return NextResponse.json({error:e instanceof Error?e.message:"unexpected error"},{status:500});}
}
