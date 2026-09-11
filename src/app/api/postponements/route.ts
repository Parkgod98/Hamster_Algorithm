import { NextResponse } from "next/server";
import { createAdminClient,requireUser } from "@/lib/supabase";
import { addStudyDays,studyDateFromTimestamp } from "@/lib/study-day";

function seoulParts(now=new Date()){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",hour12:false,hour:"2-digit",minute:"2-digit"}).formatToParts(now);const get=(t:string)=>Number(parts.find(p=>p.type===t)?.value);return {hour:get("hour"),minute:get("minute")};}

export async function POST(request:Request){
  try{
    const user=await requireUser(request);const {studyId}=await request.json() as {studyId?:string};if(!studyId)return NextResponse.json({error:"studyId required"},{status:400});const admin=createAdminClient();
    const {data:study}=await admin.from("studies").select("postpone_deadline_hour,postpone_deadline_minute,max_consecutive_postpone").eq("id",studyId).single();
    const {data:member}=await admin.from("study_members").select("study_id").eq("study_id",studyId).eq("user_id",user.id).maybeSingle();if(!study||!member)return NextResponse.json({error:"forbidden"},{status:403});
    const current=studyDateFromTimestamp(new Date().toISOString());const time=seoulParts();if(time.hour>study.postpone_deadline_hour||(time.hour===study.postpone_deadline_hour&&time.minute>study.postpone_deadline_minute))return NextResponse.json({error:"미루기 신청 마감(23:59)이 지났습니다."},{status:409});
    let consecutive=0;for(let i=1;i<=study.max_consecutive_postpone;i++){const d=addStudyDays(current,-i);const {data}=await admin.from("postponements").select("id").eq("study_id",studyId).eq("user_id",user.id).eq("study_date",d).maybeSingle();if(!data)break;consecutive++;}
    if(consecutive>=study.max_consecutive_postpone)return NextResponse.json({error:"연속 미루기는 최대 2회입니다."},{status:409});
    const {error}=await admin.from("postponements").insert({study_id:studyId,user_id:user.id,study_date:current});if(error?.code==="23505")return NextResponse.json({ok:true,duplicate:true});if(error)return NextResponse.json({error:error.message},{status:500});return NextResponse.json({ok:true,studyDate:current});
  }catch(e){if(e instanceof Error&&e.message==="UNAUTHORIZED")return NextResponse.json({error:"unauthorized"},{status:401});return NextResponse.json({error:"unexpected error"},{status:500});}
}
