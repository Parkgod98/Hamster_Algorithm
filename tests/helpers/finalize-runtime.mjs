import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=fileURLToPath(new URL('../../',import.meta.url));
const nodeRequire=createRequire(import.meta.url);
export const TABLE={studies:'hamster_studies',members:'hamster_study_members',submissions:'hamster_submissions',postponements:'hamster_postponements',versions:'hamster_study_rule_versions',penalties:'hamster_penalties'};

// Executes the actual route and actual domain modules. No network or real Supabase client is available.
export function runtime({cap=1000,joined='2026-10-17',now='2026-10-18T04:05:00+09:00',secret='test-cron',routeSource}={}) {
  let clock=Date.parse(now),sequence=0;
  const state={rows:Object.fromEntries(Object.values(TABLE).map(k=>[k,[]])),queries:[],writes:[],failures:[],onRead:null};
  state.rows[TABLE.studies].push({id:'study',created_at:`${joined}T04:00:00+09:00`,rule_config:{},max_presolve_days:2,max_consecutive_postpone:2,postpone_deadline_hour:23,postpone_deadline_minute:59});
  state.rows[TABLE.members].push({study_id:'study',user_id:'alice',joined_at:`${joined}T04:00:00+09:00`});
  class TestDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  const compare=(key,a,b)=>key.endsWith('_at')?Date.parse(a)-Date.parse(b):String(a).localeCompare(String(b));
  class Query {
    constructor(table){this.table=table;this.filters=[];this.orders=[];this.mode='select';}
    select(columns){this.columns=columns;return this;}
    eq(key,value){this.filters.push(r=>r[key]===value);return this;}
    in(key,values){this.filters.push(r=>values.includes(r[key]));return this;}
    lt(key,value){this.filters.push(r=>compare(key,r[key],value)<0);return this;}
    lte(key,value){this.filters.push(r=>compare(key,r[key],value)<=0);return this;}
    gte(key,value){this.filters.push(r=>compare(key,r[key],value)>=0);return this;}
    order(key,{ascending=true}={}){this.orders.push([key,ascending]);return this;}
    range(from,to){this.from=from;this.to=to;return this;}
    insert(value){this.mode='insert';this.input=value;return this;}
    then(resolve,reject){return Promise.resolve().then(()=>this.execute()).then(resolve,reject);}
    execute(){
      const record={table:this.table,mode:this.mode,from:this.from??0,orders:this.orders};state.queries.push(record);
      const failure=state.failures.find(f=>f.table===this.table&&(f.mode??'select')===this.mode&&(f.from===undefined||f.from===record.from)&&(!f.when||f.when(this)));
      if(failure)return {data:null,error:failure.nullData?null:{code:'TEST_DB_FAILURE',message:'private database detail'}};
      if(this.mode==='insert'){
        if(this.table!==TABLE.penalties)throw new Error('Unexpected write');
        const p=this.input;
        if(state.rows[this.table].some(r=>r.study_id===p.study_id&&r.user_id===p.user_id&&r.study_date===p.study_date))return {data:null,error:{code:'23505'}};
        const saved={...p,id:`pen-${++sequence}`,created_at:new TestDate().toISOString()};state.rows[this.table].push(saved);state.writes.push(saved);return {data:null,error:null};
      }
      state.onRead?.(this.table,record);
      const sorted=state.rows[this.table].filter(r=>this.filters.every(fn=>fn(r))).sort((a,b)=>{for(const [key,asc]of this.orders){const c=compare(key,a[key],b[key]);if(c)return asc?c:-c;}return 0;});
      const from=this.from??0,size=Math.min(cap,this.to===undefined?Infinity:this.to-from+1);
      const data=structuredClone(sorted.slice(from,from+size));record.returned=data.length;return {data,error:null};
    }
  }
  const modules=new Map(),admin={from:table=>new Query(table)};
  function load(filename){
    const abs=path.resolve(root,filename);if(modules.has(abs))return modules.get(abs);
    const source=ts.transpileModule(fs.readFileSync(abs,'utf8'),{fileName:abs,compilerOptions:{
      module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,
    }}).outputText;
    const exports={};modules.set(abs,exports);
    const require=name=>{
      if(name==='next/server')return nodeRequire(name);
      if(name==='@/lib/supabase')return {createAdminClient:()=>admin};
      if(!name.startsWith('@/')&&!name.startsWith('.'))throw new Error(`External I/O/import blocked: ${name}`);
      const base=name.startsWith('@/')?path.join(root,'src',name.slice(2)):path.resolve(path.dirname(abs),name);
      return load(base.endsWith('.ts')?base:base+'.ts');
    };
    new vm.Script(`(function(exports,require){${source}\n})`,{filename:abs}).runInNewContext({Date:TestDate,Error,Map,Set,Array,Number,Math,Request,Response,Headers,URL,process:{env:{CRON_SECRET:secret}},console})(exports,require);
    return exports;
  }
  return {...state,table:TABLE,admin,load,setNow:value=>{clock=Date.parse(value);},setReadHook:fn=>{state.onRead=fn;},
    fail:(key,options={})=>state.failures.push({table:TABLE[key],...options}),
    solve:(date,difficulty='Gold V',user='alice',study='study')=>state.rows[TABLE.submissions].push({id:`sub-${String(++sequence).padStart(8,'0')}`,study_id:study,user_id:user,solved_at:new Date(date.includes('T')?date:`${date}T12:00:00+09:00`).toISOString(),hamster_problems:{platform:'BOJ',difficulty}}),
    postpone:(date,user='alice')=>state.rows[TABLE.postponements].push({id:`post-${++sequence}`,study_id:'study',user_id:user,study_date:date}),
    async request(token='test-cron'){
      const response=await load(routeSource??'src/app/api/cron/finalize/route.ts').GET(new Request('https://local.invalid/api/cron/finalize',{headers:token?{authorization:`Bearer ${token}`}:{}}));
      return {status:response.status,body:await response.json()};
    },
  };
}
