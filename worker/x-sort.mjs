import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const FRESH_MS=4*60*60_000;
export const STALE_MS=8*60*60_000;
const RETRY_MS=30*60_000;
const DAY_MS=24*60*60_000;
const THEMES=[
 {id:'x-money',name:'X payments / xMoney',query:'xMoney',terms:['xmoney','x payments']},
 {id:'e-acc',name:'e/acc',query:'e/acc',terms:['e/acc','effective accelerationism']},
 {id:'stock-pairing',name:'Stock pairing / coin airdrops',query:'stock pairing',terms:['stock pairing','stock-pairing']},
 {id:'tokenized-stocks',name:'Tokenized stocks',query:'tokenized stocks',terms:['tokenized stocks','tokenized stock']},
];
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const errorMessage=error=>String(error?.message||error).slice(0,200);
export function postTime(id){
 try{return /^\d+$/.test(id)?Number((BigInt(id)>>22n)+1288834974657n):NaN}catch{return NaN}
}

export function summarizeTheme(theme,payload,now=Date.now()){
 if(!Array.isArray(payload?.data))throw new Error('Invalid XFlux search response');
 const seen=new Set(),posts=[];
 for(const item of payload.data){
  // XFlux currently reports near-fetch created_at for old posts. The Snowflake ID carries the post time.
  const id=String(item?.id||''),at=postTime(id),body=String(item?.text||'');
  if(!/^\d+$/.test(id)||seen.has(id)||!Number.isFinite(at)||at<now-DAY_MS||at>now+5*60_000)continue;
  if(!theme.terms.some(term=>body.toLowerCase().includes(term)))continue;
  seen.add(id);
  const metrics=item.public_metrics||{},author=item.author||item.user||{};
  const username=String(author.username||item.author_username||item.username||'').replace(/^@/,'');
  posts.push({id,at,url:`https://x.com/i/status/${id}`,author:username?`@${username}`:'X post',text:body.slice(0,280),engagement:Math.max(0,number(metrics.like_count))+2*Math.max(0,number(metrics.retweet_count))+Math.max(0,number(metrics.reply_count))});
 }
 posts.sort((a,b)=>b.at-a.at);
 return {id:theme.id,name:theme.name,query:theme.query,posts24h:posts.length,latestAt:posts[0]?.at||null,sampleCapped:payload.data.length>=100,evidence:posts.slice(0,3).map(({url,author,text,at})=>({url,author,text,at}))};
}

export async function searchTheme(theme,key,fetcher=fetch,now=Date.now()){
 const url=new URL('https://www.xfluxapi.com/api/v1/search');
 url.searchParams.set('q',theme.query);url.searchParams.set('limit','100');
 const response=await fetcher(url,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`XFlux HTTP ${response.status}`);
 return summarizeTheme(theme,await response.json(),now);
}

async function readCache(filename){try{return JSON.parse(await readFile(filename,'utf8'))}catch{return null}}
async function saveCache(filename,value){const temp=`${filename}.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(value));await rename(temp,filename)}
function serve(cache,now,status){return {...cache,cacheStatus:status,nextRefreshAt:cache.sampledAt+FRESH_MS,staleAfter:cache.sampledAt+STALE_MS,ageMs:now-cache.sampledAt}}

export async function collectXSort({filename,key=process.env.XFLUX_API_KEY,fetcher=fetch,now=Date.now()}){
 const stored=await readCache(filename),cache=stored?.version===2?stored:null,age=now-number(cache?.sampledAt);
 if(cache?.sampledAt&&age>=0&&age<FRESH_MS)return serve(cache,now,'fresh');
 if(cache?.lastAttemptAt&&now-cache.lastAttemptAt<RETRY_MS){
  if(cache.sampledAt&&age<STALE_MS)return serve(cache,now,'stale');
  return {version:2,status:'error',cacheStatus:'error',message:'XFlux retry cooldown is active.',nextRefreshAt:cache.lastAttemptAt+RETRY_MS,themes:[]};
 }
 if(!key)return {version:2,status:'error',cacheStatus:'error',message:'XFlux API key is unavailable.',themes:[]};
 const themes=[],errors=[];
 for(const theme of THEMES){
  try{themes.push(await searchTheme(theme,key,fetcher,now))}
  catch(error){errors.push({theme:theme.name,message:errorMessage(error)});if(/HTTP (401|402|403|429|5\d\d)/.test(errorMessage(error)))break}
 }
 if(!themes.length){
  const fallback={...(cache||{}),lastAttemptAt:now};await saveCache(filename,fallback);
  if(cache?.sampledAt&&age<STALE_MS)return {...serve(cache,now,'stale'),errors};
  return {version:2,status:'error',cacheStatus:'error',message:errors[0]?.message||'XFlux returned no usable response.',nextRefreshAt:now+RETRY_MS,themes:[],errors};
 }
 themes.sort((a,b)=>b.posts24h-a.posts24h||(b.latestAt||0)-(a.latestAt||0));
 const report={version:2,status:errors.length?'partial':themes.some(t=>t.posts24h)?'connected':'no-evidence',source:'xflux',sampledAt:now,lastAttemptAt:now,method:'24-hour matching posts in four tracked XFlux searches; ranked by sampled post count; post time from X ID',themes,errors};
 await saveCache(filename,report);
 return serve(report,now,'fresh');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const filename=process.argv[2]||'/history/x-sort.json';
 collectXSort({filename}).then(report=>console.log(JSON.stringify(report))).catch(error=>{console.error(errorMessage(error));process.exitCode=1});
}
