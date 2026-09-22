import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {NETWORKS,FEEDS,parsePools,fetchPublicSource,addressMatches} from '../dist/public-radar.mjs';
import {sourcesFor,storyParagraph,bestSearchLead} from '../dist/coin-context.mjs';

export const RETENTION_MS=5*86400000;
const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,i*size+size));
const amount=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
export function refreshMarket(coins,pairs,now=Date.now()){
 const byAddress=new Map();
 for(const pair of pairs){
  const address=pair?.baseToken?.address;if(!address)continue;
  const key=`${String(pair.chainId).toLowerCase()}:${String(address).toLowerCase()}`,current=byAddress.get(key);
  if(!current||amount(pair.liquidity?.usd)>amount(current.liquidity?.usd))byAddress.set(key,pair);
 }
 return coins.map(coin=>{
  const pair=byAddress.get(`${coin.network}:${String(coin.contract_address).toLowerCase()}`);
  if(!pair)return coin;
  return {...coin,pool:pair.pairAddress||coin.pool,liquidity:amount(pair.liquidity?.usd)??coin.liquidity,volume:amount(pair.volume?.h24)??coin.volume,volume5m:amount(pair.volume?.m5),buyers:amount(pair.txns?.h24?.buys)??coin.buyers,buys:amount(pair.txns?.h24?.buys)??coin.buys,sells:amount(pair.txns?.h24?.sells)??coin.sells,buys5m:amount(pair.txns?.m5?.buys),sells5m:amount(pair.txns?.m5?.sells),priceChange:amount(pair.priceChange?.h24)??coin.priceChange,marketUpdatedAt:now,fetchedAt:now};
 });
}
export function mergeCoins(previous,incoming,now=Date.now()){
 const rows=new Map(previous.filter(c=>c.firstSeen>now-RETENTION_MS).map(c=>[c.id,c]));
 for(const coin of incoming){
  const old=rows.get(coin.id);
  if(!old&&!(coin.poolCreated>=now-36*3600000&&coin.liquidity>=3000&&(coin.buys??0)+(coin.sells??0)>=5))continue;
  rows.set(coin.id,{...old,...coin,firstSeen:old?.firstSeen??now,savedContext:old?.savedContext??null});
 }
 return [...rows.values()];
}
export async function readSnapshot(filename){
 try{
  const snapshot=JSON.parse(await readFile(filename,'utf8'));
  if(!Array.isArray(snapshot.coins))throw new Error('Invalid coin snapshot');
  return snapshot;
 }catch(error){if(error.code==='ENOENT')return {version:1,coins:[],lastRun:null,feeds:{}};throw error}
}
async function save(filename,snapshot){
 await mkdir(path.dirname(filename),{recursive:true});
 await writeFile(filename+'.tmp',JSON.stringify(snapshot));
 await rename(filename+'.tmp',filename);
}
async function story(coin,fetcher){
 for(const source of sourcesFor(coin)){
  try{
   const response=await fetcher('https://r.jina.ai/'+source.url,{signal:AbortSignal.timeout(18000)});
   if(!response.ok)continue;
   const text=(await response.text()).slice(0,60000),snippet=storyParagraph(text);
   if(snippet)return {kind:'web',web:{...source,snippet,exact:source.contract===coin.contract_address&&coin.network==='solana'&&text.includes(coin.contract_address),attribution:'Source description; claims have not been independently verified.'}};
  }catch{}
 }
 const query='"'+coin.name+'" '+coin.symbol+' meme origin story';
 const response=await fetcher('https://r.jina.ai/http://html.duckduckgo.com/html/?'+new URLSearchParams({q:query}),{signal:AbortSignal.timeout(18000)});
 if(!response.ok)throw new Error('Context provider unavailable');
 const lead=bestSearchLead((await response.text()).slice(0,60000));
 return lead?{kind:'web',web:{...lead,exact:false,attribution:'Related name or theme; connection to this contract is unverified.'}}:null;
}
export async function collect(filename,{fetcher=fetch,now=Date.now()}={}){
 const previous=await readSnapshot(filename),feeds={...previous.feeds},incoming=[];
 const results=await Promise.allSettled(NETWORKS.map(async network=>{
  const response=await fetcher('https://api.geckoterminal.com/api/v2/networks/'+network.id+'/new_pools?include=base_token,quote_token',{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('HTTP '+response.status);
  return parsePools(await response.json(),network,now);
 }));
 results.forEach((r,i)=>{
  const key=NETWORKS[i].id;
  if(r.status==='fulfilled'){incoming.push(...r.value);feeds[key]={lastSuccess:now,error:null}}
  else feeds[key]={...feeds[key],error:String(r.reason.message),lastAttempt:now};
 });
 let coins=mergeCoins(previous.coins,incoming,now);
 const marketResults=await Promise.allSettled([...new Map(coins.map(c=>[c.network,c])).keys()].flatMap(network=>{
  const addresses=coins.filter(c=>c.network===network).map(c=>c.contract_address);
  return chunks(addresses,30).map(async batch=>{
   const response=await fetcher(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(network)}/${batch.map(encodeURIComponent).join(',')}`,{signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error(`Market refresh HTTP ${response.status}`);
   const pairs=await response.json();return Array.isArray(pairs)?pairs:[];
  });
 }));
 coins=refreshMarket(coins,marketResults.flatMap(r=>r.status==='fulfilled'?r.value:[]),now);
 const snapshot={version:1,coins,lastRun:now,feeds};
 // Commit discovery first so slow or failed story lookups cannot lose coins.
 await save(filename,snapshot);
 const news=await Promise.allSettled([...FEEDS.map(feed=>fetchPublicSource(feed,fetcher)),(async()=>{
  const response=await fetcher('https://api.dexscreener.com/token-profiles/latest/v1',{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Profiles unavailable');
  const profiles=await response.json();return Array.isArray(profiles)?profiles:[];
 })()]);
 const articles=news.slice(0,FEEDS.length).flatMap(r=>r.status==='fulfilled'?r.value:[]);
 const profiles=news.at(-1).status==='fulfilled'?news.at(-1).value:[];
 for(const coin of coins){
  const matches=articles.filter(a=>addressMatches({posts:[a]},[coin]).length);
  if(matches.length)coin.savedContext={kind:'verified',articles:matches.slice(0,2)};
  if(!coin.savedContext){
   const profile=profiles.find(p=>p.chainId===coin.network&&(coin.network==='solana'?p.tokenAddress===coin.contract_address:String(p.tokenAddress).toLowerCase()===coin.contract_address.toLowerCase())&&(p.description?.trim()||p.links?.some(l=>/x\.com|twitter\.com/i.test(l.url||''))));
   if(profile)coin.savedContext={kind:'verified',profile};
  }
  if(!coin.savedContext){
   const name=coin.name.toLowerCase(),symbol=coin.symbol.toLowerCase();
   const related=articles.filter(a=>{const text=(a.title+' '+a.summary).toLowerCase();return name.length>=4&&text.includes(name)||symbol.length>=4&&text.split(/[^a-z0-9]+/).includes(symbol)});
   if(related.length)coin.savedContext={kind:'rss',articles:related.slice(0,2)};
  }
 }
 // Bounded work; pending coins are retried on later scheduled runs.
 const queue=coins.filter(c=>!c.savedContext&&(!c.contextCheckedAt||c.contextCheckedAt<now-6*3600000))
  .sort((a,b)=>(a.contextCheckedAt??0)-(b.contextCheckedAt??0)||b.firstSeen-a.firstSeen).slice(0,4);
 for(const coin of queue){
  try{const found=await story(coin,fetcher);if(found)coin.savedContext=found;coin.contextError=null}
  catch{coin.contextError='Context source unavailable'}
  coin.contextCheckedAt=now;
 }
 await save(filename,snapshot);
 return snapshot;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const snapshot=await collect(process.argv[2]);
 console.log(JSON.stringify({coins:snapshot.coins.length,lastRun:snapshot.lastRun,feeds:snapshot.feeds}));
}
