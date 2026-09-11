import { addStudyDays } from "./study-day";
import { consumeForDay } from "./rules";

export type TimelineDay={date:string;credits:number;postponed:boolean};
export type TimelineResult={date:string;state:"complete"|"in-progress"|"postponed"|"missed";available:number};

export function evaluateTimeline(days:TimelineDay[],currentDate:string,maxCarryDays=2):TimelineResult[]{
  const ordered=[...days].sort((a,b)=>a.date.localeCompare(b.date)); const lots:{earnedOn:string;credit:number}[]=[]; const out:TimelineResult[]=[];
  for(const day of ordered){
    if(day.credits>0)lots.push({earnedOn:day.date,credit:day.credits});
    for(const lot of lots){ if(dayDistance(lot.earnedOn,day.date)>maxCarryDays)lot.credit=0; }
    const available=lots.reduce((s,l)=>s+l.credit,0);
    if(day.postponed){out.push({date:day.date,state:"postponed",available});continue;}
    if(day.date===currentDate&&available<1){out.push({date:day.date,state:"in-progress",available});continue;}
    const result=consumeForDay(lots,day.date,maxCarryDays);
    out.push({date:day.date,state:result.complete?"complete":"missed",available});
  }
  return out;
}

export function dateRange(start:string,end:string){const dates=[];for(let d=start;d<=end;d=addStudyDays(d,1))dates.push(d);return dates;}
function dayDistance(a:string,b:string){return Math.floor((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000);}
