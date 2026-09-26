import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {NETWORKS,RADAR_NETWORKS,FEEDS,parsePools,fetchPublicSource,addressMatches,safeURL} from '../dist/public-radar.mjs';
import {sourcesFor,storyParagraph,bestSearchLead} from '../dist/coin-context.mjs';
import {normalizeLaunchpad} from '../dist/coin-stages.mjs';
import {evaluatePostMigration,evaluateLaterRecovery,observationStart,outcomeCoverage,POST_MIGRATION_WINDOW_MS,EARLY_AGE_LIMIT_MS,LATE_RECOVERY_WINDOW_MS} from '../dist/post-migration.mjs';

export const RETENTION_MS=5*86400000;
export const RECENT_MARKET_MS=4*3600000;
export const RADAR_LIMIT_PER_CHAIN=200;
export const TRACKED_RADAR_TOKENS=[{network:'robinhood',contract:'0x6249519883b8d7ccf915dfcd6c0442984dae9d24'}];
const trackedRadarIds=new Set(TRACKED_RADAR_TOKENS.map(token=>`${token.network}:${token.contract.toLowerCase()}`));
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
  return {...coin,image_url:safeURL(pair.info?.imageUrl)||coin.image_url||null,pool:pair.pairAddress||coin.pool,liquidity:amount(pair.liquidity?.usd)??coin.liquidity,priceUsd:amount(pair.priceUsd)??coin.priceUsd,priceUpdatedAt:amount(pair.priceUsd)!==null?now:coin.priceUpdatedAt,volume:amount(pair.volume?.h24)??coin.volume,volume5m:amount(pair.volume?.m5),buyers:amount(pair.txns?.h24?.buys)??coin.buyers,buys:amount(pair.txns?.h24?.buys)??coin.buys,sells:amount(pair.txns?.h24?.sells)??coin.sells,buys5m:amount(pair.txns?.m5?.buys),sells5m:amount(pair.txns?.m5?.sells),priceChange:amount(pair.priceChange?.h24)??coin.priceChange,marketUpdatedAt:now,fetchedAt:now};
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
 newest.filter(c=>c.launchpad?.completed===false&&c.launchpad.graduationPercentage>=80).slice(0,20).forEach(add);
 newest.slice(0,Math.min(50,Math.max(1,Math.floor(limit*0.4)))).forEach(add);
 [...coins].sort((a,b)=>(a.launchpadCheckedAt??0)-(b.launchpadCheckedAt??0)||b.firstSeen-a.firstSeen).forEach(add);
 return selected;
}
export function mergeCoins(previous,incoming,now=Date.now()){
 const rows=new Map(previous.filter(c=>c.firstSeen>now-RETENTION_MS).map(c=>[c.id,c]));
 for(const coin of incoming){
  const old=rows.get(coin.id);
  if(!old&&!(coin.poolCreated>=now-36*3600000&&coin.liquidity>=3000&&(coin.buys??0)+(coin.sells??0)>=5))continue;
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
 if(fetcher===fetch){
  const direct=fetch;let nextGeckoAt=0,queue=Promise.resolve();
  fetcher=(url,options)=>{
   if(!String(url).startsWith('https://api.geckoterminal.com/'))return direct(url,options);
   const turn=queue.then(async()=>{const wait=Math.max(0,nextGeckoAt-Date.now());if(wait)await new Promise(resolve=>setTimeout(resolve,wait));nextGeckoAt=Date.now()+2100});
   queue=turn.catch(()=>{});
   return turn.then(()=>direct(url,options));
  };
 }
 const previous=await readSnapshot(filename),feeds={...previous.feeds},incoming=[];
 let indexedFeed={pools:[],status:{lastScanAt:null,count:0,backfillComplete:false,errors:{notStarted:'Pool indexer has not run'}}};
 try{indexedFeed=JSON.parse(await readFile(path.join(path.dirname(filename),'robinhood-pool-feed.json'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
 const rpcError=Object.values(indexedFeed.status?.errors||{}).join('; ');
 feeds.robinhood_rpc={lastSuccess:rpcError?feeds.robinhood_rpc?.lastSuccess??null:indexedFeed.status?.lastScanAt??null,error:rpcError||null,lastAttempt:indexedFeed.status?.lastScanAt??null,pools:indexedFeed.status?.count??0,backfillComplete:indexedFeed.status?.backfillComplete===true};
 const duePools=Array.isArray(indexedFeed.pools)?indexedFeed.pools:[];
 const indexedBatches=chunks(duePools,30);
 const indexedResults=await Promise.allSettled(indexedBatches.map(async batch=>{
  const ids=batch.map(pool=>encodeURIComponent(pool.pool)).join(',');
  const response=await fetcher(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/multi/${ids}?include=base_token,quote_token`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Indexed pools HTTP ${response.status}`);
  return parsePools(await response.json(),NETWORKS.find(network=>network.id==='robinhood'),now);
 }));
 const indexedCoins=indexedResults.flatMap(result=>result.status==='fulfilled'?result.value:[]);
 const indexedFailure=indexedResults.find(result=>result.status==='rejected');
 feeds.robinhood_indexed_pools=indexedFailure?{...feeds.robinhood_indexed_pools,error:String(indexedFailure.reason.message),lastAttempt:now}:{lastSuccess:now,error:null};
 const newPoolPages=NETWORKS.flatMap(network=>[1,2,3].map(page=>({network,page})));
 const results=await Promise.allSettled(newPoolPages.map(async ({network,page})=>{
  const response=await fetcher(`https://api.geckoterminal.com/api/v2/networks/${network.id}/new_pools?include=base_token,quote_token&page=${page}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('HTTP '+response.status);
  return parsePools(await response.json(),network,now);
 }));
 results.forEach((r,i)=>{
  const key=newPoolPages[i].network.id;
  if(r.status==='fulfilled'){incoming.push(...r.value);feeds[key]={lastSuccess:now,error:null}}
  else if(newPoolPages[i].page===1)feeds[key]={...feeds[key],error:String(r.reason.message),lastAttempt:now};
 });
 let coins=mergeCoins(previous.coins,incoming,now);
 const trending=[];
 const trendingResults=await Promise.allSettled(RADAR_NETWORKS.map(async network=>{
  const response=await fetcher(`https://api.geckoterminal.com/api/v2/networks/${network.id}/trending_pools?include=base_token,quote_token&duration=1h`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Trending HTTP ${response.status}`);
  return parsePools(await response.json(),network,now);
 }));
 trendingResults.forEach((result,index)=>{
  const key=`${RADAR_NETWORKS[index].id}_trending`;
  if(result.status==='fulfilled'){trending.push(...result.value);feeds[key]={lastSuccess:now,error:null}}
  else feeds[key]={...feeds[key],error:String(result.reason.message),lastAttempt:now};
 });
 coins=mergeCoins(coins,[...trending,...indexedCoins],now);
 const topPoolPages=RADAR_NETWORKS.filter(network=>network.id==='solana'||network.id==='robinhood').flatMap(network=>[1,2,3].map(page=>({network,page})));
 const topResults=await Promise.allSettled(topPoolPages.map(async ({network,page})=>{
  const response=await fetcher(`https://api.geckoterminal.com/api/v2/networks/${network.id}/pools?include=base_token,quote_token&page=${page}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Top pools HTTP ${response.status}`);
  return parsePools(await response.json(),network,now);
 }));
 const topPools=topResults.flatMap(result=>result.status==='fulfilled'?result.value:[]);
 for(const network of RADAR_NETWORKS.filter(network=>network.id==='solana'||network.id==='robinhood')){
  const results=topResults.filter((_,index)=>topPoolPages[index].network.id===network.id);
  const failure=results.find(result=>result.status==='rejected');
  const key=`${network.id}_top_pools`;
  feeds[key]=failure?{...feeds[key],error:String(failure.reason.message),lastAttempt:now}:{lastSuccess:now,error:null};
 }
 const trackedResults=await Promise.allSettled(TRACKED_RADAR_TOKENS.map(async token=>{
  const network=RADAR_NETWORKS.find(network=>network.id===token.network);
  const response=await fetcher(`https://api.geckoterminal.com/api/v2/networks/${network.id}/tokens/${encodeURIComponent(token.contract)}/pools?include=base_token,quote_token`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Tracked token HTTP ${response.status}`);
  const matches=parsePools(await response.json(),network,now).filter(coin=>coin.contract_address.toLowerCase()===token.contract.toLowerCase());
  if(!matches.length)throw new Error('Tracked contract has no eligible pool');
  return matches;
 }));
 const tracked=trackedResults.flatMap(result=>result.status==='fulfilled'?result.value:[]);
 trackedResults.forEach((result,index)=>{const key=`${TRACKED_RADAR_TOKENS[index].network}_tracked`;feeds[key]=result.status==='fulfilled'?{lastSuccess:now,error:null}:{...feeds[key],error:String(result.reason.message),lastAttempt:now}});
 let radarCoins=mergeRadarCoins(previous.radarCoins,[...incoming,...trending,...topPools,...indexedCoins,...tracked],coins,now);
 const targets=[...new Map([...coins,...radarCoins].map(c=>[c.id,c])).values()];
 const marketResults=await Promise.allSettled([...new Set(targets.map(c=>c.network))].flatMap(network=>{
  const addresses=targets.filter(c=>c.network===network).map(c=>c.contract_address);
  return chunks(addresses,30).map(async batch=>{
   const response=await fetcher(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(network)}/${batch.map(encodeURIComponent).join(',')}`,{signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error(`Market refresh HTTP ${response.status}`);
   const pairs=await response.json();return Array.isArray(pairs)?pairs:[];
  });
 }));
 const pairs=marketResults.flatMap(r=>r.status==='fulfilled'?r.value:[]);
 coins=refreshMarket(coins,pairs,now);
 coins=recordMarketHistory(coins,now);
 radarCoins=recordMarketHistory(refreshMarket(radarCoins,pairs,now),now);
 // Keep fresh contracts current and rotate through older contracts so they can
 // enter Final Stretch after their first hour. Bound requests to 120 tokens.
 const launchCandidates=selectLaunchCandidates(coins);
 const launchBatches=[...new Set(launchCandidates.map(c=>c.network))].flatMap(network=>chunks(launchCandidates.filter(c=>c.network===network),20));
 const launchResults=await Promise.allSettled(launchBatches.map(async batch=>{
  const network=batch[0].network,addresses=batch.map(c=>encodeURIComponent(c.contract_address)).join(',');
  const response=await fetcher(`https://api.geckoterminal.com/api/v2/networks/${network}/tokens/multi/${addresses}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Launchpad data HTTP ${response.status}`);
  const payload=await response.json();return Array.isArray(payload.data)?payload.data:[];
 }));
 coins=refreshLaunchpad(coins,launchResults.flatMap(r=>r.status==='fulfilled'?r.value:[]),now);
 const checked=new Set(launchResults.flatMap((r,i)=>r.status==='fulfilled'?launchBatches[i].map(c=>c.id):[]));
 coins=coins.map(coin=>checked.has(coin.id)?{...coin,launchpadCheckedAt:now}:coin);
 coins=await backfillPriceHistory(coins,fetcher,now);
 coins=updateMigrationStates(coins,now);
 const snapshot={version:2,coins,radarCoins,lastRun:now,feeds};
 // Commit discovery first so slow or failed story lookups cannot lose coins.
 await save(filename,snapshot);
 const news=await Promise.allSettled([...FEEDS.map(feed=>fetchPublicSource(feed,fetcher)),(async()=>{
  const response=await fetcher('https://api.dexscreener.com/token-profiles/latest/v1',{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Profiles unavailable');
  const profiles=await response.json();return Array.isArray(profiles)?profiles:[];
 })()]);
 const articles=news.slice(0,FEEDS.length).flatMap(r=>r.status==='fulfilled'?r.value:[]);
 const profiles=news.at(-1).status==='fulfilled'?news.at(-1).value:[];
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
 // Bounded work; pending coins are retried on later scheduled runs.
 const queue=contextTargets.filter(c=>!c.savedContext&&(!c.contextCheckedAt||c.contextCheckedAt<now-6*3600000))
  .sort((a,b)=>(a.contextCheckedAt??0)-(b.contextCheckedAt??0)||b.firstSeen-a.firstSeen).slice(0,4);
 for(const coin of queue){
  try{const found=await story(coin,fetcher);if(found)coin.savedContext=found;coin.contextError=null}
  catch{coin.contextError='Context source unavailable'}
  coin.contextCheckedAt=now;
 }
 const byId=new Map(coins.map(c=>[c.id,c]));
 for(const coin of radarCoins){const current=byId.get(coin.id);if(current){coin.savedContext=current.savedContext;coin.contextCheckedAt=current.contextCheckedAt}}
 await save(filename,snapshot);
 return snapshot;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const snapshot=await collect(process.argv[2]);
 console.log(JSON.stringify({coins:snapshot.coins.length,lastRun:snapshot.lastRun,feeds:snapshot.feeds}));
}
