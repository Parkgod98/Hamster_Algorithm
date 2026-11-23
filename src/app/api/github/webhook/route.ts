import { NextResponse } from "next/server";
import { DB } from "@/lib/db";
import { verifyGithubSignature } from "@/lib/github-app";
import { processGitHubReceipt,type PushPayload } from "@/lib/github-ingestion";
import { createAdminClient } from "@/lib/supabase";

export async function POST(request: Request) {
  const raw=await request.text();
  if(!verifyGithubSignature(raw,request.headers.get("x-hub-signature-256")))return NextResponse.json({error:"invalid signature"},{status:401});
  const delivery=request.headers.get("x-github-delivery");
  if(!delivery)return NextResponse.json({error:"missing delivery id"},{status:400});
  let payload:PushPayload;
  try{payload=JSON.parse(raw);if(!payload || typeof payload!=="object")throw new Error();}
  catch{return NextResponse.json({error:"invalid payload"},{status:400});}
  try{
    const db=createAdminClient();
    const receipt=await db.from(DB.webhookEvents).insert({delivery_id:delivery,event_name:request.headers.get("x-github-event")??"unknown",
      repository_id:payload.repository?.id??null,payload});
    if(receipt.error?.code==="23505"){
      // Old interrupted deliveries may predate durable payloads. A signed
      // redelivery supplies the missing body without replacing a saved body.
      const repair=await db.from(DB.webhookEvents).update({payload}).eq("delivery_id",delivery).is("payload",null).is("processed_at",null);
      if(repair.error)throw repair.error;
    }else if(receipt.error)throw receipt.error;
    return NextResponse.json(await processGitHubReceipt(db,delivery));
  }catch{
    return NextResponse.json({error:"delivery processing incomplete"},{status:503});
  }
}
