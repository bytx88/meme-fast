import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HOUR=60*60_000;
const MAX_TARGETS=8;
const MAX_PAGES=3;
const EMPTY={version:1,status:'disconnected',sampledAt:null,coins:{}};
const validId=id=>/^(solana:[1-9A-HJ-NP-Za-km-z]{32,44}|(?:base|robinhood):0x[a-fA-F0-9]{40})$/.test(id);
const compact=value=>String(value??'').trim();
const uniq=items=>[...new Set(items)];

export function selectTargets(snapshot,config={},limit=MAX_TARGETS){
 const configured=Array.isArray(config.targets)?config.targets:[];
 const candidates=uniq([...(snapshot?.coins||[]),...(snapshot?.radarCoins||[])].filter(c=>validId(c?.id)).map(c=>c.id));
 const byId=new Map([...(snapshot?.coins||[]),...(snapshot?.radarCoins||[])].filter(c=>validId(c?.id)).map(c=>[c.id,c]));
 const manual=configured.filter(t=>validId(t?.id)).map(t=>({id:t.id,contract:t.id.split(':')[1],aliases:Array.isArray(t.aliases)?t.aliases.filter(a=>typeof a==='string'&&a.length>=3&&a.length<=80).slice(0,3):[],keyHandles:Array.isArray(t.keyHandles)?t.keyHandles.filter(h=>/^@?[A-Za-z0-9_]{1,15}$/.test(h)).map(h=>h.replace(/^@/,'').toLowerCase()).slice(0,10):[]}));
 const targetIds=uniq([...manual.map(t=>t.id),...candidates.sort((a,b)=>(Number(byId.get(b)?.buyers)||0)-(Number(byId.get(a)?.buyers)||0))]).slice(0,limit);
 return targetIds.map(id=>manual.find(t=>t.id===id)||{id,contract:id.split(':')[1],aliases:[],keyHandles:[]});
}

export function searchQuery(target){
 const terms=[`"${target.contract}"`,...target.aliases.map(a=>`"${a.replaceAll('"','')}"`)];
 return `(${terms.join(' OR ')}) -is:retweet`;
}

export function xfluxQuery(target){
 return [`"${target.contract}"`,...target.aliases.map(a=>`"${a.replaceAll('"','')}"`)].join(' OR ');
}

function matches(text,target){
 const lower=compact(text).toLowerCase();
 if(lower.includes(target.contract.toLowerCase()))return 'Exact contract mention';
 for(const alias of target.aliases){
  const term=alias.toLowerCase(),at=lower.indexOf(term);
  if(at>=0&&(!/[a-z0-9]/.test(term[0])||at===0||!/[a-z0-9]/.test(lower[at-1]))&&(!/[a-z0-9]/.test(term.at(-1))||at+term.length===lower.length||!/[a-z0-9]/.test(lower[at+term.length])))return `Configured alias: ${alias}`;
 }
 return null;
}

function score(posts,keyHandles){
 const accounts=new Set(posts.map(p=>p.authorId)).size;
 const engagement=posts.reduce((sum,p)=>sum+Math.min(200,Math.max(0,p.likes)+2*Math.max(0,p.reposts)+Math.max(0,p.replies)),0);
 const base=45*Math.sqrt(Math.min(1,accounts/50))+25*Math.sqrt(Math.min(1,engagement/1000))+15*Math.sqrt(Math.min(1,posts.length/100));
 const key=posts.filter(p=>keyHandles.includes(p.username.toLowerCase())).length;
 return {score:Math.round(keyHandles.length?base+15*Math.min(1,key/2):base/0.85),accounts,key};
}

export function summarizePosts(target,payloads,now=Date.now()){
 const all=new Map();
 for(const payload of payloads){
  const users=new Map((payload.includes?.users||[]).map(u=>[u.id,u]));
  for(const post of payload.data||[]){
   const at=Date.parse(post.created_at),reason=matches(post.text,target);
   if(!reason||!Number.isFinite(at)||at<now-12*HOUR||at>now||!/^\d+$/.test(String(post.id)))continue;
   const user=users.get(post.author_id),metrics=post.public_metrics||{};
   all.set(post.id,{id:post.id,at,authorId:String(post.author_id||''),username:String(user?.username||''),likes:Number(metrics.like_count)||0,reposts:Number(metrics.retweet_count)||0,replies:Number(metrics.reply_count)||0,reason});
  }
 }
 const posts=[...all.values()],current=posts.filter(p=>p.at>=now-6*HOUR),previous=posts.filter(p=>p.at<now-6*HOUR);
 const currentScore=score(current,target.keyHandles),previousScore=score(previous,target.keyHandles);
 return {score:currentScore.score,delta6h:currentScore.score-previousScore.score,uniqueAccounts6h:currentScore.accounts,posts6h:current.length,keyInteractions6h:target.keyHandles.length?currentScore.key:null,sampledAt:now,coverage:target.aliases.length?'contract + configured aliases':'exact contract',posts:current.sort((a,b)=>b.at-a.at).slice(0,10).map(p=>({url:`https://x.com/${p.username||'i'}/status/${p.id}`,author:p.username?`@${p.username}`:'View post',reason:p.reason}))};
}

export async function searchTarget(target,bearer,fetcher=fetch,now=Date.now()){
 const payloads=[];let nextToken;
 for(let page=0;page<MAX_PAGES;page++){
  const url=new URL('https://api.x.com/2/tweets/search/recent');
  url.searchParams.set('query',searchQuery(target));
  url.searchParams.set('start_time',new Date(now-12*HOUR).toISOString());
  url.searchParams.set('max_results','100');
  url.searchParams.set('post.fields','created_at,public_metrics');
  url.searchParams.set('expansions','author_id');
  url.searchParams.set('user.fields','username');
  if(nextToken)url.searchParams.set('next_token',nextToken);
  const response=await fetcher(url,{headers:{Authorization:`Bearer ${bearer}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`X recent search HTTP ${response.status}`);
  const payload=await response.json();
  if(!Array.isArray(payload.data)&&Number(payload.meta?.result_count)!==0)throw new Error('Invalid X recent search response');
  payloads.push(payload);nextToken=payload.meta?.next_token;
  if(!nextToken)return summarizePosts(target,payloads,now);
 }
 throw new Error('X search exceeds the page cap; score withheld');
}

export async function searchTargetXFlux(target,key,fetcher=fetch,now=Date.now()){
 const url=new URL('https://www.xfluxapi.com/api/v1/search');
 url.searchParams.set('q',xfluxQuery(target));
 url.searchParams.set('limit','100');
 const response=await fetcher(url,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`XFlux search HTTP ${response.status}`);
 const payload=await response.json();
 if(!Array.isArray(payload.data))throw new Error('Invalid XFlux search response');
 if(!payload.data.length)throw new Error('XFlux returned no search evidence; score withheld');
 if(payload.data.length>=100)throw new Error('XFlux search reached the 100-post cap; score withheld');
 const users=new Map(),posts=[];
 for(const post of payload.data){
  const reportedAt=Date.parse(post.created_at),reason=matches(post.text,target);
  if(!reason||!Number.isFinite(reportedAt)||reportedAt<now-12*HOUR||reportedAt>now+5*60_000)continue;
  const at=Math.min(reportedAt,now);
  const author=post.author||post.user||{};
  const username=String(author.username||post.author_username||post.username||'').replace(/^@/,'');
  const authorId=String(post.author_id||author.id||username.toLowerCase());
  const metrics=post.public_metrics||{};
  if(!/^\d+$/.test(String(post.id))||!authorId||(target.keyHandles.length&&!username)||!Number.isFinite(Number(metrics.like_count))||!Number.isFinite(Number(metrics.retweet_count))||!Number.isFinite(Number(metrics.reply_count)))throw new Error('XFlux omitted post, author, or engagement fields; score withheld');
  users.set(authorId,{id:authorId,username});
  posts.push({...post,created_at:new Date(at).toISOString(),author_id:authorId,public_metrics:metrics});
 }
 if(!posts.length){
  const recent=payload.data.filter(post=>{const at=Date.parse(post.created_at);return Number.isFinite(at)&&at>=now-12*HOUR&&at<=now+5*60_000}).length;
  const matching=payload.data.filter(post=>matches(post.text,target)).length;
  const newest=Math.max(...payload.data.map(post=>Date.parse(post.created_at)).filter(Number.isFinite));
  const newestAge=Number.isFinite(newest)?`${Math.round((now-newest)/60_000)}m old`:'unknown age';
  throw new Error(`XFlux returned no matching recent posts (${payload.data.length} returned, ${recent} recent, ${matching} text matches, newest ${newestAge}); score withheld`);
 }
 const reading=summarizePosts(target,[{data:posts,includes:{users:[...users.values()]}}],now);
 return {...reading,coverage:`XFlux sampled search (up to 100 posts); ${reading.coverage}`,source:'xflux'};
}

async function writeReport(filename,report){
 await mkdir(path.dirname(filename),{recursive:true});
 const temporary=`${filename}.tmp`;
 await writeFile(temporary,JSON.stringify(report));
 await rename(temporary,filename);
}

export async function collectXFactor({snapshotFile,outputFile,configFile,provider=process.env.X_FACTOR_PROVIDER||'xflux',token=provider==='xflux'?process.env.XFLUX_API_KEY:process.env.X_BEARER_TOKEN,fetcher=fetch,now=Date.now(),targetLimit=Number(process.env.X_FACTOR_TARGET_LIMIT)||MAX_TARGETS}){
 if(!token){await writeReport(outputFile,EMPTY);return EMPTY}
 const snapshot=JSON.parse(await readFile(snapshotFile,'utf8'));
 let config={};
 if(configFile){try{config=JSON.parse(await readFile(configFile,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}}
 const targets=selectTargets(snapshot,config,Math.min(MAX_TARGETS,Math.max(1,Math.floor(targetLimit)||1))),coins={},errors=[];
 for(const target of targets){
  try{coins[target.id]=await (provider==='xflux'?searchTargetXFlux(target,token,fetcher,now):searchTarget(target,token,fetcher,now))}
  catch(error){errors.push({id:target.id,message:error.message});if(/HTTP (401|402|403|429|5\d\d)/.test(error.message))break}
 }
 const report={version:1,status:Object.keys(coins).length?'connected':'error',source:provider,sampledAt:now,coverage:{sampled:Object.keys(coins).length,targeted:targets.length,method:'recent search; exact contract plus configured aliases'},coins,errors};
 await writeReport(outputFile,report);
 return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [snapshotFile='.data/coins.json',outputFile='.data/x-factor.json',configFile='x-factor-targets.json']=process.argv.slice(2);
 collectXFactor({snapshotFile,outputFile,configFile}).then(report=>console.log(`X Factor: ${report.status}; ${Object.keys(report.coins).length} measured coins`)).catch(error=>{console.error(`X Factor: ${error.message}`);process.exitCode=1});
}
