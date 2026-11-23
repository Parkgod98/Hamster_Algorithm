import type { SupabaseClient } from "@supabase/supabase-js";
import { DB,RPC } from "./db";
import { parseBaekjoonHubCommit,type PushCommit } from "./baekjoonhub";
import type { NormalizedSubmission } from "./types";
import { evaluateMemberProgress,loadStudyProgressContext,notificationStateForProgress } from "./server-progress";
import { shouldSendCompletion } from "./notification-rules";
import { sendStudyNotificationOnce } from "./push";
import { studyDateFromTimestamp } from "./study-day";

export type PushPayload = { repository?: { id: number }; commits?: PushCommit[] };
type Saved = { target_study: string; solver: string; event_id: string };

export async function recordGitHubSolutions(db: SupabaseClient, connectionId: string,
  source: "github" | "backfill", submissions: NormalizedSubmission[], deliveryId: string | null = null) {
  const {data,error} = await db.rpc(RPC.recordGitHubSolutions,{p_connection:connectionId,p_source:source,p_submissions:submissions,p_delivery:deliveryId});
  if(error)throw error;
  return (data ?? []) as Saved[];
}

async function sendCompletions(db: SupabaseClient, saved: Saved[], parsed: Map<string,NormalizedSubmission>) {
  const date=studyDateFromTimestamp(new Date().toISOString());
  const groups=new Map<string,Saved[]>();
  for (const row of saved) {
    const group=groups.get(row.target_study) ?? [];
    group.push(row); groups.set(row.target_study,group);
  }
  for (const [studyId,rows] of groups) {
    const userId=rows[0].solver;
    try {
      const context=await loadStudyProgressContext(db,studyId,date,[userId]);
      if(!context)continue;
      const after=notificationStateForProgress(evaluateMemberProgress(context,userId,date));
      if(after!=="complete")continue;
      // Subtract only rows inserted by this transaction. Redelivery and concurrent
      // deliveries that overlapped it cannot subtract an existing user's solve.
      const prior=(context.solutionsByUser.get(userId)??[]).map(row=>({...row}))
        .sort((a,b)=>Date.parse(a.solved_through)-Date.parse(b.solved_through));
      for(const row of rows){
        const item=parsed.get(row.event_id);
        if(!item)continue;
        const solvedAt=Date.parse(item.solvedAt);
        const day=studyDateFromTimestamp(item.solvedAt);
        const group=prior.find(group=>group.solves>0 && group.study_date===day && group.platform===item.platform
          && group.difficulty===item.difficulty && Date.parse(group.solved_through)>=solvedAt);
        if(group)group.solves-=1;
      }
      context.solutionsByUser.set(userId,prior.filter(group=>group.solves>0));
      const before=notificationStateForProgress(evaluateMemberProgress(context,userId,date));
      if(shouldSendCompletion(before,after))await sendStudyNotificationOnce(db,{studyId,userId,studyDate:date,kind:"completion"});
    } catch {console.error("GitHub completion notification failed",{studyId});}
  }
}

export async function processGitHubReceipt(db: SupabaseClient,deliveryId: string) {
  const receipt=await db.from(DB.webhookEvents).select("event_name,payload,processed_at").eq("delivery_id",deliveryId).single();
  if(receipt.error)throw receipt.error;
  if(receipt.data.processed_at)return {ok:true,duplicate:true};
  const payload=receipt.data.payload as PushPayload | null;
  if(!payload)throw new Error("Missing delivery payload");
  const attempt=await db.from(DB.webhookEvents).update({last_attempt_at:new Date().toISOString()}).eq("delivery_id",deliveryId);
  if(attempt.error)throw attempt.error;
  let connectionId: string | undefined;
  if(receipt.data.event_name==="push" && payload.repository){
    const connection=await db.from(DB.repositoryConnections).select("id")
      .eq("github_repository_id",payload.repository.id).eq("active",true).maybeSingle();
    if(connection.error)throw connection.error;
    connectionId=connection.data?.id;
  }
  if(!connectionId || !payload.repository){
    const complete=await db.from(DB.webhookEvents).update({processed_at:new Date().toISOString(),payload:null}).eq("delivery_id",deliveryId);
    if(complete.error)throw complete.error;
    return {ok:true,ignored:true};
  }
  const parsed=new Map<string,NormalizedSubmission>();
  for(const commit of payload.commits??[])for(const item of parseBaekjoonHubCommit(payload.repository.id,commit))parsed.set(item.sourceEventId,item);
  const saved=await recordGitHubSolutions(db,connectionId,"github",[...parsed.values()],deliveryId);
  await sendCompletions(db,saved,parsed);
  return {ok:true,inserted:saved.length};
}
