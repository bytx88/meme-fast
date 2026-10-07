import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderFetch} from '../worker/provider-fetch.mjs';
import {selectMarketTargets,validPriorityIds} from '../worker/refresh-priority.mjs';
import {marketFreshness,freshnessCounts} from '../dist/market-freshness.mjs';
import {refreshMarket} from '../worker/coin-collector.mjs';
import {discoveryPlan,discoverPools} from '../worker/pool-discovery.mjs';

test('paced queue starts each timeout at dispatch and spaces actual requests',async()=>{
 let clock=1000;const calls=[];
 const fetcher=createProviderFetch(async(url,options)=>{calls.push({at:clock,aborted:options.signal.aborted});return {status:200}},
  {now:()=>clock,sleep:async ms=>{clock+=ms},policies:{'api.dexscreener.com':{interval:500,limit:3}}});
 await Promise.all([1,2,3].map(i=>fetcher(`https://api.dexscreener.com/${i}`,{signal:AbortSignal.abort()})));
 assert.deepEqual(calls,[{at:1000,aborted:false},{at:1500,aborted:false},{at:2000,aborted:false}]);
 await assert.rejects(fetcher('https://api.dexscreener.com/4'),/budget reached/);
});
test('long Retry-After skips traffic without exceeding the deadline and persists across runs',async()=>{
 let calls=0;
 const fetcher=createProviderFetch(async()=>{calls++;return {status:429,headers:new Headers({'retry-after':'120'})}}, {now:()=>1000,budgetMs:90000});
 const results=await Promise.allSettled([1,2,3].map(i=>fetcher(`https://api.geckoterminal.com/${i}`)));
 assert.equal(calls,1);assert.equal(results[1].status,'rejected');
 const next=createProviderFetch(async()=>{calls++;return {status:200}},{now:()=>2000,initial:fetcher.state(),budgetMs:90000});
 await assert.rejects(next('https://api.geckoterminal.com/test'),/cooldown/);
 assert.equal(calls,1);
});
test('a transient rate limit waits, retries once, and resumes discovery across chains',async()=>{
 let clock=1000;const calls=[],feeds={};
 const fetcher=createProviderFetch(async url=>{
  calls.push({url,at:clock});
  return calls.length===1?new Response(null,{status:429,headers:{'retry-after':'60'}}):Response.json({data:[],included:[]});
 },{now:()=>clock,sleep:async ms=>{clock+=ms}});
 await discoverPools(fetcher,clock,feeds);
 assert.equal(calls[1].at,61000);
 assert.equal(calls[0].url,calls[1].url);
 assert(Object.values(feeds).every(feed=>feed.status==='ok'));
 assert(clock<211000);
});
test('a provider in cooldown does not block another provider',async()=>{
 let resume;const sleeping=new Promise(resolve=>{resume=resolve});let clock=1000;
 const fetcher=createProviderFetch(async()=>new Response(null,{status:200}),{
  now:()=>clock,sleep:async ms=>{await sleeping;clock+=ms},initial:{'api.geckoterminal.com':{cooldownUntil:61000}}
 });
 const discovery=fetcher('https://api.geckoterminal.com/discovery');
 const market=await fetcher('https://api.dexscreener.com/market');
 assert.equal(market.status,200);assert.equal(clock,1000);
 resume();assert.equal((await discovery).status,200);
});
test('first discovery requests cover every chain and view before deeper pagination',()=>{
 const plan=discoveryPlan(),firstDeep=plan.findIndex(item=>item.page>1);
 assert.equal(firstDeep,10);
 assert.deepEqual(plan.slice(0,5).map(item=>item.key),['solana','base','robinhood','bsc','bsc_trending']);
 assert.equal(new Set(plan.slice(0,firstDeep).map(item=>item.key)).size,10);
 assert.equal(plan.length,20);
 assert.deepEqual(plan.filter(item=>item.network.id==='bsc').map(item=>[item.kind,item.page]),[['new_pools',1],['trending_pools',1]]);
});
test('indexed refresh runs before deeper pages even when later discovery exhausts its budget',async()=>{
 const calls=[],feeds={};let indexed=false;
 const fetcher=async url=>{
  calls.push(url);
  if(calls.length>11)throw Error('collection budget reached');
  if(url.endsWith('/indexed'))indexed=true;
  return Response.json({data:[],included:[]});
 };
 await discoverPools(fetcher,1000,feeds,{betweenPasses:()=>fetcher('https://api.geckoterminal.com/indexed')});
 assert.equal(indexed,true);
 assert(calls[10].endsWith('/indexed'));
 assert(calls[11].includes('page=2'));
 assert.equal(feeds.solana_trending.status,'ok');
 assert.equal(feeds.solana.error,'collection budget reached');
});
test('failed requests do not poison the provider queue',async()=>{
 let calls=0;
 const fetcher=createProviderFetch(async()=>{if(++calls===1)throw Error('network');return {status:200}}, {policies:{'api.dexscreener.com':{interval:0,limit:2}}});
 const result=await Promise.allSettled([1,2].map(i=>fetcher(`https://api.dexscreener.com/${i}`)));
 assert.equal(result[0].status,'rejected');assert.equal(result[1].status,'fulfilled');
});
test('saved contracts precede ranking sample, then retained contracts rotate by attempt',()=>{
 const coins=['saved','ranked','old','attempted'].map((id,i)=>({id:`solana:${id}`,network:'solana',contract_address:id,firstSeen:1,marketAttemptAt:i===3?100:0,marketUpdatedAt:i}));
 assert.deepEqual(selectMarketTargets(coins,[coins[1]],['solana:saved'],1e9,3).map(c=>c.contract_address),['saved','ranked','old']);
 const next=coins.map(c=>({...c,marketAttemptAt:c.contract_address==='old'?200:c.marketAttemptAt}));
 assert.equal(selectMarketTargets(next,[coins[1]],['solana:saved'],1e9,3).at(-1).contract_address,'attempted');
});
test('priority contracts are bounded and Solana identities stay case-sensitive',()=>{
 assert.throws(()=>validPriorityIds(Array(31).fill('base:0x'+'a'.repeat(40))));
 assert.throws(()=>validPriorityIds(['ethereum:0x'+'a'.repeat(40)]));
 const id='solana:'+'A'.repeat(32);assert.deepEqual(validPriorityIds([id,id]),[id]);
 const [coin]=refreshMarket([{id,network:'solana',contract_address:'A'.repeat(32),marketUpdatedAt:1}], [{chainId:'solana',baseToken:{address:'a'.repeat(32)},liquidity:{usd:10000}}],2000);
 assert.equal(coin.marketUpdatedAt,1);
});
test('freshness distinguishes age from partial, missing and future market timestamps',()=>{
 const now=1e9,coin={marketUpdatedAt:now,liquidity:5000,volume5m:0,buys5m:0,sells5m:0};
 assert.equal(marketFreshness(coin,now).state,'fresh');
 assert.equal(marketFreshness({...coin,marketUpdatedAt:now-16*60000},now).state,'stale');
 assert.equal(marketFreshness({...coin,liquidity:null},now).state,'incomplete');
 assert.equal(marketFreshness({...coin,marketUpdatedAt:now+1},now).state,'unknown');
 assert.equal(marketFreshness({...coin,marketUpdatedAt:0},now).state,'unknown');
 assert.match(freshnessCounts([coin,{...coin,liquidity:null},{}],now),/^1 fresh · 0 stale · 2 partial/);
});
