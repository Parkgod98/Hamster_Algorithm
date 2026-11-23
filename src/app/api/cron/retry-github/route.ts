import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";
import { processGitHubReceipt } from "@/lib/github-ingestion";

export async function GET(request: Request) {
  const secret=process.env.CRON_SECRET;
  const credential = `Bearer ${secret}`;
  const expected=Buffer.from(credential),actual=Buffer.from(request.headers.get("authorization")??"");
  if(!secret || actual.length!==expected.length || !timingSafeEqual(actual,expected))return NextResponse.json({error:"unauthorized"},{status:401});
  const db=createAdminClient();
  const pending=await db.from(DB.webhookEvents).select("delivery_id").is("processed_at",null).not("payload","is",null)
    .order("last_attempt_at",{nullsFirst:true}).order("received_at").limit(25);
  if(pending.error)return NextResponse.json({error:"receipt lookup failed"},{status:503});
  let processed=0,failed=0;
  for(const row of pending.data){
    try{await processGitHubReceipt(db,row.delivery_id);processed++;}
    catch{failed++;}
  }
  return NextResponse.json({processed,failed},{status:failed?503:200});
}
