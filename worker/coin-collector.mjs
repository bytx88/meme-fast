import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {NETWORKS,RADAR_NETWORKS,FEEDS,parsePools,fetchPublicSource,addressMatches,safeURL} from '../dist/public-radar.mjs';
import {sourcesFor,storyParagraph,bestSearchLead} from '../dist/coin-context.mjs';
import {normalizeLaunchpad} from '../dist/coin-stages.mjs';
import {evaluatePostMigration,evaluateLaterRecovery,observationStart,outcomeCoverage,POST_MIGRATION_WINDOW_MS,EARLY_AGE_LIMIT_MS,LATE_RECOVERY_WINDOW_MS} from '../dist/post-migration.mjs';
import {feedStatus,coverageFor,validateSnapshot,PIPELINE_LIMITS} from './snapshot-contract.mjs';
import {snapshotVersion,versionFile} from './snapshot-view.mjs';
import {createProviderFetch} from './provider-fetch.mjs';
import {selectMarketTargets,tokenKey} from './refresh-priority.mjs';
import {discoverPools,discoverLaunchpads} from './pool-discovery.mjs';

export const RETENTION_MS=PIPELINE_LIMITS.retentionMs;
export const RECENT_MARKET_MS=4*3600000;
export const RADAR_LIMIT_PER_CHAIN=PIPELINE_LIMITS.radarPerChain;
export const TRACKED_RADAR_TOKENS=[{network:'robinhood',contract:'0x6249519883b8d7ccf915dfcd6c0442984dae9d24'}];
const trackedRadarIds=new Set(TRACKED_RADAR_TOKENS.map(token=>`${token.network}:${token.contract.toLowerCase()}`));
const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,i*size+size));
const amount=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
export function refreshMarket(coins,pairs,now=Date.now()){
 const byAddress=new Map();
 for(const pair of pairs){
  const address=pair?.baseToken?.address;if(!address)continue;
  const key=tokenKey(`${String(pair.chainId).toLowerCase()}:${address}`),current=byAddress.get(key);
  if(!current||amount(pair.liquidity?.usd)>amount(current.liquidity?.usd))byAddress.set(key,pair);
 }
 return coins.map(coin=>{
  const pair=byAddress.get(tokenKey(`${coin.network}:${coin.contract_address}`));
  if(!pair)return coin;
  return {...coin,image_url:safeURL(pair.info?.imageUrl)||coin.image_url||null,pool:pair.pairAddress||coin.pool,dex:pair.dexId||coin.dex,liquidity:amount(pair.liquidity?.usd),priceUsd:amount(pair.priceUsd)??coin.priceUsd,priceUpdatedAt:amount(pair.priceUsd)!==null?now:coin.priceUpdatedAt,volume:amount(pair.volume?.h24),volume5m:amount(pair.volume?.m5),buyers:amount(pair.txns?.h24?.buys)??coin.buyers,buys:amount(pair.txns?.h24?.buys)??coin.buys,sells:amount(pair.txns?.h24?.sells)??coin.sells,buys5m:amount(pair.txns?.m5?.buys),sells5m:amount(pair.txns?.m5?.sells),priceChange:amount(pair.priceChange?.h24),marketUpdatedAt:now,fetchedAt:now};
 });
}
export function recordMarketHistory(coins,now=Date.now()){
 return coins.map(coin=>{
  const recentVolume1h=rows=>rows.filter(row=>row.at>=now-60*60000).reduce((total,row)=>total+(Number(row.volume5m)>0?Number(row.volume5m):0),0);
  if(coin.marketUpdatedAt!==now)return {...coin,recentVolume1h:recentVolume1h(coin.marketHistory||[])};
  const sample={at:now,priceUsd:coin.priceUpdatedAt===now?amount(coin.priceUsd):null,liquidity:amount(coin.liquidity),volume5m:amount(coin.volume5m),buys5m:amount(coin.buys5m),sells5m:amount(coin.sells5m),volume24h:amount(coin.volume)};
  const recent=(coin.marketHistory||[]).filter(row=>row.at>now-RECENT_MARKET_MS&&row.at<now);
  recent.push(sample);
  const hourly=(coin.marketHistoryHourly||[]).filter(row=>row.at>now-RETENTION_MS&&row.at<now);
  if(!hourly.length||now-hourly.at(-1).at>=55*60000)hourly.push(sample);
  return {...coin,marketHistory:recent.slice(-48),marketHistoryHourly:hourly.slice(-120),recentVolume1h:recentVolume1h(recent)};
 });
}
export function refreshLaunchpad(coins,tokens,now=Date.now()){
 const key=(network,address)=>`${network}:${network==='solana'?address:String(address).toLowerCase()}`;
 const byId=new Map(tokens.filter(token=>token.attributes?.address).map(token=>{
  const network=String(token.id||'').split('_')[0];
  return [key(network,token.attributes.address),normalizeLaunchpad(token.attributes.launchpad_details)];
 }));
 return coins.map(coin=>{
  const id=key(coin.network,coin.contract_address);
  if(!byId.has(id))return coin;
  const launchpad=byId.get(id);
  if(!launchpad)return {...coin,launchpad:coin.launchpad??null,launchpadUpdatedAt:now};
  return {...coin,launchpad,launchpadUpdatedAt:now,graduationObservedAt:launchpad.completed?launchpad.completedAt??coin.graduationObservedAt??now:coin.graduationObservedAt};
 });
}
export function selectPriceBackfills(coins,now=Date.now(),limit=8){
 const eligible=coins.filter(coin=>{
  const start=observationStart(coin),age=start===null?Infinity:now-start;
  return coin.pool&&age>=0&&age<=RETENTION_MS&&!(coin.priceHistory5m||[]).length&&
   (!coin.priceHistoryCheckedAt||now-coin.priceHistoryCheckedAt>=30*60000);
 });
 const byVolume=(a,b)=>(b.volume??0)-(a.volume??0);
 const early=eligible.filter(coin=>now-observationStart(coin)<=EARLY_AGE_LIMIT_MS).sort(byVolume);
 const later=eligible.filter(coin=>now-observationStart(coin)>EARLY_AGE_LIMIT_MS).sort(byVolume);
 const selected=[...early.slice(0,Math.ceil(limit/2)),...later.slice(0,Math.floor(limit/2))];
 if(selected.length<limit)selected.push(...[...early.slice(Math.ceil(limit/2)),...later.slice(Math.floor(limit/2))].sort(byVolume).slice(0,limit-selected.length));
 return selected;
}
export async function backfillPriceHistory(coins,fetcher=fetch,now=Date.now()){
 const selected=selectPriceBackfills(coins,now),byId=new Map();
 await Promise.allSettled(selected.map(async coin=>{
  try{
   const end=Math.min(now,observationStart(coin)+LATE_RECOVERY_WINDOW_MS);
   let pool=coin.pool;
   try{if(coin.contract_address){
    const lookup=await fetcher(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(coin.contract_address)}`,{signal:AbortSignal.timeout(15000)});
    if(lookup.ok){
     const payload=await lookup.json();
     const sameAddress=address=>coin.network==='solana'?address===coin.contract_address:String(address).toLowerCase()===String(coin.contract_address).toLowerCase();
     const pairs=(payload.pairs||[]).filter(pair=>pair.chainId===coin.network&&sameAddress(pair.baseToken?.address)&&Number(pair.liquidity?.usd)>=1000&&Number(pair.pairCreatedAt)>0);
     pairs.sort((a,b)=>a.pairCreatedAt-b.pairCreatedAt);
     if(pairs[0]?.pairAddress)pool=pairs[0].pairAddress;
    }
   }}catch{}
   const url=`https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(coin.network)}/pools/${encodeURIComponent(pool)}/ohlcv/minute?aggregate=5&limit=288&currency=usd&before_timestamp=${Math.floor(end/1000)}`;
   const response=await fetcher(url,{signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error(`OHLCV HTTP ${response.status}`);
   const payload=await response.json();
   const rows=payload?.data?.attributes?.ohlcv_list;
   if(!Array.isArray(rows))throw new Error('Invalid OHLCV');
   const start=observationStart(coin);
   const priceHistory5m=rows.filter(row=>Array.isArray(row)&&Number(row[0])>0&&Number(row[4])>0)
    .map(row=>({at:Number(row[0])*1000+5*60000,priceUsd:Number(row[4])}))
    .filter(row=>row.at>=start&&row.at<=start+LATE_RECOVERY_WINDOW_MS)
    .sort((a,b)=>a.at-b.at);
   byId.set(coin.id,{priceHistory5m,priceHistoryPool:pool,priceHistoryCheckedAt:now});
  }catch{byId.set(coin.id,{priceHistoryCheckedAt:now})}
 }));
 return coins.map(coin=>byId.has(coin.id)?{...coin,...byId.get(coin.id)}:coin);
}
export function updateMigrationStates(coins,now=Date.now()){
 return coins.map(coin=>{
  const start=observationStart(coin);
  if(start===null||now<start)return coin;
  const age=now-start;
  let next=coin;
  if(age<=EARLY_AGE_LIMIT_MS){
   const result=evaluatePostMigration(coin,now);
   if(result?.state==='rugged'){
    next={...next,ruggedAt:result.at,rugDrawdownPercent:Math.round(result.drawdown*100)};
    if(result.earlySuccess&&!coin.sustainedAt)next={...next,sustainedAt:result.earlySuccess.at,successScenario:result.earlySuccess.scenario,recoveryPercent:Math.round(result.earlySuccess.recovery*100)};
   }
   else if(result?.state==='sustained'&&!coin.sustainedAt)next={...next,sustainedAt:result.at,successScenario:result.scenario,washDrawdownPercent:Math.round(result.drawdown*100),recoveryPercent:Math.round(result.recovery*100)};
  }
  if(age>EARLY_AGE_LIMIT_MS&&age<=RETENTION_MS&&!next.laterRecoveryAt){
   const result=evaluateLaterRecovery(next,now);
   if(result)next={...next,laterRecoveryAt:result.at,laterRecoveryPercent:Math.round(result.recovery*100),laterDrawdownPercent:Math.round(result.drawdown*100)};
  }
  const successCoverage=age<POST_MIGRATION_WINDOW_MS?'observing':outcomeCoverage(next,age<=EARLY_AGE_LIMIT_MS?POST_MIGRATION_WINDOW_MS:LATE_RECOVERY_WINDOW_MS,now);
  return {...next,successCoverage};
 });
}
export function selectLaunchCandidates(coins,limit=120){
 const selected=[],seen=new Set();
 const add=coin=>{if(selected.length<limit&&!seen.has(coin.id)){selected.push(coin);seen.add(coin.id)}};
 const newest=[...coins].sort((a,b)=>b.firstSeen-a.firstSeen);
 // New pairs get first claim on the bounded launchpad budget.
 newest.slice(0,Math.max(1,Math.floor(limit*2/3))).forEach(add);
 newest.filter(c=>c.launchpad?.completed===false&&c.launchpad.graduationPercentage>=80).sort((a,b)=>(a.launchpadCheckedAt??0)-(b.launchpadCheckedAt??0)).slice(0,Math.max(1,Math.floor(limit/6))).forEach(add);
 [...coins].sort((a,b)=>(a.launchpadCheckedAt??0)-(b.launchpadCheckedAt??0)||b.firstSeen-a.firstSeen).forEach(add);
 return selected;
}
export function mergeCoins(previous,incoming,now=Date.now()){
 const rows=new Map(previous.filter(c=>c.firstSeen>now-RETENTION_MS).map(c=>[c.id,c]));
 for(const coin of incoming){
  const old=rows.get(coin.id);
  if(!old&&!((coin.poolCreated>=now-36*3600000||coin.launchpadSource)&&coin.liquidity>=3000&&(coin.buys??0)+(coin.sells??0)>=5))continue;
  const created=[old?.poolCreated,coin.poolCreated].filter(value=>Number.isFinite(Number(value))&&Number(value)>0).map(Number);
  rows.set(coin.id,{...old,...coin,poolCreated:created.length?Math.min(...created):coin.poolCreated,image_url:coin.image_url||old?.image_url||null,firstSeen:old?.firstSeen??now,savedContext:old?.savedContext??null});
 }
 return [...rows.values()];
}
export function mergeRadarCoins(previous,incoming,coins,now=Date.now()){
 const rows=new Map((previous||[]).filter(c=>c.lastSeenRadarAt>now-RETENTION_MS).map(c=>[c.id,c]));
 for(const coin of [...incoming,...coins]){
  if(!coin.id||!coin.contract_address||!coin.network||amount(coin.liquidity)<3000)continue;
  const old=rows.get(coin.id);
  const richer=(key)=>(old?.[key]?.length||0)>(coin[key]?.length||0)?old[key]:coin[key]||old?.[key]||[];
  rows.set(coin.id,{...old,...coin,firstSeenRadarAt:old?.firstSeenRadarAt??now,lastSeenRadarAt:now,
   marketHistory:richer('marketHistory'),marketHistoryHourly:richer('marketHistoryHourly'),
   savedContext:coin.savedContext??old?.savedContext??null});
 }
 const counts=new Map();
 return [...rows.values()].sort((a,b)=>Number(trackedRadarIds.has(b.id.toLowerCase()))-Number(trackedRadarIds.has(a.id.toLowerCase()))||b.lastSeenRadarAt-a.lastSeenRadarAt||(b.volume??0)-(a.volume??0)).filter(coin=>{
  const count=counts.get(coin.network)||0;if(count>=RADAR_LIMIT_PER_CHAIN)return false;counts.set(coin.network,count+1);return true;
 });
}
export async function readSnapshot(filename){
 try{
  const snapshot=JSON.parse(await readFile(filename,'utf8'));
  if(!Array.isArray(snapshot.coins))throw new Error('Invalid coin snapshot');
  return snapshot;
 }catch(error){if(error.code==='ENOENT')return {version:1,coins:[],lastRun:null,feeds:{}};throw error}
}
async function save(filename,snapshot){
 validateSnapshot(snapshot);
 await mkdir(path.dirname(filename),{recursive:true});
 await writeFile(filename+'.tmp',JSON.stringify(snapshot));
 await rename(filename+'.tmp',filename);
 const versionPath=versionFile(filename);
 await writeFile(versionPath+'.tmp',JSON.stringify(snapshotVersion(snapshot)));
 await rename(versionPath+'.tmp',versionPath);
 const healthPath=filename.replace(/\.json$/,'')+'.health.json';
 await writeFile(healthPath+'.tmp',JSON.stringify({revision:snapshot.revision??null,lastRun:snapshot.lastRun??null,feeds:snapshot.feeds??null}));
 await rename(healthPath+'.tmp',healthPath);
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
export async function collectLaunchpad(coins,fetcher,now,feeds,{launchPools=[],priorityIds=[]}={}){
 const launchCandidates=selectLaunchCandidates(coins);
 const selectedIds=new Set(launchCandidates.map(c=>c.id));
 const priority=new Set(priorityIds.map(tokenKey));
 for(const coin of coins.filter(c=>priority.has(tokenKey(c.id))).slice(0,30)){
  if(!selectedIds.has(coin.id)){launchCandidates.push(coin);selectedIds.add(coin.id)}
 }
 // Additional budget for active curves, independent of newest-pair admission.
 // Pool liquidity selects checks; only authoritative launchpad data assigns a stage.
 const active=[...launchPools,...coins.filter(c=>['pumpfun','meteoradbc'].includes(c.dex)&&c.launchpad?.completed!==true)];
 active.filter(c=>c.liquidity>=3000||(c.volume5m>0&&c.volume>=15000)).sort((a,b)=>(b.liquidity??0)-(a.liquidity??0)).forEach(c=>{
  if(launchCandidates.length<200&&!selectedIds.has(c.id)){launchCandidates.push(c);selectedIds.add(c.id)}
 });
 // Send active-curve batches first so a provider cooldown cannot consume their entire allocation.
 const activeIds=new Set(active.map(c=>c.id));
 launchCandidates.sort((a,b)=>Number(priority.has(tokenKey(b.id)))-Number(priority.has(tokenKey(a.id)))||Number(activeIds.has(b.id))-Number(activeIds.has(a.id)));
 const launchBatches=[...new Set(launchCandidates.map(c=>c.network))].flatMap(network=>chunks(launchCandidates.filter(c=>c.network===network),20));
 const launchResults=await Promise.allSettled(launchBatches.map(async batch=>{
  const network=batch[0].network,addresses=batch.map(c=>encodeURIComponent(c.contract_address)).join(',');
  const response=await fetcher(`https://api.geckoterminal.com/api/v2/networks/${network}/tokens/multi/${addresses}?include=top_pools`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Launchpad data HTTP ${response.status}`);
  const payload=await response.json();
  const tokens=Array.isArray(payload.data)?payload.data:[];
  const pools=parsePools({data:(payload.included||[]).filter(p=>p.type==='pool'),included:tokens},NETWORKS.find(n=>n.id===network),now);
  return {tokens,pools};
 }));
 const launchTokens=launchResults.flatMap(r=>r.status==='fulfilled'?r.value.tokens:[]);
 const launchFailure=launchResults.find(r=>r.status==='rejected');
 if(launchResults.length)feeds.launchpad=feedStatus(feeds.launchpad,now,launchFailure?{error:launchFailure.reason.message,returnedRecords:launchTokens.length}:{records:launchTokens.length});
 else feeds.launchpad={...feeds.launchpad,status:'idle',error:null,returnedRecords:null};
 const checked=new Set(launchResults.flatMap((r,i)=>r.status==='fulfilled'?launchBatches[i].map(c=>c.id):[]));
 return {tokens:launchTokens,pools:launchResults.flatMap(r=>r.status==='fulfilled'?r.value.pools:[]),checked,attemptedRequests:launchResults.length};
}

async function enrichMarket(coins,radarCoins,fetcher,now,feeds,{priorityIds=[],marketOnly=false,skipMarket=false}={}){
 const targets=skipMarket?[]:selectMarketTargets(coins,radarCoins,priorityIds,now);
 const marketResults=await Promise.allSettled([...new Set(targets.map(c=>c.network))].flatMap(network=>{
  const addresses=targets.filter(c=>c.network===network).map(c=>c.contract_address);
  return chunks(addresses,30).map(async batch=>{
   const response=await fetcher(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(network)}/${batch.map(encodeURIComponent).join(',')}`,{signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error(`Market refresh HTTP ${response.status}`);
   const pairs=await response.json();return Array.isArray(pairs)?pairs:[];
  });
 }));
 const pairs=marketResults.flatMap(r=>r.status==='fulfilled'?r.value:[]);
 const marketFailure=marketResults.find(r=>r.status==='rejected');
 if(marketResults.length)feeds.dex_market=feedStatus(feeds.dex_market,now,marketFailure?{error:marketFailure.reason.message,returnedRecords:pairs.length}:{records:pairs.length});
 else if(!skipMarket)feeds.dex_market={...feeds.dex_market,status:'idle',error:null,returnedRecords:null};
 const attempted=new Set(targets.map(c=>tokenKey(c.id)));
 coins=coins.map(c=>attempted.has(tokenKey(c.id))?{...c,marketAttemptAt:now}:c);
 radarCoins=radarCoins.map(c=>attempted.has(tokenKey(c.id))?{...c,marketAttemptAt:now}:c);
 coins=recordMarketHistory(refreshMarket(coins,pairs,now),now);
 radarCoins=recordMarketHistory(refreshMarket(radarCoins,pairs,now),now);
 if(marketOnly)return {coins,radarCoins,refreshedPairs:pairs.length,attemptedRequests:marketResults.length,selected:targets.length};
 coins=updateMigrationStates(await backfillPriceHistory(coins,fetcher,now),now);
 return {coins,radarCoins,refreshedPairs:pairs.length,attemptedRequests:marketResults.length};
}

async function enrichContext(snapshot,fetcher,now){
 const {coins,radarCoins,feeds}=snapshot;
 const news=await Promise.allSettled([...FEEDS.map(feed=>fetchPublicSource(feed,fetcher)),(async()=>{
  const response=await fetcher('https://api.dexscreener.com/token-profiles/latest/v1',{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Profiles unavailable');
  const profiles=await response.json();return Array.isArray(profiles)?profiles:[];
 })()]);
 const articles=news.slice(0,FEEDS.length).flatMap(r=>r.status==='fulfilled'?r.value:[]);
 const profiles=news.at(-1).status==='fulfilled'?news.at(-1).value:[];
 FEEDS.forEach((feed,index)=>{const result=news[index];feeds[`news_${feed.id}`]=feedStatus(feeds[`news_${feed.id}`],now,result.status==='fulfilled'?{records:result.value.length}:{error:result.reason.message})});
 const profileResult=news.at(-1);
 feeds.dex_profiles=feedStatus(feeds.dex_profiles,now,profileResult.status==='fulfilled'?{records:profiles.length}:{error:profileResult.reason.message});
 const coinIds=new Set(coins.map(c=>c.id));
 const contextTargets=[...coins,...radarCoins.filter(c=>!coinIds.has(c.id))];
 for(const coin of contextTargets){
  const exactProfile=profiles.find(p=>p.chainId===coin.network&&(coin.network==='solana'?p.tokenAddress===coin.contract_address:String(p.tokenAddress).toLowerCase()===coin.contract_address.toLowerCase()));
  coin.image_url=safeURL(exactProfile?.icon)||coin.image_url||null;
  const matches=articles.filter(a=>addressMatches({posts:[a]},[coin]).length);
  if(matches.length)coin.savedContext={kind:'verified',articles:matches.slice(0,2)};
  if(!coin.savedContext){
   const profile=exactProfile&&(exactProfile.description?.trim()||exactProfile.links?.some(l=>/x\.com|twitter\.com/i.test(l.url||'')))?exactProfile:null;
   if(profile)coin.savedContext={kind:'verified',profile};
  }
  if(!coin.savedContext){
   const name=coin.name.toLowerCase(),symbol=coin.symbol.toLowerCase();
   const related=articles.filter(a=>{const text=(a.title+' '+a.summary).toLowerCase();return name.length>=4&&text.includes(name)||symbol.length>=4&&text.split(/[^a-z0-9]+/).includes(symbol)});
   if(related.length)coin.savedContext={kind:'rss',articles:related.slice(0,2)};
  }
 }
 const queue=contextTargets.filter(c=>!c.savedContext&&(!c.contextCheckedAt||c.contextCheckedAt<now-6*3600000))
  .sort((a,b)=>(a.contextCheckedAt??0)-(b.contextCheckedAt??0)||b.firstSeen-a.firstSeen).slice(0,4);
 for(const coin of queue){
  try{const found=await story(coin,fetcher);if(found)coin.savedContext=found;coin.contextError=null}
  catch{coin.contextError='Context source unavailable'}
  coin.contextCheckedAt=now;
 }
 const byId=new Map(coins.map(c=>[c.id,c]));
 for(const coin of radarCoins){const current=byId.get(coin.id);if(current){coin.savedContext=current.savedContext;coin.contextCheckedAt=current.contextCheckedAt}}
 return {articles:articles.length,profiles:profiles.length,checked:queue.length,failedLookups:queue.filter(coin=>coin.contextError).length};
}
export async function collect(filename,{fetcher=fetch,now=Date.now(),priorityIds=[]}={}){
 const previous=await readSnapshot(filename),feeds={...previous.feeds};
 const paced=fetcher===fetch?createProviderFetch(fetch,{initial:previous.providerState}):null;
 if(paced)fetcher=paced;
 // Cover essential discovery, then launchpad checks and indexed pools before deeper pagination.
 let tracked=[],indexedCoins=[],launch,launchPools=[];
 const discovery=discoverPools(fetcher,now,feeds,{initialCount:NETWORKS.length,betweenPasses:async({incoming,trending})=>{
 // Graduation checks must precede indexed refresh and deeper discovery, which can exhaust Gecko's budget.
 const retainedLaunchPools=(previous.coins||[]).filter(c=>c.launchpadSource&&c.firstSeen>now-RETENTION_MS);
 launch=await collectLaunchpad(mergeCoins(previous.coins||[],[...incoming,...trending],now),fetcher,now,feeds,{launchPools:retainedLaunchPools,priorityIds});
 launchPools=await discoverLaunchpads(fetcher,now,feeds);
 let indexedFeed={pools:[],status:{lastScanAt:null,count:0,backfillComplete:false,errors:{notStarted:'Pool indexer has not run'}}};
 try{indexedFeed=JSON.parse(await readFile(path.join(path.dirname(filename),'robinhood-pool-feed.json'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
 const rpcError=Object.values(indexedFeed.status?.errors||{}).join('; ');
 feeds.robinhood_rpc=feedStatus(feeds.robinhood_rpc,indexedFeed.status?.lastScanAt??now,{error:rpcError||null,records:indexedFeed.status?.count??0,pools:indexedFeed.status?.count??0,backfillComplete:indexedFeed.status?.backfillComplete===true});
 const trackedResults=await Promise.allSettled(TRACKED_RADAR_TOKENS.map(async token=>{
  const network=RADAR_NETWORKS.find(network=>network.id===token.network);
  try{
   const response=await fetcher(`https://api.geckoterminal.com/api/v2/networks/${network.id}/tokens/${encodeURIComponent(token.contract)}/pools?include=base_token,quote_token`,{signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error(`Tracked token HTTP ${response.status}`);
   const matches=parsePools(await response.json(),network,now).filter(coin=>coin.contract_address.toLowerCase()===token.contract.toLowerCase());
   if(matches.length)return matches;
  }catch{}
  const response=await fetcher(`https://api.dexscreener.com/tokens/v1/${network.id}/${encodeURIComponent(token.contract)}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Tracked token fallback HTTP ${response.status}`);
  const pairs=await response.json();
  const pair=Array.isArray(pairs)?pairs.filter(pair=>pair.chainId===network.id&&pair.baseToken?.address?.toLowerCase()===token.contract.toLowerCase()&&/^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(pair.pairAddress||'')).sort((a,b)=>(b.liquidity?.usd??0)-(a.liquidity?.usd??0))[0]:null;
  if(!pair)throw new Error('Tracked contract has no eligible pool');
  return [{id:`${network.id}:${token.contract}`,name:pair.baseToken.name||pair.baseToken.symbol||'Unknown token',symbol:pair.baseToken.symbol||'?',image_url:safeURL(pair.info?.imageUrl),network:network.id,chain:network.name,contract_address:token.contract,contract_verified:true,pool:pair.pairAddress,poolCreated:amount(pair.pairCreatedAt),mc:amount(pair.marketCap),fdv:amount(pair.fdv),volume:amount(pair.volume?.h24),volume5m:amount(pair.volume?.m5),liquidity:amount(pair.liquidity?.usd),buys:amount(pair.txns?.h24?.buys),sells:amount(pair.txns?.h24?.sells),buys5m:amount(pair.txns?.m5?.buys),sells5m:amount(pair.txns?.m5?.sells),priceUsd:amount(pair.priceUsd),priceChange:amount(pair.priceChange?.h24),fetchedAt:now,marketUpdatedAt:now,priceUpdatedAt:now}];
 }));
 tracked=trackedResults.flatMap(result=>result.status==='fulfilled'?result.value:[]);
 trackedResults.forEach((result,index)=>{const key=`${TRACKED_RADAR_TOKENS[index].network}_tracked`;feeds[key]=feedStatus(feeds[key],now,result.status==='fulfilled'?{records:result.value.length}:{error:result.reason.message})});
 const duePools=Array.isArray(indexedFeed.pools)?indexedFeed.pools:[];
 const indexedBatches=chunks(duePools,30);
 const indexedResults=await Promise.allSettled(indexedBatches.map(async batch=>{
  const ids=batch.map(pool=>encodeURIComponent(pool.pool)).join(',');
  const response=await fetcher(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/multi/${ids}?include=base_token,quote_token`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Indexed pools HTTP ${response.status}`);
  return parsePools(await response.json(),NETWORKS.find(network=>network.id==='robinhood'),now);
 }));
 indexedCoins=indexedResults.flatMap(result=>result.status==='fulfilled'?result.value:[]);
 const indexedFailure=indexedResults.find(result=>result.status==='rejected');
 if(indexedResults.length)feeds.robinhood_indexed_pools=feedStatus(feeds.robinhood_indexed_pools,now,indexedFailure?{error:indexedFailure.reason.message,returnedRecords:indexedCoins.length}:{records:indexedCoins.length});
 else feeds.robinhood_indexed_pools={...feeds.robinhood_indexed_pools,status:'idle',error:null,returnedRecords:null};
 }});
 // Dexscreener progresses independently while Gecko waits or backs off.
 const retainedRefresh=enrichMarket((previous.coins||[]).filter(c=>c.firstSeen>now-RETENTION_MS),(previous.radarCoins||[]).filter(c=>c.lastSeenRadarAt>now-RETENTION_MS),fetcher,now,feeds,{priorityIds,marketOnly:true});
 const [{incoming,trending,topPools},retained]=await Promise.all([discovery,retainedRefresh]);
 previous.coins=retained.coins;previous.radarCoins=retained.radarCoins;
 const coinsFromDiscovery=mergeCoins(previous.coins,incoming,now);
 let coins=mergeCoins(coinsFromDiscovery,[...trending,...indexedCoins,...launchPools],now);
 // Use the exact token's included pool, after Dex refresh, so omitted Dex liquidity cannot erase curve reserves.
 const curveIds=new Set(launch.tokens.filter(t=>normalizeLaunchpad(t.attributes?.launchpad_details)?.completed===false).map(t=>`${String(t.id).split('_')[0]}:${t.attributes.address}`));
 coins=mergeCoins(coins,launch.pools.filter(c=>curveIds.has(c.id)).map(c=>({...c,launchpadSource:'verified-curve'})),now);
 coins=refreshLaunchpad(coins,launch.tokens,now).map(coin=>launch.checked.has(coin.id)?{...coin,launchpadCheckedAt:now}:coin);
 let radarCoins=mergeRadarCoins(previous.radarCoins,[...incoming,...trending,...topPools,...indexedCoins,...tracked],coins,now);
 const market=await enrichMarket(coins,radarCoins,fetcher,now,feeds,{skipMarket:true});
 market.refreshedPairs+=retained.refreshedPairs;market.attemptedRequests+=retained.attemptedRequests+launch.attemptedRequests;
 coins=market.coins;radarCoins=market.radarCoins;
 const discoverySources=[...NETWORKS.map(network=>network.id),...RADAR_NETWORKS.map(network=>`${network.id}_trending`),'robinhood_rpc','robinhood_indexed_pools','launchpad_pools'];
 const discoveryStatus=discoverySources.some(key=>feeds[key]?.error)?'degraded':'complete';
 const marketStatus=!market.attemptedRequests?'skipped':feeds.dex_market?.error||feeds.launchpad?.error?'degraded':'complete';
 const snapshot={providerState:paced?.state()||previous.providerState||{},version:2,revision:`${now}:1`,coins,radarCoins,lastRun:now,feeds,coverage:coverageFor(feeds),pipeline:{
  discovery:{status:discoveryStatus,completedAt:now,coins:coins.length,radarCoins:radarCoins.length},
  market:{status:marketStatus,completedAt:now,refreshedPairs:market.refreshedPairs,selectedContracts:retained.selected,refreshLimit:1800,priorityContracts:priorityIds.length},
  context:{status:'pending'},
 }};
 // Commit discovery and market data before slower context lookups.
 await save(filename,snapshot);
 // Reserve a separate bounded window so discovery cooldowns cannot starve context.
 const contextFetcher=paced?createProviderFetch(fetch,{initial:paced.state(),budgetMs:45000}):fetcher;
 const context=await enrichContext(snapshot,contextFetcher,now);
 const contextSources=[...FEEDS.map(feed=>`news_${feed.id}`),'dex_profiles'];
 const contextStatus=contextSources.some(key=>feeds[key]?.error)||context.failedLookups?'degraded':'complete';
 snapshot.pipeline.context={status:contextStatus,completedAt:now,...context};
 snapshot.revision=`${now}:2`;
 snapshot.coverage=coverageFor(feeds);
 snapshot.providerState=paced?{...paced.state(),...contextFetcher.state()}:snapshot.providerState;
 await save(filename,snapshot);
 return snapshot;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const snapshot=await collect(process.argv[2],{priorityIds:JSON.parse(process.env.MEME_REFRESH_PRIORITY_IDS||'[]')});
 console.log(JSON.stringify({coins:snapshot.coins.length,lastRun:snapshot.lastRun,feeds:snapshot.feeds}));
}
